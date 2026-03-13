# 🎵 Discord Music Bot v2 — Interactive Button Controls

A modern Discord Music Bot built with **Discord.js v14**, featuring a rich interactive control panel with buttons directly in chat.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🎵 YouTube Playback | URLs & search queries via `play-dl` |
| 🎛️ Button Controls | 9 interactive buttons in chat |
| 📋 Queue System | Per-server queues with history |
| 🔁 Loop Modes | Off → Song → Queue → Off (cycles) |
| 🔀 Shuffle | Randomize the current queue |
| 🔊 Volume Control | ±10% per button press |
| ⏮ Previous | Jump back to previous song |
| 📊 Progress Bar | Visual bar, refreshes every 15s |
| ✨ Autoplay | Related songs when queue ends |
| 👋 Auto-Leave | Disconnects after 5 min inactivity |
| 🔒 Security | VC guard + per-user cooldown |

---

## 📁 Project Structure

```
music-bot/
├── commands/
│   ├── play.js          # /play <query>
│   ├── queue.js         # /queue
│   └── stop.js          # /stop
├── events/
│   ├── ready.js         # Bot ready
│   └── interactionCreate.js  # Slash & button handler
├── music/
│   ├── player.js        # Core audio engine
│   └── queue.js         # Queue data structure
├── ui/
│   └── musicPanel.js    # Embed + button builders
├── index.js             # Entry point
├── deploy-commands.js   # Register slash commands
├── package.json
└── .env.example
```

---

## 🛠️ Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
```

> Get both from the [Discord Developer Portal](https://discord.com/developers/applications):
> - **Token**: Bot → Reset Token
> - **Client ID**: OAuth2 → Client ID (Application ID)

### 3. Deploy Slash Commands
```bash
npm run deploy
```
> ⚠️ Global slash commands can take up to **1 hour** to propagate. For instant testing, use guild-specific deployment.

### 4. Run the Bot
```bash
npm start
```

---

## 🎮 Slash Commands

| Command | Description |
|---|---|
| `/play <query>` | Play from YouTube URL or search term |
| `/queue` | Show the current queue |
| `/stop` | Stop music & disconnect |

---

## 🎛️ Music Control Panel Buttons

When a song starts, the bot sends a live **interactive panel** with:

**Row 1:**
| Button | Action |
|---|---|
| ⏮ | Play previous song |
| ⏸/▶️ | Toggle Pause / Resume |
| ⏭ | Skip to next song |
| 🔁 | Cycle loop mode |
| ⏹ | Stop & disconnect |

**Row 2:**
| Button | Action |
|---|---|
| 🔀 | Shuffle queue |
| 🔉 | Volume down 10% |
| 🔊 | Volume up 10% |
| 📜 | Show queue |

---

## 🔒 Security Rules

- ✅ Only users **in the same VC** can press buttons
- ✅ **1-second cooldown** per user to prevent spam
- ✅ Graceful error handling on all interactions

---

## 🌐 Hosting

To keep your bot running 24/7, host it on:
- **[Railway](https://railway.app)** — Free tier, easy deploy from GitHub
- **[Render](https://render.com)** — Free Node.js web services
- **[DigitalOcean](https://digitalocean.com)** — $4/mo droplet
- **[VPS / Home server]** — Run with `pm2 start index.js`

### PM2 (process manager)
```bash
npm install -g pm2
pm2 start index.js --name music-bot
pm2 save
pm2 startup
```

---

Built with ❤️ using Node.js · Discord.js v14 · @discordjs/voice · play-dl
