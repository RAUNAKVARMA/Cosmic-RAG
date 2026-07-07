export interface CodingHistoryEntry {
  id: string;
  prompt: string;
  answer: string;
  modelId: string;
  modelLabel: string;
  createdAt: number;
}

const STORAGE_KEY = 'cosmic-coding-assistant-history';
const MAX_ENTRIES = 20;

export function loadCodingHistory(): CodingHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CodingHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        typeof e.id === 'string' &&
        typeof e.prompt === 'string' &&
        typeof e.answer === 'string' &&
        typeof e.modelId === 'string' &&
        typeof e.modelLabel === 'string' &&
        typeof e.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

export function saveCodingHistory(entries: CodingHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    const trimmed = entries.slice(0, Math.max(1, Math.floor(MAX_ENTRIES / 2)));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up silently */
    }
  }
}

export function prependCodingHistory(entry: CodingHistoryEntry): CodingHistoryEntry[] {
  const next = [entry, ...loadCodingHistory()].slice(0, MAX_ENTRIES);
  saveCodingHistory(next);
  return next;
}

export function removeCodingHistoryEntry(id: string): CodingHistoryEntry[] {
  const next = loadCodingHistory().filter((e) => e.id !== id);
  saveCodingHistory(next);
  return next;
}
