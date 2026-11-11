# AetherHiFi — Google Drive Lossless Music Streamer (PWA)

A zero-install web application and Progressive Web App (PWA) for streaming lossless audio (**FLAC**, **ALAC**, **WAV**) directly from your Google Drive on both your **personal Windows laptop** and **office MacBook**.

## Key Features
- **Direct HTTP 206 Range Streaming via Service Worker (`/sw-stream.js`)**: Streams 30MB–150MB+ FLAC files directly from Google's CDN to your browser `<audio>` pipeline with instant seeking and zero server bandwidth bottlenecks.
- **Partial-Byte FLAC Header Indexer**: Extracts `STREAMINFO` (sample rate, bit depth, duration), `VORBIS_COMMENT` tags, and embedded `PICTURE` album art by fetching only the first 128 KB of each file (`Range: bytes=0-131071`).
- **Cross-Device Cloud Library Sync (`aetherhifi-library-index.json`)**: Index your library once on your Windows laptop and save the index to Google Drive. When you open the app on your office MacBook, click **"Load Index from Drive"** to load your entire library, cover art, and playlists in under 2 seconds.
- **Dual-Deck Gapless Playback Engine**: Pre-buffers the next track in a standby `<audio>` deck when 15 seconds remain on the current track for seamless album transitions.
- **OS Media Keys & Lock Screen Integration**: Full `navigator.mediaSession` support for Windows media keys and MacBook keyboard/Control Center controls.

## Quick Start (Local Development)

```bash
cd gdrive-lossless-player
npm install
npm run dev
```

## Deploying for Your Office MacBook & Windows Laptop (Vercel / Cloudflare Pages)
1. Push `gdrive-lossless-player` to a private GitHub repository.
2. Import into **Vercel** or **Cloudflare Pages** (Build command: `npm run build`, Output directory: `dist`).
3. In [Google Cloud Console](https://console.cloud.google.com/):
   - Enable the **Google Drive API**.
   - Create an **OAuth 2.0 Client ID** (Web application) and add both `http://localhost:5173` and your Vercel/Cloudflare URL to **Authorized JavaScript origins**.
4. Open the app, click **Connect Google Drive**, paste your Client ID, and select your Music folder!
