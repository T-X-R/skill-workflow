import { useRef, useState, useCallback, useEffect } from 'react'
import { useWorkflowStore } from '../stores/workflowStore'
import type { LogEntry, NodeState, ExecutionStatus, NodeStatusType } from '../types'

// WebSocket 消息类型
interface WsMessage {
  type: 'connected' | 'node_status' | 'log' | 'execution_status' | 'heartbeat' | 'pong' | 'error'
  data: any
}

interface NodeStatusData {
  node_id: string
  skill_id: string
  status: NodeStatusType
  started_at: string | null
  finished_at: string | null
  output: Record<string, any>
  error: string | null
  logs: string[]
}

interface ExecutionStatusData {
  execution_id: string
  workflow_id?: string
  status: ExecutionStatus
  node_states?: Record<string, NodeStatusData>
  logs?: LogEntry[]
  results?: Record<string, any>
  started_at: string | null
  finished_at: string | null
  created_at?: string
  context?: Record<string, any>
}

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY = 3000
const MAX_LOGS = 500

export function useExecution() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const executionIdRef = useRef<string | null>(null)
  const connectWebSocketRef = useRef<((executionId: string) => void) | undefined>(undefined)

  const [isConnected, setIsConnected] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({})
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus | null>(null)
  const [results, setResults] = useState<Record<string, any> | null>(null)
  // Accumulated agent text streamed during workflow execution
  const [workflowAgentStream, setWorkflowAgentStream] = useState<string>('')

  const { updateNodeStatus, setCurrentExecution, currentExecution } = useWorkflowStore()

  // 清理重连定时器
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  // 处理 WebSocket 消息
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WsMessage = JSON.parse(event.data)

      switch (message.type) {
        case 'connected':
          console.log('WebSocket 已连接:', message.data.message)
          break

        case 'node_status': {
          const nodeData = message.data as NodeStatusData
          // 更新本地 nodeStates
          setNodeStates(prev => ({
            ...prev,
            [nodeData.node_id]: {
              node_id: nodeData.node_id,
              skill_id: nodeData.skill_id,
              status: nodeData.status,
              started_at: nodeData.started_at,
              finished_at: nodeData.finished_at,
              output: nodeData.output || {},
              error: nodeData.error,
              logs: nodeData.logs || [],
            }
          }))
          // 更新画布节点状态
          updateNodeStatus(nodeData.node_id, nodeData.status)
          break
        }

        case 'log': {
          const logEntry = message.data as LogEntry
          setLogs(prev => {
            const newLogs = [...prev, logEntry]
            // 限制日志数量
            if (newLogs.length > MAX_LOGS) {
              return newLogs.slice(-MAX_LOGS)
            }
            return newLogs
          })
          break
        }

        case 'execution_status': {
          const execData = message.data as ExecutionStatusData
          setExecutionStatus(execData.status)

          // 如果包含完整的节点状态，更新
          if (execData.node_states) {
            const newNodeStates: Record<string, NodeState> = {}
            for (const [nodeId, ns] of Object.entries(execData.node_states)) {
              newNodeStates[nodeId] = {
                node_id: ns.node_id,
                skill_id: ns.skill_id,
                status: ns.status,
                started_at: ns.started_at,
                finished_at: ns.finished_at,
                output: ns.output || {},
                error: ns.error,
                logs: ns.logs || [],
              }
              // 同步更新画布节点
              updateNodeStatus(nodeId, ns.status)
            }
            setNodeStates(newNodeStates)
          }

          // 如果包含日志，更新
          if (execData.logs && execData.logs.length > 0) {
            setLogs(execData.logs.slice(-MAX_LOGS))
          }

          // 如果包含结果，更新
          if (execData.results) {
            setResults(execData.results)
          }

          // 更新 currentExecution
          if (currentExecution && execData.execution_id === currentExecution.id) {
            setCurrentExecution({
              ...currentExecution,
              status: execData.status,
              started_at: execData.started_at,
              finished_at: execData.finished_at,
              results: execData.results || currentExecution.results,
            })
          }
          break
        }

        case 'agent_chunk': {
          const { content } = message.data as { content: string }
          if (content) {
            setWorkflowAgentStream(prev => prev + content)
          }
          break
        }

        case 'heartbeat':
        case 'pong':
          // 心跳响应，不需要处理
          break

        case 'error':
          console.error('WebSocket 错误:', message.data.message)
          break

        default:
          console.log('未知消息类型:', message.type)
      }
    } catch (error) {
      console.error('解析 WebSocket 消息失败:', error)
    }
  }, [updateNodeStatus, setCurrentExecution, currentExecution])

  // 连接 WebSocket
  const connectWebSocket = useCallback((executionId: string) => {
    // 如果已有连接，先断开
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    clearReconnectTimeout()
    executionIdRef.current = executionId

    // 构建 WebSocket URL（通过 Vite 代理）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/execution/${executionId}`

    console.log('正在连接 WebSocket:', wsUrl)

    try {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('WebSocket 已连接')
        setIsConnected(true)
        reconnectAttemptRef.current = 0
      }

      ws.onmessage = handleMessage

      ws.onerror = (error) => {
        console.error('WebSocket 错误:', error)
      }

      ws.onclose = (event) => {
        console.log('WebSocket 已关闭:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null

        // 非正常关闭且不是手动断开，尝试重连
        if (event.code !== 1000 && event.code !== 4004 && executionIdRef.current) {
          // 延迟重连
          const currentExecutionId = executionIdRef.current
          if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptRef.current += 1
            console.log(`WebSocket 尝试重连 (${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})...`)
            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (executionIdRef.current === currentExecutionId) {
                connectWebSocketRef.current?.(currentExecutionId)
              }
            }, RECONNECT_DELAY)
          } else {
            console.error('WebSocket 重连次数已达上限')
          }
        }
      }

      wsRef.current = ws
    } catch (error) {
      console.error('创建 WebSocket 失败:', error)
    }
  }, [handleMessage, clearReconnectTimeout])

  // 保持 ref 更新
  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket
  }, [connectWebSocket])

  // 断开 WebSocket
  const disconnectWebSocket = useCallback(() => {
    clearReconnectTimeout()
    executionIdRef.current = null
    reconnectAttemptRef.current = 0

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect')
      wsRef.current = null
    }

    setIsConnected(false)
  }, [clearReconnectTimeout])

  // 重置所有状态
  const resetState = useCallback(() => {
    setLogs([])
    setNodeStates({})
    setExecutionStatus(null)
    setResults(null)
    setWorkflowAgentStream('')
  }, [])

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      disconnectWebSocket()
    }
  }, [disconnectWebSocket])

  return {
    connectWebSocket,
    isConnected,
    logs,
    nodeStates,
    executionStatus,
    results,
    workflowAgentStream,
    resetState,
  }
}
