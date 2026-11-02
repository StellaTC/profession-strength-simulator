import { localizeUiText } from '@/locales/domLocalization'
import { translateCombatName, translateTriggerLabel } from './combatTranslation'
import { getTriggerDependencies, getTriggerConditionsForDependency, getTriggerComparatorsForCondition, isComparatorValueRequired } from './triggerMapper.js'

const statuses: Record<string, string> = {queued:'排队',running:'计算中',paused:'已暂停',cancelled:'已取消',failed:'失败',completed:'完成'}
const fields: Record<string, string> = {memberId:'成员 ID',member:'成员',player:'成员',slot:'槽位',before:'原配置',after:'新配置',from:'原配置',to:'新配置',kind:'类别',triggers:'触发条件',value:'阈值',conditionHrid:'状态',dependencyHrid:'对象',comparatorHrid:'比较符'}
export const plannerStatusLabel = (status: string) => localizeUiText(statuses[status] || status)
export const plannerFieldLabel = (field: string) => localizeUiText(fields[field] || field)

export function plannerTriggerLabel(trigger: any): string {
  const dependency = getTriggerDependencies().find((x:any)=>x.hrid===trigger.dependencyHrid)
  const condition = getTriggerConditionsForDependency(trigger.dependencyHrid).find((x:any)=>x.hrid===trigger.conditionHrid)
  const comparator = getTriggerComparatorsForCondition(trigger.conditionHrid).find((x:any)=>x.hrid===trigger.comparatorHrid)
  return [translateTriggerLabel(dependency?.name || '', trigger.dependencyHrid), translateTriggerLabel(condition?.name || '', trigger.conditionHrid), translateTriggerLabel(comparator?.name || '', trigger.comparatorHrid), isComparatorValueRequired(trigger.comparatorHrid) ? trigger.value : ''].filter(x=>x!==''&&x!=null).join(' ')
}

/** Format display values without changing saved results or their identifiers. */
export function plannerValueLabel(value: unknown, field = ''): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length ? value.map(item=>plannerValueLabel(item,field)).join(' · ') : localizeUiText('无条件立即触发')
  if (typeof value === 'object') {
    if ('conditionHrid' in value) return plannerTriggerLabel(value)
    return Object.entries(value).map(([key,item])=>`${plannerFieldLabel(key)}: ${plannerValueLabel(item,key)}`).join(' · ')
  }
  if (field === 'member' || field === 'player' || field === 'memberId') return String(value)
  const text = String(value).replace(/\/(?:items|abilities|actions\/combat|labyrinths)\/[a-z0-9_]+/g, hrid=>translateCombatName('',hrid))
  // Legacy upgrade results store names rather than HRIDs. Translate each side
  // independently, leaving enhancement levels and arrows intact.
  return text.split(' → ').map(part=>{
    const match = part.match(/^(.+?)\s+((?:\+|Lv\.)\d+(?:\s.*)?)$/)
    return localizeUiText(match ? `${translateCombatName(match[1])} ${match[2]}` : translateCombatName(part))
  }).join(' → ')
}
