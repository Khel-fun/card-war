'use client';

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { useSocket } from '@/hooks/useSocket';
import GameBoard from '@/components/GameBoard';
import Link from 'next/link';

export default function GamePage() {
  const { address } = useAccount();
  const router = useRouter();
  const { status, gameWinner, playerId, roundNumber, cardCounts, deckHash, reset } = useGameStore();

  useSocket(address);

  useEffect(() => {
    if (status === 'idle') {
      router.push('/lobby');
    }
  }, [status, router]);

  const isWinner = gameWinner === playerId;
  const opponentId = Object.keys(cardCounts).find(id => id !== playerId) ?? '';

  if (status === 'game_over') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.6 }}
        >
          <div className="text-8xl mb-6">
            {isWinner ? '🏆' : '💀'}
          </div>
          <h1 className={`text-5xl font-bold mb-3 font-display ${isWinner ? 'text-war-gold' : 'text-war-red'}`}>
            {isWinner ? 'You Win!' : 'You Lose'}
          </h1>
          <p className="text-gray-400 text-lg mb-2">
            Game ended after {roundNumber} rounds
          </p>
          <div className="flex gap-8 justify-center mt-4 mb-8">
            <div className="text-center">
              <p className="text-xs text-gray-500">Your cards</p>
              <p className="text-3xl font-bold text-white">{cardCounts[playerId ?? ''] ?? 0}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Opponent cards</p>
              <p className="text-3xl font-bold text-white">{cardCounts[opponentId] ?? 0}</p>
            </div>
          </div>

          {deckHash && (
            <div className="bg-war-card border border-war-border rounded-xl p-4 mb-6 max-w-sm mx-auto">
              <p className="text-xs text-gray-500 mb-1">Deck Hash (verify fairness)</p>
              <p className="font-mono text-xs text-gray-400 break-all">{deckHash}</p>
            </div>
          )}

          <div className="flex gap-4 justify-center">
            <Link href="/lobby">
              <motion.button
                onClick={reset}
                className="px-8 py-3 bg-war-accent hover:bg-purple-600 text-white font-bold rounded-xl transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                Play Again
              </motion.button>
            </Link>
            <Link href="/">
              <button
                onClick={reset}
                className="px-8 py-3 bg-war-card border border-war-border hover:border-war-accent text-gray-300 font-bold rounded-xl transition-colors"
              >
                Home
              </button>
            </Link>
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start pt-8 px-4 gap-6">
      <div className="flex items-center justify-between w-full max-w-2xl">
        <Link href="/lobby" className="text-gray-600 hover:text-gray-400 text-sm transition-colors">
          ← Leave Game
        </Link>
        <h1 className="text-xl font-bold text-white font-display">⚔️ Card War</h1>
        <div className="text-xs text-gray-600 font-mono">
          {status === 'queued' ? 'Searching...' : status === 'active' ? 'Active' : status === 'war' ? '⚔️ WAR' : status}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {(status === 'active' || status === 'war') && (
          <motion.div
            key="gameboard"
            className="w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <GameBoard />
          </motion.div>
        )}

        {status === 'queued' && (
          <motion.div
            key="queued"
            className="flex flex-col items-center gap-4 mt-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="text-6xl"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            >
              🃏
            </motion.div>
            <p className="text-gray-400">Waiting for opponent...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
