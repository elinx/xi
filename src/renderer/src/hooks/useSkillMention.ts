import { useState, useCallback, useRef } from 'react'
import type { SkillInfo } from './useSkillStore'

interface SkillMentionItem {
  name: string
  description: string
  harness?: string
}

export function useSkillMention(skills: SkillInfo[]) {
  const [visible, setVisible] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const itemsRef = useRef<SkillMentionItem[]>([])

  const items = skills
    .filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    .map(s => ({ name: s.name, description: s.description, harness: s.harness }))
  itemsRef.current = items

  const detectSkillMention = useCallback((text: string, cursorPos: number): string | null => {
    const beforeCursor = text.slice(0, cursorPos)
    const match = beforeCursor.match(/\/skill:([a-z0-9-]*)$/)
    return match ? match[1] : null
  }, [])

  const handleTextChange = useCallback((text: string, cursorPos: number) => {
    const q = detectSkillMention(text, cursorPos)
    if (q !== null) {
      setQuery(q)
      setVisible(true)
      setSelectedIndex(0)
    } else {
      setVisible(false)
    }
  }, [detectSkillMention])

  const onKeyDown = useCallback((e: React.KeyboardEvent): string | true | false => {
    if (!visible) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, itemsRef.current.length - 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = itemsRef.current[selectedIndex]
      if (item) return item.name
      return true
    }
    if (e.key === 'Escape') {
      setVisible(false)
      return true
    }
    return false
  }, [visible, selectedIndex])

  const close = useCallback(() => {
    setVisible(false)
  }, [])

  return { visible, items, selectedIndex, handleTextChange, onKeyDown, close }
}
