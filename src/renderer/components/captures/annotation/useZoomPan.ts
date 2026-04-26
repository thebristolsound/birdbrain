import { useMemo, useState } from 'react'

export const MIN_USER_SCALE = 0.5
export const MAX_ABS_SCALE = 8
export const MIN_VISIBLE_PX = 64

interface Options {
  imageWidth: number
  imageHeight: number
  containerWidth: number
  containerHeight: number
}

export function useZoomPan(opts: Options) {
  const { imageWidth, imageHeight, containerWidth, containerHeight } = opts

  const fitScale = useMemo(() => {
    if (!imageWidth || !containerWidth) return 1
    return Math.min(containerWidth / imageWidth, 1)
  }, [imageWidth, containerWidth])

  const initialPan = useMemo(() => {
    const w = imageWidth * fitScale
    const h = imageHeight * fitScale
    return {
      x: Math.max(0, (containerWidth - w) / 2),
      y: Math.max(0, (containerHeight - h) / 2)
    }
  }, [imageWidth, imageHeight, containerWidth, containerHeight, fitScale])

  const [userScale, setUserScaleState] = useState(1)
  const [panX, setPanX] = useState(initialPan.x)
  const [panY, setPanY] = useState(initialPan.y)

  const scale = userScale * fitScale

  return {
    fitScale,
    userScale,
    scale,
    panX,
    panY,
    setUserScaleState,
    setPanX,
    setPanY
  }
}
