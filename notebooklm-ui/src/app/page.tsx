'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import NebulaStudioHint from '@/components/NebulaStudioHint';
import type { NebulaHoverState } from '@/components/nebulaHover';
import styles from './page.module.css';

const SpaceScene = dynamic(() => import('@/components/SpaceScene'), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [nebulaHover, setNebulaHover] = useState<NebulaHoverState | null>(null);
  const [studioExpanded, setStudioExpanded] = useState(false);
  const studioExpandedRef = useRef(false);

  useEffect(() => {
    studioExpandedRef.current = studioExpanded;
  }, [studioExpanded]);

  const enter = () => router.push('/chat');

  const handleNebulaHoverChange = useCallback((state: NebulaHoverState | null) => {
    if (!state?.visible) {
      if (!studioExpandedRef.current) {
        setNebulaHover(null);
      }
      return;
    }
    setNebulaHover({ x: Math.round(state.x), y: Math.round(state.y), visible: true });
  }, []);

  const handleNebulaClick = useCallback(() => {
    setStudioExpanded(true);
  }, []);

  const dismissStudio = useCallback(() => {
    setStudioExpanded(false);
    setNebulaHover(null);
  }, []);

  const openStudio = useCallback(() => {
    setStudioExpanded(false);
    setNebulaHover(null);
    router.push('/image-studio');
  }, [router]);

  return (
    <>
      <SpaceScene
        onBlackHoleClick={enter}
        onImageStudioNebulaClick={handleNebulaClick}
        onNebulaHoverChange={handleNebulaHoverChange}
      />
      <div className={styles.overlay}>
        <div className={styles.hero}>
          <h1 className={styles.title}>Cosmic RAG</h1>
          <p className={styles.subtitle}>
            A retrieval-augmented knowledge assistant. Upload your documents and get grounded,
            low-latency answers from across your corpus.
          </p>
          <button type="button" className={styles.cta} onClick={enter}>
            Enter the knowledge portal
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12h14m0 0l-5-5m5 5l-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <p className={styles.ctaHint}>Or click the black hole to dive in</p>
        </div>
      </div>
      {(studioExpanded || (nebulaHover?.visible ?? false)) && (
        <NebulaStudioHint
          x={nebulaHover?.x ?? 0}
          y={nebulaHover?.y ?? 0}
          visible={nebulaHover?.visible ?? false}
          expanded={studioExpanded}
          onOpen={openStudio}
          onDismiss={dismissStudio}
        />
      )}
    </>
  );
}
