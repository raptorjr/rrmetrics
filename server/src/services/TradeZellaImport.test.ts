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
