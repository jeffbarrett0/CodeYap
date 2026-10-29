import { paintShapes, type Shape } from './drawing'

/** Render the current video frame plus drawn annotations to a PNG blob at native resolution. */
export async function captureSnapshot(video: HTMLVideoElement, shapes: Shape[], at?: { frame: number; fps: number }): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 1280
  canvas.height = video.videoHeight || 720
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  paintShapes(ctx, shapes, canvas.width, canvas.height, video, at)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode snapshot'))), 'image/png'))
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
