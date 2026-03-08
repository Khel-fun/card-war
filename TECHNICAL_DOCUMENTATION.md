# Card War - Technical Documentation

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Backend Architecture](#backend-architecture)
3. [Frontend Architecture](#frontend-architecture)
4. [Smart Contracts](#smart-contracts)
5. [Zero-Knowledge Proof System](#zero-knowledge-proof-system)
6. [Database Schema](#database-schema)
7. [API Reference](#api-reference)
8. [Deployment Guide](#deployment-guide)
9. [Configuration](#configuration)

---

## Architecture Overview

Card War is a decentralized card game built with a hybrid architecture combining traditional web technologies with blockchain and zero-knowledge proofs for fairness verification.

### Tech Stack

**Frontend:**
- Next.js 14 (React framework)
- TypeScript
- Tailwind CSS
- Framer Motion (animations)
- RainbowKit + Wagmi (Web3 wallet integration)
- Socket.IO Client (real-time communication)
- Zustand (state management)

**Backend:**
- Node.js + Express
- Socket.IO (WebSocket server)
- PostgreSQL (database)
- TypeScript/JavaScript
- Noir (ZK circuit language)
- Aztec BB.js (proof generation)

**Smart Contracts:**
- Solidity
- Hardhat (development framework)
- Base Sepolia (testnet deployment)

**Infrastructure:**
- Kurier API (ZK proof aggregation service)
- zkVerify (on-chain proof verification)
- ngrok (local development tunneling)

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Game Board  │  │   Lobby      │  │  Wallet      │          │
│  │  Component   │  │  Matchmaking │  │  Connection  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                    Socket.IO + HTTP
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    BACKEND (Node.js)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Socket.IO   │  │  Game Engine │  │  Matchmaker  │          │
│  │  Handlers    │  │  (War Logic) │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  ZK Proof    │  │  Tracking    │  │  Reconcile   │          │
│  │  Generation  │  │  Service     │  │  Worker      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                  │                  │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          │                  │                  │
          │                  ▼                  │
          │         ┌──────────────┐            │
          │         │  PostgreSQL  │            │
          │         │   Database   │            │
          │         └──────────────┘            │
          │                                     │
          ▼                                     ▼
┌──────────────────┐                  ┌──────────────────┐
│   Kurier API     │                  │   Kurier API     │
│ (Proof Submit)   │                  │ (Job Status)     │
└──────────────────┘                  └──────────────────┘
          │                                     │
          └─────────────────┬───────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │    zkVerify      │
                  │  (Aggregation)   │
                  └──────────────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │  Smart Contract  │
                  │  (Base Sepolia)  │
                  └──────────────────┘
```

---

## Backend Architecture

### Core Components

#### 1. **Express Server** (`backend/src/index.js`)

Main entry point that initializes:
- HTTP server
- Socket.IO server with CORS configuration
- Database connection
- API routes
- ZK reconciliation worker

**Key Features:**
- CORS configured for ngrok and production
- Request logging middleware
- Health check endpoint
- Game reveal and fairness endpoints

**Configuration:**
```javascript
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['ngrok-skip-browser-warning', 'content-type'],
  },
});
```

#### 2. **Game Engine** (`backend/src/game/gameEngine.js`)

Implements the core War card game logic.

**Class: GameEngine**

**Properties:**
- `gameId`: Unique game identifier (UUID)
- `player1Id`, `player2Id`: Wallet addresses
- `hands`: Object mapping player IDs to their card arrays
- `pendingWarCards`: Cards in play during WAR scenarios
- `state`: Game state machine (`ACTIVE`, `WAR`, `RESOLVED`, `CLOSED`)
- `roundNumber`: Current round counter
- `deck`: Original shuffled deck (52 cards)

**Key Methods:**

```javascript
// Initialize game with shuffled deck
constructor(gameId, player1Id, player2Id, shuffledDeck)

// Deal cards to both players (26 each)
dealCards()

// Flip cards and determine winner
flipCards() // Returns: { roundNumber, player1Card, player2Card, isWar, winner, gameOver }

// Handle WAR scenario (place face-down card)
resolveWar() // Returns: { faceDownCards, gameOver?, gameWinner? }

// Get current card counts
getCardCounts() // Returns: { [player1Id]: count, [player2Id]: count }

// Serialize game state
serialize() // Returns: { gameId, state, roundNumber, cardCounts, isWar }
```

**Game Flow:**
1. Deck shuffled with ZK proof
2. Cards dealt (26 each) with ZK proof
3. Players flip cards simultaneously
4. Higher card wins both cards
5. Tie triggers WAR: face-down card + new flip
6. Game ends after 5 rounds or when player runs out of cards

**Scoring Logic:**
```javascript
// Normal win: +2 cards (both flipped cards)
if (p1Card.rank > p2Card.rank) {
  const winnings = [p1Card, p2Card, ...pendingWarCards];
  this.hands[this.player1Id].push(...winnings);
}

// WAR win: +4+ cards (all face-down + face-up cards)
// Pending war cards accumulate until someone wins
```

#### 3. **Matchmaker** (`backend/src/game/matchmaker.js`)

Manages player queuing and game creation.

**Class: Matchmaker**

**Properties:**
- `waitingPlayers`: Map of players waiting for match
- `activeGames`: Map of gameId → game objects
- `playerToGame`: Map of playerId → gameId

**Key Methods:**

```javascript
// Add player to queue, create game if 2 players waiting
async addPlayer(playerId, socketId, walletAddress, joinTimestamp)
// Returns: { type: 'waiting' | 'game_start' | 'already_in_game' }

// Remove player from queue/game
removePlayer(playerId)
// Returns: { gameId?, opponentSocketId? } | null

// Get active game by ID
getGame(gameId)
```

**Matchmaking Flow:**
1. Player joins queue with wallet address
2. If another player waiting → create game
3. Generate shuffled deck with ZK proof
4. Deal cards with ZK proof
5. Emit `game_start` to both players

#### 4. **Socket.IO Handlers** (`backend/src/socket/socketHandler.js`)

Real-time event handling for game interactions.

**Events:**

**Client → Server:**
- `join_queue`: Join matchmaking with wallet address
- `flip_card`: Player ready to flip card
- `resolve_war`: Player ready to resolve WAR
- `disconnect`: Player disconnects

**Server → Client:**
- `queue_joined`: Confirmation of joining queue
- `game_start`: Game created, send initial state
- `your_role`: Assign player1 or player2 role
- `player_ready`: One player ready, waiting for other
- `card_flip`: Both cards revealed
- `war_start`: Tie detected, WAR begins
- `war_face_down`: Face-down cards placed
- `war_result`: WAR resolved
- `game_over`: Game finished
- `opponent_disconnected`: Other player left
- `error`: Error occurred

**Example Flow:**
```javascript
socket.on('flip_card', async ({ gameId }) => {
  const playerId = socket.data.playerId;
  game.readyFlips.add(playerId);
  
  if (game.readyFlips.size < 2) {
    io.to(gameId).emit('player_ready', { playerId, waiting: true });
    return;
  }
  
  game.readyFlips.clear();
  const result = game.engine.flipCards();
  
  io.to(gameId).emit('card_flip', {
    roundNumber: result.roundNumber,
    player1Card: result.player1Card,
    player2Card: result.player2Card,
    isWar: result.isWar,
    winner: result.winner,
    cardCounts: game.engine.getCardCounts(),
  });
});
```

#### 5. **Zero-Knowledge Proof System** (`backend/src/proving_system/`)

Generates and verifies proofs for deck shuffling and dealing.

**Key Files:**
- `prove.ts`: Proof generation and verification
- `reconcileJobs.ts`: Background worker for polling proof status
- `onchain.ts`: On-chain verification logic
- `utils.ts`: Helper functions

**Circuits:**
- `shuffle`: Proves deck was shuffled correctly
- `deal`: Proves cards were dealt fairly

**Proof Generation Flow:**

```typescript
// 1. Generate proof
const { proofHex, publicInputs, proofUuid } = await generateProof(
  'shuffle',
  { deck: [1,2,3,...], shuffled: [52,3,17,...], seed: 12345 },
  { gameId, playerAddress }
);

// 2. Submit to Kurier (non-blocking mode)
const { jobId, status } = await submitProofForVerification(
  'shuffle',
  proofHex,
  publicInputs,
  { gameId, proofUuid }
);
// Returns immediately with jobId

// 3. Reconciliation worker polls status
// Every 30s, checks stale jobs and updates DB
// When aggregated, triggers on-chain verification
```

**Verification Modes:**

**Blocking Mode** (deprecated):
```bash
ZK_VERIFY_BLOCKING=true  # Polls until aggregated
ZK_VERIFY_MAX_POLLS=50   # Max polling attempts
```

**Non-Blocking Mode** (recommended):
```bash
ZK_VERIFY_BLOCKING=false  # Returns immediately
# Reconciliation worker handles polling
```

#### 6. **Reconciliation Worker** (`backend/src/proving_system/reconcileJobs.ts`)

Background service that polls Kurier API for proof job status updates.

**Configuration:**
```bash
ZK_RECONCILE_ENABLED=true              # Enable worker
ZK_RECONCILE_POLLING_ENABLED=true      # Enable API polling
ZK_RECONCILE_INTERVAL_MS=30000         # Poll every 30s
ZK_RECONCILE_BATCH_SIZE=25             # Process 25 jobs per run
ZK_RECONCILE_STALE_SECONDS=120         # Jobs older than 2min are stale
```

**Worker Flow:**
```typescript
async function reconcileOnce() {
  // 1. Fetch stale jobs from DB
  const jobs = await trackingService.getStaleJobsForReconciliation(25, 120);
  
  // 2. Poll Kurier for each job
  for (const job of jobs) {
    const statusResponse = await axios.get(
      `${KURIER_URL}/job-status/${KURIER_API}/${job.job_id}`
    );
    
    // 3. Update DB with latest status
    await trackingService.upsertVerificationJob({
      jobId: job.job_id,
      status: statusResponse.data.status,
      aggregationId: statusResponse.data.aggregationId,
      // ... other fields
    });
  }
  
  // 4. Trigger on-chain verification for aggregated jobs
  for (const sessionId of affectedSessions) {
    await verifySessionAggregationsOnChain(sessionId);
  }
}
```

**Job States:**
- `Submitted`: Just submitted to Kurier
- `Queued`: In Kurier's queue
- `IncludedInBlock`: Included in zkVerify block
- `AggregationPending`: Waiting for aggregation
- `Aggregated`: Ready for on-chain verification
- `Failed`: Verification failed

#### 7. **Tracking Service** (`backend/src/tracking/`)

Manages proof and verification job tracking in PostgreSQL.

**Key Methods:**

```typescript
// Track circuit compilation
async upsertCircuit(kind, vkHash, verificationKeyHex)

// Track proof generation
async upsertProof(sessionUuid, circuitUuid, proofHex, publicInputs)

// Track verification job
async upsertVerificationJob({ jobId, status, aggregationId, ... })

// Get stale jobs for reconciliation
async getStaleJobsForReconciliation(limit, staleSeconds)

// Record on-chain verification
async recordAggregationVerification({ proofUuid, aggregationId, ... })
```

---

## Frontend Architecture

### Core Components

#### 1. **App Structure** (`frontend/src/app/`)

Next.js 14 app router structure:

```
app/
├── page.tsx          # Landing page
├── lobby/page.tsx    # Matchmaking lobby
├── game/page.tsx     # Game board
└── layout.tsx        # Root layout with providers
```

#### 2. **Providers** (`frontend/src/components/Providers.tsx`)

Wraps app with necessary context providers:

```typescript
<WagmiProvider config={wagmiConfig}>
  <QueryClientProvider client={queryClient}>
    <RainbowKitProvider>
      {children}
    </RainbowKitProvider>
  </QueryClientProvider>
</WagmiProvider>
```

**Wagmi Configuration:**
- Chain: Base Sepolia (testnet)
- Connectors: Injected wallet, WalletConnect
- Transport: HTTP RPC

#### 3. **Game State Management** (`frontend/src/store/gameStore.ts`)

Zustand store for global game state.

**State:**
```typescript
interface GameState {
  gameId: string | null;
  playerId: string | null;
  role: 'player1' | 'player2' | null;
  status: 'idle' | 'waiting' | 'active' | 'war' | 'game_over';
  cardCounts: { [playerId: string]: number };
  lastFlip: {
    player1Card: Card | null;
    player2Card: Card | null;
    winner: string | null;
  } | null;
  roundNumber: number;
  isWar: boolean;
  message: string;
  myReady: boolean;
  gameWinner: string | null;
}
```

**Actions:**
```typescript
setGameId(gameId: string)
setPlayerId(playerId: string)
setRole(role: 'player1' | 'player2')
setStatus(status: GameStatus)
updateCardCounts(counts: { [playerId: string]: number })
setLastFlip(flip: FlipData)
setWar(isWar: boolean)
setMessage(message: string)
setMyReady(ready: boolean)
setGameWinner(winner: string)
reset() // Clear all state
```

#### 4. **Socket Integration** (`frontend/src/lib/socket.ts`)

Socket.IO client wrapper with ngrok bypass.

```typescript
export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000', {
      autoConnect: false,
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true',
      },
    });
  }
  return socket;
}
```

**Usage in Components:**
```typescript
const socket = useSocket();

