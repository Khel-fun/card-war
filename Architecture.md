# Card War — Architecture Overview

## System Overview

Card War is a real-time, provably fair, 1v1 PvP card game (the classic "War" card game) built on a three-tier architecture:

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | Next.js (React), Wagmi, RainbowKit, Socket.IO client, Zustand | Wallet authentication, real-time game UI, on-chain interactions |
| **Backend** | Node.js, Express, Socket.IO, PostgreSQL, Noir/UltraHonk | Game orchestration, matchmaking, ZK proof generation & verification, state persistence |
| **Smart Contracts** | Solidity (Hardhat), Base Mainnet | On-chain game registry, proof aggregation verification via zkVerify |

All card operations (shuffle and deal) are executed deterministically through **Noir zero-knowledge circuits**. Proofs are generated server-side, submitted to the **zkVerify Kurier relayer** for aggregation, and ultimately anchored on-chain through the **CardWarRegistry** smart contract. This makes every game session **publicly auditable and provably fair**, without revealing private game state during play.

```
┌────────────────────┐       WebSocket / HTTP        ┌──────────────────────────────────────┐
│                    │◄──────────────────────────────►│              Backend                 │
│     Frontend       │                                │                                      │
│  (Next.js + Wagmi) │      Contract Calls            │  ┌──────────┐  ┌──────────────────┐  │
│                    │───────────┐                     │  │   Game    │  │  Proving System  │  │
└────────────────────┘           │                     │  │  Engine   │  │  (Noir/BB.js)    │  │
                                 │                     │  └──────────┘  └────────┬─────────┘  │
                                 ▼                     │                         │             │
                      ┌────────────────────┐           │                         ▼             │
                      │   CardWarRegistry  │           │               ┌─────────────────┐    │
                      │   (Base Mainnet)   │◄──────────┤               │  zkVerify Kurier │    │
                      └────────────────────┘           │               │  (Relayer API)   │    │
                                 ▲                     │               └─────────────────┘    │
                                 │                     │                         │             │
                                 │                     │  ┌──────────┐  ┌───────▼──────────┐  │
                                 │                     │  │PostgreSQL│  │  Reconcile Worker │  │
                                 │                     │  │          │◄─┤  (Background Job) │  │
                                 └─────────────────────┤  └──────────┘  └──────────────────┘  │
                                                       └──────────────────────────────────────┘
```

---

## Component Breakdown

### Frontend

**Technology**: Next.js 14 (App Router), TypeScript, Wagmi v2, RainbowKit, Socket.IO client, Zustand, Framer Motion, Tailwind CSS

**Target chain**: Base Mainnet

#### Pages

| Page | Route | Responsibility |
|---|---|---|
| Home | `/` | Wallet connection via RainbowKit; gateway to lobby |
| Lobby | `/lobby` | Matchmaking queue; socket connection setup; "Find Match" button emits `join_queue` |
| Game | `/game` | Active gameplay board; game-over screen with fairness report fetched from `/api/games/:gameId/fairness` |

#### Key Modules

| Module | File | Purpose |
|---|---|---|
| **Socket Client** | `lib/socket.ts` | Singleton Socket.IO client connecting to the backend (configurable via `NEXT_PUBLIC_BACKEND_URL`) |
| **useSocket Hook** | `hooks/useSocket.ts` | Registers all Socket.IO event listeners (`game_start`, `card_flip`, `war_start`, `game_end`, etc.) and drives Zustand state transitions |
| **useContract Hook** | `hooks/useContract.ts` | Wagmi hooks wrapping `createGame`, `joinGame`, and `completeGame` calls to the CardWarRegistry contract |
| **Game Store** | `store/gameStore.ts` | Zustand store holding all client-side game state: `gameId`, `playerId`, `role`, `status`, `cardCounts`, `lastFlip`, `roundNumber`, `isWar`, `gameWinner` |
| **GameBoard** | `components/GameBoard.tsx` | Primary gameplay UI — card flip animations, score tracking, war state rendering, round display |
| **Wagmi Config** | `lib/wagmiConfig.ts` | Chain configuration (Base Mainnet), RainbowKit wallets (Injected + WalletConnect) |
| **Contract ABI** | `contracts/CardWarRegistry.json` | Auto-generated ABI and deployed address (written by the deploy script) |

