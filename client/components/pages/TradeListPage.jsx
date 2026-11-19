const React = require('react');
const { useState, useEffect } = React;
const helper = require('../../helper.js');
const { authFetch } = helper;
const { getTradePL, calculateAnalytics } = require('../../utils/analytics');
const CustomizableStats = require('../shared/CustomizableStats');
const StatCard = require('../shared/StatCard');
const WinRateCard = require('../shared/WinRateCard');
const AvgWinLossCard = require('../shared/AvgWinLossCard');
const { formatDuration, formatDateEST, formatTimeEST } = require('../../utils/dateUtils');
const { TAG_COLOR_PRESETS } = require('../../utils/tagConstants');
const Icons = require('../shared/Icons');
const DateRangePicker = require('../shared/DateRangePicker');
const RuleChecklist = require('../shared/RuleChecklist');


const DailyPnlChart = ({ trades, currency, formatMoney, totalPL }) => {
  const ordered = [...trades].sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
  let running = 0;
  const values = [0, ...ordered.map(trade => { running += getTradePL(trade); return running; })];
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const width = 360, height = 132, left = 68, right = 8, top = 10, bottom = 10;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = index => left + (values.length <= 1 ? 0 : index / (values.length - 1)) * plotWidth;
  const y = value => top + ((max - value) / span) * plotHeight;
  const zeroY = y(0);
  const originalPoints = values.map((value, index) => ({ x: x(index), y: y(value), value }));
  // Insert exact zero-crossing points so both the stroke and fill change colour at zero.
  const points = [];
  originalPoints.forEach((point, index) => {
    if (index === 0) { points.push(point); return; }
    const previous = originalPoints[index - 1];
    if ((previous.value < 0 && point.value > 0) || (previous.value > 0 && point.value < 0)) {
      const ratio = Math.abs(previous.value) / (Math.abs(previous.value) + Math.abs(point.value));
      points.push({ x: previous.x + (point.x - previous.x) * ratio, y: zeroY, value: 0 });
    }
    points.push(point);
  });
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const previous = points[Math.max(0, index - 1)];
    const following = points[Math.min(points.length - 1, index + 2)];
    const dx = next.x - point.x;
    const slopeStart = (next.y - previous.y) / Math.max(1, next.x - previous.x);
    const slopeEnd = (following.y - point.y) / Math.max(1, following.x - point.x);
    const minY = Math.min(point.y, next.y);
    const maxY = Math.max(point.y, next.y);
    const control1Y = Math.max(minY, Math.min(maxY, point.y + slopeStart * dx / 3));
    const control2Y = Math.max(minY, Math.min(maxY, next.y - slopeEnd * dx / 3));
    const control1X = point.x + dx / 3;
    const control2X = next.x - dx / 3;
    const positive = (point.value + next.value) >= 0;
    const path = `M${point.x},${point.y} C${control1X},${control1Y} ${control2X},${control2Y} ${next.x},${next.y}`;
    const area = path + ` L${next.x},${zeroY} L${point.x},${zeroY} Z`;
    return { path, area, positive };
  });
  // Keep zero visible and suppress extreme labels that would collide with it.
  const candidates = [
    ...(max > 0 ? [{ value: max, priority: 1 }] : []),
    { value: 0, priority: 0 },
    ...(min < 0 ? [{ value: min, priority: 1 }] : []),
  ];
  const ticks = candidates.sort((a, b) => a.priority - b.priority).filter((tick, index, all) =>
    all.slice(0, index).every(kept => Math.abs(y(kept.value) - y(tick.value)) >= 19)
  );
  return (
    <div className="min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[132px] overflow-visible" role="img" aria-label={`Cumulative P&L chart ending at ${formatMoney(totalPL, currency)}`}>
        {ticks.map((tick, index) => (
          <g key={index}>
            <line x1={left} y1={y(tick.value)} x2={width - right} y2={y(tick.value)} stroke="currentColor" opacity={tick.value === 0 ? 0.34 : 0.18} strokeDasharray="3 3" />
            <text x={left - 7} y={y(tick.value) + 3.5} textAnchor="end" fill="currentColor" opacity="0.72" fontSize="10">{formatMoney(tick.value, currency)}</text>
          </g>
        ))}
        {segments.map((segment, index) => (
          <g key={index}>
            <path d={segment.area} fill={segment.positive ? 'rgba(34,197,94,0.16)' : 'rgba(239,68,68,0.16)'} />
            <path d={segment.path} fill="none" stroke={segment.positive ? '#22c55e' : '#ef4444'} strokeWidth="2.5" strokeLinecap="round" />
          </g>
        ))}
        {points.length > 1 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.5" fill={totalPL >= 0 ? '#22c55e' : '#ef4444'} />}
      </svg>
    </div>
  );
};

const DailyMetric = ({ label, value, valueClass = 'text-text-primary' }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">{label}</div>
    <div className={`font-mono text-sm font-semibold truncate ${valueClass}`}>{value}</div>
  </div>
);

