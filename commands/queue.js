const { SlashCommandBuilder } = require('discord.js');
const { buildQueueEmbed } = require('../ui/musicPanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue'),

    async execute(interaction) {
        const player = interaction.client.musicPlayers.get(interaction.guildId);

        if (!player || (!player.currentSong && player.queue.isEmpty)) {
            return interaction.reply({ content: '❌ The queue is currently empty!', ephemeral: true });
        }

        const embed = buildQueueEmbed(player);
        await interaction.reply({ embeds: [embed], ephemeral: false });
    },
};
