<script setup lang="ts">
import { ElMessage } from "element-plus"
import { CopyDocument, Delete, Plus } from "@element-plus/icons-vue"
import {
  MAX_TRIGGER_COUNT,
  getTriggerComparatorsForCondition,
  getTriggerConditionsForDependency,
  getTriggerDependencies,
  isComparatorValueRequired
} from "../services/triggerMapper.js"
import { translateCombatName, translateTriggerLabel } from "../services/combatTranslation"
import {
  copyTriggerPresetForTesting,
  wouldDuplicateTriggerSearch,
  type SkillPoolEntry,
  type TriggerPreset
} from "../services/skillOptimizer"
import AbilityIcon from "./AbilityIcon.vue"

const props = defineProps<{ entry: SkillPoolEntry }>()
const dependencies = getTriggerDependencies()
let copiedPresetSequence = 0

function weightedTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => width + (/[^\x00-\xff]/.test(character) ? 14 : 7.5), 0)
}

function optionWidth(items: Array<{ name?: string, hrid: string }>, placeholder: string, min = 88, max = 320) {
  const labels = [placeholder, ...items.map(item => translateTriggerLabel(item.name || "", item.hrid))]
  return `${Math.ceil(Math.min(max, Math.max(min, Math.max(...labels.map(weightedTextWidth)) + 48)))}px`
}

function dependencyWidth() {
  return optionWidth(dependencies, "对象", 90, 180)
}

function conditionWidth(row: any) {
  return optionWidth(conditions(row), "状态", 112, 300)
}

function comparatorWidth(row: any) {
  return optionWidth(comparators(row), "比较符", 82, 150)
}

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
  row.valueMode = "fixed"
  row.searchKind = row.conditionHrid.endsWith("lowest_hp_percentage") ? "percentage" : "absolute"
}

function addCondition(target: TriggerPreset) {
  if (target.conditions.length >= MAX_TRIGGER_COUNT) return
  const dependency = dependencies[0]
  const condition = dependency ? getTriggerConditionsForDependency(dependency.hrid)[0] : null
  const comparator = condition ? getTriggerComparatorsForCondition(condition.hrid)[0] : null
  target.conditions.push({
    dependencyHrid: dependency?.hrid || "",
    conditionHrid: condition?.hrid || "",
    comparatorHrid: comparator?.hrid || "",
    value: 0,
    valueMode: "fixed",
    searchKind: "absolute"
  })
}

function addPreset() {
  props.entry.presets.push({
    id: `custom-${Date.now()}-${props.entry.presets.length + 1}`,
    label: `触发条件候选 ${props.entry.presets.length + 1}`,
    checked: true,
    conditions: []
  })
}

function duplicatePreset(source: TriggerPreset, sourceIndex: number) {
  copiedPresetSequence += 1
  const id = `copy-${Date.now()}-${copiedPresetSequence}`
  const hadSearchCondition = source.conditions.some(condition => condition.valueMode === "search")
  props.entry.presets.splice(sourceIndex + 1, 0, copyTriggerPresetForTesting(source, id))
  ElMessage.success(hadSearchCondition
    ? "已复制为新测试组；搜索条件已改为固定"
    : "已复制为新测试组")
}

function searchDisabled(preset: TriggerPreset, rowIndex: number) {
  const row = preset.conditions[rowIndex]
  return row?.valueMode !== "search"
    && wouldDuplicateTriggerSearch(props.entry.presets, preset, rowIndex)
}

function setValueMode(preset: TriggerPreset, rowIndex: number, mode: unknown) {
  const row = preset.conditions[rowIndex]
  if (!row) return
  const nextMode = mode === "search" ? "search" : "fixed"
  if (nextMode === "search" && wouldDuplicateTriggerSearch(props.entry.presets, preset, rowIndex)) {
    ElMessage.warning("相同条件组已有搜索方案；请先修改其他 AND 条件")
    return
  }
  row.valueMode = nextMode
}
</script>

