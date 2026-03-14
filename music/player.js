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

const prism          = require('prism-media');
const { spawn }      = require('child_process');
const path           = require('path');
const fs             = require('fs');

const { MusicQueue } = require('./queue');
const {
    buildNowPlayingEmbed,
    buildControlButtons,
    buildQueueEmbed,
} = require('../ui/musicPanel');

const { getSpotifyRecommendations } = require('../services/spotify');
const { searchSoundCloud, getSoundCloudStream } = require('../services/soundcloud');

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

    async addSong(song, member) {
        song.requestedBy = member;
        this.queue.add(song);
        this._clearInactivity();

        if (this.audioPlayer.state.status === AudioPlayerStatus.Idle && !this.currentSong) {
            await this._playCurrent();
        }
    }

    skip() {
        this.audioPlayer.stop(true);
    }

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

    cycleLoop() {
        if (this.loopMode === 'none')       this.loopMode = 'song';
        else if (this.loopMode === 'song')  this.loopMode = 'queue';
        else                                this.loopMode = 'none';
        this._refreshPanel();
        return this.loopMode;
    }

    shuffle() {
        this.queue.shuffle();
        this._refreshPanel();
    }

    setVolume(val) {
        this.volume = Math.max(0, Math.min(100, val));
        if (this.resource?.volume) {
            this.resource.volume.setVolume(this.volume / 100);
        }
        this._refreshPanel();
    }

    toggleAutoplay() {
        this.autoplay = !this.autoplay;
        if (!this.autoplay) this._autoplaySeen.clear();
        this._refreshPanel();
        return this.autoplay;
    }

    async playPrevious() {
        if (this._history.length === 0) return false;
        const prev = this._history.pop();
        if (this.currentSong) this.queue.songs.unshift(this.currentSong);
        this.queue.songs.unshift(prev);
        this.currentSong = null;
        this.audioPlayer.stop(true);
        return true;
    }

    stop() {
        this.queue.clear();
        this._paused = false;
        this.audioPlayer.stop(true);
        this.currentSong = null;
        this._deletePanel();
        if (this.client.setIdlePresence) this.client.setIdlePresence();
        this.destroy();
    }

    destroy() {
        this._clearInactivity();
        this._stopPanelRefresh();
        this._deletePanel();
        try { this.connection?.destroy(); } catch {}
        this.client.musicPlayers.delete(this.guildId);
        console.log(`[Player] Destroyed player for guild ${this.guildId}`);
    }

    getCurrentTime() {
        if (!this.resource) return 0;
        return Math.floor(this.resource.playbackDuration / 1000);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────

    async _playCurrent(retries = 0) {
        const song = this.queue.shift();
        if (!song) {
            await this._tryAutoplay();
            return;
        }

        if (this.currentSong) this._history.push(this.currentSong);
        this.currentSong = song;
        this._paused = false;

        try {
            // ── Step 1: SoundCloud Matching ──────────────────────────────
            let streamUrl = song.streamUrl || song.url;
            const isSoundCloudUrl = streamUrl?.includes('soundcloud.com');

            if (!isSoundCloudUrl) {
                console.log(`[Spotify] Converting to SoundCloud search...`);
                const searchQuery = `${song.artist} ${song.title}`;
                const match = await searchSoundCloud(searchQuery);
                
                if (!match) {
                    throw new Error('⚠️ Could not find this track on SoundCloud.');
                }
                
                streamUrl = match.url;
                song.streamUrl = streamUrl;
                // Update missing metadata from SoundCloud if needed
                if (!song.duration) song.duration = match.duration;
            }

            console.log(`[SoundCloud] Stream ready`);
            const stream = await getSoundCloudStream(streamUrl);

            // ── Step 2: Create Audio Resource ────────────────────────────
            console.log(`[Debug] Creating AudioResource (Type: Arbitrary)...`);
            this.resource = createAudioResource(stream, {
                inputType:    StreamType.Arbitrary,
                inlineVolume: true,
            });
            this.resource.volume.setVolume(this.volume / 100);

            this.resource.playStream.on('error', err => {
                console.error(`[Debug] Resource Internal Stream Error: ${err.message}`);
            });
            
            this.resource.playStream.on('end', () => {
                console.log('[Debug] Resource playStream ended.');
            });

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

            if (retries < 2) {
                console.log(`[Player] Skipping to next song after failure…`);
                this.textChannel.send(`⚠️ Stream failed for **${song.title}**: ${err.message}`).catch(() => {});
                this.currentSong = null;
                await this._playCurrent(retries + 1);
            } else {
                console.error('[Player] Too many consecutive errors — stopping.');
                this.textChannel.send('❌ Too many playback errors. Stopping.').catch(() => {});
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
        if (!this.autoplay || !this.currentSong) {
            this._setInactivity();
            this._deletePanel();
            return;
        }

        if (this._autoplayFetching) return;

        this._autoplayFetching = true;
        const baseSong = this.currentSong;
        console.log(`[Player] Autoplay › Finding next track for "${baseSong.title}"…`);

        try {
            this._autoplaySeen.add(baseSong.url);

            const nextMeta = await getSpotifyRecommendations(baseSong.spotifyId);
            if (!nextMeta || this._autoplaySeen.has(nextMeta.url)) {
                throw new Error('No fresh autoplay results.');
            }

            if (this._autoplaySeen.size > 50) {
                this._autoplaySeen.delete(this._autoplaySeen.values().next().value);
            }
            this._autoplaySeen.add(nextMeta.url);

            this.queue.add(nextMeta);
            this.textChannel.send(`✨ **Autoplay** › Next: **${nextMeta.title}**`).catch(() => {});
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

    _setInactivity() {
        this._clearInactivity();
        this._inactivityTimer = setTimeout(() => {
            this.textChannel.send('👋 Leaving voice channel due to **5 minutes of inactivity**.').catch(() => {});
            this.destroy();
        }, INACTIVITY_TIMEOUT_MS);
    }

    _clearInactivity() {
        if (this._inactivityTimer) {
            clearTimeout(this._inactivityTimer);
            this._inactivityTimer = null;
        }
    }
}

module.exports = { MusicPlayer };
