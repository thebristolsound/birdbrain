// Mount point only. The popup itself lives in PopupApp.tsx so it can be
// rendered by a test without a #root element and without pulling in the
// Tailwind entry. (Named PopupApp, not Popup: TypeScript refuses two files in
// one directory differing from popup.tsx only in casing.)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Popup } from '@extension/popup/PopupApp'
import './popup.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
