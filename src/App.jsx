import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import PlayerPage from './pages/PlayerPage'
import AdminPage from './pages/AdminPage'
import AdminLogin from './pages/AdminLogin'

function AdminGate() {
  const [authed, setAuthed] = useState(
    () => localStorage.getItem('adminAuth') === 'true'
  )
  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />
  return <AdminPage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/"              element={<PlayerPage />} />
      <Route path="/panel-a3f8x7" element={<AdminGate />} />
      <Route path="*"              element={<Navigate to="/" replace />} />
    </Routes>
  )
}
