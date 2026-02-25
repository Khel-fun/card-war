'use client';

import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion } from 'framer-motion';
import Link from 'next/link';

const BG = 'radial-gradient(ellipse at center bottom, #7c2d12 0%, #431407 30%, #1c0a02 60%, #0a0500 100%)';
const FIRE = `
  radial-gradient(ellipse at 15% 70%, rgba(251,146,60,0.22) 0%, transparent 45%),
  radial-gradient(ellipse at 85% 70%, rgba(239,68,68,0.18) 0%, transparent 45%),
  radial-gradient(ellipse at 50% 90%, rgba(245,158,11,0.1) 0%, transparent 50%)
`;

export default function HomePage() {
  const { isConnected } = useAccount();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: BG }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: FIRE }} />

      <motion.div
        className="relative z-10 text-center max-w-lg w-full"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
      >
        {/* Title */}
        <motion.h1
          className="font-black tracking-[0.12em] leading-none mb-1"
          style={{
            fontSize: 'clamp(4rem, 14vw, 8rem)',
            color: '#f5c842',
            textShadow: '0 0 60px rgba(245,158,11,0.6), 0 4px 8px rgba(0,0,0,0.9)',
            fontFamily: 'Georgia, serif',
          }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, type: 'spring' }}
        >
          WAR
        </motion.h1>
        <p className="text-sm font-bold tracking-[0.3em] uppercase mb-8" style={{ color: 'rgba(245,200,80,0.55)' }}>
          Card Battle · 1v1 PvP
        </p>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, transparent, #78501a)' }} />
          <span style={{ color: '#78501a', fontSize: 12 }}>⚔</span>
          <div className="h-px flex-1" style={{ background: 'linear-gradient(to left, transparent, #78501a)' }} />
        </div>

        {/* Wallet connect */}
        <div className="flex flex-col items-center gap-5 mb-10">
          <ConnectButton />

          {isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="w-full"
            >
              <Link href="/lobby">
                <motion.button
                  className="w-full py-4 px-8 font-black text-xl tracking-[0.15em] uppercase rounded-lg"
                  style={{
                    background: 'linear-gradient(to bottom, #b8860b, #7a4f00)',
                    border: '2px solid #f5c842',
                    color: '#fff8e0',
                    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    boxShadow: '0 0 30px rgba(245,158,11,0.5), 0 4px 16px rgba(0,0,0,0.8)',
                  }}
                  whileHover={{ scale: 1.04, boxShadow: '0 0 50px rgba(245,158,11,0.8)' }}
                  whileTap={{ scale: 0.97 }}
                >
                  ENTER BATTLE
                </motion.button>
              </Link>
            </motion.div>
          )}
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: '⚡', title: 'Real-time', desc: 'WebSocket instant gameplay' },
            { icon: '🔒', title: 'Fair', desc: 'Deck hash published before game' },
            { icon: '🎮', title: 'PvP', desc: 'Challenge players worldwide' },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl p-4 text-center"
              style={{
                background: 'rgba(0,0,0,0.45)',
                border: '1px solid rgba(120,80,26,0.5)',
                boxShadow: 'inset 0 1px 0 rgba(245,200,50,0.06)',
              }}
            >
              <div className="text-2xl mb-2">{f.icon}</div>
              <p className="font-bold text-sm mb-1" style={{ color: '#d4a74a' }}>{f.title}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
