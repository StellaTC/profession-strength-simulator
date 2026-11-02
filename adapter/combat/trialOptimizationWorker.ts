import { TrialOptimizer } from "./optimizer/trialOptimizer"
import { TrialWorkerPool } from "./services/trialWorkerPool"
import { TrialOptimizationStorage } from "./services/trialOptimizationStorage"
let optimizer: TrialOptimizer | undefined
let pool: TrialWorkerPool | undefined
let nextRequest=0
const pending=new Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void}>()
const sharedRun=(payload:any)=>new Promise<any>((resolve,reject)=>{
  const requestId=++nextRequest;pending.set(requestId,{resolve,reject});self.postMessage({type:'compute',requestId,payload})
})
self.onmessage = async ({ data }) => {
  if(data.type==='compute_result'){
    const request=pending.get(data.requestId);pending.delete(data.requestId)
    if(data.error)request?.reject(Object.assign(new Error(data.error),{name:data.name||'Error'}));else request?.resolve(data.result)
    return
  }
  if (data.type === "pause") { optimizer?.pause(); return }
  if (data.type === "resume") { optimizer?.resume(); return }
  if (data.type === "cancel") { optimizer?.cancel(); pool?.close(); for(const request of pending.values())request.reject(new DOMException("模拟已取消","AbortError"));pending.clear();return }
  if (data.type !== "start" || optimizer) return
  const storage = new TrialOptimizationStorage(message => self.postMessage({ type: "warning", message }))
  pool = new TrialWorkerPool(Math.min(8, Math.max(1, Number(data.concurrency) || 4)), storage, sharedRun, data.input.engineImplementation || "auto")
  optimizer = new TrialOptimizer(data.input, pool, storage, progress => self.postMessage({ type: "progress", progress }))
  try { self.postMessage({ type: "result", result: await optimizer.run() }) }
  catch (error: any) { self.postMessage({ type: "error", message: error.message, name: error.name }) }
  finally { pool.close(); pending.clear(); await storage.close(); optimizer = undefined; pool = undefined }
}
