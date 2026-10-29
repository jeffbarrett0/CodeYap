import type { Category, Clip, ClipPatch, Match, Player, Team, User, Video } from '@/types'

let userId: string | null = null
export const setApiUser = (id: string | null) => {
  userId = id
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? `${res.status} ${res.statusText}`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export interface UploadMeta {
  title?: string
  matchId?: string | null
  angle?: string
  tags?: string[]
}

/** Multipart upload with progress (fetch cannot report upload progress, XHR can). */
export function uploadVideo(
  file: File,
  meta: UploadMeta,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/videos')
    if (userId) xhr.setRequestHeader('x-user-id', userId)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let data: unknown
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Video)
      else reject(new ApiError(xhr.status, (data as { error?: string } | undefined)?.error ?? `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'))
    signal?.addEventListener('abort', () => xhr.abort())

    // Text fields first so the server knows them when the file part arrives.
    const form = new FormData()
    if (meta.title) form.append('title', meta.title)
    if (meta.matchId) form.append('matchId', meta.matchId)
    if (meta.angle) form.append('angle', meta.angle)
    if (meta.tags?.length) form.append('tags', JSON.stringify(meta.tags))
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

export const api = {
  users: () => request<User[]>('GET', '/users'),
  teams: () => request<Team[]>('GET', '/teams'),
  players: () => request<Player[]>('GET', '/players'),
  taxonomy: () => request<Category[]>('GET', '/taxonomy'),
  matches: () => request<Match[]>('GET', '/matches'),
  createMatch: (m: Partial<Match>) => request<Match>('POST', '/matches', m),
  patchMatch: (id: string, m: Partial<Match>) => request<Match>('PATCH', `/matches/${id}`, m),

  createPlayer: (p: Partial<Player>) => request<Player>('POST', '/players', p),
  patchPlayer: (id: string, p: Partial<Player>) => request<Player>('PATCH', `/players/${id}`, p),
  deletePlayer: (id: string) => request<void>('DELETE', `/players/${id}`),
  uploadPlayerPhoto: async (id: string, file: File): Promise<Player> => {
    const form = new FormData()
    form.append('file', file, file.name)
    const res = await fetch(`/api/players/${id}/photo`, { method: 'POST', headers: userId ? { 'x-user-id': userId } : {}, body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Photo upload failed')
    return data as Player
  },
  createTeam: (t: Partial<Team>) => request<Team>('POST', '/teams', t),
  patchTeam: (id: string, t: Partial<Team>) => request<Team>('PATCH', `/teams/${id}`, t),
  deleteTeam: (id: string) => request<void>('DELETE', `/teams/${id}`),
  deleteMatch: (id: string) => request<void>('DELETE', `/matches/${id}`),

  videos: () => request<Video[]>('GET', '/videos'),
  patchVideo: (id: string, v: Partial<Video>) => request<Video>('PATCH', `/videos/${id}`, v),
  deleteVideo: (id: string) => request<void>('DELETE', `/videos/${id}`),

  clips: (matchId: string) => request<Clip[]>('GET', `/clips?matchId=${encodeURIComponent(matchId)}`),
  createClips: (clips: Partial<Clip>[]) => request<Clip[]>('POST', '/clips/bulk', { clips }),
  updateClips: (updates: { id: string; patch: ClipPatch }[]) => request<Clip[]>('POST', '/clips/batch-update', { updates }),
  deleteClips: (ids: string[]) => request<{ deleted: number }>('POST', '/clips/batch-delete', { ids }),
}
