export function validateConfigs(configs,maps){
 for(const [index,c]of configs.entries()){
  const prefix=`角色 ${index+1}：`;
  const gear=c.equipment||{};const weapon=maps.itemDetailMap[gear.weapon?.itemHrid];
  if(!weapon?.equipmentDetail)throw Error(prefix+'请选择合法武器');
  if(weapon.equipmentDetail.type==='/equipment_types/two_hand'&&gear.off_hand?.itemHrid)throw Error(prefix+'双手武器不能同时装备副手');
  for(const [slot,e]of Object.entries(gear)){
   if(!e?.itemHrid||slot==='trinket')continue;const item=maps.itemDetailMap[e.itemHrid];
   if(!item?.equipmentDetail)throw Error(prefix+`装备不存在 ${e.itemHrid}`);
   if(!Number.isFinite(Number(e.enhancementLevel))||Number(e.enhancementLevel)<0)throw Error(prefix+'强化等级无效');
   if(slot!=='weapon'&&item.equipmentDetail.type!==`/equipment_types/${slot}`)throw Error(prefix+`装备槽位不符 ${slot}`);
  }
  const skills=new Set();for(const [i,a]of (c.abilities||[]).entries()){
   if(!a?.abilityHrid)continue;const def=maps.abilityDetailMap[a.abilityHrid];if(!def)throw Error(prefix+`技能不存在 ${a.abilityHrid}`);
   if(Boolean(def.isSpecialAbility)!==(i===0))throw Error(prefix+'第一个技能槽为特技，其余为普通技能');
   if(skills.has(a.abilityHrid))throw Error(prefix+'技能不能重复');skills.add(a.abilityHrid);
  }
  for(const [key,category]of [['food','/item_categories/food'],['drinks','/item_categories/drink']]){
   const used=new Set(),buffs=new Set();for(const hrid of c[key]||[]){if(!hrid)continue;const item=maps.itemDetailMap[hrid];
    if(item?.categoryHrid!==category||!item.consumableDetail?.usableInActionTypeMap?.['/action_types/combat'])throw Error(prefix+`不是合法战斗消耗品 ${hrid}`);
    if(used.has(hrid))throw Error(prefix+'消耗品不能重复');used.add(hrid);
    for(const b of item.consumableDetail.buffs||[]){if(buffs.has(b.uniqueHrid))throw Error(prefix+'消耗品效果互斥');buffs.add(b.uniqueHrid);}
   }
  }
 }
}
