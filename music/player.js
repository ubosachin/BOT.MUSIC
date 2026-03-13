/**
 * music/player.js
 * Core music player — manages voice connection, audio streaming,
 * queue handling, autoplay, loop modes, and the live control panel.
 *
 * Streaming backend: yt-dlp (subprocess) → piped stdout → createAudioResource
 * This is the most reliable approach for 2025+ YouTube extraction since
 * ytdl-core / play-dl cannot parse YouTube's n-transform function and get 403.
 */

'use strict';

const {
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    joinVoiceChannel,
    StreamType,
} = require('@discordjs/voice');

const play           = require('play-dl');        // search + metadata only
const { spawn }      = require('child_process');
const { execSync }   = require('child_process');
const path           = require('path');
const fs             = require('fs');

const { MusicQueue } = require('./queue');
const {
    buildNowPlayingEmbed,
    buildControlButtons,
    buildQueueEmbed,
} = require('../ui/musicPanel');

const { getSpotifyRecommendations } = require('../services/spotify');

const {
    getYT_DLP,
    COOKIES_FILE,
    getYtDlpInfo,
    getYtDlpSearch
} = require('./ytdlp');

// ── Initialize play-dl with cookies for metadata ──────────────────────────────
if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
    try {
        const content = fs.readFileSync(COOKIES_FILE, 'utf8');
        const lines = content.split('\n');
        const cookieArray = [];
        for (const line of lines) {
            if (!line || line.startsWith('#')) continue;
            const parts = line.split('\t');
            if (parts.length >= 7) {
                cookieArray.push(`${parts[5].trim()}=${parts[6].trim()}`);
            }
        }
        if (cookieArray.length > 0) {
            play.setToken({
                youtube: {
                    cookie: cookieArray.join('; ')
                }
            });
            console.log('[Player] ✅ play-dl metadata cookies set.');
        }
    } catch (err) {
        console.warn('[Player] ⚠️  Failed to initialize play-dl cookies:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} url - Full YouTube watch URL
 * @returns {{ stream: NodeJS.ReadableStream, proc: import('child_process').ChildProcess }}
 */
function buildYtDlpArgs(url, fmt, cookiesFile, clientArgs) {
    const args = [
        '-f', fmt,
        '--no-playlist',
        '--quiet',
        '--js-runtimes', 'node',
        ...clientArgs,
        '-o', '-',
    ];
    if (cookiesFile) args.push('--cookies', cookiesFile);
    args.push(url);
    return args;
}

function createYtDlpStream(url, isLive = false, forceNoCookies = false) {
    // Format priority:
    //   - Normal videos: prefer opus/webm, fall back to m4a, then anything audio
    //   - Livestreams:   just take bestaudio (HLS/DASH — no webm available)
    const fmt = isLive
        ? 'bestaudio'
        : 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best';

    // ── Client strategy ───────────────────────────────────────────────────────
    // 1. web_creator  — bypasses n-challenge/signature when cookies are present
    //                   (may emit a 'GVS PO Token' warning, but still streams)
    // 2. web          — standard client + EJS remote solver as last resort
    const useCookies = COOKIES_FILE && !forceNoCookies;
    const primaryArgs = [
        '--extractor-args', 'youtube:player_client=ios,android,web_creator',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        '--force-ipv4',
        '--remote-components', 'ejs:github'
    ];

    const args = buildYtDlpArgs(url, fmt, useCookies ? COOKIES_FILE : null, primaryArgs);

    // Support multi-part commands (e.g. "python3 -m yt_dlp")
    const ytPath = getYT_DLP();
    const cmdParts = ytPath.split(' ');
    const bin = cmdParts[0];
    const finalArgs = [...cmdParts.slice(1), ...args];

    // Pass full environment so yt-dlp can find its cache (HOME, PATH, etc.)
    const proc = spawn(bin, finalArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    // Collect stderr — surface ERRORs to the caller, suppress known-harmless warnings
    const IGNORED_WARNINGS = [
        'GVS PO Token',       // web_creator client warning — streams still work
        'po_token=web_creator', // same
    ];
    let lastError = null;
    proc.stderr.on('data', chunk => {
        const line = chunk.toString().trim();
        if (!line) return;
        if (IGNORED_WARNINGS.some(w => line.includes(w))) return; // suppress harmless noise
        console.warn(`[yt-dlp] ${line}`);
        
        // Error capture logic
        if (line.includes('ERROR:') || line.includes('cookies are no longer valid')) {
            lastError = line;
        }
    });

    proc.stdout.on('data', chunk => {
        if (!proc.hasSentData) {
            console.log(`[Debug] yt-dlp PIPE: First chunk received (${chunk.length} bytes)`);
            proc.hasSentData = true;
        }
    });

    return { stream: proc.stdout, proc, getError: () => lastError };
}


// ─────────────────────────────────────────────────────────────────────────────
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class MusicPlayer {
    /**
     * @param {import('discord.js').Client}      client
     * @param {string}                           guildId
     * @param {import('discord.js').TextChannel} textChannel
     */
    constructor(client, guildId, textChannel) {
        this.client      = client;
        this.guildId     = guildId;
        this.textChannel = textChannel;

        this.queue       = new MusicQueue();
        this.currentSong = null;
        this.connection  = null;
        this.resource    = null;
        this.panelMsg    = null;

        this.loopMode          = 'none'; // 'none' | 'song' | 'queue'
        this.volume            = 80;
        this.autoplay          = true;
        this._paused           = false;
        this._history          = [];
        this._autoplaySeen     = new Set();
        this._autoplayFetching = false;
        this._inactivityTimer  = null;
        this._panelInterval    = null;
        this._ytdlpProc        = null;  // track yt-dlp subprocess

        // ── Audio Player ──────────────────────────────────────────────
        this.audioPlayer = createAudioPlayer();

        this.audioPlayer.on(AudioPlayerStatus.Idle, () => this._onIdle());
        this.audioPlayer.on('error', err => {
            console.error(`[Player] Audio error: ${err.message}`);
            this._onIdle();
        });

        this.audioPlayer.on('stateChange', (oldState, newState) => {
            console.log(`[Debug] AudioPlayer: ${oldState.status} -> ${newState.status}`);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────

    /** Connect to a voice channel. */
    async join(voiceChannel) {
        this.connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        this.guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf:       true,
            debug:          true,
        });

        this.connection.on('stateChange', (oldState, newState) => {
            console.log(`[Debug] Connection: ${oldState.status} -> ${newState.status}`);
        });

        // Ensure we reach READY state before subscribing
        try {
            await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
            console.log(`[Player] Voice Connection Ready in ${this.guildId} ✅`);
            this.connection.subscribe(this.audioPlayer);
        } catch (err) {
            console.error(`[Player] FAILED to reach READY state: ${err.message}`);
            this.destroy();
            throw err;
        }

        this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch {
                this.destroy();
            }
        });

    }

    /** Add a song to queue; start playback if idle. */
    async addSong(song, member) {
        song.requestedBy = member;
        this.queue.add(song);
        this._clearInactivity();

        if (this.audioPlayer.state.status === AudioPlayerStatus.Idle && !this.currentSong) {
            await this._playCurrent();
        }
    }

    /** Skip current track. */
    skip() {
        this.audioPlayer.stop(true);
    }

    /** Toggle pause / resume. Returns new paused state. */
    togglePause() {
        if (this._paused) {
            this.audioPlayer.unpause();
            this._paused = false;
        } else {
            this.audioPlayer.pause();
            this._paused = true;
        }
        this._refreshPanel();
        return this._paused;
    }

    get isPaused() { return this._paused; }

    /** Cycle loop: none → song → queue → none. */
    cycleLoop() {
        if (this.loopMode === 'none')       this.loopMode = 'song';
        else if (this.loopMode === 'song')  this.loopMode = 'queue';
        else                                this.loopMode = 'none';
        this._refreshPanel();
        return this.loopMode;
    }

    /** Shuffle the queue. */
    shuffle() {
        this.queue.shuffle();
        this._refreshPanel();
    }

    /** Set volume 0-100. */
    setVolume(val) {
        this.volume = Math.max(0, Math.min(100, val));
        if (this.resource?.volume) {
            this.resource.volume.setVolume(this.volume / 100);
        }
        this._refreshPanel();
    }

    /** Toggle autoplay. Returns new state. */
    toggleAutoplay() {
        this.autoplay = !this.autoplay;
        if (!this.autoplay) this._autoplaySeen.clear();
        this._refreshPanel();
        return this.autoplay;
    }

    /** Play previous track from history. */
    async playPrevious() {
        if (this._history.length === 0) return false;
        const prev = this._history.pop();
        if (this.currentSong) this.queue.songs.unshift(this.currentSong);
        this.queue.songs.unshift(prev);
        this.currentSong = null;
        this.audioPlayer.stop(true);
        return true;
    }

    /** Stop music and destroy player. */
    stop() {
        this.queue.clear();
        this._paused = false;
        if (this._ytdlpProc) {
            try { this._ytdlpProc.kill('SIGTERM'); } catch {}
            this._ytdlpProc = null;
        }
        this.audioPlayer.stop(true);
        this.currentSong = null;
        this._deletePanel();
        if (this.client.setIdlePresence) this.client.setIdlePresence();
        this.destroy();
    }

    /** Destroy voice connection and clean up. */
    destroy() {
        this._clearInactivity();
        this._stopPanelRefresh();
        this._deletePanel();
        if (this._ytdlpProc) {
            try { this._ytdlpProc.kill('SIGTERM'); } catch {}
            this._ytdlpProc = null;
        }
        try { this.connection?.destroy(); } catch {}
        this.client.musicPlayers.delete(this.guildId);
        console.log(`[Player] Destroyed player for guild ${this.guildId}`);
    }

    /** Get current playback position in seconds. */
    getCurrentTime() {
        if (!this.resource) return 0;
        return Math.floor(this.resource.playbackDuration / 1000);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────

    async _playCurrent(retries = 0, forceNoCookies = false) {
        const song = this.queue.shift();
        if (!song) {
            await this._tryAutoplay();
            return;
        }

        if (this.currentSong) this._history.push(this.currentSong);
        this.currentSong = song;
        this._paused = false;

        // Kill any lingering yt-dlp process from a previous song
        if (this._ytdlpProc) {
            try { this._ytdlpProc.kill('SIGTERM'); } catch {}
            this._ytdlpProc = null;
        }

        try {
            // ── Step 1: Validate / recover URL ───────────────────────────
            let streamUrl = song.streamUrl || song.url;
            const isValidYtUrl = /^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/)/.test(streamUrl);

            if (!isValidYtUrl) {
                console.warn(`[Player] No stream URL for "${song.title}" — searching YouTube...`);
                const results = await play.search(song.title + (song.artist ? ` ${song.artist}` : ''), { limit: 1 });
                if (!results.length) throw new Error('Re-search returned no results.');
                streamUrl = results[0].url;
                song.streamUrl = streamUrl; 
            }
            console.log(`[Player] Validating Stream: ${streamUrl}`);

            // ── Step 2: Spawn yt-dlp, pipe audio → Discord ────────────────
            console.log(`[Player] Fetching stream via yt-dlp${forceNoCookies ? ' (COOKIES DISABLED FALLBACK)' : ''}…`);
            // Livestreams (durationInSec === 0) need a different format selector
            const isLive = !song.durationInSec || song.durationInSec === 0;
            const { stream: ytStream, proc: ytProc, getError } = createYtDlpStream(streamUrl, isLive, forceNoCookies);
            this._ytdlpProc = ytProc;

            // Wait for data to flow — but also honour yt-dlp ERROR lines and exit codes.
            await new Promise((resolve, reject) => {
                let settled = false;
                const done = (fn) => { if (!settled) { settled = true; fn(); } };

                ytProc.once('error', err => done(() => reject(err)));
                ytStream.once('error', err => done(() => reject(err)));

                ytProc.once('exit', code => {
                    if (code !== 0) {
                        done(() => reject(new Error(
                            getError() || `yt-dlp exited with code ${code}`
                        )));
                    }
                });

                ytStream.once('readable', () => {
                    setTimeout(() => {
                        const err = getError();
                        if (err) {
                            done(() => reject(new Error(err)));
                        } else {
                            done(() => resolve());
                        }
                    }, 450);
                });
            });

            // ── Step 3: Hand stream to @discordjs/voice ───────────────────
            console.log(`[Debug] Creating AudioResource (Type: Arbitrary)...`);
            this.resource = createAudioResource(ytStream, {
                inputType:    StreamType.Arbitrary,
                inlineVolume: true,
            });
            this.resource.volume.setVolume(this.volume / 100);

            this.resource.playStream.on('error', err => {
                console.error(`[Debug] Resource PlayStream Error: ${err.message}`);
            });

            console.log('[Player] Stream ready');
            this.audioPlayer.play(this.resource);
            if (!this._songsPlayed) this._songsPlayed = 0;
            this._songsPlayed++;

            await this._sendOrUpdatePanel();
            this._startPanelRefresh();
            this._clearInactivity();
            console.log(`[Player] ▶ Now playing: "${song.title}"`);

            if (this.client.setNowPlaying) this.client.setNowPlaying(song);

        } catch (err) {
            console.error(`[Player] Stream failed for "${song.title}": ${err.message}`);

            // User Requirement: If YouTube streaming fails, retry search with keywords
            if (retries === 0) {
                console.log(`[Player] 🔄 Retrying search with keywords for "${song.title}"…`);
                try {
                    const keywords = ['lyrics', 'audio', 'official'];
                    let found = null;
                    for (const kw of keywords) {
                        try {
                            const query = `${song.title} ${song.artist || ''} ${kw}`;
                            const res = await getYtDlpSearch(query);
                            if (res) { 
                                found = res; 
                                break; 
                            }
                        } catch (e) {}
                    }
                    if (found) {
                        console.log(`[Player] ✅ Found alternative stream: ${found.url}`);
                        song.streamUrl = found.url;
                        this.queue.songs.unshift(song);
                        return this._playCurrent(retries + 1);
                    }
                } catch (e) {
                    console.error('[Player] Keyword retry failed.');
                }
            }

            if (retries < 2) {
                console.log(`[Player] Skipping to next song after failure…`);
                this.textChannel.send('⚠️ Could not find a playable version of this track.').catch(() => {});
                this.currentSong = null;
                await this._playCurrent(retries + 1);
            } else {
                console.error('[Player] Too many consecutive errors — stopping.');
                this.textChannel
                    .send('❌ Too many playback errors. Stopping.')
                    .catch(() => {});
                this.currentSong = null;
                this._setInactivity();
                this._deletePanel();
            }
        }
    }

    async _onIdle() {
        this._stopPanelRefresh();

        if (this.loopMode === 'song' && this.currentSong) {
            this.queue.songs.unshift(this.currentSong);
        } else if (this.loopMode === 'queue' && this.currentSong) {
            this.queue.add(this.currentSong);
        }

        if (!this.queue.isEmpty) {
            await this._playCurrent();
        } else {
            await this._tryAutoplay();
        }
    }

    async _tryAutoplay() {
        if (!this.autoplay) {
            console.log('[Player] Autoplay is OFF — stopping after queue end.');
            this._setInactivity();
            this._deletePanel();
            return;
        }

        if (!this.currentSong) {
            this._setInactivity();
            this._deletePanel();
            return;
        }

        if (this._autoplayFetching) {
            console.log('[Player] Autoplay fetch already in progress — skipping.');
            return;
        }

        this._autoplayFetching = true;
        const baseSong = this.currentSong;
        console.log(`[Player] Autoplay › Finding next track for "${baseSong.title}"…`);

        try {
            this._autoplaySeen.add(baseSong.url);

            let picked = null;

            // 1. Try Spotify recommendations FIRST
            if (baseSong.spotifyId) {
                try {
                    picked = await getSpotifyRecommendations(baseSong.spotifyId);
                    if (picked && this._autoplaySeen.has(picked.url)) picked = null; // already heard
                } catch (err) {
                    console.warn('[Player] Spotify recommendations failed. Falling back to YouTube search...');
                }
            }

            // 2. Fallback to YouTube search if Spotify fails or no ID
            if (!picked) {
                const queries = [
                    `${baseSong.title} official audio`,
                    `${baseSong.artist} mix`,
                ];

                for (const query of queries) {
                    if (picked) break;
                    const results = await play.search(query, { limit: 5, source: { youtube: 'video' } });
                    const fresh   = results.filter(r =>
                        r.url &&
                        !this._autoplaySeen.has(r.url) &&
                        r.durationInSec > 30 &&
                        r.durationInSec < 600
                    );
                    if (fresh.length > 0) {
                        const p = fresh[0];
                        picked = {
                            title:         p.title,
                            url:           p.url,
                            thumbnail:     p.thumbnails?.[0]?.url || '',
                            durationRaw:   p.durationRaw || '?',
                            durationInSec: p.durationInSec || 0,
                            source:        'youtube'
                        };
                    }
                }
            }

            if (!picked) throw new Error('No fresh autoplay results.');

            // Cap seen history at 50
            if (this._autoplaySeen.size > 50) {
                this._autoplaySeen.delete(this._autoplaySeen.values().next().value);
            }
            this._autoplaySeen.add(picked.url);

            const next = {
                ...picked,
                requestedBy: null,
            };

            this.queue.add(next);
            this.textChannel.send(`✨ **Autoplay** › Next: **${next.title}** \`${next.durationRaw}\``).catch(() => {});
            await this._playCurrent();
        } catch (err) {
            console.warn('[Player] Autoplay failed:', err.message);
            this.textChannel.send('⚠️ Autoplay could not find a fresh song. Stopping.').catch(() => {});
            this._setInactivity();
            this._deletePanel();
        } finally {
            this._autoplayFetching = false;
        }
    }

    // ── Panel helpers ─────────────────────────────────────────────────

    async _sendOrUpdatePanel() {
        const embed   = buildNowPlayingEmbed(this.currentSong, this);
        const buttons = buildControlButtons(this._paused, this.autoplay);

        try {
            if (this.panelMsg) {
                await this.panelMsg.edit({ embeds: [embed], components: buttons });
            } else {
                this.panelMsg = await this.textChannel.send({ embeds: [embed], components: buttons });
            }
        } catch {
            try {
                this.panelMsg = await this.textChannel.send({ embeds: [embed], components: buttons });
            } catch {}
        }
    }

    _startPanelRefresh() {
        this._stopPanelRefresh();
        this._panelInterval = setInterval(() => {
            if (this.currentSong && !this._paused) this._refreshPanel();
        }, 15_000);
    }

    _stopPanelRefresh() {
        if (this._panelInterval) {
            clearInterval(this._panelInterval);
            this._panelInterval = null;
        }
    }

    async _refreshPanel() {
        if (!this.currentSong || !this.panelMsg) return;
        const embed   = buildNowPlayingEmbed(this.currentSong, this);
        const buttons = buildControlButtons(this._paused, this.autoplay);
        try { await this.panelMsg.edit({ embeds: [embed], components: buttons }); } catch {}
    }

    async _deletePanel() {
        this._stopPanelRefresh();
        if (this.panelMsg) {
            try { await this.panelMsg.delete(); } catch {}
            this.panelMsg = null;
        }
    }

    // ── Inactivity timer ──────────────────────────────────────────────

    _setInactivity() {
        this._clearInactivity();
        this._inactivityTimer = setTimeout(() => {
            this.textChannel.send('👋 Leaving voice channel due to **5 minutes of inactivity**.').catch(() => {});
            this.destroy();
        }, INACTIVITY_TIMEOUT_MS);
        console.log('[Player] Inactivity timer started (5 min).');
    }

    _clearInactivity() {
        if (this._inactivityTimer) {
            clearTimeout(this._inactivityTimer);
            this._inactivityTimer = null;
        }
    }
}

module.exports = { MusicPlayer, getYtDlpInfo, getYtDlpSearch };
