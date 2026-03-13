require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const dns  = require('dns');

// Fix for macOS/Linux voice connection loops (prioritize IPv4)
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { execSync } = require('child_process');
const https = require('https');
const express = require('express');
const path = require('path');

// ── Production Audio Engine Link ─────────────────────────────────────────────
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) {
        process.env.FFMPEG_PATH = ffmpegPath;
        // Also add to system PATH so prism-media/others find it automatically
        const ffmpegDir = path.dirname(ffmpegPath);
        process.env.PATH = ffmpegDir + path.delimiter + process.env.PATH;
        console.log(`[System] Audio Engine Linked: ${ffmpegPath}`);
    }
} catch (e) {
    console.warn('[System] Warning: ffmpeg-static not found. Falling back to system path.');
}

// ── Render/Cloud Port Binding ────────────────────────────────────────────────
const app = express();
const port = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('🚀 Ultra Bot Music Pro is running.'));
app.listen(port, '0.0.0.0', () => console.log(`[System] Web server listening on port ${port}`));

// ── Production Shield (Error Handlers) ────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Critical] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[Critical] Uncaught Exception:', err);
});

// ── Pre-flight: Ensure yt-dlp exists (Auto-download for Linux/Mac servers) ───
async function ensureYtDlp() {
    const platform = process.platform;
    const isLinux = platform === 'linux';
    const isMac   = platform === 'darwin';
    const localPath = path.join(__dirname, 'yt-dlp');
    
    // Check if it already exists in PATH or local folder
    try {
        execSync('yt-dlp --version', { stdio: 'ignore' });
        return; 
    } catch {}
    
    if (fs.existsSync(localPath)) return;

    if (isLinux || isMac) {
        console.log(`[Setup] 📥 yt-dlp not found on ${platform}. Downloading standalone binary...`);
        
        // GitHub release URLs for different platforms
        const suffix = isMac ? '_macos' : '';
        const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${suffix}`;
        
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(localPath);
            https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                // Handle Redirects (GitHub does this)
                if (res.statusCode === 301 || res.statusCode === 302) {
                    https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
                        res2.pipe(file);
                        res2.on('end', () => {
                            fs.chmodSync(localPath, '755');
                            console.log('[Setup] ✅ yt-dlp downloaded and permissions set.');
                            resolve();
                        });
                    });
                    return;
                }
                res.pipe(file);
                res.on('end', () => {
                    fs.chmodSync(localPath, '755');
                    console.log('[Setup] ✅ yt-dlp downloaded and permissions set.');
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(localPath, () => {});
                console.error('[Setup] ❌ Failed to download yt-dlp:', err.message);
                resolve();
            });
        });
    }
}

// ── Client setup ──────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Storage
client.commands      = new Collection(); // Slash command handlers
client.musicPlayers  = new Map();        // guildId → MusicPlayer

// ── Global error handling ─────────────────────────────────────────────────────
process.on('unhandledRejection', err => {
    console.error('[Process] Unhandled rejection:', err);
});
process.on('uncaughtException', err => {
    console.error('[Process] Uncaught exception:', err);
});

// ── Startup ───────────────────────────────────────────────────────────────────
(async () => {
    console.clear();
    console.log('\x1b[32m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\x1b[32m%s\x1b[0m', '  🚀 STARTING ULTRA BOT MUSIC PRO');
    console.log('\x1b[32m%s\x1b[0m', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Ensure yt-dlp is ready
    await ensureYtDlp();

    // 2. Load Commands
    const commandsPath = path.join(__dirname, 'commands');
    for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
        const command = require(path.join(commandsPath, file));
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`[System] Initialized /${command.data.name}`);
        }
    }

    // 3. Load Events
    const eventsPath = path.join(__dirname, 'events');
    for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
        const event = require(path.join(eventsPath, file));
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
    }

    // 4. Login
    if (!process.env.DISCORD_TOKEN) {
        console.error('[Critical] DISCORD_TOKEN is missing in .env!');
        process.exit(1);
    }
    await client.login(process.env.DISCORD_TOKEN);
})();

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const handleShutdown = async (signal) => {
    console.log(`\n[Process] Received ${signal}. Shutting down gracefully...`);
    
    const guildCount = client.musicPlayers.size;
    if (guildCount > 0) {
        console.log(`[Process] Cleaning up ${guildCount} active music players...`);
        for (const player of client.musicPlayers.values()) {
            player.destroy();
        }
    }

    client.destroy();
    console.log('[Process] Finalized cleanup. Goodbye!');
    process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
