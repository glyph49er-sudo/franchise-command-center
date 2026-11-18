
const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require("discord.js");

module.exports = function installTeamClaimer(client, sharedCommands) {
const { TEAMS } = require("./teams");
const EA = require("./ea-connector");

const EA_CONNECTION_PATH = path.join(__dirname, "data", "ea-connection.json");
let eaConnection = null;
try { if (fs.existsSync(EA_CONNECTION_PATH)) eaConnection = JSON.parse(fs.readFileSync(EA_CONNECTION_PATH, "utf8")); }
catch (err) { console.error("Could not read saved EA connection:", err?.message || err); }
const pendingEaAuth = new Map();
function saveEAConnection() {
  fs.mkdirSync(path.dirname(EA_CONNECTION_PATH), { recursive: true });
  if (eaConnection) fs.writeFileSync(EA_CONNECTION_PATH, JSON.stringify(eaConnection, null, 2), { mode: 0o600 });
  else if (fs.existsSync(EA_CONNECTION_PATH)) fs.unlinkSync(EA_CONNECTION_PATH);
}

// Team Claimer progress (roles + claims) lives in data/team_claimer_config.json.
// If an old Team Claimer config.json sits next to the bot, it is imported once.
const CONFIG_PATH = path.join(__dirname, "data", "team_claimer_config.json");
const LEGACY_CONFIG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, fs.existsSync(LEGACY_CONFIG_PATH) ? fs.readFileSync(LEGACY_CONFIG_PATH, "utf8") : JSON.stringify({ roles: {}, claims: {} }, null, 2));
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
if (!config.roles) config.roles = {};
if (!config.claims) config.claims = {};
const WAITLIST_CHANNEL_ID = "1468516639757828156";
const WAITLIST_ROLE_NAME = "waitlist";
const WAITLIST_PING_ROLE_ID = process.env.WAITLIST_PING_ROLE_ID || "1543435132596129882";

// The waitlist role can be configured by ID (WAITLIST_COACH_ROLE_ID, shared with the
// rest of the bot) or found by name. Both historical names are accepted so the merged
// bot and the old Team Claimer agree on which role is "the waitlist".
const WAITLIST_ROLE_NAMES = [WAITLIST_ROLE_NAME, process.env.WAITLIST_COACH_ROLE_NAME || "waitlist coach"].map(n => n.toLowerCase());
function getWaitlistRole(guild) {
  const configuredId = process.env.WAITLIST_COACH_ROLE_ID;
  if (configuredId && guild.roles.cache.has(configuredId)) return guild.roles.cache.get(configuredId);
  return guild.roles.cache.find(r => WAITLIST_ROLE_NAMES.includes(r.name.toLowerCase()));
}

function hasTeamRole(member) {
  return configuredTeamRolesOf(member).size > 0;
}

// roleId -> { channelId, messageId } for every "<team> is open" waitlist ping that
// is still live. Saved in config.json so it survives a restart.
if (!config.announcements) config.announcements = {};
// channelId -> { guildId, messageId } for every live /open-teams board.
if (!config.liveBoards) config.liveBoards = {};

