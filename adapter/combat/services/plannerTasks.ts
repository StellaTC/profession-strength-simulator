import { reactive } from "vue"
import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"
import { saveCloudHistory, listCloudHistory } from "@/services/cloudHistory"
import { useAuthStore } from "@/stores/auth"
import { SIMULATION_ENGINE_VERSION } from "../shared/simulationVersion.js"
import { copyCombatValue, combatWorkspaceOwner, validateParty, type SharedCombatBaseline, type PartyBuild } from "./combatWorkspaceState"
import { PlannerEvaluator, validateTarget, type PricingSnapshot, type PlannerTarget } from "./plannerEvaluation"
import { optimizePartyConsumables, planPartyUpgrades, planTargetGoal, comparePartyBuilds, type PlannerOptions } from "./combatPlanners"
export type PlannerKind = "consumables" | "goal" | "upgrades" | "batch"
export interface PlannerTask {
  schemaVersion:1; id:string; accountKey:string; kind:PlannerKind; createdAt:number; updatedAt:number
  status:"queued"|"running"|"paused"|"cancelled"|"failed"|"completed"
  stage:string; error?:string; baseline:SharedCombatBaseline; options:PlannerOptions; pricing:PricingSnapshot
  engineVersion:string; implementationVersion?:string; completedSimulations?:number; builds:PartyBuild[]; targets:PlannerTarget[]; hours:number
  algorithmVersion?:number; storageError?:string; cacheWarning?:string; syncStatus?:"pending"|"saved"|"failed"; syncError?:string
  checkpoint?:any; result?:any
}
const state=reactive({tasks:[] as PlannerTask[],loaded:[] as string[]})
const controllers=new Map<string,AbortController>(),loading=new Map<string,Promise<void>>(),writes=new Map<string,Promise<unknown>>()
let pumping=false
export function plannerTasks(owner:string){return state.tasks.filter(t=>t.accountKey===owner).sort((a,b)=>b.createdAt-a.createdAt)}
export async function loadPlannerTasks(owner:string){
  if(state.loaded.includes(owner))return
  if(!loading.has(owner))loading.set(owner,(async()=>{
    const rows=await getIndexedDbValue<PlannerTask[]>(`planner-tasks-v1:${owner}`)||[]
    for(const row of rows)if(row.schemaVersion===1&&row.accountKey===owner){
      if(row.status==='running'||row.status==='queued'){row.status='paused';row.stage='页面已刷新，可继续计算（已完成模拟会复用）'}
      state.tasks.push(row)
    }
    state.loaded.push(owner)
  })().finally(()=>loading.delete(owner)))
  await loading.get(owner)
}
async function persist(task:PlannerTask){
  task.updatedAt=Date.now()
  const rows=copyCombatValue(plannerTasks(task.accountKey)),key=`planner-tasks-v1:${task.accountKey}`
  const write=(writes.get(key)||Promise.resolve()).catch(()=>{}).then(()=>setIndexedDbValue(key,rows));writes.set(key,write);await write
  task.storageError=''
}
async function persistSafely(task:PlannerTask){
  try{await persist(task);return true}catch(error:any){task.storageError=`本机保存失败：${error.message||error}。请保留此页面并重试保存。`;return false}
}
export async function retryPlannerTaskSave(task:PlannerTask){return persistSafely(task)}
export async function syncPlannerTask(task:PlannerTask){
  if(task.status!=='completed'||task.accountKey==='guest'||combatWorkspaceOwner(useAuthStore().user?.id)!==task.accountKey)return
  task.syncStatus='pending';task.syncError=''
  const saved=await saveCloudHistory('planner-task',copyCombatValue(task))
  task.syncStatus=saved?'saved':'failed';task.syncError=saved?'':'云端同步失败，本机结果仍可查看，请重试同步。'
  await persistSafely(task)
}

