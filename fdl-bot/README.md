# Madden League Management Bot

One Discord bot containing:

- `/game-of-the-week`
- `/players-of-the-week`
- `/draft`
- `/draft-results`
- `/dev-traits`
- `/check-dev-traits`
- `/prospect-maker`
- `/mystery-box-post` and `/mystery-box-checker`
- `/scout-player`, `/scout-sheet`, and `/reset-scout-sheets`
- `/open-teams`

Administrative setup commands are Administrator-only. Member-facing claim and scouting commands remain available to regular members.

## Important setup

1. Create the bot/application and copy the token and application/client ID into `.env`.
2. Invite the bot with the `bot` and `applications.commands` scopes.
3. Enable **Message Content Intent** and **Server Members Intent** in the Developer Portal.
4. Copy `.env.example` to `.env` and fill in the values.
5. Run `npm install` then `npm start`.

The bot registers commands to the configured `GUILD_ID`.

## Roles

For `/draft`, the bot gives users who vote **No** the `Missed draft` role. If `MISSED_DRAFT_ROLE_ID` is blank, it searches for a role named `Missed draft` (case-insensitive). You can set the exact role ID if preferred.

For Game of the Week and Open Teams, NFL roles are detected by full team name, short team name, or abbreviation. `TEAM_ROLE_IDS` can override role IDs. When a member gains a team role, their `waitlist coach` role is removed; when they lose their last team role, it is added back. Configure `WAITLIST_COACH_ROLE_ID` if needed.

## /draft

Creates a real Discord poll:

**Will you make the draft?**

- Yes
- No

The bot listens to poll vote events. A No vote adds the Missed draft role; changing the vote to Yes removes it. `/draft-results` lets admins see the stored Yes/No users.

## /dev-traits

Creates:

**Come get your dev traits!**

- `Claim` — available to everyone except users with Missed draft.
- `Claim (Missed Draft)` — available only to users with Missed draft.

Regular form:

- Age reset 1
- Age reset 2
- Age reset 3
- X factor
- Superstar

Missed-draft form:

- Age reset 1
- Age reset 2
- Age reset 3
- X factor
- Superstar 1
- Superstar 2

Discord modals have a five-field component limit. Therefore the six-field missed-draft form is completed in two consecutive modal screens, with Superstar 2 on the second screen. The user still starts from one Claim (Missed Draft) button.

Each user can submit only once until the stored submission is marked Given.

## /check-dev-traits

Admin-only review queue. Each page shows one user's submission. Previous/Next moves through users. `Given` removes that submission from the queue and persistent storage.

## /prospect-maker

Admin `/prospect-maker` creates a public post with a **Make Now** button. Everyone can click it.

Discord modals also have a five-field limit, so the prospect form is completed through three consecutive screens:

1. Name, College, Position, Height, Weight
2. Archetype, 3 Strengths, Weakness 1
3. Weakness 2, optional Backstory, Player Comparison

The final prospect is posted to `PROSPECT_CHANNEL_ID` in this format:

**Name**
College: ...
Position: ...
Height: ...
Weight: ...
Archetype: ...

⭐ ...
⭐ ...
⭐ ...

⚠️ ...
⚠️ ...

📖 **Backstory:** ...

**Player Comparison:** ...

## Persistence

The bot stores draft results, dev-trait submissions, prospects, generated prospect stat sheets, GOTW/POTW submissions, Mystery Box claims/history, scouting histories, team-role configuration, team ownership, waitlist status, and the open-team message ID in separate JSON files under `data/`. These survive bot restarts. Corrupt JSON files are backed up and replaced with safe defaults.

## Notes

- Game of the Week can be posted before kickoff. The winner/loser buttons remain disabled until a matching final score is detected in the Snallabot score channel; ties unlock two team-specific tie buttons.
- Players of the Week requires four distinct recipients. Each recipient can submit three +3 non-physical attributes for players.
- Prospect stat sheets are generated from the prospect form and stored for future scouting.


## Added FDL systems

This build includes:
- `/players-of-the-week`: four Players of the Week, each with exactly ONE +3 to ONE non-physical attribute (one player). Speed, Acceleration, Agility, Strength, Jumping, Change of Direction, Stamina and Injury are rejected; anything else is allowed.
- `/game-of-the-week`: creates the post before kickoff, watches the Snallabot score channel, then unlocks winner/loser or tie submissions when a score is detected.
- `/mystery-box-post` and `/mystery-box-checker`: daily per-user Mystery Box claims using Pacific calendar dates and persistent JSON history.
- Prospect stat sheets are generated when the Prospect Maker submits a prospect and are posted to the configured `PROSPECT_STATS_CHANNEL_ID` (`1570919677507666021`).
- `/scout-player`, `/scout-sheet`, and admin-only `/reset-scout-sheets`.
- `/open-teams`: role-based open-team status post in welcome channel `1472462578935533660`, refreshed on membership/role changes and Carl-bot welcome messages. General-chat questions about open teams receive a short response.

### New persistent data files

