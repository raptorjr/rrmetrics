const KEY='rr:replay-chart-theme';
function normalizeChartTheme(value){return value==='light'||value==='dark'?value:'app';}
function resolveChartTheme(value,appTheme){const mode=normalizeChartTheme(value);return mode==='app'?(appTheme==='light'?'light':'dark'):mode;}
function readChartTheme(storage){try{return normalizeChartTheme((storage||localStorage).getItem(KEY));}catch{return 'app';}}
function saveChartTheme(value,storage){try{const s=storage||localStorage,mode=normalizeChartTheme(value);if(mode==='app')s.removeItem(KEY);else s.setItem(KEY,mode);}catch{}}
module.exports={normalizeChartTheme,resolveChartTheme,readChartTheme,saveChartTheme};