#### Socket Events Consumed

| Event | Data | Effect |
|---|---|---|
| `queue_joined` | — | Set status to `queued` |
| `game_start` | `gameId`, `player1Id`, `player2Id`, `cardCounts` | Transition to `active` |
| `your_role` | `playerId`, `role` | Assign local identity |
| `player_ready` | `playerId`, `waiting` | Show waiting indicator |
| `card_flip` | Round result with cards, winner, counts | Animate card reveal, update scores |
| `war_start` | Message | Show WAR UI |
| `war_face_down` | Message, updated counts | Transition back to `active` after face-down placement |
| `game_end` | `winner`, `cardCounts`, `roundNumber` | Show game-over screen, fetch fairness |
| `opponent_disconnected` | Message | Auto-win for remaining player |

---

### Backend

**Technology**: Node.js, Express, Socket.IO, PostgreSQL (`pg`), TypeScript (ESM) for the proving system, CommonJS for core game logic

The backend is the **authority for all game state**. Clients never hold cards; they only receive card data at flip-time via socket events.

#### Entry Point — `index.js`

- Creates Express + HTTP server with CORS configured
- Initializes Socket.IO
- Initializes PostgreSQL schema via `initDB()`
- Starts the **reconcile worker** (`reconcileJobs.startJobReconcileWorker()`)
- Exposes REST endpoints:
  - `GET /health` — Health check
  - `GET /api/games/:gameId/reveal` — Returns the original deck for a `CLOSED` game (post-game transparency)
  - `GET /api/games/:gameId/fairness` — Returns ZK proof verification status for shuffle and deal (per-player), evaluated by checking `bb_verification_status` and the Kurier `optimisticVerify` response

#### Game Engine — `game/gameEngine.js`

The `GameEngine` class is the core state machine for a single game session.

**States**: `WAITING` → `ACTIVE` ↔ `WAR` → `RESOLVED` → `ACTIVE` (next round) → `CLOSED`

**Key methods**:

| Method | Description |
|---|---|
| `setup(seed_A, seed_B)` | Executes Noir `shuffle_deck` and `deal_cards` circuits (in-process witness execution) using player join timestamps as deterministic seeds. Converts Field-encoded card indices to `{rank, suit}` objects. Fires non-blocking background proof generation. |
| `flipCards()` | Both players' top cards are compared by rank. Higher card wins the round; equal cards trigger WAR. Game ends after `MAX_ROUNDS` (5) or when a player runs out of cards. |
| `resolveWar()` | Each player places one face-down card from their hand onto the war pile. State transitions back to `ACTIVE` for the next decisive flip. |
| `_generateAndVerifyProofsBackground(...)` | Fire-and-forget: generates 4 ZK proofs (shuffle × 2 players + deal × 2 players) in parallel, then submits all 4 for verification via Kurier. Errors are logged but never block gameplay. |

#### Matchmaker — `game/matchmaker.js`

Queue-based 1v1 matchmaking:

1. Player calls `addPlayer(playerId, socketId, walletAddress, joinTimestamp)`
2. If the queue is empty, the player waits
3. If another player is already waiting, a new `GameEngine` is instantiated, `setup()` is called with both players' join timestamps, and both are notified of `game_start`

The matchmaker maintains three in-memory maps:
- `waitingPlayers[]` — FIFO queue
- `games: Map<gameId, Game>` — active game sessions
- `playerToGame: Map<playerId, gameId>` — reverse lookup

#### Socket Handler — `socket/socketHandler.js`

Manages the full real-time lifecycle:

| Socket Event | Handler Logic |
|---|---|
| `join_queue` | Upserts user in DB, delegates to matchmaker, rooms both players into the game channel, inserts `games` and `game_sessions` rows |
| `flip_card` | Waits for both players to signal readiness (`readyFlips` set), then calls `engine.flipCards()`. Broadcasts `card_flip` and optionally `war_start`. Persists round data. |
| `resolve_war` | Waits for both players, calls `engine.resolveWar()`. Broadcasts `war_face_down` or triggers `handleGameOver`. |
| `disconnect` | Removes from matchmaker, notifies opponent of auto-win, closes game in DB |

