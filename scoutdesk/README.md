# ScoutDesk

A football (soccer) **video scouting and match-analysis workstation** in the spirit of Hudl / Wyscout / Sportscode:
upload match video, tag moments into clips with a keyboard-first workflow, review them on a
timeline, and (in later phases) build playlists, profile players and export reports.

Dark, dense, pro-tool UI. Light theme available.

> **Status: phases 1–5 of 10 are built and verified** (see [Roadmap](#roadmap)). Phases 6–10 are not started.

## Quick start

Requirements: **Node 20+** and, strongly recommended, **ffmpeg** on your `PATH`
(thumbnails, metadata probing, the generated demo video, and later clip export all use it).

```bash
cd scoutdesk
npm run setup     # installs deps, creates the SQLite DB, seeds demo data + generates demo footage
npm run dev       # API on :4000, web app on http://localhost:5173
```

The seed creates 2 teams, 3 players, the default football taxonomy, 1 match with a generated
3-minute demo video (so frame stepping is easy to verify: the timecode and frame number are burned into the footage),
and 30 tagged clips. Three demo users are available from the avatar menu: **admin**, **analyst** (default) and **viewer** (read-only).

Production-style (one process, one port):

```bash
npm run build && npm start    # http://localhost:4000 serves the API and the built client
```

Useful commands

| Command | What it does |
| --- | --- |
| `npm run seed:reset` | Wipe the DB and re-seed (re-generates demo footage) |
| `SEED_VIDEO_FORMAT=webm npm run seed:reset` | Demo footage as VP9/WebM instead of H.264 (for browsers/builds without H.264) |
| `npm test` | Server integration tests (needs a seeded DB) + client unit tests |
| `npm run typecheck` | `tsc --noEmit` for both packages |

Environment variables (all optional): `PORT` (4000), `STORAGE_DIR` (`server/storage`), `MAX_UPLOAD_BYTES` (20 GB),
`STREAM_URL_TTL` seconds (24 h), `SCOUTDESK_SECRET` (URL-signing key; auto-generated into `storage/.secret` otherwise).

## What works today

**Shell** — sidebar (Library, Matches, Players, Teams, Playlists, Reports, Settings), top bar with global search
(`/` or `Ctrl/⌘K`; matches, teams, players, tags), team context filter, user switcher, dark/light theme, shortcut cheat sheet (`?`).

**Library** — drag-and-drop multi-file upload streamed to disk (progress tray that survives navigation, cancel/retry),
background ffprobe + thumbnail, grid/list views, filter/sort, rename, attach to a match, delete (admin).
Video is delivered through **signed URLs with HTTP Range support**, so seeking works on multi-GB files.

**Matches** — list with score, video/clip counts and tagging status; create a match.

**Match analysis** (resizable panels, layout is remembered)
- *Player*: play/pause, **frame step ±1 (←/→)**, ±5 s, ±10 s, speed 0.25×–2×, volume, fullscreen,
  `HH:MM:SS.ff` timecode, wheel/button **zoom and drag-to-pan**, and a **drawing overlay** (arrow / line / circle,
  colours, undo, clear) bound to the paused frame, with **PNG snapshot** export that bakes in the drawings.
- *Timeline* (canvas): ruler, per-category density "waveform", one lane per category, overview map.
  Click/drag to scrub, **drag clip edges to re-trim** (one undo step), `Ctrl+wheel` / `=` `-` zoom, wheel pan, follow-playhead.
- *Tagging panel*: quick-tag buttons grouped by category, each with a hotkey; sticky **team / player / jersey / outcome / zone**
  context; configurable pre/post roll (default −5 s / +5 s). Fully usable without the mouse.
- *Clip inspector*: tag, start/end (timecode fields, ±0.5 s, "set to playhead"), team, player, jersey, outcome, zone, labels, notes.
- *Clip list*: virtualized table (timestamp, category/tag, player, team, outcome, notes, labels), sortable, multi-select
  (click / Shift / Ctrl), filters (text, category, tag, player, team, outcome, zone, label), **saved filter presets**,
  bulk actions (change tag, outcome, team/player, add label, delete).
- *Event log*: play-by-play list that follows the video.
- **Undo / redo** (`Ctrl/⌘Z`, `Ctrl/⌘⇧Z`) for every clip edit — create, edit, bulk edit, trim, delete — kept in sync with the server.
- **Roles**: admin, analyst (can tag), viewer (read-only). Enforced in the UI *and* on the server (401/403).

### Keyboard shortcuts (press `?` in the app for the live list)

| | |
| --- | --- |
| `Space` | play / pause (always, unless you're typing in a field) |
| `←` `→` | previous / next frame (hold to repeat) |
| `Shift+←/→`, `Alt+←/→` | ∓5 s, ∓10 s |
| `[` `]` | slower / faster |
| `,` `.` | previous / next tagged event |
| `Home` `End` | start / end |
| `D` | draw on paused frame · `F` fullscreen · `M` mute |
| `S T G K C R B Y` … | tag Shot, Shot on target, Goal, Key pass, Cross, Dribble, Run in behind, Combination (see the cheat sheet for all 29) |
| `Alt+T`, `Alt+0/1/2/3`, `#` | toggle team, outcome auto/✓/✗/–, jump to jersey entry |
| `I` `O` | set selected clip's start / end to the playhead |
| `Enter` | open the clip inspector · `Delete` delete selection · `Esc` stop clip / close drawing / deselect |
| `Ctrl/⌘A` | select all visible clips |
| `=` `-` | zoom timeline in / out |

Deep links: `/match/:id?tag=<tagTypeId>`, `?clip=<clipId>`, `?t=<seconds>`.

## Architecture

```
scoutdesk/
├─ server/                Fastify 5 + Prisma 6 (SQLite) — TypeScript, run with tsx
│  ├─ prisma/             schema.prisma, seed.ts (+ demo-footage generator), taxonomy.ts
│  ├─ src/routes/         reference (teams/players/matches), videos, clips, taxonomy
│  ├─ src/lib/            range.ts (HTTP Range), sign.ts (HMAC URLs), ffmpeg.ts (probe/thumbs)
│  └─ test/               vitest + fastify.inject integration tests
└─ client/                React 18 + Vite + Tailwind + Radix primitives + Zustand
   └─ src/
      ├─ components/ui    shadcn-style primitives     ├─ lib/       api, hotkeys, timecode
      ├─ components/layout shell, search, cheat sheet  ├─ store/     app prefs, reference data, uploads
      └─ features/{library,matches,match}              └─ match/     playback, timeline, tagging, clips, history…
```

Design notes

- **Playback state is not React state.** A `PlayerController` singleton owns the `<video>`; a rAF loop publishes `time` to a store
  that only the timecode and the (DOM-positioned) playhead read, so playback never re-renders the tree.
- **Frame stepping** lands in the *middle* of the target frame `(n + ½)/fps`, which stops browsers rounding back to the neighbour.
- **Clip edits are optimistic**: applied locally, written to the server, re-synced on failure. Undo/redo entries are inverse patches,
  so they replay against the API too; no-op edits are dropped. The client mints clip ids so redo re-creates the same record.
- **Hotkeys** run through one capture-phase listener and a registry that also feeds the cheat sheet.
- **Performance** (measured, 5,030 clips in one match, headless Chromium): table ready in ~0.5 s with 20 DOM rows,
  timeline zoom = 1 frame, 60 fps (p95 16.9 ms) during playback with the timeline live, filtering 5 k clips ≈ 75 ms.

## Known limitations

- **Browser codecs decide what plays.** H.264/AAC MP4 is safest; MOV/MKV/WebM depend on the browser. There is no server transcoding yet.
- **Auth is demo-grade**: the client sends `x-user-id`. Swap `server/src/auth.ts` for real sessions before exposing it.
- Filter presets are stored per browser (localStorage). Undo/redo currently covers clip edits (other entities arrive with their phases).
- Drawn snapshots download as PNG; saving them into reports comes with phase 9.

## Roadmap

1. ✅ Project setup, app shell, navigation, dark theme
2. ✅ Video library: upload, storage, range streaming, thumbnails
3. ✅ Match analysis: player, frame stepping, speed, zoom/pan, drawing
4. ✅ Timeline, tagging panel with hotkeys, clip creation
5. ✅ Clip list with filtering and bulk actions
6. ⏳ Pitch visualisation, player & team database
7. ⏳ Playlists, playback, FFmpeg clip export + job queue
8. ⏳ Player profiles (stats, heatmap, radar), comparison
9. ⏳ PDF reports, share links
10. ⏳ Polish: remaining a11y pass, empty states everywhere, multi-angle sync

## Browser tests

`e2e/*.cjs` are Playwright scripts that drive the real app (frame-accurate stepping against the burned-in frame counter,
tagging, undo/redo, timeline drags, filters, bulk edits, viewer role, a 5,000-clip performance run). They assume the app is running on
`:4000` with a freshly seeded DB, e.g. `node e2e/analysis-transport-tagging.cjs ./e2e-out`. Screenshots land in the output dir.
