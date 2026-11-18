'use strict';
// EA franchise features for the FDL bot. Everything here reads the live Madden
// Connected Franchise through the connection that teamClaimer.js manages
// (/ea-connect), so there is nothing extra to set up once the bot is connected.
//
// Commands: /standings /schedule /roster /player /leaders /power-rankings
//           /free-agents /game-channels (admin) /auto-potw (admin) /franchise-debug (admin)
// Optional: AUTO_POTW=true posts Players of the Week by itself when a week finishes.
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const EA = require('./ea-connector');
const D = require('./franchiseData');

const POTW_CHANNEL_ID = process.env.POTW_CHANNEL_ID || '1468516903096942724';
// Face-card image. {id} is replaced with the player's portraitId from the roster export.
// If this URL pattern is wrong for your Madden version, the card simply has no picture;
// set PORTRAIT_URL_TEMPLATE in .env to fix it (or set it to "none" to turn pictures off).
const PORTRAIT_URL_TEMPLATE = process.env.PORTRAIT_URL_TEMPLATE || 'https://ratings-images-prod.pulse.ea.com/madden-nfl-27/portraits/{id}.png';
// Rookies with a non-Normal dev trait show as "Hidden" (Snallabot's default). HIDDEN_DEVS=false shows everything.
const PLAYER_CONFIG = path.join(__dirname, 'data', 'player_config.json');
// /player_configuration configure hidden_devs overrides the HIDDEN_DEVS env setting and survives restarts.
let HIDDEN_DEVS = String(process.env.HIDDEN_DEVS ?? 'true').toLowerCase() !== 'false';
try { const c = JSON.parse(fs.readFileSync(PLAYER_CONFIG, 'utf8')); if (typeof c.hiddenDevs === 'boolean') HIDDEN_DEVS = c.hiddenDevs; } catch { /* no saved setting */ }
function setHiddenDevs(v) { HIDDEN_DEVS = Boolean(v); fs.mkdirSync(path.dirname(PLAYER_CONFIG), { recursive: true }); fs.writeFileSync(PLAYER_CONFIG, JSON.stringify({ hiddenDevs: HIDDEN_DEVS })); }
const devTag = p => { const d = D.devShown(p, HIDDEN_DEVS); return d && d !== 'Normal' ? d : ''; };
const COLOR = 0x6f35c9;
const CACHE_MS = 5 * 60 * 1000;
const ROSTER_CACHE_MS = 15 * 60 * 1000;

class UserError extends Error {}

