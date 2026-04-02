import { create } from 'zustand'
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react'
import type { SkillSummary, Workflow, Execution, WorkflowNode, WorkflowEdge, NodeStatusType, ExecutionPolicy, QualityGate } from '../types'

// SkillNode 数据类型
export interface SkillNodeData {
  skillId: string
  label: string
  category: string
  description: string
  hasScript: boolean
  status?: NodeStatusType
  params: Record<string, any>
  executionPolicy?: ExecutionPolicy
  conditionHint?: string
  qualityGate?: QualityGate | null
  [key: string]: unknown
}

interface WorkflowState {
  // React Flow 节点和边
  nodes: Node<SkillNodeData>[]
  edges: Edge[]
  setNodes: (nodes: Node<SkillNodeData>[]) => void
  setEdges: (edges: Edge[]) => void
  onNodesChange: (changes: NodeChange<Node<SkillNodeData>>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  onConnect: (connection: Connection) => void

  // 节点操作
  addNode: (node: Node<SkillNodeData>) => void
  removeNode: (nodeId: string) => void
  updateNodeParams: (nodeId: string, params: Record<string, any>) => void
  updateNodeStatus: (nodeId: string, status: NodeStatusType) => void
  updateNodePolicy: (nodeId: string, policy: ExecutionPolicy, conditionHint?: string) => void
  updateNodeQualityGate: (nodeId: string, qualityGate: QualityGate | null) => void
  clearCanvas: () => void

  // Chat-generated node management
  chatGeneratedNodeIds: Set<string>
  addChatPlanNodes: (steps: Array<{ skill_id: string; label?: string }>) => void
  addDynamicSkillNode: (skillId: string) => void
  clearChatNodes: () => void

  // 选中的节点
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void

  // 当前工作流
  currentWorkflow: Workflow | null
  setCurrentWorkflow: (workflow: Workflow | null) => void

  // 执行状态
  currentExecution: Execution | null
  setCurrentExecution: (execution: Execution | null) => void

  // 当前 Session（Agent 对话）
  currentSessionId: string | null
  setCurrentSessionId: (id: string | null) => void

  // Agent 面板状态
  isAgentPanelOpen: boolean
  setAgentPanelOpen: (open: boolean) => void
  toggleAgentPanel: () => void

  // Skill 列表
  skills: SkillSummary[]
  setSkills: (skills: SkillSummary[]) => void

  // Skill 分类
  categories: string[]
  setCategories: (categories: string[]) => void

  // 搜索关键字
  searchKeyword: string
  setSearchKeyword: (keyword: string) => void

  // 转换为后端格式
  toBackendFormat: () => { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
  // 从后端格式加载
  loadFromBackendFormat: (nodes: WorkflowNode[], edges: WorkflowEdge[], skillsMap: Record<string, SkillSummary>) => void
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // React Flow 节点和边
  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    })),
  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    })),
  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge(connection, state.edges),
    })),

  // 节点操作
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),
  removeNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    })),
  updateNodeParams: (nodeId, params) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } }
          : n
      ),
    })),
  updateNodeStatus: (nodeId, status) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, status } } : n
      ),
    })),
  updateNodePolicy: (nodeId, policy, conditionHint) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, executionPolicy: policy, conditionHint: conditionHint ?? n.data.conditionHint } }
          : n
      ),
    })),
  updateNodeQualityGate: (nodeId, qualityGate) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, qualityGate } }
          : n
      ),
    })),
  clearCanvas: () =>
    set({ nodes: [], edges: [], selectedNodeId: null, chatGeneratedNodeIds: new Set() }),

  // Chat-generated node management
  chatGeneratedNodeIds: new Set<string>(),

  addChatPlanNodes: (steps) => {
    const state = get()
    // Remove previous chat-generated nodes
    const prevIds = state.chatGeneratedNodeIds
    const nonChatNodes = state.nodes.filter((n) => !prevIds.has(n.id))
    const nonChatEdges = state.edges.filter(
      (e) => !prevIds.has(e.source) && !prevIds.has(e.target),
    )

    const newNodeIds = new Set<string>()
    const newNodes: Node<SkillNodeData>[] = []
    const newEdges: Edge[] = []

    // Vertical column layout starting at (300, 80), spacing 120px
    const startX = 300
    const startY = 80
    const spacing = 120

    steps.forEach((step, index) => {
      const nodeId = `chat-${step.skill_id}`
      const skill = state.skills.find((s) => s.id === step.skill_id)
      newNodeIds.add(nodeId)
      newNodes.push({
        id: nodeId,
        type: 'skillNode',
        position: { x: startX, y: startY + index * spacing },
        data: {
          skillId: step.skill_id,
          label: skill?.name || step.label || step.skill_id,
          category: skill?.category || '通用',
          description: skill?.description || '',
          hasScript: skill?.has_script || false,
          status: 'pending' as NodeStatusType,
          params: {},
          chatGenerated: true,
        },
      })

      if (index > 0) {
        const prevNodeId = `chat-${steps[index - 1].skill_id}`
        newEdges.push({
          id: `chat-edge-${prevNodeId}-${nodeId}`,
          source: prevNodeId,
          target: nodeId,
          sourceHandle: 'bottom',
          targetHandle: 'top',
        })
      }
    })

    set({
      nodes: [...nonChatNodes, ...newNodes],
      edges: [...nonChatEdges, ...newEdges],
      chatGeneratedNodeIds: newNodeIds,
    })
  },

  addDynamicSkillNode: (skillId) => {
    const state = get()
    const nodeId = `chat-${skillId}`
    if (state.chatGeneratedNodeIds.has(nodeId)) return

    const skill = state.skills.find((s) => s.id === skillId)
    const chatNodes = state.nodes.filter((n) => state.chatGeneratedNodeIds.has(n.id))
    const lastNode = chatNodes.length > 0 ? chatNodes[chatNodes.length - 1] : null
    const position = lastNode
      ? { x: lastNode.position.x, y: lastNode.position.y + 120 }
      : { x: 300, y: 80 }

    const newNode: Node<SkillNodeData> = {
      id: nodeId,
      type: 'skillNode',
      position,
      data: {
        skillId,
        label: skill?.name || skillId,
        category: skill?.category || '通用',
        description: skill?.description || '',
        hasScript: skill?.has_script || false,
        status: 'pending' as NodeStatusType,
        params: {},
        chatGenerated: true,
      },
    }

    const newEdges: Edge[] = []
    if (lastNode) {
      newEdges.push({
        id: `chat-edge-${lastNode.id}-${nodeId}`,
        source: lastNode.id,
        target: nodeId,
        sourceHandle: 'bottom',
        targetHandle: 'top',
      })
    }

    const newIds = new Set(state.chatGeneratedNodeIds)
    newIds.add(nodeId)

    set({
      nodes: [...state.nodes, newNode],
      edges: [...state.edges, ...newEdges],
      chatGeneratedNodeIds: newIds,
    })
  },

  clearChatNodes: () => {
    const state = get()
    const ids = state.chatGeneratedNodeIds
    if (ids.size === 0) return
    set({
      nodes: state.nodes.filter((n) => !ids.has(n.id)),
      edges: state.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      chatGeneratedNodeIds: new Set(),
    })
  },

  // 选中的节点
  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  // 当前工作流
  currentWorkflow: null,
  setCurrentWorkflow: (workflow) => set({ currentWorkflow: workflow }),

  // 执行状态
  currentExecution: null,
  setCurrentExecution: (execution) => set({ currentExecution: execution }),

  // 当前 Session
  currentSessionId: null,
  setCurrentSessionId: (id) => set({ currentSessionId: id }),

  // Agent 面板状态
  isAgentPanelOpen: false,
  setAgentPanelOpen: (open) => set({ isAgentPanelOpen: open }),
  toggleAgentPanel: () => set((state) => ({ isAgentPanelOpen: !state.isAgentPanelOpen })),

  // Skill 列表
  skills: [],
  setSkills: (skills) => set({ skills }),

  // Skill 分类
  categories: [],
  setCategories: (categories) => set({ categories }),

  // 搜索关键字
  searchKeyword: '',
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),

  // 转换为后端格式
  toBackendFormat: () => {
    const { nodes, edges, chatGeneratedNodeIds } = get()
    const filteredNodes = nodes.filter((n) => !chatGeneratedNodeIds.has(n.id))
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))
    const filteredEdges = edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    )
    const backendNodes: WorkflowNode[] = filteredNodes.map((n) => ({
      node_id: n.id,
      skill_id: n.data.skillId,
      position: n.position,
      params: n.data.params,
      label: n.data.label,
      execution_policy: n.data.executionPolicy || 'always',
      condition_hint: n.data.conditionHint || null,
      quality_gate: n.data.qualityGate || null,
    }))
    const backendEdges: WorkflowEdge[] = filteredEdges.map((e) => ({
      id: e.id,
      source_node_id: e.source,
      target_node_id: e.target,
      source_handle: e.sourceHandle || 'output',
      target_handle: e.targetHandle || 'input',
    }))
    return { nodes: backendNodes, edges: backendEdges }
  },

  // 从后端格式加载
  loadFromBackendFormat: (backendNodes, backendEdges, skillsMap) => {
    const nodes: Node<SkillNodeData>[] = backendNodes.map((n) => {
      const skill = skillsMap[n.skill_id]
      return {
        id: n.node_id,
        type: 'skillNode',
        position: n.position,
        data: {
          skillId: n.skill_id,
          label: n.label || skill?.name || n.skill_id,
          category: skill?.category || '通用',
          description: skill?.description || '',
          hasScript: skill?.has_script || false,
          params: n.params || {},
          executionPolicy: n.execution_policy || 'always',
          conditionHint: n.condition_hint || undefined,
          qualityGate: n.quality_gate || null,
        },
      }
    })
    const edges: Edge[] = backendEdges.map((e) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_handle,
      targetHandle: e.target_handle,
    }))
    set({ nodes, edges })
  },

}))
