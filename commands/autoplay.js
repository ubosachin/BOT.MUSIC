const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle smart autoplay mode'),

    async execute(interaction) {
        let player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player) {
            return interaction.reply({ content: '❌ The bot is not active in this guild.', ephemeral: true });
        }

        const isNowOn = player.toggleAutoplay();
        await interaction.reply(
            isNowOn
                ? '✨ **Autoplay enabled** — I\'ll keep playing related songs!'
                : '💤 **Autoplay disabled** — Playback will stop when the queue ends.'
        );
    },
};