**Game-over flow**: On game completion, `handleGameOver` updates both `games` and `game_sessions` tables with the winner, then starts a **session verification retry loop** (`startSessionVerificationRetry`) that periodically calls `verifySessionAggregationsOnChain` to push aggregated proofs on-chain.

#### Deck Utilities — `game/deck.js`

Standard 52-card deck utilities (`createDeck`, `shuffle`, `hashDeck`, `dealCards`, `rankLabel`). These exist as fallback/reference utilities; the active game path uses Noir circuit-based shuffle/deal.

---

### Smart Contracts

**Contract**: `CardWarRegistry.sol`
**Network**: Base Mainnet (chain ID 8453)
**Framework**: Hardhat + OpenZeppelin

#### Contract Design

The CardWarRegistry is an **on-chain game ledger and ZK verification anchor**. It does not handle wagers — purely transparency and provable fairness.

**State per game** (keyed by `bytes32 gameKey = keccak256(gameId)`):
- `player1`, `player2` addresses
- `status` enum: `None` → `WaitingForPlayer2` → `Active` → `Completed` / `Cancelled`
- `winner` address
- `gameId` (off-chain UUID), `createdAt`, `completedAt`

**Key functions**:

| Function | Access | Purpose |
|---|---|---|
| `createGame(gameId)` | Any player | Registers a new game on-chain |
| `joinGame(gameId)` | Any player (≠ player1) | Player2 joins; status → `Active` |
| `completeGame(gameId, winner)` | Operator only | Records winner; status → `Completed` |
| `cancelGame(gameId)` | Player1 / Operator | Cancels a game that hasn't started |
| `verifyProofAggregation(...)` | View | Delegates to the configured **zkVerify** contract to validate a Merkle inclusion proof for a proof aggregation |
| `recordProofAggregationVerification(...)` | Operator only | Calls `verifyProofAggregation`, requires it to return true, then emits `ProofAggregationVerified` event |

**Access control**: Ownable + operator pattern. The deployer is automatically an operator. Additional operators can be added via `setOperator`.

**zkVerify integration**: The contract holds a configurable `zkVerify` address (the zkVerify settlement contract on the target chain) and an immutable `domainId`. Proof aggregation verification is delegated to the `IVerifyProofAggregation` interface.

#### Deployment

`scripts/deploy.js`:
1. Deploys `CardWarRegistry` with the configured `ZKVERIFY_DOMAIN_ID`
2. If `ZKVERIFY_CONTRACT_ADDRESS` is set, calls `updateZkVerify` to configure it
3. Writes deployment info to `deployments/<network>.json`
4. Writes ABI + address to `frontend/src/contracts/CardWarRegistry.json` (auto-syncs frontend)

---

### Zero-Knowledge Proof System

**Location**: `backend/src/proving_system/`
**ZK Framework**: Noir circuits compiled to UltraHonk proofs (via `@noir-lang/noir_js` and `@aztec/bb.js`)

#### Circuits

Located in `proving_system/circuits/`, the project has two active circuit types:

| Circuit | Kind | Inputs | Purpose |
|---|---|---|---|
| `shuffle` | `CircuitKind.SHUFFLE` | `seed`, `shuffled_deck` | Proves a deck was deterministically shuffled from a given seed |
| `deal` | `CircuitKind.DEAL` | `seed`, `commitment`, `cards` | Proves cards were deterministically dealt from a shuffled deck with a binding commitment |

The circuits expose Noir-native functions (`shuffle_deck`, `deal_cards`, `card_to_string`) through `circuits/index.ts`, which are called **in-process** for fast witness execution during `GameEngine.setup()`.

#### Proof Lifecycle

```
  Player Seeds                          Noir Witness Execution (fast, in-process)
  ───────────────►  shuffle_deck(seed) ──────► shuffled_deck
                    deal_cards(shuffled_deck, seed) ──────► (dealt_cards, commitment)
                                          │
                                          ▼
                               GameEngine populates hands
                               Game begins immediately
                                          │
                               ┌──────────┴──────────┐
                               │  Background (async)  │
                               │  Fire-and-forget      │
                               └──────────┬──────────┘
                                          │
                    ┌─────────────────────►│◄─────────────────────┐
                    │                      │                      │
              generateProof()        generateProof()        generateProof()  × 4
              (SHUFFLE, p1)          (SHUFFLE, p2)          (DEAL, p1 & p2)
                    │                      │                      │
                    ▼                      ▼                      ▼
              BB.js local verify     BB.js local verify     BB.js local verify
                    │                      │                      │
                    └──────────┬───────────┘──────────────────────┘
                               │
                               ▼
                    verifyProof() / submitProofForVerification()
                    → Submit to Kurier relayer API
                    → Kurier returns jobId + optimisticVerify
                               │
                               ▼
                    Tracking service persists proof, job, submission
```

