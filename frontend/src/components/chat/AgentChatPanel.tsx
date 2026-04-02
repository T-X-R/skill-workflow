import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { sessionsApi } from '../../api/client'
import { useWorkflowStore } from '../../stores/workflowStore'
import type {
  ChatMessage,
  ChatMessageType,
  ChatMode,
  NodeState,
  ExecutionStatus,
  LogEntry,
  NodeStatusType,
} from '../../types'

// ─── Props ──────────────────────────────────────────────

interface AgentChatPanelProps {
  isOpen: boolean
  onToggle: () => void
  executionStatus: ExecutionStatus | null
  nodeStates: Record<string, NodeState>
  results: Record<string, any> | null
  logs: LogEntry[]
  isConnected: boolean
  workflowAgentStream: string
  onResetExecution: () => void
  onConnectWebSocket: (executionId: string) => void
}

// ─── Utility ────────────────────────────────────────────

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return ''
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function findMediaUrls(obj: any, urls: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return urls
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && /\.(mp4|webm|mov|jpg|jpeg|png|gif|mp3|wav)(\?|$)/i.test(value)) {
      urls.push(value)
    } else if (typeof value === 'object') {
      findMediaUrls(value, urls)
    }
  }
  return urls
}

// ─── Sub-components ─────────────────────────────────────

