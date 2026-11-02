import { enginePreference } from "./enginePreference"
/** Shared by detached planner jobs. A cancelled simulation is never cached. */
type Job = { payload: any, weight:number, signal?: AbortSignal, resolve: (value: any) => void, reject: (error: Error) => void, abort?: () => void, progress?: (value:any)=>void }
type Slot = { worker: Worker, job?: Job, timer?: ReturnType<typeof setTimeout> }
export const computeAbort = () => new DOMException("计算已取消", "AbortError")
export class CombatComputePool {
  private slots: Slot[] = []
  private jobs: Job[] = []
  private idleTimer?: ReturnType<typeof setTimeout>
  constructor(private limit = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1))) {}
  run(payload: any, signal?: AbortSignal, progress?: (value:any)=>void): Promise<any> {
    if (signal?.aborted) return Promise.reject(computeAbort())
    return new Promise((resolve, reject) => {
      const hours=Number(payload.simulationTimeLimit||0)/3600e9
      const job: Job = { weight:Math.min(this.limit,hours>168?3:hours>72?2:1), payload:{...payload,engineImplementation:payload.engineImplementation || enginePreference.value}, signal, resolve, reject, progress }
      job.abort = () => {
        const slot = this.slots.find(s => s.job === job)
        this.jobs = this.jobs.filter(j => j !== job)
        if (slot) this.remove(slot)
        signal?.removeEventListener("abort", job.abort!)
        reject(computeAbort())
        this.pump()
      }
      signal?.addEventListener("abort", job.abort, { once: true })
      this.jobs.push(job)
      this.pump()
    })
  }
  private remove(slot: Slot) {
    clearTimeout(slot.timer)
    slot.worker.terminate()
    this.slots = this.slots.filter(s => s !== slot)
  }
  private finish(slot: Slot, result?: any, error?: Error) {
    const job = slot.job
    clearTimeout(slot.timer)
    slot.job = undefined
    job?.signal?.removeEventListener("abort", job.abort!)
    if (error) { this.remove(slot); job?.reject(error) } else job?.resolve(result)
    this.pump()
  }
  private pump() {
    clearTimeout(this.idleTimer)
    while (this.jobs.length) {
      // Long runs retain larger unit/statistics buffers; share the same bounded memory budget.
      const used=this.slots.reduce((sum,slot)=>sum+(slot.job?.weight||0),0)
      if(used+this.jobs[0].weight>this.limit)return
      let slot = this.slots.find(s => !s.job)
      if (!slot && this.slots.length < this.limit) {
        try {
          slot = { worker: new Worker(new URL("../computeWorker.ts", import.meta.url), { type: "module" }) }
          const owned = slot
          owned.worker.onmessage = ({ data }) => {
            if (data.type === "simulation_progress") owned.job?.progress?.(data)
            if (data.type === "simulation_result") this.finish(owned, data.simResult)
            if (data.type === "simulation_error") this.finish(owned, undefined, new Error(data.error?.message || "模拟失败"))
          }
          owned.worker.onerror = e => this.finish(owned, undefined, new Error(e.message || "Worker 运行失败"))
          this.slots.push(owned)
        } catch (e) {
          const jobs = this.jobs.splice(0)
          for (const job of jobs) { job.signal?.removeEventListener("abort", job.abort!); job.reject(e as Error) }
          return
        }
      }
      if (!slot) return
      slot.job = this.jobs.shift()!
      const owned = slot
      slot.timer = setTimeout(() => this.finish(owned, undefined, new Error("单次模拟超过 4 分钟，请缩短模拟时长")), 240_000)
      try { slot.worker.postMessage(slot.job.payload) } catch (e) { this.finish(slot, undefined, e as Error) }
    }
    // No retained workers once the whole queue is idle.
    if (this.slots.every(s => !s.job)) this.idleTimer = setTimeout(() => { for (const slot of [...this.slots]) if (!slot.job) this.remove(slot) }, 1000)
  }
}
export const combatComputePool = new CombatComputePool()

/** Worker-compatible facade for legacy clients; the actual workers share the queue above. */
export function createPooledCombatWorker(): Worker {
  let controller: AbortController | undefined
  let catalog: any
  const worker = {
    onmessage: null as ((event: any) => void) | null,
    onerror: null as ((event: any) => void) | null,
    postMessage(payload: any) {
      controller?.abort()
      controller = new AbortController()
      const current = controller
      catalog = payload.gameDataEnvelope || catalog
      void combatComputePool.run({ ...payload, gameDataEnvelope: catalog }, current.signal,
        data => { if (!current.signal.aborted) worker.onmessage?.({data}) })
        .then(simResult => { if (!current.signal.aborted) worker.onmessage?.({data:{type:'simulation_result',simResult}}) })
        .catch(error => { if (!current.signal.aborted) worker.onmessage?.({data:{type:'simulation_error',error:{message:error.message}}}) })
    },
    terminate() { controller?.abort() }
  }
  return worker as unknown as Worker
}
