s=open('claimer_src.js').read()
def rep(a,b):
    global s
    assert a in s, a[:70]; s=s.replace(a,b,1)
rep('require("dotenv").config();\n','')
rep('const { TEAMS } = require("./teams");','module.exports = function installTeamClaimer(client, sharedCommands) {\nconst { TEAMS } = require("./teams");')
rep('const CONFIG_PATH = path.join(__dirname, "config.json");\nconst config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));',
'''// Team Claimer progress (roles + claims) lives in data/team_claimer_config.json.
// If an old Team Claimer config.json sits next to the bot, it is imported once.
const CONFIG_PATH = path.join(__dirname, "data", "team_claimer_config.json");
const LEGACY_CONFIG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, fs.existsSync(LEGACY_CONFIG_PATH) ? fs.readFileSync(LEGACY_CONFIG_PATH, "utf8") : JSON.stringify({ roles: {}, claims: {} }, null, 2));
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));''')
rep('const WAITLIST_ROLE_NAME = "waitlist";','const WAITLIST_ROLE_NAME = "waitlist";\nconst WAITLIST_PING_ROLE_ID = process.env.WAITLIST_PING_ROLE_ID || "1543435132596129882";')
rep('''async function deleteOpenAnnouncement(guild, roleId) {
  const entry = config.announcements?.[roleId];
  if (!entry) return;''','''// Deletes every "<team> is open" ping for this team still in the waitlist channel,
// including ones posted before the merge or by the old Team Claimer bot (needs Manage Messages).
async function sweepOpenPings(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return;
  const channel = await guild.channels.fetch(WAITLIST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return;
  const needle = `**${role.name}** is open`.toLowerCase();
  for (const m of recent.values()) {
    if (String(m.content || "").toLowerCase().includes(needle)) await m.delete().catch(err => {
      if (err?.code !== 10008) console.error(`Couldn't delete open ping for ${role.name} (give the bot Manage Messages):`, err?.message || err);
    });
  }
}

async function deleteOpenAnnouncement(guild, roleId) {
  const entry = config.announcements?.[roleId];
  const teamRole = guild.roles.cache.get(roleId);
  if (teamRole && teamRole.members.size > 0) await sweepOpenPings(guild, roleId).catch(() => {});
  if (!entry) return;''')
rep('''    const waitlistRole = getWaitlistRole(guild);
    if (!waitlistRole || !role) return;
''','''    if (!role) return;
    const pingRoleId = guild.roles.cache.has(WAITLIST_PING_ROLE_ID) ? WAITLIST_PING_ROLE_ID : getWaitlistRole(guild)?.id;
    if (!pingRoleId) return;
''')
rep('''      content: `<@&${waitlistRole.id}> **${role.name}** is open, claim it while you can!!`,
      allowedMentions: { roles: [waitlistRole.id] }''','''      content: `<@&${pingRoleId}> **${role.name}** is open, claim it while you can!!`,
      allowedMentions: { roles: [pingRoleId] }''')
rep('''  new SlashCommandBuilder().setName("my-team").setDescription("Show which team you have claimed.")
].map(c => c.toJSON());''','''  new SlashCommandBuilder().setName("my-team").setDescription("Show which team you have claimed.")
];
const CLAIMER_COMMANDS = new Set(commands.map(c => c.name));
sharedCommands.push(...commands);''')
rep('''const client = new Client({
  // GuildMembers is required so the bot can see who already holds each team role.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});
''','')
rep('''  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("Slash commands registered.");

  } catch (err) { console.error("Could not register slash commands:", err); }
''','')
rep('''    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) return;
''','''    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild() || !CLAIMER_COMMANDS.has(interaction.commandName)) return;
''')
rep('📸 After entering your EA username, the bot will ask for a screenshot and automatically verify it before giving you the role or changing your nickname.',
    "🎮 After entering your EA username you'll see the league info. Join the franchise in Madden **first**, then press **Joined** — the bot checks EA live before giving you the role.")
