import { useEffect, useRef } from 'react';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useGameStore } from '@/store/gameStore';

export function useSocket(walletAddress: string | undefined) {
  const store = useGameStore();
  const registered = useRef(false);

  useEffect(() => {
    if (!walletAddress || registered.current) return;

    const socket = connectSocket();
    registered.current = true;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
    });

    socket.on('queue_joined', () => {
      store.setStatus('queued');
      store.setMessage('Waiting for opponent...');
    });

    socket.on('game_start', (data: {
      gameId: string;
      player1Id: string;
      player2Id: string;
      cardCounts: { [key: string]: number };
    }) => {
      store.setGameId(data.gameId);
      store.setCardCounts(data.cardCounts);
      store.setStatus('active');
      store.setMessage('Game started! Both players flip to begin.');
    });

    socket.on('your_role', (data: { playerId: string; role: 'player1' | 'player2' }) => {
      store.setPlayerId(data.playerId);
      store.setRole(data.role);
    });

    socket.on('player_ready', (data: { playerId: string; waiting: boolean }) => {
      const myId = store.playerId;
      if (data.playerId !== myId) {
        store.setMessage('Opponent is ready! Waiting for you...');
      } else {
        store.setMessage('You are ready! Waiting for opponent...');
        store.setMyReady(true);
      }
    });

    socket.on('card_flip', (data: {
      roundNumber: number;
      player1Card: { rank: number; suit: string };
      player2Card: { rank: number; suit: string };
      isWar: boolean;
      winner: string | null;
      cardCounts: { [key: string]: number };
    }) => {
      store.setRoundNumber(data.roundNumber);
      store.setLastFlip({
        player1Card: data.player1Card,
        player2Card: data.player2Card,
        winner: data.winner,
      });
      store.setCardCounts(data.cardCounts);
      store.setIsWar(data.isWar);
      store.setMyReady(false);
      store.setBothReady(false);

      if (data.isWar) {
        store.setStatus('war');
        store.setMessage('⚔️ WAR! Equal cards — place a face-down card!');
      } else {
        store.setStatus('active');
        store.setMessage(data.winner ? `Round ${data.roundNumber} winner decided!` : null);
      }
    });

    socket.on('war_start', (data: { message: string }) => {
      store.setMessage(data.message);
    });

    socket.on('war_face_down', (data: { message: string; cardCounts: { [key: string]: number } }) => {
      store.setCardCounts(data.cardCounts);
      store.setMessage(data.message);
      store.setMyReady(false);
      store.setBothReady(false);
      store.setStatus('active');
      store.setIsWar(false);
    });

    socket.on('war_result', (data: { gameOver: boolean }) => {
      if (data.gameOver) {
        store.setMessage('War ended the game!');
      }
    });

    socket.on('game_end', (data: { winner: string; cardCounts: { [key: string]: number }; roundNumber: number }) => {
      store.setGameWinner(data.winner);
      store.setCardCounts(data.cardCounts);
      store.setRoundNumber(data.roundNumber);
      store.setStatus('game_over');
      store.setMessage(null);
    });

    socket.on('opponent_disconnected', (data: { message: string; gameId: string }) => {
      store.setStatus('game_over');
      store.setGameWinner(store.playerId);
      store.setMessage(data.message);
    });

    socket.on('error', (data: { message: string }) => {
      store.setMessage(`Error: ${data.message}`);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    return () => {
      socket.off('connect');
      socket.off('queue_joined');
      socket.off('game_start');
      socket.off('your_role');
      socket.off('player_ready');
      socket.off('card_flip');
      socket.off('war_start');
      socket.off('war_face_down');
      socket.off('war_result');
      socket.off('game_end');
      socket.off('opponent_disconnected');
      socket.off('error');
      socket.off('disconnect');
      registered.current = false;
    };
  }, [walletAddress]);
}

export function emitJoinQueue(walletAddress: string) {
  getSocket().emit('join_queue', { walletAddress });
}

export function emitFlipCard(gameId: string) {
  getSocket().emit('flip_card', { gameId });
}

export function emitResolveWar(gameId: string) {
  getSocket().emit('resolve_war', { gameId });
}
