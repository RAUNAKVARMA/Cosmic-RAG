'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchImageModels,
  generateImage,
  type ImageModel,
} from '@/lib/api';
import {
  loadImageHistory,
  prependImageHistory,
  removeImageHistoryEntry,
  type ImageHistoryEntry,
} from '@/lib/imageStudioHistory';
import styles from './ImageStudioChat.module.css';

interface Attachment {
  id: string;
  name: string;
  url: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images: Attachment[];
  resultUrl?: string;
  resultLabel?: string;
  isError?: boolean;
}

const MAX_ATTACHMENTS = 4;

function makeId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ImageStudioChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [history, setHistory] = useState<ImageHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const lastGenerateModelRef = useRef('');

  const isHistoryView = showHistory;

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url));
    };
  }, []);

  useEffect(() => {
    setHistory(loadImageHistory());
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isGenerating, history, isHistoryView]);

  useEffect(() => {
    let cancelled = false;
    fetchImageModels()
      .then((list) => {
        if (cancelled) return;
        const imageModels = list.filter((m) => m.output === 'image' && m.available);
        setModels(imageModels);
        const preferred = imageModels.find((m) => m.id === lastGenerateModelRef.current) ?? imageModels[0];
        if (preferred) {
          lastGenerateModelRef.current = preferred.id;
          setSelectedModel(preferred.id);
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setAttachments((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      const next = images.slice(0, Math.max(room, 0)).map((f) => ({
        id: makeId(),
        name: f.name,
        url: URL.createObjectURL(f),
      }));
      return [...prev, ...next];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const canSend =
    !isHistoryView &&
    input.trim().length > 0 &&
    !isGenerating &&
    selectedModel.length > 0;

  const handleRemoveHistory = (id: string) => {
    setHistory(removeImageHistoryEntry(id));
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
    const seed = Math.floor(Math.random() * 1_000_000);

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      text: prompt,
      images: attachments,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setAttachments([]);
    setIsGenerating(true);

    try {
      const result = await generateImage({ prompt, modelId: selectedModel, seed });
      const label = `${model?.label ?? selectedModel} · seed ${result.seed}`;
      setHistory(
        prependImageHistory({
          id: makeId(),
          prompt,
          image: result.image,
          label,
          createdAt: Date.now(),
        }),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: '',
          images: [],
          resultUrl: result.image,
          resultLabel: label,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text:
            err instanceof Error
              ? err.message
              : 'Image generation failed. Check that the model NIM is running.',
          images: [],
          isError: true,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const activeModel = isHistoryView ? undefined : models.find((m) => m.id === selectedModel);

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
                Generated images appear here. Close History to create a new one.
              </p>
            </div>
          ) : (
            <div className={styles.historyGrid}>
              {history.map((entry) => (
                <article key={entry.id} className={styles.historyCard}>
                  <span className={styles.historyImageWrap}>
                    <Image
                      src={entry.image}
                      alt={entry.prompt}
                      fill
                      sizes="(max-width: 640px) 50vw, 220px"
                      className={styles.historyImage}
                      unoptimized
                    />
                  </span>
                  <div className={styles.historyMeta}>
                    <p className={styles.historyPrompt}>{entry.prompt}</p>
                    <p className={styles.historyLabel}>
                      {entry.label} · {formatHistoryDate(entry.createdAt)}
                    </p>
                    <div className={styles.historyActions}>
                      <a
                        className={styles.downloadBtn}
                        href={entry.image}
                        download={`cosmic-${entry.id}.jpg`}
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className={styles.historyRemoveBtn}
                        onClick={() => handleRemoveHistory(entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : messages.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyOrb} aria-hidden />
            <h2 className={styles.emptyTitle}>Describe your cosmic vision</h2>
            <p className={styles.emptyText}>
              Type a prompt and pick a model to generate. Upload or drag &amp; drop reference
              images too.
            </p>
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
                {m.role === 'user' ? 'You' : 'AI'}
              </span>
              <div className={`${styles.msgCard} ${m.isError ? styles.msgCardError : ''}`}>
                {m.images.length > 0 && (
                  <div className={styles.msgImages}>
                    {m.images.map((img) => (
                      <span key={img.id} className={styles.msgImageWrap}>
                        <Image
                          src={img.url}
                          alt={img.name}
                          fill
                          sizes="140px"
                          className={styles.msgImage}
                          unoptimized
                        />
                      </span>
                    ))}
                  </div>
                )}
                {m.resultUrl && (
                  <figure className={styles.resultFigure}>
                    <span className={styles.resultImageWrap}>
                      <Image
                        src={m.resultUrl}
                        alt={m.resultLabel ?? 'Generated image'}
                        fill
                        sizes="(max-width: 640px) 100vw, 480px"
                        className={styles.resultImage}
                        unoptimized
                      />
                    </span>
                    <figcaption className={styles.resultCaption}>
                      <span>{m.resultLabel}</span>
                      <a
                        className={styles.downloadBtn}
                        href={m.resultUrl}
                        download={`cosmic-${makeId()}.jpg`}
                      >
                        Download
                      </a>
                    </figcaption>
                  </figure>
                )}
                {m.text && <p className={styles.msgText}>{m.text}</p>}
              </div>
            </div>
          ))
        )}

        {isGenerating && (
          <div className={styles.msgRow}>
            <span className={`${styles.avatar} ${styles.avatarAssistant}`} aria-hidden>
              AI
            </span>
            <div className={styles.msgCard}>
              <span className={styles.typing} aria-label="Generating">
                <span />
                <span />
                <span />
              </span>
              <span className={styles.genHint}>Generating with {activeModel?.label ?? 'model'}…</span>
            </div>
          </div>
        )}
      </div>

      {!isHistoryView && attachments.length > 0 && (
        <div className={styles.attachStrip}>
          {attachments.map((a) => (
            <div key={a.id} className={styles.attachThumb}>
              <Image
                src={a.url}
                alt={a.name}
                fill
                sizes="64px"
                className={styles.attachImage}
                unoptimized
              />
              <button
                type="button"
                className={styles.attachRemove}
                aria-label={`Remove ${a.name}`}
                onClick={() => removeAttachment(a.id)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.toolbar}>
        {!isHistoryView && (
          <>
            <label className={styles.modelLabel} htmlFor="image-model">
              Model
            </label>
            <div className={styles.selectWrap}>
              <select
                id="image-model"
                className={styles.modelSelect}
                value={selectedModel}
                onChange={(e) => {
                  lastGenerateModelRef.current = e.target.value;
                  setSelectedModel(e.target.value);
                }}
                disabled={models.length === 0}
              >
                {models.length === 0 ? (
                  <option value="">No models available</option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))
                )}
              </select>
              <svg className={styles.selectChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {activeModel && (
              <span
                className={`${styles.statusDot} ${styles.statusOk}`}
                title="Configured"
                aria-hidden
              />
            )}
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
          {history.length > 0 && (
            <span className={styles.historyCount}>{history.length}</span>
          )}
        </button>
      </div>

      {!isHistoryView && (
      <div className={styles.composer}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className={styles.uploadBtn}
          aria-label="Upload image"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachments.length >= MAX_ATTACHMENTS}
          title={
            attachments.length >= MAX_ATTACHMENTS
              ? `Up to ${MAX_ATTACHMENTS} images`
              : 'Upload image'
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
            <path
              d="M4 15.5l4-4a2 2 0 012.83 0L15 15.5m2-2l1-1a2 2 0 012.83 0L21 13.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <textarea
          className={styles.textarea}
          placeholder="Describe the image you want to create…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />

        <button
          type="button"
          className={styles.sendBtn}
          aria-label="Generate"
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
          <span className={styles.dropText}>Drop images to attach</span>
        </div>
      )}
    </div>
  );
}
