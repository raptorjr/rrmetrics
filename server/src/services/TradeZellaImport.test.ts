import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchTradeZellaRows,
  parseTradeZellaRows,
  parseTradeZellaTimestamp,
} from './TradeZellaImport';

test('converts CET and CEST timestamps to UTC', () => {
  assert.equal(parseTradeZellaTimestamp('2026-01-15', '14:00:00 CET'), '2026-01-15T13:00:00.000Z');
  assert.equal(parseTradeZellaTimestamp('2026-07-15', '14:00:00 CEST'), '2026-07-15T12:00:00.000Z');
});

test('parses TradeZella rows and preserves account, side, costs and net P&L', () => {
  const rows = parseTradeZellaRows([{
    'Account Name': '150k XFA', Instrument: 'MES', Side: 'short', Quantity: '2',
    'Open Date': '2026-07-15', 'Open Time': '14:00:00 CEST',
    'Close Date': '2026-07-15', 'Close Time': '14:05:00 CEST',
    'Entry Price': '6600.25', 'Exit Price': '6599.25',
    'Net P&L': '8.52', 'Gross P&L': '10.00', Fee: '0.48', Commission: '1.00',
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceAccount, '150k XFA');
  assert.equal(rows[0].quantity, -2);
  assert.equal(rows[0].manualPL, 8.52);
  assert.equal(rows[0].grossPL, 10);
  assert.equal(rows[0].fees, 0.48);
  assert.equal(rows[0].commissions, 1);
  assert.ok(rows[0].sourceFingerprint.includes('MES'));
});

test('matches two one-contract CSV rows to one two-contract RR position', () => {
  const source = parseTradeZellaRows([
    { 'Account Name': '150k XFA', Instrument: 'MES', Side: 'long', Quantity: '1', 'Open Date': '2026-04-07', 'Open Time': '14:48:48 CEST', 'Close Date': '2026-04-07', 'Close Time': '16:00:17 CEST', 'Entry Price': '6616.75', 'Exit Price': '6601.25', 'Net P&L': '-78.24' },
    { 'Account Name': '150k XFA', Instrument: 'MES', Side: 'long', Quantity: '1', 'Open Date': '2026-04-07', 'Open Time': '16:00:12 CEST', 'Close Date': '2026-04-07', 'Close Time': '16:00:17 CEST', 'Entry Price': '6602.75', 'Exit Price': '6601.25', 'Net P&L': '-8.24' },
  ]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-1', ticker: 'MES', enter_time: '2026-04-07T12:48:48.000Z',
    exit_time: '2026-04-07T14:00:17.000Z', enter_price: 6609.75,
    exit_price: 6601.25, quantity: 2, manual_pl: -86.48,
  }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(matches[0].sourceRows, [2, 3]);
  assert.deepEqual(matches[0].existingTradeIds, ['rr-1']);
});

test('matches one consolidated CSV trade to multiple RR partial exits', () => {
  const source = parseTradeZellaRows([{
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'long', Quantity: '2',
    'Open Date': '2026-07-15', 'Open Time': '14:00:00 CEST',
    'Close Date': '2026-07-15', 'Close Time': '14:05:00 CEST',
    'Entry Price': '2400.00', 'Exit Price': '2401.00', 'Net P&L': '20.00',
  }]);
  const matches = matchTradeZellaRows(source, [
    {
      id: 'rr-partial-1', ticker: 'MGC', enter_time: '2026-07-15T12:00:00.000Z',
      exit_time: '2026-07-15T12:04:00.000Z', enter_price: 2400,
      exit_price: 2400.5, quantity: 1, manual_pl: 5,
    },
    {
      id: 'rr-partial-2', ticker: 'MGC', enter_time: '2026-07-15T12:00:00.000Z',
      exit_time: '2026-07-15T12:05:00.000Z', enter_price: 2400,
      exit_price: 2401.5, quantity: 1, manual_pl: 15,
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(matches[0].sourceRows, [2]);
  assert.deepEqual(matches[0].existingTradeIds, ['rr-partial-1', 'rr-partial-2']);
});

test('does not combine CSV rows from different source accounts', () => {
  const source = parseTradeZellaRows([
    { 'Account Name': 'Practice', Instrument: 'MES', Side: 'long', Quantity: '1', 'Open Date': '2026-04-07', 'Open Time': '14:48:48 CEST', 'Close Date': '2026-04-07', 'Close Time': '16:00:17 CEST', 'Entry Price': '6616.75', 'Exit Price': '6601.25', 'Net P&L': '-78.24' },
    { 'Account Name': '150k XFA', Instrument: 'MES', Side: 'long', Quantity: '1', 'Open Date': '2026-04-07', 'Open Time': '16:00:12 CEST', 'Close Date': '2026-04-07', 'Close Time': '16:00:17 CEST', 'Entry Price': '6602.75', 'Exit Price': '6601.25', 'Net P&L': '-8.24' },
  ]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-1', ticker: 'MES', enter_time: '2026-04-07T12:48:48.000Z',
    exit_time: '2026-04-07T14:00:17.000Z', enter_price: 6609.75,
    exit_price: 6601.25, quantity: 2, manual_pl: -86.48,
  }]);
  assert.equal(matches.some((match) => match.status === 'matched'), false);
});


test('keeps identical TradeZella rows as distinct source occurrences', () => {
  const row = {
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'long', Quantity: '1',
    'Open Date': '2026-07-15', 'Open Time': '14:00:00 CEST',
    'Close Date': '2026-07-15', 'Close Time': '14:05:00 CEST',
    'Entry Price': '2400.00', 'Exit Price': '2401.00', 'Net P&L': '10.00',
  };
  const parsed = parseTradeZellaRows([row, row]);
  assert.equal(parsed.length, 2);
  assert.notEqual(parsed[0].sourceFingerprint, parsed[1].sourceFingerprint);
});


test('matches a position when average entry differs but timing, exit, size and net P&L agree', () => {
  const source = parseTradeZellaRows([{
    'Account Name': '150k XFA', Instrument: 'MGC', Side: 'short', Quantity: '2',
    'Open Date': '2026-04-14', 'Open Time': '13:38:46 CEST',
    'Close Date': '2026-04-14', 'Close Time': '13:40:12 CEST',
    'Entry Price': '4799.30', 'Exit Price': '4809.20', 'Net P&L': '-238.48',
  }]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-average-entry-diff', ticker: 'MGC',
    enter_time: '2026-04-14T11:38:46.900Z', exit_time: '2026-04-14T11:40:12.200Z',
    enter_price: 4797.45, exit_price: 4809.20, quantity: -2, manual_pl: -238.48,
  }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(matches[0].existingTradeIds, ['rr-average-entry-diff']);
});

test('does not use a differing average entry to match when net P&L also disagrees', () => {
  const source = parseTradeZellaRows([{
    'Account Name': '150k XFA', Instrument: 'MGC', Side: 'short', Quantity: '2',
    'Open Date': '2026-04-14', 'Open Time': '13:38:46 CEST',
    'Close Date': '2026-04-14', 'Close Time': '13:40:12 CEST',
    'Entry Price': '4799.30', 'Exit Price': '4809.20', 'Net P&L': '-238.48',
  }]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-wrong-pnl', ticker: 'MGC',
    enter_time: '2026-04-14T11:38:46.900Z', exit_time: '2026-04-14T11:40:12.200Z',
    enter_price: 4797.45, exit_price: 4809.20, quantity: -2, manual_pl: -200,
  }]);
  assert.equal(matches[0].status, 'review');
});


test('matches when entry, quantity and all financial totals agree despite different exit execution details', () => {
  const source = parseTradeZellaRows([{
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'long', Quantity: '5',
    'Open Date': '2026-11-02', 'Open Time': '14:41:12 CET',
    'Close Date': '2026-11-02', 'Close Time': '14:43:35 CET',
    'Entry Price': '3946.00', 'Exit Price': '3954.20',
    'Net P&L': '266.40', 'Gross P&L': '276.00', Fee: '7.10', Commission: '2.50',
  }]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-exit-aggregation', ticker: 'MGC',
    enter_time: '2026-11-02T13:41:12.973Z', exit_time: '2026-11-02T13:43:35.605Z',
    enter_price: 3946, exit_price: 3951.52, quantity: 5, manual_pl: 266.4,
    gross_pl: 276, fees: 7.1, commissions: 2.5,
  }]);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(matches[0].existingTradeIds, ['rr-exit-aggregation']);
});

