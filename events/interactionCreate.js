const { Events, MessageFlags } = require('discord.js');
const { buildQueueEmbed } = require('../ui/musicPanel');

// Cooldown map: userId → last interaction timestamp
const cooldowns = new Map();
const COOLDOWN_MS = 1_000; // 1 second per user

// Helper: ephemeral flag (replaces deprecated ephemeral: true)
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

module.exports = {
    name: Events.InteractionCreate,

    async execute(interaction) {
        // ── Slash commands ────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (err) {
                // Ignore harmless race conditions:
                // 10062 = Unknown Interaction (Expired)
                // 40060 = Interaction already acknowledged
                if (err?.code === 10062 || err?.code === 40060) return;

                console.error(`[InteractionCreate] Error in /${interaction.commandName}:`, err);
                const msg = { content: '❌ An error occurred while running that command.', flags: MessageFlags.Ephemeral };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(msg).catch(() => {});
                } else {
                    await interaction.reply(msg).catch(() => {});
                }
            }
            return;
        }

        // ── Button interactions ───────────────────────────────────────
        if (!interaction.isButton()) return;

        const id = interaction.customId;
        if (!id.startsWith('music_')) return;

        console.log(`[UI] Button interaction received: ${id}`);

        // ── Cooldown check ────────────────────────────────────────────
        const now  = Date.now();
        const last = cooldowns.get(interaction.user.id) ?? 0;
        if (now - last < COOLDOWN_MS) {
            return interaction.reply({
                content: '⏳ Please wait a moment before pressing another button.',
                flags:   MessageFlags.Ephemeral,
            });
        }
        cooldowns.set(interaction.user.id, now);

        // ── Fetch player ──────────────────────────────────────────────
        const player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player || !player.currentSong) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        // ── Voice channel guard ───────────────────────────────────────
        const botVcId  = interaction.guild.members.me.voice.channelId;
        const userVcId = interaction.member.voice.channelId;
        if (!userVcId || userVcId !== botVcId) {
            return interaction.reply({
                content: '❌ You must be in the **same voice channel** as the bot to use controls!',
                flags:   MessageFlags.Ephemeral,
            });
        }

        // ── Route button actions ──────────────────────────────────────
        try {
            switch (id) {

                // ⏮ Previous
                case 'music_prev': {
                    const ok = await player.playPrevious();
                    await interaction.reply({
                        content: ok ? '⏮️ Playing previous song.' : '❌ No previous song in history.',
                        flags:   MessageFlags.Ephemeral,
                    });
                    break;
                }

                // ⏸ / ▶️ Pause-Resume toggle
                case 'music_pause': {
                    const nowPaused = player.togglePause();
                    await interaction.reply({
                        content: nowPaused ? '⏸️ Paused.' : '▶️ Resumed.',
                        flags:   MessageFlags.Ephemeral,
                    });
                    break;
                }

                // ⏭ Skip
                case 'music_skip': {
                    player.skip();
                    await interaction.reply({ content: '⏭️ Skipped!', flags: MessageFlags.Ephemeral });
                    break;
                }

                // 🔁 Loop cycle
                case 'music_loop': {
                    const mode   = player.cycleLoop();
                    const labels = { none: '➡️ Loop off', song: '🔂 Looping this song', queue: '🔁 Looping the queue' };
                    await interaction.reply({ content: labels[mode], flags: MessageFlags.Ephemeral });
                    break;
                }

                // 🔀 Shuffle
                case 'music_shuffle': {
                    if (player.queue.isEmpty) {
                        return interaction.reply({ content: '❌ The queue is empty — nothing to shuffle.', flags: MessageFlags.Ephemeral });
                    }
                    player.shuffle();
                    await interaction.reply({ content: '🔀 Queue shuffled!', flags: MessageFlags.Ephemeral });
                    break;
                }

                // 📜 Show queue
                case 'music_queue': {
                    const embed = buildQueueEmbed(player);
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    break;
                }

                // 🔊 Volume up (+10)
                case 'music_volup': {
                    if (player.volume >= 100) {
                        return interaction.reply({ content: '🔊 Already at maximum volume (100%)!', flags: MessageFlags.Ephemeral });
                    }
                    player.setVolume(player.volume + 10);
                    await interaction.reply({ content: `🔊 Volume: **${player.volume}%**`, flags: MessageFlags.Ephemeral });
                    break;
                }

                // 🔉 Volume down (-10)
                case 'music_voldown': {
                    if (player.volume <= 0) {
                        return interaction.reply({ content: '🔇 Already muted (0%)!', flags: MessageFlags.Ephemeral });
                    }
                    player.setVolume(player.volume - 10);
                    await interaction.reply({ content: `🔉 Volume: **${player.volume}%**`, flags: MessageFlags.Ephemeral });
                    break;
                }

                // ▶️ / ⏹ Autoplay toggle
                case 'music_autoplay': {
                    const isNowOn = player.toggleAutoplay();
                    await interaction.reply({
                        content: isNowOn
                            ? '✅ **Autoplay enabled** — I\'ll keep playing related songs when the queue ends.'
                            : '❌ **Autoplay disabled** — Playback will stop when the queue ends.',
                        flags: MessageFlags.Ephemeral,
                    });
                    break;
                }

                // ⏹ Stop
                case 'music_stop': {
                    player.stop();
                    await interaction.reply('⏹️ Stopped and disconnected.');
                    break;
                }

                default:
                    await interaction.reply({ content: '❓ Unknown button.', flags: MessageFlags.Ephemeral });
            }
        } catch (err) {
            console.error('[InteractionCreate] Button handler error:', err);
            try {
                await interaction.reply({ content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral });
            } catch {}
        }
    },
};
