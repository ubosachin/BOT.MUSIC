const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Adjust the player volume')
        .addIntegerOption(opt =>
            opt.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
        ),

    async execute(interaction) {
        const player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
        }

        const level = interaction.options.getInteger('level');
        player.setVolume(level);
        await interaction.reply(`🔊 Volume set to **${level}%**`);
    },
};
