import { useState, useCallback, useRef, useEffect } from "react";

export interface FileEntry {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
}

interface FileIndexResult {
  files: FileEntry[];
  loading: boolean;
  refresh: () => void;
}

const IGNORED_NAMES = new Set(["node_modules", ".git", ".pi", ".DS_Store"]);
const MAX_DEPTH = 5;
const MAX_ENTRIES = 5000;

function isIgnored(name: string): boolean {
  return IGNORED_NAMES.has(name) || name.startsWith(".");
}

async function walkDir(
  dirPath: string,
  projectRoot: string,
  depth: number,
  entries: FileEntry[],
): Promise<void> {
  if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;

  let result: { ok: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean }>; error?: string };
  try {
    result = await window.api.readDirectory(dirPath);
  } catch {
    return;
  }

  if (!result.ok || !result.entries) return;

  for (const item of result.entries) {
    if (entries.length >= MAX_ENTRIES) break;
    if (isIgnored(item.name)) continue;

    const relativePath = item.path.slice(projectRoot.length + 1);
    entries.push({
      name: item.name,
      path: item.path,
      relativePath,
      isDirectory: item.isDirectory,
    });

    if (item.isDirectory) {
      await walkDir(item.path, projectRoot, depth + 1, entries);
    }
  }
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export function useFileIndex(): FileIndexResult {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<FileEntry[] | null>(null);
  const staleRef = useRef(true);
  const loadingRef = useRef(false);

  const refresh = useCallback(() => {
    if (loadingRef.current) return;
    if (cacheRef.current && !staleRef.current) {
      setFiles(cacheRef.current);
      return;
    }

    loadingRef.current = true;
    setLoading(true);

    (async () => {
      try {
        const projectRoot = await window.api.getProjectPath();
        const entries: FileEntry[] = [];
        await walkDir(projectRoot, projectRoot, 0, entries);
        const sorted = sortEntries(entries);
        cacheRef.current = sorted;
        staleRef.current = false;
        setFiles(sorted);
      } catch {
        cacheRef.current = null;
        staleRef.current = true;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.api as typeof window.api & { onFsChanged?: (cb: () => void) => () => void };
    if (!api.onFsChanged) return;
    const unsub = api.onFsChanged(() => {
      staleRef.current = true;
    });
    return unsub;
  }, []);

  return { files, loading, refresh };
}