module.exports = function installFranchise(client, commands, ctx) {
  const { GUILD_ID, TEAMS, normalizeTeam, teamClaimer, features } = ctx;
  const admin = PermissionFlagsBits.Administrator;
  const STATE_FILE = path.join(__dirname, 'data', 'auto_potw.json');

  // ---------------------------------------------------------------------------
  // Small persistent record of which weeks already got a Players of the Week post.
  // ---------------------------------------------------------------------------
  function readState() {
    try { const v = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (v && typeof v.posted === 'object') return v; } catch { /* first run */ }
    return { posted: {} };
  }
  function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }

  // ---------------------------------------------------------------------------
  // EA access: one connection (owned by teamClaimer), cached results, and token
  // persistence. EA refreshes tokens as a side effect of any call, so if the refresh
  // token changed we save it - otherwise a restart could lose the login.
  // ---------------------------------------------------------------------------
  const cache = new Map(); // key -> { at, value } | { promise }
  function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && hit.value !== undefined && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
    if (hit && hit.promise) return hit.promise;
    const promise = fn().then(value => { cache.set(key, { at: Date.now(), value }); return value; })
      .catch(err => { cache.delete(key); throw err; });
    cache.set(key, { promise });
    return promise;
  }
  const peek = key => { const hit = cache.get(key); return hit && hit.value !== undefined ? hit.value : null; };

  async function withEA(fn) {
    const conn = teamClaimer.getConnection();
    if (!conn?.refreshToken || !conn?.leagueId) throw new UserError('FDL is not connected to the Madden franchise yet. An admin needs to run `/ea-connect`.');
    const before = conn.refreshToken;
    try { return await fn(conn); }
    finally {
      if (conn.refreshToken !== before) { try { teamClaimer.saveConnection(); } catch (e) { console.error('[franchise] could not save refreshed EA token:', e.message); } }
    }
  }

  const getTeams = () => cached('teams', CACHE_MS, async () => D.normalizeTeams(await withEA(c => EA.getTeams(c))));
  async function getStandings() {
    const teams = await getTeams();
    const raw = await cached('standings', CACHE_MS, () => withEA(c => EA.getStandings(c)));
    return D.normalizeStandings(raw, teams);
  }
  const getHub = () => cached('hub', CACHE_MS, () => withEA(c => EA.getLeagueInfo(c)));
  async function getCurrent() { return D.currentWeekFromHub(await getHub().catch(() => ({}))); }
  async function resolveWeek(requested) {
    if (requested) return requested;
    const { week } = await getCurrent();
    if (!week) throw new UserError("I couldn't tell which week the league is on. Add the week number, e.g. `week: 5`.");
    return week;
  }
  async function getGames(week) {
    const teams = await getTeams();
    const raw = await cached(`schedule:${week}`, CACHE_MS, () => withEA(c => EA.getSchedule(c, week - 1)));
    return D.normalizeGames(raw, teams);
  }
  const getStats = week => cached(`stats:${week}`, CACHE_MS, () => withEA(c => EA.getWeeklyStats(c, week - 1)));

  async function getRoster(team) {
    const teams = await getTeams(), byId = D.teamsById(teams);
    const raw = await cached(`roster:${team.id}`, ROSTER_CACHE_MS, () => withEA(c => EA.getTeamRoster(c, team.id, team.index)));
    return raw.map(p => D.normalizePlayer({ ...p, teamId: p.teamId ?? team.id }, byId));
  }
  async function getFreeAgents() {
    const teams = await getTeams(), byId = D.teamsById(teams);
    const raw = await cached('freeAgents', ROSTER_CACHE_MS, () => withEA(c => EA.getFreeAgents(c)));
    return raw.map(p => D.normalizePlayer({ ...p, teamId: 0 }, byId));
  }
  // Every rostered player + free agents. First call walks all 32 rosters, so it is slow;
  // the result is cached for 15 minutes.
  function getAllPlayers() {
    return cached('allPlayers', ROSTER_CACHE_MS, async () => {
      const teams = await getTeams();
      const all = [];
      for (const team of teams) all.push(...await getRoster(team));
      all.push(...await getFreeAgents().catch(() => []));
      return all;
    });
  }

  const findTeam = (teams, input) => {
    const full = normalizeTeam(input);
    const short = full ? TEAMS[full].short : String(input || '').trim();
    const lower = short.toLowerCase();
    return teams.find(t => t.name.toLowerCase() === lower || t.abbr.toLowerCase() === lower || t.nick.toLowerCase() === lower) || null;
  };
  const ownerOf = name => teamClaimer.ownerOfTeamName(name);

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  const teamOpt = (o, desc = 'NFL team') => o.setName('team').setDescription(desc).setAutocomplete(true);
  commands.push(
    new SlashCommandBuilder().setName('standings').setDescription('League standings by division.')
      .addStringOption(o => o.setName('conference').setDescription('Show one conference').addChoices({ name: 'AFC', value: 'AFC' }, { name: 'NFC', value: 'NFC' })),
    new SlashCommandBuilder().setName('schedule').setDescription("A week's games and scores.")
      .addIntegerOption(o => o.setName('week').setDescription('Week number (default: current week)').setMinValue(1).setMaxValue(23))
      .addStringOption(o => teamOpt(o, 'Only this team')),
    new SlashCommandBuilder().setName('roster').setDescription("A team's best players.")
      .addStringOption(o => teamOpt(o, 'NFL team').setRequired(true))
      .addStringOption(o => o.setName('position').setDescription('Filter, e.g. QB, WR, OL, DB')),
    new SlashCommandBuilder().setName('player').setDescription('Player card with face, ratings and dev trait.')
      .addStringOption(o => o.setName('name').setDescription('Player name').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('leaders').setDescription("A week's stat leaders.")
      .addStringOption(o => o.setName('category').setDescription('Stat').setRequired(true)
        .addChoices(...Object.entries(D.LEADER_CATEGORIES).map(([value, c]) => ({ name: c.label, value }))))
      .addIntegerOption(o => o.setName('week').setDescription('Week number (default: current week)').setMinValue(1).setMaxValue(23)),
    new SlashCommandBuilder().setName('lineup').setDescription("A team's starting lineup (best player at each spot).")
      .addStringOption(o => teamOpt(o, 'NFL team').setRequired(true)),
    new SlashCommandBuilder().setName('team-compare').setDescription('Two teams head to head: record, ratings, best players.')
      .addStringOption(o => o.setName('team1').setDescription('First team').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('team2').setDescription('Second team').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('player-list').setDescription('List every player matching a search (name, position or team).')
      .addStringOption(o => o.setName('search').setDescription('Part of a name, or a position like WR').setRequired(true)),
    new SlashCommandBuilder().setName('stats').setDescription('Player stat leaders for your league (Snallabot style).')
      .addSubcommand(s => s.setName('weekly').setDescription('Weekly stat leaders')
        .addStringOption(o => o.setName('stat_type').setDescription('passing, rushing, receiving, tackles...').setRequired(true).addChoices(...Object.entries(D.LEADER_CATEGORIES).map(([value, c]) => ({ name: c.label, value }))))
        .addIntegerOption(o => o.setName('week').setDescription('Optional week (default: current)').setMinValue(1).setMaxValue(23)))
      .addSubcommand(s => s.setName('season').setDescription('Season stat leaders')
        .addStringOption(o => o.setName('stat_type').setDescription('passing, rushing, receiving, tackles...').setRequired(true).addChoices(...Object.entries(D.LEADER_CATEGORIES).map(([value, c]) => ({ name: c.label, value }))))),
    new SlashCommandBuilder().setName('player_configuration').setDescription('Configure the players commands in your league (admin).')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName('configure').setDescription('Settings for players')
        .addBooleanOption(o => o.setName('hidden_devs').setDescription('Show rookies\' dev traits as Hidden (true) or reveal them (false)').setRequired(true))),
    new SlashCommandBuilder().setName('stat-leaders').setDescription('Season stat leaders (summed from every played week).')
      .addStringOption(o => o.setName('category').setDescription('Stat').setRequired(true)
        .addChoices(...Object.entries(D.LEADER_CATEGORIES).map(([value, c]) => ({ name: c.label, value })))),
    new SlashCommandBuilder().setName('compare').setDescription('Two players side by side.')
      .addStringOption(o => o.setName('player1').setDescription('First player').setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName('player2').setDescription('Second player').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('schedule-difficulty').setDescription("How tough a team's schedule is (opponent win % and rating).")
      .addStringOption(o => teamOpt(o, 'NFL team').setRequired(true)),
    new SlashCommandBuilder().setName('power-rankings').setDescription('FDL power rankings from record, point differential and team rating.'),
    new SlashCommandBuilder().setName('free-agents').setDescription('Best available free agents.')
      .addStringOption(o => o.setName('position').setDescription('Filter, e.g. QB, WR, OL, DB')),
    new SlashCommandBuilder().setName('franchise-hub').setDescription('League overview: week, coaches, top teams and this week\'s games.'),
    new SlashCommandBuilder().setName('team').setDescription('Team profile: record, division rank, power rank, coach and best players.')
      .addStringOption(o => teamOpt(o, 'NFL team').setRequired(true)),
    new SlashCommandBuilder().setName('playoff-picture').setDescription('Current playoff seeds and the bubble.')
      .addStringOption(o => o.setName('conference').setDescription('Show one conference').addChoices({ name: 'AFC', value: 'AFC' }, { name: 'NFC', value: 'NFC' })),
    new SlashCommandBuilder().setName('playoffs').setDescription('Playoff bracket: results by round, or the projected wild-card round.'),
    new SlashCommandBuilder().setName('team-schedule').setDescription("A team's full regular-season schedule and results.")
      .addStringOption(o => teamOpt(o, 'NFL team').setRequired(true)),
    new SlashCommandBuilder().setName('top-players').setDescription('Best players in the league by overall.')
      .addStringOption(o => o.setName('position').setDescription('Filter, e.g. QB, WR, OL, DB')),
    new SlashCommandBuilder().setName('game-channels').setDescription('Admin: create a channel for every game of a week and ping both coaches.')
      .addIntegerOption(o => o.setName('week').setDescription('Week number').setRequired(true).setMinValue(1).setMaxValue(23))
      .addStringOption(o => o.setName('category').setDescription('Category name (default: "Week N")'))
      .setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('auto-potw').setDescription("Admin: post this week's Players of the Week from Madden's weekly awards.")
      .addIntegerOption(o => o.setName('week').setDescription('Week number (default: current week)').setMinValue(1).setMaxValue(23))
      .addBooleanOption(o => o.setName('force').setDescription('Post again even if this week was already posted'))
      .setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('franchise-debug').setDescription('Admin: show the raw field names EA is sending (for fixing blank values).')
      .addStringOption(o => o.setName('dataset').setDescription('Which export').setRequired(true)
        .addChoices(...['teams', 'standings', 'schedule', 'roster', 'stats', 'hub', 'awards'].map(v => ({ name: v, value: v }))))
      .setDefaultMemberPermissions(admin)
  );
  const OWN = new Set(['franchise-hub', 'team', 'playoff-picture', 'playoffs', 'team-schedule', 'top-players', 'standings', 'schedule', 'roster', 'player', 'leaders', 'lineup', 'team-compare', 'player-list', 'stats', 'player_configuration', 'stat-leaders', 'compare', 'schedule-difficulty', 'power-rankings', 'free-agents', 'game-channels', 'auto-potw', 'franchise-debug']);

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const embed = (title, description) => new EmbedBuilder().setColor(COLOR).setAuthor({ name: 'FDL' }).setTitle(title).setDescription(description ? D.clip(description, 4000) : null).setTimestamp();
  const block = lines => '```\n' + D.clip(lines.join('\n'), 1000) + '\n```';
  const portraitUrl = p => {
    if (!p.portraitId || String(PORTRAIT_URL_TEMPLATE).toLowerCase() === 'none') return null;
    return PORTRAIT_URL_TEMPLATE.replace('{id}', encodeURIComponent(p.portraitId));
  };

  function playerCard(p, alsoMatches = []) {
    const e = embed(`${p.name}`, `**${p.pos || '—'}** • ${p.team}${p.jersey !== undefined && p.jersey !== null ? ` • #${p.jersey}` : ''}${p.age ? ` • Age ${p.age}` : ''}`)
      .setColor({ 'X-Factor': 0xe74c3c, Superstar: 0xf1c40f, Star: 0x3498db }[D.devShown(p, HIDDEN_DEVS)] || COLOR)
      .addFields(
        { name: 'Overall', value: `**${p.ovr || '—'}** ${D.bar(p.ovr, 12)}`, inline: true },
        { name: 'Development', value: `${D.devEmoji(p, HIDDEN_DEVS)} ${D.devShown(p, HIDDEN_DEVS) || '—'}`, inline: true }
      );
    const top = D.topRatings(p, 8);
    if (top.length) e.addFields({ name: 'Top ratings', value: top.map(([k, v]) => `\`${k.padEnd(18).slice(0, 18)}\` ${D.bar(v, 10)} **${v}**`).join('\n') });
    const img = portraitUrl(p);
    if (img) e.setThumbnail(img);
    if (alsoMatches.length) e.setFooter({ text: `Also matches: ${alsoMatches.slice(0, 4).map(m => `${m.name} (${m.pos}, ${m.team})`).join(' • ')}` });
    return e;
  }

  // ---------------------------------------------------------------------------
  // Players of the Week from EA stats
  // ---------------------------------------------------------------------------
  // Madden decides the weekly awards itself after each sim; we read them from EA (never score box scores).
  // Madden shows four weekly awards: AFC/NFC Offense and AFC/NFC Defense, each with the player's stat line.
  // 1) use the awards Madden itself publishes (if the EA export carries them), 2) otherwise pick the best
  // performer per slot from that week's stats. Either way each line carries the stat line.
  async function buildPotw(week) {
    const [hub, players, stats, standings, teams] = await Promise.all([getHub().catch(() => null), getAllPlayers(), getStats(week).catch(() => ({})), getStandings(), getTeams()]);
    const byId = D.teamsById(teams);
    const confOfId = Object.fromEntries(standings.map(r => [r.teamId, (r.division || '').slice(0, 3)]));
    const perfs = D.playerPerformances(stats, byId);
    let awards = D.extractWeeklyAwards({ players, hub, week }), source = 'madden';
    if (awards.length) {
      awards = awards.map(a => {
        const perf = perfs.find(p => p.name === a.name && (!a.teamId || p.teamId === a.teamId)) || perfs.find(p => p.name === a.name);
        const conf = confOfId[a.teamId || perf?.teamId];
        const side = a.category === 'Offensive' ? 'Offense' : a.category === 'Defensive' ? 'Defense' : null;
        return { ...a, category: conf && side ? `${conf} ${side}` : a.category, statLine: perf?.statLine || '' };
      });
    } else {
      awards = D.conferenceAwards(perfs, id => confOfId[id] || null); source = 'stats';
    }
    if (!awards.length) {
      throw new UserError(`I don't have week ${week}'s stats or awards yet (they appear after the week is simmed). `
        + 'If this keeps happening after the sim, an admin can run `/franchise-debug dataset:awards` to see what EA is sending.');
    }
    for (const a of awards) if (!a.pos) a.pos = players.find(p => p.name === a.name && (!a.teamId || p.teamId === a.teamId))?.pos || '';
    const sig = `${source}|` + awards.map(a => `${a.category}:${a.name}`).join('|');
    const picked = awards.map(a => ({
      userId: ownerOf(a.team) || null, name: a.name, team: a.team,
      line: `**${a.category}:** **${a.name}** (${a.pos ? `${a.pos}, ` : ''}${a.team})${a.statLine ? `\n${a.statLine}` : ''}`
    }));
    picked.sig = sig; picked.source = source;
    return picked;
  }
  async function postPotw(week, { force = false, channelId = POTW_CHANNEL_ID } = {}) {
    const { season } = await getCurrent();
    const key = `${season ?? 'x'}-${week}`;
    const state = readState();
    if (state.posted[key] && !force) throw new UserError(`Players of the Week for week ${week} was already posted. Use \`force: true\` to post it again.`);
    const picked = await buildPotw(week);
    // Some EA fields are plain flags that stay set until the next awards come out: don't re-post last week's winners.
    if (!force && state.lastSig === picked.sig) throw new UserError(`Madden still shows last week's awards for week ${week}; waiting for the new ones.`);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserError(`I can't access the Players of the Week channel (${channelId}).`);
    const sent = await features.postPlayersOfWeek(channel, `Week ${week}`, picked.map(p => ({ userId: p.userId, line: p.line })), picked.source);
    state.posted[key] = { messageId: sent.id, channelId: channel.id, at: Date.now() };
    state.lastSig = picked.sig;
    writeState(state);
    return { sent, picked };
  }
  // Automatic: after a week is simmed Madden publishes its weekly awards; the first time they show up for a
  // week the bot posts a NEW Players of the Week message (never edits an old one). Set AUTO_POTW=false to turn off.
  const awardsWaiting = new Set();
  async function autoPotwTick() {
    const result = { posted: false };
    try {
      const { week: current, season } = await getCurrent();
      if (!current) return result;
      const state = readState();
      for (const week of [current - 1, current].filter(w => w >= 1)) {
        if (state.posted[`${season ?? 'x'}-${week}`]) continue;
        const games = await getGames(week);
        if (!games.length || !games.every(g => g.final)) continue;
        try { await postPotw(week); } catch (err) {
          if (err instanceof UserError) { if (!awardsWaiting.has(week)) { awardsWaiting.add(week); console.log(`[auto-potw] week ${week} is final; waiting for Madden's weekly awards`); } continue; }
          throw err;
        }
        console.log(`[auto-potw] posted Players of the Week for week ${week}`);
        return { posted: true, week };
      }
    } catch (err) {
      if (!(err instanceof UserError)) console.error('[auto-potw]', err.message || err);
    }
    return result;
  }
  if (String(process.env.AUTO_POTW ?? 'true').toLowerCase() !== 'false') {
    client.once('ready', () => {
      setTimeout(autoPotwTick, 60 * 1000).unref?.();
      setInterval(autoPotwTick, 15 * 60 * 1000).unref?.();
      console.log('[auto-potw] automatic Players of the Week is ON');
    });
  }


  // ---------------------------------------------------------------------------
  // Live posts: every public stat post (standings, leaders, free agents, rosters...) is remembered and
  // re-rendered on each Madden refresh, editing the SAME message in place. Players of the Week and
  // Game of the Week are NOT live - each of those is a new, separate post.
  // ---------------------------------------------------------------------------
  const LIVE = new Set(['franchise-hub', 'team', 'playoff-picture', 'playoffs', 'team-schedule', 'top-players', 'standings', 'schedule',
    'roster', 'player', 'leaders', 'stats', 'stat-leaders', 'power-rankings', 'free-agents', 'schedule-difficulty', 'compare', 'lineup', 'team-compare', 'player-list']);
  const HEAVY = new Set(['stat-leaders', 'schedule-difficulty']); // read up to 18 weeks; refreshed every 3rd cycle
  const LIVE_FILE = path.join(__dirname, 'data', 'live_posts.json');
  const LIVE_MAX = 100, LIVE_PER_CHANNEL = 20;
  const liveState = (() => { try { return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')); } catch { return { posts: [] }; } })();
  const saveLive = () => { fs.mkdirSync(path.dirname(LIVE_FILE), { recursive: true }); const tmp = LIVE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(liveState)); fs.renameSync(tmp, LIVE_FILE); };
  let liveTick = 0, liveBusy = false;

  const snapshotOptions = i => {
    const data = i.options?.data || [];
    const sub = data.find(o => o.type === 1);
    return { sub: sub ? sub.name : null, opts: Object.fromEntries((sub ? sub.options || [] : data).map(o => [o.name, o.value])) };
  };
  const fakeOptions = snap => ({
    getSubcommand: () => snap.sub,
    getString: k => (snap.opts[k] === undefined ? null : String(snap.opts[k])),
    getInteger: k => (snap.opts[k] === undefined ? null : Number(snap.opts[k])),
    getNumber: k => (snap.opts[k] === undefined ? null : Number(snap.opts[k])),
    getBoolean: k => (snap.opts[k] === undefined ? null : Boolean(snap.opts[k])),
    getUser: () => null, getChannel: () => null, getRole: () => null
  });

  async function registerLive(i) {
    try {
      const msg = await i.fetchReply();
      if (!msg?.id) return;
      liveState.posts.push({ messageId: msg.id, channelId: i.channelId, guildId: i.guildId, command: i.commandName, snap: snapshotOptions(i), at: Date.now(), hash: null });
      // keep the newest per channel / overall
      const mine = liveState.posts.filter(p => p.channelId === i.channelId);
      for (const old of mine.slice(0, Math.max(0, mine.length - LIVE_PER_CHANNEL))) liveState.posts.splice(liveState.posts.indexOf(old), 1);
      if (liveState.posts.length > LIVE_MAX) liveState.posts.splice(0, liveState.posts.length - LIVE_MAX);
      saveLive();
    } catch (err) { console.error('[live] could not register post:', err.message || err); }
  }

  // Re-runs a command with the options it was originally posted with and returns the new payload.
  async function renderLive(post) {
    let payload = null;
    const fake = {
      commandName: post.command, options: fakeOptions(post.snap), guildId: post.guildId, channelId: post.channelId,
      inGuild: () => true, isRepliable: () => true, deferred: true, replied: false,
      memberPermissions: { has: () => false }, user: { id: 'live-refresh', tag: 'live' },
      deferReply: async () => {}, editReply: async p => { payload = typeof p === 'string' ? { content: p } : p; }, reply: async p => { payload = typeof p === 'string' ? { content: p } : p; }
    };
    await run(fake);
    return payload;
  }
  const fingerprint = payload => JSON.stringify({ c: payload.content || '', e: (payload.embeds || []).map(e => { const j = e.toJSON ? e.toJSON() : { ...e }; delete j.timestamp; return j; }) });

  async function refreshLive({ force = false } = {}) {
    if (liveBusy) return { updated: 0, checked: 0, skipped: true };
    liveBusy = true;
    let updated = 0, checked = 0, dirty = false;
    try {
      liveTick++;
      for (const post of [...liveState.posts]) {
        if (!force && HEAVY.has(post.command) && liveTick % 3 !== 0) continue;
        checked++;
        try {
          const payload = await renderLive(post);
          if (!payload) continue;
          const fp = fingerprint(payload);
          if (fp === post.hash) continue;
          const channel = await client.channels.fetch(post.channelId);
          await channel.messages.edit(post.messageId, { content: payload.content ?? '', embeds: payload.embeds || [], components: payload.components || [] });
          post.hash = fp; updated++; dirty = true;
        } catch (err) {
          if (err instanceof UserError) continue; // EA hiccup or empty data: keep the old post as it is
          if ([10008, 10003, 50001, 50013].includes(err?.code)) { liveState.posts.splice(liveState.posts.indexOf(post), 1); dirty = true; continue; } // message/channel gone
          console.error(`[live] ${post.command}:`, err.message || err);
        }
        await new Promise(r => setTimeout(r, 700)); // stay well under Discord's edit rate limit
      }
      if (dirty) saveLive();
    } finally { liveBusy = false; }
    return { updated, checked };
  }
  const invalidate = () => cache.clear();
  client.once('ready', () => {
    const t = setInterval(() => refreshLive().catch(e => console.error('[live]', e.message || e)), CACHE_MS + 15 * 1000);
    t.unref?.();
  });

  // ---------------------------------------------------------------------------
  // Interaction handling
  // ---------------------------------------------------------------------------
  client.on('interactionCreate', async i => {
    try {
      if (i.isAutocomplete() && OWN.has(i.commandName)) return await autocomplete(i);
      if (!i.isChatInputCommand() || !OWN.has(i.commandName)) return;
      if (!i.inGuild() || (GUILD_ID && i.guildId !== GUILD_ID)) return;
      // Admin tools answer privately; everything else is public so the league can see it.
      await i.deferReply({ ephemeral: ['franchise-debug', 'game-channels', 'auto-potw'].includes(i.commandName) });
      await run(i);
      if (LIVE.has(i.commandName)) await registerLive(i);
    } catch (err) {
      const msg = err instanceof UserError ? `⚠️ ${err.message}` : `❌ Something went wrong: ${String(err.message || err).slice(0, 300)}`;
      if (!(err instanceof UserError)) console.error('[franchise]', err);
      if (i.isRepliable()) {
        if (i.deferred || i.replied) await i.editReply({ content: msg, embeds: [], components: [] }).catch(() => {});
        else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });

  async function autocomplete(i) {
    const focused = i.options.getFocused(true);
    const q = String(focused.value || '').toLowerCase();
    if (['team', 'team1', 'team2'].includes(focused.name)) {
      const names = Object.keys(TEAMS).filter(t => !q || t.toLowerCase().includes(q) || TEAMS[t].short.toLowerCase().includes(q) || TEAMS[t].abbr.toLowerCase().includes(q));
      return i.respond(names.slice(0, 25).map(t => ({ name: `${TEAMS[t].short} (${TEAMS[t].abbr})`, value: t })));
    }
    if (['name', 'player1', 'player2'].includes(focused.name)) {
      const players = peek('allPlayers') || []; // never trigger a slow EA fetch from autocomplete
      if (!q || q.length < 2) return i.respond([]);
      const hits = players.filter(p => p.name.toLowerCase().includes(q)).sort((a, b) => b.ovr - a.ovr).slice(0, 25);
      return i.respond(hits.map(p => ({ name: D.clip(`${p.name} — ${p.pos}, ${p.team} (${p.ovr})`, 100), value: D.clip(p.name, 100) })));
    }
    return i.respond([]);
  }

  async function run(i) {
    const name = i.commandName;

    if (name === 'franchise-hub') {
      const conn = teamClaimer.getConnection() || {};
      const [teams, rows, cur] = await Promise.all([getTeams(), getStandings(), getCurrent()]);
      const claimed = teams.filter(t => ownerOf(t.name)).length;
      const e = embed(`🏟️ ${conn.leagueName || 'FDL Franchise'}`, `${cur.season !== null && cur.season !== undefined ? `Season **${cur.season + 1}** • ` : ''}${cur.week ? `Week **${cur.week}**` : 'Week unknown'}`)
        .addFields({ name: 'Coaches', value: `**${claimed}/${teams.length}** teams claimed`, inline: true });
      const top = D.powerRankings(rows).slice(0, 5);
      if (top.length) e.addFields({ name: 'Top 5 (power rankings)', value: top.map((r, n) => `**${n + 1}.** ${r.name} (${D.recordText(r)})`).join('\n'), inline: true });
      if (cur.week) {
        const games = await getGames(cur.week).catch(() => []);
        if (games.length) {
          const done = games.filter(g => g.final).length;
          e.addFields({ name: `Week ${cur.week} games`, value: `**${done}/${games.length}** final${done < games.length ? '' : ' — week complete ✅'}\n${games.slice(0, 8).map(D.gameLine).join('\n')}` });
        }
      }
      e.addFields({ name: 'More', value: '`/standings` `/playoff-picture` `/power-rankings` `/schedule` `/leaders` `/team` `/player` `/top-players` `/free-agents`' });
      return i.editReply({ embeds: [e] });
    }

    if (name === 'team') {
      const teams = await getTeams();
      const team = findTeam(teams, i.options.getString('team', true));
      if (!team) throw new UserError("I couldn't find that team.");
      const rows = await getStandings();
      const prof = D.teamProfile(team, rows, D.powerRankings(rows));
      if (!prof) throw new UserError(`No standings found for the ${team.name} yet.`);
      const { row } = prof, owner = ownerOf(team.name);
      const e = embed(`${team.name}`, `${owner ? `Coach: <@${owner}>` : 'No coach claimed yet'}${team.user ? ` • EA: \`${team.user}\`` : ''}`)
        .addFields(
          { name: 'Record', value: `**${D.recordText(row)}** (${D.signed(row.diff)})`, inline: true },
          { name: row.division || 'Division', value: prof.divisionRank ? `${D.ordinal(prof.divisionRank)} of ${prof.divisionSize}` : '—', inline: true },
          { name: 'Power rank', value: prof.powerRank ? `${D.ordinal(prof.powerRank)} of ${prof.powerTotal}` : '—', inline: true },
          { name: 'Team overall', value: `${row.ovr || team.ovr || '—'}`, inline: true },
          { name: 'Points', value: `${row.pf} for • ${row.pa} against`, inline: true }
        );
      const roster = await getRoster(team).catch(() => []);
      if (roster.length) e.addFields({ name: 'Best players', value: roster.sort((a, b) => b.ovr - a.ovr).slice(0, 5).map(p => `**${p.ovr}** ${p.name} (${p.pos})${devTag(p) ? ` — ${devTag(p)}` : ''}`).join('\n') });
      const { week } = await getCurrent();
      if (week) {
        const game = (await getGames(week).catch(() => [])).find(g => g.awayId === team.id || g.homeId === team.id);
        if (game) e.addFields({ name: `Week ${week}`, value: D.gameLine(game) });
      }
      return i.editReply({ embeds: [e] });
    }

    if (name === 'playoffs') {
      const e = embed('🏆 Playoff Bracket').setFooter({ text: 'Bracket per Snallabot • projection uses current standings' });
      let any = false;
      for (const r of D.PLAYOFF_ROUNDS) {
        const games = await getGames(r.week).catch(() => []);
        if (!games.length) continue;
        any = true;
        e.addFields({ name: r.name, value: games.map(D.gameLine).join('\n').slice(0, 1000) });
      }
      if (!any) {
        const proj = D.projectedWildCard(D.playoffPicture(await getStandings()));
        for (const conf of ['AFC', 'NFC']) {
          const p = proj[conf];
          if (!p.games.length) continue;
          const lines = p.games.map(g => `(${g.home.seed}) ${g.home.team.name} vs (${g.away.seed}) ${g.away.team.name}`);
          if (p.bye) lines.push(`🛌 Bye: (1) ${p.bye.team.name}`);
          e.addFields({ name: `${conf} wild card (projected)`, value: lines.join('\n') });
        }
        if (!e.data?.fields?.length) throw new UserError('No standings available yet.');
      }
      return i.editReply({ embeds: [e] });
    }

    if (name === 'team-schedule') {
      const teams = await getTeams();
      const input = i.options.getString('team', true);
      const team = findTeam(teams, input);
      if (!team) throw new UserError(`I couldn't find a team called "${input}".`);
      if (!peek(`schedule:${1}`)) await i.editReply('🔎 Loading the season schedule from EA…');
      const byWeek = {};
      for (let w = 1; w <= 18; w++) byWeek[w] = await getGames(w).catch(() => []);
      const log = D.teamSeasonLog(team.id, byWeek);
      return i.editReply({ content: '', embeds: [embed(`📅 ${team.name} Schedule`, block(log.map(D.seasonLogLine))).setFooter({ text: 'W/L with final score' })] });
    }

    if (name === 'playoff-picture') {
      const rows = await getStandings();
      const pic = D.playoffPicture(rows);
      const only = i.options.getString('conference');
      const e = embed('🏆 Playoff Picture').setFooter({ text: 'Seeds 1-4 division winners • tiebreaks: record, then point differential only' });
      for (const conf of ['AFC', 'NFC']) {
        if (only && only !== conf) continue;
        const p = pic[conf];
        if (!p.seeds.length) continue;
        const lines = p.seeds.map(s => `**${s.seed}.** ${s.team.name} (${D.recordText(s.team)})${s.divisionWinner ? ' 🏅' : ''}`);
        if (p.bubble.length) lines.push(`_On the bubble:_ ${p.bubble.map(t => `${t.name} (${D.recordText(t)})`).join(', ')}`);
        e.addFields({ name: conf, value: lines.join('\n'), inline: true });
      }
      if (!e.data?.fields?.length) throw new UserError('No standings available yet.');
      return i.editReply({ embeds: [e] });
    }

    if (name === 'top-players') {
      const pos = i.options.getString('position');
      if (!peek('allPlayers')) await i.editReply('🔎 Loading every roster from EA — the first lookup takes a minute…');
      const players = (await getAllPlayers()).filter(p => D.matchesPosition(p.pos, pos)).sort((a, b) => b.ovr - a.ovr).slice(0, 15);
      if (!players.length) throw new UserError(`No ${pos ? pos.toUpperCase() + ' ' : ''}players found.`);
      const lines = players.map((p, n) => `${String(n + 1).padStart(2)} ${p.name.slice(0, 20).padEnd(20)} ${p.pos.padEnd(4)} ${String(p.ovr).padStart(2)} ${p.team.slice(0, 11)}`);
      return i.editReply({ content: '', embeds: [embed(`⭐ Top Players${pos ? ` — ${pos.toUpperCase()}` : ''}`, block(lines)).setFooter({ text: 'Top 15 by overall, including free agents' })] });
    }

    if (name === 'standings') {
      const rows = await getStandings();
      const groups = D.groupStandings(rows, i.options.getString('conference'));
      if (!groups.length) throw new UserError('No standings available yet.');
      const e = embed('🏈 FDL Standings').setFooter({ text: 'W-L-T (point differential)' });
      for (const g of groups) {
        e.addFields({ name: g.division, value: g.teams.map((t, n) => `${n + 1}. **${t.name}** ${D.recordText(t)} (${D.signed(t.diff)})`).join('\n'), inline: true });
      }
      return i.editReply({ embeds: [e] });
    }

    if (name === 'schedule') {
      const week = await resolveWeek(i.options.getInteger('week'));
      const teams = await getTeams();
      let games = await getGames(week);
      const teamInput = i.options.getString('team');
      if (teamInput) {
        const team = findTeam(teams, teamInput);
        if (!team) throw new UserError(`I couldn't find a team called "${teamInput}".`);
        games = games.filter(g => g.awayId === team.id || g.homeId === team.id);
      }
      if (!games.length) throw new UserError(`No games found for week ${week}.`);
      return i.editReply({ embeds: [embed(`📅 Week ${week} Schedule`, games.map(D.gameLine).join('\n')).setFooter({ text: '✅ = final' })] });
    }

    if (name === 'lineup') {
      const team = findTeam(await getTeams(), i.options.getString('team', true));
      if (!team) throw new UserError("I couldn't find that team.");
      const groups = D.lineup(await getRoster(team));
      if (!groups.length) throw new UserError(`No roster found for the ${team.name}.`);
      const lines = groups.flatMap(g => g.players.map((p, n) => `${(n ? '' : g.group).padEnd(3)} ${p.pos.padEnd(4)} ${p.name.slice(0, 20).padEnd(20)} ${String(p.ovr).padStart(2)} ${(devTag(p) || '').slice(0, 9)}`));
      const owner = ownerOf(team.name);
      return i.editReply({ embeds: [embed(`${team.name} Starting Lineup`, `${owner ? `Coach: <@${owner}>\n` : ''}${block(lines)}`)] });
    }

    if (name === 'team-compare') {
      const teams = await getTeams();
      const [t1, t2] = [i.options.getString('team1', true), i.options.getString('team2', true)].map(q => findTeam(teams, q));
      if (!t1 || !t2) throw new UserError(`I couldn't find ${!t1 ? 'the first' : 'the second'} team.`);
      if (t1.id === t2.id) throw new UserError('Pick two different teams.');
      const [rows, r1, r2] = await Promise.all([getStandings(), getRoster(t1), getRoster(t2)]);
      const c = D.teamCompare(t1, t2, rows, r1, r2), n1 = x => (x ? x.toFixed(1) : '—');
      const mark = (x, y, flip = false) => (x === y ? ['', ''] : (flip ? x < y : x > y) ? ['✅', ''] : ['', '✅']);
      const rowsOut = [['Record', c.a.record, c.b.record, ['', '']], ['Overall', c.a.ovr, c.b.ovr, mark(c.a.ovr, c.b.ovr)], ['Offense', n1(c.a.offense), n1(c.b.offense), mark(c.a.offense, c.b.offense)],
        ['Defense', n1(c.a.defense), n1(c.b.defense), mark(c.a.defense, c.b.defense)], ['Pts For', c.a.pf, c.b.pf, mark(c.a.pf, c.b.pf)], ['Pts Against', c.a.pa, c.b.pa, mark(c.a.pa, c.b.pa, true)],
        ['Point Diff', D.signed ? D.signed(c.a.diff) : c.a.diff, D.signed ? D.signed(c.b.diff) : c.b.diff, mark(c.a.diff, c.b.diff)]]
        .map(([l, a, b, [ma, mb]]) => `${ma ? '✅' : '  '}${String(a).padStart(6)} │ ${l.padEnd(11)} │ ${String(b).padEnd(6)}${mb ? '✅' : ''}`);
      const best = t => t.best.map(p => `${p.name} (${p.pos} ${p.ovr})`).join(', ');
      return i.editReply({ embeds: [embed(`${c.a.name} vs ${c.b.name}`, `${block(rowsOut)}`).addFields({ name: c.a.name, value: best(c.a) || '—' }, { name: c.b.name, value: best(c.b) || '—' })] });
    }

    if (name === 'player-list') {
      const q = i.options.getString('search', true).toLowerCase().trim();
      if (!peek('allPlayers')) await i.editReply('🔎 Loading every roster from EA — the first lookup takes a minute…');
      const all = await getAllPlayers();
      const hits = all.filter(p => p.name.toLowerCase().includes(q) || (q.length <= 4 && D.matchesPosition(p.pos, q))).sort((a, b) => b.ovr - a.ovr).slice(0, 25);
      if (!hits.length) throw new UserError(`No players match "${q}".`);
      const lines = hits.map(p => `${p.name.slice(0, 20).padEnd(20)} ${p.pos.padEnd(4)} ${String(p.ovr).padStart(2)} ${p.team.slice(0, 12)}`);
      return i.editReply({ embeds: [embed(`Players matching "${q}"`, block(lines)).setFooter({ text: `Top ${hits.length} by overall` })] });
    }

    if (name === 'roster') {
      const teams = await getTeams();
      const team = findTeam(teams, i.options.getString('team', true));
      if (!team) throw new UserError("I couldn't find that team.");
      const pos = i.options.getString('position');
      const players = (await getRoster(team)).filter(p => D.matchesPosition(p.pos, pos)).sort((a, b) => b.ovr - a.ovr).slice(0, 20);
      if (!players.length) throw new UserError(`No ${pos ? pos.toUpperCase() + ' ' : ''}players found for the ${team.name}.`);
      const lines = players.map(p => `${String(p.jersey ?? '').padStart(2)} ${p.name.slice(0, 20).padEnd(20)} ${p.pos.padEnd(4)} ${String(p.ovr).padStart(2)} ${(devTag(p) || '').slice(0, 9)}`);
      const owner = ownerOf(team.name);
      return i.editReply({ embeds: [embed(`${team.name} Roster${pos ? ` — ${pos.toUpperCase()}` : ''}`, `${owner ? `Coach: <@${owner}>\n` : ''}${block(lines)}`).setFooter({ text: `Top ${players.length} by overall` })] });
    }

    if (name === 'player') {
      const query = i.options.getString('name', true).toLowerCase().trim();
      if (!peek('allPlayers')) await i.editReply('🔎 Loading every roster from EA — the first lookup takes a minute…');
      const all = await getAllPlayers();
      const hits = all.filter(p => p.name.toLowerCase().includes(query)).sort((a, b) => (b.name.toLowerCase() === query) - (a.name.toLowerCase() === query) || b.ovr - a.ovr);
      if (!hits.length) throw new UserError(`I couldn't find a player matching "${query}".`);
      return i.editReply({ content: '', embeds: [playerCard(hits[0], hits.slice(1))] });
    }

    if (name === 'leaders' || (name === 'stats' && i.options.getSubcommand() === 'weekly')) {
      const category = i.options.getString('category') ?? i.options.getString('stat_type', true), cat = D.LEADER_CATEGORIES[category];
      const week = await resolveWeek(i.options.getInteger('week'));
      const teams = await getTeams();
      const leaders = D.weeklyLeaders(await getStats(week), category, D.teamsById(teams));
      if (!leaders.length) throw new UserError(`No ${cat.label.toLowerCase()} recorded for week ${week} yet.`);
      const medals = ['🥇', '🥈', '🥉'];
      return i.editReply({ embeds: [embed(`📊 Week ${week} — ${cat.label} Leaders`, leaders.map((l, n) => `${medals[n] || `**${n + 1}.**`} **${l.name}** (${l.team}) — **${l.value}** · ${l.detail}`).join('\n'))] });
    }

    if (name === 'player_configuration') {
      if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) throw new UserError('Administrator access required.');
      setHiddenDevs(i.options.getBoolean('hidden_devs', true));
      return i.editReply(`Hidden rookie dev traits are now **${HIDDEN_DEVS ? 'ON' : 'OFF'}**.`);
    }

    if (name === 'stat-leaders' || (name === 'stats' && i.options.getSubcommand() === 'season')) {
      const category = i.options.getString('category') ?? i.options.getString('stat_type', true), cat = D.LEADER_CATEGORIES[category];
      const { week } = await getCurrent();
      const last = Math.min(week || 18, 18);
      if (!peek(`stats:${last}`)) await i.editReply('🔎 Adding up the season from EA…');
      const teams = await getTeams();
      const list = [];
      for (let w = 1; w <= last; w++) list.push(await getStats(w).catch(() => null));
      const leaders = D.seasonLeaders(list, category, D.teamsById(teams));
      if (!leaders.length) throw new UserError(`No ${cat.label.toLowerCase()} recorded this season yet.`);
      const medals = ['🥇', '🥈', '🥉'];
      return i.editReply({ content: '', embeds: [embed(`📊 Season ${cat.label} Leaders`, leaders.map((l, n) => `${medals[n] || `**${n + 1}.**`} **${l.name}** (${l.team}) — **${l.value}** in ${l.games} game${l.games === 1 ? '' : 's'}`).join('\n')).setFooter({ text: `Weeks 1-${last}` })] });
    }

    if (name === 'compare') {
      if (!peek('allPlayers')) await i.editReply('🔎 Loading every roster from EA — the first lookup takes a minute…');
      const all = await getAllPlayers();
      const find = q => {
        const s = q.toLowerCase().trim();
        return all.filter(p => p.name.toLowerCase().includes(s)).sort((a, b) => (b.name.toLowerCase() === s) - (a.name.toLowerCase() === s) || b.ovr - a.ovr)[0];
      };
      const [q1, q2] = [i.options.getString('player1', true), i.options.getString('player2', true)];
      const a = find(q1), b = find(q2);
      if (!a || !b) throw new UserError(`I couldn't find ${!a ? `"${q1}"` : `"${q2}"`}.`);
      const rows = D.comparePlayers(a, b, HIDDEN_DEVS);
      const mark = (r, side) => (r.win === side ? '✅' : '  ');
      const lines = rows.map(r => `${mark(r, 'a')}${String(r.a).padStart(7)} │ ${r.label.slice(0, 16).padEnd(16)} │ ${String(r.b).padEnd(7)}${mark(r, 'b')}`);
      return i.editReply({ content: '', embeds: [embed(`${a.name} vs ${b.name}`, `**${a.name}** — ${a.pos}, ${a.team}\n**${b.name}** — ${b.pos}, ${b.team}\n${block(lines)}`)] });
    }

    if (name === 'schedule-difficulty') {
      const teams = await getTeams();
      const input = i.options.getString('team', true);
      const team = findTeam(teams, input);
      if (!team) throw new UserError(`I couldn't find a team called "${input}".`);
      if (!peek('schedule:1')) await i.editReply('🔎 Loading the season schedule from EA…');
      const byWeek = {};
      for (let w = 1; w <= 18; w++) byWeek[w] = await getGames(w).catch(() => []);
      const sos = D.scheduleDifficulty(team.id, byWeek, await getStandings());
      const pct = v => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
      if (!sos.remaining.length && !sos.played.length) throw new UserError('No schedule data available yet.');
      const e = embed(`🧗 ${team.name} Schedule Difficulty`)
        .addFields(
          { name: 'Remaining', value: `Opp win%: **${pct(sos.remainingWinPct)}**\nOpp OVR: **${sos.remainingOvr === null ? '—' : sos.remainingOvr.toFixed(1)}**\n${sos.remaining.length} games`, inline: true },
          { name: 'Played', value: `Opp win%: **${pct(sos.playedWinPct)}**\n${sos.played.length} games`, inline: true }
        );
      if (sos.remaining.length) e.addFields({ name: 'Toughest remaining', value: block([...sos.remaining].sort((a, b) => b.winPct - a.winPct).slice(0, 5).map(r => `Wk ${String(r.week).padStart(2)} ${r.home ? 'vs' : '@ '} ${r.opp.slice(0, 14).padEnd(14)} ${pct(r.winPct)}`)) });
      return i.editReply({ content: '', embeds: [e] });
    }

    if (name === 'power-rankings') {
      const ranked = D.powerRankings(await getStandings());
      if (!ranked.length) throw new UserError('No standings available yet.');
      const lines = ranked.map((r, n) => `**${n + 1}.** ${r.name} (${D.recordText(r)}) — ${r.score.toFixed(1)}`);
      return i.editReply({ embeds: [embed('👑 FDL Power Rankings', lines.join('\n')).setFooter({ text: 'Score = 60×win% + 1.5×point diff per game + 0.8×(team OVR − 75)' })] });
    }

    if (name === 'free-agents') {
      const pos = i.options.getString('position');
      const fas = (await getFreeAgents()).filter(p => D.matchesPosition(p.pos, pos)).sort((a, b) => b.ovr - a.ovr).slice(0, 15);
      if (!fas.length) throw new UserError(`No ${pos ? pos.toUpperCase() + ' ' : ''}free agents found.`);
      const lines = fas.map(p => `${p.name.slice(0, 22).padEnd(22)} ${p.pos.padEnd(4)} ${String(p.ovr).padStart(2)} ${p.age ? `age ${p.age}` : ''}`);
      return i.editReply({ embeds: [embed(`🆓 Free Agents${pos ? ` — ${pos.toUpperCase()}` : ''}`, block(lines)).setFooter({ text: `Top ${fas.length} by overall` })] });
    }

    if (name === 'game-channels') {
      const week = i.options.getInteger('week', true);
      const games = await getGames(week);
      if (!games.length) throw new UserError(`No games found for week ${week}.`);
      const guild = i.guild;
      const me = guild.members.me || await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) throw new UserError('I need the **Manage Channels** permission to create game channels.');
      await guild.channels.fetch();
      const categoryName = (i.options.getString('category') || `Week ${week}`).slice(0, 100);
      let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
      if (!category) category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: `FDL week ${week} game channels` });
      const existing = new Set(guild.channels.cache.filter(c => c.parentId === category.id).map(c => c.name));
      let created = 0, skipped = 0;
      for (const g of games) {
        const channelName = `wk${week}-${D.slug(g.away)}-at-${D.slug(g.home)}`.slice(0, 100);
        if (existing.has(channelName)) { skipped++; continue; }
        const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic: `Week ${week}: ${g.away} @ ${g.home}`, reason: `FDL week ${week} game channel` });
        const owners = [ownerOf(g.away), ownerOf(g.home)].filter(Boolean);
        const matchup = `${ownerOf(g.away) ? `<@${ownerOf(g.away)}> ` : ''}**${g.away}** @ **${g.home}**${ownerOf(g.home) ? ` <@${ownerOf(g.home)}>` : ''}`;
        await channel.send({ content: `**Week ${week}**\n${matchup}\n\nGood luck! Schedule your game and post the result here.`, allowedMentions: { users: owners } });
        created++;
      }
      return i.editReply(`✅ **${categoryName}**: created **${created}** game channel${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} that already existed` : ''}.`);
    }

    if (name === 'auto-potw') {
      const week = await resolveWeek(i.options.getInteger('week'));
      const { sent, picked } = await postPotw(week, { force: i.options.getBoolean('force') || false });
      return i.editReply(`✅ Posted Players of the Week for week ${week} in <#${sent.channelId}> (${picked.map(p => p.name).join(', ')}).`);
    }

    if (name === 'franchise-debug') {
      const dataset = i.options.getString('dataset', true);
      let sample, count;
      if (dataset === 'teams') { const raw = await withEA(c => EA.getTeams(c)); count = raw.length; sample = raw[0]; }
      else if (dataset === 'standings') { const raw = await withEA(c => EA.getStandings(c)); count = raw.length; sample = raw[0]; }
      else if (dataset === 'schedule') { const week = await resolveWeek(null); const raw = await withEA(c => EA.getSchedule(c, week - 1)); count = raw.length; sample = raw[0]; }
      else if (dataset === 'roster') { const teams = await getTeams(); const raw = await withEA(c => EA.getTeamRoster(c, teams[0].id, teams[0].index)); count = raw.length; sample = raw[0]; }
      else if (dataset === 'stats') { const week = await resolveWeek(null); const s = await withEA(c => EA.getWeeklyStats(c, week - 1)); count = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length])); sample = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v[0]])); }
      else if (dataset === 'awards') {
        const [hub, players] = await Promise.all([getHub().catch(() => ({})), getAllPlayers()]);
        const teams = await getTeams();
        const rawRow = (await withEA(c => EA.getTeamRoster(c, teams[0].id, teams[0].index)))[0] || {};
        sample = { ...D.describeAwardData(hub, players), playerRowFieldNames: Object.keys(rawRow).filter(k => /week|award|honor|potw/i.test(k)), allPlayerFieldCount: Object.keys(rawRow).length, hubTopLevelKeys: Object.keys(hub || {}), found_for_current_week: D.extractWeeklyAwards({ players, hub, week: (await getCurrent()).week }).map(a => `${a.category}: ${a.name} (${a.team}) via ${a.source}`) };
        count = '—';
      }
      else { sample = await getHub(); count = '—'; }
      const text = JSON.stringify(sample, null, 1) || 'null';
      return i.editReply({ content: `**${dataset}** — records: \`${JSON.stringify(count)}\`\n\`\`\`json\n${D.clip(text, 1700)}\n\`\`\`` });
    }
  }

  // Roster for an autocomplete: gives up after `ms` so Discord's 3-second limit is never hit.
  // The fetch keeps running in the background and is cached for the next keystroke.
  async function rosterWithin(teamInput, ms = 2200) {
    const work = (async () => {
      const team = findTeam(await getTeams(), teamInput);
      return team ? { team, roster: await getRoster(team) } : null;
    })();
    work.catch(() => {});
    return Promise.race([work, new Promise(resolve => setTimeout(() => resolve(null), ms))]).catch(() => null);
  }
  const currentSeasonYear = async () => {
    const { season } = await getCurrent().catch(() => ({}));
    return Number(process.env.MADDEN_SEASON || 2026) + (Number.isFinite(season) ? season : 0);
  };

  return {
    getStandings, getCurrent, getTeams, getRoster, getAllPlayers, getGames, getStats, findTeam, ownerOf,
    rosterWithin, currentSeasonYear, playerCard, withEA, UserError, embed, get hiddenDevs() { return HIDDEN_DEVS; },
    postPotw, autoPotwTick, refreshLive, invalidate, getHub, LIVE,
    // Render a command like a user ran it (for scheduled static posts): -> { content, embeds, components }
    renderCommand: (command, snap = { sub: null, opts: {} }) => renderLive({ command, snap, guildId: GUILD_ID, channelId: null })
  };
};
