import { useState, useEffect, useCallback, useMemo } from 'react'
import { sessionsApi, workflowsApi } from '../../api/client'
import { useWorkflowStore } from '../../stores/workflowStore'
import type { Session, Workflow, SkillSummary } from '../../types'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active: { label: '进行中', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  success: { label: '已完成', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  failed: { label: '失败', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  paused: { label: '已暂停', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  cancelled: { label: '已取消', color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin}分钟前 · ${timeStr}`

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `今天 ${timeStr}`

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay === 1) return `昨天 ${timeStr}`
  if (diffDay < 7) return `${diffDay}天前 · ${timeStr}`

  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + timeStr
}

interface SessionListProps {
  onSessionSelect?: (session: Session) => void
}

export function SessionList({ onSessionSelect }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [workflows, setWorkflows] = useState<Record<string, Workflow>>({})
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchKeyword, setSearchKeyword] = useState('')

  const {
    currentSessionId,
    setCurrentSessionId,
    setAgentPanelOpen,
    loadFromBackendFormat,
    skills,
    clearCanvas,
    clearChatNodes,
  } = useWorkflowStore()

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      const [sessResp, wfResp] = await Promise.all([
        sessionsApi.list(true),
        workflowsApi.list(),
      ])
      setSessions(sessResp.data.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ))
      const wfMap: Record<string, Workflow> = {}
      for (const wf of wfResp.data) {
        wfMap[wf.id] = wf
      }
      setWorkflows(wfMap)
    } catch (e) {
      console.error('Failed to fetch sessions:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleSelect = useCallback(async (session: Session) => {
    setCurrentSessionId(session.id)
    setAgentPanelOpen(true)

    if (session.workflow_id && workflows[session.workflow_id]) {
      const wf = workflows[session.workflow_id]
      const skillsMap: Record<string, SkillSummary> = {}
      for (const s of skills) {
        skillsMap[s.id] = s
      }
      loadFromBackendFormat(wf.nodes, wf.edges, skillsMap)
    } else {
      clearCanvas()
    }

    onSessionSelect?.(session)
  }, [workflows, skills, setCurrentSessionId, setAgentPanelOpen, loadFromBackendFormat, clearCanvas, onSessionSelect])

  const handleDelete = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (deletingId) return
    setDeletingId(sessionId)
    try {
      await sessionsApi.delete(sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null)
        clearChatNodes()
        clearCanvas()
      }
    } catch (e) {
      console.error('Failed to delete session:', e)
    } finally {
      setDeletingId(null)
    }
  }, [deletingId, currentSessionId, setCurrentSessionId, clearChatNodes, clearCanvas])

  const filteredSessions = useMemo(() => {
    if (!searchKeyword) return sessions
    const kw = searchKeyword.toLowerCase()
    return sessions.filter((s) => {
      const wfName = s.workflow_id ? workflows[s.workflow_id]?.name : null
      return (
        s.id.toLowerCase().includes(kw) ||
        (s.external_ref && s.external_ref.toLowerCase().includes(kw)) ||
        (wfName && wfName.toLowerCase().includes(kw)) ||
        s.status.toLowerCase().includes(kw)
      )
    })
  }, [sessions, searchKeyword, workflows])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center px-6">
        <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin mb-3" />
        <p className="text-[12px] text-zinc-500">加载会话列表...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + Refresh header */}
      <div className="p-4 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500">
            Sessions
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
              {sessions.length}
            </span>
            <button
              onClick={fetchSessions}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="刷新"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative group">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="搜索会话..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-8 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
          />
          {searchKeyword && (
            <button
              onClick={() => setSearchKeyword('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-[13px] text-zinc-400 font-medium">
              {searchKeyword ? '未找到匹配的会话' : '暂无会话记录'}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">
              {searchKeyword ? '请尝试其他关键词' : '使用右侧 Agent 开始对话'}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = currentSessionId === session.id
            const statusConf = STATUS_CONFIG[session.status] || STATUS_CONFIG.active
            const wfName = session.workflow_id ? workflows[session.workflow_id]?.name : null

            return (
              <div
                key={session.id}
                onClick={() => handleSelect(session)}
                className={`group relative mx-2 mb-1 px-3 py-3 rounded-xl cursor-pointer transition-all duration-200 border ${
                  isActive
                    ? 'bg-zinc-800/80 border-zinc-600'
                    : 'bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-md ${statusConf.bg} ${statusConf.color} ${statusConf.border} border`}>
                        {session.status === 'active' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        )}
                        {statusConf.label}
                      </span>
                      <span className={`text-[10px] rounded-md px-1.5 py-0.5 border ${
                        session.type === 'interactive'
                          ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}>
                        {session.type === 'interactive' ? '交互' : '批量'}
                      </span>
                    </div>

                    {/* Workflow name or session ID */}
                    <p className={`text-[13px] font-medium truncate ${
                      isActive ? 'text-zinc-100' : 'text-zinc-300'
                    }`}>
                      {wfName || `Session ${session.id.slice(0, 16)}...`}
                    </p>

                    {/* Meta info */}
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] text-zinc-500">
                        {formatTime(session.updated_at)}
                      </span>
                      {session.artifact_count != null && session.artifact_count > 0 && (
                        <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {session.artifact_count} 产物
                        </span>
                      )}
                      {session.external_ref && (
                        <span className="text-[10px] text-zinc-600 truncate max-w-[100px]" title={session.external_ref}>
                          ref: {session.external_ref}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(e, session.id)}
                    className={`shrink-0 mt-1 p-1 rounded-md transition-all ${
                      deletingId === session.id
                        ? 'text-red-400 bg-red-500/10'
                        : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10'
                    }`}
                    title="删除会话"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 flex gap-3 items-start">
          <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            选择一个会话即可查看历史对话和关联的工作流节点。
          </p>
        </div>
      </div>
    </div>
  )
}
