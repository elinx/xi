import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { useSkillStore, HARNESS_CONFIG, SCOPE_CONFIG, normalizeHarness, type SkillInfo } from '../hooks/useSkillStore'

interface SkillViewerProps {
  skillFilePath: string
}

export default function SkillViewer({ skillFilePath }: SkillViewerProps) {
  const skills = useSkillStore(s => s.skills)
  const skillDetail = useSkillStore(s => s.skillDetail)
  const detailLoading = useSkillStore(s => s.detailLoading)
  const loadSkillDetail = useSkillStore(s => s.loadSkillDetail)
  const [showSource, setShowSource] = useState(false)

  const skill = skills.find(s => s.filePath === skillFilePath)

  useEffect(() => {
    loadSkillDetail(skillFilePath)
  }, [skillFilePath, loadSkillDetail])

  if (!skill) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Skill not found
      </div>
    )
  }

  const harnessKey = normalizeHarness(skill.harness)
  const harnessCfg = HARNESS_CONFIG[harnessKey]
  const scopeCfg = SCOPE_CONFIG[skill.scope] ?? { label: skill.scope, className: 'bg-gray-100 text-gray-500' }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50">
        <span className="text-sm font-semibold text-gray-800">{skill.name}</span>
        {harnessCfg && harnessKey !== 'xi' && harnessKey !== 'unknown' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${harnessCfg.className}`}>
            {harnessCfg.icon} {harnessCfg.label}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${scopeCfg.className}`}>
          {scopeCfg.label}
        </span>
        {skill.disableModelInvocation && (
          <span title="Only invokable via /skill:name" className="text-xs">🔒</span>
        )}
        {skillDetail?.content && (
          <button
            onClick={() => setShowSource(!showSource)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
            title={showSource ? 'Switch to preview' : 'View raw source'}
          >
            {showSource ? 'Preview' : '</> Source'}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {detailLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading...
          </div>
        ) : skillDetail?.content ? (
          showSource ? (
            <pre className="text-xs leading-5 font-mono p-6 whitespace-pre overflow-x-auto bg-gray-50">
              {skillDetail.content}
            </pre>
          ) : (
            <div className="prose prose-sm max-w-none p-6 [&_img]:max-w-full [&_img]:rounded">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => { e.preventDefault(); if (href) window.api.openExternal(href) }}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {skillDetail.content}
              </ReactMarkdown>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {skill.description || 'No content available'}
          </div>
        )}
      </div>
    </div>
  )
}
