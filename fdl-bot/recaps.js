'use strict';
// Automatic league posts (Franchise Hub style). Set a channel with /recaps set and the bot posts, on its own:
//   - a "FINAL" card for every finished game (records, top performers, written story, Box Score button)
//   - a matchup card when a new week's games are up
//   - the weekly power rankings once a week is fully played
// These are NEW messages each time (they are results, not live boards). Live boards are edited in place.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const R = require('./recapLogic');
const S = require('./scoreboardLogic');
const D = require('./franchiseData');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, franchise } = ctx;
  const FILE = path.join(__dirname, 'data', 'recaps.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { channelId: process.env.RECAP_CHANNEL_ID || null, posted: {}, previews: {}, power: {} }; } };
  const save = s => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, FILE); };

  commands.push(new SlashCommandBuilder().setName('recaps').setDescription('Admin: automatic game recaps, matchup cards and weekly power rankings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('set').setDescription('Post recaps in this channel from now on')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for recaps').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o.setName('backfill').setDescription('Also post recaps for games already finished this week (default: no)')))
    .addSubcommand(s => s.setName('off').setDescription('Stop automatic recaps'))
    .addSubcommand(s => s.setName('now').setDescription('Check Madden and post anything new right now')));

  let busy = false;
  async function tick({ backfill = true } = {}) {
    const state = load();
    if (!state.channelId || busy) return { posted: 0 };
    busy = true;
    let posted = 0;
    try {
      const channel = await client.channels.fetch(state.channelId).catch(() => null);
      if (!channel?.isTextBased()) return { posted: 0, error: 'channel not accessible' };
      const { week } = await franchise.getCurrent();
      if (!week) return { posted: 0 };
      const season = await franchise.currentSeasonYear();
      const standings = await franchise.getStandings();
      const records = Object.fromEntries(standings.map(r => [r.teamId, D.recordText(r)]));
      const ovr = Object.fromEntries(standings.map(r => [r.teamId, r.ovr]));

      for (const w of [week - 1, week].filter(x => x >= 1)) {
        const games = await franchise.getGames(w);
        const wk = `${season}-${w}`;
        // matchup card, once, while the week still has unplayed games
        if (w === week && !state.previews[wk] && games.some(x => !x.final)) {
          const lines = R.matchupLines(games, records, ovr);
          if (lines.length) {
            await channel.send({ embeds: [franchise.embed(`📅 ${season} ${S.weekName(w)} Matchups`, lines.join('\n'))], allowedMentions: { parse: [] } });
            posted++;
          }
          state.previews[wk] = true; save(state);
        }
        // one FINAL card per finished game
        const finals = games.filter(x => x.final && !state.posted[`${wk}-${x.awayId}-${x.homeId}`]);
        if (finals.length) {
          const stats = await franchise.getStats(w).catch(() => ({}));
          for (const game of finals) {
            const key = `${wk}-${game.awayId}-${game.homeId}`;
            const card = R.recapCard({ game, stats, records, season, weekLabel: S.weekName(w) });
            const e = franchise.embed(card.title, card.description).addFields(card.fields);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`box:${w}:${game.awayId}:${game.homeId}`).setLabel('Box Score').setEmoji('📊').setStyle(ButtonStyle.Secondary));
            const msg = await channel.send({ embeds: [e], components: [row], allowedMentions: { parse: [] } });
            state.posted[key] = msg.id; save(state); posted++;
            await new Promise(r => setTimeout(r, 800));
          }
        }
        // weekly power rankings once everything is played
        if (games.length && games.every(x => x.final) && !state.power[wk]) {
          const payload = await franchise.renderCommand('power-rankings').catch(() => null);
          if (payload) { await channel.send({ content: payload.content || undefined, embeds: payload.embeds || [], allowedMentions: { parse: [] } }); posted++; }
          state.power[wk] = true; save(state);
        }
      }
    } finally { busy = false; }
    return { posted };
  }
  client.once('ready', () => {
    const t = setInterval(() => tick().catch(e => console.error('[recaps]', e.message || e)), 5 * 60 * 1000 + 45 * 1000);
    t.unref?.();
  });

  client.on('interactionCreate', async i => {
    try {
      if (!i.isChatInputCommand() || i.commandName !== 'recaps') return;
      if (GUILD_ID && i.guildId !== GUILD_ID) return;
      if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
      await i.deferReply({ ephemeral: true });
      const sub = i.options.getSubcommand();
      const state = load();
      if (sub === 'off') { state.channelId = null; save(state); return i.editReply('Automatic recaps are off.'); }
      if (sub === 'set') {
        const ch = i.options.getChannel('channel', true);
        state.channelId = ch.id;
        if (!i.options.getBoolean('backfill')) {
          // baseline: games that are already final don't get a recap, only the ones that finish from now on
          const { week } = await franchise.getCurrent(); const season = await franchise.currentSeasonYear();
          for (const w of [week - 1, week].filter(x => x >= 1)) {
            const games = await franchise.getGames(w);
            for (const g of games.filter(x => x.final)) state.posted[`${season}-${w}-${g.awayId}-${g.homeId}`] = 'baseline';
            if (games.length && games.every(x => x.final)) state.power[`${season}-${w}`] = true;
          }
        }
        save(state);
        return i.editReply(`✅ Recaps, matchup cards and weekly power rankings will post in <#${ch.id}>.`);
      }
      const r = await tick();
      return i.editReply(r.error ? `⚠️ ${r.error}` : `Checked Madden: ${r.posted} new post${r.posted === 1 ? '' : 's'}.`);
    } catch (err) {
      const msg = err instanceof franchise.UserError ? `⚠️ ${err.message}` : `❌ ${String(err.message || err).slice(0, 300)}`;
      try { if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ content: msg, ephemeral: true }); } catch { /* gone */ }
    }
  });
  return { tick };
};
