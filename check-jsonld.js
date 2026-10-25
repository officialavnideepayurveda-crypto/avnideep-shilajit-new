const fs=require('fs');
const h=fs.readFileSync('index.html','utf8');
const re=/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const matches=[];
let m;
while((m=re.exec(h))){ matches.push(m[1]); }
console.log('JSON-LD blocks:',matches.length);
matches.forEach((b)=>{
  const inner=b.replace(/^[\s\r\n]+/,'').replace(/[\s\r\n]+$/,'').replace(/[/][/]/g,'');
  try{
    JSON.parse(inner);
    console.log('VALID-JSON');
  }catch(e){
    console.log('INVALID-JSON :: '+b.slice(0,150).replace(/\s+/g,' '));
  }
});
