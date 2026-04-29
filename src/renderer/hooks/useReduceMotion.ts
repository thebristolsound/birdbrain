import { useEffect, useState } from 'react'

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
export const REDUCE_MOTION_STORAGE_KEY = 'reduceMotion'

function readSettingFlag(): boolean {
  return localStorage.getItem(REDUCE_MOTION_STORAGE_KEY) === 'true'
}

function readOsPref(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches
}

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => readOsPref() || readSettingFlag())

  useEffect(() => {
    function recompute() {
      setReduce(readOsPref() || readSettingFlag())
    }

    const mql = window.matchMedia(MEDIA_QUERY)
    mql.addEventListener('change', recompute)

    function onStorage(e: StorageEvent) {
      if (e.key === REDUCE_MOTION_STORAGE_KEY) recompute()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      mql.removeEventListener('change', recompute)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return reduce
}
