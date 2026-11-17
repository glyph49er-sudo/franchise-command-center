'use strict';
// Pure helpers for gameChannels.js. Ported from snallabot-service (MIT, Copyright (c) 2024 snallabot).
const SIM = { FAIR_SIM: 'FAIR_SIM', FORCE_WIN_AWAY: 'FORCE_WIN_AWAY', FORCE_WIN_HOME: 'FORCE_WIN_HOME' };
const SIM_LABEL = { FAIR_SIM: 'Fair Sim', FORCE_WIN_AWAY: 'Force Win Away', FORCE_WIN_HOME: 'Force Win Home' };
const SUBCOMMAND_WEEK = { wildcard: 19, divisional: 20, conference: 21, superbowl: 23 };

// Valid weeks: 1-18 regular season, 19 wild card, 20 divisional, 21 conference, 23 Super Bowl (22 is the Pro Bowl).
function validateWeek(week) {
  return Number.isInteger(week) && week >= 1 && week <= 23 && week !== 22 ? null
    : 'Invalid week number. Use weeks 1-18, or the playoff commands (wild card 19, divisional 20, conference 21, Super Bowl 23).';
}
const weekForSubcommand = (sub, week) => (sub === 'create' ? week : SUBCOMMAND_WEEK[sub]);
const channelName = (away, home) => `${away}-at-${home}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

function notifierMessage(matchup, waitHours, roleId) {
  return `${matchup}\nTime to schedule your game! Once it is scheduled, hit ⏰. Otherwise you will be notified again every ${waitHours} hours.\n` +
    `When you're done playing, hit 🏆 and I will clean up the channel.\n` +
    `Need to sim this game? Hit 🏠 or ✈️ to request a force win for the home or away side (both is a fair sim), then <@&${roleId}> hits ⏭ to confirm it!`;
}

// A coach's button press sets their request; pressing the same side again clears it.
function toggleRequest(requests, userId, side) {
  const next = { ...(requests || {}) };
  if (next[userId] === side) delete next[userId]; else next[userId] = side;
  return next;
}
// requests: { userId: 'HOME' | 'AWAY' }. Both sides asking = fair sim.
function simResult(requests) {
  const sides = new Set(Object.values(requests || {}));
  if (sides.has('HOME') && sides.has('AWAY')) return SIM.FAIR_SIM;
  if (sides.has('HOME')) return SIM.FORCE_WIN_HOME;
  if (sides.has('AWAY')) return SIM.FORCE_WIN_AWAY;
  return null;
}
const shouldNotify = (notifiedAt, hours, now) => now - notifiedAt >= hours * 3600 * 1000;

// games: normalized EA games for the week (to show final scores).
function scoreboardText(wk, games = []) {
  const lines = Object.values(wk.channels || {}).map(st => {
    const g = games.find(x => x.awayId === st.awayId && x.homeId === st.homeId);
    const status = st.sim ? `⏭ ${SIM_LABEL[st.sim]}` : g && g.final ? `✅ ${g.awayScore}-${g.homeScore}` : st.done ? '🏆 Done' : st.scheduled ? '⏰ Scheduled' : '🕓 Unscheduled';
    return `${st.away} @ ${st.home} — ${status}`;
  });
  return `# Week ${wk.week} Scoreboard\n${lines.join('\n') || 'No games.'}`;
}

// Per-team FW/FL/FS counts. sims: [{season, result, away, home}]
function simSummary(sims, season) {
  const t = {};
  const row = n => (t[n] = t[n] || { team: n, fw: 0, fl: 0, fs: 0 });
  for (const s of sims || []) {
    if (season && s.season !== season) continue;
    if (s.result === SIM.FAIR_SIM) { row(s.away).fs++; row(s.home).fs++; continue; }
    const [winner, loser] = s.result === SIM.FORCE_WIN_HOME ? [s.home, s.away] : [s.away, s.home];
    row(winner).fw++; row(loser).fl++;
  }
  return Object.values(t).sort((a, b) => b.fw + b.fl + b.fs - (a.fw + a.fl + a.fs) || a.team.localeCompare(b.team));
}
module.exports = { SIM, SIM_LABEL, validateWeek, weekForSubcommand, channelName, notifierMessage, toggleRequest, simResult, shouldNotify, scoreboardText, simSummary };