useEffect(() => {
  socket.on('game_start', handleGameStart);
  socket.on('card_flip', handleCardFlip);
  
  return () => {
    socket.off('game_start', handleGameStart);
    socket.off('card_flip', handleCardFlip);
  };
}, []);
```

#### 5. **Game Board Component** (`frontend/src/components/GameBoard.tsx`)

Main game UI with card animations and score tracking.

**Sub-Components:**

**SideDeck:**
```typescript
function SideDeck({ count, label, isMe, scoreChange }) {
  // Displays card count with animated score changes
  // Shows +N/-N indicators that fade out
}
```

**BigCard:**
```typescript
function BigCard({ card, label, won, count, scoreChange }) {
  // Displays flipped card with animations
  // Shows card count and score changes
  // Handles card flip animations
}
```

**Features:**
- Responsive design (mobile + desktop)
- Framer Motion animations for card flips
- Score change indicators (+2, -4, etc.)
- WAR state visualization
- Win/loss messaging
- Game rules modal

**State Management:**
```typescript
const [showWinAnim, setShowWinAnim] = useState(false);
const [showRules, setShowRules] = useState(false);
const [prevCounts, setPrevCounts] = useState<{ [key: string]: number }>({});
const [myScoreChange, setMyScoreChange] = useState<number | null>(null);
const [opponentScoreChange, setOpponentScoreChange] = useState<number | null>(null);
```

**Score Change Detection:**
```typescript
useEffect(() => {
  if (Object.keys(cardCounts).length > 0 && Object.keys(prevCounts).length > 0) {
    const myChange = myCount - (prevCounts[playerId] ?? myCount);
    const oppChange = opponentCount - (prevCounts[opponentId] ?? opponentCount);
    
    if (myChange !== 0) {
      setMyScoreChange(myChange);
      setTimeout(() => setMyScoreChange(null), 1500);
    }
  }
  setPrevCounts(cardCounts);
}, [cardCounts]);
```

#### 6. **Lobby Component** (`frontend/src/app/lobby/page.tsx`)

Matchmaking interface.

**Features:**
- Wallet connection requirement
- Join queue button
- Waiting state animation
- Automatic redirect to game on match

**Flow:**
```typescript
const handleJoinQueue = () => {
  if (!address) return;
  
  const socket = getSocket();
  socket.connect();
  socket.emit('join_queue', { walletAddress: address });
  
  socket.on('game_start', ({ gameId, player1Id, player2Id }) => {
    router.push('/game');
  });
};
```

#### 7. **Fairness Verification** (`frontend/src/app/game/page.tsx`)

Displays ZK proof verification status after game ends.

```typescript
useEffect(() => {
  if (status !== 'game_over' || !gameId) return;
  
  const fetchFairness = async () => {
    const response = await fetch(
      `${backendUrl}/api/games/${gameId}/fairness`,
      { 
        headers: { 'ngrok-skip-browser-warning': 'true' }
      }
    );
    const data = await response.json();
    setFairness({
      shuffleChecked: Boolean(data?.fairness?.shuffle?.checked),
      dealChecked: Boolean(data?.fairness?.deal?.checked),
    });
  };
  
  fetchFairness();
}, [status, gameId]);
```

**Display:**
```typescript
<div>
  <p>✅ Shuffle fairness</p>
  <p>✅ Deal fairness</p>
  <p>Final aggregation/on-chain attestation may complete later.</p>
