import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import SiteFooter from '@/components/SiteFooter';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cosmic RAG App',
  description: 'Explore the cosmos and chat with Ollama, NVIDIA, DeepSeek, and more',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
