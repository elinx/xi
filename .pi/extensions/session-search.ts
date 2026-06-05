import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"

interface ParsedSession {
  name: string
  entries: Array<{
    type: string
    message?: {
      role?: string
      content?: unknown
      timestamp?: number
    }
  }>
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== "object") continue
    const b = block as { type?: string; text?: string }
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text)
    }
  }
  return parts.join("\n")
}

function parseSessionFile(filePath: string): ParsedSession {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n").filter(l => l.trim().length > 0)

  let name = ""
  const entries: ParsedSession["entries"] = []
  const MAX_ENTRIES = 500

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]) as Record<string, unknown>
      if (i === 0 && entry.type === "session") continue
      if (entry.type === "session_info" && typeof entry.name === "string") {
        name = entry.name
        continue
      }
      if (entry.type === "message" && entry.message) {
        entries.push({ type: entry.type, message: entry.message as ParsedSession["entries"][0]["message"] })
        if (entries.length >= MAX_ENTRIES) break
      }
    } catch {
      continue
    }
  }

  return { name, entries }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export default function sessionSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "search_sessions",
    label: "Search Sessions",
    description: "Search all sessions in the current project for relevant conversations. Use this when the user asks about previous discussions, past decisions, or work done in other sessions that may not be in the current conversation.",
    promptSnippet: "Search past session conversations for relevant context",
    promptGuidelines: [
      "Use search_sessions when the user refers to past work, previous decisions, or discussions that may be in other sessions.",
      "search_sessions returns conversation excerpts from other sessions — use them as context, not as absolute truth.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query — keywords or phrases to find in session conversations" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 10, max: 30)", default: 10 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionFile = ctx.sessionManager.getSessionFile()
      if (!sessionFile) {
        return { content: [{ type: "text" as const, text: "No active session found." }] }
      }

      const sessionDir = dirname(sessionFile)
      if (!existsSync(sessionDir)) {
        return { content: [{ type: "text" as const, text: "Session directory not found." }] }
      }

      const limit = Math.min(params.limit ?? 10, 30)
      const q = params.query.toLowerCase()
      if (q.length < 2) {
        return { content: [{ type: "text" as const, text: "Query too short. Use at least 2 characters." }] }
      }

      const currentSessionFile = ctx.sessionManager.getSessionFile()
      const files = readdirSync(sessionDir)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => join(sessionDir, f))

      const matches: Array<{
        sessionName: string
        isCurrent: boolean
        role: string
        content: string
        timestamp: number
      }> = []

      for (const filePath of files) {
        if (matches.length >= limit) break

        try {
          const { name, entries } = parseSessionFile(filePath)
          const isCurrent = filePath === currentSessionFile

          for (const entry of entries) {
            if (matches.length >= limit) break
            if (entry.type !== "message" || !entry.message) continue
            if (entry.message.role !== "user" && entry.message.role !== "assistant") continue

            const text = extractText(entry.message.content)
            if (!text.toLowerCase().includes(q)) continue

            matches.push({
              sessionName: name || filePath.split("/").pop()?.replace(".jsonl", "") || "unknown",
              sessionPath: filePath,
              isCurrent: !!isCurrent,
              role: entry.message.role,
              content: text.slice(0, 500),
              timestamp: entry.message.timestamp ?? 0,
            })
          }
        } catch {
          continue
        }
      }

      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: `No conversations found matching "${params.query}".` }] }
      }

      matches.sort((a, b) => b.timestamp - a.timestamp)

      const lines = [`Found ${matches.length} matching conversation${matches.length === 1 ? "" : "s"}:\n`]

      for (const m of matches) {
        const tag = m.isCurrent ? " (current session)" : ""
        lines.push(`--- Session: "${m.sessionName}"${tag} ---`)
        lines.push(`[${m.role === "user" ? "User" : "Assistant"}, ${relativeTime(m.timestamp)}]: ${m.content}`)
        lines.push("")
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] }
    },
  })
}
