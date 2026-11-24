import * as THREE from '../vendor/three.module.js';

export const MAP={width:2200,depth:2200,halfWidth:1100,halfDepth:1100,centerLat:43.7135,centerLon:-79.3335};
const mat=(color,roughness=.9,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const groundMat=mat('#526b55');
const seeded=(seed)=>{let value=seed>>>0;return()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const pointSegmentDistance=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,den=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/den));return Math.hypot(px-(ax+t*dx),pz-(az+t*dz));};

function makeLabel(name){
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(3,15,10,.84)';ctx.strokeStyle='rgba(235,194,82,.8)';ctx.lineWidth=5;rounded(ctx,8,10,752,108,18);ctx.fill();ctx.stroke();
  ctx.font='800 31px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#f4e6b6';ctx.fillText(name,384,65,720);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
}
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

export async function createWorld(scene){
  const [buildingResponse,contextResponse,landmarkResponse,treeResponse,sidewalkResponse]=await Promise.all([
    fetch(new URL('../data/flemingdon-buildings.json',import.meta.url)),
    fetch(new URL('../data/flemingdon-context.json',import.meta.url)),
    fetch(new URL('../data/flemingdon-landmarks.json',import.meta.url)),
    fetch(new URL('../data/flemingdon-trees.json',import.meta.url)),
    fetch(new URL('../data/flemingdon-sidewalks.json',import.meta.url))
  ]);
  if(!buildingResponse.ok||!contextResponse.ok||!landmarkResponse.ok||!treeResponse.ok||!sidewalkResponse.ok)throw new Error('Toronto map data could not be loaded.');
  const [buildingData,context,landmarkData,treeData,sidewalkData]=await Promise.all([buildingResponse.json(),contextResponse.json(),landmarkResponse.json(),treeResponse.json(),sidewalkResponse.json()]);
  const random=seeded(24062026),roads=context.roads,parks=context.parks,buildingMeshes=[],treeMeshes=[];
  const cellSize=90,treeCellSize=32,buildingGrid=new Map(),treeGrid=new Map(),buildingCollisions=[];
  scene.background=new THREE.Color('#9caf9f');scene.fog=new THREE.Fog('#9caf9f',1050,2900);
  const hemi=new THREE.HemisphereLight('#e5eddc','#263a2d',1.85);scene.add(hemi);
  const sun=new THREE.DirectionalLight('#ffe8b6',2.45);sun.position.set(-550,950,680);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-1450;sun.shadow.camera.right=1450;sun.shadow.camera.top=1450;sun.shadow.camera.bottom=-1450;sun.shadow.bias=-.00035;scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(MAP.width,MAP.depth),groundMat);ground.rotation.x=-Math.PI/2;ground.position.y=-.24;ground.receiveShadow=true;scene.add(ground);

  createBuildingMeshes(scene,buildingData.features,buildingMeshes,buildingCollisions,buildingGrid,cellSize);
  createParkMeshes(scene,parks);
  createRoadMeshes(scene,roads);
  createSidewalkMeshes(scene,sidewalkData.paths);
  const treeCollisions=createTreeMeshes(scene,treeData.trees,treeGrid,treeCellSize,random,treeMeshes);
  const landmarks=landmarkData.landmarks.map(landmark=>{
    const clear=clearOfBuildings(landmark.x,landmark.z,3,buildingGrid,cellSize)?landmark:findClearSpot(landmark.x,landmark.z,buildingGrid,cellSize,random);
    const marker=clear||landmark;
    if(landmark.label){const label=makeLabel(landmark.name.toUpperCase());label.scale.set(Math.min(180,landmark.name.length*4.6),18,1);label.position.set(marker.x,22,marker.z);scene.add(label);}
    const pin=new THREE.Mesh(new THREE.RingGeometry(2.5,3.2,20),new THREE.MeshBasicMaterial({color:'#e8c456',side:THREE.DoubleSide,transparent:true,opacity:.9}));pin.rotation.x=-Math.PI/2;pin.position.set(marker.x,.06,marker.z);scene.add(pin);
    return{...landmark,markerX:marker.x,markerZ:marker.z};
  });

  const zone=new THREE.Mesh(new THREE.RingGeometry(.992,1,128),new THREE.MeshBasicMaterial({color:'#82dbe7',side:THREE.DoubleSide,transparent:true,opacity:.9}));zone.rotation.x=-Math.PI/2;zone.position.y=.26;scene.add(zone);
  const stormWall=new THREE.Mesh(new THREE.CylinderGeometry(1,1,90,96,1,true),new THREE.MeshBasicMaterial({color:'#54c4de',side:THREE.DoubleSide,transparent:true,opacity:.06,depthWrite:false}));stormWall.position.y=45;scene.add(stormWall);

  const lootSpawns=[],kinds=['rifle','shotgun','medkit','shield','ammo','rifle','shotgun'];
  for(let i=0;i<34;i++){const spot=findClearSpot((random()-.5)*(MAP.width-180),(random()-.5)*(MAP.depth-180),buildingGrid,cellSize,random);if(spot)lootSpawns.push({...spot,type:kinds[Math.floor(random()*kinds.length)]});}
  for(const supply of [{x:-465,z:-220,type:'rifle'},{x:-900,z:-430,type:'shotgun'},{x:600,z:400,type:'shield'},{x:185,z:380,type:'medkit'},{x:45,z:-625,type:'rifle'},{x:880,z:-150,type:'ammo'}]){
    const spot=findClearSpot(supply.x,supply.z,buildingGrid,cellSize,random);if(spot)lootSpawns.push({...spot,type:supply.type});
  }
  return{bounds:MAP,collisions:treeCollisions,treeGrid,treeCellSize,buildingGrid,buildingCellSize:cellSize,buildingCollisions,buildingMeshes,treeMeshes,roads,parks,sidewalks:sidewalkData.paths,landmarks,lootSpawns,zone,stormWall,ground,buildingSource:buildingData.source,contextSource:context.source,landmarkSource:landmarkData.source,treeSource:treeData.source,sidewalkSource:sidewalkData.source};
}

