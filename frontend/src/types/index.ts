// ============== Skill 相关 ==============

export interface SkillParam {
  name: string
  type: string  // "string" | "number" | "boolean" | "select"
  description: string
  required: boolean
  default: any
  options?: string[]
}

export interface SkillIO {
  name: string
  type: string
  description: string
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  category: string
  has_script: boolean
}

export interface SkillMeta extends SkillSummary {
  inputs: SkillIO[]
  outputs: SkillIO[]
  params: SkillParam[]
  skill_md_content: string
  script_path: string | null
}

// ============== Workflow 相关 ==============

export interface Position {
  x: number
  y: number
}

export type ExecutionPolicy = 'always' | 'agent_decides' | 'skip'

export interface QualityGate {
  strategy: 'self_review' | 'metric_check' | 'none'
  criteria: string
  max_retries: number
  fallback: 'use_original' | 'skip' | 'fail'
}

export interface WorkflowNode {
  node_id: string
  skill_id: string
  position: Position
  params: Record<string, any>
  label: string
  execution_policy?: ExecutionPolicy
  condition_hint?: string | null
  quality_gate?: QualityGate | null
}

export interface WorkflowEdge {
  id: string
  source_node_id: string
  target_node_id: string
  source_handle: string
  target_handle: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  created_at: string
  updated_at: string
  is_draft?: boolean
  is_published?: boolean
}

// ============== Execution 相关 ==============

export type ExecutionStatus = 'pending' | 'running' | 'paused' | 'success' | 'failed'
export type NodeStatusType = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export type QualityVerdict = 'passed' | 'failed' | 'skipped'

export interface QualityResult {
  verdict: QualityVerdict
  strategy: 'self_review' | 'metric_check' | 'none'
  retries_used: number
  max_retries: number
  fallback_applied: 'use_original' | 'skip' | 'fail' | null
  details: string
}

export interface NodeState {
  node_id: string
  skill_id: string
  status: NodeStatusType
  started_at: string | null
  finished_at: string | null
  output: Record<string, any>
  error: string | null
  logs: string[]
  quality_result?: QualityResult | null
}

export interface LogEntry {
  timestamp: string
  node_id: string | null
  level: string
  message: string
}

export interface Execution {
  id: string
  workflow_id: string
  status: ExecutionStatus
  node_states: Record<string, NodeState>
  context: Record<string, any>
  logs: LogEntry[]
  results: Record<string, any>
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface ExecutionStartResponse {
  id: string
  session_id: string
  workflow_id: string
  status: string
  message: string
}

// ============== Session 相关 ==============

export type SessionType = 'interactive' | 'batch'
export type SessionStatus = 'active' | 'completed' | 'failed' | 'cancelled'

export interface Artifact {
  key: string
  file_path: string
  media_type: string
  node_id?: string | null
  skill_id?: string | null
  created_at: string
}

export interface Session {
  id: string
  type: SessionType
  external_ref?: string | null
  workflow_id?: string | null
  execution_id?: string | null
  artifacts?: Record<string, Artifact>
  artifact_count?: number
  visible: boolean
  status: SessionStatus | string
  created_at: string
  updated_at: string
}

export interface SessionCreate {
  type?: SessionType
  external_ref?: string | null
  workflow_id?: string | null
  visible?: boolean
}

// ============== Chat 相关 ==============

export type ChatMode = 'general' | 'execution'

export type ChatMessageType = 'user' | 'agent' | 'system'

export type ExecutionEventType =
  | 'workflow-start'
  | 'node-update'
  | 'workflow-complete'
  | 'workflow-failed'

export interface ExecutionEventData {
  type: ExecutionEventType
  nodeId?: string
  skillId?: string
  skillName?: string
  nodeStatus?: NodeStatusType
  duration?: string
  error?: string | null
  logs?: string[]
  output?: Record<string, any>
  results?: Record<string, any>
  nodeStates?: Record<string, NodeState>
  progress?: number
}

export interface ChatMessage {
  id: string
  type: ChatMessageType
  content: string
  timestamp: Date
  executionEvent?: ExecutionEventData
}
