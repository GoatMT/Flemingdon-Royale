import * as THREE from '../vendor/three.module.js';

const weaponLook={pistol:'#bdc9c0',rifle:'#313936',shotgun:'#76533a'};
const material=(color,roughness=.78,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});

function textSprite(text,{foreground='#fff1c3',background='rgba(3,15,10,.84)',outline='rgba(225,183,65,.7)',fontSize=34}={}){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=112;const ctx=canvas.getContext('2d');
  ctx.fillStyle=background;ctx.strokeStyle=outline;ctx.lineWidth=4;roundRect(ctx,5,5,502,102,17);ctx.fill();ctx.stroke();ctx.font=`800 ${fontSize}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=foreground;ctx.fillText(text,256,56,470);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthWrite:false}));
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

export function createAvatar(scene,data,{isHuman=false,x=0,z=0,custom=false}={}){
  const root=new THREE.Group();root.position.set(x,0,z);scene.add(root);
  const model=new THREE.Group();root.add(model);
  const color=data.kitColor||'#166b47',skin=custom?'#cb9470':'#a97354',shirt=material(color),dark=material('#24312a'),skinMat=material(skin),sole=material('#d6c9a5'),hair=material('#211d18');
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.34,.48,4,8),shirt);torso.position.y=1.02;torso.castShadow=true;model.add(torso);
  const belt=new THREE.Mesh(new THREE.CylinderGeometry(.34,.33,.14,8),material('#15241d'));belt.position.y=.72;model.add(belt);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.25,12,10),skinMat);head.position.y=1.62;head.castShadow=true;model.add(head);
  const hairCap=new THREE.Mesh(new THREE.SphereGeometry(.256,12,8,0,Math.PI*2,0,Math.PI*.48),hair);hairCap.position.y=1.68;model.add(hairCap);
  for(const side of [-1,1]){
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.34,3,6),shirt);arm.position.set(side*.39,1.12,.015);arm.rotation.z=side*-.13;arm.castShadow=true;model.add(arm);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.125,.42,3,6),dark);leg.position.set(side*.145,.42,0);leg.castShadow=true;model.add(leg);
    const boot=new THREE.Mesh(new THREE.BoxGeometry(.2,.12,.34),sole);boot.position.set(side*.145,.1,.07);model.add(boot);
  }
  const number=textSprite(data.jersey==null?'LSL':String(data.jersey),{fontSize:43,foreground:'#fff5dc',background:'rgba(0,0,0,.06)',outline:'rgba(0,0,0,0)',});number.scale.set(.22,.09,1);number.position.set(0,1.12,.343);model.add(number);
  const weapon=new THREE.Group();model.add(weapon);buildHandWeapon(weapon,'pistol');
  const glider=new THREE.Group();
  const canopy=new THREE.Mesh(new THREE.SphereGeometry(2.8,16,9,0,Math.PI*2,0,Math.PI*.52),material(isHuman?'#0d7447':'#153e30',.63));canopy.position.y=4.15;canopy.scale.y=.55;glider.add(canopy);
  const trim=new THREE.Mesh(new THREE.TorusGeometry(2.72,.08,5,24),material('#e6bd4c',.35,.18));trim.position.y=4.1;trim.rotation.x=Math.PI/2;glider.add(trim);
  for(const side of [-1,1])for(const front of [-1,1]){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(side*.22,1.55,front*.12),new THREE.Vector3(side*2.25,4.25,front*1.35)]),new THREE.LineBasicMaterial({color:'#e9ddb1'}));glider.add(line);}
  root.add(glider);glider.visible=false;
  const selection=new THREE.Mesh(new THREE.RingGeometry(.57,.66,24),new THREE.MeshBasicMaterial({color:isHuman?'#ffe08a':'#4ec9e9',side:THREE.DoubleSide,transparent:true,opacity:isHuman ? .8 : .45}));selection.rotation.x=-Math.PI/2;selection.position.y=.025;root.add(selection);
  const tag=textSprite(data.name||'Lantern player',{fontSize:29,foreground:isHuman?'#ffe08a':'#eff4ea'});tag.scale.set(Math.max(5.6,Math.min(13,(data.name||'').length*.46)),1.2,1);tag.position.y=2.55;root.add(tag);
  const ratings=data.gameplayProfile?.ratings||{},profileSpeed=Number(ratings.speed)||1;
  return {id:data.id||('custom-'+Date.now()),name:data.name||'Lantern player',jersey:data.jersey??null,teamId:data.teamId||'custom',teamName:data.teamName||'LSL Rookie',teamLogo:data.teamLogo||'',kitColor:color,overall:Number(data.overall)||70,gameplayProfile:data.gameplayProfile||null,root,model,weaponModel:weapon,selection,tag,glider,isHuman,custom,alive:true,health:100,shield:isHuman?50:30,eliminations:0,damageDone:0,weapon:'pistol',weapons:['pistol'],ammo:{pistol:72,rifle:0,shotgun:0},clips:{pistol:12,rifle:0,shotgun:0},medkits:0,shieldPotions:0,moveSpeed:(5.5+(Number(data.overall||70)-70)*.014)*Math.max(.86,Math.min(1.14,profileSpeed)),aiState:{cooldown:0,think:Math.random(),target:null,loot:null,strafe:Math.random()<.5?-1:1,lootThink:0},stormTick:0,jump:0,hitFlash:0};
}

export function setAvatarWeapon(entity,type){entity.weapon=type;if(!entity.weapons.includes(type))entity.weapons.push(type);buildHandWeapon(entity.weaponModel,type);}
function buildHandWeapon(group,type){
  group.clear();const body=material(weaponLook[type]||'#c5bd94',.5,.35),dark=material('#131b17',.65,.12),glow=material(type==='rifle'?'#e2c14c':type==='shotgun'?'#d38c39':'#89b7c9',.3,.2);
  const receiver=new THREE.Mesh(new THREE.BoxGeometry(type==='shotgun'?.54:.43,.13,.15),body);receiver.position.set(.37,1.04,.18);group.add(receiver);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,type==='shotgun'?.52:.38,7),dark);barrel.rotation.x=Math.PI/2;barrel.position.set(.38,1.05,.48);group.add(barrel);
  const grip=new THREE.Mesh(new THREE.BoxGeometry(.09,.2,.09),dark);grip.position.set(.26,.89,.18);grip.rotation.x=-.2;group.add(grip);
  const sight=new THREE.Mesh(new THREE.BoxGeometry(.08,.065,.075),glow);sight.position.set(.39,1.14,.18);group.add(sight);
}

export function createLoot(scene,item){
  const group=new THREE.Group();group.position.set(item.x,.6,item.z);scene.add(group);
  const palette={rifle:'#8fe0a8',shotgun:'#f0a65e',medkit:'#ff7474',shield:'#71b9f2',ammo:'#f0d36f'};
  const colors=palette[item.type]||'#efd16e',glow=material(colors,.36,.1),dark=material('#103121');
  const box=new THREE.Mesh(new THREE.BoxGeometry(1.1,.78,.85),glow);box.castShadow=true;group.add(box);
  const cross=new THREE.Mesh(new THREE.BoxGeometry(.18,.58,.06),dark);cross.position.set(0,.03,.45);group.add(cross);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(1.15,.045,4,24),new THREE.MeshBasicMaterial({color:colors,transparent:true,opacity:.75}));halo.rotation.x=Math.PI/2;halo.position.y=-.35;group.add(halo);
  const label=textSprite(item.name||item.type.toUpperCase(),{fontSize:27,foreground:'#fff4c8',background:'rgba(3,19,12,.88)',outline:'rgba(255,255,255,.2)'});label.scale.set(6,1.3,1);label.position.y=1.5;group.add(label);
  return {...item,mesh:group,alive:true};
}

export function setEntityFacing(entity,x,z){entity.model.rotation.y=Math.atan2(x,z);}

export function damageEntity(entity,amount){
  if(!entity.alive)return {dealt:0,eliminated:false};
  const raw=Math.max(0,amount),shieldDamage=Math.min(entity.shield,raw);entity.shield-=shieldDamage;const healthDamage=Math.min(entity.health,raw-shieldDamage);entity.health-=healthDamage;
  const eliminated=entity.health<=0;if(eliminated){entity.health=0;entity.alive=false;entity.selection.visible=false;entity.tag.visible=false;}
  entity.hitFlash=.12;entity.model.traverse(object=>{if(object.isMesh&&object.material?.emissive){object.material.emissive.set('#661a10');object.material.emissiveIntensity=.8;}});
  return {dealt:shieldDamage+healthDamage,eliminated};
}
