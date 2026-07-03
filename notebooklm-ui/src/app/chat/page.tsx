'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import ChatInterface from '../../components/ChatInterface';
import styles from './ChatPage.module.css';

const CosmicBackdrop = dynamic(() => import('@/components/CosmicBackdrop'), { ssr: false });

export default function ChatPage() {
  return (
    <div className={styles.page}>
      <CosmicBackdrop />
      <div className={styles.vignette} aria-hidden />

      <nav className={styles.nav}>
        <Link href="/" className={styles.backLink}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to Galaxy
        </Link>

        <div className={styles.navCenter}>
          <span className={styles.navIcon} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="2" fill="#67e8f9" />
              <circle cx="12" cy="5" r="1.2" fill="#a78bfa" opacity="0.9" />
              <circle cx="19" cy="12" r="1.2" fill="#a78bfa" opacity="0.7" />
              <circle cx="12" cy="19" r="1.2" fill="#a78bfa" opacity="0.5" />
              <circle cx="5" cy="12" r="1.2" fill="#a78bfa" opacity="0.6" />
              <path
                d="M12 7v2M12 15v2M7 12H5M19 12h-2"
                stroke="rgba(103,232,249,0.35)"
                strokeWidth="0.75"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className={styles.navTitle}>Cosmic RAG</span>
        </div>

        <span className={styles.badge}>Multi-LLM · RAG</span>
      </nav>

      <main className={styles.main}>
        <ChatInterface />
      </main>
    </div>
  );
}
