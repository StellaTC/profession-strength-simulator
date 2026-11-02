import { RUST_TRIAL_IMPLEMENTATION_VERSION, JS_TRIAL_IMPLEMENTATION_VERSION } from "../shared/simulationVersion"
import { PythonRandom } from "./pythonRandom"
import { rosterLevel, rosterSizeRepresentatives, perturbedStarts, natureTransfers } from "./trialInitialCandidates"
import { guildTrialMemberProfession } from "../services/guildTrialNative"
import { TRIAL_ENGINE_VERSION, OPTIMIZER_VERSION } from "../shared/simulationVersion"
import upstream from "../guildTrialEngine/upstream.json"
import { mean, standardError, summarizeSamples, pairedSamples, meaningfulTrialGain } from "../shared/simulationStatistics"
import { simulationFingerprint, TrialOptimizationStorage } from "../services/trialOptimizationStorage"
import type { GuildTrialSimulationResult } from "../services/guildTrialRunner"
import {
  candidate, legalCandidate, rosterNeighbors, skillNeighbors, fairNeighbors, uniqueCandidates,
  candidateDistance, adaptiveNeighbors, withRole, recommendedCandidate, jointSkillNeighbors, healingCandidates, trialBossSlug, type TrialCandidate, type TrialSearchInput,
} from "./trialCandidates"

