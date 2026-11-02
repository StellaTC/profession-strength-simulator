<script setup lang="ts">
import { computed } from 'vue'
import { getRuntimeCombatGameData } from '../shared/runtimeGameData.js'
import { translateCombatName } from '../services/combatTranslation'
import type { PlannerTarget } from '../services/plannerEvaluation'
const props = defineProps<{modelValue:PlannerTarget, label?:string, zoneOnly?:boolean}>()
const emit = defineEmits<{ 'update:modelValue':[PlannerTarget] }>()
const options = computed(() => Object.values(props.modelValue.kind==='labyrinth'?getRuntimeCombatGameData().maps.combatMonsterDetailMap:getRuntimeCombatGameData().maps.actionDetailMap).filter((x:any)=>props.modelValue.kind==='labyrinth'||x.combatZoneInfo).map((x:any)=>({value:x.hrid,label:translateCombatName(x.name,x.hrid)})))
function set(key:string,value:unknown){emit('update:modelValue',{...props.modelValue,[key]:value})}
function mode(value:any){emit('update:modelValue',{kind:value,hrid:'',difficulty:value==='labyrinth'?100:0})}
</script>
<template><div class="target-picker"><label>{{ label || '目标区域' }}</label><el-select v-if="!zoneOnly" :model-value="modelValue.kind" @update:model-value="mode" aria-label="战斗模式" style="width:120px"><el-option label="区域 / 地下城" value="zone"/><el-option label="迷宫" value="labyrinth"/><el-option label="任务战斗" value="task"/></el-select><el-select :model-value="modelValue.hrid" @update:model-value="set('hrid',$event)" filterable placeholder="选择区域" aria-label="目标区域" style="width:240px"><el-option v-for="o in options" :key="o.value" :label="o.label" :value="o.value"/></el-select><el-input-number :model-value="modelValue.difficulty" @update:model-value="set('difficulty',$event)" :min="modelValue.kind==='labyrinth'?1:0" :max="modelValue.kind==='labyrinth'?100000:5" :precision="0" aria-label="难度或迷宫等级"/><small>{{ modelValue.kind==='labyrinth'?'迷宫等级':'难度' }}</small></div></template>
<style scoped>.target-picker{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.target-picker label{font-weight:600;min-width:85px}.target-picker small{color:var(--el-text-color-secondary)}</style>
