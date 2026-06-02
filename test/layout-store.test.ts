import { describe, it, expect, beforeEach } from 'vitest'
import { useLayoutStore } from '../src/renderer/src/hooks/useLayoutStore'

describe('useLayoutStore', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      leftPanelView: 'sessions',
      leftPanelCollapsed: false,
      leftPanelWidth: 260,
      rightPanelView: 'files',
      rightPanelCollapsed: true,
      rightPanelWidth: 220,
    })
  })

  describe('left panel view', () => {
    it('switches to a different view and opens panel', () => {
      useLayoutStore.getState().setLeftPanelView('skills')
      const state = useLayoutStore.getState()
      expect(state.leftPanelView).toBe('skills')
      expect(state.leftPanelCollapsed).toBe(false)
    })

    it('clicking same view does not toggle collapse', () => {
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(false)
      useLayoutStore.getState().setLeftPanelView('sessions')
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(false)
    })

    it('opens panel when switching view while collapsed', () => {
      useLayoutStore.getState().setLeftPanelCollapsed(true)
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(true)
      useLayoutStore.getState().setLeftPanelView('mcp')
      const state = useLayoutStore.getState()
      expect(state.leftPanelView).toBe('mcp')
      expect(state.leftPanelCollapsed).toBe(false)
    })
  })

  describe('left panel width', () => {
    it('sets width within bounds', () => {
      useLayoutStore.getState().setLeftPanelWidth(300)
      expect(useLayoutStore.getState().leftPanelWidth).toBe(300)
    })

    it('clamps to minimum 180px', () => {
      useLayoutStore.getState().setLeftPanelWidth(50)
      expect(useLayoutStore.getState().leftPanelWidth).toBe(180)
    })

    it('clamps to maximum 480px', () => {
      useLayoutStore.getState().setLeftPanelWidth(600)
      expect(useLayoutStore.getState().leftPanelWidth).toBe(480)
    })

    it('falls back to 260 on NaN', () => {
      useLayoutStore.getState().setLeftPanelWidth(Number.NaN)
      expect(useLayoutStore.getState().leftPanelWidth).toBe(260)
    })
  })

  describe('right panel view', () => {
    it('switches to git and opens panel', () => {
      useLayoutStore.getState().setRightPanelView('git')
      const state = useLayoutStore.getState()
      expect(state.rightPanelView).toBe('git')
      expect(state.rightPanelCollapsed).toBe(false)
    })

    it('clicking same view does not toggle collapse', () => {
      useLayoutStore.getState().setRightPanelCollapsed(false)
      useLayoutStore.getState().setRightPanelView('files')
      expect(useLayoutStore.getState().rightPanelCollapsed).toBe(false)
    })
  })

  describe('right panel width', () => {
    it('clamps to minimum 180px', () => {
      useLayoutStore.getState().setRightPanelWidth(100)
      expect(useLayoutStore.getState().rightPanelWidth).toBe(180)
    })

    it('clamps to maximum 400px', () => {
      useLayoutStore.getState().setRightPanelWidth(500)
      expect(useLayoutStore.getState().rightPanelWidth).toBe(400)
    })
  })

  describe('toggle functions', () => {
    it('toggleLeftPanel flips collapsed state', () => {
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(false)
      useLayoutStore.getState().toggleLeftPanel()
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(true)
      useLayoutStore.getState().toggleLeftPanel()
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(false)
    })

    it('toggleRightPanel flips collapsed state', () => {
      expect(useLayoutStore.getState().rightPanelCollapsed).toBe(true)
      useLayoutStore.getState().toggleRightPanel()
      expect(useLayoutStore.getState().rightPanelCollapsed).toBe(false)
    })
  })

  describe('setCollapsed', () => {
    it('setLeftPanelCollapsed sets exact state', () => {
      useLayoutStore.getState().setLeftPanelCollapsed(true)
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(true)
      useLayoutStore.getState().setLeftPanelCollapsed(false)
      expect(useLayoutStore.getState().leftPanelCollapsed).toBe(false)
    })

    it('setRightPanelCollapsed sets exact state', () => {
      useLayoutStore.getState().setRightPanelCollapsed(false)
      expect(useLayoutStore.getState().rightPanelCollapsed).toBe(false)
      useLayoutStore.getState().setRightPanelCollapsed(true)
      expect(useLayoutStore.getState().rightPanelCollapsed).toBe(true)
    })
  })
})
