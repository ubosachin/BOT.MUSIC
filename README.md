# Ultra Bot Music Pro v2.0 🎵

A premium Spotify-first Discord Music Bot designed for high-fidelity audio and stable production environments.

## 🚀 Features

- **Spotify-First Engine**: Uses Spotify as the primary search engine for tracks, playlists, and albums.
- **Precision Playback**: Fetches metadata from Spotify and streams high-quality audio via YouTube.
- **Smart Input Detection**: Automatically handles song names, YouTube links, and Spotify links.
- **Universal Search Fallback**: Switches to `yt-dlp` global search if Spotify is unavailable.
- **Spotify Autoplay**: High-quality "Radio" experience using Spotify's recommendation engine.
- **Production Stable**:
  - Pure-JS Opus encoding (`opusscript`) for cross-platform compatibility.
  - Multi-client `yt-dlp` strategy to bypass bot detection.
  - DNS IPv4 prioritization to fix macOS/Linux connection loops.
  - Graceful shutdown and process cleanup.

## 🛠 Setup

1. **Environment Variables**:
   Create a `.env` file with:
   ```env
   DISCORD_TOKEN=your_token
   SPOTIFY_CLIENT_ID=your_id
   SPOTIFY_CLIENT_SECRET=your_secret
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Required Binaries**:
   Ensures `yt-dlp` and `ffmpeg` are installed on your system.
   - Mac: `brew install yt-dlp ffmpeg`
   - Linux: `sudo apt install yt-dlp ffmpeg`

4. **Deploy Commands**:
   ```bash
   npm run deploy
   ```

5. **Start the Bot**:
   ```bash
   npm run start
   ```

## 🎮 Commands

- `/play <name|link>` - Play music from Spotify or YouTube.
- `/skip` - Skip current track.
- `/stop` - Stop playback and leave.
- `/queue` - View current song queue.
- `/autoplay` - Toggle smart recommendations.
- `/volume` - Adjust volume (0-100).
- `/pause` / `/resume` - Control playback.

---
Built with ❤️ by [ubosachin](https://github.com/ubosachin)
