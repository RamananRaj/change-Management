import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// Handles the whole password-recovery loop in one page:
//  • /auth/reset with a valid recovery link  → Supabase establishes a session and
//    fires PASSWORD_RECOVERY; we show a "set a new password" form.
//  • /auth/reset with an expired/invalid link → the URL hash carries
//    error_code=otp_expired; we show a friendly notice + "send a new link".
//  • /auth/reset opened directly              → we show the "request a link" form.
export default function ResetPassword() {
  const navigate = useNavigate()
  // 'request' = ask for email · 'recovering' = set new password · 'expired' = link dead
  const [mode, setMode]         = useState('request')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)
  const [busy, setBusy]         = useState(false)

  useEffect(() => {
    // 1. Expired / invalid link — Supabase puts the error in the URL hash.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (hash.get('error')) {
      setMode('expired')
      setError(hash.get('error_description')?.replace(/\+/g, ' ') || 'This link is invalid or has expired.')
      return
    }
    // 2. A valid recovery link fires PASSWORD_RECOVERY once the token is parsed.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovering')
    })
    // 3. Fallback: token may already have been consumed into a session before we subscribed.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && window.location.hash.includes('type=recovery')) setMode('recovering')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function sendLink(e) {
    e?.preventDefault()
    if (!email.trim()) { setError('Enter your email address.'); return }
    setBusy(true); setError(null); setNotice(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset`,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNotice('Check your email for a fresh reset link, then click it within the hour.')
  }

  async function setNewPassword(e) {
    e.preventDefault()
    if (password.length < 6)     { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm)    { setError('Passwords do not match.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNotice('Password updated. Redirecting you to sign in…')
    setTimeout(() => navigate('/auth/signin'), 1400)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>

      <div className="w-full max-w-sm">
        {mode === 'recovering' ? (
          <>
            <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">Set a new password</h1>
            <p className="text-slate-500 text-sm text-center mb-8">Choose a new password for your account.</p>
            <form onSubmit={setNewPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">New password</label>
                <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(null) }}
                  placeholder="At least 6 characters" required
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirm password</label>
                <input type="password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(null) }}
                  placeholder="Re-enter password" required
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]" />
              </div>
              {error  && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}
              {notice && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">{notice}</div>}
              <button type="submit" disabled={busy}
                className="w-full bg-[#E8913A] text-white font-semibold py-3 rounded-lg hover:bg-[#d07e2e] transition-colors text-sm disabled:opacity-60">
                {busy ? 'Saving…' : 'Update password'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">
              {mode === 'expired' ? 'Link expired' : 'Reset your password'}
            </h1>
            <p className="text-slate-500 text-sm text-center mb-8">
              {mode === 'expired'
                ? 'That reset link is invalid or has expired. Enter your email and we’ll send a fresh one.'
                : 'Enter your email and we’ll send you a link to set a new password.'}
            </p>
            <form onSubmit={sendLink} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null) }}
                  placeholder="you@example.com" required
                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]" />
              </div>
              {error  && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>}
              {notice && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">{notice}</div>}
              <button type="submit" disabled={busy}
                className="w-full bg-[#E8913A] text-white font-semibold py-3 rounded-lg hover:bg-[#d07e2e] transition-colors text-sm disabled:opacity-60">
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <p className="text-center text-sm text-slate-500 mt-6">
          <Link to="/auth/signin" className="text-[#1F4E79] font-semibold hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
