import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const PHASE_LABEL = ['第一階段', '第二階段', '第三階段', '第四階段']

export default function Navbar({ currentPhase = 0, isAdmin = false }) {
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
      padding: scrolled ? '12px clamp(16px,4vw,48px)' : '22px clamp(16px,4vw,48px)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: scrolled ? 'rgba(6,6,6,0.88)' : 'transparent',
      backdropFilter: scrolled ? 'blur(24px)' : 'none',
      borderBottom: scrolled ? '1px solid rgba(201,168,64,0.12)' : '1px solid transparent',
      transition: 'all 0.4s',
    }}>
      {/* Logo */}
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/LOGO.png" alt="THE ONE POKER" style={{ height: 'clamp(56px,10vw,96px)', width: 'auto' }} />
      </Link>


      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isAdmin && (
          <Link to="/" style={{
            padding: '8px 20px', borderRadius: '100px',
            border: '1px solid rgba(201,168,64,0.25)',
            color: 'var(--gold)', fontSize: '0.82em', fontWeight: 700,
          }}>← 玩家頁面</Link>
        )}
        <div style={{
          padding: '8px 20px', borderRadius: '100px',
          background: 'var(--gold)', color: '#000',
          fontWeight: 900, fontSize: '0.80em', letterSpacing: 2,
        }}>{PHASE_LABEL[currentPhase]}</div>
      </div>
    </nav>
  )
}
