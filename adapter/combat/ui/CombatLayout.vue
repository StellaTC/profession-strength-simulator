<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSimulatorStore } from '../stores/simulatorStore.js'
import { copyCombatValue } from '../services/combatWorkspaceState'
import { initializeCombatGameData } from '../services/combatBridge'
import { createEmptyPlayerConfig } from '../shared/playerConfig.js'
import { useAuthStore } from '@/stores/auth'
import { combatWorkspaceOwner, combatWorkspaceState, loadCombatWorkspace, baselineIsCurrent } from '../services/combatWorkspaceState'
import { loadPlannerTasks, plannerTasks } from '../services/plannerTasks'
const route = useRoute(), auth = useAuthStore(), simulator = useSimulatorStore()
const collapsed = ref(localStorage.getItem('combat-sidebar-collapsed') === 'true'), drawer = ref(false)
const owner = computed(() => combatWorkspaceOwner(auth.user?.id))
const baseline = computed(() => combatWorkspaceState(owner.value).baseline)
const running = computed(() => plannerTasks(owner.value).filter(t => ['running','queued'].includes(t.status)).length)
const links = [
  ['/combat/setup','数据与基准'], ['/combat','战斗配置与模拟'], ['/combat/advisor','刷图推荐'],
  ['/combat/queue','装备升级建议'], ['/combat/skill-optimizer','最优技能组'], ['/combat/consumables','药品与触发优化'],
  ['/combat/goal','目标区域提升'], ['/combat/party-planner','整队提升规划'], ['/combat/acquisition','装备获取成本'],
  ['/combat/batch','方案批量对比'], ['/combat/guild-trial','公会试炼'], ['/combat/tasks','任务与历史']
]
watch(owner, async (value, previous) => {
  await initializeCombatGameData()
  await loadCombatWorkspace(value)
  if (owner.value !== value) return
  const b = combatWorkspaceState(value).baseline
  if (b) {
    simulator.players = copyCombatValue(b.players)
    simulator.simulationSettings = { ...simulator.simulationSettings, ...copyCombatValue(b.settings) }
    simulator.activePlayerId = b.activePlayerId
  } else if (previous) {
    simulator.players = [1,2,3,4,5].map(id=>createEmptyPlayerConfig(id))
    simulator.activePlayerId = '1'
    simulator.queue.importedProfileByPlayer = {}
    simulator.simulationSettings.profileSnapshotOwnerId = 0
    simulator.simulationSettings.profileSnapshotCapturedAt = ''
  }
  void loadPlannerTasks(value)
}, { immediate: true })
let appliedRevision = ''
watch([()=>baseline.value?.id,()=>simulator.runtime.isRunning,()=>simulator.advisor.runtime.isRunning],()=>{
  const b=baseline.value
  if(!b||b.id===appliedRevision||simulator.runtime.isRunning||simulator.advisor.runtime.isRunning)return
  simulator.players=copyCombatValue(b.players)
  simulator.simulationSettings={...simulator.simulationSettings,...copyCombatValue(b.settings)}
  simulator.activePlayerId=b.activePlayerId
  appliedRevision=b.id
})
watch(() => route.path, () => { drawer.value = false })
watch(collapsed, value => localStorage.setItem('combat-sidebar-collapsed', String(value)))
</script>
<template>
  <div class="combat-shell" :class="{collapsed}">
    <aside class="combat-sidebar" aria-label="战斗工具导航">
      <button class="sidebar-toggle" @click="collapsed = !collapsed" :aria-expanded="!collapsed" aria-label="折叠或展开侧栏">{{ collapsed ? '☰' : '收起菜单 ‹' }}</button>
      <nav v-if="!collapsed">
        <router-link v-for="[path,label] in links" :key="path" :to="path" :class="{active:route.path===path}" :aria-current="route.path===path?'page':undefined">{{ label }}<small v-if="path==='/combat/tasks' && running">{{ running }}</small></router-link>
      </nav>
    </aside>
    <div class="combat-content">
      <div class="baseline-strip">
        <el-button class="mobile-menu" @click="drawer = true" aria-label="打开导航菜单">☰ 菜单</el-button>
        <router-link to="/combat/setup"><strong :translate="baseline ? 'no' : undefined">{{ baseline ? baseline.name : '尚未建立共享基准' }}</strong></router-link>
        <span v-if="baseline">修订 {{ baseline.revision }} · {{ baseline.players.filter(p=>p.selected).length }} 人</span>
        <el-tag v-if="baseline && !baselineIsCurrent(baseline)" type="warning">基准数据已过期</el-tag>
        <router-link v-if="running" to="/combat/tasks">{{ running }} 项任务运行中</router-link>
      </div>
      <router-view v-slot="{ Component }"><KeepAlive :key="owner"><component :is="Component" :key="route.path" /></KeepAlive></router-view>
    </div>
    <el-drawer v-model="drawer" title="战斗工具" direction="ltr" size="min(300px,85vw)" append-to-body>
      <nav class="drawer-links"><router-link v-for="[path,label] in links" :key="path" :to="path" :class="{active:route.path===path}" @click="drawer=false">{{ label }}</router-link></nav>
    </el-drawer>
  </div>
</template>
<style scoped>
.combat-shell{display:grid;grid-template-columns:210px minmax(0,1fr);gap:22px;max-width:1700px;margin:auto;padding:18px}.combat-shell.collapsed{grid-template-columns:42px minmax(0,1fr)}.combat-sidebar{position:sticky;top:94px;align-self:start;max-height:calc(100vh - 110px);overflow:auto;border-right:1px solid var(--el-border-color-light);padding-right:12px}.sidebar-toggle{border:0;background:transparent;color:var(--el-text-color-secondary);padding:12px;cursor:pointer}.combat-sidebar nav,.drawer-links{display:grid;gap:4px}.combat-sidebar a,.drawer-links a{padding:11px 12px;color:var(--el-text-color-regular);text-decoration:none;border-radius:8px;font-size:14px}.combat-sidebar a:hover,.drawer-links a:hover{background:var(--el-fill-color-light)}.combat-sidebar a.active,.drawer-links a.active{background:var(--el-color-primary-light-9);color:var(--el-color-primary);font-weight:600}.combat-sidebar small{float:right}.combat-content{min-width:0}.baseline-strip{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;color:var(--el-text-color-secondary)}.baseline-strip a{color:var(--el-color-primary);text-decoration:none}.mobile-menu{display:none}@media(max-width:900px){.combat-shell,.combat-shell.collapsed{display:block;padding:12px}.combat-sidebar{display:none}.mobile-menu{display:inline-flex}.baseline-strip{gap:8px}}
</style>
