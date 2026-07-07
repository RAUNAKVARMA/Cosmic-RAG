'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MessageContent from '@/components/MessageContent';
import {
  apiHeaders,
  fetchChatModels,
  getApiBaseUrl,
  parseApiErrorResponse,
  type ChatModel,
} from '@/lib/api';
import {
  loadCodingHistory,
  prependCodingHistory,
  removeCodingHistoryEntry,
  type CodingHistoryEntry,
} from '@/lib/codingAssistantHistory';
import styles from './CodingAssistantChat.module.css';

interface CodeSnippet {
  id: string;
  name: string;
  content: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  snippets: CodeSnippet[];
  isError?: boolean;
}

const MAX_SNIPPETS = 4;
const MAX_SNIPPET_CHARS = 12_000;
const CODE_EXTENSIONS = new Set([
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.sql',
  '.sh',
  '.ps1',
  '.yaml',
  '.yml',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.txt',
]);

const QUICK_PROMPTS = [
  'Explain this error and how to fix it',
  'Refactor this code for readability',
  'Write unit tests for this function',
  'Review for bugs and edge cases',
];

const FALLBACK_MODELS: ChatModel[] = [
  { id: 'auto', label: 'Auto Router', provider: 'router', available: true },
];

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isCodeFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(lower.slice(dot));
}

function buildCodingPayload(prompt: string, snippets: CodeSnippet[]): string {
  let body =
    'You are an expert coding assistant. Help with debugging, refactoring, explaining, and writing code. ' +
    'Use fenced code blocks with language tags when showing code.\n\n' +
    `User request:\n${prompt}`;

  if (snippets.length > 0) {
    body += '\n\n--- Reference files ---';
    for (const snippet of snippets) {
      body += `\n\n### ${snippet.name}\n\`\`\`\n${snippet.content}\n\`\`\``;
    }
  }
  return body;
}

