'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import ImageStudioChat from '@/components/ImageStudioChat';
import styles from './ImageStudioPage.module.css';

const CosmicBackdrop = dynamic(() => import('@/components/CosmicBackdrop'), { ssr: false });

export default function ImageStudioPage() {
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
          <span className={styles.navTitle}>Image Studio</span>
        </div>

        <span className={styles.badge}>Creative Lab</span>
      </nav>

      <main className={styles.main}>
        <div className={styles.shell}>
          <div className={styles.shellInner}>
            <header className={styles.header}>
              <h1 className={styles.title}>Image Studio</h1>
              <p className={styles.subtitle}>
                Prompt or upload a reference image, and let the studio craft cosmic visuals.
              </p>
            </header>

            <ImageStudioChat />

            <p className={styles.footerNote}>Discovered from the orange nebula in the galaxy.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
