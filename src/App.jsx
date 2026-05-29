import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }       from './context/AuthContext'
import { OnboardingProvider } from './context/OnboardingContext'
import ProtectedRoute         from './components/ProtectedRoute'

import Landing        from './pages/Landing'
import SignUp         from './pages/auth/SignUp'
import SignIn         from './pages/auth/SignIn'
import RoleSelect     from './pages/onboarding/RoleSelect'
import IndustrySelect from './pages/onboarding/IndustrySelect'
import Confirm        from './pages/onboarding/Confirm'
import Dashboard      from './pages/Dashboard'
import Diagnose       from './pages/phases/Diagnose'
import Design         from './pages/phases/Design'
import Engage         from './pages/phases/Engage'
import Embed          from './pages/phases/Embed'
import Evaluate       from './pages/phases/Evaluate'
import AppLayout      from './layouts/AppLayout'

export default function App() {
  return (
    <AuthProvider>
      <OnboardingProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/"             element={<Landing />} />
            <Route path="/auth/signup"  element={<SignUp />} />
            <Route path="/auth/signin"  element={<SignIn />} />

            {/* Onboarding — requires auth */}
            <Route path="/onboarding/role"     element={<ProtectedRoute><RoleSelect /></ProtectedRoute>} />
            <Route path="/onboarding/industry" element={<ProtectedRoute><IndustrySelect /></ProtectedRoute>} />
            <Route path="/onboarding/confirm"  element={<ProtectedRoute><Confirm /></ProtectedRoute>} />

            {/* App — requires auth, wrapped in sidebar layout */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard"       element={<Dashboard />} />
              <Route path="/phases/diagnose" element={<Diagnose />} />
              <Route path="/phases/design"   element={<Design />} />
              <Route path="/phases/engage"   element={<Engage />} />
              <Route path="/phases/embed"    element={<Embed />} />
              <Route path="/phases/evaluate" element={<Evaluate />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </OnboardingProvider>
    </AuthProvider>
  )
}