start=s.index('      await interaction.deferReply({ ephemeral: true });\n      try {\n        // Never verify against stale ownership data.')
end=s.index('  } catch (err) {\n    console.error("Interaction error:", err);')
s=s[:start]+'''      const leagueName = eaConnection.leagueName || "FDL Connected Franchise";
      const leagueInfo = new EmbedBuilder()
        .setColor(data.category === "AFC" ? 0xd50a0a : 0x013369)
        .setAuthor({ name: "FDL • Team Claim" })
        .setTitle(`${role.name} — join the league first`)
        .setDescription([
          `**League:** ${leagueName}`,
          `**Platform:** Madden NFL 27 • PC`,
          `**Team:** ${resolveGuildEmoji(interaction.guild, data.emoji)} ${role.name}`,
          `**Your EA username:** \\`${username}\\``,
          "",
          "**How to join**",
          "1. Open Madden NFL 27 → **Franchise** → **Join League** (or accept the invite).",
          `2. Pick **${leagueName}** and take the **${role.name}**.`,
          "3. Come back here and press **Joined**.",
          "",
          `⚠️ **Do NOT press Joined until you are actually in the league on the ${role.name}.** The bot checks EA directly — if you haven't joined yet you **won't be verified** and nothing will be assigned.`
        ].join("\\n"))
        .setFooter({ text: "Verification reads the live Madden franchise owner field." });
      const joinedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claimJoined:${roleId}:${username}`.slice(0, 100)).setLabel("Joined").setEmoji("✅").setStyle(ButtonStyle.Success)
      );
      return interaction.reply({ embeds: [leagueInfo], components: [joinedRow], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith("claimJoined:")) {
      if (!interaction.inGuild()) return;
      const [, roleId, ...rest] = interaction.customId.split(":");
      const username = rest.join(":");
      const role = interaction.guild.roles.cache.get(roleId);
      if (!config.roles[roleId] || !role) return interaction.reply({ content: "That team is no longer configured.", ephemeral: true });
      if (!eaConnection?.leagueId) return interaction.reply({ content: "❌ FDL's Madden connection is offline. Ask an administrator to run `/ea-connect`.", ephemeral: true });
      await interaction.deferUpdate();
      try {
        await refreshEAConnection("claim-joined"); // always fresh: they may have joined seconds ago
        const ownership = EA.findTeamOwner(eaConnection.teams, role.name, username);
        if (!ownership.ok) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle("❌ Not verified yet")
            .setDescription(`${ownership.reason}\\n\\nMake sure you've **joined ${eaConnection.leagueName || "the league"}** in Madden on the **${role.name}** with the EA account \\`${username}\\`, then press **Joined** again.\\n\\nNo role or nickname was changed.`)],
            components: interaction.message.components });
        }
        const finished = await finalizeClaim(interaction.guild, interaction.user.id, roleId, username);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ Welcome to the ${role.name}!`)
          .setDescription(`Madden confirms **${username}** owns the **${role.name}** in **${eaConnection.leagueName || "the connected franchise"}**.\\n\\nNickname: **${finished.nickname}**${finished.nickNote}`)], components: [] });
      } catch (err) {
        console.error("EA-backed claim verification failed:", err);
        return interaction.editReply({ content: `❌ I couldn't verify this claim: ${describeError(err)}\\n\\nNo team role was assigned. Try **Joined** again in a minute.`, embeds: [], components: interaction.message.components });
      }
    }
'''+s[end:]
i=s.index('client.login(process.env.DISCORD_TOKEN)')
s=s[:i]+'''return {
  getConnection: () => eaConnection,
  saveConnection: saveEAConnection,
  refreshEAConnection,
  ownerOfTeamName(name) {
    const roleId = Object.keys(config.roles).find(id => String(config.roles[id]?.label).toLowerCase() === String(name || "").toLowerCase());
    return roleId ? (config.claims?.[roleId] || null) : null;
  }
};
};
'''
open('teamClaimer.js','w').write(s)
