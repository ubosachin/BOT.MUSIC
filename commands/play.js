/**
 * commands/play.js
 *
 * /play command — accepts:
 *   • YouTube video URL
 *   • YouTube search query
 *   • Spotify track URL   → fetches metadata from Spotify, streams via YouTube
 *   • Spotify playlist URL → queues all tracks
 *   • Spotify album URL   → queues all tracks
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const play = require('play-dl');
const { MusicPlayer, getYtDlpInfo, getYtDlpSearch } = require('../music/player');
const { searchSpotify, resolveSpotifyLink } = require('../services/spotify');

const isSpotifyUrl = (url) => /^(https?:\/\/)?(open\.spotify\.com)\/.+$/.test(url);
const isYouTubeUrl = (url) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/.test(url);
const isBotError   = (err) => /confirm you(’|')re not a bot/i.test(err.message);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('High-quality music from Spotify (primary) or YouTube')
        .addStringOption(opt =>
            opt.setName('query')
                .setDescription('Spotify link, playlist, artist name, or song title')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();
        } catch (e) {
            if (e.code === 10062 || e.code === 40060) return;
            throw e;
        }

        const query        = interaction.options.getString('query').trim();
        const voiceChannel = interaction.member.voice.channel;
        const me           = interaction.guild.members.me;

        if (!voiceChannel) {
            return interaction.editReply('❌ You must be in a **voice channel** to play music!');
        }

        let player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player) {
            player = new MusicPlayer(interaction.client, interaction.guildId, interaction.channel);
            interaction.client.musicPlayers.set(interaction.guildId, player);
        }
        player.textChannel = interaction.channel;

        if (!player.connection) {
            await player.join(voiceChannel);
        }

        // 1. Detect input & route
        if (isSpotifyUrl(query)) {
            console.log('[Input] Spotify link detected');
            return handleSpotify(interaction, player, query);
        }

        if (isYouTubeUrl(query)) {
            console.log('[Input] YouTube link detected');
            return handleYouTubeDirect(interaction, player, query);
        }

        // 3. Simple text search -> Spotify first
        console.log('[Input] Song name detected');
        return handleQuery(interaction, player, query);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Spotify handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleSpotify(interaction, player, url) {
    try {
        await interaction.editReply('🟢 **Fetching Spotify tracks...**');
        const songs = await resolveSpotifyLink(url, interaction.member);

        if (!songs || songs.length === 0) {
            return interaction.editReply('❌ Could not find any playable songs for this Spotify link.');
        }

        if (songs.length === 1) {
            const pos = player.queue.length;
            await player.addSong(songs[0], interaction.member);
            const action = (pos === 0 && !player.currentSong) ? 'Playing now' : `Queued at position **#${pos + 1}**`;
            return interaction.editReply(`🟢 **Spotify Resolving** ✅\n▶️ ${action}: **${songs[0].title}** — *${songs[0].artist}*`);
        } else {
            // Multi-loading
            await interaction.editReply(`📚 Loading **${songs.length}** tracks into the queue...`);
            for (const s of songs) {
                await player.addSong(s, interaction.member);
            }
            return interaction.editReply(`✅ **Spotify Loaded** successfully: **${songs.length} tracks** added.`);
        }
    } catch (err) {
        console.error('[play.js] Spotify error:', err.message);
        return interaction.editReply(`⚠️ Spotify error: \`${err.message}\``);
    }
}

/**
 * Handle Text Query (Spotify-First)
 */
