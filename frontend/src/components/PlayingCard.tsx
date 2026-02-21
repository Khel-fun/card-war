'use client';

import { motion } from 'framer-motion';

interface PlayingCardProps {
  rank?: number;
  suit?: string;
  faceDown?: boolean;
  animate?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLORS: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-gray-900',
  spades: 'text-gray-900',
};

function rankLabel(rank: number): string {
  if (rank <= 10) return String(rank);
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank];
}

const sizes = {
  sm: 'w-16 h-24 text-sm',
  md: 'w-24 h-36 text-base',
  lg: 'w-32 h-48 text-xl',
};

export default function PlayingCard({ rank, suit, faceDown = false, animate = false, size = 'md' }: PlayingCardProps) {
  const sizeClass = sizes[size];

  if (faceDown) {
    return (
      <motion.div
        className={`${sizeClass} rounded-xl border-2 border-war-border bg-gradient-to-br from-war-accent to-purple-900 flex items-center justify-center shadow-lg`}
        initial={animate ? { rotateY: 90, scale: 0.8 } : {}}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="text-4xl opacity-30">🂠</div>
      </motion.div>
    );
  }

  if (!rank || !suit) {
    return (
      <div className={`${sizeClass} rounded-xl border-2 border-dashed border-war-border bg-war-card flex items-center justify-center`}>
        <span className="text-gray-600 text-xs">Empty</span>
      </div>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[suit] || suit;
  const suitColor = SUIT_COLORS[suit] || 'text-gray-900';
  const label = rankLabel(rank);

  return (
    <motion.div
      className={`${sizeClass} rounded-xl border-2 border-gray-200 bg-white flex flex-col justify-between p-2 shadow-xl`}
      initial={animate ? { rotateY: 90, scale: 0.8, y: -20 } : {}}
      animate={{ rotateY: 0, scale: 1, y: 0 }}
      transition={{ duration: 0.4, type: 'spring' }}
    >
      <div className={`font-bold leading-none ${suitColor} font-display`}>
        <div>{label}</div>
        <div className="text-xs">{suitSymbol}</div>
      </div>
      <div className={`text-center text-3xl ${suitColor} font-display`}>{suitSymbol}</div>
      <div className={`font-bold leading-none ${suitColor} font-display rotate-180 self-end`}>
        <div>{label}</div>
        <div className="text-xs">{suitSymbol}</div>
      </div>
    </motion.div>
  );
}
