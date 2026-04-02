import { useState, useCallback, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { useWorkflowStore, type SkillNodeData } from '../../stores/workflowStore'
import { workflowsApi, executionsApi } from '../../api/client'
import type { Workflow } from '../../types'
import type { Node, Edge } from '@xyflow/react'

// 工作流列表弹窗组件
function WorkflowListModal({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean
  onClose: () => void
  onSelect: (workflow: Workflow) => void
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 加载工作流列表
  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const response = await workflowsApi.list()
      setWorkflows(response.data)
    } catch (error) {
      console.error('Failed to load workflows:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开时加载（用 useEffect 避免在 render 阶段直接触发 setState）
  useEffect(() => {
    if (isOpen) {
      loadWorkflows()
    }
  }, [isOpen, loadWorkflows])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-[520px] max-h-[75vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/50">
          <h3 className="font-semibold text-[14px] text-zinc-100 font-display">加载工作流</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="搜索工作流..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-6 h-6 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
              <span className="text-[12px] text-zinc-500">加载中...</span>
            </div>
          ) : (() => {
            const filtered = searchQuery
              ? workflows.filter((w) => w.name.toLowerCase().includes(searchQuery.toLowerCase()))
              : workflows
            return filtered.length > 0 ? (
            <div className="space-y-1.5">
              {filtered.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => {
                    onSelect(wf)
                    onClose()
                  }}
                  className="w-full text-left p-4 hover:bg-zinc-900 rounded-xl transition-all duration-200 border border-transparent hover:border-zinc-800 group"
                >
                  <div className="font-medium text-[13px] text-zinc-200 group-hover:text-emerald-400 transition-colors mb-1">{wf.name}</div>
                  {wf.description && (
                    <div className="text-[12px] text-zinc-500 line-clamp-1 mb-2 leading-relaxed">{wf.description}</div>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-zinc-600 font-mono">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      {wf.nodes.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {new Date(wf.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-[13px] text-zinc-500">
              {searchQuery ? '未找到匹配的工作流' : '暂无保存的工作流'}
            </div>
          )
          })()}
        </div>
      </div>
    </div>
  )
}

// 自动布局函数
function getLayoutedElements(
  nodes: Node<SkillNodeData>[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR'
) {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80 })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 180, height: 60 })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 110,
        y: nodeWithPosition.y - 40,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

export function WorkflowToolbar({ onExecutionStart }: { onExecutionStart?: (executionId: string) => void }) {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    currentWorkflow,
    setCurrentWorkflow,
    setCurrentExecution,
    setAgentPanelOpen,
    toBackendFormat,
    loadFromBackendFormat,
    skills,
    clearCanvas,
    clearChatNodes,
  } = useWorkflowStore()

  const { fitView } = useReactFlow()
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [executing, setExecuting] = useState(false)
  const [showLoadModal, setShowLoadModal] = useState(false)

  // 保存工作流
  // isDraft=true: auto-save before execution (not shown in load list)
  // isDraft=false (default): explicit user save (shown in load list)
  const handleSave = useCallback(async (isDraft: boolean = false) => {
    if (nodes.length === 0) return

    setSaving(true)
    try {
      const { nodes: backendNodes, edges: backendEdges } = toBackendFormat()
      const data = {
        name: currentWorkflow?.name || '未命名工作流',
        description: currentWorkflow?.description || '',
        nodes: backendNodes,
        edges: backendEdges,
        is_draft: isDraft,
      }

      let workflow: Workflow
      if (currentWorkflow?.id) {
        const response = await workflowsApi.update(currentWorkflow.id, data)
        workflow = response.data
      } else {
        const response = await workflowsApi.create(data)
        workflow = response.data
      }
      setCurrentWorkflow(workflow)
      if (!isDraft) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 2000)
      }
    } catch (error) {
      console.error('Failed to save workflow:', error)
      if (!isDraft) {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 2500)
      }
    } finally {
      setSaving(false)
    }
  }, [nodes.length, toBackendFormat, currentWorkflow, setCurrentWorkflow])

  // 执行工作流
  const handleExecute = useCallback(async () => {
    if (!currentWorkflow?.id) {
      // Auto-save as draft before execution
      await handleSave(true)
    }

    const workflowId = currentWorkflow?.id || useWorkflowStore.getState().currentWorkflow?.id
    if (!workflowId) return

    setExecuting(true)
    try {
      const response = await executionsApi.start({ workflow_id: workflowId })
      const startResp = response.data

      setCurrentExecution({
        id: startResp.id,
        workflow_id: startResp.workflow_id,
        status: startResp.status as any,
        node_states: {},
        context: {},
        logs: [],
        results: {},
        started_at: new Date().toISOString(),
        finished_at: null,
        created_at: new Date().toISOString(),
      })

      setAgentPanelOpen(true)

      if (onExecutionStart && startResp.id) {
        onExecutionStart(startResp.id)
      }
    } catch (error) {
      console.error('Failed to start execution:', error)
    } finally {
      setExecuting(false)
    }
  }, [currentWorkflow?.id, handleSave, setCurrentExecution, setAgentPanelOpen, onExecutionStart])

  // 清空画布
  const handleClear = useCallback(() => {
    if (nodes.length === 0) return

    const confirmed = window.confirm('确定要清空画布吗？此操作不可撤销。')
    if (confirmed) {
      clearCanvas()
      setCurrentWorkflow(null)
    }
  }, [nodes.length, clearCanvas, setCurrentWorkflow])

  // 加载工作流
  const handleLoadWorkflow = useCallback(
    (workflow: Workflow) => {
      // 创建 skills 映射
      const skillsMap = skills.reduce(
        (acc, s) => {
          acc[s.id] = s
          return acc
        },
        {} as Record<string, (typeof skills)[0]>
      )

      clearChatNodes()
      loadFromBackendFormat(workflow.nodes, workflow.edges, skillsMap)
      setCurrentWorkflow(workflow)
      setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 100)
    },
    [skills, loadFromBackendFormat, setCurrentWorkflow, fitView, clearChatNodes]
  )

  // 自动布局
  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges)
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 100)
  }, [nodes, edges, setNodes, setEdges, fitView])

  return (
    <>
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1.5 bg-zinc-950/80 backdrop-blur-md border border-zinc-800/80 rounded-[16px] shadow-lg">
        {/* 保存按钮 */}
        <button
          onClick={() => handleSave(false)}
          disabled={saving || nodes.length === 0}
          className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
            saveStatus === 'success'
              ? 'text-emerald-400 bg-emerald-500/10'
              : saveStatus === 'error'
                ? 'text-red-400 bg-red-500/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
          }`}
          title="保存工作流"
        >
          {saving ? (
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : saveStatus === 'success' ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : saveStatus === 'error' ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          )}
          <span>
            {saveStatus === 'success' ? '已保存' : saveStatus === 'error' ? '保存失败' : '保存'}
          </span>
        </button>

        <div className="w-[1px] h-4 bg-zinc-800" />

        {/* 执行按钮 */}
        <button
          onClick={handleExecute}
          disabled={executing || nodes.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-zinc-900 bg-zinc-100 hover:bg-white rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          title="执行工作流"
        >
          {executing ? (
            <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span>运行</span>
        </button>

        <div className="w-[1px] h-4 bg-zinc-800" />

        {/* 加载按钮 */}
        <button
          onClick={() => setShowLoadModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-xl transition-all duration-200 active:scale-[0.97] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          title="加载工作流"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span>加载</span>
        </button>

        {/* 自动布局按钮 */}
        <button
          onClick={handleAutoLayout}
          disabled={nodes.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          title="自动布局"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <span>整理</span>
        </button>

        <div className="w-[1px] h-4 bg-zinc-800" />

        {/* 清空按钮 */}
        <button
          onClick={handleClear}
          disabled={nodes.length === 0}
          className="flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed text-red-400 hover:bg-red-950/30"
          title="清空画布"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* 加载工作流弹窗 */}
      <WorkflowListModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onSelect={handleLoadWorkflow}
      />
    </>
  )
}
