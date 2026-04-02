import { ReactFlowProvider } from '@xyflow/react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { WorkflowCanvas, WorkflowToolbar, NodeConfigPanel } from '../workflow'
import { AgentChatPanel } from '../chat'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useExecution } from '../../hooks/useExecution'

export function MainLayout() {
  const {
    currentWorkflow,
    setCurrentWorkflow,
    selectedNodeId,
    clearCanvas,
    isAgentPanelOpen,
    toggleAgentPanel,
  } = useWorkflowStore()

  const {
    connectWebSocket,
    isConnected,
    logs,
    nodeStates,
    executionStatus,
    results,
    workflowAgentStream,
    resetState,
  } = useExecution()

  const handleNameChange = (name: string) => {
    if (currentWorkflow) {
      setCurrentWorkflow({ ...currentWorkflow, name })
    } else {
      setCurrentWorkflow({
        id: '',
        name,
        description: '',
        nodes: [],
        edges: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  const handleNew = () => {
    const confirmed = useWorkflowStore.getState().nodes.length === 0 ||
      window.confirm('确定要新建工作流吗？当前未保存的修改将会丢失。')
    if (confirmed) {
      clearCanvas()
      setCurrentWorkflow(null)
    }
  }

  return (
    <ReactFlowProvider>
      <div className="h-screen w-screen flex flex-col bg-[var(--color-bg)] overflow-hidden noise-overlay">
        <Header
          workflowName={currentWorkflow?.name || '未命名工作流'}
          onNameChange={handleNameChange}
          onNew={handleNew}
        />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />

          <main className="flex-1 flex overflow-hidden relative">
            <div className="flex-1 relative bg-[var(--color-bg)]">
              <WorkflowToolbar
                onExecutionStart={(executionId) => {
                  resetState()
                  connectWebSocket(executionId)
                }}
              />
              <WorkflowCanvas />
            </div>
            {selectedNodeId && <NodeConfigPanel />}
          </main>

          <AgentChatPanel
            isOpen={isAgentPanelOpen}
            onToggle={toggleAgentPanel}
            executionStatus={executionStatus}
            nodeStates={nodeStates}
            results={results}
            logs={logs}
            isConnected={isConnected}
            workflowAgentStream={workflowAgentStream}
            onResetExecution={resetState}
            onConnectWebSocket={connectWebSocket}
          />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