export default function CodingAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<ChatModel[]>(FALLBACK_MODELS);
  const [modelsError, setModelsError] = useState('');
  const [selectedModel, setSelectedModel] = useState('auto');
  const [history, setHistory] = useState<CodingHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const lastModelRef = useRef('auto');

  const isHistoryView = showHistory;
  const apiBase = getApiBaseUrl();
  const activeModel = isHistoryView ? undefined : models.find((m) => m.id === selectedModel);

  const canSend =
    !isHistoryView && input.trim().length > 0 && !isLoading && selectedModel.length > 0;

  useEffect(() => {
    setHistory(loadCodingHistory());
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isLoading, history, isHistoryView]);

  useEffect(() => {
    let cancelled = false;
    fetchChatModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setModelsError('');
        const preferred =
          list.find((m) => m.id === lastModelRef.current) ??
          list.find((m) => m.id === 'auto') ??
          list[0];
        if (preferred) {
          lastModelRef.current = preferred.id;
          setSelectedModel(preferred.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setModels(FALLBACK_MODELS);
        setModelsError(
          err instanceof Error ? err.message : 'Could not load models from the API.',
        );
        setSelectedModel('auto');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addCodeFiles = useCallback(async (files: FileList | File[]) => {
    const codeFiles = Array.from(files).filter((f) => isCodeFile(f.name));
    if (codeFiles.length === 0) return;

    const read = await Promise.all(
      codeFiles.slice(0, MAX_SNIPPETS).map(async (file) => {
        const content = (await file.text()).slice(0, MAX_SNIPPET_CHARS);
        return { id: makeId(), name: file.name, content };
      }),
    );

    setSnippets((prev) => {
      const room = MAX_SNIPPETS - prev.length;
      if (room <= 0) return prev;
      return [...prev, ...read.slice(0, room)].slice(0, MAX_SNIPPETS);
    });
  }, []);

  const removeSnippet = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addCodeFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) void addCodeFiles(e.dataTransfer.files);
  };

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
    setSnippets([]);
    setShowHistory(false);
  };

  const handleRemoveHistory = (id: string) => {
    setHistory(removeCodingHistoryEntry(id));
  };

  const formatHistoryDate = (ts: number) =>
    new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));

  const handleSend = async () => {
    if (!canSend) return;

    const prompt = input.trim();
    const model = models.find((m) => m.id === selectedModel);
    const attachedSnippets = [...snippets];

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      text: prompt,
      snippets: attachedSnippets,
    };

    const priorHistory = messages
      .filter((m) => !m.isError)
      .slice(-20)
      .map(({ role, text }) => ({ role, content: text }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSnippets([]);
    setIsLoading(true);

    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: buildCodingPayload(prompt, attachedSnippets),
          model_id: selectedModel,
          history: priorHistory,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseApiErrorResponse(res));
      }

      const data = (await res.json()) as { answer: string };
      const answer = data.answer?.trim() || 'No response from the model.';

      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        text: answer,
        snippets: [],
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (model) {
        setHistory(
          prependCodingHistory({
            id: makeId(),
            prompt,
            answer,
            modelId: model.id,
            modelLabel: model.label,
            createdAt: Date.now(),
          }),
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Something went wrong.';
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: detail,
          snippets: [],
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      className={`${styles.chat} ${isDragging && !isHistoryView ? styles.dragging : ''}`}
      onDragOver={(e) => {
        if (isHistoryView) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (isHistoryView) return;
        e.preventDefault();
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className={styles.thread} ref={threadRef}>
        {isHistoryView ? (
          history.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyOrb} aria-hidden />
              <h2 className={styles.emptyTitle}>No history yet</h2>
              <p className={styles.emptyText}>
                Your coding sessions appear here. Close History to start a new one.
              </p>
            </div>
          ) : (
            <div className={styles.historyList}>
              {history.map((entry) => (
                <article key={entry.id} className={styles.historyCard}>
                  <p className={styles.historyPrompt}>{entry.prompt}</p>
                  <p className={styles.historyAnswer}>{entry.answer}</p>
                  <p className={styles.historyMeta}>
                    {entry.modelLabel} · {formatHistoryDate(entry.createdAt)}
                  </p>
                  <div className={styles.historyActions}>
                    <button
                      type="button"
                      className={styles.historyRemoveBtn}
                      onClick={() => handleRemoveHistory(entry.id)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : messages.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyOrb} aria-hidden />
            <h2 className={styles.emptyTitle}>Write, debug, and ship faster</h2>
            <p className={styles.emptyText}>
              Paste a snippet, describe a bug, or attach code files. The assistant replies with
              explanations and examples.
            </p>
            <div className={styles.promptChips}>
              {QUICK_PROMPTS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={styles.promptChip}
                  onClick={() => setInput(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.msgRow} ${m.role === 'user' ? styles.msgRowUser : ''}`}
            >
              <span
                className={`${styles.avatar} ${
                  m.role === 'user' ? styles.avatarUser : styles.avatarAssistant
                }`}
                aria-hidden
              >
                {m.role === 'user' ? 'You' : '</>'}
              </span>
              <div className={`${styles.msgCard} ${m.isError ? styles.msgCardError : ''}`}>
                {m.snippets.length > 0 && (
                  <div className={styles.snippetList}>
                    {m.snippets.map((s) => (
                      <span key={s.id} className={styles.snippetTag}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' ? (
                  <MessageContent content={m.text} role="assistant" />
                ) : (
                  <p className={styles.msgText}>{m.text}</p>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className={styles.msgRow}>
            <span className={`${styles.avatar} ${styles.avatarAssistant}`} aria-hidden>
              {'</>'}
            </span>
            <div className={styles.msgCard}>
              <span className={styles.typing} aria-label="Thinking">
                <span />
                <span />
                <span />
              </span>
              <span className={styles.genHint}>
                Code AI is thinking with {activeModel?.label ?? 'model'}…
              </span>
            </div>
          </div>
        )}
      </div>

      {!isHistoryView && snippets.length > 0 && (
        <div className={styles.attachStrip}>
          {snippets.map((s) => (
            <span key={s.id} className={styles.attachChip}>
              {s.name}
              <button
                type="button"
                className={styles.attachRemove}
                aria-label={`Remove ${s.name}`}
                onClick={() => removeSnippet(s.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.toolbar}>
        {!isHistoryView && (
          <>
            <label className={styles.modelLabel} htmlFor="coding-model">
              Model
            </label>
            <div className={styles.selectWrap}>
              <select
                id="coding-model"
                className={styles.modelSelect}
                value={models.some((m) => m.id === selectedModel) ? selectedModel : 'auto'}
                onChange={(e) => {
                  lastModelRef.current = e.target.value;
                  setSelectedModel(e.target.value);
                }}
                aria-label="Select AI model"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {!m.available && m.id !== 'auto' ? ' (setup needed)' : ''}
                  </option>
                ))}
              </select>
              <svg className={styles.selectChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {activeModel && (
              <span
                className={`${styles.statusDot} ${activeModel.available ? styles.statusOk : styles.statusOff}`}
                title={activeModel.available ? 'Ready' : 'May need API keys in backend/.env'}
                aria-hidden
              />
            )}
            <button type="button" className={styles.newChatBtn} onClick={handleNewChat}>
              New chat
            </button>
          </>
        )}
        <button
          type="button"
          className={`${styles.historyBtn} ${isHistoryView ? styles.historyBtnActive : ''}`}
          onClick={() => setShowHistory((prev) => !prev)}
          aria-pressed={isHistoryView}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          History
          {history.length > 0 && <span className={styles.historyCount}>{history.length}</span>}
        </button>
      </div>

      {!isHistoryView && modelsError && (
        <p className={styles.setupHint} role="alert">
          {modelsError}
        </p>
      )}

      {!isHistoryView && !modelsError && activeModel && !activeModel.available && (
        <p className={styles.setupHint}>
          This model may need API keys in backend/.env — you can still try it or pick Auto Router.
        </p>
      )}

      {!isHistoryView && (
        <div className={styles.composer}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".py,.js,.ts,.tsx,.jsx,.java,.go,.rs,.c,.cpp,.h,.cs,.rb,.php,.swift,.kt,.sql,.sh,.ps1,.yaml,.yml,.json,.md,.html,.css,.scss,.txt"
            multiple
            className={styles.hiddenInput}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className={styles.uploadBtn}
            aria-label="Attach code file"
            onClick={() => fileInputRef.current?.click()}
            disabled={snippets.length >= MAX_SNIPPETS}
            title={
              snippets.length >= MAX_SNIPPETS
                ? `Up to ${MAX_SNIPPETS} files`
                : 'Attach code file'
            }
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path d="M14 2v6h6M10 13h4M10 17h4M10 9h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <textarea
            className={styles.textarea}
            placeholder="Ask about code, paste an error, or request a refactor…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />

          <button
            type="button"
            className={styles.sendBtn}
            aria-label="Send"
            onClick={() => void handleSend()}
            disabled={!canSend}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 12h15m0 0l-6-6m6 6l-6 6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}

      {isDragging && !isHistoryView && (
        <div className={styles.dropOverlay} aria-hidden>
          <span className={styles.dropText}>Drop code files to attach</span>
        </div>
      )}
    </div>
  );
}
