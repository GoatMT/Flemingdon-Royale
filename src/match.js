import * as THREE from '../vendor/three.module.js';
import {MAP,updateStormVisual,buildingBlocks,treeBlocks} from './map.js';
import {createAvatar,createLoot,setAvatarWeapon,damageEntity,setEntityFacing} from './actors.js';
import {shuffle,playerLabel} from './data.js';

const WEAPONS={
  pistol:{label:'SIDEARM',icon:'◈',mag:12,damage:24,range:245,fireDelay:.34,reload:1.35,spread:.009},
  rifle:{label:'BURST RIFLE',icon:'▰',mag:30,damage:18,range:425,fireDelay:.13,reload:1.65,spread:.006},
  shotgun:{label:'TACTICAL SHOTGUN',icon:'⬟',mag:6,damage:9,range:115,fireDelay:.7,reload:1.9,spread:.024}
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.root.position.x-b.root.position.x,a.root.position.z-b.root.position.z);
const directionTo=(a,b)=>{const dx=b.root.position.x-a.root.position.x,dz=b.root.position.z-a.root.position.z,len=Math.hypot(dx,dz)||1;return{x:dx/len,z:dz/len};};

export class BattleRoyale{
  constructor(scene,world,callbacks={}){
    this.scene=scene;this.world=world;this.callbacks=callbacks;this.entities=[];this.player=null;this.pickups=[];this.elapsed=0;this.kills=0;this.active=false;this.paused=false;this.zoneRadius=1020;this.hudTimer=0;this.raycaster=new THREE.Raycaster();this.random=Math.random;
  }
  start(character,roster,dropId='flemingdon-park'){
    this.disposeEntities();this.active=true;this.paused=false;this.elapsed=0;this.kills=0;this.zoneRadius=1020;this.hudTimer=0;this.killFeed=[];
    const point=this.world.landmarks.find(landmark=>landmark.dropId===dropId)||this.world.landmarks.find(landmark=>landmark.dropId==='flemingdon-park')||{x:0,z:0},humanSpawn=this.findSafePosition(point.x,point.z),human=createAvatar(this.scene,character,{isHuman:true,x:humanSpawn.x,z:humanSpawn.z,custom:character.custom});
    this.player=human;this.entities=[human];human.landing={x:humanSpawn.x,z:humanSpawn.z};human.root.position.set(humanSpawn.x,118,humanSpawn.z);human.glideTime=0;
    const candidates=shuffle(roster.filter(player=>player.id!==character.id),this.random).slice(0,11);
    const used=[];
    candidates.forEach((data,index)=>{
      const angle=(index/11)*Math.PI*2+(this.random()-.5)*.42,radius=590+this.random()*385;
      let x=clamp(point.x+Math.cos(angle)*radius,-MAP.halfWidth+75,MAP.halfWidth-75),z=clamp(point.z+Math.sin(angle)*radius,-MAP.halfDepth+75,MAP.halfDepth-75);
      const safe=this.findSafePosition(x,z,used);x=safe.x;z=safe.z;used.push({x,z});
      const bot=createAvatar(this.scene,data,{x,z});bot.landing={x,z};bot.root.position.set(x,115+this.random()*35,z);bot.glideTime=0;bot.aiState.think=this.random()*.25;
      if(index===1||index===6){this.give(bot,'rifle');bot.clips.rifle=30;bot.ammo.rifle=90;}
      if(index===4){this.give(bot,'shotgun');bot.clips.shotgun=6;bot.ammo.shotgun=18;}
      this.entities.push(bot);
    });
    this.pickups=this.world.lootSpawns.map(item=>createLoot(this.scene,{...item,name:WEAPONS[item.type]?.label||({medkit:'MED KIT',shield:'SHIELD CELL',ammo:'AMMO'}[item.type])}));
    this.callbacks.onStart?.(human);this.callbacks.onToast?.('DROP IN · FIND YOUR FIRST UPGRADE');this.callbacks.onHUD?.(this.snapshot());
  }
  findSafePosition(x,z,used=[]){
    for(let attempt=0;attempt<42;attempt++){
      const px=clamp(x+(this.random()-.5)*180,-MAP.halfWidth+40,MAP.halfWidth-40),pz=clamp(z+(this.random()-.5)*180,-MAP.halfDepth+40,MAP.halfDepth-40);
      if(!this.blocked(px,pz,.8)&&used.every(other=>Math.hypot(px-other.x,pz-other.z)>95))return{x:px,z:pz};
    }
    return{x:clamp(x,-MAP.halfWidth+45,MAP.halfWidth-45),z:clamp(z,-MAP.halfDepth+45,MAP.halfDepth-45)};
  }
  disposeEntities(){
    for(const entity of this.entities){this.scene.remove(entity.root);entity.root.traverse(obj=>{if(obj.geometry)obj.geometry.dispose?.();if(obj.material?.map?.isCanvasTexture)obj.material.map.dispose?.();});}
    for(const loot of this.pickups){this.scene.remove(loot.mesh);loot.mesh.traverse(obj=>{obj.geometry?.dispose?.();if(obj.material?.map?.isCanvasTexture)obj.material.map.dispose?.();});}
    this.entities=[];this.pickups=[];this.player=null;
  }
  give(entity,type){
    if(!entity.weapons.includes(type)){entity.weapons.push(type);entity.clips[type]=0;entity.ammo[type]=0;}
    if(type==='rifle'){entity.clips.rifle=Math.max(entity.clips.rifle,WEAPONS.rifle.mag);entity.ammo.rifle+=60;}
    if(type==='shotgun'){entity.clips.shotgun=Math.max(entity.clips.shotgun,WEAPONS.shotgun.mag);entity.ammo.shotgun+=12;}
    setAvatarWeapon(entity,type);
  }
  pickup(entity,item){
    if(!item?.alive||!entity.alive)return false;
    item.alive=false;item.mesh.visible=false;
    if(item.type==='rifle'||item.type==='shotgun'){
      const already=entity.weapons.includes(item.type);if(already){entity.clips[item.type]=Math.max(entity.clips[item.type],WEAPONS[item.type].mag);entity.ammo[item.type]+=item.type==='rifle'?42:8;}else this.give(entity,item.type);
      setAvatarWeapon(entity,item.type);this.callbacks.onToast?.(already?'AMMO COLLECTED · '+WEAPONS[item.type].label:WEAPONS[item.type].label+' EQUIPPED');
    }else if(item.type==='medkit'){
      if(entity.isHuman&&entity.health>=90){entity.alive=true;item.alive=true;item.mesh.visible=true;return false;}
      entity.medkits=Math.min(3,(entity.medkits||0)+1);this.callbacks.onToast?.('MED KIT PICKED UP · PRESS H');
    }else if(item.type==='shield'){
      entity.shieldPotions=Math.min(3,(entity.shieldPotions||0)+1);this.callbacks.onToast?.('SHIELD CELL PICKED UP · PRESS J');
    }else if(item.type==='ammo'){
      entity.ammo.pistol+=30;if(entity.weapons.includes('rifle'))entity.ammo.rifle+=30;this.callbacks.onToast?.('AMMO PICKED UP');
    }
    this.callbacks.onPickup?.(item,entity);return true;
  }
  nearestPickup(entity,max=4){let result=null,best=max;for(const item of this.pickups){if(!item.alive)continue;const gap=Math.hypot(item.mesh.position.x-entity.root.position.x,item.mesh.position.z-entity.root.position.z);if(gap<best){best=gap;result=item;}}return result;}
  move(entity,dx,dz,dt,speed){
    const len=Math.hypot(dx,dz);if(len>.001){dx/=len;dz/=len;setEntityFacing(entity,dx,dz);}
    const stride=speed*dt,oldX=entity.root.position.x,oldZ=entity.root.position.z,nx=clamp(oldX+dx*stride,-MAP.halfWidth+2,MAP.halfWidth-2),nz=clamp(oldZ+dz*stride,-MAP.halfDepth+2,MAP.halfDepth-2);
    if(!this.blocked(nx,nz,.52)){entity.root.position.x=nx;entity.root.position.z=nz;return false;}
    let moved=false;if(!this.blocked(nx,oldZ,.52)){entity.root.position.x=nx;moved=true;}if(!this.blocked(entity.root.position.x,nz,.52)){entity.root.position.z=nz;moved=true;}return !moved;
  }
  blocked(x,z,radius){
    if(x<-MAP.halfWidth+radius||x>MAP.halfWidth-radius||z<-MAP.halfDepth+radius||z>MAP.halfDepth-radius)return true;
    if(treeBlocks(this.world,x,z,radius))return true;
    return buildingBlocks(this.world,x,z,radius);
  }
  update(dt,controls,camera){
    if(!this.active||this.paused)return;
    dt=Math.min(.05,dt);this.elapsed+=dt;this.hudTimer-=dt;
    const closingStart=46,shrinkEnd=355,progress=clamp((this.elapsed-closingStart)/(shrinkEnd-closingStart),0,1);this.zoneRadius=1020+(150-1020)*progress;updateStormVisual(this.world,this.zoneRadius);
    this.updatePlayer(dt,controls,camera);this.updateBots(dt);this.updateLoot(dt);this.applyStorm(dt);
    this.entities.forEach(entity=>{entity.fireCooldown=Math.max(0,(entity.fireCooldown||0)-dt);if(entity.hitFlash>0)entity.hitFlash=Math.max(0,entity.hitFlash-dt);if(entity.reloadTime>0){entity.reloadTime-=dt;if(entity.reloadTime<=0)this.finishReload(entity);}});
    if(this.player&&!this.player.alive){this.finish(false);return;}
    const alive=this.entities.filter(entity=>entity.alive);if(alive.length<=1)this.finish(alive[0]===this.player);
    if(this.hudTimer<=0){this.hudTimer=.1;this.callbacks.onHUD?.(this.snapshot());}
  }
  updatePlayer(dt,controls,camera){
    const player=this.player;if(!player?.alive)return;
    if(player.root.position.y>0){player.glideTime+=dt;player.root.position.y=Math.max(0,player.root.position.y-25*dt);player.glider&&(player.glider.visible=player.root.position.y>2);}
    const moveX=controls.moveX||0,moveZ=controls.moveZ||0;
    if(Math.hypot(moveX,moveZ)>.04){
      const forward={x:Math.sin(controls.yaw||0),z:-Math.cos(controls.yaw||0)},right={x:Math.cos(controls.yaw||0),z:Math.sin(controls.yaw||0)};
      const x=right.x*moveX+forward.x*moveZ,z=right.z*moveX+forward.z*moveZ;
      this.move(player,x,z,dt,(controls.sprint?player.moveSpeed*1.48:player.moveSpeed));
    }
    if(controls.jumpPressed&&player.root.position.y<=.02){player.jumpVelocity=6.6;}
    if(player.jumpVelocity){player.root.position.y+=player.jumpVelocity*dt;player.jumpVelocity-=17*dt;if(player.root.position.y<0){player.root.position.y=0;player.jumpVelocity=0;}}
    if(controls.pickupPressed)this.pickup(player,this.nearestPickup(player));
    if(controls.reloadPressed)this.reload(player);
    if(controls.medkitPressed)this.useMedkit(player);
    if(controls.shieldPressed)this.useShield(player);
    if(controls.weaponSlot)this.selectWeapon(player,controls.weaponSlot-1);
    if(controls.fire)this.firePlayer(player,camera);
  }
  firePlayer(player,camera){
    if(!player.alive||player.root.position.y>1.5)return;
    const type=player.weapon,weapon=WEAPONS[type];if(!weapon||player.fireCooldown>0||player.reloadTime>0)return;
    if(player.clips[type]<=0){this.reload(player);return;}
    player.fireCooldown=weapon.fireDelay;player.clips[type]--;const origin=new THREE.Vector3(player.root.position.x,player.root.position.y+1.48,player.root.position.z),direction=new THREE.Vector3();camera.getWorldDirection(direction);this.raycaster.set(origin,direction);this.raycaster.far=weapon.range;
    const shooting=Number(player.gameplayProfile?.ratings?.shooting)||1;
    const targets=this.entities.filter(other=>other!==player&&other.alive).map(other=>{
      const center=new THREE.Vector3(other.root.position.x,other.root.position.y+1.02,other.root.position.z),delta=center.clone().sub(origin),along=delta.dot(direction);if(along<1||along>weapon.range)return null;const miss=delta.addScaledVector(direction,-along).length(),radius=(weapon.spread*along+(type==='shotgun'?1.5:.68))*clamp(shooting,.84,1.16);if(miss>radius)return null;return{entity:other,along,center,miss};
    }).filter(Boolean).sort((a,b)=>a.along-b.along);
    let targetHit=false;
    for(const candidate of targets){
      if(this.isBlocked(origin,candidate.center))continue;
      let damage=weapon.damage;if(type==='shotgun')damage=Math.max(8,Math.round(weapon.damage*(1-candidate.miss/3)));
      this.damage(player,candidate.entity,damage);targetHit=true;
      if(type!=='shotgun')break;
    }
    this.callbacks.onFire?.(player,type);if(targetHit)this.callbacks.onHit?.();
  }
  fireBot(bot,target){
    const weapon=WEAPONS[bot.weapon];if(!weapon||bot.fireCooldown>0||bot.reloadTime>0||!bot.alive||!target.alive)return;
    if(bot.clips[bot.weapon]<=0){this.reload(bot);return;}
    const d=distance(bot,target);if(d>weapon.range||!this.hasLineOfSight(bot,target))return;
    bot.fireCooldown=weapon.fireDelay*(2.2+this.random()*1.8);bot.clips[bot.weapon]--;
    const shooting=Number(bot.gameplayProfile?.ratings?.shooting)||1,accuracy=clamp((.69-d/weapon.range*.32+(bot.overall-70)*.002)*shooting,.2,.82);
    if(this.random()<accuracy){const skill=clamp(.74+(bot.overall-70)*.003,.6,.95),damage=weapon.damage*(.43+skill*.34);this.damage(bot,target,damage);}
  }
  damage(attacker,target,amount){
    const result=damageEntity(target,amount);attacker.damageDone=(attacker.damageDone||0)+result.dealt;
    if(target.isHuman)this.callbacks.onHumanDamage?.(result.dealt);
    if(result.eliminated){attacker.eliminations=(attacker.eliminations||0)+1;if(attacker===this.player)this.kills++;
      this.callbacks.onElimination?.(attacker,target);this.dropLoot(target);if(target.isHuman){this.callbacks.onToast?.('ELIMINATED · '+playerLabel(attacker));}
    }
  }
  isBlocked(origin,target){
    const delta=target.clone().sub(origin),length=delta.length();if(length<.5)return false;this.raycaster.set(origin,delta.normalize());this.raycaster.far=length-.25;
    return this.raycaster.intersectObjects(this.world.buildingMeshes,false).length>0;
  }
  hasLineOfSight(a,b){const origin=new THREE.Vector3(a.root.position.x,a.root.position.y+1.45,a.root.position.z),target=new THREE.Vector3(b.root.position.x,b.root.position.y+1.2,b.root.position.z);return !this.isBlocked(origin,target);}
  reload(entity){const type=entity.weapon,weapon=WEAPONS[type];if(!weapon||entity.reloadTime>0||entity.clips[type]>=weapon.mag||entity.ammo[type]<=0)return;entity.reloadTime=weapon.reload;entity.fireCooldown=.15;if(entity.isHuman)this.callbacks.onToast?.('RELOADING');}
  finishReload(entity){const type=entity.weapon,weapon=WEAPONS[type];if(!weapon)return;const need=weapon.mag-entity.clips[type],take=Math.min(need,entity.ammo[type]);entity.clips[type]+=take;entity.ammo[type]-=take;entity.reloadTime=0;}
  selectWeapon(entity,index){const type=entity.weapons[index];if(type){entity.weapon=type;setAvatarWeapon(entity,type);}}
  useMedkit(entity){if(entity.medkits>0&&entity.health<90){entity.medkits--;entity.health=Math.min(100,entity.health+55);if(entity.isHuman)this.callbacks.onToast?.('MED KIT USED');}}
  useShield(entity){if(entity.shieldPotions>0&&entity.shield<85){entity.shieldPotions--;entity.shield=Math.min(100,entity.shield+45);if(entity.isHuman)this.callbacks.onToast?.('SHIELD CELL USED');}}
  updateBots(dt){
    for(const bot of this.entities){if(bot===this.player||!bot.alive)continue;
      bot.aiState.think-=dt;bot.aiState.lootThink-=dt;
      if(bot.root.position.y>0){bot.root.position.y=Math.max(0,bot.root.position.y-24*dt);bot.glider&&(bot.glider.visible=bot.root.position.y>2);continue;}
      if(bot.health<58&&bot.medkits>0)this.useMedkit(bot);
      if(bot.shield<38&&bot.shieldPotions>0)this.useShield(bot);
      if(bot.aiState.think<=0){bot.aiState.think=.27+this.random()*.28;this.thinkBot(bot);}
      const state=bot.aiState;
      if(state.loot?.alive){const dx=state.loot.mesh.position.x-bot.root.position.x,dz=state.loot.mesh.position.z-bot.root.position.z,gap=Math.hypot(dx,dz);if(gap<3){this.pickup(bot,state.loot);state.loot=null;}else{const blocked=this.move(bot,dx,dz,dt,5.1);if(blocked)state.strafe*=-1;}}
      else if(state.target?.alive){const target=state.target,gap=distance(bot,target),vec=directionTo(bot,target),stormForced=gap>this.zoneRadius*.95&&Math.hypot(bot.root.position.x,bot.root.position.z)>this.zoneRadius-40;
        if(stormForced){this.move(bot,-bot.root.position.x,-bot.root.position.z,dt,5.8);}
        else if(gap>72){const blocked=this.move(bot,vec.x,vec.z,dt,bot.moveSpeed);if(blocked){const lateral={x:-vec.z*state.strafe,z:vec.x*state.strafe};this.move(bot,lateral.x,lateral.z,dt,bot.moveSpeed*.82);}}
        else{const lateral={x:-vec.z*state.strafe,z:vec.x*state.strafe};this.move(bot,vec.x*.26+lateral.x*.9,vec.z*.26+lateral.z*.9,dt,bot.moveSpeed*.62);if(gap<250)this.fireBot(bot,target);}
      }else this.move(bot,Math.sin(this.elapsed*.3+bot.overall),Math.cos(this.elapsed*.24+bot.overall),dt,2.8);
    }
  }
  thinkBot(bot){
    const state=bot.aiState,inside=Math.hypot(bot.root.position.x,bot.root.position.z)<this.zoneRadius-80;
    if(!inside&&this.elapsed>48){state.target=null;state.loot=null;return;}
    if(state.lootThink<=0){state.lootThink=1.2+this.random()*1.3;
      const wantWeapon=bot.weapons.length<2,wantHealth=bot.health<68&&!bot.medkits,wantShield=bot.shield<25&&!bot.shieldPotions;
      if(wantWeapon||wantHealth||wantShield){const loot=this.pickups.filter(item=>item.alive&&((wantWeapon&&['rifle','shotgun'].includes(item.type))||(wantHealth&&item.type==='medkit')||(wantShield&&item.type==='shield'))).sort((a,b)=>Math.hypot(a.x-bot.root.position.x,a.z-bot.root.position.z)-Math.hypot(b.x-bot.root.position.x,b.z-bot.root.position.z))[0];if(loot&&Math.hypot(loot.x-bot.root.position.x,loot.z-bot.root.position.z)<150)state.loot=loot;}
    }
    if(state.loot?.alive)return;
    const enemies=this.entities.filter(other=>other!==bot&&other.alive).sort((a,b)=>distance(bot,a)-distance(bot,b));state.target=enemies[0]||null;
  }
  updateLoot(dt){for(const item of this.pickups){if(!item.alive)continue;item.mesh.rotation.y+=dt*.7;item.mesh.position.y=.55+Math.sin(this.elapsed*2+item.x*.02)*.13;}}
  dropLoot(entity){
    if(entity.weapons.length>1){const type=entity.weapons.find(weapon=>weapon!=='pistol');if(type)this.pickups.push(createLoot(this.scene,{type,x:entity.root.position.x+2,z:entity.root.position.z+1,name:WEAPONS[type].label}));}
    if(this.random()<.45)this.pickups.push(createLoot(this.scene,{type:'ammo',x:entity.root.position.x-2,z:entity.root.position.z-1,name:'AMMO'}));
  }
  applyStorm(dt){
    if(this.elapsed<46)return;
    for(const entity of this.entities){if(!entity.alive)continue;const outside=Math.hypot(entity.root.position.x,entity.root.position.z)>this.zoneRadius;if(outside){entity.stormTick=(entity.stormTick||0)+dt;if(entity.stormTick>=1){entity.stormTick-=1;this.damage({eliminations:0},entity,8);if(entity.isHuman&&this.elapsed-(entity.lastStormWarn||-5)>4){entity.lastStormWarn=this.elapsed;this.callbacks.onToast?.('OUTSIDE THE ZONE · MOVE NOW');}}}else entity.stormTick=0;}
  }
  finish(won){if(!this.active)return;this.active=false;this.paused=true;this.callbacks.onFinish?.({won,kills:this.kills,time:this.elapsed,alive:this.entities.filter(entity=>entity.alive).length,health:this.player?.health||0,shield:this.player?.shield||0});}
  snapshot(){const player=this.player,remaining=this.entities.filter(entity=>entity.alive).length,closeIn=Math.max(0,46-this.elapsed);return{remaining,kills:this.kills,time:this.elapsed,zoneRadius:this.zoneRadius,closeIn,health:player?.health||0,shield:player?.shield||0,weapon:player?.weapon||'pistol',clips:player?.clips||{},ammo:player?.ammo||{},weapons:player?.weapons||[],medkits:player?.medkits||0,shieldPotions:player?.shieldPotions||0,player,entities:this.entities};}
  nearestLoot(){return this.player?this.nearestPickup(this.player):null;}
}

export {WEAPONS};