The bot creates these files under `data/` automatically: `team_claims.json`, `team_role_config.json`, `waitlist.json`, `open_team_status.json`, `players_of_week.json`, `games_of_week.json`, `mystery_box.json`, `prospect_stat_sheets.json`, and `scout_sheets.json`. Invalid JSON is backed up and safely replaced with defaults when read.

### Setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`.
3. Ensure `GUILD_ID` is the league server ID, `PROSPECT_CHANNEL_ID=1540434920676003971`, and `PROSPECT_STATS_CHANNEL_ID=1570919677507666021`.
4. Invite the bot with `applications.commands`, `bot`, and the permissions needed to view/read/send/edit/delete messages (Manage Messages in the welcome channel), manage roles (for the existing missed-draft role feature), and view server members.
5. Run `npm install`, then `npm start`.

The bot needs **Message Content Intent** and **Server Members Intent** enabled in the Discord Developer Portal. When a member gains an NFL team role, the bot removes their `waitlist coach` role; when they lose their last NFL team role, it adds that role back. Set `WAITLIST_COACH_ROLE_ID` if the role name is different. For team-role detection, the team roles must exist and be named with the full team name, short team name, or NFL abbreviation, or be configured as `TEAM_ROLE_IDS` in `.env` / `data/team_role_config.json`.

The score watcher recognizes Snallabot score lines in the form `Cowboys 35 vs 26 Giants` (also accepts abbreviations). If Snallabot changes its score-message format, update the score parser in `features.js`.

Note: This ZIP intentionally excludes `.env` (which can contain your private bot token) and `node_modules`. Run `npm install` after extracting it.

### Open teams posts
- `/open-teams` creates or refreshes the Team Claimer-style embed in the channel where the command is run. The bot stores that channel/message and edits it automatically when team roles change.
- The welcome-channel open-teams post is a separate automatic message. It is refreshed from Carl-bot welcome messages and does not require `/open-teams`.
- Both posts are independent; running the command does not move or replace the welcome-channel post.

## EA franchise commands
These read the live Madden league through the connection set up with `/ea-connect`.

| Command | What it does |
| --- | --- |
| `/standings [conference]` | Division standings with point differential |
| `/schedule [week] [team]` | A week's games and scores |
| `/roster team [position]` | Top players for a team (shows the coach) |
| `/player name` | Face card with overall, dev trait and top ratings (first lookup loads all rosters) |
| `/leaders category [week]` | Passing / rushing / receiving / tackles / sacks / interceptions leaders |
| `/power-rankings` | Ranking from record, point differential and team overall |
| `/free-agents [position]` | Best available free agents |
| `/franchise-hub` | League overview: season/week, claimed coaches, top 5, this week's games |
| `/team team` | Team profile: record, division and power rank, coach, best players, this week's game |
| `/playoff-picture [conference]` | Seeds 1-7 per conference plus the bubble (tiebreaks: record, then point differential) |
| `/playoffs` | Playoff bracket by round (wild card, divisional, conference, Super Bowl); before the playoffs, the projected wild-card round (2v7, 3v6, 4v5) |
| `/team-schedule team` | A team's 18-week schedule with results |
| `/trade configure` | Admin: trade channel, committee role, approvals needed, optional accepted/declined channels (saved to `data/trade_config.json`) |
| `/trade submit team_a team_b …` | Propose a trade (up to 3 players and 3 picks per side, autocompleted). Committee votes with buttons; passes at the required approvals, fails at that many rejections; the submitter can't vote |
| `/stat-leaders category` | Season leaders, summed from every played week (idea from Franchise Hub) |
| `/compare player1 player2` | Two players side by side with the winner of each row marked (Franchise Hub) |
| `/schedule-difficulty team` | Opponent win % and rating for played vs remaining games (Franchise Hub) |
| `/top-players [position]` | Best players in the league by overall, including free agents |
| `/game-channels week [category]` | Admin: one channel per game, both coaches pinged |
| `/auto-potw [week] [force]` | Admin: post Players of the Week from the box scores |
| `/franchise-debug dataset` | Admin: show the raw field names EA sends |

Optional `.env` settings: `AUTO_POTW=true` (post Players of the Week automatically once a week's games are all final), `POTW_CHANNEL_ID`, `PORTRAIT_URL_TEMPLATE` (use `{id}` for the portrait id, or `none`), `WAITLIST_COACH_ROLE_ID`, `HIDDEN_DEVS=false` (by default a rookie's non-Normal dev trait shows as ❔ Hidden, like Snallabot), `MADDEN_SEASON` (default 2026, sets trade pick years).

Franchise Hub (franchisehub.gg) is a hosted product with no public source, so its features were researched from its public site and re-created from scratch: `/compare`, `/stat-leaders`, `/schedule-difficulty`, `/playoffs`, trade voting. Not re-created: its XP, sportsbook, upgrades, prize wheel, postgame stories and box scores.

Snallabot-derived code is MIT licensed; see `SNALLABOT_LICENSE.md`. Not ported (needs Snallabot's own database or external keys): sim confirmations (`/sims`), YouTube/Twitch stream notifiers, the teams board, the web export.

Run the tests with `node --test test/*.test.js`.
