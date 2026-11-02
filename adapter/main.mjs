import fs from 'node:fs';
import {validateConfigs} from './validation.mjs';
import {importSoloConfig,importGroupConfig} from './combat/services/importExportMapper.js';
import {createEmptyPlayerConfig} from './combat/shared/playerConfig.js';
import readline from 'node:readline';
import {setRuntimeCombatGameData,getRuntimeCombatGameData} from './combat/shared/runtimeGameData.js';
import {buildPlayersForSimulation} from './combat/services/playerMapper.js';
import {compileRustPayload,rustGameData} from './combat/services/rustPayload.js';
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));setRuntimeCombatGameData(data);
const maps=getRuntimeCombatGameData().maps;
function compile(r){
 const configs=r.configs.map((p,i)=>({...p,id:String(i+1),selected:true,equipment:Object.fromEntries(Object.entries(p.equipment||{}).filter(([slot,item])=>slot!=="trinket"&&!String(item?.itemHrid||"").includes("task_badge")))}));
 validateConfigs(configs,maps);
 return compileRustPayload({players:buildPlayersForSimulation(configs),zone:{zoneHrid:r.zone||'/actions/combat/pirate_cove',difficultyTier:r.tier??1},seed:r.seed??20261028,simulationTimeLimit:(r.hours??48)*3600e9,extra:r.extra||{mooPass:true,comExp:20,comDrop:20,omitWipeDetails:true}});
}
for await(const line of readline.createInterface({input:process.stdin})){
 try{const r=JSON.parse(line);let result;
 if(r.op==='import'){const text=JSON.stringify(r.value);if(r.value.version===2&&r.value.players){result=importGroupConfig(text,r.value.players.map((p,i)=>createEmptyPlayerConfig(p.id||i+1)),{}).players;}else result=[importSoloConfig(text,createEmptyPlayerConfig(1),{}).player];}
 else if(r.op==='data')result=rustGameData();
 else if(r.op==='catalog')result={gameVersion:data.gameVersion||maps.gameVersion,experience:maps.levelExperienceTable,combatStyles:maps.combatStyleDetailMap,abilities:maps.abilityDetailMap,items:maps.itemDetailMap,zones:Object.values(maps.actionDetailMap).filter(x=>x.combatZoneInfo&&(x.combatZoneInfo.isDungeon||(x.combatZoneInfo.fightInfo?.randomSpawnInfo?.spawns||[]).length>1)).sort((a,b)=>(a.sortIndex||0)-(b.sortIndex||0)),monsters:maps.combatMonsterDetailMap,houseRooms:maps.houseRoomDetailMap,guildBuffs:maps.guildBuffDetailMap,achievements:maps.achievementDetailMap,triggerDependencies:maps.combatTriggerDependencyDetailMap,triggerConditions:maps.combatTriggerConditionDetailMap,triggerComparators:maps.combatTriggerComparatorDetailMap};
 else result=compile(r);
 console.log(JSON.stringify({ok:true,result}));
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e.stack||e)}));}
}
