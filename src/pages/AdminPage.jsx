import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { db, callFn } from '../lib/firebase'
import {
  doc, setDoc, collection, onSnapshot,
  query, orderBy, limit, where, serverTimestamp, writeBatch, increment,
} from 'firebase/firestore'
import * as XLSX from 'xlsx'

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN
const BRANCHES = ['逢甲店', '北屯店']
const PHASES = ['第一階段', '第二階段', '第三階段', '第四階段']
const PHASE_LABELS = [
  '第一階段　4/1 ～ 4/16',
  '第二階段　4/17 ～ 5/1',
  '第三階段　5/2 ～ 5/16',
  '第四階段　5/17 ～ 5/31',
]

const CARD_W = 64
const CARD_H = Math.round(CARD_W * 244.64 / 169.075)

const SUITS = [
  { id: 'spade',   label: '♠', color: '#c8c8c8' },
  { id: 'heart',   label: '♥', color: '#e74c3c' },
  { id: 'diamond', label: '♦', color: '#e74c3c' },
  { id: 'club',    label: '♣', color: '#c8c8c8' },
]
const RANKS = [
  { id: '1', label: 'A' },
  { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '4', label: '4' },
  { id: '5', label: '5' }, { id: '6', label: '6' }, { id: '7', label: '7' },
  { id: '8', label: '8' }, { id: '9', label: '9' }, { id: '10', label: '10' },
  { id: 'jack', label: 'J' }, { id: 'queen', label: 'Q' }, { id: 'king', label: 'K' },
]

/* ─── Poker hand evaluator ─── */
function parseCardId(id) {
  if (!id) return null
  const u = id.indexOf('_')
  const rank = { jack: 11, queen: 12, king: 13 }[id.slice(u + 1)] ?? parseInt(id.slice(u + 1))
  return { suit: id.slice(0, u), rank }
}

function evalFiveCard(cards) {
  const ranks  = cards.map(c => c.rank === 1 ? 14 : c.rank).sort((a, b) => b - a)
  const suits  = cards.map(c => c.suit)
  const isFlush = suits.every(s => s === suits[0])
  const uniq   = [...new Set(ranks)].sort((a, b) => b - a)
  let isStraight = uniq.length === 5 && uniq[0] - uniq[4] === 4
  if (!isStraight && uniq.length === 5 && uniq[0] === 14) {
    const low = uniq.slice(1)
    isStraight = low[0] === 5 && low[3] === 2
  }
  const freq   = {}
  ranks.forEach(r => freq[r] = (freq[r] || 0) + 1)
  const counts = Object.values(freq).sort((a, b) => b - a)
  if (isFlush && isStraight) return 8
  if (counts[0] === 4) return 7
  if (counts[0] === 3 && counts[1] === 2) return 6
  if (isFlush) return 5
  if (isStraight) return 4
  if (counts[0] === 3) return 3
  if (counts[0] === 2 && counts[1] === 2) return 2
  if (counts[0] === 2) return 1
  return 0
}

const HAND_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '鐵支', '同花順']

function evalBestHand(holeIds, communityIds) {
  const all = [...holeIds, ...communityIds].map(parseCardId).filter(Boolean)
  if (all.length < 5) return null
  let best = -1, n = all.length
  for (let a = 0; a < n-4; a++)
    for (let b = a+1; b < n-3; b++)
      for (let c = b+1; c < n-2; c++)
        for (let d = c+1; d < n-1; d++)
          for (let e = d+1; e < n; e++) {
            const s = evalFiveCard([all[a], all[b], all[c], all[d], all[e]])
            if (s > best) best = s
          }
  return best >= 0 ? { rank: best, name: HAND_NAMES[best] } : null
}

/* ─── CSS-in-JS tokens ─── */
const C = {
  bg:        '#111c12',
  panel:     '#1c2e1e',
  panelHdr:  '#213224',
  border:    'rgba(255,255,255,0.09)',
  borderGold:'rgba(201,168,64,0.35)',
  gold:      '#c9a840',
  neon:      '#00ffb3',
  red:       '#e74c3c',
  white:     '#efefef',
  gray:      '#7a7a7a',
  input:     '#162018',
}

/* ─── Primitives ─── */
const Panel = ({ title, icon, children, span2 }) => (
  <div style={{
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderTop: `2px solid ${C.gold}`,
    borderRadius: 16,
    overflow: 'hidden',
    gridColumn: span2 ? '1 / -1' : undefined,
  }}>
    <div style={{
      background: C.panelHdr,
      padding: '14px 20px',
      display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: `1px solid ${C.border}`,
      fontSize: '0.95em', fontWeight: 900, color: C.gold,
    }}>
      <span>{icon}</span>{title}
    </div>
    <div style={{ padding: '20px' }}>{children}</div>
  </div>
)

const FLabel = ({ children }) => (
  <div style={{ fontSize: '0.75em', letterSpacing: 2, textTransform: 'uppercase', color: C.gray, marginBottom: 5, marginTop: 12 }}>
    {children}
  </div>
)

const FInput = (props) => (
  <input {...props} style={{
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: `1px solid ${C.borderGold}`,
    background: C.input, color: C.white,
    fontSize: '0.9em', outline: 'none',
    ...props.style,
  }} />
)

const FSelect = ({ children, ...props }) => (
  <select {...props} style={{
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: `1px solid ${C.borderGold}`,
    background: C.input, color: C.white,
    fontSize: '0.9em', outline: 'none', cursor: 'pointer',
    ...props.style,
  }}>{children}</select>
)

const Btn = ({ variant = 'gold', children, ...props }) => {
  const styles = {
    gold: { background: `linear-gradient(135deg,${C.gold},#b87333)`, color: '#000' },
    neon: { background: 'linear-gradient(135deg,#00ffb3,#00b482)', color: '#000' },
    blue: { background: 'linear-gradient(135deg,#3498db,#2980b9)', color: '#fff' },
    red:  { background: `linear-gradient(135deg,${C.red},#c0392b)`, color: '#fff' },
    ghost:{ background: 'transparent', color: C.gold, border: `1px solid ${C.borderGold}` },
  }
  return (
    <button {...props} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      padding: '10px 18px', borderRadius: 8, border: 'none',
      fontWeight: 900, fontSize: '0.88em', cursor: 'pointer',
      letterSpacing: 0.5, transition: 'opacity 0.2s',
      ...styles[variant],
      ...props.style,
    }}>{children}</button>
  )
}

