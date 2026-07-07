'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import CodingAssistantChat from '@/components/CodingAssistantChat';
import styles from './CodingAssistantPage.module.css';

const CosmicBackdrop = dynamic(() => import('@/components/CosmicBackdrop'), { ssr: false });

export default function CodingAssistantPage() {
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
          <span className={styles.backText}>Back to Galaxy</span>
        </Link>

        <div className={styles.navCenter}>
          <span className={styles.navTitle}>Coding Assistant</span>
        </div>

        <span className={styles.badge}>Code Lab</span>
      </nav>

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.shellInner}>
            <header className={styles.header}>
              <h1 className={styles.title}>Coding Assistant</h1>
              <p className={styles.subtitle}>
                Debug, refactor, and generate code with an AI that can pull from your uploaded docs.
              </p>
            </header>

            <CodingAssistantChat />

            <p className={styles.footerNote}>Discovered from the green nebula in the galaxy.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
