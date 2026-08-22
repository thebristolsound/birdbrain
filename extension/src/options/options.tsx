// Mount point only. The page itself lives in OptionsApp.tsx so it can be
// rendered by a test without a #root element and without pulling in the Tailwind
// entry. (Named OptionsApp, not Options: TypeScript refuses two files in one
// directory differing from options.tsx only in casing.)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { OptionsPage } from '@extension/options/OptionsApp'
import './options.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>
)