#### Key Functions in `prove.ts`

| Function | Description |
|---|---|
| `setupProver(circuit_name)` | Loads compiled circuit JSON, instantiates `Noir` and `UltraHonkBackend` |
| `registerVk(circuit_name)` | Generates verification key, registers it with Kurier, persists circuit setup via tracking service |
| `ensureCircuitSetup(circuit_name)` | Cached VK registration — checks DB for active circuit first, falls back to `registerVk` |
| `generateProof(circuit_name, inputs, context)` | Full proof generation: ABI validation → witness execution → UltraHonk proof → local BB.js verification → persists proof record |
| `verifyProof(circuit_name, proofHex, publicInputs, context)` | Submits proof to Kurier; optionally polls for aggregation (controlled by `ZK_VERIFY_BLOCKING`); on aggregation, triggers on-chain verification |
| `submitProofForVerification(...)` | Non-blocking submit-only variant (recommended for production) |
| `verifySessionAggregationsOnChain(gameId)` | Post-game batch: iterates all proof jobs for a session, verifies aggregated proofs on-chain via CardWarRegistry |

#### On-Chain Verification — `onchain.ts`

`verifyAndRecordAggregationOnChain()`:
1. Connects to Base Mainnet via ethers.js using the operator wallet
2. Calls `CardWarRegistry.verifyProofAggregation()` (read-only) to check the Merkle inclusion proof
3. If valid, calls `CardWarRegistry.recordProofAggregationVerification()` (state-changing tx) to emit the on-chain event
4. Returns verification result with tx hash

---

### Verification Services — zkVerify Kurier

**Kurier** is the external relayer service provided by zkVerify that handles proof aggregation and settlement.

#### Integration Flow

1. **VK Registration**: The backend registers each circuit's verification key with Kurier once (`POST /register-vk/:apiKey`). The returned `vkHash` is cached for subsequent proof submissions.

2. **Proof Submission**: Each proof (UltraHonk, `attestation` mode) is submitted to Kurier (`POST /submit-proof/:apiKey`). Kurier returns:
   - `optimisticVerify`: Immediate validity check — `"success"` means the proof is syntactically valid
   - `jobId`: Identifier for tracking aggregation progress

3. **Job Status Polling**: The backend can poll `GET /job-status/:apiKey/:jobId` to track job progression through states:
   - `Submitted` → `Queued` → `IncludedInBlock` → `AggregationPending` → `Aggregated` (or `Failed`)

4. **Aggregation Details**: When a job reaches `Aggregated`, Kurier provides:
   - `aggregationId`, `leaf`, `leafIndex`, `numberOfLeaves`, `merkleProof`
   - These are the inputs required for on-chain Merkle inclusion verification

#### Reconcile Worker — `reconcileJobs.ts`

A background worker that handles asynchronous proof status resolution:

- **Start condition**: Launched at server boot if `ZK_RECONCILE_ENABLED !== "false"`
- **Interval**: Configurable via `ZK_RECONCILE_INTERVAL_MS` (default: 30s)
- **Logic**:
  1. Queries DB for stale verification jobs (status in `Submitted`, `Queued`, `IncludedInBlock`, `AggregationPending` and not updated recently)
  2. Polls Kurier for each job's current status
  3. Upserts fresh status data into `verification_jobs`
  4. For jobs whose game sessions were affected, triggers `verifySessionAggregationsOnChain()` to attempt on-chain settlement
- **Polling guard**: `ZK_RECONCILE_POLLING_ENABLED` allows disabling API calls while keeping the worker alive (useful for reducing load)

---

### Logging and Persistence

#### PostgreSQL Schema

