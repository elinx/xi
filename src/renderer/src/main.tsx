import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

if (typeof window !== 'undefined' && !window.api) {
  const noop = () => {}
  const noopUnsub = () => () => noop
  const ok = async () => ({ ok: true })
  const okData = (data: unknown) => async () => ({ ok: true, data })

  window.api = new Proxy({} as typeof window.api, {
    get(_target, prop) {
      if (prop === 'onEvent' || prop === 'onResponse' || prop === 'onExtensionUiRequest' || prop === 'onStateChanged' || prop === 'onWorkerStatus' || prop === 'onFsChanged' || prop === 'onTerminalData' || prop === 'onTerminalExit') return noopUnsub()
      if (prop === 'openConfigDir' || prop === 'showItemInFolder' || prop === 'copyToClipboard') return noop
      if (prop === 'start' || prop === 'stop') return ok
      if (prop === 'listSessions' || prop === 'refreshSessions') return async () => ({ projects: [] })
      if (prop === 'getForkMessages' || prop === 'getMessages' || prop === 'getMessagesForSession' || prop === 'getForkPoints') return async () => []
      if (prop === 'getCurrentSession') return async () => null
      if (prop === 'getState') return async () => ({ connected: false })
      if (prop === 'getAvailableModels') return okData({ models: [] })
      if (prop === 'getProviderAuthStatus') return okData({})
      if (prop === 'readDirectory') return okData({ entries: [] })
      if (prop === 'listSkills') return okData([])
      if (prop === 'listMcpServers') return okData([])
      if (prop === 'mcpPing') return async () => ({ ok: true, connected: false })
      if (prop === 'getProjectPath') return async () => '/'
      if (prop === 'workerEnsureReady') return async () => ({ ok: true, status: 'connected' })
      if (prop === 'workerGetStatus') return async () => []
      if (prop === 'workerDispose') return ok
      if (prop === 'workerSetIdleTimeout') return async () => ({ ok: true })
      if (prop === 'workerGetIdleTimeout') return async () => ({ ok: true, minutes: 5 })
      if (prop === 'workerSetMaxSecondaries') return async () => ({ ok: true })
      if (prop === 'workerGetMaxSecondaries') return async () => ({ ok: true, maxSecondaries: 8 })
      if (prop === 'getLastSession' || prop === 'saveLastSession') return async () => null
      return ok
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
