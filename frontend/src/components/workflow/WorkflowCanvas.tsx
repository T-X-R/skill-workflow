import { useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type OnSelectionChangeFunc,
  type IsValidConnection,
  BackgroundVariant,
  MarkerType,
  ConnectionMode,
} from '@xyflow/react'
import { SkillNode } from './SkillNode'
import { useWorkflowStore, type SkillNodeData } from '../../stores/workflowStore'
import { skillsApi } from '../../api/client'
import type { Node } from '@xyflow/react'

// 注册自定义节点类型
const nodeTypes = {
  skillNode: SkillNode,
}

// 生成唯一节点 ID
function generateNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export function WorkflowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNodeId,
  } = useWorkflowStore()

  // 处理拖拽悬停
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  // 处理拖放
  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()

      // 获取拖拽数据
      const dataStr = event.dataTransfer.getData('application/json')
      if (!dataStr) return

      try {
        const { skillId } = JSON.parse(dataStr)
        if (!skillId) return

        // 获取 Skill 详情
        const response = await skillsApi.getDetail(skillId)
        const skill = response.data

        // 计算放置位置
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })

        // 创建新节点
        const newNode: Node<SkillNodeData> = {
          id: generateNodeId(),
          type: 'skillNode',
          position,
          data: {
            skillId: skill.id,
            label: skill.name,
            category: skill.category,
            description: skill.description,
            hasScript: skill.has_script,
            params: {},
          },
        }

        // 设置默认参数值
        skill.params.forEach((param) => {
          if (param.default !== null && param.default !== undefined) {
            newNode.data.params[param.name] = param.default
          }
        })

        addNode(newNode)
      } catch (error) {
        console.error('Failed to add node:', error)
      }
    },
    [addNode, screenToFlowPosition]
  )

  // 只阻止节点自连接，方向由拖拽起点决定（Loose 模式）
  const isValidConnection = useCallback<IsValidConnection>((connection) => {
    return connection.source !== connection.target
  }, [])

  // 处理选中变化
  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      if (selectedNodes.length === 1) {
        setSelectedNodeId(selectedNodes[0].id)
      } else {
        setSelectedNodeId(null)
      }
    },
    [setSelectedNodeId]
  )

  // MiniMap 节点颜色
  const nodeColor = useCallback(() => {
    return '#27272a' // zinc-800
  }, [])

  // 空状态提示
  const emptyState = useMemo(() => {
    if (nodes.length > 0) return null

    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-center mb-5 shadow-sm">
            <svg
              className="w-8 h-8 text-zinc-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
              />
            </svg>
          </div>

          <h3 className="text-[15px] font-semibold mb-2 text-zinc-300 tracking-tight font-display">
            构建你的工作流
          </h3>
          <p className="text-[13px] text-zinc-500 max-w-[240px] leading-relaxed">
            从左侧拖拽 Skill 节点到此处，或使用右侧 Agent 助手通过自然语言自动构建。
          </p>
        </div>
      </div>
    )
  }, [nodes.length])

  return (
    <div ref={reactFlowWrapper} className="w-full h-full bg-zinc-950">
      {emptyState}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSelectionChange={handleSelectionChange}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-transparent"
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: 'rgba(161,161,170,0.5)', strokeWidth: 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: 'rgba(161,161,170,0.8)',
          },
        }}
        connectionLineStyle={{ stroke: '#10b981', strokeWidth: 2 }}
        connectionLineContainerStyle={{ zIndex: 1000 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(255,255,255,0.06)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={nodeColor}
          maskColor="rgba(9, 9, 11, 0.85)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}
