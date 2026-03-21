import { useEffect, useState } from 'react'

export function useAppVersion() {
  const [version, setVersion] = useState<string>('0.0.0')

  useEffect(() => {
    let mounted = true
    void window.birdbrain.app
      .getVersion()
      .then((v) => {
        if (mounted && v) setVersion(v)
      })
      .catch((error) => {
        console.error('Failed to load app version', error)
        if (mounted) setVersion('0.0.0')
      })
    return () => {
      mounted = false
    }
  }, [])

  return version
}
