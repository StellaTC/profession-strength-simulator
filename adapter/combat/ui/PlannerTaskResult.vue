<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { PlannerTask } from '../services/plannerTasks'
import { setSharedBaseline, savePartyBuild } from '../services/combatWorkspaceState'
import { localizeUiText } from '@/locales/domLocalization'
import { useActiveLang } from '@/locales'
import { watch } from 'vue'
import { plannerFieldLabel, plannerValueLabel } from '../services/plannerPresentation'
import { translateCombatName } from '../services/combatTranslation'
const props=defineProps<{task:PlannerTask}>()
const result=computed(()=>props.task.result), name=ref(localizeUiText('优化整队方案'))
watch(useActiveLang(),(_,previous)=>{if(['优化整队方案','Optimized party build'].includes(name.value))name.value=localizeUiText('优化整队方案')})
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{maximumFractionDigits:3}):'—'
const metrics=[['profitMidpointPerHour','利润中值 / 小时'],['profitPerHour','利润下限 / 小时'],['xpPerHour','经验 / 小时'],['deathsPerHour','死亡 / 小时']]
const rows=computed(()=>[...metrics,['expensesPerHour','消耗成本 / 小时'],['revenuePerHour','收入下限 / 小时']].map(([key,label])=>{
  const metric=(evaluation:any)=>evaluation?.[key]??evaluation?.players?.reduce((sum:number,p:any)=>sum+Number(p[key]||0),0)
  const before=metric(result.value?.baseline),after=metric(result.value?.result)
  return {label,before,after,delta:Number(after)-Number(before)}
}))
const itemName=(hrid:string)=>translateCombatName('',hrid)
async function save(baseline=false){try{const t=props.task;if(baseline)await setSharedBaseline(t.accountKey,{players:result.value.players,settings:t.baseline.settings,name:name.value,source:'优化方案',gameDataVersion:t.baseline.gameDataVersion});else await savePartyBuild(t.accountKey,name.value,result.value.players,t.baseline.settings,t.baseline.gameDataVersion);ElMessage.success(baseline?'已建立新修订':'整队方案已保存')}catch(e:any){ElMessage.error(e.message)}}
function exportResult(){const blob=new Blob([JSON.stringify(props.task,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${props.task.kind}-${props.task.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template><div v-if="result" class="task-result">
  <el-alert :title="result.message" :type="result.found===false||result.sustainable===false?'warning':'info'" :closable="false"/>
  <p v-if="result.kind==='goal' && result.found">搜索到的最早可行方案：第 <strong>{{result.day}}</strong> 天。最终复核累计 {{ result.reviewHours }} 小时。</p>
  <p v-if="task.options.maxDeaths===0 && result.kind==='goal'">零死亡只表示本次 {{ result.reviewHours }} 小时验证中未发生死亡。</p>
  <el-table v-if="result.kind!=='batch'" :data="rows"><el-table-column prop="label" label="指标"/><el-table-column label="基准"><template #default="{row}">{{n(row.before)}}</template></el-table-column><el-table-column label="方案"><template #default="{row}">{{n(row.after)}}</template></el-table-column><el-table-column label="变化"><template #default="{row}">{{n(row.delta)}}</template></el-table-column></el-table>
  <p v-if="result.result?.implementationVersions">计算实现：{{result.result.implementationVersions.join('、')}}</p>
  <el-table v-if="result.changes?.length" :data="result.changes"><el-table-column v-for="key in Object.keys(result.changes[0]).filter(k=>k!=='memberId')" :key="key" :prop="key" :label="plannerFieldLabel(key)"><template #default="{row}"><span :translate="key==='member'||key==='player'?'no':undefined">{{plannerValueLabel(row[key],key)}}</span></template></el-table-column></el-table>
  <el-table v-if="result.steps?.length" :data="result.steps"><el-table-column v-for="key in ['day','member','change','cost']" :key="key" :label="({day:'购买日',member:'成员',change:'采购项目',cost:'净支出'} as any)[key]"><template #default="{row}"><span :translate="key==='member'?'no':undefined">{{typeof row[key]==='number'?n(row[key]):plannerValueLabel(row[key],key)}}</span></template></el-table-column><el-table-column type="expand"><template #default="{row}"><el-table :data="row.purchases || []"><el-table-column label="材料"><template #default="{row:p}">{{itemName(p.itemHrid)}} +{{p.level}}</template></el-table-column><el-table-column label="期望数量"><template #default="{row:p}">{{n(p.count)}}</template></el-table-column><el-table-column label="单价"><template #default="{row:p}">{{n(p.unitPrice)}}</template></el-table-column></el-table></template></el-table-column><el-table-column label="材料与路线"><template #default="{row}">{{row.steps?.map((step:string)=>plannerValueLabel(step)).join(' → ') || '直接采购'}}</template></el-table-column></el-table>
  <el-table v-if="result.members" :data="result.members"><el-table-column label="成员"><template #default="{row}"><span translate="no">{{row.name}}</span></template></el-table-column><el-table-column label="当前现金"><template #default="{row}">{{n(row.cash)}}</template></el-table-column><el-table-column label="每日收入"><template #default="{row}">{{n(row.dailyIncome)}}</template></el-table-column><el-table-column label="采购成本"><template #default="{row}">{{row.cost==null?'未找到方案':n(row.cost)}}</template></el-table-column><el-table-column label="现金缺口"><template #default="{row}">{{row.cost==null?'—':n(Math.max(0,row.cost-row.cash))}}</template></el-table-column></el-table>
  <template v-if="result.balances"><p>{{result.sustainable===false?'资金耗尽时':'期末'}}资产估值 {{n(result.finalWealth)}} · 不升级 {{n(result.noUpgradeWealth)}}（不升级可持续 {{n(result.noUpgradeFundedDays ?? result.horizon)}} 天；现金与装备残值合计）</p><el-table :data="result.balances"><el-table-column label="成员"><template #default="{row}"><span translate="no">{{row.name}}</span></template></el-table-column><el-table-column :label="result.sustainable===false?'停止时现金':'期末现金'"><template #default="{row}">{{n(row.cash)}}</template></el-table-column><el-table-column label="完整周期所需额外现金"><template #default="{row}">{{n(row.additionalCashRequired||0)}}</template></el-table-column><el-table-column label="装备税后残值"><template #default="{row}">{{n(row.equipmentValue)}}{{row.missingEquipmentPrices?"（缺价项按 0）":""}}</template></el-table-column></el-table></template>
  <el-table v-if="result.kind==='batch'" :data="result.rows" :default-sort="{prop:'delta',order:'descending'}"><el-table-column label="方案"><template #default="{row}"><span translate="no">{{row.name}}</span></template></el-table-column><el-table-column label="目标"><template #default="{row}">{{itemName(row.target?.hrid)}} · {{row.target?.difficulty}}</template></el-table-column><el-table-column v-for="[key,label] in metrics" :key="key" :prop="`result.${key}`" :label="label" sortable><template #default="{row}">{{row.error?'—':n(row.result?.[key])}}</template></el-table-column><el-table-column prop="delta" label="目标变化" sortable><template #default="{row}">{{row.error||n(row.delta)}}</template></el-table-column></el-table>
  <div class="result-actions"><template v-if="result.players"><el-input v-model="name" placeholder="方案名称" style="width:210px"/><el-button @click="save()">另存整队方案</el-button><el-button type="primary" @click="save(true)">设为新基准</el-button></template><el-button @click="exportResult">导出结果与配置</el-button></div>
</div></template>
<style scoped>.task-result{margin-top:16px}.task-result .el-table{margin-top:16px}.result-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}</style>
