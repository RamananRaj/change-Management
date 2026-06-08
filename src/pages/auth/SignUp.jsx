import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function SignUp() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const [form, setForm]     = useState({ fullName: '', email: '', password: '' })
  const [error, setError]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [invite, setInvite] = useState(null) // { client_name, project_name, ... }

  // If arriving from an invite link, look up its details and prefill the form.
  useEffect(() => {
    if (!inviteToken) return
    localStorage.setItem('cf_pending_invite', inviteToken)
    supabase.rpc('invite_details', { p_token: inviteToken }).then(({ data }) => {
      const inv = Array.isArray(data) ? data[0] : data
      if (inv && inv.status === 'pending') {
        setInvite(inv)
        setForm(f => ({ ...f, email: inv.email ?? '', fullName: inv.full_name ?? f.fullName }))
      }
    })
  }, [inviteToken])

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.auth.signUp({
      email:    form.email,
      password: form.password,
      options: {
        data: { full_name: form.fullName },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Update profile with full name
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ full_name: form.fullName })
        .eq('id', data.user.id)
    }

    // If email confirmation is disabled, we have a session immediately.
    if (data.session) {
      // Invited users are linked + onboarded by accept_invite (run in AuthContext),
      // so send them to the dashboard; everyone else goes through onboarding.
      if (inviteToken) {
        await supabase.rpc('accept_invite', { p_token: inviteToken })
        localStorage.removeItem('cf_pending_invite')
        navigate('/dashboard')
      } else {
        navigate('/onboarding/role')
      }
    } else {
      setSuccess(true)
    }

    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
        <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center max-w-sm">
          <div className="text-3xl mb-3">📬</div>
          <h2 className="font-bold text-slate-800 mb-2">Check your email</h2>
          <p className="text-slate-500 text-sm">
            We sent a confirmation link to <strong>{form.email}</strong>. Click it to activate your account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-12">
      <p className="text-[#1F4E79] font-bold tracking-widest text-sm mb-8">CHANGEFLOW</p>

      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">Create your account</h1>
        <p className="text-slate-500 text-sm text-center mb-8">
          Start your change management journey
        </p>

        {invite && (
          <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/20 rounded-lg px-4 py-3 mb-6 text-sm text-slate-600">
            You've been invited to join <strong className="text-[#1F4E79]">{invite.client_name}</strong>
            {invite.project_name ? <> — <strong>{invite.project_name}</strong></> : null}. Set a password to accept.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full name</label>
            <input
              type="text"
              name="fullName"
              value={form.fullName}
              onChange={handleChange}
              placeholder="Your name"
              required
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              readOnly={!!invite}
              className={`w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79] ${invite ? 'bg-slate-50 text-slate-500' : ''}`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="At least 6 characters"
              required
              minLength={6}
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-[#1F4E79] focus:ring-1 focus:ring-[#1F4E79]"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#E8913A] text-white font-semibold py-3 rounded-lg hover:bg-[#d07e2e] transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{' '}
          <Link to="/auth/signin" className="text-[#1F4E79] font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
