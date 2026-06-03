import { useMemo } from 'react';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  keywords: string[];
  shortcut?: string;
  action: () => void;
}

export function useCommandRegistry(): CommandItem[] {
  return useMemo<CommandItem[]>(
    () => [
      {
        id: 'file.save',
        label: 'Save File',
        group: 'File',
        keywords: ['save', 'write'],
        shortcut: '⌘S',
        action: () => {},
      },
      {
        id: 'file.close',
        label: 'Close Tab',
        group: 'File',
        keywords: ['close', 'tab'],
        shortcut: '⌘W',
        action: () => {},
      },
      {
        id: 'session.new',
        label: 'New Session',
        group: 'Session',
        keywords: ['new', 'create', 'branch'],
        action: () => {},
      },
      {
        id: 'session.clear',
        label: 'Clear Session',
        group: 'Session',
        keywords: ['clear', 'reset'],
        action: () => {},
      },
      {
        id: 'view.toggleLeft',
        label: 'Toggle Left Panel',
        group: 'View',
        keywords: ['sidebar', 'panel', 'left'],
        shortcut: '⌘\\',
        action: () => {},
      },
      {
        id: 'view.toggleRight',
        label: 'Toggle Right Panel',
        group: 'View',
        keywords: ['sidebar', 'panel', 'right'],
        shortcut: '⌘⇧\\',
        action: () => {},
      },
      {
        id: 'view.terminal',
        label: 'Open Terminal',
        group: 'View',
        keywords: ['terminal', 'shell', 'console'],
        shortcut: '⌘`',
        action: () => {},
      },
      {
        id: 'view.settings',
        label: 'Open Settings',
        group: 'View',
        keywords: ['settings', 'preferences', 'config'],
        action: () => {},
      },
      {
        id: 'git.stageAll',
        label: 'Stage All Changes',
        group: 'Git',
        keywords: ['git', 'stage', 'add'],
        action: () => {},
      },
      {
        id: 'git.discardAll',
        label: 'Discard All Changes',
        group: 'Git',
        keywords: ['git', 'discard', 'revert'],
        action: () => {},
      },
      {
        id: 'model.switch',
        label: 'Switch Model',
        group: 'Model',
        keywords: ['model', 'llm', 'ai', 'switch'],
        action: () => {},
      },
    ],
    [],
  );
}
