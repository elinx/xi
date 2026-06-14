export const DEFAULT_SUMMARY_PROMPT = `Summarize this session concisely and factually. Structure your response as follows:

## Goal
What the user wanted to accomplish.

## What was done
Key actions taken — implementations, modifications, investigations. Include file paths where relevant.

## Files
List files that were read, modified, or created.

## Issues
Unresolved problems or open questions. Omit if none.

## Status
One of: in progress, completed, blocked.

Do not use any tools. Output only the summary text.`

export function getSummaryPrompt(): string {
  if (typeof window === 'undefined') return DEFAULT_SUMMARY_PROMPT
  return localStorage.getItem('xi-settings-summary-prompt')?.trim() || DEFAULT_SUMMARY_PROMPT
}
