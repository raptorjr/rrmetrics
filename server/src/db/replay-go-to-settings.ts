import type { Db } from './connection';
const BUILT_INS = ['asian','london','new-york','next-day'];
interface GoToOption { id:string;label:string;time:string;enabled:boolean }
interface GoToSettings { version:1;options:GoToOption[] }
export function validateGoToSettings(input:unknown):GoToSettings|null {
  if(!input||typeof input!=='object')return null;
  const v=input as {version?:unknown;options?:unknown};
  if(v.version!==1||!Array.isArray(v.options)||v.options.length<4||v.options.length>24)return null;
  const options:GoToOption[]=[],ids=new Set<string>();
  for(const item of v.options){
    if(!item||typeof item!=='object')return null;
    const {id,label,time,enabled}=item;
    if(typeof id!=='string'||!(/^[a-zA-Z0-9_-]{1,80}$/.test(id))||ids.has(id)||
      typeof label!=='string'||!label.trim()||label.length>80||
      typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||typeof enabled!=='boolean')return null;
    ids.add(id);options.push({id,label:label.trim(),time,enabled});
  }
  if(!BUILT_INS.every(id=>ids.has(id)))return null;
  return {version:1,options};
}
export function readGoToSettings(db:Db,userId:string):GoToSettings|null {
  const row=db.prepare('SELECT settings_json FROM replay_go_to_settings WHERE user_id=?').get(userId) as {settings_json:string}|undefined;
  if(!row)return null;
  const value=validateGoToSettings(JSON.parse(row.settings_json));
  if(!value)throw Error('Invalid stored Go to settings.');
  return value;
}
export function saveGoToSettings(db:Db,userId:string,settings:GoToSettings):void {
  db.prepare('INSERT INTO replay_go_to_settings (user_id,settings_json,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at')
    .run(userId,JSON.stringify(settings),new Date().toISOString());
}
