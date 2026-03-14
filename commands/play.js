/**
 * commands/play.js
 *
 * /play command — accepts:
 *   • Spotify link, playlist, album
 *   • SoundCloud link
 *   • Song name (searches Spotify)
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { MusicPlayer } = require('../music/player');
const { searchSpotify, resolveSpotifyLink } = require('../services/spotify');

const isSpotifyUrl    = (url) => /^(https?:\/\/)?(open\.spotify\.com)\/.+$/.test(url);
const isSoundCloudUrl = (url) => /^(https?:\/\/)?(www\.)?(soundcloud\.com)\/.+$/.test(url);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('High-quality music from Spotify & SoundCloud (No YouTube)')
        .addStringOption(opt =>
            opt.setName('query')
                .setDescription('Spotify link, SoundCloud link, or song name')
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

        if (isSpotifyUrl(query)) {
            console.log('[Spotify] Link detected');
            return handleSpotify(interaction, player, query);
        }

        if (isSoundCloudUrl(query)) {
            console.log('[SoundCloud] Link detected');
            return handleSoundCloud(interaction, player, query);
        }

        console.log('[Spotify] Searching for song name...');
        return handleQuery(interaction, player, query);
    },
};

// ─────────────────────────────────────────────────────────────────────────────

async function handleSpotify(interaction, player, url) {
    try {
        await interaction.editReply('🟢 **Fetching Spotify tracks...**');
        const songs = await resolveSpotifyLink(url);

        if (!songs || songs.length === 0) {
            return interaction.editReply('❌ Could not find any tracks for this Spotify link.');
        }

        for (const s of songs) {
            await player.addSong(s, interaction.member);
        }

        if (songs.length === 1) {
            return interaction.editReply(`🟢 **Spotify Resolving** ✅\n▶️ Added: **${songs[0].title}** — *${songs[0].artist}*`);
        } else {
            return interaction.editReply(`✅ **Spotify Loaded**: **${songs.length} tracks** added to queue.`);
        }
    } catch (err) {
        console.error('[play.js] Spotify error:', err.message);
        return interaction.editReply(`⚠️ Spotify error: \`${err.message}\``);
    }
}

async function handleSoundCloud(interaction, player, url) {
    try {
        await interaction.editReply('🟠 **Resolving SoundCloud link...**');
        const song = {
            title: 'SoundCloud Track',
            artist: 'SoundCloud',
            url: url,
            source: 'soundcloud'
        };
        
        await player.addSong(song, interaction.member);
        return interaction.editReply(`🟠 **SoundCloud Ready** ✅\n▶️ Added: **${url}**`);
    } catch (err) {
        return interaction.editReply(`❌ SoundCloud error: ${err.message}`);
    }
}

async function handleQuery(interaction, player, query) {
    try {
        await interaction.editReply('🔍 **Searching Spotify...**');
        const song = await searchSpotify(query);

        await player.addSong(song, interaction.member);
        return interaction.editReply(`🟢 **Spotify Resolving** ✅\n▶️ Added: **${song.title}** — *${song.artist}*`);
    } catch (err) {
        console.error('[play.js] Search failed:', err.message);
        return interaction.editReply('⚠️ Could not find this track on Spotify.');
    }
}
