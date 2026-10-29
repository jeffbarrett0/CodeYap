/**
 * Seed: 3 users, 2 teams, 3 players, the default taxonomy, 1 match with a
 * generated demo video, and 30 tagged clips.
 *
 *   npm run seed                 # no-op if data already exists
 *   npm run seed -- --reset      # wipe and re-seed
 *   SEED_VIDEO_FORMAT=webm npm run seed -- --reset   # VP9 instead of H.264
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { VIDEO_DIR } from '../src/config.js'
import { prisma } from '../src/db.js'
import { ffmpegAvailable, processVideo } from '../src/lib/ffmpeg.js'
import { ensureStorage } from '../src/lib/storage.js'
import { DEFAULT_TAXONOMY } from './taxonomy.js'

const run = promisify(execFile)
const DEMO_SECONDS = 180
const FPS = 25
type Outcome = 'success' | 'fail' | 'neutral'

// ── Demo video ──────────────────────────────────────────────────────────────

const FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
  '/System/Library/Fonts/Menlo.ttc',
  '/System/Library/Fonts/Supplemental/Courier New.ttf',
  'C:/Windows/Fonts/consola.ttf',
]

function pitchFilter(): string {
  const f: string[] = []
  // mowing stripes
  for (let i = 0; i < 10; i++) {
    if (i % 2) f.push(`drawbox=x=${60 + 116 * i}:y=40:w=116:h=640:color=0x276b3d:t=fill`)
  }
  const line = 'color=white@0.85'
  f.push(`drawbox=x=60:y=40:w=1160:h=640:${line}:t=3`) // touchlines
  f.push(`drawbox=x=638:y=40:w=3:h=640:${line}:t=fill`) // halfway
  f.push(`drawbox=x=60:y=190:w=190:h=340:${line}:t=3`, `drawbox=x=1030:y=190:w=190:h=340:${line}:t=3`)
  f.push(`drawbox=x=60:y=290:w=70:h=140:${line}:t=3`, `drawbox=x=1150:y=290:w=70:h=140:${line}:t=3`)
  f.push(`drawbox=x=610:y=330:w=60:h=60:${line}:t=3`) // centre mark (square — keeps the filter cheap)

  // 4-3-3 (home, blue) v 4-4-2 (away, red); positions in pitch px, jittered by sin/cos
  const home: [number, number][] = [[110, 360], [250, 190], [250, 300], [250, 420], [250, 530], [420, 240], [420, 360], [420, 480], [560, 190], [580, 360], [560, 530]]
  const away: [number, number][] = [[1170, 360], [1030, 190], [1030, 300], [1030, 420], [1030, 530], [860, 190], [860, 300], [860, 420], [860, 530], [720, 300], [720, 420]]
  const dot = (p: [number, number], i: number, color: string) => {
    const a = 14 + (i % 4) * 7
    const w = 0.35 + (i % 5) * 0.11
    return `drawbox=x='${p[0]}+${a}*sin(t*${w.toFixed(2)}+${i})':y='${p[1]}+${a}*cos(t*${(w * 0.8).toFixed(2)}+${i * 2})':w=18:h=18:color=${color}:t=fill`
  }
  home.forEach((p, i) => f.push(dot(p, i, '0x3b82f6')))
  away.forEach((p, i) => f.push(dot(p, i + 11, '0xdc2626')))
  f.push(`drawbox=x='640+420*sin(t*0.7)':y='360+200*cos(t*0.45)':w=12:h=12:color=white:t=fill`) // ball
  return f.join(',')
}

async function generateDemoVideo(dest: string, format: 'mp4' | 'webm'): Promise<boolean> {
  const font = FONTS.find((p) => fs.existsSync(p))
  let vf = pitchFilter()
  if (font) {
    const common = `fontfile='${font}':fontcolor=white:fontsize=34:box=1:boxcolor=black@0.6:boxborderw=8`
    vf += `,drawtext=${common}:text='%{pts\\:hms}  F%{frame_num}':x=70:y=52`
    vf += `,drawtext=${common}:fontsize=26:text='NORTHBRIDGE FC  v  RIVERMOUTH UNITED  (demo footage)':x=70:y=640`
  }
  const enc =
    format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-g', String(FPS), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-deadline', 'realtime', '-cpu-used', '8', '-g', String(FPS), '-pix_fmt', 'yuv420p']
  try {
    await run(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1f5a35:s=1280x720:r=${FPS}:d=${DEMO_SECONDS}`, '-vf', vf, ...enc, dest],
      { maxBuffer: 1024 * 1024 * 16 },
    )
    return true
  } catch (err) {
    console.warn('  ! could not generate demo video:', err instanceof Error ? err.message.split('\n')[0] : err)
    return false
  }
}

// ── Clips ───────────────────────────────────────────────────────────────────

type P = 'hale' | 'ferreira' | 'mensah' | null
interface ClipSeed {
  t: number
  tag: string
  p: P
  team: 'home' | 'away'
  outcome?: Outcome
  zone: string
  xy: [number, number]
  end?: [number, number]
  notes?: string
  labels?: string[]
}

const CLIPS: ClipSeed[] = [
  { t: 8.0, tag: 'Combination play', p: 'ferreira', team: 'home', zone: '3x3:5', xy: [45, 50], end: [62, 40], notes: 'Wall pass with Hale to break the first line.', labels: ['build-up'] },
  { t: 14.5, tag: 'Key pass', p: 'ferreira', team: 'home', zone: '3x3:6', xy: [62, 40], end: [84, 48], notes: 'Weighted ball between CB and LB.', labels: ['assist-type'] },
  { t: 15.8, tag: 'Shot on target', p: 'hale', team: 'home', zone: '3x3:6', xy: [84, 48], end: [100, 46], notes: 'First-time effort, saved low to keeper’s left.' },
  { t: 16.3, tag: 'Save', p: null, team: 'away', zone: '3x3:4', xy: [4, 50], notes: 'Parries it behind for a corner.' },
  { t: 24.0, tag: 'Duel won', p: 'mensah', team: 'away', zone: '3x3:5', xy: [48, 52], notes: 'Shoulder-to-shoulder, wins it clean.' },
  { t: 29.2, tag: 'Lost possession', p: 'ferreira', team: 'home', zone: '3x3:5', xy: [52, 38], notes: 'Heavy touch under pressure.' },
  { t: 33.0, tag: 'Turnover', p: null, team: 'away', zone: '3x3:5', xy: [50, 40], labels: ['transition'] },
  { t: 34.5, tag: 'Counter-attack', p: null, team: 'away', outcome: 'neutral', zone: '3x3:5', xy: [50, 45], end: [75, 60], notes: 'Three-v-two, slowed by recovery run.', labels: ['transition'] },
  { t: 38.0, tag: 'Cross', p: null, team: 'away', outcome: 'fail', zone: '3x3:9', xy: [88, 90], end: [92, 50], notes: 'Overhit, runs out of play.' },
  { t: 39.2, tag: 'Aerial duel', p: 'mensah', team: 'away', outcome: 'success', zone: '3x3:8', xy: [14, 50], notes: 'Dominant in the air at the back post.' },
  { t: 44.0, tag: 'Pressing action', p: 'hale', team: 'home', outcome: 'success', zone: '3x3:4', xy: [82, 42], notes: 'Triggers press on the goal-kick receiver.', labels: ['press-trigger'] },
  { t: 47.5, tag: 'Recovery', p: 'hale', team: 'home', zone: '3x3:5', xy: [74, 46], notes: 'Wins the second ball high up the pitch.' },
  { t: 52.0, tag: 'Dribble', p: 'ferreira', team: 'home', outcome: 'success', zone: '3x3:6', xy: [58, 70], end: [72, 62], notes: 'Beats his man on the outside.' },
  { t: 55.7, tag: 'Foul', p: 'mensah', team: 'away', zone: '3x3:4', xy: [18, 40], notes: 'Late challenge, free kick to home.' },
  { t: 57.0, tag: 'Free kick', p: null, team: 'home', outcome: 'neutral', zone: '3x3:4', xy: [76, 38], end: [90, 50], notes: 'Whipped in, cleared at the near post.' },
  { t: 60.5, tag: 'Shot', p: 'ferreira', team: 'home', outcome: 'fail', zone: '3x3:5', xy: [74, 52], end: [100, 62], notes: 'Drives over the bar from 25 yards.' },
  { t: 66.0, tag: 'Tackle', p: 'mensah', team: 'away', outcome: 'success', zone: '3x3:8', xy: [20, 55], notes: 'Perfectly timed slide tackle.' },
  { t: 70.4, tag: 'Interception', p: 'ferreira', team: 'home', zone: '3x3:5', xy: [44, 48], notes: 'Reads the pass into the number 10.' },
  { t: 76.0, tag: 'Run in behind', p: 'hale', team: 'home', zone: '3x3:6', xy: [66, 40], end: [88, 44], notes: 'Splits the centre-backs; offside trap beaten.', labels: ['off-ball'] },
  { t: 78.2, tag: 'Goal', p: 'hale', team: 'home', zone: '3x3:6', xy: [90, 46], end: [100, 48], notes: 'Calm finish across the keeper. 1–0.', labels: ['goal'] },
  { t: 84.0, tag: 'Corner', p: null, team: 'away', outcome: 'neutral', zone: '3x3:9', xy: [100, 100], end: [90, 52], notes: 'Out-swinger to the penalty spot.' },
  { t: 85.3, tag: 'Block', p: 'ferreira', team: 'home', zone: '3x3:2', xy: [12, 48], notes: 'Gets across to block the volley.' },
  { t: 92.0, tag: 'Throw-in', p: null, team: 'home', zone: '3x3:6', xy: [55, 100], end: [62, 80] },
  { t: 98.5, tag: 'Error', p: 'mensah', team: 'away', zone: '3x3:2', xy: [10, 50], notes: 'Misplaced back-pass straight to Hale.', labels: ['goal-conceded'] },
  { t: 99.6, tag: 'Shot on target', p: 'hale', team: 'home', zone: '3x3:6', xy: [86, 50], end: [100, 44], notes: 'Rounds the keeper after the error.' },
  { t: 100.2, tag: 'Goal', p: 'hale', team: 'home', zone: '3x3:6', xy: [90, 48], end: [100, 50], notes: 'Rebound tap-in. 2–0.', labels: ['goal'] },
  { t: 112.0, tag: 'Duel lost', p: 'ferreira', team: 'home', zone: '3x3:5', xy: [46, 44], notes: 'Out-muscled in midfield.' },
  { t: 118.0, tag: 'Claim', p: null, team: 'away', zone: '3x3:4', xy: [6, 48], notes: 'Plucks a cross out of the air.' },
  { t: 121.4, tag: 'Goal', p: null, team: 'away', zone: '3x3:6', xy: [88, 50], end: [100, 54], notes: 'Header from the corner. 2–1.', labels: ['goal', 'set-piece'] },
  { t: 150.0, tag: 'Card', p: 'mensah', team: 'away', zone: '3x3:5', xy: [38, 50], notes: 'Yellow card for dissent.' },
]

const mulberry = (a: number) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── Main ────────────────────────────────────────────────────────────────────

async function wipe() {
  const videos = await prisma.video.findMany()
  for (const v of videos) fs.rmSync(path.join(VIDEO_DIR, path.basename(v.filePath)), { force: true })
  await prisma.clip.deleteMany()
  await prisma.video.deleteMany()
  await prisma.match.deleteMany()
  await prisma.player.deleteMany()
  await prisma.team.deleteMany()
  await prisma.tagType.deleteMany()
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()
}

async function main() {
  ensureStorage()
  if (process.argv.includes('--reset')) {
    console.log('Resetting database…')
    await wipe()
  } else if ((await prisma.match.count()) > 0) {
    console.log('Database already has data — skipping seed (use --reset to wipe).')
    return
  }

  console.log('Seeding users, teams, players…')
  await prisma.user.createMany({
    data: [
      { id: 'u_admin', name: 'Alex Morgan', email: 'alex@scoutdesk.local', role: 'admin', color: '#a3e635' },
      { id: 'u_analyst', name: 'Sam Rivera', email: 'sam@scoutdesk.local', role: 'analyst', color: '#38bdf8' },
      { id: 'u_viewer', name: 'Jo Lee', email: 'jo@scoutdesk.local', role: 'viewer', color: '#fbbf24' },
    ],
  })
  await prisma.team.createMany({
    data: [
      { id: 't_nbfc', name: 'Northbridge FC', shortName: 'NBR', color: '#3b82f6', isOwn: true, country: 'England', formation: '4-3-3' },
      { id: 't_rmu', name: 'Rivermouth United', shortName: 'RMU', color: '#dc2626', isOwn: false, country: 'England', formation: '4-4-2' },
    ],
  })
  await prisma.player.createMany({
    data: [
      { id: 'p_hale', name: 'Marcus Hale', jersey: 9, positions: ['ST'], foot: 'right', heightCm: 186, age: 24, nationality: 'England', teamId: 't_nbfc', notes: 'Intelligent runner in behind; clinical first-time finisher. Press-trigger for the front line.' },
      { id: 'p_ferreira', name: 'Luca Ferreira', jersey: 8, positions: ['CM', 'AM'], foot: 'right', heightCm: 178, age: 26, nationality: 'Portugal', teamId: 't_nbfc', notes: 'Progressive passer, strong in tight spaces. Occasionally loses the ball under pressure.' },
      { id: 'p_mensah', name: 'Kofi Mensah', jersey: 5, positions: ['CB'], foot: 'right', heightCm: 190, age: 28, nationality: 'Ghana', teamId: 't_rmu', notes: 'Dominant aerially; discipline is a concern (cards).' },
    ],
  })

  console.log('Seeding taxonomy…')
  const tagIds = new Map<string, string>()
  for (const [ci, cat] of DEFAULT_TAXONOMY.entries()) {
    const c = await prisma.category.create({ data: { name: cat.name, color: cat.color, sortOrder: ci } })
    for (const [ti, tag] of cat.tags.entries()) {
      const t = await prisma.tagType.create({
        data: { categoryId: c.id, name: tag.name, hotkey: tag.hotkey, defaultOutcome: tag.outcome ?? 'neutral', sortOrder: ti },
      })
      tagIds.set(tag.name, t.id)
    }
  }

  console.log('Seeding match…')
  await prisma.match.create({
    data: {
      id: 'm_demo',
      date: new Date('2026-10-24T15:00:00Z'),
      competition: 'Premier Division · Matchday 14',
      venue: 'Northbridge Park',
      homeTeamId: 't_nbfc',
      awayTeamId: 't_rmu',
      homeScore: 2,
      awayScore: 1,
      tagStatus: 'in_progress',
      lineups: { home: ['p_hale', 'p_ferreira'], away: ['p_mensah'] },
      notes: 'Demo fixture. The attached footage is a 3-minute synthetic clip so the app works out of the box.',
    },
  })

  console.log('Generating demo video (needs ffmpeg)…')
  let videoId: string | null = null
  if (await ffmpegAvailable()) {
    const format = process.env.SEED_VIDEO_FORMAT === 'webm' ? 'webm' : 'mp4'
    const file = `v_demo.${format}`
    const dest = path.join(VIDEO_DIR, file)
    if (await generateDemoVideo(dest, format)) {
      await prisma.video.create({
        data: {
          id: 'v_demo',
          title: 'Northbridge v Rivermouth — Main camera (demo)',
          originalName: file,
          filePath: `videos/${file}`,
          mimeType: format === 'mp4' ? 'video/mp4' : 'video/webm',
          sizeBytes: BigInt(fs.statSync(dest).size),
          angle: 'Main',
          tags: ['demo', 'league'],
          matchId: 'm_demo',
          status: 'processing',
        },
      })
      await processVideo('v_demo')
      videoId = 'v_demo'
    }
  } else {
    console.warn('  ! ffmpeg not found — skipping demo video. Upload any match video from the Library instead.')
  }

  console.log('Seeding 30 clips…')
  const rnd = mulberry(7)
  const playerMeta: Record<string, { id: string; teamId: string; jersey: number }> = {
    hale: { id: 'p_hale', teamId: 't_nbfc', jersey: 9 },
    ferreira: { id: 'p_ferreira', teamId: 't_nbfc', jersey: 8 },
    mensah: { id: 'p_mensah', teamId: 't_rmu', jersey: 5 },
  }
  const defaults = new Map(DEFAULT_TAXONOMY.flatMap((c) => c.tags).map((t) => [t.name, t.outcome ?? 'neutral'] as const))
  await prisma.clip.createMany({
    data: CLIPS.map((c, i) => {
      const pm = c.p ? playerMeta[c.p] : null
      return {
        id: `c_seed_${String(i + 1).padStart(2, '0')}`,
        matchId: 'm_demo',
        videoId,
        tagTypeId: tagIds.get(c.tag)!,
        startSec: Math.max(0, +(c.t - 5).toFixed(2)),
        endSec: Math.min(DEMO_SECONDS, +(c.t + 5 + (rnd() < 0.3 ? 1.5 : 0)).toFixed(2)),
        timeSec: c.t,
        playerId: pm?.id ?? null,
        teamId: pm?.teamId ?? (c.team === 'home' ? 't_nbfc' : 't_rmu'),
        jersey: pm?.jersey ?? null,
        outcome: c.outcome ?? (defaults.get(c.tag) as Outcome),
        zone: c.zone,
        x: c.xy[0],
        y: c.xy[1],
        endX: c.end?.[0] ?? null,
        endY: c.end?.[1] ?? null,
        notes: c.notes ?? '',
        labels: c.labels ?? [],
        createdById: 'u_analyst',
      }
    }),
  })

  console.log(`Done. ${CLIPS.length} clips${videoId ? ' + demo video' : ''} ready.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
