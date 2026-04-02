import { useState, useEffect, useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { workflowsApi } from '../../api/client'
import type { Workflow } from '../../types'

interface WorkflowLibraryProps {
  /** Called after a workflow is loaded into the canvas, so the parent can switch tabs */
  onAfterLoad?: () => void
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return new Date(isoStr).toLocaleDateString('zh-CN')
}

// ---------- API Info Panel ----------

function ApiInfoPanel({ workflowId }: { workflowId: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/api/workflows/${workflowId}/run`

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="mt-2 rounded-xl bg-zinc-900/80 border border-emerald-500/20 p-3 text-[11px] space-y-2">
      <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M5 13l4 4L19 7" />
        </svg>
        接口已发布
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 font-mono text-zinc-400 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 truncate select-all">
          <span className="text-blue-400">POST</span>{' '}
          <span className="text-zinc-300">/api/workflows/{workflowId}/run</span>
        </div>
        <button
          onClick={copy}
          className={`shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
            copied
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
          }`}
          title="复制接口地址"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              已复制
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              复制
            </>
          )}
        </button>
      </div>

      <div className="text-zinc-600 leading-relaxed">
        可传入 <code className="text-zinc-500">param_overrides</code> 覆盖节点参数，
        返回执行对象，通过 WebSocket 订阅进度。
      </div>
    </div>
  )
}

// ---------- Workflow Card ----------

interface WorkflowCardProps {
  workflow: Workflow
  onLoad: (w: Workflow) => void
  onRename: (id: string, newName: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onTogglePublish: (w: Workflow) => Promise<void>
}

function WorkflowCard({ workflow, onLoad, onRename, onDelete, onTogglePublish }: WorkflowCardProps) {
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(workflow.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savingRename, setSavingRename] = useState(false)
  const [savingPublish, setSavingPublish] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showApi, setShowApi] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRenameValue(workflow.name)
  }, [workflow.name])

  const startRename = () => {
    setRenaming(true)
    setRenameValue(workflow.name)
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  const submitRename = async () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === workflow.name) {
      setRenaming(false)
      return
    }
    setSavingRename(true)
    try {
      await onRename(workflow.id, trimmed)
    } finally {
      setSavingRename(false)
      setRenaming(false)
    }
  }

  const handleRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submitRename()
    if (e.key === 'Escape') setRenaming(false)
  }

  const handleTogglePublish = async () => {
    setSavingPublish(true)
    try {
      await onTogglePublish(workflow)
      if (!workflow.is_published) setShowApi(true) // auto-expand on first publish
    } finally {
      setSavingPublish(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete(workflow.id)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const nodeCount = workflow.nodes?.length ?? 0

  return (
    <div
      className={`mx-2 mb-1.5 rounded-xl border transition-all duration-200 ${
        hovered
          ? 'bg-zinc-900 border-zinc-700'
          : 'bg-zinc-950 border-zinc-800/60'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        if (!renaming) setConfirmDelete(false)
      }}
    >
      <div className="px-3 py-2.5">
        {/* Name row */}
        <div className="flex items-center gap-2 mb-1">
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={handleRenameKey}
              disabled={savingRename}
              autoFocus
              className="flex-1 min-w-0 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-0.5 text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          ) : (
            <span
              className="flex-1 min-w-0 text-[13px] font-medium text-zinc-200 truncate cursor-pointer"
              onDoubleClick={startRename}
              title={workflow.name}
            >
              {workflow.name}
            </span>
          )}

          {workflow.is_published && (
            <button
              onClick={() => setShowApi((v) => !v)}
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              title="查看接口信息"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              已发布
            </button>
          )}
        </div>

        {/* Meta */}
        <div className="text-[11px] text-zinc-600 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          {nodeCount} 个节点
          <span className="text-zinc-800">·</span>
          {relativeTime(workflow.updated_at)}
        </div>

        {/* Action row (visible on hover) */}
        <div
          className={`mt-2 transition-all duration-200 overflow-hidden ${
            hovered || confirmDelete ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400 flex-1">确定删除？</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-2.5 py-1 text-[11px] rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                {deleting ? '删除中…' : '确定'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {/* Open/edit */}
              <button
                onClick={() => onLoad(workflow)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                title="在画布中打开编辑"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                编辑
              </button>

              {/* Rename */}
              <button
                onClick={startRename}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                title="重命名"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                重命名
              </button>

              {/* Publish toggle */}
              <button
                onClick={handleTogglePublish}
                disabled={savingPublish}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border transition-colors disabled:opacity-50 ${
                  workflow.is_published
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                }`}
                title={workflow.is_published ? '取消发布' : '发布为接口'}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {workflow.is_published ? '已发布' : '发布'}
              </button>

              {/* Delete */}
              <button
                onClick={() => setConfirmDelete(true)}
                className="ml-auto flex items-center px-2 py-1 text-[11px] rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-colors"
                title="删除工作流"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Published API info */}
      {workflow.is_published && showApi && (
        <div className="px-3 pb-3">
          <ApiInfoPanel workflowId={workflow.id} />
        </div>
      )}
    </div>
  )
}

