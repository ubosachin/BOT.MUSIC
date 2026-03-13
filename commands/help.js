const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all music bot commands'),

    async execute(interaction) {
        console.log(`[Command] Executing help`);
        
        const embed = new EmbedBuilder()
            .setColor('#1DB954')
            .setAuthor({ name: 'ULTRA BOT MUSIC • HELP CENTER', iconURL: interaction.client.user.displayAvatarURL() })
            .setTitle('🚀 How to use Ultra Bot Music')
            .setDescription('Experience high-fidelity audio with Spotify-first search and YouTube backup.')
            .addFields(
                {
                    name: '🎵 CORE COMMANDS',
                    value: [
                        '➥ `/play <query>` — Search **Spotify** (Hi-Fi)',
                        '➥ `/play <url>` — Direct Spotify/YouTube links',
                        '➥ `/pause` • `/resume` — Control playback',
                        '➥ `/skip` — Play next in queue',
                        '➥ `/stop` — Terminate session'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '✨ ADVANCED TOOLS',
                    value: [
                        '➥ `/queue` — View live session queue',
                        '➥ `/autoplay` — Toggle **Smart Radio** mode',
                        '➥ `/volume` — Adjust audio gain (0-100)',
                        '➥ `/nowplaying` — Show detailed panel'
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: 'Ultra Bot Music • Precision Audio Engine • v2.0' })
            .setTimestamp();

        try {
            await interaction.reply({ embeds: [embed] });
        } catch (err) {
            console.error('[Help] Error sending help embed:', err);
            await interaction.reply({ 
                content: '⚠️ Something went wrong while executing this command.', 
                ephemeral: true 
            }).catch(() => {});
        }
    },
};
