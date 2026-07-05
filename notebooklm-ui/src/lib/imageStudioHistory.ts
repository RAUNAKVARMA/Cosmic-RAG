export interface ImageHistoryEntry {
  id: string;
  prompt: string;
  image: string;
  label: string;
  createdAt: number;
}

const STORAGE_KEY = 'cosmic-image-studio-history';
const MAX_ENTRIES = 12;

export function loadImageHistory(): ImageHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImageHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        typeof e.id === 'string' &&
        typeof e.prompt === 'string' &&
        typeof e.image === 'string' &&
        typeof e.label === 'string' &&
        typeof e.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

export function saveImageHistory(entries: ImageHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* localStorage full — drop oldest until it fits */
    const trimmed = entries.slice(0, Math.max(1, Math.floor(MAX_ENTRIES / 2)));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up silently */
    }
  }
}

export function prependImageHistory(entry: ImageHistoryEntry): ImageHistoryEntry[] {
  const next = [entry, ...loadImageHistory()].slice(0, MAX_ENTRIES);
  saveImageHistory(next);
  return next;
}

export function removeImageHistoryEntry(id: string): ImageHistoryEntry[] {
  const next = loadImageHistory().filter((e) => e.id !== id);
  saveImageHistory(next);
  return next;
}

export function clearImageHistory(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
