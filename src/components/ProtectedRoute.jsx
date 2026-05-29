import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const ONBOARDING_PATHS = ['/onboarding/role', '/onboarding/industry', '/onboarding/confirm']

export default function ProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-3">CHANGEFLOW</p>
          <div className="w-6 h-6 border-2 border-[#1F4E79] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth/signin" replace />
  }

  // If onboarding not done and trying to access app pages, send to onboarding
  const isOnboardingPath = ONBOARDING_PATHS.includes(pathname)
  if (profile && !profile.onboarding_done && !isOnboardingPath) {
    return <Navigate to="/onboarding/role" replace />
  }

  return children
}