/** Upstream entry.py standard defaults at 8805f411; browser runtime is versioned separately. */
export const TRIAL_SEARCH_CONFIG = Object.freeze({
  baselineSeeds: 30, searchLooks: [3, 5, 8, 10], refineSeeds: 10, tier3Seeds: 20,
  finalSeeds: 30, initialBase: 600, initialMaximum: 1200, perMember: 12,
  eliteCount: 12, tier3Rounds: 1, neighborLimit: 12, finalistLimit: 4,
  healingRounds: 5, healingTopK: 3, insanityStep: 3, insanityMinimumFraction: 0.4,
})
export interface TrialEvaluation {
  candidate: TrialCandidate
  seeds: number[]
  samples: number[]
  bossSamples: [number[], number[]]
  results: [GuildTrialSimulationResult, GuildTrialSimulationResult]
  metrics: ReturnType<typeof summarizeSamples>
  status: "screening" | "validated"
  baselineDifference?: ReturnType<typeof pairedSamples>
}
export interface TrialSearchProgress {
  stage: string, completed: number, total: number, simulations: number,
  top: TrialEvaluation[], paused: boolean, fingerprint: string, restored: number,
}
export interface TrialSearchResult {
  fingerprint: string, engineVersion: string, algorithmVersion: string, referenceCommit: string,
  baseline: TrialEvaluation, selected: TrialEvaluation, finalists: TrialEvaluation[], adopted: boolean,
}
export interface TrialSimulator {
  simulate(encounter: string, members: TrialCandidate["members"], seed: number): Promise<GuildTrialSimulationResult>
}
export function rankEvaluations(a: TrialEvaluation, b: TrialEvaluation) {
  return b.metrics.mean - a.metrics.mean || b.metrics.cvar10 - a.metrics.cvar10
    || a.metrics.standardError - b.metrics.standardError || a.candidate.key.localeCompare(b.candidate.key)
}
export async function trialSeedSeries(trialSetKey: string, namespace: string, count: number) {
  // Upstream hashes the raw UTF-8 string, not JSON.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`2.3.0:${trialSetKey}:${namespace}`))
  const base = new DataView(digest).getUint32(0, false)
  return Array.from({ length: count }, (_, i) => (base + Math.imul(i + 1, 0x9e3779b9)) >>> 0)
}
export async function trialTaskFingerprint(input: TrialSearchInput) {
  return simulationFingerprint({ input, implementation: input.engineImplementation === "javascript" ? JS_TRIAL_IMPLEMENTATION_VERSION : RUST_TRIAL_IMPLEMENTATION_VERSION, engine: TRIAL_ENGINE_VERSION, algorithm: OPTIMIZER_VERSION,
    data: upstream.workerSha256, config: TRIAL_SEARCH_CONFIG })
}
function averageResults(results: GuildTrialSimulationResult[]): GuildTrialSimulationResult {
  const output = structuredClone(results[0])
  for (const key of ["points", "layersCompleted", "currentLevel", "totalDamage", "simulatedSeconds", "completedFloorPoints", "partialFloorPoints", "currentFloorProgress"] as const) {
    if (results.every(r => typeof r[key] === "number")) output[key] = mean(results.map(r => r[key] as number))
  }
  const names = new Set(results.flatMap(r => Object.keys(r.templateStats)))
  output.templateStats = {}
  for (const name of names) {
    const rows = results.map(r => r.templateStats[name]).filter(Boolean)
    output.templateStats[name] = Object.fromEntries(Object.keys(rows[0]).map(key => [key, mean(rows.map(row => Number(row[key as keyof typeof row]) || 0))])) as any
  }
  const memberIds = new Set(results.flatMap(r=>(r.memberStats||[]).map(m=>m.characterId)))
  output.memberStats = [...memberIds].map(characterId => {
    const rows = results.flatMap(r=> { const m=r.memberStats?.find(m=>m.characterId===characterId);return m ? [{...m,dps:m.damage/Math.max(1,r.simulatedSeconds)}]:[] })
    return { ...Object.fromEntries(Object.keys(rows[0]).filter(k=>k!=="characterId"&&typeof (rows[0] as any)[k]==="number").map(k=>[k,mean(rows.map(row=>(row as any)[k]))])), characterId } as any
  })
  output.implementationVersions = [...new Set(results.flatMap(r => r.implementationVersions || [r.implementationVersion || "legacy"]))]
  output.implementationVersion = output.implementationVersions.length === 1 ? output.implementationVersions[0] : "mixed"
  const fallbacks = [...new Set(results.map(r=>r.fallbackReason).filter(Boolean))]
  if (fallbacks.length) output.fallbackReason = fallbacks.join("; ")
  output.runs = results.length
  output.validationStatus = results.length === 30 ? "validated" : "screening"
  output.seed = undefined
  return output
}
export class TrialOptimizer {
  private paused = false
  private cancelled = false
  private wake: (() => void) | undefined
  private fingerprint = ""
  private simulations = 0
  private restored = 0
  private stage = "baseline"
  private completed = 0
  private total = 0
  private top: TrialEvaluation[] = []
  private neighborhoodStats: Record<string,{generated:number,qualified:number}> = {}
  private memo = new Map<string, Promise<TrialEvaluation>>()
  constructor(private input: TrialSearchInput, private simulator: TrialSimulator, private storage: TrialOptimizationStorage,
    private progress: (value: TrialSearchProgress) => void = () => {}) {}
  pause() { this.paused = true; this.emit() }
  resume() { this.paused = false; this.wake?.(); this.wake = undefined; this.emit() }
  cancel() { this.cancelled = true; this.resume() }
  private emit() {
    this.progress({ stage: this.stage, completed: this.completed, total: this.total, simulations: this.simulations,
      top: this.top.slice(0, 10), paused: this.paused, fingerprint: this.fingerprint, restored: this.restored })
  }
  private async boundary() {
    if (this.cancelled) throw new DOMException("已取消，已完成候选已保存", "AbortError")
    if (this.paused) await new Promise<void>(resolve => { this.wake = resolve })
    if (this.cancelled) throw new DOMException("已取消，已完成候选已保存", "AbortError")
  }
  private async evaluate(value: TrialCandidate, seeds: number[]): Promise<TrialEvaluation> {
    await this.boundary()
    if (!legalCandidate(value, this.input)) throw new Error("优化器拒绝不符合页面规则的候选")
    const key = await simulationFingerprint({ fingerprint: this.fingerprint, candidate: value.key, seeds })
    if (this.memo.has(key)) return this.memo.get(key)!
    const computation = (async () => {
      const checkpoint = await this.storage.get<TrialEvaluation>("checkpoints", key)
      if (checkpoint) { this.restored++; return checkpoint }
      const bySeed: Array<[GuildTrialSimulationResult, GuildTrialSimulationResult]> = []
      // Only one candidate is committed at a time. Seeds and bosses are queued in a fixed order;
      // worker completions occupy their original slots in Promise.all.
      for (let offset = 0; offset < seeds.length; offset += 4) {
        await this.boundary()
        const chunk = await Promise.all(seeds.slice(offset, offset + 4).map(async seed =>
          await Promise.all(value.teams.map(team => this.simulator.simulate(team.encounterHrid,
            team.memberIds.map(id => value.members.find(m => m.characterId === id)!), seed))) as [GuildTrialSimulationResult, GuildTrialSimulationResult]))
        bySeed.push(...chunk); this.simulations += chunk.length * 2
        this.emit()
      }
      const bossSamples = [bySeed.map(r => r[0].points), bySeed.map(r => r[1].points)] as [number[], number[]]
      const samples = seeds.map((_, i) => bossSamples[0][i] + bossSamples[1][i])
      const metrics = summarizeSamples(samples)
      // Upstream total SE is the quadrature of the two per-boss SEs.
      metrics.standardError = Math.hypot(...bossSamples.map(standardError))
      metrics.confidenceInterval = [metrics.mean - 1.96 * metrics.standardError, metrics.mean + 1.96 * metrics.standardError]
      const result: TrialEvaluation = { candidate: value, seeds, samples, bossSamples, metrics,
        results: [averageResults(bySeed.map(r => r[0])), averageResults(bySeed.map(r => r[1]))],
        status: "screening" }
      await this.storage.put("checkpoints", key, result)
      return result
    })()
    this.memo.set(key, computation)
    try { return await computation } catch (error) { this.memo.delete(key); throw error }
  }
  private async batch(stage: string, candidates: TrialCandidate[], seeds: number[]) {
    this.stage = stage; this.completed = 0
    const values = uniqueCandidates(candidates).filter(c => legalCandidate(c, this.input))
    this.total = values.length; this.top = []; this.emit()
    const result: TrialEvaluation[] = []
    for (const value of values) {
      await this.boundary()
      result.push(await this.evaluate(value, seeds))
      this.completed++; this.top = [...result].sort(rankEvaluations).slice(0, 10)
      await this.storage.put("checkpoints", `${this.fingerprint}:progress`, { stage, completed: this.completed, total: this.total, top: this.top })
      this.emit()
    }
    return result.sort(rankEvaluations)
  }
  private competitive(values: TrialEvaluation[], ratio: number, minimum: number, maximum = 120) {
    const ranked = [...values].sort(rankEvaluations)
    if (!ranked.length) return []
    const target = Math.min(ranked.length, maximum, Math.max(minimum, Math.ceil(ranked.length * ratio)))
    const cutoff = ranked[target - 1]
    return ranked.filter(value => !pairedSamples(value.samples, cutoff.samples, 4).clearlyWorse).slice(0, maximum)
  }
  private diverse(values: TrialEvaluation[]) {
    const remaining = [...new Map(values.map(v=>[v.candidate.key,v])).values()].sort(rankEvaluations), selected: TrialEvaluation[] = []
    if (remaining.length) selected.push(remaining.shift()!)
    while (remaining.length && selected.length < TRIAL_SEARCH_CONFIG.eliteCount) {
      remaining.sort((a, b) => Math.min(...selected.map(s => candidateDistance(b.candidate, s.candidate)))
        - Math.min(...selected.map(s => candidateDistance(a.candidate, s.candidate))) || rankEvaluations(a, b))
      selected.push(remaining.shift()!)
    }
    return selected
  }
  private async healing(parent: TrialCandidate, seeds: number[]) {
    let current = await this.evaluate(parent, seeds)
    for (let round = 0; round < TRIAL_SEARCH_CONFIG.healingRounds; round++) {
      const damage = current.results.map(result=>Object.fromEntries((result.memberStats||[]).map(m=>[m.characterId,m.dps||m.damage/Math.max(1,result.simulatedSeconds)])))
      const values = healingCandidates(current.candidate, this.input, damage, TRIAL_SEARCH_CONFIG.healingTopK)
      const reviewed = await this.batch("healing", [current.candidate, ...values], seeds)
      const best = reviewed[0]
      if (!best || best.candidate.key === current.candidate.key || rankEvaluations(best,current) >= 0) break
      current = best
    }
    return current.candidate
  }
  private async insanity(parent: TrialCandidate, screenSeeds: number[], raceSeeds: number[]) {
    let current = parent
    for (let teamIndex = 0; teamIndex < 2; teamIndex++) {
      const baseline = await this.evaluate(current, screenSeeds)
      const team = current.teams[teamIndex]
      const order = team.memberIds.filter(id => {
        const m = current.members.find(x => x.characterId === id)!
        return !m.assignedAuraHrid && m.abilities.some(a => a.abilityHrid === "/abilities/revive")
      }).sort((a, b) => {
        const ma = current.members.find(m => m.characterId === a)!, mb = current.members.find(m => m.characterId === b)!
        return (baseline.results[teamIndex].memberStats?.find(m=>m.characterId===b)?.dps ?? baseline.results[teamIndex].templateStats[mb.characterName]?.damage ?? 0)
          - (baseline.results[teamIndex].memberStats?.find(m=>m.characterId===a)?.dps ?? baseline.results[teamIndex].templateStats[ma.characterName]?.damage ?? 0) || a - b
      })
      const maximum = Math.max(0,order.length-2)
      if (!maximum) continue
      const positions = new Set([0, maximum])
      for (let n = Math.min(maximum, Math.max(3, Math.ceil(maximum * 0.4))); n <= maximum; n += 3) positions.add(n)
      const atPosition = (n: number) => {
        let value = current
        for (const id of order.slice(0, n)) value = withRole(value, id, "/abilities/insanity", `insanity:${n}`)
        return value
      }
      let screened = (await this.batch("insanity_screen", [...positions].filter(n=>n>0).sort((a, b) => a - b).map(atPosition), screenSeeds))
        .filter(v=>!pairedSamples(v.samples,baseline.samples).clearlyWorse)
      const extra = new Set<number>()
      for (const value of screened.filter(v=>!pairedSamples(v.samples,screened[0].samples).clearlyWorse).slice(0,3)) {
        const n = Number(value.candidate.mutation.split(":")[1]) || 0
        for (const next of [n - 1, n + 1]) if (next > 0 && next <= maximum && !positions.has(next)) extra.add(next)
      }
      screened = [...screened, ...await this.batch("insanity_neighbors", [...extra].sort((a, b) => a - b).map(atPosition), screenSeeds)].sort(rankEvaluations)
      const reviewed = await this.batch("insanity", [current, ...this.competitive(screened, 0.1, 3).map(v => v.candidate)], raceSeeds)
      const anchor=reviewed.find(v=>v.candidate.key===current.key)!
      current=reviewed.filter(v=>!pairedSamples(v.samples,anchor.samples).clearlyWorse).sort(rankEvaluations)[0]?.candidate || current
    }
    for(const [index,team] of current.teams.entries()) {
      if(trialBossSlug(team.encounterHrid)!=="swarm") continue
      const evaluated=await this.evaluate(current,raceSeeds)
      const water=current.members.filter(m=>team.memberIds.includes(m.characterId)&&guildTrialMemberProfession(m).key==="water")
        .sort((a,b)=>(evaluated.results[index].memberStats?.find(m=>m.characterId===b.characterId)?.dps||0)-(evaluated.results[index].memberStats?.find(m=>m.characterId===a.characterId)?.dps||0)||a.characterId-b.characterId).slice(0,10)
      for(const member of water)if(!member.assignedAuraHrid&&member.abilities[0]?.abilityHrid==="/abilities/revive"){
        const next=withRole(current,member.characterId,"/abilities/insanity","swarm_top10_water_revive_to_insanity")
        if(legalCandidate(next,this.input)) current=next
      }
    }
    return current
  }
  async run(): Promise<TrialSearchResult> {
    this.fingerprint = await trialTaskFingerprint(this.input)
    const original = candidate(this.input.teams, this.input.members)
    if (!legalCandidate(original, this.input)) throw new Error("初始阵容不符合当前成员、锁定或参数规则")
    const finished = await this.storage.get<TrialSearchResult>("checkpoints", `${this.fingerprint}:result`)
    if (finished) return finished
    const seeds = await Promise.all([
      trialSeedSeries(this.input.trialSetKey, "baseline", 30), trialSeedSeries(this.input.trialSetKey, "search_paired", 10),
      trialSeedSeries(this.input.trialSetKey, "refine", 10), trialSeedSeries(this.input.trialSetKey, "tier3", 20),
      trialSeedSeries(this.input.trialSetKey, "final_paired", 30),
    ])
    await this.batch("baseline", [original], seeds[0])
    const budget = Math.min(1200, Math.max(600, this.input.members.filter(m => m.selected).length * 12))
    const random = new PythonRandom(BigInt("0x"+(await simulationFingerprint({trialSetKey:this.input.trialSetKey,version:"2.3.0"})).slice(0,16)))
    const seedCandidate=await this.healing(recommendedCandidate(original,this.input),seeds[1].slice(0,3))
    const moves=rosterNeighbors(seedCandidate,this.input),swaps=rosterNeighbors(seedCandidate,this.input,"swap")
    const marginal=[seedCandidate,...moves].sort((a,b)=>rosterLevel(b)-rosterLevel(a)||(a.key<b.key?1:-1))[0]
    const randomBaseline=perturbedStarts(seedCandidate,this.input,random,1)[0]||seedCandidate
    const initial=fairNeighbors(seedCandidate,[[original,marginal,randomBaseline],rosterSizeRepresentatives(seedCandidate,this.input),
      perturbedStarts(seedCandidate,this.input,random),natureTransfers(seedCandidate,this.input),moves,swaps,skillNeighbors(seedCandidate,this.input,"aura")],budget)
    let ranked = await this.batch("initial", [original, ...initial], seeds[1].slice(0, 3))
    if (ranked.length > 12) {
      const promotionTarget = Math.min(120, Math.max(12, Math.ceil(ranked.length * 0.1)))
      const promoted: TrialCandidate[] = []
      let pending = ranked
      for (const look of [5, 8, 10]) {
        const raced = await this.batch(`initial_race_${look}`, uniqueCandidates([original, ...pending.map(v => v.candidate)]), seeds[1].slice(0, look))
        const anchor = raced.find(v => v.candidate.key === original.key)!
        const cutoff = raced[Math.min(promotionTarget, raced.length) - 1]
        pending = []
        for (const value of raced) {
          const comparison = pairedSamples(value.samples, cutoff.samples, 4)
          if (comparison.clearlyWorse) continue
          if (comparison.clearlyBetter && !pairedSamples(value.samples, anchor.samples, 4).clearlyWorse) promoted.push(value.candidate)
          else pending.push(value)
        }
      }
      ranked = (await this.batch("initial_promoted", [original, ...promoted, ...pending.map(v => v.candidate)], seeds[1])).slice(0,promotionTarget)
    }
    const shortlist = ranked.slice(0, Math.min(120, Math.max(12, Math.ceil(ranked.length * 0.2)))).map(v => v.candidate)
    const baseline = await this.healing(original, seeds[2])
    const best = await this.healing(ranked[0]?.candidate || original, seeds[2])
    const refineCandidates = uniqueCandidates([best, baseline, ...shortlist].flatMap(parent => [parent,
      ...[...rosterNeighbors(parent,this.input),...rosterNeighbors(parent,this.input,"swap"),...jointSkillNeighbors(parent,this.input)].slice(0,11)]))
    ranked = await this.batch("refine_screen", refineCandidates, seeds[2].slice(0, 3))
    ranked = await this.batch("refine_race", [baseline, ...this.competitive(ranked, 0.2, 12).map(v => v.candidate)], seeds[2])
    let elites = this.diverse(ranked)
    for (let round = 0; round < TRIAL_SEARCH_CONFIG.tier3Rounds; round++) {
      const neighbors = elites.flatMap(v => [v.candidate, ...adaptiveNeighbors(v.candidate, rosterNeighbors(v.candidate, this.input),12,this.neighborhoodStats)])
      for(const value of neighbors){const key=value.mutation.split(":")[0];const stats=this.neighborhoodStats[key] ||= {generated:0,qualified:0};stats.generated++}
      const screened = await this.batch("tier3_screen", [baseline, ...neighbors], seeds[1].slice(0, 3))
      const raced = await this.batch("tier3_race", [baseline, ...this.competitive(screened, 0.1, 12).map(v => v.candidate)], seeds[2])
      const reviewed = await this.batch("tier3", [baseline, ...this.diverse(raced).map(v => v.candidate)], seeds[3])
      for(const value of reviewed){const key=value.candidate.mutation.split(":")[0];const stats=this.neighborhoodStats[key] ||= {generated:0,qualified:0};stats.qualified++}
      elites = this.diverse([...elites,...reviewed])
    }
    const variants=(parent:TrialCandidate)=>adaptiveNeighbors(parent,[parent,
      ...skillNeighbors(parent,this.input,"aura"),...natureTransfers(parent,this.input),...skillNeighbors(parent,this.input,"role"),...skillNeighbors(parent,this.input,"profession")],12,this.neighborhoodStats)
    const skillCandidates = elites.flatMap(v=>variants(v.candidate))
    const skills = await this.batch("skill_screen", skillCandidates, seeds[2])
    ranked = await this.batch("skill_refine", this.diverse([...elites,...skills]).map(v=>v.candidate), seeds[3])
    const winner=ranked[0]?.candidate || baseline
    const feedback=uniqueCandidates([...rosterNeighbors(winner,this.input),...rosterNeighbors(winner,this.input,"swap")]).slice(0,450)
    const feedbackScreen=await this.batch("feedback_screen",feedback,seeds[1].slice(0,3))
    const feedbackSkills=await this.batch("feedback_race",feedbackScreen.slice(0,12).flatMap(v=>variants(v.candidate)),seeds[2])
    const feedbackFinal=await this.batch("feedback",this.diverse([await this.evaluate(winner,seeds[3]),...feedbackSkills]).map(v=>v.candidate),seeds[3])
    ranked=this.diverse([...ranked,...feedbackFinal]).sort(rankEvaluations)
    const finalists: TrialCandidate[] = [original]
    for (const source of [baseline, ...ranked.filter(v => v.candidate.key !== baseline.key).slice(0, 4).map(v => v.candidate)]) {
      let value = await this.healing(source, seeds[2])
      value = await this.insanity(value, seeds[1].slice(0, 3), seeds[2])
      value = await this.healing(value, seeds[2])
      finalists.push(value)
    }
    const final = await this.batch("final", finalists, seeds[4])
    const anchor = final.find(v => v.candidate.key === original.key)!
    for (const value of final) { value.status = "validated"; value.baselineDifference = pairedSamples(value.samples, anchor.samples) }
    const selected = final.filter(value => meaningfulTrialGain(value.samples, anchor.samples)).sort(rankEvaluations)[0] || anchor
    const result: TrialSearchResult = { fingerprint: this.fingerprint, engineVersion: TRIAL_ENGINE_VERSION,
      algorithmVersion: OPTIMIZER_VERSION, referenceCommit: upstream.commit, baseline: anchor,
      selected, finalists: final, adopted: selected.candidate.key !== anchor.candidate.key }
    await this.storage.put("checkpoints", `${this.fingerprint}:result`, result)
    await this.storage.put("checkpoints", `latest:${this.input.historyScope || "default"}`, { input: this.input, result })
    this.top = final; this.stage = "complete"; this.emit()
    return result
  }
}
