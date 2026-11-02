import {
  guildTrialMemberProfession, guildTrialRuleViolations, GUILD_TRIAL_AURA_HRIDS, guildTrialAuraStrength,
  type NativeGuildTrialMember, type GuildTrialTeam, type GuildTrialRulesByBoss,
} from "../services/guildTrialNative"
import { canonicalJson } from "../services/trialOptimizationStorage"
import groups from "./skillGroups.json"

export type Teams = [GuildTrialTeam, GuildTrialTeam]
export interface TrialSearchInput {
  engineImplementation?: "auto" | "javascript"
  members: NativeGuildTrialMember[]
  teams: Teams
  rules: GuildTrialRulesByBoss
  rosterLimit: number
  lockedMemberIds: number[]
  excludableMemberIds?: number[]
  trialSetKey: string
  historyScope?: string
}
export interface TrialCandidate { key: string, teams: Teams, members: NativeGuildTrialMember[], mutation: string, healingOrigins: Record<number, string[]> }
const roleHrids = new Set([...GUILD_TRIAL_AURA_HRIDS, "/abilities/revive", "/abilities/insanity", "/abilities/invincible"])
const names: Record<string, string> = { water: "水", fire: "火", nature: "自", sword: "剑", spear: "枪", mace: "锤", bow: "弓", crossbow: "弩", shield: "盾" }
const pools: Record<string, string[]> = {
  water: ["elemental_affinity", "frost_surge", "mana_spring", "water_strike", "precision", "ice_spear", "rejuvenate"],
  fire: ["elemental_affinity", "smoke_burst", "firestorm", "flame_blast", "fireball", "precision", "rejuvenate"],
  nature: ["elemental_affinity", "toxic_pollen", "natures_veil", "life_drain", "entangle", "rejuvenate", "precision"],
  sword: ["frenzy", "berserk", "precision", "maim", "crippling_slash", "cleave"],
  mace: ["frenzy", "berserk", "precision", "fracturing_impact", "stunning_blow", "sweep"],
  spear: ["frenzy", "berserk", "precision", "puncture", "penetrating_strike"],
  bow: ["frenzy", "berserk", "precision", "rain_of_arrows", "steady_shot", "pestilent_shot", "penetrating_shot"],
  crossbow: ["frenzy", "berserk", "precision", "rain_of_arrows", "steady_shot", "pestilent_shot", "penetrating_shot"],
  shield: ["provoke", "toughness", "elusiveness", "fracturing_impact"],
}
export function abilityLevel(member: NativeGuildTrialMember, hrid: string) {
  return Math.max(0, ...[...(member.learnedAbilities || []), ...member.abilities].filter(a => a.abilityHrid === hrid).map(a => a.level)) || groups.defaultAbilityLevel
}
export function candidate(teams: Teams, members: NativeGuildTrialMember[], mutation = "baseline", healingOrigins: Record<number, string[]> = {}): TrialCandidate {
  const copied = structuredClone(teams)
  copied.forEach(team => team.memberIds.sort((a, b) => a - b))
  const assigned = new Set(copied.flatMap(team => team.memberIds))
  healingOrigins=Object.fromEntries(Object.entries(healingOrigins).filter(([id])=>assigned.has(Number(id))))
  const builds = members.filter(m => assigned.has(m.characterId)).sort((a, b) => a.characterId - b.characterId)
    .map(m => ({ id: m.characterId, abilities: m.abilities, aura: m.assignedAuraHrid, auraLevel: m.assignedAuraLevelOverride }))
  return { key: canonicalJson({ teams: copied.map(t => t.memberIds), builds, healingOrigins }), teams: copied, members, mutation, healingOrigins }
}
export function legalCandidate(value: TrialCandidate, input: TrialSearchInput) {
  const ids = value.teams.flatMap(team => team.memberIds)
  if (value.teams.some(team => !team.memberIds.length) || new Set(ids).size !== ids.length) return false
  const selected = new Set(input.members.filter(m => m.selected).map(m => m.characterId))
  if (ids.some(id => !selected.has(id))) return false
  for (const id of input.lockedMemberIds) {
    if (input.teams.findIndex(team => team.memberIds.includes(id)) !== value.teams.findIndex(team => team.memberIds.includes(id))) return false
  }
  if (input.excludableMemberIds) for (const id of input.teams.flatMap(t => t.memberIds)) {
    if (!ids.includes(id) && !input.excludableMemberIds.includes(id)) return false
  }
  return guildTrialRuleViolations(value.teams, value.members, input.rules, input.rosterLimit).length === 0
}
export function uniqueCandidates(values: TrialCandidate[]) {
  return [...new Map(values.map(value => [value.key, value])).values()]
}
export function changedMember(parent: TrialCandidate, id: number, hrids: string[], mutation: string, aura?: string) {
  const members = parent.members.map(member => member.characterId !== id ? member : {
    ...member, assignedAuraHrid: aura, assignedAuraLevelOverride: aura === member.assignedAuraHrid ? member.assignedAuraLevelOverride : undefined,
    abilities: hrids.map(abilityHrid => ({ abilityHrid, level: abilityLevel(member, abilityHrid) })),
  })
  return candidate(parent.teams, members, mutation, parent.healingOrigins)
}
export function withRole(parent: TrialCandidate, id: number, role: string, mutation = "role") {
  const member = parent.members.find(m => m.characterId === id)!
  return changedMember(parent, id, [role, ...member.abilities.filter(a => !roleHrids.has(a.abilityHrid)).map(a => a.abilityHrid).slice(0, 4)], mutation,
    GUILD_TRIAL_AURA_HRIDS.includes(role) ? role : undefined)
}
/** Distinct aura carriers, maximizing total power with the upstream top-four/expanded pass. */
export function assignTeamAuras(parent:TrialCandidate,input:TrialSearchInput,teamIndex:number,requested:Record<string,number>={},validate=true) {
  const team=parent.teams[teamIndex],rules=Array.isArray(input.rules)?input.rules[teamIndex]:input.rules
  const forced={...requested}
  for(const rule of rules.assignedAuras||[]){
    if(forced[rule.abilityHrid]!==undefined&&forced[rule.abilityHrid]!==rule.memberId)return null
    forced[rule.abilityHrid]=rule.memberId
  }
  const members=parent.members.filter(m=>team.memberIds.includes(m.characterId)&&
    (m.abilities[0]?.abilityHrid!=="/abilities/insanity"||Object.values(forced).includes(m.characterId)))
  const powers=GUILD_TRIAL_AURA_HRIDS.map(aura=>members.map(m=>({id:m.characterId,name:m.characterName,power:guildTrialAuraStrength(m,aura,
    rules.assignedAuras?.find(r=>r.memberId===m.characterId&&r.abilityHrid===aura)?.abilityLevel)}))
    .filter(v=>v.power>0&&(forced[aura]===undefined||forced[aura]===v.id))
    .sort((a,b)=>b.power-a.power||a.name.toLowerCase().localeCompare(b.name.toLowerCase())||a.id-b.id))
  type Selection={score:number,ids:number[]}
  const better=(a:Selection,b:Selection|undefined)=>!b||a.score>b.score||a.score===b.score&&a.ids.some((id,i)=>id!==b.ids[i]&&a.ids.slice(0,i).every((v,k)=>v===b.ids[k])&&id<b.ids[i])
  const solve=(limit:number)=>{
    let states=new Map<number,Selection>([[0,{score:0,ids:Array(5).fill(Infinity)}]])
    for(const member of members){
      const next=new Map(states)
      for(const [mask,state] of states)for(let aura=0;aura<5;aura++){
        if(mask&(1<<aura))continue
        const option=powers[aura].slice(0,limit).find(v=>v.id===member.characterId)
        if(!option)continue
        const proposal={score:state.score+option.power,ids:[...state.ids]};proposal.ids[aura]=member.characterId
        const newMask=mask|(1<<aura)
        if(better(proposal,next.get(newMask)))next.set(newMask,proposal)
      }
      states=next
    }
    return states.get(31)
  }
  const selected=solve(4)||solve(members.length)
  if(!selected)return null
  let next=parent
  for(const member of parent.members.filter(m=>team.memberIds.includes(m.characterId))){
    const index=selected.ids.indexOf(member.characterId)
    const role=index>=0?GUILD_TRIAL_AURA_HRIDS[index]:guildTrialMemberProfession(member).key==="shield"?"/abilities/invincible":member.abilities[0]?.abilityHrid==="/abilities/insanity"?"/abilities/insanity":"/abilities/revive"
    next=withRole(next,member.characterId,role,"aura_reassign")
  }
  return !validate||legalCandidate(next,input)?next:null
}
export function rosterNeighbors(parent: TrialCandidate, input: TrialSearchInput, kind: "move" | "swap" | "joint" = "move", light=false) {
  const values: TrialCandidate[] = []
  const unlocked = input.members.filter(m => m.selected && !input.lockedMemberIds.includes(m.characterId)).map(m => m.characterId).sort((a, b) => a - b)
  const position = (id: number) => parent.teams.findIndex(t => t.memberIds.includes(id))
  const move = (changes: Array<[number, number]>) => {
    const teams = structuredClone(parent.teams)
    for (const [id] of changes) teams.forEach(t => { t.memberIds = t.memberIds.filter(value => value !== id) })
    for (const [id, to] of changes) if (to >= 0) teams[to].memberIds.push(id)
    let value = candidate(teams, parent.members, kind, parent.healingOrigins)
    // Repair aura ownership atomically after roster edits while retaining profession slots.
    if(!light) for(let index=0;index<2;index++)value=assignTeamAuras(value,input,index,{},false)||value
    value={...value,mutation:kind}
    if (legalCandidate(value, input)) values.push(value)
  }
  if (kind === "move") for (const id of unlocked) for (const to of [0, 1, -1]) {
    if (to !== position(id)) move([[id, to]])
  }
  else for (let i = 0; i < unlocked.length; i++) for (let j = i + 1; j < unlocked.length; j++) {
    const a = unlocked[i], b = unlocked[j], pa = position(a), pb = position(b)
    if (kind === "swap" && pa !== pb) move([[a, pb], [b, pa]])
    if (kind === "joint") for (const to of [0, 1, -1]) if (to !== pa && to !== pb) move([[a, to], [b, to]])
  }
  return uniqueCandidates(values)
}
export function professionSequences(member: NativeGuildTrialMember) {
  const profession = guildTrialMemberProfession(member).key
  if (profession === "shield") return [pools.shield.map(a => `/abilities/${a}`)]
  const pool = (pools[profession] || []).map(a => `/abilities/${a}`)
  const fixed = ({ water: "water_strike", fire: "fireball", nature: "entangle" } as Record<string, string>)[profession]
  const sequences: string[][] = []
  const visit = (sequence: string[]) => {
    if (sequence.length === (fixed ? 3 : 4)) {
      const value = fixed ? [...sequence, `/abilities/${fixed}`] : sequence
      // The shared page validator remains authoritative for explicit skill requirements.
      if (["sword", "mace", "spear", "bow", "crossbow"].includes(profession) && !value.includes("/abilities/berserk")) return
      sequences.push(value); return
    }
    for (const hrid of pool) if (!sequence.includes(hrid) && hrid !== `/abilities/${fixed}`) visit([...sequence, hrid])
  }
  visit([])
  return sequences.sort((a, b) => b.reduce((s, h) => s + abilityLevel(member, h), 0) - a.reduce((s, h) => s + abilityLevel(member, h), 0)
    || a.join(",").localeCompare(b.join(",")))
}
export function skillNeighbors(parent: TrialCandidate, input: TrialSearchInput, kind: "profession" | "role" | "aura" | "healing") {
  const values: TrialCandidate[] = []
  const add = (value: TrialCandidate) => { if (value.key !== parent.key && legalCandidate(value, input)) values.push(value) }
  for (const [teamIndex, team] of parent.teams.entries()) {
    const members = team.memberIds.map(id => parent.members.find(m => m.characterId === id)!)
    if (kind === "aura") {
      for (const aura of GUILD_TRIAL_AURA_HRIDS) {
        const carriers = members.filter(m => m.assignedAuraHrid === aura || m.abilities.some(a => a.abilityHrid === aura))
        const power = (m: NativeGuildTrialMember) => guildTrialAuraStrength(m, aura, m.assignedAuraHrid === aura ? m.assignedAuraLevelOverride : undefined)
        const ranked = members.filter(m => power(m) > 0).sort((a, b) => power(b) - power(a) || a.characterId - b.characterId).slice(0, 4)
        for (const member of ranked) {
          if (carriers.some(m => m.characterId === member.characterId)) continue
          let next = parent
          for (const carrier of carriers) next = withRole(next, carrier.characterId, "/abilities/revive", "aura")
          add(assignTeamAuras(parent,input,teamIndex,{[aura]:member.characterId}) || withRole(next, member.characterId, aura, "aura"))
        }
      }
      continue
    }
    for (const member of members) {
      const profession = guildTrialMemberProfession(member).key
      const normals = member.abilities.filter(a => !roleHrids.has(a.abilityHrid)).map(a => a.abilityHrid).slice(0, 4)
      const role = member.assignedAuraHrid || member.abilities.find(a => roleHrids.has(a.abilityHrid))?.abilityHrid || "/abilities/revive"
      if (kind === "role" && (role === "/abilities/insanity" || role === "/abilities/revive" && members.filter(m=>m.abilities[0]?.abilityHrid==="/abilities/revive").length>2)) {
        add(withRole(parent, member.characterId, role === "/abilities/insanity" ? "/abilities/revive" : "/abilities/insanity"))
      }
      if (kind === "profession") {
        const sequences = professionSequences(member).filter(seq => seq.join() !== normals.join()).slice(0, 2)
        for (const sequence of sequences) if (sequence.length === 4) add(changedMember(parent, member.characterId, [role, ...sequence], `profession:${teamIndex}:${member.characterId}`, member.assignedAuraHrid))
      }
      if (kind === "healing" && ["water", "fire", "nature"].includes(profession)) {
        const heal = "/abilities/rejuvenate"
        const alternatives = professionSequences(member).filter(seq => seq.includes(heal) !== normals.includes(heal)).slice(0, 2)
        for (const sequence of alternatives) add(changedMember(parent, member.characterId, [role, ...sequence], "healing", member.assignedAuraHrid))
      }
    }
  }
  const result=uniqueCandidates(values)
  return kind==="profession" ? result.slice(0,Math.max(parent.teams.flatMap(t=>t.memberIds).length,24)) : result
}
export function candidateDistance(a: TrialCandidate, b: TrialCandidate) {
  const left = new Set(a.teams[0].memberIds), right = new Set(b.teams[0].memberIds)
  let distance = [...left].filter(id=>!right.has(id)).length + [...right].filter(id=>!left.has(id)).length
  const assigned = new Set(a.teams.flatMap(t=>t.memberIds)), others = new Set(b.teams.flatMap(t=>t.memberIds))
  for (const member of a.members.filter(m=>assigned.has(m.characterId))) {
    if (!others.has(member.characterId)) { distance += 5; continue }
    const other = b.members.find(m=>m.characterId===member.characterId)!
    distance += member.abilities.filter((ability,index)=>ability.abilityHrid!==other.abilities[index]?.abilityHrid).length
  }
  return distance
}
export type NeighborhoodStats = Record<string,{generated:number,qualified:number}>
export function adaptiveNeighbors(parent: TrialCandidate, generated: TrialCandidate[], limit=parent.teams.flatMap(t=>t.memberIds).length+24, stats:NeighborhoodStats={}) {
  if (limit<=0) return []
  const rate=(v:TrialCandidate)=>{const s=stats[v.mutation.split(":")[0]];return ((s?.qualified||0)+1)/((s?.generated||0)+2)}
  const ranked=uniqueCandidates(generated).sort((a,b)=>rate(b)-rate(a)||(a.key<b.key?-1:a.key>b.key?1:0))
  const selected:TrialCandidate[]=[], covered=new Set<number>(), seen=new Set<string>()
  for(const value of ranked){
    const changed=new Set(parent.teams[0].memberIds.filter(id=>!value.teams[0].memberIds.includes(id)))
    for(const id of value.teams[0].memberIds) if(!parent.teams[0].memberIds.includes(id)) changed.add(id)
    for(const id of value.teams.flatMap(t=>t.memberIds)){
      const before=parent.members.find(m=>m.characterId===id), after=value.members.find(m=>m.characterId===id)
      if(!parent.teams.some(t=>t.memberIds.includes(id))||canonicalJson(before?.abilities)!==canonicalJson(after?.abilities)) changed.add(id)
    }
    if(![...changed].some(id=>!covered.has(id))) continue
    selected.push(value);seen.add(value.key);changed.forEach(id=>covered.add(id))
    if(selected.length>=limit)return selected
  }
  for(const value of ranked)if(!seen.has(value.key)){selected.push(value);if(selected.length>=limit)break}
  return selected
}
export function fairNeighbors(parent: TrialCandidate, sources: TrialCandidate[][], limit: number) {
  const result: TrialCandidate[] = [], seen = new Set<string>(), covered = new Set<number>()
  const interleaved: TrialCandidate[] = []
  for (let index = 0; index < Math.max(0, ...sources.map(s => s.length)); index++) for (const source of sources) if (source[index]) interleaved.push(source[index])
  for (const value of interleaved) {
    const changed = parent.members.filter(m => {
      const other = value.members.find(x => x.characterId === m.characterId)
      return parent.teams.findIndex(t => t.memberIds.includes(m.characterId)) !== value.teams.findIndex(t => t.memberIds.includes(m.characterId))
        || canonicalJson(m.abilities) !== canonicalJson(other?.abilities) || m.assignedAuraHrid !== other?.assignedAuraHrid
    }).map(m => m.characterId)
    if (!changed.some(id => !covered.has(id)) || seen.has(value.key)) continue
    result.push(value); seen.add(value.key); changed.forEach(id => covered.add(id))
    if (result.length >= limit) return result
  }
  for (const value of interleaved) if (!seen.has(value.key)) {
    result.push(value); seen.add(value.key)
    if (result.length >= limit) break
  }
  return result
}

