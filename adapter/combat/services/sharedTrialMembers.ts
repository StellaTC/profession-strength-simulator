import { getRuntimeCombatGameData } from '../shared/runtimeGameData.js'
import { copyCombatValue, type SharedCombatBaseline } from './combatWorkspaceState'
import { guildTrialMemberProfession, guildTrialPowerScore, type NativeGuildTrialMember } from './guildTrialNative'
/** Character facts only. Trial assignments, food restrictions and trial rules remain separate. */
export function membersFromSharedBaseline(baseline:SharedCombatBaseline, existing:NativeGuildTrialMember[]) {
  const result=copyCombatValue(existing), missing:string[]=[]
  const items=getRuntimeCombatGameData().maps.itemDetailMap
  for(const p of baseline.players.filter(p=>p.selected)) {
    if(result.some(m=>m.characterName===p.name))continue
    const skills=Object.fromEntries(Object.entries(p.levels).map(([k,v])=>[`/skills/${k}`,Number(v)]))
    const equipment=Object.values(p.equipment).flatMap((e:any)=>{
      const slot=items[e.itemHrid]?.equipmentDetail?.type?.split('/').pop() || items[e.itemHrid]?.equipmentDetail?.equipmentTypeHrid?.split('/').pop()
      return slot?[{itemLocationHrid:`/item_locations/${slot}`,itemHrid:e.itemHrid,enhancementLevel:Number(e.enhancementLevel)||0}]:[]
    })
    const abilities=p.abilities.filter((a:any)=>a?.abilityHrid).map((a:any)=>({...a}))
    let id=-(100000+result.length)
    while(result.some(m=>m.characterId===id))id--
    const member:NativeGuildTrialMember={characterId:id,characterName:p.name,capturedAt:new Date(baseline.createdAt).toISOString(),skills,equipment,abilities,
      guildBuffs:copyCombatValue(p.guildBuffs||{}),houseRooms:copyCombatValue(p.houseRooms||{}),achievements:copyCombatValue(p.achievements||{}),communityBuffs:{},
      guildBuildingLevels:copyCombatValue(p.guildBuildingLevels||{}),characterGuildBuffs:copyCombatValue(p.characterGuildBuffs||{}),
      abilityCombatTriggersMap:copyCombatValue(p.triggerMap||{}),learnedAbilities:Object.entries(p.abilityLevelMap||{}).map(([abilityHrid,level])=>({abilityHrid,level:Number(level)})),
      auras:Object.fromEntries(abilities.filter((a:any)=>getRuntimeCombatGameData().maps.abilityDetailMap[a.abilityHrid]?.isSpecialAbility).map((a:any)=>[a.abilityHrid,a.level])),selected:true,roleTag:'',powerScore:0}
    member.roleTag=guildTrialMemberProfession(member).name
    member.powerScore=guildTrialPowerScore(member)
    if(!p.guildBuildingLevels||!p.characterGuildBuffs)missing.push(`${p.name}：试炼公会建筑 / 个人公会增益`)
    result.push(member)
  }
  return {members:result,missing}
}
