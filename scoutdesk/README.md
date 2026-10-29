# ScoutDesk

A football (soccer) **video scouting and match-analysis workstation** in the spirit of Hudl / Wyscout / Sportscode:
upload match video, tag moments into clips with a keyboard-first workflow, review them on a
timeline, and (in later phases) build playlists, profile players and export reports.

Dark, dense, pro-tool UI. Light theme available.

> **Status: all 10 planned phases are built and verified** — see [Roadmap](#roadmap) and [Testing](#testing).

## Quick start

**Windows (PowerShell):** install Node 20+ and ffmpeg (`winget install OpenJS.NodeJS.LTS Gyan.FFmpeg`), reopen the terminal, then if `npm` is blocked
by the execution policy run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once (or use `npm.cmd run …` instead of `npm run …`).


Requirements: **Node 20+** and **ffmpeg** on your `PATH`
(thumbnails, metadata probing, the generated demo video and MP4 export all use it; without it the app still runs).

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
Dark by default, 1280 px and up, WCAG 2.x A/AA clean (axe-core on every screen in both themes).

**Library** — drag-and-drop multi-file upload streamed to disk (progress tray that survives navigation, cancel/retry),
background ffprobe + thumbnail, grid/list views, filter/sort, rename, attach to a match, delete (admin).
Video is delivered through **signed URLs with HTTP Range support**, so seeking works on multi-GB files.

**Matches** — list with score, video/clip counts and tagging status; create/edit a match (score, status, venue, **lineups**); share a read-only link.
**Players** — database with photo upload, jersey, multiple positions, foot, height, age, nationality, team, notes; filter by team/position; tick two to **compare**.
**Teams** — own team vs opponents, colour, formation field (indicative placement by position), roster, match history and W/D/L record.

**Match analysis** (resizable panels, layout is remembered)
- *Player*: play/pause, **frame step ±1 (←/→)**, ±5 s, ±10 s, speed 0.25×–2×, volume, fullscreen,
  `HH:MM:SS.ff` timecode, wheel/button **zoom and drag-to-pan**, and a **drawing overlay** (arrow / line / circle,
  colours, undo, clear) bound to the paused frame. **Snapshots** download as PNG or are **saved to the report library** (drawings baked in).
- *Multi-angle*: pick a second camera angle; it plays in sync beside the main one. An **offset slider** (±60 s, frame nudges) aligns the two and is saved per video.
- *Timeline* (canvas): ruler, per-category density "waveform", one lane per category, overview map.
  Click/drag to scrub, **drag clip edges to re-trim** (one undo step), `Ctrl+wheel` / `=` `-` zoom, wheel pan, follow-playhead.
- *Tagging panel*: quick-tag buttons grouped by category, each with a hotkey; sticky **team / player / jersey / outcome / zone**
  context; configurable pre/post roll (default −5 s / +5 s). Fully usable without the mouse.
- *Clip inspector*: tag, start/end (timecode fields, ±0.5 s, "set to playhead"), team, player, jersey, outcome, zone, labels, notes,
  **threaded comments** with clickable `@1:23` timestamp mentions, one-click **MP4 export** and add-to-playlist.
- *Clip list*: virtualized table, sortable, multi-select (click / Shift / Ctrl), filters (text, category, tag, player, team, outcome, zone, label),
  **saved filter presets**, bulk actions (change tag, outcome, team/player, add label, add to playlist, export MP4, delete).
- *Event log*: play-by-play list that follows the video. *Pitch*: SVG pitch with event dots + pass/shot arrows, heatmap mode, time-range filter,
  and **click/drag to place an event** (undoable).
- **Undo / redo** (`Ctrl/⌘Z`, `Ctrl/⌘⇧Z`) for every clip edit — create, edit, bulk edit, trim, delete, relocate.

**Playlists** — build from any match via a cross-match clip library (filters: match, **date range**, category, player, outcome, text), **drag clips in**,
drag or button to reorder, custom titles, **cut / fade** transitions. Continuous playback with **auto-advance**, a lower-third **title overlay**,
loop, and fades through black. **Export to MP4** (FFmpeg: normalised 1280×720/25 fps H.264+AAC, optional burned-in titles, fades applied) through a
persistent **job queue** with live progress and download links.

**Share links** — read-only links to a playlist or a whole match, with optional **password** (scrypt-hashed, brute-force throttled) and **expiry**; revocable.
Recipients need no account and see no app chrome.

**Player profiles** — stat cards computed from tags (passes, shots, tackles, duels %, key passes, …), **heatmap / event map**, **radar vs position peers**
(falls back to all players, and says so), actions-by-type chart, all clips (deep-linked into the match), side-by-side **comparison** with leaders marked.

**Reports** — printable **PDF scouting reports** for a player or a team: summary stats, peer-comparison bars, vector heatmap, key clips with timestamps,
saved snapshots, and a written-notes section (ruled lines when left empty). Live preview, then download.

**Taxonomy editor** (Settings, admin) — add/rename/reorder/delete categories (= timeline lanes) and tags, pick colours, capture hotkeys
(reserved/duplicate keys refused), set default outcomes.

**Roles** — admin, analyst (can tag, build, export, share), viewer (read-only). Enforced in the UI *and* on the server (401/403).

### Drawing, seek bar and match import

- **Simple / Pro mode** (button top right). Simple (default): the footage, frame tools, screenshot and the timeline. Pro: also tagging, clip inspector, clips table, event log and pitch map. The choice is remembered.
- **Your own JSON files**: Matches → *Import from link* (or the upload dialog) → *Choose JSON file(s)*. Reads StatsBomb / Hudl open data (matches, lineups, events), SofaScore JSON (event, lineups) and a simple format (see the example in the dialog). Several files can be combined; a swap box fixes home/away.
- **Frame tools** (Turkish labels, under the video). Pause, pick a tool, draw; after one drawing the tool hands you back to *Seç*, so the next click never draws by accident. Click a drawing to select it, press its middle to move it, drag the white dots to resize, `Delete` removes it.
  - **Ok**, **Çizgi**, **Koşu oku** (dashed run arrow): drag.
  - **Daire**: click a player for a ground ring (or drag any size; Shift = perfect circle).
  - **Zoom**: click or drag a circle on a player; a live **"Player close up"** magnifier opens on the left of the video (also in screenshots).
  - **Bağlantı**: click player after player (yellow/black rings, joined by a line); right-click ends.
  - **Alan**: click corners; right-click (or double-click) closes the hatched area.
  - **Numara**: click players for 1, 2, 3…; right-click ends.
  - **Oyuncu**: click a player; the side **Çizim** tab opens with the name box (type, or pick from the match's players).
  - **Aydınlat**: click a player to light them with a white glow.
  - **Colours**: 32 ready colours (basic, pastel, dark, neutral) plus a free colour (picker or `#rrggbb`).
  - **Close-up** (Zoom): drag inside it to pan, mouse wheel to zoom, drag the dot on its edge to resize (or use the sliders in the Çizim tab).
  - **Numara / Oyuncu**: drag the white dot or use the mouse wheel to resize; Oyuncu also has a *Yazı boyutu* slider.
  - **Layout**: drag the dividers between sections; sizes are remembered, *Düzeni sıfırla* (top right of the match header) restores the defaults.
  - **Çizim süresi** keeps a drawing on screen for 2–10 s while playing (default: only on its frame). *Video boyutu* resizes the picture, *Ortala* recentres it.
- **Ekran görüntüsü al** (top right of the video panel) saves only the match footage, without drawings or interface.
- **Timeline** is a simple CapCut-style strip: time ruler, the match video as a filmstrip, tagged clips as coloured markers (click one to open it). Click or drag anywhere to jump; `+`/`-` zoom.
- **Seek bar** under the video with minute ticks and hover preview; type a time in *Go to* (`3` = minute 3, `4:30` = 4 min 30 s).
- **Match header** at the top of the analysis screen (teams, crests, score, competition, venue, formations, status).
- **Import from a link**: when uploading a video you are asked which match it is. Paste a link and the match (teams, date, competition, venue, score, lineups, formations, optionally events as clips) is filled in. Also under Matches → *Import from link*.
  - Hudl open data (`github.com/hudl/open-data`) is verified against live data.
  - SofaScore (JSON API) and generic pages (JSON-LD / title) are implemented but could not be tested from the build sandbox; sites may block automated requests. Transfermarkt has no dedicated parser yet (best-effort generic only).

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

Coordinates are stored per clip as `x,y` (0–100, always oriented in the *tagging team's* attacking direction) plus optional `endX,endY`.

Deep links: `/match/:id?tag=<tagTypeId>`, `?clip=<clipId>`, `?t=<seconds>`.

## Architecture

```
scoutdesk/
├─ server/                Fastify 5 + Prisma 6 (SQLite) — TypeScript, run with tsx
│  ├─ prisma/             schema.prisma, seed.ts (+ demo-footage generator), taxonomy.ts
│  ├─ src/routes/         reference, videos, clips, taxonomy, playlists, exports, shares, comments, snapshots, profile, reports
│  ├─ src/lib/            range (HTTP Range), sign (HMAC URLs), ffmpeg (probe/thumbs), exporter (FFmpeg queue),
│  │                      stats (tag → stats, radar), report (pdfkit), display, heat
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

## Security notes

- Media (video, thumbnails, photos, snapshots, exports) is served through **HMAC-signed, expiring URLs** — nothing is world-readable by guessing an id.
- Share passwords are scrypt-hashed with per-link salts; failed attempts are throttled (8/min per link and IP).
- Uploads are streamed with size/extension checks; storage paths never come from user input.
- **Auth is demo-grade** (the client sends `x-user-id`). Replace `server/src/auth.ts` with real sessions/SSO before exposing the server beyond a trusted network.
- `npm audit` reports a `deepmerge-ts` advisory reachable only through Prisma's CLI config loader (build-time tooling, not the running server); it needs a Prisma major upgrade.

## Known limitations

- **Browser codecs decide what plays.** H.264/AAC MP4 is safest; MOV/MKV/WebM depend on the browser. There is no server transcoding for *playback* (export always re-encodes to H.264).
- Passes: the default taxonomy has no generic "Pass" tag, so "passes" are Key pass, Cross, Combination play, Distribution (and `Pass` if you add one) — see "How are these computed?" on the profile.
- Stats describe *tagged* actions, not full-match totals; radar axes are scaled against the best player in *your* database, not a league benchmark.
- Filter presets are stored per browser. Undo/redo covers clip edits (other entities save immediately).
- SQLite + in-process export queue suit a single analyst workstation or small team; for many concurrent users move to Postgres and a separate worker.

## Roadmap

1. ✅ Project setup, app shell, navigation, dark theme
2. ✅ Video library: upload, storage, range streaming, thumbnails
3. ✅ Match analysis: player, frame stepping, speed, zoom/pan, drawing
4. ✅ Timeline, tagging panel with hotkeys, clip creation
5. ✅ Clip list with filtering and bulk actions
6. ✅ Pitch visualisation, player & team database
7. ✅ Playlists, playback, FFmpeg export + job queue
8. ✅ Player profiles (stats, heatmap, radar), comparison
9. ✅ PDF reports, share links
10. ✅ Polish: accessibility pass, empty states, comments, multi-angle sync, taxonomy editor

Ideas beyond the brief: real auth/SSO, Postgres + object storage, per-user presets, server-side transcoding for non-H.264 uploads, team-level radar benchmarks.

## Testing

```bash
npm test             # 51 server integration tests + 37 client unit tests
npm run typecheck
node e2e/a11y.cjs    # axe-core WCAG A/AA audit of every screen, dark + light (needs the app running on :4000)
```

`e2e/*.cjs` are Playwright scripts that drive the real app — frame-accurate stepping against the burned-in frame counter, tagging, undo/redo, timeline drags,
filters and bulk edits, viewer role, playlists with drag-and-drop and auto-advance, a real FFmpeg export (verified as MP4), password-protected public links
opened in an anonymous browser, profiles/compare, PDF generation, comments, multi-angle sync, the taxonomy editor, and a 5,000-clip performance run.
They need `npm i -g playwright && npx playwright install chromium`, the app on `:4000`
(`npm run build && npm start`) and a freshly seeded DB (`SEED_VIDEO_FORMAT=webm npm run seed:reset` if your Chromium build lacks H.264), e.g.
`node e2e/phase7-playlists-export-share.cjs ./e2e-out`. Screenshots land in the output dir.
