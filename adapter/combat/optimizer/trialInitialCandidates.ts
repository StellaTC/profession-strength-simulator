import { guildTrialMemberProfession } from "../services/guildTrialNative"
import { candidate, legalCandidate, rosterNeighbors, trialBossSlug, type TrialCandidate, type TrialSearchInput } from "./trialCandidates"
import { PythonRandom } from "./pythonRandom"

const assigned = (value:TrialCandidate)=>new Set(value.teams.flatMap(t=>t.memberIds))
export function rosterLevel(value:TrialCandidate) {
  const ids=assigned(value)
  return value.members.filter(m=>ids.has(m.characterId)).reduce((sum,m)=>sum+guildTrialMemberProfession(m).level,0)
}
/** Same bounded breadth-first size-pair traversal as upstream, with page eligibility. */
export function rosterSizeRepresentatives(base:TrialCandidate,input:TrialSearchInput) {
  const size=(c:TrialCandidate)=>c.teams.map(t=>t.memberIds.length).join(":")
  const best=new Map([[size(base),base]]),updates=new Map([[size(base),1]]),queue=[base]
  const maximum=(input.rosterLimit+1)**2*2
  for(let cursor=0;cursor<queue.length&&cursor<maximum;cursor++){
    const current=queue[cursor]
    for(const next of rosterNeighbors(current,input,"move",true)){
      const key=size(next)
      if(key===size(current))continue
      const prior=best.get(key)
      if(prior&&(rosterLevel(next)<rosterLevel(prior)||rosterLevel(next)===rosterLevel(prior)&&next.key<=prior.key))continue
      best.set(key,next)
      if((updates.get(key)||0)<2){updates.set(key,(updates.get(key)||0)+1);queue.push(next)}
    }
  }
  return [...best.values()].sort((a,b)=>a.teams[0].memberIds.length-b.teams[0].memberIds.length||a.teams[1].memberIds.length-b.teams[1].memberIds.length)
}
export function perturbedStarts(base:TrialCandidate,input:TrialSearchInput,random:PythonRandom,count=6){
  const result:TrialCandidate[]=[]
  let current=base
  for(let i=0;i<count*5;i++){
    const neighbors=rosterNeighbors(current,input)
    if(!neighbors.length)break
    current=random.choice(neighbors)
    if(result.length<count)result.push(current)
  }
  return result
}
export function natureTransfers(base:TrialCandidate,input:TrialSearchInput){
  const target=base.teams.findIndex(t=>trialBossSlug(t.encounterHrid)==="hedgehog")
  if(target<0)return []
  const source=1-target,ids=assigned(base)
  const eligible=base.members.filter(m=>m.selected&&!input.lockedMemberIds.includes(m.characterId))
  const ranked=(members:typeof eligible,ascending=false)=>members.sort((a,b)=>(guildTrialMemberProfession(b).level-guildTrialMemberProfession(a).level)*(ascending?-1:1)||a.characterName.toLowerCase().localeCompare(b.characterName.toLowerCase())||a.characterId-b.characterId)
  const natures=eligible.filter(m=>guildTrialMemberProfession(m).key==="nature")
  const incoming=[...ranked(natures.filter(m=>base.teams[source].memberIds.includes(m.characterId))),...ranked(natures.filter(m=>!ids.has(m.characterId)))]
  const replacing=ranked(eligible.filter(m=>base.teams[target].memberIds.includes(m.characterId)&&!["nature","shield"].includes(guildTrialMemberProfession(m).key)),true)
  const result:TrialCandidate[]=[]
  let current=base
  for(let i=0;i<Math.min(incoming.length,replacing.length);i++){
    const teams=structuredClone(current.teams),enter=incoming[i].characterId,leave=replacing[i].characterId
    teams[target].memberIds=teams[target].memberIds.filter(id=>id!==leave);teams[target].memberIds.push(enter)
    if(teams[source].memberIds.includes(enter)){teams[source].memberIds=teams[source].memberIds.filter(id=>id!==enter);teams[source].memberIds.push(leave)}
    const next=candidate(teams,current.members,"nature_transfer",current.healingOrigins)
    if(legalCandidate(next,input)){current=next;result.push(next)}
  }
  return result
}