// ---------- Main WorkflowLibrary ----------

export function WorkflowLibrary({ onAfterLoad }: WorkflowLibraryProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)  // start as true so spinner shows before first fetch
  const [searchQuery, setSearchQuery] = useState('')

  const { fitView } = useReactFlow()
  const { loadFromBackendFormat, setCurrentWorkflow, skills, clearChatNodes } = useWorkflowStore()

  const fetchWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await workflowsApi.list()
      setWorkflows(res.data)
    } catch (err) {
      console.error('Failed to fetch workflows:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkflows()
  }, [fetchWorkflows])

  const handleLoad = useCallback(
    (workflow: Workflow) => {
      const skillsMap = skills.reduce(
        (acc, s) => { acc[s.id] = s; return acc },
        {} as Record<string, (typeof skills)[0]>
      )
      clearChatNodes()
      loadFromBackendFormat(workflow.nodes, workflow.edges, skillsMap)
      setCurrentWorkflow(workflow)
      setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 100)
      onAfterLoad?.()
    },
    [skills, loadFromBackendFormat, setCurrentWorkflow, fitView, onAfterLoad, clearChatNodes]
  )

  const handleRename = useCallback(async (id: string, newName: string) => {
    await workflowsApi.update(id, { name: newName })
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, name: newName } : w)))
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    await workflowsApi.delete(id)
    setWorkflows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const handleTogglePublish = useCallback(async (workflow: Workflow) => {
    const next = !workflow.is_published
    await workflowsApi.update(workflow.id, { is_published: next })
    setWorkflows((prev) =>
      prev.map((w) => (w.id === workflow.id ? { ...w, is_published: next } : w))
    )
  }, [])

  const filtered = searchQuery
    ? workflows.filter((w) => w.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : workflows

  return (
    <div className="flex flex-col h-full">
      {/* Search + refresh header */}
      <div className="p-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="搜索流程..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>
          <button
            onClick={fetchWorkflows}
            disabled={loading}
            className="shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
            title="刷新列表"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <svg className="w-5 h-5 text-zinc-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-[12px] text-zinc-600">加载中…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center px-6">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-[12px] text-zinc-400 font-medium">
              {searchQuery ? '未找到匹配的流程' : '暂无已保存的流程'}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">
              {searchQuery ? '试试其他关键词' : '在画布中构建并保存工作流'}
            </p>
          </div>
        ) : (
          filtered.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onLoad={handleLoad}
              onRename={handleRename}
              onDelete={handleDelete}
              onTogglePublish={handleTogglePublish}
            />
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="p-3 border-t border-zinc-800">
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 flex gap-2.5 items-start">
          <svg className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            发布后可通过接口批量触发执行，支持传入参数覆盖，适合自动化剪辑场景。
          </p>
        </div>
      </div>
    </div>
  )
}
