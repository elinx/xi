/**
 * Git-related types shared between renderer and main process.
 */

/** Commit list entry (returned by git:log) */
export interface CommitEntry {
  hash: string
  shortHash: string
  message: string
  body: string
  author_name: string
  author_email: string
  date: string
  refs: string
}

/** File change entry in a commit detail */
export interface FileChange {
  path: string
  status: string
  additions: number
  deletions: number
}

/** Commit detail (returned by git:commitDetail) */
export interface CommitDetail extends CommitEntry {
  files: FileChange[]
}
