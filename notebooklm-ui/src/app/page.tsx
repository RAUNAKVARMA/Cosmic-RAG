'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import NebulaCodingHint from '@/components/NebulaCodingHint';
import NebulaStudioHint from '@/components/NebulaStudioHint';
import type { NebulaHoverState, NebulaId } from '@/components/nebulaHover';
import styles from './page.module.css';

const SpaceScene = dynamic(() => import('@/components/SpaceScene'), { ssr: false });

export default function Home() {
  const router = useRouter();
  const [nebulaHover, setNebulaHover] = useState<NebulaHoverState | null>(null);
  const [expandedNebula, setExpandedNebula] = useState<NebulaId | null>(null);
  const expandedNebulaRef = useRef<NebulaId | null>(null);

  useEffect(() => {
    expandedNebulaRef.current = expandedNebula;
  }, [expandedNebula]);

  const enter = () => router.push('/chat');

  const handleNebulaHoverChange = useCallback((state: NebulaHoverState | null) => {
    if (!state?.visible) {
      if (!expandedNebulaRef.current) {
        setNebulaHover(null);
      }
      return;
    }
    setNebulaHover({
      id: state.id,
      x: Math.round(state.x),
      y: Math.round(state.y),
      visible: true,
    });
  }, []);

  const handleImageStudioClick = useCallback(() => {
    setExpandedNebula('image-studio');
  }, []);

  const handleCodingAssistantClick = useCallback(() => {
    setExpandedNebula('coding-assistant');
  }, []);

  const dismissNebula = useCallback(() => {
    setExpandedNebula(null);
    setNebulaHover(null);
  }, []);

  const openImageStudio = useCallback(() => {
    setExpandedNebula(null);
    setNebulaHover(null);
    router.push('/image-studio');
  }, [router]);

  const openCodingAssistant = useCallback(() => {
    setExpandedNebula(null);
    setNebulaHover(null);
    router.push('/coding-assistant');
  }, [router]);

  const showImageStudio =
    expandedNebula === 'image-studio' ||
    (nebulaHover?.id === 'image-studio' && nebulaHover.visible);
  const showCodingAssistant =
    expandedNebula === 'coding-assistant' ||
    (nebulaHover?.id === 'coding-assistant' && nebulaHover.visible);

  return (
    <>
      <SpaceScene
        onBlackHoleClick={enter}
        onImageStudioNebulaClick={handleImageStudioClick}
        onCodingAssistantNebulaClick={handleCodingAssistantClick}
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
      {showImageStudio && (
        <NebulaStudioHint
          x={nebulaHover?.id === 'image-studio' ? nebulaHover.x : 0}
          y={nebulaHover?.id === 'image-studio' ? nebulaHover.y : 0}
          visible={nebulaHover?.id === 'image-studio' ? nebulaHover.visible : false}
          expanded={expandedNebula === 'image-studio'}
          onOpen={openImageStudio}
          onDismiss={dismissNebula}
        />
      )}
      {showCodingAssistant && (
        <NebulaCodingHint
          x={nebulaHover?.id === 'coding-assistant' ? nebulaHover.x : 0}
          y={nebulaHover?.id === 'coding-assistant' ? nebulaHover.y : 0}
          visible={nebulaHover?.id === 'coding-assistant' ? nebulaHover.visible : false}
          expanded={expandedNebula === 'coding-assistant'}
          onOpen={openCodingAssistant}
          onDismiss={dismissNebula}
        />
      )}
    </>
  );
}
