'use strict';
// Remaining Snallabot commands: /streams, /logger, /broadcasts, /export and team logos.
// Ported from snallabot-service (MIT, Copyright (c) 2024 snallabot) - see SNALLABOT_LICENSE.md.
//  - /broadcasts needs keys in .env: TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET and/or YOUTUBE_API_KEY
//    (Snallabot ships its own keys; a self-hosted bot needs yours). Without a key that side stays idle.
//  - /export is Snallabot's "update the bot with your league data"; FDL reads Madden directly, so it just
//    runs the same refresh as /update-sync.
const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ChannelType: CT } = require('discord.js');
const X = require('./extrasLogic');

module.exports = function install(client, commands, ctx) {
  const { GUILD_ID, TEAMS, franchise } = ctx;
  const dataFile = name => path.join(__dirname, 'data', name);
  const read = (name, fallback) => { try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return fallback; } };
  const write = (name, v) => { fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); const tmp = dataFile(name) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, dataFile(name)); };
  const admin = PermissionFlagsBits.Administrator;
  const textCh = o => o.addChannelTypes(ChannelType.GuildText);

  commands.push(
    new SlashCommandBuilder().setName('streams').setDescription('Streams: configure, count, remove, reset').setDefaultMemberPermissions(admin)
      .addSubcommand(s => s.setName('configure').setDescription('Set the channel that shows stream counts').addChannelOption(o => textCh(o.setName('channel').setDescription('Channel to post in').setRequired(true))))
      .addSubcommand(s => s.setName('count').setDescription('Up a member\'s stream count by 1 (or override)')
        .addUserOption(o => o.setName('user').setDescription('Member to count the stream for').setRequired(true))
        .addIntegerOption(o => o.setName('increment').setDescription('Amount to add (default 1, negative to subtract)').setMinValue(-100).setMaxValue(100)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a member\'s stream count').addUserOption(o => o.setName('user').setDescription('Member to remove').setRequired(true)))
      .addSubcommand(s => s.setName('reset').setDescription('DANGER: reset every member to 0')),
    new SlashCommandBuilder().setName('logger').setDescription('Save finished game channels into threads').setDefaultMemberPermissions(admin)
      .addSubcommand(s => s.setName('configure').setDescription('Set the logger channel').addChannelOption(o => textCh(o.setName('channel').setDescription('Channel that holds the log threads').setRequired(true))))
      .addSubcommand(s => s.setName('on').setDescription('Turn the logger on or off').addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true))),
    new SlashCommandBuilder().setName('broadcasts').setDescription('Post live Twitch / YouTube streams').setDefaultMemberPermissions(admin)
      .addSubcommand(s => s.setName('configure').setDescription('Where to post live streams')
        .addChannelOption(o => textCh(o.setName('channel').setDescription('Channel to send broadcasts to').setRequired(true)))
        .addStringOption(o => o.setName('keyword').setDescription('Only show broadcasts with this keyword in the title'))
        .addRoleOption(o => o.setName('notifier_role').setDescription('Optional role to ping on every broadcast')))
      .addSubcommandGroup(g => g.setName('youtube').setDescription('YouTube channels')
        .addSubcommand(s => s.setName('add').setDescription('Add a YouTube channel').addStringOption(o => o.setName('youtube_channel').setDescription('Channel ID, URL or @handle').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a YouTube channel').addStringOption(o => o.setName('youtube_channel').setDescription('Channel ID, URL or @handle').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('List YouTube channels')))
      .addSubcommandGroup(g => g.setName('twitch').setDescription('Twitch channels')
        .addSubcommand(s => s.setName('add').setDescription('Add a Twitch channel').addStringOption(o => o.setName('twitch_channel').setDescription('Twitch username or URL').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a Twitch channel').addStringOption(o => o.setName('twitch_channel').setDescription('Twitch username or URL').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('List Twitch channels'))),
    new SlashCommandBuilder().setName('export').setDescription('Update the bot with your league data (reads Madden now)').setDefaultMemberPermissions(admin)
      .addSubcommand(s => s.setName('current').setDescription('Update the current week'))
      .addSubcommand(s => s.setName('week').setDescription('Update a specific week').addIntegerOption(o => o.setName('week').setDescription('Week to update').setRequired(true).setMinValue(1).setMaxValue(23)))
      .addSubcommand(s => s.setName('all_weeks').setDescription('Update every week')),
    new SlashCommandBuilder().setName('team-logo').setDescription('Customize the emoji/logo shown next to a team on the scoreboard').setDefaultMemberPermissions(admin)
      .addSubcommand(s => s.setName('customize').setDescription('Use a server emoji (or an uploaded image) as the team logo')
        .addStringOption(o => o.setName('team').setDescription('NFL team').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('emoji').setDescription('An existing server emoji, e.g. :otters:'))
        .addAttachmentOption(o => o.setName('image_file').setDescription('Image to turn into a server emoji')))
      .addSubcommand(s => s.setName('reset').setDescription('Back to the default').addStringOption(o => o.setName('team').setDescription('NFL team').setRequired(true).setAutocomplete(true)))
  );

  // ---------- streams ----------
  async function refreshStreamBoard(state) {
    if (!state.channelId) return;
    const ch = await client.channels.fetch(state.channelId).catch(() => null);
    if (!ch?.isTextBased()) return;
    const content = X.streamBoard(state.counts);
    if (state.messageId) { try { await ch.messages.edit(state.messageId, { content, allowedMentions: { parse: [] } }); return; } catch (e) { if (![10008].includes(e?.code)) throw e; } }
    const m = await ch.send({ content, allowedMentions: { parse: [] } });
    state.messageId = m.id; write('streams.json', state);
  }

  // ---------- logger (also called by gameChannels when a game is finished) ----------
  async function archiveChannel(channel) {
    const cfg = read('logger.json', { enabled: false, channelId: null });
    if (!cfg.enabled || !cfg.channelId) return false;
    const logCh = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!logCh?.threads) return false;
    const all = [];
    let before;
    for (let page = 0; page < 10; page++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!batch.size) break;
      all.push(...batch.values());
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    const msgs = all.reverse().map(m => ({ author: m.member?.displayName || m.author?.username || 'unknown', content: m.content, createdAt: m.createdTimestamp, attachments: [...(m.attachments?.values?.() || [])].map(a => a.url) }));
    const thread = await logCh.threads.create({ name: channel.name.slice(0, 100), autoArchiveDuration: 10080, reason: 'Game channel log' });
    for (const chunk of X.transcript(msgs)) await thread.send({ content: chunk, allowedMentions: { parse: [] } });
    return true;
  }

  // ---------- broadcasts ----------
  const bcfg = () => read('broadcasts.json', { channelId: null, keyword: '', roleId: null, youtube: [], twitch: [], seen: {} });
  let twitchToken = null, twitchExpires = 0;
  async function twitchLive(logins) {
    const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
    if (!id || !secret || !logins.length) return [];
    if (!twitchToken || Date.now() > twitchExpires) {
      const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
      const j = await r.json(); twitchToken = j.access_token; twitchExpires = Date.now() + (j.expires_in - 600) * 1000;
    }
    const q = logins.map(l => `user_login=${encodeURIComponent(l)}`).join('&');
    const r = await fetch(`https://api.twitch.tv/helix/streams?${q}`, { headers: { 'Client-Id': id, Authorization: `Bearer ${twitchToken}` } });
    const j = await r.json();
    return (j.data || []).map(s => ({ key: `twitch:${s.id}`, who: s.user_name, title: s.title, url: `https://twitch.tv/${s.user_login}`, platform: 'Twitch' }));
  }
  async function youtubeLive(channels) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key || !channels.length) return [];
    const out = [];
    for (const ch of channels) {
      try {
        const feed = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`)).text();
        const ids = [...feed.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map(m => m[1]).slice(0, 5);
        if (!ids.length) continue;
        const j = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(',')}&key=${key}`)).json();
        for (const v of j.items || []) if (v.liveStreamingDetails?.actualStartTime && !v.liveStreamingDetails.actualEndTime) out.push({ key: `youtube:${v.id}`, who: v.snippet.channelTitle, title: v.snippet.title, url: `https://youtu.be/${v.id}`, platform: 'YouTube' });
      } catch (e) { console.error('[broadcasts] youtube', ch, e.message); }
    }
    return out;
  }
  async function resolveYoutube(parsed) {
    if (parsed.id) return parsed.id;
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return null;
    const j = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent('@' + parsed.handle)}&key=${key}`)).json();
    return j.items?.[0]?.id || null;
  }
  async function broadcastTick() {
    const cfg = bcfg();
    if (!cfg.channelId || (!cfg.youtube.length && !cfg.twitch.length)) return;
    const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!ch?.isTextBased()) return;
    const live = [...await twitchLive(cfg.twitch).catch(e => { console.error('[broadcasts] twitch', e.message); return []; }), ...await youtubeLive(cfg.youtube)];
    let dirty = false;
    for (const s of live) {
      if (cfg.seen[s.key] || !X.matchesKeyword(s.title, cfg.keyword)) continue;
      await ch.send({ content: `${cfg.roleId ? `<@&${cfg.roleId}> ` : ''}🔴 **${s.who}** is live on ${s.platform}: **${s.title}**\n${s.url}`, allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] } });
      cfg.seen[s.key] = Date.now(); dirty = true;
    }
    for (const [k, t] of Object.entries(cfg.seen)) if (Date.now() - t > 7 * 864e5) { delete cfg.seen[k]; dirty = true; }
    if (dirty) write('broadcasts.json', cfg);
  }
  client.once('ready', () => { const t = setInterval(() => broadcastTick().catch(e => console.error('[broadcasts]', e.message)), 3 * 60 * 1000); t.unref?.(); });

  // ---------- interactions ----------
  const teamKey = input => { const k = ctx.normalizeTeam ? ctx.normalizeTeam(input) : null; return k; };
  client.on('interactionCreate', async i => {
    try {
      if (GUILD_ID && i.guildId && i.guildId !== GUILD_ID) return;
      if (i.isAutocomplete() && i.commandName === 'team-logo') {
        const f = String(i.options.getFocused() || '').toLowerCase();
        return i.respond(Object.keys(TEAMS).filter(n => n.toLowerCase().includes(f) || TEAMS[n].abbr.toLowerCase() === f).slice(0, 25).map(n => ({ name: n, value: n })));
      }
      if (!i.isChatInputCommand() || !['streams', 'logger', 'broadcasts', 'export', 'team-logo'].includes(i.commandName)) return;
      if (!i.memberPermissions?.has(admin)) return i.reply({ content: 'Administrator access required.', ephemeral: true });
      await i.deferReply({ ephemeral: true });
      const sub = i.options.getSubcommand();

      if (i.commandName === 'streams') {
        const st = read('streams.json', { channelId: null, messageId: null, counts: {} });
        if (sub === 'configure') { st.channelId = i.options.getChannel('channel', true).id; st.messageId = null; write('streams.json', st); await refreshStreamBoard(st); return i.editReply(`✅ Stream counts will show in <#${st.channelId}>.`); }
        if (!st.channelId) return i.editReply('Run `/streams configure` first.');
        if (sub === 'count') { const u = i.options.getUser('user', true); st.counts = X.bumpStream(st.counts, u.id, i.options.getInteger('increment') ?? 1); }
        if (sub === 'remove') { const u = i.options.getUser('user', true); delete st.counts[u.id]; }
        if (sub === 'reset') st.counts = {};
        write('streams.json', st); await refreshStreamBoard(st);
        return i.editReply('✅ Stream counts updated.');
      }

      if (i.commandName === 'logger') {
        const cfg = read('logger.json', { enabled: false, channelId: null });
        if (sub === 'configure') { cfg.channelId = i.options.getChannel('channel', true).id; write('logger.json', cfg); return i.editReply(`✅ Finished game channels will be saved as threads in <#${cfg.channelId}>${cfg.enabled ? '.' : ' once you run `/logger on`.'}`); }
        cfg.enabled = i.options.getBoolean('enabled', true); write('logger.json', cfg);
        return i.editReply(cfg.enabled ? (cfg.channelId ? '✅ Logger is on.' : '✅ Logger is on, but pick a channel with `/logger configure`.') : 'Logger is off.');
      }

      if (i.commandName === 'broadcasts') {
        const cfg = bcfg(), group = i.options.getSubcommandGroup(false);
        if (!group) {
          cfg.channelId = i.options.getChannel('channel', true).id; cfg.keyword = i.options.getString('keyword') || ''; cfg.roleId = i.options.getRole('notifier_role')?.id || null;
          write('broadcasts.json', cfg);
          const missing = [!process.env.TWITCH_CLIENT_ID && 'Twitch (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)', !process.env.YOUTUBE_API_KEY && 'YouTube (YOUTUBE_API_KEY)'].filter(Boolean);
          return i.editReply(`✅ Live streams post in <#${cfg.channelId}>${cfg.keyword ? ` when the title has "${cfg.keyword}"` : ''}.${missing.length ? `\n⚠️ Add keys to \`.env\` for: ${missing.join(', ')}.` : ''}`);
        }
        if (group === 'twitch') {
          if (sub === 'list') return i.editReply(cfg.twitch.length ? cfg.twitch.map(t => `• ${t}`).join('\n') : 'No Twitch channels yet.');
          const login = X.parseTwitchLogin(i.options.getString('twitch_channel', true));
          if (!login) return i.editReply('That doesn\'t look like a Twitch username.');
          cfg.twitch = sub === 'add' ? [...new Set([...cfg.twitch, login])] : cfg.twitch.filter(t => t !== login);
          write('broadcasts.json', cfg); return i.editReply(`✅ ${sub === 'add' ? 'Added' : 'Removed'} **${login}**.`);
        }
        if (group === 'youtube') {
          if (sub === 'list') return i.editReply(cfg.youtube.length ? cfg.youtube.map(t => `• ${t}`).join('\n') : 'No YouTube channels yet.');
          const parsed = X.parseYoutubeChannel(i.options.getString('youtube_channel', true));
          if (!parsed) return i.editReply('Give me a channel ID (UC…), a channel URL, or an @handle.');
          const id = await resolveYoutube(parsed);
          if (!id) return i.editReply(parsed.handle ? 'I can only look up @handles when `YOUTUBE_API_KEY` is set — paste the channel URL with the UC… ID instead.' : 'Could not read that channel.');
          cfg.youtube = sub === 'add' ? [...new Set([...cfg.youtube, id])] : cfg.youtube.filter(t => t !== id);
          write('broadcasts.json', cfg); return i.editReply(`✅ ${sub === 'add' ? 'Added' : 'Removed'} **${id}**.`);
        }
      }

      if (i.commandName === 'export') {
        franchise.invalidate();
        const r = await franchise.refreshLive({ force: true });
        return i.editReply(`✅ Madden data refreshed (${sub === 'week' ? `week ${i.options.getInteger('week', true)}` : sub === 'all_weeks' ? 'all weeks' : 'current week'}); ${r.updated} live post${r.updated === 1 ? '' : 's'} updated. FDL reads Madden directly, so there's nothing to upload — \`/update-sync\` does the same plus the scoreboard and claims.`);
      }

      if (i.commandName === 'team-logo') {
        const team = i.options.getString('team', true);
        if (!TEAMS[team]) return i.editReply('Pick a team from the list.');
        const logos = read('team_logos.json', {});
        if (sub === 'reset') { delete logos[TEAMS[team].short.toLowerCase()]; write('team_logos.json', logos); return i.editReply(`✅ Reset the ${team} logo.`); }
        const emojiText = i.options.getString('emoji'), file = i.options.getAttachment('image_file');
        let emoji = null;
        if (file) {
          const created = await i.guild.emojis.create({ attachment: file.url, name: TEAMS[team].short.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'team' });
          emoji = created.toString();
        } else if (emojiText) {
          const m = emojiText.match(/<a?:(\w+):(\d+)>/), byName = i.guild.emojis.cache.find(e => e.name === emojiText.replace(/:/g, ''));
          emoji = m ? emojiText : byName ? byName.toString() : null;
        }
        if (!emoji) return i.editReply('Give me an existing server emoji (like `:otters:`) or attach an image.');
        logos[TEAMS[team].short.toLowerCase()] = emoji; write('team_logos.json', logos);
        return i.editReply(`✅ ${emoji} is now the ${team} logo on the scoreboard.`);
      }
    } catch (err) {
      const msg = `❌ ${String(err.message || err).slice(0, 300)}`;
      console.error('[extras]', err);
      try { if (i.deferred || i.replied) await i.editReply(msg); else await i.reply({ content: msg, ephemeral: true }); } catch { /* gone */ }
    }
  });
  return { archiveChannel };
};