</div>
```

---

## Smart Contracts

### CardWarRegistry Contract

**Location:** `contract/contracts/CardWarRegistry.sol`

**Purpose:** Records on-chain verification of ZK proofs for game fairness.

**Key Functions:**

```solidity
function recordAggregationVerification(
    uint256 domainId,
    uint256 aggregationId,
    bytes32 leaf,
    bytes32[] calldata merklePath,
    uint256 leafCount,
    uint256 leafIndex
) external returns (bool)
```

**Parameters:**
- `domainId`: zkVerify domain identifier
- `aggregationId`: Unique aggregation batch ID
- `leaf`: Merkle tree leaf (proof hash)
- `merklePath`: Merkle proof path
- `leafCount`: Total leaves in tree
- `leafIndex`: Position of this leaf

**Events:**
```solidity
event AggregationVerified(
    uint256 indexed domainId,
    uint256 indexed aggregationId,
    bytes32 leaf,
    address verifier
);
```

**Deployment:**
```bash
cd contract
npx hardhat run scripts/deploy.js --network baseSepolia
```

**Configuration:**
```javascript
// hardhat.config.js
networks: {
  baseSepolia: {
    url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    accounts: [process.env.DEPLOYER_PRIVATE_KEY],
    chainId: 84532,
  },
}
```

---

## Zero-Knowledge Proof System

### Noir Circuits

**Location:** `backend/circuits/`

Two circuits for game fairness:

#### 1. Shuffle Circuit (`shuffle/`)

**Purpose:** Prove deck was shuffled correctly using Fisher-Yates algorithm.

**Inputs:**
```noir
fn main(
    deck: [Field; 52],      // Original ordered deck
    shuffled: [Field; 52],  // Shuffled deck
    seed: Field             // Random seed
) -> pub [Field; 52]        // Public: shuffled deck
```

**Verification:**
- All 52 cards present (no duplicates)
- Shuffle deterministic from seed
- Output matches shuffled deck

#### 2. Deal Circuit (`deal/`)

**Purpose:** Prove cards were dealt fairly to both players.

**Inputs:**
```noir
fn main(
    shuffled: [Field; 52],  // Shuffled deck
    player1: [Field; 26],   // Player 1's cards
    player2: [Field; 26]    // Player 2's cards
) -> pub [Field; 52]        // Public: concatenated hands
```

**Verification:**
- First 26 cards → Player 1
- Last 26 cards → Player 2
- All cards accounted for

### Proof Generation Pipeline

**1. Circuit Compilation:**
```typescript
const noir = new Noir(compiledCircuit);
const backend = new UltraHonkBackend(compiledCircuit.bytecode);
```

**2. Witness Generation:**
```typescript
const { witness } = await noir.execute(inputs);
```

**3. Proof Generation:**
```typescript
const proof = await backend.generateProof(witness);
const proofHex = uint8ArrayToHex(proof.proof);
```

**4. Verification Key:**
```typescript
const vk = await backend.getVerificationKey();
const vkHash = hashString(uint8ArrayToHex(vk));
```

**5. Submit to Kurier:**
```typescript
const response = await axios.post(
  `${KURIER_URL}/submit-proof/${KURIER_API}`,
  {
    proofType: 'ultrahonk',
    vkRegistered: Boolean(vkHash),
    chainId: 84532,
    proofData: {
      proof: proofHex,
      publicSignals: publicInputs,
      vk: vkHash || vkHex,
    },
    submissionMode: 'attestation',
  }
);
```

**6. Poll for Aggregation:**
```typescript
// Reconciliation worker polls every 30s
const statusResponse = await axios.get(
  `${KURIER_URL}/job-status/${KURIER_API}/${jobId}`
);

