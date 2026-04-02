import { useState } from 'react'
import { callFn } from '../lib/firebase'

export default function AdminLogin({ onSuccess }) {
  const [account,  setAccount]  = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!account.trim() || !password.trim()) {
      setError('請輸入帳號與密碼')
      return
    }
    setLoading(true)
    setError('')
    try {
      await callFn('adminLogin')({ account: account.trim(), password })
      localStorage.setItem('adminAuth', 'true')
      onSuccess()
    } catch (err) {
      if (err.code === 'functions/unauthenticated') {
        setError('帳號或密碼錯誤')
      } else {
        console.error(err)
        setError('驗證失敗，請稍後再試')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--black)',
      fontFamily: "'Noto Sans TC', sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#0d1f0f',
        border: '1px solid #c9a84040',
        borderRadius: 12,
        padding: '48px 40px',
        width: '100%',
        maxWidth: 380,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        boxShadow: '0 0 40px #00000080',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 28, color: 'var(--gold)', fontWeight: 900, letterSpacing: 2 }}>
            MONSTER
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 6 }}>
            後台管理系統
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--gray)' }}>帳號</label>
          <input
            type="text"
            value={account}
            onChange={e => setAccount(e.target.value)}
            placeholder="請輸入帳號"
            autoComplete="username"
            style={{
              background: '#060606',
              border: '1px solid #3a3a3a',
              borderRadius: 6,
              color: 'var(--white)',
              padding: '10px 14px',
              fontSize: 15,
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = '#c9a840'}
            onBlur={e => e.target.style.borderColor = '#3a3a3a'}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--gray)' }}>密碼</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="請輸入密碼"
            autoComplete="current-password"
            style={{
              background: '#060606',
              border: '1px solid #3a3a3a',
              borderRadius: 6,
              color: 'var(--white)',
              padding: '10px 14px',
              fontSize: 15,
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = '#c9a840'}
            onBlur={e => e.target.style.borderColor = '#3a3a3a'}
          />
        </div>

        {error && (
          <div style={{
            color: '#e74c3c',
            fontSize: 13,
            textAlign: 'center',
            background: '#e74c3c18',
            border: '1px solid #e74c3c40',
            borderRadius: 6,
            padding: '8px 12px',
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? '#3a3a3a' : 'var(--gold)',
            color: '#060606',
            border: 'none',
            borderRadius: 6,
            padding: '12px',
            fontSize: 15,
            fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: 4,
            transition: 'background 0.2s',
          }}
        >
          {loading ? '驗證中...' : '登入'}
        </button>
      </form>
    </div>
  )
}
