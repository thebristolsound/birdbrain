import { useQuery } from '@tanstack/react-query'
import { captureThumbnailQueryOptions } from '@renderer/lib/api/captures'

export function useCaptureThumbnail(captureId: string | null) {
  const { data, isLoading } = useQuery(captureThumbnailQueryOptions(captureId ?? ''))

  const thumbnail = captureId && data ? `data:image/jpeg;base64,${data}` : null

  return { thumbnail, loading: !!captureId && isLoading }
}
