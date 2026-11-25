const pad = value => String(value).padStart(2, '0');

function parseClockTime(value, timeFormat = '24h', includeSeconds = true) {
  const clock = String(value || '').trim();
  const match = (timeFormat === '24h'
    ? /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    : /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i).exec(clock);
  if (!match || (!includeSeconds && match[3] !== undefined)) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]), second = Number(match[3] || 0);
  if (minute > 59 || second > 59 || (timeFormat === '24h' ? hour > 23 : hour < 1 || hour > 12)) return null;
  if (timeFormat !== '24h') hour = hour % 12 + (match[4].toUpperCase() === 'PM' ? 12 : 0);
  return { hour, minute, second };
}

function formatClockTime(parts, timeFormat = '24h', includeSeconds = true) {
  const { hour, minute, second = 0 } = parts;
  const h = timeFormat === '24h' ? hour : hour % 12 || 12;
  return pad(h) + ':' + pad(minute) + (includeSeconds ? ':' + pad(second) : '') +
    (timeFormat === '24h' ? '' : ' ' + (hour >= 12 ? 'PM' : 'AM'));
}

module.exports = { parseClockTime, formatClockTime };
