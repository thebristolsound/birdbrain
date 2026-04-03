import { useState, useEffect } from 'react'

export function useCaptureThumbnail(captureId: string | null) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!captureId) {
      setThumbnail(null)
      return
    }

    let cancelled = false
    setLoading(true)

    window.birdbrain.captures
      .getThumbnail(captureId)
      .then((data) => {
        if (!cancelled && data) {
          setThumbnail(`data:image/jpeg;base64,${data}`)
        }
      })
      .catch((err) => {
        console.error('Failed to load thumbnail:', err)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [captureId])

  return { thumbnail, loading }
}
