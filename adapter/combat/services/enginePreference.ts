import { ref } from 'vue'
const KEY='combat-engine-preference-v1'
export const enginePreference=ref<'auto'|'javascript'>(globalThis.localStorage?.getItem(KEY)==='javascript'?'javascript':'auto')
export function setEnginePreference(value:'auto'|'javascript') {enginePreference.value=value;globalThis.localStorage?.setItem(KEY,value)}