const TradeListPage = ({ trades, triggerReload, onEdit, onOpenForm, tags, strategyRules, dailyNotes = [], onSaveNote, onDeleteNote }) => {
  const [searchTicker, setSearchTicker] = useState('');
  const [sortField, setSortField] = useState('exitTime');
  const [sortDir, setSortDir] = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sideFilters, setSideFilters] = useState([]);
  const [filterTags, setFilterTags] = useState([]);
  const [showNewTagInline, setShowNewTagInline] = useState(false);
  const [inlineTagName, setInlineTagName] = useState('');
  const [inlineTagColor, setInlineTagColor] = useState(TAG_COLOR_PRESETS[0]);
  const [inlineTagCreating, setInlineTagCreating] = useState(false);
  const [expandedTradeId, setExpandedTradeId] = useState(null);
  const [tradeChecksMap, setTradeChecksMap] = useState({});
  const [checksLoading, setChecksLoading] = useState(false);
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [selectedTradeIds, setSelectedTradeIds] = useState(new Set());
  const [bulkTagPickerOpen, setBulkTagPickerOpen] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [trackingView, setTrackingView] = useState('day');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [editingNoteDate, setEditingNoteDate] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    setSelectedTradeIds(new Set());
  }, [searchTicker, dateFrom, dateTo, sideFilters, filterTags]);

  const COLUMN_DEFS = [
    { id: 'date', label: 'Date', alwaysOn: true },
    { id: 'ticker', label: 'Ticker', alwaysOn: true },
    { id: 'tags', label: 'Tags' },
    { id: 'entry', label: 'Entry' },
    { id: 'exit', label: 'Exit' },
    { id: 'qty', label: 'Qty' },
    { id: 'gross', label: 'Gross P/L' },
    { id: 'fees', label: 'Fees' },
    { id: 'commissions', label: 'Commissions' },
    { id: 'pl', label: 'Net P/L', alwaysOn: true },
    { id: 'duration', label: 'Duration' },
  ];
  const DEFAULT_COLUMNS = ['date','ticker','tags','entry','exit','qty','pl','duration'];
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tradeTableColumns'));
      if (Array.isArray(saved)) return saved;
    } catch {}
    return DEFAULT_COLUMNS;
  });
  const toggleColumn = (colId) => {
    setVisibleColumns(prev => {
      const next = prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId];
      localStorage.setItem('tradeTableColumns', JSON.stringify(next));
      return next;
    });
  };
  const isCol = (colId) => visibleColumns.includes(colId);
  const visibleColCount = visibleColumns.length + 2; // +1 for checkbox, +1 for actions

  const doDelete = async (id) => {
    setDeletingIds(prev => new Set([...prev, id]));
    setDeleteConfirmId(null);
    try {
      const response = await authFetch('/api/removeTrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _id: id }),
      });
      const data = await response.json();
      if (data.error) {
        setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      } else {
        triggerReload();
      }
    } catch {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleDeleteClick = (id) => {
    if (localStorage.getItem('skipTradeDeleteConfirm') === 'true') {
      doDelete(id);
    } else {
      setDeleteConfirmId(id);
    }
  };

  const tradeRules = strategyRules ? strategyRules.filter(r => r.type === 'trade') : [];

  const fetchTradeChecksForList = async (tradeId) => {
    if (tradeChecksMap[tradeId] !== undefined) return;
    try {
      const resp = await authFetch(`/api/strategy/checks/trade/${tradeId}`);
      const data = await resp.json();
      if (!data.error) setTradeChecksMap(prev => ({ ...prev, [tradeId]: data.checks || [] }));
    } catch (err) {
      console.error('Failed to fetch trade checks:', err);
    }
  };

  const handleTradeRuleToggle = async (tradeId, ruleId, followed) => {
    setChecksLoading(true);
    try {
      const resp = await authFetch('/api/strategy/checks/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, ruleId, followed }),
      });
      const check = await resp.json();
      if (!check.error) {
        setTradeChecksMap(prev => {
          const existing = prev[tradeId] || [];
          const filtered = existing.filter(ch => ch.ruleId !== ruleId);
          return { ...prev, [tradeId]: [...filtered, check] };
        });
      }
    } catch (err) {
      console.error('Failed to toggle trade check:', err);
    } finally {
      setChecksLoading(false);
    }
  };

  const handleInlineCreateTag = async () => {
    if (!inlineTagName.trim() || inlineTagCreating) return;
    setInlineTagCreating(true);
    try {
      const response = await authFetch('/api/makeTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inlineTagName.trim(), color: inlineTagColor }),
      });
      const data = await response.json();
      if (!data.error) {
        setInlineTagName('');
        setInlineTagColor(TAG_COLOR_PRESETS[0]);
        setShowNewTagInline(false);
        triggerReload();
      }
    } catch (err) {
      console.error('Failed to create tag:', err);
    }
    setInlineTagCreating(false);
  };

  /**
   * handleBulkEval - Marks or unmarks selected trades as evaluation trades.
   * Calls POST /api/bulkUpdateTrades with action 'markEval' or 'unmarkEval'.
   * Clears selection and triggers data reload on success.
   * @param {boolean} isEval - true to mark as eval, false to unmark
   */
  const handleBulkEval = async (isEval) => {
    if (selectedTradeIds.size === 0 || bulkActionLoading) return;
    setBulkActionLoading(true);
    try {
      const response = await authFetch('/api/bulkUpdateTrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeIds: [...selectedTradeIds],
          action: isEval ? 'markEval' : 'unmarkEval',
        }),
      });
      const data = await response.json();
      if (!data.error) {
        setSelectedTradeIds(new Set());
        triggerReload();
      }
    } catch (err) {
      console.error('Bulk eval error:', err);
    }
    setBulkActionLoading(false);
  };

  /**
   * handleBulkAddTags - Adds one or more tags to all selected trades.
   * Calls POST /api/bulkUpdateTrades with action 'addTags' and tag ID array.
   * Closes tag picker, clears selection, and triggers reload on success.
   * @param {string[]} tagIds - Array of tag IDs to add
   */
  const handleBulkAddTags = async (tagIds) => {
    if (selectedTradeIds.size === 0 || tagIds.length === 0 || bulkActionLoading) return;
    setBulkActionLoading(true);
    try {
      const response = await authFetch('/api/bulkUpdateTrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeIds: [...selectedTradeIds],
          action: 'addTags',
          tags: tagIds,
        }),
      });
      const data = await response.json();
      if (!data.error) {
        setBulkTagPickerOpen(false);
        setSelectedTradeIds(new Set());
        triggerReload();
      }
    } catch (err) {
      console.error('Bulk add tags error:', err);
    }
    setBulkActionLoading(false);
  };

  /**
   * handleBulkDelete - Deletes all selected trades after confirmation.
   * Calls POST /api/bulkDeleteTrades with array of trade IDs.
   * Closes confirm modal, clears selection, and triggers reload on success.
   */
  const handleBulkDelete = async () => {
    if (selectedTradeIds.size === 0 || bulkActionLoading) return;
    setBulkActionLoading(true);
    try {
      const response = await authFetch('/api/bulkDeleteTrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeIds: [...selectedTradeIds] }),
      });
      const data = await response.json();
      if (!data.error) {
        setBulkDeleteConfirm(false);
        setSelectedTradeIds(new Set());
        triggerReload();
      }
    } catch (err) {
      console.error('Bulk delete error:', err);
    }
    setBulkActionLoading(false);
  };

  let filtered = deletingIds.size > 0 ? trades.filter(t => !deletingIds.has(t._id)) : trades;

  if (searchTicker && trackingView === 'all') {
    const terms = searchTicker.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (terms.length > 0) {
      filtered = filtered.filter(t => terms.some(term => t.ticker.toLowerCase().includes(term)));
    }
  }

  if (filterTags.length > 0) {
    filtered = filtered.filter(t =>
      t.tags && t.tags.some(tagId => filterTags.includes(tagId))
    );
  }

  if (sideFilters.length > 0) {
    filtered = filtered.filter(t => {
      const pl = getTradePL(t);
      return sideFilters.every(f => {
        if (f === 'wins') return pl > 0;
        if (f === 'losses') return pl < 0;
        if (f === 'long') return t.quantity > 0;
        if (f === 'short') return t.quantity < 0;
        return true;
      });
    });
  }

  if (dateFrom) {
    const from = new Date(dateFrom);
    filtered = filtered.filter(t => new Date(t.exitTime) >= from);
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    filtered = filtered.filter(t => new Date(t.exitTime) <= to);
  }

  filtered = [...filtered].sort((a, b) => {
    let valA, valB;
    if (sortField === 'ticker') {
      valA = a.ticker.toLowerCase();
      valB = b.ticker.toLowerCase();
    } else if (sortField === 'pl') {
      valA = getTradePL(a);
      valB = getTradePL(b);
    } else {
      valA = new Date(a[sortField]);
      valB = new Date(b[sortField]);
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });


  // Group by the New York trading session, independent of the display time zone.
  const getSessionDateKey = (trade) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(trade.exitTime));
    const get = type => parts.find(part => part.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  };
  const formatGroupDate = (key, options) => {
    const parts = key.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  };
  const currencyCodes = [...new Set(filtered.map(trade => (trade.currency_code || trade.currencyCode || 'USD').toUpperCase()))];
  const hasMixedCurrencies = currencyCodes.length > 1;
  const formatMoney = (value, currency) => {
    const code = currency || (currencyCodes.length === 1 ? currencyCodes[0] : 'USD');
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch { return code + ' ' + Number(value || 0).toFixed(2); }
  };
  const formatAggregateMoney = value => hasMixedCurrencies ? 'Mixed' : formatMoney(value);

  const groupedTrades = (() => {
    const groups = new Map();
    filtered.forEach(trade => {
      const dateKey = getSessionDateKey(trade);
      let groupKey = dateKey;
      let label = formatGroupDate(dateKey, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      if (trackingView === 'week') {
        const [year, month, day] = dateKey.split('-').map(Number);
        const monday = new Date(Date.UTC(year, month - 1, day, 12));
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const sunday = new Date(monday);
        sunday.setUTCDate(sunday.getUTCDate() + 6);
        groupKey = monday.getUTCFullYear() + '-' + String(monday.getUTCMonth() + 1).padStart(2, '0') + '-' + String(monday.getUTCDate()).padStart(2, '0');
        const sundayKey = sunday.getUTCFullYear() + '-' + String(sunday.getUTCMonth() + 1).padStart(2, '0') + '-' + String(sunday.getUTCDate()).padStart(2, '0');
        label = formatGroupDate(groupKey, { month: 'short', day: 'numeric' }) + ' – ' + formatGroupDate(sundayKey, { month: 'short', day: 'numeric', year: 'numeric' });
      }
      if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, label, trades: [], totalPL: 0, wins: 0, losses: 0, grossWins: 0, grossLosses: 0, grossPL: 0, grossPLComplete: true, commissions: 0, volume: 0, currencyCodes: new Set() });
      const group = groups.get(groupKey);
      const pl = getTradePL(trade);
      group.trades.push(trade);
      group.currencyCodes.add((trade.currency_code || trade.currencyCode || 'USD').toUpperCase());
      group.totalPL += pl;
      group.commissions += Number(trade.commissions || 0);
      group.volume += Math.abs(Number(trade.quantity || 0));
      if (trade.grossPL === null || trade.grossPL === undefined || trade.grossPL === '') group.grossPLComplete = false;
      else group.grossPL += Number(trade.grossPL);
      if (pl > 0) { group.wins++; group.grossWins += pl; }
      else if (pl < 0) { group.losses++; group.grossLosses += Math.abs(pl); }
    });
    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
  })();
  useEffect(() => {
    if (trackingView === 'week' && groupedTrades.length > 0) {
      setExpandedGroups(Object.fromEntries(groupedTrades.map((group, index) => [group.key, index === 0])));
    }
  }, [trackingView, groupedTrades.map(group => group.key).join('|')]);

  const displayRows = trackingView === 'all'
    ? filtered.map(trade => ({ type: 'trade', trade }))
    : groupedTrades.flatMap(group => {
        const isExpanded = expandedGroups[group.key] === true;
        if (!isExpanded) return [{ type: 'group', group }];
        const orderedTrades = trackingView === 'day' ? [...group.trades].sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime)) : group.trades;
        return [{ type: 'group', group }, ...((trackingView === 'day' || trackingView === 'week') ? [{ type: trackingView === 'day' ? 'dayHeader' : 'weekHeader', key: group.key }] : []), ...orderedTrades.map(trade => ({ type: 'trade', trade }))];
      });
  const toggleGroup = key => setExpandedGroups(current => ({ ...current, [key]: trackingView === 'day' ? current[key] !== true : current[key] === false }));

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <Icons.ChevronUp className="w-3 h-3 ml-1 inline" /> : <Icons.ChevronDown className="w-3 h-3 ml-1 inline" />;
  };

  const formatDateTime = (dateString) => formatDateEST(dateString);

  const formatTime = (dateString) => formatTimeEST(dateString);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Trades</h1>
          <p className="text-text-secondary text-sm mt-1">Manage and review your trade history</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all" onClick={onOpenForm}>
            <Icons.Plus className="w-4 h-4" />
            New Trade
          </button>
        </div>
      </div>


      <div className="flex items-center gap-1 bg-bg-surface border border-border rounded-lg p-1 w-fit">
        {[
          { id: 'day', label: 'Day' },
          { id: 'week', label: 'Week' },
          { id: 'all', label: 'All' },
        ].map(view => (
          <button
            key={view.id}
            type="button"
            onClick={() => setTrackingView(view.id)}
            className={'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ' + (trackingView === view.id ? 'bg-accent text-accent-text' : 'text-text-secondary hover:text-text-primary')}
          >
            {view.label}
          </button>
        ))}
      </div>

      {trackingView === 'all' && (
        <CustomizableStats
          storageKey="rrmetrics_trades_all_tiles"
          defaultOrder={['netPL', 'profitFactor', 'winRate', 'avgWinLoss', 'totalTrades', 'bestTrade', 'worstTrade', 'avgDuration']}
          defaultVisible={['netPL', 'profitFactor', 'winRate', 'avgWinLoss']}
          items={[
            { id: 'netPL', label: 'Net cumulative P&L', render: () => <StatCard label={hasMixedCurrencies ? 'Net P&L · Mixed currencies' : 'Net cumulative P&L · ' + (currencyCodes[0] || 'USD')} value={formatAggregateMoney(calculateAnalytics(filtered).totalPL)} tooltip="Net profit or loss across the selected trades, after fees and commissions." color={hasMixedCurrencies ? 'text-text-secondary' : calculateAnalytics(filtered).totalPL >= 0 ? 'text-positive' : 'text-negative'} subValue={hasMixedCurrencies ? 'Choose one currency for comparable totals' : filtered.length + ' closed trades'} /> },
            { id: 'profitFactor', label: 'Profit factor', render: () => {
              const grossWins = filtered.reduce((sum, trade) => sum + Math.max(0, getTradePL(trade)), 0);
              const grossLosses = filtered.reduce((sum, trade) => sum + Math.max(0, -getTradePL(trade)), 0);
              const factor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
              return <StatCard label="Profit factor" value={hasMixedCurrencies ? '—' : factor === Infinity ? '∞' : factor.toFixed(2)} color="text-text-primary" subValue={hasMixedCurrencies ? 'Multiple currencies' : undefined} tooltip="Gross profit divided by gross loss. Above 1.00 means gross profits exceed gross losses; below 1.00 means gross losses are larger." />;
            } },
            { id: 'winRate', label: 'Trade win %', render: () => <WinRateCard wins={calculateAnalytics(filtered).wins} losses={calculateAnalytics(filtered).losses} breakevens={calculateAnalytics(filtered).breakevens} total={filtered.length} /> },
            { id: 'avgWinLoss', label: 'Avg Win / Loss', render: () => <AvgWinLossCard avgWin={calculateAnalytics(filtered).avgWin} avgLoss={calculateAnalytics(filtered).avgLoss} /> },
            { id: 'totalTrades', label: 'Total trades', render: () => <StatCard label="Total trades" value={filtered.length} color="text-text-primary" tooltip="Number of closed trades in the selected period." /> },
            { id: 'bestTrade', label: 'Best trade', render: () => <StatCard label="Best trade" value={hasMixedCurrencies ? '—' : formatMoney(filtered.length ? Math.max(...filtered.map(getTradePL)) : 0)} color="text-positive" tooltip="The highest net P&L from a single trade in the selected period." /> },
            { id: 'worstTrade', label: 'Worst trade', render: () => <StatCard label="Worst trade" value={hasMixedCurrencies ? '—' : formatMoney(filtered.length ? Math.min(...filtered.map(getTradePL)) : 0)} color="text-negative" tooltip="The lowest net P&L from a single trade in the selected period." /> },
            { id: 'avgDuration', label: 'Average duration', render: () => <StatCard label="Average duration" value={filtered.length ? formatDuration(filtered.reduce((sum, trade) => sum + (new Date(trade.exitTime) - new Date(trade.enterTime)), 0) / filtered.length) : '—'} color="text-text-primary" tooltip="Average time between entry and exit across the selected trades." /> },
          ]}
        />
      )}

      {trackingView !== 'all' && (
        <div className="flex items-center justify-between text-xs text-text-tertiary">
          <span>{groupedTrades.length} {trackingView === 'day' ? 'trading days' : 'trading weeks'} · {filtered.length} trades</span>
          <button type="button" className="hover:text-text-primary" onClick={() => setExpandedGroups({})}>Expand all</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {trackingView === 'all' && (
          <>
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
              <input
                type="text"
                placeholder="Search tickers (comma-separated)..."
                value={searchTicker}
                onChange={(e) => setSearchTicker(e.target.value.toUpperCase())}
                className="w-full pl-9 pr-4 py-2.5 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                style={{ textTransform: 'uppercase' }}
                autoComplete="off"
              />
            </div>
          </>
        )}
        <DateRangePicker startDate={dateFrom} endDate={dateTo} onChange={({ startDate, endDate }) => { setDateFrom(startDate); setDateTo(endDate); }} />
        <div className="flex items-center gap-1.5">
          {[
            { id: 'long', label: 'Long', activeClass: 'bg-positive/15 border-positive/50 text-positive' },
            { id: 'short', label: 'Short', activeClass: 'bg-negative/15 border-negative/50 text-negative' },
            { id: 'wins', label: 'Wins', activeClass: 'bg-positive/15 border-positive/50 text-positive' },
            { id: 'losses', label: 'Losses', activeClass: 'bg-negative/15 border-negative/50 text-negative' },
          ].map(opt => {
            const isActive = sideFilters.includes(opt.id);
            return (
              <button
                key={opt.id}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? opt.activeClass
                    : 'bg-bg-input border-border text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setSideFilters(prev =>
                  prev.includes(opt.id) ? prev.filter(f => f !== opt.id) : [...prev, opt.id]
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags && tags.map(tag => {
            const isActive = filterTags.includes(tag._id);
            return (
              <button
                key={tag._id}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  !isActive ? 'bg-bg-input border-border text-text-secondary hover:text-text-primary' : ''
                }`}
                style={isActive ? {
                  borderColor: tag.color,
                  backgroundColor: tag.color + '20',
                  color: tag.color,
                } : undefined}
                onClick={() => {
                  setFilterTags(prev =>
                    prev.includes(tag._id)
                      ? prev.filter(id => id !== tag._id)
                      : [...prev, tag._id]
                  );
                }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                {tag.name}
              </button>
            );
          })}
          {!showNewTagInline ? (
            <button
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-text-tertiary hover:text-text-primary hover:border-accent transition-colors"
              onClick={() => setShowNewTagInline(true)}
            >
              <Icons.Plus className="w-3 h-3" />
              New Tag
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-input border border-border rounded-full">
              <input
                type="text"
                value={inlineTagName}
                onChange={(e) => setInlineTagName(e.target.value)}
                placeholder="Tag name"
                className="bg-transparent text-text-primary text-xs focus:outline-none w-20 placeholder-text-muted"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleInlineCreateTag(); if (e.key === 'Escape') { setShowNewTagInline(false); setInlineTagName(''); } }}
              />
              {TAG_COLOR_PRESETS.slice(0, 4).map(color => (
                <button
                  key={color}
                  type="button"
                  className={`w-4 h-4 rounded-full border transition-all flex-shrink-0 ${
                    inlineTagColor === color ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setInlineTagColor(color)}
                />
              ))}
              <button
                className="text-accent text-xs font-semibold hover:brightness-110 disabled:opacity-50 px-1"
                onClick={handleInlineCreateTag}
                disabled={inlineTagCreating || !inlineTagName.trim()}
              >
                {inlineTagCreating ? '...' : 'Add'}
              </button>
              <button
                className="text-text-muted text-xs hover:text-text-primary px-0.5"
                onClick={() => { setShowNewTagInline(false); setInlineTagName(''); }}
              >
                &times;
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {trackingView === 'all' && <span className="text-text-tertiary text-sm">{filtered.length} trade{filtered.length !== 1 ? 's' : ''}</span>}
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-input border border-border transition-colors"
              title="Toggle columns"
            >
              <Icons.Layers className="w-3.5 h-3.5" />
              Columns
            </button>
            {showColumnMenu && (
              <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColumnMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-bg-surface border border-border rounded-lg shadow-xl p-1.5 min-w-[160px]">
                {COLUMN_DEFS.filter(c => !c.alwaysOn).map(col => (
                  <label
                    key={col.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-bg-input transition-colors"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        isCol(col.id) ? 'bg-accent border-accent' : 'border-border'
                      }`}
                      onClick={(e) => { e.preventDefault(); toggleColumn(col.id); }}
                    >
                      {isCol(col.id) && <Icons.Check className="w-3 h-3 text-accent-text" />}
                    </div>
                    <span className="text-sm text-text-secondary">{col.label}</span>
                  </label>
                ))}
              </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bulk action bar — shown when one or more trades are checkbox-selected */}
      {selectedTradeIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-accent/10 border border-accent/30 rounded-xl">
          <span className="text-sm font-semibold text-text-primary">{selectedTradeIds.size} trade{selectedTradeIds.size !== 1 ? 's' : ''} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              className="px-3 py-1.5 text-xs font-medium bg-bg-surface border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-accent transition-all disabled:opacity-50"
              onClick={() => handleBulkEval(true)}
              disabled={bulkActionLoading}
            >
              Mark Eval
            </button>
            <button
              className="px-3 py-1.5 text-xs font-medium bg-bg-surface border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-accent transition-all disabled:opacity-50"
              onClick={() => handleBulkEval(false)}
              disabled={bulkActionLoading}
            >
              Unmark Eval
            </button>
            <div className="relative">
              <button
                className="px-3 py-1.5 text-xs font-medium bg-bg-surface border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-accent transition-all disabled:opacity-50"
                onClick={() => setBulkTagPickerOpen(v => !v)}
                disabled={bulkActionLoading}
              >
                Add Tags
              </button>
              {bulkTagPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBulkTagPickerOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 bg-bg-surface border border-border rounded-lg shadow-xl p-2 min-w-[180px]">
                    {tags && tags.map(tag => (
                      <button
                        key={tag._id}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-input hover:text-text-primary transition-colors"
                        onClick={() => handleBulkAddTags([tag._id])}
                      >
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                        {tag.name}
                      </button>
                    ))}
                    {(!tags || tags.length === 0) && (
                      <p className="text-text-muted text-xs px-3 py-2">No tags created yet</p>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              className="px-3 py-1.5 text-xs font-medium bg-negative/10 border border-negative/30 rounded-lg text-negative hover:bg-negative/20 transition-all disabled:opacity-50"
              onClick={() => setBulkDeleteConfirm(true)}
              disabled={bulkActionLoading}
            >
              Delete
            </button>
            <button
              className="px-3 py-1.5 text-xs font-medium text-text-tertiary hover:text-text-primary transition-colors"
              onClick={() => setSelectedTradeIds(new Set())}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-text-tertiary text-lg">No trades yet</p>
            <p className="text-text-muted text-sm mt-1">Add your first trade to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              {trackingView === 'all' && <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-border accent-accent"
                      checked={filtered.length > 0 && filtered.every(t => selectedTradeIds.has(t._id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTradeIds(new Set(filtered.map(t => t._id)));
                        } else {
                          setSelectedTradeIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary" onClick={() => toggleSort('exitTime')}>
                    Date <SortIcon field="exitTime" />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary" onClick={() => toggleSort('ticker')}>
                    Ticker <SortIcon field="ticker" />
                  </th>
                  {isCol('tags') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Tags</th>}
                  {isCol('entry') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Entry</th>}
                  {isCol('exit') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Exit</th>}
                  {isCol('qty') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Qty</th>}
                  {isCol('gross') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Gross P/L</th>}
                  {isCol('fees') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Fees</th>}
                  {isCol('commissions') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Commissions</th>}
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer hover:text-text-primary" onClick={() => toggleSort('pl')}>
                    Net P/L <SortIcon field="pl" />
                  </th>
                  {isCol('duration') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Duration</th>}
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Actions</th>
                </tr>
              </thead>}
              <tbody>
                {displayRows.map(item => {
                  if (item.type === 'dayHeader') {
                    return (
                      <tr key={'day-header-' + item.key} className="bg-bg-input/70 border-y border-border">
                        <th className="px-4 py-3 w-10"><input type="checkbox" className="rounded border-border accent-accent" checked={filtered.length > 0 && filtered.every(t => selectedTradeIds.has(t._id))} onChange={e => setSelectedTradeIds(e.target.checked ? new Set(filtered.map(t => t._id)) : new Set())} /></th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('exitTime')}>Date <SortIcon field="exitTime" /></th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('ticker')}>Ticker <SortIcon field="ticker" /></th>
                        {isCol('tags') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Tags</th>}
                        {isCol('entry') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Entry</th>}
                        {isCol('exit') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Exit</th>}
                        {isCol('qty') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Qty</th>}
                        {isCol('gross') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Gross P/L</th>}
                        {isCol('fees') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Fees</th>}
                        {isCol('commissions') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Commissions</th>}
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('pl')}>Net P/L <SortIcon field="pl" /></th>
                        {isCol('duration') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Duration</th>}
                        <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Actions</th>
                      </tr>
                    );
                  }
                  if (item.type === 'weekHeader') {
                    return (
                      <tr key={'week-header-' + item.key} className="bg-bg-input/70 border-y border-border">
                        <th className="px-4 py-3 w-10"><input type="checkbox" className="rounded border-border accent-accent" checked={filtered.length > 0 && filtered.every(t => selectedTradeIds.has(t._id))} onChange={e => setSelectedTradeIds(e.target.checked ? new Set(filtered.map(t => t._id)) : new Set())} /></th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('exitTime')}>Date <SortIcon field="exitTime" /></th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('ticker')}>Ticker <SortIcon field="ticker" /></th>
                        {isCol('tags') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Tags</th>}
                        {isCol('entry') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Entry</th>}
                        {isCol('exit') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Exit</th>}
                        {isCol('qty') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Qty</th>}
                        {isCol('gross') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Gross P/L</th>}
                        {isCol('fees') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Fees</th>}
                        {isCol('commissions') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Commissions</th>}
                        <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider cursor-pointer" onClick={() => toggleSort('pl')}>Net P/L <SortIcon field="pl" /></th>
                        {isCol('duration') && <th className="text-left px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Duration</th>}
                        <th className="text-right px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Actions</th>
                      </tr>
                    );
                  }
                  if (item.type === 'group') {
                    const group = item.group;
                    const isOpen = trackingView === 'day' ? expandedGroups[group.key] === true : expandedGroups[group.key] !== false;
                    const decisive = group.wins + group.losses;
                    const winRate = decisive > 0 ? (group.wins / decisive) * 100 : 0;
                    const profitFactor = group.grossLosses > 0 ? group.grossWins / group.grossLosses : group.grossWins > 0 ? Infinity : 0;
                    const groupHasMixedCurrencies = group.currencyCodes.size > 1;
                    if (trackingView === 'day') {
                      const currency = [...group.currencyCodes][0] || 'USD';
                      const existingNote = dailyNotes.find(note => note.date === group.key);
                      const hasNote = Boolean(existingNote && existingNote.content);
                      return (
                        <tr key={'group-' + group.key} className="border-b border-border/60">
                          <td colSpan={visibleColCount} className="p-3">
                            <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
                              <div className="w-full flex items-center justify-between gap-3 px-4 py-3">
                                <button type="button" onClick={() => toggleGroup(group.key)} aria-expanded={isOpen} className="flex items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity">
                                  <span className="text-text-secondary">{isOpen ? '⌄' : '›'}</span>
                                  <span className="font-semibold text-text-primary text-sm whitespace-nowrap">{group.label}</span>
                                  <span className="text-text-tertiary">·</span>
                                  <span className={'font-mono text-sm font-semibold whitespace-nowrap ' + (group.totalPL >= 0 ? 'text-positive' : 'text-negative')}>
                                    {groupHasMixedCurrencies ? 'Mixed currencies' : 'Net P&L ' + (group.totalPL > 0 ? '+' : '') + formatMoney(group.totalPL, currency)}
                                  </span>
                                </button>
                                <button type="button" onClick={() => { setEditingNoteDate(group.key); setNoteDraft(existingNote ? existingNote.content : ''); }} className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-accent transition-colors whitespace-nowrap" title={hasNote ? 'Edit day note' : 'Add day note'}>
                                  <Icons.Edit className="w-3.5 h-3.5" /> {hasNote ? 'Edit note' : 'Add note'}
                                  {hasNote && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                                </button>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,0.9fr)_1.5fr] gap-5 px-4 pb-4 pt-1">
                                <DailyPnlChart trades={group.trades} currency={currency} formatMoney={formatMoney} totalPL={group.totalPL} />
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 content-center">
                                  <DailyMetric label="Total trades" value={group.trades.length} />
                                  <DailyMetric label="Win rate" value={winRate.toFixed(1) + '%'} />
                                  <DailyMetric label="Winners / losers" value={group.wins + ' / ' + group.losses} />
                                  <DailyMetric label="Profit factor" value={groupHasMixedCurrencies ? '—' : profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} />
                                  <DailyMetric label="Gross P&L" value={group.grossPLComplete && !groupHasMixedCurrencies ? formatMoney(group.grossPL, currency) : '—'} />
                                  <DailyMetric label="Commissions" value={!groupHasMixedCurrencies ? formatMoney(group.commissions, currency) : '—'} />
                                  <DailyMetric label="Volume" value={group.volume.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' contracts'} />
                                  <DailyMetric label="Breakeven" value={group.trades.filter(trade => getTradePL(trade) === 0).length} />
                                </div>
                              </div>
                              {!isOpen && null}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    const currency = [...group.currencyCodes][0] || 'USD';
                    const dailyBreakdown = (() => {
                      const days = new Map();
                      group.trades.forEach(trade => {
                        const day = getSessionDateKey(trade);
                        days.set(day, (days.get(day) || 0) + getTradePL(trade));
                      });
                      return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
                    })();
                    const maxDailyAbs = Math.max(1, ...dailyBreakdown.map(([, value]) => Math.abs(value)));
                    const dailyCounts = new Map();
                    group.trades.forEach(trade => {
                      const day = getSessionDateKey(trade);
                      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
                    });
                    const chartWidth = 560;
                    const chartHeight = 118;
                    const chartTop = 8;
                    const chartBottom = 22;
                    const zeroY = chartTop + (chartHeight - chartTop - chartBottom) / 2;
                    const maxBarHeight = (chartHeight - chartTop - chartBottom) / 2;
                    const barSlot = chartWidth / 7;
                    const barWidth = Math.min(34, barSlot * 0.58);
                    return (
                      <tr key={'group-' + group.key} className="border-b border-border/60">
                        <td colSpan={visibleColCount} className="p-3">
                          <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
                            <button type="button" onClick={() => toggleGroup(group.key)} aria-expanded={isOpen} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-bg-input/40 transition-colors">
                              <span className="text-text-secondary">{isOpen ? '⌄' : '›'}</span>
                              <span className="font-semibold text-text-primary text-sm">{group.label}</span>
                              <span className="text-text-tertiary">·</span>
                              <span className={'font-mono text-sm font-bold ' + (group.totalPL >= 0 ? 'text-positive' : 'text-negative')}>
                                {groupHasMixedCurrencies ? 'Mixed currencies' : 'Net P&L ' + (group.totalPL > 0 ? '+' : '') + formatMoney(group.totalPL, currency)}
                              </span>
                              <span className="ml-auto text-[11px] text-text-tertiary">{group.trades.length} closed trades · {group.wins} wins · {group.losses} losses</span>
                            </button>
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(340px,0.95fr)_1.5fr] gap-5 px-4 pb-4 pt-1">
                              <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Daily P&L</div>
                                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[118px]" role="img" aria-label="Daily profit and loss for this week">
                                  <line x1="0" y1={zeroY} x2={chartWidth} y2={zeroY} stroke="currentColor" opacity="0.24" strokeDasharray="3 3" />
                                  {Array.from({ length: 7 }, (_, index) => {
                                    const date = new Date(group.key + 'T12:00:00Z');
                                    date.setUTCDate(date.getUTCDate() + index);
                                    const dayKey = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
                                    const value = dailyBreakdown.find(([day]) => day === dayKey)?.[1] || 0;
                                    const count = dailyCounts.get(dayKey) || 0;
                                    const barHeight = Math.abs(value) / maxDailyAbs * maxBarHeight;
                                    const x = index * barSlot + (barSlot - barWidth) / 2;
                                    const y = value >= 0 ? zeroY - barHeight : zeroY;
                                    const label = formatGroupDate(dayKey, { weekday: 'short' });
                                    return (
                                      <g key={dayKey} className="cursor-default">
                                        <title>{label}: {formatMoney(value, currency)} · {count} {count === 1 ? 'trade' : 'trades'}</title>
                                        {count > 0 && <rect x={x} y={y} width={barWidth} height={Math.max(2, barHeight)} rx="3" fill={value >= 0 ? '#22c55e' : '#ef4444'} opacity="0.86" />}
                                        <text x={x + barWidth / 2} y={chartHeight - 5} textAnchor="middle" fill="currentColor" opacity="0.65" fontSize="11">{label}</text>
                                        <rect x={index * barSlot} y="0" width={barSlot} height={chartHeight} fill="transparent" pointerEvents="all">
                                          <title>{label}: {formatMoney(value, currency)} · {count} {count === 1 ? 'trade' : 'trades'}</title>
                                        </rect>
                                      </g>
                                    );
                                  })}
                                </svg>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 content-center">
                                <DailyMetric label="Total trades" value={group.trades.length} />
                                <DailyMetric label="Win rate" value={winRate.toFixed(1) + '%'} />
                                <DailyMetric label="Winners / losers" value={group.wins + ' / ' + group.losses} />
                                <DailyMetric label="Profit factor" value={groupHasMixedCurrencies ? '—' : profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} />
                                <DailyMetric label="Gross P&L" value={group.grossPLComplete && !groupHasMixedCurrencies ? formatMoney(group.grossPL, currency) : '—'} />
                                <DailyMetric label="Commissions" value={!groupHasMixedCurrencies ? formatMoney(group.commissions, currency) : '—'} />
                                <DailyMetric label="Volume" value={group.volume.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' contracts'} />
                                <DailyMetric label="Breakeven" value={group.trades.filter(trade => getTradePL(trade) === 0).length} />
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  const trade = item.trade;
                  const pl = getTradePL(trade);
                  const duration = new Date(trade.exitTime) - new Date(trade.enterTime);
                  const isExpanded = expandedTradeId === trade._id;
                  const tradeTags = tags && trade.tags ? tags.filter(tag => trade.tags.includes(tag._id)) : [];
                  return (
                    <React.Fragment key={trade._id}>
                      <tr
                        className={`border-b transition-colors cursor-pointer ${selectedTradeIds.has(trade._id)
                          ? 'bg-accent/10 border-y border-accent/70 shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.45)]'
                          : 'border-border/50 hover:bg-bg-input/50'}`}
                        onClick={() => onEdit(trade)}
                      >
                        <td className="px-4 py-3 w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded border-border accent-accent"
                            checked={selectedTradeIds.has(trade._id)}
                            onChange={() => {
                              setSelectedTradeIds(prev => {
                                const next = new Set(prev);
                                if (next.has(trade._id)) next.delete(trade._id);
                                else next.add(trade._id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-text-primary text-sm">{formatDateTime(trade.exitTime)}</div>
                          <div className="text-text-muted text-xs">{formatTime(trade.enterTime)} - {formatTime(trade.exitTime)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm font-semibold text-text-primary">{trade.ticker}</span>
                          <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            trade.quantity > 0
                              ? 'bg-positive/15 text-positive'
                              : 'bg-negative/15 text-negative'
                          }`}>
                            {trade.quantity > 0 ? 'LONG' : 'SHORT'}
                          </span>
                          {trade.isEval && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/15 text-accent">EVAL</span>
                          )}
                        </td>
                        {isCol('tags') && (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {trade.tags && trade.tags.map(tagId => {
                                const tag = tags && tags.find(t => t._id === tagId);
                                if (!tag) return null;
                                return (
                                  <span
                                    key={tagId}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                    style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                  >
                                    {tag.name}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        )}
                        {isCol('entry') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">${trade.enterPrice.toFixed(2)}</td>}
                        {isCol('exit') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">${trade.exitPrice.toFixed(2)}</td>}
                        {isCol('qty') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">{trade.quantity}</td>}
                        {isCol('gross') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">{trade.grossPL == null ? '—' : formatMoney(Number(trade.grossPL), (trade.currency_code || trade.currencyCode || 'USD').toUpperCase())}</td>}
                        {isCol('fees') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">{formatMoney(Number(trade.fees || 0), (trade.currency_code || trade.currencyCode || 'USD').toUpperCase())}</td>}
                        {isCol('commissions') && <td className="px-4 py-3 font-mono text-sm text-text-secondary">{formatMoney(Number(trade.commissions || 0), (trade.currency_code || trade.currencyCode || 'USD').toUpperCase())}</td>}
                        <td className="px-4 py-3">
                          <span className={`font-mono text-sm font-semibold ${pl >= 0 ? 'text-positive' : 'text-negative'}`}>
                            {formatMoney(pl, (trade.currency_code || trade.currencyCode || 'USD').toUpperCase())}
                          </span>
                          {trade.manualPL !== null && trade.manualPL !== undefined && (
                            <span className="text-text-muted text-xs ml-1">(M)</span>
                          )}
                        </td>
                        {isCol('duration') && <td className="px-4 py-3 text-sm text-text-secondary">{formatDuration(duration)}</td>}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-input transition-colors"
                              onClick={(e) => { e.stopPropagation(); onEdit(trade); }}
                              title="Edit"
                            >
                              <Icons.Edit />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-text-tertiary hover:text-negative hover:bg-negative/10 transition-colors"
                              onClick={(e) => { e.stopPropagation(); handleDeleteClick(trade._id); }}
                              title="Delete"
                            >
                              <Icons.Trash />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border/50">
                          <td colSpan={visibleColCount} className="px-6 py-4 bg-bg-input/20">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                {tradeTags.length > 0 && (
                                  <div>
                                    <span className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">Tags</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                      {tradeTags.map(tag => (
                                        <span key={tag._id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: tag.color + '22', color: tag.color }}>
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }}></span>
                                          {tag.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {trade.comments && (
                                  <div>
                                    <span className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">Notes</span>
                                    <div className="text-xs text-text-secondary bg-bg-surface rounded-lg px-3 py-2 mt-1.5">{trade.comments}</div>
                                  </div>
                                )}
                                {trade.screenshot && (
                                  <div>
                                    <span className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">Screenshot</span>
                                    <img src={trade.screenshot} alt="Trade screenshot" className="rounded-lg border border-border max-h-48 w-full object-contain bg-bg-surface mt-1.5" />
                                  </div>
                                )}
                                {!trade.comments && !trade.screenshot && tradeTags.length === 0 && tradeRules.length === 0 && (
                                  <p className="text-text-muted text-xs">No notes or screenshot attached to this trade.</p>
                                )}
                              </div>
                              {tradeRules.length > 0 && (
                                <div>
                                  <span className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">Trade Rules</span>
                                  <div className="mt-1.5">
                                    <RuleChecklist
                                      rules={tradeRules}
                                      checks={tradeChecksMap[trade._id] || []}
                                      onToggle={(ruleId, followed) => handleTradeRuleToggle(trade._id, ruleId, followed)}
                                      loading={checksLoading}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingNoteDate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !noteSaving && setEditingNoteDate(null)}>
          <div className="bg-bg-surface border border-border rounded-xl p-5 w-full max-w-lg shadow-xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-text-primary font-semibold">Day note · {formatGroupDate(editingNoteDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</h3>
              <button type="button" className="text-text-tertiary hover:text-text-primary" onClick={() => setEditingNoteDate(null)} disabled={noteSaving}><Icons.X /></button>
            </div>
            <textarea value={noteDraft} onChange={event => setNoteDraft(event.target.value)} rows={6} placeholder="What happened today? Record your observations, decisions or lessons..." className="w-full resize-y rounded-lg border border-border bg-bg-input text-text-primary text-sm p-3 focus:outline-none focus:border-accent" />
            <div className="flex items-center justify-between gap-2 mt-3">
              <div>
                {dailyNotes.some(note => note.date === editingNoteDate) && (
                  <button type="button" className="text-xs text-negative hover:underline disabled:opacity-50" disabled={noteSaving} onClick={async () => { setNoteSaving(true); await onDeleteNote(editingNoteDate); setNoteSaving(false); setEditingNoteDate(null); }}>Delete note</button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 text-xs text-text-secondary hover:text-text-primary" disabled={noteSaving} onClick={() => setEditingNoteDate(null)}>Cancel</button>
                <button type="button" className="px-4 py-2 rounded-lg bg-accent text-accent-text text-xs font-semibold disabled:opacity-50" disabled={noteSaving || !noteDraft.trim()} onClick={async () => { setNoteSaving(true); await onSaveNote(editingNoteDate, noteDraft.trim()); setNoteSaving(false); setEditingNoteDate(null); }}>Save note</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-text-primary font-semibold mb-1">Delete Trade</h3>
            <p className="text-text-secondary text-sm mb-5">Are you sure you want to delete this trade? This cannot be undone.</p>
            <label className="flex items-center gap-2 text-text-tertiary text-sm mb-5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded"
                onChange={e => {
                  if (e.target.checked) localStorage.setItem('skipTradeDeleteConfirm', 'true');
                  else localStorage.removeItem('skipTradeDeleteConfirm');
                }}
              />
              Do not show again
            </label>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => setDeleteConfirmId(null)}
              >Cancel</button>
              <button
                className="px-4 py-2 text-sm bg-negative text-white rounded-lg hover:opacity-80 transition-opacity"
                onClick={() => doDelete(deleteConfirmId)}
              >Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation modal */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setBulkDeleteConfirm(false)}>
          <div className="bg-bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-text-primary font-semibold mb-1">Delete {selectedTradeIds.size} Trade{selectedTradeIds.size !== 1 ? 's' : ''}</h3>
            <p className="text-text-secondary text-sm mb-5">Are you sure you want to delete {selectedTradeIds.size} trade{selectedTradeIds.size !== 1 ? 's' : ''}? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => setBulkDeleteConfirm(false)}
              >Cancel</button>
              <button
                className="px-4 py-2 text-sm bg-negative text-white rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
                onClick={handleBulkDelete}
                disabled={bulkActionLoading}
              >{bulkActionLoading ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};


module.exports = TradeListPage;