// Deletes the "<team> is open" waitlist ping for a team (if there is one).
// Safe to call any number of times — the record is removed first, so a second
// call is a no-op.
// Deletes every "<team> is open" ping for this team still in the waitlist channel,
// including ones posted before the merge or by the old Team Claimer bot (needs Manage Messages).
async function sweepOpenPings(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return;
  const channel = await guild.channels.fetch(WAITLIST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return;
  const needle = `**${role.name}** is open`.toLowerCase();
  for (const m of recent.values()) {
    if (String(m.content || "").toLowerCase().includes(needle)) await m.delete().catch(err => {
      if (err?.code !== 10008) console.error(`Couldn't delete open ping for ${role.name} (give the bot Manage Messages):`, err?.message || err);
    });
  }
}

async function deleteOpenAnnouncement(guild, roleId) {
  const entry = config.announcements?.[roleId];
  const teamRole = guild.roles.cache.get(roleId);
  if (teamRole && teamRole.members.size > 0) await sweepOpenPings(guild, roleId).catch(() => {});
  if (!entry) return;
  delete config.announcements[roleId];
  saveConfig();
  try {
    const channel = await guild.channels.fetch(entry.channelId).catch(() => null);
    if (channel && channel.isTextBased()) await channel.messages.delete(entry.messageId);
  } catch (err) {
    if (err?.code !== 10008) { // 10008 = message was already deleted
      console.error(`Could not delete the open-team message for ${roleId}:`, err?.message || err);
    }
  }
}

async function announceTeamOpened(guild, role) {
  try {
    if (!role) return;
    const pingRoleId = guild.roles.cache.has(WAITLIST_PING_ROLE_ID) ? WAITLIST_PING_ROLE_ID : getWaitlistRole(guild)?.id;
    if (!pingRoleId) return;

    const channel = await guild.channels.fetch(WAITLIST_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // Never leave two pings up for the same team.
    await deleteOpenAnnouncement(guild, role.id);

    const sent = await channel.send({
      content: `<@&${pingRoleId}> **${role.name}** is open, claim it while you can!!`,
      allowedMentions: { roles: [pingRoleId] }
    });
    config.announcements[role.id] = { channelId: channel.id, messageId: sent.id };
    saveConfig();

    // If somebody grabbed the team while the ping was being sent, take it back down.
    if (role.members.size > 0) await deleteOpenAnnouncement(guild, role.id);
  } catch (err) {
    console.error(`Could not announce ${role?.name || "team"} opening:`, err?.message || err);
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Live /open-teams board. The message posted by /open-teams is remembered and
// edited in place whenever a team is taken or opens up.
// ---------------------------------------------------------------------------
function getTeamStatuses(guild) {
  return TEAMS.map(team => {
    const roleId = Object.keys(config.roles).find(id => config.roles[id]?.label === team.name);
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    return { team, role, taken: Boolean(role && role.members.size > 0) };
  });
}

function buildBoardEmbed(guild) {
  const statuses = getTeamStatuses(guild);
  const lines = statuses.map(({ team, taken }) =>
    `${resolveGuildEmoji(guild, team.emoji)} **${team.name}** — ${taken ? "❌ TAKEN" : "✅ OPEN"}`);
  const openCount = statuses.filter(s => !s.taken).length;
  return new EmbedBuilder()
    .setTitle("NFL Team Availability")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${openCount} open • ${statuses.length - openCount} taken • updates automatically` })
    .setTimestamp();
}

async function refreshLiveBoards(guild) {
  const boards = Object.entries(config.liveBoards).filter(([, b]) => b.guildId === guild.id);
  if (!boards.length) return;
  if (!memberCacheReady && !(await ensureMembers(guild))) return; // can't read holders — don't show wrong data

  const embed = buildBoardEmbed(guild);
  for (const [channelId, board] of boards) {
    try {
      const channel = await guild.channels.fetch(channelId);
      const message = await channel.messages.fetch(board.messageId);
      const current = message.embeds[0];
      if (current && current.description === embed.data.description) continue; // nothing changed
      await message.edit({ embeds: [embed] });
    } catch (err) {
      if (err?.code === 10008 || err?.code === 10003) {
        // The board message or its channel was deleted — stop tracking it.
        delete config.liveBoards[channelId];
        saveConfig();
      } else {
        console.error(`Could not update the open-teams board in ${channelId}:`, err?.message || err);
      }
    }
  }
}

// Changes arrive in bursts (a reset, a move between teams), so wait a moment and
// refresh once. If a refresh is already running, queue exactly one more.
const boardState = new Map(); // guildId -> { timer, running, dirty }
function scheduleBoardRefresh(guild) {
  if (!Object.values(config.liveBoards).some(b => b.guildId === guild.id)) return;
  const state = boardState.get(guild.id) || { timer: null, running: false, dirty: false };
  boardState.set(guild.id, state);
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    if (state.running) { state.dirty = true; return; }
    state.running = true;
    try { await refreshLiveBoards(guild); }
    catch (err) { console.error("Board refresh failed:", err?.message || err); }
    finally {
      state.running = false;
      if (state.dirty) { state.dirty = false; scheduleBoardRefresh(guild); }
    }
  }, 1500);
}

const guildLocks = new Set();

async function withGuildLock(guildId, fn) {
  while (guildLocks.has(guildId)) await new Promise(r => setTimeout(r, 50));
  guildLocks.add(guildId);
  try { return await fn(); } finally { guildLocks.delete(guildId); }
}

let rateLimitUntil = 0;
function rateLimitSecondsLeft() { return Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000)); }
function extractRetryAfterSeconds(err) {
  const message = err?.message || String(err);
  const match = message.match(/[Rr]etry after ([\d.]+)/);
  if (match) return Math.ceil(Number(match[1]));
  if (err?.retryAfter) return Math.ceil(Number(err.retryAfter));
  return null;
}
function registerRateLimit(err) {
  const seconds = extractRetryAfterSeconds(err);
  if (seconds == null) return null;
  const until = Date.now() + seconds * 1000;
  if (until > rateLimitUntil) rateLimitUntil = until;
  return seconds;
}
function rateLimitNotice(prefix) {
  const seconds = rateLimitSecondsLeft();
  return `⏳ ${prefix} Please wait **${seconds} second${seconds === 1 ? "" : "s"}** and then try again.`;
}

function resolveGuildEmoji(guild, name) {
  if (!name) return "🏈";
  const match = String(name).match(/^:([^:]+):$/);
  if (match) {
    const wanted = match[1].toLowerCase();
    const emoji = guild.emojis.cache.find(e => e.name.toLowerCase() === wanted);
    if (emoji) return `<:${emoji.name}:${emoji.id}>`;
    return name;
  }
  return name;
}
function teamButton(guild, roleId, data) {
  return new ButtonBuilder()
    .setCustomId(`claim:${roleId}`)
    .setLabel(data.label || data.roleName || "Claim")
    .setStyle(data.category === "AFC" ? ButtonStyle.Danger : ButtonStyle.Primary)
    .setEmoji(resolveGuildEmoji(guild, data.emoji));
}
function configuredTeamRolesOf(member) {
  return member.roles.cache.filter(r => Boolean(config.roles[r.id]));
}
function cleanUsername(raw) {
  return String(raw || "").replace(/[\[\]]/g, " ").replace(/\s+/g, " ").trim();
}
function describeError(err) {
  const message = err?.message || String(err);
  const retry = message.match(/[Rr]etry after ([\d.]+)/);
  if (retry || /rate limit/i.test(message)) {
    if (retry) {
      const seconds = Math.ceil(Number(retry[1]));
      return `Discord is rate limiting us right now. Please wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`;
    }
    return "Discord is rate limiting us right now. Please wait a few seconds and try again.";
  }
  if (err?.code === 50013) return "I don't have permission to do that — my bot role must be above the team roles (and I need Manage Roles + Manage Nicknames).";
  if (err?.code === 50001) return "I don't have access to do that here.";
  if (err?.code === 10011) return "That team role no longer exists.";
  if (err?.code === 10007) return "I couldn't find you in this server.";
  return message;
}


function teamRoleData(roleId) { return config.roles[roleId] || null; }
function claimedUserId(roleId) { return config.claims?.[roleId] || null; }
function setClaim(roleId, userId) { if (!config.claims) config.claims = {}; config.claims[roleId] = userId; saveConfig(); }
function clearClaim(roleId) { if (config.claims?.[roleId]) { delete config.claims[roleId]; saveConfig(); } }
function getConfiguredTeamRoleIds() { return Object.keys(config.roles).filter(id => config.roles[id]); }
function teamForMemberId(userId) {
  const entry = Object.entries(config.claims || {}).find(([, id]) => id === userId);
  return entry ? entry[0] : null;
}

// ---------------------------------------------------------------------------
// Ownership truth = who actually HOLDS the team role in Discord.
// config.claims is only a cache of that. To read role holders reliably the bot
// needs the guild member list, so we keep it cached and refresh it when needed.
// ---------------------------------------------------------------------------
let memberCacheReady = false;
let memberFetchFailed = false;
let lastMemberFetch = 0;

async function ensureMembers(guild, { force = false } = {}) {
  if (!guild) return false;
  if (!force && memberCacheReady && Date.now() - lastMemberFetch < 60_000) return true;
  try {
    await guild.members.fetch();
    memberCacheReady = true;
    memberFetchFailed = false;
    lastMemberFetch = Date.now();
    return true;
  } catch (err) {
    memberFetchFailed = true;
    console.error("Could not fetch guild members:", err?.message || err);
    return memberCacheReady; // fall back to whatever we already cached
  }
}

// Rebuild config.claims from the real role assignments in the server, so anyone
// who already had a team role (assigned manually or before this bot ran) counts
// as the owner of that team.
async function syncClaimsFromRoles(guild) {
  const ok = await ensureMembers(guild, { force: true });
  if (!ok) return { synced: 0, cleared: 0, ok: false };

  let synced = 0;
  let cleared = 0;
  if (!config.claims) config.claims = {};

  for (const roleId of Object.keys(config.roles)) {
    const role = guild.roles.cache.get(roleId);
    const holder = role ? role.members.first() : null;
    const recorded = config.claims[roleId] || null;

    if (holder) {
      if (recorded !== holder.id) {
        config.claims[roleId] = holder.id;
        synced++;
      }
    } else if (recorded) {
      delete config.claims[roleId];
      cleared++;
    }
  }
  saveConfig();
  if (synced || cleared) {
    console.log(`Claim sync: ${synced} team(s) linked to their current role holder, ${cleared} stale claim(s) cleared.`);
  }
  return { synced, cleared, ok: true };
}

// Returns { holder, holderId, verified }. `verified: false` means the bot could
// not read the member list, so occupancy is unknown and claims must be blocked
// rather than wrongly granted.
async function findRoleHolder(guild, role) {
  const recorded = claimedUserId(role.id);
  if (recorded) {
    const member = await guild.members.fetch(recorded).catch(() => null);
    if (member && member.roles.cache.has(role.id)) {
      return { holder: member, holderId: recorded, verified: true };
    }
    clearClaim(role.id); // stale entry — the member left or lost the role
  }

  const ok = await ensureMembers(guild);
  const cached = role.members.first() || null;
  if (cached) {
    setClaim(role.id, cached.id);
    return { holder: cached, holderId: cached.id, verified: true };
  }
  return { holder: null, holderId: null, verified: ok };
}

const MEMBER_LIST_HELP =
  "⚠️ I can't confirm whether this team is already taken because I can't read this server's member list. " +
  "Ask an admin to enable **Server Members Intent** for the bot in the Discord Developer Portal " +
  "(Bot → Privileged Gateway Intents), then restart the bot.";

// ONE code path for putting a member on a team. /teams assign, /verify-member and the
// EA-verified claim flow (finalizeClaim) all end here, so they always behave identically:
// move them off any other team, give the team role, record the claim, take the "is open"
// ping down, drop the waitlist role, set the "Team [Username]" nickname, refresh live boards.
// Callers hold the guild lock and have already checked who currently owns the role.
async function applyTeamAssignment(guild, member, role, { username, reason }) {
  const clean = cleanUsername(username) || member.user.username;
  const nickname = `${role.name} [${clean}]`;
  if (nickname.length > 32) throw new Error(`**${nickname}** is ${nickname.length} characters — Discord nicknames max out at 32. That username is too long for the Team [Username] format.`);

  const oldTeams = configuredTeamRolesOf(member).filter(r => r.id !== role.id);
  if (oldTeams.size) {
    await member.roles.remove([...oldTeams.keys()], `${reason} (moved teams)`);
    for (const oldRole of oldTeams.values()) clearClaim(oldRole.id);
  }
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, reason);
  setClaim(role.id, member.id);
  await deleteOpenAnnouncement(guild, role.id); // team is taken — pull the waitlist ping down

  let notes = "";
  const waitlistRole = getWaitlistRole(guild);
  if (waitlistRole && member.roles.cache.has(waitlistRole.id)) {
    try { await member.roles.remove(waitlistRole, `Removed from waitlist after claiming ${role.name}`); }
    catch (err) { notes += `\n⚠️ Couldn't remove their **waitlist** role: ${describeError(err)}`; }
  }
  try {
    await member.setNickname(nickname, reason);
  } catch (err) {
    const seconds = registerRateLimit(err);
    notes += seconds != null
      ? `\n⚠️ Discord rate-limited the nickname change. The team role was assigned; set the nickname to \`${nickname}\` after the cooldown.`
      : `\n⚠️ The team role was assigned, but I couldn't change the nickname (${describeError(err)}). Set it to \`${nickname}\` manually.`;
  }
  scheduleBoardRefresh(guild);
  return { nickname, nickNote: notes, oldTeams };
}

async function finalizeClaim(guild, userId, roleId, username) {
  return withGuildLock(guild.id, async () => {
    const role = guild.roles.cache.get(roleId);
    const data = config.roles[roleId];
    if (!role || !data) throw new Error("That team is no longer configured.");

    const botMember = await guild.members.fetchMe();
    if (role.position >= botMember.roles.highest.position) {
      throw new Error("I can't assign this team because my bot role is not above it.");
    }

    const member = await guild.members.fetch(userId);
    const held = configuredTeamRolesOf(member);
    if (held.size) throw new Error(`You have already claimed a team (**${held.first().name}**).`);

    // Ownership check against the REAL role holders in Discord.
    const { holder: currentHolder, verified } = await findRoleHolder(guild, role);
    if (currentHolder) throw new Error(`Sorry — **${role.name}** has already been claimed by **${currentHolder.user.tag}**.`);
    if (!verified) throw new Error(MEMBER_LIST_HELP);


    const { nickname, nickNote } = await applyTeamAssignment(guild, member, role, { username, reason: `Verified NFL team claim by ${member.user.tag}` });
    return { nickname, nickNote };
  });
}

async function resetAllTeams(guild) {
  return withGuildLock(guild.id, async () => {
    const result = {
      membersScanned: 0,
      rolesRemoved: 0,
      nicknamesRemoved: 0,
      claimsCleared: 0,
      failures: []
    };

    const ok = await ensureMembers(guild, { force: true });
    if (!ok) throw new Error(MEMBER_LIST_HELP);

    await guild.roles.fetch();
    const teamRoleIds = getConfiguredTeamRoleIds();
    const teamRoles = teamRoleIds
      .map(id => guild.roles.cache.get(id))
      .filter(Boolean);

    const botMember = await guild.members.fetchMe();
    const teamRoleIdSet = new Set(teamRoleIds);

    for (const member of guild.members.cache.values()) {
      result.membersScanned++;

      // Snapshot the member's current team roles before removing anything.
      const heldTeamRoles = member.roles.cache.filter(role => teamRoleIdSet.has(role.id));

      if (!heldTeamRoles.size) continue;

      // Only remove a nickname when it follows this bot's team nickname format:
      // "Team [EAUsername]". This avoids wiping unrelated custom nicknames.
      const currentNickname = member.nickname;
      const matchingTeamRole = heldTeamRoles.find(role => {
        const escaped = role.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return currentNickname && new RegExp(`^${escaped} \\[[^\\]]*\\]$`, "i").test(currentNickname);
      });

      if (matchingTeamRole && currentNickname) {
        try {
          await member.setNickname(null, "FDL league reset: removed team nickname");
          result.nicknamesRemoved++;
        } catch (err) {
          result.failures.push(`${member.user.tag}: couldn't remove nickname (${describeError(err)})`);
        }
      }

      for (const role of heldTeamRoles.values()) {
        if (role.position >= botMember.roles.highest.position) {
          result.failures.push(`${role.name}: bot role is not high enough to remove it`);
          continue;
        }

        try {
          await member.roles.remove(role, "FDL league reset: cleared team assignment");
          result.rolesRemoved++;
        } catch (err) {
          result.failures.push(`${member.user.tag} / ${role.name}: ${describeError(err)}`);
        }
      }
    }

    // Remove every stored ownership record only for roles that no longer have
    // a member holding them. This keeps failed role removals from becoming
    // falsely available.
    for (const roleId of teamRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role || role.members.size === 0) {
        if (config.claims?.[roleId]) {
          delete config.claims[roleId];
          result.claimsCleared++;
        }
      }
    }

    saveConfig();

    return result;
  });
}

let eaSyncPromise = null;
async function refreshEAConnection(reason = "manual") {
  if (!eaConnection?.refreshToken || !eaConnection?.leagueId) throw new Error("FDL is not connected to an EA franchise yet. Run /ea-connect first.");
  if (eaSyncPromise) return eaSyncPromise;
  eaSyncPromise = (async () => {
    try {
      const result = await EA.syncLeague(eaConnection);
      eaConnection.lastSyncReason = reason;
      saveEAConnection();
      return result;
    } catch (err) {
      eaConnection.lastSyncError = err?.message || String(err);
      saveEAConnection();
      throw err;
    } finally {
      eaSyncPromise = null;
    }
  })();
  return eaSyncPromise;
}

const commands = [
  new SlashCommandBuilder()
    .setName("ea-connect")
    .setDescription("Admin: connect FDL directly to the Madden 27 PC franchise through EA.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("ea-status")
    .setDescription("Admin: show the Madden EA connection and last roster sync.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("ea-refresh")
    .setDescription("Admin: immediately refresh the Madden franchise ownership data.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("ea-disconnect")
    .setDescription("Admin: remove FDL's saved EA connection.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("setup-nfl-teams")
    .setDescription("Create/link all 32 NFL team roles, grouped into AFC and NFC.")
    .addBooleanOption(o => o.setName("create-missing").setDescription("Create any team role that doesn't exist yet (default: true)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("create-team-panels")
    .setDescription("Post the AFC and NFC team claim panels in this channel.")
    .addStringOption(o => o.setName("conference").setDescription("Post only one conference").addChoices({ name: "AFC", value: "AFC" }, { name: "NFC", value: "NFC" }).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("release-team")
    .setDescription("Free up a team so somebody else can claim it.")
    .addRoleOption(o => o.setName("role").setDescription("The team role to release").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("release-member")
    .setDescription("Remove a member's claimed team so they can pick again.")
    .addUserOption(o => o.setName("member").setDescription("The member to reset").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("team-status")
    .setDescription("Show who owns a team, or list every claimed team.")
    .addRoleOption(o => o.setName("role").setDescription("A single team role (optional)").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("verify-member")
    .setDescription("Admin: verify a member and give them their team — no screenshot needed.")
    .addUserOption(o => o.setName("member").setDescription("Their Discord username").setRequired(true))
    .addStringOption(o => o.setName("ea-username").setDescription("Their EA username (goes in the [ ] of their nickname)").setRequired(true).setMaxLength(24))
    .addRoleOption(o => o.setName("team").setDescription("The NFL team they joined").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("open-teams").setDescription("Post all 32 NFL teams with their current OPEN/TAKEN status."),
  new SlashCommandBuilder().setName("team-list").setDescription("Post all 32 NFL teams with their current OPEN/TAKEN status."),
  new SlashCommandBuilder().setName("post-open-teams").setDescription("Post only the comma-separated list of open teams."),
  new SlashCommandBuilder().setName("sync-teams").setDescription("Re-scan the server so whoever holds each team role owns that team.").setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName("waitlist-button")
    .setDescription("Admin: post the Join the waitlist button.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("waitlist-user")
    .setDescription("Admin: add a member to the waitlist.")
    .addUserOption(o => o.setName("member").setDescription("The member to add to the waitlist").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("waitlist-checker")
    .setDescription("Admin: list everyone currently on the waitlist.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("reset-all").setDescription("Admin: completely reset the FDL team league so every team is available again.").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("my-team").setDescription("Show which team you have claimed."),
  // ---- Snallabot-style command groups (see SNALLABOT_LICENSE.md), backed by FDL's team roles ----
  new SlashCommandBuilder().setName("teams").setDescription("Assign or free teams, post the teams board, or reset every team.")
    .addSubcommand(sc => sc.setName("assign").setDescription("Assign a Discord user to the specified team")
      .addRoleOption(o => o.setName("team").setDescription("The NFL team role").setRequired(true))
      .addUserOption(o => o.setName("user").setDescription("The member to assign to this team").setRequired(true)))
    .addSubcommand(sc => sc.setName("free").setDescription("Remove the user assigned to this team, making the team open")
      .addRoleOption(o => o.setName("team").setDescription("The NFL team role").setRequired(true)))
    .addSubcommand(sc => sc.setName("configure").setDescription("Post the live teams board in a channel (updates automatically)")
      .addChannelOption(o => o.setName("channel").setDescription("Channel for the board (default: here)")))
    .addSubcommand(sc => sc.setName("reset").setDescription("Reset all team assignments, making every team open (Administrator)"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName("waitlist").setDescription("Handle the league waitlist: list, add, remove, pop")
    .addSubcommand(sc => sc.setName("list").setDescription("List the users currently on the waitlist"))
    .addSubcommand(sc => sc.setName("add").setDescription("Add a user to the waitlist")
      .addUserOption(o => o.setName("user").setDescription("User to add").setRequired(true))
      .addIntegerOption(o => o.setName("position").setDescription("Position in line (default: end)").setMinValue(1)))
    .addSubcommand(sc => sc.setName("remove").setDescription("Remove a user from the waitlist")
      .addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)))
    .addSubcommand(sc => sc.setName("pop").setDescription("Remove a user by position (default: first in line)")
      .addIntegerOption(o => o.setName("position").setDescription("Position to remove").setMinValue(1)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
];
const CLAIMER_COMMANDS = new Set(commands.map(c => c.name));
sharedCommands.push(...commands);


// ---------------------------------------------------------------------------
// Auto-verify: a claim stays "pending" after the member submits their EA username. The bot keeps
// reading Madden, and the moment that username owns the team in the franchise it assigns the team
// (same applyTeamAssignment path as /teams assign) - no need to press "Joined".
// Per team the LAST person to start a claim is the pending one (they're the one joining right now).
// ---------------------------------------------------------------------------
const pendingClaims = new Map(); // roleId -> { userId, username, interaction, guildId, createdAt }
const CLAIM_WATCH_MS = 45 * 1000, CLAIM_PENDING_TTL = 60 * 60 * 1000;
let claimWatchBusy = false;

function registerPendingClaim(roleId, userId, username, interaction) {
  const prior = pendingClaims.get(roleId);
  if (prior && prior.userId !== userId) {
    prior.interaction?.editReply({ content: `ℹ️ Someone else started claiming this team after you, so I'm now watching for them instead. Start again if this was you.`, embeds: [], components: [] }).catch(() => {});
  }
  pendingClaims.set(roleId, { userId, username, interaction, guildId: interaction.guildId, createdAt: Date.now() });
}
async function tellClaimant(pending, guild, payload) {
  try { await pending.interaction.editReply(payload); return; } catch { /* ephemeral token expired */ }
  try {
    const user = await client.users.fetch(pending.userId);
    await user.send({ content: payload.content || undefined, embeds: payload.embeds || [] });
  } catch { /* DMs closed - the nickname/role change is still visible in the server */ }
}
async function claimWatchTick() {
  if (claimWatchBusy || !pendingClaims.size) return;
  if (!eaConnection?.refreshToken || !eaConnection?.leagueId) return;
  claimWatchBusy = true;
  try {
    for (const [roleId, p] of [...pendingClaims]) if (Date.now() - p.createdAt > CLAIM_PENDING_TTL) pendingClaims.delete(roleId);
    if (!pendingClaims.size) return;
    await refreshEAConnection("claim-watch");
    for (const [roleId, p] of [...pendingClaims]) {
      const guild = client.guilds.cache.get(p.guildId);
      const role = guild?.roles.cache.get(roleId);
      if (!guild || !role || !config.roles[roleId]) { pendingClaims.delete(roleId); continue; }
      const ownership = EA.findTeamOwner(eaConnection.teams, role.name, p.username);
      if (!ownership.ok) continue; // not in the league on that team yet - keep watching
      try {
        const done = await finalizeClaim(guild, p.userId, roleId, p.username);
        pendingClaims.delete(roleId);
        await tellClaimant(p, guild, { content: "", components: [], embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ Welcome to the ${role.name}!`)
          .setDescription(`Madden shows **${p.username}** on the **${role.name}** in **${eaConnection.leagueName || "the franchise"}**, so I verified you automatically.\n\nNickname: **${done.nickname}**${done.nickNote}`)] });
        console.log(`[claim-watch] auto-verified ${p.userId} on ${role.name}`);
      } catch (err) {
        // Someone else got the team / they already hold one / bot can't assign: stop watching and say why.
        pendingClaims.delete(roleId);
        await tellClaimant(p, guild, { content: `❌ I saw you join, but couldn't assign **${role.name}**: ${describeError(err)}`, embeds: [], components: [] });
      }
    }
  } catch (err) {
    console.error("[claim-watch]", err?.message || err);
  } finally {
    claimWatchBusy = false;
  }
}

client.once("ready", async () => {
  const claimWatchTimer = setInterval(claimWatchTick, CLAIM_WATCH_MS);
  claimWatchTimer.unref?.();


  // EA franchise ownership is refreshed on startup and every 10 minutes.
  if (eaConnection?.refreshToken && eaConnection?.leagueId) {
    refreshEAConnection("startup").catch(err => console.error("Initial EA roster sync failed:", err?.message || err));
  }
  const eaSyncTimer = setInterval(() => {
    if (eaConnection?.refreshToken && eaConnection?.leagueId) {
      refreshEAConnection("scheduled").catch(err => console.error("Scheduled EA roster sync failed:", err?.message || err));
    }
  }, 10 * 60 * 1000);
  eaSyncTimer.unref?.();

  // On startup: anyone who already holds a team role is recorded as that team's owner.
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
    if (guild) {
      const result = await syncClaimsFromRoles(guild);
      if (!result.ok) console.error(MEMBER_LIST_HELP);
      else {
        console.log("Startup claim sync complete — existing team-role holders now own their teams.");
        // Catch up on anything that changed while the bot was offline: take down
        // "is open" pings for teams that got claimed, and refresh the live boards.
        for (const roleId of Object.keys(config.announcements)) {
          const role = guild.roles.cache.get(roleId);
          if (!role || role.members.size > 0) await deleteOpenAnnouncement(guild, roleId);
        }
        scheduleBoardRefresh(guild);
      }
    }
  } catch (err) {
    console.error("Startup claim sync failed:", err?.message || err);
  }
});

// Keep ownership in sync live: role added/removed, or member leaves.
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  let changed = false;
  for (const roleId of Object.keys(config.roles)) {
    const had = oldMember.roles.cache.has(roleId);
    const has = newMember.roles.cache.has(roleId);
    const role = newMember.guild.roles.cache.get(roleId);

    if (!had && has) {
      changed = true;
      setClaim(roleId, newMember.id);
      // Team was just taken — delete its "is open" waitlist ping right away.
      await deleteOpenAnnouncement(newMember.guild, roleId);
    } else if (had && !has) {
      changed = true;
      if (claimedUserId(roleId) === newMember.id) clearClaim(roleId);
      // Any removal of a configured team role means that team is open again.
      await announceTeamOpened(newMember.guild, role);
    }
  }
  if (changed) scheduleBoardRefresh(newMember.guild);
});

client.on("guildMemberRemove", async member => {
  let changed = false;
  for (const roleId of Object.keys(config.roles)) {
    const role = member.guild.roles.cache.get(roleId);
    const wasHolder = member.roles.cache.has(roleId) || claimedUserId(roleId) === member.id;

    if (wasHolder) {
      changed = true;
      if (claimedUserId(roleId) === member.id) clearClaim(roleId);
      await announceTeamOpened(member.guild, role);
    }
  }
  if (changed) scheduleBoardRefresh(member.guild);
});


client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild() || !CLAIMER_COMMANDS.has(interaction.commandName)) return;

      if (interaction.commandName === "ea-connect") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Only server administrators can connect the franchise EA account.", ephemeral: true });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ea:begin:${interaction.user.id}`).setLabel("I've logged into EA").setStyle(ButtonStyle.Success)
        );
        return interaction.reply({
          content: `**Connect FDL to Madden NFL 27 (PC)**\n\n1. Open this EA login link in your browser: <${EA.EA_LOGIN_URL}>\n2. Sign into the EA account linked to the PC copy of Madden.\n3. EA will redirect to a local address that may show a connection error. That's expected. Copy the **entire URL from your browser address bar** (it contains the one-time code).\n4. Click the button below and paste that URL.\n\nFDL stores the EA session tokens locally for automatic roster checks. Do not send your EA password or any token to Discord or to anyone.`,
          components: [row], ephemeral: true
        });
      }

      if (interaction.commandName === "ea-status") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Only administrators can view the EA connection status.", ephemeral: true });
        if (!eaConnection?.leagueId) return interaction.reply({ content: "❌ FDL is not connected to an EA franchise. Run `/ea-connect`.", ephemeral: true });
        const synced = eaConnection.lastSync ? `<t:${Math.floor(eaConnection.lastSync / 1000)}:R>` : "Not synced yet";
        const owners = Number(eaConnection.lastSyncOwners || 0);
        return interaction.reply({ content: `**FDL EA connection**\n• Platform: Madden NFL 27 PC\n• Franchise: **${eaConnection.leagueName || eaConnection.leagueId}**\n• Roster sync: ${synced}\n• Teams with an EA owner username: **${owners}/32**\n• Automatic refresh: every 10 minutes\n${eaConnection.lastSyncError ? `\n⚠️ Last sync error: ${eaConnection.lastSyncError}` : ""}`, ephemeral: true });
      }

      if (interaction.commandName === "ea-refresh") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Only administrators can refresh the EA connection.", ephemeral: true });
        if (!eaConnection?.leagueId) return interaction.reply({ content: "❌ FDL is not connected. Run `/ea-connect` first.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await refreshEAConnection("manual");
          return interaction.editReply(`✅ EA franchise data refreshed. **${result.teams.length} teams** checked; **${result.leagueOwners}** have an assigned EA username.`);
        } catch (err) {
          eaConnection.lastSyncError = err?.message || String(err); saveEAConnection();
          return interaction.editReply(`❌ EA refresh failed: ${err?.message || err}\n\nIf the EA session expired, run \`/ea-connect\` again.`);
        }
      }

      if (interaction.commandName === "ea-disconnect") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "Only administrators can disconnect the EA account.", ephemeral: true });
        eaConnection = null; saveEAConnection(); pendingEaAuth.delete(interaction.user.id);
        return interaction.reply({ content: "FDL's saved EA connection has been removed.", ephemeral: true });
      }

      if (interaction.commandName === "verify-member") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only administrators can use **/verify-member**.", ephemeral: true });
        const targetUser = interaction.options.getUser("member");
        const teamRole = interaction.options.getRole("team");
        const eaUsername = cleanUsername(interaction.options.getString("ea-username"));
        if (!config.roles[teamRole.id]) return interaction.reply({ content: "❌ That role isn't configured as an NFL team.", ephemeral: true });
        if (!eaUsername) return interaction.reply({ content: "❌ The EA username can't be empty.", ephemeral: true });
        const nickname = `${teamRole.name} [${eaUsername}]`;
        if (nickname.length > 32) return interaction.reply({ content: `❌ **${nickname}** is ${nickname.length} characters — Discord nicknames max out at 32. That EA username is too long for the Team [Username] format.`, ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        try {
          return await withGuildLock(interaction.guildId, async () => {
            const member = await interaction.guild.members.fetch(targetUser.id);
            const botMember = await interaction.guild.members.fetchMe();
            if (teamRole.position >= botMember.roles.highest.position) {
              return interaction.editReply({ content: `❌ I can't assign **${teamRole.name}** because my bot role isn't above it.` });
            }

            const { holder, verified } = await findRoleHolder(interaction.guild, teamRole);
            if (holder && holder.id !== targetUser.id) {
              return interaction.editReply({ content: `❌ **${teamRole.name}** is already claimed by **${holder.user.tag}**. Use **/release-team** first if you want to move it.` });
            }
            if (!holder && !verified) return interaction.editReply({ content: MEMBER_LIST_HELP });

            const { nickNote, oldTeams } = await applyTeamAssignment(interaction.guild, member, teamRole, { username: eaUsername, reason: `Admin verification by ${interaction.user.tag}` });
            const notes = nickNote;

            const moved = oldTeams.size ? `\n**Moved off:** ${oldTeams.map(r => r.name).join(", ")}` : "";
            return interaction.editReply({ content: `✅ **Admin verification complete.**\n\n**Member:** ${targetUser}\n**Team:** ${teamRole.name}\n**EA Username:** ${eaUsername}\n**Nickname:** ${nickname}${moved}${notes}` });
          });
        } catch (err) {
          console.error("Admin verification error:", err);
          return interaction.editReply({ content: `❌ Admin verification failed: ${describeError(err)}` });
        }
      }

      if (interaction.commandName === "open-teams" || interaction.commandName === "team-list" || interaction.commandName === "post-open-teams") {
        await interaction.deferReply({ ephemeral: true });
        const ok = await ensureMembers(interaction.guild, { force: true });
        if (!ok) return interaction.editReply({ content: MEMBER_LIST_HELP });

        if (interaction.commandName === "post-open-teams") {
          const open = getTeamStatuses(interaction.guild).filter(s => !s.taken).map(s => s.team.name);
          await interaction.channel.send({ content: `OPEN TEAMS: ${open.join(", ") || "NONE"}` });
          return interaction.editReply({ content: "Posted." });
        }

        const posted = await interaction.channel.send({ embeds: [buildBoardEmbed(interaction.guild)] });

        if (interaction.commandName === "open-teams") {
          // This board is now live. One live board per channel: running the command
          // again in the same channel replaces the old one.
          const previous = config.liveBoards[interaction.channelId];
          if (previous) await interaction.channel.messages.delete(previous.messageId).catch(() => {});
          config.liveBoards[interaction.channelId] = { guildId: interaction.guildId, messageId: posted.id };
          saveConfig();
        }
        return interaction.editReply({ content: interaction.commandName === "open-teams" ? "Posted — this list now updates automatically." : "Posted." });
      }

      if (interaction.commandName === "my-team") {
        const held = configuredTeamRolesOf(interaction.member);
        const team = held.first();
        return interaction.reply({ content: team ? `You have claimed **${team.name}**.` : "You haven't claimed a team yet.", ephemeral: true });
      }

      if (["waitlist-button", "waitlist-user", "waitlist-checker"].includes(interaction.commandName)) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Only administrators can use waitlist commands.", ephemeral: true });
        }

        const waitlistRole = getWaitlistRole(interaction.guild);
        if (!waitlistRole) {
          return interaction.reply({ content: `❌ I couldn't find a role named **${WAITLIST_ROLE_NAME}**. Create the **waitlist** role first.`, ephemeral: true });
        }

        if (interaction.commandName === "waitlist-button") {
          const button = new ButtonBuilder()
            .setCustomId("waitlist:join")
            .setLabel("join the waitlist!")
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(button);
          await interaction.channel.send({
            content: "Need a team? Click the button below to join the waitlist!",
            components: [row]
          });
          return interaction.reply({ content: "✅ Waitlist button posted.", ephemeral: true });
        }

        if (interaction.commandName === "waitlist-user") {
          const user = interaction.options.getUser("member");
          const member = await interaction.guild.members.fetch(user.id);

          if (hasTeamRole(member)) {
            const team = configuredTeamRolesOf(member).first();
            return interaction.reply({ content: `❌ ${user} already has the **${team.name}** team role, so they cannot be added to the waitlist.`, ephemeral: true });
          }

          if (member.roles.cache.has(waitlistRole.id)) {
            return interaction.reply({ content: `ℹ️ ${user} is already on the waitlist.`, ephemeral: true });
          }

          await member.roles.add(waitlistRole, `Added to waitlist by ${interaction.user.tag}`);
          return interaction.reply({ content: `✅ Added ${user} to the waitlist.`, ephemeral: true });
        }

        if (interaction.commandName === "waitlist-checker") {
          await interaction.deferReply({ ephemeral: true });
          const ok = await ensureMembers(interaction.guild, { force: true });
          if (!ok) return interaction.editReply({ content: MEMBER_LIST_HELP });

          const members = interaction.guild.members.cache
            .filter(member => member.roles.cache.has(waitlistRole.id))
            .sort((a, b) => a.user.username.localeCompare(b.user.username));

          if (!members.size) return interaction.editReply({ content: "📋 **Waitlist**\n\nNobody is currently on the waitlist." });

          const lines = [...members.values()].map((member, i) => `${i + 1}. ${member}`);
          const chunks = [];
          let chunk = "📋 **Waitlist**\n\n";
          for (const line of lines) {
            if ((chunk + line + "\n").length > 1900) {
              chunks.push(chunk);
              chunk = "";
            }
            chunk += line + "\n";
          }
          if (chunk) chunks.push(chunk);

          await interaction.editReply({ content: chunks.shift() });
          for (const extra of chunks) await interaction.followUp({ content: extra, ephemeral: true });
          return;
        }
      }

      if (interaction.commandName === "reset-all") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Only administrators can use **/reset-all**.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const result = await resetAllTeams(interaction.guild);
          let message =
            `✅ **FDL league reset complete.**\n\n` +
            `• Members scanned: **${result.membersScanned}**\n` +
            `• Team roles removed: **${result.rolesRemoved}**\n` +
            `• Team nicknames removed: **${result.nicknamesRemoved}**\n` +
            `• Team claims cleared: **${result.claimsCleared}**\n` +
            `• All in-progress claims/verification requests were cleared.\n\n` +
            `Every successfully cleared team is available to claim again.`;

          if (result.failures.length) {
            message += `\n\n⚠️ **${result.failures.length} item${result.failures.length === 1 ? "" : "s"} could not be fully reset:**\n- ${result.failures.slice(0, 15).join("\n- ")}`;
            if (result.failures.length > 15) message += `\n- ...and ${result.failures.length - 15} more.`;
          }

          return interaction.editReply({ content: message });
        } catch (err) {
          console.error("Reset-all error:", err);
          return interaction.editReply({ content: `❌ **Reset failed:** ${describeError(err)}` });
        }
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) && !["open-teams", "post-open-teams"].includes(interaction.commandName)) {
        return interaction.reply({ content: "You need **Manage Roles** to use this command.", ephemeral: true });
      }

      if (interaction.commandName === "teams") {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        if (sub === "reset") {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.editReply("❌ Only administrators can reset every team.");
          const r = await resetAllTeams(guild);
          return interaction.editReply(`✅ All teams reset: **${r.rolesRemoved}** team role${r.rolesRemoved === 1 ? "" : "s"} removed, **${r.claimsCleared}** claim${r.claimsCleared === 1 ? "" : "s"} cleared.${r.failures.length ? `\n⚠️ ${r.failures.length} item(s) could not be fully reset.` : ""}`);
        }
        if (sub === "configure") {
          if (!(await ensureMembers(guild, { force: true }))) return interaction.editReply(MEMBER_LIST_HELP);
          const channel = interaction.options.getChannel("channel") || interaction.channel;
          const target = await guild.channels.fetch(channel.id);
          const previous = config.liveBoards[target.id];
          if (previous) await target.messages.delete(previous.messageId).catch(() => {});
          const posted = await target.send({ embeds: [buildBoardEmbed(guild)] });
          config.liveBoards[target.id] = { guildId: guild.id, messageId: posted.id };
          saveConfig();
          return interaction.editReply(`✅ The teams board is posted in <#${target.id}> and updates automatically.`);
        }
        const role = interaction.options.getRole("team", true);
        if (!config.roles[role.id]) return interaction.editReply("That role isn't configured as an NFL team role (run `/setup-nfl-teams` first).");
        if (!(await ensureMembers(guild, { force: true }))) return interaction.editReply(MEMBER_LIST_HELP);
        if (sub === "free") {
          return withGuildLock(guild.id, async () => {
            const { holder } = await findRoleHolder(guild, role);
            if (!holder) { clearClaim(role.id); return interaction.editReply(`**${role.name}** is already open.`); }
            await holder.roles.remove(role, `Freed by ${interaction.user.tag}`);
            clearClaim(role.id);
            await deleteOpenAnnouncement(guild, role.id);
            scheduleBoardRefresh(guild);
            return interaction.editReply(`✅ **${role.name}** is now open (was ${holder}).`);
          });
        }
        if (sub === "assign") {
          const user = interaction.options.getUser("user", true);
          return withGuildLock(guild.id, async () => {
            const { holder } = await findRoleHolder(guild, role);
            if (holder && holder.id !== user.id) return interaction.editReply(`❌ **${role.name}** is already assigned to ${holder}. Run \`/teams free\` on it first.`);
            const member = await guild.members.fetch(user.id);
            const botMember = await guild.members.fetchMe();
            if (role.position >= botMember.roles.highest.position) return interaction.editReply(`❌ I can't assign **${role.name}** because my bot role isn't above it.`);
            const current = (member.nickname || "").match(/\[(.+)\]\s*$/)?.[1];
            const { nickNote, oldTeams: old } = await applyTeamAssignment(guild, member, role, { username: current || user.username, reason: `Assigned by ${interaction.user.tag}` });
            const note = nickNote;
            return interaction.editReply(`✅ ${user} is now the coach of **${role.name}**.${old.size ? ` (moved off ${old.map(r => r.name).join(", ")})` : ""}${note}`);
          });
        }
      }

      if (interaction.commandName === "waitlist") {
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild, wl = getWaitlistRole(guild);
        if (!wl) return interaction.editReply("I couldn't find the **waitlist** role. Create it, or set `WAITLIST_COACH_ROLE_ID` in `.env`.");
        if (!(await ensureMembers(guild, { force: true }))) return interaction.editReply(MEMBER_LIST_HELP);
        const holders = guild.members.cache.filter(m => m.roles.cache.has(wl.id));
        const orderPath = path.join(__dirname, "data", "waitlist_order.json");
        let order = [];
        try { order = JSON.parse(fs.readFileSync(orderPath, "utf8")); } catch {}
        const queue = () => [...order.filter(id => holders.has(id)), ...[...holders.values()].filter(m => !order.includes(m.id)).sort((a, b) => a.user.username.localeCompare(b.user.username)).map(m => m.id)];
        const save = q => { order = q; fs.mkdirSync(path.dirname(orderPath), { recursive: true }); fs.writeFileSync(orderPath, JSON.stringify(q)); };
        const show = q => (q.length ? q.map((id, n) => `**${n + 1}.** <@${id}>`).join("\n") : "Nobody is on the waitlist.");
        let q = queue();
        if (sub === "list") return interaction.editReply({ content: `📋 **Waitlist** (${q.length})\n${show(q)}`, allowedMentions: { parse: [] } });
        if (sub === "add") {
          const user = interaction.options.getUser("user", true);
          const member = await guild.members.fetch(user.id);
          if (hasTeamRole(member)) return interaction.editReply(`❌ ${user} already has a team.`);
          if (!member.roles.cache.has(wl.id)) await member.roles.add(wl, `Waitlisted by ${interaction.user.tag}`);
          q = q.filter(id => id !== user.id);
          const pos = Math.min(interaction.options.getInteger("position") || q.length + 1, q.length + 1);
          q.splice(pos - 1, 0, user.id); save(q);
          return interaction.editReply({ content: `✅ Added ${user} at position **${pos}**.\n${show(q)}`, allowedMentions: { parse: [] } });
        }
        if (sub === "remove") {
          const user = interaction.options.getUser("user", true);
          const member = await guild.members.fetch(user.id);
          if (!member.roles.cache.has(wl.id)) return interaction.editReply(`${user} isn't on the waitlist.`);
          await member.roles.remove(wl, `Removed by ${interaction.user.tag}`);
          q = q.filter(id => id !== user.id); save(q);
          return interaction.editReply({ content: `✅ Removed ${user}.\n${show(q)}`, allowedMentions: { parse: [] } });
        }
        if (sub === "pop") {
          const pos = interaction.options.getInteger("position") || 1;
          if (pos > q.length) return interaction.editReply(q.length ? `There are only ${q.length} people on the waitlist.` : "Nobody is on the waitlist.");
          const id = q[pos - 1];
          await (await guild.members.fetch(id)).roles.remove(wl, `Popped by ${interaction.user.tag}`);
          q = q.filter(x => x !== id); save(q);
          return interaction.editReply({ content: `✅ Popped <@${id}> (position ${pos}).\n${show(q)}`, allowedMentions: { parse: [] } });
        }
      }

      if (interaction.commandName === "setup-nfl-teams") {
        await interaction.deferReply({ ephemeral: true });
        const createMissing = interaction.options.getBoolean("create-missing") ?? true;
        const botMember = await interaction.guild.members.fetchMe();
        await interaction.guild.roles.fetch();
        const created = [], linked = [], problems = [];
        for (const team of TEAMS) {
          let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === team.name.toLowerCase());
          if (!role) {
            if (!createMissing) { problems.push(`${team.name} — role not found`); continue; }
            try {
              role = await interaction.guild.roles.create({ name: team.name, mentionable: true, reason: `NFL team role created by ${interaction.user.tag}` });
              created.push(team.name);
            } catch (err) { problems.push(`${team.name} — could not create role`); continue; }
          } else linked.push(team.name);
          if (role.managed || role.position >= botMember.roles.highest.position) problems.push(`${team.name} — move my bot role above it in Server Settings → Roles`);
          config.roles[role.id] = { label: team.name, emoji: team.emoji, roleName: team.name, category: team.conference };
        }
        for (const roleId of Object.keys(config.roles)) if (!interaction.guild.roles.cache.has(roleId)) delete config.roles[roleId];
        saveConfig();
        let msg = `Set up **${Object.keys(config.roles).length}** NFL team roles (AFC + NFC).\n• Created: **${created.length}**\n• Linked to existing roles: **${linked.length}**`;
        if (problems.length) msg += `\n\n⚠️ Needs attention:\n- ${problems.slice(0, 15).join("\n- ")}`;
        msg += `\n\nTo enable automatic Madden ownership checks, an administrator must first run \`/ea-connect\`. Members can then click a team and enter their exact EA username; FDL checks the live franchise owner data before assigning roles.`;
        return interaction.editReply({ content: msg });
      }

      if (interaction.commandName === "create-team-panels") {
        const only = interaction.options.getString("conference");
        const conferences = only ? [only] : ["AFC", "NFC"];
        if (!Object.keys(config.roles).length) return interaction.reply({ content: "No team roles configured yet. Run `/setup-nfl-teams` first.", ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        let posted = 0;
        for (const conference of conferences) {
          const entries = Object.entries(config.roles).filter(([, d]) => d.category === conference).sort((a, b) => a[1].label.localeCompare(b[1].label));
          for (let start = 0; start < entries.length; start += 25) {
            const chunk = entries.slice(start, start + 25), rows = [];
            for (let i = 0; i < chunk.length; i += 5) {
              const row = new ActionRowBuilder();
              for (const [roleId, data] of chunk.slice(i, i + 5)) row.addComponents(teamButton(interaction.guild, roleId, data));
              rows.push(row);
            }
            const part = entries.length > 25 ? ` (${Math.floor(start / 25) + 1}/${Math.ceil(entries.length / 25)})` : "";
            const embed = new EmbedBuilder().setTitle(`${conference} Teams${part}`).setDescription("Click a button to start your claim.\n\n**Each team can only be claimed by ONE member.**\n**Each member can only claim ONE team.**\n\n🎮 After entering your EA username you'll see the league info. Join the franchise in Madden **first**, then press **Joined** — the bot checks EA live before giving you the role.");
            await interaction.channel.send({ embeds: [embed], components: rows });
            posted++;
          }
        }
        return interaction.editReply({ content: `Posted **${posted}** panel message${posted === 1 ? "" : "s"}.` });
      }

      if (interaction.commandName === "sync-teams") {
        await interaction.deferReply({ ephemeral: true });
        const result = await syncClaimsFromRoles(interaction.guild);
        if (!result.ok) return interaction.editReply({ content: MEMBER_LIST_HELP });
        const takenCount = Object.keys(config.claims || {}).length;
        return interaction.editReply({
          content: `✅ Synced with the server. **${takenCount}** team${takenCount === 1 ? " is" : "s are"} currently taken (${result.synced} newly linked, ${result.cleared} stale claim${result.cleared === 1 ? "" : "s"} cleared).`
        });
      }

      if (interaction.commandName === "release-team") {
        const role = interaction.options.getRole("role");
        if (!config.roles[role.id]) return interaction.reply({ content: "That role isn't configured as an NFL team role.", ephemeral: true });
        return withGuildLock(interaction.guildId, async () => {
          const { holder } = await findRoleHolder(interaction.guild, role);
          if (!holder) { clearClaim(role.id); return interaction.reply({ content: `**${role.name}** is already available.`, ephemeral: true }); }
          await holder.roles.remove(role, `Released by ${interaction.user.tag}`);
          clearClaim(role.id);
          return interaction.reply({ content: `Released **${role.name}** from **${holder.user.tag}**. It can be claimed again.`, ephemeral: true });
        });
      }

      if (interaction.commandName === "release-member") {
        const user = interaction.options.getUser("member");
        return withGuildLock(interaction.guildId, async () => {
          const member = await interaction.guild.members.fetch(user.id);
          const held = configuredTeamRolesOf(member);
          if (!held.size) return interaction.reply({ content: `**${user.tag}** hasn't claimed a team.`, ephemeral: true });
          await member.roles.remove([...held.keys()], `Team reset by ${interaction.user.tag}`);
          for (const teamRole of held.values()) clearClaim(teamRole.id);
          return interaction.reply({ content: `Removed **${held.map(r => r.name).join(", ")}** from **${user.tag}**. They can claim again.`, ephemeral: true });
        });
      }

      if (interaction.commandName === "team-status") {
        const role = interaction.options.getRole("role");
        if (role) {
          if (!config.roles[role.id]) return interaction.reply({ content: "That role isn't configured as an NFL team role.", ephemeral: true });
          const { holder } = await findRoleHolder(interaction.guild, role);
          return interaction.reply({ content: holder ? `**${role.name}** is held by **${holder.user.tag}**.` : `**${role.name}** is **available**.`, ephemeral: true });
        }
        const lines = { AFC: [], NFC: [] };
        await ensureMembers(interaction.guild, { force: true });
        for (const [roleId, data] of Object.entries(config.roles)) {
          const teamRole = interaction.guild.roles.cache.get(roleId); if (!teamRole) continue;
          const { holder } = await findRoleHolder(interaction.guild, teamRole);

          lines[data.category === "AFC" ? "AFC" : "NFC"].push(`${resolveGuildEmoji(interaction.guild, data.emoji)} **${data.label}** — ${holder ? holder.user.tag : "available"}`);
        }
        const embed = new EmbedBuilder().setTitle("NFL Team Claims").addFields({ name: "AFC", value: lines.AFC.sort().join("\n") || "None", inline: true }, { name: "NFC", value: lines.NFC.sort().join("\n") || "None", inline: true });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("ea:begin:")) {
      const ownerId = interaction.customId.split(":")[2];
      if (interaction.user.id !== ownerId) return interaction.reply({ content: "Only the administrator who started this EA connection can continue it.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`eaCode:${ownerId}`).setTitle("Paste the EA redirect URL").addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("redirectUrl").setLabel("Full URL from your browser address bar").setPlaceholder("http://127.0.0.1/success?code=...").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000))
      );
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("eaCode:")) {
      const ownerId = interaction.customId.split(":")[1];
      if (interaction.user.id !== ownerId) return interaction.reply({ content: "This EA connection session belongs to another administrator.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      try {
        const auth = await EA.exchangeInitialCode(interaction.fields.getTextInputValue("redirectUrl"));
        pendingEaAuth.set(ownerId, { accessToken: auth.accessToken, personas: auth.personas, createdAt: Date.now() });
        const options = auth.personas.slice(0, 25).map((persona, i) => ({
          label: String(persona.displayName || persona.name || `PC Persona ${i + 1}`).slice(0, 100),
          description: `Madden 27 PC • ${persona.namespaceName}`.slice(0, 100),
          value: String(persona.personaId)
        }));
        const menu = new StringSelectMenuBuilder().setCustomId(`eaPersona:${ownerId}`).setPlaceholder("Select your Madden PC persona").addOptions(options);
        return interaction.editReply({ content: "✅ EA account recognized. Select the Madden PC persona that owns the franchise:", components: [new ActionRowBuilder().addComponents(menu)] });
      } catch (err) {
        console.error("EA initial authorization failed:", err?.message || err);
        return interaction.editReply(`❌ EA authorization failed: ${err?.message || err}\n\nRun \`/ea-connect\` and try a fresh login link. The EA login code can only be used once.`);
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("eaPersona:")) {
      const ownerId = interaction.customId.split(":")[1];
      if (interaction.user.id !== ownerId) return interaction.reply({ content: "This EA connection session belongs to another administrator.", ephemeral: true });
      await interaction.deferUpdate();
      try {
        const pending = pendingEaAuth.get(ownerId);
        if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error("This EA setup session expired. Run /ea-connect again.");
        const persona = pending.personas.find(p => String(p.personaId) === interaction.values[0]);
        if (!persona) throw new Error("That Madden persona was not found in the pending EA login.");
        const token = await EA.getPersonaToken(pending.accessToken, persona);
        // Keep the authorized persona token before loading franchises. If EA's
        // Madden service is temporarily down, the admin can retry this step
        // without repeating the EA browser login.
        pendingEaAuth.set(ownerId, { ...pending, token, persona, createdAt: Date.now() });
        const leagues = await EA.getLeagues(token);
        pendingEaAuth.set(ownerId, { ...pending, token, persona, leagues, createdAt: Date.now() });
        const options = leagues.slice(0, 25).map((league, i) => ({
          label: String(league.leagueName || `Franchise ${i + 1}`).slice(0, 100),
          description: `${league.numMembers || 0} members • ${league.seasonText || "Connected Franchise"}`.slice(0, 100),
          value: String(league.leagueId)
        }));
        if (!options.length) throw new Error("EA login worked, but this account does not currently have any Connected Franchises.");
        const menu = new StringSelectMenuBuilder().setCustomId(`eaLeague:${ownerId}`).setPlaceholder("Select the FDL Connected Franchise").addOptions(options);
        return interaction.editReply({ content: "✅ Madden PC persona authorized. Select the FDL Connected Franchise:", components: [new ActionRowBuilder().addComponents(menu)] });
      } catch (err) {
        console.error("EA persona selection failed:", err?.message || err);
        const pending = pendingEaAuth.get(ownerId);
        const canRetry = Boolean(pending?.token);
        const retryRow = canRetry ? [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`eaRetryLeagues:${ownerId}`).setLabel("Retry franchise lookup").setStyle(ButtonStyle.Primary)
        )] : [];
        return interaction.editReply({
          content: `❌ Could not load your Madden franchises: ${err?.message || err}.${canRetry ? "\n\nYour EA authorization is still saved temporarily. Use the button below to retry without signing in again." : "\n\nRun /ea-connect again to restart EA authorization."}`,
          components: retryRow
        });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("eaRetryLeagues:")) {
      const ownerId = interaction.customId.split(":")[1];
      if (interaction.user.id !== ownerId) return interaction.reply({ content: "Only the administrator who started this EA connection can retry it.", ephemeral: true });
      await interaction.deferUpdate();
      try {
        const pending = pendingEaAuth.get(ownerId);
        if (!pending?.token || Date.now() - pending.createdAt > 10 * 60 * 1000) throw new Error("The temporary EA authorization expired. Run /ea-connect again.");
        const leagues = await EA.getLeagues(pending.token);
        pendingEaAuth.set(ownerId, { ...pending, leagues, createdAt: Date.now() });
        const options = leagues.slice(0, 25).map((league, i) => ({
          label: String(league.leagueName || `Franchise ${i + 1}`).slice(0, 100),
          description: `${league.numMembers || 0} members • ${league.seasonText || "Connected Franchise"}`.slice(0, 100),
          value: String(league.leagueId)
        }));
        if (!options.length) throw new Error("EA login worked, but this account does not currently have any Connected Franchises.");
        const menu = new StringSelectMenuBuilder().setCustomId(`eaLeague:${ownerId}`).setPlaceholder("Select the FDL Connected Franchise").addOptions(options);
        return interaction.editReply({ content: "✅ Madden PC persona authorized. Select the FDL Connected Franchise:", components: [new ActionRowBuilder().addComponents(menu)] });
      } catch (err) {
        console.error("EA franchise retry failed:", err?.message || err);
        const retryRow = [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`eaRetryLeagues:${ownerId}`).setLabel("Retry franchise lookup").setStyle(ButtonStyle.Primary)
        )];
        return interaction.editReply({ content: `❌ Franchise lookup failed: ${err?.message || err}. Your EA authorization may still be usable; try again shortly.`, components: retryRow });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("eaLeague:")) {
      const ownerId = interaction.customId.split(":")[1];
      if (interaction.user.id !== ownerId) return interaction.reply({ content: "This EA connection session belongs to another administrator.", ephemeral: true });
      await interaction.deferUpdate();
      try {
        const pending = pendingEaAuth.get(ownerId);
        if (!pending?.token) throw new Error("Your EA setup session expired. Run /ea-connect again.");
        const league = pending.leagues.find(l => String(l.leagueId) === interaction.values[0]);
        if (!league) throw new Error("That Connected Franchise was not found in the pending EA session.");
        eaConnection = {
          ...pending.token,
          leagueId: Number(league.leagueId),
          leagueName: String(league.leagueName || "Connected Franchise"),
          connectedAt: Date.now(),
          connectedBy: ownerId,
          teams: [],
          lastSync: 0,
          lastSyncOwners: 0
        };
        saveEAConnection();
        const result = await refreshEAConnection("initial-connect");
        pendingEaAuth.delete(ownerId);
        return interaction.editReply({ content: `✅ **FDL is connected to Madden NFL 27 PC!**\n\nFranchise: **${eaConnection.leagueName}**\nTeams found: **${result.teams.length}/32**\nTeams with an EA username: **${result.leagueOwners}**\n\nThe roster will refresh automatically every 10 minutes. Team claims will now be checked against the EA franchise owner field before Discord roles or nicknames are changed.`, components: [] });
      } catch (err) {
        console.error("EA franchise selection failed:", err?.message || err);
        return interaction.editReply({ content: `❌ The franchise was selected, but the first EA sync failed: ${err?.message || err}\n\nThe connection details were saved. You can try /ea-refresh or reconnect with /ea-connect.`, components: [] });
      }
    }

    if (interaction.isButton() && interaction.customId === "waitlist:join") {
      if (!interaction.inGuild()) return;

      const waitlistRole = getWaitlistRole(interaction.guild);
      if (!waitlistRole) {
        return interaction.reply({ content: "❌ The **waitlist** role could not be found. Ask an admin to create it.", ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (hasTeamRole(member)) {
        const team = configuredTeamRolesOf(member).first();
        return interaction.reply({ content: `❌ You already have the **${team.name}** team role, so you can't join the waitlist.`, ephemeral: true });
      }

      if (member.roles.cache.has(waitlistRole.id)) {
        return interaction.reply({ content: "ℹ️ You're already on the waitlist.", ephemeral: true });
      }

      try {
        await member.roles.add(waitlistRole, "Joined waitlist from waitlist button");
        return interaction.reply({ content: "✅ You're on the **waitlist**! You'll be notified when a team opens.", ephemeral: true });
      } catch (err) {
        registerRateLimit(err);
        return interaction.reply({ content: `❌ I couldn't add the waitlist role: ${describeError(err)}`, ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith("claim:")) {
      if (!interaction.inGuild()) return;
      const roleId = interaction.customId.slice("claim:".length), data = config.roles[roleId], role = interaction.guild.roles.cache.get(roleId);
      if (!data) return interaction.reply({ content: "This team button is no longer configured.", ephemeral: true });
      if (!role) return interaction.reply({ content: "That team role no longer exists.", ephemeral: true });
      if (rateLimitSecondsLeft() > 0) return interaction.reply({ content: rateLimitNotice("Discord is rate-limiting the bot right now — I can't open the claim form yet."), ephemeral: true });
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const held = configuredTeamRolesOf(member);
      if (held.size) {
        const current = held.first();
        return interaction.reply({ content: current.id === role.id ? `You have already claimed a team (**${current.name}**).` : `❌ You have already claimed a team (**${current.name}**). You can only claim one team — ask a mod to release it if you want to switch.`, ephemeral: true });
      }
      const { holder: currentHolder, verified } = await findRoleHolder(interaction.guild, role);
      if (currentHolder) return interaction.reply({ content: `❌ Sorry — **${role.name}** has already been claimed by **${currentHolder.user.tag}**. Pick a team that's still open.`, ephemeral: true });
      if (!verified) return interaction.reply({ content: MEMBER_LIST_HELP, ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`claimModal:${roleId}`).setTitle(`Claim the ${role.name}`.slice(0, 45)).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("eaUsername").setLabel("Your EA username (exact)").setPlaceholder("EAUser1").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(24).setRequired(true)));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("claimModal:")) {
      if (!interaction.inGuild()) return;
      const roleId = interaction.customId.slice("claimModal:".length), data = config.roles[roleId], role = interaction.guild.roles.cache.get(roleId);
      if (!data || !role) return interaction.reply({ content: "That team is no longer configured.", ephemeral: true });
      const username = cleanUsername(interaction.fields.getTextInputValue("eaUsername"));
      if (!username) return interaction.reply({ content: "Please enter your exact EA username.", ephemeral: true });
      if (!eaConnection?.leagueId) return interaction.reply({ content: "❌ FDL's automatic Madden verification is not connected yet. Ask an administrator to run `/ea-connect`.", ephemeral: true });

      const leagueName = eaConnection.leagueName || "FDL Connected Franchise";
      const leagueInfo = new EmbedBuilder()
        .setColor(data.category === "AFC" ? 0xd50a0a : 0x013369)
        .setAuthor({ name: "FDL • Team Claim" })
        .setTitle(`${role.name} — join the league first`)
        .setDescription([
          `**League:** ${leagueName}`,
          `**League username:** ${process.env.LEAGUE_USERNAME || "FDL27"}`,
          `**League password:** ${process.env.LEAGUE_PASSWORD || "MADDENFDL27"}`,
          `**Platform:** Madden NFL 27 • PC`,
          `**Team:** ${resolveGuildEmoji(interaction.guild, data.emoji)} ${role.name}`,
          `**Your EA username:** \`${username}\``,
          "",
          "**How to join**",
          "1. Open Madden NFL 27 → **Franchise** → **Join League** (or accept the invite).",
          `2. Pick **${leagueName}** (enter the league username and password above if Madden asks) and take the **${role.name}**.`,
          "3. That's it — I'm reading Madden and will verify you automatically as soon as you're in (you can also press **Joined** to check right now).",
          "",
          `⚠️ Nothing is assigned until Madden shows you on the ${role.name} with this EA username.`
        ].join("\n"))
        .setFooter({ text: "Verification reads the live Madden franchise owner field." });
      const joinedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claimJoined:${roleId}:${username}`.slice(0, 100)).setLabel("Joined").setEmoji("✅").setStyle(ButtonStyle.Success)
      );
      const sentClaim = await interaction.reply({ embeds: [leagueInfo], components: [joinedRow], ephemeral: true });
      registerPendingClaim(roleId, interaction.user.id, username, interaction);
      return sentClaim;
    }

    if (interaction.isButton() && interaction.customId.startsWith("claimJoined:")) {
      if (!interaction.inGuild()) return;
      const [, roleId, ...rest] = interaction.customId.split(":");
      const username = rest.join(":");
      const role = interaction.guild.roles.cache.get(roleId);
      if (!config.roles[roleId] || !role) return interaction.reply({ content: "That team is no longer configured.", ephemeral: true });
      if (!eaConnection?.leagueId) return interaction.reply({ content: "❌ FDL's Madden connection is offline. Ask an administrator to run `/ea-connect`.", ephemeral: true });
      await interaction.deferUpdate();
      try {
        await refreshEAConnection("claim-joined"); // always fresh: they may have joined seconds ago
        const ownership = EA.findTeamOwner(eaConnection.teams, role.name, username);
        if (!ownership.ok) {
          registerPendingClaim(roleId, interaction.user.id, username, interaction); // keep watching for them
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle("❌ Not verified yet")
            .setDescription(`${ownership.reason}\n\nMake sure you've **joined ${eaConnection.leagueName || "the league"}** in Madden on the **${role.name}** with the EA account \`${username}\`, then I'll verify you automatically — I'm still watching Madden for you (or press **Joined** again to check right now).\n\nNo role or nickname was changed yet.`)],
            components: interaction.message.components });
        }
        const finished = await finalizeClaim(interaction.guild, interaction.user.id, roleId, username);
        pendingClaims.delete(roleId);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ Welcome to the ${role.name}!`)
          .setDescription(`Madden confirms **${username}** owns the **${role.name}** in **${eaConnection.leagueName || "the connected franchise"}**.\n\nNickname: **${finished.nickname}**${finished.nickNote}`)], components: [] });
      } catch (err) {
        console.error("EA-backed claim verification failed:", err);
        return interaction.editReply({ content: `❌ I couldn't verify this claim: ${describeError(err)}\n\nNo team role was assigned. Try **Joined** again in a minute.`, embeds: [], components: interaction.message.components });
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
    registerRateLimit(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: describeError(err), ephemeral: true }).catch(() => {});
    else if (interaction.isRepliable() && interaction.deferred) await interaction.editReply({ content: describeError(err) }).catch(() => {});
  }
});

function roleIdForTeamName(name) {
  return Object.keys(config.roles).find(id => String(config.roles[id]?.label).toLowerCase() === String(name || "").toLowerCase()) || null;
}
function ownerOfTeamName(name) {
  const roleId = roleIdForTeamName(name);
  return roleId ? (config.claims?.[roleId] || null) : null;
}

return {
  getConnection: () => eaConnection,
  saveConnection: saveEAConnection,
  refreshEAConnection,
  // Team names here are the short names used by teams.js ("Cowboys", "49ers").
  roleIdForTeamName,
  applyTeamAssignment,
  finalizeClaim,
  claimWatchTick,
  registerPendingClaim,
  pendingClaims,
  ownerOfTeamName
};
};
