# 🃏 Card War — PvP Card Game

Real-time 1v1 War card game with WebSocket gameplay and Web3 wagering via smart contract escrow.

## Project Structure

```
card-war/
├── backend/          # Node.js + Express + Socket.io game server
├── frontend/         # Next.js + Tailwind + RainbowKit + Wagmi
└── contract/         # Hardhat + Solidity escrow contract
```

---

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env   # edit DATABASE_URL, REDIS_URL, CLIENT_URL
npm install
npm run dev
```

Requires: PostgreSQL + Redis running locally.

### 2. Contract

```bash
cd contract
cp .env.example .env   # fill in RPC URL + private key
npm install
npx hardhat node                          # local chain
npx hardhat run scripts/deploy.js --network localhost
```

The deploy script writes the ABI + address to `frontend/src/contracts/CardWarEscrow.json`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # set NEXT_PUBLIC_BACKEND_URL, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
npm install
npm run dev
```

---

## Architecture

| Layer | Tech |
|-------|------|
| Real-time | Socket.io |
| Game state | In-memory (Matchmaker) + PostgreSQL |
| Cache | Redis (optional, for scaling) |
| Frontend | Next.js 14 App Router |
| Web3 | Wagmi v2 + RainbowKit + viem |
| Contract | Solidity 0.8.24 + OpenZeppelin |

## Socket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_queue` | Client → Server | Join matchmaking |
| `queue_joined` | Server → Client | Waiting for opponent |
| `game_start` | Server → Client | Match found, game begins |
| `your_role` | Server → Client | player1 or player2 |
| `flip_card` | Client → Server | Player ready to flip |
| `card_flip` | Server → Client | Both cards revealed |
| `war_start` | Server → Client | Tie — war begins |
| `resolve_war` | Client → Server | Place face-down war card |
| `war_face_down` | Server → Client | Face-down cards placed |
| `game_end` | Server → Client | Game over + winner |
| `opponent_disconnected` | Server → Client | Opponent left |

## Smart Contract

`CardWarEscrow.sol` — escrow for wagers:
- `createGame(gameId)` — player1 locks ETH
- `joinGame(gameId)` — player2 matches wager
- `settleGame(gameId, winner)` — operator pays winner (3% house fee)
- `cancelGame(gameId)` — refund if no opponent joined

## Anti-Cheat

- Backend controls shuffle (Fisher-Yates + `crypto.randomInt`)
- SHA-256 deck hash published at game start
- Full deck revealed via API after game ends (`GET /api/games/:id/reveal`)

## WalletConnect

Get a free Project ID at https://cloud.walletconnect.com and set it in `frontend/.env.local`.