async function handleQuery(interaction, player, query) {
    try {
        await interaction.editReply('🔍 **Searching Spotify...**');
        const song = await searchSpotify(query, interaction.member);

        const pos = player.queue.length;
        await player.addSong(song, interaction.member);
        
        const action = (pos === 0 && !player.currentSong) ? 'Playing now' : `Queued at position **#${pos + 1}**`;
        return interaction.editReply(`🟢 **Spotify Resolving** ✅\n▶️ ${action}: **${song.title}** — *${song.artist}*`);

    } catch (err) {
        let errorDetail = err.message || '';
        if (err.statusCode) errorDetail += ` (HTTP ${err.statusCode})`;
        if (err.body) errorDetail += ` - ${JSON.stringify(err.body)}`;
        if (!errorDetail) errorDetail = JSON.stringify(err, Object.getOwnPropertyNames(err));
        
        console.warn(`[play.js] Spotify search failed for "${query}": ${errorDetail}. Trying Universal Search...`);
        
        // Universal Search Fallback (YouTube Search via yt-dlp)
        try {
            await interaction.editReply('🔍 Spotify failed. Searching **Universal Database**...');
            
            // Tier 1: yt-dlp Search (More robust on Cloud IPs than play-dl)
            let song = null;
            try {
                console.log(`[Search] Attempting yt-dlp search for "${query}"`);
                song = await getYtDlpSearch(query);
            } catch (ytdlpErr) {
                console.warn(`[play.js] yt-dlp primary search failed: ${ytdlpErr.message}`);
            }

            // Tier 2: Keyword-enriched search
            if (!song) {
                try {
                    console.log(`[Search] Attempting enriched search: "${query} audio"`);
                    song = await getYtDlpSearch(`${query} audio`);
                } catch (ytdlpErr) {
                    console.warn(`[play.js] enriched search also failed.`);
                }
            }

            if (!song) {
                return interaction.editReply('❌ No results found in the Universal Database. Try a different query.');
            }

            const pos = player.queue.length;
            await player.addSong(song, interaction.member);
            const action = (pos === 0 && !player.currentSong) ? 'Playing now' : `Queued at position **#${pos + 1}**`;
            return interaction.editReply(`🔍 **Universal Search** ✅\n▶️ ${action}: **${song.title}**`);

        } catch (fail) {
            console.error('[play.js] Backup failed:', fail.message);
            return interaction.editReply('⚠️ Could not find a playable version of this track.');
        }
    }
}

async function handleYouTubeDirect(interaction, player, query) {
    const isBotError = (err) => /confirm you(’|')re not a bot/i.test(err.message);
    const type = play.yt_validate(query);
    
    try {
        if (type === 'video') {
            await interaction.editReply('📺 Resolving YouTube video…');
            let song;
            try {
                const info = await play.video_info(query);
                const v    = info.video_details;
                song = {
                    title:         v.title,
                    artist:        v.channel?.name || '',
                    url:           v.url,
                    thumbnail:     v.thumbnails?.[0]?.url || '',
                    durationRaw:   v.durationRaw,
                    durationInSec: v.durationInSec,
                    source:        'youtube',
                };
            } catch (err) {
                if (isBotError(err)) {
                    console.log('[play.js] play-dl blocked on direct URL. Falling back to yt-dlp info...');
                    song = await getYtDlpInfo(query);
                } else {
                    throw err;
                }
            }
            
            const pos = player.queue.length;
            await player.addSong(song, interaction.member);
            const action = pos > 0 ? `Queued at position **#${pos + 1}**` : 'Playing now';
            return interaction.editReply(`📺 YouTube Direct ✅\n▶️ ${action}: **${song.title}**`);

        } else if (type === 'playlist') {
            await interaction.editReply('📋 Loading YouTube playlist…');
            const playlist = await play.playlist_info(query, { incomplete: true });
            const videos   = await playlist.all_videos();

            for (const v of videos) {
                const song = {
                    title:         v.title,
                    artist:        v.channel?.name || '',
                    url:           v.url,
                    thumbnail:     v.thumbnails[0]?.url || '',
                    durationRaw:   v.durationRaw,
                    durationInSec: v.durationInSec,
                    source:        'youtube',
                };
                await player.addSong(song, interaction.member);
            }
            return interaction.editReply(`📋 YouTube Playlist → Loaded **${videos.length} videos** into the queue!`);
        }
    } catch (err) {
        console.error('[play.js] YouTube Direct error:', err.message);
        const errorMsg = isBotError(err) || err.message.includes('Bot Detection')
            ? '❌ YouTube is blocking direct links.\n\n**To fix this:**\n1. Update `cookies.txt` in the bot folder.\n2. Or search by name (Spotify primary).'
            : '❌ Could not load this YouTube link.';
        return interaction.editReply(errorMsg);
    }
}
