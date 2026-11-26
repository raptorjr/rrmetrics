const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('application source does not use blocking browser alert, confirm or prompt',()=>{
 const violations=[];
 const walk=dir=>{
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const p=path.join(dir,entry.name);
   if(entry.isDirectory()){if(!['node_modules','vendor','dist','build'].includes(entry.name))walk(p);continue;}
   if(!/\.(jsx?|tsx?)$/.test(entry.name)||/\.test\./.test(entry.name))continue;
   const lines=fs.readFileSync(p,'utf8').split('\n');
   lines.forEach((line,i)=>{
    if(/^\s*(?:\/\/|\*)/.test(line))return;
    if(/\b(?:window\s*\.\s*|globalThis\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/.test(line))violations.push(path.relative(path.join(__dirname,'..'),p)+':'+(i+1)+' '+line.trim());
   });
  }
 };
 walk(path.join(__dirname,'..'));
 assert.deepEqual(violations,[]);
});
