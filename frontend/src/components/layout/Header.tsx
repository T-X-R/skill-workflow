import { useState } from 'react'

interface HeaderProps {
  workflowName: string
  onNameChange?: (name: string) => void
  onNew?: () => void
}

export function Header({
  workflowName,
  onNameChange,
  onNew,
}: HeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(workflowName)

  const handleNameClick = () => {
    setIsEditing(true)
    setEditName(workflowName)
  }

  const handleNameBlur = () => {
    setIsEditing(false)
    if (editName.trim() && editName !== workflowName) {
      onNameChange?.(editName.trim())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameBlur()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditName(workflowName)
    }
  }

  return (
    <header className="h-[60px] shrink-0 flex items-center justify-between px-6 bg-zinc-950 border-b border-zinc-800/60 relative z-50">
      {/* Left — Logo + Brand */}
      <div className="flex items-center gap-3">
        {/* Minimalist Logo */}
        <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-sm">
          <div className="w-3 h-3 rounded-sm bg-zinc-200"></div>
        </div>

        <div className="flex flex-col">
          <span className="font-semibold text-[14px] text-zinc-100 tracking-tight font-display leading-none mb-1">
            Skill Workflow
          </span>
          <span className="text-[10px] text-zinc-500 font-medium tracking-wide uppercase leading-none">
            Automation Platform
          </span>
        </div>
      </div>

      {/* Center — Workflow name */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={handleKeyDown}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium w-56 text-center focus:outline-none transition-all duration-200 bg-zinc-900 border border-zinc-700 text-zinc-100 focus:ring-1 focus:ring-zinc-700 shadow-sm"
            autoFocus
          />
        ) : (
          <button
            onClick={handleNameClick}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 hover:bg-zinc-900 text-zinc-300 hover:text-zinc-100 border border-transparent hover:border-zinc-800 cursor-text"
          >
            {workflowName}
            <svg
              className="w-3 h-3 opacity-0 group-hover:opacity-100 text-zinc-500 transition-opacity duration-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 text-[12px] font-medium rounded-xl transition-all duration-200 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent hover:border-zinc-800"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新建
        </button>
      </div>
    </header>
  )
}
