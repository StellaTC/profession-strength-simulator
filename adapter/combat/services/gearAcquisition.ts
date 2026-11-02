import { itemDetailIndex as rawItemDetailIndex } from "../shared/gameDataIndex.js"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js"
import { buildRefinementIndex } from "./autoEquipmentUpgrade.js"
import { EnhanceCalculator, calculatePhilosopherEnhanceFlow } from "@/calculator/enhance"
import { getTeaIngredientList, withPlayerConfigOverride } from "@/common/apis/player"
import { createStellaEnhancingActionConfig, analyzeStellaCraftBaseCost } from "./stellaEquipmentCost"
import type { PricingSnapshot } from "./plannerEvaluation"
const itemDetailIndex = rawItemDetailIndex as Record<string, any>
export interface PurchaseLine { itemHrid: string; level: number; count: number; unitPrice: number }
export interface AcquisitionRoute { kind: string; cost: number; usedOwned: boolean; purchases: PurchaseLine[]; steps: string[] }
export interface OwnedGear { itemHrid: string; level: number }
export function gearQuote(pricing: PricingSnapshot, hrid: string, level = 0, side: "ask" | "bid" = "ask"): number | null {
  if (hrid === "/items/coin") return 1
  const raw = pricing.enhancementQuotesByItem?.[hrid]?.[String(level)]?.[side] ?? (level === 0 ? pricing.priceTable?.[hrid]?.[side] : undefined)
  const number = Number(raw)
  return raw != null && Number.isFinite(number) && number > 0 ? number : null
}
const line = (itemHrid:string,level:number,count:number,unitPrice:number):PurchaseLine => ({itemHrid,level,count,unitPrice})
function compact(route: AcquisitionRoute): AcquisitionRoute {
  const purchases = new Map<string,PurchaseLine>()
  for (const p of route.purchases) {
    const key=JSON.stringify([p.itemHrid,p.level,p.unitPrice]), previous=purchases.get(key)
    if (previous) previous.count+=p.count
    else purchases.set(key,{...p})
  }
  return {...route,purchases:[...purchases.values()],steps:[...new Set(route.steps)]}
}
function combine(kind: string, a: AcquisitionRoute, b: AcquisitionRoute, extra: PurchaseLine[] = []): AcquisitionRoute | null {
  if (a.usedOwned && b.usedOwned) return null
  return {kind,cost:a.cost+b.cost+extra.reduce((s,p)=>s+p.count*p.unitPrice,0),usedOwned:a.usedOwned||b.usedOwned,purchases:[...a.purchases,...b.purchases,...extra],steps:[...a.steps,...b.steps,kind]}
}
/** Stateful cost graph: the one owned item is a resource bit, never duplicated between branches. */
export class GearAcquisition {
  private memo = new Map<string, AcquisitionRoute[]>()
  private enhancementMemo = new Map<string, {cost:number,purchases:PurchaseLine[],step:string} | null>()
  private craftingMemo = new Map<string, AcquisitionRoute | null>()
  private refinements = buildRefinementIndex()
  readonly cap = (getRuntimeCombatGameData().maps.enhancementLevelSuccessRateTable || []).length || 20
  constructor(readonly pricing:PricingSnapshot,readonly tax=0.05,readonly owned?:OwnedGear) {
    if (!Number.isFinite(tax) || tax<0 || tax>=1) throw new Error("卖出税必须在 0～100% 之间")
    // An empty equipment slot has nothing to sell or consume.
    if (!owned?.itemHrid) this.owned = undefined
  }
  resale(hrid:string,level:number) { const price=gearQuote(this.pricing,hrid,level,"bid");return price==null?null:price*(1-this.tax) }
  private crafted(hrid: string): AcquisitionRoute | null {
    if (this.craftingMemo.has(hrid)) return this.craftingMemo.get(hrid)!
    const analysis = withPlayerConfigOverride(createStellaEnhancingActionConfig(), () => analyzeStellaCraftBaseCost(hrid, {
      ask: (item, level) => gearQuote(this.pricing, item, level) ?? -1,
      bid: (item, level) => gearQuote(this.pricing, item, level, "bid") ?? -1
    }, true))
    const result = analysis ? {
      kind: "Stella 制作估价", cost: analysis.cost, usedOwned: false,
      purchases: analysis.materials,
      steps: [`Stella 单步制作 ${hrid} 底子（固定制作配置，材料按市场快照；不含制作茶与人工）`]
    } : null
    this.craftingMemo.set(hrid, result)
    return result
  }
  private enhanced(hrid:string,from:number,to:number) {
    const key=`${hrid}:${from}:${to}`
    if(this.enhancementMemo.has(key))return this.enhancementMemo.get(key)!
    const item=itemDetailIndex[hrid]
    if(!item?.enhancementCosts?.length || to<=from)return null
    let best:{cost:number,purchases:PurchaseLine[],step:string}|null=null
    const materials=(item.enhancementCosts || []).map((x:any)=>({...x,price:gearQuote(this.pricing,x.itemHrid)}))
    if(materials.some((x:any)=>x.count>0&&x.price==null))return null
    const protectionRoutes = [...new Set([hrid,...(item.protectionItemHrids || []),"/items/mirror_of_protection"])]
      .map(h => { const price = gearQuote(this.pricing, String(h)); return price == null ? null : { cost: price, purchases: [line(String(h), 0, 1, price)] } })
      .filter((route): route is {cost:number,purchases:PurchaseLine[]} => route !== null)
    const craftedBase = this.crafted(hrid)
    if (craftedBase) protectionRoutes.push(craftedBase)
    const protection = protectionRoutes.sort((a,b) => a.cost-b.cost)[0]
    withPlayerConfigOverride(createStellaEnhancingActionConfig(),()=>{
      for(let protectLevel=1;protectLevel<=to;protectLevel++) {
        const calc=new EnhanceCalculator({hrid,originLevel:from,enhanceLevel:to,protectLevel})
        if(!calc.available)continue
        const {actions,protects}=calc.enhancelate()
        if(!Number.isFinite(actions)||actions<0||!Number.isFinite(protects)||protects<0||(protects>0&&!protection))continue
        const tea=getTeaIngredientList(calc).filter(x=>x.count>0).map(x=>({...x,price:gearQuote(this.pricing,x.hrid)}))
        if(tea.some(x=>x.price==null))continue
        const purchases:PurchaseLine[]=[...materials.filter((x:any)=>x.count>0).map((x:any)=>line(x.itemHrid,0,x.count*actions,x.price)),...tea.map(x=>line(x.hrid,0,x.count*actions,x.price!))]
        if(protects>0)purchases.push(...protection.purchases.map(p => ({...p,count:p.count*protects})))
        const cost=purchases.reduce((s,x)=>s+x.count*x.unitPrice,0)
        if(!best||cost<best.cost)best={cost,purchases,step:`Stella 强化 ${hrid} +${from} → +${to}，+${protectLevel} 起保护（期望消耗）`}
      }
    })
    this.enhancementMemo.set(key,best);return best
  }
  /** Same blessed-mirror expectation model as the existing Stella cost page. */
  private modeledMirror(hrid: string, level: number, bases: AcquisitionRoute[]): AcquisitionRoute | null {
    const mirror = gearQuote(this.pricing, "/items/philosophers_mirror")
    const base = bases.filter(r => !r.usedOwned).sort((a,b) => a.cost-b.cost)[0]
    if (level < 2 || mirror == null || !base) return null
    const materials = (itemDetailIndex[hrid]?.enhancementCosts || []).filter((m:any) => m.count > 0)
      .map((m:any) => ({...m, price: gearQuote(this.pricing,m.itemHrid)}))
    if (!materials.length || materials.some((m:any) => m.price == null)) return null
    const protections: AcquisitionRoute[] = [base]
    for (const h of new Set([...(itemDetailIndex[hrid].protectionItemHrids || []), '/items/mirror_of_protection'])) {
      const price = gearQuote(this.pricing,String(h))
      if (price != null) protections.push({kind:'保护品',cost:price,usedOwned:false,purchases:[line(String(h),0,1,price)],steps:[]})
    }
    const protection = protections.sort((a,b) => a.cost-b.cost)[0]
    return withPlayerConfigOverride(createStellaEnhancingActionConfig(), () => {
      let best: AcquisitionRoute | null = null
      for (let start=1; start<level; start++) for (let protect=1; protect<=start; protect++) {
        const flow = calculatePhilosopherEnhanceFlow({hrid,targetLevel:level,protectLevel:protect,philosopherProtectLevel:start,useBlessedInPhilosopher:true})
        if (!flow) continue
        const calc = new EnhanceCalculator({hrid,enhanceLevel:level,protectLevel:protect})
        const teas = getTeaIngredientList(calc).filter(t => t.count > 0).map(t => ({...t,price:gearQuote(this.pricing,t.hrid)}))
        if (teas.some(t => t.price == null)) continue
        const purchases = [
          ...base.purchases.map(p => ({...p,count:p.count*flow.baseItemCount})),
          ...materials.map((m:any) => line(m.itemHrid,0,m.count*flow.totalActions,m.price)),
          ...protection.purchases.map(p => ({...p,count:p.count*flow.protectionCount})),
          line('/items/philosophers_mirror',0,flow.mirrorCount,mirror),
          ...teas.map(t => line(t.hrid,0,t.count*flow.totalActions,t.price!))
        ].filter(p => p.count > 0)
        const cost = purchases.reduce((sum,p) => sum+p.count*p.unitPrice,0)
        if (Number.isFinite(cost) && (!best || cost<best.cost)) best = {kind:'Stella 混合强化估价',cost,usedOwned:false,purchases,
          steps:[...base.steps,`Stella 普通强化与贤者镜混合，+${protect} 起保护，+${start} 起使用贤者镜（包含福气概率与三种茶的期望消耗）`]}
      }
      return best
    })
  }
  routes(hrid:string,level:number,visiting=new Set<string>()):AcquisitionRoute[] {
    const key=`${hrid}:${level}`
    if(!itemDetailIndex[hrid]||!Number.isInteger(level)||level<0||level>this.cap)return []
    if(this.memo.has(key))return this.memo.get(key)!
    if(visiting.has(key))return []
    const seen=new Set(visiting).add(key), candidates:AcquisitionRoute[]=[]
    const ask=gearQuote(this.pricing,hrid,level)
    if(ask!=null)candidates.push({kind:"直接购买",cost:ask,usedOwned:false,purchases:[line(hrid,level,1,ask)],steps:[`购买 ${hrid} +${level}`]})
    if(this.owned?.itemHrid===hrid&&this.owned.level===level)candidates.push({kind:"使用已有装备",cost:0,usedOwned:true,purchases:[],steps:[`使用已有 ${hrid} +${level}`]})
    if (level === 0) { const crafted = this.crafted(hrid); if (crafted) candidates.push(crafted) }
    const ref=Array.from(this.refinements.values()).find((r:any)=>r.afterItemHrid===hrid) as any
    if(ref){
      const mats=(ref.inputItems||[]).filter((x:any)=>x.itemHrid!==ref.beforeItemHrid&&x.count>0).map((x:any)=>({hrid:x.itemHrid,count:x.count/ref.outputCount*0.89,price:gearQuote(this.pricing,x.itemHrid)}))
      if(mats.every((x:any)=>x.price!=null))for(const base of this.routes(ref.beforeItemHrid,level,seen))candidates.push({kind:"普通版精炼",cost:base.cost+mats.reduce((s:number,x:any)=>s+x.count*x.price,0),usedOwned:base.usedOwned,purchases:[...base.purchases,...mats.map((x:any)=>line(x.hrid,0,x.count,x.price))],steps:[...base.steps,`精炼为 ${hrid} +${level}（工匠茶材料系数 0.89）`]})
    }
    const mirror=gearQuote(this.pricing,"/items/philosophers_mirror")
    if(level>=2&&mirror!=null){
      for(const main of this.routes(hrid,level-1,seen))for(const padHrid of new Set([hrid,...(ref?[ref.beforeItemHrid]:[])]))for(const pad of this.routes(padHrid,level-2,seen)){
        const route=combine("贤者镜合成",main,pad,[line("/items/philosophers_mirror",0,1,mirror)])
        if(route)candidates.push(route)
      }
    }
    if(level>0){
      const modeled = this.modeledMirror(hrid,level,this.routes(hrid,0,seen))
      if (modeled) candidates.push(modeled)
      const starts=new Set([0,...(this.owned?.itemHrid===hrid&&this.owned.level<level?[this.owned.level]:[])])
      for(const start of starts){
        const enhancement=this.enhanced(hrid,start,level)
        if(enhancement)for(const base of this.routes(hrid,start,seen))candidates.push({kind:"自行强化",cost:base.cost+enhancement.cost,usedOwned:base.usedOwned,purchases:[...base.purchases,...enhancement.purchases],steps:[...base.steps,enhancement.step]})
      }
    }
    // Preserve the best route of each kind and ownership state for comparison and parents.
    const best=new Map<string,AcquisitionRoute>()
    for(const c of candidates){const id=`${c.kind}:${c.usedOwned}`;if(Number.isFinite(c.cost)&&(!best.has(id)||c.cost<best.get(id)!.cost))best.set(id,c)}
    const result=[...best.values()].map(compact);this.memo.set(key,result);return result
  }
  compare(hrid:string,level:number){
    if(!itemDetailIndex[hrid]||!Number.isInteger(level)||level<0||level>this.cap)throw new Error("装备或强化等级无效")
    const resale=this.owned?this.resale(this.owned.itemHrid,this.owned.level):0
    const routes=this.routes(hrid,level).map(r=>({...r,netCost:r.cost-(r.usedOwned?0:(resale||0)),resaleCredit:r.usedOwned?0:resale,missingResale:!r.usedOwned&&resale==null})).sort((a,b)=>a.netCost-b.netCost)
    return {routes,best:routes[0]||null,marketCapturedAt:this.pricing.sourceUpdatedAt,tax:this.tax,owned:this.owned,assumption:"买入使用卖价，转卖使用买价扣税；自行强化采用 Stella 参数的期望材料消耗。装备缺市场报价时仍可按 Stella 制作与强化模型估算；必要材料缺价且无可计算路线时不参与推荐。模型估价不代表实际成交价。"}
  }
}
