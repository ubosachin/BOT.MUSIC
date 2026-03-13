const { Events, ActivityType } = require('discord.js');

// Idle presence rotates every 10 seconds to look alive
const IDLE_ACTIVITIES = [
    { name: '/play — add a song!',      type: ActivityType.Listening },
    { name: 'your music requests 🎵',   type: ActivityType.Listening },
    { name: 'the queue 📋',             type: ActivityType.Watching  },
    { name: 'Ultra Bot Music 🎧',       type: ActivityType.Playing   },
];

module.exports = {
    name: Events.ClientReady,
    once: true,

    execute(client) {
        const separator = '━'.repeat(40);
        console.log(`\n${separator}`);
        console.log(`  🎵  Discord Music Bot v2.0`);
        console.log(`  ✅  Logged in as: ${client.user.tag}`);
        console.log(`  🌐  Serving: ${client.guilds.cache.size} guild(s)`);
        console.log(`${separator}\n`);

        // Set initial idle presence
        let idleIdx = 0;
        const setIdlePresence = () => {
            // Only rotate if nothing is actively playing across any guild
            const anyPlaying = [...client.musicPlayers.values()].some(p => p.currentSong);
            if (anyPlaying) return;

            const act = IDLE_ACTIVITIES[idleIdx % IDLE_ACTIVITIES.length];
            client.user.setPresence({
                activities: [act],
                status: 'online',
            });
            idleIdx++;
        };

        // Expose helper on client so player.js can call it
        client.setIdlePresence  = setIdlePresence;
        client.setNowPlaying    = (song) => {
            const title = song.title.length > 64 ? song.title.slice(0, 61) + '…' : song.title;
            client.user.setPresence({
                activities: [{
                    name:  title,
                    type:  ActivityType.Listening,
                    url:   song.url,        // enables the "Streaming" rich link
                }],
                status: 'online',
            });
        };

        // Start idle rotation
        setIdlePresence();
        setInterval(setIdlePresence, 10_000);
    },
};
