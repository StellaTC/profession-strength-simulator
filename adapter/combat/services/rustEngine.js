import { compileRustPayload, rustGameData } from "./rustPayload.js";
import { getRuntimeCombatGameDataVersion } from "../shared/runtimeGameData.js";

export const RUST_IMPLEMENTATION_VERSION = "rust-wasm-3";
// Enable a mode only after its full differential suite passes. Trial has a separate gate.
export const VERIFIED_RUST_MODES = Object.freeze(["normal", "labyrinth", "task"]);
let active = null;
let loading = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export class BrowserRustEngine {
  constructor(exports) { this.exports = exports; this.dataVersion = ""; }
  input(text) {
    const bytes = encoder.encode(text);
    const ptr = this.exports.alloc(bytes.length);
    if (!ptr) throw new Error("WASM 输入过大或无法分配内存");
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }
  output() { return decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.out_ptr(), this.exports.out_len())); }
  setGameData(data) {
    if (this.exports.load_gamedata(...this.input(JSON.stringify(data))) !== 0) throw new Error(this.output());
  }
  run(scenario) {
    this.exports.run(...this.input(JSON.stringify(scenario)), 1);
    const response = JSON.parse(this.output());
    if (response.error) throw new Error(response.error);
    const result = response.result;
    if (!result || !Number.isFinite(result.simulatedTime) || result.simulatedTime <= 0) throw new Error("WASM 返回无效模拟结果");
    return result;
  }
}
export async function runRustSimulation(payload) {
  if (!loading && !active) loading = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}engine/mwi_engine.wasm`);
    if (!response.ok) throw new Error(`WASM 加载失败 (${response.status})`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    active = new BrowserRustEngine(instance.exports);
  })().finally(() => { loading = null; });
  if (loading) await loading;
  try {
    const version = getRuntimeCombatGameDataVersion();
    // Re-load on catalog identity as well as public version (custom imported catalogs may share a label).
    const data = JSON.stringify(rustGameData());
    if (active.dataVersion !== version || active.catalog !== data) {
      active.setGameData(JSON.parse(data)); active.dataVersion = version; active.catalog = data;
    }
    const result = active.run(compileRustPayload(payload));
    for (const wipe of result.wipeEvents || []) wipe.timestamp = new Date().toISOString();
    return result;
  } catch (error) { active = null; throw error; }
}
