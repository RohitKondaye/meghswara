# MeghSwara — Agent Guide

Shared instructions for **every** coding agent on this repo (Antigravity on Windows, Claude Code on macOS).
Antigravity reads this file directly; Claude Code loads it via `CLAUDE.md`.

> Before starting work, read [`docs/HANDOFF.md`](docs/HANDOFF.md) for current status.
> Before ending a session, update it (see "Handoff protocol" below).

## What this is
A personal PWA that streams lossless audio (FLAC, ALAC `.m4a`, WAV, MP3, OGG) straight from the
owner's Google Drive to a Windows laptop, a MacBook and an Android phone.

- Live: https://meghswara.pages.dev (Cloudflare Pages project `meghswara`)
- Repo: https://github.com/RohitKondaye/meghswara (**public** — never commit secrets)
- Stack: Vite 6 + React 19 + TypeScript + Tailwind v4, Dexie (IndexedDB), Zustand,
  Cloudflare Pages Functions + KV.

## Commands
```bash
npm install
npm run dev          # http://localhost:5173 (must stay on 5173: it's an authorized Google OAuth origin)
npm test             # vitest
npm run build        # tsc -b && vite build  (run before every commit)
npm run deploy       # build + wrangler pages deploy to production
npm run logs         # read live error telemetry from production (needs TELEMETRY_READ_KEY in .env)
npm run logs:clear   # wipe telemetry
```

## Architecture map
| Area | File(s) |
|---|---|
| Google OAuth (GIS token client, silent refresh, stream cookie, stream URL builder) | `src/services/googleAuth.ts` |
| Drive listing, folder scan, byte-range fetch, cloud index save/load | `src/services/driveApi.ts` |
| FLAC header parsing (STREAMINFO / VORBIS_COMMENT / PICTURE) from first 128 KB | `src/services/metadataIndexer.ts` |
| Dual-deck gapless playback engine | `src/audio/gaplessEngine.ts` |
| 10-band EQ + visualizer (Web Audio) | `src/audio/equalizerEngine.ts` |
| Player state / queue | `src/store/playerStore.ts` |
| IndexedDB schema | `src/db/libraryDb.ts` |
| Offline pinning (Cache Storage) | `src/services/offlineCache.ts` |
| Lyrics (lrclib.net) | `src/services/lyricsService.ts` |
| Client error reporting | `src/services/telemetry.ts` |
| **Edge stream proxy** (`/api/stream/:id`, alias `/drive-stream/:id`) | `functions/drive-stream/[fileId].ts`, `functions/api/stream/[fileId].ts` |
| **Telemetry API** (`/api/telemetry`, KV `MEGHSWARA_TELEMETRY`) | `functions/api/telemetry.ts` |
| Shared edge security (CORS allowlist, token scrubbing) | `shared/edgeSecurity.ts` |
| Static security headers / CSP | `public/_headers` |
| Localhost-only Service Worker stream proxy | `public/sw-stream.js` |

## Hard-won lessons (do NOT regress these)
1. **Production streams go through the Cloudflare edge function, not the Service Worker.**
   A Service Worker doing a CORS fetch to Google can't see `Content-Range`, and Android Chrome
   rejects a `206` without it (`NotSupportedError: no supported source`). The SW is unregistered
   on production and only used on localhost.
2. **Normalize `application/x-flac` → `audio/flac`.** Android's media stack rejects Google's MIME type.
3. **Never cap/truncate Range responses** (e.g. to 768 KB). The `<audio>` FLAC decoder treats the
   end of the response as end-of-track and skips to the next song after ~5 s. Pass `Range` through
   (`bytes=0-` if absent) and stream `upstream.body`.
4. **Never download whole files into memory** (`arrayBuffer()` / blob fallback) for playback —
   that's what made mobile startup take ages.
5. **Streams must be `Cache-Control: no-store`.** Caching them filled phone storage.
6. **Track end uses `Math.max(deck.duration, track.duration)`** so a partially buffered duration
   never triggers an early hand-off. Release the old deck (`removeAttribute('src')` + `load()`).
7. **Stream auth is cookie-first** (`meghswara_token`, `SameSite=Strict; Secure`); the token goes
   in the URL only on localhost or on the single fallback retry in `gaplessEngine.ts`.
8. When debugging a device problem, **read telemetry first** (`npm run logs`) instead of asking
   for screenshots.

## Security & privacy rules
- Secrets live only in `.env` (gitignored) and Cloudflare secrets. See `.env.example` for names.
- `VITE_GOOGLE_CLIENT_ID` is read from env — don't hardcode it.
- Telemetry must never contain OAuth tokens (scrubbed server-side in `shared/edgeSecurity.ts`; also
  use `redactTokenFromUrl` client-side).
- Adding a new external origin (API, CDN, font)? Update the CSP in `public/_headers` or it will be blocked.
- Adding a new deploy origin? Update the allowlist in `shared/edgeSecurity.ts` **and** Google Cloud
  Console → Authorized JavaScript origins.
- Keep Drive scopes minimal: `drive.readonly` + `drive.file`.
- If data collection changes, update `src/components/PrivacyNotice.tsx`.

## Conventions
- TypeScript strict; `npm run build` must pass (it type-checks) before committing.
- Line endings are LF (enforced by `.gitattributes`) so Windows and macOS don't fight.
- Small, descriptive commits on `main`. Deploy only from a clean, pushed `main`.
- Network steps (deploy, push, `wrangler` commands) need real network access.

## Handoff protocol (switching between Antigravity ⇄ Claude Code)
Conversation history does **not** transfer between tools — only the repo does. So:

**Start of session**
1. `git pull --rebase`
2. Read `docs/HANDOFF.md`
3. `npm install` if `package-lock.json` changed

**End of session**
1. `npm run build && npm test`
2. Update `docs/HANDOFF.md`: what changed, what's in progress, known issues, next steps
3. Commit and `git push` — even work-in-progress (prefix the message with `WIP:`)
4. Put anything you learned the hard way into "Hard-won lessons" above
