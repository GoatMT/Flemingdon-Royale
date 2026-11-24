import * as THREE from '../vendor/three.module.js';
import {loadRoster,playerLabel,escapeHTML} from './data.js';
import {createWorld,MAP} from './map.js';
import {BattleRoyale,WEAPONS} from './match.js';
import {setEntityFacing} from './actors.js';

const $=id=>document.getElementById(id);
const canvas=$('game');
const state={scene:null,camera:null,renderer:null,clock:new THREE.Clock(),world:null,battle:null,roster:null,teams:null,mode:'official',inMatch:false,paused:false,yaw:0,pitch:.13,mouseDown:false,touchFire:false,touchSprint:false,lastPointer:null,keys:new Set(),pressed:new Set(),touch:{x:0,z:0},lastHUD:null,toastTimer:0,hitTimer:0,mapTimer:0,orbit:0};
const $body=document.body;

function fillRoster(){
  const select=$('player-select'),players=state.roster.players;
  const grouped=[...players].sort((a,b)=>a.teamName.localeCompare(b.teamName)||a.name.localeCompare(b.name));
  select.innerHTML=grouped.map(player=>'<option value="'+escapeHTML(player.id)+'">'+escapeHTML(playerLabel(player))+' · '+escapeHTML(player.teamName)+' · '+(player.overall??'—')+' OVR</option>').join('');
  select.disabled=false;$('drop-button').disabled=false;$('roster-count').textContent=players.length+' OFFICIAL PLAYERS';
  select.addEventListener('change',updatePlayerCard);updatePlayerCard();
}
function selectedCharacter(){
  if(state.mode==='custom')return{id:'custom-'+Date.now(),name:$('custom-name').value.trim()||'Rookie',jersey:null,teamName:'LSL Rookie',teamId:'custom',kitColor:$('custom-color').value,overall:70,custom:true};
  return state.roster.players.find(player=>player.id===$('player-select').value)||state.roster.players[0];
}
function updatePlayerCard(){
  const player=selectedCharacter(),team=state.teams.find(item=>item.id===player.teamId),mark=$('player-card').querySelector('.player-mark');
  mark.style.background=player.kitColor||'#147448';
  if(player.teamLogo)mark.innerHTML='<img src="./'+escapeHTML(player.teamLogo)+'" alt="">';else mark.textContent='LSL';
  $('player-card').querySelector('strong').textContent=player.name+(player.jersey!=null?' #'+player.jersey:'');
  const ratings=player.gameplayProfile?.ratings||{},boosts=[];
  for(const [key,label] of [['speed','SPD'],['shooting','AIM']]){const value=Number(ratings[key]);if(Number.isFinite(value)&&value!==1)boosts.push(label+' '+(value>1?'+':'')+Math.round((value-1)*100)+'%');}
  $('player-card').querySelector('small').textContent=player.custom?'Fictional custom character':player.teamName+' · '+(boosts.length?boosts.join(' / '):(player.position||'LSL player'));
  $('player-card').querySelector('.ovr').textContent=player.overall??'—';
}
function bindLobby(){
  document.querySelectorAll('[data-character-mode]').forEach(button=>button.addEventListener('click',()=>{
    state.mode=button.dataset.characterMode;document.querySelectorAll('[data-character-mode]').forEach(item=>item.classList.toggle('active',item===button));
    $('official-fields').hidden=state.mode!=='official';$('custom-fields').hidden=state.mode!=='custom';updatePlayerCard();
  }));
  $('custom-name').addEventListener('input',updatePlayerCard);$('custom-color').addEventListener('input',updatePlayerCard);
  $('drop-button').addEventListener('click',startMatch);$('pause-button').addEventListener('click',pauseMatch);$('resume-button').addEventListener('click',resumeMatch);
  $('quit-button').addEventListener('click',goLobby);$('lobby-button').addEventListener('click',goLobby);$('again-button').addEventListener('click',startMatch);
}
function setToast(message){const node=$('toast');node.textContent=message;node.classList.add('show');state.toastTimer=2.2;}
function showHit(){const marker=$('hit-marker');marker.classList.add('show');state.hitTimer=.16;}
function startMatch(){
  if(!state.roster||!state.battle)return;
  const character=selectedCharacter();state.inMatch=true;state.paused=false;state.yaw=0;state.pitch=.13;state.keys.clear();state.pressed.clear();state.lastHUD=null;
  $('lobby').hidden=true;$('result-screen').hidden=true;$('pause-screen').hidden=true;$('game-hud').hidden=false;$('loading').hidden=true;
  state.battle.start(character,state.roster.players,$('drop-select').value);updateHUD(state.battle.snapshot());
  if(matchMedia('(pointer:fine)').matches&&canvas.requestPointerLock){try{canvas.requestPointerLock();}catch{}}
  setToast('DROP IN · FIND YOUR FIRST UPGRADE');
}
function pauseMatch(){if(!state.inMatch||state.paused)return;state.paused=true;state.battle.paused=true;$('pause-screen').hidden=false;state.keys.clear();state.pressed.clear();if(document.pointerLockElement)document.exitPointerLock();}
function resumeMatch(){if(!state.inMatch)return;state.paused=false;state.battle.paused=false;$('pause-screen').hidden=true;if(matchMedia('(pointer:fine)').matches&&canvas.requestPointerLock)try{canvas.requestPointerLock();}catch{}}
function goLobby(){state.inMatch=false;state.paused=false;state.battle.active=false;state.battle.paused=true;state.battle.disposeEntities();$('game-hud').hidden=true;$('pause-screen').hidden=true;$('result-screen').hidden=true;$('lobby').hidden=false;if(document.pointerLockElement)document.exitPointerLock();}
function finishMatch(result){
  state.inMatch=false;state.paused=true;$('game-hud').hidden=true;$('pause-screen').hidden=true;$('result-screen').hidden=false;
  $('result-eyebrow').textContent=result.won?'VICTORY · FLEMINGDON PARK':'MATCH COMPLETE · '+result.alive+' LEFT';$('result-title').textContent=result.won?'LAST LANTERN STANDING.':'YOUR DROP ENDED.';
  $('result-copy').textContent=result.won?'You outlasted every contestant in Flemingdon Park.':'Loot up, watch the zone, and take another run at the crown.';
  $('result-stats').innerHTML='<div><strong>'+result.kills+'</strong><small>ELIMINATIONS</small></div><div><strong>'+formatTime(result.time)+'</strong><small>SURVIVAL TIME</small></div><div><strong>'+Math.max(0,Math.round(result.health))+'</strong><small>HEALTH LEFT</small></div>';
  if(document.pointerLockElement)document.exitPointerLock();
}
function formatTime(seconds){const min=Math.floor(seconds/60),sec=Math.floor(seconds%60);return String(min).padStart(2,'0')+':'+String(sec).padStart(2,'0');}
function updateHUD(snapshot){
  if(!snapshot?.player)return;state.lastHUD=snapshot;
  const p=snapshot.player,weapon=WEAPONS[snapshot.weapon];
  $('alive-count').textContent=snapshot.remaining;$('kill-count').textContent=snapshot.kills;$('match-clock').textContent=formatTime(snapshot.time);
  $('hud-player-name').textContent=p.name+(p.jersey!=null?' #'+p.jersey:'');$('hud-player-team').textContent=p.teamName;$('avatar-dot').style.background=p.kitColor;
  $('health-number').textContent=Math.max(0,Math.ceil(snapshot.health));$('health-fill').style.width=Math.max(0,snapshot.health)+'%';$('shield-number').textContent=Math.max(0,Math.ceil(snapshot.shield));$('shield-fill').style.width=Math.max(0,snapshot.shield)+'%';
  $('medkit-count').textContent=snapshot.medkits;$('shield-cell-count').textContent=snapshot.shieldPotions;$('touch-medkit').disabled=snapshot.medkits<1||snapshot.health>=90;$('touch-shield').disabled=snapshot.shieldPotions<1||snapshot.shield>=85;
  $('weapon-name').textContent=weapon?.label||'SIDEARM';$('ammo-clip').textContent=snapshot.clips[snapshot.weapon]||0;$('ammo-reserve').textContent=snapshot.ammo[snapshot.weapon]||0;
  $('storm-label').textContent=snapshot.closeIn>0?'ZONE CLOSES IN':snapshot.time>355?'FINAL ZONE':'ZONE SHRINKING';$('storm-clock').textContent=snapshot.closeIn>0?formatTime(snapshot.closeIn):snapshot.time>355?'FINAL':formatTime(Math.max(0,355-snapshot.time));
  $('match-status').textContent=snapshot.time<46?'DROP · LOOT · SURVIVE':snapshot.time<355?'ZONE MOVING · STAY INSIDE':'FINAL CIRCLE';
  document.querySelector('.minimap-wrap')?.classList.toggle('danger',Math.hypot(p.root.position.x,p.root.position.z)>snapshot.zoneRadius);
  const prompt=state.battle.nearestLoot();$('pickup-prompt').hidden=!prompt;$('touch-pickup').disabled=!prompt;
  if(prompt){$('pickup-name').textContent=prompt.name||prompt.type.toUpperCase();$('touch-pickup').textContent='PICKUP';}
  renderHotbar(snapshot);if(state.mapTimer<=0){paintMinimap(snapshot);state.mapTimer=.15;}
}
function renderHotbar(snapshot){
  const root=$('hotbar'),key=snapshot.weapons.join('|')+'|'+snapshot.weapon;if(root.dataset.key===key)return;root.dataset.key=key;
  root.innerHTML=snapshot.weapons.map((type,index)=>'<button class="hotbar-slot '+(type===snapshot.weapon?'active':'')+'" data-slot="'+(index+1)+'"><span class="slot-key">'+(index+1)+'</span><span class="slot-icon">'+(WEAPONS[type]?.icon||'◈')+'</span><span class="slot-name">'+(type==='pistol'?'SIDEARM':type==='rifle'?'BURST RIFLE':'SHOTGUN')+'</span></button>').join('');
}
function paintMinimap(snapshot){
  const c=$('minimap'),ctx=c.getContext('2d'),w=c.width,h=c.height,pad=15,sx=x=>pad+(x+MAP.halfWidth)/(MAP.width)*(w-pad*2),sy=z=>pad+(MAP.halfDepth-z)/(MAP.depth)*(h-pad*2);
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#25432f';ctx.fillRect(0,0,w,h);
  for(const park of state.world.parks){ctx.fillStyle=/golf/i.test(park.name)?'#4d8653':/conservation|hydro|green space/i.test(park.name)?'#356b48':'#3b764d';for(const polygon of park.polygons){ctx.beginPath();for(const ring of polygon){if(!ring.length)continue;ctx.moveTo(sx(ring[0][0]),sy(ring[0][1]));for(const [x,z] of ring.slice(1))ctx.lineTo(sx(x),sy(z));ctx.closePath();}ctx.fill('evenodd');}}
  ctx.lineCap='round';for(const road of state.world.roads){ctx.beginPath();ctx.moveTo(sx(road.points[0][0]),sy(road.points[0][1]));for(const [x,z] of road.points.slice(1))ctx.lineTo(sx(x),sy(z));const path=/trail|walkway/i.test(road.class);ctx.strokeStyle=path?'#c2b68f':road.width>20?'#d2cebd':'#a1aa9a';ctx.lineWidth=path?1:road.width>20?3.4:1.4;ctx.stroke();}
  for(const landmark of state.world.landmarks){ctx.beginPath();ctx.arc(sx(landmark.markerX??landmark.x),sy(landmark.markerZ??landmark.z),2.2,0,Math.PI*2);ctx.fillStyle='#f0ca64';ctx.fill();}
  ctx.beginPath();ctx.arc(sx(0),sy(0),snapshot.zoneRadius/MAP.width*(w-pad*2),0,Math.PI*2);ctx.strokeStyle='#76dae5';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
  for(const entity of snapshot.entities){if(!entity.alive)continue;ctx.beginPath();ctx.arc(sx(entity.root.position.x),sy(entity.root.position.z),entity.isHuman?5:3,0,Math.PI*2);ctx.fillStyle=entity.isHuman?'#fff2ad':'#ff6458';ctx.fill();if(entity.isHuman){ctx.strokeStyle='#182118';ctx.lineWidth=1;ctx.stroke();}}
  ctx.strokeStyle='#e6e2ca66';ctx.lineWidth=1;ctx.strokeRect(pad,pad,w-pad*2,h-pad*2);
}
function addKillFeed(killer,victim){
  const feed=$('kill-feed'),line=document.createElement('div');line.innerHTML='<b>'+escapeHTML(killer.name)+'</b> ✦ '+escapeHTML(victim.name);feed.prepend(line);while(feed.children.length>4)feed.lastElementChild.remove();setTimeout(()=>line.remove(),7000);
}
function inputSnapshot(){
  const held=state.keys,moveX=(held.has('KeyD')?1:0)-(held.has('KeyA')?1:0)+state.touch.x,moveZ=(held.has('KeyW')?1:0)-(held.has('KeyS')?1:0)+state.touch.z,n=Math.hypot(moveX,moveZ),norm=n>1?1/n:1;
  let weaponSlot=0;for(let i=1;i<=3;i++)if(state.pressed.delete('slot'+i))weaponSlot=i;
  return{moveX:moveX*norm,moveZ:moveZ*norm,sprint:held.has('ShiftLeft')||held.has('ShiftRight')||state.touchSprint,yaw:state.yaw,fire:state.mouseDown||state.touchFire,
    jumpPressed:state.pressed.delete('jump'),pickupPressed:state.pressed.delete('pickup'),reloadPressed:state.pressed.delete('reload'),medkitPressed:state.pressed.delete('medkit'),shieldPressed:state.pressed.delete('shield'),weaponSlot};
}
function updateCamera(dt){
  const p=state.battle.player;if(!p)return;
  const target=new THREE.Vector3(p.root.position.x,p.root.position.y+1.35,p.root.position.z),dist=7.1,cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
  const desired=new THREE.Vector3(target.x-Math.sin(state.yaw)*cp*dist,target.y+1.35+sp*dist,target.z+Math.cos(state.yaw)*cp*dist);
  state.camera.position.lerp(desired,1-Math.exp(-8*dt));
  const look=new THREE.Vector3(target.x+Math.sin(state.yaw)*20*cp,target.y+sp*20,target.z-Math.cos(state.yaw)*20*cp);state.camera.lookAt(look);
  if(!state.battle.player.jumpVelocity)setEntityFacing(p,Math.sin(state.yaw),-Math.cos(state.yaw));
}
function keyDown(event){
  if(event.code==='Escape'&&state.inMatch){event.preventDefault();state.paused?resumeMatch():pauseMatch();return;}
  if(!state.inMatch||state.paused||/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName))return;
  if(['Space','KeyE','KeyR','KeyH','KeyJ','Digit1','Digit2','Digit3'].includes(event.code))event.preventDefault();
  state.keys.add(event.code);if(event.repeat)return;
  const keyMap={Space:'jump',KeyE:'pickup',KeyR:'reload',KeyH:'medkit',KeyJ:'shield',Digit1:'slot1',Digit2:'slot2',Digit3:'slot3'};if(keyMap[event.code])state.pressed.add(keyMap[event.code]);
}
function keyUp(event){state.keys.delete(event.code);}
function bindInput(){
  addEventListener('keydown',keyDown);addEventListener('keyup',keyUp);addEventListener('blur',()=>{state.keys.clear();state.mouseDown=false;state.touchFire=false;});
  canvas.addEventListener('pointerdown',event=>{if(!state.inMatch||state.paused)return;if(event.pointerType==='mouse'){state.mouseDown=event.button===0;if(event.button===2)event.preventDefault();}state.lastPointer={x:event.clientX,y:event.clientY};if(matchMedia('(pointer:fine)').matches&&document.pointerLockElement!==canvas&&canvas.requestPointerLock)try{canvas.requestPointerLock();}catch{};});
  addEventListener('pointerup',event=>{if(event.pointerType==='mouse')state.mouseDown=false;state.lastPointer=null;});
  addEventListener('pointermove',event=>{
    if(!state.inMatch||state.paused)return;
    if(document.pointerLockElement===canvas){state.yaw-=event.movementX*.0024;state.pitch=clamp(state.pitch-event.movementY*.0018,-.28,.58);return;}
    if(event.pointerType==='touch'&&event.target===canvas&&state.lastPointer){const dx=event.clientX-state.lastPointer.x,dy=event.clientY-state.lastPointer.y;state.yaw-=dx*.009;state.pitch=clamp(state.pitch-dy*.006,-.28,.58);state.lastPointer={x:event.clientX,y:event.clientY};}
  });
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  bindTouchControls();
}
function bindTouchControls(){
  const pad=$('move-pad'),thumb=$('move-thumb');let activePointer=null;
  const updatePad=event=>{const rect=pad.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,max=rect.width*.32,dx=event.clientX-cx,dy=event.clientY-cy,len=Math.hypot(dx,dy),factor=len>max?max/len:1;state.touch.x=dx*factor/max;state.touch.z=-dy*factor/max;thumb.style.transform='translate('+dx*factor+'px,'+dy*factor+'px)';};
  pad.addEventListener('pointerdown',event=>{activePointer=event.pointerId;pad.setPointerCapture(event.pointerId);updatePad(event);});pad.addEventListener('pointermove',event=>{if(event.pointerId===activePointer)updatePad(event);});
  const release=event=>{if(event.pointerId!==activePointer)return;activePointer=null;state.touch={x:0,z:0};thumb.style.transform='translate(0,0)';};pad.addEventListener('pointerup',release);pad.addEventListener('pointercancel',release);
  const hold=(id,set)=>{const button=$(id);button.addEventListener('pointerdown',event=>{event.preventDefault();set(true);button.setPointerCapture(event.pointerId);});const end=()=>set(false);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);button.addEventListener('lostpointercapture',end);};
  hold('touch-fire',value=>state.touchFire=value);hold('touch-sprint',value=>state.touchSprint=value);
  $('touch-pickup').addEventListener('pointerdown',()=>state.pressed.add('pickup'));$('touch-reload').addEventListener('pointerdown',()=>state.pressed.add('reload'));
  $('touch-medkit').addEventListener('pointerdown',()=>state.pressed.add('medkit'));$('touch-shield').addEventListener('pointerdown',()=>state.pressed.add('shield'));
  $('hotbar').addEventListener('click',event=>{const button=event.target.closest('[data-slot]');if(button)state.pressed.add('slot'+button.dataset.slot);});
}
function renderFrame(){
  requestAnimationFrame(renderFrame);const dt=Math.min(.05,state.clock.getDelta());state.mapTimer-=dt;state.toastTimer-=dt;state.hitTimer-=dt;
  if(state.toastTimer<=0)$('toast').classList.remove('show');if(state.hitTimer<=0)$('hit-marker').classList.remove('show');
  if(state.inMatch&&!state.paused){const controls=inputSnapshot();state.battle.update(dt,controls,state.camera);updateCamera(dt);if(state.lastHUD)updateHUD(state.lastHUD);state.pressed.clear();}
  else if(!state.inMatch){state.orbit+=dt*.08;state.camera.position.set(Math.sin(state.orbit)*1560,560,Math.cos(state.orbit)*1560);state.camera.lookAt(0,0,0);}
  state.renderer.render(state.scene,state.camera);
}
async function initialize(){
  bindLobby();bindInput();$('touch-controls').hidden=!matchMedia('(pointer:coarse)').matches;
  try{state.roster=await loadRoster();state.teams=state.roster.teams;fillRoster();}
  catch(error){$('roster-count').textContent='ROSTER LOAD FAILED';$('player-select').innerHTML='<option>'+escapeHTML(error.message)+'</option>';console.error(error);}
  state.scene=new THREE.Scene();state.camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.1,5000);
  state.renderer=new THREE.WebGLRenderer({canvas,antialias:matchMedia('(pointer:fine)').matches,alpha:false,powerPreference:'high-performance'});
  state.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));state.renderer.setSize(innerWidth,innerHeight,false);state.renderer.outputColorSpace=THREE.SRGBColorSpace;state.renderer.toneMapping=THREE.ACESFilmicToneMapping;state.renderer.toneMappingExposure=1.14;
  state.renderer.shadowMap.enabled=true;state.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  state.world=await createWorld(state.scene);
  state.battle=new BattleRoyale(state.scene,state.world,{
    onStart:player=>{state.lastHUD=null;},onToast:setToast,onHUD:updateHUD,onHit:showHit,onElimination:addKillFeed,onFinish:finishMatch,
    onFire:()=>{},onHumanDamage:()=>{},onPickup:()=>{}
  });
  addEventListener('resize',()=>{state.camera.aspect=innerWidth/innerHeight;state.camera.updateProjectionMatrix();state.renderer.setSize(innerWidth,innerHeight,false);state.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));});
  renderFrame();
}

initialize().catch(error=>{console.error(error);$('loading').hidden=false;$('loading').innerHTML='<span>COULD NOT START · '+escapeHTML(error.message)+'</span>';});
