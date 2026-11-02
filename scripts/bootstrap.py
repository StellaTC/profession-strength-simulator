from pathlib import Path
import json,sqlite3,collections,copy,argparse,bisect
root=Path(__file__).resolve().parents[1]; args=argparse.ArgumentParser();args.add_argument('--archive',required=True);archive=Path(args.parse_args().archive)
data=json.loads((root/'resources/game-data.json').read_text()); maps=data.get('maps',data)
print('data',list(maps)[:8])
con=sqlite3.connect(f'file:{archive}?mode=ro',uri=True)
classes=['water','fire','nature','sword','mace','spear','bow','crossbow','shield']; templates=[]; provenance=[]
for cls in classes:
 rows=con.execute('SELECT event_id,member_slot,levels_json,equipment_json,food_json,drinks_json,abilities_json,triggers_json,house_rooms_json,achievements_json,guild_buffs_json FROM party_members WHERE class_id=?',(cls,))
 samples={}
 for row in rows:
  try:
   vals=[json.loads(x or '{}') for x in row[2:]]; lv,eq,food,drinks,ab,tr,house,ach,guild=vals
   if max(lv.values(),default=0)<150 or sum(bool(v and v.get('itemHrid')) for v in eq.values())<12 or sum(bool(a and a.get('abilityHrid')) for a in ab)<5 or len([f for f in food if f])<3 or len([f for f in drinks if f])<3 or not tr or not house or not ach: continue
   # Entire loadout signature, excluding enhancement to avoid repeated optimizer telemetry.
   sig=tuple(sorted((k,v['itemHrid']) for k,v in eq.items() if v and v.get('itemHrid')))
   fingerprint=json.dumps([lv,eq,ab],sort_keys=True)
   samples.setdefault(fingerprint,(sig,row,vals))
  except (ValueError,TypeError,KeyError): pass
 counts=collections.Counter(v[0] for v in samples.values()); signature,count=counts.most_common(1)[0]
 _,row,vals=next(v for v in samples.values() if v[0]==signature)
 lv,eq,food,drinks,ab,tr,house,ach,guild=vals
 provenance.append(dict(profession=cls,qualifyingUniqueSnapshots=len(samples),wholeLoadoutSupport=count,sourceEvent=row[0],sourceSlot=row[1],equipment=dict(signature),method='最高战斗技能≥150，至少12个非空装备，5个非空技能，3食物3饮料，触发器/房屋/成就资料齐全；按等级、装备、技能去重后选整套装备众数；不拼接单槽。'))
 for tier in range(3):
  levels=dict(stamina=125+10*tier,intelligence=120+10*tier,attack=135+10*tier,defense=125+10*tier,melee=105+10*tier,ranged=105+10*tier,magic=105+10*tier)
  primary='magic' if cls in classes[:3] else 'ranged' if cls in ['bow','crossbow'] else 'defense' if cls=='shield' else 'melee'
  levels[primary]=150+10*tier
  stats=maps['itemDetailMap'][eq['weapon']['itemHrid']]['equipmentDetail']['combatStats'];primary=stats['primaryTraining'].split('/')[-1]
  for style in stats['combatStyleHrids']:
   for skill in maps['combatStyleDetailMap'][style]['skillExpMap']:levels[skill.split('/')[-1]]=130+10*tier
  levels[primary]=150+10*tier
  if cls=='spear':
   levels['attack']=145+10*tier
   levels['melee']=140+10*tier
  gear=copy.deepcopy(eq); gear.pop("trinket",None)
  for slot,item in gear.items():
   if not item:continue
   item['enhancementLevel']=10 if slot=='pouch' else [12,14,15][tier] if slot in ['weapon','main_hand','two_hand'] else [5,7,10][tier] if slot in ['ring','earrings','neck'] else [10,12,14][tier]
  abilities=copy.deepcopy(ab)
  for i,a in enumerate(abilities):
   if a:a['level']=([50,60,70] if i==0 else [80,90,100])[tier]
  rooms={k:[6,8,8][tier] for k,v in maps['houseRoomDetailMap'].items() if 'combat' in k or k in house}
  achievements={k:True for k in maps['achievementDetailMap']}
  buffs={k:5 for k,v in maps['guildBuffDetailMap'].items() if v.get('isCombat')}
  drinks=['/items/critical_coffee',f'/items/ultra_{"melee" if cls=="spear" else primary}_coffee','/items/ultra_attack_coffee']
  config=dict(id='1',name=cls,selected=True,levels=levels,equipment=gear,food=food,drinks=drinks,abilities=abilities,triggerMap=tr,houseRooms=rooms,achievements=achievements,guildBuffs=buffs)
  templates.append(dict(id=f'{cls}-{tier}',profession=cls,tier=tier,version=(7 if cls=='spear' else 6)+(1 if tier==2 else 0),config=config,provenance=provenance[-1]))
(root/'resources/templates.json').write_text(json.dumps(templates,ensure_ascii=False,indent=2))
(root/'outputs/模板来源.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2))
