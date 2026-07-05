'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import styles from './NebulaStudioHint.module.css';

const PREVIEW_IMAGES = [
  '/studio/studio-nebula-1.png',
  '/studio/studio-nebula-3.png',
  '/studio/studio-nebula-2.png',
];

interface NebulaStudioHintProps {
  x: number;
  y: number;
  visible: boolean;
  expanded: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

function StudioIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
      <path
        d="M3.5 16.5l4.3-4.3a2 2 0 012.83 0l2.37 2.37m0 0l1.8-1.8a2 2 0 012.83 0l2.87 2.87"
        stroke="currentColor"
        strokeWidth="1.6"
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

export default function NebulaStudioHint({
  x,
  y,
  visible,
  expanded,
  onOpen,
  onDismiss,
}: NebulaStudioHintProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const layerFarRef = useRef<HTMLDivElement>(null);
  const layerNearRef = useRef<HTMLDivElement>(null);
  const [activeImage, setActiveImage] = useState(0);

  const MAX_TILT = 12;

  useEffect(() => {
    if (!expanded) return;
    const id = window.setInterval(() => {
      setActiveImage((prev) => (prev + 1) % PREVIEW_IMAGES.length);
    }, 3800);
    return () => window.clearInterval(id);
  }, [expanded]);

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
    if (layerNearRef.current) {
      layerNearRef.current.style.transition = 'none';
      layerNearRef.current.style.transform = `translate3d(${(dx * 22).toFixed(1)}px, ${(dy * 22).toFixed(1)}px, 0)`;
    }
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
    if (layerNearRef.current) {
      layerNearRef.current.style.transition = 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)';
      layerNearRef.current.style.transform = 'translate3d(0, 0, 0)';
    }
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
          aria-label="Close Image Studio"
          onClick={onDismiss}
        />
        <div className={styles.stage}>
          <div
            ref={cardRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="nebula-studio-title"
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

            <span ref={layerNearRef} className={styles.iconBadgeLg}>
              <StudioIcon />
            </span>

            <span className={styles.eyebrow}>Nebula discovered</span>
            <h2 id="nebula-studio-title" className={styles.modalTitle}>
              Image Studio
            </h2>
            <p className={styles.modalDesc}>
              Step into your creative lab in the galaxy — generate, upload, and refine cosmic
              visuals with AI.
            </p>

            <div className={styles.previewFrame} aria-hidden>
              <div ref={layerFarRef} className={styles.previewParallax}>
                {PREVIEW_IMAGES.map((src, i) => (
                  <Image
                    key={src}
                    src={src}
                    alt=""
                    fill
                    sizes="400px"
                    priority={i === 0}
                    className={`${styles.previewImage} ${i === activeImage ? styles.previewImageActive : ''}`}
                  />
                ))}
                <div className={styles.previewGrid} />
              </div>
              <div className={styles.previewScrim} />
              <div className={styles.previewDots}>
                {PREVIEW_IMAGES.map((src, i) => (
                  <span
                    key={src}
                    className={`${styles.previewDot} ${i === activeImage ? styles.previewDotActive : ''}`}
                  />
                ))}
              </div>
              <span className={styles.previewTag}>Live gallery</span>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryBtn} onClick={onDismiss}>
                Not now
              </button>
              <button type="button" className={styles.primaryBtn} onClick={onOpen}>
                Open Image Studio
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
        <StudioIcon />
      </span>
      <span className={styles.chipCopy}>
        <span className={styles.chipTitle}>Image Studio</span>
        <span className={styles.chipHint}>Click to explore</span>
      </span>
      <span className={styles.pointer} aria-hidden />
    </div>
  );
}
