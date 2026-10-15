import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Spinner } from './tw'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, loading, loadError, refreshUser, logout } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Signed in, but who the user is (and which pages they may open) isn't known yet.
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center dark:bg-slate-950">
        {loading || !loadError ? (
          <Spinner />
        ) : (
          <>
            <p className="text-sm font-semibold text-ink">
              Could not load your account. Check that the server is running and try again.
            </p>
            <div className="flex gap-2">
              <Button variant="contained" onClick={() => { refreshUser().catch(() => {}) }}>Try again</Button>
              <Button variant="outlined" color="neutral" onClick={logout}>Log out</Button>
            </div>
          </>
        )}
      </div>
    )
  }
  return children
}
