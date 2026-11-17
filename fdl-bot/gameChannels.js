'use strict';
// /game_channels and /sims, ported from snallabot-service (src/discord/commands/game_channels.ts, sims.ts),
// MIT License, Copyright (c) 2024 snallabot. See SNALLABOT_LICENSE.md.
//
// Differences from Snallabot: games come from the live EA connection (franchise.js) instead of Snallabot's
// export queue, state is kept in data/game_channels.json, and Snallabot's emoji reactions are buttons so the
// bot needs no extra gateway intents:
//   ⏰ Scheduled  - stops the reminder pings        🏆 Done - removes the channel
//   🏠 / ✈️        - a coach asks for a force win for the home / away side (both = fair sim)
//   ⏭ Confirm sim - admin role confirms the request; it is logged and shows in /sims
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const L = require('./gameChannelLogic');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, franchise } = ctx;
  const FILE = path.join(__dirname, 'data', 'game_channels.json');
  const blank = () => ({ config: null, weeks: {}, sims: [] });
  function load() { try { const v = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { ...blank(), ...v }; } catch { return blank(); } }
  function save(s) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, FILE); }

  const catOpt = o => o.setName('category_override').setDescription('Overrides the category to create channels in').addChannelTypes(ChannelType.GuildCategory);
  commands.push(
    new SlashCommandBuilder().setName('game_channels').setDescription('Handles game channels (Snallabot style)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName('create').setDescription('Create game channels')
        .addIntegerOption(o => o.setName('week').setDescription('The week number to create for').setRequired(true).setMinValue(1).setMaxValue(23)).addChannelOption(catOpt))
      .addSubcommand(s => s.setName('wildcard').setDescription('Creates wildcard week game channels').addChannelOption(catOpt))
      .addSubcommand(s => s.setName('divisional').setDescription('Creates divisional week game channels').addChannelOption(catOpt))
      .addSubcommand(s => s.setName('conference').setDescription('Creates conference championship week game channels').addChannelOption(catOpt))
      .addSubcommand(s => s.setName('superbowl').setDescription('Creates superbowl week game channels').addChannelOption(catOpt))
      .addSubcommand(s => s.setName('clear').setDescription('Clear all game channels')
        .addIntegerOption(o => o.setName('week').setDescription('Optional week to clear').setMinValue(1).setMaxValue(23)))
      .addSubcommand(s => s.setName('configure').setDescription('Sets up game channels')
        .addChannelOption(o => o.setName('category').setDescription('Category to create channels under').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption(o => o.setName('scoreboard_channel').setDescription('Channel to post the scoreboard').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addIntegerOption(o => o.setName('notification_period').setDescription('Hours to wait before pinging unscheduled games').setRequired(true).setMinValue(1).setMaxValue(240))
        .addRoleOption(o => o.setName('admin_role').setDescription('Admin role that confirms force wins').setRequired(true))
        .addBooleanOption(o => o.setName('private_channels').setDescription('Make game channels private to the coaches and admins')))
      .addSubcommand(s => s.setName('notify').setDescription('Notifies all remaining game channels')),
    new SlashCommandBuilder().setName('sims').setDescription('View sim statistics by season')
      .addIntegerOption(o => o.setName('season').setDescription('Season number (default: current)').setMinValue(1))
  );

  // ---- helpers -------------------------------------------------------------------------------
  const isAdminFor = (i, cfg) => Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator) || (cfg?.adminRoleId && i.member?.roles?.cache?.has(cfg.adminRoleId)));
  const rowFor = (st, disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gc:sched').setLabel('Scheduled').setEmoji('⏰').setStyle(ButtonStyle.Secondary).setDisabled(disabled || st.scheduled),
    new ButtonBuilder().setCustomId('gc:done').setLabel('Done').setEmoji('🏆').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('gc:home').setLabel('Home win').setEmoji('🏠').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('gc:away').setLabel('Away win').setEmoji('✈️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('gc:sim').setLabel('Confirm sim').setEmoji('⏭').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
  const coachesOf = st => [franchise.ownerOf(st.away), franchise.ownerOf(st.home)].filter(Boolean);
  const mentions = st => `${franchise.ownerOf(st.away) ? `<@${franchise.ownerOf(st.away)}>` : `**${st.away}**`} at ${franchise.ownerOf(st.home) ? `<@${franchise.ownerOf(st.home)}>` : `**${st.home}**`}`;

  async function updateScoreboard(guild, store, weekKey) {
    const wk = store.weeks[weekKey];
    if (!wk || !wk.scoreboard) return;
    try {
      const ch = await client.channels.fetch(wk.scoreboard.channelId);
      const games = await franchise.getGames(wk.week).catch(() => []);
      const text = L.scoreboardText(wk, games);
      const msg = await ch.messages.fetch(wk.scoreboard.messageId).catch(() => null);
      if (msg) await msg.edit({ content: text, allowedMentions: { parse: [] } });
      else { const m = await ch.send({ content: text, allowedMentions: { parse: [] } }); wk.scoreboard.messageId = m.id; save(store); }
    } catch (e) { console.error('[game_channels] scoreboard:', e.message); }
  }

  async function createWeek(i, week, categoryOverride) {
    const store = load(), cfg = store.config;
    if (!cfg) throw new franchise.UserError('Game channels are not configured. Run `/game_channels configure` first.');
    const err = L.validateWeek(week);
    if (err) throw new franchise.UserError(err);
    const games = await franchise.getGames(week);
    if (!games.length) throw new franchise.UserError(`No games found for week ${week}.`);
    const guild = i.guild;
    const categoryId = categoryOverride?.id || cfg.categoryId;
    const created = [];
    try {
      const wk = { week, createdAt: Date.now(), scoreboard: null, channels: {} };
      for (const g of games) {
        const coaches = [franchise.ownerOf(g.away), franchise.ownerOf(g.home)].filter(Boolean);
        const overwrites = cfg.privateChannels ? [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
          { id: cfg.adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          ...coaches.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
        ] : undefined;
        const name = L.channelName(g.away, g.home);
        const channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: categoryId, topic: `Week ${week}: ${g.away} @ ${g.home}`, permissionOverwrites: overwrites, reason: `Game channels week ${week}` });
        created.push(channel);
        const st = { channelId: channel.id, scheduleId: g.scheduleId ?? null, awayId: g.awayId, homeId: g.homeId, away: g.away, home: g.home, scheduled: false, done: false, requests: {}, sim: null, notifiedAt: Date.now() };
        const msg = await channel.send({ content: L.notifierMessage(mentions(st), cfg.waitPingHours, cfg.adminRoleId), components: [rowFor(st)], allowedMentions: { users: coaches, roles: [cfg.adminRoleId] } });
        st.messageId = msg.id;
        wk.channels[channel.id] = st;
      }
      const sb = await client.channels.fetch(cfg.scoreboardChannelId);
      const sbMsg = await sb.send({ content: L.scoreboardText(wk, games), allowedMentions: { parse: [] } });
      wk.scoreboard = { channelId: sb.id, messageId: sbMsg.id };
      store.weeks[String(week)] = wk;
      save(store);
      return created.length;
    } catch (e) {
      await Promise.all(created.map(c => c.delete('Game channel create failed').catch(() => {})));
      throw e;
    }
  }

  async function clearWeeks(i, week) {
    const store = load();
    const keys = Object.keys(store.weeks).filter(k => !week || store.weeks[k].week === week);
    let removed = 0;
    for (const k of keys) {
      for (const st of Object.values(store.weeks[k].channels)) {
        const ch = await i.guild.channels.fetch(st.channelId).catch(() => null);
        if (ch) { await ch.delete(`Cleared by ${i.user.tag}`).catch(() => {}); removed++; }
      }
      delete store.weeks[k];
    }
    save(store);
    return removed;
  }

  async function notify(store, force) {
    const cfg = store.config; if (!cfg) return 0;
    let n = 0;
    for (const wk of Object.values(store.weeks)) for (const st of Object.values(wk.channels)) {
      if (st.scheduled || st.done || st.sim) continue;
      if (!force && !L.shouldNotify(st.notifiedAt, cfg.waitPingHours, Date.now())) continue;
      const ch = await client.channels.fetch(st.channelId).catch(() => null);
      if (!ch) continue;
      await ch.send({ content: L.notifierMessage(mentions(st), cfg.waitPingHours, cfg.adminRoleId), allowedMentions: { users: coachesOf(st), roles: [cfg.adminRoleId] } }).catch(() => {});
      st.notifiedAt = Date.now(); n++;
    }
    if (n) save(store);
    return n;
  }
  client.once('ready', () => { const t = setInterval(() => { notify(load(), false).catch(e => console.error('[game_channels] notify:', e.message)); }, 10 * 60 * 1000); t.unref?.(); });

  // ---- interactions --------------------------------------------------------------------------
  client.on('interactionCreate', async i => {
    try {
      if (i.guildId && GUILD_ID && i.guildId !== GUILD_ID) return;
      if (i.isChatInputCommand() && i.commandName === 'game_channels') {
        const store = load(), sub = i.options.getSubcommand();
        if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator) && !isAdminFor(i, store.config)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
        await i.deferReply({ ephemeral: true });
        if (sub === 'configure') {
          const prev = store.config || {};
          store.config = { categoryId: i.options.getChannel('category', true).id, scoreboardChannelId: i.options.getChannel('scoreboard_channel', true).id,
            waitPingHours: i.options.getInteger('notification_period', true), adminRoleId: i.options.getRole('admin_role', true).id, privateChannels: Boolean(i.options.getBoolean('private_channels')) };
          save({ ...store });
          return i.editReply(`Game channels are configured:\n- Admin role: <@&${store.config.adminRoleId}>\n- Category: <#${store.config.categoryId}>\n- Scoreboard: <#${store.config.scoreboardChannelId}>\n- Notification period: every ${store.config.waitPingHours} hour(s)\n- Private channels: ${store.config.privateChannels ? 'Yes' : 'No'}${prev.categoryId ? '' : ''}`);
        }
        if (sub === 'clear') { const n = await clearWeeks(i, i.options.getInteger('week')); return i.editReply(`Game channels cleared (${n} channel${n === 1 ? '' : 's'} deleted).`); }
        if (sub === 'notify') { const n = await notify(store, true); return i.editReply(`Notified ${n} game channel${n === 1 ? '' : 's'}.`); }
        const week = L.weekForSubcommand(sub, i.options.getInteger('week'));
        const n = await createWeek(i, week, i.options.getChannel('category_override'));
        return i.editReply(`✅ Created **${n}** game channel${n === 1 ? '' : 's'} for week ${week}. The scoreboard is posted in <#${load().config.scoreboardChannelId}>.`);
      }

      if (i.isChatInputCommand() && i.commandName === 'sims') {
        await i.deferReply();
        const store = load();
        const cur = await franchise.getCurrent().catch(() => ({}));
        const season = i.options.getInteger('season') ?? (cur.season !== null && cur.season !== undefined ? cur.season + 1 : null);
        const rows = L.simSummary(store.sims, season);
        if (!rows.length) return i.editReply(`No sims recorded${season ? ` for season ${season}` : ''}.`);
        const lines = rows.map(r => `${r.team.slice(0, 16).padEnd(16)} FW ${String(r.fw).padStart(2)}  FL ${String(r.fl).padStart(2)}  FS ${String(r.fs).padStart(2)}`);
        return i.editReply('**Sims' + (season ? ` — Season ${season}` : '') + '** (FW force win, FL force loss, FS fair sim)\n```\n' + lines.join('\n').slice(0, 1800) + '\n```');
      }

      if (i.isButton() && i.customId.startsWith('gc:')) {
        const store = load(), cfg = store.config;
        const wk = Object.values(store.weeks).find(w => w.channels[i.channelId]);
        const st = wk?.channels[i.channelId];
        if (!st) return i.reply({ content: 'This game channel is no longer tracked.', ephemeral: true });
        const admin = isAdminFor(i, cfg), coaches = coachesOf(st), isCoach = coaches.includes(i.user.id);
        const action = i.customId.slice(3);
        if (!admin && !isCoach && coaches.length) return i.reply({ content: 'Only the coaches in this game or the admin role can use these.', ephemeral: true });
        if (action === 'sched') {
          st.scheduled = true; save(store);
          await i.update({ components: [rowFor(st)] });
          return i.followUp({ content: `⏰ ${i.user} marked this game as scheduled. Reminders stopped.`, allowedMentions: { parse: [] } });
        }
        if (action === 'home' || action === 'away') {
          if (st.sim) return i.reply({ content: 'A sim was already confirmed for this game.', ephemeral: true });
          const side = action === 'home' ? 'HOME' : 'AWAY';
          const next = L.toggleRequest(st.requests, i.user.id, side);
          st.requests = next; save(store);
          const result = L.simResult(next);
          return i.reply({ content: `${side === 'HOME' ? '🏠' : '✈️'} Request recorded: **${result ? L.SIM_LABEL[result] : 'none'}**. <@&${cfg.adminRoleId}> press ⏭ **Confirm sim** to confirm it.`, allowedMentions: { roles: [cfg.adminRoleId] } });
        }
        if (action === 'sim') {
          if (!admin) return i.reply({ content: 'Only the admin role can confirm a sim.', ephemeral: true });
          const result = L.simResult(st.requests);
          if (!result) return i.reply({ content: 'Nobody has requested a sim yet. Coaches press 🏠 or ✈️ first (both for a fair sim).', ephemeral: true });
          st.sim = result; st.done = true;
          const cur = await franchise.getCurrent().catch(() => ({}));
          store.sims.push({ week: wk.week, season: cur.season !== null && cur.season !== undefined ? cur.season + 1 : null, result, away: st.away, home: st.home, awayId: st.awayId, homeId: st.homeId, confirmedBy: i.user.id, at: Date.now() });
          save(store);
          await i.update({ components: [rowFor(st, true)] });
          await i.followUp({ content: `⏭ **${L.SIM_LABEL[result]}** confirmed by ${i.user}. Game logged — this channel can be cleared.`, allowedMentions: { parse: [] } });
          return updateScoreboard(i.guild, store, String(wk.week));
        }
        if (action === 'done') {
          st.done = true; save(store);
          await i.reply({ content: '🏆 Thanks! Cleaning up this channel…' });
          await updateScoreboard(i.guild, store, String(wk.week));
          setTimeout(() => i.channel.delete('Game finished').catch(() => {}), 4000);
          return;
        }
      }
    } catch (e) {
      const msg = e instanceof franchise.UserError ? e.message : `Something went wrong: ${e.message}`;
      if (!(e instanceof franchise.UserError)) console.error('[game_channels]', e);
      try { if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ content: msg, ephemeral: true }); } catch {}
    }
  });

  // Used by /update-sync and the periodic refresh: re-render every tracked weekly scoreboard.
  async function refreshScoreboards() {
    const store = load();
    for (const k of Object.keys(store.weeks)) await updateScoreboard(null, store, k);
    return Object.keys(store.weeks).length;
  }
  client.once('ready', () => { const t = setInterval(() => refreshScoreboards().catch(() => {}), 5 * 60 * 1000); t.unref?.(); });
  return { refreshScoreboards };
};
