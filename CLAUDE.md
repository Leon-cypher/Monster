# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend
```bash
npm run dev        # Vite dev server (HMR)
npm run build      # Production build → dist/
npm run preview    # Preview built app locally
npm run lint       # ESLint check
```

### Deploy
```bash
# Always build before deploying hosting
npm run build && firebase deploy --only hosting

# Deploy everything
npm run build && firebase deploy

# Deploy specific targets
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

### Functions (run from functions/)
```bash
cd functions && npm install   # Install dependencies before first deploy
firebase deploy --only functions
firebase functions:log        # View logs
```

> **Vite version note**: Must use Vite 5.x. Vite 8.x has a Windows bug where `npm run build` silently outputs nothing. If build produces no `dist/index.html`, downgrade: `npm install vite@^5.4.0 @vitejs/plugin-react@^4.3.0 --save-dev`

## Architecture

### Overview
A tournament-based lottery system for a poker club (THE ONE POKER). Players earn points from POS purchases, redeem points for scratch card chances, and combine drawn hole cards with 5 public community cards to form poker hands for prizes.

**Two branches**: 逢甲 / 北屯 — players and points are tracked per branch. All admin and query operations must specify a branch.

**Four phases**: April 1 – May 31, each ~15 days with its own community card set and winner pool.

### Tech Stack
| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite 5 + React Router v7 |
| Animation | GSAP (ScrollTrigger), Three.js (particle bg) |
| Backend | Firebase Cloud Functions v2, Node.js 24, asia-east1 |
| Database | Firestore |
| Storage | Cloud Storage (POS Excel uploads) |
| Hosting | Firebase Hosting (SPA, rewrites to index.html) |

### Frontend Structure
```
src/
  main.jsx          — BrowserRouter entry
  App.jsx           — Routes: / (PlayerPage), /admin (AdminPage)
  index.css         — CSS variables (--gold, --neon, --green, --black, --white, --gray)
  lib/firebase.js   — Firebase init; exports: db, callFn(name)
  pages/
    PlayerPage.jsx  — Player-facing: HERO → community cards → tabs (點數查詢/活動說明/開獎時程)
    AdminPage.jsx   — Admin dashboard: phase mgmt, player ops, draw results, batch rollback
  components/
    Navbar.jsx      — Fixed top nav, phase pill, admin/player toggle
    ParticlesBg.jsx — Three.js gold floating particles (canvas position:fixed, zIndex:0)
```

**Calling Cloud Functions** — always use the factory:
```js
import { callFn } from '../lib/firebase'
const result = await callFn('functionName')({ ...args })
// result.data.data contains the response payload
```

**Firestore real-time** — use `onSnapshot` for live data (community cards, phases, draws stats). Clean up in `useEffect` return.

**ParticlesBg zIndex** — The canvas is `position:fixed, zIndex:0`. Any page wrapper must have `zIndex:1` to appear above particles.

### Cloud Functions (`functions/index.js`)
| Function | Trigger | Purpose |
|---|---|---|
| `processPOS` | Storage upload (reports/*.xlsx) | Parse Excel, create pos_records |
| `scheduledCalculatePoints` | Cron 15:00 Asia/Taipei | Daily point calculation |
| `triggerManualCalculation` | HTTPS callable | Admin manual calc trigger |
| `getUserPoints` | HTTPS callable | Query player points + transaction history |
| `redeemChance` | HTTPS callable | Deduct scratch card chance |
| `manualAdjustPoints` | HTTPS callable | Admin point/chance adjustment |
| `rollbackPOSBatch` | HTTPS callable | Reverse all effects of a POS file |

### Firestore Collections
**`playerScores`** — doc ID: `{playerId}_{branchId}`
- `playerId`, `branchId`, `points` (0–9 remainder), `lotteryChances`, `playerName`, `lastUpdated`

**`pointTransactions`** — audit log, auto-ID
- `playerId`, `branchId`, `type` (EARN_POINTS / REDEEM_CARD / ADMIN_DEDUCT / MANUAL_ADJUST / ROLLED_BACK), `pointsChanged`, `chancesChanged`, `checkoutTime`, `description`, `sourceFile`

**`pos_records`** — doc ID: `{branchId}_{transactionId}_{itemName}_{seq}`
- Raw POS line items. `processed: false` → picked up by next calculation run.

**`phases`** — doc ID: "1"–"4"
- `active` (boolean), `label` (string), `cards` (array of 5 card IDs like `"club_1"`)

**`draws`** — draw results per player per phase
- `playerId`, `phase` (matches `phases.label`), `card1`, `card2`, `result` (大獎/普獎/無), `timestamp`

### Business Logic
**Point tiers** (from item price in POS):
- $1,200–$3,399 → 1 pt, $3,400–$6,599 → 2 pt, $6,600–$10,999 → 3 pt, $11,000+ → 5 pt
- Every 10 cumulative points generates 1 `lotteryChance`; remainder stays in `points`

**Winning condition**: hole cards + community cards → best 5-card poker hand
- 大獎: Four of a Kind or better → $30,000
- 普獎: Full House → $20,000 split (min $500/person)

**Card IDs** format: `{suit}_{rank}` — suit: club/diamond/heart/spade, rank: 1–13

### Key Design Decisions
- All styling is inline CSS (no CSS modules or styled-components). Use `clamp()` for responsive values. Media queries go in the `<style>` JSX tag at the bottom of PlayerPage.
- `html` and `body` both need `overflow-x: hidden` for iOS Safari to prevent horizontal scroll.
- Admin page has no authentication — assumed to be accessed only by trusted operators.
- Firestore security rules are open until 2026-06-01 (development mode).