The database schema (auto-created by `initDB()`) consists of 8 tables that capture the complete lifecycle of games and their ZK proof audit trail:

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│    users     │────►│      games       │     │   game_sessions   │
│ (wallets)    │     │ (game state)     │     │ (ZK tracking hub) │
└─────────────┘     └──────────────────┘     └─────────┬─────────┘
                    ┌──────────────────┐               │
                    │     rounds       │       ┌───────▼─────────┐
                    │ (per-round data) │       │    circuits      │
                    └──────────────────┘       │ (VK/ABI cached)  │
                                               └───────┬─────────┘
                                               ┌───────▼─────────┐
                                               │     proofs      │
                                               │  (proof records) │
                                               └───────┬─────────┘
                                       ┌───────────────┼───────────────┐
                               ┌───────▼─────────┐   ┌▼──────────────────────┐
                               │verification_jobs│   │aggregation_verifications│
                               │(Kurier job state)│   │(on-chain results)       │
                               └─────────────────┘   └─────────────────────────┘
```

| Table | Purpose |
|---|---|
| `users` | Wallet addresses, auto-created on first `join_queue` |
| `games` | Core game records: players, status, winner, original deck (JSONB), timestamps |
| `rounds` | Per-round data: cards played by each player, winner, war flag |
| `game_sessions` | ZK tracking hub: arrays of `circuit_uuids`, `proof_uuids`, `job_ids`; links a game to all its ZK artifacts |
| `circuits` | Cached compiled circuits with VK hex, VK hash, artifact SHA-256; deduplicated by `(kind, artifact_sha256)` |
| `proofs` | Individual proof records: hex, public inputs, hashes, local BB.js verification status, Kurier job linkage, on-chain verification status |
| `verification_jobs` | Kurier job lifecycle: status enum, aggregation details (leaf, Merkle proof, indices), statement, tx hash |
| `aggregation_verifications` | On-chain verification results: contract address, domain/aggregation IDs, Merkle path, verified flag, tx hash |

#### Tracking Service — `tracking/service.ts` + `tracking/repository.ts`

A service-repository pattern that encapsulates all DB interactions for the proving system:

- **Feature flag**: Controlled by `TRACKING_ENABLED` env var; when `false`, all tracking calls are no-ops
- **Service layer** (`TrackingService`): Business logic, session management, conditional writes
- **Repository layer** (`TrackingRepository`): Raw SQL queries with proper upsert semantics and array-append operations for session UUID arrays
- **SHA-256 hashing**: Proof hex and public inputs are hashed for integrity verification and deduplication

#### Logging

The system uses structured `console.log` / `console.error` with consistent tag prefixes:

| Tag | Source |
|---|---|
| `[SOCKET]` | Socket handler — connection, event, and error logging |
| `[API]` | REST endpoint request/response logging |
| `[ZK]` | Proof generation and verification lifecycle |
| `[ZK: SESSION]` | Post-game session verification retry loop |
| `[ZK: RECONCILE]` | Background reconcile worker operations |
| `[TRACKING]` | Tracking service persistence operations |
| `[WARN: ZKV]` | zkVerify-related warnings (missing VK hash, polling failures) |
| `[ERR: ...]` | Categorized error messages (Circuits, Proof, Env, etc.) |

---

## Core Logic Flows

### 1. Matchmaking Flow

```
Player A connects → join_queue(walletAddress)
  ├── Upsert user in DB
  ├── Matchmaker: queue empty → push to waitingPlayers
  └── Emit queue_joined

Player B connects → join_queue(walletAddress)
  ├── Upsert user in DB
  ├── Matchmaker: Player A waiting → create game
  │   ├── new GameEngine(gameId, playerA, playerB)
  │   ├── engine.setup(seedA, seedB)  ← Noir circuits execute
  │   │   ├── shuffle_deck(seedA), shuffle_deck(seedB)
  │   │   ├── deal_cards(shuffledA, seedA), deal_cards(shuffledB, seedB)
  │   │   ├── Populate player hands
  │   │   └── Fire-and-forget: 4 ZK proofs (background)
  │   ├── Insert games row + game_sessions row
  │   └── Room both sockets into gameId channel
  ├── Emit game_start to room
  └── Emit your_role to each player
```

### 2. Round Play Flow

```
Player A → flip_card(gameId)
  └── readyFlips.add(playerA) → size < 2 → emit player_ready

