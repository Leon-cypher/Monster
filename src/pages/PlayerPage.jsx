import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import ParticlesBg from '../components/ParticlesBg'
import Navbar from '../components/Navbar'
import { db, callFn } from '../lib/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'

gsap.registerPlugin(ScrollTrigger)

const CARD_W = 100
const CARD_H = Math.round(CARD_W * 244.64 / 169.075)

const BRANCHES = ['逢甲店', '北屯店']

const TX_LABEL = {
  EARN_POINTS:   { label: '消費加點', color: 'var(--neon)' },
  REDEEM_CARD:   { label: '兌換抽牌', color: 'var(--gold)' },
  ADMIN_DEDUCT:  { label: '後台扣除', color: '#ff9090' },
  MANUAL_ADJUST: { label: '手動調整', color: 'var(--gray)' },
  ROLLED_BACK:   { label: '已撤銷',   color: '#777' },
}

const TABS = ['點數查詢', '活動說明', '開獎時程']

/* ─── Point query ─── */
function PointQuery() {
  const [id, setId]         = useState('')
  const [branch, setBranch] = useState('逢甲店')
  const [result, setResult] = useState(null)
  const [showAll, setShowAll] = useState(false)

  async function doQuery() {
    if (!id.trim()) { setResult({ type: 'err', msg: '⚠️ 請輸入玩家 ID' }); return }
    setResult({ type: 'loading' })
    setShowAll(false)
    try {
      const res = await callFn('getUserPoints')({ playerId: id.trim(), branchId: branch })
      const { player, transactions } = res.data.data
      setResult({ type: 'ok', id: id.trim(), branch, player, transactions })
    } catch (e) {
      const msg = e.code === 'functions/invalid-argument' ? '⚠️ 找不到此玩家 ID' : '⚠️ 查詢失敗，請稍後再試'
      setResult({ type: 'err', msg })
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
        {BRANCHES.map(b => (
          <button key={b} onClick={() => setBranch(b)} style={{
            padding: '8px 28px', borderRadius: '100px', border: 'none',
            fontWeight: 700, fontSize: '0.88em', cursor: 'pointer', transition: 'all 0.2s',
            background: branch === b ? 'var(--gold)' : 'rgba(201,168,64,0.1)',
            color: branch === b ? '#000' : 'var(--gold)',
          }}>{b}</button>
        ))}
      </div>

      <div className="query-row" style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          value={id} onChange={e => setId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doQuery()}
          placeholder="輸入玩家 ID"
          style={{
            flex: 1, minWidth: 0, padding: '16px 22px', borderRadius: '100px',
            border: '1px solid rgba(201,168,64,0.3)',
            background: 'rgba(255,255,255,0.03)', color: 'var(--white)',
            fontSize: '0.95em', outline: 'none', letterSpacing: 1,
          }}
        />
        <button onClick={doQuery} className="query-btn" style={{
          padding: '16px 28px', borderRadius: '100px',
          background: 'var(--gold)', color: '#000',
          border: 'none', fontWeight: 900, fontSize: '0.95em',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>查詢</button>
      </div>

      {result && (
        <div style={{
          padding: '26px 28px', borderRadius: 20,
          background: result.type === 'err' ? 'rgba(40,5,5,0.8)' : 'rgba(13,31,15,0.95)',
          border: `1px solid ${result.type === 'err' ? 'rgba(231,76,60,0.3)' : 'rgba(0,255,179,0.2)'}`,
        }}>
          {result.type === 'err' && (
            <div style={{ textAlign: 'center', color: '#ff8a8a' }}>{result.msg}</div>
          )}
          {result.type === 'loading' && (
            <div style={{ textAlign: 'center', color: 'var(--gray)', letterSpacing: 2 }}>查詢中…</div>
          )}
          {result.type === 'ok' && <>
            <div style={{ fontSize: '0.82em', color: 'var(--gray)', textAlign: 'center', marginBottom: 4 }}>
              {result.player.playerName}　{result.branch}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '4em', fontWeight: 900, color: 'var(--neon)', lineHeight: 1 }}>
                  {result.player.scratchCardChances}
                </div>
                <div style={{ color: 'var(--gray)', fontSize: '0.82em', marginTop: 4 }}>抽獎次數</div>
              </div>
              <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '4em', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>
                  {result.player.totalPoints}
                </div>
                <div style={{ color: 'var(--gray)', fontSize: '0.82em', marginTop: 4 }}>累積點數</div>
              </div>
            </div>

            {result.transactions.length > 0 && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '0.75em', letterSpacing: 3, color: 'var(--gray)', textTransform: 'uppercase', marginBottom: 10 }}>
                  點數異動紀錄
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {result.transactions.slice(0, showAll ? undefined : 5).map((tx, i) => {
                    const meta = TX_LABEL[tx.type] || { label: tx.type, color: 'var(--gray)' }
                    const time = tx.checkoutTime ? new Date(tx.checkoutTime).toLocaleDateString('zh-TW') : '—'
                    return (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        padding: '8px 14px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                      }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: '0.8em', fontWeight: 700, color: meta.color }}>{meta.label}</span>
                          <span style={{ fontSize: '0.75em', color: 'var(--gray)', marginLeft: 8, wordBreak: 'break-all' }}>{tx.description}</span>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {tx.pointsChanged !== 0 && (
                            <div style={{ fontSize: '0.85em', fontWeight: 700, color: tx.pointsChanged > 0 ? 'var(--neon)' : '#ff9090' }}>
                              {tx.pointsChanged > 0 ? '+' : ''}{tx.pointsChanged} pt
                            </div>
                          )}
                          <div style={{ fontSize: '0.72em', color: 'var(--gray)' }}>{time}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {!showAll && result.transactions.length > 5 && (
                  <button onClick={() => setShowAll(true)} style={{
                    marginTop: 8, padding: '8px 0', width: '100%', borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
                    color: 'var(--gray)', fontSize: '0.8em', cursor: 'pointer', letterSpacing: 1,
                  }}>顯示全部（共 {result.transactions.length} 筆）</button>
                )}
              </div>
            )}
          </>}
        </div>
      )}
    </div>
  )
}

/* ─── 活動說明 tab ─── */
function ActivityInfo() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* 集點規則 */}
      <h3 style={{ fontSize: '1.1em', letterSpacing: 4, color: 'var(--neon)', textTransform: 'uppercase', marginBottom: 20 }}>集點規則</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 16 }}>
        {[['$1,200','1 點'],['$3,400','2 點'],['$6,600','3 點'],['$11,000+','5 點']].map(([buy, pts]) => (
          <div key={buy} style={{
            padding: '22px 20px', borderRadius: 18, textAlign: 'center',
            border: '1px solid rgba(201,168,64,0.15)', background: 'rgba(0,0,0,0.3)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,var(--gold),transparent)' }} />
            <div style={{ fontSize: '1.5em', fontWeight: 900, color: 'var(--white)' }}>{buy}</div>
            <div style={{ fontSize: '1.6em', fontWeight: 900, color: 'var(--gold)', marginTop: 4 }}>{pts}</div>
          </div>
        ))}
      </div>
      <div className="redeem-bar" style={{
        padding: 'clamp(16px,3vw,20px) clamp(18px,4vw,28px)', borderRadius: 16, marginBottom: 44,
        background: 'rgba(0,255,179,0.04)', border: '1px solid rgba(0,255,179,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ fontSize: '1em', fontWeight: 700 }}>集滿 <span style={{ color: 'var(--neon)' }}>10 點</span> 至櫃台兌換</div>
        <div style={{ fontSize: 'clamp(1.2em,4vw,1.6em)', fontWeight: 900, color: 'var(--neon)' }}>
          一次抽 2 張手牌&nbsp;
          <span style={{ letterSpacing: 2, color: 'var(--gold)' }}>♠ ♥ ♦ ♣</span>
        </div>
      </div>

      {/* 抽獎方式 */}
      <h3 style={{ fontSize: '1.1em', letterSpacing: 4, color: 'var(--neon)', textTransform: 'uppercase', marginBottom: 20 }}>抽獎方式</h3>
      <div style={{
        padding: '24px 28px', borderRadius: 18, marginBottom: 44,
        background: 'rgba(13,31,15,0.6)', border: '1px solid rgba(255,255,255,0.06)',
        lineHeight: 2.1, fontSize: '0.92em', color: 'var(--gray)',
      }}>
        <div>・活動共分 <strong style={{ color: 'var(--white)' }}>4 個階段</strong>，每階段持續 <strong style={{ color: 'var(--white)' }}>15 天</strong></div>
        <div>・每階段開 <strong style={{ color: 'var(--white)' }}>5 張公共牌</strong>，展示於網站及櫃台</div>
        <div>・以抽中的 <strong style={{ color: 'var(--white)' }}>2 張手牌</strong> 與 <strong style={{ color: 'var(--white)' }}>3 張公共牌</strong> 組成 <strong style={{ color: 'var(--gold)' }}>葫蘆以上</strong> 牌型即可獲獎</div>
        <div>・大樂透當日賽事不計分</div>
      </div>

      {/* 獎品說明 */}
      <h3 style={{ fontSize: '1.1em', letterSpacing: 4, color: 'var(--neon)', textTransform: 'uppercase', marginBottom: 20 }}>獎品說明</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
        {[
          {
            icon: (
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <path d="M24 6L8 18l4 18h24l4-18z" fill="rgba(201,168,64,0.15)" stroke="#c9a840" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M8 18l7 4M40 18l-7 4M24 6l-5 16M24 6l5 16" stroke="#c9a840" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M16 36h16" stroke="#c9a840" strokeWidth="1.5" strokeLinecap="round"/>
                <rect x="14" y="39" width="20" height="3.5" rx="1.75" fill="#c9a840" opacity="0.7"/>
                <circle cx="8" cy="18" r="2.5" fill="#c9a840"/>
                <circle cx="40" cy="18" r="2.5" fill="#c9a840"/>
                <circle cx="24" cy="6" r="2.5" fill="#c9a840"/>
              </svg>
            ),
            type: 'Grand Prize', name: '大獎 — 鐵支以上',
            amt: '$30,000', amtColor: 'var(--gold)',
            bg: 'linear-gradient(145deg,rgba(184,115,51,0.18),rgba(201,168,64,0.06))',
            border: 'rgba(201,168,64,0.25)',
            cond: '擊中鐵支（Four of a Kind）以上牌型 ✦ 均分獎金，保底每人 $500 ✦ 無人中獎累積至下期',
          },
          {
            icon: (
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <path d="M24 42L6 18l6-8h24l6 8z" fill="rgba(0,255,179,0.10)" stroke="#00ffb3" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M6 18h36" stroke="#00ffb3" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M12 10l6 8M36 10l-6 8M24 10v8" stroke="#00ffb3" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M6 18l18 24M42 18L24 42" stroke="#00ffb3" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
              </svg>
            ),
            type: 'Regular Prize', name: '普獎 — 葫蘆',
            amt: '$20,000', amtColor: 'var(--neon)',
            bg: 'linear-gradient(145deg,rgba(0,255,179,0.06),rgba(0,80,60,0.14))',
            border: 'rgba(0,255,179,0.18)',
            cond: '擊中葫蘆（Full House）✦ 均分獎金，保底每人 $500 ✦ 超過 40 人改發現金+點數 ✦ 無人中獎累積至下期',
          },
        ].map(p => (
          <div key={p.name} style={{
            padding: 'clamp(24px,4vw,36px) clamp(20px,4vw,32px)', borderRadius: 26, position: 'relative', overflow: 'hidden',
            background: p.bg, border: `1px solid ${p.border}`,
          }}>
            <div style={{ marginBottom: 16 }}>{p.icon}</div>
            <div style={{ fontSize: '0.72em', letterSpacing: 4, color: 'var(--gray)', textTransform: 'uppercase', marginBottom: 6 }}>{p.type}</div>
            <div style={{ fontSize: '1.2em', fontWeight: 700, marginBottom: 14 }}>{p.name}</div>
            <div style={{ fontSize: '2.8em', fontWeight: 900, lineHeight: 1, color: p.amtColor }}>{p.amt}</div>
            <div style={{ marginTop: 16, fontSize: '0.82em', color: 'var(--gray)', lineHeight: 1.9 }}>{p.cond}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── 開獎時程 tab ─── */
function Schedule({ activePhaseIndex = -1 }) {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { n: 'Phase 01', date: '4 / 1 — 4 / 16' },
          { n: 'Phase 02', date: '4 / 17 — 5 / 1' },
          { n: 'Phase 03', date: '5 / 2 — 5 / 16' },
          { n: 'Phase 04', date: '5 / 17 — 5 / 31' },
        ].map((ph, i) => {
          const active = i === activePhaseIndex
          return (
            <div key={ph.n} style={{
              padding: 'clamp(16px,3vw,26px)', borderRadius: 20, position: 'relative', overflow: 'hidden',
              border: `1px solid ${active ? 'rgba(0,255,179,0.3)' : 'rgba(255,255,255,0.07)'}`,
              background: active ? 'rgba(0,255,179,0.05)' : 'rgba(255,255,255,0.02)',
            }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: active ? 'var(--neon)' : 'var(--gray2)', borderRadius: '0 3px 3px 0' }} />
              <div style={{ fontSize: '0.72em', letterSpacing: 4, color: 'var(--gray)', textTransform: 'uppercase', marginBottom: 8 }}>{ph.n}</div>
              <div style={{ fontSize: '1.35em', fontWeight: 700, color: active ? 'var(--neon)' : 'var(--white)' }}>{ph.date}</div>
              {active && (
                <div style={{
                  position: 'absolute', top: 16, right: 16,
                  padding: '3px 12px', borderRadius: '100px',
                  fontSize: '0.72em', fontWeight: 700, background: 'var(--neon)', color: '#000',
                }}>進行中</div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: '0.82em', color: 'var(--gray)', letterSpacing: 1, lineHeight: 1.9 }}>
        ＊大樂透當日賽事不計分<br />
        ＊每期公共牌於階段第一天公布於網站及櫃台
      </div>
    </div>
  )
}

/* ─── Main Page ─── */
export default function PlayerPage() {
  const eyebrowRef = useRef(null)
  const w1Ref      = useRef(null)
  const w2Ref      = useRef(null)
  const subRef     = useRef(null)
  const badgesRef  = useRef(null)
  const cueRef     = useRef(null)
  const tabsRef    = useRef(null)

  const [activeTab, setActiveTab] = useState('點數查詢')

  /* ─── Community cards ─── */
  const [communityCards, setCommunityCards]     = useState(Array(5).fill(null))
  const [activePhaseLabel, setActivePhaseLabel] = useState('')
  const [activePhaseIndex, setActivePhaseIndex] = useState(-1)
  const [winnerCounts, setWinnerCounts]         = useState({ grand: 0, regular: 0 })
  const [flippedCards, setFlippedCards]         = useState(Array(5).fill(false))
  const communityCardsRef = useRef(null)
  const cardInnerRefs     = useRef([])

  useEffect(() => {
    const q = query(collection(db, 'phases'), where('active', '==', true))
    return onSnapshot(q, snap => {
      if (snap.empty) {
        setCommunityCards(Array(5).fill(null))
        setActivePhaseLabel('')
        setActivePhaseIndex(-1)
      } else {
        const docSnap = snap.docs[0]
        const data = docSnap.data()
        setCommunityCards(Array(5).fill(null).map((_, i) => (data.cards || [])[i] || null))
        setActivePhaseLabel(data.label || '')
        setActivePhaseIndex(parseInt(docSnap.id) - 1)
        setWinnerCounts({
          grand:   data.stats?.grand   || 0,
          regular: data.stats?.regular || 0,
        })
      }
    })
  }, [])

  /* ─── Prize per person ─── */
  const grandPer = winnerCounts.grand > 0
    ? `$${Math.max(Math.round(30000 / winnerCounts.grand), 500).toLocaleString()}`
    : null
  const regularPer = winnerCounts.regular > 0
    ? winnerCounts.regular > 40
      ? '改發現金+點數'
      : `$${Math.max(Math.round(20000 / winnerCounts.regular), 500).toLocaleString()}`
    : null

  /* ─── Card flip animation ─── */
  useEffect(() => {
    const container = communityCardsRef.current
    if (!container) return
    const inners = container.querySelectorAll('.card-inner')
    if (!inners.length) return
    // 先全部設為背面
    setFlippedCards(Array(5).fill(true))
    gsap.set(inners, { rotateY: 180 })
    // 依序自動翻開
    inners.forEach((el, i) => {
      gsap.to(el, { rotateY: 0, duration: 0.55, ease: 'power3.inOut', delay: 0.6 + i * 0.18 })
    })
    setFlippedCards(Array(5).fill(false))
  }, [communityCards])

  function toggleCard(i) {
    const el = cardInnerRefs.current[i]
    if (!el) return
    setFlippedCards(prev => {
      const next = [...prev]
      next[i] = !next[i]
      gsap.to(el, { rotateY: next[i] ? 180 : 0, duration: 0.55, ease: 'power3.inOut' })
      return next
    })
  }

  /* ─── Hero animations ─── */
  useEffect(() => {
    const tl = gsap.timeline({ delay: 0.4 })
    tl.to(eyebrowRef.current, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' })
      .to(w1Ref.current, { translateY: '0%', duration: 1.1, ease: 'expo.out' }, 0.25)
      .to(w2Ref.current, { translateY: '0%', duration: 1.1, ease: 'expo.out' }, 0.43)
      .to(subRef.current,    { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 0.85)
      .to(badgesRef.current, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 1.05)
      .to(cueRef.current,    { opacity: 1, duration: 0.6 }, 1.3)

    ScrollTrigger.create({
      start: '200px top',
      onEnter: () => gsap.to(cueRef.current, { opacity: 0, y: 10, duration: 0.5 }),
    })
    return () => ScrollTrigger.getAll().forEach(t => t.kill())
  }, [])

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <ParticlesBg />
      <Navbar currentPhase={activePhaseIndex >= 0 ? activePhaseIndex : 0} />

      {/* ── HERO ── */}
      <section id="hero" style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '120px 32px 120px',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 280,
          background: 'linear-gradient(transparent,var(--green))', pointerEvents: 'none',
        }} />

        <div ref={eyebrowRef} style={{ fontSize: '0.72em', letterSpacing: 7, textTransform: 'uppercase', color: 'var(--neon)', marginBottom: 24, opacity: 0, transform: 'translateY(20px)' }}>
          4 / 1 &nbsp;—&nbsp; 5 / 31
        </div>

        <h1 style={{ fontWeight: 900, lineHeight: 0.88, letterSpacing: -3, fontSize: 'clamp(5.5em,17vw,16em)', fontFamily: "'Noto Serif TC', serif" }}>
          <span style={{ display: 'block', overflow: 'hidden' }}>
            <span ref={w1Ref} style={{ display: 'block', transform: 'translateY(110%)', color: 'var(--white)' }}>中牌</span>
          </span>
          <span style={{ display: 'block', overflow: 'hidden' }}>
            <span ref={w2Ref} style={{
              display: 'block', transform: 'translateY(110%)',
              background: 'linear-gradient(135deg,var(--gold) 0%,var(--bronze) 60%,var(--gold) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>怪物</span>
          </span>
        </h1>

        <p ref={subRef} style={{ fontSize: 'clamp(0.95em,2.5vw,1.6em)', letterSpacing: 'clamp(4px,2.5vw,14px)', color: 'var(--gray)', marginTop: 28, opacity: 0, transform: 'translateY(20px)', fontFamily: "'Noto Serif TC', serif" }}>
          巔 峰 集 結 令
        </p>

        <div ref={badgesRef} style={{ marginTop: 36, opacity: 0, textAlign: 'center' }}>
          <div style={{ fontSize: 'clamp(2.4em,8vw,4.5em)', fontWeight: 900, color: 'var(--neon)', lineHeight: 1, letterSpacing: 2 }}>
            $200,000
          </div>
          <div style={{ fontSize: '0.82em', letterSpacing: 6, color: 'var(--gray)', marginTop: 8, textTransform: 'uppercase' }}>
            總 獎 池
          </div>
        </div>

        <div ref={cueRef} style={{ position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)', opacity: 0, textAlign: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: '0.7em', letterSpacing: 5, color: 'var(--gray)', display: 'block', marginBottom: 8 }}>SCROLL</span>
          <div style={{ width: 1, height: 64, background: 'linear-gradient(var(--gold),transparent)', margin: '0 auto', animation: 'sline 2.2s ease-in-out infinite' }} />
        </div>
      </section>

      {/* ── COMMUNITY CARDS ── */}
      <section id="community" style={{ background: 'var(--green)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(48px,8vw,80px) clamp(16px,5vw,44px)' }}>
          <p style={{ fontSize: '0.72em', letterSpacing: 7, textTransform: 'uppercase', color: 'var(--neon)', marginBottom: 14 }}>Community Cards</p>
          <h2 style={{ fontSize: 'clamp(2.4em,6vw,5em)', fontWeight: 900, lineHeight: 1, marginBottom: 16 }}>
            本期 <span style={{ color: 'var(--gold)' }}>公 共 牌</span>
          </h2>
          <div style={{ width: 80, height: 2, background: 'linear-gradient(90deg,var(--gold),transparent)', marginBottom: 44 }} />

          {activePhaseLabel && (
            <p style={{ color: 'var(--neon)', letterSpacing: 3, marginBottom: 36, fontSize: '0.88em', textAlign: 'center' }}>
              {activePhaseLabel}
            </p>
          )}

          <div ref={communityCardsRef} style={{
            display: 'flex', alignItems: 'stretch',
            gap: 'clamp(6px,1.8vw,20px)', flexWrap: 'nowrap',
          }}>
            {communityCards.map((cardId, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, perspective: '700px' }}
                onClick={() => toggleCard(i)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.transition = 'transform 0.2s' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                <div className="card-inner" ref={el => cardInnerRefs.current[i] = el} style={{
                  width: '100%', aspectRatio: '169.075 / 244.64',
                  position: 'relative', transformStyle: 'preserve-3d',
                  cursor: 'pointer',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0,
                    backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                    borderRadius: 'clamp(4px,1vw,9px)', overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                  }}>
                    <svg width="100%" height="100%" viewBox="0 0 169.075 244.64" style={{ display: 'block' }}>
                      <use href={`/svg-cards.svg#${cardId || 'back'}`} />
                    </svg>
                  </div>
                  <div style={{
                    position: 'absolute', inset: 0,
                    backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    borderRadius: 'clamp(4px,1vw,9px)', overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                  }}>
                    <svg width="100%" height="100%" viewBox="0 0 169.075 244.64" style={{ display: 'block' }}>
                      <use href="/svg-cards.svg#back" />
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', color: 'var(--gray)', fontSize: '0.72em', marginTop: 14, letterSpacing: 3, opacity: 0.6 }}>
            TAP TO FLIP
          </p>

          <p style={{ textAlign: 'center', color: 'var(--gray)', fontSize: '0.82em', marginTop: 16, letterSpacing: 1, lineHeight: 1.8 }}>
            以 2 張手牌與 3 張公共牌，組成 <strong style={{ color: 'var(--white)' }}>葫蘆以上</strong> 即可獲獎
          </p>

          {/* Winner counts */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 32 }}>
            {[
              { label: '大獎', icon: '🥇', count: winnerCounts.grand,   color: 'var(--gold)',  bg: 'rgba(201,168,64,0.08)',  border: 'rgba(201,168,64,0.25)', per: grandPer },
              { label: '普獎', icon: '🥈', count: winnerCounts.regular, color: 'var(--neon)',  bg: 'rgba(0,255,179,0.06)',   border: 'rgba(0,255,179,0.2)',  per: regularPer },
            ].map(({ label, icon, count, color, bg, border, per }) => (
              <div key={label} style={{
                flex: 1, maxWidth: 220,
                padding: 'clamp(14px,3vw,20px) clamp(16px,4vw,40px)', borderRadius: 16,
                background: bg, border: `1px solid ${border}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '0.72em', letterSpacing: 3, color: 'var(--gray)', textTransform: 'uppercase', marginBottom: 8 }}>{icon} {label}</div>
                <div style={{ fontSize: '2.2em', fontWeight: 900, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: '0.7em', color: 'var(--gray)', marginTop: 6, letterSpacing: 1 }}>本期中獎人數</div>
                {per && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                    <div style={{ fontSize: '0.65em', color: 'var(--gray)', letterSpacing: 1, marginBottom: 2 }}>每人可分</div>
                    <div style={{ fontSize: '1.1em', fontWeight: 900, color }}>{per}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* gradient transition to tabs */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
          background: 'linear-gradient(transparent, var(--black))', pointerEvents: 'none',
        }} />
      </section>

      {/* ── TABS ── */}
      <div ref={tabsRef} style={{ background: 'var(--black)', minHeight: '60vh' }}>

        {/* Tab bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'rgba(6,6,6,0.92)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{
            maxWidth: 900, margin: '0 auto',
            display: 'flex', padding: '0 24px',
          }}>
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, padding: '18px 8px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '0.92em', fontWeight: 700, letterSpacing: 1,
                color: activeTab === tab ? 'var(--gold)' : 'var(--gray)',
                borderBottom: `2px solid ${activeTab === tab ? 'var(--gold)' : 'transparent'}`,
                transition: 'all 0.2s',
                marginBottom: '-1px',
              }}>{tab}</button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(28px,5vw,56px) clamp(16px,3vw,24px) clamp(48px,8vw,80px)' }}>
          {activeTab === '點數查詢' && <PointQuery />}
          {activeTab === '活動說明' && <ActivityInfo />}
          {activeTab === '開獎時程' && <Schedule activePhaseIndex={activePhaseIndex} />}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{ background: 'var(--black)', padding: '44px clamp(20px,5vw,44px)', textAlign: 'center', position: 'relative', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <img src="/LOGO.png" alt="THE ONE POKER" style={{ height: 72, marginBottom: 14 }} />
        <div style={{ fontSize: '0.85em', color: 'var(--gray)', letterSpacing: 2 }}>巔峰集結令 — 逢甲店 ✕ 北屯店 同步</div>
        <div style={{ fontSize: '0.75em', color: 'var(--gray2)', marginTop: 16 }}>活動期間 4/1 – 5/31 ／ 大樂透當日賽事不計分</div>
      </footer>

      <style>{`
        @keyframes sline { 0%,100%{opacity:1;transform:scaleY(1)} 50%{opacity:.2;transform:scaleY(.3)} }
        a { font-family: inherit; }
        @media (max-width: 480px) {
          .redeem-bar { flex-direction: column; text-align: center; }
          .query-row { flex-wrap: wrap; }
          .query-btn { width: 100%; }
        }
      `}</style>
    </div>
  )
}
