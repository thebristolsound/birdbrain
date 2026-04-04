import { useState, useEffect } from 'react'

export function useCaptureThumbnail(captureId: string | null) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!captureId) {
      setThumbnail(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setThumbnail(null)
    setLoading(true)

    window.birdbrain.captures
      .getThumbnail(captureId)
      .then((data) => {
        if (!cancelled) {
          if (data) {
            setThumbnail(`data:image/jpeg;base64,${data}`)
          } else {
            setThumbnail(null)
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load thumbnail:', err)
        }
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
