const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),

    async execute(interaction) {
        const player = interaction.client.musicPlayers.get(interaction.guildId);
        if (!player || !player.currentSong) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (interaction.member.voice.channelId !== me.voice.channelId) {
            return interaction.reply({ content: '❌ You must be in the same voice channel!', ephemeral: true });
        }

        player.skip();
        await interaction.reply('⏭️ Skipped the current song!');
    },
};
