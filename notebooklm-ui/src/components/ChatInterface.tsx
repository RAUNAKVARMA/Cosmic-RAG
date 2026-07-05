'use client';

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import DocumentUpload from './DocumentUpload';
import FileTypeIcon from './FileTypeIcon';
import MessageContent from './MessageContent';
import {
  buildConversationFromState,
  createConversation,
  deleteConversation,
  getActiveId,
  getConversation,
  loadConversations,
  messageFromStored,
  saveConversation,
  setActiveId,
  type ChatMessage,
  type Conversation,
  type SourceRef,
} from '@/lib/chatHistory';
import { apiHeaders, getApiBaseUrl, parseApiErrorResponse } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import styles from './ChatInterface.module.css';

function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 20a8 8 0 0116 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCosmic() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.2 3.3L16.5 8l-3.3 1.7L12 13l-1.2-3.3L7.5 8l3.3-1.7L12 3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="rgba(103,232,249,0.15)"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

interface DocumentListItem {
  id: string;
  name: string;
  type: string;
  chunks: number;
}

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [, refreshRelativeTimes] = useReducer((n: number) => n + 1, 0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [docError, setDocError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('auto');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationCreatedAt, setConversationCreatedAt] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);

  const apiBase = getApiBaseUrl();

  const refreshConversationList = useCallback(() => {
    setConversations(loadConversations());
  }, []);

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/documents`);
      if (!res.ok) {
        setDocError('Could not load documents.');
        return;
      }
      const data = (await res.json()) as DocumentListItem[];
      setDocuments(Array.isArray(data) ? data : []);
      setDocError(null);
    } catch {
      setDocError('Could not load documents.');
    }
  }, [apiBase]);

  useEffect(() => {
    const activeId = getActiveId();
    if (activeId) {
      const conv = getConversation(activeId);
      if (conv) {
        setConversationId(conv.id);
        setConversationCreatedAt(conv.createdAt);
        setMessages(conv.messages.map(messageFromStored));
        setSelectedModelId(conv.modelId);
        restoredRef.current = true;
        refreshConversationList();
        return;
      }
    }
    const fresh = createConversation('auto');
    setConversationId(fresh.id);
    setConversationCreatedAt(fresh.createdAt);
    setActiveId(fresh.id);
    refreshConversationList();
  }, [refreshConversationList]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const res = await fetch(`${apiBase}/models`);
        if (!res.ok) return;
        const data = (await res.json()) as ModelOption[];
        if (Array.isArray(data) && data.length > 0) {
          setModels(data);
          if (!restoredRef.current) {
            const auto = data.find((m) => m.id === 'auto');
            if (auto) setSelectedModelId('auto');
          }
        }
      } catch {
        /* models endpoint optional until backend restarts */
      }
    };
    void loadModels();
  }, [apiBase]);

  useEffect(() => {
    const id = window.setInterval(() => refreshRelativeTimes(), 30000);
    return () => window.clearInterval(id);
  }, [refreshRelativeTimes]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!conversationId || !conversationCreatedAt) return;
    const timer = window.setTimeout(() => {
      const conv = buildConversationFromState(
        conversationId,
        'New conversation',
        conversationCreatedAt,
        selectedModelId,
        messages,
      );
      saveConversation(conv);
      refreshConversationList();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [messages, conversationId, conversationCreatedAt, selectedModelId, refreshConversationList]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const priorHistory = messages.slice(-20).map(({ role, content }) => ({ role, content }));

    const userMessage: ChatMessage = { role: 'user', content: trimmed, timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: trimmed,
          model_id: selectedModelId,
          history: priorHistory,
        }),
      });

      if (!res.ok) {
        throw new Error('Request failed');
      }

      const data = (await res.json()) as {
        answer: string;
        sources?: SourceRef[];
        timestamp?: string;
      };

      let ts = new Date();
      if (data.timestamp) {
        const parsed = Date.parse(data.timestamp);
        if (!Number.isNaN(parsed)) {
          ts = new Date(parsed);
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
          timestamp: ts,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong. Please try again in a moment.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    setDocError(null);
    const allowed = /\.(pdf|docx|txt|md|csv)$/i;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!allowed.test(file.name)) {
        setDocError('Only PDF, DOCX, TXT, MD, and CSV files are supported.');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setDocError('Each file must be 10 MB or smaller.');
        continue;
      }
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(`${apiBase}/upload`, {
          method: 'POST',
          headers: apiHeaders(),
          body: form,
        });
        if (!res.ok) {
          const detail = await parseApiErrorResponse(res);
          setDocError(detail);
          continue;
        }
        await refreshDocuments();
      } catch {
        setDocError('Upload failed. Check your connection and try again.');
      }
    }
  };

  const startNewConversation = () => {
    const fresh = createConversation(selectedModelId);
    setConversationId(fresh.id);
    setConversationCreatedAt(fresh.createdAt);
    setActiveId(fresh.id);
    setMessages([]);
    setInput('');
    refreshConversationList();
  };

  const handleNewChat = () => {
    startNewConversation();
    setShowHistoryPanel(false);
  };

  const handleSelectConversation = (id: string) => {
    if (id === conversationId) {
      setShowHistoryPanel(false);
      return;
    }
    const conv = getConversation(id);
    if (!conv) return;
    setConversationId(conv.id);
    setConversationCreatedAt(conv.createdAt);
    setActiveId(conv.id);
    setMessages(conv.messages.map(messageFromStored));
    setSelectedModelId(conv.modelId);
    setShowHistoryPanel(false);
  };

  const confirmDeleteConversation = () => {
    if (!deleteTargetId) return;
    const wasActive = deleteTargetId === conversationId;
    deleteConversation(deleteTargetId);
    setDeleteTargetId(null);
    refreshConversationList();
    if (wasActive) {
      startNewConversation();
    }
  };

  const confirmClearHistory = () => {
    setIsClearing(true);
    window.setTimeout(() => {
      if (conversationId) {
        deleteConversation(conversationId);
      }
      startNewConversation();
      setIsClearing(false);
      setShowClearConfirm(false);
    }, 300);
  };

  const deleteTarget = deleteTargetId
    ? conversations.find((c) => c.id === deleteTargetId)
    : null;

  const sortedConversations = [...conversations].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );

  return (
    <div className={`${styles.wrap} ${showHistoryPanel ? styles.wrapWithPanel : ''}`}>
      {showHistoryPanel && (
        <button
          type="button"
          className={styles.historyBackdrop}
          aria-label="Close history panel"
          onClick={() => setShowHistoryPanel(false)}
        />
      )}

      <aside
        className={`${styles.historyPanel} ${showHistoryPanel ? styles.historyPanelOpen : ''}`}
        aria-hidden={!showHistoryPanel}
      >
        <div className={styles.historyHeader}>
          <h2 className={styles.historyTitle}>History</h2>
          <button
            type="button"
            className={styles.historyClose}
            onClick={() => setShowHistoryPanel(false)}
            aria-label="Close history"
          >
            ×
          </button>
        </div>
        {sortedConversations.length === 0 ? (
          <p className={styles.historyEmpty}>No past conversations yet</p>
        ) : (
          <ul className={styles.historyList}>
            {sortedConversations.map((conv) => (
              <li key={conv.id} className={styles.historyItem}>
                <button
                  type="button"
                  className={`${styles.historySelect} ${conv.id === conversationId ? styles.historySelectActive : ''}`}
                  onClick={() => handleSelectConversation(conv.id)}
                >
                  <span className={styles.historyItemTitle}>{conv.title}</span>
                  <span className={styles.historyItemMeta}>
                    {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''} ·{' '}
                    <span suppressHydrationWarning>
                      {formatRelativeTime(new Date(conv.updatedAt))}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.historyDelete}
                  aria-label={`Delete ${conv.title}`}
                  onClick={() => setDeleteTargetId(conv.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className={styles.shell}>
        <div className={styles.shellInner}>
          <div className={styles.toolbar}>
            <label className={styles.modelWrap}>
              <span className={styles.modelLabel}>Model</span>
              <select
                className={styles.modelSelect}
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                disabled={isLoading || models.length === 0}
                aria-label="Select AI model"
              >
                {models.length === 0 ? (
                  <option value="auto">Auto Router</option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.available && m.id !== 'auto'}>
                      {m.label}
                      {!m.available && m.id !== 'auto' ? ' (unavailable)' : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={() => setShowHistoryPanel((open) => !open)}
                aria-expanded={showHistoryPanel}
                aria-label="Conversation history"
              >
                History
              </button>
              <button
                type="button"
                className={styles.toolbarBtn}
                onClick={handleNewChat}
                aria-label="Start new chat"
              >
                New chat
              </button>
              <button
                type="button"
                className={styles.clearBtn}
                disabled={messages.length === 0 || isClearing}
                onClick={() => setShowClearConfirm(true)}
                aria-label="Clear chat history"
              >
                Clear
              </button>
            </div>
          </div>

          <div
            className={`${styles.chatPanel} ${isClearing ? styles.chatPanelFadeOut : ''}`}
            aria-live="polite"
          >
            {messages.length === 0 && !isLoading && (
              <div className={styles.emptyState}>
                <div className={styles.emptyOrbit} aria-hidden />
                <h2 className={styles.emptyTitle}>Indexed knowledge, cosmic answers</h2>
                <p className={styles.emptySubtitle}>
                  Upload documents below, then ask questions in plain language. Retrieval runs against your
                  corpus before the model responds.
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={`${msg.timestamp.getTime()}-${idx}`}
                className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgRowUser : styles.msgRowAssistant}`}
              >
                <div
                  className={`${styles.avatar} ${msg.role === 'user' ? styles.avatarUser : styles.avatarAssistant}`}
                >
                  {msg.role === 'user' ? <IconUser /> : <IconCosmic />}
                </div>
                <div className={styles.msgCard}>
                  <div className={styles.roleRow}>
                    <span
                      className={`${styles.roleLabel} ${msg.role === 'assistant' ? styles.roleLabelAssistant : styles.roleLabelUser}`}
                    >
                      {msg.role === 'user' ? 'You' : 'Cosmic AI'}
                    </span>
                    <span className={styles.time} suppressHydrationWarning>
                      {formatRelativeTime(msg.timestamp)}
                    </span>
                  </div>
                  <div className={styles.body}>
                    <MessageContent content={msg.content} role={msg.role} />
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <details className={styles.sources}>
                      <summary className={styles.sourcesSummary}>
                        {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} referenced
                      </summary>
                      <ul>
                        {msg.sources.map((src, i) => (
                          <li key={i} className={styles.sourceItem}>
                            <span className={styles.sourceDoc}>{src.document ?? 'Document'}</span>
                            <span className={styles.sourceMeta}>
                              {typeof src.score === 'number' && `score ${src.score.toFixed(2)} · `}
                              chunk {src.chunk_index}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className={styles.typingRow} aria-live="polite">
                <div className={`${styles.avatar} ${styles.avatarAssistant}`}>
                  <IconCosmic />
                </div>
                <div className={styles.typingCard}>
                  <span>Cosmic AI is thinking</span>
                  <span className={styles.dots} aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className={styles.formWrap}>
            <form className={styles.form} onSubmit={handleSend}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the cosmos..."
                className={styles.input}
                disabled={isLoading}
                aria-label="Message"
              />
              <button type="submit" disabled={isLoading || !input.trim()} className={styles.sendBtn}>
                Send
              </button>
            </form>
          </div>

          <div className={styles.docSection}>
            <DocumentUpload onFileUpload={handleFileUpload} />
            {docError && (
              <p role="alert" className={styles.docError}>
                {docError}
              </p>
            )}
            {documents.length > 0 && (
              <ul className={styles.docList}>
                {documents.map((doc) => (
                  <li key={doc.id} className={styles.docRow}>
                    <FileTypeIcon type={doc.type} />
                    <span className={styles.docName} title={doc.name}>
                      {doc.name}
                    </span>
                    <span className={styles.docMeta}>{doc.chunks} chunks</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showClearConfirm && (
        <div
          className={styles.dialogWrap}
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-dialog-title"
        >
          <div className={styles.dialog}>
            <h3 id="clear-dialog-title">Clear all messages?</h3>
            <p>This removes the conversation from this screen. Your uploaded documents stay indexed.</p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button type="button" className={styles.dialogConfirm} onClick={confirmClearHistory}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className={styles.dialogWrap}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
        >
          <div className={styles.dialog}>
            <h3 id="delete-dialog-title">Delete conversation?</h3>
            <p>
              &ldquo;{deleteTarget.title}&rdquo; will be removed from history. This cannot be undone.
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setDeleteTargetId(null)}>
                Cancel
              </button>
              <button type="button" className={styles.dialogConfirm} onClick={confirmDeleteConversation}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
