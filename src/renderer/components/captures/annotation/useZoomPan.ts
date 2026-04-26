import { useCallback, useMemo, useState } from 'react'

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

  const [userScale, setUserScale] = useState(1)
  const [panX, setPanX] = useState(initialPan.x)
  const [panY, setPanY] = useState(initialPan.y)

  const scale = userScale * fitScale

  const zoomAt = useCallback(
    (deltaUserScale: number, cursorX: number, cursorY: number) => {
      const maxUserScale = MAX_ABS_SCALE / fitScale
      const nextUserScale = Math.max(
        MIN_USER_SCALE,
        Math.min(maxUserScale, userScale * deltaUserScale)
      )
      const nextScale = nextUserScale * fitScale
      // Solve for pan so the image-space pixel under the cursor is unchanged.
      // image_x = (cursor_x - panX) / scale must equal (cursor_x - nextPanX) / nextScale
      const imagePxX = (cursorX - panX) / scale
      const imagePxY = (cursorY - panY) / scale
      setUserScale(nextUserScale)
      setPanX(cursorX - imagePxX * nextScale)
      setPanY(cursorY - imagePxY * nextScale)
    },
    [fitScale, userScale, panX, panY, scale]
  )

  return {
    fitScale,
    userScale,
    scale,
    panX,
    panY,
    setUserScale,
    setPanX,
    setPanY,
    zoomAt
  }
}
