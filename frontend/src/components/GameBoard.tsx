'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useGameStore } from '@/store/gameStore';
import { emitFlipCard, emitResolveWar } from '@/hooks/useSocket';

const MAX_ROUNDS = 5;

function getCardImg(rank: number | string, suit: string): string {
  const suitMap: Record<string, string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
  const rankMap: Record<string, string> = { '1': 'a', '11': 'j', '12': 'q', '13': 'k', '14': 'a', ace: 'a', jack: 'j', queen: 'q', king: 'k' };
  const s = suitMap[suit.toLowerCase()] ?? suit[0].toLowerCase();
  const key = String(rank).toLowerCase();
  const r = rankMap[key] ?? key;
  return `/cards/${r}${s}.png`;
}

function SideDeck({ count, label, isMe, scoreChange }: { count: number; label: string; isMe: boolean; scoreChange?: number | null }) {
  const layers = Math.min(count, 5);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: 72, height: 100 }}>
        {Array.from({ length: Math.max(layers, 1) }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-md overflow-hidden"
            style={{
              width: 60, height: 84,
              top: i * 3, left: i * 2,
              zIndex: layers - i,
              boxShadow: '0 3px 10px rgba(0,0,0,0.7)',
              filter: isMe ? 'hue-rotate(200deg) saturate(1.4)' : 'none',
            }}
          >
            <Image src="/cards/back_of_card.jpg" alt="" fill className="object-cover" />
          </div>
        ))}
      </div>
      <p className="font-bold text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</p>
      <div className="relative">
        <p className="font-black text-lg" style={{ color: '#d4a74a', textShadow: '0 0 8px rgba(245,158,11,0.5)' }}>{count}</p>
        <AnimatePresence>
          {scoreChange !== null && scoreChange !== undefined && (
            <motion.p
              key={`score-${scoreChange}`}
              className="absolute font-black text-sm"
              style={{
                color: scoreChange > 0 ? '#22c55e' : '#ef4444',
                textShadow: '0 0 10px currentColor',
                left: '50%',
                transform: 'translateX(-50%)',
                top: 24,
              }}
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 0, y: 15 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5 }}
            >
              {scoreChange > 0 ? `+${scoreChange}` : scoreChange}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BigCard({ card, label, won }: { card?: { rank: number | string; suit: string } | null; label: string; won?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-3">
      <p className="text-xs sm:text-sm font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</p>
      <div className="relative" style={{ width: 'clamp(90px, 25vw, 130px)', height: 'clamp(126px, 35vw, 182px)' }}>
        {[2, 1].map(i => (
          <div
            key={i}
            className="absolute rounded-lg sm:rounded-xl overflow-hidden"
            style={{
              width: 'clamp(84px, 23vw, 120px)',
              height: 'clamp(117px, 32vw, 168px)',
              top: i * 3, left: i * 2,
              zIndex: 3 - i,
              boxShadow: '0 4px 14px rgba(0,0,0,0.75)',
            }}
          >
            <Image src="/cards/back_of_card.jpg" alt="" fill className="object-cover" />
          </div>
        ))}
        <AnimatePresence mode="wait">
          <motion.div
            key={card ? `${card.rank}-${card.suit}` : 'back'}
            className="absolute rounded-lg sm:rounded-xl overflow-hidden"
            style={{
              width: 'clamp(84px, 23vw, 120px)',
              height: 'clamp(117px, 32vw, 168px)',
              top: 0, left: 0, zIndex: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
            }}
            initial={{ rotateY: card ? 90 : 0, scale: 0.9 }}
            animate={{ rotateY: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.45, type: 'spring' }}
          >
            {card ? (
              <Image src={getCardImg(card.rank, card.suit)} alt={`${card.rank} of ${card.suit}`} fill className="object-cover" />
            ) : (
              <Image src="/cards/back_of_card.jpg" alt="face down" fill className="object-cover" />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function GameBoard() {
  const {
    gameId, playerId, role, status, cardCounts, lastFlip,
    roundNumber, isWar, message, myReady,
    setMyReady,
  } = useGameStore();

  const [showWinAnim, setShowWinAnim] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [prevCounts, setPrevCounts] = useState<{ [key: string]: number }>({});
  const [myScoreChange, setMyScoreChange] = useState<number | null>(null);
  const [opponentScoreChange, setOpponentScoreChange] = useState<number | null>(null);

  if (!gameId || !playerId) return null;

  const myCount = cardCounts[playerId] ?? 0;
  const opponentId = Object.keys(cardCounts).find(id => id !== playerId) ?? '';
  const opponentCount = cardCounts[opponentId] ?? 0;

  const isPlayer1 = role === 'player1';
  const myCard = isPlayer1 ? lastFlip?.player1Card : lastFlip?.player2Card;
  const opponentCard = isPlayer1 ? lastFlip?.player2Card : lastFlip?.player1Card;
  const roundWinner = lastFlip?.winner;
  const iWon = roundWinner === playerId;
  const opponentWon = roundWinner === opponentId;

  const myLabel = playerId.length > 10 ? `${playerId.slice(0, 6)}...${playerId.slice(-4)}` : playerId;
  const oppLabel = opponentId.length > 10 ? `${opponentId.slice(0, 6)}...${opponentId.slice(-4)}` : (opponentId || 'Opponent');

  useEffect(() => {
    if (roundWinner && !isWar) {
      setShowWinAnim(true);
      const t = setTimeout(() => setShowWinAnim(false), 1200);
      return () => clearTimeout(t);
    }
  }, [roundWinner, roundNumber, isWar]);

  useEffect(() => {
    if (Object.keys(cardCounts).length > 0 && Object.keys(prevCounts).length > 0) {
      const myChange = myCount - (prevCounts[playerId] ?? myCount);
      const oppChange = opponentCount - (prevCounts[opponentId] ?? opponentCount);
      
      if (myChange !== 0) {
        setMyScoreChange(myChange);
        setTimeout(() => setMyScoreChange(null), 1500);
      }
      if (oppChange !== 0) {
        setOpponentScoreChange(oppChange);
        setTimeout(() => setOpponentScoreChange(null), 1500);
      }
    }
    setPrevCounts(cardCounts);
  }, [cardCounts, playerId, opponentId, myCount, opponentCount, prevCounts]);

  const handleFlip = () => {
    if (!gameId || myReady) return;
    setMyReady(true);
    emitFlipCard(gameId);
  };

  const handleWar = () => {
    if (!gameId || myReady) return;
    setMyReady(true);
    emitResolveWar(gameId);
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col select-none">

      {/* ── TOP BAR ── */}
      <div className="relative z-20 flex items-start justify-between px-3 sm:px-6 pt-3 sm:pt-5">
        <Link href="/lobby">
          <motion.button
            className="relative"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Image src="/back.png" alt="Back" width={100} height={33} className="object-contain sm:w-[150px] sm:h-[50px]" />
          </motion.button>
        </Link>

        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            onClick={() => setShowRules(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm"
            style={{
              background: 'linear-gradient(to bottom, #2b1c0b, #1a1208)',
              border: '1px solid #78501a',
              color: '#d4a74a',
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            aria-label="Game rules"
          >
            i
          </motion.button>
          <div className="hidden sm:block" style={{ width: 40 }} />
        </div>
      </div>
        <div className="flex flex-col items-center gap-1">
          <h1
            className="font-black tracking-[0.15em] leading-none"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
              color: '#f5c842',
              textShadow: '0 0 30px rgba(245,158,11,0.7), 0 3px 6px rgba(0,0,0,0.9)',
              fontFamily: 'Georgia, serif',
            }}
          >
            WAR
          </h1>
          <div
            className="flex items-center gap-2 px-5 py-1 rounded-sm"
            style={{
              background: 'linear-gradient(to bottom, #3d2a0a, #251800)',
              border: '1px solid #78501a',
            }}
          >
            <span style={{ color: '#78501a', fontSize: 10 }}>◆</span>
            <span className="font-bold tracking-widest text-sm" style={{ color: '#d4a74a' }}>
              ROUND {roundNumber} / {MAX_ROUNDS}
            </span>
            <span style={{ color: '#78501a', fontSize: 10 }}>◆</span>
          </div>
          {isWar && (
            <motion.div
              className="text-sm font-bold tracking-widest mt-1"
              style={{ color: '#ef4444', textShadow: '0 0 15px rgba(239,68,68,0.8)' }}
              animate={{ scale: [1, 1.15, 1], opacity: [0.8, 1, 0.8] }}
              transition={{ repeat: Infinity, duration: 0.7 }}
            >
              ⚔️ WAR ⚔️
            </motion.div>
          )}
        </div>

      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onClick={() => setShowRules(false)}
          />
          <motion.div
            className="relative w-full max-w-xl rounded-2xl p-6"
            style={{
              background: 'rgba(0,0,0,0.8)',
              border: '1px solid rgba(120,80,26,0.6)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2
                className="font-black tracking-widest"
                style={{ color: '#f5c842', textShadow: '0 0 20px rgba(245,158,11,0.5)', fontFamily: 'Georgia, serif' }}
              >
                GAME RULES
              </h2>
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="text-sm uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.6)' }}
              >
                Close
              </button>
            </div>
            <ol className="space-y-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
              <li><span style={{ color: '#d4a74a' }}>1.</span> Each player gets half the deck. All flips are simultaneous.</li>
              <li><span style={{ color: '#d4a74a' }}>2.</span> Higher card wins the round and takes both cards.</li>
              <li><span style={{ color: '#d4a74a' }}>3.</span> If cards tie, WAR begins: each player places one face-down card.</li>
              <li><span style={{ color: '#d4a74a' }}>4.</span> Then both flip a new card. Winner takes all cards in the war pile.</li>
              <li><span style={{ color: '#d4a74a' }}>5.</span> Game ends after 5 rounds or when a player runs out of cards.</li>
              <li><span style={{ color: '#d4a74a' }}>6.</span> If the game ends early, the player with more cards wins.</li>
            </ol>
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(120,80,26,0.3)' }}>
              <h3 className="font-bold tracking-wider mb-2" style={{ color: '#d4a74a', fontSize: '0.9rem' }}>SCORING</h3>
              <ul className="space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                <li><span style={{ color: '#22c55e' }}>+2</span> cards for winning a normal round (your card + opponent's card)</li>
                <li><span style={{ color: '#22c55e' }}>+4</span> or more cards for winning a WAR (all face-down + face-up cards)</li>
                <li><span style={{ color: '#ef4444' }}>-2</span> cards for losing a normal round</li>
                <li>Your score is the total number of cards you currently hold</li>
              </ul>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── PLAYER SCORES ── */}
      <div className="relative z-20 flex items-start justify-between px-4 sm:px-10 pt-2 sm:pt-3">
        <div className="text-center" style={{ minWidth: 80 }}>
          <p className="font-bold text-white text-sm sm:text-xl" style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)', fontFamily: 'Georgia, serif' }}>
            Player 1
          </p>
          <p className="text-[10px] sm:text-xs font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{oppLabel}</p>
          {/* <p className="font-bold tracking-widest text-xs sm:text-sm mt-1 sm:mt-2 uppercase" style={{ color: '#d4a74a' }}>
            Score: {opponentCount}
          </p> */}
        </div>
        <div className="flex-1" />
        <div className="text-center" style={{ minWidth: 80 }}>
          <p className="font-bold text-white text-sm sm:text-xl" style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)', fontFamily: 'Georgia, serif' }}>
            Player 2
          </p>
          <p className="text-[10px] sm:text-xs font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{myLabel}</p>
          {/* <p className="font-bold tracking-widest text-xs sm:text-sm mt-1 sm:mt-2 uppercase" style={{ color: '#d4a74a' }}>
            Score: {myCount}
          </p> */}
        </div>
      </div>

      {/* ── MAIN PLAY AREA ── */}
      <div className="relative z-20 flex-1 flex items-center justify-center px-2 sm:px-4" style={{ paddingBottom: 140 }}>
        <div className="w-full max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">

          {/* Left side — opponent won-cards deck */}
          <div className="flex-shrink-0 sm:block hidden">
            <SideDeck count={opponentCount} label="Opponent" isMe={false} scoreChange={opponentScoreChange} />
          </div>

          {/* Center — big flip cards */}
          <div className="flex-1 flex items-center justify-center gap-3 sm:gap-6">
            {/* Opponent center card */}
            <div className="relative">
              <BigCard card={opponentCard} label="Opponent's Card" won={opponentWon} />
              {showWinAnim && opponentCard && opponentWon && (
                <motion.div
                  className="absolute pointer-events-none rounded-xl overflow-hidden"
                  style={{ width: 120, height: 168, top: 20, left: 0, zIndex: 30 }}
                  initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  animate={{ x: -260, y: 60, scale: 0.35, opacity: 0 }}
                  transition={{ duration: 1, ease: 'easeIn' }}
                >
                  <Image src={getCardImg(opponentCard.rank, opponentCard.suit)} alt="" fill className="object-cover" />
                </motion.div>
              )}
            </div>

            {/* VS divider */}
            <div className="flex flex-col items-center gap-1 sm:gap-2 flex-shrink-0">
              <AnimatePresence>
                {roundWinner && (
                  <motion.p
                    key={`result-${roundNumber}`}
                    className="font-black text-xs sm:text-sm tracking-widest text-center"
                    style={{ color: iWon ? '#22c55e' : '#ef4444', textShadow: '0 0 16px currentColor' }}
                    initial={{ opacity: 0, scale: 0.5, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    {iWon ? '🏆 YOU WON' : '💀 YOU LOST'}
                  </motion.p>
                )}
              </AnimatePresence>
              <p className="font-black text-xl sm:text-3xl" style={{ color: 'rgba(255,255,255,0.55)' }}>VS</p>
            </div>

            {/* My center card */}
            <div className="relative">
              <BigCard card={myCard} label="Your Card" won={iWon} />
              {showWinAnim && myCard && iWon && (
                <motion.div
                  className="absolute pointer-events-none rounded-xl overflow-hidden"
                  style={{ width: 120, height: 168, top: 20, left: 0, zIndex: 30 }}
                  initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  animate={{ x: 260, y: 60, scale: 0.35, opacity: 0 }}
                  transition={{ duration: 1, ease: 'easeIn' }}
                >
                  <Image src={getCardImg(myCard.rank, myCard.suit)} alt="" fill className="object-cover" />
                </motion.div>
              )}
            </div>
          </div>

          {/* Right side — my won-cards deck */}
          <div className="flex-shrink-0 sm:block hidden">
            <SideDeck count={myCount} label="Your Deck" isMe scoreChange={myScoreChange} />
          </div>

          {/* Mobile deck indicators */}
          <div className="sm:hidden flex items-center justify-between w-full px-4 mt-4">
            <SideDeck count={opponentCount} label="Opp" isMe={false} scoreChange={opponentScoreChange} />
            <SideDeck count={myCount} label="You" isMe scoreChange={myScoreChange} />
          </div>

        </div>
      </div>

      {/* ── BOTTOM ACTION AREA ── */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col items-center gap-3 pb-8">
        <AnimatePresence>
          {message && (
            <motion.p
              key={message}
              className="text-sm px-4 text-center"
              style={{ color: 'rgba(255,255,255,0.55)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {message}
            </motion.p>
          )}
          {!message && status === 'active' && !myReady && (
            <motion.p
              key="hint"
              className="text-sm"
              style={{ color: 'rgba(255,255,255,0.4)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Tap the button to reveal your card!
            </motion.p>
          )}
          {myReady && (
            <motion.p
              key="waiting"
              className="text-sm font-bold tracking-widest uppercase"
              style={{ color: 'rgba(245,158,11,0.7)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Waiting for opponent...
            </motion.p>
          )}
        </AnimatePresence>

        {status === 'active' && (
          <motion.button
            onClick={handleFlip}
            disabled={myReady}
            className="relative flex items-center justify-center"
            style={{
              cursor: myReady ? 'not-allowed' : 'pointer',
              opacity: myReady ? 0.4 : 1,
            }}
            whileHover={myReady ? {} : { scale: 1.06 }}
            whileTap={myReady ? {} : { scale: 0.97 }}
          >
            <Image src="/flip.png" alt="Flip Card" width={280} height={70} className="object-contain" />
          </motion.button>
        )}

        {status === 'war' && (
          <motion.button
            onClick={handleWar}
            disabled={myReady}
            className="relative flex items-center justify-center"
            style={{
              cursor: myReady ? 'not-allowed' : 'pointer',
              opacity: myReady ? 0.4 : 1,
            }}
            animate={myReady ? {} : { scale: [1, 1.04, 1] }}
            transition={{ repeat: Infinity, duration: 0.9 }}
            whileTap={myReady ? {} : { scale: 0.97 }}
          >
            <Image src="/war.png" alt="Place War Card" width={280} height={70} className="object-contain" />
          </motion.button>
        )}
      </div>

    </div>
  );
}
