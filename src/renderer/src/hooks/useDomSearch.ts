import { useState, useEffect, useCallback, useRef } from 'react'

export interface DomMatch {
  range: Range
  text: string
}

interface UseDomSearchOptions {
  containerRef: React.RefObject<HTMLElement | null>
  query: string
  caseSensitive: boolean
  enabled: boolean
}

const MAX_MATCHES = 500

export function useDomSearch({ containerRef, query, caseSensitive, enabled }: UseDomSearchOptions) {
  const [matches, setMatches] = useState<DomMatch[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightKeyRef = useRef<string>('')

  const clearHighlights = useCallback(() => {
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      const highlights = CSS.highlights as unknown as { delete: (key: string) => void; set: (key: string, value: unknown) => void }
      highlights.delete('search-match')
      highlights.delete('search-current')
    }
  }, [])

  const search = useCallback(() => {
    if (!enabled || !query.trim() || !containerRef.current) {
      clearHighlights()
      setMatches([])
      setCurrentIndex(0)
      return
    }

    const container = containerRef.current
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        // offsetParent is null for elements inside display:none subtrees (any depth)
        // This catches hidden session content when a file tab is active
        if (!parent.offsetParent) return NodeFilter.FILTER_REJECT
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') return NodeFilter.FILTER_REJECT
        if (!node.textContent) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    const searchStr = caseSensitive ? query : query.toLowerCase()
    const found: DomMatch[] = []

    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      if (found.length >= MAX_MATCHES) break
      const raw = textNode.textContent || ''
      const haystack = caseSensitive ? raw : raw.toLowerCase()
      let pos = 0
      while (pos < haystack.length) {
        const idx = haystack.indexOf(searchStr, pos)
        if (idx === -1) break
        if (found.length >= MAX_MATCHES) break
        const range = document.createRange()
        range.setStart(textNode, idx)
        range.setEnd(textNode, idx + query.length)
        found.push({ range, text: raw.slice(idx, idx + query.length) })
        pos = idx + query.length
      }
    }

    setMatches(found)
    setCurrentIndex(found.length > 0 ? 0 : 0)
  }, [enabled, query, caseSensitive, containerRef, clearHighlights])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(), 150)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  useEffect(() => {
    if (!enabled || matches.length === 0) {
      clearHighlights()
      return
    }

    if (typeof CSS === 'undefined' || !CSS.highlights) return

    const highlights = CSS.highlights as unknown as { delete: (key: string) => void; set: (key: string, value: unknown) => void }
    const allRanges = matches.map((m) => m.range.cloneRange())
    const highlightAll = new Highlight(...allRanges)
    highlights.set('search-match', highlightAll)

    if (currentIndex >= 0 && currentIndex < matches.length) {
      const currentRange = matches[currentIndex].range.cloneRange()
      const highlightCurrent = new Highlight(currentRange)
      highlights.set('search-current', highlightCurrent)
    }
  }, [matches, currentIndex, enabled, clearHighlights])

  useEffect(() => {
    return () => clearHighlights()
  }, [clearHighlights])

  const scrollToCurrent = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= matches.length) return
    const range = matches[currentIndex].range
    const rect = range.getBoundingClientRect()
    const root = containerRef.current
    if (!root) return

    // Walk up from the match to find the nearest scrollable ancestor
    let scrollContainer: HTMLElement | null = range.startContainer.parentElement
    while (scrollContainer && scrollContainer !== root) {
      const style = window.getComputedStyle(scrollContainer)
      const canScroll = (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && scrollContainer.scrollHeight > scrollContainer.clientHeight
      if (canScroll) break
      scrollContainer = scrollContainer.parentElement
    }
    if (!scrollContainer) scrollContainer = root

    if (rect.top === 0 && rect.bottom === 0 && rect.height === 0) return

    const scRect = scrollContainer.getBoundingClientRect()
    if (rect.top < scRect.top || rect.bottom > scRect.bottom) {
      const offset = rect.top - scRect.top + scrollContainer.scrollTop
        - (scrollContainer.clientHeight - rect.height) / 2
      scrollContainer.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
    }
  }, [matches, currentIndex, containerRef])

  useEffect(() => {
    if (enabled && matches.length > 0) {
      scrollToCurrent()
    }
  }, [currentIndex, enabled, matches, scrollToCurrent])

  const next = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex((prev) => (prev + 1) % matches.length)
  }, [matches.length])

  const prev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length)
  }, [matches.length])

  const clear = useCallback(() => {
    clearHighlights()
    setMatches([])
    setCurrentIndex(0)
  }, [clearHighlights])

  return {
    matches,
    currentIndex,
    setCurrentIndex,
    next,
    prev,
    clear,
    truncated: matches.length >= MAX_MATCHES,
  }
}
