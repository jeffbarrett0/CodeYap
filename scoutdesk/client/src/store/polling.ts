import { useEffect } from 'react'
import { useData } from './data'

/** While any video is still being probed/thumbnailed, refresh the list every 2s. */
export function useVideoProcessingPoll() {
  const processing = useData((s) => s.videos.some((v) => v.status === 'processing'))
  const refresh = useData((s) => s.refreshVideos)
  useEffect(() => {
    if (!processing) return
    const id = setInterval(() => void refresh().catch(() => {}), 2000)
    return () => clearInterval(id)
  }, [processing, refresh])
}
