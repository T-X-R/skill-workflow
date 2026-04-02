import { useState, useEffect, useCallback } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { skillsApi } from '../../api/client'
import type { SkillMeta, SkillParam, ExecutionPolicy, QualityGate } from '../../types'

// 参数输入组件
function ParamInput({
  param,
  value,
  onChange,
}: {
  param: SkillParam
  value: any
  onChange: (name: string, value: any) => void
}) {
  const handleChange = useCallback(
    (newValue: any) => {
      onChange(param.name, newValue)
    },
    [param.name, onChange]
  )

  // 字符串输入
  if (param.type === 'string') {
    return (
      <input
        type="text"
        value={value ?? param.default ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={param.default?.toString() || ''}
        className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm"
      />
    )
  }

  // 数字输入
  if (param.type === 'number') {
    return (
      <input
        type="number"
        value={value ?? param.default ?? ''}
        onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : null)}
        placeholder={param.default?.toString() || ''}
        className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm"
      />
    )
  }

  // 布尔开关
  if (param.type === 'boolean') {
    const isChecked = value ?? param.default ?? false
    return (
      <button
        type="button"
        onClick={() => handleChange(!isChecked)}
        className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 ease-in-out border ${
          isChecked ? 'bg-zinc-200 border-zinc-200' : 'bg-zinc-900 border-zinc-800'
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-4 h-4 rounded-full transition-transform duration-200 ease-out shadow-sm ${
            isChecked ? 'translate-x-[16px] bg-zinc-900' : 'bg-zinc-500'
          }`}
        />
      </button>
    )
  }

  // 下拉选择
  if (param.type === 'select' && param.options) {
    return (
      <select
        value={value ?? param.default ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm appearance-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
          backgroundPosition: 'right 0.75rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1rem',
          paddingRight: '2.5rem',
        }}
      >
        <option value="" className="bg-zinc-900">请选择...</option>
        {param.options.map((opt) => (
          <option key={opt} value={opt} className="bg-zinc-900">
            {opt}
          </option>
        ))}
      </select>
    )
  }

  // 默认文本输入
  return (
    <input
      type="text"
      value={value ?? param.default ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm"
    />
  )
}

const POLICY_OPTIONS: { value: ExecutionPolicy; label: string; description: string; color: string }[] = [
  { value: 'always', label: '始终执行', description: '无条件执行此节点', color: 'text-emerald-400' },
  { value: 'agent_decides', label: 'Agent 决定', description: '由 Agent 根据上下文判断是否需要执行', color: 'text-blue-400' },
  { value: 'skip', label: '跳过', description: '本次执行跳过此节点', color: 'text-zinc-500' },
]

const STRATEGY_OPTIONS: { value: QualityGate['strategy']; label: string; description: string; color: string }[] = [
  { value: 'none', label: '不质检', description: '执行完毕直接进入下一节点', color: 'text-zinc-500' },
  { value: 'self_review', label: 'AI 自检', description: 'Agent 根据 criteria 自主判断结果是否达标', color: 'text-amber-400' },
  { value: 'metric_check', label: '指标检查', description: '通过命令获取量化指标并与阈值对比', color: 'text-cyan-400' },
]

const FALLBACK_OPTIONS: { value: QualityGate['fallback']; label: string }[] = [
  { value: 'use_original', label: '使用原始输入' },
  { value: 'skip', label: '跳过节点' },
  { value: 'fail', label: '终止工作流' },
]

export function NodeConfigPanel() {
  const { selectedNodeId, nodes, updateNodeParams, updateNodePolicy, updateNodeQualityGate, setSelectedNodeId } = useWorkflowStore()
  const [skillMeta, setSkillMeta] = useState<SkillMeta | null>(null)
  const [loading, setLoading] = useState(false)

  // 获取选中的节点
  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null

  // 加载 Skill 详情
  useEffect(() => {
    if (!selectedNode) {
      setSkillMeta(null)
      return
    }

    const loadSkillMeta = async () => {
      setLoading(true)
      try {
        const response = await skillsApi.getDetail(selectedNode.data.skillId)
        setSkillMeta(response.data)
      } catch (error) {
        console.error('Failed to load skill meta:', error)
        setSkillMeta(null)
      } finally {
        setLoading(false)
      }
    }

    loadSkillMeta()
  }, [selectedNode?.data.skillId, selectedNode])

  // 处理参数变化
  const handleParamChange = useCallback(
    (name: string, value: any) => {
      if (selectedNodeId) {
        updateNodeParams(selectedNodeId, { [name]: value })
      }
    },
    [selectedNodeId, updateNodeParams]
  )

  // 处理执行策略变化
  const handlePolicyChange = useCallback(
    (policy: ExecutionPolicy) => {
      if (selectedNodeId) {
        updateNodePolicy(selectedNodeId, policy, selectedNode?.data.conditionHint as string | undefined)
      }
    },
    [selectedNodeId, updateNodePolicy, selectedNode?.data.conditionHint]
  )

  const handleConditionHintChange = useCallback(
    (hint: string) => {
      if (selectedNodeId && selectedNode?.data.executionPolicy) {
        updateNodePolicy(selectedNodeId, selectedNode.data.executionPolicy as ExecutionPolicy, hint)
      }
    },
    [selectedNodeId, updateNodePolicy, selectedNode?.data.executionPolicy]
  )

  const currentQualityGate: QualityGate = (selectedNode?.data.qualityGate as QualityGate) ?? {
    strategy: 'none',
    criteria: '',
    max_retries: 2,
    fallback: 'use_original',
  }

  const handleQualityGateChange = useCallback(
    (patch: Partial<QualityGate>) => {
      if (!selectedNodeId) return
      const updated = { ...currentQualityGate, ...patch }
      updateNodeQualityGate(selectedNodeId, updated.strategy === 'none' ? null : updated)
    },
    [selectedNodeId, updateNodeQualityGate, currentQualityGate]
  )

  // 关闭面板
  const handleClose = useCallback(() => {
    setSelectedNodeId(null)
  }, [setSelectedNodeId])

  if (!selectedNode) return null

  return (
    <aside className="w-[300px] flex flex-col shrink-0 bg-zinc-950 border-l border-zinc-800 z-10 animate-slide-in-right relative">
      {/* 头部 — 固定不滚动 */}
      <div className="p-5 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[14px] text-zinc-100 truncate pr-2 font-display">
            {selectedNode.data.label}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                useWorkflowStore.getState().removeNode(selectedNode.id)
              }}
              className="text-red-400/80 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-md transition-colors"
              title="删除节点"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button
              onClick={handleClose}
              className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 p-1.5 rounded-md transition-colors"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
            {selectedNode.data.category}
          </span>
          {selectedNode.data.hasScript ? (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              脚本执行
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400">
              AI 执行
            </span>
          )}
        </div>
        {selectedNode.data.description && (
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            {selectedNode.data.description}
          </p>
        )}
      </div>

      {/* 所有可滚动内容 */}
      <div className="flex-1 overflow-y-auto">

      {/* 参数表单 */}
      <div className="p-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-[11px] text-zinc-500">加载参数...</span>
          </div>
        ) : skillMeta && skillMeta.params.length > 0 ? (
          <div className="space-y-5">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">参数配置</h4>
            {skillMeta.params.map((param) => (
              <div key={param.name} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300">
                    {param.name}
                    {param.required && <span className="text-red-500/80">*</span>}
                  </label>
                  {param.default !== null && param.default !== undefined && (
                    <span className="text-[10px] text-zinc-600 font-mono">
                      默认: {String(param.default)}
                    </span>
                  )}
                </div>
                {param.description && (
                  <p className="text-[11px] text-zinc-500 leading-relaxed mb-1">{param.description}</p>
                )}
                <ParamInput
                  param={param}
                  value={selectedNode.data.params[param.name]}
                  onChange={handleParamChange}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 px-4">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <p className="text-[12px] text-zinc-400">此节点无需配置参数</p>
          </div>
        )}

        {/* 输入输出信息 */}
        {skillMeta && (skillMeta.inputs.length > 0 || skillMeta.outputs.length > 0) && (
          <div className="mt-8 pt-6 border-t border-zinc-800/60 space-y-6">
            {/* 输入 */}
            {skillMeta.inputs.length > 0 && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">输入项</h4>
                <div className="space-y-2">
                  {skillMeta.inputs.map((input) => (
                    <div key={input.name} className="flex items-center gap-2.5 text-[12px] bg-zinc-900/50 border border-zinc-800/50 p-2 rounded-lg">
                      <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded text-[10px] font-mono">
                        {input.type}
                      </span>
                      <span className="text-zinc-300 font-medium">{input.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 输出 */}
            {skillMeta.outputs.length > 0 && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">输出项</h4>
                <div className="space-y-2">
                  {skillMeta.outputs.map((output) => (
                    <div key={output.name} className="flex items-center gap-2.5 text-[12px] bg-zinc-900/50 border border-zinc-800/50 p-2 rounded-lg">
                      <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-[10px] font-mono">
                        {output.type}
                      </span>
                      <span className="text-zinc-300 font-medium">{output.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>{/* /参数表单 */}

      {/* 执行策略 */}
      <div className="px-5 pb-5 pt-2 border-t border-zinc-800/60 space-y-4">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mt-4">Agent 执行策略</h4>
        <div className="space-y-1.5">
          {POLICY_OPTIONS.map((opt) => {
            const isActive = (selectedNode.data.executionPolicy || 'always') === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePolicyChange(opt.value)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-150 ${
                  isActive
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-current' : 'bg-zinc-700'} ${opt.color}`} />
                  <span className={`text-[12px] font-medium ${isActive ? opt.color : 'text-zinc-400'}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-0.5 ml-3.5">{opt.description}</p>
              </button>
            )
          })}
        </div>

        {selectedNode.data.executionPolicy === 'agent_decides' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-500">判断提示（可选）</label>
            <textarea
              value={(selectedNode.data.conditionHint as string) || ''}
              onChange={(e) => handleConditionHintChange(e.target.value)}
              placeholder="告诉 Agent 在什么情况下需要执行，例如：如果视频包含旋转元数据才需要执行"
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-[12px] bg-zinc-900 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-all resize-none leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* 质检策略 */}
      <div className="px-5 pb-5 pt-2 border-t border-zinc-800/60 space-y-4">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mt-4">质检策略</h4>
        <div className="space-y-1.5">
          {STRATEGY_OPTIONS.map((opt) => {
            const isActive = currentQualityGate.strategy === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleQualityGateChange({ strategy: opt.value })}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all duration-150 ${
                  isActive
                    ? 'bg-zinc-800 border-zinc-700'
                    : 'bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-current' : 'bg-zinc-700'} ${opt.color}`} />
                  <span className={`text-[12px] font-medium ${isActive ? opt.color : 'text-zinc-400'}`}>
                    {opt.label}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-0.5 ml-3.5">{opt.description}</p>
              </button>
            )
          })}
        </div>

        {currentQualityGate.strategy !== 'none' && (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-500">
                {currentQualityGate.strategy === 'metric_check' ? '检查指标与阈值' : '质检标准'}
              </label>
              <textarea
                value={currentQualityGate.criteria}
                onChange={(e) => handleQualityGateChange({ criteria: e.target.value })}
                placeholder={
                  currentQualityGate.strategy === 'metric_check'
                    ? '例如：输出视频分辨率 >= 1920x1080，码率 >= 2000kbps'
                    : '例如：字幕文本无口水词，时间轴与画面同步'
                }
                rows={3}
                className="w-full rounded-xl px-3 py-2 text-[12px] bg-zinc-900 border border-zinc-800 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-all resize-none leading-relaxed"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500">最大重试</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={currentQualityGate.max_retries}
                  onChange={(e) => handleQualityGateChange({ max_retries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })}
                  className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-medium text-zinc-500">失败回退</label>
                <select
                  value={currentQualityGate.fallback}
                  onChange={(e) => handleQualityGateChange({ fallback: e.target.value as QualityGate['fallback'] })}
                  className="w-full rounded-xl px-3 py-2 text-[13px] bg-zinc-900 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all shadow-sm appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                    backgroundPosition: 'right 0.5rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1rem',
                    paddingRight: '2rem',
                  }}
                >
                  {FALLBACK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-zinc-900">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部节点 ID */}
      <div className="p-4 border-t border-zinc-800/60">
        <p className="text-[10px] text-zinc-600 font-mono truncate" title={selectedNode.id}>
          ID: {selectedNode.id}
        </p>
      </div>

      </div>{/* /滚动容器 */}
    </aside>
  )
}
