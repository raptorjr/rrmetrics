const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readChartTheme,saveChartTheme,resolveChartTheme}=require('./replayChartTheme');
test('chart theme follows the application unless explicitly overridden',()=>{
 const values=new Map();
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 assert.equal(readChartTheme(storage),'app');
 assert.equal(resolveChartTheme('app','light'),'light');
 assert.equal(resolveChartTheme('app','custom'),'dark');
 saveChartTheme('dark',storage);
 assert.equal(readChartTheme(storage),'dark');
 assert.equal(resolveChartTheme(readChartTheme(storage),'light'),'dark');
 saveChartTheme('light',storage);
 assert.equal(resolveChartTheme(readChartTheme(storage),'dark'),'light');
 saveChartTheme('app',storage);
 assert.equal(readChartTheme(storage),'app');
 assert.equal(resolveChartTheme(readChartTheme(storage),'light'),'light');
 assert.equal(readChartTheme({getItem:()=>{throw Error('blocked');}}),'app');
});
