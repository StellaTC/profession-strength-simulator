/** Pinned reference model/metrics.py: sample SE and one-sided alpha spending. */
export const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
export function standardError(values: number[]) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1) / values.length)
}
export function sequentialInterval(values: number[], lookCount = 4): [number, number] {
  if (values.length < 2) return [-Infinity, Infinity]
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  if (variance <= 1e-12) return [average, average]
  const criticalNormals = [0, 1.6448536269514715, 1.9599639845400534, 2.1280452341849836, 2.2414027276049464, 2.3263478740408408]
  if (!Number.isInteger(lookCount) || lookCount < 1 || lookCount > 5) throw new Error("Unsupported sequential look count")
  const z = criticalNormals[lookCount], z2 = z * z, degrees = values.length - 1
  const critical = z + (z * z2 + z) / (4 * degrees)
    + (5 * z * z2 * z2 + 16 * z * z2 + 3 * z) / (96 * degrees ** 2)
    + (3 * z * z2 ** 3 + 19 * z * z2 * z2 + 17 * z * z2 - 15 * z) / (384 * degrees ** 3)
  const delta = critical * Math.sqrt(variance / values.length)
  return [average - delta, average + delta]
}
export function summarizeSamples(values: number[]) {
  const average = mean(values), error = standardError(values)
  const worst = [...values].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(values.length * 0.1)))
  return { mean: average, standardError: error, cvar10: mean(worst),
    confidenceInterval: [average - 1.96 * error, average + 1.96 * error] as [number, number], runs: values.length }
}
export function pairedSamples(candidate: number[], baseline: number[], lookCount = 1) {
  if (candidate.length !== baseline.length) throw new Error("Paired samples must have equal lengths")
  const differences = candidate.map((value, index) => value - baseline[index])
  const interval = sequentialInterval(differences, lookCount)
  return { runs: differences.length, meanDifference: mean(differences), interval,
    clearlyBetter: interval[0] > 1e-9, clearlyWorse: interval[1] < -1e-9 }
}
export function meaningfulTrialGain(candidate: number[], baseline: number[]) {
  if (candidate.length !== 30 || baseline.length !== 30) return false
  return pairedSamples(candidate, baseline).interval[0] > Math.max(10, mean(baseline) * 0.002) + 1e-9
}
export function reviewSeedSchedule(seedBase: number, totalHours: number) {
  return Array.from({ length: 8 }, (_, index) => ({
    seed: (seedBase + Math.imul(index + 1, 0x9e3779b9)) >>> 0, hours: totalHours / 8,
  }))
}

export function summarizePairedMetrics(candidateRuns: Array<Record<string, number>>, baselineRuns: Array<Record<string, number>>, fields: string[]) {
  return Object.fromEntries(fields.map(field => {
    const samples = candidateRuns.map(run => Number(run[field]) || 0)
    const baseline = baselineRuns.map(run => Number(run[field]) || 0)
    return [field, { ...summarizeSamples(samples), paired: pairedSamples(samples, baseline) }]
  }))
}
