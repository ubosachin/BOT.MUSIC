const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music, clear the queue, and leave the voice channel'),

    async execute(interaction) {
        const player = interaction.client.musicPlayers.get(interaction.guildId);

        if (!player) {
            return interaction.reply({ content: '❌ The bot is not playing any music!', ephemeral: true });
        }

        const me = interaction.guild.members.me;
        if (interaction.member.voice.channelId !== me.voice.channelId) {
            return interaction.reply({
                content: '❌ You must be in the **same voice channel** as the bot to stop it!',
                ephemeral: true,
            });
        }

        player.stop();
        await interaction.reply('⏹️ Stopped the music, cleared the queue, and disconnected!');
    },
};