export function trialBossSlug(encounterHrid: string) {
  return encounterHrid.split("/").pop()!.replace("firefly", "swarm").replace(/^.*?(badger|chameleon|jellyfish|hedgehog|swarm).*$/, "$1")
}
export function teamSkillPlans(parent: TrialCandidate) {
  const plans = new Map<number, string[]>()
  for (const team of parent.teams) for (const profession of Object.keys(names)) {
    const members = parent.members.filter(m => team.memberIds.includes(m.characterId) && guildTrialMemberProfession(m).key === profession)
    if (profession === "shield") { for (const m of members) plans.set(m.characterId, pools.shield.map(h => `/abilities/${h}`)); continue }
    const rule = groups.rules.find(g => g.profession === names[profession] && g.boss === trialBossSlug(team.encounterHrid))
    if (!rule) continue
    const primary = rule.primary, secondary = rule.secondary
    let count = secondary.length ? Math.min(members.length, Math.max(0, rule.primaryCount)) : members.length
    if (profession === "water") {
      const a = primary.includes("/abilities/mana_spring"), b = secondary.includes("/abilities/mana_spring"), required = Math.min(3, members.length)
      if (a && !b) count = Math.max(required, count)
      if (b && !a) count = Math.min(members.length - required, count)
    }
    const total = (m: NativeGuildTrialMember, sequence: string[]) => sequence.reduce((sum, h) => sum + abilityLevel(m, h), 0)
    const relative = (m: NativeGuildTrialMember) => total(m, primary.filter(h => !secondary.includes(h))) - total(m, secondary.filter(h => !primary.includes(h)))
    const ranked = [...members].sort((a,b) => relative(b)-relative(a) || total(b,primary)-total(a,primary) || a.characterName.toLowerCase().localeCompare(b.characterName.toLowerCase()) || a.characterId-b.characterId)
    ranked.forEach((m,index) => plans.set(m.characterId, [...(index < count ? primary : secondary)]))
  }
  return plans
}
export function recommendedCandidate(parent: TrialCandidate, input: TrialSearchInput) {
  let next = parent
  for (const [id, sequence] of teamSkillPlans(parent)) {
    const member = next.members.find(m => m.characterId === id)!
    const role = member.assignedAuraHrid || member.abilities.find(a => roleHrids.has(a.abilityHrid))?.abilityHrid || "/abilities/revive"
    next = changedMember(next, id, [role, ...sequence], "team_skill_plan", member.assignedAuraHrid)
  }
  for(let team=0;team<2;team++)next=assignTeamAuras(next,input,team)||next
  return legalCandidate(next,input) ? next : parent
}
export function jointSkillNeighbors(parent: TrialCandidate, input: TrialSearchInput) {
  const joint = skillNeighbors(parent,input,"role").slice(0,12).flatMap(role => skillNeighbors(role,input,"profession").slice(0,2))
  const assigned = parent.members.filter(m => parent.teams.some(t => t.memberIds.includes(m.characterId))).sort((a,b)=>a.characterId-b.characterId)
  for (let i=0;i<Math.min(12,assigned.length-1);i++) {
    let value = parent
    for (const m of assigned.slice(i,i+2)) {
      const current = m.abilities.filter(a=>!roleHrids.has(a.abilityHrid)).map(a=>a.abilityHrid)
      const sequence = professionSequences(m).sort((a,b)=>a.join().localeCompare(b.join())).find(seq=>seq.join()!==current.join())
      if (!sequence) continue
      const role = m.assignedAuraHrid || m.abilities.find(a=>roleHrids.has(a.abilityHrid))?.abilityHrid || "/abilities/revive"
      value = changedMember(value,m.characterId,[role,...sequence],"high_interaction_pair",m.assignedAuraHrid)
    }
    if (value.key!==parent.key && legalCandidate(value,input)) joint.push(value)
  }
  return uniqueCandidates(joint)
}

