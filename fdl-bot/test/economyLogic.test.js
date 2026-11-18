const test = require('node:test'); const assert = require('node:assert');
const E = require('../economyLogic');
test('odds favor the better team and carry a house edge', () => {
  const o = E.gameOdds(85, 70); assert.ok(o.home < o.away); assert.ok(1 / o.home + 1 / o.away > 1);
  assert.ok(E.gameOdds(70, 70).home < E.gameOdds(70, 70).away); // home edge
});
test('american odds format', () => { assert.strictEqual(E.americanOdds(3), '+200'); assert.strictEqual(E.americanOdds(1.5), '-200'); });
test('settleBet win/loss/push/insurance', () => {
  const bet = { stake: 100, odds: 2, pick: 'home' };
  assert.deepStrictEqual(E.settleBet(bet, { homeScore: 20, awayScore: 10 }), { status: 'won', payout: 200 });
  assert.strictEqual(E.settleBet(bet, { homeScore: 10, awayScore: 20 }).status, 'lost');
  assert.strictEqual(E.settleBet(bet, { homeScore: 10, awayScore: 10 }).status, 'push');
  assert.strictEqual(E.settleBet({ ...bet, insured: true }, { homeScore: 10, awayScore: 20 }).payout, 100);
});
test('levels', () => { assert.strictEqual(E.levelFor(0), 1); assert.strictEqual(E.levelFor(100), 2); assert.strictEqual(E.levelFor(400), 3); const p = E.progress(150); assert.strictEqual(p.level, 2); });
test('daily cooldown and streak', () => {
  const now = 1e12;
  assert.strictEqual(E.daily({ lastDaily: now - 5 * E.HOUR }, now).ok, false);
  assert.strictEqual(E.daily({ lastDaily: now - 30 * E.HOUR, streak: 2 }, now).streak, 3);
  assert.strictEqual(E.daily({ lastDaily: now - 60 * E.HOUR, streak: 5 }, now).streak, 1);
});
test('wheel returns prizes by weight', () => { assert.strictEqual(E.spin(() => 0).label, '50 coins'); assert.ok(E.spin(() => 0.999999).label); });
