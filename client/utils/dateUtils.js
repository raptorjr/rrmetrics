const formatDuration = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const EST_TZ = 'America/New_York';

// Format a date in EST timezone - returns an object with EST components
const toEST = (date) => {
  const d = new Date(date);
  // Use Intl to get the parts in EST
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hours: parseInt(get('hour'), 10) % 24,
    minutes: parseInt(get('minute'), 10),
    seconds: parseInt(get('second'), 10),
  };
};

// Resolve the user's display time zone. Trading-session calculations remain on EST_TZ.
const getDisplayTimeZone = () => {
  let preference = 'auto';
  try {
    if (typeof localStorage !== 'undefined') preference = localStorage.getItem('rrmetrics_time_zone') || 'auto';
  } catch {}
  if (preference !== 'auto') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: preference });
      return preference;
    } catch {}
  }
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || EST_TZ; }
  catch { return EST_TZ; }
};

// Display formatting follows the user's Settings → Preferences choices.
// Trading-session calculations remain on EST_TZ; these helpers only format instants.
const getDateFormat = () => {
  try {
    return localStorage.getItem('rrmetrics_date_format') || 'auto';
  } catch {
    return 'auto';
  }
};

const getTimeFormat = () => {
  try {
    return localStorage.getItem('rrmetrics_time_format') === '24h' ? '24h' : '12h';
  } catch {
    return '12h';
  }
};

const formatDateEST = (dateString) => {
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '—';
  const timeZone = getDisplayTimeZone();
  const format = getDateFormat();
  if (format === 'auto') {
    return date.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone,
    });
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  if (format === 'dmy-dot') return `${values.day}.${values.month}.${values.year}`;
  if (format === 'dmy-slash') return `${values.day}/${values.month}/${values.year}`;
  if (format === 'mdy-slash') return `${values.month}/${values.day}/${values.year}`;
  if (format === 'ymd-dash') return `${values.year}-${values.month}-${values.day}`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone });
};

// Legacy name retained for existing imports; trade times use the selected user time zone.
const formatTimeEST = (dateString) => {
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', timeZone: getDisplayTimeZone(),
    hour12: getTimeFormat() !== '24h',
  });
};

const formatFullDateEST = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: EST_TZ });
};

// Get EST offset string for the given date (handles EST/EDT)
const getESTOffset = (date) => {
  const d = new Date(date);
  const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
  const estStr = d.toLocaleString('en-US', { timeZone: EST_TZ });
  const diffMs = new Date(estStr) - new Date(utcStr);
  const diffHours = diffMs / 3600000;
  return diffHours === -4 ? '-04:00' : '-05:00';
};

module.exports = { formatDuration, EST_TZ, toEST, getDisplayTimeZone, getDateFormat, getTimeFormat, formatDateEST, formatTimeEST, formatFullDateEST, getESTOffset };
