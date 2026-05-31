interface LazySwitchBannerProps {
  backgroundSessionName: string | null
  isAgentEnded: boolean
  onStop: () => void
}

function LazySwitchBanner({ backgroundSessionName, isAgentEnded, onStop }: LazySwitchBannerProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between bg-blue-50 border-b border-blue-200 px-4 py-1.5">
      <div className="flex items-center gap-2">
        {isAgentEnded ? (
          <span className="text-xs text-gray-500">正在切换回当前会话...</span>
        ) : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
            </span>
            <span className="text-xs text-blue-700">
              Session &quot;{backgroundSessionName ?? ''}&quot; 后台运行中
            </span>
          </>
        )}
      </div>
      {!isAgentEnded && (
        <button
          onClick={onStop}
          className="rounded bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-red-500"
        >
          Stop
        </button>
      )}
    </div>
  )
}

export default LazySwitchBanner
