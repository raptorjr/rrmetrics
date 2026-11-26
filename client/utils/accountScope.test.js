const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NO_ACCOUNTS,getTradeAccountKey}=require('./accountIdentity');
const {filterAccountDomain,filterReplayAccounts}=require('./accountScope');
const {calculateAnalytics,getTradePL}=require('./analytics');
test('account mode never mixes real and replay records, even for All and matching names',()=>{
  const real={account:'Practice',ticker:'NQ',manualPL:10,quantity:1,enterTime:'2026-01-01T00:00:00Z',exitTime:'2026-01-01T00:01:00Z'};
  const replay={...real,domain:'backtesting',replaySessionId:'a',manualPL:25,quantity:-2};
  const second={...replay,replaySessionId:'b',manualPL:-5};
  const all=[real,replay,second];
  assert.deepEqual(filterAccountDomain(all,'trading',[]),[real]);
  assert.deepEqual(filterAccountDomain(all,'backtesting',[]),[replay,second]);
  assert.deepEqual(filterAccountDomain(all,'backtesting',['replay::a']),[replay]);
  assert.deepEqual(filterAccountDomain(all,'backtesting',[NO_ACCOUNTS]),[]);
  assert.deepEqual(filterAccountDomain(all,'backtesting',['replay::deleted']),[]);
  assert.deepEqual(filterAccountDomain(all,'trading',['replay::a']),[]);
  assert.equal(getTradeAccountKey({...replay,account:'Renamed'}),'replay::a');
  assert.equal(getTradePL(replay),25);
  assert.equal(calculateAnalytics(filterAccountDomain(all,'backtesting',[])).totalPL,20);
  assert.deepEqual(filterReplayAccounts([{key:'replay::a'},{key:'replay::empty'}],['replay::empty']),[{key:'replay::empty'}]);
});


test('an explicit empty or missing replay selection never becomes All',()=>{
 const accounts=[{key:'replay::current',name:'Current'}];
 assert.deepEqual(filterReplayAccounts(accounts,['replay::removed']),[]);
 assert.deepEqual(filterReplayAccounts(accounts,[NO_ACCOUNTS]),[]);
 assert.deepEqual(filterReplayAccounts(accounts,[]),accounts);
});

test('multiple replay sessions share an account without merging real trade identity',()=>{
 const first={domain:'backtesting',replaySessionId:'old',replayAccountId:'a',manualPL:200};
 const second={...first,replaySessionId:'new',manualPL:-50};
 const other={...first,replayAccountId:'b'};
 assert.equal(getTradeAccountKey(second),'replay::a');
 assert.deepEqual(filterAccountDomain([first,second,other],'backtesting',['replay::a']),[first,second]);
});
