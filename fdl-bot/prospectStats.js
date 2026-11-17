// Position-true Madden ratings for FDL prospects.
// Rule: a prospect is only strong in the attributes his POSITION uses.
//   core -> high (scales with dev trait), secondary -> moderate, everything else -> low.
// Physicals: Superstar and X-Factor get elite physicals; Stars stay solid.
const ATTRIBUTES = [
  ["SPD","Speed"],["STR","Strength"],["AGI","Agility"],["ACC","Acceleration"],["AWR","Awareness"],
  ["BTK","Break Tackle"],["TRK","Trucking"],["COD","Change of Direction"],["BCV","Ball Carrier Vision"],
  ["SFA","Stiff Arm"],["SPM","Spin Move"],["JKM","Juke Move"],["CAR","Carrying"],["CTH","Catching"],
  ["SRR","Short Route Running"],["MRR","Medium Route Running"],["DRR","Deep Route Running"],
  ["CIT","Catch in Traffic"],["SPC","Spectacular Catch"],["RLS","Release"],["JMP","Jumping"],
  ["THP","Throw Power"],["SAC","Throw Accuracy Short"],["MAC","Throw Accuracy Medium"],["DAC","Throw Accuracy Deep"],
  ["TOR","Throw on the Run"],["TUP","Throw Under Pressure"],["PAC","Play Action"],["BSK","Break Sack"],
  ["RBK","Run Block"],["RBP","Run Block Power"],["RBF","Run Block Finesse"],["PBK","Pass Block"],
  ["PBP","Pass Block Power"],["PBF","Pass Block Finesse"],["IBL","Impact Blocking"],["LBK","Lead Block"],
  ["TAK","Tackle"],["POW","Hit Power"],["PMV","Power Moves"],["FMV","Finesse Moves"],["BSH","Block Shedding"],
  ["PUR","Pursuit"],["PRC","Play Recognition"],["MCV","Man Coverage"],["ZCV","Zone Coverage"],["PRS","Press"],
  ["KPW","Kick Power"],["KAC","Kick Accuracy"],["RET","Kick Return"],["LSN","Long Snap"],["STA","Stamina"],
  ["INJ","Injury"],["TGH","Toughness"]
].map(([code,name]) => ({code,name}));
const BY_CODE = Object.fromEntries(ATTRIBUTES.map(a => [a.code,a]));
const PHYSICAL_CODES=["SPD","STR","AGI","ACC","COD","JMP","STA","INJ","TGH"];
const PHYS=new Set(PHYSICAL_CODES);
// phys tiers: K = key, G = good, L = not used by this position. STA/INJ/TGH default to G.
const POSITIONS = {
  QB:{core:["THP","SAC","MAC","DAC","TOR","TUP","PAC","BSK","AWR"],secondary:["CAR","BCV"],phys:{SPD:"G",ACC:"G",AGI:"G",COD:"G",STR:"L",JMP:"L"}},
  HB:{core:["BTK","TRK","BCV","SFA","SPM","JKM","CAR"],secondary:["CTH","SRR","MRR","CIT","RLS","RET","PBK","AWR"],phys:{SPD:"K",ACC:"K",AGI:"K",COD:"K",STR:"G",JMP:"G"}},
  FB:{core:["RBK","RBP","LBK","IBL","TRK","CAR"],secondary:["RBF","PBK","BTK","BCV","SFA","CTH","AWR"],phys:{STR:"K",SPD:"G",ACC:"G",AGI:"G",COD:"G",JMP:"L"}},
  WR:{core:["CTH","SRR","MRR","DRR","CIT","SPC","RLS"],secondary:["BCV","JKM","SPM","BTK","CAR","RET","AWR"],phys:{SPD:"K",ACC:"K",AGI:"K",COD:"K",JMP:"K",STR:"G"}},
  TE:{core:["CTH","SRR","MRR","CIT","SPC","RLS","RBK","IBL"],secondary:["DRR","RBP","RBF","PBK","PBP","PBF","BTK","TRK","BCV","CAR","AWR"],phys:{STR:"K",JMP:"K",SPD:"G",ACC:"G",AGI:"G",COD:"G"}},
  OL:{core:["RBK","RBP","RBF","PBK","PBP","PBF","IBL"],secondary:["LBK","AWR","LSN"],phys:{STR:"K",SPD:"L",ACC:"L",AGI:"L",COD:"L",JMP:"L"}},
  EDGE:{core:["PMV","FMV","BSH","PUR","TAK","POW","PRC"],secondary:["AWR","ZCV"],phys:{STR:"K",ACC:"K",SPD:"G",AGI:"G",COD:"G",JMP:"L"}},
  DT:{core:["PMV","FMV","BSH","TAK","POW","PUR","PRC"],secondary:["AWR"],phys:{STR:"K",ACC:"G",SPD:"L",AGI:"L",COD:"L",JMP:"L"}},
  LB:{core:["TAK","POW","BSH","PUR","PRC","ZCV","MCV"],secondary:["PMV","FMV","PRS","CTH","AWR"],phys:{SPD:"K",ACC:"K",STR:"K",AGI:"G",COD:"G",JMP:"G"}},
  CB:{core:["MCV","ZCV","PRS","PRC"],secondary:["PUR","TAK","POW","CTH","SPC","RET","AWR"],phys:{SPD:"K",ACC:"K",AGI:"K",COD:"K",JMP:"K",STR:"G"}},
  S:{core:["ZCV","MCV","PRC","PUR","TAK","POW"],secondary:["PRS","BSH","CTH","SPC","RET","AWR"],phys:{SPD:"K",ACC:"K",AGI:"K",COD:"K",JMP:"G",STR:"G"}},
  K:{core:["KPW","KAC"],secondary:["AWR"],phys:{SPD:"L",ACC:"L",AGI:"L",COD:"L",STR:"L",JMP:"L"}},
  P:{core:["KPW","KAC"],secondary:["AWR"],phys:{SPD:"L",ACC:"L",AGI:"L",COD:"L",STR:"L",JMP:"L"}},
  ATH:{core:["BCV","CTH","TAK","PRC","CAR"],secondary:["AWR","BTK","JKM","SRR","MCV","ZCV","PUR","RET"],phys:{SPD:"K",ACC:"K",AGI:"K",COD:"K",STR:"G",JMP:"G"}}
};
for (const [k,p] of Object.entries(POSITIONS)) { p.label=k; for (const c of ["STA","INJ","TGH"]) p.phys[c] ||= "G"; }
const POSITION_ALIASES = {
  QB:"QB",QUARTERBACK:"QB",HB:"HB",RB:"HB",RUNNINGBACK:"HB",HALFBACK:"HB",TAILBACK:"HB",FB:"FB",FULLBACK:"FB",
  WR:"WR",WIDERECEIVER:"WR",RECEIVER:"WR",TE:"TE",TIGHTEND:"TE",LT:"OL",RT:"OL",LG:"OL",RG:"OL",C:"OL",OL:"OL",
  OFFENSIVELINE:"OL",OFFENSIVELINEMAN:"OL",TACKLE:"OL",GUARD:"OL",CENTER:"OL",EDGE:"EDGE",EDGERUSHER:"EDGE",DE:"EDGE",
  LE:"EDGE",RE:"EDGE",LEDG:"EDGE",REDG:"EDGE",DEFENSIVEEND:"EDGE",RUSHEND:"EDGE",DT:"DT",NT:"DT",DEFENSIVETACKLE:"DT",NOSETACKLE:"DT",
  LB:"LB",MLB:"LB",OLB:"LB",ILB:"LB",LOLB:"LB",ROLB:"LB",LINEBACKER:"LB",CB:"CB",CORNER:"CB",CORNERBACK:"CB",
  S:"S",FS:"S",SS:"S",SAFETY:"S",FREESAFETY:"S",STRONGSAFETY:"S",K:"K",KICKER:"K",P:"P",PUNTER:"P",ATH:"ATH",ATHLETE:"ATH",
  DB:"CB",DEFENSIVEBACK:"CB",NICKEL:"CB",NICKELBACK:"CB",SLOTCB:"CB",CB1:"CB",CB2:"CB",CB3:"CB",
  SAF:"S",SAFE:"S",SAFETIES:"S",SS1:"S",FS1:"S",
  WIDEOUT:"WR",SLOT:"WR",SLOTWR:"WR",SLOTRECEIVER:"WR",WR1:"WR",WR2:"WR",WR3:"WR",
  RUNNINGBACKS:"HB",RB1:"HB",HB1:"HB",MIKE:"LB",WILL:"LB",SAM:"LB",BACKER:"LB",OT:"OL",OG:"OL",IOL:"OL",PK:"K",LS:"OL"
};
const norm = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g,"");
const FAST_POSITION_TOKENS=new Set(["WR","CB","S","HB"]);
function normalizePosition(value) {
  const raw = norm(value); if (POSITION_ALIASES[raw]) return POSITION_ALIASES[raw];
  const tokens = String(value || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const hits = [];
  for (let n = Math.min(3, tokens.length); n >= 1; n--)
    for (let i = 0; i + n <= tokens.length; i++) { const p = POSITION_ALIASES[tokens.slice(i, i + n).join("")]; if (p) hits.push(p); }
  const fast = hits.find(p => FAST_POSITION_TOKENS.has(p)); if (fast) return fast;
  if (hits.length) return hits[0];
  const match = Object.keys(POSITION_ALIASES).filter(k => k.length>3 && raw.includes(k)).sort((a,b)=>b.length-a.length)[0];
  return match ? POSITION_ALIASES[match] : "ATH";
}
const PHRASES = {
  ROUTERUNNING:["SRR","MRR","DRR"],SHORTROUTES:["SRR"],MEDIUMROUTES:["MRR"],DEEPROUTES:["DRR"],
  THROWACCURACY:["SAC","MAC","DAC"],ACCURATEPASSER:["SAC","MAC","DAC"],PASSINGACCURACY:["SAC","MAC","DAC"],
  STRONGARM:["THP"],BIGARM:["THP"],ARMSTRENGTH:["THP"],MOBILEQUARTERBACK:["TOR"],SCRAMBLING:["TOR"],POCKETPRESENCE:["TUP","BSK"],
  ELUSIVE:["BTK","JKM","SPM"],ELUSIVENESS:["BTK","JKM","SPM"],POWERBACK:["TRK","BTK"],SPEEDBACK:["SPD","ACC"],
  BALLSECURITY:["CAR"],SUREHANDS:["CTH","CIT"],CONTESTEDCATCH:["CIT"],HIGHPOINT:["JMP","SPC"],DEEPTHREAT:["DRR","SPD"],
  RUNBLOCKING:["RBK","RBP","RBF"],PASSBLOCKING:["PBK","PBP","PBF"],BLOCKING:["RBK","PBK"],PASSRUSH:["PMV","FMV"],
  RUNSTOPPER:["BSH","TAK"],RUNSUPPORT:["BSH","PUR","TAK"],COVERAGE:["MCV","ZCV"],BALLHAWK:["PRC","CTH"],
  HARDHITTER:["POW"],TACKLING:["TAK"],FIELDVISION:["BCV","AWR"],DURABLE:["STA","INJ","TGH"],DURABILITY:["STA","INJ","TGH"],
  ATHLETICISM:["SPD","ACC","AGI"],EXPLOSIVE:["ACC"]
};
function resolveTrait(text) {
  const compact=norm(text), found=new Set(); if(!compact) return [];
  for(const [phrase,codes] of Object.entries(PHRASES)) if(compact.includes(norm(phrase))) codes.forEach(c=>found.add(c));
  for(const a of ATTRIBUTES) if(compact.includes(norm(a.name)) || compact===a.code) found.add(a.code);
  return [...found];
}
function parseHeightInches(value) {
  const s=String(value||"").trim();
  const m=s.match(/^(\d)\s*(?:'|’|ft\.?|feet)\s*(\d{1,2})/i)||s.match(/^(\d)\s*[- ]\s*(\d{1,2})$/);
  if(m) return Number(m[1])*12+Number(m[2]); if(/^\d{2}$/.test(s)) return Number(s); return null;
}
const randomInt=(rng,min,max)=>min+Math.floor(rng()*(max-min+1));
const clamp=n=>Math.max(20,Math.min(99,Math.round(n)));
function rollDevelopment(rng=Math.random){const r=rng();return r<.35?"Normal":r<.70?"Star":r<.90?"Superstar":"X-Factor";}
const BANDS = {
  core:      {Normal:[78,87],Star:[81,90],Superstar:[86,94],"X-Factor":[89,97]},
  secondary: {Normal:[58,72],Star:[62,75],Superstar:[66,78],"X-Factor":[70,82]},
  other:     {Normal:[22,48],Star:[24,50],Superstar:[26,52],"X-Factor":[28,54]},
  K:         {Normal:[80,88],Star:[85,91],Superstar:[90,97],"X-Factor":[93,99]},
  G:         {Normal:[74,84],Star:[80,88],Superstar:[90,96],"X-Factor":[92,98]},
  L:         {Normal:[52,66],Star:[56,69],Superstar:[62,74],"X-Factor":[66,78]}
};
const OTHER_CAP=66, SECONDARY_CAP=86;
const ELITE_DEV=new Set(["Superstar","X-Factor"]);
const SPEED_MIN_DEFAULT=85;
const SPEED_EXEMPT_POSITIONS=new Set(["EDGE","DT","OL","K","P"]);
const FAST_SKILL_POSITIONS=new Set(["WR","CB","S","HB"]);
const FAST_SKILL_SPEED_MIN=88, WR_SPEED_ACC_MIN=86, WR_ELITE_SPEED_ACC_MIN=89;
function tierOf(code,profile){
  if(PHYS.has(code)) return profile.phys[code]||"G";
  if(profile.core.includes(code)) return "core";
  if(profile.secondary.includes(code)) return "secondary";
  return "other";
}
function applySpeedRules(ratings,position,development){
  if(position==="WR"){
    const eliteMin=ELITE_DEV.has(development)?WR_ELITE_SPEED_ACC_MIN:WR_SPEED_ACC_MIN;
    ratings.SPD=Math.max(ratings.SPD,FAST_SKILL_SPEED_MIN,eliteMin);
    ratings.ACC=Math.max(ratings.ACC,eliteMin);
  }else if(FAST_SKILL_POSITIONS.has(position)) ratings.SPD=Math.max(ratings.SPD,FAST_SKILL_SPEED_MIN);
  else if(!SPEED_EXEMPT_POSITIONS.has(position)) ratings.SPD=Math.max(ratings.SPD,SPEED_MIN_DEFAULT);
  for(const code of Object.keys(ratings))ratings[code]=Math.min(99,ratings[code]);
}
function generateRatings(data,development,rng=Math.random){
  const position=normalizePosition(data.position),profile=POSITIONS[position];
  const strengthCodes=new Set([data.strength1,data.strength2,data.strength3].flatMap(resolveTrait));
  const weaknessCodes=new Set([data.weakness1,data.weakness2].flatMap(resolveTrait));
  const inches=parseHeightInches(data.height),ratings={},tiers={};
  for(const a of ATTRIBUTES){const t=tierOf(a.code,profile);tiers[a.code]=t;const [lo,hi]=BANDS[t][development];ratings[a.code]=randomInt(rng,lo,hi);}
  if(inches!==null&&inches>=75){for(const [c,v] of [["JMP",2],["CIT",2],["SPC",2],["STR",2],["AGI",-2],["COD",-2]]) if(tiers[c]!=="other") ratings[c]+=v;}
  else if(inches!==null&&inches<=70){for(const [c,v] of [["AGI",2],["COD",2],["ACC",1],["JMP",-2],["TRK",-1]]) if(tiers[c]!=="other") ratings[c]+=v;}
  for(const code of weaknessCodes){
    if(strengthCodes.has(code))continue;const t=tiers[code];
    if(t==="core")ratings[code]=randomInt(rng,70,77);
    else if(t==="secondary")ratings[code]=randomInt(rng,48,58);
    else if(PHYS.has(code))ratings[code]-=randomInt(rng,4,8);
    else ratings[code]=randomInt(rng,20,35);
  }
  for(const code of strengthCodes){
    const t=tiers[code];
    if(t==="core")ratings[code]=Math.max(ratings[code],randomInt(rng,90,99));
    else if(t==="secondary")ratings[code]=Math.max(ratings[code],randomInt(rng,78,86));
    else if(t==="K"||t==="G")ratings[code]=Math.max(ratings[code]+randomInt(rng,2,4),ELITE_DEV.has(development)?93:88);
    else if(t==="L")ratings[code]+=randomInt(rng,3,6);
    else ratings[code]=Math.max(ratings[code],randomInt(rng,56,OTHER_CAP));
  }
  for(const code of Object.keys(ratings)){ratings[code]=clamp(ratings[code]);if(tiers[code]==="other")ratings[code]=Math.min(ratings[code],OTHER_CAP);if(tiers[code]==="secondary")ratings[code]=Math.min(ratings[code],SECONDARY_CAP);}
  return{ratings,tiers,strengthCodes:[...strengthCodes],weaknessCodes:[...weaknessCodes],core:profile.core,secondary:profile.secondary,position};
}
function keyCodes(position){const p=POSITIONS[position]||POSITIONS.ATH;return [...new Set([...p.core,...Object.entries(p.phys).filter(([,t])=>t==="K").map(([c])=>c)])];}
function overallFor(ratings,position){const k=keyCodes(position);return Math.round(k.reduce((a,c)=>a+ratings[c],0)/k.length);}
function generateProspect(data,rng=Math.random){
  const development=rollDevelopment(rng);
  const g=generateRatings(data,development,rng);
  applySpeedRules(g.ratings,g.position,development);
  const stats=Object.fromEntries(ATTRIBUTES.map(a=>[a.name,g.ratings[a.code]]));
  return{ratings:g.ratings,stats,development,position:g.position,core:g.core,secondary:g.secondary,tiers:g.tiers,overall:overallFor(g.ratings,g.position)};
}
function keyStatNames(position){return keyCodes(normalizePosition(position)).map(c=>BY_CODE[c].name);}
module.exports={ATTRIBUTES,POSITIONS,BY_CODE,PHYSICAL_CODES,generateProspect,keyStatNames,normalizePosition,overallFor,
  _internal:{normalizePosition,resolveTrait,parseHeightInches,generateRatings,rollDevelopment,applySpeedRules,norm,tierOf,BANDS}};
