<script setup lang="ts">
import { Refresh } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"
import { useRoute } from "vue-router"
import { computed, onMounted } from "vue"
import { getRuntimeCombatGameDataVersion } from "../shared/runtimeGameData.js"
import { useSimulatorStore } from "../stores/simulatorStore.js"
import { useAuthStore } from "@/stores/auth"

import { enginePreference, setEnginePreference } from "../services/enginePreference"
import { VERIFIED_RUST_MODES } from "../services/rustEngine.js"
let hasAutoRefreshedMarketPrices = false
const route = useRoute()
const simulator = useSimulatorStore()
const auth = useAuthStore()
const snapshotAccount = computed(() => simulator.activePlayer?.name || "未初始化")
const snapshotCapturedAt = computed(() => {
  const value = simulator.simulationSettings.profileSnapshotCapturedAt
  return value ? new Date(value).toLocaleString() : "本机数据"
})
const marketPriceCutoff = computed(() => {
  const value = Number(simulator.pricing?.sourceUpdatedAt || simulator.pricing?.lastFetchedAt || 0)
  return value > 0 ? new Date(value).toLocaleString() : "尚未更新"
})

async function refreshPrices() {
  try {
    const result = await simulator.ensureMarketPricesLoaded()
    const cutoff = Number(result?.sourceUpdatedAt || simulator.pricing?.sourceUpdatedAt || simulator.pricing?.lastFetchedAt || Date.now())
    if (!result && simulator.pricing?.error) {
      ElMessage.warning(`市场价格更新失败，继续使用本机缓存：${simulator.pricing.error}`)
    } else if (result && "source" in result && result.source === "browser-cache") {
      ElMessage.success(`市场价格缓存仍在一小时有效期内，价格截止 ${new Date(cutoff).toLocaleString()}`)
    } else {
      ElMessage.success(`市场价格已从服务器更新，价格截止 ${new Date(cutoff).toLocaleString()}`)
    }
  } catch (error: any) {
    ElMessage.error(error?.message || "市场价格更新失败")
  }
}

onMounted(() => {
  if (!hasAutoRefreshedMarketPrices) {
    hasAutoRefreshedMarketPrices = true
    void simulator.ensureMarketPricesLoaded()
  }
})
</script>

<template>
  <el-card class="combat-header" shadow="never">
    <div class="combat-header__top">
      <div>
        <h2>战斗工具</h2>
        <p>当前快照：{{ snapshotAccount }} · {{ snapshotCapturedAt }} · 游戏数据 {{ getRuntimeCombatGameDataVersion() || "fallback" }}</p>
      </div>
      <div class="combat-header__actions">
        <el-select :model-value="enginePreference" @update:model-value="setEnginePreference" aria-label="模拟引擎" style="width:190px">
          <el-option :label="VERIFIED_RUST_MODES.length ? '自动（已验证模式用 WASM）' : '自动（当前使用 JS）'" value="auto" />
          <el-option label="始终使用 JavaScript" value="javascript" />
        </el-select>
        <el-tag :type="auth.user ? 'success' : 'info'" effect="plain">{{ auth.user ? `云端账号：${auth.user.username}` : "游客 · 本机存储" }}</el-tag>
        <div class="market-price-status">
          <el-button :icon="Refresh" :loading="simulator.pricing?.isLoading" @click="refreshPrices">{{ simulator.pricing?.isLoading ? "正在更新" : "更新市场价" }}</el-button>
          <small>价格截止：{{ marketPriceCutoff }}</small>
        </div>
      </div>
    </div>
  </el-card>

</template>

<style scoped>
.combat-header { margin-bottom: 16px; }
.combat-header__top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.combat-header__top h2 { margin: 0; font-size: 22px; }
.combat-header__top p { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.combat-header__actions,.market-price-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.market-price-status { color: var(--el-text-color-secondary); }
.combat-nav-sticky { position: sticky; top: 68px; z-index: 8; margin-bottom: 16px; padding: 0 12px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 8px; box-shadow: 0 4px 12px rgb(0 0 0 / 5%); }
.combat-menu { border-bottom: 0; }
.combat-menu .el-tag { margin-left: 5px; }
@media (max-width: 760px) { .combat-nav-sticky { top: 58px; margin-right: -10px; margin-left: -10px; padding: 0; border-radius: 0; overflow-x: auto; }.combat-menu { width: max-content; min-width: 100%; } }
</style>
