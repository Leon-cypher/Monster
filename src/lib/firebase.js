import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"
import { getFunctions, httpsCallable } from "firebase/functions"

// ================================================
// Firebase Configuration
// ================================================
const firebaseConfig = {
  apiKey:            "AIzaSyDD52raidLgclxbPn3BVnaeSkP3baTac7s",
  authDomain:        "monster-afb3a.firebaseapp.com",
  projectId:         "monster-afb3a",
  storageBucket:     "monster-afb3a.firebasestorage.app",
  messagingSenderId: "984679406136",
  appId:             "1:984679406136:web:2e0487b3b49a713d3464cd",
  measurementId:     "G-G8C9183K3W",
}

const app       = initializeApp(firebaseConfig)
const db        = getFirestore(app)
const functions = getFunctions(app, 'asia-east1')

const callFn = (name) => httpsCallable(functions, name)

export { app, db, functions, callFn }

// ================================================
// Database schema reference:
// players/{id}  → { points, drawsUsed, created }
// draws/{id}    → { playerId, phase, card1, card2, result, timestamp }
// phases/{1-4}  → { startDate, endDate, communityCards, active }
// settings/     → { grandPrize, regularPrizePool, minPrize, maxWinners, pointsPerDraw }
// ================================================
