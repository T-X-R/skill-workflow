import axios from 'axios'
import type { SkillSummary, SkillMeta, Workflow, ExecutionStartResponse, Execution, Session, SessionCreate, Artifact } from '../types'

const api = axios.create({
  baseURL: '/api',
})

// Skills API
export const skillsApi = {
  list: (params?: { category?: string; search?: string }) =>
    api.get<SkillSummary[]>('/skills/', { params }),
  getCategories: () => api.get<string[]>('/skills/categories'),
  getDetail: (skillId: string) => api.get<SkillMeta>(`/skills/${skillId}`),
}

// Workflows API
export const workflowsApi = {
  list: () => api.get<Workflow[]>('/workflows/'),
  create: (data: { name?: string; description?: string; nodes?: any[]; edges?: any[]; is_draft?: boolean }) =>
    api.post<Workflow>('/workflows/', data),
  get: (id: string) => api.get<Workflow>(`/workflows/${id}`),
    update: (id: string, data: Partial<Workflow> & { is_draft?: boolean; is_published?: boolean }) =>
    api.put<Workflow>(`/workflows/${id}`, data),
  delete: (id: string) => api.delete(`/workflows/${id}`),
}

// Executions API
export const executionsApi = {
  start: (data: { workflow_id: string; param_overrides?: Record<string, any> }) =>
    api.post<ExecutionStartResponse>('/executions/', data),
  list: (workflowId?: string) =>
    api.get<Execution[]>('/executions/', { params: { workflow_id: workflowId } }),
  get: (id: string) => api.get<Execution>(`/executions/${id}`),
  pause: (id: string) => api.post<Execution>(`/executions/${id}/pause`),
  resume: (id: string) => api.post<Execution>(`/executions/${id}/resume`),
  resumeFrom: (id: string, nodeId: string) =>
    api.post<Execution>(`/executions/${id}/resume-from/${nodeId}`),
}

// Sessions API
export const sessionsApi = {
  create: (data: SessionCreate) =>
    api.post<Session>('/sessions/', data),
  list: (all?: boolean) =>
    api.get<Session[]>('/sessions/', { params: { all } }),
  get: (id: string) =>
    api.get<Session>(`/sessions/${id}`),
  findByRef: (ref: string) =>
    api.get<Session[]>(`/sessions/by-ref/${ref}`),
  getArtifacts: (id: string) =>
    api.get<Record<string, Artifact>>(`/sessions/${id}/artifacts`),
  delete: (id: string) =>
    api.delete(`/sessions/${id}`),
  getMessages: (id: string) =>
    api.get<{ session_id: string; messages: Array<{ id: string; type: string; content: string }> }>(`/sessions/${id}/messages`),
  getExecutionLog: (id: string) =>
    api.get<{ session_id: string; events: any[] }>(`/sessions/${id}/execution-log`),

  /**
   * POST to sessions/{id}/messages and stream the SSE response.
   * Returns the fetch Response so the caller can read .body as a ReadableStream.
   */
  sendMessageStream: (sessionId: string, message: string, signal?: AbortSignal): Promise<Response> =>
    fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
      signal,
    }),
}

export default api
