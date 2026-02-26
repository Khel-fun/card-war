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
  const { status, gameWinner, playerId, roundNumber, cardCounts, reset } = useGameStore();

  useSocket(address);

  useEffect(() => {
    if (status === 'idle') {
      router.push('/lobby');
    }
  }, [status, router]);

  const isWinner = gameWinner === playerId;
  const opponentId = Object.keys(cardCounts).find(id => id !== playerId) ?? '';
  const myScore = cardCounts[playerId ?? ''] ?? 0;
  const opponentScore = cardCounts[opponentId] ?? 0;

  if (status === 'game_over') {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4 gap-8 relative overflow-hidden"
        style={{
          background: 'radial-gradient(ellipse at center bottom, #7c2d12 0%, #431407 30%, #1c0a02 60%, #0a0500 100%)',
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at 20% 50%, rgba(251,146,60,0.15) 0%, transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(239,68,68,0.1) 0%, transparent 50%)',
        }} />
        <motion.div
          className="text-center relative z-10"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.6 }}
        >
          <div className="text-8xl mb-4">{isWinner ? '🏆' : '💀'}</div>
          <h1
            className="text-6xl font-bold mb-2 font-display"
            style={{
              color: isWinner ? '#f59e0b' : '#ef4444',
              textShadow: isWinner
                ? '0 0 40px rgba(245,158,11,0.8), 0 2px 4px rgba(0,0,0,0.8)'
                : '0 0 40px rgba(239,68,68,0.8), 0 2px 4px rgba(0,0,0,0.8)',
            }}
          >
            {isWinner ? 'VICTORY!' : 'DEFEATED'}
          </h1>
          <p className="text-amber-300/70 text-lg mb-6">Battle ended after {roundNumber} rounds</p>

          <div
            className="flex gap-12 justify-center mb-8 px-8 py-4 rounded-xl"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(245,158,11,0.3)' }}
          >
            <div className="text-center">
              <p className="text-amber-400/60 text-xs uppercase tracking-widest mb-1">Your Score</p>
              <p className="text-4xl font-bold text-white font-display">{myScore}</p>
            </div>
            <div className="w-px bg-amber-900/50" />
            <div className="text-center">
              <p className="text-amber-400/60 text-xs uppercase tracking-widest mb-1">Opponent Score</p>
              <p className="text-4xl font-bold text-white font-display">{opponentScore}</p>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <Link href="/lobby">
              <motion.button
                onClick={reset}
                className="px-10 py-3 font-bold text-lg rounded-lg transition-all"
                style={{
                  background: 'linear-gradient(to bottom, #d97706, #92400e)',
                  border: '2px solid #f59e0b',
                  color: '#fef3c7',
                  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                  boxShadow: '0 0 20px rgba(245,158,11,0.4)',
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                PLAY AGAIN
              </motion.button>
            </Link>
            <Link href="/">
              <button
                onClick={reset}
                className="px-10 py-3 font-bold text-lg rounded-lg transition-all"
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  border: '2px solid rgba(245,158,11,0.3)',
                  color: '#d6d3d1',
                }}
              >
                HOME
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{
      background: 'radial-gradient(ellipse at center bottom, #7c2d12 0%, #431407 30%, #1c0a02 60%, #0a0500 100%)',
    }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(ellipse at 15% 60%, rgba(251,146,60,0.25) 0%, transparent 40%),
          radial-gradient(ellipse at 85% 60%, rgba(239,68,68,0.2) 0%, transparent 40%),
          radial-gradient(ellipse at 50% 80%, rgba(245,158,11,0.1) 0%, transparent 50%)
        `,
      }} />
      <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none" style={{
        background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
      }} />

      <AnimatePresence mode="wait">
        {(status === 'active' || status === 'war') && (
          <motion.div
            key="gameboard"
            className="w-full h-full"
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
            className="flex flex-col items-center justify-center min-h-screen gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className="text-7xl"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            >
              🃏
            </motion.div>
            <p
              className="text-2xl font-bold font-display"
              style={{ color: '#f59e0b', textShadow: '0 0 20px rgba(245,158,11,0.5)' }}
            >
              Seeking Opponent...
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