Player B → flip_card(gameId)
  └── readyFlips.add(playerB) → size = 2 → readyFlips.clear()
      ├── engine.flipCards()
      │   ├── Shift top card from each player's hand
      │   ├── Compare ranks:
      │   │   ├── Higher rank wins → winner gets both cards + war pile
      │   │   ├── Equal ranks → WAR state, cards added to pendingWarCards
      │   │   └── Game over if MAX_ROUNDS reached or hand empty
      │   └── Return result
      ├── Emit card_flip to room
      ├── If WAR: emit war_start
      ├── If game over: handleGameOver()
      └── Insert rounds row
```

### 3. War Resolution Flow

```
Both players → resolve_war(gameId)
  └── Both ready → engine.resolveWar()
      ├── Each player places 1 face-down card → pendingWarCards
      ├── State → ACTIVE
      └── Emit war_face_down (next flip decides the war)

Next flip_card call resolves normally:
  - Winner of the flip takes all pendingWarCards + current cards
```

### 4. ZK Proof Generation & Verification Flow

```
GameEngine.setup() completes:
  └── _generateAndVerifyProofsBackground() [fire-and-forget]
      │
      ├── Phase 1: Generate 4 proofs in parallel
      │   ├── generateProof(SHUFFLE, {seed_A, shuffled_deck_A})
      │   ├── generateProof(SHUFFLE, {seed_B, shuffled_deck_B})
      │   ├── generateProof(DEAL, {seed_A, commitment_A, cards_A})
      │   └── generateProof(DEAL, {seed_B, commitment_B, cards_B})
      │   Each:
      │     1. Load circuit JSON → Noir + UltraHonkBackend
      │     2. Validate inputs against circuit ABI
      │     3. Execute witness → generate UltraHonk proof
      │     4. Local BB.js verification
      │     5. Persist proof record via tracking service
      │
      ├── Phase 2: Submit all 4 for verification
      │   └── verifyProof() for each
      │       1. ensureCircuitSetup() — cache-or-register VK with Kurier
      │       2. POST /submit-proof → Kurier
      │       3. Persist verification job + attach to proof
      │       4. If blocking: poll job-status until Aggregated
      │       5. If non-blocking: return immediately
      │
      └── Phase 3: On-chain (if aggregated and blocking)
          └── verifyAndRecordAggregationOnChain()
              1. CardWarRegistry.verifyProofAggregation() [read]
              2. CardWarRegistry.recordProofAggregationVerification() [tx]
```

### 5. Post-Game Verification Flow

```
handleGameOver()
  ├── Emit game_end to room
  ├── Update games + game_sessions in DB
  └── startSessionVerificationRetry(gameId)
      │
      ├── Immediately runs verifySessionAggregationsOnChain(gameId)
      │   ├── Fetch all proof jobs for the session
      │   ├── For each Aggregated job with complete Merkle data:
      │   │   └── verifyAndRecordAggregationOnChain()
      │   └── Return summary: {verified, failed, skipped...}
      │
      └── Retry at interval (30s default, max 20 attempts)
          └── Stops when all jobs resolved or max attempts reached