if (statusResponse.data.status === 'Aggregated') {
  // Trigger on-chain verification
  await verifyAndRecordAggregationOnChain({
    gameId,
    aggregationId,
    leaf,
    merklePath,
    leafCount,
    leafIndex,
  });
}
```

---

## Database Schema

### PostgreSQL Tables

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address CHAR(42) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### games
```sql
CREATE TABLE games (
  id UUID PRIMARY KEY,
  player1_id UUID REFERENCES users(id),
  player2_id UUID REFERENCES users(id),
  status VARCHAR(20),
  original_deck JSONB,
  winner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### rounds
```sql
CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(id),
  round_number INTEGER,
  player1_card JSONB,
  player2_card JSONB,
  winner_id UUID REFERENCES users(id),
  is_war BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### game_sessions
```sql
CREATE TABLE game_sessions (
  session_uuid UUID PRIMARY KEY,
  players CHAR(42)[],
  circuit_uuids UUID[],
  proof_uuids UUID[],
  job_ids UUID[],
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### circuits
```sql
CREATE TABLE circuits (
  circuit_uuid UUID PRIMARY KEY,
  kind VARCHAR(50),
  vk_hash VARCHAR(64),
  verification_key_hex TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### proofs
```sql
CREATE TABLE proofs (
  proof_uuid UUID PRIMARY KEY,
  session_uuid UUID REFERENCES game_sessions(session_uuid),
  circuit_uuid UUID REFERENCES circuits(circuit_uuid),
  proof_hex TEXT,
  public_inputs JSONB,
  bb_verification_status BOOLEAN,
  submit_response_json JSONB,
  onchain_verification_status BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### verification_jobs
```sql
CREATE TABLE verification_jobs (
  job_id UUID PRIMARY KEY,
  status VARCHAR(50),
  aggregation_id INTEGER,
  aggregation_response JSONB,
  leaf VARCHAR(66),
  leaf_index INTEGER,
  number_of_leaves INTEGER,
  merkle_proof TEXT[],
  statement TEXT,
  tx_hash VARCHAR(66),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### aggregation_verifications
```sql
CREATE TABLE aggregation_verifications (
  id UUID PRIMARY KEY,
  proof_uuid UUID REFERENCES proofs(proof_uuid),
  zkverify_contract_address CHAR(42),
  domain_id INTEGER,
  aggregation_id INTEGER,
  leaf VARCHAR(66),
  merkle_path TEXT[],
  leaf_count INTEGER,
  leaf_index INTEGER,
  verified BOOLEAN,
  tx_hash VARCHAR(66),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Reference

### HTTP Endpoints

#### GET /health
Health check endpoint.

**Response:**
```json
{ "status": "ok" }
```

#### GET /api/games/:gameId/reveal
Get original deck after game ends.

**Parameters:**
- `gameId`: UUID of the game

**Response:**
```json
{
  "deck": [
    { "rank": 14, "suit": "hearts" },
    { "rank": 2, "suit": "spades" },
    ...
  ]
}
```

**Errors:**
- `404`: Game not found
- `400`: Game not finished yet

#### GET /api/games/:gameId/fairness
Get ZK proof verification status.

**Parameters:**
- `gameId`: UUID of the game

**Response:**
```json
{
  "gameId": "3b005bbb-f3f6-4d48-ae40-e540f52e845c",
  "fairness": {
    "shuffle": {
      "checked": true,
      "passedCount": 2,
      "expectedCount": 2
    },
    "deal": {
      "checked": true,
      "passedCount": 2,
      "expectedCount": 2
    }
  },
  "lastUpdatedAt": "2026-03-08T06:35:12.345Z"
}
```

### Socket.IO Events

#### Client → Server

**join_queue**
```typescript
socket.emit('join_queue', { 
  walletAddress: '0x1234...' 
});
```

**flip_card**
```typescript
socket.emit('flip_card', { 
  gameId: '3b005bbb-...' 
});
```

**resolve_war**
```typescript
socket.emit('resolve_war', { 
  gameId: '3b005bbb-...' 
});
```

#### Server → Client

**queue_joined**
```typescript
socket.on('queue_joined', ({ message }) => {
  // "Waiting for opponent..."
});
```

**game_start**
```typescript
socket.on('game_start', ({ 
  gameId, 
  player1Id, 
  player2Id, 
  cardCounts 
}) => {
  // Game created, initialize UI
});
```

**your_role**
```typescript
socket.on('your_role', ({ playerId, role }) => {
  // role: 'player1' | 'player2'
});
```

**card_flip**
```typescript
socket.on('card_flip', ({ 
  roundNumber,
  player1Card,
  player2Card,
  isWar,
  winner,
  cardCounts
}) => {
  // Display flipped cards
});
```

**war_start**
```typescript
socket.on('war_start', ({ message }) => {
  // "WAR! Both players flip a face-down card."
});
```

**game_over**
```typescript
socket.on('game_over', ({ 
  winner, 
  finalCounts 
}) => {
  // Show game results
});
```

---

## Deployment Guide

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Hardhat
- ngrok (for local development)

### Backend Deployment

**1. Install Dependencies:**
```bash
cd backend
npm install
```

**2. Configure Environment:**
```bash
cp .env.example .env
# Edit .env with your values
```

**Required Variables:**
```bash
PORT=4000
DATABASE_URL=postgresql://user:pass@localhost:5432/cardwar
KURIER_URL=https://api-testnet.kurier.xyz/api/v1
KURIER_API=your_kurier_api_key
RPC_URL=https://sepolia.base.org
OPERATOR_PRIVATE_KEY=0x...
CARDWAR_REGISTRY_ADDRESS=0x...
ZKVERIFY_DOMAIN_ID=2
```

**3. Initialize Database:**
```bash
npm run migrate  # Run migrations
```

**4. Start Server:**
```bash
# Development
npm run dev

# Production
npm start
```

**5. Expose with ngrok:**
```bash
ngrok http 4000
# Copy ngrok URL to frontend .env
```

### Frontend Deployment

**1. Install Dependencies:**
```bash
cd frontend
npm install
```

**2. Configure Environment:**
```bash
cp .env.example .env.local
```

**Required Variables:**
```bash
NEXT_PUBLIC_BACKEND_URL=https://your-ngrok-url.ngrok-free.dev
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

**3. Build:**
```bash
npm run build
```

**4. Deploy to Vercel:**
```bash
vercel deploy
# Or connect GitHub repo to Vercel
```

### Contract Deployment

**1. Install Dependencies:**
```bash
cd contract
npm install
```

**2. Configure Environment:**
```bash
cp .env.example .env
```

**Required Variables:**
```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=your_api_key
```

**3. Deploy:**
```bash
npx hardhat run scripts/deploy.js --network baseSepolia
```

**4. Update Backend:**
```bash
# Copy deployed contract address to backend .env
CARDWAR_REGISTRY_ADDRESS=0x...
```

---

## Configuration

### Backend Environment Variables

```bash
# Server
PORT=4000
CLIENT_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/cardwar

# Kurier API
KURIER_URL=https://api-testnet.kurier.xyz/api/v1
KURIER_API=<YOUR_KURIER_API_KEY>

# Blockchain
RPC_URL=https://sepolia.base.org
OPERATOR_PRIVATE_KEY=0x<PRIVATE_KEY>
CARDWAR_REGISTRY_ADDRESS=0x<CONTRACT_ADDRESS>
ZKVERIFY_DOMAIN_ID=2

# Tracking
TRACKING_ENABLED=true

# Reconciliation Worker
ZK_RECONCILE_ENABLED=true
ZK_RECONCILE_POLLING_ENABLED=true
ZK_RECONCILE_INTERVAL_MS=30000
ZK_RECONCILE_BATCH_SIZE=25
ZK_RECONCILE_STALE_SECONDS=120

# Proof Verification
ZK_VERIFY_BLOCKING=false  # Non-blocking mode (recommended)
ZK_VERIFY_MAX_POLLS=50    # Max polls if blocking
```

### Frontend Environment Variables

```bash
# Backend URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_PROJECT_ID
```

### Performance Tuning

**Database Connection Pool:**
```javascript
const pool = new Pool({
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // Close idle connections
  connectionTimeoutMillis: 2000,
});
```

**Reconciliation Worker:**
```bash
# Reduce load on Kurier API
ZK_RECONCILE_INTERVAL_MS=60000  # Poll every 60s instead of 30s
ZK_RECONCILE_BATCH_SIZE=10      # Process fewer jobs per run
ZK_RECONCILE_STALE_SECONDS=300  # Only check jobs older than 5min
```

**Socket.IO:**
```javascript
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});
```

---

## Troubleshooting

### Common Issues

**1. ngrok ERR_NGROK_6024**
- **Cause:** Missing `ngrok-skip-browser-warning` header
- **Fix:** Add header to all fetch/axios requests
```typescript
headers: { 'ngrok-skip-browser-warning': 'true' }
```

**2. Socket.IO Connection Failed**
- **Cause:** CORS misconfiguration
- **Fix:** Ensure backend CORS allows frontend origin
```javascript
cors: { origin: '*', allowedHeaders: ['ngrok-skip-browser-warning'] }
```

**3. Proof Verification Timeout**
- **Cause:** Blocking mode with too many concurrent games
- **Fix:** Use non-blocking mode
```bash
ZK_VERIFY_BLOCKING=false
```

**4. Database Connection Pool Exhausted**
- **Cause:** Too many concurrent queries
- **Fix:** Increase pool size or add connection retry logic

**5. Ace Cards Not Displaying**
- **Cause:** Backend uses rank 14, frontend expects rank 1
- **Fix:** Map rank 14 to 'a' in `getCardImg` function
```typescript
const rankMap = { '14': 'a', '1': 'a', ... };
```

---

## Security Considerations

**1. Private Keys:**
- Never commit private keys to git
- Use environment variables
- Rotate keys regularly

**2. Database:**
- Use parameterized queries (prevents SQL injection)
- Enable SSL for production
- Regular backups

**3. Smart Contracts:**
- Audit before mainnet deployment
- Use OpenZeppelin libraries
- Test thoroughly on testnet

**4. ZK Proofs:**
- Verify all proofs on-chain
- Don't trust client-side verification
- Monitor proof submission rate

**5. API Rate Limiting:**
- Implement rate limiting on endpoints
- Use API keys for Kurier
- Monitor for abuse

---

## Future Improvements

**1. Scalability:**
- Implement Redis for session management
- Add load balancer for multiple backend instances
- Use message queue for proof processing

**2. Features:**
- Tournament mode
- Leaderboard
- Replay system
- Spectator mode

**3. Optimization:**
- Batch proof submissions
- Optimize circuit size
- Cache verification keys

**4. Monitoring:**
- Add Prometheus metrics
- Implement error tracking (Sentry)
- Real-time dashboard

---

## License

MIT License - See LICENSE file for details.

## Support

For issues and questions:
- GitHub Issues: [repository-url]
- Discord: [discord-invite]
- Email: [support-email]
