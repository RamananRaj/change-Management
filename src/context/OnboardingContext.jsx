import { createContext, useContext, useState } from 'react'

const OnboardingContext = createContext(null)

export function OnboardingProvider({ children }) {
  const [role, setRole]         = useState(null)  // 'po' | 'cm' | 'pm'
  const [industry, setIndustry] = useState(null)  // e.g. 'financial-services'

  return (
    <OnboardingContext.Provider value={{ role, setRole, industry, setIndustry }}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  return useContext(OnboardingContext)
}
