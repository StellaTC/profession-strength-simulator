import { handleSimulationMessage } from './worker.js'
import { runGuildTrialPayload } from './guildTrialWorker.js'
// Both rule modules stay independent; only execution slots and cancellation are shared.
self.onmessage = async ({data}) => {
  if (data.type !== 'start_guild_trial') return handleSimulationMessage(data,self)
  try {
    const simResult = await runGuildTrialPayload(data, (detail?:any)=>self.postMessage({type:'simulation_progress',...detail}))
    self.postMessage({type:'simulation_result',simResult})
  } catch (error:any) { self.postMessage({type:'simulation_error',error:{message:error.message||String(error)}}) }
}