function ExecutionNodeCard({
  nodeId,
  state,
  isExpanded,
  onToggle,
  onRerunFrom,
}: {
  nodeId: string
  state: NodeState
  isExpanded: boolean
  onToggle: () => void
  onRerunFrom?: (nodeId: string) => void
}) {
  const statusConfig: Record<NodeStatusType, { icon: React.ReactNode; color: string; label: string }> = {
    pending: {
      icon: <div className="w-2 h-2 rounded-full bg-zinc-600" />,
      color: 'text-zinc-500',
      label: '等待中',
    },
    running: {
      icon: <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />,
      color: 'text-blue-400',
      label: '执行中',
    },
    success: {
      icon: (
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ),
      color: 'text-emerald-400',
      label: '完成',
    },
    failed: {
      icon: (
        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
      color: 'text-red-400',
      label: '失败',
    },
    skipped: {
      icon: (
        <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      ),
      color: 'text-yellow-400',
      label: '跳过',
    },
  }

  const config = statusConfig[state.status] || statusConfig.pending
  const duration = formatDuration(state.started_at, state.finished_at)
  const hasDetails =
    (state.logs && state.logs.length > 0) ||
    state.error ||
    (state.output && Object.keys(state.output).length > 0)

  return (
    <div className="group">
      <div
        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer hover:bg-zinc-800/50 ${
          state.status === 'running' ? 'bg-blue-500/5' : ''
        }`}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div className="shrink-0 w-5 h-5 flex items-center justify-center">{config.icon}</div>
        <div className="flex-1 min-w-0">
          <span className={`text-[13px] font-medium ${config.color}`}>{state.skill_id}</span>
        </div>
        {state.status === 'running' && (
          <span className="text-[11px] text-blue-400/70 font-mono">运行中...</span>
        )}
        {duration && <span className="text-[11px] text-zinc-500 font-mono">{duration}</span>}
        {onRerunFrom && (state.status === 'success' || state.status === 'failed') && (
          <button
            onClick={(e) => { e.stopPropagation(); onRerunFrom(nodeId) }}
            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-emerald-400 transition-all"
            title="从此节点重跑"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
        {hasDetails && (
          <svg
            className={`w-3.5 h-3.5 text-zinc-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {isExpanded && hasDetails && (
        <div className="ml-8 mt-1 mb-2 pl-3 border-l-2 border-zinc-800 space-y-2 animate-fade-in">
          {state.error && (
            <div className="text-[12px] text-red-400/90 bg-red-500/5 rounded-md px-3 py-2 font-mono leading-relaxed">
              {state.error}
            </div>
          )}
          {state.logs && state.logs.length > 0 && (
            <div className="text-[11px] text-zinc-500 font-mono bg-zinc-900/50 rounded-md px-3 py-2 max-h-[120px] overflow-y-auto leading-relaxed">
              {state.logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}
          {state.output && Object.keys(state.output).length > 0 && (
            <details className="text-[11px]">
              <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">输出数据</summary>
              <pre className="mt-1 text-zinc-500 font-mono bg-zinc-900/50 rounded-md px-3 py-2 max-h-[120px] overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(state.output, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function ExecutionTracker({
  nodeStates,
  executionStatus,
  progress,
  onPause,
  onResume,
  onRerunFrom,
  isPausing,
  isResuming,
}: {
  nodeStates: Record<string, NodeState>
  executionStatus: ExecutionStatus | null
  progress: number
  onPause: () => void
  onResume: () => void
  onRerunFrom: (nodeId: string) => void
  isPausing: boolean
  isResuming: boolean
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const sortedNodes = useMemo(() => {
    return Object.entries(nodeStates).sort((a, b) => {
      const aTime = a[1].started_at ? new Date(a[1].started_at).getTime() : Infinity
      const bTime = b[1].started_at ? new Date(b[1].started_at).getTime() : Infinity
      return aTime - bTime
    })
  }, [nodeStates])

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-zinc-800/40">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[12px] font-medium ${
              executionStatus === 'success' ? 'text-emerald-400' :
              executionStatus === 'failed' ? 'text-red-400' :
              'text-zinc-300'
            }`}>
              {executionStatus === 'running' ? '执行中' :
               executionStatus === 'paused' ? '已暂停' :
               executionStatus === 'success' ? '执行完成' :
               executionStatus === 'failed' ? '执行失败' : '执行进度'}
            </span>
            {executionStatus !== 'success' && executionStatus !== 'failed' && (
              <span className="text-[11px] font-mono text-zinc-500">{progress}%</span>
            )}
          </div>
          <div className="w-full h-1 rounded-full overflow-hidden bg-zinc-800">
            <div
              className={`h-full transition-all duration-500 ease-out rounded-full ${
                executionStatus === 'failed' ? 'bg-red-500' :
                executionStatus === 'success' ? 'bg-emerald-500' :
                'bg-gradient-to-r from-blue-500 to-cyan-400'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {executionStatus === 'running' && (
          <button
            onClick={onPause}
            disabled={isPausing}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPausing ? (
              <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            )}
            暂停
          </button>
        )}
        {executionStatus === 'paused' && (
          <button
            onClick={onResume}
            disabled={isResuming}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors disabled:opacity-50"
          >
            {isResuming ? (
              <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
            继续
          </button>
        )}
      </div>

      <div className="py-1">
        {sortedNodes.length === 0 ? (
          executionStatus === 'running' || executionStatus === 'paused' ? (
            <div className="px-4 py-6 text-center text-[12px] text-zinc-600 flex items-center justify-center gap-2">
              <div className="w-3 h-3 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
              等待节点初始化...
            </div>
          ) : null
        ) : (
          sortedNodes.map(([nodeId, state]) => (
            <ExecutionNodeCard
              key={nodeId}
              nodeId={nodeId}
              state={state}
              isExpanded={expandedNodes.has(nodeId)}
              onToggle={() => toggleNode(nodeId)}
              onRerunFrom={onRerunFrom}
            />
          ))
        )}
      </div>
    </div>
  )
}

function ExecutionResultCard({
  results,
  nodeStates,
}: {
  results: Record<string, any>
  nodeStates: Record<string, NodeState>
}) {
  const mediaUrls = useMemo(() => findMediaUrls(results), [results])
  const allOutputs = useMemo(
    () => Object.entries(nodeStates).filter(([, s]) => s.output && Object.keys(s.output).length > 0),
    [nodeStates]
  )

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-500/10 flex items-center gap-2">
        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[13px] font-medium text-emerald-300">执行结果</span>
      </div>
      <div className="p-4 space-y-3">
        {mediaUrls.length > 0 && (
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">输出媒体</span>
            {mediaUrls.map((url, i) => {
              const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url)
              const isImage = /\.(jpg|jpeg|png|gif)(\?|$)/i.test(url)
              return (
                <div key={i} className="rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800">
                  {isVideo && <video src={url} controls className="w-full max-h-[200px]" />}
                  {isImage && <img src={url} alt="" className="w-full max-h-[200px] object-contain" />}
                  <div className="px-3 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-mono truncate flex-1">{url.split('/').pop()}</span>
                    <a href={url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline ml-2 shrink-0">打开</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {allOutputs.length > 0 && (
          <details className="text-[11px]">
            <summary className="text-zinc-400 cursor-pointer hover:text-zinc-300 transition-colors font-medium">
              各节点输出详情 ({allOutputs.length})
            </summary>
            <div className="mt-2 space-y-2">
              {allOutputs.map(([nodeId, state]) => (
                <div key={nodeId} className="bg-zinc-900/60 rounded-md px-3 py-2 border border-zinc-800/50">
                  <div className="text-zinc-400 font-medium mb-1">{state.skill_id}</div>
                  <pre className="text-zinc-500 font-mono max-h-[80px] overflow-auto whitespace-pre-wrap break-all text-[10px]">
                    {JSON.stringify(state.output, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.type === 'user'
  return (
    <div className={`flex animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[92%] rounded-[20px] px-4 py-3 shadow-sm ${
          isUser
            ? 'rounded-tr-sm bg-zinc-800 text-zinc-100 border border-zinc-700'
            : 'rounded-tl-sm bg-zinc-900 text-zinc-300 border border-zinc-800/50'
        }`}
      >
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-all">{message.content}</div>
        <div className="text-[10px] mt-2 text-zinc-500 font-mono text-right">
          {message.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[92%] rounded-[20px] rounded-tl-sm bg-zinc-900 border border-zinc-800/50 px-4 py-3 shadow-sm">
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-all text-zinc-300">
          {content}
          <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-zinc-400 animate-pulse align-middle" />
        </div>
      </div>
    </div>
  )
}

function LoadingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="rounded-[20px] rounded-tl-sm bg-zinc-900 border border-zinc-800/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1">
            {[0, 150, 300].map((delay) => (
              <div
                key={delay}
                className="w-1.5 h-1.5 rounded-full bg-zinc-500"
                style={{ animation: `dot-bounce 1.4s ease-in-out ${delay}ms infinite` }}
              />
            ))}
          </div>
          <span className="text-[12px] text-zinc-500">正在思考...</span>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ mode, onSelect }: { mode: ChatMode; onSelect: (text: string) => void }) {
  const examples =
    mode === 'general'
      ? ['帮我处理一个竖屏视频', '我需要给视频加字幕', '视频画质增强']
      : ['字幕太长了，帮我重新断句', '视频画质不够清晰', '美颜效果太强了，调弱一点']

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-sm">
        <svg className="w-7 h-7 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </div>
      <h3 className="font-semibold text-[15px] mb-2 text-zinc-200 tracking-tight font-display leading-tight">
        {mode === 'general' ? 'AI 工作流助手' : 'AI 执行助手'}
      </h3>
      <p className="text-[13px] mb-8 text-zinc-500 leading-relaxed max-w-[220px]">
        {mode === 'general'
          ? '描述您想要处理的视频需求，我会帮您规划并执行所需的 Skill 流程。'
          : '工作流正在执行中，您可以提出修改意见或要求重新执行某些步骤。'}
      </p>
      <div className="w-full space-y-2">
        <p className="text-[11px] mb-3 text-zinc-600 font-medium tracking-wide uppercase">试试这些描述</p>
        {examples.map((example, i) => (
          <div
            key={i}
            onClick={() => onSelect(example)}
            className="text-[12px] px-4 py-2.5 rounded-xl text-left transition-all duration-200 bg-zinc-900/50 border border-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 cursor-pointer"
          >
            {example}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────

export function AgentChatPanel({
  isOpen,
  onToggle,
  executionStatus,
  nodeStates,
  results,
  logs: _logs,
  isConnected,
  workflowAgentStream,
  onResetExecution: _onResetExecution,
  onConnectWebSocket: _onConnectWebSocket,
}: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPausing, setIsPausing] = useState(false)
  const [isResuming, setIsResuming] = useState(false)
  const [showTracker, setShowTracker] = useState(false)

  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const prevExecutionStatusRef = useRef<ExecutionStatus | null>(null)
  const currentRunIdRef = useRef<number>(0)
  const displayedNodeRepliesRef = useRef<Set<string>>(new Set())
  const sessionsCreatedHereRef = useRef<Set<string>>(new Set())

  const {
    currentWorkflow,
    currentExecution,
    currentSessionId,
    setCurrentSessionId,
    setCurrentExecution,
    addChatPlanNodes,
    addDynamicSkillNode,
    clearChatNodes,
    updateNodeStatus,
    chatGeneratedNodeIds,
  } = useWorkflowStore()

  const mode: ChatMode = useMemo(() => {
    return executionStatus != null ? 'execution' : 'general'
  }, [executionStatus])

  // If backend reports success but a node actually failed, treat as failed
  const effectiveExecutionStatus = useMemo((): ExecutionStatus | null => {
    if (executionStatus === 'success') {
      const hasFailedNode = Object.values(nodeStates).some(s => s.status === 'failed')
      if (hasFailedNode) return 'failed'
    }
    return executionStatus
  }, [executionStatus, nodeStates])

  const progress = useMemo(() => {
    if (effectiveExecutionStatus === 'success') return 100
    if (effectiveExecutionStatus === 'failed') {
      const entries = Object.values(nodeStates)
      if (entries.length === 0) return 100
      const done = entries.filter(
        (s) => s.status === 'success' || s.status === 'failed' || s.status === 'skipped'
      ).length
      return Math.round((done / entries.length) * 100)
    }
    const entries = Object.values(nodeStates)
    if (entries.length === 0) return 0
    const done = entries.filter(
      (s) => s.status === 'success' || s.status === 'failed' || s.status === 'skipped'
    ).length
    return Math.round((done / entries.length) * 100)
  }, [nodeStates, effectiveExecutionStatus])

  const scrollToBottom = useCallback((smooth = true) => {
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, isLoading, showTracker, streamingContent, scrollToBottom])

  useEffect(() => {
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // ── Load session history when switching to an external session ──
  useEffect(() => {
    if (!currentSessionId) return
    if (sessionsCreatedHereRef.current.has(currentSessionId)) return

    let cancelled = false

    async function loadHistory() {
      setIsLoadingHistory(true)
      try {
        const resp = await sessionsApi.getMessages(currentSessionId!)
        if (cancelled) return
        const loaded: ChatMessage[] = resp.data.messages.map((m, i) => ({
          id: m.id || `history-${i}`,
          type: m.type as ChatMessageType,
          content: m.content,
          timestamp: new Date(),
        }))
        setMessages(loaded)
        setStreamingContent(null)
        setShowTracker(false)
        setTimeout(() => scrollToBottom(false), 0)
      } catch (e) {
        console.error('Failed to load session history:', e)
      } finally {
        if (!cancelled) setIsLoadingHistory(false)
      }
    }

    loadHistory()

    return () => { cancelled = true }
  }, [currentSessionId])

  // ── Read SSE stream ──────────────────────────────────

  async function readSSEStream(
    response: Response,
    onChunk: (text: string) => void,
    onEvent: (event: Record<string, any>) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') return
            if (!raw) continue
            try {
              const parsed = JSON.parse(raw)
              if (parsed.error) {
                onChunk(`\n[错误] ${parsed.error}`)
              } else if (parsed.type) {
                onEvent(parsed)
              } else if (parsed.content) {
                onChunk(parsed.content)
              }
            } catch {
              onChunk(raw)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ── Ensure session exists ────────────────────────────

  async function ensureSession(): Promise<string> {
    if (currentSessionId) return currentSessionId
    const response = await sessionsApi.create({ type: 'interactive', visible: true })
    const sessionId = response.data.id
    sessionsCreatedHereRef.current.add(sessionId)
    setCurrentSessionId(sessionId)
    return sessionId
  }

  // ── Node output reactions ────────────────────────────

  function extractAgentReply(state: NodeState): string | null {
    // Only surface explicit agent-generated messages; raw errors are already shown in node detail
    if (typeof state.output?.message === 'string' && state.output.message) return state.output.message
    return null
  }

  useEffect(() => {
    Object.entries(nodeStates).forEach(([nodeId, state]) => {
      const runKey = `${currentRunIdRef.current}-${nodeId}`
      if (displayedNodeRepliesRef.current.has(runKey)) return
      if (state.status !== 'success' && state.status !== 'failed') return
      const reply = extractAgentReply(state)
      if (!reply) return
      displayedNodeRepliesRef.current.add(runKey)
      setMessages(prev => [...prev, {
        id: `agent-reply-${runKey}`,
        type: 'agent',
        content: reply,
        timestamp: new Date(),
      }])
    })
  }, [nodeStates])

  // ── Execution lifecycle messages ─────────────────────

  useEffect(() => {
    const prev = prevExecutionStatusRef.current
    const curr = executionStatus

    if ((prev === null || prev === 'pending') && curr === 'running') {
      const workflowName = currentWorkflow?.name || '工作流'
      currentRunIdRef.current += 1
      displayedNodeRepliesRef.current = new Set()
      setShowTracker(true)
      setMessages(prev => [
        ...prev.filter(m => m.type === 'user'),
        {
          id: `sys-exec-start-${Date.now()}`,
          type: 'system',
          content: `开始执行 "${workflowName}"`,
          timestamp: new Date(),
          executionEvent: { type: 'workflow-start' },
        },
      ])
    }

    if ((prev === 'running' || prev === 'paused') && (curr === 'success' || curr === 'failed')) {
      const failedNode = Object.values(nodeStates).find(s => s.status === 'failed')
      const isEffectivelyFailed = curr === 'failed' || !!failedNode

      // Persist accumulated workflow agent stream as a chat message
      if (workflowAgentStream) {
        setMessages(prev => [...prev, {
          id: `agent-wf-${Date.now()}`,
          type: 'agent',
          content: workflowAgentStream,
          timestamp: new Date(),
        }])
      }

      if (isEffectivelyFailed) {
        setMessages(prev => [...prev, {
          id: `sys-exec-fail-${Date.now()}`,
          type: 'system',
          content: failedNode
            ? `执行失败 — "${failedNode.skill_id}"${failedNode.error ? ': ' + failedNode.error : ''}`
            : '工作流执行失败',
          timestamp: new Date(),
          executionEvent: { type: 'workflow-failed', error: failedNode?.error },
        }])
      } else {
        setMessages(prev => [...prev, {
          id: `sys-exec-done-${Date.now()}`,
          type: 'system',
          content: '工作流执行完成',
          timestamp: new Date(),
          executionEvent: { type: 'workflow-complete' },
        }])
      }
    }

    prevExecutionStatusRef.current = curr
  }, [executionStatus, currentWorkflow?.name, nodeStates])

  // ── Execution actions ───────────────────────────────

  const handlePause = useCallback(async () => {
    if (!currentExecution?.id) return
    setIsPausing(true)
    try {
      const sessionId = await ensureSession()
      await sessionsApi.sendMessageStream(sessionId, '请暂停当前执行', undefined)
      setCurrentExecution({ ...currentExecution, status: 'paused' })
    } catch (err) {
      console.error('暂停失败:', err)
    } finally {
      setIsPausing(false)
    }
  }, [currentExecution, setCurrentExecution])

  const handleResume = useCallback(async () => {
    if (!currentExecution?.id) return
    setIsResuming(true)
    try {
      const sessionId = await ensureSession()
      await sessionsApi.sendMessageStream(sessionId, '请继续执行', undefined)
      setCurrentExecution({ ...currentExecution, status: 'running' })
    } catch (err) {
      console.error('恢复失败:', err)
    } finally {
      setIsResuming(false)
    }
  }, [currentExecution, setCurrentExecution])

  const handleRerunFrom = useCallback(async (nodeId: string) => {
    if (!currentSessionId) return

    const skillId = nodeStates[nodeId]?.skill_id || nodeId
    const feedback = window.prompt(
      `从 "${skillId}" 重新执行\n\n请输入修改意见（可留空直接重跑）：`,
      '',
    )

    if (feedback === null) return

    currentRunIdRef.current += 1
    const feedbackTrimmed = feedback.trim()

    setMessages(prev => [...prev, {
      id: `sys-rerun-${Date.now()}`,
      type: 'system',
      content: feedbackTrimmed
        ? `从 "${skillId}" 重新执行，反馈：${feedbackTrimmed}`
        : `从 "${skillId}" 开始重新执行`,
      timestamp: new Date(),
    }])

    const message = feedbackTrimmed
      ? `用户对节点 ${nodeId}（${skillId}）的结果不满意：「${feedbackTrimmed}」。请根据反馈从该节点重新执行。`
      : `请从节点 ${nodeId}（${skillId}）重新执行`

    await handleSendToAgent(message)
  }, [currentSessionId, nodeStates])

  // ── Canvas event handler ────────────────────────────

  const handleCanvasEvent = useCallback((event: Record<string, any>) => {
    const { type, skill_id, steps } = event

    if (type === 'execution_plan' && Array.isArray(steps)) {
      addChatPlanNodes(steps)
      setMessages(prev => [...prev, {
        id: `sys-plan-${Date.now()}`,
        type: 'system',
        content: `已生成执行计划 (${steps.length} 个步骤)`,
        timestamp: new Date(),
      }])
      return
    }

    if (!skill_id) return

    const nodeId = `chat-${skill_id}`

    if (type === 'skill_start' || type === 'dynamic_skill') {
      if (!chatGeneratedNodeIds.has(nodeId)) {
        addDynamicSkillNode(skill_id)
      }
      updateNodeStatus(nodeId, 'running')
      return
    }

    if (type === 'skill_end') {
      updateNodeStatus(nodeId, 'success')
      return
    }

    if (type === 'skill_error') {
      updateNodeStatus(nodeId, 'failed')
    }
  }, [addChatPlanNodes, addDynamicSkillNode, updateNodeStatus, chatGeneratedNodeIds])

  // ── Core send to agent ──────────────────────────────

  async function handleSendToAgent(message: string) {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsLoading(true)
    setError(null)
    setStreamingContent('')

    try {
      const sessionId = await ensureSession()
      const response = await sessionsApi.sendMessageStream(sessionId, message, signal)

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`)
      }

      let fullContent = ''

      await readSSEStream(
        response,
        (chunk) => {
          fullContent += chunk
          setStreamingContent(fullContent)
        },
        handleCanvasEvent,
        signal,
      )

      if (fullContent) {
        setMessages(prev => [...prev, {
          id: `agent-${Date.now()}`,
          type: 'agent',
          content: fullContent,
          timestamp: new Date(),
        }])
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || signal.aborted) return
      console.error('Agent 请求失败:', err)
      setError('Agent 暂时不可用，请稍后重试')
      setMessages(prev => [...prev, {
        id: `agent-${Date.now()}`,
        type: 'agent',
        content: '抱歉，我暂时无法处理您的请求，请稍后再试。',
        timestamp: new Date(),
      }])
    } finally {
      setIsLoading(false)
      setStreamingContent(null)
    }
  }

  // ── Chat submission ─────────────────────────────────

  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    if (!isOpen) onToggle()

    await handleSendToAgent(userMessage.content)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const isActive = inputValue.trim() && !isLoading

  // ── Render ──────────────────────────────────────────

  return (
    <aside
      className={`shrink-0 flex flex-col transition-all duration-300 ease-in-out border-l border-zinc-800 bg-zinc-950 relative ${
        isOpen ? 'w-[420px]' : 'w-[0px]'
      }`}
    >
      {/* Toggle */}
      <button
        onClick={onToggle}
        className="absolute left-[-32px] top-4 w-8 h-10 bg-zinc-900 border border-zinc-800 border-r-0 rounded-l-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors z-20 shadow-sm"
      >
        <svg
          className={`w-4 h-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div
        className={`flex flex-col h-full w-[420px] overflow-hidden transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="h-[56px] flex items-center justify-between px-5 shrink-0 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 shadow-sm">
              <svg className="w-4 h-4 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-zinc-100 tracking-tight font-display leading-tight">Agent</h2>
              <p className="text-[11px] text-zinc-500 font-medium">
                {isLoadingHistory ? '加载历史...' : mode === 'general' ? '构建工作流' : '执行与调优'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                <span className="text-[10px] text-zinc-500">已连接</span>
              </div>
            )}
            {currentSessionId && (
              <button
                onClick={() => {
                  abortControllerRef.current?.abort()
                  setCurrentSessionId(null)
                  setMessages([])
                  setStreamingContent(null)
                  clearChatNodes()
                }}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors px-1.5 py-0.5 rounded"
                title="新建对话"
              >
                新对话
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin mb-3" />
              <p className="text-[12px] text-zinc-500">加载对话记录...</p>
            </div>
          ) : messages.length === 0 && !showTracker && !streamingContent ? (
            <EmptyState mode={mode} onSelect={(text) => { setInputValue(text) }} />
          ) : (
            <>
              {messages.map((message) => {
                if (message.type === 'system') {
                  const isStart = message.executionEvent?.type === 'workflow-start'
                  const isComplete = message.executionEvent?.type === 'workflow-complete'
                  const isFailed = message.executionEvent?.type === 'workflow-failed'

                  return (
                    <div key={message.id} className="space-y-3 animate-fade-in">
                      <div className="flex justify-center">
                        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium border ${
                          isComplete
                            ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20'
                            : isFailed
                            ? 'bg-red-500/5 text-red-400 border-red-500/20'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}>
                          {isStart && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          )}
                          {isComplete && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {isFailed && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {!isStart && !isComplete && !isFailed && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          {message.content}
                        </div>
                      </div>

                      {isStart && showTracker && !(
                        (effectiveExecutionStatus === 'success' || effectiveExecutionStatus === 'failed') &&
                        Object.keys(nodeStates).length === 0
                      ) && (
                        <ExecutionTracker
                          nodeStates={nodeStates}
                          executionStatus={effectiveExecutionStatus}
                          progress={progress}
                          onPause={handlePause}
                          onResume={handleResume}
                          onRerunFrom={handleRerunFrom}
                          isPausing={isPausing}
                          isResuming={isResuming}
                        />
                      )}

                      {isComplete && results && Object.keys(results).length > 0 && (
                        <ExecutionResultCard results={results} nodeStates={nodeStates} />
                      )}
                    </div>
                  )
                }

                return <MessageBubble key={message.id} message={message} />
              })}

              {/* Workflow agent stream (思维链) — shown during execution */}
              {workflowAgentStream && effectiveExecutionStatus === 'running' && (
                <StreamingBubble content={workflowAgentStream} />
              )}

              {/* Chat streaming message in progress */}
              {streamingContent ? (
                <StreamingBubble content={streamingContent} />
              ) : isLoading ? (
                <LoadingIndicator />
              ) : null}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Error strip */}
        {error && (
          <div className="px-5 py-2.5 bg-red-950/20 border-t border-red-900/30 text-red-400 text-[12px] flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Input area */}
        <div className="p-4 shrink-0 border-t border-zinc-800/60 bg-zinc-950">
          <div className="flex gap-2 items-end bg-zinc-900 border border-zinc-800 rounded-[16px] p-1.5 shadow-sm focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700 transition-all">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'general' ? '描述视频需求...' : '输入反馈或补充参数...'}
              rows={1}
              className="flex-1 min-w-0 bg-transparent px-3 py-2.5 resize-none text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none leading-relaxed"
              style={{ minHeight: '44px', maxHeight: '120px' }}
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!isActive}
              className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-[12px] transition-all duration-200 ${
                isActive
                  ? 'bg-zinc-100 text-zinc-900 hover:bg-white shadow-sm'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
