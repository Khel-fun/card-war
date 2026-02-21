'use client';

import { motion } from 'framer-motion';

interface CardDeckProps {
  count: number;
  label: string;
  isMe?: boolean;
}

export default function CardDeck({ count, label, isMe = false }: CardDeckProps) {
  const stackCount = Math.min(Math.ceil(count / 5), 6);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-24 h-36">
        {count === 0 ? (
          <div className="w-24 h-36 rounded-xl border-2 border-dashed border-war-border flex items-center justify-center">
            <span className="text-gray-600 text-xs">Empty</span>
          </div>
        ) : (
          Array.from({ length: stackCount }).map((_, i) => (
            <motion.div
              key={i}
              className={`absolute w-24 h-36 rounded-xl border-2 ${
                isMe ? 'border-war-accent bg-gradient-to-br from-war-accent to-purple-900' : 'border-war-border bg-gradient-to-br from-slate-700 to-slate-900'
              } shadow-md`}
              style={{ top: -i * 2, left: i * 1, zIndex: i }}
              animate={{ top: -i * 2 }}
              transition={{ duration: 0.3 }}
            />
          ))
        )}
      </div>
      <div className="text-center">
        <p className={`text-sm font-semibold ${isMe ? 'text-war-accent' : 'text-gray-400'}`}>{label}</p>
        <p className="text-2xl font-bold text-white">{count}</p>
        <p className="text-xs text-gray-500">cards</p>
      </div>
    </div>
  );
}
