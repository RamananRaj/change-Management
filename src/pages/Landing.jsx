import { useNavigate } from 'react-router-dom'

const industries = [
  '⚡ Utilities & Energy',
  '📡 Telecommunications',
  '🏦 Financial Services',
  '🏥 Healthcare',
  '🏭 Manufacturing',
  '🏛 Public Sector',
  '🛒 Retail & Consumer',
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Nav */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
        <span className="text-[#1F4E79] font-bold tracking-widest text-lg">CHANGEFLOW</span>
        <button
          onClick={() => navigate('/onboarding/role')}
          className="text-sm text-[#1F4E79] border border-[#1F4E79] rounded-md px-4 py-2 hover:bg-[#1F4E79] hover:text-white transition-colors"
        >
          Get started
        </button>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-8 py-20">
        <div className="inline-block bg-[#1F4E79]/10 text-[#1F4E79] text-xs font-semibold tracking-widest uppercase px-3 py-1 rounded-full mb-6">
          Industry-Specific · Role-Based · AI-Powered
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-[#1F4E79] leading-tight mb-4 max-w-2xl">
          Change management that fits<br />
          <span className="text-[#E8913A]">your industry and your role</span>
        </h1>
        <p className="text-slate-500 text-lg max-w-xl mb-10">
          A guided 5-phase platform for Product Owners, Change Managers, and Project Managers — configured for your sector from day one.
        </p>
        <button
          onClick={() => navigate('/onboarding/role')}
          className="bg-[#E8913A] text-white font-semibold px-8 py-3 rounded-lg hover:bg-[#d07e2e] transition-colors text-base"
        >
          Start your change journey →
        </button>
      </section>

      {/* Industry strip */}
      <section className="bg-slate-50 border-t border-slate-100 px-8 py-6">
        <p className="text-center text-xs text-slate-400 uppercase tracking-widest font-semibold mb-4">Configured for 7 industries</p>
        <div className="flex flex-wrap justify-center gap-3">
          {industries.map(ind => (
            <span key={ind} className="bg-white border border-slate-200 text-slate-600 text-sm px-4 py-2 rounded-full">
              {ind}
            </span>
          ))}
        </div>
      </section>

      {/* Phase strip */}
      <section className="border-t border-slate-100 px-8 py-8">
        <p className="text-center text-xs text-slate-400 uppercase tracking-widest font-semibold mb-6">The 5-phase change journey</p>
        <div className="flex justify-center gap-0 max-w-2xl mx-auto">
          {['01\nDiagnose', '02\nDesign', '03\nEngage', '04\nEmbed', '05\nEvaluate'].map((ph, i) => (
            <div
              key={i}
              className={`flex-1 text-center py-3 border-t-2 ${i === 0 ? 'border-[#1F4E79]' : 'border-slate-200'}`}
            >
              {ph.split('\n').map((line, j) => (
                <p key={j} className={j === 0 ? 'text-xs text-slate-400' : `text-sm font-medium ${i === 0 ? 'text-[#1F4E79]' : 'text-slate-600'}`}>
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