```

---

## End-to-End User Game Session Workflow

### Step 1 — Connect & Enter

1. User opens the app at `/` (Home page)
2. Connects wallet via RainbowKit (Base Mainnet)
3. Clicks **ENTER BATTLE** → navigates to `/lobby`

### Step 2 — Find Match

4. Lobby page initializes Socket.IO connection via `useSocket(address)`
5. User clicks **Find Match** → `emitJoinQueue(walletAddress)`
6. Backend creates/updates user record, enters matchmaking queue
7. If opponent available: backend creates `GameEngine`, runs Noir circuits, deals cards
8. Both players receive `game_start` + `your_role` events
9. Frontend navigates to `/game`, `GameBoard` component renders

### Step 3 — Play Rounds

10. Player presses **FLIP** → `emitFlipCard(gameId)`
11. When both players ready → backend flips, compares ranks, broadcasts `card_flip`
12. Frontend animates card reveals, updates scores
13. If ranks equal → WAR: both players press **WAR** button → face-down cards placed → next flip resolves
14. Repeat for up to 5 rounds

### Step 4 — Game Over

15. Game ends when: a player runs out of cards, or 5 rounds complete, or a player disconnects
16. Backend emits `game_end` with winner
17. Frontend shows Victory/Defeat screen with scores
18. Frontend fetches `/api/games/:gameId/fairness` to display ZK fairness checks (shuffle ✅, deal ✅)

### Step 5 — Background Verification (Async)

19. Backend's post-game retry loop attempts to push aggregated proofs on-chain
20. Reconcile worker continues polling Kurier for any unresolved jobs
21. Once all proofs are aggregated and verified on-chain, the game session is fully attested
22. User can verify on-chain: `ProofAggregationVerified` events on CardWarRegistry

### Step 6 — Post-Game Transparency

23. Original deck available via `GET /api/games/:gameId/reveal` (only after game status is `CLOSED`)
24. Full proof audit trail queryable from PostgreSQL (`proofs`, `verification_jobs`, `aggregation_verifications`)

---

## Data and State Management

### In-Memory State (Backend)

| Structure | Lifetime | Contents |
|---|---|---|
| `Matchmaker.waitingPlayers[]` | Until matched or disconnected | Player queue entries with socketId, walletAddress, joinTimestamp |
| `Matchmaker.games: Map` | Duration of game + cleanup | GameEngine instance, player socket mappings, readyFlips set |
| `GameEngine` instance | Duration of game | Full card state — hands, pending war cards, original deck, round counter |
| `_circuitSetupCache: Map` | Server lifetime | Cached VK registration results per circuit kind |
| `_sessionVerifyRetryTimers: Map` | Until verification completes | Interval timers for post-game on-chain verification |

### Persistent State (PostgreSQL)

All game outcomes, round details, proof records, verification jobs, and on-chain attestation results are durably stored. The schema supports:

- **Fairness auditing**: Join `proofs` → `circuits` → `verification_jobs` → `aggregation_verifications` to trace a proof from generation through on-chain settlement
- **Session reconstruction**: `game_sessions` links all circuit UUIDs, proof UUIDs, and job IDs for a given game
- **Reconciliation**: `verification_jobs` with stale statuses are periodically re-checked by the reconcile worker

### Client-Side State (Frontend)

Zustand store (`gameStore.ts`) holds ephemeral UI state. No persistence — state resets on navigation. Game state transitions driven entirely by socket events.

---

## Security and Fairness Guarantees

### Provably Fair Card Operations

1. **Deterministic shuffling**: Each player's deck is shuffled using their `joinTimestamp` as a seed, executed through a Noir circuit. The same seed always produces the same shuffle.
2. **ZK proofs**: Four UltraHonk proofs (2 shuffle + 2 deal) are generated per game, proving the shuffle and deal were performed correctly without revealing the seed or card order during play.
3. **Local verification**: Every proof is first verified locally via BB.js before submission, ensuring only valid proofs reach the relayer.
4. **Optimistic verification**: Kurier performs immediate syntactic validation (`optimisticVerify: "success"`) on submission.
5. **Aggregated on-chain attestation**: Proofs are aggregated by Kurier and verified on-chain through the CardWarRegistry contract's Merkle inclusion check against the zkVerify settlement contract.

### Post-Game Transparency

- **Deck reveal**: The original shuffled deck is stored in PostgreSQL and exposed via the `/reveal` API after game completion, allowing independent verification.
- **Fairness endpoint**: The `/fairness` API provides a real-time summary of whether shuffle and deal proofs have passed both local and on-chain verification.
- **On-chain events**: `ProofAggregationVerified` events on CardWarRegistry provide an immutable, public record of verified game sessions.

### Non-Blocking Design

ZK proof generation and verification are intentionally non-blocking. The game proceeds immediately after Noir witness execution (which is fast, in-process). Proof generation, Kurier submission, and on-chain verification all happen asynchronously in the background. This ensures:
- **Zero gameplay latency** from ZK operations
- **Graceful degradation**: If proof generation or verification fails, the game completes normally; failures are logged for investigation
- **Eventual consistency**: The reconcile worker ensures all proofs eventually reach their terminal state (aggregated + on-chain verified)

### Access Control

- **Operator pattern**: On-chain state mutations (`completeGame`, `recordProofAggregationVerification`) are restricted to authorized operators
- **Backend authority**: Clients cannot manipulate card state; all game logic executes server-side
- **Wallet authentication**: Players are identified by their Ethereum wallet address, verified through RainbowKit/Wagmi