test('does not strong-match when gross P&L or costs disagree', () => {
  const source = parseTradeZellaRows([{
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'long', Quantity: '5',
    'Open Date': '2026-11-02', 'Open Time': '14:41:12 CET',
    'Close Date': '2026-11-02', 'Close Time': '14:43:35 CET',
    'Entry Price': '3946.00', 'Exit Price': '3954.20',
    'Net P&L': '266.40', 'Gross P&L': '276.00', Fee: '7.10', Commission: '2.50',
  }]);
  const matches = matchTradeZellaRows(source, [{
    id: 'rr-financial-mismatch', ticker: 'MGC',
    enter_time: '2026-11-02T13:41:12.973Z', exit_time: '2026-11-02T13:43:35.605Z',
    enter_price: 3946, exit_price: 3951.52, quantity: 5, manual_pl: 266.4,
    gross_pl: 276, fees: 7.1, commissions: 3.5,
  }]);
  assert.notEqual(matches[0].status, 'matched');
});


test('links a TradeZella merged row to two RR positions with the same net financial result', () => {
  const source = parseTradeZellaRows([{
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'long', Quantity: '2',
    'Open Date': '2026-08-17', 'Open Time': '10:15:03 CEST',
    'Close Date': '2026-08-17', 'Close Time': '13:15:49 CEST',
    'Entry Price': '4459.70', 'Exit Price': '4455.70',
    'Gross P&L': '-19.00', 'Net P&L': '-22.84', Fee: '2.84', Commission: '1.00',
  }]);
  const matches = matchTradeZellaRows(source, [
    {
      id: 'rr-aug-1', ticker: 'MGC', enter_time: '2026-08-17T08:15:03.184933Z',
      exit_time: '2026-08-17T08:35:50.959521Z', enter_price: 4459.7,
      exit_price: 4455.7, quantity: 1, manual_pl: -41.92, gross_pl: -40,
      fees: 1.42, commissions: 0.5,
    },
    {
      id: 'rr-aug-2', ticker: 'MGC', enter_time: '2026-08-17T09:16:19.049238Z',
      exit_time: '2026-08-17T11:15:49.476706Z', enter_price: 4453.6,
      exit_price: 4455.7, quantity: 1, manual_pl: 19.08, gross_pl: 21,
      fees: 1.42, commissions: 0.5,
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(new Set(matches[0].existingTradeIds), new Set(['rr-aug-1', 'rr-aug-2']));
});

test('matches a merged reversal when initial direction, absolute net size and all financial totals agree', () => {
  const source = parseTradeZellaRows([{
    'Account Name': 'Practice', Instrument: 'MGC', Side: 'short', Quantity: '4',
    'Open Date': '2026-09-22', 'Open Time': '15:39:48 CEST',
    'Close Date': '2026-09-22', 'Close Time': '16:39:12 CEST',
    'Entry Price': '4370.20', 'Exit Price': '4370.90',
    'Gross P&L': '12.00', 'Net P&L': '-3.36', Fee: '11.36', Commission: '4.00',
  }]);
  const matches = matchTradeZellaRows(source, [
    {
      id: 'rr-sep-short', ticker: 'MGC', enter_time: '2026-09-22T13:39:48.886020Z',
      exit_time: '2026-09-22T14:01:26.752334Z', enter_price: 4370.2,
      exit_price: 4371, quantity: -2, manual_pl: -19.84, gross_pl: -16,
      fees: 2.84, commissions: 1,
    },
    {
      id: 'rr-sep-long', ticker: 'MGC', enter_time: '2026-09-22T14:01:55.024171Z',
      exit_time: '2026-09-22T14:39:12.808606Z', enter_price: 4370.433333333333,
      exit_price: 4370.9, quantity: 6, manual_pl: 16.48, gross_pl: 28,
      fees: 8.52, commissions: 3,
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'matched');
  assert.deepEqual(new Set(matches[0].existingTradeIds), new Set(['rr-sep-short', 'rr-sep-long']));
  assert.match(matches[0].reason, /initial direction.*absolute net size/);
});
