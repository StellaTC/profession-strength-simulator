export const STELLA_ENHANCING_PROFILE = Object.freeze({
  schemaVersion: 1,
  profileId: "stella-guild-server-2026-07-27",
  characterId: 98148,
  characterName: "Stella",
  source: "mwi-guild-assistant/player_snapshots + player_trial_builds",
  capturedAt: "2026-07-27T02:57:28.826Z",
  exporterVersion: "1.14.5",
  skills: {
    enhancing: 142,
    cheesesmithing: 118,
    crafting: 136,
    tailoring: 124
  },
  enhancing: {
    tool: { hrid: "/items/celestial_enhancer", enhancementLevel: 16, label: "星空强化器 +16" },
    body: { hrid: "/items/enhancers_top", enhancementLevel: 11, label: "强化师上衣 +11" },
    legs: { hrid: "/items/enhancers_bottoms", enhancementLevel: 10, label: "强化师下装 +10" },
    charm: { hrid: "/items/grandmaster_enhancing_charm", enhancementLevel: 10, label: "宗师强化护符 +10" },
    back: { hrid: "/items/chance_cape_refined", enhancementLevel: 10, label: "机缘披风（精）+10" },
    house: { hrid: "/house_rooms/observatory", level: 8, label: "天文台 8 级" },
    teas: [
      { hrid: "/items/ultra_enhancing_tea", label: "究极强化茶" },
      { hrid: "/items/wisdom_tea", label: "经验茶" },
      { hrid: "/items/blessed_tea", label: "福气茶" }
    ]
  },
  specialEquipment: [
    { type: "hands", hrid: "/items/enchanted_gloves", enhancementLevel: 10, label: "附魔手套 +10" },
    { type: "neck", hrid: "/items/philosophers_necklace", enhancementLevel: 10, label: "贤者项链 +10" },
    { type: "earrings", hrid: "/items/philosophers_earrings", enhancementLevel: 5, label: "贤者耳环 +5" },
    { type: "ring", hrid: "/items/philosophers_ring", enhancementLevel: 7, label: "贤者戒指 +7" },
    { type: "pouch", hrid: "/items/guzzling_pouch", enhancementLevel: 10, label: "暴饮之囊 +10" },
    { type: "off_hand", hrid: "/items/eye_watch", enhancementLevel: 10, label: "掌上监工 +10" },
    { type: "feet", hrid: "/items/collectors_boots", enhancementLevel: 10, label: "收藏家靴 +10" }
  ],
  achievements: {
    completedTiers: ["beginner", "novice", "adept", "veteran", "champion", "elite"],
    completedCount: 77,
    totalCount: 77,
    enhancingEffectLabel: "六档成就均完成；强化计算实际生效项为冠军档强化成功率 +0.2%"
  },
  production: {
    mode: "single_step_direct_recipe",
    teas: [],
    actions: {
      cheesesmithing: {
        level: 118,
        tool: { hrid: "/items/holy_hammer", enhancementLevel: 10, label: "神圣锤子 +10" },
        houseLevel: 5,
        houseLabel: "锻造间 5 级"
      },
      crafting: {
        level: 136,
        tool: { hrid: "/items/celestial_chisel", enhancementLevel: 7, label: "星空凿子 +7" },
        houseLevel: 5,
        houseLabel: "工坊 5 级"
      },
      tailoring: {
        level: 124,
        tool: { hrid: "/items/holy_needle", enhancementLevel: 9, label: "神圣针 +9" },
        houseLevel: 5,
        houseLabel: "缝纫室 5 级"
      }
    }
  },
  communityBuff: {
    enhancingSpeedLevel: 0,
    captured: false,
    label: "服务器快照未采集公会强化速度 Buff，按 0 级计算"
  },
  costRules: {
    baseItem: "装备底子采用强化页的单步直接制作模式；制作配方中的茶不计入底子成本",
    protection: "普通强化与贤者镜混合强化同时遍历；保护等级 1 到目标等级、贤者镜起点 1 到目标等级前一档，按期望金币成本选择最低方案",
    philosopherMirror: "贤者镜价格、需要的副装备、普通保护品和三种茶均计价；达到哪一星开始使用不写死，按装备与当期价格实时求最优",
    consumables: "究极强化茶、经验茶、福气茶的实际消耗量与市场成本计入",
    labor: "不计人工时薪、市场税和强化副产物收益",
    replacement: "更换装备时扣除旧装备当前买价；同一装备升星只计算增量强化消耗"
  }
} as const)

export type StellaEnhancingProfile = typeof STELLA_ENHANCING_PROFILE
