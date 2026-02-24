import type { Metadata } from 'next';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import Providers from '@/components/Providers';
import ClientOnly from '@/components/ClientOnly';

export const metadata: Metadata = {
  title: 'Card War — PvP Card Game',
  description: 'Real-time 1v1 War card game with Web3 wagering',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-war-bg text-white min-h-screen antialiased">
        <ClientOnly>
          <Providers>{children}</Providers>
        </ClientOnly>
      </body>
    </html>
  );
}
