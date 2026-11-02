<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { localizeUiText } from '@/locales/domLocalization'
import { useActiveLang } from '@/locales'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useSimulatorStore } from '../stores/simulatorStore.js'
import { combatWorkspaceOwner, combatWorkspaceState, loadCombatWorkspace, setSharedBaseline, setBaselineFromArtifact, savePartyBuild, deletePartyBuild, importPartyBuilds, exportPartyBuilds, copyCombatValue, type PartyBuild } from '../services/combatWorkspaceState'
import { listCombatRunArtifactsForAccount, resolveCombatAccountKey, type CombatRunArtifactV2 } from '../services/combatRunHistory'
const auth=useAuthStore(), simulator=useSimulatorStore()
const owner=computed(()=>combatWorkspaceOwner(auth.user?.id)), state=computed(()=>combatWorkspaceState(owner.value))
const name=ref(localizeUiText('我的队伍')), records=ref<CombatRunArtifactV2[]>([]), selectedHistory=ref(''), busy=ref(false)
watch(useActiveLang(),()=>{if(['我的队伍','My party'].includes(name.value))name.value=localizeUiText('我的队伍')})
const fileInput=ref<HTMLInputElement>(), fileMode=ref<'builds'|'history'>('builds')
watch(owner,async value=>{await loadCombatWorkspace(value);await reloadHistory()},{immediate:true})
async function action(fn:()=>Promise<unknown>){busy.value=true;try{await fn();ElMessage.success('已保存')}catch(e:any){ElMessage.error(e.message)}finally{busy.value=false}}
async function reloadHistory(){records.value=await listCombatRunArtifactsForAccount({canonicalAccountKey:resolveCombatAccountKey(auth.user?.id,simulator.activePlayer?.name||''),profileOwnerIds:auth.user?[auth.user.id]:[simulator.simulationSettings.profileSnapshotOwnerId],activePlayerName:simulator.activePlayer?.name||''})}
function establish(){return action(()=>setSharedBaseline(owner.value,{name:name.value,players:simulator.players,settings:simulator.simulationSettings,activePlayerId:simulator.activePlayerId}))}
function save(){return action(()=>savePartyBuild(owner.value,name.value,simulator.players,simulator.simulationSettings))}
function load(build:PartyBuild){simulator.players=copyCombatValue(build.players);simulator.simulationSettings={...simulator.simulationSettings,...copyCombatValue(build.settings)};simulator.activePlayerId=String(build.players.find(p=>p.selected)?.id||build.players[0].id);ElMessage.success('整队方案已载入战斗配置；共享基准保持原修订')}
function asBaseline(build:PartyBuild){return action(()=>setSharedBaseline(owner.value,{players:build.players,settings:build.settings,name:build.name,source:'整队方案',gameDataVersion:build.gameDataVersion}))}
function exportBuilds(){downloadJson(localizeUiText('整队方案.json'),exportPartyBuilds(owner.value))}
function pick(mode:'builds'|'history'){fileMode.value=mode;fileInput.value?.click()}
async function importFile(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;await action(async()=>{const text=await file.text();if(fileMode.value==='builds')await importPartyBuilds(owner.value,text);else await setBaselineFromArtifact(owner.value,JSON.parse(text))});input.value=''}
function historyBaseline(){const row=records.value.find(r=>r.id===selectedHistory.value);if(row)return action(()=>setBaselineFromArtifact(owner.value,row))}
function downloadJson(filename:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
</script>
<template>
  <el-card shadow="never" class="shared-panel">
    <h2>共享基准与整队方案</h2>
    <p>导入角色后建立一次基准，各工具共用这份固定配置。编辑或优化会另存方案，点击“设为新基准”才更新所有页面。</p>
    <el-alert v-if="state.baseline" type="success" :closable="false"><template #title><span translate="no">{{state.baseline.name}}</span> · 修订 {{state.baseline.revision}} · <span translate="no">{{state.baseline.players.filter(p=>p.selected).map(p=>p.name).join('、')}}</span></template></el-alert>
    <div class="actions"><el-input v-model="name" aria-label="基准或整队方案名称" placeholder="基准 / 方案名称" style="width:240px"/><el-button type="primary" :loading="busy" @click="establish">{{state.baseline?'将当前配置设为新基准':'用当前配置建立基准'}}</el-button><el-button @click="save">保存当前整队方案</el-button></div>
    <div class="actions"><el-select v-model="selectedHistory" placeholder="从完整模拟历史建立基准" style="width:320px" @visible-change="value=>value&&reloadHistory()"><el-option v-for="r in records.filter(r=>!r.partial)" :key="r.id" :value="r.id" :label="`${new Date(r.createdAt).toLocaleString()} · ${r.players.filter(p=>p.selected).map(p=>p.name).join('、')}`"/></el-select><el-button :disabled="!selectedHistory" @click="historyBaseline">将历史设为基准</el-button><el-button @click="pick('history')">导入完整模拟 JSON</el-button></div>
    <div class="actions"><el-button @click="pick('builds')">导入整队方案</el-button><el-button :disabled="!state.builds.length" @click="exportBuilds">导出整队方案</el-button></div>
    <el-table v-if="state.builds.length" :data="state.builds" size="small"><el-table-column label="整队方案"><template #default="{row}"><span translate="no">{{row.name}}</span></template></el-table-column><el-table-column label="成员"><template #default="{row}">{{row.players.filter((p:any)=>p.selected).map((p:any)=>p.name).join('、')}}</template></el-table-column><el-table-column label="操作" min-width="310"><template #default="{row}"><el-button link @click="load(row)">载入配置</el-button><el-button link @click="action(()=>savePartyBuild(owner,`${row.name} 副本`,row.players,row.settings,row.gameDataVersion))">复制</el-button><el-button link type="primary" @click="asBaseline(row)">设为新基准</el-button><el-button link type="danger" @click="action(()=>deletePartyBuild(owner,row.id))">删除</el-button></template></el-table-column></el-table>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile"/>
  </el-card>
</template>
<style scoped>.shared-panel{margin-bottom:18px}.shared-panel h2{margin-top:0;font-size:20px}.shared-panel p{color:var(--el-text-color-secondary);line-height:1.7}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}</style>
