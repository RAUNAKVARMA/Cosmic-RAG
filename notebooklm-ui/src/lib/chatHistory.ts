export interface SourceRef {
  document?: string;
  score: number;
  chunk_index: number;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId: string;
  messages: StoredMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  timestamp: Date;
}

const CONVERSATIONS_KEY = 'cosmic-rag:conversations';
const ACTIVE_ID_KEY = 'cosmic-rag:active-conversation-id';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_THREAD = 200;
const TITLE_MAX_LEN = 48;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function truncateTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TITLE_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_LEN - 1)}…`;
}

export function messageToStored(msg: ChatMessage): StoredMessage {
  return {
    role: msg.role,
    content: msg.content,
    sources: msg.sources,
    timestamp: msg.timestamp.toISOString(),
  };
}

export function messageFromStored(msg: StoredMessage): ChatMessage {
  const parsed = Date.parse(msg.timestamp);
  return {
    role: msg.role,
    content: msg.content,
    sources: msg.sources,
    timestamp: Number.isNaN(parsed) ? new Date() : new Date(parsed),
  };
}

export function loadConversations(): Conversation[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistConversations(conversations: Conversation[]): void {
  if (!canUseStorage()) return;
  try {
    const sorted = [...conversations].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
    const trimmed = sorted.slice(0, MAX_CONVERSATIONS);
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded or private mode */
  }
}

export function getActiveId(): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(ACTIVE_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

export function createConversation(modelId: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: newId(),
    title: 'New conversation',
    createdAt: now,
    updatedAt: now,
    modelId,
    messages: [],
  };
}

export function saveConversation(conversation: Conversation): void {
  const conversations = loadConversations();
  const messages =
    conversation.messages.length > MAX_MESSAGES_PER_THREAD
      ? conversation.messages.slice(-MAX_MESSAGES_PER_THREAD)
      : conversation.messages;

  const updated: Conversation = {
    ...conversation,
    messages,
    updatedAt: new Date().toISOString(),
  };

  const idx = conversations.findIndex((c) => c.id === updated.id);
  if (idx >= 0) {
    conversations[idx] = updated;
  } else {
    conversations.unshift(updated);
  }
  persistConversations(conversations);
}

export function deleteConversation(id: string): void {
  const conversations = loadConversations().filter((c) => c.id !== id);
  persistConversations(conversations);
  if (getActiveId() === id) {
    try {
      window.localStorage.removeItem(ACTIVE_ID_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function getConversation(id: string): Conversation | null {
  return loadConversations().find((c) => c.id === id) ?? null;
}

export function buildConversationFromState(
  id: string,
  title: string,
  createdAt: string,
  modelId: string,
  messages: ChatMessage[],
): Conversation {
  const stored = messages.map(messageToStored);
  const firstUser = messages.find((m) => m.role === 'user');
  const resolvedTitle = firstUser ? truncateTitle(firstUser.content) : title;

  return {
    id,
    title: resolvedTitle || 'New conversation',
    createdAt,
    updatedAt: new Date().toISOString(),
    modelId,
    messages: stored,
  };
}