const Feedback = ({ type, children }) => {
  if (!children) return null
  const map = {
    ok:   { bg: '#0e2e1a', border: '#00ffb3', color: C.neon },
    err:  { bg: '#2a0a0a', border: C.red,     color: '#ff9090' },
    warn: { bg: '#2a2000', border: C.gold,    color: '#e8c96a' },
    info: { bg: '#0e1e10', border: C.borderGold, color: C.white },
  }
  const s = map[type] || map.info
  return (
    <div style={{
      marginTop: 12, padding: '12px 16px', borderRadius: 8,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.color, fontSize: '0.88em', lineHeight: 1.6,
    }}>{children}</div>
  )
}

/* ─── Card Slot ─── */
function CardSlot({ index, suit, rank, onSuitChange, onRankChange, label }) {
  const cardId = suit && rank ? `${suit}_${rank}` : null
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '14px 10px', borderRadius: 12,
      background: cardId ? '#1a2e1c' : '#151f16',
      border: `1px solid ${cardId ? C.borderGold : C.border}`,
    }}>
      <div style={{ fontSize: '0.68em', letterSpacing: 2, color: C.gray, textTransform: 'uppercase' }}>
        {label || `第 ${index + 1} 張`}
      </div>

      <div style={{ width: CARD_W, height: CARD_H, borderRadius: 5, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', flexShrink: 0 }}>
        <svg width={CARD_W} height={CARD_H} viewBox="0 0 169.075 244.64" style={{ display: 'block' }}>
          <use href={`/svg-cards.svg#${cardId || 'back'}`} />
        </svg>
      </div>

      {/* Suit */}
      <div style={{ display: 'flex', gap: 4 }}>
        {SUITS.map(s => (
          <button key={s.id} onClick={() => onSuitChange(s.id)} style={{
            width: 30, height: 30, borderRadius: 6,
            border: suit === s.id ? `2px solid ${C.gold}` : '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer', fontSize: '0.95em', fontWeight: 900,
            color: s.color,
            background: suit === s.id ? 'rgba(201,168,64,0.2)' : '#111c12',
            transition: 'all 0.12s',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Rank */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 3, width: '100%' }}>
        {RANKS.map(r => (
          <button key={r.id} onClick={() => onRankChange(r.id)} style={{
            padding: '3px 1px', borderRadius: 5, border: 'none',
            cursor: 'pointer', fontSize: '0.72em', fontWeight: 700,
            color: rank === r.id ? '#000' : C.gray,
            background: rank === r.id ? C.gold : 'rgba(255,255,255,0.07)',
            transition: 'all 0.12s',
          }}>{r.label}</button>
        ))}
      </div>

      {cardId && (
        <button onClick={() => { onSuitChange(''); onRankChange('') }} style={{
          padding: '3px 10px', borderRadius: 20, border: 'none',
          fontSize: '0.7em', cursor: 'pointer',
          background: 'rgba(231,76,60,0.2)', color: '#ff9090',
        }}>✕ 清除</button>
      )}
    </div>
  )
}

const SAVE_PASSWORD = '2150995'

/* ─── Password Dialog ─── */
function PasswordDialog({ message, onConfirm, onCancel }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function handleConfirm() {
    if (pw === SAVE_PASSWORD) { onConfirm() }
    else { setErr(true); setPw('') }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: '#1c2e1e', border: `1px solid ${C.gold}`,
        borderRadius: 16, padding: '32px 36px', maxWidth: 440, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        <div style={{ fontSize: '1.5em', marginBottom: 12 }}>🔐</div>
        <div style={{ fontWeight: 900, fontSize: '1.05em', marginBottom: 10, color: C.white }}>確認操作</div>
        <div style={{ color: C.gray, lineHeight: 1.7, marginBottom: 20, fontSize: '0.9em', whiteSpace: 'pre-line' }}>{message}</div>
        <div style={{ fontSize: '0.75em', letterSpacing: 2, color: C.gray, marginBottom: 6 }}>請輸入密碼以確認執行</div>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          placeholder="輸入密碼"
          autoFocus
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 8, boxSizing: 'border-box',
            border: `1px solid ${err ? C.red : C.borderGold}`,
            background: C.input, color: C.white, fontSize: '0.9em', outline: 'none', marginBottom: 6,
          }}
        />
        {err && <div style={{ fontSize: '0.82em', color: '#ff9090', marginBottom: 10 }}>密碼錯誤，請重試</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: err ? 4 : 14 }}>
          <Btn variant="ghost" onClick={onCancel} style={{ flex: 1 }}>取消</Btn>
          <Btn variant="gold" onClick={handleConfirm} style={{ flex: 1 }}>確認執行</Btn>
        </div>
      </div>
    </div>
  )
}

/* ─── Confirm Dialog ─── */
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: '#1c2e1e', border: `1px solid ${C.red}`,
        borderRadius: 16, padding: '32px 36px', maxWidth: 440, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        <div style={{ fontSize: '1.5em', marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 900, fontSize: '1.05em', marginBottom: 10, color: C.white }}>確認操作</div>
        <div style={{ color: C.gray, lineHeight: 1.7, marginBottom: 28, fontSize: '0.9em', whiteSpace: 'pre-line' }}>{message}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="ghost" onClick={onCancel} style={{ flex: 1 }}>取消</Btn>
          <Btn variant="red" onClick={onConfirm} style={{ flex: 1 }}>確認執行</Btn>
        </div>
      </div>
    </div>
  )
}

