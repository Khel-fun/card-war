'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function HomePage() {
  const { isConnected } = useAccount();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <motion.div
        className="text-center max-w-lg"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <motion.div
          className="text-8xl mb-6"
          animate={{ rotateY: [0, 360] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        >
          🃏
        </motion.div>

        <h1 className="text-5xl font-bold text-white mb-3 font-display tracking-tight">
          Card <span className="text-war-accent">War</span>
        </h1>
        <p className="text-gray-400 text-lg mb-2">
          Real-time 1v1 PvP card game
        </p>
        <p className="text-gray-600 text-sm mb-10">
          Connect your wallet · Join the queue · Flip to win
        </p>

        <div className="flex flex-col items-center gap-4">
          <ConnectButton />

          {isConnected && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="flex flex-col gap-3 w-full"
            >
              <Link href="/lobby">
                <motion.button
                  className="w-full py-4 px-8 bg-war-accent hover:bg-purple-600 text-white font-bold text-xl rounded-2xl shadow-lg shadow-purple-900/50 transition-colors"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Enter Lobby
                </motion.button>
              </Link>
            </motion.div>
          )}
        </div>

        <div className="mt-16 grid grid-cols-3 gap-6 text-center">
          {[
            { icon: '⚡', title: 'Real-time', desc: 'WebSocket powered instant gameplay' },
            { icon: '🔒', title: 'Fair', desc: 'Deck hash published before game starts' },
            { icon: '💎', title: 'Web3', desc: 'Wager ETH via smart contract escrow' },
          ].map((f) => (
            <div key={f.title} className="bg-war-card border border-war-border rounded-xl p-4">
              <div className="text-3xl mb-2">{f.icon}</div>
              <p className="text-white font-semibold text-sm">{f.title}</p>
              <p className="text-gray-500 text-xs mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </main>
  );
}
