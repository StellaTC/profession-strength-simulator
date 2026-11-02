import { itemDetailIndex as rawItemDetailIndex, levelExperienceTable } from "../shared/gameDataIndex.js"
import { buildPlayersForSimulation } from "./playerMapper.js"
import { generateAutomaticEquipmentVariants, generateEquipmentReplacementCandidates, materializeEquipmentReplacementVariant, computeAbilityBookUpgradeCost } from "./autoEquipmentUpgrade.js"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js"
import { copyCombatValue, type CombatConfig } from "./combatWorkspaceState"
import { GearAcquisition, gearQuote } from "./gearAcquisition"
import { PlannerEvaluator, REVIEW_SEEDS, SCREEN_SEEDS, plannerSeeds, compareEvaluations, type Evaluation, type PlannerTarget, type PlannerObjective } from "./plannerEvaluation"
import { translateCombatName } from "./combatTranslation"
const itemDetailIndex = rawItemDetailIndex as Record<string, any>
export interface PlannerOptions {
  target: PlannerTarget; currentTarget?: PlannerTarget; objective: PlannerObjective
  budgets: Record<string,number>; otherIncome: Record<string,number>; tax: number
  horizon: number; maxDays: number; maxDeaths: number; maxLevelUp: number
  lockedMembers: string[]; lockedSlots: string[]; swapItems: boolean
  includeLevels: boolean; includeConsumables: boolean; includeReplacements: boolean
  rounds: number
}
export interface PlannerControl { resume?: any; stage: (text:string)=>void; checkpoint?: (value:any)=>Promise<void> }
const name=(hrid:string)=>translateCombatName(itemDetailIndex[hrid]?.name || "",hrid)
const blank=(p:CombatConfig[])=>copyCombatValue(p)
function avgMetric(r:Evaluation,o:PlannerObjective){return r[o]}
function trigger(condition:string,comparator:string,value:number,dependency="self"){
  return {dependencyHrid:`/combat_trigger_dependencies/${dependency}`,conditionHrid:`/combat_trigger_conditions/${condition}`,comparatorHrid:`/combat_trigger_comparators/${comparator}`,value}
}
export function consumablesConflict(a:string,b:string){
  if(!a||!b)return false
  if(a===b)return true
  const family=(h:string)=>h.match(/(?:_|\/)(yogurt|gummy|donut|cake)$/)?.[1] || (h.endsWith('/cupcake')?'cake':'')
  if(family(a)&&family(a)===family(b))return true
  const buffs=(h:string)=>(itemDetailIndex[h]?.consumableDetail?.buffs || []).map((x:any)=>x.uniqueHrid).filter(Boolean)
  const set=new Set(buffs(a));return buffs(b).some((x:string)=>set.has(x))
}
function legalConsumable(player:CombatConfig,kind:string,slot:number,hrid:string){
  if(!hrid)return true
  const item=itemDetailIndex[hrid]
  if(!item?.consumableDetail?.usableInActionTypeMap?.['/action_types/combat'])return false
  const requirements=item.consumableDetail.levelRequirements || []
  if(requirements.some((r:any)=>Number(player.levels[r.skillHrid.split('/').at(-1)]||0)<r.level))return false
  return !(player[kind]||[]).some((h:string,i:number)=>i!==slot&&consumablesConflict(h,hrid))
}
export async function optimizePartyConsumables(ev:PlannerEvaluator,options:PlannerOptions,control:PlannerControl,initial=ev.baseline.players){
  const resumed=control.resume?.kind==='consumables'?control.resume:null
  let players=blank(resumed?.players||initial);const original=blank(initial),changes:any[]=blank(resumed?.changes||[])
  const objective=options.objective,target=options.target
  const base=await ev.evaluate(original,target,24,REVIEW_SEEDS)
  const maps=getRuntimeCombatGameData().maps
  const catalogue=Object.values(maps.itemDetailMap) as any[]
  for(let round=0;round<Math.max(1,Math.min(3,options.rounds));round++){
    let adopted=resumed?.round===round?resumed.adopted:0
    for(let m=0;m<players.length;m++){
      if(!players[m].selected||options.lockedMembers.includes(String(players[m].id)))continue
      const info=buildPlayersForSimulation([{...players[m],selected:true}])[0]
      for(const kind of ['food','drinks'])for(let slot=0;slot<Math.min(3,Number(info.combatDetails.combatStats[kind==='food'?'foodSlots':'drinkSlots']||1));slot++){
        const cursor=round*1000+m*10+(kind==='food'?0:3)+slot
        if(resumed&&cursor<=resumed.cursor)continue
        ev.check();const lock=`${players[m].id}:${kind}:${slot}`
        if(options.lockedSlots.includes(lock))continue
        control.stage(`第 ${round+1} 轮 · ${players[m].name} · ${kind==='food'?'食物':'饮料'} ${slot+1}`)
        const before=players[m][kind]?.[slot]||''
        const hrids=options.swapItems?[before,'',...catalogue.filter(i=>i.categoryHrid===`/item_categories/${kind==='food'?'food':'drink'}`&&i.consumableDetail?.cooldownDuration>0&&gearQuote(ev.pricing,i.hrid)!=null).map(i=>i.hrid)]:[before]
        let current=await ev.evaluate(players,target,4,SCREEN_SEEDS)
        let best:{players:CombatConfig[],evaluation:Evaluation,threshold?:any}|null=null
        for(const h of new Set(hrids)){
          if(!legalConsumable(players[m],kind,slot,h))continue
          const candidate=blank(players);candidate[m][kind][slot]=h
          const result=await ev.evaluate(candidate,target,4,SCREEN_SEEDS)
          if(result[objective]>(best?.evaluation[objective]??current[objective])+1e-9)best={players:candidate,evaluation:result}
        }
        let candidate=best?.players||blank(players)
        const chosen=candidate[m][kind][slot]
        if(chosen){
          const detail=itemDetailIndex[chosen]?.consumableDetail||{}
          const templates:any[][]=[candidate[m].triggerMap?.[chosen] || detail.defaultCombatTriggers || [],detail.defaultCombatTriggers||[],[]]
          const hp=info.combatDetails.maxHitpoints,mp=info.combatDetails.maxManapoints
          for(const fraction of [.1,.25,.5,.75,.9]){
            if(detail.hitpointRestore>0){templates.push([trigger('missing_hp','greater_than_equal',Math.max(1,Math.round(hp*fraction)))]);templates.push([trigger('current_hp','less_than_equal',Math.max(1,Math.round(hp*fraction)))])}
            if(detail.manapointRestore>0)templates.push([trigger('missing_mp','greater_than_equal',Math.max(1,Math.round(mp*fraction)))])
          }
          if(!(detail.hitpointRestore>0)&&!(detail.manapointRestore>0))for(const n of [1,2,3,4])templates.push([trigger('number_of_active_units','greater_than_equal',n,'all_enemies')])
          let bestTemplate:any[]|null=null
          let bestValue=best?.evaluation[objective]??current[objective]
          for(const t of templates){
            const config=blank(candidate);config[m].triggerMap||={};config[m].triggerMap[chosen]=t
            const result=await ev.evaluate(config,target,4,SCREEN_SEEDS)
            if(result[objective]>bestValue+1e-9){bestValue=result[objective];best={players:config,evaluation:result};bestTemplate=t}
          }
          const condition=bestTemplate?.[0]
          if(condition&&['missing_hp','current_hp','missing_mp'].some(c=>condition.conditionHrid.endsWith('/'+c))){
            const max=condition.conditionHrid.endsWith('_mp')?mp:hp
            for(const delta of [-.1,-.05,.05,.1]){
              const t=[{...condition,value:Math.max(1,Math.min(max,Math.round(condition.value+delta*max)))}]
              const config=blank(best!.players);config[m].triggerMap[chosen]=t
              const result=await ev.evaluate(config,target,8,SCREEN_SEEDS)
              const comparison=await ev.evaluate(best!.players,target,8,SCREEN_SEEDS)
              if(result[objective]>comparison[objective]+1e-9)best={players:config,evaluation:result}
            }
          }
        }
        if(best){
          const screen=await ev.evaluate(players,target,8,SCREEN_SEEDS),review=await ev.evaluate(best.players,target,8,SCREEN_SEEDS)
          if(review[objective]>screen[objective]+1e-9&&review.deathsPerHour<=screen.deathsPerHour+1e-9){
            players=best.players;adopted++
            changes.push({memberId:players[m].id,member:players[m].name,slot:kind==='food'?`食物 ${slot+1}`:`饮料 ${slot+1}`,before:name(before)||'空',after:name(players[m][kind][slot])||'空',triggers:copyCombatValue(players[m].triggerMap?.[players[m][kind][slot]]||[])})
          }
        }
        await control.checkpoint?.({kind:'consumables',players,changes,cursor,round,adopted})
      }
    }
    if(!adopted&&(!resumed||round>=resumed.round))break
  }
  control.stage('独立 8 次配对复核')
  const result=await ev.evaluate(players,target,24,REVIEW_SEEDS)
  const statistics=compareEvaluations(result,base,objective)
  const accepted=changes.length>0&&statistics.clearlyBetter&&result.deathsPerHour<=base.deathsPerHour+1e-9
  return {kind:'consumables',players:accepted?players:original,baseline:base,result:accepted?result:base,changes:accepted?changes:[],statistics,unchanged:!accepted,reviewHours:192,message:accepted?'改动通过 8 次配对复核':'没有通过复核的可靠提升，保持原配置'}
}
interface Upgrade { member:number; id:string; label:string; players:CombatConfig[]; cost:number; detail:any }
function upgrades(ev:PlannerEvaluator,players:CombatConfig[],options:PlannerOptions):Upgrade[]{
  const out:Upgrade[]=[]
  players.forEach((p,m)=>{
    if(!p.selected||options.lockedMembers.includes(String(p.id)))return
    const initial=ev.baseline.players.find(x=>String(x.id)===String(p.id))||p
    const variants:any[]=[...generateAutomaticEquipmentVariants(p).variants]
    if(options.includeReplacements){
      const replacement=generateEquipmentReplacementCandidates(p)
      for(const c of [...replacement.upper,...replacement.defensive])variants.push(materializeEquipmentReplacementVariant(p,{...c,afterLevel:p.equipment[c.slot]?.enhancementLevel||0,refined:false}))
    }
    for(const v of variants){
      if(!v.eligible)continue
      if(v.afterItemHrid&&v.afterLevel>Number(initial.equipment?.[v.slot]?.enhancementLevel||0)+options.maxLevelUp)continue
      let cost:number|null=null,detail:any
      if(v.abilityHrid){
        const original=initial.abilities?.[v.abilityIndex]?.level||1
        if(v.afterLevel>original+10)continue
        detail=computeAbilityBookUpgradeCost(v.abilityHrid,v.beforeLevel,v.afterLevel,ev.pricing.priceTable);cost=detail.costAvailable?detail.cost:null
      }else{
        const before=v.beforeItemHrid?{itemHrid:v.beforeItemHrid,level:v.beforeLevel}:undefined
        detail=new GearAcquisition(ev.pricing,options.tax,before).compare(v.afterItemHrid,v.afterLevel)
        detail.best=detail.routes.find((route:any)=>!route.missingResale)||null
        cost=detail.best?.netCost??null
      }
      if(cost==null||!Number.isFinite(cost))continue
      const next=blank(players);next[m]=copyCombatValue(v.snapshot)
      out.push({member:m,id:v.id,label:v.label||`${name(v.afterItemHrid)} +${v.afterLevel}`,players:next,cost,detail})
    }
  })
  return out
}
function income(result:Evaluation,players:CombatConfig[],options:PlannerOptions){return players.map(p=>(result.players.find(x=>x.id===String(p.id))?.profitMidpointPerHour||0)*24+Number(options.otherIncome[String(p.id)]||0))}
export function purchaseWait(cash:number,dailyIncome:number,cost:number){return cost<=cash?0:dailyIncome>0?(cost-cash)/dailyIncome:Infinity}
/** A party cannot continue with the same simulated income once a member runs out of funds. */
export function fundedProjection(players:CombatConfig[],cash:number[],daily:number[],remaining:number){
  const days=Math.max(0,Math.min(remaining,...players.map((p,i)=>p.selected&&daily[i]<0?Math.max(0,cash[i])/-daily[i]:Infinity)))
  return {days,sustainable:days>=remaining-1e-9,
    balances:cash.map((money,i)=>Math.max(0,money+daily[i]*days)),
    shortfalls:cash.map((money,i)=>players[i].selected?Math.max(0,-(money+daily[i]*remaining)):0)}
}
function assetValue(ev:PlannerEvaluator,players:CombatConfig[],options:PlannerOptions){
  const gear=new GearAcquisition(ev.pricing,options.tax)
  return players.filter(p=>p.selected).reduce((sum,p)=>sum+Object.values(p.equipment||{}).reduce((s:number,e:any)=>s+(gear.resale(e.itemHrid,Number(e.enhancementLevel)||0)||0),0),0)
}
export async function planPartyUpgrades(ev:PlannerEvaluator,options:PlannerOptions,control:PlannerControl){
  const resumed=control.resume?.kind==='upgrades'?control.resume:null
  let players=blank(resumed?.players||ev.baseline.players),day=Number(resumed?.day||0)
  let result:Evaluation=resumed?.result||await ev.evaluate(players,options.target,24,REVIEW_SEEDS)
  const baseline:Evaluation=resumed?.baseline||result,cash:number[]=resumed?.cash?.slice()||players.map(p=>Number(options.budgets[String(p.id)]||0)),steps:any[]=blank(resumed?.steps||[])
  let daily:number[]=resumed?.daily?.slice()||income(result,players,options)
  const wealth=(config:CombatConfig[],money:number[],rates:number[],at:number)=>fundedProjection(config,money,rates,options.horizon-at).balances.reduce((sum,value)=>sum+value,0)+assetValue(ev,config,options)
  const noUpgradeProjection=resumed?.noUpgradeProjection||fundedProjection(players,cash,daily,options.horizon)
  const noUpgradeWealth=resumed?.noUpgradeWealth??wealth(players,cash,daily,0)
  for(let step=steps.length;step<40;step++){
    ev.check();control.stage(`规划购买顺序 · 第 ${step+1} 步`)
    const baselineWealth=wealth(players,cash,daily,day)
    const objective=options.objective
    const remaining=fundedProjection(players,cash,daily,options.horizon-day).days*24
    const baselineScore=objective==='profitMidpointPerHour'?baselineWealth:result[objective]*remaining
    let best:{upgrade:Upgrade,result:Evaluation,wait:number,wealth:number}|null=null
    for(const u of upgrades(ev,players,options)){
      const wait=purchaseWait(cash[u.member],daily[u.member],u.cost)
      if(!Number.isFinite(wait)||day+wait>options.horizon||wait>fundedProjection(players,cash,daily,options.horizon-day).days+1e-9)continue
      const evaluated=await ev.evaluate(u.players,options.target,4,SCREEN_SEEDS)
      const rates=income(evaluated,u.players,options),money=cash.map((c,i)=>c+daily[i]*wait);money[u.member]-=u.cost
      if(money.some((c,i)=>players[i].selected&&c< -1e-6))continue
      const value=objective==='profitMidpointPerHour'?wealth(u.players,money,rates,day+wait):result[objective]*wait*24+evaluated[objective]*fundedProjection(u.players,money,rates,options.horizon-day-wait).days*24
      if(value>Math.max(baselineScore,best?.wealth??-Infinity))best={upgrade:u,result:evaluated,wait,wealth:value}
    }
    if(!best)break
    const verified=await ev.evaluate(best.upgrade.players,options.target,24,REVIEW_SEEDS)
    const statistics=compareEvaluations(verified,result,objective)
    const money=cash.map((c,i)=>c+daily[i]*best!.wait);money[best.upgrade.member]-=best.upgrade.cost
    const rates=income(verified,best.upgrade.players,options)
    if(!statistics.clearlyBetter||verified.deathsPerHour>result.deathsPerHour+1e-9||(objective==='profitMidpointPerHour'&&wealth(best.upgrade.players,money,rates,day+best.wait)<=baselineWealth))break
    day+=best.wait;money.forEach((c,i)=>cash[i]=c);daily=rates;players=best.upgrade.players;result=verified
    steps.push({day,member:players[best.upgrade.member].name,change:best.upgrade.label,cost:best.upgrade.cost,dailyProfit:result.profitMidpointPerHour*24,purchases:best.upgrade.detail.best?.purchases||[],steps:best.upgrade.detail.best?.steps||[],statistics})
    await control.checkpoint?.({kind:'upgrades',players,day,steps,result,baseline,cash,daily,noUpgradeWealth,noUpgradeProjection})
  }
  const projection=fundedProjection(players,cash,daily,options.horizon-day),fundedUntilDay=day+projection.days
  return {kind:'upgrades',players,baseline,result,steps,horizon:options.horizon,noUpgradeWealth,noUpgradeFundedDays:noUpgradeProjection.days,
    sustainable:projection.sustainable,fundedUntilDay,finalWealth:wealth(players,cash,daily,day),
    balances:players.filter(p=>p.selected).map(p=>{const i=players.indexOf(p);return {id:p.id,name:p.name,cash:projection.balances[i],dailyIncome:daily[i],additionalCashRequired:projection.shortfalls[i],equipmentValue:assetValue(ev,[p],options),missingEquipmentPrices:Object.values(p.equipment||{}).some((e:any)=>e?.itemHrid&&gearQuote(ev.pricing,e.itemHrid,Number(e.enhancementLevel)||0,'bid')==null)}}),
    message:projection.sustainable?'每人独立预算；保留不升级方案，购买后重新模拟整队收益。装备缺少买价时按零残值估计。':`资金不足以持续 ${options.horizon} 天，整队战斗规划在第 ${fundedUntilDay.toFixed(3)} 天停止。显示停止时的现金与资产；补足各人缺口后需重新规划，不把负余额当作可执行方案。`}
}
export function levelsAfterDays(player:CombatConfig,rates:Record<string,number>,days:number){
  const next=copyCombatValue(player)
  for(const skill of Object.keys(next.levels)){
    let level=Number(player.levels[skill]);const floor=Number(levelExperienceTable[level]||0)
    const raw=Number(player.skillExperience?.[skill]);const start=Number.isFinite(raw)&&raw>=floor&&raw<Number(levelExperienceTable[level+1]??Infinity)?raw:floor
    const xp=start+Math.max(0,Number(rates[skill]||0))*24*days
    while(level+1<levelExperienceTable.length&&Number(levelExperienceTable[level+1])<=xp)level++
    next.levels[skill]=level
  }
  return next
}
export async function planTargetGoal(ev:PlannerEvaluator,options:PlannerOptions,control:PlannerControl){
  const currentTarget=options.currentTarget||options.target,initial=blank(ev.baseline.players)
  const current=await ev.evaluate(initial,currentTarget,24,REVIEW_SEEDS),daily=income(current,initial,options)
  const direct=await ev.evaluate(initial,options.target,24,REVIEW_SEEDS)
  const accepts=(r:Evaluation)=>r.deathsPerHour<=options.maxDeaths+1e-12&&r[options.objective]>current[options.objective]
  const resumed=control.resume?.kind==='goal'?control.resume:null
  const attempts:any[]=blank(resumed?.attempts||[]);let best:any=resumed?.best?copyCombatValue(resumed.best):null
  const tryDay=async(day:number)=>{
    ev.check();if(attempts.some(attempt=>attempt.day===day))return;control.stage(`目标达标搜索 · 第 ${day} 天`)
    let players=initial.map(p=>options.includeLevels&&!options.lockedMembers.includes(String(p.id))?levelsAfterDays(p,current.players.find(x=>x.id===String(p.id))?.xpBySkill||{},day):copyCombatValue(p))
    const spent=players.map(()=>0),budgets=players.map((p,i)=>Number(options.budgets[String(p.id)]||0)+daily[i]*day),steps:any[]=[]
    if(budgets.some((cash,i)=>players[i].selected&&cash<0)){attempts.push({day,valid:false,reason:"当前地点净收入会使成员现金透支"});return}
    let result=await ev.evaluate(players,options.target,4,SCREEN_SEEDS)
    for(let step=0;step<40&&!accepts(result);step++){
      let next:{u:Upgrade,r:Evaluation,score:number}|null=null
      for(const u of upgrades(ev,players,options)){
        if(spent[u.member]+u.cost>budgets[u.member]+1e-9)continue
        const r=await ev.evaluate(u.players,options.target,4,SCREEN_SEEDS)
        const survival=Math.max(0,result.deathsPerHour-r.deathsPerHour)
        const gain=r[options.objective]-result[options.objective]
        if(r.deathsPerHour>result.deathsPerHour+1e-9||(!survival&&gain<=0))continue
        const score=(result.deathsPerHour>options.maxDeaths?survival*1e9+gain:gain)/Math.max(1,u.cost)
        if(!next||score>next.score)next={u,r,score}
      }
      if(!next)break
      spent[next.u.member]+=next.u.cost;players=next.u.players;result=next.r;steps.push({member:players[next.u.member].name,change:next.u.label,cost:next.u.cost,purchases:next.u.detail.best?.purchases||[],steps:next.u.detail.best?.steps||[]})
    }
    if(options.includeConsumables){
      const drugs=await optimizePartyConsumables(ev,{...options,rounds:1},{stage:control.stage},players)
      if(!drugs.unchanged){players=drugs.players;steps.push(...drugs.changes.map(c=>({member:c.member,change:`${c.slot}：${c.before} → ${c.after}`,cost:0})))}
    }
    result=await ev.evaluate(players,options.target,24,REVIEW_SEEDS)
    const valid=accepts(result)&&compareEvaluations(result,current,options.objective).clearlyBetter
    attempts.push({day,valid,deathsPerHour:result.deathsPerHour,dailyProfit:result.profitMidpointPerHour*24})
    if(valid&&(!best||day<best.day))best={day,players,result,steps,spent,budgets}
    await control.checkpoint?.({kind:'goal',attempts,best})
  }
  if(accepts(direct)&&compareEvaluations(direct,current,options.objective).clearlyBetter)best={day:0,players:initial,result:direct,steps:[],spent:initial.map(()=>0),budgets:initial.map(p=>Number(options.budgets[String(p.id)]||0))}
  if(!best||resumed){
    for(const day of [...new Set([0,7,30,90,options.maxDays].filter(d=>d<=options.maxDays))].sort((a,b)=>a-b))await tryDay(day)
    // Probe each earlier coarse interval, without assuming a failed greedy search proves infeasibility.
    if(best){const upper=best.day;for(let day=1;day<upper;day+=Math.max(1,Math.floor(upper/12)))if(!attempts.some(a=>a.day===day))await tryDay(day)
      const end=best.day;for(let day=Math.max(0,end-7);day<end;day++)if(!attempts.some(a=>a.day===day))await tryDay(day)}
  }
  let finalCurrent=current
  if(best){
    control.stage('最终独立 8 次配对复核')
    const seeds=plannerSeeds(57401239,8)
    finalCurrent=await ev.evaluate(initial,currentTarget,24,seeds)
    const finalResult=await ev.evaluate(best.players,options.target,24,seeds)
    if(finalResult.deathsPerHour<=options.maxDeaths+1e-12&&compareEvaluations(finalResult,finalCurrent,options.objective).clearlyBetter)best.result=finalResult
    else {attempts.push({day:best.day,valid:false,reason:'最终独立复核未通过'});best=null}
  }
  return {kind:'goal',players:best?.players||initial,baseline:finalCurrent,result:best?.result||direct,found:Boolean(best),day:best?.day??null,steps:best?.steps||[],attempts,reviewHours:192,
    members:initial.map((p,i)=>({selected:p.selected,name:p.name,cash:Number(options.budgets[String(p.id)]||0),dailyIncome:daily[i],cost:best?.spent[i]??null,levels:best?.players[i].levels||p.levels})).filter(p=>p.selected),
    message:best?'搜索到的最早可行方案（启发式搜索，不保证全局最短）':'在当前预算、候选范围和天数内未找到通过复核的方案；不代表目标永远不可达。'}
}
export async function comparePartyBuilds(ev:PlannerEvaluator,options:PlannerOptions,control:PlannerControl,builds:any[],targets:PlannerTarget[],hours:number,checkpoint:any={}){
  const rows:any[]=[...(checkpoint?.rows||[])],selected=builds.length?builds:[{id:'baseline',name:'当前基准',players:ev.baseline.players}]
  const total=selected.length*targets.length
  for(const target of targets){
    const base=await ev.evaluate(ev.baseline.players,target,hours,REVIEW_SEEDS)
    for(const build of selected){
      const key=JSON.stringify([build.id,target]);if(rows.some(r=>r.key===key&&!r.error))continue
      const existing=rows.findIndex(r=>r.key===key);if(existing>=0)rows.splice(existing,1)
      control.stage(`方案批量对比 · ${rows.length+1}/${total} · ${build.name}`)
      try{if(build.gameDataVersion && build.gameDataVersion!==ev.baseline.gameDataVersion)throw new Error("方案游戏数据版本与基准不一致，请检查后重新保存");const result=await ev.evaluate(build.players,target,hours,REVIEW_SEEDS,build.settings||ev.baseline.settings);rows.push({key,buildId:build.id,name:build.name,target,result,delta:result[options.objective]-base[options.objective],statistics:compareEvaluations(result,base,options.objective)})}
      catch(error:any){if(error.name==='AbortError')throw error;rows.push({key,name:build.name,target,error:error.message})}
      await control.checkpoint?.({rows})
    }
  }
  return {kind:'batch',rows,total,message:'所有方案使用相同的 8 个种子；失败项可重试。'}
}
