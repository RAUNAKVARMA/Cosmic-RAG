'use client';

import { useRef } from 'react';
import styles from './NebulaCodingHint.module.css';

interface NebulaCodingHintProps {
  x: number;
  y: number;
  visible: boolean;
  expanded: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

function CodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CodePreview() {
  return (
    <pre className={styles.codeBlock}>
      <span className={styles.codeComment}>{'// Nebula coding lab'}</span>
      {'\n'}
      <span className={styles.codeKw}>async function</span>{' '}
      <span className={styles.codeFn}>solve</span>
      {'(query) {\n  '}
      <span className={styles.codeKw}>const</span> context ={' '}
      <span className={styles.codeKw}>await</span> rag.retrieve(query);
      {'\n  '}
      <span className={styles.codeKw}>return</span> llm.generate(
      <span className={styles.codeStr}>&quot;Explain + code&quot;</span>, context);
      {'\n}'}
    </pre>
  );
}

export default function NebulaCodingHint({
  x,
  y,
  visible,
  expanded,
  onOpen,
  onDismiss,
}: NebulaCodingHintProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const layerFarRef = useRef<HTMLDivElement>(null);

  const MAX_TILT = 12;

  const handleTiltMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (0.5 - py) * MAX_TILT;
    const ry = (px - 0.5) * (MAX_TILT + 2);

    card.style.transition = 'none';
    card.style.transform = `perspective(1100px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;

    if (glareRef.current) {
      glareRef.current.style.opacity = '1';
      glareRef.current.style.background = `radial-gradient(circle at ${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%, rgba(255,255,255,0.22), transparent 45%)`;
    }
    const dx = px - 0.5;
    const dy = py - 0.5;
    if (layerFarRef.current) {
      layerFarRef.current.style.transition = 'none';
      layerFarRef.current.style.transform = `translate3d(${(dx * -16).toFixed(1)}px, ${(dy * -16).toFixed(1)}px, 0)`;
    }
  };

  const handleTiltLeave = () => {
    const card = cardRef.current;
    if (card) {
      card.style.transition = 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)';
      card.style.transform = 'perspective(1100px) rotateX(0deg) rotateY(0deg)';
    }
    if (glareRef.current) glareRef.current.style.opacity = '0';
    if (layerFarRef.current) {
      layerFarRef.current.style.transition = 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)';
      layerFarRef.current.style.transform = 'translate3d(0, 0, 0)';
    }
  };

  if (!visible && !expanded) return null;

  if (expanded) {
    return (
      <div className={styles.overlay} role="presentation">
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close Coding Assistant"
          onClick={onDismiss}
        />
        <div className={styles.stage}>
          <div
            ref={cardRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nebula-coding-title"
            onPointerMove={handleTiltMove}
            onPointerLeave={handleTiltLeave}
          >
            <div className={styles.aura} aria-hidden />
            <div ref={glareRef} className={styles.glare} aria-hidden />

            <button
              type="button"
              className={styles.closeBtn}
              aria-label="Close"
              onClick={onDismiss}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <span className={styles.iconBadgeLg}>
              <CodeIcon />
            </span>

            <span className={styles.eyebrow}>Nebula discovered</span>
            <h2 id="nebula-coding-title" className={styles.modalTitle}>
              Coding Assistant
            </h2>
            <p className={styles.modalDesc}>
              Pair with an AI that writes, debugs, and explains code — grounded in your docs when
              you need context from the cosmos.
            </p>

            <div className={styles.previewFrame} aria-hidden>
              <div ref={layerFarRef} className={styles.previewParallax}>
                <CodePreview />
              </div>
              <div className={styles.previewScrim} />
              <span className={styles.previewTag}>Code lab</span>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryBtn} onClick={onDismiss}>
                Not now
              </button>
              <button type="button" className={styles.primaryBtn} onClick={onOpen}>
                Open Coding Assistant
                <ArrowIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.chip} ${visible ? styles.chipVisible : ''}`}
      style={{ left: x, top: y }}
      role="status"
      aria-live="polite"
    >
      <span className={styles.iconBadge}>
        <CodeIcon />
      </span>
      <span className={styles.chipCopy}>
        <span className={styles.chipTitle}>Coding Assistant</span>
        <span className={styles.chipHint}>Click to explore</span>
      </span>
      <span className={styles.pointer} aria-hidden />
    </div>
  );
}
