import type { Action, Equipment } from "~/game"
import type { ActionConfig, ActionConfigItem, PlayerEquipmentItem } from "@/pinia/stores/player"
import { calculatePhilosopherEnhanceFlow, EnhanceCalculator } from "@/calculator/enhance"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getItemDetailOf } from "@/common/apis/game"
import { getBuffOf, getDrinkConcentration, getPlayerLevelOf, getTeaIngredientList, withPlayerConfigOverride } from "@/common/apis/player"
import { defaultActionConfig } from "@/pinia/stores/player"
import { STELLA_ENHANCING_PROFILE } from "../shared/stellaEnhancingProfile"

export interface StellaEquipmentCostPricing {
  ask: (hrid: string, level?: number) => number
  bid: (hrid: string, level?: number) => number
}

export interface StellaEquipmentTransitionInput {
  beforeItemHrid?: string
  beforeLevel?: number
  afterItemHrid: string
  afterLevel?: number
  deductBeforeEquipmentValue?: boolean
  pricing: StellaEquipmentCostPricing
}

export interface StellaEnhancingEffectiveStats {
  playerLevel: number
  successBonus: number
  blessedChance: number
  speedBonus: number
  experienceBonus: number
  drinkConcentration: number
}

export interface StellaEquipmentCostAnalysis {
  cost: number
  beforeEquipmentValue: number
  afterEquipmentValue: number
  deductsBeforeEquipmentValue: boolean
  mode: "normal" | "philosopher"
  protectLevel: number | null
  philosopherStartLevel: number | null
  expectedActions: number
  expectedProtectionCount: number
  expectedPhilosopherMirrorCount: number
  baseMode: "direct_crafting" | "market_fallback"
}

const PRODUCTION_ACTIONS = ["cheesesmithing", "crafting", "tailoring"] as const satisfies readonly Action[]

function equipment(type: Equipment, hrid: string, enhanceLevel: number): PlayerEquipmentItem {
  return { type, hrid, enhanceLevel }
}

function applyActionEquipment(
  actionConfig: ActionConfigItem,
  values: { level: number, tool: { hrid: string, enhancementLevel: number }, houseLevel: number }
) {
  actionConfig.playerLevel = values.level
  actionConfig.tool = equipment(`${actionConfig.action}_tool` as Equipment, values.tool.hrid, values.tool.enhancementLevel)
  actionConfig.houseLevel = values.houseLevel
  actionConfig.tea = []
}

export function createStellaEnhancingActionConfig(): ActionConfig {
  const config = defaultActionConfig("Stella 强化成本基准", "#7c3aed")
  const enhancing = config.actionConfigMap.get("enhancing")!
  enhancing.playerLevel = STELLA_ENHANCING_PROFILE.skills.enhancing
  enhancing.tool = equipment("enhancing_tool" as Equipment, STELLA_ENHANCING_PROFILE.enhancing.tool.hrid, STELLA_ENHANCING_PROFILE.enhancing.tool.enhancementLevel)
  enhancing.body = equipment("body", STELLA_ENHANCING_PROFILE.enhancing.body.hrid, STELLA_ENHANCING_PROFILE.enhancing.body.enhancementLevel)
  enhancing.legs = equipment("legs", STELLA_ENHANCING_PROFILE.enhancing.legs.hrid, STELLA_ENHANCING_PROFILE.enhancing.legs.enhancementLevel)
  enhancing.back = equipment("back", STELLA_ENHANCING_PROFILE.enhancing.back.hrid, STELLA_ENHANCING_PROFILE.enhancing.back.enhancementLevel)
  enhancing.charm = equipment("charm", STELLA_ENHANCING_PROFILE.enhancing.charm.hrid, STELLA_ENHANCING_PROFILE.enhancing.charm.enhancementLevel)
  enhancing.houseLevel = STELLA_ENHANCING_PROFILE.enhancing.house.level
  enhancing.tea = STELLA_ENHANCING_PROFILE.enhancing.teas.map(tea => tea.hrid)

  for (const action of PRODUCTION_ACTIONS) {
    const actionConfig = config.actionConfigMap.get(action)!
    applyActionEquipment(actionConfig, STELLA_ENHANCING_PROFILE.production.actions[action])
  }

  config.specialEquimentMap.clear()
  for (const item of STELLA_ENHANCING_PROFILE.specialEquipment) {
    config.specialEquimentMap.set(item.type as Equipment, equipment(item.type as Equipment, item.hrid, item.enhancementLevel))
  }

  for (const tier of STELLA_ENHANCING_PROFILE.achievements.completedTiers) {
    config.achievementBuffMap.set(tier, { type: tier, enabled: true })
  }
  for (const buff of config.communityBuffMap.values()) {
    buff.level = undefined
  }
  for (const shrine of config.shrineBuffMap.values()) {
    shrine.level = 0
  }
  config.seals = []
  return config
}

