const test=require("node:test"),assert=require("node:assert");
const {generateProspect,_internal}=require("../prospectStats");
const base={name:"T",college:"U",height:"6'0\"",weight:"200",archetype:"x",strength1:"",strength2:"",strength3:"",weakness1:"Speed",weakness2:"Acceleration",comparison:"x"};
const POS=["QB","HB","FB","WR","TE","LT","LG","C","RG","RT","EDGE","DE","DT","NT","LB","OLB","CB","FS","SS","K","P","ATH"];
const exempt=new Set(["LT","LG","C","RG","RT","EDGE","DE","DT","NT","K","P"]);
function gen(position,devRoll,seed,extra={}){let n=seed;const rng=()=>{n=(n*1664525+1013904223)%4294967296;return n/4294967296;};
  for(let t=0;t<5000;t++){const g=generateProspect({...base,...extra,position},rng);if(g.development===devRoll)return g;}throw new Error("no roll");}
const DEVS=["Normal","Star","Superstar","X-Factor"];
test("speed minimums by position and trait",()=>{
  const fast=new Set(["WR","CB","S","HB"]);
  for(const pos of POS)for(const dev of DEVS)for(let s=1;s<=30;s++){
    const g=gen(pos,dev,s),sp=g.stats.Speed,ac=g.stats.Acceleration;
    if(g.position==="WR"){const m=dev==="Superstar"||dev==="X-Factor"?89:86;assert.ok(sp>=Math.max(88,m)&&ac>=m,`WR ${dev} ${sp}/${ac}`);}
    else if(fast.has(g.position))assert.ok(sp>=88,`${pos} ${sp}`);
    else if(!exempt.has(pos))assert.ok(sp>=85,`${pos} ${sp}`);
  }
});
test("a CB never gets QB/OL/kicker stats, even if listed as strengths",()=>{
  for(const dev of DEVS)for(let s=1;s<=50;s++){
    const g=gen("CB",dev,s,{strength1:"Throw Power",strength2:"Pass Block",strength3:"Kick Power"});
    for(const k of ["Throw Power","Throw Accuracy Deep","Pass Block","Run Block","Kick Power","Power Moves"])assert.ok(g.stats[k]<=66,`CB ${dev} ${k}=${g.stats[k]}`);
    assert.ok(g.stats["Man Coverage"]>=78);
  }
});
test("off-position stats stay low",()=>{
  for(const [pos,bad] of [["QB","Tackle"],["OL","Catching"],["DT","Throw Power"],["WR","Block Shedding"],["K","Man Coverage"],["S","Pass Block Power"]])
    for(let s=1;s<=30;s++)assert.ok(gen(pos,"X-Factor",s).stats[bad]<=66,`${pos} ${bad}`);
});
test("Superstar/X-Factor physicals elite (90+); Star physicals 80+",()=>{
  const phys=["SPD","STR","AGI","ACC","COD","JMP","STA","INJ","TGH"],none={weakness1:"",weakness2:""};
  for(let s=1;s<=50;s++){
    for(const d of ["X-Factor","Superstar"]){const g=gen("CB",d,s,none);for(const c of phys)assert.ok(g.ratings[c]>=90,`${d} ${c}=${g.ratings[c]}`);}
    const st=gen("CB","Star",s,none);for(const c of phys)assert.ok(st.ratings[c]>=80,`Star ${c}=${st.ratings[c]}`);
    assert.ok(gen("OL","Superstar",s,none).ratings.STR>=90);
  }
});
test("all 54 attributes present, in range",()=>{const g=gen("WR","Star",3);assert.strictEqual(Object.keys(g.stats).length,54);for(const v of Object.values(g.stats))assert.ok(v>=20&&v<=99);});
test("free-text positions keep the 88 speed floor",()=>{
  for(const pos of ["DB","Nickel","Safety","Free Safety","SS","Corner","CB/S","RB","Running Back","Slot WR","WR/KR","Wide Out"])for(const dev of DEVS)for(let s=1;s<=15;s++)assert.ok(gen(pos,dev,s).stats.Speed>=88,pos);
});
test("position parsing",()=>{const n=_internal.normalizePosition;assert.strictEqual(n("DB"),"CB");assert.strictEqual(n("Safety"),"S");assert.strictEqual(n("RB"),"HB");assert.strictEqual(n("Mike"),"LB");assert.strictEqual(n("xyz"),"ATH");assert.strictEqual(n("REDG"),"EDGE");});
