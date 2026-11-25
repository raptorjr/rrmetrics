import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { validateGoToSettings,readGoToSettings,saveGoToSettings } from '../db/replay-go-to-settings';
test('Go to preferences are validated, independently persisted and owner scoped',()=>{
  const db=new Database(':memory:');
  try{
    db.pragma('foreign_keys=ON');
    const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');db.exec(schema);
    for(const id of ['a','b'])db.prepare('INSERT INTO profiles (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(id,id+'@example.test','','2026-01-01');
    const options=['asian','london','new-york','next-day'].map(id=>({id,label:id,time:'02:00',enabled:true}));
    const settings=validateGoToSettings({version:1,options});assert.ok(settings);
    const local=validateGoToSettings({version:1,options:options.map(x=>({...x,timeZone:'Europe/Oslo'}))});assert.ok(local);
    assert.equal(validateGoToSettings({version:1,options:options.map(x=>({...x,timeZone:'Not/AZone'}))}),null);
    saveGoToSettings(db,'a',local);assert.equal(readGoToSettings(db,'b'),null);
    db.exec(schema);assert.deepEqual(readGoToSettings(db,'a'),local);
    assert.equal(validateGoToSettings({version:1,options:options.slice(1)}),null);
    assert.equal(validateGoToSettings({version:1,options:[...options,{...options[0]}]}),null);
    assert.equal(validateGoToSettings({version:1,options:options.map(x=>({...x,time:'25:00'}))}),null);
  }finally{db.close();}
});
