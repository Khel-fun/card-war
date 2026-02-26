# 🃏 Card War — PvP Card Game

Real-time 1v1 War card game with WebSocket gameplay.

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

### 2. Contract (Optional - for on-chain state tracking)

```bash
cd contract
cp .env.example .env   # fill in RPC URL + private key
npm install
npx hardhat node                          # local chain
npx hardhat run scripts/deploy.js --network localhost
```

The deploy script writes the ABI + address to `frontend/src/contracts/CardWarRegistry.json`.

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
| On-chain registry | Solidity (CardWarRegistry) - optional |
| Cache | Redis (optional, for scaling) |
| Frontend | Next.js 14 App Router |
| Wallet | Wagmi v2 + RainbowKit + viem |

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

## Smart Contract (Optional)

`CardWarRegistry.sol` — on-chain game state registry for transparency:
- **No wagers or payments** — purely for provable fairness
- `createGame(gameId)` — player1 registers game on-chain
- `joinGame(gameId)` — player2 joins the registered game
- `completeGame(gameId, winner)` — operator records winner on-chain
- `cancelGame(gameId)` — cancel if no opponent joined

The contract provides an immutable, transparent record of:
- Game participants (player1 & player2 addresses)
- Game outcome (winner address)
- Timestamps (created, completed)

This allows anyone to verify game results by checking the on-chain record.

## Anti-Cheat

- Backend controls shuffle (Fisher-Yates + `crypto.randomInt`)
- Full deck revealed via API after game ends (`GET /api/games/:id/reveal`)

## WalletConnect

Get a free Project ID at https://cloud.walletconnect.com and set it in `frontend/.env.local`.
