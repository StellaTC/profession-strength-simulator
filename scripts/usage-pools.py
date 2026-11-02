from pathlib import Path
import sqlite3,json,collections,argparse
p=argparse.ArgumentParser();p.add_argument('--archive',required=True);args=p.parse_args();root=Path(__file__).resolve().parents[1];data=json.loads((root/'resources/game-data.json').read_text());db=sqlite3.connect(f'file:{args.archive}?mode=ro',uri=True)
classes=['water','fire','nature','sword','mace','spear','bow','crossbow','shield'];report={'schemaVersion':2,'threshold':0.2,'deduplication':'匿名资料不能识别真实人数；按等级、完整战斗装备和技能配置去重，统计每职业有效配装样本的使用率。','professions':{}}
for cls in classes:
 seen=set();abilities=collections.Counter();foods=collections.Counter();coffees=collections.Counter();total=0;drink_sets=collections.Counter();food_sets=collections.Counter();orders=collections.Counter();trigger_counts=collections.defaultdict(collections.Counter)
 for row in db.execute('SELECT levels_json,equipment_json,abilities_json,food_json,drinks_json,triggers_json FROM party_members WHERE class_id=?',(cls,)):
  try:
   levels,eq,ab,food,drinks,triggers=[json.loads(x or '{}') for x in row];eq={k:v for k,v in eq.items() if k!='trinket'}
   if max(levels.values(),default=0)<150 or sum(bool(v and v.get('itemHrid')) for v in eq.values())<12 or sum(bool(a and a.get('abilityHrid')) for a in ab)<5:continue
   sig=json.dumps([levels,eq,ab],sort_keys=True)
   if sig in seen:continue
   seen.add(sig);total+=1
   order=tuple(a['abilityHrid'] for a in ab if a and a.get('abilityHrid') and not data['abilityDetailMap'].get(a['abilityHrid'],{}).get('isSpecialAbility'));orders[order]+=1
   if '/items/wisdom_coffee' not in drinks:drink_sets[tuple(drinks)]+=1
   food_sets[tuple(food)]+=1
   for h,t in triggers.items():trigger_counts[h][json.dumps(t,sort_keys=True)]+=1
   abilities.update({a['abilityHrid'] for a in ab if a and a.get('abilityHrid')});foods[tuple(sorted(f for f in food if f))]+=1;coffees.update(set(d for d in drinks if d))
  except (ValueError,TypeError,KeyError):continue
 detail=[]
 for h,count in abilities.most_common():
  a=data['abilityDetailMap'].get(h)
  if a:detail.append({'hrid':h,'name':a['name'],'special':bool(a.get('isSpecialAbility')),'count':count,'usage':count/total,'eligible':count/total>=.2,'mandatory':count/total>.99})
 triples=[(sum(data['itemDetailMap'].get(f,{}).get('itemLevel',0) for f in fs),count,fs) for fs,count in foods.items() if len(fs)==3 and all(f in data['itemDetailMap'] for f in fs)]
 best=max(triples) if triples else (0,0,())
 report['professions'][cls]={'sampleCount':total,'abilities':detail,'food':list(food_sets.most_common(1)[0][0]),'fixedDrinks':list(drink_sets.most_common(1)[0][0]),'fixedTriggers':{h:json.loads(c.most_common(1)[0][0]) for h,c in trigger_counts.items()},'ordinaryOrders':[{'skills':list(o),'count':n} for o,n in orders.most_common()],'fixedFoodSupport':food_sets.most_common(1)[0][1],'fixedDrinksSupport':drink_sets.most_common(1)[0][1],'foodSupport':best[1],'foodSelection':'采用该职业去重样本中频次最高的完整搭配；咖啡同样取最常用整套并排除智慧咖啡；每项触发器取完整条件列表的众数。','coffeeUsage':[{'hrid':h,'name':data['itemDetailMap'].get(h,{}).get('name',h),'count':n,'usage':n/total} for h,n in coffees.most_common()]}
primary_coffee={'water':'magic','fire':'magic','nature':'magic','sword':'melee','mace':'melee','spear':'melee','bow':'ranged','crossbow':'ranged','shield':'defense'}
for cls,v in report['professions'].items():
 v['archiveMostCommonDrinks']=v['fixedDrinks'];v['archiveMostCommonDrinksSupport']=v.get('fixedDrinksSupport');v['fixedDrinksSupport']=None;v['fixedDrinks']=['/items/critical_coffee',f'/items/ultra_{primary_coffee[cls]}_coffee','/items/ultra_attack_coffee'];v['coffeeSelection']='用户规则：初筛攻击起步，个人死亡率超2/h时暴击换耐力，否则比较攻速/吟唱，保留最佳进入复核。'
report['schemaVersion']=3
report['coffeePolicy']={'version': 1, 'baseline': ['critical_coffee', 'ultra_primary_damage_coffee', 'ultra_attack_coffee'], 'alternatives': {'physical': 'swiftness_coffee', 'magic': 'channeling_coffee'}, 'deathThresholdPerMemberPerHour': 2, 'replaceOnExcessDeath': 'critical_coffee -> ultra_stamina_coffee', 'selectionPhase': 'first4hOnly', 'initialRunSurvivalBranchSkipsSpeedComparison': True, 'thirdCupSharedWithinProfession': True, 'persistSelectionAcrossLaterStages': True, 'excluded': ['lucky_coffee', 'wisdom_coffee']}
report['coffeePool']=[h for h,v in data['itemDetailMap'].items() if h.endswith('_coffee') and v.get('consumableDetail',{}).get('usableInActionTypeMap',{}).get('/action_types/combat') and h not in ['/items/wisdom_coffee','/items/lucky_coffee']]
(root/'resources/search-pools.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));(root/'outputs/职业技能与咖啡使用率.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
for cls,p in report['professions'].items():print(cls,p['sampleCount'],[(a['name'],round(a['usage']*100)) for a in p['abilities'] if a['eligible']],p['food'])
