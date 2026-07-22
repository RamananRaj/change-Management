import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }       from './context/AuthContext'
import { OnboardingProvider } from './context/OnboardingContext'
import ProtectedRoute         from './components/ProtectedRoute'

import Landing        from './pages/Landing'
import PublicDemo     from './pages/PublicDemo'
import SignUp         from './pages/auth/SignUp'
import SignIn         from './pages/auth/SignIn'
import ResetPassword  from './pages/auth/ResetPassword'
import RoleSelect     from './pages/onboarding/RoleSelect'
import IndustrySelect from './pages/onboarding/IndustrySelect'
import Confirm        from './pages/onboarding/Confirm'
import Dashboard      from './pages/Dashboard'
import Canvas        from './pages/Canvas'
import Admin         from './pages/Admin'
import ClientAdmin   from './pages/ClientAdmin'
import AdminPreview  from './pages/AdminPreview'
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
            {/* Anonymous CORA demo. Deliberately outside ProtectedRoute — it takes no
                session, and gets its data from the demo-data Edge Function rather than
                the tenant database, so no anonymous read path is opened to serve it. */}
            <Route path="/try"          element={<PublicDemo />} />
            <Route path="/auth/signup"  element={<SignUp />} />
            <Route path="/auth/signin"  element={<SignIn />} />
            <Route path="/auth/reset"   element={<ResetPassword />} />

            {/* Onboarding — requires auth */}
            <Route path="/onboarding/role"     element={<ProtectedRoute><RoleSelect /></ProtectedRoute>} />
            <Route path="/onboarding/industry" element={<ProtectedRoute><IndustrySelect /></ProtectedRoute>} />
            <Route path="/onboarding/confirm"  element={<ProtectedRoute><Confirm /></ProtectedRoute>} />

            {/* App — requires auth, wrapped in sidebar layout */}
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard"       element={<Dashboard />} />
              <Route path="/canvas"          element={<Canvas />} />
              <Route path="/admin"           element={<Admin />} />
              <Route path="/admin/preview"   element={<AdminPreview />} />
              <Route path="/client-admin"    element={<ClientAdmin />} />
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
