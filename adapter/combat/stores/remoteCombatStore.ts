import { defineStore } from "pinia"
import { cancelRemoteCombatJob, getRemoteCombatJob, getRemoteCombatStatus, type RemoteCombatJob, type RemoteCombatStatus } from "../services/remoteCombat"

export interface RemoteCombatLogEntry {
  id: string
  at: number
  message: string
}

export const useRemoteCombatStore = defineStore("remote-combat", {
  state: () => ({
    status: null as RemoteCombatStatus | null,
    activeJob: null as RemoteCombatJob | null,
    loading: false,
    error: "",
    pollTimer: 0 as ReturnType<typeof setTimeout> | number,
    activityLog: [] as RemoteCombatLogEntry[],
    lastLoggedRuntimeSignature: ""
  }),
  actions: {
    appendLog(message: string) {
      const normalized = String(message || "").trim()
      if (!normalized) return
      const at = Date.now()
      this.activityLog.unshift({ id: `${at}-${Math.random().toString(16).slice(2)}`, at, message: normalized })
      this.activityLog = this.activityLog.slice(0, 80)
    },
    clearLog() {
      this.activityLog = []
      this.lastLoggedRuntimeSignature = ""
    },
    async refresh() {
      this.loading = true
      try {
        this.status = await getRemoteCombatStatus()
        this.activeJob = this.status.activeJob || this.activeJob
        this.error = ""
        return this.status
      } catch (error: any) {
        this.error = error?.message || "无法读取远程计算状态"
        throw error
      } finally {
        this.loading = false
      }
    },
    setActiveJob(job: RemoteCombatJob, preserveLog = false) {
      const isNewJob = this.activeJob?.jobId !== job.jobId || this.activityLog.length === 0
      this.activeJob = job
      if (isNewJob) {
        if (!preserveLog) this.clearLog()
        this.appendLog(job.status === "queued"
          ? `任务已提交到服务器模拟队列，当前第 ${job.queuePosition || "-"} 位`
          : `已载入任务：${job.stage || job.status}`)
      }
      this.startPolling(job.jobId)
    },
    startPolling(jobId?: string) {
      this.stopPolling()
      const targetId = jobId || this.activeJob?.jobId
      if (!targetId) return
      const poll = async () => {
        try {
          const response = await getRemoteCombatJob(targetId)
          let job = response.job
          if (job.status === "queued") {
            const status = await getRemoteCombatStatus()
            this.status = status
            job = status.activeJob?.jobId === targetId ? status.activeJob : job
            this.appendLog(`服务器模拟队列：当前第 ${job.queuePosition || "-"} 位，共 ${status.queuedCharacters} 人排队（30 秒后再次更新）`)
          } else {
            const signature = `${job.status}|${job.stage}|${Math.round(Number(job.progress || 0) * 10000)}`
            if (signature !== this.lastLoggedRuntimeSignature) {
              this.lastLoggedRuntimeSignature = signature
              if (job.status === "leased") this.appendLog("服务器计算节点已领取任务，等待启动")
              else if (job.status === "paused") this.appendLog(job.stage || "任务已暂停，等待可用算力")
              else if (job.status === "running") this.appendLog(`计算进度：${job.stage || `${Math.round(job.progress * 100)}%`}`)
              else if (job.status === "completed") this.appendLog("任务计算完成，结果已回传")
              else if (job.status === "cancelled") this.appendLog("任务已取消")
              else if (job.status === "failed") this.appendLog(`任务失败：${job.error || "未知错误"}`)
            }
          }
          this.activeJob = job
          if (["completed", "failed", "cancelled"].includes(job.status)) {
            await this.refresh().catch(() => undefined)
            return
          }
        } catch (error: any) {
          this.error = error?.message || "任务状态读取失败"
          this.appendLog(`状态更新失败：${this.error}，稍后自动重试`)
        }
        this.pollTimer = setTimeout(poll, this.activeJob?.status === "queued" ? 30_000 : 5_000)
      }
      void poll()
    },
    stopPolling() {
      if (this.pollTimer) clearTimeout(this.pollTimer)
      this.pollTimer = 0
    },
    async cancelActive() {
      if (!this.activeJob) return null
      const response = await cancelRemoteCombatJob(this.activeJob.jobId)
      this.activeJob = response.job
      return response.job
    }
  }
})
