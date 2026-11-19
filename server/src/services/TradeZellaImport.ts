export interface TradeZellaRow {
  sourceRow: number;
  sourceAccount: string;
  ticker: string;
  enterTime: string;
  exitTime: string;
  enterPrice: number;
  exitPrice: number;
  quantity: number;
  manualPL: number | null;
  grossPL: number | null;
  fees: number;
  commissions: number;
}

export interface ExistingTrade {
  id: string;
  ticker: string;
  enter_time: string;
  exit_time: string;
  enter_price: number;
  exit_price: number;
  quantity: number;
  manual_pl: number | null;
}

export interface MatchResult {
  status: 'matched' | 'new' | 'review';
  sourceRows: number[];
  existingTradeIds: string[];
  reason: string;
}

const num = (value: unknown): number | null => {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};
const ticker = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
const epoch = (value: string) => new Date(value).getTime() / 1000;

export function parseTradeZellaTimestamp(dateValue: unknown, timeValue: unknown): string | null {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  const match = time.match(/^(\d{1,2}:\d{2}:\d{2})(?:\s+(CET|CEST))?$/i);
  if (!date || !match) return null;
  const [hour, minute, second] = match[1].split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  const offset = (match[2] || 'CET').toUpperCase() === 'CEST' ? 120 : 60;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000).toISOString();
}

export function parseTradeZellaRows(rows: Array<Record<string, unknown>>): TradeZellaRow[] {
  const result: TradeZellaRow[] = [];
  rows.forEach((row, index) => {
    const sourceAccount = String(row['Account Name'] || '').trim();
    const symbol = ticker(row.Instrument || row.Symbol);
    const enterTime = parseTradeZellaTimestamp(row['Open Date'], row['Open Time']);
    const exitTime = parseTradeZellaTimestamp(row['Close Date'], row['Close Time']);
    const enterPrice = num(row['Entry Price']);
    const exitPrice = num(row['Exit Price']);
    const quantity = num(row.Quantity);
    const side = String(row.Side || '').toLowerCase().trim();
    if (!sourceAccount || !symbol || !enterTime || !exitTime || enterPrice == null || exitPrice == null || quantity == null || quantity <= 0 || !['long', 'short'].includes(side)) return;
    result.push({
      sourceRow: index + 2, sourceAccount, ticker: symbol, enterTime, exitTime,
      enterPrice, exitPrice, quantity: side === 'short' ? -quantity : quantity,
      manualPL: num(row['Net P&L']), grossPL: num(row['Gross P&L']),
      fees: num(row.Fee) || 0, commissions: num(row.Commission) || 0,
    });
  });
  return result;
}

export function summarizeTradeZellaAccounts(rows: TradeZellaRow[]) {
  const accounts = new Map<string, { accountName: string; tradeCount: number; firstTrade: string; lastTrade: string }>();
  for (const row of rows) {
    const item = accounts.get(row.sourceAccount);
    if (!item) accounts.set(row.sourceAccount, { accountName: row.sourceAccount, tradeCount: 1, firstTrade: row.enterTime, lastTrade: row.exitTime });
    else {
      item.tradeCount += 1;
      if (row.enterTime < item.firstTrade) item.firstTrade = row.enterTime;
      if (row.exitTime > item.lastTrade) item.lastTrade = row.exitTime;
    }
  }
  return [...accounts.values()].sort((a, b) => a.accountName.localeCompare(b.accountName));
}

function exactMatch(source: TradeZellaRow, existing: ExistingTrade): boolean {
  return source.ticker === existing.ticker.toUpperCase()
    && Math.sign(source.quantity) === Math.sign(existing.quantity)
    && near(Math.abs(source.quantity), Math.abs(existing.quantity), 0.0001)
    && near(epoch(source.enterTime), epoch(existing.enter_time), 2)
    && near(epoch(source.exitTime), epoch(existing.exit_time), 2)
    && near(source.enterPrice, existing.enter_price, 0.01)
    && near(source.exitPrice, existing.exit_price, 0.01)
    && (source.manualPL == null || existing.manual_pl == null || near(source.manualPL, existing.manual_pl, 0.03));
}

