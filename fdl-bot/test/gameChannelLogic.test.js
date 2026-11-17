const test = require('node:test'), assert = require('node:assert');
const L = require('../gameChannelLogic');

test('valid weeks: 1-18, 19-21, 23; 22 and out of range rejected', () => {
  for (const w of [1, 18, 19, 21, 23]) assert.strictEqual(L.validateWeek(w), null);
  for (const w of [0, 22, 24, 1.5]) assert.match(L.validateWeek(w), /Invalid week/);
  assert.deepStrictEqual(['wildcard', 'divisional', 'conference', 'superbowl'].map(s => L.weekForSubcommand(s)), [19, 20, 21, 23]);
  assert.strictEqual(L.weekForSubcommand('create', 7), 7);
});
test('channel names are discord-safe', () => {
  assert.strictEqual(L.channelName('49ers', 'New York Giants'), '49ers-at-new-york-giants');
});
test('sim requests: home, away, both = fair sim, toggle clears', () => {
  let r = L.toggleRequest({}, 'a', 'HOME');
  assert.strictEqual(L.simResult(r), 'FORCE_WIN_HOME');
  r = L.toggleRequest(r, 'b', 'AWAY');
  assert.strictEqual(L.simResult(r), 'FAIR_SIM');
  r = L.toggleRequest(r, 'b', 'AWAY');
  assert.strictEqual(L.simResult(r), 'FORCE_WIN_HOME');
  r = L.toggleRequest(r, 'a', 'HOME');
  assert.strictEqual(L.simResult(r), null);
  assert.strictEqual(L.simResult(L.toggleRequest({}, 'a', 'AWAY')), 'FORCE_WIN_AWAY');
});
test('notify only after the waiting period', () => {
  assert.strictEqual(L.shouldNotify(0, 12, 11 * 3600e3), false);
  assert.strictEqual(L.shouldNotify(0, 12, 12 * 3600e3), true);
});
test('scoreboard shows sims, finals, scheduled and unscheduled', () => {
  const wk = { week: 3, channels: {
    a: { away: 'A', home: 'B', awayId: 1, homeId: 2, sim: 'FORCE_WIN_HOME' },
    b: { away: 'C', home: 'D', awayId: 3, homeId: 4 },
    c: { away: 'E', home: 'F', awayId: 5, homeId: 6, scheduled: true },
    d: { away: 'G', home: 'H', awayId: 7, homeId: 8 } } };
  const t = L.scoreboardText(wk, [{ awayId: 3, homeId: 4, final: true, awayScore: 10, homeScore: 20 }]);
  assert.match(t, /# Week 3 Scoreboard/);
  assert.match(t, /A @ B — ⏭ Force Win Home/);
  assert.match(t, /C @ D — ✅ 10-20/);
  assert.match(t, /E @ F — ⏰ Scheduled/);
  assert.match(t, /G @ H — 🕓 Unscheduled/);
});
test('sim summary counts FW/FL/FS per team and filters by season', () => {
  const sims = [
    { season: 1, result: 'FORCE_WIN_HOME', away: 'A', home: 'B' },
    { season: 1, result: 'FAIR_SIM', away: 'A', home: 'C' },
    { season: 2, result: 'FORCE_WIN_AWAY', away: 'A', home: 'B' }];
  const s1 = Object.fromEntries(L.simSummary(sims, 1).map(r => [r.team, r]));
  assert.deepStrictEqual([s1.A.fw, s1.A.fl, s1.A.fs], [0, 1, 1]);
  assert.deepStrictEqual([s1.B.fw, s1.B.fl, s1.B.fs], [1, 0, 0]);
  assert.strictEqual(L.simSummary(sims, 2).length, 2);
  assert.strictEqual(L.simSummary(sims).length, 3);
});
