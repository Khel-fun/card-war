'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { emitFlipCard, emitResolveWar } from '@/hooks/useSocket';
import PlayingCard from './PlayingCard';
import CardDeck from './CardDeck';

export default function GameBoard() {
  const {
    gameId, playerId, role, status, cardCounts, lastFlip,
    roundNumber, isWar, message, myReady,
    setMyReady,
  } = useGameStore();

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
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between w-full px-4">
        <div className="text-center">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Opponent</p>
          <p className="text-xs text-gray-600 font-mono truncate max-w-[120px]">{opponentId.slice(0, 8)}...</p>
        </div>
        <div className="text-center">
          <p className="text-war-gold font-bold text-lg">Round {roundNumber}</p>
          {isWar && (
            <motion.p
              className="text-war-red font-bold text-sm"
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 0.8 }}
            >
              ⚔️ WAR ⚔️
            </motion.p>
          )}
        </div>
        <div className="text-center">
          <p className="text-xs text-war-accent uppercase tracking-widest">You</p>
          <p className="text-xs text-gray-600 font-mono truncate max-w-[120px]">{playerId.slice(0, 8)}...</p>
        </div>
      </div>

      <div className="flex items-center justify-around w-full">
        <CardDeck count={opponentCount} label="Opponent" isMe={false} />

        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-6 items-center">
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-gray-500">Opponent</p>
              <AnimatePresence mode="wait">
                {opponentCard ? (
                  <PlayingCard key={`opp-${roundNumber}`} rank={opponentCard.rank} suit={opponentCard.suit} animate size="lg" />
                ) : (
                  <PlayingCard faceDown size="lg" />
                )}
              </AnimatePresence>
              {opponentWon && (
                <motion.span
                  className="text-war-green text-xs font-bold"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  ✓ Won
                </motion.span>
              )}
            </div>

            <div className="text-2xl text-gray-600">VS</div>

            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-war-accent">You</p>
              <AnimatePresence mode="wait">
                {myCard ? (
                  <PlayingCard key={`me-${roundNumber}`} rank={myCard.rank} suit={myCard.suit} animate size="lg" />
                ) : (
                  <PlayingCard faceDown size="lg" />
                )}
              </AnimatePresence>
              {iWon && (
                <motion.span
                  className="text-war-green text-xs font-bold"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  ✓ Won
                </motion.span>
              )}
            </div>
          </div>

          {message && (
            <motion.div
              className="text-center text-sm text-gray-300 bg-war-card border border-war-border rounded-lg px-4 py-2 max-w-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {message}
            </motion.div>
          )}

          {status === 'active' && (
            <motion.button
              onClick={handleFlip}
              disabled={myReady}
              className={`px-8 py-3 rounded-xl font-bold text-white text-lg transition-all ${
                myReady
                  ? 'bg-gray-700 cursor-not-allowed opacity-60'
                  : 'bg-war-accent hover:bg-purple-600 active:scale-95 shadow-lg shadow-purple-900/50'
              }`}
              whileTap={{ scale: 0.95 }}
            >
              {myReady ? 'Waiting...' : '🃏 Flip Card'}
            </motion.button>
          )}

          {status === 'war' && (
            <motion.button
              onClick={handleWar}
              disabled={myReady}
              className={`px-8 py-3 rounded-xl font-bold text-white text-lg transition-all ${
                myReady
                  ? 'bg-gray-700 cursor-not-allowed opacity-60'
                  : 'bg-war-red hover:bg-red-600 active:scale-95 shadow-lg shadow-red-900/50'
              }`}
              animate={myReady ? {} : { scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              whileTap={{ scale: 0.95 }}
            >
              {myReady ? 'Waiting...' : '⚔️ Place War Card'}
            </motion.button>
          )}
        </div>

        <CardDeck count={myCount} label="You" isMe />
      </div>

      <div className="flex gap-6 text-center text-sm text-gray-500">
        <div>
          <span className="text-war-gold font-mono text-xs">Deck Hash</span>
          <p className="font-mono text-xs text-gray-600 truncate max-w-[200px]">
            {useGameStore.getState().deckHash?.slice(0, 20)}...
          </p>
        </div>
      </div>
    </div>
  );
}
