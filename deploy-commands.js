require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Collect command JSON ──────────────────────────────────────────────────────
const commands = [];
const commandsPath = path.join(__dirname, 'commands');

if (!fs.existsSync(commandsPath)) {
    console.error('❌  /commands directory not found! Make sure you are in the project root.');
    process.exit(1);
}

for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    }
}

// ── Validate env ──────────────────────────────────────────────────────────────
const { DISCORD_TOKEN, CLIENT_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('❌  DISCORD_TOKEN or CLIENT_ID missing in .env!');
    process.exit(1);
}

// ── Deploy ────────────────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
    try {
        console.log(`\n📤  Deploying ${commands.length} slash command(s)…`);
        const data = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log(`✅  Successfully deployed ${data.length} slash command(s)!\n`);
    } catch (err) {
        console.error('❌  Deploy failed:', err);
    }
})();
