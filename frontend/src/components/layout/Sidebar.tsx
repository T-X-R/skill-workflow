import { useState, useMemo, useCallback } from 'react'
import { useWorkflowStore } from '../../stores/workflowStore'
import { useSkills } from '../../hooks/useSkills'
import type { SkillSummary } from '../../types'
import { WorkflowLibrary } from '../workflow/WorkflowLibrary'
import { SessionList } from '../session/SessionList'

interface CategoryGroup {
  category: string
  skills: SkillSummary[]
}

const CATEGORY_COLORS: Record<string, string> = {
  '音频处理': '#3b82f6',
  '视频处理': '#a855f7',
  '字幕处理': '#10b981',
  'AI分析': '#f97316',
  '云端处理': '#0ea5e9',
  '文件存储': '#eab308',
  '工作流支撑': '#71717a',
}

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#71717a'
}

function SkillItem({ skill }: { skill: SkillSummary }) {
  const nodes = useWorkflowStore((state) => state.nodes)
  const [descExpanded, setDescExpanded] = useState(false)

  const isOnCanvas = nodes.some((n) => n.data.skillId === skill.id)
  const isRunning = nodes.some(
    (n) => n.data.skillId === skill.id && n.data.status === 'running'
  )

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ skillId: skill.id }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const toggleDesc = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDescExpanded((v) => !v)
  }, [])

  const hasLongDesc = skill.description && skill.description.length > 40

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={`group relative mx-2 mb-1 px-3 py-2.5 rounded-xl cursor-grab active:cursor-grabbing transition-all duration-200 border ${
        isOnCanvas
          ? 'bg-zinc-900 border-zinc-700'
          : 'bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={`text-[13px] font-medium truncate ${
                isOnCanvas ? 'text-zinc-200' : 'text-zinc-300'
              }`}
            >
              {skill.name}
            </span>
            {isRunning && (
              <span className="flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                运行中
              </span>
            )}
            {isOnCanvas && !isRunning && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700">
                已使用
              </span>
            )}
            {skill.has_script && (
              <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                脚本
              </span>
            )}
          </div>
          <div className="relative">
            <p
              className={`text-[11px] leading-relaxed text-zinc-500 transition-all duration-200 ${
                descExpanded ? '' : 'line-clamp-2'
              }`}
            >
              {skill.description || '暂无描述'}
            </p>
            {hasLongDesc && (
              <button
                onClick={toggleDesc}
                className="mt-0.5 flex items-center gap-0.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer select-none"
              >
                <svg
                  className={`w-3 h-3 transition-transform duration-200 ${descExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {descExpanded ? '收起' : '展开'}
              </button>
            )}
          </div>
        </div>

        {/* Drag handle icon */}
        <div className="shrink-0 mt-0.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function CategorySection({
  category,
  skills,
  isExpanded,
  onToggle,
}: {
  category: string
  skills: SkillSummary[]
  isExpanded: boolean
  onToggle: () => void
}) {
  const color = getCategoryColor(category)

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between transition-all duration-200 group hover:bg-zinc-900/50"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full shadow-sm" style={{ background: color }} />
          <span className="text-[12px] font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
            {category}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500 group-hover:text-zinc-400 transition-colors">
            {skills.length}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-zinc-600 transition-transform duration-300 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          maxHeight: isExpanded ? '1000px' : '0px',
        }}
      >
        <div className="py-1">
          {skills.map((skill) => (
            <SkillItem key={skill.id} skill={skill} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { searchKeyword, setSearchKeyword } = useWorkflowStore()
  const { skills, categories } = useSkills()
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'skills' | 'workflows' | 'sessions'>('skills')

  const groupedSkills = useMemo(() => {
    const filtered = searchKeyword
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
            s.description.toLowerCase().includes(searchKeyword.toLowerCase())
        )
      : skills

    const groups: CategoryGroup[] = []
    const categoryOrder = categories.length > 0 ? categories : ['通用']

    categoryOrder.forEach((cat) => {
      const catSkills = filtered.filter((s) => s.category === cat)
      if (catSkills.length > 0) {
        groups.push({ category: cat, skills: catSkills })
      }
    })

    const uncategorized = filtered.filter((s) => !categoryOrder.includes(s.category))
    if (uncategorized.length > 0) {
      groups.push({ category: '其他', skills: uncategorized })
    }

    return groups
  }, [skills, categories, searchKeyword])

  const effectiveExpandedCategories = useMemo(() => {
    if (searchKeyword) {
      return new Set(groupedSkills.map((g) => g.category))
    }
    return expandedCategories
  }, [searchKeyword, groupedSkills, expandedCategories])

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  return (
    <aside className="w-[280px] flex flex-col shrink-0 bg-zinc-950 border-r border-zinc-800 z-10 relative">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-0 border-b border-zinc-800/60">
        <button
          onClick={() => setActiveTab('skills')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-lg transition-all border-b-2 -mb-px ${
            activeTab === 'skills'
              ? 'text-zinc-100 border-zinc-300'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          技能库
        </button>
        <button
          onClick={() => setActiveTab('workflows')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-lg transition-all border-b-2 -mb-px ${
            activeTab === 'workflows'
              ? 'text-zinc-100 border-zinc-300'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          流程库
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium rounded-t-lg transition-all border-b-2 -mb-px ${
            activeTab === 'sessions'
              ? 'text-zinc-100 border-zinc-300'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          会话
        </button>
      </div>

      {/* Skills tab content */}
      {activeTab === 'skills' && (
        <>
          {/* Search Header */}
          <div className="p-4 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500">
                Skills Library
              </span>
              <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                {skills.length} Nodes
              </span>
            </div>

            <div className="relative group">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search skills..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-8 py-2 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all"
              />
              {searchKeyword && (
                <button
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Skill list */}
          <div className="flex-1 overflow-y-auto py-2">
            {groupedSkills.length > 0 ? (
              groupedSkills.map((group) => (
                <CategorySection
                  key={group.category}
                  category={group.category}
                  skills={group.skills}
                  isExpanded={effectiveExpandedCategories.has(group.category)}
                  onToggle={() => toggleCategory(group.category)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <p className="text-[13px] text-zinc-400 font-medium">未找到匹配</p>
                <p className="text-[11px] text-zinc-600 mt-1">请尝试其他关键词</p>
              </div>
            )}
          </div>

          {/* Footer tip */}
          <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
            <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3 flex gap-3 items-start">
              <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                拖拽 Skill 到右侧画布，或使用右侧 Agent 助手自动构建。
              </p>
            </div>
          </div>
        </>
      )}

      {/* Workflows tab content */}
      {activeTab === 'workflows' && (
        <WorkflowLibrary onAfterLoad={() => setActiveTab('skills')} />
      )}

      {/* Sessions tab content */}
      {activeTab === 'sessions' && (
        <SessionList />
      )}
    </aside>
  )
}