function createBuildingMeshes(scene,features,buildingMeshes,collisions,grid,cellSize){
  const palette=[
    [mat('#766e5f',.94),mat('#b6aa91',.88)],
    [mat('#627068',.92),mat('#b0b6a8',.84)],
    [mat('#59645e',.88),mat('#c1b89e',.82)],
    [mat('#4f5b59',.84),mat('#c9c6b7',.76)]
  ];
  const batches=palette.map(()=>[[],[]]),windowRecords=[];
  for(const feature of features){
    const height=Math.max(3,Math.min(180,Number(feature.height)||10));
    const tier=height<9?0:height<20?1:height<55?2:3;
    const polygons=buildingPolygons(feature.parts||[]);
    if(!polygons.length)continue;
    const allPoints=polygons.flatMap(polygon=>polygon.outer);
    const bounds={minX:Math.min(...allPoints.map(p=>p[0])),maxX:Math.max(...allPoints.map(p=>p[0])),minZ:Math.min(...allPoints.map(p=>p[1])),maxZ:Math.max(...allPoints.map(p=>p[1])),polygons};
    collisions.push(bounds);indexCellGrid(grid,bounds,cellSize);
    for(const polygon of polygons){
      appendFacadeWindows(polygon.outer,height,windowRecords);
      const shape=shapeFromBuildingPolygon(polygon);
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,steps:1,bevelEnabled:false,curveSegments:1});
      geometry.rotateX(-Math.PI/2);
      const index=geometry.getIndex(),positions=geometry.attributes.position,normals=geometry.attributes.normal;
      for(const group of geometry.groups){
        const target=batches[tier][group.materialIndex===1?1:0];
        for(let i=group.start;i<group.start+group.count;i++){
          const vertex=index?index.getX(i):i;
          target[0].push(positions.getX(vertex),positions.getY(vertex),positions.getZ(vertex));
          target[1].push(normals.getX(vertex),normals.getY(vertex),normals.getZ(vertex));
        }
      }
      geometry.dispose();
    }
  }
  for(let tier=0;tier<batches.length;tier++)for(let surface=0;surface<2;surface++){
    const [positions,normals]=batches[tier][surface];if(!positions.length)continue;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,palette[tier][surface]);mesh.name='City building massing';mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);buildingMeshes.push(mesh);
  }
  if(windowRecords.length){
    const windows=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,.08),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.48,metalness:.08}),windowRecords.length),dummy=new THREE.Object3D();
    windowRecords.forEach((window,index)=>{dummy.position.set(window.x,window.y,window.z);dummy.rotation.y=window.angle;dummy.scale.set(window.width,window.height,1);dummy.updateMatrix();windows.setMatrixAt(index,dummy.matrix);windows.setColorAt(index,new THREE.Color(window.tint));});
    windows.instanceMatrix.needsUpdate=true;if(windows.instanceColor)windows.instanceColor.needsUpdate=true;windows.name='Simplified building facade windows';windows.castShadow=false;windows.receiveShadow=true;scene.add(windows);buildingMeshes.push(windows);
  }
}
function appendFacadeWindows(ring,height,windows){
  const points=closedRing(ring),rows=Math.max(1,Math.min(14,Math.floor((height-1.5)/3.25))),tints=['#304345','#405b5d','#526969','#6b7d73'];let made=0;
  for(let i=0;i<points.length&&made<160;i++){
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<3.5)continue;
    const count=Math.min(18,Math.max(1,Math.floor(length/4.7))),ux=dx/length,uz=dz/length,outX=-uz,outZ=ux,angle=Math.atan2(-uz,ux),width=Math.min(1.55,length/count*.54);
    for(let row=0;row<rows&&made<160;row++)for(let column=0;column<count&&made<160;column++){
      const along=(column+.5)*length/count,y=1.25+row*3.25;if(y+1.35>height)continue;
      windows.push({x:a[0]+ux*along+outX*.07,y,z:a[1]+uz*along+outZ*.07,angle,width,height:row===0&&height<6?1:1.25,tint:tints[(row+column)%tints.length]});made++;
    }
  }
}