function positivePrice(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function resolveAsk(pricing: StellaEquipmentCostPricing, hrid: string, level?: number) {
  if (hrid === "/items/coin") return 1
  return positivePrice(pricing.ask(hrid, level))
}

/** Shared single-step Stella recipe model. Strict callers must not price missing inputs at zero. */
export function analyzeStellaCraftBaseCost(
  hrid: string,
  pricing: StellaEquipmentCostPricing,
  requireCompletePrices = false
) {
  for (const action of PRODUCTION_ACTIONS) {
    const calc = new ManufactureCalculator({ hrid, project: action, action })
    if (!calc.available) continue
    const outputCount = calc.actionItem.outputItems
      .filter(output => output.itemHrid === hrid)
      .reduce((sum, output) => sum + output.count, 0)
    if (outputCount <= 0) continue
    const materials = calc.ingredientList
      .filter(ingredient => ingredient.count > 0 && getItemDetailOf(ingredient.hrid).categoryHrid !== "/item_categories/drink")
      .map(ingredient => ({
        itemHrid: ingredient.hrid,
        level: ingredient.level || 0,
        count: ingredient.count / outputCount,
        unitPrice: resolveAsk(pricing, ingredient.hrid, ingredient.level)
      }))
    if (requireCompletePrices && materials.some(material => material.unitPrice <= 0)) return null
    return { cost: materials.reduce((sum, material) => sum + material.count * material.unitPrice, 0), materials, action }
  }
  return null
}

function directCraftBaseCost(hrid: string, pricing: StellaEquipmentCostPricing): number | null {
  return analyzeStellaCraftBaseCost(hrid, pricing)?.cost ?? null
}

function cheapestProtectionUnitCost(hrid: string, craftedBaseCost: number, pricing: StellaEquipmentCostPricing) {
  const item = getItemDetailOf(hrid)
  const candidates = [...new Set([
    ...(item.protectionItemHrids || []),
    hrid,
    "/items/mirror_of_protection"
  ])]
  return candidates.reduce((best, candidateHrid) => {
    const price = candidateHrid === hrid ? craftedBaseCost : resolveAsk(pricing, candidateHrid)
    if (price <= 0) return best
    return !best || price < best.price ? { hrid: candidateHrid, price } : best
  }, null as { hrid: string, price: number } | null)
}

interface EnhancementPlan {
  cost: number
  mode: "normal" | "philosopher"
  protectLevel: number | null
  philosopherStartLevel: number | null
  actions: number
  protectionCount: number
  philosopherMirrorCount: number
}

function teaCostForActions(calc: EnhanceCalculator, actions: number, pricing: StellaEquipmentCostPricing) {
  return getTeaIngredientList(calc).reduce((sum, tea) => (
    sum + tea.count * actions * resolveAsk(pricing, tea.hrid)
  ), 0)
}

function computeNormalEnhancementPlan(
  hrid: string,
  fromLevel: number,
  toLevel: number,
  craftedBaseCost: number,
  pricing: StellaEquipmentCostPricing
) : EnhancementPlan {
  if (toLevel <= fromLevel) {
    return { cost: 0, mode: "normal", protectLevel: null, philosopherStartLevel: null, actions: 0, protectionCount: 0, philosopherMirrorCount: 0 }
  }
  const item = getItemDetailOf(hrid)
  if (!item.enhancementCosts?.length) {
    return { cost: 0, mode: "normal", protectLevel: null, philosopherStartLevel: null, actions: 0, protectionCount: 0, philosopherMirrorCount: 0 }
  }
  const protection = cheapestProtectionUnitCost(hrid, craftedBaseCost, pricing)
  let best: EnhancementPlan | null = null

  for (let protectLevel = 1; protectLevel <= toLevel; protectLevel++) {
    const calc = new EnhanceCalculator({
      hrid,
      originLevel: fromLevel,
      enhanceLevel: toLevel,
      protectLevel
    })
    if (!calc.available) continue
    const { actions, protects } = calc.enhancelate()
    const materialCost = item.enhancementCosts.reduce((sum, ingredient) => (
      sum + ingredient.count * actions * resolveAsk(pricing, ingredient.itemHrid)
    ), 0)
    const protectionCost = protection ? protection.price * protects : 0
    const cost = materialCost + protectionCost + teaCostForActions(calc, actions, pricing)
    if (!best || cost < best.cost) {
      best = {
        cost,
        mode: "normal",
        protectLevel,
        philosopherStartLevel: null,
        actions,
        protectionCount: protects,
        philosopherMirrorCount: 0
      }
    }
  }
  return best ?? { cost: 0, mode: "normal", protectLevel: null, philosopherStartLevel: null, actions: 0, protectionCount: 0, philosopherMirrorCount: 0 }
}

function computeFullAcquisitionPlan(
  hrid: string,
  targetLevel: number,
  baseCost: number,
  pricing: StellaEquipmentCostPricing
): EnhancementPlan {
  const normal = computeNormalEnhancementPlan(hrid, 0, targetLevel, baseCost, pricing)
  let best: EnhancementPlan = { ...normal, cost: normal.cost + baseCost }
  if (targetLevel <= 1) return best

  const item = getItemDetailOf(hrid)
  const enhancementUnitCost = (item.enhancementCosts || []).reduce((sum, ingredient) => (
    sum + ingredient.count * resolveAsk(pricing, ingredient.itemHrid)
  ), 0)
  const protection = cheapestProtectionUnitCost(hrid, baseCost, pricing)
  const philosopherMirrorUnitCost = resolveAsk(pricing, "/items/philosophers_mirror")
  if (enhancementUnitCost <= 0 || philosopherMirrorUnitCost <= 0) return best

  for (let philosopherStartLevel = 1; philosopherStartLevel < targetLevel; philosopherStartLevel++) {
    for (let protectLevel = 1; protectLevel <= philosopherStartLevel; protectLevel++) {
      const flow = calculatePhilosopherEnhanceFlow({
        hrid,
        targetLevel,
        protectLevel,
        philosopherProtectLevel: philosopherStartLevel,
        useBlessedInPhilosopher: true
      })
      if (!flow || (flow.protectionCount > 0 && !protection)) continue
      const speedCalc = new EnhanceCalculator({ hrid, enhanceLevel: targetLevel, protectLevel })
      const cost = flow.baseItemCount * baseCost
        + flow.totalActions * enhancementUnitCost
        + flow.protectionCount * (protection?.price || 0)
        + flow.mirrorCount * philosopherMirrorUnitCost
        + teaCostForActions(speedCalc, flow.totalActions, pricing)
      if (cost < best.cost) {
        best = {
          cost,
          mode: "philosopher",
          protectLevel,
          philosopherStartLevel,
          actions: flow.totalActions,
          protectionCount: flow.protectionCount,
          philosopherMirrorCount: flow.mirrorCount
        }
      }
    }
  }
  return best
}

export function analyzeStellaEquipmentTransitionCost(input: StellaEquipmentTransitionInput): StellaEquipmentCostAnalysis | null {
  const targetHrid = String(input.afterItemHrid || "")
  if (!targetHrid) return null
  const beforeHrid = String(input.beforeItemHrid || "")
  const beforeLevel = Math.max(0, Math.floor(Number(input.beforeLevel) || 0))
  const afterLevel = Math.max(0, Math.floor(Number(input.afterLevel) || 0))

  try {
    return withPlayerConfigOverride(createStellaEnhancingActionConfig(), () => {
      const sameItem = beforeHrid === targetHrid
      if (sameItem && afterLevel <= beforeLevel) {
        const directCraftCost = directCraftBaseCost(targetHrid, input.pricing)
        const baseCost = directCraftCost ?? resolveAsk(input.pricing, targetHrid)
        const currentPlan = computeFullAcquisitionPlan(targetHrid, beforeLevel, baseCost, input.pricing)
        return {
          cost: 0,
          beforeEquipmentValue: currentPlan.cost,
          afterEquipmentValue: currentPlan.cost,
          deductsBeforeEquipmentValue: input.deductBeforeEquipmentValue !== false,
          mode: "normal" as const,
          protectLevel: null,
          philosopherStartLevel: null,
          expectedActions: 0,
          expectedProtectionCount: 0,
          expectedPhilosopherMirrorCount: 0,
          baseMode: "direct_crafting" as const
        }
      }
      const directCraftCost = directCraftBaseCost(targetHrid, input.pricing)
      const baseCost = directCraftCost ?? resolveAsk(input.pricing, targetHrid)
      let plan = computeFullAcquisitionPlan(targetHrid, afterLevel, baseCost, input.pricing)
      const afterEquipmentValue = plan.cost
      let beforeEquipmentValue = 0
      let cost = afterEquipmentValue
      const deductsBeforeEquipmentValue = input.deductBeforeEquipmentValue !== false

      if (sameItem) {
        const existingPlan = computeFullAcquisitionPlan(targetHrid, beforeLevel, baseCost, input.pricing)
        beforeEquipmentValue = existingPlan.cost
        cost = deductsBeforeEquipmentValue
          ? Math.max(0, afterEquipmentValue - beforeEquipmentValue)
          : afterEquipmentValue
        plan = {
          ...plan,
          actions: Math.max(0, plan.actions - existingPlan.actions),
          protectionCount: Math.max(0, plan.protectionCount - existingPlan.protectionCount),
          philosopherMirrorCount: Math.max(0, plan.philosopherMirrorCount - existingPlan.philosopherMirrorCount)
        }
      } else if (beforeHrid) {
        beforeEquipmentValue = positivePrice(input.pricing.bid(beforeHrid, beforeLevel))
        cost = deductsBeforeEquipmentValue
          ? Math.max(0, afterEquipmentValue - beforeEquipmentValue)
          : afterEquipmentValue
      }
      return {
        cost: Math.max(0, cost),
        beforeEquipmentValue,
        afterEquipmentValue,
        deductsBeforeEquipmentValue,
        mode: plan.mode,
        protectLevel: plan.protectLevel,
        philosopherStartLevel: plan.philosopherStartLevel,
        expectedActions: plan.actions,
        expectedProtectionCount: plan.protectionCount,
        expectedPhilosopherMirrorCount: plan.philosopherMirrorCount,
        baseMode: directCraftCost == null ? "market_fallback" : "direct_crafting"
      }
    })
  } catch (error) {
    console.warn("Stella equipment transition cost unavailable; using queue fallback.", error)
    return null
  }
}

export function computeStellaEquipmentTransitionCost(input: StellaEquipmentTransitionInput): number | null {
  return analyzeStellaEquipmentTransitionCost(input)?.cost ?? null
}

export function getStellaEnhancingEffectiveStats(): StellaEnhancingEffectiveStats | null {
  try {
    return withPlayerConfigOverride(createStellaEnhancingActionConfig(), () => ({
      playerLevel: getPlayerLevelOf("enhancing"),
      successBonus: getBuffOf("enhancing", "Success"),
      blessedChance: getBuffOf("enhancing", "Blessed"),
      speedBonus: getBuffOf("enhancing", "Speed"),
      experienceBonus: getBuffOf("enhancing", "Experience"),
      drinkConcentration: getDrinkConcentration()
    }))
  } catch {
    return null
  }
}
