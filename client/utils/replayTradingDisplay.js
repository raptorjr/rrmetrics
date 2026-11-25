const LABEL_UNITS = [
  { id: 'currency', label: 'Currency ($)' },
  { id: 'points', label: 'Points' },
  { id: 'ticks', label: 'Ticks' },
  { id: 'percent', label: 'Percentage' },
];
const DEFAULT_UNITS = ['currency'];

function normalizeTradingDisplay(value) {
  const chosen = LABEL_UNITS.map(unit => unit.id).filter(id => Array.isArray(value) && value.includes(id));
  return chosen.length ? chosen : DEFAULT_UNITS.slice();
}
const SETTINGS_URL = '/api/backtesting/chart-settings';
async function loadTradingDisplay(request) {
  const response = await request(SETTINGS_URL);
  if (!response.ok) throw new Error('Could not load trading settings.');
  const data = await response.json();
  return normalizeTradingDisplay(data.settings?.labelUnits);
}
async function saveTradingDisplay(units, request) {
  const response = await request(SETTINGS_URL, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, labelUnits: normalizeTradingDisplay(units) }),
  });
  if (!response.ok) throw new Error('Could not save trading settings.');
  const data = await response.json();
  return normalizeTradingDisplay(data.settings.labelUnits);
}
function signed(value, digits, suffix = '', prefix = '', unsigned = false) {
  const absolute = Math.abs(value);
  const number = absolute.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = unsigned || Number(number.replaceAll(',', '')) === 0 ? '' : value < 0 ? '-' : '+';
  return sign + prefix + number + suffix;
}
function formatTradingAmounts(ctx, spec, units, unsigned = false) {
  if (!Number.isFinite(ctx.entryPrice) || !Number.isFinite(ctx.currentPrice) || ctx.entryPrice <= 0 || ctx.currentPrice <= 0) return '';
  const points = (ctx.currentPrice - ctx.entryPrice) * (ctx.side === 'sell' ? -1 : 1);
  const values = {
    currency: signed(points * ctx.openQuantity * spec.pointValue, 2, '', '$', unsigned),
    points: signed(points, spec.decimals, ' pts', '', unsigned),
    ticks: signed(points / spec.tickSize, 0, ' ticks', '', unsigned),
    percent: signed(points / ctx.entryPrice * 100, 3, '%', '', unsigned),
  };
  return normalizeTradingDisplay(units).map(id => values[id]).join(' · ');
}
function formatPendingDistance(order, price, market, spec, units) {
  const label = formatTradingAmounts({ side: 'buy', entryPrice: market, currentPrice: price, openQuantity: order.quantity }, spec, units, true);
  return label ? label + ' away' : '';
}
module.exports = { LABEL_UNITS, normalizeTradingDisplay, loadTradingDisplay, saveTradingDisplay, formatTradingAmounts, formatPendingDistance };