/* ─── Main ─── */
export default function AdminPage() {
  const [records, setRecords]   = useState([])
  const [connected, setConnected] = useState(false)
  const [phase, setPhase]       = useState(0)

  const [branch, setBranch]     = useState('逢甲店')

  // 玩家操作 panel 有自己的 branch 選擇
  const [opBranch, setOpBranch] = useState('逢甲店')
  const [sId, setSId]           = useState('')
  const [sRes, setSRes]         = useState(null)
  const [pAction, setPAction]   = useState('deduct')
  const [pAmt, setPAmt]         = useState('1')
  const [pRes, setPRes]         = useState(null)

  const [prId, setPrId]         = useState('')
  const [prMode, setPrMode]     = useState('')   // '' | 'lose' | 'win'
  const [handSlots, setHandSlots] = useState([{ suit: '', rank: '' }, { suit: '', rank: '' }])
  const [prResult, setPrResult] = useState('')
  const [prRes, setPrRes]       = useState(null)

  const [fPhase, setFPhase]     = useState('all')
  const [fResult, setFResult]   = useState('all')
  const [calcRes, setCalcRes]   = useState(null)
  const [calcLoading, setCalcLoading] = useState(false)

  const [phaseDocs, setPhaseDocs] = useState({})
  const [cardsPhase, setCardsPhase] = useState(0)
  const [slots, setSlots]         = useState(Array(5).fill(null).map(() => ({ suit: '', rank: '' })))
  const [cardsRes, setCardsRes]   = useState(null)
  const [confirm, setConfirm]     = useState(null)
  const [pwConfirm, setPwConfirm] = useState(null)

  const [searchLoading, setSearchLoading] = useState(false)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [saveLoading, setSaveLoading]     = useState(false)

  const [rbFile, setRbFile]   = useState('')
  const [rbRes, setRbRes]     = useState(null)
  const [rbLoading, setRbLoading] = useState(false)

  /* ─── Firebase listeners ─── */
  useEffect(() => {
    const q = fPhase !== 'all'
      ? query(collection(db, 'draws'), where('phase', '==', fPhase), orderBy('timestamp', 'desc'))
      : query(collection(db, 'draws'), orderBy('timestamp', 'desc'), limit(1000))
    return onSnapshot(q,
      snap => {
        setConnected(true)
        setRecords(snap.docs.map(d => {
          const r = d.data()
          return { id: r.playerId, phase: r.phase, c1: r.card1, c2: r.card2, result: r.result, time: r.timestamp?.toDate().toLocaleString('zh-TW') ?? '—' }
        }))
      },
      () => setConnected(false),
    )
  }, [fPhase])

  const cardsPhaseInitialized = useRef(false)
  useEffect(() => {
    return onSnapshot(collection(db, 'phases'), snap => {
      const docs = {}
      snap.docs.forEach(d => { docs[d.id] = d.data() })
      setPhaseDocs(docs)
      // 首次載入時自動切換至目前 active 的階段
      if (!cardsPhaseInitialized.current) {
        const activeIndex = snap.docs.findIndex(d => d.data().active === true)
        if (activeIndex !== -1) {
          setCardsPhase(activeIndex)
          setPhase(activeIndex)
        }
        cardsPhaseInitialized.current = true
      }
    })
  }, [])

  useEffect(() => {
    const data = phaseDocs[String(cardsPhase + 1)]
    if (data?.cards?.length) {
      setSlots(Array(5).fill(null).map((_, i) => {
        const id = data.cards[i]
        if (!id) return { suit: '', rank: '' }
        const u = id.indexOf('_')
        return { suit: id.slice(0, u), rank: id.slice(u + 1) }
      }))
    } else {
      setSlots(Array(5).fill(null).map(() => ({ suit: '', rank: '' })))
    }
    setCardsRes(null)
  }, [cardsPhase, phaseDocs])

  /* ─── Hand eval ─── */
  const communityCardIds = slots.map(s => s.suit && s.rank ? `${s.suit}_${s.rank}` : null).filter(Boolean)
  const holeCardIds      = handSlots.map(s => s.suit && s.rank ? `${s.suit}_${s.rank}` : null).filter(Boolean)
  const handEval         = holeCardIds.length > 0 && communityCardIds.length === 5
    ? evalBestHand(holeCardIds, communityCardIds) : null
  const suggestedResult  = handEval
    ? (handEval.rank >= 7 ? '大獎' : handEval.rank >= 6 ? '普獎' : '無') : null

  /* ─── Stats ─── */
  const phaseStats = phaseDocs[String(phase + 1)]?.stats || {}
  const grand   = phaseStats.grand   || 0
  const regular = phaseStats.regular || 0
  const none    = phaseStats.none    || 0
  const total   = grand + regular + none

  let perPerson = 'N/A', perNote = `${PHASES[phase]}目前無人中普獎`
  if (regular > 40) { perPerson = '改發現金+點數'; perNote = `⚠️ 已達 ${regular} 人，超過 40 人上限` }
  else if (regular > 0) { const v = Math.max(Math.round(20000 / regular), 500); perPerson = `$${v.toLocaleString()}`; perNote = `$20,000 ÷ ${regular} 人${v === 500 ? '（保底 $500）' : ''}` }

  let grandPerPerson = 'N/A', grandPerNote = `${PHASES[phase]}目前無人中大獎`
  if (grand > 0) { const v = Math.max(Math.round(30000 / grand), 500); grandPerPerson = `$${v.toLocaleString()}`; grandPerNote = `$30,000 ÷ ${grand} 人${v === 500 ? '（保底 $500）' : ''}` }

  const filtered = records.filter(r =>
    fResult === 'all' || r.result === fResult
  )

  /* ─── Actions ─── */
  async function searchPlayer() {
    if (!sId.trim()) { setSRes({ t: 'err', msg: '請輸入玩家 ID' }); return }
    setPRes(null)
    setSearchLoading(true)
    try {
      const res = await callFn('getUserPoints')({ playerId: sId.trim(), branchId: opBranch })
      setSRes({ t: 'ok', id: sId.trim(), p: res.data.data.player })
      setPrId(sId.trim()) // 同步 ID 到兌獎登記
    } catch (e) {
      if (e.code === 'functions/invalid-argument') setSRes({ t: 'warn', id: sId.trim() })
      else setSRes({ t: 'err', msg: '查詢失敗，請稍後再試' })
    } finally {
      setSearchLoading(false)
    }
  }

  async function createPlayer(id) {
    try {
      await setDoc(doc(db, 'playerScores', `${id}_${opBranch}`), {
        playerId: id, branchId: opBranch, points: 0, lotteryChances: 0,
        lastUpdated: serverTimestamp(), playerName: id,
      })
      setSRes({ t: 'created', id })
    } catch { setSRes({ t: 'err', msg: '建立失敗，請稍後再試' }) }
  }

  async function updatePoints() {
    if (!sId.trim()) { setPRes({ t: 'err', msg: '請先查詢玩家' }); return }
    const amt = parseInt(pAmt)
    if (!amt || amt <= 0) { setPRes({ t: 'err', msg: pAction === 'add' ? '請輸入有效點數' : '請輸入有效次數' }); return }
    setUpdateLoading(true)
    try {
      if (pAction === 'add') {
        await callFn('manualAdjustPoints')({
          playerId: sId.trim(), branchId: opBranch,
          pointsAdjustment: amt, chancesAdjustment: 0,
          reason: `後台手動加點 ${amt}pt`, operator: 'ADMIN',
          adminToken: ADMIN_TOKEN,
        })
        setPRes({ t: 'ok', op: 'add', amt })
      } else if (pAction === 'addChance') {
        await callFn('manualAdjustPoints')({
          playerId: sId.trim(), branchId: opBranch,
          pointsAdjustment: 0, chancesAdjustment: amt,
          reason: `後台手動加抽獎次數 ${amt}次`, operator: 'ADMIN',
          adminToken: ADMIN_TOKEN,
        })
        setPRes({ t: 'ok', op: 'addChance', amt })
      } else {
        await callFn('redeemChance')({
          playerId: sId.trim(), branchId: opBranch,
          deductTimes: amt,
          reason: '後台扣除抽獎次數', operator: 'ADMIN',
          adminToken: ADMIN_TOKEN,
        })
        setPRes({ t: 'ok', op: 'deduct', amt })
      }
      // refresh player data
      const res = await callFn('getUserPoints')({ playerId: sId.trim(), branchId: opBranch })
      setSRes({ t: 'ok', id: sId.trim(), p: res.data.data.player })
    } catch (e) { setPRes({ t: 'err', msg: e.message }) }
    finally { setUpdateLoading(false) }
  }

  async function triggerCalc() {
    setCalcLoading(true); setCalcRes(null)
    try {
      const res = await callFn('triggerManualCalculation')({ adminToken: ADMIN_TOKEN })
      setCalcRes({ t: 'ok', msg: res.data.message || '計算完成' })
    } catch (e) {
      setCalcRes({ t: 'err', msg: e.message })
    } finally {
      setCalcLoading(false)
    }
  }

  async function submitPrize(resultOverride) {
    if (!prId.trim()) { setPrRes({ t: 'err', msg: '請輸入玩家 ID' }); return }
    const result = resultOverride || prResult
    if (!result) { setPrRes({ t: 'err', msg: '請選擇獎項結果' }); return }
    const c1 = handSlots[0].suit && handSlots[0].rank ? `${handSlots[0].suit}_${handSlots[0].rank}` : ''
    const c2 = handSlots[1].suit && handSlots[1].rank ? `${handSlots[1].suit}_${handSlots[1].rank}` : ''
    setSubmitLoading(true)
    try {
      await callFn('submitDraw')({ playerId: prId.trim(), phase: PHASES[phase], card1: c1, card2: c2, result, adminToken: ADMIN_TOKEN })
      setPrRes({ t: 'ok', id: prId.trim(), result, c1, c2 })
      setPrId(''); setPrMode(''); setHandSlots([{ suit: '', rank: '' }, { suit: '', rank: '' }]); setPrResult('')
    } catch (e) { console.error('submitPrize failed:', e); setPrRes({ t: 'err', msg: '提交失敗，請稍後再試' }) }
    finally { setSubmitLoading(false) }
  }

  function updateSlot(i, field, value) {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  async function doSaveCards() {
    const cards = slots.map(s => (s.suit && s.rank) ? `${s.suit}_${s.rank}` : null)
    const definedCards = cards.filter(Boolean)
    if (new Set(definedCards).size !== definedCards.length) {
      setCardsRes({ t: 'err', msg: '公共牌中有重複的牌，請重新確認' })
      return
    }
    setSaveLoading(true)
    try {
      await doc(db, 'phases', String(cardsPhase + 1))
      const batch = writeBatch(db)
      batch.set(doc(db, 'phases', String(cardsPhase + 1)), {
        cards, label: PHASE_LABELS[cardsPhase],
      }, { merge: true })
      await batch.commit()
      setCardsRes({ t: 'ok', msg: `✅ ${PHASES[cardsPhase]}公共牌已儲存（未切換展示）` })
    } catch { setCardsRes({ t: 'err', msg: '儲存失敗，請稍後再試' }) }
    finally { setSaveLoading(false) }
  }

  async function doActivatePhase() {
    setSaveLoading(true)
    try {
      const batch = writeBatch(db)
      for (let i = 1; i <= 4; i++) {
        batch.set(doc(db, 'phases', String(i)), {
          active: i === cardsPhase + 1,
        }, { merge: true })
      }
      await batch.commit()
      setCardsRes({ t: 'ok', msg: `✅ ${PHASES[cardsPhase]}已設為玩家端展示` })
    } catch { setCardsRes({ t: 'err', msg: '切換失敗，請稍後再試' }) }
    finally { setSaveLoading(false) }
  }

  async function rollbackBatch() {
    if (!rbFile.trim()) { setRbRes({ t: 'err', msg: '請輸入要撤銷的檔名' }); return }
    setRbLoading(true); setRbRes(null)
    try {
      const res = await callFn('rollbackPOSBatch')({ fileName: rbFile.trim(), adminToken: ADMIN_TOKEN })
      setRbRes({ t: res.data.success ? 'ok' : 'warn', msg: res.data.message })
      if (res.data.success) setRbFile('')
    } catch (e) {
      setRbRes({ t: 'err', msg: e.message })
    } finally {
      setRbLoading(false)
    }
  }

  function exportWinners() {
    const winners = records.filter(r => r.result === '大獎' || r.result === '普獎')
    if (winners.length === 0) { alert('目前篩選條件下沒有中獎紀錄'); return }

    // 計算各階段普獎/大獎人數（從所有 records）
    const phaseRegularCount = {}
    const phaseGrandCount = {}
    records.forEach(r => {
      if (r.result === '普獎') phaseRegularCount[r.phase] = (phaseRegularCount[r.phase] || 0) + 1
      if (r.result === '大獎') phaseGrandCount[r.phase] = (phaseGrandCount[r.phase] || 0) + 1
    })

    const rows = winners.map(r => {
      let prize = ''
      if (r.result === '大獎') {
        const cnt = phaseGrandCount[r.phase] || 1
        const v = Math.max(Math.round(30000 / cnt), 500)
        prize = `$${v.toLocaleString()}（$30,000 ÷ ${cnt} 人）`
      } else if (r.result === '普獎') {
        const cnt = phaseRegularCount[r.phase] || 1
        const v = Math.max(Math.round(20000 / cnt), 500)
        prize = `$${v.toLocaleString()}（$20,000 ÷ ${cnt} 人）`
      }
      return { 階段: r.phase, 玩家ID: r.id, 手牌1: r.c1 || '—', 手牌2: r.c2 || '—', 結果: r.result, 獎金: prize, 時間: r.time }
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 28 }, { wch: 22 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '中獎名單')
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    XLSX.writeFile(wb, `中獎名單_${fPhase === 'all' ? '全階段' : fPhase}_${today}.xlsx`)
  }

  const isActive = phaseDocs[String(cardsPhase + 1)]?.active === true

  const resultBadge = r => ({
    大獎: { background: 'rgba(201,168,64,0.15)', color: C.gold,  border: `1px solid rgba(201,168,64,0.3)` },
    普獎: { background: 'rgba(0,255,179,0.10)', color: C.neon,  border: `1px solid rgba(0,255,179,0.2)` },
    無:   { background: 'rgba(120,120,120,0.1)', color: C.gray, border: `1px solid rgba(120,120,120,0.2)` },
  }[r] || {})

  /* ─── Topbar select style ─── */
  const topSelect = {
    padding: '6px 14px', borderRadius: 8,
    border: `1px solid ${C.borderGold}`,
    background: C.input, color: C.gold,
    fontSize: '0.82em', fontWeight: 700,
    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.white, fontFamily: 'inherit' }}>

      {confirm && <ConfirmDialog message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      {pwConfirm && <PasswordDialog message={pwConfirm.message} onConfirm={pwConfirm.onConfirm} onCancel={() => setPwConfirm(null)} />}

      {/* ── Topbar ── */}
      <div className="admin-topbar" style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#0d160e', borderBottom: `1px solid ${C.border}`,
        padding: '12px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/LOGO.png" alt="logo" style={{ height: 28 }} />
          <span style={{ color: C.gray, fontSize: '0.8em', letterSpacing: 2 }}>/ 店員後台</span>
          <Link to="/" style={{
            padding: '5px 14px', borderRadius: 100,
            border: `1px solid ${C.borderGold}`,
            color: C.gold, fontSize: '0.78em', fontWeight: 700,
            textDecoration: 'none', marginLeft: 8,
          }}>← 玩家頁面</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={branch} onChange={e => setBranch(e.target.value)} style={topSelect}>
            {BRANCHES.map(b => <option key={b} value={b} style={{ background: C.input }}>{b}</option>)}
          </select>
          <select value={phase} onChange={e => {
            const next = +e.target.value
            setPwConfirm({ message: `切換兌獎登記階段至「${PHASES[next]}」？`, onConfirm: () => { setPwConfirm(null); setPhase(next) } })
          }} style={topSelect}>
            {PHASES.map((p, i) => <option key={i} value={i} style={{ background: C.input }}>{p}</option>)}
          </select>
          <div style={{
            padding: '6px 14px', borderRadius: 8, fontSize: '0.78em', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
            background: connected ? 'rgba(0,255,179,0.1)' : 'rgba(231,76,60,0.1)',
            border: `1px solid ${connected ? 'rgba(0,255,179,0.3)' : 'rgba(231,76,60,0.3)'}`,
            color: connected ? C.neon : C.red,
          }}>
            <span style={{ fontSize: '0.6em' }}>●</span>
            {connected ? '已連接 Firebase' : '未連接 Firebase'}
          </div>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="admin-grid" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px 60px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 18 }}>

        {/* 1. 玩家查詢 + 加點/扣點 */}
        <Panel title="玩家查詢 / 點數操作" icon="🔍">
          {/* Branch selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {BRANCHES.map(b => (
              <button key={b} onClick={() => { setOpBranch(b); setSRes(null); setPRes(null) }} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontWeight: 900, fontSize: '0.88em', transition: 'all 0.15s',
                background: opBranch === b ? C.gold : 'rgba(201,168,64,0.08)',
                color: opBranch === b ? '#000' : C.gold,
              }}>{b}</button>
            ))}
          </div>

          {/* Player ID */}
          <div style={{ display: 'flex', gap: 8 }}>
            <FInput
              value={sId}
              onChange={e => { setSId(e.target.value); setSRes(null); setPRes(null) }}
              onKeyDown={e => e.key === 'Enter' && searchPlayer()}
              placeholder="輸入玩家 ID"
              style={{ flex: 1 }}
            />
            <Btn onClick={searchPlayer} disabled={searchLoading} style={{ whiteSpace: 'nowrap', opacity: searchLoading ? 0.6 : 1 }}>{searchLoading ? '查詢中…' : '查詢'}</Btn>
          </div>

          {/* Query result */}
          {sRes && (
            sRes.t === 'err' ? <Feedback type="err">{sRes.msg}</Feedback>
            : sRes.t === 'warn' ? <Feedback type="warn">
                找不到玩家 <strong>{sRes.id}</strong>（{opBranch}）
                <br />
                <button onClick={() => setConfirm({
                  message: `確定建立新玩家「${sRes.id}」（${opBranch}）？\n建立後將可進行點數操作。`,
                  onConfirm: () => { setConfirm(null); createPlayer(sRes.id) },
                })} style={{ marginTop: 8, padding: '5px 14px', borderRadius: 6, border: 'none', background: C.neon, color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: '0.85em' }}>
                  ➕ 建立新玩家
                </button>
              </Feedback>
            : sRes.t === 'created' ? <Feedback type="ok">✅ 已建立玩家 <strong>{sRes.id}</strong>（{opBranch}）</Feedback>
            : <>
                <Feedback type="info">
                  <div style={{ fontSize: '0.82em', color: C.gray, textAlign: 'center', marginBottom: 4 }}>
                    {sRes.id}　<span style={{ color: C.neon }}>{opBranch}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 8 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '3.2em', fontWeight: 900, color: C.neon, lineHeight: 1 }}>{sRes.p.scratchCardChances}</div>
                      <div style={{ color: C.gray, fontSize: '0.76em', marginTop: 4 }}>抽獎次數</div>
                    </div>
                    <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '3.2em', fontWeight: 900, color: C.gold, lineHeight: 1 }}>{sRes.p.totalPoints}</div>
                      <div style={{ color: C.gray, fontSize: '0.76em', marginTop: 4 }}>累積點數</div>
                    </div>
                  </div>
                </Feedback>

                {/* 操作區 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <FSelect value={pAction} onChange={e => setPAction(e.target.value)} style={{ flex: 1 }}>
                    <option value="add">＋ 手動加點</option>
                    <option value="addChance">＋ 手動加抽獎次數</option>
                    <option value="deduct">－ 手動扣除抽獎次數</option>
                  </FSelect>
                  <FInput type="number" value={pAmt} onChange={e => setPAmt(e.target.value)} placeholder="數值" min="1" style={{ width: 80 }} />
                </div>
                <Btn variant="neon" disabled={updateLoading} onClick={() => setConfirm({
                  message: `確定對玩家「${sId.trim()}」（${opBranch}）執行\n${pAction === 'add' ? `手動加 ${pAmt} 點` : pAction === 'addChance' ? `手動加 ${pAmt} 次抽獎次數` : `扣除 ${pAmt} 次抽獎次數`}？\n此操作將直接修改玩家資料。`,
                  onConfirm: () => { setConfirm(null); updatePoints() },
                })} style={{ marginTop: 10, width: '100%', opacity: updateLoading ? 0.6 : 1 }}>{updateLoading ? '執行中…' : '確認執行'}</Btn>
                {pRes && (
                  pRes.t === 'err'
                    ? <Feedback type="err">{pRes.msg}</Feedback>
                    : <Feedback type="ok">✅ {pRes.op === 'add' ? `加 ${pRes.amt} 點` : pRes.op === 'addChance' ? `加 ${pRes.amt} 次抽獎次數` : `扣除 ${pRes.amt} 次抽獎次數`}</Feedback>
                )}
              </>
          )}
        </Panel>

        {/* 2. 即時統計（移至此處） */}
        <Panel title="即時統計" icon="📊">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['🥇 大獎', grand, C.gold], ['🥈 普獎', regular, C.neon], ['👥 總參與', total, '#7fb3ff'], ['❌ 未中獎', none, C.gray]].map(([l, n, c]) => (
              <div key={l} style={{ padding: '16px', borderRadius: 10, textAlign: 'center', background: '#151f16', border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: '2.4em', fontWeight: 900, lineHeight: 1, color: c }}>{n}</div>
                <div style={{ fontSize: '0.76em', color: C.gray, marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(184,115,51,0.08)', border: `1px solid rgba(201,168,64,0.25)` }}>
              <div style={{ fontSize: '0.74em', color: C.gray, letterSpacing: 2, textTransform: 'uppercase' }}>🥇 大獎每人可分</div>
              <div style={{ fontSize: '2em', fontWeight: 900, color: C.gold, lineHeight: 1, marginTop: 4 }}>{grandPerPerson}</div>
              <div style={{ fontSize: '0.76em', color: C.gray, marginTop: 6, lineHeight: 1.6 }}>{grandPerNote}</div>
            </div>
            <div style={{ padding: '16px', borderRadius: 10, background: '#0e2218', border: `1px solid rgba(0,255,179,0.2)` }}>
              <div style={{ fontSize: '0.74em', color: C.gray, letterSpacing: 2, textTransform: 'uppercase' }}>🥈 普獎每人可分</div>
              <div style={{ fontSize: '2em', fontWeight: 900, color: C.neon, lineHeight: 1, marginTop: 4 }}>{perPerson}</div>
              <div style={{ fontSize: '0.76em', color: C.gray, marginTop: 6, lineHeight: 1.6 }}>{perNote}</div>
            </div>
          </div>
          <Btn variant="ghost" onClick={() => setConfirm({
            message: '手動執行計分將處理所有未計算的 POS 紀錄並更新玩家點數。\n\n請確認目前 POS 資料已上傳完整再執行。',
            onConfirm: () => { setConfirm(null); triggerCalc() },
          })} disabled={calcLoading} style={{ width: '100%', opacity: calcLoading ? 0.6 : 1 }}>
            {calcLoading ? '計算中…' : '⚡ 手動執行計分'}
          </Btn>
          {calcRes && <Feedback type={calcRes.t}>{calcRes.msg}</Feedback>}
        </Panel>

        {/* 3. 兌獎登記 */}
        <Panel title="兌獎登記" icon="🎴" span2>
          {/* Player ID */}
          <FLabel>玩家 ID</FLabel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <FInput value={prId} onChange={e => { setPrId(e.target.value); setPrMode(''); setPrRes(null) }} placeholder="輸入玩家 ID" style={{ flex: 1 }} />
          </div>

          {/* Mode selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            <button onClick={() => {
              if (!prId.trim()) { setPrRes({ t: 'err', msg: '請輸入玩家 ID' }); return }
              setConfirm({
                message: `確定將玩家「${prId.trim()}」登記為「未中獎」（${PHASES[phase]}）？`,
                onConfirm: () => { setConfirm(null); submitPrize('無') },
              })
            }} style={{
              padding: '18px', borderRadius: 12, border: `2px solid ${C.border}`,
              background: '#151f16', color: C.gray,
              fontWeight: 900, fontSize: '1.05em', cursor: 'pointer', transition: 'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.gray; e.currentTarget.style.color = C.white }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.gray }}
            >
              ❌ 未中獎<br />
              <span style={{ fontSize: '0.72em', fontWeight: 400, marginTop: 4, display: 'block' }}>快速登記，不需輸入牌型</span>
            </button>
            <button onClick={() => { setPrMode('win'); setPrRes(null) }} style={{
              padding: '18px', borderRadius: 12,
              border: `2px solid ${prMode === 'win' ? C.gold : C.borderGold}`,
              background: prMode === 'win' ? 'rgba(201,168,64,0.12)' : '#151f16',
              color: prMode === 'win' ? C.gold : C.gray,
              fontWeight: 900, fontSize: '1.05em', cursor: 'pointer', transition: 'all 0.15s',
            }}>
              🏆 有中獎<br />
              <span style={{ fontSize: '0.72em', fontWeight: 400, marginTop: 4, display: 'block' }}>輸入手牌並自動判定牌型</span>
            </button>
          </div>

          {/* Win flow */}
          {prMode === 'win' && (
            <div className="win-flow-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>

              {/* Left: hand card picker */}
              <div>
                <FLabel>玩家手牌</FLabel>
                <div style={{ display: 'flex', gap: 10 }}>
                  {handSlots.map((s, i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <CardSlot
                        index={i} label={`手牌 ${i + 1}`}
                        suit={s.suit} rank={s.rank}
                        onSuitChange={v => setHandSlots(prev => prev.map((x, xi) => xi === i ? { ...x, suit: v } : x))}
                        onRankChange={v => setHandSlots(prev => prev.map((x, xi) => xi === i ? { ...x, rank: v } : x))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: community ref + auto eval + result */}
              <div>
                <FLabel>公共牌（{PHASES[phase]}）</FLabel>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {slots.map((s, i) => {
                    const id = s.suit && s.rank ? `${s.suit}_${s.rank}` : null
                    const h  = Math.round(40 * 244.64 / 169.075)
                    return (
                      <div key={i} style={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
                        <svg width={40} height={h} viewBox="0 0 169.075 244.64" style={{ display: 'block' }}>
                          <use href={`/svg-cards.svg#${id || 'back'}`} />
                        </svg>
                      </div>
                    )
                  })}
                </div>

                <FLabel>系統判定</FLabel>
                {handEval ? (
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, marginBottom: 12,
                    background: suggestedResult === '大獎' ? 'rgba(201,168,64,0.15)' : suggestedResult === '普獎' ? 'rgba(0,255,179,0.1)' : 'rgba(120,120,120,0.1)',
                    border: `1px solid ${suggestedResult === '大獎' ? C.borderGold : suggestedResult === '普獎' ? 'rgba(0,255,179,0.3)' : C.border}`,
                  }}>
                    <div style={{ fontSize: '1.5em', fontWeight: 900, color: suggestedResult === '大獎' ? C.gold : suggestedResult === '普獎' ? C.neon : C.gray }}>
                      {handEval.name}
                    </div>
                    <div style={{ fontSize: '0.82em', color: C.gray, marginTop: 4 }}>
                      建議：<strong style={{ color: C.white }}>{suggestedResult}</strong>
                      {suggestedResult === '大獎' && '　🥇 $30,000'}
                      {suggestedResult === '普獎' && '　🥈 均分 $20,000'}
                    </div>
                    {prResult && prResult !== suggestedResult && (
                      <div style={{ fontSize: '0.76em', color: '#ff9090', marginTop: 4 }}>⚠️ 已手動覆蓋為：{prResult}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82em', color: C.gray, marginBottom: 12, padding: '8px 0', lineHeight: 1.7 }}>
                    {holeCardIds.length === 0 ? '← 選擇手牌後自動判定' : communityCardIds.length < 5 ? '⚠️ 公共牌尚未設定完整' : '…'}
                  </div>
                )}

                <FLabel>獎項結果{suggestedResult ? '（可覆蓋）' : ''}</FLabel>
                <FSelect value={prResult} onChange={e => setPrResult(e.target.value)}>
                  <option value="">— 請選擇 —</option>
                  <option value="大獎">🥇 大獎（鐵支以上）$30,000</option>
                  <option value="普獎">🥈 普獎（葫蘆）均分 $20,000</option>
                </FSelect>
                {suggestedResult && !prResult && (
                  <button onClick={() => setPrResult(suggestedResult)} style={{
                    marginTop: 6, padding: '5px 14px', borderRadius: 6,
                    border: `1px solid ${C.borderGold}`, background: 'transparent',
                    color: C.gold, fontSize: '0.8em', cursor: 'pointer', fontWeight: 700,
                  }}>↑ 採用系統建議（{suggestedResult}）</button>
                )}

                <Btn variant="blue" disabled={submitLoading} onClick={() => setConfirm({
                  message: `確定送出玩家「${prId.trim()}」的中獎結果？\n結果：${prResult || '（未選擇）'}\n\n此操作將寫入抽獎紀錄，無法自動復原。`,
                  onConfirm: () => { setConfirm(null); submitPrize() },
                })} style={{ marginTop: 14, width: '100%', opacity: submitLoading ? 0.6 : 1 }}>{submitLoading ? '送出中…' : '送出中獎結果'}</Btn>
              </div>
            </div>
          )}

          {prRes && (
            prRes.t === 'err'
              ? <Feedback type="err">{prRes.msg}</Feedback>
              : <Feedback type="ok">{{ '大獎': '🥇', '普獎': '🥈', '無': '❌ 未中獎' }[prRes.result]} 已記錄　玩家：<strong>{prRes.id}</strong>{prRes.c1 && `　手牌：${prRes.c1} / ${prRes.c2}`}</Feedback>
          )}
        </Panel>

        {/* 4. 公共牌設定 */}
        <Panel title="公共牌設定" icon="🃏" span2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {PHASES.map((p, i) => (
                <button key={i} onClick={() => setCardsPhase(i)} style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontWeight: 900, fontSize: '0.84em', transition: 'all 0.15s',
                  background: cardsPhase === i ? C.gold : 'rgba(201,168,64,0.08)',
                  color: cardsPhase === i ? '#000' : C.gold,
                }}>{p}</button>
              ))}
              {isActive && (
                <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7em', fontWeight: 700, background: C.neon, color: '#000' }}>
                  展示中
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="ghost" disabled={saveLoading} onClick={() => setConfirm({
                message: `確定儲存「${PHASES[cardsPhase]}」的公共牌？\n（不會切換玩家端展示階段）`,
                onConfirm: () => { setConfirm(null); setPwConfirm({ message: `確定儲存「${PHASES[cardsPhase]}」的公共牌？\n（不會切換玩家端展示階段）`, onConfirm: () => { setPwConfirm(null); doSaveCards() } }) },
              })} style={{ fontSize: '0.82em', opacity: saveLoading ? 0.6 : 1 }}>
                {saveLoading ? '儲存中…' : '儲存公共牌'}
              </Btn>
              <Btn variant="gold" disabled={saveLoading} onClick={() => setConfirm({
                message: `確定將玩家端切換至「${PHASES[cardsPhase]}」展示？\n儲存後玩家端將立即切換至此階段。`,
                onConfirm: () => { setConfirm(null); setPwConfirm({ message: `確定將玩家端切換至「${PHASES[cardsPhase]}」展示？\n儲存後玩家端將立即切換至此階段。`, onConfirm: () => { setPwConfirm(null); doActivatePhase() } }) },
              })} style={{ fontSize: '0.82em', opacity: saveLoading ? 0.6 : 1 }}>
                {saveLoading ? '切換中…' : '設為展示'}
              </Btn>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {slots.map((slot, i) => (
              <CardSlot key={i} index={i} suit={slot.suit} rank={slot.rank}
                onSuitChange={v => updateSlot(i, 'suit', v)}
                onRankChange={v => updateSlot(i, 'rank', v)}
              />
            ))}
          </div>
          {cardsRes && <Feedback type={cardsRes.t}>{cardsRes.msg}</Feedback>}
        </Panel>

        {/* 5. 批次撤銷 */}
        <Panel title="批次撤銷 POS 資料" icon="↩️" span2>
          <div style={{ color: C.gray, fontSize: '0.85em', lineHeight: 1.7, marginBottom: 16 }}>
            輸入已上傳的 POS 檔名，系統將撤銷該批次所有點數計算結果，並將玩家點數還原。
          </div>
          <FLabel>POS 檔名</FLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <FInput
              value={rbFile}
              onChange={e => { setRbFile(e.target.value); setRbRes(null) }}
              onKeyDown={e => e.key === 'Enter' && !rbLoading && setConfirm({
                message: `確定撤銷 POS 批次「${rbFile.trim()}」？\n此操作將反向計算所有受影響玩家的點數，無法自動復原。`,
                onConfirm: () => { setConfirm(null); rollbackBatch() },
              })}
              placeholder="例：逢甲_20260301.xlsx"
              style={{ flex: 1 }}
            />
            <Btn variant="red" disabled={rbLoading} onClick={() => {
              if (!rbFile.trim()) { setRbRes({ t: 'err', msg: '請輸入檔名' }); return }
              setConfirm({
                message: `確定撤銷 POS 批次「${rbFile.trim()}」？\n此操作將反向計算所有受影響玩家的點數，無法自動復原。`,
                onConfirm: () => { setConfirm(null); rollbackBatch() },
              })
            }} style={{ whiteSpace: 'nowrap', opacity: rbLoading ? 0.6 : 1 }}>
              {rbLoading ? '撤銷中…' : '執行撤銷'}
            </Btn>
          </div>
          {rbRes && <Feedback type={rbRes.t}>{rbRes.msg}</Feedback>}
        </Panel>

        {/* 6. 抽獎記錄 */}
        <Panel title="抽獎記錄" icon="📋" span2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
            {[
              [fPhase, setFPhase, [['all', '全部階段'], ...PHASES.map(p => [p, p])]],
              [fResult, setFResult, [['all', '全部結果'], ['大獎', '大獎'], ['普獎', '普獎'], ['無', '未中獎']]],
            ].map(([val, setter, opts], i) => (
              <select key={i} value={val} onChange={e => setter(e.target.value)} style={topSelect}>
                {opts.map(([v, l]) => <option key={v} value={v} style={{ background: C.input }}>{l}</option>)}
              </select>
            ))}
            <Btn variant="neon" onClick={exportWinners} style={{ fontSize: '0.82em', whiteSpace: 'nowrap' }}>
              📥 匯出中獎名單
            </Btn>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84em' }}>
              <thead>
                <tr>
                  {['時間', '玩家 ID', '階段', '手牌', '結果'].map(h => (
                    <th key={h} style={{
                      background: '#0d160e', padding: '10px 14px', textAlign: 'left',
                      position: 'sticky', top: 0, color: C.gold,
                      fontSize: '0.76em', letterSpacing: 2, textTransform: 'uppercase',
                      borderBottom: `1px solid ${C.borderGold}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0
                  ? <tr><td colSpan={5} style={{ textAlign: 'center', color: C.gray, padding: 32 }}>暫無記錄</td></tr>
                  : filtered.map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 14px', color: C.gray, fontSize: '0.82em' }}>{r.time}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700 }}>{r.id}</td>
                      <td style={{ padding: '10px 14px', color: C.gray, fontSize: '0.85em' }}>{r.phase}</td>
                      <td style={{ padding: '10px 14px' }}>{r.c1 || '?'} / {r.c2 || '?'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, fontSize: '0.8em', fontWeight: 700, ...resultBadge(r.result) }}>{r.result}</span>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </Panel>

      </div>

      <style>{`
        @media (max-width: 768px) {
          .admin-topbar {
            padding: 10px 16px !important;
          }
          .admin-grid {
            grid-template-columns: 1fr !important;
            padding: 16px 14px 48px !important;
          }
          .admin-grid > div[style*="1 / -1"] {
            grid-column: 1 !important;
          }
          .win-flow-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
