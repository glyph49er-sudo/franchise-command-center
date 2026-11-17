require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '1468509424862761146';
const SCORE_CHANNEL_ID = '1468519057903980620'; // Snallabot score channel (fixed)

const PROSPECT_CHANNEL_ID = process.env.PROSPECT_CHANNEL_ID || '1540434920676003971';
const PROSPECT_STATS_CHANNEL_ID = process.env.PROSPECT_STATS_CHANNEL_ID || '1570919677507666021';
const MISSED_DRAFT_ROLE_ID = process.env.MISSED_DRAFT_ROLE_ID || '';
const MISSED_DRAFT_ROLE_NAME = process.env.MISSED_DRAFT_ROLE_NAME || 'Missed draft';

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILES = {
  draft: path.join(DATA_DIR, 'draft.json'),
  devtraits: path.join(DATA_DIR, 'devtraits.json'),
  devtraitsGiven: path.join(DATA_DIR, 'devtraits_given.json'),
  prospects: path.join(DATA_DIR, 'prospects.json')
};
function readJson(file, fallback) {
  try { const value=JSON.parse(fs.readFileSync(file, 'utf8')); if(value && typeof value==='object' && Array.isArray(value)===Array.isArray(fallback)) return value; try{fs.writeFileSync(file,JSON.stringify(fallback,null,2));}catch{} return fallback; }
  catch { if(fs.existsSync(file)){try{fs.copyFileSync(file,file+`.corrupt-${Date.now()}.bak`);}catch{}} try{fs.writeFileSync(file,JSON.stringify(fallback,null,2));}catch{} return fallback; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
let draftData = readJson(FILES.draft, { polls: {}, users: {} });
draftData.polls ||= {}; draftData.users ||= {};
let devTraits = readJson(FILES.devtraits, {});
let devTraitsGiven = readJson(FILES.devtraitsGiven, {});
let prospects = readJson(FILES.prospects, []); if(!Array.isArray(prospects))prospects=[];
const draftSessions = new Map();
const devSessions = new Map();
const prospectSessions = new Map();

const TEAMS = {
  'Arizona Cardinals': { abbr:'ARI', short:'Cardinals' }, 'Atlanta Falcons': { abbr:'ATL', short:'Falcons' },
  'Baltimore Ravens': { abbr:'BAL', short:'Ravens' }, 'Buffalo Bills': { abbr:'BUF', short:'Bills' },
  'Carolina Panthers': { abbr:'CAR', short:'Panthers' }, 'Chicago Bears': { abbr:'CHI', short:'Bears' },
  'Cincinnati Bengals': { abbr:'CIN', short:'Bengals' }, 'Cleveland Browns': { abbr:'CLE', short:'Browns' },
  'Dallas Cowboys': { abbr:'DAL', short:'Cowboys' }, 'Denver Broncos': { abbr:'DEN', short:'Broncos' },
  'Detroit Lions': { abbr:'DET', short:'Lions' }, 'Green Bay Packers': { abbr:'GB', short:'Packers' },
  'Houston Texans': { abbr:'HOU', short:'Texans' }, 'Indianapolis Colts': { abbr:'IND', short:'Colts' },
  'Jacksonville Jaguars': { abbr:'JAX', short:'Jaguars' }, 'Kansas City Chiefs': { abbr:'KC', short:'Chiefs' },
  'Las Vegas Raiders': { abbr:'LV', short:'Raiders' }, 'Los Angeles Chargers': { abbr:'LAC', short:'Chargers' },
  'Los Angeles Rams': { abbr:'LAR', short:'Rams' }, 'Miami Dolphins': { abbr:'MIA', short:'Dolphins' },
  'Minnesota Vikings': { abbr:'MIN', short:'Vikings' }, 'New England Patriots': { abbr:'NE', short:'Patriots' },
  'New Orleans Saints': { abbr:'NO', short:'Saints' }, 'New York Giants': { abbr:'NYG', short:'Giants' },
  'New York Jets': { abbr:'NYJ', short:'Jets' }, 'Philadelphia Eagles': { abbr:'PHI', short:'Eagles' },
  'Pittsburgh Steelers': { abbr:'PIT', short:'Steelers' }, 'San Francisco 49ers': { abbr:'SF', short:'49ers' },
  'Seattle Seahawks': { abbr:'SEA', short:'Seahawks' }, 'Tampa Bay Buccaneers': { abbr:'TB', short:'Buccaneers' },
  'Tennessee Titans': { abbr:'TEN', short:'Titans' }, 'Washington Commanders': { abbr:'WAS', short:'Commanders' }
};
const TEAM_ALIASES = {
  ARI:'Arizona Cardinals', ATL:'Atlanta Falcons', BAL:'Baltimore Ravens', BUF:'Buffalo Bills', CAR:'Carolina Panthers', CHI:'Chicago Bears', CIN:'Cincinnati Bengals', CLE:'Cleveland Browns', DAL:'Dallas Cowboys', DEN:'Denver Broncos', DET:'Detroit Lions', GB:'Green Bay Packers', GNB:'Green Bay Packers', HOU:'Houston Texans', IND:'Indianapolis Colts', JAX:'Jacksonville Jaguars', JAC:'Jacksonville Jaguars', KC:'Kansas City Chiefs', KAN:'Kansas City Chiefs', LV:'Las Vegas Raiders', LVR:'Las Vegas Raiders', LAC:'Los Angeles Chargers', LAR:'Los Angeles Rams', MIA:'Miami Dolphins', MIN:'Minnesota Vikings', NE:'New England Patriots', NWE:'New England Patriots', NO:'New Orleans Saints', NOS:'New Orleans Saints', NYG:'New York Giants', NYJ:'New York Jets', PHI:'Philadelphia Eagles', PIT:'Pittsburgh Steelers', SF:'San Francisco 49ers', SFO:'San Francisco 49ers', SEA:'Seattle Seahawks', TB:'Tampa Bay Buccaneers', TAM:'Tampa Bay Buccaneers', TEN:'Tennessee Titans', WAS:'Washington Commanders', WSH:'Washington Commanders'
};
const TEAM_NAMES = Object.keys(TEAMS);
function normalizeTeam(input) {
  if (!input) return null;
  if (TEAMS[input]) return input;
  const s = input.trim();
  if (TEAM_ALIASES[s.toUpperCase()]) return TEAM_ALIASES[s.toUpperCase()];
  return TEAM_NAMES.find(t => t.toLowerCase() === s.toLowerCase() || TEAMS[t].short.toLowerCase() === s.toLowerCase()) || null;
}
function parseRoleIds() {
  const out = {};
  for (const pair of (process.env.TEAM_ROLE_IDS || '').split(',')) {
    const [team, id] = pair.split('=').map(s => s?.trim());
    if (team && id) out[normalizeTeam(team) || team] = id;
  }
  return out;
}
const TEAM_ROLE_IDS = parseRoleIds();
function isAdmin(i) { return i.memberPermissions?.has(PermissionFlagsBits.Administrator); }
async function getMissedRole(guild, createIfMissing = true) {
  if (MISSED_DRAFT_ROLE_ID) {
    const role = guild.roles.cache.get(MISSED_DRAFT_ROLE_ID) || await guild.roles.fetch(MISSED_DRAFT_ROLE_ID).catch(() => null);
    return role || null;
  }
  let role = guild.roles.cache.find(r => r.name.toLowerCase() === MISSED_DRAFT_ROLE_NAME.toLowerCase());
  if (!role && createIfMissing) {
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('The bot needs Manage Roles permission to create/use the Missed draft role.');
    }
    role = await guild.roles.create({ name: MISSED_DRAFT_ROLE_NAME, reason: 'Madden League bot: required for draft attendance' });
  }
  return role || null;
}
async function hasMissedDraft(member) {
  const role = await getMissedRole(member.guild, false);
  return !!role && member.roles.cache.has(role.id);
}
function teamRoleMatches(member, team) {
  const configured = TEAM_ROLE_IDS[team];
  if (configured && member.roles.cache.has(configured)) return true;
  const d = TEAMS[team];
  return member.roles.cache.some(r => { const n=r.name.toLowerCase(); return n.includes(team.toLowerCase()) || n.includes(d.short.toLowerCase()) || new RegExp(`\\b${d.abbr.toLowerCase()}\\b`).test(n); });
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function weekLabel(w) { const x = String(w).trim(); return /^WK/i.test(x) ? x.toUpperCase() : `WK${x}`; }
function teamSearchNames(team) {
  const d = TEAMS[team];
  return [d.short, d.abbr, team]
    .filter(Boolean)
    .sort((a,b) => b.length - a.length)
    .map(esc);
}

function normalizeScoreText(text) {
  return String(text || '')
    .replace(/<a?:[^:>]+:\d+>/g, ' ')
    .replace(/<@!?\d+>/g, ' ')
    .replace(/<#[^>]+>/g, ' ')
    .replace(/<t:\d+(?::[tTdDfFR])?>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\r\n]+/g, '\n')
    .replace(/[*_~`]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function teamTokens(team) {
  const d = TEAMS[team];
  return [team, d.short, d.abbr].filter(Boolean).map(x => String(x).toLowerCase());
}

function teamAppears(line, team) {
  const lower = String(line || '').toLowerCase();
  return teamTokens(team).some(token => {
    const escaped = esc(token);
    return new RegExp(`(?:^|\\b)${escaped}(?:$|\\b)`, 'i').test(lower);
  });
}

function stripTrailingGameNote(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function extractGameLines(text) {
  const clean = normalizeScoreText(text);
  const lines = clean.split(/\n+/).map(x => stripTrailingGameNote(x.trim())).filter(Boolean);
  const games = [];

  // Snallabot's real format from the league score channel:
  //   Cowboys 35 vs 26 Giants
  // and sometimes:
  //   Cowboys 35 vs 26 Giants (Force Win Home)
  // Logos are removed by normalizeScoreText().
  for (const line of lines) {
    const patterns = [
      /^(.*?)\s+(\d+)\s+(?:vs\.?|@|[-–—])\s+(\d+)\s+(.*?)$/i,
      /^(.*?)\s+(\d+)\s+(\d+)\s+(.*?)$/i
    ];
    let m = null;
    for (const pattern of patterns) {
      m = line.match(pattern);
      if (m) break;
    }
    if (!m) continue;

    const left = m[1].trim();
    const leftScore = Number(m[2]);
    const rightScore = Number(m[3]);
    const right = stripTrailingGameNote(m[4].trim());
    if (!left || !right || !Number.isFinite(leftScore) || !Number.isFinite(rightScore)) continue;

    games.push({ left, leftScore, right, rightScore, raw: line });
  }
  return games;
}

function extractGameByAliases(text, awayTeam, homeTeam) {
  const clean = normalizeScoreText(text);
  const aliases = team => teamTokens(team).sort((a, b) => b.length - a.length).map(esc).join('|');
  const awayAliases = aliases(awayTeam);
  const homeAliases = aliases(homeTeam);

  // Direct fallback for the exact Snallabot structure. This deliberately
  // does not depend on markdown, emoji, or the Week header.
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*(?:${awayAliases})\\s+(\\d+)\\s+(?:vs\\.?|@|[-–—])\\s+(\\d+)\\s+(?:${homeAliases})(?:\\s*\\([^\\n)]*\\))?\\s*$`, 'im'),
    new RegExp(`(?:^|\\n)\\s*(?:${homeAliases})\\s+(\\d+)\\s+(?:vs\\.?|@|[-–—])\\s+(\\d+)\\s+(?:${awayAliases})(?:\\s*\\([^\\n)]*\\))?\\s*$`, 'im')
  ];

  let m = clean.match(patterns[0]);
  if (m) return { awayScore: Number(m[1]), homeScore: Number(m[2]), raw: m[0].trim() };
  m = clean.match(patterns[1]);
  if (m) return { awayScore: Number(m[2]), homeScore: Number(m[1]), raw: m[0].trim() };
  return null;
}

function findScore(text, awayTeam, homeTeam) {
  for (const game of extractGameLines(text)) {
    const leftAway = teamAppears(game.left, awayTeam) && teamAppears(game.right, homeTeam);
    const rightAway = teamAppears(game.left, homeTeam) && teamAppears(game.right, awayTeam);
    if (leftAway) return { awayScore: game.leftScore, homeScore: game.rightScore, raw: game.raw };
    if (rightAway) return { awayScore: game.rightScore, homeScore: game.leftScore, raw: game.raw };
  }
  return extractGameByAliases(text, awayTeam, homeTeam);
}

function weekMatches(text, week) {
  const n = String(week).trim().replace(/^WK\s*/i, '').replace(/^WEEK\s*/i, '');
  if (!n) return false;
  const clean = normalizeScoreText(text);
  return new RegExp(`(?:\\bWK|\\bWEEK)\\s*${esc(n)}\\b`, 'i').test(clean)
    || new RegExp(`\\bSEASON\\s+WEEK\\s*${esc(n)}\\b`, 'i').test(clean)
    || new RegExp(`\\bWEEK\\s*${esc(n)}\\s+GAMES?\\b`, 'i').test(clean);
}

function scoreMessageText(message) {
  const embedText = (message.embeds || [])
    .flatMap(e => [
      e.title,
      e.description,
      ...(e.fields || []).flatMap(f => [f.name, f.value]),
      e.author?.name,
      e.footer?.text
    ])
    .filter(Boolean)
    .join('\n');
  return normalizeScoreText([message.content || '', embedText].filter(Boolean).join('\n'));
}

async function findTeamOwner(guild, team) {
  // Team ownership is determined by the same team role system used by the
  // rest of the bot. Prefer an explicitly configured role ID, then fall back
  // to an exact team/short-name/abbreviation role name.
  const configuredId = TEAM_ROLE_IDS[team];
  let role = configuredId
    ? (guild.roles.cache.get(configuredId) || await guild.roles.fetch(configuredId).catch(() => null))
    : null;

  if (!role) {
    const names = [team, TEAMS[team].short, TEAMS[team].abbr].map(x => x.toLowerCase());
    role = guild.roles.cache.find(r => names.includes(r.name.toLowerCase())) || null;
  }

  if (!role) return null;

  // Make sure the member cache is populated before checking role.members.
  // This is safe to do only when GOTW is created, not on every message.
  if (!role.members.size) {
    await guild.members.fetch().catch(() => null);
  }

  const owner = role.members.find(m => !m.user.bot);
  return owner || role.members.first() || null;
}

async function findGameScore(week, awayTeam, homeTeam) {
  const channel = await client.channels.fetch(SCORE_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages?.fetch) {
    throw new Error(`Cannot access Snallabot score channel ${SCORE_CHANNEL_ID}. Check View Channel and Read Message History permissions.`);
  }

  let before;
  let checked = 0;
  let sawWeek = false;
  let sawAnyScoreLine = false;
  let lastTexts = [];

  while (checked < 10000) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    for (const m of batch.values()) {
      checked++;
      const text = scoreMessageText(m);
      if (!text) continue;

      if (weekMatches(text, week)) sawWeek = true;
      if (extractGameLines(text).length) sawAnyScoreLine = true;
      if (lastTexts.length < 3) lastTexts.push(text.slice(0, 500));

      const score = findScore(text, awayTeam, homeTeam);
      if (score) {
        return {
          ...score,
          weekFound: sawWeek || weekMatches(text, week),
          messageId: m.id
        };
      }
    }

    before = batch.last().id;
    if (batch.size < 100) break;
  }

  console.warn(`[GOTW] Could not find ${TEAMS[awayTeam].abbr} vs ${TEAMS[homeTeam].abbr}. checked=${checked} sawWeek=${sawWeek} sawScoreLine=${sawAnyScoreLine}`);
  return null;
}

function gamePost(g,rewards=null) {
  const winner=g.awayScore>g.homeScore?g.awayTeam:g.homeTeam;
  const loser=g.awayScore>g.homeScore?g.homeTeam:g.awayTeam;
  // These are actual Discord user mentions. If a team owner has a nickname
  // such as "Cowboys [deathskull0660]", Discord will render that nickname in
  // the mention automatically. Bold the mention so the final line reads like
  // @**Cowboys [deathskull0660]** DAL 35 26 NYG @**Giants {commish} [MoonXSN]**.
  const awayMention=g.teamMentions?.[g.awayTeam]?`**<@${g.teamMentions[g.awayTeam].id}>** `:'';
  const homeMention=g.teamMentions?.[g.homeTeam]?` **<@${g.teamMentions[g.homeTeam].id}>**`:'';
  return [
    `**Game of the week (${weekLabel(g.week)}):**`, '',
    `${awayMention}${TEAMS[g.awayTeam].abbr} ${g.awayScore} ${g.homeScore} ${TEAMS[g.homeTeam].abbr}${homeMention}`, '',
    g.reason, '',
    rewards?.stardevPlayer ? `**${TEAMS[winner].short}:** Stardev *${rewards.stardevPlayer}* +1 ${rewards.physicalAttribute} *${rewards.physicalPlayer}*` : `**${TEAMS[winner].short}:** Stardev __ +1 physical attribute __`,
    rewards?.loserSpeedPlayer ? `**${TEAMS[loser].short}:** +1 speed *${rewards.loserSpeedPlayer}*` : `**${TEAMS[loser].short}:** +1 speed __`
  ].join('\n');
}
function gotwButtons(winner,loser,winDisabled=false,loseDisabled=false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gotw_winner:${winner}`).setLabel('Winner Rewards').setStyle(ButtonStyle.Success).setDisabled(winDisabled),
    new ButtonBuilder().setCustomId(`gotw_loser:${loser}`).setLabel('Loser Reward').setStyle(ButtonStyle.Danger).setDisabled(loseDisabled)
  )];
}
function userPost(user,week,r=null) { return [`**Week ${String(week).replace(/^WK/i,'')}**`,`**UOW:** ${user}`,'**Award:**',r?`+5 awareness *${r.awareness_player}*`:'+5 awareness __',r?`+2 ${r.position_attribute} *${r.position_player}*`:'+2 position attribute __',r?`+1 ${r.physical_attribute} *${r.physical_player}*`:'+1 physical attribute __'].join('\n'); }
function uowButtons(id,disabled=false) { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`uow_claim:${id}`).setLabel('Claim Awards').setStyle(ButtonStyle.Primary).setDisabled(disabled))]; }

const commands = [
  new SlashCommandBuilder().setName('game-of-the-week').setDescription('Create a Game of the Week award post.').addStringOption(o=>o.setName('week').setDescription('Week in Snallabot.').setRequired(true)).addStringOption(o=>o.setName('away_team').setDescription('Away team.').setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName('home_team').setDescription('Home team.').setRequired(true).setAutocomplete(true)).addStringOption(o=>o.setName('reason').setDescription('Why this is Game of the Week.').setRequired(true).setMaxLength(1000)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('draft').setDescription('Post the draft attendance poll.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('draft-results').setDescription('View current draft attendance answers.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('clear-dev-traits').setDescription('Reset dev trait submissions so users can claim again.').addUserOption(o=>o.setName('user').setDescription('Optional user to reset; omit to reset everyone.').setRequired(false)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('dev-traits').setDescription('Post the dev traits claim buttons.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('check-dev-traits').setDescription('Review submitted dev traits.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('prospect-maker').setDescription('Post the prospect maker button.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// Commands that index.js itself handles (captured BEFORE the other modules add theirs).
// The administrator gate below applies only to these; features.js and teamClaimer.js
// enforce their own permissions (members use /my-team and /open-teams, moderators with
// Manage Roles use /setup-nfl-teams, etc.).
const INDEX_COMMAND_NAMES = new Set(commands.map(c => c.name));

const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent] });
let TEAM_CLAIMER = null; // assigned below; features.js reads it lazily
const FDL_FEATURES = require('./features')(client, commands, { GUILD_ID, SCORE_CHANNEL_ID, PROSPECT_CHANNEL_ID, PROSPECT_STATS_CHANNEL_ID, TEAMS, TEAM_ROLE_IDS, normalizeTeam, teamRoleMatches, isAdmin, findScore, scoreMessageText,
  claimerRoleId: team => TEAM_CLAIMER?.roleIdForTeamName(TEAMS[team]?.short) || null });
// One bot: Team Claimer (claims, waitlist, EA connection) and the EA franchise features
// (standings, schedule, rosters, leaders, power rankings, free agents, game channels,
// auto Players of the Week) all run on this same client.
TEAM_CLAIMER = require('./teamClaimer')(client, commands);
const FRANCHISE = require('./franchise')(client, commands, { GUILD_ID, SCORE_CHANNEL_ID, TEAMS, normalizeTeam, isAdmin, teamClaimer: TEAM_CLAIMER, features: FDL_FEATURES });
// Ported from Snallabot (MIT, see SNALLABOT_LICENSE.md): trade committee.
require('./trade')(client, commands, { GUILD_ID, franchise: FRANCHISE });
require('./gameChannels')(client, commands, { GUILD_ID, franchise: FRANCHISE });
async function registerCommands(){const rest=new REST({version:'10'}).setToken(TOKEN);await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands.map(c=>c.toJSON())});console.log('Registered league management commands.');}
client.once('ready',async()=>{console.log(`Logged in as ${client.user.tag}`);try{await registerCommands();}catch(e){console.error('Slash-command registration failed. Check application ID, guild ID, and bot permissions:',e);}});

function modalField(id,label,placeholder,required=true,style=TextInputStyle.Short,max=100){return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder||'').setStyle(style).setRequired(required).setMaxLength(max));}
function getFields(i, ids){const o={}; for(const id of ids)o[id]=i.fields.getTextInputValue(id).trim(); return o;}

client.on('interactionCreate',async i=>{
  try {
    if(i.isAutocomplete()){
      if(i.commandName!=='game-of-the-week')return;
      const q=i.options.getFocused().toLowerCase();
      return i.respond(TEAM_NAMES.filter(t=>t.toLowerCase().includes(q)||TEAMS[t].short.toLowerCase().includes(q)||TEAMS[t].abbr.toLowerCase().includes(q)).slice(0,25).map(t=>({name:`${TEAMS[t].short} (${TEAMS[t].abbr})`,value:t})));
    }
    if(i.isChatInputCommand()){
      if(INDEX_COMMAND_NAMES.has(i.commandName)&&!isAdmin(i))return i.reply({content:'You must be an administrator to use this command.',ephemeral:true});
      if(i.commandName==='game-of-the-week'){ return; }
      if(i.commandName==='draft'){
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('draft_vote:yes').setLabel('Yes').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('draft_vote:no').setLabel('No').setStyle(ButtonStyle.Danger)
        );
        const msg=await i.channel.send({content:'**Will you make the draft?**',components:[row]});
        draftData.polls[msg.id]={guildId:i.guildId,channelId:i.channelId,createdBy:i.user.id,createdAt:Date.now()};
        writeJson(FILES.draft,draftData);
        return i.reply({content:'Draft poll posted.',ephemeral:true});
      }
      if(i.commandName==='clear-dev-traits'){
        const target=i.options.getUser('user');
        devTraits=readJson(FILES.devtraits,{}); devTraitsGiven=readJson(FILES.devtraitsGiven,{});
        if(target){
          delete devTraits[target.id];
          delete devTraitsGiven[target.id];
          writeJson(FILES.devtraits,devTraits); writeJson(FILES.devtraitsGiven,devTraitsGiven);
          return i.reply({content:`Cleared the dev-trait submission for ${target}. They can claim again.`,ephemeral:true,allowedMentions:{users:[target.id]}});
        }
        devTraits={}; devTraitsGiven={};
        writeJson(FILES.devtraits,devTraits); writeJson(FILES.devtraitsGiven,devTraitsGiven);
        for(const [id,s] of devSessions) { if(s?.adminId===i.user.id) devSessions.delete(id); }
        return i.reply({content:'Cleared all dev-trait submissions. Everyone can claim again.',ephemeral:true});
      }
      if(i.commandName==='draft-results'){
        const entries=Object.entries(draftData.users); const yes=entries.filter(([,v])=>v.choice==='yes'), no=entries.filter(([,v])=>v.choice==='no');
        const names=arr=>arr.map(([id])=>`<@${id}>`);
        const content=`**Draft results**\n\n**Yes (${yes.length}):**\n${names(yes).join('\n')||'None'}\n\n**No / Missed Draft (${no.length}):\n${names(no).join('\n')||'None'}`;
        const chunks=[];let current='';for(const line of content.split('\n')){if((current+'\n'+line).length>1850){chunks.push(current);current=line;}else current+=(current?'\n':'')+line;}if(current)chunks.push(current);
        await i.reply({content:chunks[0]||'No draft results yet.',ephemeral:true});for(const chunk of chunks.slice(1))await i.followUp({content:chunk,ephemeral:true});return;
      }
      if(i.commandName==='dev-traits'){
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('dev_regular').setLabel('Claim').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('dev_missed').setLabel('Claim (Missed Draft)').setStyle(ButtonStyle.Danger));
        await i.reply({content:'**Come get your dev traits!**',components:[row]});return;
      }
      if(i.commandName==='check-dev-traits'){
        // Reload from disk so the admin queue always reflects what was actually marked Given.
        devTraits = readJson(FILES.devtraits, {});
        devTraitsGiven = readJson(FILES.devtraitsGiven, {});
        for (const id of Object.keys(devTraits)) { if (devTraitsGiven[id]) delete devTraits[id]; }
        writeJson(FILES.devtraits, devTraits);
        const ids=Object.keys(devTraits); if(!ids.length)return i.reply({content:'There are no un-given dev trait submissions.',ephemeral:true});
        const sessionId=`${i.user.id}:${Date.now()}`; devSessions.set(sessionId,{adminId:i.user.id,ids,index:0});
        return sendDevPage(i,sessionId);
      }
      if(i.commandName==='prospect-maker'){
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prospect_make').setLabel('Make Now').setStyle(ButtonStyle.Primary));
        await i.reply({content:'**Create your prospect!**',components:[row]});return;
      }
    }

    if(i.isButton()){
      if(i.customId==='draft_vote:yes'||i.customId==='draft_vote:no'){
        const choice=i.customId.endsWith(':no')?'no':'yes';
        const record=draftData.polls[i.message.id];
        if(!record)return i.reply({content:'This draft poll is no longer active.',ephemeral:true});
        draftData.users[i.user.id]={choice,pollId:i.message.id,updatedAt:Date.now()};
        try{
          const role=await getMissedRole(i.guild,true);
          if(!role)throw new Error(`Could not find or create the '${MISSED_DRAFT_ROLE_NAME}' role.`);
          const me=i.guild.members.me||await i.guild.members.fetchMe();
          if(!me.permissions.has(PermissionFlagsBits.ManageRoles))throw new Error('The bot does not have Manage Roles permission.');
          if(role.managed||role.position>=me.roles.highest.position)throw new Error(`The '${role.name}' role is not below the bot's highest role. Move the bot's bot role above '${role.name}'.`);
          const member=await i.guild.members.fetch(i.user.id);
          if(choice==='no') await member.roles.add(role,'Draft poll: selected No');
          else if(member.roles.cache.has(role.id)) await member.roles.remove(role,'Draft poll: selected Yes');
          writeJson(FILES.draft,draftData);
          return i.reply({content:choice==='no'?`Recorded **No** and gave you the **${role.name}** role.`:'Recorded **Yes**.',ephemeral:true});
        }catch(e){
          writeJson(FILES.draft,draftData);
          return i.reply({content:`Your vote was recorded as **${choice.toUpperCase()}**, but I could not update the role: ${e.message}`,ephemeral:true});
        }
      }
      if(i.customId==='dev_regular'||i.customId==='dev_missed'){
        const missed=i.customId==='dev_missed', member=await i.guild.members.fetch(i.user.id), role=await getMissedRole(i.guild, true);
        if(!role)return i.reply({content:'The Missed draft role could not be found. Set MISSED_DRAFT_ROLE_ID or create the role named "Missed draft".',ephemeral:true});
        if(missed&&!member.roles.cache.has(role.id))return i.reply({content:'This button is only for members with the Missed draft role.',ephemeral:true});
        if(!missed&&member.roles.cache.has(role.id))return i.reply({content:'Because you have the Missed draft role, use Claim (Missed Draft).',ephemeral:true});
        if(devTraits[i.user.id])return i.reply({content:'You have already submitted your dev traits.',ephemeral:true});
        devSessions.set(i.user.id,{mode:missed?'missed':'regular',data:{}});
        const modal=new ModalBuilder().setCustomId(`dev_modal1:${i.user.id}`).setTitle(missed?'Missed Draft Dev Traits':'Dev Traits');
        const ids=[['age1','Age reset 1'],['age2','Age reset 2'],['age3','Age reset 3'],['xfactor','X factor'],[missed?'superstar1':'superstar','Superstar']];
        modal.addComponents(...ids.map(([id,label])=>modalField(id,label,'Player name'))); await i.showModal(modal);return;
      }
      if(i.customId.startsWith('prospect_continue2:')){
        const id=i.customId.split(':')[1];
        const s=prospectSessions.get(id);
        if(id!==i.user.id)return i.reply({content:'This prospect form belongs to another user.',ephemeral:true});
        if(!s)return i.reply({content:'Your prospect session expired. Click Make Now to start a fresh form.',ephemeral:true});
        const m=new ModalBuilder().setCustomId(`prospect2:${id}`).setTitle('Prospect Maker — Traits');
        m.addComponents(modalField('archetype','Archetype','Example: Power Rusher, Deep Threat'),modalField('strength1','⭐ Strength 1','Strength 1'),modalField('strength2','⭐ Strength 2','Strength 2'),modalField('strength3','⭐ Strength 3','Strength 3'),modalField('weakness1','⚠️ Weakness 1','Weakness 1'));
        return i.showModal(m);
      }
      if(i.customId.startsWith('prospect_continue3:')){
        const id=i.customId.split(':')[1];
        const s=prospectSessions.get(id);
        if(id!==i.user.id)return i.reply({content:'This prospect form belongs to another user.',ephemeral:true});
        if(!s)return i.reply({content:'Your prospect session expired. Click Make Now to start a fresh form.',ephemeral:true});
        const m=new ModalBuilder().setCustomId(`prospect3:${id}`).setTitle('Prospect Maker — Final');
        m.addComponents(modalField('weakness2','⚠️ Weakness 2','Weakness 2'),modalField('age','Age','Example: 21',true,TextInputStyle.Short,3),modalField('number','Number (optional)','Example: 12',false,TextInputStyle.Short,3),modalField('backstory','📖 Backstory (optional)','Optional backstory',false,TextInputStyle.Paragraph,1000),modalField('comparison','Player Comparison','NFL player comparison'));
        return i.showModal(m);
      }
      if(i.customId==='prospect_make'){
        // Always start a fresh prospect. A stale/incomplete session must never block the user.
        prospectSessions.delete(i.user.id);
        prospectSessions.set(i.user.id,{data:{},startedAt:Date.now()});
        const m=new ModalBuilder().setCustomId(`prospect1:${i.user.id}`).setTitle('Prospect Maker — Basic');
        m.addComponents(modalField('name','Name','Player name'),modalField('college','College','College'),modalField('position','Position','QB, WR, EDGE, etc.'),modalField('height','Height','Example: 6\'3"'),modalField('weight','Weight','Example: 205 lbs')); await i.showModal(m);return;
      }
      if(i.customId.startsWith('devpage:')){
        // Session IDs contain ':' (Discord user ID + timestamp), so do NOT use
        // a simple three-part destructure here. The old code treated the
        // timestamp as the action and looked up only the user ID as the session.
        const parts = i.customId.split(':');
        const action = parts.pop();
        parts.shift(); // remove "devpage"
        const sid = parts.join(':');
        const s = devSessions.get(sid);

        if(!s || s.adminId !== i.user.id){
          return i.reply({content:'This review page is no longer available to you.',ephemeral:true});
        }

        // Keep the session queue synchronized with the current submissions.
        s.ids = Object.keys(devTraits).filter(id => !devTraitsGiven[id]);

        if(!s.ids.length){
          devSessions.delete(sid);
          return i.update({content:'**All dev trait submissions have been marked given.**',components:[]});
        }

        if(action === 'next') s.index = Math.min(s.ids.length - 1, s.index + 1);
        if(action === 'prev') s.index = Math.max(0, s.index - 1);

        if(action === 'given'){
          const givenId = s.ids[s.index];
          if(givenId){
            devTraitsGiven[givenId] = { givenAt: Date.now(), givenBy: i.user.id };
            delete devTraits[givenId];
            writeJson(FILES.devtraitsGiven, devTraitsGiven);
            writeJson(FILES.devtraits, devTraits);
          }

          // Rebuild the queue after marking the current submission Given.
          s.ids = Object.keys(devTraits).filter(id => !devTraitsGiven[id]);
          if(!s.ids.length){
            devSessions.delete(sid);
            return i.update({content:'**All dev trait submissions have been marked given.**',components:[]});
          }

          // Stay at the same position when possible; if the last item was
          // removed, move back one page instead of going out of bounds.
          s.index = Math.min(s.index, s.ids.length - 1);
        }

        return sendDevPage(i, sid, true);
      }
      if(i.customId.startsWith('uow_claim:')){
        const id=i.customId.split(':')[1]; if(i.user.id!==id)return i.reply({content:'Only the User of the Week can claim these awards.',ephemeral:true});
        const m=new ModalBuilder().setCustomId(`uow_modal:${id}`).setTitle('User of the Week Awards');
        m.addComponents(modalField('awareness_player','Player for +5 Awareness','Player name'),modalField('position_player','Player for +2 Position Attribute','Player name'),modalField('position_attribute','Position Attribute (+2)','Attribute for that player'),modalField('physical_player','Player for +1 Physical Attribute','Player name'),modalField('physical_attribute','Physical Attribute (+1)','Attribute')); await i.showModal(m);return;
      }
      if(i.customId.startsWith('gotw_winner:')||i.customId.startsWith('gotw_loser:')){
        const [type,team]=i.customId.split(':');const member=await i.guild.members.fetch(i.user.id);const t=normalizeTeam(team);if(!teamRoleMatches(member,t))return i.reply({content:`Only the ${TEAMS[t].short} team role can use this button.`,ephemeral:true});
        if(type==='gotw_winner'){const m=new ModalBuilder().setCustomId(`gotw_win_modal:${t}`).setTitle('Winner Rewards');m.addComponents(modalField('stardev_player','Stardev Player','Player name'),modalField('physical_attribute','Physical Attribute (+1)','Attribute'),modalField('physical_player','Player Receiving Attribute','Player name'));await i.showModal(m);}else{const m=new ModalBuilder().setCustomId(`gotw_lose_modal:${t}`).setTitle('Loser Reward');m.addComponents(modalField('loser_speed_player','Player for +1 Speed','Player name'));await i.showModal(m);}return;
      }
    }

    if(i.isModalSubmit()){
      if(i.customId.startsWith('uow_modal:')){
        const id=i.customId.split(':')[1];if(i.user.id!==id)return i.reply({content:'Only the User of the Week can submit these awards.',ephemeral:true});
        const r=getFields(i,['awareness_player','position_player','position_attribute','physical_player','physical_attribute']);const user=await client.users.fetch(id);const msg=await i.channel.messages.fetch(i.message.id);const m=msg.content.match(/^\*\*Week\s+([^*]+)\*\*/i);await msg.edit({content:userPost(user,m?m[1]:'' ,r),components:uowButtons(id,true),allowedMentions:{users:[id]}});return i.reply({content:'Your User of the Week awards have been added.',ephemeral:true});
      }
      if(i.customId.startsWith('gotw_win_modal:')){const team=normalizeTeam(i.customId.split(':')[1]);const member=await i.guild.members.fetch(i.user.id);if(!teamRoleMatches(member,team))return i.reply({content:'You do not have the correct team role.',ephemeral:true});const r=getFields(i,['stardev_player','physical_attribute','physical_player']);const msg=await i.channel.messages.fetch(i.message.id);const lines=msg.content.split('\n');const idx=lines.findIndex(x=>x.startsWith(`**${TEAMS[team].short}:**`));if(idx>=0)lines[idx]=`**${TEAMS[team].short}:** Stardev *${r.stardev_player}* +1 ${r.physical_attribute} *${r.physical_player}*`;await msg.edit({content:lines.join('\n'),components:disableGotw(msg.components,'winner')});return i.reply({content:'Winner rewards added.',ephemeral:true});}
      if(i.customId.startsWith('gotw_lose_modal:')){const team=normalizeTeam(i.customId.split(':')[1]);const member=await i.guild.members.fetch(i.user.id);if(!teamRoleMatches(member,team))return i.reply({content:'You do not have the correct team role.',ephemeral:true});const p=i.fields.getTextInputValue('loser_speed_player').trim();const msg=await i.channel.messages.fetch(i.message.id);const lines=msg.content.split('\n');const idx=lines.findIndex(x=>x.startsWith(`**${TEAMS[team].short}:**`));if(idx>=0)lines[idx]=`**${TEAMS[team].short}:** +1 speed *${p}*`;await msg.edit({content:lines.join('\n'),components:disableGotw(msg.components,'loser')});return i.reply({content:'Loser reward added.',ephemeral:true});}
      if(i.customId.startsWith('dev_modal1:')){
        const id=i.customId.split(':')[1],s=devSessions.get(id);if(!s||i.user.id!==id)return i.reply({content:'This form expired. Please click the claim button again.',ephemeral:true});
        const ids=['age1','age2','age3','xfactor',s.mode==='missed'?'superstar1':'superstar'];Object.assign(s.data,getFields(i,ids));
        if(s.mode==='missed'){const m=new ModalBuilder().setCustomId(`dev_modal2:${id}`).setTitle('Missed Draft — Final Trait');m.addComponents(modalField('superstar2','Superstar 2','Player name'));await i.showModal(m);return;}
        delete devTraitsGiven[id]; writeJson(FILES.devtraitsGiven, devTraitsGiven); devTraits[id]={userId:id,username:i.user.username,mode:s.mode,...s.data,submittedAt:Date.now()};writeJson(FILES.devtraits,devTraits);devSessions.delete(id);return i.reply({content:'Your dev traits have been submitted.',ephemeral:true});
      }
      if(i.customId.startsWith('dev_modal2:')){const id=i.customId.split(':')[1],s=devSessions.get(id);if(!s||i.user.id!==id)return i.reply({content:'This form expired. Please click the claim button again.',ephemeral:true});s.data.superstar2=i.fields.getTextInputValue('superstar2').trim();delete devTraitsGiven[id]; writeJson(FILES.devtraitsGiven, devTraitsGiven); devTraits[id]={userId:id,username:i.user.username,mode:'missed',...s.data,submittedAt:Date.now()};writeJson(FILES.devtraits,devTraits);devSessions.delete(id);return i.reply({content:'Your missed-draft dev traits have been submitted.',ephemeral:true});}
      if(i.customId.startsWith('prospect1:')){
        const id=i.customId.split(':')[1],s=prospectSessions.get(id);
        if(id!==i.user.id)return i.reply({content:'This prospect form belongs to another user.',ephemeral:true});
        if(!s){prospectSessions.set(id,{data:{},startedAt:Date.now()});return i.reply({content:'Your old prospect session expired. Click Make Now to start a new one.',ephemeral:true});}
        Object.assign(s.data,getFields(i,['name','college','position','height','weight']));
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`prospect_continue2:${id}`).setLabel('Continue to Traits').setStyle(ButtonStyle.Primary));
        return i.reply({content:'**Step 1 saved.** Click **Continue to Traits** to enter the archetype, strengths, and first weakness.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('prospect2:')){
        const id=i.customId.split(':')[1],s=prospectSessions.get(id);
        if(id!==i.user.id)return i.reply({content:'This prospect form belongs to another user.',ephemeral:true});
        if(!s){prospectSessions.set(id,{data:{},startedAt:Date.now()});return i.reply({content:'Your old prospect session expired. Click Make Now to start a new one.',ephemeral:true});}
        Object.assign(s.data,getFields(i,['archetype','strength1','strength2','strength3','weakness1']));
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`prospect_continue3:${id}`).setLabel('Continue to Final Step').setStyle(ButtonStyle.Primary));
        return i.reply({content:'**Step 2 saved.** Click **Continue to Final Step** to enter the second weakness, age, optional number, optional backstory, and player comparison.',components:[row],ephemeral:true});
      }
      if(i.customId.startsWith('prospect3:')){
        const id=i.customId.split(':')[1],s=prospectSessions.get(id);
        if(id!==i.user.id)return i.reply({content:'This prospect form belongs to another user.',ephemeral:true});
        if(!s){prospectSessions.delete(id);return i.reply({content:'Your prospect session expired. Click Make Now to start a fresh one.',ephemeral:true});}
        Object.assign(s.data,getFields(i,['weakness2','age','number','backstory','comparison']));
        const d=s.data;
        if(!/^\d{1,2}$/.test(d.age||'')||(d.number&&!/^\d{1,2}$/.test(d.number)))return i.reply({content:'Age must be a whole number (example: 21), and Number must be a number from 0 to 99 (or left blank). Click **Continue to Final Step** to try again.',ephemeral:true});
        if(!d.name||!d.college||!d.position||!d.age||!d.height||!d.weight||!d.archetype||!d.strength1||!d.strength2||!d.strength3||!d.weakness1||!d.weakness2||!d.comparison){prospectSessions.delete(id);return i.reply({content:'A required prospect field was missing. Click Make Now to start again.',ephemeral:true});}
        const text=[`**${d.name}**`,`College: ${d.college}`,`Position: ${d.position}`,`Age: ${d.age}`,`Number: ${d.number||'N/A'}`,`Height: ${d.height}`,`Weight: ${d.weight}`,`Archetype: ${d.archetype}`,'',`⭐ Strength: ${d.strength1}`,`⭐ Strength: ${d.strength2}`,`⭐ Strength: ${d.strength3}`,'',`⚠️ Weakness: ${d.weakness1}`,`⚠️ Weakness: ${d.weakness2}`,'',`📖 Backstory (optional): ${d.backstory||'N/A'}`,'',`Player Comparison: ${d.comparison}`].join('\n');
        const ch=await client.channels.fetch(PROSPECT_CHANNEL_ID);
        if(!ch?.isTextBased())throw new Error(`Prospect channel ${PROSPECT_CHANNEL_ID} is not text based.`);
        const perms=ch.permissionsFor(i.guild.members.me || client.user);
        if(!perms?.has(['ViewChannel','SendMessages']))throw new Error(`Bot lacks View Channel and/or Send Messages in prospect channel ${PROSPECT_CHANNEL_ID}.`);
        const sent=await ch.send({content:text});
        await FDL_FEATURES.createProspectSheet(d).catch(e=>console.error('[prospect stat sheet]',e));
        prospects.push({userId:id,username:i.user.username,channelId:PROSPECT_CHANNEL_ID,messageId:sent.id,data:d,createdAt:Date.now()});
        writeJson(FILES.prospects,prospects);
        prospectSessions.delete(id);
        return i.reply({content:'Your prospect was posted.',ephemeral:true});
      }
    }
  }catch(e){console.error(e);if(i.isModalSubmit() && i.customId?.startsWith('prospect')) prospectSessions.delete(i.user.id);const msg=(i.isModalSubmit()&&i.customId?.startsWith('prospect')) ? `Prospect Maker error: ${e.message||'unknown error'}. Your form was reset; click Make Now to start again.` : 'Something went wrong while processing that request.';if(i.isRepliable()&&!i.replied&&!i.deferred)await i.reply({content:msg,ephemeral:true}).catch(()=>{});else if(i.deferred&&!i.replied)await i.editReply(msg).catch(()=>{});}
});

async function sendDevPage(i,sid,update=false){const s=devSessions.get(sid);const ids=Object.keys(devTraits);if(!s||!ids.length)return;const id=ids[s.index];s.ids=ids;s.index=Math.min(s.index,ids.length-1);const d=devTraits[id];const lines=[`**${s.index+1}/${ids.length}**`,`${d.username?`<@${id}>`:`<@${id}>`}`,'',`-Age reset 1: ${d.age1}`,`-Age reset 2: ${d.age2}`,`-Age reset 3: ${d.age3}`,`-X factor: ${d.xfactor}`];if(d.mode==='missed')lines.push(`-Superstar 1: ${d.superstar1}`,`-Superstar 2: ${d.superstar2}`);else lines.push(`-Superstar: ${d.superstar}`);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`devpage:${sid}:prev`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(s.index<=0),new ButtonBuilder().setCustomId(`devpage:${sid}:next`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(s.index>=ids.length-1),new ButtonBuilder().setCustomId(`devpage:${sid}:given`).setLabel('Given').setStyle(ButtonStyle.Success));const payload={content:lines.join('\n'),components:[row],allowedMentions:{users:[id]}};return update?i.update(payload):i.reply({...payload,ephemeral:true});}
function disableGotw(rows,type){return rows.map(row=>{const r=ActionRowBuilder.from(row);return new ActionRowBuilder().addComponents(r.components.map(c=>{const b=ButtonBuilder.from(c);if((type==='winner'&&String(b.data.custom_id||'').startsWith('gotw_winner:'))||(type==='loser'&&String(b.data.custom_id||'').startsWith('gotw_loser:')))b.setDisabled(true);return b;}));});}

client.login(TOKEN).catch(e=>{console.error('Discord login failed. Check DISCORD_TOKEN:',e);process.exitCode=1;});
