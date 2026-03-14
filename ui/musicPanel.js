/**
 * ui/musicPanel.js
 *
 * Ultra-premium, Gen-Z styled music control panel.
 * Designed to look like a modern streaming app (Spotify/Apple Music).
 * Updated for Spotify + SoundCloud architecture.
 */

'use strict';

const {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
} = require('discord.js');

const PROGRESS_EMPTY = '▢';
const PROGRESS_FULL = '▰';
const PROGRESS_HEAD = '🔘';

/**
 * Modern Progress Bar
 */
function buildProgressBar(current, total, size = 15) {
    if (!total || total === 0) return `${PROGRESS_HEAD}${PROGRESS_EMPTY.repeat(size)}`;
    const progress = Math.min(current / total, 1);
    const filledSize = Math.round(size * progress);
    const emptySize = size - filledSize;

    const bar = PROGRESS_FULL.repeat(filledSize) + PROGRESS_HEAD + PROGRESS_EMPTY.repeat(Math.max(0, emptySize));
    return `**${bar}**`;
}

/**
 * Format seconds to M:SS or H:MM:SS
 */
function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Session duration tracker
 */
function getSessionTime(player) {
    if (!player._sessionStart) return '0:00';
    const elapsed = Math.floor((Date.now() - player._sessionStart) / 1000);
    return formatTime(elapsed);
}

/**
 * Main Now Playing Panel
 */
function buildNowPlayingEmbed(song, player) {
    const cur = player.getCurrentTime();
    const total = song.duration || 0;
    
    // Dynamic color based on source
    const embedColor = song.source === 'spotify' ? '#1DB954' : '#FF5500'; // Spotify Green vs SoundCloud Orange

    if (!player._sessionStart) player._sessionStart = Date.now();
    if (!player._songsPlayed) player._songsPlayed = 0;

    const progressBar = buildProgressBar(cur, total);
    const timeInfo = `\`${formatTime(cur)} / ${formatTime(total)}\``;

    // Queue Preview (Next 3 songs)
    const nextSongs = player.queue.songs.slice(0, 3);
    let upNextStr = nextSongs.length > 0 
        ? nextSongs.map((s, i) => `\`${i + 1}.\` [${s.title}](${s.url})`).join('\n')
        : '_No more songs in queue_';

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: player._paused ? '⏸️ PAUSED' : '🎵 NOW PLAYING',
            iconURL: song.source === 'spotify' 
                ? 'https://upload.wikimedia.org/wikipedia/commons/1/19/Spotify_logo_without_text.svg' 
                : 'https://upload.wikimedia.org/wikipedia/commons/a/af/Soundcloud_logo.svg'
        })
        .setTitle(song.title)
        .setURL(song.url)
        .setDescription(
            `**${song.artist || 'Unknown Artist'}**\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${progressBar}\n` +
            `${timeInfo}\n\n` +
            `🔹 **Audio Source**: \`Ultra SoundCloud\`\n` +
            `🔹 **Metadata**: \`Hybrid Spotify Pro v3\``
        )
        .setImage(song.thumbnail)
        .addFields(
            { name: '👤 Requester', value: `${song.requestedBy ? `<@${song.requestedBy.id}>` : '`Autoplay ✨`'}`, inline: true },
            { name: '🌐 Driver', value: `\`${song.source.toUpperCase()}\``, inline: true },
            { name: '🔊 Volume', value: `\`${player.volume}%\``, inline: true },
            
            { name: '🔁 Loop', value: `\`${player.loopMode.toUpperCase()}\``, inline: true },
            { name: '✨ Smart Autoplay', value: `\`${player.autoplay ? 'Active' : 'Disabled'}\``, inline: true },
            { name: '📜 Queue', value: `\`${player.queue.length} left\``, inline: true },

            { name: '📊 Tracker', value: `🎵 **${player._songsPlayed}** tracks • ⏱ **${getSessionTime(player)}** uptime`, inline: false },
            { name: '⏭ UP NEXT', value: upNextStr, inline: false }
        )
        .setFooter({ text: 'Ultra Bot Music Pro • Advanced Audio Hub • v3.0' })
        .setTimestamp();

    return embed;
}

/**
 * Modern Control Buttons
 */
function buildControlButtons(isPaused = false, autoplay = true) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_prev')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setEmoji(isPaused ? '▶️' : '⏸️')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setEmoji('🔀')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_voldown')
            .setEmoji('🔉')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_volup')
            .setEmoji('🔊')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_queue')
            .setEmoji('📜')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_autoplay')
            .setEmoji('✨')
            .setLabel(autoplay ? 'Autoplay On' : 'Autoplay Off')
            .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    return [row1, row2];
}

/**
 * Standard Queue Embed
 */
function buildQueueEmbed(player) {
    const songs = player.queue.songs;
    const current = player.currentSong;
    
    const embed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle('📜 Live Queue')
        .setDescription(
            `**Now Playing**: [${current.title}](${current.url})\n` +
            `━━━━━━━━━━━━━━━━━━━━`
        )
        .setTimestamp();

    if (songs.length === 0) {
        embed.addFields({ name: 'Up Next', value: '_The queue is empty. Add more songs or enable Autoplay!_ ' });
    } else {
        const list = songs.slice(0, 10).map((s, i) => `\`${i + 1}.\` **[${s.title}](${s.url})**`).join('\n');
        embed.addFields({ 
            name: `Up Next (${songs.length} total)`, 
            value: list + (songs.length > 10 ? `\n\n_...and ${songs.length - 10} more tracks_` : '') 
        });
    }

    embed.setFooter({ text: 'Ultra Bot Music • SoundCloud Engine' });

    return embed;
}

module.exports = {
    buildNowPlayingEmbed,
    buildControlButtons,
    buildQueueEmbed,
    formatTime,
    buildProgressBar,
};
