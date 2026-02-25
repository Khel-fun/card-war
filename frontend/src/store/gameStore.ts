import { create } from 'zustand';

export type GameStatus = 'idle' | 'queued' | 'active' | 'war' | 'game_over';

export interface Card {
  rank: number;
  suit: string;
}

export interface GameState {
  gameId: string | null;
  playerId: string | null;
  role: 'player1' | 'player2' | null;
  opponentId: string | null;
  status: GameStatus;
  deckHash: string | null;
  cardCounts: { [playerId: string]: number };
  lastFlip: { player1Card: Card | null; player2Card: Card | null; winner: string | null } | null;
  roundNumber: number;
  isWar: boolean;
  gameWinner: string | null;
  message: string | null;
  bothReady: boolean;
  myReady: boolean;

  setGameId: (id: string) => void;
  setPlayerId: (id: string) => void;
  setRole: (role: 'player1' | 'player2') => void;
  setOpponentId: (id: string) => void;
  setStatus: (status: GameStatus) => void;
  setDeckHash: (hash: string) => void;
  setCardCounts: (counts: { [key: string]: number }) => void;
  setLastFlip: (flip: GameState['lastFlip']) => void;
  setRoundNumber: (n: number) => void;
  setIsWar: (v: boolean) => void;
  setGameWinner: (id: string | null) => void;
  setMessage: (msg: string | null) => void;
  setMyReady: (v: boolean) => void;
  setBothReady: (v: boolean) => void;
  reset: () => void;
}

const initialState = {
  gameId: null,
  playerId: null,
  role: null,
  opponentId: null,
  status: 'idle' as GameStatus,
  deckHash: null,
  cardCounts: {},
  lastFlip: null,
  roundNumber: 0,
  isWar: false,
  gameWinner: null,
  message: null,
  bothReady: false,
  myReady: false,
};

export const useGameStore = create<GameState>((set) => ({
  ...initialState,
  setGameId: (id) => set({ gameId: id }),
  setPlayerId: (id) => set({ playerId: id }),
  setRole: (role) => set({ role }),
  setOpponentId: (id) => set({ opponentId: id }),
  setStatus: (status) => set({ status }),
  setDeckHash: (hash) => set({ deckHash: hash }),
  setCardCounts: (counts) => set({ cardCounts: counts }),
  setLastFlip: (flip) => set({ lastFlip: flip }),
  setRoundNumber: (n) => set({ roundNumber: n }),
  setIsWar: (v) => set({ isWar: v }),
  setGameWinner: (id) => set({ gameWinner: id }),
  setMessage: (msg) => set({ message: msg }),
  setMyReady: (v) => set({ myReady: v }),
  setBothReady: (v) => set({ bothReady: v }),
  reset: () => set(initialState),
}));
