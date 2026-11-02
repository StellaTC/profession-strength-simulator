import { enginePreference } from "./enginePreference"
import { combatComputePool } from "./combatComputePool"
import type { TrialSearchInput } from "../optimizer/trialCandidates"
import type { TrialSearchProgress, TrialSearchResult } from "../optimizer/trialOptimizer"
export function startTrialOptimization(input: TrialSearchInput, options: {
  signal?: AbortSignal, onProgress: (value: TrialSearchProgress) => void, onWarning: (message: string) => void, concurrency?: number,
}) {
  const worker = new Worker(new URL("../trialOptimizationWorker.ts", import.meta.url), { type: "module" })
  const controller=new AbortController()
  const cancel = () => { controller.abort(); worker.postMessage({ type: "cancel" }) }
  let timeout: ReturnType<typeof setTimeout> | undefined
  const result = new Promise<TrialSearchResult>((resolve, reject) => {
    const finish = () => { controller.abort(); clearTimeout(timeout); options.signal?.removeEventListener("abort", abort); worker.terminate() }
    const abort = () => {
      cancel()
      // Give the controller time to flush completed candidates before terminating.
      timeout = setTimeout(() => { finish(); reject(new DOMException("阵容优化已取消", "AbortError")) }, 5000)
    }
    if (options.signal?.aborted) { finish(); reject(new DOMException("阵容优化已取消", "AbortError")); return }
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onmessage = ({ data }) => {
      if(data.type==='compute'){
        void combatComputePool.run(data.payload,controller.signal).then(result=>{
          if(!controller.signal.aborted)worker.postMessage({type:'compute_result',requestId:data.requestId,result})
        }).catch(error=>{worker.postMessage({type:'compute_result',requestId:data.requestId,error:error.message,name:error.name})})
      }
      else if (data.type === "progress") options.onProgress(data.progress)
      else if (data.type === "warning") options.onWarning(data.message)
      else if (data.type === "result") { finish(); resolve(data.result) }
      else if (data.type === "error") { finish(); reject(Object.assign(new Error(data.message), { name: data.name })) }
    }
    worker.onerror = event => { finish(); reject(new Error(event.message || "优化控制 Worker 失败")) }
    worker.postMessage({ type: "start", input: JSON.parse(JSON.stringify({...input,engineImplementation:enginePreference.value})), concurrency: options.concurrency || Math.min(8, navigator.hardwareConcurrency || 4) })
  })
  return { result, pause: () => worker.postMessage({ type: "pause" }), resume: () => worker.postMessage({ type: "resume" }), cancel }
}
