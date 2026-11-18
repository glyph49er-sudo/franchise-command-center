'use strict';
// Snallabot-style scores channel + box scores + /update-sync.
//
// - /scoreboard set <channel>: the bot keeps ONE message per week there ("# 2026 Season Week 3 Games"),
//   editing it as games finish and posting a fresh message when the league moves to a new week.
//   Winners are bold, records show in parentheses, force wins / fair sims are tagged.
// - Every finished game gets a "<Winner> box score" button -> full player box score for both teams.
// - /update-sync: force-read Madden now and refresh everything (live posts, scoreboards, POTW check).
// Layout follows snallabot-service (MIT, Copyright (c) 2024 snallabot) - see SNALLABOT_LICENSE.md.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const L = require('./scoreboardLogic');
const D = require('./franchiseData');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, TEAMS, franchise, teamClaimer, gameChannels, recaps } = ctx;
  const FILE = path.join(__dirname, 'data', 'scoreboard.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { channelId: process.env.SCOREBOARD_CHANNEL_ID || null, posts: {} }; } };
  const save = s => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, FILE); };
  const hashes = new Map(); // post key -> last content+components fingerprint (avoid pointless edits)

  commands.push(
    new SlashCommandBuilder().setName('scoreboard').setDescription('Admin: the live scores channel (Snallabot style).')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName('set').setDescription('Choose the scores channel and post the current week there')
        .addChannelOption(o => o.setName('channel').setDescription('Channel for scores').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('refresh').setDescription('Re-read this week and update the scoreboard now'))
      .addSubcommand(s => s.setName('post').setDescription('Post a given week (e.g. to backfill)')
        .addIntegerOption(o => o.setName('week').setDescription('Week 1-23').setRequired(true).setMinValue(1).setMaxValue(23))),
    new SlashCommandBuilder().setName('update-sync').setDescription('Admin: read Madden right now and update every live post, scoreboard and board.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  );

  // team emoji: a server emoji named after the team ("cowboys", "dal"); none -> no emoji.
  function emojiFor(guild) {
    let custom = {};
    try { custom = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'team_logos.json'), 'utf8')); } catch { /* no custom logos */ }
    const byName = new Map();
    for (const e of guild?.emojis?.cache?.values?.() || []) byName.set(e.name.toLowerCase(), e);
    return teamName => {
      if (custom[String(teamName).toLowerCase()]) return custom[String(teamName).toLowerCase()];
      const full = Object.keys(TEAMS).find(k => TEAMS[k].short.toLowerCase() === String(teamName).toLowerCase());
      const e = byName.get(String(teamName).toLowerCase()) || (full && byName.get(TEAMS[full].abbr.toLowerCase()));
      return e ? e.toString() : '';
    };
  }
  const readSims = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'game_channels.json'), 'utf8')).sims || []; } catch { return []; } };

  function buttonRows(games, week) {
    const btns = L.boxButtons(games, week).map(b => new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setEmoji('📊').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let n = 0; n < btns.length && rows.length < 5; n += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(n, n + 5)));
    return rows;
  }

  async function renderWeek(guild, week) {
    const [games, standings, season] = await Promise.all([franchise.getGames(week), franchise.getStandings(), franchise.currentSeasonYear()]);
    const records = Object.fromEntries(standings.map(r => [r.teamId, D.recordText(r)]));
    const content = L.scoreboardText({ season, week, games, records, sims: readSims(), emoji: emojiFor(guild) });
    return { content: D.clip(content, 2000), components: buttonRows(games, week), games, season };
  }

  async function postWeek(week, { guild, force = false } = {}) {
    const state = load();
    if (!state.channelId) return { skipped: 'no channel' };
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (!channel?.isTextBased()) return { skipped: 'channel not accessible' };
    guild = guild || channel.guild;
    const { content, components, season } = await renderWeek(guild, week);
    const key = `${season}-${week}`;
    const fp = JSON.stringify({ content, components: components.map(r => r.toJSON?.() ?? r) });
    const post = state.posts[key];
    if (post) {
      if (!force && hashes.get(key) === fp) return { unchanged: true, key };
      try {
        await channel.messages.edit(post.messageId, { content, components, allowedMentions: { parse: [] } });
        hashes.set(key, fp);
        return { updated: true, key };
      } catch (err) {
        if (![10008, 10003].includes(err?.code)) throw err; // message was deleted -> post a new one
      }
    }
    const sent = await channel.send({ content, components, allowedMentions: { parse: [] } });
    state.posts[key] = { messageId: sent.id, channelId: channel.id, week };
    save(state); hashes.set(key, fp);
    return { posted: true, key };
  }

  // Keeps the current week (and the one before it, until it is final) up to date; new week -> new message.
  async function refreshScoreboard({ force = false } = {}) {
    const { week } = await franchise.getCurrent();
    if (!week) return { skipped: 'week unknown' };
    const results = [];
    for (const w of [week - 1, week].filter(x => x >= 1)) {
      if (w !== week && !load().posts[`${await franchise.currentSeasonYear()}-${w}`]) continue; // never back-post an old week
      results.push(await postWeek(w, { force }));
    }
    return { results };
  }
  client.once('ready', () => {
    const t = setInterval(() => refreshScoreboard().catch(e => console.error('[scoreboard]', e.message || e)), 5 * 60 * 1000 + 30 * 1000);
    t.unref?.();
    setTimeout(() => refreshScoreboard().catch(e => console.error('[scoreboard]', e.message || e)), 30 * 1000).unref?.();
  });

  client.on('interactionCreate', async i => {
    try {
      if (i.guildId && GUILD_ID && i.guildId !== GUILD_ID) return;

      if (i.isButton() && i.customId.startsWith('box:')) {
        const [, w, a, h] = i.customId.split(':').map((x, n) => (n ? Number(x) : x));
        await i.deferReply({ ephemeral: true });
        const games = await franchise.getGames(w);
        const game = games.find(g => g.awayId === a && g.homeId === h);
        if (!game) return i.editReply('I could not find that game in Madden right now.');
        const [stats, season] = await Promise.all([franchise.getStats(w), franchise.currentSeasonYear()]);
        const box = L.boxScore({ game, stats, season, week: w });
        const embeds = box.teams.map(t => franchise.embed(t.title, t.description).addFields(t.fields));
        return i.editReply({ content: `**${box.header}**`, embeds });
      }

      if (!i.isChatInputCommand() || !['scoreboard', 'update-sync'].includes(i.commandName)) return;
      if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
      await i.deferReply({ ephemeral: true });

      if (i.commandName === 'scoreboard') {
        const sub = i.options.getSubcommand();
        if (sub === 'set') {
          const ch = i.options.getChannel('channel', true);
          save({ ...load(), channelId: ch.id, posts: {} });
          const r = await refreshScoreboard({ force: true });
          return i.editReply(`✅ Scores will live in <#${ch.id}>. ${JSON.stringify(r.results || r.skipped)}`.slice(0, 1900));
        }
        if (sub === 'refresh') { franchise.invalidate(); const r = await refreshScoreboard({ force: true }); return i.editReply(`Scoreboard refreshed. ${JSON.stringify(r.results || r.skipped)}`.slice(0, 1900)); }
        if (sub === 'post') { const r = await postWeek(i.options.getInteger('week', true), { guild: i.guild, force: true }); return i.editReply(`Done: ${JSON.stringify(r)}`); }
      }

      if (i.commandName === 'update-sync') {
        const steps = [];
        const t0 = Date.now();
        try { await teamClaimer.refreshEAConnection('update-sync'); steps.push('✅ Read Madden (teams, owners, rosters)'); }
        catch (e) { steps.push(`❌ Madden read failed: ${String(e.message || e).slice(0, 200)}`); return i.editReply(steps.join('\n') + '\nNothing was updated. Run `/ea-status` to check the connection.'); }
        franchise.invalidate();
        const cur = await franchise.getCurrent().catch(() => ({}));
        steps.push(`✅ League is on **${cur.week ? D_weekName(cur.week) : 'an unknown week'}**`);
        const live = await franchise.refreshLive({ force: true }).catch(e => ({ error: e.message }));
        steps.push(live.error ? `⚠️ Live posts: ${live.error}` : `✅ Live posts: ${live.updated} updated of ${live.checked}`);
        const sb = await refreshScoreboard({ force: true }).catch(e => ({ error: e.message }));
        steps.push(sb.error ? `⚠️ Scoreboard: ${sb.error}` : sb.skipped ? `ℹ️ Scoreboard: ${sb.skipped} (run /scoreboard set)` : '✅ Scores channel updated');
        const gc = await gameChannels.refreshScoreboards().catch(() => null);
        if (gc) steps.push(`✅ ${gc} game channel scoreboard${gc === 1 ? '' : 's'} updated`);
        const rc = recaps ? await recaps.tick().catch(() => null) : null;
        if (rc && rc.posted) steps.push(`✅ ${rc.posted} new recap post${rc.posted === 1 ? '' : 's'}`);
        const potw = await franchise.autoPotwTick().catch(() => null);
        if (potw && potw.posted) steps.push('✅ Players of the Week posted');
        return i.editReply(`${steps.join('\n')}\n_Done in ${((Date.now() - t0) / 1000).toFixed(1)}s._`);
      }
    } catch (err) {
      const msg = err instanceof franchise.UserError ? `⚠️ ${err.message}` : `❌ ${String(err.message || err).slice(0, 300)}`;
      if (!(err instanceof franchise.UserError)) console.error('[scoreboard]', err);
      try { if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ content: msg, ephemeral: true }); } catch { /* gone */ }
    }
  });
  const D_weekName = L.weekName;
  return { refreshScoreboard, postWeek };
};
