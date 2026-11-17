'use strict';
// Trade Committee: /trade configure and /trade submit, with Approve/Reject voting buttons.
// Ported from snallabot-service (src/discord/commands/trade.ts), MIT License,
// Copyright (c) 2024 snallabot. See SNALLABOT_LICENSE.md.
//
// Differences from Snallabot: players come from the live EA roster of the chosen team (via
// franchise.js) instead of Snallabot's stored export, and trades are kept in data/trades.json.
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const D = require('./franchiseData');
const T = require('./tradeLogic');

const CONFIG_FILE = path.join(__dirname, 'data', 'trade_config.json');
const TRADES_FILE = path.join(__dirname, 'data', 'trades.json');
const SLOTS = [1, 2, 3];

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = function installTrade(client, commands, ctx) {
  const { GUILD_ID, franchise } = ctx;
  const { UserError } = franchise;

  const slot = (o, name, desc, required = false) => o.setName(name).setDescription(desc).setRequired(required).setAutocomplete(true);
  commands.push(new SlashCommandBuilder().setName('trade').setDescription('Submit trades for Trade Committee approval.')
    .addSubcommand(s => s.setName('configure').setDescription('Admin: set the trade channel, committee role and approvals needed.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel where trades are posted').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName('trade_committee_role').setDescription('Role allowed to vote').setRequired(true))
      .addIntegerOption(o => o.setName('required_approvals').setDescription('Approvals (or rejections) needed to decide a trade').setRequired(true).setMinValue(1).setMaxValue(25))
      .addChannelOption(o => o.setName('accepted_trades_channel').setDescription('Where approved trades are moved (default: same channel)').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName('declined_trades_channel').setDescription('Where rejected trades are moved (default: same channel)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => {
      // Discord requires the required options (the two teams) to come first.
      s.setName('submit').setDescription('Submit a trade for Trade Committee approval.');
      const add = (name, desc, required) => s.addStringOption(o => slot(o, name, desc, required));
      add('team_a', 'Team sending the first group of assets', true);
      add('team_b', 'Team sending the second group of assets', true);
      for (const side of ['a', 'b']) {
        for (const n of SLOTS) add(`team_${side}_player_${n}`, `Team ${side.toUpperCase()} player ${n} (optional)`, false);
        for (const n of SLOTS) add(`team_${side}_pick_${n}`, `Team ${side.toUpperCase()} draft pick ${n} (optional)`, false);
      }
      return s;
    }));

  const getConfig = () => readJson(CONFIG_FILE, null);
  const trades = () => readJson(TRADES_FILE, {});
  const textFor = (trade, cfg) => T.tradeText(trade, cfg.roleId, { hiddenDevs: franchise.hiddenDevs, coachOf: franchise.ownerOf });

  function components(trade) {
    const locked = trade.status !== T.STATUS.PENDING;
    const rows = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`trade_vote:${trade.id}:APPROVE`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(locked),
      new ButtonBuilder().setCustomId(`trade_vote:${trade.id}:REJECT`).setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(locked))];
    const players = [...trade.teamA.receives, ...trade.teamB.receives].filter(a => a.type === 'PLAYER').slice(0, 25);
    if (players.length) {
      rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`trade_player:${trade.id}`).setPlaceholder('View a player in this trade').setMinValues(1).setMaxValues(1)
        .addOptions(players.map(p => ({ label: `${p.pos} ${p.name}`.slice(0, 100), description: `${p.ovr} OVR • Age ${p.age ?? '?'}`.slice(0, 100), value: String(p.id).slice(0, 100) })))));
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  client.on('interactionCreate', async i => {
    try {
      if (i.isAutocomplete() && i.commandName === 'trade') return await autocomplete(i);
      if (i.isChatInputCommand() && i.commandName === 'trade') {
        if (!i.inGuild() || (GUILD_ID && i.guildId !== GUILD_ID)) return;
        return await (i.options.getSubcommand() === 'configure' ? configure(i) : submit(i));
      }
      if (i.isButton() && i.customId.startsWith('trade_vote:')) return await vote(i);
      if (i.isStringSelectMenu() && i.customId.startsWith('trade_player:')) return await viewPlayer(i);
    } catch (err) {
      const msg = err instanceof UserError ? `⚠️ ${err.message}` : `❌ Something went wrong: ${String(err.message || err).slice(0, 300)}`;
      if (!(err instanceof UserError)) console.error('[trade]', err);
      if (i.isRepliable?.()) {
        if (i.deferred || i.replied) await i.editReply({ content: msg, embeds: [], components: [] }).catch(() => {});
        else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });

  async function configure(i) {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
    const channel = i.options.getChannel('channel', true), role = i.options.getRole('trade_committee_role', true);
    const requiredApprovals = i.options.getInteger('required_approvals', true);
    const accepted = i.options.getChannel('accepted_trades_channel'), declined = i.options.getChannel('declined_trades_channel');
    writeJson(CONFIG_FILE, {
      channelId: channel.id, roleId: role.id, requiredApprovals,
      acceptedChannelId: accepted?.id || channel.id, declinedChannelId: declined?.id || channel.id
    });
    return i.reply({
      ephemeral: true,
      content: `Trade command is configured!\n- Trade submissions: <#${channel.id}>\n- Trade committee role: <@&${role.id}>\n- Required approvals: ${requiredApprovals}\n- Accepted trades: ${accepted ? `<#${accepted.id}>` : 'same channel'}\n- Declined trades: ${declined ? `<#${declined.id}>` : 'same channel'}`
    });
  }

  async function submit(i) {
    await i.deferReply({ ephemeral: true });
    const cfg = getConfig();
    if (!cfg) throw new UserError('Trades are not configured yet. An admin needs to run `/trade configure` first.');
    const teams = await franchise.getTeams();
    const teamA = franchise.findTeam(teams, i.options.getString('team_a', true));
    const teamB = franchise.findTeam(teams, i.options.getString('team_b', true));
    if (!teamA || !teamB) throw new UserError("I couldn't find one of those teams. Pick them from the dropdown.");
    if (teamA.id === teamB.id) throw new UserError('A team cannot trade with itself.');

    // What each team SENDS (players from its roster plus free-text/dropdown picks).
    async function sends(team, side) {
      const roster = await franchise.getRoster(team);
      const players = [];
      for (const n of SLOTS) {
        const id = i.options.getString(`team_${side}_player_${n}`);
        if (!id) continue;
        if (id.startsWith('__')) throw new UserError('Choose players from the dropdown list (the roster may still have been loading — try again).');
        const p = roster.find(r => String(r.id) === id);
        if (!p) throw new UserError(`One of the selected players is not on the ${team.name}.`);
        if (players.some(x => x.id === p.id)) throw new UserError(`${p.name} was selected twice.`);
        players.push({ type: 'PLAYER', ...p, teamId: team.id, team: team.name });
      }
      const picks = SLOTS.map(n => i.options.getString(`team_${side}_pick_${n}`)).filter(Boolean).map(label => ({ type: 'PICK', label: label.trim().slice(0, 80) }));
      return [...players, ...picks];
    }
    const [aSends, bSends] = await Promise.all([sends(teamA, 'a'), sends(teamB, 'b')]);
    if (!aSends.length || !bSends.length) throw new UserError('Each team must send at least one player or pick.');

    const trade = {
      id: T.newTradeId(), submittedBy: i.user.id, requiredApprovals: cfg.requiredApprovals, status: T.STATUS.PENDING, votes: {}, createdAt: Date.now(),
      teamA: { id: teamA.id, name: teamA.name, receives: bSends },
      teamB: { id: teamB.id, name: teamB.name, receives: aSends }
    };
    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserError('I can\'t access the trade channel. Ask an admin to run `/trade configure` again.');
    const coaches = [franchise.ownerOf(teamA.name), franchise.ownerOf(teamB.name)].filter(Boolean);
    const sent = await channel.send({ content: textFor(trade, cfg), components: components(trade), allowedMentions: { roles: [cfg.roleId], users: [i.user.id, ...coaches] } });
    trade.messageId = sent.id; trade.channelId = channel.id;
    const all = trades(); all[trade.id] = trade; writeJson(TRADES_FILE, all);
    return i.editReply(`Trade submitted for Trade Committee approval in <#${cfg.channelId}>.`);
  }

  async function vote(i) {
    const [, tradeId, choice] = i.customId.split(':');
    const cfg = getConfig();
    if (!cfg) return i.reply({ content: 'Trades are not configured.', ephemeral: true });
    if (!i.member?.roles?.cache?.has(cfg.roleId)) return i.reply({ content: 'Only the Trade Committee can vote on trades.', ephemeral: true });
    const all = trades();
    const result = T.applyVote(all[tradeId], i.user.id, choice);
    if (result.error) return i.reply({ content: result.error, ephemeral: true });
    const trade = result.trade;
    all[tradeId] = trade; writeJson(TRADES_FILE, all);

    const moveTo = trade.status === T.STATUS.APPROVED ? cfg.acceptedChannelId : trade.status === T.STATUS.REJECTED ? cfg.declinedChannelId : null;
    if (moveTo && moveTo !== cfg.channelId) {
      // Decided: move the post to the accepted/declined channel and remove the voting message.
      await i.deferUpdate();
      const target = await client.channels.fetch(moveTo).catch(() => null);
      if (!target?.isTextBased()) return i.followUp({ content: `Decided (${trade.status}), but I can't access <#${moveTo}> to move it.`, ephemeral: true });
      const moved = await target.send({ content: textFor(trade, cfg), components: components(trade), allowedMentions: { users: [trade.submittedBy] } });
      trade.messageId = moved.id; trade.channelId = target.id; all[tradeId] = trade; writeJson(TRADES_FILE, all);
      return i.message.delete().catch(() => {});
    }
    return i.update({ content: textFor(trade, cfg), components: components(trade), allowedMentions: { users: [trade.submittedBy] } });
  }

  async function viewPlayer(i) {
    const tradeId = i.customId.split(':')[1];
    const trade = trades()[tradeId];
    if (!trade) return i.reply({ content: 'This trade is no longer stored.', ephemeral: true });
    const player = [...trade.teamA.receives, ...trade.teamB.receives].find(a => a.type === 'PLAYER' && String(a.id) === i.values[0]);
    if (!player) return i.reply({ content: "I couldn't find that player.", ephemeral: true });
    return i.reply({ embeds: [franchise.playerCard(player)], ephemeral: true });
  }

  async function autocomplete(i) {
    if (i.options.getSubcommand(false) !== 'submit') return i.respond([]);
    const focused = i.options.getFocused(true), q = String(focused.value || '').toLowerCase();
    const name = focused.name;
    if (name === 'team_a' || name === 'team_b') {
      return i.respond(D.NFL.filter(([team, abbr]) => !q || team.toLowerCase().includes(q) || abbr.toLowerCase().includes(q))
        .slice(0, 25).map(([team, abbr]) => ({ name: `${team} (${abbr})`, value: team })));
    }
    const side = name.startsWith('team_a') ? 'team_a' : 'team_b';
    if (name.includes('_pick_')) {
      const year = await franchise.currentSeasonYear().catch(() => Number(process.env.MADDEN_SEASON || 2026));
      return i.respond(T.pickLabels(year, q).map(label => ({ name: label, value: label })));
    }
    const teamInput = i.options.getString(side);
    if (!teamInput) return i.respond([{ name: `Choose ${side} first`, value: '__none__' }]);
    const got = await franchise.rosterWithin(teamInput);
    if (!got) return i.respond([{ name: 'Loading this roster from EA… try again in a few seconds', value: '__loading__' }]);
    const taken = new Set(SLOTS.map(n => i.options.getString(`${side}_player_${n}`)).filter(Boolean));
    const hits = got.roster.filter(p => !taken.has(String(p.id)) && (!q || `${p.name} ${p.pos}`.toLowerCase().includes(q)))
      .sort((a, b) => b.ovr - a.ovr).slice(0, 25);
    return i.respond(hits.map(p => ({ name: `${p.pos} ${p.name} — ${p.ovr} OVR`.slice(0, 100), value: String(p.id).slice(0, 100) })));
  }

  return { getConfig };
};
