import { createGuildTrialWorkerPayload, type GuildTrialSimulationResult } from "./guildTrialRunner"
import type { NativeGuildTrialMember } from "./guildTrialNative"
import { TRIAL_ENGINE_VERSION, RUST_TRIAL_IMPLEMENTATION_VERSION, JS_TRIAL_IMPLEMENTATION_VERSION } from "../shared/simulationVersion"
import upstream from "../guildTrialEngine/upstream.json"
import { simulationFingerprint, TrialOptimizationStorage } from "./trialOptimizationStorage"

type Job = { payload: any, resolve: (value: GuildTrialSimulationResult) => void, reject: (error: Error) => void }
type Slot = { worker: Worker, job?: Job, timer?: ReturnType<typeof setTimeout> }
export class TrialWorkerPool {
  private slots: Slot[] = []
  private queue: Job[] = []
  private stopped = false
  private sharedJobs=new Set<Job>()
  private inflight = new Map<string, Promise<GuildTrialSimulationResult>>()
  constructor(private count: number, private storage: TrialOptimizationStorage, private sharedRun?: (payload:any)=>Promise<GuildTrialSimulationResult>, private implementation: "auto" | "javascript" = "auto") {}
  private makeSlot(): Slot {
    const worker = new Worker(new URL("../guildTrialWorker.js", import.meta.url), { type: "module" })
    const slot: Slot = { worker }
    worker.onmessage = ({ data }) => {
      if (!slot.job || data.type === "guild_trial_progress") return
      const job = slot.job
      clearTimeout(slot.timer); slot.job = undefined
      if (data.type === "guild_trial_result") job.resolve(data.result)
      else job.reject(new Error(data.error || "试炼 Worker 返回无效结果"))
      this.dispatch()
    }
    worker.onerror = event => this.failSlot(slot, new Error(event.message || "试炼 Worker 失败"))
    return slot
  }
  private failSlot(slot: Slot, error: Error) {
    clearTimeout(slot.timer)
    slot.job?.reject(error); slot.job = undefined
    slot.worker.terminate()
    const index = this.slots.indexOf(slot)
    if (index >= 0) this.slots.splice(index,1)
    this.dispatch()
  }
  private dispatch() {
    if (this.stopped) return
    if(this.sharedRun){
      while(this.queue.length&&this.sharedJobs.size<Math.max(1,Math.min(8,this.count))){
        const job=this.queue.shift()!;this.sharedJobs.add(job)
        void this.sharedRun(job.payload).then(job.resolve,job.reject).finally(()=>{this.sharedJobs.delete(job);this.dispatch()})
      }
      return
    }
    try { while (this.slots.length < Math.max(1, Math.min(8,this.count))) this.slots.push(this.makeSlot()) }
    catch (error) {
      const reason=error instanceof Error ? error : new Error(String(error))
      for(const job of this.queue.splice(0))job.reject(reason)
      return
    }
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue
      slot.job = this.queue.shift()!
      slot.timer = setTimeout(() => this.failSlot(slot, new Error("试炼模拟超时")), 240_000)
      try { slot.worker.postMessage(slot.job.payload) }
      catch (error) { this.failSlot(slot, error instanceof Error ? error : new Error(String(error))) }
    }
  }
  async simulate(encounterHrid: string, members: NativeGuildTrialMember[], seed: number) {
    if (this.stopped) throw new DOMException("模拟已取消", "AbortError")
    const payload = createGuildTrialWorkerPayload(encounterHrid, members, seed)
    payload.engineImplementation = this.implementation
    const key = await simulationFingerprint({ implementation: this.implementation === "javascript" ? JS_TRIAL_IMPLEMENTATION_VERSION : RUST_TRIAL_IMPLEMENTATION_VERSION, engine: TRIAL_ENGINE_VERSION, data: upstream.workerSha256, payload })
    if (this.inflight.has(key)) return this.inflight.get(key)!
    const promise = (async () => {
      const cached = await this.storage.get<GuildTrialSimulationResult>("simulations", key)
      if (cached) return cached
      if (this.stopped) throw new DOMException("模拟已取消", "AbortError")
      const result = await new Promise<GuildTrialSimulationResult>((resolve, reject) => {
        this.queue.push({ payload, resolve, reject }); this.dispatch()
      })
      if (!result.fallbackReason) await this.storage.put("simulations", key, result)
      return result
    })()
    this.inflight.set(key, promise)
    try { return await promise } finally { this.inflight.delete(key) }
  }
  close() {
    this.stopped = true
    const error = new DOMException("模拟已取消", "AbortError")
    for (const job of this.sharedJobs) job.reject(error)
    this.sharedJobs.clear()
    for (const job of this.queue.splice(0)) job.reject(error)
    for (const slot of this.slots) {
      clearTimeout(slot.timer); slot.job?.reject(error); slot.worker.terminate()
    }
    this.slots = []
  }
}
