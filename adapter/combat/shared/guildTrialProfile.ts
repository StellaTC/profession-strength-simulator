export interface CharacterGuildBuff {
  isCombat: boolean
  attributes: Array<{ typeHrid: string, flatBoost: number, ratioBoost: number }>
}

export interface GuildTrialBuildingProfile {
  guildBuildingLevels?: Record<string, number>
  characterGuildBuffs?: Record<string, CharacterGuildBuff>
}

export function copyTrialBuildings(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([hrid, level]) =>
    hrid.startsWith("/guild_buildings/") && Number.isInteger(level) && Number(level) >= 0 && Number(level) <= 20
  ))
}

export function copyCharacterGuildBuffs(value: unknown): Record<string, CharacterGuildBuff> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([hrid, entry]) => {
    if (!hrid.startsWith("/guild_buffs/") || !entry || typeof entry !== "object") return []
    const buff = entry as CharacterGuildBuff
    return [[hrid, {
      isCombat: buff.isCombat === true,
      attributes: (Array.isArray(buff.attributes) ? buff.attributes : []).filter(attribute =>
        attribute && typeof attribute.typeHrid === "string" && attribute.typeHrid.startsWith("/buff_types/")
        && Number.isFinite(attribute.flatBoost) && Number.isFinite(attribute.ratioBoost)
      ).map(attribute => ({ typeHrid: attribute.typeHrid, flatBoost: attribute.flatBoost, ratioBoost: attribute.ratioBoost }))
    }]]
  }))
}

const combatRooms: Record<string, string> = { stamina: "dining_room", intelligence: "library", attack: "dojo", defense: "armory", melee: "gym", ranged: "archery_range", magic: "mystical_study" }
export function effectiveTrialSkillLevel(member: { skills: Record<string, number>, houseRooms?: Record<string, number>, guildBuildingLevels?: Record<string, number> }, skillHrid: string) {
  const room = combatRooms[skillHrid.split("/").pop() || ""]
  const base = Number(member.skills[skillHrid]) || 0
  const house = Number(member.houseRooms?.[`/house_rooms/${room}`]) || 0
  const building = copyTrialBuildings(member.guildBuildingLevels)[`/guild_buildings/${room}`] || 0
  return base + (Number.isInteger(house) && house >= 0 && house <= 100 ? house : 0) + 2 * building
}
