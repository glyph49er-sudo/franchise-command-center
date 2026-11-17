// Position-balanced Madden ratings for FDL prospects (ported from the TML bot, with FDL rule changes).
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
const POSITIONS = {
  QB:{label:"QB",core:["SAC","MAC","DAC","THP","TOR","TUP","PAC","AWR","BSK"]},
  HB:{label:"HB",core:["BTK","TRK","BCV","SFA","SPM","JKM","CAR","CTH","AWR","COD"]},
  FB:{label:"FB",core:["RBK","RBP","RBF","IBL","LBK","TRK","BCV","CAR","CTH"]},
  WR:{label:"WR",core:["SRR","MRR","DRR","CTH","CIT","SPC","RLS","BCV","JKM","SPM"]},
  TE:{label:"TE",core:["CTH","SRR","MRR","CIT","SPC","RLS","RBK","RBF","PBK","IBL"]},
  OL:{label:"OL",core:["RBK","RBP","RBF","PBK","PBP","PBF","IBL","LBK","AWR"]},
  EDGE:{label:"EDGE",core:["PMV","FMV","BSH","PUR","PRC","TAK","POW","AWR"]},
  DT:{label:"DT",core:["PMV","FMV","BSH","TAK","POW","PRC","PUR","AWR"]},
  LB:{label:"LB",core:["TAK","POW","BSH","PUR","PRC","MCV","ZCV","PRS","AWR"]},
  CB:{label:"CB",core:["MCV","ZCV","PRS","PRC","PUR","TAK","CTH","SPC","AWR"]},
  S:{label:"S",core:["MCV","ZCV","PRC","PUR","TAK","POW","BSH","CTH","AWR"]},
  K:{label:"K",core:["KPW","KAC","AWR"]}, P:{label:"P",core:["KPW","KAC","AWR"]},
  ATH:{label:"ATH",core:["AWR","BCV","CTH","TAK","PRC","CAR"]}
};
const POSITION_ALIASES = {
  QB:"QB",QUARTERBACK:"QB",HB:"HB",RB:"HB",RUNNINGBACK:"HB",HALFBACK:"HB",TAILBACK:"HB",FB:"FB",FULLBACK:"FB",
  WR:"WR",WIDERECEIVER:"WR",RECEIVER:"WR",TE:"TE",TIGHTEND:"TE",LT:"OL",RT:"OL",LG:"OL",RG:"OL",C:"OL",OL:"OL",
  OFFENSIVELINE:"OL",OFFENSIVELINEMAN:"OL",TACKLE:"OL",GUARD:"OL",CENTER:"OL",EDGE:"EDGE",EDGERUSHER:"EDGE",DE:"EDGE",
  LE:"EDGE",RE:"EDGE",DEFENSIVEEND:"EDGE",RUSHEND:"EDGE",DT:"DT",NT:"DT",DEFENSIVETACKLE:"DT",NOSETACKLE:"DT",
  LB:"LB",MLB:"LB",OLB:"LB",ILB:"LB",LOLB:"LB",ROLB:"LB",LINEBACKER:"LB",CB:"CB",CORNER:"CB",CORNERBACK:"CB",
  S:"S",FS:"S",SS:"S",SAFETY:"S",FREESAFETY:"S",STRONGSAFETY:"S",K:"K",KICKER:"K",P:"P",PUNTER:"P",ATH:"ATH",ATHLETE:"ATH"
};
const norm = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g,"");
// Extra free-text spellings people type into the prospect form.
Object.assign(POSITION_ALIASES,{
  DB:"CB",DEFENSIVEBACK:"CB",NICKEL:"CB",NICKELBACK:"CB",SLOTCB:"CB",CB1:"CB",CB2:"CB",CB3:"CB",
  SAF:"S",SAFE:"S",SAFETIES:"S",SS1:"S",FS1:"S",
  WIDEOUT:"WR",SLOT:"WR",SLOTWR:"WR",SLOTRECEIVER:"WR",WR1:"WR",WR2:"WR",WR3:"WR",
  RUNNINGBACKS:"HB",RB1:"HB",HB1:"HB",
  MIKE:"LB",WILL:"LB",SAM:"LB",BACKER:"LB",
  OT:"OL",OG:"OL",IOL:"OL",
  PK:"K",LS:"OL"
});
const FAST_POSITION_TOKENS=new Set(["WR","CB","S","HB"]);
function normalizePosition(value) {
  const raw = norm(value); if (POSITION_ALIASES[raw]) return POSITION_ALIASES[raw];
  // Multi-word / multi-position entries ("Slot WR", "CB/S", "WR/KR", "Wide Out"): look at each word.
  const tokens = String(value || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const hits = [];
  for (let n = Math.min(3, tokens.length); n >= 1; n--)       // try phrases first ("FREE SAFETY"), then single words
    for (let i = 0; i + n <= tokens.length; i++) { const p = POSITION_ALIASES[tokens.slice(i, i + n).join("")]; if (p) hits.push(p); }
  // If a prospect lists several spots and any of them is a fast-skill spot, treat him as that spot so the speed floor applies.
  const fast = hits.find(p => FAST_POSITION_TOKENS.has(p)); if (fast) return fast;
  if (hits.length) return hits[0];
  const match = Object.keys(POSITION_ALIASES).filter(k => k.length>3 && raw.includes(k)).sort((a,b)=>b.length-a.length)[0];
  return match ? POSITION_ALIASES[match] : "ATH";
}
const PHRASES = {
  ROUTERUNNING:["SRR","MRR","DRR"],SHORTROUTES:["SRR"],MEDIUMROUTES:["MRR"],DEEPROUTES:["DRR"],
  THROWACCURACY:["SAC","MAC","DAC"],ACCURATEPASSER:["SAC","MAC","DAC"],PASSINGACCURACY:["SAC","MAC","DAC"],
  STRONGARM:["THP"],BIGARM:["THP"],MOBILEQUARTERBACK:["TOR"],SCRAMBLING:["TOR"],POCKETPRESENCE:["TUP","BSK"],
  ELUSIVE:["BTK","JKM","SPM"],ELUSIVENESS:["BTK","JKM","SPM"],POWERBACK:["TRK","BTK"],SPEEDBACK:["SPD","ACC"],
  BALLSECURITY:["CAR"],SUREHANDS:["CTH","CIT"],CONTESTEDCATCH:["CIT"],HIGHPOINT:["JMP","SPC"],DEEPTHREAT:["DRR","SPD"],
  RUNBLOCKING:["RBK","RBP","RBF"],PASSBLOCKING:["PBK","PBP","PBF"],BLOCKING:["RBK","PBK"],PASSRUSH:["PMV","FMV"],
  RUNSTOPPER:["BSH","TAK"],RUNSUPPORT:["BSH","PUR","TAK"],COVERAGE:["MCV","ZCV"],BALLHAWK:["PRC","CTH"],
  HARDHITTER:["POW"],TACKLING:["TAK"],FIELDVISION:["BCV","AWR"],DURABLE:["STA","INJ","TGH"],DURABILITY:["STA","INJ","TGH"]
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
const clamp=n=>Math.max(40,Math.min(99,n));
function rollDevelopment(rng=Math.random){const r=rng();return r<.35?"Normal":r<.70?"Star":r<.90?"Superstar":"X-Factor";}

const PHYSICAL_CODES=["SPD","STR","AGI","ACC","COD","JMP","STA","INJ","TGH"];
// X-Factors get a noticeably higher physical grade: floor 90, and each physical stat rolls 90-98.
const DEVELOPMENT_FLOORS={"X-Factor":{physical:90,position:88},Superstar:{physical:84,position:84},Star:{physical:80,position:78}};
const XFACTOR_PHYSICAL_MAX=98;

// Minimum speed rules.
const SPEED_MIN_DEFAULT=85;                      // everyone...
const SPEED_EXEMPT_POSITIONS=new Set(["EDGE","DT","OL"]); // ...except EDGE, DT, and OL (LT, LG, C, RG, RT)
const FAST_SKILL_POSITIONS=new Set(["WR","CB","S","HB"]); // WR, CB, SS/FS (S), and RB (HB) minimum 88 SPD
const FAST_SKILL_SPEED_MIN=88;
const WR_SPEED_ACC_MIN=86;                       // WR minimum for ACC
const WR_ELITE_SPEED_ACC_MIN=89;                 // Superstar / X-Factor WR minimum for SPD and ACC

function applyDevelopmentFloors(ratings,core,development,rng=Math.random){
  const floors=DEVELOPMENT_FLOORS[development];if(!floors)return;
  for(const code of PHYSICAL_CODES){
    if(development==="X-Factor")ratings[code]=Math.max(ratings[code],randomInt(rng,floors.physical,XFACTOR_PHYSICAL_MAX));
    else ratings[code]=Math.max(floors.physical,ratings[code]);
  }
  for(const code of core)ratings[code]=Math.max(floors.position,ratings[code]);
}
function applySpeedRules(ratings,position,development){
  if(position==="WR"){
    const eliteMin=(development==="Superstar"||development==="X-Factor")?WR_ELITE_SPEED_ACC_MIN:WR_SPEED_ACC_MIN;
    ratings.SPD=Math.max(ratings.SPD,FAST_SKILL_SPEED_MIN,eliteMin);
    ratings.ACC=Math.max(ratings.ACC,eliteMin);
  }else if(FAST_SKILL_POSITIONS.has(position)){
    ratings.SPD=Math.max(ratings.SPD,FAST_SKILL_SPEED_MIN);
  }else if(!SPEED_EXEMPT_POSITIONS.has(position)){
    ratings.SPD=Math.max(ratings.SPD,SPEED_MIN_DEFAULT);
  }
  for(const code of Object.keys(ratings))ratings[code]=Math.min(99,ratings[code]);
}
function generateRatings(data,rng=Math.random){
  const position=normalizePosition(data.position),core=POSITIONS[position].core;
  const strengthCodes=new Set([data.strength1,data.strength2,data.strength3].flatMap(resolveTrait));
  const weaknessCodes=new Set([data.weakness1,data.weakness2].flatMap(resolveTrait));
  const inches=parseHeightInches(data.height),ratings={};
  for(const a of ATTRIBUTES) ratings[a.code]=randomInt(rng,58,89);
  for(const code of core) ratings[code]=randomInt(rng,80,95);
  if(inches!==null&&inches>=75){
    for(const [code,amount] of [["JMP",3],["CIT",2],["SPC",2],["STR",2],["AGI",-2],["COD",-2]]) ratings[code]+=amount;
    if(["WR","TE"].includes(position)){ratings.CTH+=2;ratings.RLS+=1;}
    if(["OL","DT"].includes(position)){ratings.PBP+=2;ratings.RBP+=2;}
  }else if(inches!==null&&inches<=70){for(const [code,amount] of [["AGI",2],["COD",3],["ACC",1],["JMP",-2],["TRK",-1]])ratings[code]+=amount;}
  for(const code of Object.keys(ratings))ratings[code]=clamp(ratings[code]);
  for(const code of weaknessCodes)if(!strengthCodes.has(code))ratings[code]=core.includes(code)?randomInt(rng,80,84):randomInt(rng,70,79);
  for(const code of strengthCodes)ratings[code]=randomInt(rng,87,99);
  for(const code of core)ratings[code]=Math.max(80,ratings[code]);
  return{ratings,strengthCodes:[...strengthCodes],weaknessCodes:[...weaknessCodes],core,position};
}
// Returns { ratings (by code), stats (by full attribute name), development, position }.
function generateProspect(data,rng=Math.random){
  const g=generateRatings(data,rng),development=rollDevelopment(rng);
  applyDevelopmentFloors(g.ratings,g.core,development,rng);
  applySpeedRules(g.ratings,g.position,development);
  const stats=Object.fromEntries(ATTRIBUTES.map(a=>[a.name,g.ratings[a.code]]));
  return{ratings:g.ratings,stats,development,position:g.position,core:g.core};
}
module.exports={ATTRIBUTES,POSITIONS,BY_CODE,generateProspect,
  _internal:{normalizePosition,resolveTrait,parseHeightInches,generateRatings,rollDevelopment,applyDevelopmentFloors,applySpeedRules,norm}};
