'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGameStore } from '@/store/gameStore';
import { useSocket, emitJoinQueue } from '@/hooks/useSocket';
import { useCreateGame, useJoinGame } from '@/hooks/useEscrow';

const BG = 'radial-gradient(ellipse at center bottom, #7c2d12 0%, #431407 30%, #1c0a02 60%, #0a0500 100%)';
const FIRE = `
  radial-gradient(ellipse at 15% 70%, rgba(251,146,60,0.2) 0%, transparent 45%),
  radial-gradient(ellipse at 85% 70%, rgba(239,68,68,0.15) 0%, transparent 45%)
`;

const panelStyle = {
  background: 'rgba(0,0,0,0.55)',
  border: '1px solid rgba(120,80,26,0.6)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(245,200,50,0.07)',
};

const goldBtn = {
  background: 'linear-gradient(to bottom, #b8860b, #7a4f00)',
  border: '2px solid #f5c842',
  color: '#fff8e0',
  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  boxShadow: '0 0 28px rgba(245,158,11,0.5), 0 4px 14px rgba(0,0,0,0.8)',
};

export default function LobbyPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { status, gameId, wagerAmount, setWagerAmount, reset } = useGameStore();
  const [wagerInput, setWagerInput] = useState('0');
  const [useWager, setUseWager] = useState(false);

  useSocket(address);

  const { create, isPending: isCreating, isSuccess: createSuccess } = useCreateGame(gameId || '', wagerInput);
  const { join, isPending: isJoining, isSuccess: joinSuccess } = useJoinGame(gameId || '', wagerInput);

  useEffect(() => {
    if (status === 'active') {
      router.push('/game');
    }
  }, [status, router]);

  const handleJoinQueue = () => {
    if (!address) return;
    reset();
    emitJoinQueue(address);
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 relative" style={{ background: BG }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: FIRE }} />
        <p className="relative z-10 font-bold tracking-widest uppercase text-sm" style={{ color: 'rgba(245,200,80,0.6)' }}>
          Connect your wallet to enter the battle
        </p>
        <div className="relative z-10">
          <ConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-8 relative overflow-hidden" style={{ background: BG }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: FIRE }} />

      {/* Back link */}
      <Link href="/" className="absolute top-5 left-6 z-20">
        <motion.div
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-widest cursor-pointer"
          style={{ background: 'linear-gradient(to bottom, #292018, #1a130a)', border: '1px solid #78501a', color: '#d4a74a', boxShadow: '0 2px 8px rgba(0,0,0,0.6)' }}
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        >
          ◂ BACK
        </motion.div>
      </Link>

      {/* Header */}
      <motion.div className="relative z-10 text-center" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1
          className="font-black tracking-[0.15em] leading-none mb-1"
          style={{ fontSize: 'clamp(2.5rem, 8vw, 4rem)', color: '#f5c842', textShadow: '0 0 30px rgba(245,158,11,0.6), 0 3px 6px rgba(0,0,0,0.9)', fontFamily: 'Georgia, serif' }}
        >
          LOBBY
        </h1>
        <p className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </p>
      </motion.div>

      {/* Main panel */}
      <motion.div
        className="relative z-10 rounded-2xl p-8 w-full max-w-md flex flex-col gap-6"
        style={panelStyle}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        {/* Wager toggle */}
        <div className="flex items-center justify-between">
          <span className="font-bold tracking-widest text-sm uppercase" style={{ color: '#d4a74a' }}>Wager ETH</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={useWager} onChange={(e) => setUseWager(e.target.checked)} />
            <div className="w-11 h-6 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"
              style={{ background: useWager ? '#b8860b' : 'rgba(255,255,255,0.1)', border: '1px solid rgba(120,80,26,0.5)' }} />
          </label>
        </div>

        {/* Wager input */}
        {useWager && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-widest font-bold" style={{ color: 'rgba(212,167,74,0.7)' }}>Wager Amount (ETH)</label>
            <input
              type="number" min="0" step="0.001" value={wagerInput} placeholder="0.01"
              onChange={(e) => { setWagerInput(e.target.value); setWagerAmount(e.target.value); }}
              className="rounded-xl px-4 py-3 text-white focus:outline-none transition-colors"
              style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(120,80,26,0.5)', color: '#fff' }}
            />
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Both players must match this wager via smart contract</p>
          </motion.div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: 'rgba(120,80,26,0.4)' }} />
          <span style={{ color: 'rgba(120,80,26,0.6)', fontSize: 11 }}>⚔</span>
          <div className="h-px flex-1" style={{ background: 'rgba(120,80,26,0.4)' }} />
        </div>

        {/* Find Match button */}
        {status === 'idle' && (
          <motion.button
            onClick={handleJoinQueue}
            className="w-full py-4 font-black text-lg tracking-[0.15em] uppercase rounded-lg"
            style={goldBtn}
            whileHover={{ scale: 1.03, boxShadow: '0 0 45px rgba(245,158,11,0.8)' }}
            whileTap={{ scale: 0.97 }}
          >
            FIND MATCH
          </motion.button>
        )}

        {/* Searching */}
        {status === 'queued' && (
          <div className="flex flex-col items-center gap-5 py-2">
            <div className="flex gap-3">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-3 h-3 rounded-full"
                  style={{ background: '#b8860b' }}
                  animate={{ y: [0, -10, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.18 }}
                />
              ))}
            </div>
            <p className="font-bold tracking-widest text-sm uppercase" style={{ color: 'rgba(245,200,80,0.7)' }}>
              Seeking opponent...
            </p>
            <button
              onClick={() => reset()}
              className="text-xs uppercase tracking-widest underline"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            >
              Cancel
            </button>
          </div>
        )}
      </motion.div>

      <p className="relative z-10 text-xs text-center max-w-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>
        Games are provably fair — deck hash published before cards are dealt.
        {useWager && <span className="block mt-1" style={{ color: 'rgba(245,158,11,0.5)' }}>⚠ Wager requires both players to lock ETH in escrow.</span>}
      </p>
    </div>
  );
}