/** Conservative one-to-one and many-CSV-rows-to-one-position duplicate detection. */
export function matchTradeZellaRows(rows: TradeZellaRow[], existing: ExistingTrade[]): MatchResult[] {
  const available = new Set(existing.map((trade) => trade.id));
  const processed = new Set<number>();
  const results: MatchResult[] = [];
  const ordered = [...rows].sort((a, b) => epoch(a.exitTime) - epoch(b.exitTime));

  for (const source of ordered) {
    if (processed.has(source.sourceRow)) continue;
    const direct = existing.find((trade) => available.has(trade.id) && exactMatch(source, trade));
    if (direct) {
      available.delete(direct.id);
      processed.add(source.sourceRow);
      results.push({ status: 'matched', sourceRows: [source.sourceRow], existingTradeIds: [direct.id], reason: 'Exact trade match' });
      continue;
    }

    const candidates = existing.filter((trade) => available.has(trade.id)
      && trade.ticker.toUpperCase() === source.ticker
      && Math.sign(trade.quantity) === Math.sign(source.quantity)
      && near(epoch(trade.exit_time), epoch(source.exitTime), 2)
      && Math.abs(trade.quantity) >= Math.abs(source.quantity));
    let matched: { trade: ExistingTrade; group: TradeZellaRow[] } | undefined;

    for (const candidate of candidates) {
      const group = ordered.filter((row) => !processed.has(row.sourceRow)
        && row.sourceAccount === source.sourceAccount
        && row.ticker === source.ticker
        && Math.sign(row.quantity) === Math.sign(source.quantity)
        && near(epoch(row.exitTime), epoch(source.exitTime), 2));
      // Keep subset search bounded; unusually large clusters require manual review.
      if (group.length > 12) continue;
      const limit = Math.min(group.length, 6);
      const subsets: TradeZellaRow[][] = [];
      const visit = (start: number, selected: TradeZellaRow[]) => {
        if (selected.length >= 2) subsets.push(selected);
        if (selected.length === limit) return;
        for (let i = start; i < group.length; i += 1) visit(i + 1, [...selected, group[i]]);
      };
      visit(0, []);
      const found = subsets.find((subset) => {
        const qty = subset.reduce((sum, row) => sum + Math.abs(row.quantity), 0);
        const avgEntry = subset.reduce((sum, row) => sum + row.enterPrice * Math.abs(row.quantity), 0) / qty;
        const netValues = subset.map((row) => row.manualPL);
        const net = netValues.every((value) => value != null) ? netValues.reduce((sum, value) => sum + (value || 0), 0) : null;
        return near(qty, Math.abs(candidate.quantity), 0.0001)
          && near(avgEntry, candidate.enter_price, 0.01)
          && subset.every((row) => near(row.exitPrice, candidate.exit_price, 0.01))
          && (net == null || candidate.manual_pl == null || near(net, candidate.manual_pl, 0.03));
      });
      if (found) { matched = { trade: candidate, group: found }; break; }
    }

    if (matched) {
      available.delete(matched.trade.id);
      matched.group.forEach((row) => processed.add(row.sourceRow));
      results.push({ status: 'matched', sourceRows: matched.group.map((row) => row.sourceRow), existingTradeIds: [matched.trade.id], reason: 'Aggregated position match' });
      continue;
    }

    // The reverse shape also occurs: TradeZella may export one consolidated
    // position while RR contains several partial-exit trades for that entry.
    const existingGroupCandidates = existing.filter((trade) => available.has(trade.id)
      && trade.ticker.toUpperCase() === source.ticker
      && Math.sign(trade.quantity) === Math.sign(source.quantity)
      && near(epoch(trade.enter_time), epoch(source.enterTime), 2)
      && epoch(trade.exit_time) >= epoch(source.enterTime) - 2
      && epoch(trade.exit_time) <= epoch(source.exitTime) + 2);
    let existingGroupMatch: ExistingTrade[] | undefined;
    const groupLimit = Math.min(existingGroupCandidates.length, 6);
    const existingSubsets: ExistingTrade[][] = [];
    const visitExisting = (start: number, selected: ExistingTrade[]) => {
      if (selected.length >= 2) existingSubsets.push(selected);
      if (selected.length === groupLimit) return;
      for (let i = start; i < existingGroupCandidates.length; i += 1) {
        visitExisting(i + 1, [...selected, existingGroupCandidates[i]]);
      }
    };
    if (groupLimit >= 2 && existingGroupCandidates.length <= 12) visitExisting(0, []);
    existingGroupMatch = existingSubsets.find((subset) => {
      const qty = subset.reduce((sum, trade) => sum + Math.abs(trade.quantity), 0);
      const entry = subset.reduce((sum, trade) => sum + trade.enter_price * Math.abs(trade.quantity), 0) / qty;
      const exit = subset.reduce((sum, trade) => sum + trade.exit_price * Math.abs(trade.quantity), 0) / qty;
      const netValues = subset.map((trade) => trade.manual_pl);
      const net = netValues.every((value) => value != null)
        ? netValues.reduce((sum, value) => sum + (value || 0), 0)
        : null;
      const finalExit = Math.max(...subset.map((trade) => epoch(trade.exit_time)));
      return near(qty, Math.abs(source.quantity), 0.0001)
        && near(entry, source.enterPrice, 0.01)
        && near(exit, source.exitPrice, 0.01)
        && near(finalExit, epoch(source.exitTime), 2)
        && (source.manualPL == null || net == null || near(net, source.manualPL, 0.03));
    });

    if (existingGroupMatch) {
      existingGroupMatch.forEach((trade) => available.delete(trade.id));
      processed.add(source.sourceRow);
      results.push({
        status: 'matched',
        sourceRows: [source.sourceRow],
        existingTradeIds: existingGroupMatch.map((trade) => trade.id),
        reason: 'Consolidated trade matches multiple partial-exit positions',
      });
    } else if (candidates.length || existingGroupCandidates.length) {
      processed.add(source.sourceRow);
      results.push({ status: 'review', sourceRows: [source.sourceRow], existingTradeIds: candidates.map((trade) => trade.id), reason: 'Similar position found; details do not agree closely enough for automatic matching' });
    } else {
      processed.add(source.sourceRow);
      results.push({ status: 'new', sourceRows: [source.sourceRow], existingTradeIds: [], reason: 'No existing position match' });
    }
  }
  return results;
}
