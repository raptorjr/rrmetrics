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
  sourceFingerprint: string;
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
  gross_pl?: number | null;
  fees?: number;
  commissions?: number;
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
  const fingerprintOccurrences = new Map<string, number>();
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
    const signedQuantity = side === 'short' ? -quantity : quantity;
    const manualPL = num(row['Net P&L']);
    const fingerprintBase = [
      symbol,
      enterTime,
      exitTime,
      enterPrice.toFixed(6),
      exitPrice.toFixed(6),
      signedQuantity.toFixed(6),
      manualPL == null ? '' : manualPL.toFixed(2),
    ].join('|');
    // Identical fills can legitimately appear more than once in an export.
    // Preserve each occurrence while keeping the fingerprint stable on re-export.
    const occurrenceKey = sourceAccount + '|' + fingerprintBase;
    const occurrence = (fingerprintOccurrences.get(occurrenceKey) || 0) + 1;
    fingerprintOccurrences.set(occurrenceKey, occurrence);
    const sourceFingerprint = fingerprintBase + '#' + occurrence;
    result.push({
      sourceRow: index + 2, sourceAccount, ticker: symbol, enterTime, exitTime,
      enterPrice, exitPrice, quantity: signedQuantity,
      manualPL, grossPL: num(row['Gross P&L']),
      fees: num(row.Fee) || 0, commissions: num(row.Commission) || 0,
      sourceFingerprint,
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

function strongPositionMatch(source: TradeZellaRow, existing: ExistingTrade): boolean {
  return source.ticker === existing.ticker.toUpperCase()
    && Math.sign(source.quantity) === Math.sign(existing.quantity)
    && near(Math.abs(source.quantity), Math.abs(existing.quantity), 0.0001)
    && near(epoch(source.enterTime), epoch(existing.enter_time), 2)
    // ProjectX execution reconstruction can produce a different average exit
    // price/time from TradeZella. Require all financial totals to agree instead.
    && source.manualPL != null && existing.manual_pl != null
    && near(source.manualPL, existing.manual_pl, 0.03)
    && source.grossPL != null && existing.gross_pl != null
    && near(source.grossPL, existing.gross_pl, 0.03)
    && near(source.fees, existing.fees ?? 0, 0.03)
    && near(source.commissions, existing.commissions ?? 0, 0.03);
}

function exactMatch(source: TradeZellaRow, existing: ExistingTrade): boolean {
  return source.ticker === existing.ticker.toUpperCase()
    && Math.sign(source.quantity) === Math.sign(existing.quantity)
    && near(Math.abs(source.quantity), Math.abs(existing.quantity), 0.0001)
    && near(epoch(source.enterTime), epoch(existing.enter_time), 2)
    && near(epoch(source.exitTime), epoch(existing.exit_time), 2)
    && near(source.exitPrice, existing.exit_price, 0.01)
    // TradeZella and ProjectX can calculate different average entry prices from
    // the same fills. Exact timestamps, size, exit and net P&L are stronger evidence.
    && (near(source.enterPrice, existing.enter_price, 0.01)
      || (source.manualPL != null && existing.manual_pl != null && near(source.manualPL, existing.manual_pl, 0.03)))
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
    const strongCandidates = existing.filter(trade => available.has(trade.id) && strongPositionMatch(source, trade));
    if (strongCandidates.length === 1) {
      available.delete(strongCandidates[0].id);
      processed.add(source.sourceRow);
      results.push({ status: 'matched', sourceRows: [source.sourceRow], existingTradeIds: [strongCandidates[0].id], reason: 'Entry time, quantity, gross/net P&L and trading costs match; exit execution details differ' });
      continue;
    }
    const directCandidates = existing.filter((trade) => available.has(trade.id) && exactMatch(source, trade));
    if (directCandidates.length === 1) {
      available.delete(directCandidates[0].id);
      processed.add(source.sourceRow);
      results.push({ status: 'matched', sourceRows: [source.sourceRow], existingTradeIds: [directCandidates[0].id], reason: 'Exact trade match' });
      continue;
    }
    if (directCandidates.length > 1 || strongCandidates.length > 1) {
      const ambiguousIds = directCandidates.length > 1
        ? directCandidates.map(trade => trade.id)
        : strongCandidates.map(trade => trade.id);
      processed.add(source.sourceRow);
      results.push({
        status: 'review',
        sourceRows: [source.sourceRow],
        existingTradeIds: ambiguousIds,
        reason: 'Multiple existing positions satisfy the automatic matching rules; manual review is required',
      });
      continue;
    }

    const candidates = existing.filter((trade) => available.has(trade.id)
      && trade.ticker.toUpperCase() === source.ticker
      && Math.sign(trade.quantity) === Math.sign(source.quantity)
      && near(epoch(trade.exit_time), epoch(source.exitTime), 2)
      && Math.abs(trade.quantity) >= Math.abs(source.quantity));
    const aggregateMatches: Array<{ trade: ExistingTrade; group: TradeZellaRow[] }> = [];

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
      if (found) aggregateMatches.push({ trade: candidate, group: found });
    }

    if (aggregateMatches.length > 1) {
      const relatedIds = [...new Set(aggregateMatches.map(match => match.trade.id))];
      const sourceRows = [...new Set(aggregateMatches.flatMap(match => match.group.map(row => row.sourceRow)))];
      sourceRows.forEach(rowNumber => processed.add(rowNumber));
      results.push({ status: 'review', sourceRows, existingTradeIds: relatedIds, reason: 'Multiple RR positions satisfy the aggregated CSV-row match; manual review is required' });
      continue;
    }
    const matched = aggregateMatches[0];
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
    const validExistingGroups = existingSubsets.filter((subset) => {
      const qty = subset.reduce((sum, trade) => sum + Math.abs(trade.quantity), 0);
      const entry = subset.reduce((sum, trade) => sum + trade.enter_price * Math.abs(trade.quantity), 0) / qty;
      const exit = subset.reduce((sum, trade) => sum + trade.exit_price * Math.abs(trade.quantity), 0) / qty;
      const netValues = subset.map((trade) => trade.manual_pl);
      const net = netValues.every((value) => value != null)
        ? netValues.reduce((sum, value) => sum + (value || 0), 0)
        : null;
      const finalExit = Math.max(...subset.map((trade) => epoch(trade.exit_time)));
      return near(qty, Math.abs(source.quantity), 0.0001)
        && (near(entry, source.enterPrice, 0.01)
          || (source.manualPL != null && net != null && near(net, source.manualPL, 0.03)))
        && near(exit, source.exitPrice, 0.01)
        && near(finalExit, epoch(source.exitTime), 2)
        && (source.manualPL == null || net == null || near(net, source.manualPL, 0.03));
    });
    existingGroupMatch = validExistingGroups.length === 1 ? validExistingGroups[0] : undefined;

    // TradeZella can merge a sequence of RR position episodes into one
    // journal row (including a reversal). Its Side reflects the initial
    // direction, while Quantity can reflect the absolute final net exposure.
    // Match only when the first entry, final exit, absolute net size, and
    // every financial total reconcile.
    const episodeCandidates = existing.filter((trade) => available.has(trade.id)
      && trade.ticker.toUpperCase() === source.ticker
      && epoch(trade.enter_time) >= epoch(source.enterTime) - 2
      && epoch(trade.enter_time) <= epoch(source.exitTime) + 2
      && epoch(trade.exit_time) >= epoch(source.enterTime) - 2
      && epoch(trade.exit_time) <= epoch(source.exitTime) + 2);
    const episodeSubsets: ExistingTrade[][] = [];
    const episodeLimit = Math.min(episodeCandidates.length, 6);
    const visitEpisodes = (start: number, selected: ExistingTrade[]) => {
      if (selected.length >= 2) episodeSubsets.push(selected);
      if (selected.length === episodeLimit) return;
      for (let i = start; i < episodeCandidates.length; i += 1) {
        visitEpisodes(i + 1, [...selected, episodeCandidates[i]]);
      }
    };
    if (episodeCandidates.length <= 12 && episodeLimit >= 2) visitEpisodes(0, []);
    const validEpisodes = episodeSubsets.filter((subset) => {
      const firstEntry = Math.min(...subset.map((trade) => epoch(trade.enter_time)));
      const lastExit = Math.max(...subset.map((trade) => epoch(trade.exit_time)));
      const firstTrade = subset.find((trade) => near(epoch(trade.enter_time), firstEntry, 0.001));
      const lastTrade = subset.find((trade) => near(epoch(trade.exit_time), lastExit, 0.001));
      const signedNetQuantity = subset.reduce((sum, trade) => sum + trade.quantity, 0);
      const net = subset.every((trade) => trade.manual_pl != null)
        ? subset.reduce((sum, trade) => sum + (trade.manual_pl || 0), 0) : null;
      const gross = subset.every((trade) => trade.gross_pl != null)
        ? subset.reduce((sum, trade) => sum + (trade.gross_pl || 0), 0) : null;
      const fees = subset.reduce((sum, trade) => sum + (trade.fees || 0), 0);
      const commissions = subset.reduce((sum, trade) => sum + (trade.commissions || 0), 0);
      return !!firstTrade && !!lastTrade
        && near(firstEntry, epoch(source.enterTime), 2)
        && near(lastExit, epoch(source.exitTime), 2)
        && Math.sign(firstTrade.quantity) === Math.sign(source.quantity)
        && near(Math.abs(signedNetQuantity), Math.abs(source.quantity), 0.0001)
        && near(firstTrade.enter_price, source.enterPrice, 0.01)
        && near(lastTrade.exit_price, source.exitPrice, 0.01)
        && source.manualPL != null && net != null && near(net, source.manualPL, 0.03)
        && source.grossPL != null && gross != null && near(gross, source.grossPL, 0.03)
        && near(fees, source.fees, 0.03)
        && near(commissions, source.commissions, 0.03);
    });
    const episodeMatch = validEpisodes.length === 1 ? validEpisodes[0] : undefined;

    if (episodeMatch) {
      episodeMatch.forEach((trade) => available.delete(trade.id));
      processed.add(source.sourceRow);
      results.push({
        status: 'matched',
        sourceRows: [source.sourceRow],
        existingTradeIds: episodeMatch.map((trade) => trade.id),
        reason: 'Merged trading episode matches initial direction, first entry, final exit, absolute net size and all financial totals',
      });
    } else if (validEpisodes.length > 1) {
      processed.add(source.sourceRow);
      results.push({
        status: 'review',
        sourceRows: [source.sourceRow],
        existingTradeIds: [...new Set(validEpisodes.flatMap((subset) => subset.map((trade) => trade.id)))],
        reason: 'Multiple merged trading episodes have matching totals; automatic linking would be ambiguous',
      });
    } else if (validExistingGroups.length > 1) {
      processed.add(source.sourceRow);
      results.push({
        status: 'review',
        sourceRows: [source.sourceRow],
        existingTradeIds: [...new Set(validExistingGroups.flatMap((subset) => subset.map((trade) => trade.id)))],
        reason: 'Multiple groups of RR partial positions satisfy the consolidated trade; manual review is required',
      });
    } else if (existingGroupMatch) {
      existingGroupMatch.forEach((trade) => available.delete(trade.id));
      processed.add(source.sourceRow);
      results.push({
        status: 'matched',
        sourceRows: [source.sourceRow],
        existingTradeIds: existingGroupMatch.map((trade) => trade.id),
        reason: 'Consolidated trade matches multiple partial-exit positions',
      });
    } else if (candidates.length || existingGroupCandidates.length || episodeCandidates.length) {
      processed.add(source.sourceRow);
      const relatedIds = [...new Set([
        ...candidates.map((trade) => trade.id),
        ...existingGroupCandidates.map((trade) => trade.id),
        ...episodeCandidates.map((trade) => trade.id),
      ])];
      results.push({ status: 'review', sourceRows: [source.sourceRow], existingTradeIds: relatedIds, reason: 'Similar position found; signed direction, quantity or financial totals do not agree closely enough for automatic matching' });
    } else {
      processed.add(source.sourceRow);
      results.push({ status: 'new', sourceRows: [source.sourceRow], existingTradeIds: [], reason: 'No existing position match' });
    }
  }
  return results;
}