function buildingPolygons(rings){
  const valid=rings.filter(ring=>ring.length>=4),outers=valid.filter(ring=>ringArea(ring)<0),holes=valid.filter(ring=>ringArea(ring)>0);
  if(!outers.length&&valid.length){valid.sort((a,b)=>Math.abs(ringArea(b))-Math.abs(ringArea(a)));outers.push(valid[0]);holes.push(...valid.slice(1));}
  const polygons=outers.map(outer=>({outer,holes:[]}));
  for(const hole of holes){const candidates=polygons.filter(polygon=>pointInRing(hole[0][0],hole[0][1],polygon.outer)).sort((a,b)=>Math.abs(ringArea(a.outer))-Math.abs(ringArea(b.outer)));if(candidates[0])candidates[0].holes.push(hole);}
  return polygons;
}
function shapeFromBuildingPolygon(polygon){
  const shape=pathFromRing(polygon.outer);for(const ring of polygon.holes)shape.holes.push(pathFromRing(ring));return shape;
}
function pathFromRing(ring){
  const points=closedRing(ring);const path=new THREE.Shape();path.moveTo(points[0][0],-points[0][1]);for(let i=1;i<points.length;i++)path.lineTo(points[i][0],-points[i][1]);path.closePath();return path;
}
function closedRing(ring){
  const points=ring.slice();if(points.length>1&&dist(points[0],points[points.length-1])<.01)points.pop();return points;
}
function ringArea(ring){
  let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}return area/2;
}
function pointInRing(x,z,ring){
  let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>z)!==(b[1]>z))&&(x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]))inside=!inside;}return inside;
}
function indexCellGrid(grid,item,cellSize){
  const minX=Math.floor(item.minX/cellSize),maxX=Math.floor(item.maxX/cellSize),minZ=Math.floor(item.minZ/cellSize),maxZ=Math.floor(item.maxZ/cellSize);
  for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const key=x+','+z;let list=grid.get(key);if(!list)grid.set(key,list=[]);list.push(item);}
}
function pointInsideBuilding(x,z,item,radius=0){
  if(x<item.minX-radius||x>item.maxX+radius||z<item.minZ-radius||z>item.maxZ+radius)return false;
  for(const polygon of item.polygons){
    const inside=pointInRing(x,z,polygon.outer),inHole=polygon.holes.some(ring=>pointInRing(x,z,ring));
    if(inside&&!inHole)return true;
    if(radius>0&&(distanceToRing(x,z,polygon.outer)<radius||polygon.holes.some(ring=>pointInRing(x,z,ring)&&distanceToRing(x,z,ring)<radius)))return true;
  }
  return false;
}
function distanceToRing(x,z,ring){
  let best=Infinity;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];best=Math.min(best,pointSegmentDistance(x,z,a[0],a[1],b[0],b[1]));}return best;
}
function buildingNearby(x,z,radius,grid,cellSize){
  const result=new Set();for(let cx=Math.floor((x-radius)/cellSize);cx<=Math.floor((x+radius)/cellSize);cx++)for(let cz=Math.floor((z-radius)/cellSize);cz<=Math.floor((z+radius)/cellSize);cz++)for(const item of grid.get(cx+','+cz)||[])result.add(item);return result;
}
function clearOfBuildings(x,z,radius,grid,cellSize){
  for(const item of buildingNearby(x,z,radius,grid,cellSize))if(pointInsideBuilding(x,z,item,radius))return false;return true;
}
export function buildingBlocks(world,x,z,radius){
  for(const item of buildingNearby(x,z,radius,world.buildingGrid,world.buildingCellSize))if(pointInsideBuilding(x,z,item,radius))return true;return false;
}
export function treeBlocks(world,x,z,radius){
  const size=world.treeCellSize;
  for(let cx=Math.floor((x-radius-.5)/size);cx<=Math.floor((x+radius+.5)/size);cx++)for(let cz=Math.floor((z-radius-.5)/size);cz<=Math.floor((z+radius+.5)/size);cz++)for(const tree of world.treeGrid.get(cx+','+cz)||[])if(Math.abs(x-tree.x)<tree.halfX+radius&&Math.abs(z-tree.z)<tree.halfZ+radius)return true;
  return false;
}
function findClearSpot(x,z,grid,cellSize,random){
  for(let attempt=0;attempt<45;attempt++){const angle=attempt?random()*Math.PI*2:0,radius=attempt?12+random()*52:0,px=Math.max(-MAP.halfWidth+4,Math.min(MAP.halfWidth-4,x+Math.cos(angle)*radius)),pz=Math.max(-MAP.halfDepth+4,Math.min(MAP.halfDepth-4,z+Math.sin(angle)*radius));if(clearOfBuildings(px,pz,2,grid,cellSize))return{x:px,z:pz};}return null;
}
function createParkMeshes(scene,parks){
  const groups=[[],[],[]];
  for(const park of parks){
    const bin=/golf/i.test(park.name)?1:/conservation|green space|hydro/i.test(park.name)?2:0;
    for(const polygon of park.polygons)for(const shape of shapeFromGeoPolygon(polygon))groups[bin].push(shape);
  }
  const colors=['#3c774d','#4a8051','#356b48'];
  for(let i=0;i<groups.length;i++)if(groups[i].length){const geometry=new THREE.ShapeGeometry(groups[i],1);geometry.rotateX(-Math.PI/2);const mesh=new THREE.Mesh(geometry,mat(colors[i],1));mesh.position.y=-.12;mesh.receiveShadow=true;mesh.name='Toronto greenspace boundary';scene.add(mesh);}
}
function shapeFromGeoPolygon(rings){
  if(!rings?.length||rings[0].length<4)return[];
  const shape=pathFromRing(rings[0]);for(const hole of rings.slice(1))if(hole.length>=4)shape.holes.push(pathFromRing(hole));return[shape];
}
function createRoadMeshes(scene,roads){
  const classes={arterial:emptyRibbon(),collector:emptyRibbon(),local:emptyRibbon(),trail:emptyRibbon(),walkway:emptyRibbon()},dashes=[];
  for(const road of roads){
    const type=roadType(road),width=Math.max(type==='trail'?2.6:type==='walkway'?1.8:road.width,1);
    appendRibbon(classes[type],road.points,width,-.105);
    for(let i=0;i<road.points.length-1;i++){
      const a=road.points[i],b=road.points[i+1],length=dist(a,b);if(length<1)continue;
      const item={road,a,b,length,midX:(a[0]+b[0])/2,midZ:(a[1]+b[1])/2,angle:-Math.atan2(b[1]-a[1],b[0]-a[0])};
      if(type==='arterial')for(let along=-length*.38;along<length*.38;along+=27)dashes.push({item,along});
    }
  }
  const roadColors={arterial:'#424945',collector:'#454b46',local:'#4b514c',trail:'#82775e',walkway:'#aaa58e'};
  for(const [type,geometry] of Object.entries(classes))addRibbonMesh(scene,geometry,mat(roadColors[type],.98),`City ${type} roads and paths`);
  if(dashes.length){
    const dummy=new THREE.Object3D(),dashMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.025,.2),mat('#d6d0b7',.9),dashes.length);
    dashes.forEach((dash,index)=>{const {item,along}=dash,ux=Math.cos(-item.angle),uz=Math.sin(-item.angle);dummy.position.set(item.midX+ux*along,-.087,item.midZ+uz*along);dummy.rotation.y=item.angle;dummy.scale.set(8,1,1);dummy.updateMatrix();dashMesh.setMatrixAt(index,dummy.matrix);});
    dashMesh.instanceMatrix.needsUpdate=true;dashMesh.castShadow=false;scene.add(dashMesh);
  }
  for(const road of roads)if(road.label){const center=road.points[Math.floor((road.points.length-1)/2)];const label=makeLabel(road.name.toUpperCase());label.scale.set(Math.max(72,Math.min(160,road.name.length*5.5)),13,1);label.position.set(center[0],8,center[1]+15);scene.add(label);}
}
function createSidewalkMeshes(scene,paths){
  const sidewalks=emptyRibbon();for(const points of paths)appendRibbon(sidewalks,points,1.8,-.16);
  addRibbonMesh(scene,sidewalks,mat('#a5a396',.98),'Mapped Toronto sidewalks');
}
function roadType(road){
  if(/trail/i.test(road.class))return'trail';if(/walkway/i.test(road.class))return'walkway';
  if(road.width>=23)return'arterial';if(road.width>=14)return'collector';return'local';
}
function emptyRibbon(){return{positions:[],indices:[]};}
function appendRibbon(buffer,points,width,y){
  const clean=[];for(const point of points)if(!clean.length||dist(point,clean[clean.length-1])>.2)clean.push(point);
  if(clean.length<2)return;
  const half=width*.5,normals=[];
  for(let i=0;i<clean.length;i++){
    const before=clean[Math.max(0,i-1)],after=clean[Math.min(clean.length-1,i+1)],dx=after[0]-before[0],dz=after[1]-before[1],length=Math.hypot(dx,dz)||1;
    normals.push([-dz/length,dx/length]);
  }
  const base=buffer.positions.length/3;
  for(let i=0;i<clean.length;i++){
    let [nx,nz]=normals[i];
    if(i>0&&i<clean.length-1){const previous=normals[i-1],next=normals[i],mx=previous[0]+next[0],mz=previous[1]+next[1],magnitude=Math.hypot(mx,mz)||1;nx=mx/magnitude;nz=mz/magnitude;const divisor=Math.max(.28,Math.abs(nx*next[0]+nz*next[1])),scale=Math.min(half/divisor,half*3);nx*=scale;nz*=scale;}
    else{nx*=half;nz*=half;}
    const [x,z]=clean[i];buffer.positions.push(x+nx,y,z+nz,x-nx,y,z-nz);
  }
  for(let i=0;i<clean.length-1;i++){const left=base+i*2,right=left+1,nextLeft=left+2,nextRight=left+3;buffer.indices.push(left,nextLeft,right,right,nextLeft,nextRight);}
}
function addRibbonMesh(scene,buffer,material,name){
  if(!buffer.indices.length)return;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(buffer.positions,3));geometry.setIndex(new Uint32Array(buffer.indices));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;scene.add(mesh);
}
function createTreeMeshes(scene,records,grid,cellSize,random,treeMeshes){
  const leafGeometry=new THREE.SphereGeometry(1,12,10),evergreenGeometry=new THREE.ConeGeometry(1,1,14,5);
  const forms={
    maple:{geometry:leafGeometry,color:'#4f824b',width:1,height:.3,center:.69,depth:1},
    oak:{geometry:leafGeometry,color:'#3e7144',width:1.13,height:.3,center:.67,depth:1.06},
    birch:{geometry:leafGeometry,color:'#629153',width:.72,height:.4,center:.68,depth:.78},
    linden:{geometry:leafGeometry,color:'#4b7a48',width:.88,height:.34,center:.68,depth:.9},
    ginkgo:{geometry:leafGeometry,color:'#87964c',width:1.02,height:.25,center:.7,depth:1},
    upright:{geometry:leafGeometry,color:'#3c6c43',width:.66,height:.4,center:.68,depth:.74},
    broadleaf:{geometry:leafGeometry,color:'#507e49',width:.94,height:.33,center:.68,depth:1},
    evergreen:{geometry:evergreenGeometry,color:'#2e604a',width:1,height:.76,center:.59,depth:1}
  };
  const crownBuckets=new Map(),trunkBuckets=new Map(),obstacles=[],regionSize=550;
  const genericForms=['maple','oak','birch','linden','ginkgo','evergreen','upright'];
  records.forEach((record,index)=>{
    const x=Number(record.x),z=Number(record.z),height=Math.max(2.5,Math.min(56,Number(record.height)||10));
    const form=record.form||genericForms[Math.abs(Number(record.id)||index)%genericForms.length],style=forms[form]||forms.broadleaf;
    const radius=Math.max(1.15,Math.min(6.4,height*.2)),trunk={x,z,height,form,radius},cx=Math.floor((x+MAP.halfWidth)/regionSize),cz=Math.floor((z+MAP.halfDepth)/regionSize),region=cx+','+cz,canopyKey=form+'|'+region;
    let canopy=crownBuckets.get(canopyKey);if(!canopy)crownBuckets.set(canopyKey,canopy=[]);canopy.push(trunk);
    let stems=trunkBuckets.get(region);if(!stems)trunkBuckets.set(region,stems=[]);stems.push(trunk);
    obstacles.push({x,z,halfX:.38,halfZ:.38,kind:'tree',minX:x-.38,maxX:x+.38,minZ:z-.38,maxZ:z+.38});
    indexCellGrid(grid,obstacles[obstacles.length-1],cellSize);
  });
  const dummy=new THREE.Object3D(),trunkGeometry=new THREE.CylinderGeometry(.14,.22,1,8,1),trunkMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1});
  for(const [region,trees] of trunkBuckets){
    const trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
    trees.forEach((tree,index)=>{dummy.position.set(tree.x,tree.height*.29,tree.z);dummy.scale.set(1,tree.height*.58,1);dummy.rotation.y=0;dummy.updateMatrix();trunks.setMatrixAt(index,dummy.matrix);const bark=tree.form==='birch'?'#c8c6ad':tree.form==='evergreen'?'#594938':'#70553a';trunks.setColorAt(index,new THREE.Color(bark).multiplyScalar(.9+random()*.2));});
    trunks.instanceMatrix.needsUpdate=true;if(trunks.instanceColor)trunks.instanceColor.needsUpdate=true;trunks.castShadow=false;trunks.receiveShadow=false;trunks.name='Mapped tree trunks '+region;scene.add(trunks);treeMeshes.push(trunks);
  }
  for(const [key,trees] of crownBuckets){
    if(!trees.length)continue;
    const [form,region]=key.split('|'),style=forms[form],material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.96}),crowns=new THREE.InstancedMesh(style.geometry,material,trees.length);
    trees.forEach((tree,index)=>{
      const width=tree.radius*style.width,depth=tree.radius*style.depth;
      dummy.position.set(tree.x,tree.height*style.center,tree.z);dummy.scale.set(width,tree.height*style.height,depth);dummy.rotation.y=(random()-.5)*.7;dummy.updateMatrix();crowns.setMatrixAt(index,dummy.matrix);
      crowns.setColorAt(index,new THREE.Color(style.color).multiplyScalar(.84+random()*.32));
    });
    crowns.instanceMatrix.needsUpdate=true;if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;crowns.castShadow=false;crowns.receiveShadow=false;crowns.name='Mapped '+form+' trees '+region;scene.add(crowns);treeMeshes.push(crowns);
  }
  return obstacles;
}

export function updateStormVisual(world,radius){world.zone.scale.set(radius,radius,1);world.stormWall.scale.set(radius,1,radius);}
