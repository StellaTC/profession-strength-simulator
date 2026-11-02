export function canonicalJson(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
}
export async function simulationFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")
}

/** No upgrade of old result stores: new event semantics occupy a separate DB. */
export class TrialOptimizationStorage {
  private database: Promise<IDBDatabase> | undefined
  private memory = new Map<string, unknown>()
  private unavailable = false
  constructor(private warn: (message: string) => void = () => {}) {}
  private open() {
    return this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"))
      const request = indexedDB.open("combat-trial-optimizer-v2", 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore("simulations")
        request.result.createObjectStore("checkpoints")
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error("IndexedDB blocked"))
    })
  }
  private fallback() {
    if (!this.unavailable) this.warn("本地存储不可用，继续计算，但本次新增进度无法在刷新后恢复")
    this.unavailable = true
  }
  async get<T>(store: "simulations" | "checkpoints", key: string): Promise<T | undefined> {
    const local = this.memory.get(`${store}:${key}`) as T | undefined
    if (local !== undefined) return structuredClone(local)
    if (this.unavailable) return undefined
    try {
      const database = await this.open()
      return await new Promise<T | undefined>((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch { this.fallback(); return undefined }
  }
  async put(store: "simulations" | "checkpoints", key: string, value: unknown) {
    this.memory.set(`${store}:${key}`, structuredClone(value))
    // Memory cache is expendable; checkpoints are retained until process exit.
    if (this.memory.size > 4096) {
      const oldest = [...this.memory.keys()].find(entry => entry.startsWith("simulations:"))
      if (oldest) this.memory.delete(oldest)
    }
    if (this.unavailable) return
    try {
      const database = await this.open()
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(store, "readwrite")
        transaction.objectStore(store).put(value, key)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } catch { this.fallback() }
  }
  async close() { if (this.database) (await this.database.catch(() => null))?.close() }
}
