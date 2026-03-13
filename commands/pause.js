const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current song'),

    async execute(interaction) {
        const player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player || !player.currentSong) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
        }

        if (player.isPaused) {
            return interaction.reply({ content: '⏸️ Music is already paused!', ephemeral: true });
        }

        player.togglePause();
        await interaction.reply('⏸️ Paused the music!');
    },
};
