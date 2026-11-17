# FDL bot roadmap
- [x] Merge Team Claimer into FDL bot (keep claims/progress) — `index.js` now loads `teamClaimer.js` and `franchise.js` on the one client; the admin-only gate only covers `index.js`'s own commands
- [x] Position-true prospect stats; elite physicals for Superstar+, solid Stars (`prospectStats.js`, tested)
- [x] EA franchise features (standings, schedule, roster, player face card, leaders, power rankings, free agents, game channels) — `franchise.js` + tested helpers in `franchiseData.js`. EA's field names are unofficial: if a value is blank in Discord, an admin runs `/franchise-debug` to see what EA actually sends
- [x] Fancy scouting card — scout reports now show scouted ratings as bars in the embed (no extra dependency). A rendered image card can still be plugged in later via `ctx.cards.prospectCard`
- [x] Claim flow: league info -> "Joined" button w/ warning -> EA check (`teamClaimer.js`)
- [x] Auto Players of the Week from EA stats -> channel 1468516903096942724, @ owner, +3 non-physical claim buttons (`/auto-potw`, or automatic with `AUTO_POTW=true`)
- [x] Delete "<team> is open" waitlist ping (role 1543435132596129882) when team claimed (`teamClaimer.js`)
- [x] Fix /mystery-box-checker Given button not removing names (entries are flagged `given` and filtered out)
- [x] Snallabot features ported onto live EA data: `/trade` committee voting, hidden rookie devs, `/playoffs` bracket (text), `/team-schedule`. Skipped: `/sims`, stream notifiers (need Snallabot's DB or API keys)

## Still needs a live check (can't be tested without Discord + EA)
- [ ] Run `/franchise-debug` for teams, standings, schedule, roster and stats once and confirm names/records look right
- [ ] Face-card pictures: set `PORTRAIT_URL_TEMPLATE` if the default image URL doesn't load (or `none` to turn pictures off)
- [ ] Give the bot **Manage Channels** before using `/game-channels`
- [ ] Try `/trade configure` then `/trade submit`; confirm the bot can post in the trade channel
- [ ] Check `/playoffs` once playoff weeks exist (assumes weeks 19/20/21/23)
- [x] Franchise Hub (franchisehub.gg, researched from its public site; not in Snallabot) features re-created: `/compare`, `/stat-leaders`, `/schedule-difficulty`. Not done: XP/sportsbook/upgrades/prize wheel, postgame stories + box scores, GOTW preview cards
