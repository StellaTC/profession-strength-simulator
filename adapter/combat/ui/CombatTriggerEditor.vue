<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { ElMessage } from "element-plus"
import { Delete, Plus } from "@element-plus/icons-vue"
import {
  MAX_TRIGGER_COUNT,
  getTriggerComparatorsForCondition,
  getTriggerConditionsForDependency,
  getTriggerDependencies,
  isComparatorValueRequired
} from "../services/triggerMapper.js"
import { translateTriggerLabel } from "../services/combatTranslation"
import { useSimulatorStore } from "../stores/simulatorStore.js"

const props = defineProps<{ modelValue: boolean, targetHrid: string, targetName: string }>()
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>()
const simulator = useSimulatorStore()
const rows = ref<any[]>([])
const dependencies = getTriggerDependencies()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit("update:modelValue", value)
})

function load() {
  if (!props.targetHrid) {
    rows.value = []
    return
  }
  rows.value = simulator.ensureActivePlayerTriggerDefaults(props.targetHrid)
}

watch(() => [props.modelValue, props.targetHrid], () => {
  if (props.modelValue) load()
}, { immediate: true })

function conditions(row: any) {
  return getTriggerConditionsForDependency(row.dependencyHrid)
}

function comparators(row: any) {
  return getTriggerComparatorsForCondition(row.conditionHrid)
}

function dependencyChanged(row: any) {
  row.conditionHrid = ""
  row.comparatorHrid = ""
  row.value = 0
}

function conditionChanged(row: any) {
  const first = comparators(row)[0]
  row.comparatorHrid = first?.hrid || ""
  row.value = 0
}

function addCondition() {
  if (rows.value.length >= MAX_TRIGGER_COUNT) return
  const dependency = dependencies[0]
  const condition = dependency ? getTriggerConditionsForDependency(dependency.hrid)[0] : null
  const comparator = condition ? getTriggerComparatorsForCondition(condition.hrid)[0] : null
  rows.value.push({
    dependencyHrid: dependency?.hrid || "",
    conditionHrid: condition?.hrid || "",
    comparatorHrid: comparator?.hrid || "",
    value: 0
  })
}

function save() {
  const invalid = rows.value.some(row => !row.dependencyHrid || !row.conditionHrid || !row.comparatorHrid)
  if (invalid) return ElMessage.error("请完整选择每条触发条件")
  simulator.setActivePlayerTriggers(props.targetHrid, rows.value)
  ElMessage.success(rows.value.length ? "触发条件已保存" : "已设为无条件立即触发")
  visible.value = false
}

function resetDefault() {
  rows.value = simulator.resetActivePlayerTriggersToDefault(props.targetHrid)
  ElMessage.success("已恢复游戏默认触发条件")
}
</script>

<template>
  <el-drawer v-model="visible" :title="`${targetName || targetHrid} · 触发条件`" size="min(920px, 96vw)">
    <el-alert
      :title="rows.length ? '全部条件同时满足时触发；最多四条。' : '当前没有条件：技能或消耗品冷却完成后立即触发。'"
      :type="rows.length ? 'info' : 'success'"
      :closable="false"
      show-icon
      class="trigger-alert"
    />
    <div v-for="(row, index) in rows" :key="index" class="trigger-row">
      <el-tag effect="plain">条件 {{ index + 1 }}</el-tag>
      <el-select v-model="row.dependencyHrid" placeholder="对象" @change="dependencyChanged(row)">
        <el-option v-for="item in dependencies" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
      </el-select>
      <el-select v-model="row.conditionHrid" filterable placeholder="状态" @change="conditionChanged(row)">
        <el-option v-for="item in conditions(row)" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
      </el-select>
      <el-select v-model="row.comparatorHrid" placeholder="比较符">
        <el-option v-for="item in comparators(row)" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
      </el-select>
      <el-input-number v-if="isComparatorValueRequired(row.comparatorHrid)" v-model="row.value" :min="-1000000" :max="1000000" />
      <span v-else class="no-value">无需数值</span>
      <el-button :icon="Delete" circle plain type="danger" @click="rows.splice(index, 1)" />
    </div>
    <el-button :icon="Plus" :disabled="rows.length >= MAX_TRIGGER_COUNT" @click="addCondition">添加条件（{{ rows.length }}/{{ MAX_TRIGGER_COUNT }}）</el-button>
    <template #footer>
      <el-button @click="resetDefault">恢复游戏默认</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存触发条件</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.trigger-alert { margin-bottom: 16px; }
.trigger-row { display: grid; grid-template-columns: 76px minmax(120px, .8fr) minmax(190px, 1.4fr) minmax(110px, .7fr) minmax(110px, .7fr) 34px; gap: 8px; align-items: center; margin-bottom: 10px; }
.no-value { color: var(--el-text-color-secondary); text-align: center; font-size: 12px; }
@media (max-width: 760px) { .trigger-row { grid-template-columns: 1fr 1fr; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; } }
</style>