export function healingCandidates(parent: TrialCandidate, input: TrialSearchInput, damage: Array<Record<number,number>>, additionsTopK=3) {
  const proposals: TrialCandidate[] = [], heal = "/abilities/rejuvenate"
  const add = (member: NativeGuildTrialMember, sequence: string[], restoring: boolean) => {
    const role = member.assignedAuraHrid || member.abilities.find(a=>roleHrids.has(a.abilityHrid))?.abilityHrid || "/abilities/revive"
    const changed = changedMember(parent,member.characterId,[role,...sequence],restoring?"healing_remove":"healing_add",member.assignedAuraHrid)
    const origins = {...parent.healingOrigins}
    if (restoring) delete origins[member.characterId]
    else origins[member.characterId] = member.abilities.filter(a=>!roleHrids.has(a.abilityHrid)).map(a=>a.abilityHrid)
    const next=candidate(changed.teams,changed.members,changed.mutation,origins)
    if (legalCandidate(next,input)) proposals.push(next)
  }
  for (const [teamIndex,team] of parent.teams.entries()) {
    const members = parent.members.filter(m=>team.memberIds.includes(m.characterId))
    const order=members.filter(m=>guildTrialMemberProfession(m).key!=="shield").sort((a,b)=>(damage[teamIndex][b.characterId]||0)-(damage[teamIndex][a.characterId]||0)||a.characterName.toLowerCase().localeCompare(b.characterName.toLowerCase())||a.characterId-b.characterId)
    for (const profession of ["nature","fire","water"]) {
      const protectedIds=new Set(order.slice(0,Math.ceil(order.length*({nature:0,fire:0.2,water:0.5}[profession]||0))).map(m=>m.characterId))
      const choices: Array<{member:NativeGuildTrialMember,sequence:string[],relative:number}> = []
      for (const member of members.filter(m=>guildTrialMemberProfession(m).key===profession)) {
        if (parent.healingOrigins[member.characterId]) {add(member,parent.healingOrigins[member.characterId],true);continue}
        const current=member.abilities.filter(a=>!roleHrids.has(a.abilityHrid)).map(a=>a.abilityHrid)
        if (current.includes(heal)||protectedIds.has(member.characterId)) continue
        let sequence:string[]|undefined
        if (profession==="nature") {
          const rule=groups.rules.find(g=>g.profession===names.nature&&g.boss===trialBossSlug(team.encounterHrid))
          sequence=rule&&[rule.primary,rule.secondary].find(seq=>seq.includes(heal)&&seq.join()!==current.join())
        } else {
          const priority=profession==="fire"?["elemental_affinity","firestorm"]:["elemental_affinity","precision","ice_spear"]
          const replaceable=priority.map(h=>`/abilities/${h}`).find(h=>current.includes(h))
          if (replaceable) sequence=[heal,...current.filter(h=>h!==replaceable)]
        }
        if (sequence?.length===4) choices.push({member,sequence,relative:sequence.reduce((sum,h)=>sum+abilityLevel(member,h),0)-current.reduce((sum,h)=>sum+abilityLevel(member,h),0)})
      }
      choices.sort((a,b)=>profession==="nature" ? b.relative-a.relative || abilityLevel(b.member,heal)-abilityLevel(a.member,heal) || a.member.characterName.toLowerCase().localeCompare(b.member.characterName.toLowerCase()) || a.member.characterId-b.member.characterId : order.indexOf(b.member)-order.indexOf(a.member))
      for(const choice of choices.slice(0,additionsTopK)) add(choice.member,choice.sequence,false)
    }
  }
  return uniqueCandidates(proposals)
}
