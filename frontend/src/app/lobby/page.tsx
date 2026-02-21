'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/store/gameStore';
import { useSocket, emitJoinQueue } from '@/hooks/useSocket';
import { useCreateGame, useJoinGame } from '@/hooks/useEscrow';

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
      <main className="min-h-screen flex flex-col items-center justify-center gap-6">
        <p className="text-gray-400">Connect your wallet to play</p>
        <ConnectButton />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-4xl font-bold text-white mb-2 font-display">🃏 Lobby</h1>
        <p className="text-gray-500 text-sm font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</p>
      </motion.div>

      <motion.div
        className="bg-war-card border border-war-border rounded-2xl p-8 w-full max-w-md flex flex-col gap-6"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between">
          <span className="text-gray-300 font-semibold">Wager ETH</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={useWager}
              onChange={(e) => setUseWager(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-war-accent"></div>
          </label>
        </div>

        {useWager && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex flex-col gap-2"
          >
            <label className="text-sm text-gray-400">Wager Amount (ETH)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={wagerInput}
              onChange={(e) => {
                setWagerInput(e.target.value);
                setWagerAmount(e.target.value);
              }}
              className="bg-war-bg border border-war-border rounded-xl px-4 py-3 text-white focus:outline-none focus:border-war-accent transition-colors"
              placeholder="0.01"
            />
            <p className="text-xs text-gray-600">Both players must match this wager via smart contract</p>
          </motion.div>
        )}

        {status === 'idle' && (
          <motion.button
            onClick={handleJoinQueue}
            className="w-full py-4 bg-war-accent hover:bg-purple-600 text-white font-bold text-lg rounded-xl shadow-lg shadow-purple-900/50 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Find Match
          </motion.button>
        )}

        {status === 'queued' && (
          <div className="flex flex-col items-center gap-4">
            <motion.div
              className="flex gap-2"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-3 h-3 bg-war-accent rounded-full"
                  animate={{ y: [0, -8, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
                />
              ))}
            </motion.div>
            <p className="text-gray-400">Searching for opponent...</p>
            <button
              onClick={() => reset()}
              className="text-sm text-gray-600 hover:text-gray-400 underline"
            >
              Cancel
            </button>
          </div>
        )}
      </motion.div>

      <div className="text-center text-xs text-gray-700 max-w-sm">
        <p>Games are fair — deck hash is published before cards are dealt.</p>
        {useWager && <p className="mt-1 text-war-gold">⚠️ Wager requires both players to lock ETH in the smart contract.</p>}
      </div>
    </main>
  );
}
