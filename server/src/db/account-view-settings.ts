import type { Db } from './connection';
const NONE='__rrmetrics_no_accounts__';
export interface AccountViewSettings { version:1; mode:'trading'|'backtesting'; trading:string[]; backtesting:string[] }
export function validateAccountView(input:unknown):AccountViewSettings|null {
  if(!input||typeof input!=='object')return null;
  const x=input as Partial<AccountViewSettings>;
  const valid=(a:unknown,backtest:boolean):a is string[]=>Array.isArray(a)&&a.length<=10000&&a.every(k=>typeof k==='string'&&k.length>0&&k.length<=512&&(k===NONE||(backtest?k.startsWith('replay::'):!k.startsWith('replay::'))))&&(!a.includes(NONE)||a.length===1);
  if(x.version!==1||(x.mode!=='trading'&&x.mode!=='backtesting')||!valid(x.trading,false)||!valid(x.backtesting,true))return null;
  return {version:1,mode:x.mode,trading:[...new Set(x.trading)],backtesting:[...new Set(x.backtesting)]};
}
export function readAccountView(db:Db,owner:string):AccountViewSettings|null{
  const row=db.prepare('SELECT settings_json FROM account_view_settings WHERE user_id=?').get(owner) as {settings_json:string}|undefined;
  if(!row)return null;
  const value=validateAccountView(JSON.parse(row.settings_json));
  if(!value)throw Error('Invalid account view settings.');
  return value;
}
export function saveAccountView(db:Db,owner:string,value:AccountViewSettings){
  db.prepare('INSERT INTO account_view_settings(user_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').run(owner,JSON.stringify(value),new Date().toISOString());
}
