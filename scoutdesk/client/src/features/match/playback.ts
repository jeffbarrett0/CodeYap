import { create } from 'zustand'
import { clamp } from '@/lib/utils'
import { frameAt } from '@/lib/timecode'

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

interface PlaybackState {
  /** Current media time in seconds. Written by the rAF sync loop, read by the playhead/timecode. */
  time: number
  duration: number
  fps: number
  playing: boolean
  rate: number
  volume: number
  muted: boolean
  ready: boolean
  error: string | null
  /** When set, playback pauses on reaching `end` ("play clip" mode). */
  clipRange: { id: string; start: number; end: number } | null
}

export const usePlayback = create<PlaybackState>(() => ({
  time: 0,
  duration: 0,
  fps: 25,
  playing: false,
  rate: 1,
  volume: 1,
  muted: false,
  ready: false,
  error: null,
  clipRange: null,
}))

const set = usePlayback.setState
const get = usePlayback.getState

/**
 * Imperative handle on the <video> element. One analysis screen is mounted at a
 * time, so a module singleton keeps hotkeys, timeline and controls decoupled
 * from React render cycles (important: time updates 60×/s must not re-render the tree).
 */
class PlayerController {
  el: HTMLVideoElement | null = null
  /** Optional second camera angle, slaved to the main video: sec.time = main.time + secOffset. */
  sec: HTMLVideoElement | null = null
  secOffset = 0
  private raf = 0

  attachSecondary(el: HTMLVideoElement, offset: number) {
    this.sec = el
    this.secOffset = offset
  }
  detachSecondary() {
    this.sec = null
  }
  setSecondaryOffset(offset: number) {
    this.secOffset = offset
  }

  /** Keep the secondary angle on the same moment as the main one (frame-exact while paused, drift-corrected while playing). */
  private syncSecondary(main: HTMLVideoElement) {
    const s = this.sec
    if (!s || s.readyState < 1) return
    const raw = main.currentTime + this.secOffset
    const dur = s.duration || Infinity
    const target = clamp(raw, 0, dur)
    const inRange = raw >= 0 && raw <= dur
    s.muted = true
    if (main.paused || !inRange) {
      if (!s.paused) s.pause()
      if (Math.abs(s.currentTime - target) > 0.02) s.currentTime = target
    } else {
      if (s.playbackRate !== main.playbackRate) s.playbackRate = main.playbackRate
      if (s.paused) void s.play().catch(() => {})
      if (Math.abs(s.currentTime - target) > 0.3) s.currentTime = target
    }
  }

  attach(el: HTMLVideoElement) {
    this.el = el
    const tick = () => {
      const v = this.el
      if (v) {
        const t = v.currentTime
        if (t !== get().time) set({ time: t })
        this.syncSecondary(v)
        const range = get().clipRange
        if (range && !v.paused && t >= range.end) {
          v.pause()
          v.currentTime = range.end
          set({ clipRange: null })
        }
      }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  detach() {
    cancelAnimationFrame(this.raf)
    this.el = null
    set({ time: 0, playing: false, ready: false, error: null, clipRange: null, duration: 0 })
  }

  get currentTime() {
    return this.el?.currentTime ?? get().time
  }

  seek(t: number) {
    const v = this.el
    const { duration } = get()
    const target = clamp(t, 0, duration || Number.MAX_SAFE_INTEGER)
    if (v) v.currentTime = target
    set({ time: target })
  }

  /** Relative seek in seconds. Cancels clip-range playback so the user isn't surprised by an auto-pause. */
  skip(delta: number) {
    set({ clipRange: null })
    this.seek(this.currentTime + delta)
  }

  /**
   * Step by whole frames. Lands on the *middle* of the target frame
   * ((n + 0.5) / fps) so browsers never round back to the neighbouring frame.
   */
  stepFrames(n: number) {
    const v = this.el
    if (!v) return
    const { fps, duration } = get()
    v.pause()
    set({ clipRange: null })
    const frame = frameAt(v.currentTime, fps) + n
    const last = duration > 0 ? Math.max(0, Math.ceil(duration * fps) - 1) : Infinity
    this.seek((clamp(frame, 0, last) + 0.5) / fps)
  }

  play() {
    void this.el?.play().catch(() => {})
  }
  pause() {
    this.el?.pause()
  }
  toggle() {
    const v = this.el
    if (!v) return
    set({ clipRange: get().clipRange && v.paused ? get().clipRange : null })
    if (v.paused) this.play()
    else v.pause()
  }

  /** Seek to a clip's start and play until its end. */
  playRange(id: string, start: number, end: number) {
    set({ clipRange: { id, start, end } })
    this.seek(start)
    this.play()
  }

  setRate(rate: number) {
    const r = clamp(rate, 0.25, 2)
    if (this.el) this.el.playbackRate = r
    set({ rate: r })
  }
  stepRate(dir: 1 | -1) {
    const i = SPEEDS.findIndex((s) => s === get().rate)
    const next = SPEEDS[clamp((i === -1 ? SPEEDS.indexOf(1) : i) + dir, 0, SPEEDS.length - 1)]!
    this.setRate(next)
  }
  setVolume(v: number) {
    const volume = clamp(v, 0, 1)
    if (this.el) {
      this.el.volume = volume
      this.el.muted = false
    }
    set({ volume, muted: false })
  }
  toggleMute() {
    const muted = !get().muted
    if (this.el) this.el.muted = muted
    set({ muted })
  }
}

export const player = new PlayerController()