<template>
  <div class="trigger-cards-wrap">
    <div class="trigger-cards">
      <article v-for="(preset, presetIndex) in entry.presets" :key="preset.id" class="trigger-card" :class="{ selected: preset.checked }">
        <header>
          <el-checkbox v-model="preset.checked" />
          <AbilityIcon :ability-hrid="entry.abilityHrid" :label="translateCombatName('', entry.abilityHrid)" :size="28" />
          <strong class="preset-title">触发条件候选 {{ presetIndex + 1 }}</strong>
          <el-button :icon="CopyDocument" link type="primary" title="复制为新测试组" aria-label="复制为新测试组" @click="duplicatePreset(preset, presetIndex)" />
          <el-button :icon="Delete" link type="danger" :disabled="entry.presets.length <= 1" @click="entry.presets.splice(presetIndex, 1)" />
        </header>
        <el-alert v-if="!preset.conditions.length" title="无触发条件：冷却完成后即可释放" type="success" :closable="false" />
        <div v-for="(row, rowIndex) in preset.conditions" :key="rowIndex" class="condition-row">
          <span class="and-label" :class="{ first: rowIndex === 0 }">{{ rowIndex ? "AND" : "当" }}</span>
          <el-select v-model="row.dependencyHrid" size="small" placeholder="对象" :style="{ width: dependencyWidth() }" @change="dependencyChanged(row)">
            <el-option v-for="item in dependencies" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
          </el-select>
          <el-select v-model="row.conditionHrid" size="small" filterable placeholder="状态" :style="{ width: conditionWidth(row) }" @change="conditionChanged(row)">
            <el-option v-for="item in conditions(row)" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
          </el-select>
          <el-select v-model="row.comparatorHrid" size="small" placeholder="比较符" :style="{ width: comparatorWidth(row) }">
            <el-option v-for="item in comparators(row)" :key="item.hrid" :label="translateTriggerLabel(item.name, item.hrid)" :value="item.hrid" />
          </el-select>
          <template v-if="isComparatorValueRequired(row.comparatorHrid)">
            <el-input-number v-model="row.value" size="small" :min="0" :max="10000000" class="condition-value" />
            <el-radio-group :model-value="row.valueMode || 'fixed'" size="small" @change="setValueMode(preset, rowIndex, $event)">
              <el-radio-button value="fixed">固定</el-radio-button>
              <el-radio-button value="search" :disabled="searchDisabled(preset, rowIndex)">搜索</el-radio-button>
            </el-radio-group>
          </template>
          <span v-else class="no-value">无需数值</span>
          <el-button :icon="Delete" circle plain size="small" type="danger" @click="preset.conditions.splice(rowIndex, 1)" />
        </div>
        <el-button :icon="Plus" size="small" :disabled="preset.conditions.length >= MAX_TRIGGER_COUNT" @click="addCondition(preset)">
          添加 AND 条件（{{ preset.conditions.length }}/{{ MAX_TRIGGER_COUNT }}）
        </el-button>
      </article>
      <button class="add-card" type="button" @click="addPreset"><el-icon><Plus /></el-icon><span>添加触发条件方案</span></button>
    </div>
  </div>
</template>

<style scoped>
.trigger-cards-wrap {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 5px;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--el-border-color) transparent;
}
.trigger-cards-wrap::-webkit-scrollbar { height: 7px; }
.trigger-cards-wrap::-webkit-scrollbar-track { background: transparent; }
.trigger-cards-wrap::-webkit-scrollbar-thumb { border-radius: 10px; background: var(--el-border-color); }
.trigger-cards { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; width: 100%; min-width: 100%; }
.trigger-card { flex: 0 0 auto; width: max-content; max-width: 100%; min-width: min(560px, 100%); padding: 12px; box-sizing: border-box; border: 1px solid var(--el-border-color); border-radius: 10px; background: var(--el-fill-color-extra-light); }
.trigger-card.selected { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); }
.trigger-card header { display: grid; grid-template-columns: auto 28px minmax(160px, 1fr) auto auto; gap: 8px; align-items: center; width: 100%; margin-bottom: 10px; }
.preset-title { font-size: 14px; color: var(--el-text-color-primary); }
.condition-row { display: flex; align-items: center; flex-wrap: nowrap; gap: 7px; width: max-content; min-width: 100%; margin-bottom: 8px; }
.condition-row :deep(.el-select) { flex: 0 0 auto; }
.and-label { width: 38px; flex: 0 0 38px; color: var(--el-color-primary); font-weight: 700; text-align: center; }
.and-label.first { color: var(--el-text-color-secondary); font-weight: 500; }
.condition-value { width: 118px; flex: 0 0 118px; }
.no-value { width: 218px; flex: 0 0 218px; color: var(--el-text-color-secondary); font-size: 12px; text-align: center; }
.add-card { width: 170px; min-height: 150px; display: grid; place-content: center; gap: 8px; border: 1px dashed var(--el-border-color); border-radius: 10px; color: var(--el-text-color-secondary); background: transparent; cursor: pointer; }
@media (max-width: 760px) { .trigger-card { min-width: 340px; } }
</style>
