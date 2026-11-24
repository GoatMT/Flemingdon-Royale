const seasonUrl=new URL('../data/2026.json',import.meta.url);
const gameplayUrl=new URL('../data/player-gameplay-2026.json',import.meta.url);

export async function loadRoster(){
  const [seasonResponse,profilesResponse]=await Promise.all([fetch(seasonUrl),fetch(gameplayUrl)]);
  if(!seasonResponse.ok)throw new Error('The official 2026 LSL roster could not be loaded.');
  const season=await seasonResponse.json(),profiles=profilesResponse.ok?await profilesResponse.json():{players:{}};
  const teams=season.teams.map(team=>({...team,kitColor:'#13824e'}));
  const players=teams.flatMap(team=>team.roster.map(player=>({...player,teamId:team.id,teamName:team.name,teamLogo:team.logo,kitColor:team.kitColor,gameplayProfile:profiles.players?.[player.id]||null})));
  await Promise.all(teams.map(async team=>{
    try{
      const image=new Image();image.src=new URL('../'+team.logo,import.meta.url).href;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=24;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,24,24);
      const pixels=context.getImageData(0,0,24,24).data,bins=new Map();
      for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b);if(pixels[i+3]<160||max<50||min>218||max-min<28)continue;const key=[r,g,b].map(v=>Math.round(v/24)*24).join(',');bins.set(key,(bins.get(key)||0)+1);}
      const top=[...bins].sort((a,b)=>b[1]-a[1])[0];if(top)team.kitColor='#'+top[0].split(',').map(v=>Math.min(255,Number(v)).toString(16).padStart(2,'0')).join('');
    }catch{}
    for(const player of team.roster){player.kitColor=team.kitColor;player.teamId=team.id;player.teamName=team.name;player.teamLogo=team.logo;player.gameplayProfile=profiles.players?.[player.id]||null;}
  }));
  return {teams,players,season:String(season.season||'2026')};
}

export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const playerLabel=player=>player?.jersey!=null?`${player.name} #${player.jersey}`:player?.name||'Lantern player';

export function shuffle(array,random=Math.random){const copy=[...array];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;}
