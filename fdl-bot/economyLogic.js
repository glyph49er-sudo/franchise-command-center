'use strict';
// Pure helpers for the FDL economy: coins, XP, sportsbook odds, prize wheel, shop.
// Rebuilt from Franchise Hub's public feature list (sportsbook, XP, upgrades, prize wheel, leaderboard); not copied code.
const HOUR = 3600e3;

// Win probability for the home team from team overalls (+2 home edge), clamped.
function homeWinProb(homeOvr, awayOvr) {
  const diff = (Number(homeOvr) || 70) + 2 - (Number(awayOvr) || 70);
  return Math.min(0.92, Math.max(0.08, 1 / (1 + Math.pow(10, -diff / 25))));
}
const VIG = 1.06;
// Decimal odds (total return per 1 coin staked), with a house edge.
const decimalOdds = p => Math.max(1.05, Math.round((1 / Math.min(0.97, p * VIG)) * 100) / 100);
const americanOdds = d => (d >= 2 ? `+${Math.round((d - 1) * 100)}` : `-${Math.round(100 / (d - 1))}`);
function gameOdds(homeOvr, awayOvr) {
  const ph = homeWinProb(homeOvr, awayOvr);
  const home = decimalOdds(ph), away = decimalOdds(1 - ph);
  return { home, away, homeAmerican: americanOdds(home), awayAmerican: americanOdds(away), homeProb: ph };
}
const payoutFor = (stake, dec) => Math.floor(stake * dec);

// A bet: { id, userId, week, season, awayId, homeId, pick: 'home'|'away', stake, odds(decimal), insured, status }
// Returns { status: 'won'|'lost'|'push', payout }.
function settleBet(bet, game) {
  if (game.awayScore === game.homeScore) return { status: 'push', payout: bet.stake };
  const winner = game.homeScore > game.awayScore ? 'home' : 'away';
  if (winner === bet.pick) return { status: 'won', payout: payoutFor(bet.stake, bet.odds) };
  return bet.insured ? { status: 'push', payout: bet.stake, insuranceUsed: true } : { status: 'lost', payout: 0 };
}

// XP / levels
const levelFor = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
const xpForLevel = lvl => (lvl - 1) * (lvl - 1) * 100;
const progress = xp => { const l = levelFor(xp), a = xpForLevel(l), b = xpForLevel(l + 1); return { level: l, into: xp - a, need: b - a }; };
const bar = (n, max, len = 10) => '▰'.repeat(Math.round((n / Math.max(1, max)) * len)).padEnd(len, '▱');

// Daily reward with streak (a streak survives up to 48h between claims).
function daily(w, now = Date.now()) {
  if (w.lastDaily && now - w.lastDaily < 20 * HOUR) return { ok: false, wait: 20 * HOUR - (now - w.lastDaily) };
  const streak = w.lastDaily && now - w.lastDaily <= 48 * HOUR ? (w.streak || 0) + 1 : 1;
  return { ok: true, streak, coins: 200 + Math.min(streak - 1, 7) * 50, xp: 25 };
}

const WHEEL = [
  { label: '50 coins', coins: 50, w: 28 }, { label: '100 coins', coins: 100, w: 24 }, { label: '250 coins', coins: 250, w: 15 },
  { label: '500 coins', coins: 500, w: 8 }, { label: '1,000 coins', coins: 1000, w: 3 }, { label: '🎰 JACKPOT 5,000 coins', coins: 5000, w: 1 },
  { label: '⚡ 2x XP boost (24h)', boost: 24 * HOUR, w: 9 }, { label: '🛡️ Bet insurance', insurance: 1, w: 8 }, { label: '100 XP', xp: 100, w: 3 }, { label: 'Nothing — tough luck', w: 1 }
];
function spin(rng = Math.random) {
  const total = WHEEL.reduce((s, p) => s + p.w, 0);
  let r = rng() * total;
  for (const p of WHEEL) { if ((r -= p.w) < 0) return p; }
  return WHEEL[0];
}

const SHOP = {
  xpboost: { name: '⚡ 2x XP boost (24h)', price: 400, desc: 'Double XP from everything for 24 hours.' },
  insurance: { name: '🛡️ Bet insurance', price: 300, desc: 'Your next losing bet refunds your stake.' },
  spin: { name: '🎡 Extra wheel spin', price: 250, desc: 'Spin the wheel again today.' },
  jar: { name: '🍀 Lucky charm (3 days)', price: 1500, desc: 'Daily reward +50% for 3 days.' }
};
const wheelReady = (w, now = Date.now()) => (w.extraSpins || 0) > 0 || !w.lastWheel || now - w.lastWheel >= 20 * HOUR;
const boosted = (w, now = Date.now()) => (w.boostUntil || 0) > now;

module.exports = { HOUR, homeWinProb, decimalOdds, americanOdds, gameOdds, payoutFor, settleBet, levelFor, xpForLevel, progress, bar, daily, WHEEL, spin, SHOP, wheelReady, boosted };
