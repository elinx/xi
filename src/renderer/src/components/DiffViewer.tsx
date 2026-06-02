import { useState, useEffect } from 'react'

interface DiffViewerProps {
  filePath: string
}

export default function DiffViewer({ filePath }: DiffViewerProps) {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isUntracked, setIsUntracked] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    window.api.gitDiff(filePath)
      .then(result => {
        if (result.ok && result.data) {
          setDiff(result.data)
          setIsUntracked(false)
        } else {
          window.api.readFile(filePath)
            .then(fileResult => {
              if (fileResult.ok && fileResult.data) {
                const content = fileResult.data.content
                setDiff(content.split('\n').map(l => `+${l}`).join('\n'))
                setIsUntracked(true)
              } else {
                setError(result.error ?? 'Failed to get diff')
              }
            })
            .catch(() => setError(result.error ?? 'Failed to get diff'))
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [filePath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading diff...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        {error}
      </div>
    )
  }

  if (!diff) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No diff available
      </div>
    )
  }

  const lines = diff.split('\n')

  return (
    <div className="font-mono text-xs overflow-auto h-full">
      <table className="w-full border-collapse">
        <tbody>
          {isUntracked && (
            <tr>
              <td colSpan={2} className="px-3 py-1 text-yellow-700 bg-yellow-50 font-semibold">
                Untracked file — showing full content
              </td>
            </tr>
          )}
          {lines.map((line, i) => {
            let bg = ''
            let textColor = 'text-gray-800'
            if (line.startsWith('+++') || line.startsWith('---')) {
              bg = 'bg-blue-50'
              textColor = 'text-blue-700 font-semibold'
            } else if (line.startsWith('@@')) {
              bg = 'bg-blue-50/50'
              textColor = 'text-blue-600'
            } else if (line.startsWith('+')) {
              bg = 'bg-green-50'
              textColor = 'text-green-800'
            } else if (line.startsWith('-')) {
              bg = 'bg-red-50'
              textColor = 'text-red-800'
            }

            return (
              <tr key={i} className={bg}>
                <td className="px-2 py-0 text-right text-gray-300 select-none w-10 border-r border-gray-100">
                  {i + 1}
                </td>
                <td className={`px-3 py-0 whitespace-pre ${textColor}`}>
                  {line || ' '}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
