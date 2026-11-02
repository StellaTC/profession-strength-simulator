<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRoute } from 'vue-router'
import { useSimulatorStore } from '../stores/simulatorStore.js'
import { combatWorkspaceOwner, combatWorkspaceState, loadCombatWorkspace, baselineIsCurrent } from '../services/combatWorkspaceState'
import { sharedBaselineArtifact, type PlannerTarget } from '../services/plannerEvaluation'
import type { CombatRunArtifactV2 } from '../services/combatRunHistory'
import PlannerTargetPicker from './PlannerTargetPicker.vue'
const props=defineProps<{disabled?:boolean}>(),emit=defineEmits<{resolved:[CombatRunArtifactV2]}>()
const auth=useAuthStore(),simulator=useSimulatorStore(),route=useRoute(),owner=computed(()=>combatWorkspaceOwner(auth.user?.id)),baseline=computed(()=>combatWorkspaceState(owner.value).baseline)
const target=ref<PlannerTarget>({kind:'zone',hrid:'',difficulty:0}),busy=ref(false),error=ref(''),generation=ref(0)
watch(owner,value=>loadCombatWorkspace(value),{immediate:true})
watch(baseline,b=>{if(b&&!target.value.hrid){const old=b.artifact?.targets[0];const first=simulator.options.zones[0];target.value={kind:'zone',hrid:old?.targetHrid||first?.hrid||'',difficulty:old?.difficultyTier||0}}},{immediate:true})
async function compute(){const b=baseline.value;if(!b||!target.value.hrid||props.disabled||!baselineIsCurrent(b))return;const token=++generation.value;busy.value=true;error.value='';try{await simulator.ensureMarketPricesLoaded();const artifact=await sharedBaselineArtifact(b,{priceTable:simulator.pricing.priceTable,enhancementQuotesByItem:simulator.pricing.enhancementQuotesByItem,sourceUpdatedAt:simulator.pricing.sourceUpdatedAt},target.value);if(token===generation.value&&b.id===baseline.value?.id&&!props.disabled)emit('resolved',artifact)}catch(e:any){if(token===generation.value)error.value=e.message}finally{if(token===generation.value)busy.value=false}}
watch([()=>baseline.value?.id,()=>JSON.stringify(target.value),()=>props.disabled],()=>{if(!route.query.historyTask)void compute()},{immediate:true})
</script>
<template><el-card v-if="baseline" shadow="never" style="margin-bottom:16px"><h3>使用共享基准 · 修订 {{baseline.revision}}</h3><PlannerTargetPicker v-model="target" zone-only/><el-button :loading="busy" :disabled="disabled||!baselineIsCurrent(baseline)" @click="compute">{{busy?'正在计算该目标的基准结果':'使用此目标（自动复用缓存）'}}</el-button><p v-if="error">{{error}}</p><p v-if="!baselineIsCurrent(baseline)">基准数据已过期，请先更新基准。</p></el-card></template>
