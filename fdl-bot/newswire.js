'use strict';
// Newswire (Franchise Hub style): headlines posted automatically as new messages when Madden shows
//  - a player (default 75+ OVR; NEWS_MIN_OVR) signed, released or traded
//  - an upset (lower-rated team wins by NEWS_UPSET_GAP+ overall, default 5)
//  - a win/loss streak reaching 3, 5, 7...
// The first check after /newswire set only takes a baseline, so nothing old is posted.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const N = require('./newswireLogic');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, franchise } = ctx;
  const FILE = path.join(__dirname, 'data', 'newswire.json');
  const load = () => { try { return { channelId: null, players: null, posted: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { channelId: null, players: null, posted: {} }; } };
  const save = s => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, FILE); };
  const MIN_OVR = Number(process.env.NEWS_MIN_OVR) || 75, GAP = Number(process.env.NEWS_UPSET_GAP) || 5;

  commands.push(new SlashCommandBuilder().setName('newswire').setDescription('Admin: automatic league news (signings, trades, upsets, streaks)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('set').setDescription('Post league news in a channel').addChannelOption(o => o.setName('channel').setDescription('News channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('off').setDescription('Stop the newswire'))
    .addSubcommand(s => s.setName('now').setDescription('Check Madden for news right now')));

  let busy = false;
  async function tick() {
    const st = load();
    if (!st.channelId || busy) return { posted: 0 };
    busy = true;
    try {
      const ch = await client.channels.fetch(st.channelId).catch(() => null);
      if (!ch?.isTextBased()) return { posted: 0 };
      const items = [];
      const season = await franchise.currentSeasonYear();
      // roster moves
      const players = await franchise.getAllPlayers();
      const curr = {};
      for (const p of players) if (p.ovr >= MIN_OVR - 15) curr[p.id] = { n: p.name, pos: p.pos, ovr: p.ovr, team: p.team };
      const baseline = st.players === null;
      if (!baseline) for (const m of N.diffMoves(st.players, curr, MIN_OVR)) items.push(m.text);
      st.players = curr;
      // upsets + streaks
      const { week } = await franchise.getCurrent();
      const standings = await franchise.getStandings();
      const ovr = Object.fromEntries(standings.map(r => [r.teamId, r.ovr]));
      const weeks = [];
      for (let w = 1; w <= (week || 0); w++) weeks.push({ week: w, games: await franchise.getGames(w).catch(() => []) });
      const fresh = [];
      for (const { week: w, games } of weeks) for (const g of games) {
        const key = `${season}-${w}-${g.awayId}-${g.homeId}`;
        if (!g.final || st.posted[key]) continue;
        st.posted[key] = 1;
        if (!baseline && w >= week - 1) { const u = N.upset(g, ovr, GAP); if (u) fresh.push(u); }
      }
      const s = N.streaks(weeks);
      for (const [id, c] of Object.entries(s)) {
        const key = `streak-${season}-${id}-${c.n}`;
        if (Math.abs(c.n) >= 3 && Math.abs(c.n) % 2 === 1 && !st.posted[key]) { st.posted[key] = 1; const h = N.streakHeadline(c.name, c.n); if (h && !baseline && weeks.length) fresh.push(h); }
      }
      items.push(...fresh);
      save(st);
      for (let n = 0; n < items.length; n += 10) {
        await ch.send({ embeds: [franchise.embed('📰 FDL Newswire', items.slice(n, n + 10).join('\n\n'))], allowedMentions: { parse: [] } });
      }
      return { posted: items.length, baseline };
    } finally { busy = false; }
  }
  client.once('ready', () => { const t = setInterval(() => tick().catch(e => console.error('[newswire]', e.message || e)), 6 * 60 * 1000); t.unref?.(); });

  client.on('interactionCreate', async i => {
    try {
      if (!i.isChatInputCommand() || i.commandName !== 'newswire') return;
      if (GUILD_ID && i.guildId !== GUILD_ID) return;
      if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
      await i.deferReply({ ephemeral: true });
      const sub = i.options.getSubcommand(), st = load();
      if (sub === 'off') { st.channelId = null; save(st); return i.editReply('Newswire is off.'); }
      if (sub === 'set') { st.channelId = i.options.getChannel('channel', true).id; st.players = null; save(st); const r = await tick().catch(() => ({})); return i.editReply(`✅ News will post in <#${st.channelId}>. Baseline taken${r.baseline ? '' : ''} — only new moves from now on.`); }
      const r = await tick();
      return i.editReply(r.baseline ? 'Baseline taken; news starts from the next change.' : `Posted ${r.posted} item(s).`);
    } catch (err) {
      console.error('[newswire]', err);
      try { await i.editReply(`❌ ${String(err.message || err).slice(0, 300)}`); } catch { /* gone */ }
    }
  });
  return { tick };
};
