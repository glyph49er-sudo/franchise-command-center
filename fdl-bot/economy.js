'use strict';
// FDL economy (Franchise Hub style): coins + XP, daily rewards, sportsbook on real league games,
// prize wheel, shop/upgrades and leaderboard. Bets settle automatically from Madden results.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const E = require('./economyLogic');
const S = require('./scoreboardLogic');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, franchise } = ctx;
  const FILE = path.join(__dirname, 'data', 'economy.json');
  const load = () => { try { return { wallets: {}, bets: [], nextBet: 1, channelId: null, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { wallets: {}, bets: [], nextBet: 1, channelId: null }; } };
  const save = s => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, FILE); };
  const START = 1000, MAX_OPEN = 5, MIN_BET = 10;
  const wallet = (st, id) => (st.wallets[id] ||= { coins: START, xp: 0, streak: 0, won: 0, lost: 0, profit: 0, extraSpins: 0, insurance: 0 });
  const coins = n => `🪙 ${Number(n).toLocaleString()}`;
  const mention = id => `<@${id}>`;
  function giveXp(w, n, now = Date.now()) { const before = E.levelFor(w.xp); const add = E.boosted(w, now) ? n * 2 : n; w.xp += add; return { add, levelUp: E.levelFor(w.xp) > before ? E.levelFor(w.xp) : 0 }; }

  commands.push(
    new SlashCommandBuilder().setName('wallet').setDescription('Your coins, XP and level').addUserOption(o => o.setName('user').setDescription('Someone else')),
    new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins (keep a streak for more)'),
    new SlashCommandBuilder().setName('wheel').setDescription('Spin the prize wheel (free once a day)'),
    new SlashCommandBuilder().setName('bet').setDescription('Sportsbook: bet coins on league games')
      .addSubcommand(s => s.setName('games').setDescription('This week\'s games with odds'))
      .addSubcommand(s => s.setName('place').setDescription('Place a bet')
        .addStringOption(o => o.setName('game').setDescription('Game').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('pick').setDescription('Who wins').setRequired(true).setAutocomplete(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Coins to stake').setRequired(true).setMinValue(MIN_BET)))
      .addSubcommand(s => s.setName('mine').setDescription('Your open and recent bets')),
    new SlashCommandBuilder().setName('shop').setDescription('Spend coins on upgrades')
      .addSubcommand(s => s.setName('list').setDescription('See what is for sale'))
      .addSubcommand(s => s.setName('buy').setDescription('Buy an upgrade').addStringOption(o => o.setName('item').setDescription('Item').setRequired(true).addChoices(...Object.entries(E.SHOP).map(([value, v]) => ({ name: `${v.name.replace(/^\S+ /, '')} — ${v.price}`, value }))))),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Top coin holders, XP and sharpest bettors')
      .addStringOption(o => o.setName('type').setDescription('Ranking').addChoices({ name: 'Coins', value: 'coins' }, { name: 'XP / level', value: 'xp' }, { name: 'Betting profit', value: 'profit' })),
    new SlashCommandBuilder().setName('economy').setDescription('Admin: manage the economy').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName('give').setDescription('Give coins').addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName('take').setDescription('Take coins').addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Coins').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName('channel').setDescription('Channel for bet results and level-ups').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(s => s.setName('settle').setDescription('Settle finished bets now'))
  );

  const weekGames = async () => {
    const { week } = await franchise.getCurrent(); const season = await franchise.currentSeasonYear();
    const games = (await franchise.getGames(week)).filter(g => !g.final);
    const ovr = Object.fromEntries((await franchise.getStandings()).map(r => [r.teamId, r.ovr]));
    return { week, season, games, ovr };
  };

  async function settle() {
    const st = load(); let n = 0;
    const open = st.bets.filter(b => b.status === 'open');
    const keys = [...new Set(open.map(b => b.week))];
    const results = [];
    for (const wk of keys) {
      let games; try { games = await franchise.getGames(wk); } catch { continue; }
      for (const b of open.filter(x => x.week === wk)) {
        const g = games.find(x => x.awayId === b.awayId && x.homeId === b.homeId && x.final);
        if (!g) continue;
        const r = E.settleBet(b, g), w = wallet(st, b.userId);
        b.status = r.status; b.payout = r.payout; w.coins += r.payout;
        if (r.insuranceUsed) w.insurance = Math.max(0, w.insurance);
        if (r.status === 'won') { w.won++; w.profit += r.payout - b.stake; } else if (r.status === 'lost') { w.lost++; w.profit -= b.stake; }
        const xp = giveXp(w, r.status === 'won' ? 20 : 5);
        results.push({ b, r, g, levelUp: xp.levelUp }); n++;
      }
    }
    if (n) save(st);
    if (results.length && st.channelId) {
      const ch = await client.channels.fetch(st.channelId).catch(() => null);
      if (ch?.isTextBased()) {
        const lines = results.map(({ b, r, g }) => `${r.status === 'won' ? '✅' : r.status === 'push' ? '↩️' : '❌'} ${mention(b.userId)} — ${b.pickName} (${g.away} ${g.awayScore} @ ${g.homeScore} ${g.home}): ${r.status === 'won' ? `won ${coins(r.payout)}` : r.status === 'push' ? (r.insuranceUsed ? 'insurance refunded the stake' : 'push, stake back') : `lost ${coins(b.stake)}`}`);
        await ch.send({ embeds: [franchise.embed('🎲 Bets settled', lines.join('\n').slice(0, 4000))], allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
    return n;
  }

  client.once('ready', () => { const t = setInterval(() => settle().catch(e => console.error('[bets]', e.message)), 5 * 60 * 1000); t.unref?.(); });

  // chat XP: 5 XP (+2 coins) per minute of activity
  const lastChat = new Map();
  client.on('messageCreate', async m => {
    try {
      if (m.author.bot || !m.guild || (GUILD_ID && m.guildId !== GUILD_ID)) return;
      const now = Date.now(); if (now - (lastChat.get(m.author.id) || 0) < 60e3) return; lastChat.set(m.author.id, now);
      const st = load(), w = wallet(st, m.author.id); w.coins += 2; const x = giveXp(w, 5, now); save(st);
      if (x.levelUp) await m.channel.send({ content: `🎉 ${mention(m.author.id)} reached **level ${x.levelUp}**!`, allowedMentions: { users: [m.author.id] } }).catch(() => {});
    } catch (e) { console.error('[xp]', e.message); }
  });

  const walletEmbed = (st, id, name) => {
    const w = wallet(st, id), p = E.progress(w.xp);
    const perks = [E.boosted(w) ? `⚡ XP boost until <t:${Math.floor(w.boostUntil / 1000)}:R>` : null, w.insurance ? `🛡️ ${w.insurance} bet insurance` : null, w.extraSpins ? `🎡 ${w.extraSpins} extra spin(s)` : null, (w.charmUntil || 0) > Date.now() ? '🍀 Lucky charm active' : null].filter(Boolean);
    return franchise.embed(`${name}'s wallet`, [`**Coins:** ${coins(w.coins)}`, `**Level ${p.level}** ${E.bar(p.into, p.need)} ${p.into}/${p.need} XP`, `**Bets:** ${w.won}W-${w.lost}L (${w.profit >= 0 ? '+' : ''}${w.profit.toLocaleString()} coins)`, `**Daily streak:** ${w.streak || 0}`, ...perks].join('\n'));
  };

  client.on('interactionCreate', async i => {
    try {
      if (GUILD_ID && i.guildId && i.guildId !== GUILD_ID) return;
      if (i.isAutocomplete() && i.commandName === 'bet') {
        const f = i.options.getFocused(true);
        const { games, ovr } = await weekGames().catch(() => ({ games: [] }));
        if (f.name === 'game') return i.respond(games.filter(g => `${g.away} ${g.home}`.toLowerCase().includes(String(f.value).toLowerCase())).slice(0, 25).map(g => ({ name: `${g.away} @ ${g.home}`.slice(0, 100), value: `${g.awayId}:${g.homeId}` })));
        const [a, h] = String(i.options.getString('game') || '').split(':').map(Number);
        const g = games.find(x => x.awayId === a && x.homeId === h);
        if (!g) return i.respond([]);
        const o = E.gameOdds(ovr[g.homeId], ovr[g.awayId]);
        return i.respond([{ name: `${g.away} (${o.awayAmerican})`, value: 'away' }, { name: `${g.home} (${o.homeAmerican})`, value: 'home' }]);
      }
      if (!i.isChatInputCommand() || !['wallet', 'daily', 'wheel', 'bet', 'shop', 'leaderboard', 'economy'].includes(i.commandName)) return;
      const st = load(), now = Date.now();

      if (i.commandName === 'wallet') { const u = i.options.getUser('user') || i.user; return i.reply({ embeds: [walletEmbed(st, u.id, u.username)], ephemeral: !i.options.getUser('user') && false }); }

      if (i.commandName === 'daily') {
        const w = wallet(st, i.user.id), d = E.daily(w, now);
        if (!d.ok) return i.reply({ content: `⏳ Come back <t:${Math.floor((now + d.wait) / 1000)}:R> for your next daily.`, ephemeral: true });
        const coinsGot = Math.round(d.coins * ((w.charmUntil || 0) > now ? 1.5 : 1));
        w.coins += coinsGot; w.streak = d.streak; w.lastDaily = now; const x = giveXp(w, d.xp, now); save(st);
        return i.reply({ content: `💰 +${coins(coinsGot)} and +${x.add} XP — **${d.streak}-day streak**!${x.levelUp ? ` 🎉 Level ${x.levelUp}!` : ''}` });
      }

      if (i.commandName === 'wheel') {
        const w = wallet(st, i.user.id);
        if (!E.wheelReady(w, now)) return i.reply({ content: `🎡 You already spun today. Next free spin <t:${Math.floor(((w.lastWheel || now) + 20 * E.HOUR) / 1000)}:R> (or buy an extra spin in \`/shop\`).`, ephemeral: true });
        if ((w.extraSpins || 0) > 0 && w.lastWheel && now - w.lastWheel < 20 * E.HOUR) w.extraSpins--; else w.lastWheel = now;
        const p = E.spin();
        if (p.coins) w.coins += p.coins; if (p.xp) giveXp(w, p.xp, now); if (p.boost) w.boostUntil = Math.max(w.boostUntil || 0, now) + p.boost; if (p.insurance) w.insurance += p.insurance;
        save(st);
        return i.reply({ embeds: [franchise.embed('🎡 Prize wheel', `${i.user} spun… and landed on **${p.label}**!`)] });
      }

      if (i.commandName === 'shop') {
        if (i.options.getSubcommand() === 'list') return i.reply({ embeds: [franchise.embed('🛒 FDL Shop', Object.values(E.SHOP).map(v => `**${v.name}** — ${coins(v.price)}\n${v.desc}`).join('\n\n'))], ephemeral: true });
        const key = i.options.getString('item', true), item = E.SHOP[key], w = wallet(st, i.user.id);
        if (!item) return i.reply({ content: 'Unknown item.', ephemeral: true });
        if (w.coins < item.price) return i.reply({ content: `You need ${coins(item.price)} (you have ${coins(w.coins)}).`, ephemeral: true });
        w.coins -= item.price;
        if (key === 'xpboost') w.boostUntil = Math.max(w.boostUntil || 0, now) + 24 * E.HOUR;
        if (key === 'insurance') w.insurance++;
        if (key === 'spin') w.extraSpins++;
        if (key === 'jar') w.charmUntil = Math.max(w.charmUntil || 0, now) + 72 * E.HOUR;
        save(st);
        return i.reply({ content: `✅ Bought **${item.name}** for ${coins(item.price)}. Balance: ${coins(w.coins)}`, ephemeral: true });
      }

      if (i.commandName === 'leaderboard') {
        const type = i.options.getString('type') || 'coins';
        const rows = Object.entries(st.wallets).map(([id, w]) => ({ id, w })).sort((a, b) => (type === 'xp' ? b.w.xp - a.w.xp : type === 'profit' ? b.w.profit - a.w.profit : b.w.coins - a.w.coins)).slice(0, 10);
        const lines = rows.map((r, n) => `${['🥇', '🥈', '🥉'][n] || `**${n + 1}.**`} ${mention(r.id)} — ${type === 'xp' ? `Level ${E.levelFor(r.w.xp)} (${r.w.xp.toLocaleString()} XP)` : type === 'profit' ? `${r.w.profit >= 0 ? '+' : ''}${r.w.profit.toLocaleString()} coins (${r.w.won}W-${r.w.lost}L)` : coins(r.w.coins)}`);
        return i.reply({ embeds: [franchise.embed(`🏆 Leaderboard — ${type === 'xp' ? 'XP' : type === 'profit' ? 'Betting profit' : 'Coins'}`, lines.join('\n') || 'Nobody yet.')], allowedMentions: { parse: [] } });
      }

      if (i.commandName === 'bet') {
        const sub = i.options.getSubcommand();
        if (sub === 'games') {
          await i.deferReply();
          const { week, season, games, ovr } = await weekGames();
          if (!games.length) return i.editReply('No open games to bet on right now.');
          return i.editReply({ embeds: [franchise.embed(`🎲 ${season} ${S.weekName(week)} odds`, games.map(g => { const o = E.gameOdds(ovr[g.homeId], ovr[g.awayId]); return `**${g.away}** (${o.awayAmerican}) @ **${g.home}** (${o.homeAmerican})`; }).join('\n').slice(0, 4000)).setFooter({ text: '/bet place to wager. Odds are locked when you bet.' })] });
        }
        if (sub === 'mine') {
          const mine = st.bets.filter(b => b.userId === i.user.id).slice(-10).reverse();
          return i.reply({ embeds: [franchise.embed('Your bets', mine.map(b => `#${b.id} ${b.pickName} — ${coins(b.stake)} @ ${b.odds}x — **${b.status}**${b.status === 'won' ? ` (+${b.payout - b.stake})` : ''}`).join('\n') || 'No bets yet.')], ephemeral: true });
        }
        const w = wallet(st, i.user.id), amount = i.options.getInteger('amount', true);
        if (amount > w.coins) return i.reply({ content: `You only have ${coins(w.coins)}.`, ephemeral: true });
        if (st.bets.filter(b => b.userId === i.user.id && b.status === 'open').length >= MAX_OPEN) return i.reply({ content: `You can have ${MAX_OPEN} open bets at once.`, ephemeral: true });
        await i.deferReply({ ephemeral: true });
        const { week, season, games, ovr } = await weekGames();
        const [a, h] = i.options.getString('game', true).split(':').map(Number), pick = i.options.getString('pick', true);
        const g = games.find(x => x.awayId === a && x.homeId === h);
        if (!g) return i.editReply('That game isn\'t open for betting (already played or not this week).');
        if (st.bets.some(b => b.userId === i.user.id && b.status === 'open' && b.awayId === a && b.homeId === h && b.week === week)) return i.editReply('You already have a bet on that game.');
        const o = E.gameOdds(ovr[h], ovr[a]), odds = pick === 'home' ? o.home : o.away;
        const insured = w.insurance > 0; if (insured) w.insurance--;
        w.coins -= amount;
        const bet = { id: st.nextBet++, userId: i.user.id, week, season, awayId: a, homeId: h, pick, pickName: pick === 'home' ? g.home : g.away, stake: amount, odds, insured, status: 'open', at: now };
        st.bets.push(bet); save(st);
        return i.editReply(`🎲 Bet #${bet.id}: ${coins(amount)} on **${bet.pickName}** at **${odds}x** — pays ${coins(E.payoutFor(amount, odds))}.${insured ? '\n🛡️ Insurance applied.' : ''}\nIt settles automatically after the game finishes.`);
      }

      if (i.commandName === 'economy') {
        if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({ content: 'Administrator only.', ephemeral: true });
        const sub = i.options.getSubcommand();
        if (sub === 'channel') { st.channelId = i.options.getChannel('channel', true).id; save(st); return i.reply({ content: `✅ Bet results post in <#${st.channelId}>.`, ephemeral: true }); }
        if (sub === 'settle') { await i.deferReply({ ephemeral: true }); return i.editReply(`Settled ${await settle()} bet(s).`); }
        const u = i.options.getUser('user', true), w = wallet(st, u.id), n = i.options.getInteger('amount', true);
        w.coins = Math.max(0, w.coins + (sub === 'give' ? n : -n)); save(st);
        return i.reply({ content: `✅ ${u.username} now has ${coins(w.coins)}.`, ephemeral: true });
      }
    } catch (err) {
      console.error('[economy]', err);
      const msg = `❌ ${String(err.message || err).slice(0, 300)}`;
      try { if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ content: msg, ephemeral: true }); } catch { /* gone */ }
    }
  });
  return { settle };
};
