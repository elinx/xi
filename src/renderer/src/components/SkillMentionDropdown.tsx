import { useRef, useEffect } from 'react'
import { HARNESS_CONFIG } from '../hooks/useSkillStore'

interface SkillMentionItem {
  name: string
  description: string
  harness?: string
}

interface SkillMentionDropdownProps {
  items: SkillMentionItem[]
  selectedIndex: number
  onSelect: (item: SkillMentionItem) => void
  visible: boolean
}

export default function SkillMentionDropdown({ items, selectedIndex, onSelect, visible }: SkillMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!listRef.current || !visible) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, visible])

  if (!visible || items.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 mb-1 w-full max-h-[240px] overflow-y-auto xi-glass rounded-lg z-50 py-1">
      {items.map((item, i) => {
        const harnessCfg = item.harness && item.harness !== 'xi' && item.harness !== 'pi' && item.harness !== 'unknown'
          ? HARNESS_CONFIG[item.harness]
          : null
        return (
          <button
            key={item.name}
            ref={i === selectedIndex ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors duration-150 ${
              i === selectedIndex
                ? 'bg-blue-50 text-blue-900'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => onSelect(item)}
          >
            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-mono truncate">/skill:{item.name}</span>
            {harnessCfg && (
              <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${harnessCfg.className}`}>
                {harnessCfg.label}
              </span>
            )}
            <span className="ml-auto text-gray-400 truncate max-w-[40%]">{item.description}</span>
          </button>
        )
      })}
    </div>
  )
}
