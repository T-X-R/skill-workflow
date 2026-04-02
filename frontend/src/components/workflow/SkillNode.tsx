import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { SkillNodeData } from '../../stores/workflowStore'

type SkillNodeType = Node<SkillNodeData, 'skillNode'>

const CATEGORY_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  '音频处理': { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  '视频处理': { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  '字幕处理': { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  'AI分析':   { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  '云端处理': { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  '文件存储': { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  '工作流支撑': { color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
}

const DEFAULT_CONFIG = { color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' }

function StatusIndicator({ status }: { status?: string }) {
  if (!status || status === 'pending') {
    return <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
  }
  if (status === 'running') {
    return (
      <div className="relative w-1.5 h-1.5 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping" />
        <div className="relative w-1.5 h-1.5 rounded-full bg-blue-400" />
      </div>
    )
  }
  if (status === 'success') {
    return (
      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  return <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
}

function SkillNodeComponent({ data, selected }: NodeProps<SkillNodeType>) {
  const config = CATEGORY_CONFIG[data.category] || DEFAULT_CONFIG

  const getBorderClass = () => {
    if (data.status === 'running') {
      return 'border-blue-500 ring-2 ring-blue-500/20 shadow-[0_8px_30px_rgba(59,130,246,0.15)]'
    }
    if (selected) {
      return 'border-zinc-300 shadow-[0_8px_30px_rgba(0,0,0,0.5)]'
    }
    return 'border-zinc-800 hover:border-zinc-700 shadow-sm'
  }

  const handleCls = '!w-2.5 !h-2.5 !rounded-full !bg-zinc-700 !border !border-zinc-500 hover:!border-emerald-400 hover:!bg-emerald-500/30 hover:!shadow-[0_0_6px_rgba(52,211,153,0.5)] transition-all duration-150 !cursor-crosshair'

  return (
    <div
      className={`
        relative w-[180px] rounded-xl border bg-zinc-950/90 backdrop-blur-md transition-all duration-300
        ${data.status === 'running' ? 'animate-pulse' : ''}
        ${getBorderClass()}
      `}
    >
      {/* 四个方向连接点 — 置于 overflow-hidden 层之外，不被裁剪 */}
      <Handle id="top"    type="source" position={Position.Top}    className={handleCls} style={{ top: -5 }} />
      <Handle id="right"  type="source" position={Position.Right}  className={handleCls} style={{ right: -5 }} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleCls} style={{ bottom: -5 }} />
      <Handle id="left"   type="source" position={Position.Left}   className={handleCls} style={{ left: -5 }} />

      {/* Inner content wrapper clips to rounded corners */}
      <div className="rounded-xl overflow-hidden">
        {/* Top accent line */}
        {data.status === 'running' && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/50 via-blue-400 to-blue-500/50 animate-pulse" />
        )}

        {/* Content */}
        <div className="px-3 py-2.5">
          {/* Header: Category + Status */}
          <div className="flex items-center justify-between mb-1.5">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded border tracking-widest ${config.bg} ${config.color} ${config.border}`}
            >
              {data.category}
            </span>
            <div className="flex items-center gap-1.5">
              <div title={data.hasScript ? '脚本执行' : 'AI 执行'}>
                {data.hasScript ? (
                  <svg className="w-3 h-3 text-emerald-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3 text-purple-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                )}
              </div>
              <StatusIndicator status={data.status} />
            </div>
          </div>

          {/* Skill name */}
          <div
            className="font-semibold text-[13px] text-zinc-50 truncate leading-snug tracking-tight font-display"
            title={data.label}
          >
            {data.label}
          </div>
        </div>
      </div>
    </div>
  )
}

export const SkillNode = memo(SkillNodeComponent)