export async function createPlannerTask(input:Omit<PlannerTask,'schemaVersion'|'id'|'createdAt'|'updatedAt'|'status'|'stage'|'engineVersion'>){
  if(input.baseline.accountKey!==input.accountKey)throw new Error('基准不属于当前账号')
  if(!['consumables','goal','upgrades','batch'].includes(input.kind))throw new Error('未知任务类型')
  validateParty(input.baseline.players)
  validateTarget(input.options.target)
  if(input.options.currentTarget?.hrid)validateTarget(input.options.currentTarget)
  for(const value of [...Object.values(input.options.budgets),...Object.values(input.options.otherIncome)])if(!Number.isFinite(value))throw new Error('预算或收入无效')
  if(Object.values(input.options.budgets).some(v=>v<0))throw new Error('现金不能为负数')
  if(!Number.isFinite(input.options.tax)||input.options.tax<0||input.options.tax>=1)throw new Error('税率无效')
  if(!Number.isFinite(input.options.maxDeaths)||input.options.maxDeaths<0)throw new Error('死亡阈值无效')
  if(!Number.isInteger(input.options.maxDays)||input.options.maxDays<0||input.options.maxDays>180)throw new Error('搜索范围必须是 0～180 天')
  if(![7,14,30,60,90,180].includes(input.options.horizon))throw new Error('规划天数无效')
  if(!Number.isFinite(input.hours)||input.hours<=0||input.hours>720)throw new Error('模拟时长无效')
  if(input.kind==='batch'){
    if(!input.builds.length||!input.targets.length||input.builds.length>100||input.targets.length>200)throw new Error('请选择方案与目标，最多 100 套方案 × 200 个目标')
    input.builds.forEach(b=>validateParty(b.players));input.targets.forEach(validateTarget)
  }
  await loadPlannerTasks(input.accountKey)
  const task:PlannerTask=reactive(copyCombatValue({...input,schemaVersion:1,id:crypto.randomUUID(),createdAt:Date.now(),updatedAt:Date.now(),status:'queued',stage:'等待计算',engineVersion:SIMULATION_ENGINE_VERSION,implementationVersion:"auto",algorithmVersion:2,completedSimulations:0}))
  state.tasks.unshift(task);if(await persistSafely(task))void pump();else{task.status='paused';task.stage='等待保存后继续'}return task
}
async function pump(){
  if(pumping)return;pumping=true
  try{for(;;){
    const task=state.tasks.find(t=>t.status==='queued');if(!task)break
    const controller=new AbortController();controllers.set(task.id,controller);task.status='running';task.error=''
    try{
      await persist(task)
      const ev=new PlannerEvaluator(task.baseline,task.pricing,controller.signal,()=>{task.completedSimulations=(task.completedSimulations||0)+1},message=>{task.cacheWarning=message})
      const control={resume:task.checkpoint?copyCombatValue(task.checkpoint):undefined,stage:(text:string)=>{task.stage=text},checkpoint:async(value:any)=>{task.checkpoint=copyCombatValue(value);await persist(task)}}
      if(task.kind==='consumables')task.result=await optimizePartyConsumables(ev,task.options,control)
      else if(task.kind==='goal')task.result=await planTargetGoal(ev,task.options,control)
      else if(task.kind==='upgrades')task.result=await planPartyUpgrades(ev,task.options,control)
      else task.result=await comparePartyBuilds(ev,task.options,control,task.builds,task.targets,task.hours,task.checkpoint)
      task.implementationVersion=(task.result?.result?.implementationVersions||task.result?.rows?.flatMap((r:any)=>r.result?.implementationVersions||[])||['javascript']).filter((v:string,i:number,a:string[])=>a.indexOf(v)===i).join(',');task.status='completed';task.stage='计算完成'
    }catch(error:any){
      if(error.name!=='AbortError'){task.status='failed';task.error=error.message||String(error);task.stage='计算失败'}
      else if(task.status==='running'){task.status='cancelled';task.stage='已取消'}
    }finally{controllers.delete(task.id);await persistSafely(task)}
    if(task.status==='completed')void syncPlannerTask(task)
  }}finally{pumping=false}
}
export async function stopPlannerTask(task:PlannerTask,pause=false){
  if(!['queued','running'].includes(task.status))return
  task.status=pause?'paused':'cancelled';task.stage=pause?'已暂停，可继续计算':'已取消';controllers.get(task.id)?.abort();await persistSafely(task)
}
export async function resumePlannerTask(task:PlannerTask){
  if(controllers.has(task.id))throw new Error('正在停止计算，请稍候')
  if(task.engineVersion!==SIMULATION_ENGINE_VERSION)throw new Error('引擎规则版本已更新，请创建新任务')
  if(task.algorithmVersion!==2){task.checkpoint=undefined;task.result=undefined;task.algorithmVersion=2}
  task.status='queued';task.error='';task.stage='等待继续计算';if(await persistSafely(task))void pump();else{task.status='paused';task.stage='等待保存后继续'}
}
export async function fetchCloudPlannerTasks(){return listCloudHistory<PlannerTask>('planner-task',true)}
export async function restoreCloudPlannerTask(task:PlannerTask,owner:string){
  if(owner==='guest'||task.accountKey!==owner)throw new Error('历史记录不属于当前账号')
  await loadPlannerTasks(owner)
  if(!state.tasks.some(t=>t.id===task.id)){state.tasks.push(copyCombatValue(task));await persist(task)}
}
