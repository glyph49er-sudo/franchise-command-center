const test=require("node:test"),assert=require("node:assert");
const {generateProspect,_internal}=require("../prospectStats");
const base={name:"T",college:"U",height:"6'0\"",weight:"200",archetype:"x",strength1:"",strength2:"",strength3:"",weakness1:"Speed",weakness2:"Acceleration",comparison:"x"};
const POS=["QB","HB","FB","WR","TE","LT","LG","C","RG","RT","EDGE","DE","DT","NT","LB","OLB","CB","FS","SS","K","P","ATH"];
const exempt=new Set(["LT","LG","C","RG","RT","EDGE","DE","DT","NT"]);
function gen(position,devRoll,seed){let n=seed;const rng=()=>{n=(n*1664525+1013904223)%4294967296;return n/4294967296;};
  // first rng() call inside generateProspect is for attribute rolls, so rig dev by retrying until it matches
  for(let t=0;t<5000;t++){const g=generateProspect({...base,position},rng);if(g.development===devRoll)return g;}throw new Error("no roll");}
test("speed minimums by position and trait",()=>{
  const fastSkill=new Set(["WR","CB","S","HB"]);
  for(const pos of POS)for(const dev of ["Normal","Star","Superstar","X-Factor"])for(let s=1;s<=60;s++){
    const g=gen(pos,dev,s),sp=g.stats.Speed,ac=g.stats.Acceleration;
    if(g.position==="WR"){
      const accMin=dev==="Superstar"||dev==="X-Factor"?89:86;
      const spdMin=Math.max(88,accMin);
      assert.ok(sp>=spdMin&&ac>=accMin,`WR ${dev} ${sp}/${ac}`);
    }else if(fastSkill.has(g.position)){
      assert.ok(sp>=88,`${pos} (${g.position}) ${sp}`);
    }else if(!exempt.has(pos)){
      assert.ok(sp>=85,`${pos} ${sp}`);
    }
  }
});
test("X-Factor physicals are 90+ and Star/Superstar floors hold",()=>{
  for(let s=1;s<=80;s++){const g=gen("CB","X-Factor",s);for(const c of ["SPD","STR","AGI","ACC","COD","JMP","STA","INJ","TGH"])assert.ok(g.ratings[c]>=90&&g.ratings[c]<=99,c);}
  for(let s=1;s<=80;s++){const g=gen("CB","Superstar",s);for(const c of ["SPD","STR","AGI","ACC","COD","JMP","STA","INJ","TGH"])assert.ok(g.ratings[c]>=84);}
});
test("all 54 attributes present, in range",()=>{const g=gen("WR","Star",3);assert.strictEqual(Object.keys(g.stats).length,54);for(const v of Object.values(g.stats))assert.ok(v>=40&&v<=99);});
test("free-text positions still get the 88 speed floor (WR/CB/S/RB)",()=>{
  const typed=["DB","Defensive Back","Nickel","Safety","Free Safety","Strong Safety","SS","FS","SAF","Corner","CB/S","Cornerback","RB","Running Back","Halfback","HB","Slot WR","WR/KR","Wide Out","Wr","Slot Receiver"];
  for(const pos of typed)for(const dev of ["Normal","Star","Superstar","X-Factor"])for(let s=1;s<=40;s++){
    const g=gen(pos,dev,s);
    assert.ok(g.stats.Speed>=88,`"${pos}" -> ${g.position} ${dev} speed ${g.stats.Speed}`);
  }
});
test("position parsing",()=>{
  const n=_internal.normalizePosition;
  assert.strictEqual(n("DB"),"CB");assert.strictEqual(n("Safety"),"S");assert.strictEqual(n("Slot WR"),"WR");
  assert.strictEqual(n("RB"),"HB");assert.strictEqual(n("Mike"),"LB");assert.strictEqual(n("xyz"),"ATH");
});
