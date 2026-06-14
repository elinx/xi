import type { MentionItem } from './useFileMention'

export interface InputDraft {
  innerHTML: string
  mentions: MentionItem[]
  pastedImages: { data: string; mimeType: string }[]
}

/**
 * Per-session input draft store.
 *
 * Uses a module-level Map so drafts survive component unmount/remount
 * (e.g. switching to Settings tab and back) within the same app session.
 * Also mirrors the text portion to localStorage so drafts survive
 * system sleep/wake or renderer process restarts.
 */

const drafts = new Map<string, InputDraft>()

const LS_PREFIX = 'xi-input-draft:'

function lsKey(sessionPath: string): string {
  return LS_PREFIX + sessionPath
}

/** Save a draft for the given session path. */
export function setInputDraft(sessionPath: string, draft: InputDraft): void {
  drafts.set(sessionPath, draft)

  // Mirror to localStorage (skip large pasted images)
  try {
    const serializable = {
      innerHTML: draft.innerHTML,
      mentions: draft.mentions,
      // Omit pastedImages – they can be megabytes of base64
    }
    localStorage.setItem(lsKey(sessionPath), JSON.stringify(serializable))
  } catch {
    // localStorage quota exceeded – silently ignore
  }
}

/** Get the draft for the given session path. */
export function getInputDraft(sessionPath: string): InputDraft | undefined {
  // 1. Try in-memory cache first (always the freshest)
  const mem = drafts.get(sessionPath)
  if (mem) return mem

  // 2. Fall back to localStorage (survives sleep/wake or renderer restart)
  try {
    const raw = localStorage.getItem(lsKey(sessionPath))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InputDraft>
      const draft: InputDraft = {
        innerHTML: parsed.innerHTML ?? '',
        mentions: parsed.mentions ?? [],
        pastedImages: [], // not persisted to localStorage
      }
      // Promote to memory cache
      drafts.set(sessionPath, draft)
      return draft
    }
  } catch {
    // corrupt data – ignore
  }

  return undefined
}

/** Clear the draft for a given session (e.g. after the message is sent). */
export function clearInputDraft(sessionPath: string): void {
  drafts.delete(sessionPath)
  try {
    localStorage.removeItem(lsKey(sessionPath))
  } catch {
    // ignore
  }
}
