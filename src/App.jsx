import { Routes, Route, Navigate } from 'react-router-dom'
import PlayerPage from './pages/PlayerPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <Routes>
      <Route path="/"      element={<PlayerPage />} />
      <Route path="/panel-a3f8x7" element={<AdminPage />} />
      <Route path="*"      element={<Navigate to="/" replace />} />
    </Routes>
  )
}
