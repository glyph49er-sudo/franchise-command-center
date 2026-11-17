const fs = require('fs');
const prospectStats = require('./prospectStats');
const path = require('path');
const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder
} = require('discord.js');

module.exports = function installFeatures(client, commands, ctx) {
  const { GUILD_ID, SCORE_CHANNEL_ID, PROSPECT_CHANNEL_ID, PROSPECT_STATS_CHANNEL_ID, TEAMS, TEAM_ROLE_IDS, normalizeTeam, teamRoleMatches, isAdmin, findScore, scoreMessageText } = ctx;
  const DATA = path.join(__dirname, 'data'); fs.mkdirSync(DATA, {recursive:true});
  const files = {
    teamClaims:'team_claims.json', teamRoles:'team_role_config.json', waitlist:'waitlist.json', openStatus:'open_team_status.json',
    potw:'players_of_week.json', gotw:'games_of_week.json', mystery:'mystery_box.json', prospects:'prospects.json', prospectSheets:'prospect_stat_sheets.json', scouts:'scout_sheets.json'
  };
  const paths = Object.fromEntries(Object.entries(files).map(([k,v])=>[k,path.join(DATA,v)]));
  function read(k, fallback={}) { try { const v=JSON.parse(fs.readFileSync(paths[k],'utf8')); if(!v||typeof v!=='object'||Array.isArray(v)!==Array.isArray(fallback)){write(k,fallback);return fallback;} if(k==='mystery'){if(!v.claims||typeof v.claims!=='object'||Array.isArray(v.claims))v.claims={};if(!Array.isArray(v.history))v.history=[];if(!v.hiddenToday||typeof v.hiddenToday!=='object'||Array.isArray(v.hiddenToday))v.hiddenToday={};} if(k==='potw'&&Array.isArray(v))for(const r of v)if(!r.claimed||typeof r.claimed!=='object')r.claimed={}; if(k==='scouts'&&!Array.isArray(v))for(const r of Object.values(v))if(!Array.isArray(r.history))r.history=[]; return v; } catch(e) { if(fs.existsSync(paths[k])) { try{fs.copyFileSync(paths[k],paths[k]+`.corrupt-${Date.now()}.bak`)}catch{} } try{write(k,fallback)}catch{} return fallback; } }
  function write(k,v) { const tmp=paths[k]+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(v,null,2)); fs.renameSync(tmp,paths[k]); }
  const defaults={teamClaims:{},teamRoles:TEAM_ROLE_IDS,waitlist:{},openStatus:{},potw:[],gotw:[],mystery:{claims:{},history:[],hiddenToday:{}},prospects:[],prospectSheets:[],scouts:{}};
  for(const [k,v] of Object.entries(defaults))if(!fs.existsSync(paths[k]))write(k,v);
  const mergedTeamRoles={...TEAM_ROLE_IDS,...read('teamRoles',{})};if(JSON.stringify(mergedTeamRoles)!==JSON.stringify(read('teamRoles',{})))write('teamRoles',mergedTeamRoles);
  const admin=PermissionFlagsBits.Administrator;
  const potwSessions=new Map();
  const mysteryCheckerSessions=new Map();
  const recentJoiners=new Map();
  const physical=['Speed','Acceleration','Agility','Strength','Jumping','Change of Direction','Stamina','Injury'];
  const blockedPhysicalNorm=new Set(['speed','spd','acceleration','acc','agility','agi','strength','str','jumping','jmp','changeofdirection','cod','stamina','sta','injury','inj']);
  // Physical = Speed, Acceleration, Agility, Strength, Jumping, Change of Direction, Stamina, Injury (full names, common abbreviations, and "Speed rating"-style phrasing).
  const physicalWords=new Set(['speed','acceleration','accel','agility','strength','jumping','jump','stamina','injury','injuries']);
  const isPhysical=value=>{const raw=String(value||'').toLowerCase();const n=raw.replace(/[^a-z]/g,'');if(blockedPhysicalNorm.has(n)||/changeofdir|changedir/.test(n))return true;return raw.split(/[^a-z]+/).filter(Boolean).some(w=>physicalWords.has(w));};
  // Maps what someone typed (SPD, accel, Change of Direction...) onto the canonical physical attribute name, or null.
  const physicalAbbrev={spd:'Speed',acc:'Acceleration',accel:'Acceleration',agi:'Agility',str:'Strength',jmp:'Jumping',jump:'Jumping',cod:'Change of Direction',sta:'Stamina',inj:'Injury'};
  const canonPhysical=value=>{const n=String(value||'').toLowerCase().replace(/[^a-z]/g,'');return physical.find(x=>x.toLowerCase().replace(/[^a-z]/g,'')===n)||physicalAbbrev[n]||null;};
  // Player of the Week: exactly ONE attribute (optionally typed like "+3 Awareness"). Returns the cleaned attribute, or null if more than one was entered.
  const cleanSingleAttribute=value=>{const s=String(value||'').trim().replace(/^\(?\+?\s*3\s*\)?\s*/,'').replace(/\s*\(?\+?3\)?$/,'').trim();return /[,;/&+\n]|\band\b|\bor\b/i.test(s)||!/[a-z]/i.test(s)?null:s;};
  const looksLikeOnePlayer=value=>!/[,;&+\n]|\band\b/i.test(String(value||''));
  const mysteryRewards=[['Ball Carrier Vision',23.6],['Carrying',23.6],['Kick Return',23.6],['+1 Speed',.5],['+1 Acceleration',2],['+1 Agility',2],['+1 Awareness',2],['+1 Strength',2],['+1 Jumping',2],['+1 Change of Direction',2],['+1 Throw Power',2],['+1 Short Accuracy',2],['+1 Medium Accuracy',2],['+1 Deep Accuracy',2],['+1 Catching',2],['+1 Carrying',2],['+1 Tackling',2],['+1 Play Recognition',2],['Normal → Star',.5],['Star → Superstar',.1],['Superstar → X-Factor',.1]];
  const total=mysteryRewards.reduce((a,x)=>a+x[1],0); if(Math.abs(total-100)>1e-9) throw new Error(`Mystery Box odds total ${total}`);
  const pickWeighted=arr=>{let n=Math.random()*arr.reduce((a,x)=>a+x[1],0);for(const [v,w] of arr){n-=w;if(n<0)return v;}return arr[arr.length-1][0];};
  const modalField=(id,label,placeholder='',required=true,style=TextInputStyle.Short,max=100)=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(style).setMaxLength(max));
  const get=(i,id)=>i.fields.getTextInputValue(id).trim();
  const isAdminUser=i=>i.memberPermissions?.has(admin);
  const pacificDay=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
  const attrNon=['Awareness','Break Tackle','Trucking','Ball Carrier Vision','Stiff Arm','Spin Move','Juke Move','Carrying','Catching','Short Route Running','Medium Route Running','Deep Route Running','Catch in Traffic','Spectacular Catch','Release','Throw Power','Throw Accuracy Short','Throw Accuracy Medium','Throw Accuracy Deep','Throw on the Run','Throw Under Pressure','Play Action','Break Sack','Run Block','Run Block Power','Run Block Finesse','Pass Block','Pass Block Power','Pass Block Finesse','Impact Blocking','Lead Block','Tackle','Hit Power','Power Moves','Finesse Moves','Block Shedding','Pursuit','Play Recognition','Man Coverage','Zone Coverage','Press','Kick Power','Kick Accuracy','Kick Return','Long Snap','Toughness'];
  const positionStats={
    QB:['Throw Power','Throw Accuracy Short','Throw Accuracy Medium','Throw Accuracy Deep','Throw on the Run','Throw Under Pressure','Play Action','Break Sack','Awareness'],
    HB:['Speed','Acceleration','Agility','Carrying','Ball Carrier Vision','Break Tackle','Change of Direction','Juke Move','Spin Move','Trucking','Stiff Arm'],
    FB:['Strength','Run Block','Lead Block','Impact Blocking','Awareness','Carrying','Trucking'],
    WR:['Speed','Acceleration','Catching','Short Route Running','Medium Route Running','Deep Route Running','Catch in Traffic','Spectacular Catch','Release','Jumping'],
    TE:['Catching','Short Route Running','Medium Route Running','Run Block','Pass Block','Catch in Traffic','Awareness','Strength'],
    LT:['Pass Block','Pass Block Power','Pass Block Finesse','Run Block','Run Block Power','Run Block Finesse','Strength','Awareness'], LG:['Pass Block','Pass Block Power','Pass Block Finesse','Run Block','Run Block Power','Run Block Finesse','Strength','Impact Blocking'], C:['Pass Block','Pass Block Power','Pass Block Finesse','Run Block','Run Block Power','Run Block Finesse','Awareness','Strength'], RG:['Pass Block','Pass Block Power','Pass Block Finesse','Run Block','Run Block Power','Run Block Finesse','Strength','Impact Blocking'], RT:['Pass Block','Pass Block Power','Pass Block Finesse','Run Block','Run Block Power','Run Block Finesse','Strength','Awareness'],
    LE:['Strength','Power Moves','Finesse Moves','Block Shedding','Tackle','Pursuit','Play Recognition','Acceleration'], RE:['Strength','Power Moves','Finesse Moves','Block Shedding','Tackle','Pursuit','Play Recognition','Acceleration'], DT:['Strength','Power Moves','Block Shedding','Tackle','Hit Power','Pursuit','Play Recognition'], NT:['Strength','Power Moves','Block Shedding','Tackle','Hit Power','Awareness'], LOLB:['Speed','Acceleration','Tackle','Block Shedding','Pursuit','Play Recognition','Man Coverage','Zone Coverage'], MLB:['Tackle','Play Recognition','Block Shedding','Pursuit','Zone Coverage','Man Coverage','Hit Power','Awareness'], ROLB:['Speed','Acceleration','Tackle','Block Shedding','Pursuit','Play Recognition','Man Coverage','Zone Coverage'], CB:['Speed','Acceleration','Agility','Man Coverage','Zone Coverage','Press','Play Recognition','Jumping'], FS:['Speed','Acceleration','Zone Coverage','Man Coverage','Play Recognition','Pursuit','Tackle','Awareness'], SS:['Speed','Acceleration','Tackle','Hit Power','Zone Coverage','Man Coverage','Play Recognition','Pursuit'], K:['Kick Power','Kick Accuracy'], P:['Kick Power','Kick Accuracy'], LS:['Long Snap','Awareness','Strength']
  };
  const allStats=['Speed','Strength','Agility','Acceleration','Awareness','Break Tackle','Trucking','Change of Direction','Ball Carrier Vision','Stiff Arm','Spin Move','Juke Move','Carrying','Catching','Short Route Running','Medium Route Running','Deep Route Running','Catch in Traffic','Spectacular Catch','Release','Jumping','Throw Power','Throw Accuracy Short','Throw Accuracy Medium','Throw Accuracy Deep','Throw on the Run','Throw Under Pressure','Play Action','Break Sack','Run Block','Run Block Power','Run Block Finesse','Pass Block','Pass Block Power','Pass Block Finesse','Impact Blocking','Lead Block','Tackle','Hit Power','Power Moves','Finesse Moves','Block Shedding','Pursuit','Play Recognition','Man Coverage','Zone Coverage','Press','Kick Power','Kick Accuracy','Kick Return','Long Snap','Stamina','Injury','Toughness'];
  const normPos=p=>{p=String(p||'').toUpperCase().replace(/[^A-Z]/g,''); const aliases={QUARTERBACK:'QB',RUNNINGBACK:'HB',HALFBACK:'HB',FULLBACK:'FB',WIDERECEIVER:'WR',TIGHTEND:'TE',OFFENSIVETACKLE:'RT',OFFENSIVEGUARD:'RG',CENTER:'C',DEFENSIVEEND:'LE',DEFENSIVETACKLE:'DT',EDGE:'RE',OUTSIDELINEBACKER:'LOLB',MIDDLELINEBACKER:'MLB',INSIDELINEBACKER:'MLB',CORNERBACK:'CB',FREESAFETY:'FS',STRONGSAFETY:'SS',KICKER:'K',PUNTER:'P',LONGSNAPPER:'LS',HB:'HB',RB:'HB',FB:'FB',WR:'WR',TE:'TE',LT:'LT',LG:'LG',C:'C',RG:'RG',RT:'RT',LE:'LE',RE:'RE',DT:'DT',NT:'NT',LOLB:'LOLB',MLB:'MLB',ROLB:'ROLB',CB:'CB',FS:'FS',SS:'SS',S:'SS',K:'K',PK:'K',P:'P',LS:'LS',QB:'QB'};return aliases[p]||'ATH';};
  function labelMatches(input,stat){const aliases={'shortaccuracy':'throwaccuracyshort','mediumaccuracy':'throwaccuracymedium','deepaccuracy':'throwaccuracydeep','cod':'changeofdirection','sac':'throwaccuracyshort','mac':'throwaccuracymedium','dac':'throwaccuracydeep','spd':'speed','str':'strength','agi':'agility','acc':'acceleration','srr':'shortrouterunning','mrr':'mediumrouterunning','drr':'deeprouterunning','thp':'throwpower','cth':'catching'};const a=String(input||'').toLowerCase().replace(/[^a-z]/g,''),b=String(stat||'').toLowerCase().replace(/[^a-z]/g,'');const canonical=aliases[a]||a;if(canonical==='routerunning')return b.includes('routerunning');if(canonical==='throwaccuracy')return b.startsWith('throwaccuracy');return canonical===b||canonical.includes(b)||b.includes(canonical);}
  // Stat generation lives in prospectStats.js (TML-style, position-balanced). Returns { stats (by name), dev }.
  function generateSheet(d){const g=prospectStats.generateProspect(d);return {stats:g.stats,dev:g.development};}
  const fmtSheet=(d,s)=>{const groups=[['Athletic',['Speed','Strength','Agility','Acceleration','Awareness','Change of Direction','Jumping','Stamina','Injury','Toughness']],['Offense',['Break Tackle','Trucking','Ball Carrier Vision','Stiff Arm','Spin Move','Juke Move','Carrying','Catching','Short Route Running','Medium Route Running','Deep Route Running','Catch in Traffic','Spectacular Catch','Release','Throw Power','Throw Accuracy Short','Throw Accuracy Medium','Throw Accuracy Deep','Throw on the Run','Throw Under Pressure','Play Action','Break Sack','Run Block','Run Block Power','Run Block Finesse','Pass Block','Pass Block Power','Pass Block Finesse','Impact Blocking','Lead Block']],['Defense / Special Teams',['Tackle','Hit Power','Power Moves','Finesse Moves','Block Shedding','Pursuit','Play Recognition','Man Coverage','Zone Coverage','Press','Kick Power','Kick Accuracy','Kick Return','Long Snap']]];return [`**${d.name} — ${d.position}**`,`${d.height} | ${d.weight} | ${d.college}${d.age?` | Age ${d.age}`:''}${d.number?` | #${d.number}`:''}`,`**Archetype:** ${d.archetype||'N/A'}`,`**Strengths:** ${[d.strength1,d.strength2,d.strength3].filter(Boolean).join(', ')}`,`**Weaknesses:** ${[d.weakness1,d.weakness2].filter(Boolean).join(', ')}`,`**Development:** ${s.dev}`,...groups.map(([title,list])=>`**${title}**\n`+list.map(k=>`${k}: **${s.stats[k]}**`).join(' • '))].join('\n\n');};
  // Commands
  commands.push(
    new SlashCommandBuilder().setName('players-of-the-week').setDescription('Post four Players of the Week and their +3 non-physical award.').addStringOption(o=>o.setName('week').setDescription('League week').setRequired(true)).addUserOption(o=>o.setName('player1').setDescription('Recipient 1').setRequired(true)).addUserOption(o=>o.setName('player2').setDescription('Recipient 2').setRequired(true)).addUserOption(o=>o.setName('player3').setDescription('Recipient 3').setRequired(true)).addUserOption(o=>o.setName('player4').setDescription('Recipient 4').setRequired(true)).setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('simple-open-teams').setDescription('Post the compact FDL | Open Teams card here; it updates automatically.').setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('mystery-box-post').setDescription('Post the daily Mystery Box.').setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('mystery-box-checker').setDescription('Inspect Mystery Box reward history.').setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('scout-player').setDescription('Scout one prospect attribute.').addStringOption(o=>o.setName('name').setDescription('Prospect name').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('scout-sheet').setDescription('View your scouting history.'),
    new SlashCommandBuilder().setName('reset-scout-sheets').setDescription('Reset all scouting history.').setDefaultMemberPermissions(admin)
  );

  function findTeamRole(guild,team){const roleIds=read('teamRoles',{});const rid=roleIds[team]||TEAM_ROLE_IDS[team]||(ctx.claimerRoleId&&ctx.claimerRoleId(team));return rid?guild.roles.cache.get(rid)||null:guild.roles.cache.find(r=>{const n=r.name.toLowerCase();return n.includes(team.toLowerCase())||n.includes(TEAMS[team].short.toLowerCase())||new RegExp(`\\b${TEAMS[team].abbr.toLowerCase()}\\b`).test(n);})||null;}
  function hasTeamRole(member,team){const role=findTeamRole(member.guild,team);return !!role&&member.roles.cache.has(role.id);}
  function memberHasAnyTeamRole(member){return Object.keys(TEAMS).some(t=>hasTeamRole(member,t));}
  function openTeams(guild){return Object.keys(TEAMS).filter(t=>{const role=findTeamRole(guild,t);return !role||role.members.size===0;});}
  async function syncTeamClaims(guild){const claims={};for(const team of Object.keys(TEAMS)){const role=findTeamRole(guild,team);if(!role)continue;const owner=role.members.find(m=>!m.user.bot);if(owner)claims[team]={userId:owner.id,roleId:role.id,updatedAt:Date.now()};}write('teamClaims',claims);}
  async function syncWaitlistRole(oldMember,newMember){try{const before=memberHasAnyTeamRole(oldMember),after=memberHasAnyTeamRole(newMember);if(before===after)return;const roleId=process.env.WAITLIST_COACH_ROLE_ID||'';const role=roleId?newMember.guild.roles.cache.get(roleId):newMember.guild.roles.cache.find(r=>r.name.toLowerCase()===(process.env.WAITLIST_COACH_ROLE_NAME||'waitlist coach').toLowerCase());if(!role)return;const waitlist=read('waitlist',{});if(after){if(newMember.roles.cache.has(role.id))await newMember.roles.remove(role,'NFL team claimed; remove from waitlist');delete waitlist[newMember.id];}else{if(!newMember.roles.cache.has(role.id))await newMember.roles.add(role,'NFL team released; return to waitlist');waitlist[newMember.id]={userId:newMember.id,updatedAt:Date.now(),status:'waiting'};}write('waitlist',waitlist);}catch(e){console.error('[waitlist role sync]',e.message);}}

  function openStatusState(){const s=read('openStatus',{});if(!s.commandPosts||typeof s.commandPosts!=='object')s.commandPosts={};if(!s.welcome&&s.messageId)s.welcome={channelId:s.channelId||'1472462578935533660',messageId:s.messageId};return s;}
  async function refreshOpenPosts(guild){await updateOpenPost(guild);const state=openStatusState();for(const [channelId,post] of Object.entries(state.commandPosts)){const channel=await client.channels.fetch(channelId).catch(()=>null);if(!channel?.isTextBased())continue;const msg=await channel.messages.fetch(post.messageId).catch(()=>null);if(!msg){delete state.commandPosts[channelId];continue;}await msg.edit({embeds:[buildCommandOpenEmbed(guild)],allowedMentions:{parse:[]}}).catch(e=>console.error('[command open teams edit]',e.message));}write('openStatus',state);}
  function buildCommandOpenEmbed(guild){const open=openTeams(guild);const embed=new EmbedBuilder().setColor(0x6f35c9).setTitle('🏈 FDL | Open Teams').setDescription(open.length?open.map(t=>`**${TEAMS[t].short}**  ·  ${TEAMS[t].abbr}`).join('\n'):'**All 32 NFL teams are currently claimed.**').setFooter({text:`${open.length} team${open.length===1?'':'s'} available • Updates automatically`}).setTimestamp();return embed;}
  async function updateCommandOpenPost(guild,channel){try{await guild.members.fetch().catch(()=>{});await syncTeamClaims(guild).catch(()=>{});const state=openStatusState();const existing=state.commandPosts[channel.id];let msg=existing?await channel.messages.fetch(existing.messageId).catch(()=>null):null;if(msg)await msg.edit({embeds:[buildCommandOpenEmbed(guild)],allowedMentions:{parse:[]}});else{msg=await channel.send({embeds:[buildCommandOpenEmbed(guild)],allowedMentions:{parse:[]}});}state.commandPosts[channel.id]={channelId:channel.id,messageId:msg.id,updatedAt:Date.now()};write('openStatus',state);return msg;}catch(e){console.error('[command open teams]',e.message);throw e;}}
  async function updateOpenPost(guild,joiner=null,forceNew=false){try{await guild.members.fetch().catch(()=>{});await syncTeamClaims(guild).catch(()=>{});const channel=await client.channels.fetch('1472462578935533660');if(!channel?.isTextBased())return;const state=openStatusState();const open=openTeams(guild);const content=[`## 🏈 FDL — Open Teams`,`Welcome${joiner?`, <@${joiner.id}>`:''}! Here are the NFL teams currently available.`,``,open.length?open.map(t=>`• **${TEAMS[t].short}** (${TEAMS[t].abbr})`).join('\n'):'**All 32 teams are currently claimed.**','',`To claim a team, use the league team-claim process.`,`||This list updates automatically when teams open or are claimed.||`].join('\n');let welcome=state.welcome||((state.messageId)?{channelId:channel.id,messageId:state.messageId}:null);let msg=welcome?.messageId?await channel.messages.fetch(welcome.messageId).catch(()=>null):null;if(forceNew&&msg){await msg.delete().catch(()=>{});msg=null;}if(msg)await msg.edit({content,allowedMentions:joiner?{users:[joiner.id]}:{parse:[]}});else{const old=await channel.messages.fetch({limit:30}).catch(()=>null);if(old)for(const m of old.values())if(m.author.id===client.user.id&&m.content.includes('FDL — Open Teams'))await m.delete().catch(()=>{});msg=await channel.send({content,allowedMentions:joiner?{users:[joiner.id]}:{parse:[]}});}state.welcome={channelId:channel.id,messageId:msg.id,updatedAt:Date.now()};delete state.messageId;delete state.channelId;write('openStatus',state);}catch(e){console.error('[welcome open teams]',e.message);}}
  async function teamChange(member){if(member.guild.id!==GUILD_ID)return;await refreshOpenPosts(member.guild);}
  client.once('ready',async()=>{try{const state=openStatusState();const guild=await client.guilds.fetch(GUILD_ID);if(state.welcome||state.messageId||Object.keys(state.commandPosts).length)await refreshOpenPosts(guild);}catch(e){console.error('[open teams startup refresh]',e.message);}});
  client.on('guildMemberAdd',m=>{recentJoiners.set(m.guild.id,{id:m.id,at:Date.now()});teamChange(m).then(()=>updateOpenPost(m.guild,m)).catch(()=>{});});
  client.on('guildMemberRemove',m=>teamChange(m).catch(()=>{}));
  client.on('guildMemberUpdate',(a,b)=>{if(a.roles.cache.size!==b.roles.cache.size||a.roles.cache.some(r=>!b.roles.cache.has(r.id))){syncWaitlistRole(a,b).catch(()=>{});syncTeamClaims(b.guild).catch(()=>{});teamChange(b).catch(()=>{});}});
  client.on('messageCreate',async m=>{
    if(m.guild?.id===GUILD_ID&&m.channelId==='1472462578935533660'&&m.author.bot&&m.author.id!==client.user.id){let member=m.mentions.members.first()||null;const embedText=(m.embeds||[]).map(e=>[e.title,e.description,...(e.fields||[]).map(f=>f.value)].filter(Boolean).join(' ')).join(' ');const mention=(m.content+' '+embedText).match(/<@!?(\d+)>/);if(!member&&mention)member=await m.guild.members.fetch(mention[1]).catch(()=>null);if(!member){const recent=recentJoiners.get(m.guild.id);if(recent&&Date.now()-recent.at<5*60*1000)member=await m.guild.members.fetch(recent.id).catch(()=>null);}await updateOpenPost(m.guild,member,true);}
    if(m.guild?.id===GUILD_ID&&m.channelId===SCORE_CHANNEL_ID)await updateGamesFromScore(m).catch(e=>console.error('[GOTW score listener]',e));
    if(m.guild?.id===GUILD_ID&&m.channel.name?.toLowerCase().includes('general')&&!m.author.bot&&/who(?:'|’)s\s+open|what teams? (?:are )?open|open teams|available teams/i.test(m.content)){await m.guild.members.fetch().catch(()=>{});const open=openTeams(m.guild);await m.reply({content:open.length?`**Open teams:** ${open.map(t=>TEAMS[t].short).join(', ')}`:'All teams are currently claimed.',allowedMentions:{parse:[]}}).catch(()=>{});}
  });
  client.on('messageUpdate',async(old,m)=>{if(m.guild?.id===GUILD_ID&&m.channelId===SCORE_CHANNEL_ID)await updateGamesFromScore(m).catch(e=>console.error('[GOTW score listener]',e));});


  const gotw=read('gotw',[]); // array of submissions
  // Reuse the original bot's Snallabot-aware parser from index.js. It handles
  // the actual league score format, including logos/emojis, embeds, week
  // headers, reversed home/away order, and trailing notes such as Force Win.
  async function updateGamesFromScore(message){
    const data=read('gotw',[]);
    let changed=false;
    const text=scoreMessageText(message);
    if(!text)return;
    for(const g of data){
      if(g.status!=='pending')continue;
      const score=findScore(text,g.awayTeam,g.homeTeam);
      if(!score)continue;
      g.awayScore=score.awayScore;
      g.homeScore=score.homeScore;
      g.status=g.awayScore===g.homeScore?'tie':'final';
      g.winner=g.status==='tie'?null:(g.awayScore>g.homeScore?g.awayTeam:g.homeTeam);
      g.loser=g.status==='tie'?null:(g.awayScore>g.homeScore?g.homeTeam:g.awayTeam);
      g.scoreMessageId=message.id;
      changed=true;
      const ch=await client.channels.fetch(g.channelId).catch(()=>null);
      const msg=await ch?.messages.fetch(g.messageId).catch(()=>null);
      if(msg)await msg.edit({content:gotwText(g),components:gotwRows(g)}).catch(e=>console.error('[GOTW update]',e.message));
    }
    if(changed)write('gotw',data);
  }
  async function scanRecentScores(){try{const ch=await client.channels.fetch(SCORE_CHANNEL_ID);if(!ch?.messages?.fetch)return;const batch=await ch.messages.fetch({limit:100});for(const msg of batch.values())await updateGamesFromScore(msg);}catch(e){console.error('[GOTW initial score scan]',e.message);}}
  function gotwText(g){return [`**Game of the Week — ${g.week}**`,`**${TEAMS[g.awayTeam].short}** ${g.awayScore??'—'} vs ${g.homeScore??'—'} **${TEAMS[g.homeTeam].short}**`,g.reason,'',g.status==='pending'?'⏳ Awaiting final score. Reward submissions are locked.':g.status==='tie'?'🤝 **Tie game:** both teams may submit one physical +1 and one non-physical +1.':`🏆 Winner: **${TEAMS[g.winner].short}** | Loser: **${TEAMS[g.loser].short}**`,g.awayReward?`**${TEAMS[g.awayTeam].short}:** ${g.awayReward}`:'',g.homeReward?`**${TEAMS[g.homeTeam].short}:** ${g.homeReward}`:''].filter(Boolean).join('\n');}
  function gotwRows(g){if(g.status==='pending')return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gotw_locked:${g.id}:winner`).setLabel('Winner Reward — Awaiting Final').setStyle(ButtonStyle.Secondary).setDisabled(true),new ButtonBuilder().setCustomId(`gotw_locked:${g.id}:loser`).setLabel('Loser Reward — Awaiting Final').setStyle(ButtonStyle.Secondary).setDisabled(true))];if(g.status==='tie')return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gotw_tie:${g.id}:${g.awayTeam}`).setLabel(`${TEAMS[g.awayTeam].short} Tie Reward`).setStyle(ButtonStyle.Primary).setDisabled(!!g.awayReward),new ButtonBuilder().setCustomId(`gotw_tie:${g.id}:${g.homeTeam}`).setLabel(`${TEAMS[g.homeTeam].short} Tie Reward`).setStyle(ButtonStyle.Primary).setDisabled(!!g.homeReward))];return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`gotw_win:${g.id}:${g.winner}`).setLabel('Winner Reward').setStyle(ButtonStyle.Success).setDisabled(!!g.winnerReward),new ButtonBuilder().setCustomId(`gotw_lose:${g.id}:${g.loser}`).setLabel('Loser Reward').setStyle(ButtonStyle.Danger).setDisabled(!!g.loserReward))];}
  function saveGotw(){write('gotw',read('gotw',[]));}

  client.on('interactionCreate',async i=>{try{
    if(i.isAutocomplete()&&i.commandName==='scout-player'){const q=normName(i.options.getFocused());const names=new Map();for(const x of read('prospectSheets',[]))if(x?.name)names.set(normName(x.name),x.name);for(const x of read('prospects',[]))if(x?.data?.name&&!names.has(normName(x.data.name)))names.set(normName(x.data.name),x.data.name);return i.respond([...names.entries()].filter(([k])=>!q||k.includes(q)).slice(-25).map(([,v])=>({name:String(v).slice(0,100),value:String(v).slice(0,100)}))).catch(()=>{});}
    if(i.isChatInputCommand()&&i.commandName==='simple-open-teams'){if(!isAdminUser(i))return i.reply({content:'Administrator access required.',ephemeral:true});await i.deferReply({ephemeral:true});try{await updateCommandOpenPost(i.guild,i.channel);await i.editReply('Posted — this card updates automatically as teams are claimed or opened.');}catch(e){await i.editReply(`Could not post here: ${e.message}`);}return;}
    if(i.isChatInputCommand()&&['players-of-the-week','mystery-box-post','mystery-box-checker','scout-player','scout-sheet','reset-scout-sheets'].includes(i.commandName)){
      if(!['scout-sheet','scout-player'].includes(i.commandName)&&!isAdminUser(i))return i.reply({content:'Administrator access required.',ephemeral:true});
      if(i.commandName==='players-of-the-week'){const users=[1,2,3,4].map(n=>i.options.getUser(`player${n}`,true));if(new Set(users.map(u=>u.id)).size!==4)return i.reply({content:'Choose four different users.',ephemeral:true});const week=i.options.getString('week',true);const rows=users.map(u=>`• <@${u.id}> — **+3 non-physical attribute**`);const rec={week,users:users.map(u=>u.id),claimed:{},channelId:i.channelId,messageId:null,createdAt:Date.now()};await i.reply({content:`**Players of the Week — ${week}**\n${rows.join('\n')}\n\nEach recipient gets ONE +3 to ONE non-physical attribute (no Speed, Acceleration, Agility, Strength, Jumping, Change of Direction, Stamina, or Injury) for ONE player.`,components:users.map(u=>new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`potw_claim:${u.id}`).setLabel(`Submit — ${u.username}`.slice(0,80)).setStyle(ButtonStyle.Primary)))});const sent=await i.fetchReply();rec.messageId=sent.id;const arr=read('potw',[]);arr.push(rec);write('potw',arr);return;}
      if(i.commandName==='mystery-box-post'){const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mystery_roll').setLabel('Roll your daily trait').setStyle(ButtonStyle.Primary));await i.reply({content:'**roll your daily trait!**',components:[row]});return;}
      if(i.commandName==='mystery-box-checker'){
        const db=read('mystery',{claims:{},history:[],hiddenToday:{}});
        const day=pacificDay();
        const hiddenIds=new Set((db.hiddenToday&&db.hiddenToday[day])||[]);
        const h=(db.history||[]).filter(x=>!x.given&&!(x.date===day&&hiddenIds.has(x.userId)));
        if(!h.length)return i.reply({content:'No pending Mystery Box rewards to display right now.',ephemeral:true});
        const shownIds=[...new Set(h.map(x=>x.userId))];
        const sessionId=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        mysteryCheckerSessions.set(sessionId,{day,userIds:shownIds,entryKeys:h.map(x=>`${x.userId}:${x.at}`),at:Date.now()});
        for(const [k,v] of mysteryCheckerSessions.entries())if(Date.now()-v.at>86400000)mysteryCheckerSessions.delete(k);
        const lines=h.slice().reverse().map(x=>`<@${x.userId}> — **${x.reward}** — ${x.player} — ${x.date}`);
        const chunks=[];let cur='**Mystery Box History**';
        for(const line of lines){if((cur+'\n'+line).length>1850){chunks.push(cur);cur='';}cur+=(cur?'\n':'')+line;}
        if(cur)chunks.push(cur);
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mystery_given:${sessionId}`).setLabel('Given').setStyle(ButtonStyle.Success));
        await i.reply({content:chunks[0],components:chunks.length===1?[row]:[],ephemeral:true});
        for(let idx=1;idx<chunks.length;idx++){
          const isLast=idx===chunks.length-1;
          await i.followUp({content:chunks[idx],components:isLast?[row]:[],ephemeral:true});
        }
        return;
      }
      if(i.commandName==='scout-player'){const name=i.options.getString('name',true).trim();await i.deferReply({ephemeral:true});const found=await findSheet(name);if(found?.ambiguous)return i.editReply({content:`Several prospects match **${name}**: ${found.ambiguous.slice(0,10).map(n=>`**${n}**`).join(', ')}. Please type the full name.`});const p=found?.p;if(!p)return i.editReply({content:`I couldn't find a prospect named **${name}** in the system or the stat sheet channel. Check the spelling.`});const all=read('scouts',{});const now=Date.now(),last=all[i.user.id]?.lastScout||0;const unlock=nextScoutReset(last||now);if(last&&now<unlock)return i.editReply({content:`You can scout again <t:${Math.floor(unlock/1000)}:R>.`});let result;const roll=Math.random();if(roll<.01)result={type:'full',text:Object.entries(p.stats).map(([k,v])=>`${k}: ${v}`).join('\n')};else if(roll<.21)result={type:'dev',text:`Development trait: **${p.dev}**`};else{const keys=prospectStats.keyStatNames(p.position);const stat=keys[Math.floor(Math.random()*keys.length)];result={type:'stat',text:`${stat}: **${p.stats[stat]} OVR**`};}const rec=all[i.user.id]||{history:[]};rec.lastScout=now;rec.history=rec.history||[];rec.history.push({name:p.name,position:p.position,...result,at:now});all[i.user.id]=rec;write('scouts',all);const revealed={};let devKnown=false;for(const h of rec.history){if(normName(h.name)!==normName(p.name))continue;if(h.type==='full'){Object.assign(revealed,p.stats);devKnown=true;}else if(h.type==='dev')devKnown=true;else{const m=String(h.text).match(/^(.+?):/);if(m&&p.stats[m[1]]!=null)revealed[m[1]]=p.stats[m[1]];}}
        const face=ctx.findPortrait?await ctx.findPortrait(p.name).catch(()=>null):null;
        const card=ctx.cards?await ctx.cards.prospectCard({...p,revealed,devKnown,face}).catch(e=>{console.error('[scout card]',e.message);return null;}):null;
        const embed=new EmbedBuilder().setColor(result.type==='full'?0xf1c40f:result.type==='dev'?0x9b59b6:0x1abc9c).setAuthor({name:'FDL Scouting Department'}).setTitle(`🔎 Scout Report — ${p.name}`).setDescription(`**${p.position}** • ${p.college||'—'} • ${p.height||''} ${p.weight||''}\n\n${result.type==='full'?'💎 **FULL REVEAL!** Every rating unlocked.\n':''}${result.type==='full'?'':result.text}`).setFooter({text:`${Object.keys(revealed).length} ratings scouted on this prospect`});
        if(card)embed.setImage('attachment://scout.png');
        else{
          // No image renderer is installed, so show the scouted ratings as text bars in the embed itself.
          const ratingBar=v=>{const n=Math.max(0,Math.min(10,Math.round(Number(v)/10)));return '▰'.repeat(n)+'▱'.repeat(10-n);};
          const lines=Object.entries(revealed).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`\`${k.padEnd(18).slice(0,18)}\` ${ratingBar(v)} **${v}**`);
          embed.addFields({name:'Development',value:devKnown?`**${p.dev}**`:'❓ Not scouted yet',inline:true});
          let chunk='',n=0;
          for(const line of lines){if((chunk+'\n'+line).length>1000){embed.addFields({name:n?'​':'Scouted ratings',value:chunk});n++;chunk='';}chunk+=(chunk?'\n':'')+line;}
          if(chunk)embed.addFields({name:n?'​':'Scouted ratings',value:chunk});
        }
        return i.editReply({embeds:[embed],files:card?[{attachment:card,name:'scout.png'}]:[]});}
      if(i.commandName==='scout-sheet'){const all=read('scouts',{}),rec=all[i.user.id];if(!rec?.history?.length)return i.reply({content:'You have not scouted any players yet.',ephemeral:true});const lines=rec.history.slice().reverse().map(x=>`**${x.name} (${x.position})** — <t:${Math.floor(x.at/1000)}:d>\n${x.text}`);const chunks=[];let cur='**Your Scouting History**';for(const line of lines){if((cur+'\n\n'+line).length>1850){chunks.push(cur);cur='';}cur+=(cur?'\n\n':'')+line;}if(cur)chunks.push(cur);await i.reply({content:chunks[0],ephemeral:true});for(const chunk of chunks.slice(1))await i.followUp({content:chunk,ephemeral:true});return;}
      if(i.commandName==='reset-scout-sheets'){write('scouts',{});return i.reply({content:'All scouting histories and cooldowns have been reset.',ephemeral:true});}
    }
    if(i.isChatInputCommand()&&i.commandName==='game-of-the-week'){
      if(!isAdminUser(i))return i.reply({content:'Administrator access required.',ephemeral:true});
      const week=i.options.getString('week',true),away=normalizeTeam(i.options.getString('away_team',true)),home=normalizeTeam(i.options.getString('home_team',true)),reason=i.options.getString('reason',true);
      if(!away||!home||away===home)return i.reply({content:'Choose two different valid NFL teams.',ephemeral:true});
      await i.deferReply({ephemeral:true});
      const channel=i.channel||await client.channels.fetch(i.channelId).catch(()=>null);
      if(!channel?.isTextBased())return i.editReply('Cannot access this channel to post Game of the Week.');
      const me=i.guild?.members?.me||await i.guild?.members?.fetchMe().catch(()=>null);
      const perms=me?channel.permissionsFor(me):null;
      if(perms&&!perms.has(['ViewChannel','SendMessages']))return i.editReply('I need View Channel and Send Messages permissions in this channel.');
      const id=`${Date.now()}-${i.user.id}`;
      const g={id,week,awayTeam:away,homeTeam:home,reason,status:'pending',channelId:channel.id,messageId:null};
      let msg;
      try{msg=await channel.send({content:gotwText(g),components:gotwRows(g)});}
      catch(e){console.error('[GOTW post]',e);return i.editReply(`I couldn't post the Game of the Week in this channel (${e.code?`Discord error ${e.code}: `:''}${e.message}). Make sure I have View Channel, Send Messages and Read Message History here.`);}
      g.messageId=msg.id;const arr=read('gotw',[]);arr.push(g);write('gotw',arr);
      await scanRecentScores().catch(e=>console.error('[GOTW initial score scan]',e.message));
      return i.editReply('Game of the Week posted. It will unlock when the final score is detected.');
    }
    if(i.isButton()){
      if(i.customId.startsWith('mystery_given:')){
        if(!isAdminUser(i))return i.reply({content:'Administrator access required.',ephemeral:true});
        const sessionId=i.customId.split(':')[1];
        const session=mysteryCheckerSessions.get(sessionId);
        if(!session)return i.reply({content:'This list session has expired or was already marked as given.',ephemeral:true});
        const db=read('mystery',{claims:{},history:[],hiddenToday:{}});
        const day=session.day||pacificDay();
        if(!db.hiddenToday||typeof db.hiddenToday!=='object')db.hiddenToday={};
        const existing=new Set(db.hiddenToday[day]||[]);
        for(const uid of session.userIds)existing.add(uid);
        // Flag the exact entries that were shown as given so they never reappear (any day).
        const keys=new Set(session.entryKeys||[]);for(const x of db.history||[])if(keys.has(`${x.userId}:${x.at}`)){x.given=true;x.givenBy=i.user.id;x.givenAt=Date.now();}
        db.hiddenToday[day]=[...existing];
        for(const k of Object.keys(db.hiddenToday))if(k!==day)delete db.hiddenToday[k];
        write('mystery',db);
        mysteryCheckerSessions.delete(sessionId);
        const disabledRow=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mystery_given_done:${sessionId}`).setLabel('Given ✓').setStyle(ButtonStyle.Secondary).setDisabled(true));
        const n=session.entryKeys?.length||session.userIds.length;return i.update({content:`✅ **Marked as Given** — ${n} reward${n===1?'':'s'} removed from the Mystery Box list.`,components:[disabledRow]});
      }
      if(i.customId==='mystery_roll'){const db=read('mystery',{claims:{},history:[]});const day=pacificDay();if(db.claims[i.user.id]?.date===day)return i.reply({content:'You already rolled today. Come back after midnight Pacific time.',ephemeral:true});const reward=pickWeighted(mysteryRewards);db.claims[i.user.id]={date:day,reward,pending:true};write('mystery',db);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mystery_apply_button:${day}`).setLabel('Apply reward to a player').setStyle(ButtonStyle.Success));return i.reply({content:`Congratulations! You got **${reward}**! Who will you apply it to?`,components:[row],ephemeral:true});}if(i.customId.startsWith('mystery_apply_button:')){const day=i.customId.split(':')[1],db=read('mystery',{claims:{},history:[]}),claim=db.claims[i.user.id];if(!claim||claim.date!==day||!claim.pending)return i.reply({content:'This reward is no longer waiting to be applied.',ephemeral:true});const m=new ModalBuilder().setCustomId(`mystery_apply:${day}`).setTitle('Apply Your Mystery Box Reward');m.addComponents(modalField('player','Player Name','Who will receive this reward?'));return i.showModal(m);}
      if(i.customId.startsWith('potw_claim:')){const uid=i.customId.split(':')[1];if(i.user.id!==uid)return i.reply({content:'Only the selected Player of the Week can submit their award.',ephemeral:true});const arr=read('potw',[]),rec=[...arr].reverse().find(x=>x.users.includes(uid)&&!x.claimed[uid]);if(!rec)return i.reply({content:'No unclaimed Player of the Week award was found for you.',ephemeral:true});const m=new ModalBuilder().setCustomId(`potw_modal:${rec.messageId}:${uid}`).setTitle('Player of the Week — +3 Attribute');m.addComponents(modalField('attribute','ONE non-physical attribute (+3)','One only, e.g. Awareness, Catching, Toughness'),modalField('player','ONE player receiving the +3','Player name'));return i.showModal(m);}
      if(i.customId.startsWith('gotw_')){const [kind,id,team]=i.customId.split(':');if(!['gotw_locked','gotw_win','gotw_lose','gotw_tie'].includes(kind))return;if(kind==='gotw_locked')return i.reply({content:'The game has not been detected as final yet.',ephemeral:true});const g=read('gotw',[]).find(x=>x.id===id);if(!g)return i.reply({content:'This GOTW submission no longer exists.',ephemeral:true});const member=await i.guild.members.fetch(i.user.id);if(!hasTeamRole(member,team))return i.reply({content:'Only the owner of this team role can submit its reward.',ephemeral:true});if(kind==='gotw_win'&&g.winnerReward||kind==='gotw_lose'&&g.loserReward||kind==='gotw_tie'&&((team===g.awayTeam?g.awayReward:g.homeReward)))return i.reply({content:'This team has already submitted its reward.',ephemeral:true});const modal=new ModalBuilder().setCustomId(`gotw_modal:${kind}:${id}:${team}`).setTitle('Game of the Week Reward');if(kind==='gotw_win')modal.addComponents(modalField('stardevPlayer','Stardev Player','Player name'),modalField('physical','Physical attribute (+1)','Speed, Strength, etc.'),modalField('physicalPlayer','Player receiving physical +1','Player name'));else if(kind==='gotw_lose')modal.addComponents(modalField('loserSpeedPlayer','Player for +1 Speed','Player name'));else modal.addComponents(modalField('physical','Physical attribute (+1)','Speed, Strength, etc.'),modalField('physicalPlayer','Player for physical +1','Player name'),modalField('nonphysical','Non-physical attribute (+1)','Awareness, Catching, etc.'),modalField('nonphysicalPlayer','Player for non-physical +1','Player name'));return i.showModal(modal);}
    }
    if(i.isModalSubmit()){
      if(i.customId.startsWith('mystery_apply:')){const parts=i.customId.split(':');const day=parts[1],db=read('mystery',{claims:{},history:[]}),claim=db.claims[i.user.id];if(!claim||claim.date!==day||!claim.pending)return i.reply({content:'This reward application expired or was already used.',ephemeral:true});const player=get(i,'player');claim.pending=false;claim.player=player;db.history=db.history||[];db.history.push({userId:i.user.id,reward:claim.reward,player,date:day,at:Date.now()});write('mystery',db);return i.reply({content:`Congratulations! You got **${claim.reward}**! Applied to **${player}**.`,ephemeral:true});}
      if(i.customId.startsWith('potw_modal:')){const [,msgId,uid]=i.customId.split(':');if(uid!==i.user.id)return i.reply({content:'This award belongs to another user.',ephemeral:true});const rawAttribute=get(i,'attribute'),player=get(i,'player');if(!rawAttribute||!player)return i.reply({content:'Please enter both an attribute and a player name.',ephemeral:true});const attribute=cleanSingleAttribute(rawAttribute);if(!attribute)return i.reply({content:'Player of the Week gives exactly ONE +3 to ONE attribute. Enter a single attribute (for example Awareness) and submit again.',ephemeral:true});if(!looksLikeOnePlayer(player))return i.reply({content:'The +3 goes to ONE player. Enter a single player name and submit again.',ephemeral:true});if(isPhysical(attribute))return i.reply({content:`**${attribute}** is not allowed. You cannot choose Speed, Acceleration, Agility, Strength, Jumping, Change of Direction, Stamina, or Injury. Enter any other attribute and submit again.`,ephemeral:true});const arr=read('potw',[]),rec=arr.find(x=>x.messageId===msgId);if(!rec||rec.claimed[uid])return i.reply({content:'This award is no longer available.',ephemeral:true});rec.claimed[uid]={attribute,player,at:Date.now()};write('potw',arr);const ch=await client.channels.fetch(rec.channelId),msg=await ch.messages.fetch(msgId);const done=rec.users.map(id=>{const c=rec.claimed[id];if(!c)return `• <@${id}> — awaiting submission`;if(c.attribute)return `• <@${id}> — +3 ${c.attribute} (${c.player})`;return `• <@${id}> — ${c.attributes.map(a=>a.attribute?`+3 ${a.attribute} (${a.player})`:a.player).join('; ')}`;});if(rec.auto){const e=EmbedBuilder.from(msg.embeds[0]);e.setDescription(rec.users.map((id,n)=>{const c=rec.claimed[id];return `**${n+1}.** ${rec.lines?.[id]||''} — <@${id}>\n${c?`✅ +3 ${c.attribute} (${c.player})`:'**+3 non-physical attribute** — unclaimed'}`;}).join('\n\n'));await msg.edit({embeds:[e],components:msg.components.map(row=>new ActionRowBuilder().addComponents(row.components.map(b=>ButtonBuilder.from(b).setDisabled(Boolean(rec.claimed[b.data.custom_id.split(':')[1]])))))});return i.reply({content:`Recorded: **+3 ${attribute}** for **${player}**.`,ephemeral:true});}await msg.edit({content:`**Players of the Week — ${rec.week}**\n${done.join('\n')}`,components:msg.components.map(row=>new ActionRowBuilder().addComponents(row.components.map(b=>ButtonBuilder.from(b).setDisabled(Boolean(rec.claimed[b.data.custom_id.split(':')[1]])))))});return i.reply({content:`Recorded: **+3 ${attribute}** for **${player}**.`,ephemeral:true});}
      if(i.customId.startsWith('gotw_modal:')){const [,kind,id,team]=i.customId.split(':');const member=await i.guild.members.fetch(i.user.id);if(!hasTeamRole(member,team))return i.reply({content:'You do not own this team.',ephemeral:true});const phys=kind==='gotw_lose'?'':canonPhysical(get(i,'physical')),non=kind==='gotw_tie'?get(i,'nonphysical'):'';if(kind!=='gotw_lose'&&!phys)return i.reply({content:`Enter one of these physical attributes: ${physical.join(', ')}.`,ephemeral:true});if(kind==='gotw_tie'&&isPhysical(non))return i.reply({content:`${non} is physical. Enter a non-physical attribute instead.`,ephemeral:true});const arr=read('gotw',[]),g=arr.find(x=>x.id===id);if(!g)return i.reply({content:'GOTW record not found.',ephemeral:true});let reward;if(kind==='gotw_win'){reward=`Stardev ${get(i,'stardevPlayer')}; +1 ${phys} for ${get(i,'physicalPlayer')}`;g.winnerReward=reward;if(team===g.awayTeam)g.awayReward=reward;else g.homeReward=reward;}else if(kind==='gotw_lose'){reward=`+1 Speed for ${get(i,'loserSpeedPlayer')}`;g.loserReward=reward;if(team===g.awayTeam)g.awayReward=reward;else g.homeReward=reward;}else{reward=`+1 ${phys} for ${get(i,'physicalPlayer')}; +1 ${non} for ${get(i,'nonphysicalPlayer')}`;if(team===g.awayTeam)g.awayReward=reward;else g.homeReward=reward;}write('gotw',arr);const ch=await client.channels.fetch(g.channelId),msg=await ch.messages.fetch(g.messageId);await msg.edit({content:gotwText(g),components:gotwRows(g)});return i.reply({content:'Your GOTW reward has been recorded.',ephemeral:true});}
    }
  }catch(e){console.error('[FDL features]',e);if(i.isRepliable()&&!i.replied&&!i.deferred)await i.reply({content:`Something went wrong${e&&(e.code||e.message)?` (${String(e.code?`Discord error ${e.code}: `:'')+String(e.message||'').slice(0,150)})`:''}. Check bot permissions and try again.`,ephemeral:true}).catch(()=>{});else if(i.deferred&&!i.replied)await i.editReply(`Something went wrong${e&&(e.code||e.message)?` (${String(e.code?`Discord error ${e.code}: `:'')+String(e.message||'').slice(0,150)})`:''}. Check bot permissions and try again.`).catch(()=>{});}});

  // Helper: next unlock is the next noon Pacific on an even-numbered two-day cadence.
  function nextScoutReset(fromTs){
    const tz='America/Los_Angeles';
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(fromTs));
    const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const serial=(y,m,d)=>Math.floor(Date.UTC(y,m-1,d)/86400000);
    const anchor=serial(2026,1,1);
    const dateObj=new Date(Date.UTC(+o.year,+o.month-1,+o.day));
    const toUtcNoon=(date)=>{let guess=Date.parse(`${date}T20:00:00Z`);for(let n=0;n<4;n++){const q=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));const represented=Date.UTC(+q.year,+q.month-1,+q.day,+q.hour,+q.minute);const wanted=Date.UTC(+date.slice(0,4),+date.slice(5,7)-1,+date.slice(8,10),12,0);guess+=wanted-represented;}return guess;};
    for(let n=0;n<5;n++){const y=dateObj.getUTCFullYear(),m=dateObj.getUTCMonth()+1,d=dateObj.getUTCDate();const date=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const parity=(serial(y,m,d)-anchor)%2===0;const target=toUtcNoon(date);if(parity&&target>fromTs)return target;dateObj.setUTCDate(dateObj.getUTCDate()+1);}
    return fromTs+2*86400000;
  }

  // ---- Prospect sheet storage / lookup -------------------------------------------------
  const normName=n=>String(n||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  function saveSheet(entry){const store=read('prospectSheets',[]);const k=store.findIndex(x=>(entry.sheetId&&x.sheetId===entry.sheetId)||(entry.statMessageId&&x.statMessageId===entry.statMessageId));if(k>=0)store[k]={...store[k],...entry};else store.push(entry);write('prospectSheets',store);return entry;}
  // Rebuild a sheet from a message the bot previously posted in the stat sheet channel.
  function parseSheetMessage(msg){const c=String(msg.content||'');const h=c.match(/^\*\*(.+?)\s+—\s+(.+?)\*\*/);if(!h)return null;const stats={};for(const m of c.matchAll(/([A-Za-z][A-Za-z ]*?):\s\*\*(\d{2,3})\*\*/g)){const key=allStats.find(x=>x.toLowerCase()===m[1].trim().toLowerCase());if(key)stats[key]=Number(m[2]);}if(Object.keys(stats).length<allStats.length*.8)return null;const dev=((c.match(/\*\*Development:\*\*\s*([^\n]+)/)||[])[1]||'').trim();const list=re=>((c.match(re)||[])[1]||'').split(',').map(x=>x.trim()).filter(Boolean);const info=c.split('\n').map(x=>x.trim()).filter(Boolean)[1]||'';const [height,weight,college,...extra]=info.split('|').map(x=>x.trim());const age=(extra.map(x=>x.match(/^Age\s+(\d+)/i)).find(Boolean)||[])[1]||null,number=(extra.map(x=>x.match(/^#(\d+)/)).find(Boolean)||[])[1]||null;return {sheetId:`msg:${msg.id}`,name:h[1].trim(),position:h[2].trim(),height,weight,college,age,number,strengths:list(/\*\*Strengths:\*\*\s*([^\n]+)/),weaknesses:list(/\*\*Weaknesses:\*\*\s*([^\n]+)/),stats,dev:dev||'Normal',statMessageId:msg.id,createdAt:msg.createdTimestamp||Date.now()};}
  async function scanStatChannel(wantNorm){const ch=await client.channels.fetch(PROSPECT_STATS_CHANNEL_ID).catch(()=>null);if(!ch?.messages?.fetch)return;let before;for(let page=0;page<30;page++){const batch=await ch.messages.fetch({limit:100,...(before?{before}:{})}).catch(()=>null);if(!batch||!batch.size)break;let hit=false;const known=new Set(read('prospectSheets',[]).map(x=>x.statMessageId).filter(Boolean));for(const m of batch.values()){if(m.author?.id!==client.user?.id)continue;const sh=parseSheetMessage(m);if(!sh)continue;if(!known.has(m.id))saveSheet(sh);if(normName(sh.name)===wantNorm)hit=true;}if(hit)break;before=batch.last().id;}}
  async function createProspectSheet(d){
    const sheet=generateSheet(d);
    // Save FIRST so the prospect is always in the system, even if posting to Discord fails.
    const entry=saveSheet({sheetId:`gen:${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:d.name,position:d.position,height:d.height,weight:d.weight,college:d.college,age:d.age||null,number:d.number||null,archetype:d.archetype,strengths:[d.strength1,d.strength2,d.strength3],weaknesses:[d.weakness1,d.weakness2],stats:sheet.stats,dev:sheet.dev,statMessageId:null,createdAt:Date.now()});
    const target=await client.channels.fetch(PROSPECT_STATS_CHANNEL_ID).catch(()=>null);
    if(!target?.isTextBased())throw new Error(`Prospect stat channel ${PROSPECT_STATS_CHANNEL_ID} is unavailable or not text-based (sheet for ${d.name} was still saved).`);
    const sent=await target.send({content:fmtSheet(d,sheet)});
    saveSheet({sheetId:entry.sheetId,statMessageId:sent.id});
    return sent;
  }
  // Find a prospect's sheet: saved data -> stat sheet channel history -> prospect registry (generates + posts if missing).
  async function findSheet(name){const want=normName(name);if(!want)return null;
    const look=()=>{const store=read('prospectSheets',[]).filter(x=>x?.stats&&x.name);const latest=arr=>arr.slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).at(-1);const exact=store.filter(x=>normName(x.name)===want);if(exact.length)return {p:latest(exact)};const names=[...new Set(store.filter(x=>normName(x.name).includes(want)).map(x=>x.name))];if(names.length===1)return {p:latest(store.filter(x=>x.name===names[0]))};if(names.length>1)return {ambiguous:names};return null;};
    let r=look();if(r)return r;
    await scanStatChannel(want).catch(e=>console.error('[scout channel scan]',e.message));r=look();if(r)return r;
    const reg=read('prospects',[]).filter(x=>x?.data?.name&&normName(x.data.name)===want).at(-1);
    if(reg){await createProspectSheet(reg.data).catch(e=>console.error('[scout backfill]',e.message));r=look();if(r)return r;}
    return null;}
  // Auto Players of the Week (called by franchise.js). entries: [{userId, line}]
  async function postPlayersOfWeek(channel,week,entries){
    const users=entries.map(e=>e.userId);
    const rec={week,users,claimed:{},lines:Object.fromEntries(entries.map(e=>[e.userId,e.line])),channelId:channel.id,messageId:null,createdAt:Date.now(),auto:true};
    const embed=new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 Players of the Week — ${week}`).setDescription(entries.map((e,n)=>`**${n+1}.** ${e.line} — <@${e.userId}>\n**+3 non-physical attribute**`).join('\n\n')+`\n\nEach coach gets ONE +3 to ONE non-physical attribute (no Speed, Acceleration, Agility, Strength, Jumping, Change of Direction, Stamina, or Injury) for ONE player. Press your button to claim.`).setFooter({text:'Auto-selected from the EA franchise box scores'}).setTimestamp();
    const rows=[new ActionRowBuilder().addComponents(...entries.map((e,n)=>new ButtonBuilder().setCustomId(`potw_claim:${e.userId}`).setLabel(`Claim #${n+1}`).setEmoji('🏆').setStyle(ButtonStyle.Primary)))];
    const sent=await channel.send({embeds:[embed],components:rows,allowedMentions:{users}});
    rec.messageId=sent.id;const arr=read('potw',[]);arr.push(rec);write('potw',arr);return sent;
  }
  return { createProspectSheet, postPlayersOfWeek };

};
