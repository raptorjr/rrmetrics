const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDateEST, formatTimeEST } = require('./dateUtils');

const originalLocalStorage = global.localStorage;
let preferences;

test.beforeEach(() => {
  preferences = {
    rrmetrics_date_format: 'dmy-dot',
    rrmetrics_time_format: '24h',
    rrmetrics_time_zone: 'Europe/Oslo',
  };
  global.localStorage = { getItem: key => preferences[key] ?? null };
});

test.after(() => {
  if (originalLocalStorage === undefined) delete global.localStorage;
  else global.localStorage = originalLocalStorage;
});

test('shared date formatter follows the configured date format and display timezone', () => {
  const instant = '2026-11-09T00:00:00.000Z';
  assert.equal(formatDateEST(instant), '09.11.2026');

  preferences.rrmetrics_date_format = 'dmy-slash';
  assert.equal(formatDateEST(instant), '09/11/2026');

  preferences.rrmetrics_date_format = 'mdy-slash';
  assert.equal(formatDateEST(instant), '11/09/2026');

  preferences.rrmetrics_date_format = 'ymd-dash';
  assert.equal(formatDateEST(instant), '2026-11-09');
});

test('shared time formatter follows the configured 12/24-hour preference and timezone', () => {
  const instant = '2026-11-09T00:00:00.000Z';
  assert.equal(formatTimeEST(instant), '01:00');

  preferences.rrmetrics_time_format = '12h';
  assert.equal(formatTimeEST(instant), '01:00 AM');
});

test('automatic date format follows the browser locale', () => {
  preferences.rrmetrics_date_format = 'auto';
  const instant = '2026-11-09T00:00:00.000Z';
  const expected = new Date(instant).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Oslo',
  });
  assert.equal(formatDateEST(instant), expected);
});
