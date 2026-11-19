const React = require("react");
const { useState, useEffect } = React;
const helper = require("../../helper.js");
const { authFetch } = helper;
const Icons = require("../shared/Icons");
const ChangeIndicator = require("../shared/ChangeIndicator");
const RuleChecklist = require("../shared/RuleChecklist");
const { getTradePL, groupTradesByDate } = require("../../utils/analytics");
const { formatDuration, formatFullDateEST, formatTimeEST } = require("../../utils/dateUtils");
const { isBreakevenTrade } = require("../../utils/tickValues");
const formatCurrency = (value, currency = 'USD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: Math.abs(Number(value)) >= 1000 ? 1 : 0, maximumFractionDigits: Math.abs(Number(value)) >= 1000 ? 1 : 0, notation: 'compact' }).format(value); }
  catch { return `${currency} ${Number(value || 0).toFixed(0)}`; }
};
const { calcPercentChange } = require("../../utils/periodUtils");

const DayDetailPanel = ({ dateKey, dayData, onClose, dailyNotes, onSaveNote, onDeleteNote, tags, strategyRules, onEditTrade, sidebarCollapsed }) => {
  const [expandedTrade, setExpandedTrade] = useState(null);
  const [dailyChecks, setDailyChecks] = useState([]);
  const [tradeChecksMap, setTradeChecksMap] = useState({});
  const [checksLoading, setChecksLoading] = useState(false);
  const date = new Date(dateKey + 'T00:00:00');
  const formatted = formatFullDateEST(date);
  const dayRules = strategyRules ? strategyRules.filter(r => r.type === 'day') : [];
  const tradeRules = strategyRules ? strategyRules.filter(r => r.type === 'trade') : [];

  useEffect(() => {
    if (!strategyRules || strategyRules.length === 0) return;
    const fetchDailyChecks = async () => {
      try {
        const resp = await authFetch(`/api/strategy/checks/daily/${dateKey}`);
        const data = await resp.json();
        if (!data.error) setDailyChecks(data.checks || []);
      } catch (err) {
        console.error('Failed to fetch daily checks:', err);
      }
    };
    fetchDailyChecks();
  }, [dateKey, strategyRules]);

  const handleDailyToggle = async (ruleId, followed) => {
    setChecksLoading(true);
    try {
      const resp = await authFetch('/api/strategy/checks/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, date: dateKey, followed }),
      });
      const check = await resp.json();
      if (!check.error) {
        setDailyChecks(prev => {
          const filtered = prev.filter(ch => ch.ruleId !== ruleId);
          return [...filtered, check];
        });
      }
    } catch (err) {
      console.error('Failed to toggle daily check:', err);
    } finally {
      setChecksLoading(false);
    }
  };

  const fetchTradeChecks = async (tradeId) => {
    if (tradeChecksMap[tradeId]) return;
    try {
      const resp = await authFetch(`/api/strategy/checks/trade/${tradeId}`);
      const data = await resp.json();
      if (!data.error) {
        setTradeChecksMap(prev => ({ ...prev, [tradeId]: data.checks || [] }));
      }
    } catch (err) {
      console.error('Failed to fetch trade checks:', err);
    }
  };

  const handleTradeToggle = async (tradeId, ruleId, followed) => {
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

  const trades = dayData.trades;
  const wins = trades.filter(t => getTradePL(t) > 0).length;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : 0;
  const avgDuration = trades.length > 0
    ? trades.reduce((sum, t) => sum + (new Date(t.exitTime) - new Date(t.enterTime)), 0) / trades.length
    : 0;

  const existingNote = dailyNotes && dailyNotes.find(n => n.date === dateKey);
  const [noteText, setNoteText] = useState(existingNote ? existingNote.content : '');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    const found = dailyNotes && dailyNotes.find(n => n.date === dateKey);
    setNoteText(found ? found.content : '');
  }, [dateKey, dailyNotes]);

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSaveNote = async () => {
    if (!noteText.trim() || noteSaving) return;
    setNoteSaving(true);
    await onSaveNote(dateKey, noteText.trim());
    setNoteSaving(false);
  };

  const handleDeleteNote = async () => {
    setNoteSaving(true);
    await onDeleteNote(dateKey);
    setNoteText('');
    setNoteSaving(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="w-[480px] max-w-full h-full flex flex-col bg-bg-surface border-l border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-text-primary font-semibold">{formatted}</h3>
            <p className="text-text-secondary text-xs mt-0.5">{dayData.tradeCount} trade{dayData.tradeCount !== 1 ? 's' : ''}</p>
          </div>
          <button className="text-text-secondary hover:text-text-primary transition-colors" onClick={onClose}>
            <Icons.X />
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border">
          <div className="text-center">
            <div className="text-text-secondary text-xs mb-1">Total P/L</div>
            {dayData.tradeCount > 0 ? (
              <div className={`font-mono text-sm font-bold ${dayData.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>
                ${dayData.totalPL.toFixed(2)}
              </div>
            ) : (
              <div className="font-mono text-sm font-bold text-text-muted">N/A</div>
            )}
          </div>
          <div className="text-center">
            <div className="text-text-secondary text-xs mb-1">Win Rate</div>
            <div className="font-mono text-sm font-bold text-text-primary">{dayData.tradeCount > 0 ? `${winRate}%` : 'N/A'}</div>
          </div>
          <div className="text-center">
            <div className="text-text-secondary text-xs mb-1">Trades</div>
            <div className="font-mono text-sm font-bold text-text-primary">{dayData.tradeCount}</div>
          </div>
          <div className="text-center">
            <div className="text-text-secondary text-xs mb-1">Avg Duration</div>
            <div className="font-mono text-sm font-bold text-text-primary">{dayData.tradeCount > 0 ? formatDuration(avgDuration) : 'N/A'}</div>
          </div>
        </div>

        {/* Trade list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {trades.length > 0 && (
            <div className="space-y-2 mb-4">
              {trades.map(trade => {
                const pl = getTradePL(trade);
                const duration = new Date(trade.exitTime) - new Date(trade.enterTime);
                const entryTime = formatTimeEST(trade.enterTime);
                const exitTime = formatTimeEST(trade.exitTime);
                const isLong = trade.quantity > 0;
                const isExpanded = expandedTrade === trade._id;
                const tradeTags = tags && trade.tags ? tags.filter(tag => trade.tags.includes(tag._id)) : [];
                return (
                  <div key={trade._id} className="rounded-lg bg-bg-input border border-border overflow-hidden">
                    <button
                      className="flex items-center justify-between w-full py-2.5 px-3 text-left hover:bg-bg-input/80 transition-colors"
                      onClick={() => {
                        const nextId = isExpanded ? null : trade._id;
                        setExpandedTrade(nextId);
                        if (nextId && tradeRules.length > 0) fetchTradeChecks(nextId);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${isLong ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative'}`}>
                          {isLong ? 'L' : 'S'}
                        </span>
                        <span className="font-mono text-sm font-semibold text-text-primary">{trade.ticker}</span>
                        <span className="text-text-tertiary text-xs">{entryTime} - {exitTime}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm font-semibold ${pl >= 0 ? 'text-positive' : 'text-negative'}`}>
                          {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
                        </span>
                        {onEditTrade && (
                          <button
                            className="text-text-muted hover:text-accent transition-colors"
                            title="Edit trade"
                            onClick={(e) => { e.stopPropagation(); onEditTrade(trade); }}
                          >
                            <Icons.Edit className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <Icons.ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-2">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Entry Price</span>
                            <span className="font-mono text-text-primary">${trade.enterPrice.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Exit Price</span>
                            <span className="font-mono text-text-primary">${trade.exitPrice.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Quantity</span>
                            <span className="font-mono text-text-primary">{Math.abs(trade.quantity)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Duration</span>
                            <span className="font-mono text-text-primary">{formatDuration(duration)}</span>
                          </div>
                        </div>
                        {tradeTags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {tradeTags.map(tag => (
                              <span key={tag._id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: tag.color + '22', color: tag.color }}>
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }}></span>
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {trade.comments && (
                          <div className="text-xs text-text-secondary bg-bg-surface rounded px-2.5 py-2 mt-1">
                            {trade.comments}
                          </div>
                        )}
                        {trade.screenshot && (
                          <div className="mt-1">
                            <img src={trade.screenshot} alt="Trade screenshot" className="rounded-lg border border-border max-h-40 w-full object-contain bg-bg-surface" />
                          </div>
                        )}
                        {tradeRules.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <label className="text-text-secondary text-[10px] font-semibold uppercase tracking-wider mb-1.5 block">Trade Rules</label>
                            <RuleChecklist
                              rules={tradeRules}
                              checks={tradeChecksMap[trade._id] || []}
                              onToggle={(ruleId, followed) => handleTradeToggle(trade._id, ruleId, followed)}
                              loading={checksLoading}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Daily Note */}
          <div className="border-t border-border pt-3">
            <label className="text-text-secondary text-xs font-medium mb-1.5 block">Daily Note</label>
            <textarea
              className="w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors resize-none"
              rows="3"
              placeholder="Add a note for this day..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                className="px-3 py-1.5 bg-accent text-accent-text text-xs font-semibold rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
                onClick={handleSaveNote}
                disabled={noteSaving || !noteText.trim()}
              >
                {noteSaving ? 'Saving...' : 'Save Note'}
              </button>
              {existingNote && (
                <button
                  className="px-3 py-1.5 text-xs text-text-tertiary hover:text-negative transition-colors"
                  onClick={handleDeleteNote}
                  disabled={noteSaving}
                >
                  Delete Note
                </button>
              )}
            </div>
          </div>

          {/* Daily Rule Checks */}
          {dayRules.length > 0 && (
            <div className="border-t border-border pt-3">
              <label className="text-text-secondary text-xs font-medium mb-1.5 block">Daily Rules</label>
              <RuleChecklist
                rules={dayRules}
                checks={dailyChecks}
                onToggle={handleDailyToggle}
                loading={checksLoading}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// =====================================================
// CALENDAR VIEW (with Daily / Heatmap / Monthly / Yearly modes)
// =====================================================
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarView = ({ trades, dailyNotes, onSaveNote, onDeleteNote, tags, strategyRules, onOpenAddTrade, onEditTrade, sidebarCollapsed }) => {
  const [viewMode, setViewMode] = useState('daily'); // 'daily' | 'heatmap' | 'monthly' | 'yearly'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedNoteDate, setSelectedNoteDate] = useState(null);
  const dailyData = groupTradesByDate(trades);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const viewModes = [
    { id: 'daily', label: 'Daily', icon: Icons.Calendar },
    { id: 'heatmap', label: 'Heatmap', icon: Icons.Grid },
    { id: 'monthly', label: 'Monthly', icon: Icons.Layers },
    { id: 'yearly', label: 'Yearly', icon: Icons.Layers },
  ];

  // Compute month P&L for the header badge (daily view only)
  let monthPL = 0;
  let monthTrades = 0;
  let monthTradingDays = 0;
  const monthCurrencies = new Set();
  let prevMonthPL = 0;
  let prevMonthTrades = 0;
  if (viewMode === 'daily') {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dailyData[dk]) {
        monthPL += dailyData[dk].totalPL;
        monthTrades += dailyData[dk].tradeCount;
        monthTradingDays++;
        dailyData[dk].trades.forEach(trade => monthCurrencies.add((trade.currency_code || trade.currencyCode || 'USD').toUpperCase()));
      }
    }
    // Previous month for % change
    const prevM = month === 0 ? 11 : month - 1;
    const prevY = month === 0 ? year - 1 : year;
    const daysInPrevMonth = new Date(prevY, prevM + 1, 0).getDate();
    for (let d = 1; d <= daysInPrevMonth; d++) {
      const dk = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dailyData[dk]) {
        prevMonthPL += dailyData[dk].totalPL;
        prevMonthTrades += dailyData[dk].tradeCount;
      }
    }
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-6">
      {/* Calendar navigation, quick month action, view selector and monthly stats */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {viewMode !== 'heatmap' && (
            <button onClick={() => {
              if (viewMode === 'daily') setCurrentDate(new Date(year, month - 1, 1));
              else setCurrentDate(new Date(year - 1, 0, 1));
            }} className="p-2 rounded-lg hover:bg-bg-input text-text-secondary transition-colors" aria-label="Previous month">
              <Icons.ChevronLeft />
            </button>
          )}
          <h3 className="text-text-primary font-semibold text-lg">
            {viewMode === 'daily' ? `${MONTH_NAMES[month]} ${year}` : year}
          </h3>
          {viewMode !== 'heatmap' && (
            <button onClick={() => {
              if (viewMode === 'daily') setCurrentDate(new Date(year, month + 1, 1));
              else setCurrentDate(new Date(year + 1, 0, 1));
            }} className="p-2 rounded-lg hover:bg-bg-input text-text-secondary transition-colors" aria-label="Next month">
              <Icons.ChevronRight />
            </button>
          )}
          {viewMode === 'daily' && (
            <div className="flex bg-bg-input rounded-lg p-0.5">
              <button type="button" onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 rounded-md text-xs font-medium transition-all text-text-tertiary hover:text-text-secondary">
                This month
              </button>
            </div>
          )}
          <div className="flex bg-bg-input rounded-lg p-0.5 gap-0.5">
            {viewModes.map(mode => (
              <button key={mode.id} onClick={() => setViewMode(mode.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === mode.id ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}`}>
                <mode.icon className="w-3.5 h-3.5" />
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        {viewMode === 'daily' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-text-primary">Monthly stats:</span>
            <span className={`font-mono font-bold px-2 py-1 rounded-md ${monthTrades > 0 ? (monthPL >= 0 ? 'text-positive bg-positive/10' : 'text-negative bg-negative/10') : 'text-text-muted bg-bg-input'}`}>
              {monthTrades > 0 ? (monthCurrencies.size === 1 ? formatCurrency(monthPL, [...monthCurrencies][0]) : 'Mixed currencies') : formatCurrency(0, 'USD')}
            </span>
            <span className="font-semibold text-text-primary px-2 py-1 rounded-md bg-bg-input">{monthTradingDays} days</span>
          </div>
        )}
      </div>

      {/* Heatmap has its own year nav */}
      {viewMode === 'heatmap' && (
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setCurrentDate(new Date(year - 1, 0, 1))} className="p-1.5 rounded-lg hover:bg-bg-input text-text-secondary transition-colors">
            <Icons.ChevronLeft />
          </button>
          <span className="text-text-primary font-semibold text-lg">{year}</span>
          <button onClick={() => setCurrentDate(new Date(year + 1, 0, 1))} className="p-1.5 rounded-lg hover:bg-bg-input text-text-secondary transition-colors">
            <Icons.ChevronRight />
          </button>
        </div>
      )}

      {viewMode === 'daily' && (
        <DailyCalendar
          year={year}
          month={month}
          dailyData={dailyData}
          onSelectDay={setSelectedDay}
          onOpenNote={setSelectedNoteDate}
          dailyNotes={dailyNotes}
          onOpenAddTrade={onOpenAddTrade}
        />
      )}

      {viewMode === 'heatmap' && (
        <YearHeatmap
          year={year}
          dailyData={dailyData}
          onSelectDay={setSelectedDay}
        />
      )}

      {viewMode === 'monthly' && (
        <MonthlyGrid
          year={year}
          dailyData={dailyData}
        />
      )}

      {viewMode === 'yearly' && (
        <YearlyGrid
          currentYear={year}
          dailyData={dailyData}
          onSelectMonth={(selectedYear, selectedMonth) => {
            setCurrentDate(new Date(selectedYear, selectedMonth, 1));
            setViewMode('daily');
          }}
        />
      )}

      {selectedNoteDate && <DailyNotePopup dateKey={selectedNoteDate} dailyNotes={dailyNotes || []} onClose={() => setSelectedNoteDate(null)} onSave={onSaveNote} onDelete={onDeleteNote} />}
      {selectedDay && (
        <DayDetailPanel
          dateKey={selectedDay}
          dayData={dailyData[selectedDay] || { totalPL: 0, tradeCount: 0, trades: [] }}
          onClose={() => setSelectedDay(null)}
          dailyNotes={dailyNotes}
          onSaveNote={onSaveNote}
          onDeleteNote={onDeleteNote}
          tags={tags}
          strategyRules={strategyRules}
          onEditTrade={onEditTrade}
          sidebarCollapsed={sidebarCollapsed}
        />
      )}
    </div>
  );
};

const getCalendarWeekNumber = (year, month, weekSlots) => {
  const dates = weekSlots.filter(Boolean).map(slot => new Date(year, month, slot.day));
  if (!dates.length) return 0;
  const firstDate = dates[0];
  const rowSunday = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() - firstDate.getDay());
  const thursday = new Date(rowSunday.getFullYear(), rowSunday.getMonth(), rowSunday.getDate() + 4);
  const target = new Date(Date.UTC(thursday.getFullYear(), thursday.getMonth(), thursday.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
};


const DailyNotePopup = ({ dateKey, dailyNotes, onClose, onSave, onDelete }) => {
  const existing = dailyNotes.find(note => note.date === dateKey);
  const [draft, setDraft] = useState(existing ? existing.content : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const note = dailyNotes.find(item => item.date === dateKey); setDraft(note ? note.content : ''); }, [dateKey, dailyNotes]);
  const date = new Date(dateKey + 'T12:00:00');
  const title = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-bg-surface border border-border rounded-xl p-5 w-full max-w-lg shadow-xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-text-primary font-semibold">Day note · {title}</h3><button type="button" className="text-text-tertiary hover:text-text-primary" onClick={onClose} disabled={saving}><Icons.X /></button></div>
        <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={6} placeholder="What happened today? Record your observations, decisions or lessons..." className="w-full resize-y rounded-lg border border-border bg-bg-input text-text-primary text-sm p-3 focus:outline-none focus:border-accent" />
        <div className="flex items-center justify-between gap-2 mt-3"><div>{existing && <button type="button" className="text-xs text-negative hover:underline disabled:opacity-50" disabled={saving} onClick={async () => { setSaving(true); await onDelete(dateKey); setSaving(false); onClose(); }}>Delete note</button>}</div><div className="flex gap-2"><button type="button" className="px-3 py-2 text-xs text-text-secondary hover:text-text-primary" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="px-4 py-2 rounded-lg bg-accent text-accent-text text-xs font-semibold disabled:opacity-50" disabled={saving || !draft.trim()} onClick={async () => { setSaving(true); await onSave(dateKey, draft.trim()); setSaving(false); onClose(); }}>Save note</button></div></div>
      </div>
    </div>
  );
};

// --- Daily Calendar (original view) ---
const DailyCalendar = ({ year, month, dailyData, onSelectDay, onOpenNote, dailyNotes, onOpenAddTrade }) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build weeks as rows: each week is an array of 7 day slots (null for empty)
  const weeks = [];
  let currentWeek = new Array(7).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month, day).getDay();
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    currentWeek[dow] = { day, dateKey };
    if (dow === 6 || day === daysInMonth) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
  }

  const colTemplate = 'repeat(7, 1fr) 1px 80px';

  return (
    <>
      {/* Header row: day names + divider + "Week" column */}
      <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: colTemplate }}>
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-xs font-medium text-text-primary py-2">{d}</div>
        ))}
        <div></div>
        <div className="text-center text-xs font-medium text-text-primary py-2">Week</div>
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => {
        let weekPL = 0;
        let weekTrades = 0;
        const weekCurrencies = new Set();
        week.forEach(slot => {
          if (slot && dailyData[slot.dateKey]) {
            weekPL += dailyData[slot.dateKey].totalPL;
            weekTrades += dailyData[slot.dateKey].tradeCount;
            dailyData[slot.dateKey].trades.forEach(trade => weekCurrencies.add((trade.currency_code || trade.currencyCode || 'USD').toUpperCase()));
          }
        });

        return (
          <div key={wi} className="grid gap-1 mb-1" style={{ gridTemplateColumns: colTemplate }}>
            {week.map((slot, di) => {
              if (!slot) return <div key={`empty-${wi}-${di}`} className="h-24 rounded-lg"></div>;

              const data = dailyData[slot.dateKey];
              const hasActivity = data !== undefined;
              const pl = hasActivity ? data.totalPL : 0;
              const hasNote = dailyNotes && dailyNotes.some(n => n.date === slot.dateKey);
              const isFuture = slot.dateKey > (() => { const now = new Date(); return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); })();
              const dayWins = hasActivity ? data.trades.filter(t => getTradePL(t) > 0).length : 0;
              const dayWinRate = hasActivity && data.tradeCount > 0 ? Math.round((dayWins / data.tradeCount) * 100) : null;

              const isToday = slot.dateKey === (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; })();
              let bgClass = 'bg-bg-input';
              if (hasActivity) bgClass = pl >= 0 ? 'bg-positive/10 border-positive/30' : 'bg-negative/10 border-negative/30';

              return (
                <div key={slot.day}
                  className={`h-24 rounded-lg border p-2 ${bgClass} ${isFuture ? 'opacity-60' : 'cursor-pointer hover:brightness-110'} transition-all group relative ${isToday ? 'ring-2 ring-accent ring-inset border-accent' : 'border-border'}`}
                  onClick={() => !isFuture && onSelectDay(slot.dateKey)}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${isToday ? 'text-accent' : 'text-text-primary'}`}>{slot.day}</span>
                    <div className="flex items-center gap-1">
                      <button type="button"
                        className={`absolute bottom-1.5 right-1.5 transition-opacity w-5 h-5 rounded flex items-center justify-center text-xs ${isFuture ? 'hidden' : hasNote ? 'text-accent opacity-100' : 'text-text-secondary opacity-0 group-hover:opacity-100'} hover:bg-accent/15`}
                        onClick={event => { event.stopPropagation(); if (!isFuture) onOpenNote(slot.dateKey); }}
                        title={hasNote ? 'View or edit daily note' : 'Add daily note'} aria-label={hasNote ? 'Edit daily note' : 'Add daily note'}>
                        {hasNote ? '▤' : '✎'}
                      </button>
                      {onOpenAddTrade && (
                        <button type="button"
                          className={`absolute top-1.5 right-1.5 transition-opacity w-5 h-5 rounded flex items-center justify-center bg-accent/20 hover:bg-accent/40 text-accent text-xs font-bold ${isFuture ? 'hidden' : 'opacity-0 group-hover:opacity-100'}`}
                          onClick={event => { event.stopPropagation(); if (!isFuture) onOpenAddTrade(slot.dateKey); }}
                          title="Add trade" aria-label="Add trade">+</button>
                      )}
                    </div>
                  </div>
                  {hasActivity && (
                    <>
                      <div className={`font-mono text-sm font-semibold mt-1 ${pl >= 0 ? 'text-positive' : 'text-negative'}`}>${pl.toFixed(0)}</div>
                      <div className="text-text-primary text-[10px] mt-0.5">{data.tradeCount} trade{data.tradeCount !== 1 ? 's' : ''}</div>
                      {dayWinRate !== null && <div className="text-white text-[10px] mt-0.5 font-mono">{dayWinRate}% WR</div>}
                    </>
                  )}
                </div>
              );
            })}

            {/* Vertical divider */}
            <div className="bg-border my-1 rounded-full"></div>

            {/* ISO week summary cell */}
            <div className={`h-24 rounded-lg border p-2 flex flex-col items-center justify-center ${
              weekTrades > 0 ? (weekPL >= 0 ? 'bg-positive/5 border-positive/20' : 'bg-negative/5 border-negative/20') : 'bg-bg-input border-border'
            }`}>
              <div className="text-text-primary text-xs font-semibold">Week {getCalendarWeekNumber(year, month, week)}</div>
              {weekTrades > 0 ? (
                <>
                  <div className={`font-mono text-sm font-bold mt-1 ${weekPL >= 0 ? 'text-positive' : 'text-negative'}`}>{weekCurrencies.size === 1 ? formatCurrency(weekPL, [...weekCurrencies][0]) : 'Mixed currencies'}</div>
                  <div className="text-text-primary text-[10px] mt-0.5">{week.filter(slot => slot && dailyData[slot.dateKey]).length} days</div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
};

// --- Year Heatmap (GitHub-style) ---
const YearHeatmap = ({ year, dailyData, onSelectDay }) => {
  const [tooltip, setTooltip] = useState(null);

  // Build all days of the year
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  // Collect all P/L values for the year to compute intensity scale
  const yearPLs = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (dailyData[dk]) yearPLs.push(Math.abs(dailyData[dk].totalPL));
  }
  const maxPL = Math.max(...yearPLs, 1);

  // Generate weeks (columns) with days (rows 0-6 = Sun-Sat)
  const weeks = [];
  let currentWeek = new Array(7).fill(null);
  for (let d = new Date(startDate); d <= endDate; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const dow = d.getDay();
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    currentWeek[dow] = { dateKey, day: d.getDate(), month: d.getMonth() };
    if (dow === 6 || (d.getMonth() === 11 && d.getDate() === 31)) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
  }

  const getHeatColor = (dateKey) => {
    const data = dailyData[dateKey];
    if (!data) return 'bg-bg-input';
    const pl = data.totalPL;
    const intensity = Math.min(Math.abs(pl) / maxPL, 1);
    if (pl === 0) return 'bg-text-muted/30';
    if (pl > 0) {
      if (intensity < 0.25) return 'bg-positive/35';
      if (intensity < 0.5) return 'bg-positive/55';
      if (intensity < 0.75) return 'bg-positive/75';
      return 'bg-positive';
    }
    if (intensity < 0.25) return 'bg-negative/35';
    if (intensity < 0.5) return 'bg-negative/55';
    if (intensity < 0.75) return 'bg-negative/75';
    return 'bg-negative';
  };

  // Find which weeks correspond to month boundaries for labels
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstDayInWeek = week.find(d => d !== null);
    if (firstDayInWeek && firstDayInWeek.month !== lastMonth) {
      monthLabels.push({ weekIndex: wi, label: MONTH_SHORT[firstDayInWeek.month] });
      lastMonth = firstDayInWeek.month;
    }
  });

  // Compute stats for the side panel
  const tradingDays = Object.keys(dailyData).filter(k => k.startsWith(`${year}-`)).length;
  const totalTrades = Object.keys(dailyData).filter(k => k.startsWith(`${year}-`)).reduce((s, k) => s + dailyData[k].tradeCount, 0);
  const totalPL = Object.keys(dailyData).filter(k => k.startsWith(`${year}-`)).reduce((s, k) => s + dailyData[k].totalPL, 0);
  const avgDailyTrades = tradingDays > 0 ? (totalTrades / tradingDays) : 0;
  const avgDailyPL = tradingDays > 0 ? (totalPL / tradingDays) : 0;
  const daysInYear = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
  const tradingWeekdays = (() => {
    let count = 0;
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }
    return count;
  })();
  const pctYearTrading = tradingWeekdays > 0 ? ((tradingDays / tradingWeekdays) * 100) : 0;
  const winDays = Object.keys(dailyData).filter(k => k.startsWith(`${year}-`) && dailyData[k].totalPL > 0).length;
  const lossDays = Object.keys(dailyData).filter(k => k.startsWith(`${year}-`) && dailyData[k].totalPL < 0).length;

  return (
    <div>
      <div className="relative">
        {/* Month labels */}
        <div className="flex ml-8 mb-1 text-[11px] text-text-tertiary" style={{ gap: 0 }}>
          {(() => {
            const labels = [];
            let lastIdx = -1;
            monthLabels.forEach(({ weekIndex, label }) => {
              const left = weekIndex * 18;
              if (lastIdx === -1 || left - lastIdx > 32) {
                labels.push(<span key={label} style={{ position: 'absolute', left: `${36 + left}px` }}>{label}</span>);
                lastIdx = left;
              }
            });
            return labels;
          })()}
        </div>

        <div className="flex gap-0 mt-5">
          {/* Day-of-week labels */}
          <div className="flex flex-col gap-[3px] mr-2 text-[11px] text-text-tertiary pt-0">
            {['Sun', '', 'Tue', '', 'Thu', '', 'Sat'].map((label, i) => (
              <div key={i} className="h-[15px] flex items-center justify-end w-7">{label}</div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div className="flex gap-[3px] overflow-x-auto">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day, di) => {
                  if (!day) return <div key={di} className="w-[15px] h-[15px]" />;
                  const data = dailyData[day.dateKey];
                  const hasActivity = !!data;
                  return (
                    <div
                      key={di}
                      className={`w-[15px] h-[15px] rounded-[2px] ${getHeatColor(day.dateKey)} ${hasActivity ? 'cursor-pointer' : ''} transition-all`}
                      onMouseEnter={(e) => {
                        if (!hasActivity) return;
                        const rect = e.target.getBoundingClientRect();
                        setTooltip({ x: rect.left, y: rect.top - 8, dateKey: day.dateKey, pl: data.totalPL, trades: data.tradeCount });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => hasActivity && onSelectDay(day.dateKey)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-3 text-[10px] text-text-tertiary justify-end">
          <span>Loss</span>
          <div className="flex gap-[2px]">
            <div className="w-[13px] h-[13px] rounded-[2px] bg-negative" />
            <div className="w-[13px] h-[13px] rounded-[2px] bg-negative/55" />
            <div className="w-[13px] h-[13px] rounded-[2px] bg-bg-input" />
            <div className="w-[13px] h-[13px] rounded-[2px] bg-positive/55" />
            <div className="w-[13px] h-[13px] rounded-[2px] bg-positive" />
          </div>
          <span>Profit</span>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-bg-page border border-border rounded-lg px-3 py-2 shadow-lg pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
          >
            <div className="text-[11px] text-text-secondary">{tooltip.dateKey}</div>
            <div className={`font-mono text-sm font-semibold ${tooltip.pl >= 0 ? 'text-positive' : 'text-negative'}`}>
              ${tooltip.pl.toFixed(2)}
            </div>
            <div className="text-[10px] text-text-tertiary">{tooltip.trades} trade{tooltip.trades !== 1 ? 's' : ''}</div>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <div className="bg-bg-input rounded-lg p-3 border border-border">
          <div className="text-text-tertiary text-[10px] uppercase tracking-wider mb-1">Avg Daily Trades</div>
          <div className="font-mono text-lg font-bold text-text-primary">{avgDailyTrades.toFixed(1)}</div>
        </div>
        <div className="bg-bg-input rounded-lg p-3 border border-border">
          <div className="text-text-tertiary text-[10px] uppercase tracking-wider mb-1">Avg Daily P&L</div>
          <div className={`font-mono text-lg font-bold ${avgDailyPL >= 0 ? 'text-positive' : 'text-negative'}`}>
            ${avgDailyPL.toFixed(2)}
          </div>
        </div>
        <div className="bg-bg-input rounded-lg p-3 border border-border">
          <div className="text-text-tertiary text-[10px] uppercase tracking-wider mb-1">Year Active</div>
          <div className="font-mono text-lg font-bold text-text-primary">{pctYearTrading.toFixed(1)}%</div>
          <div className="text-text-muted text-[10px] mt-0.5">{tradingDays} of {tradingWeekdays} weekdays</div>
        </div>
        <div className="bg-bg-input rounded-lg p-3 border border-border">
          <div className="text-text-tertiary text-[10px] uppercase tracking-wider mb-1">Win / Loss Days</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-positive">{winDays}</span>
            <span className="text-text-muted text-xs">/</span>
            <span className="font-mono text-sm font-bold text-negative">{lossDays}</span>
          </div>
        </div>
      </div>
    </div>
  );
};


// --- Yearly Calendar (monthly performance matrix) ---
const YearlyGrid = ({ currentYear, dailyData, onSelectMonth }) => {
  const [metric, setMetric] = useState('pl');

  const monthStats = (year, month) => {
    let totalPL = 0;
    let tradeCount = 0;
    let wins = 0;
    let decisiveTrades = 0;
    const currencies = new Set();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayData = dailyData[dateKey];
      if (!dayData) continue;
      totalPL += dayData.totalPL;
      tradeCount += dayData.tradeCount;
      dayData.trades.forEach(trade => {
        currencies.add((trade.currencyCode || 'USD').toUpperCase());
        if (isBreakevenTrade(trade)) return;
        decisiveTrades++;
        if (getTradePL(trade) > 0) wins++;
      });
    }

    return {
      totalPL,
      tradeCount,
      winRate: decisiveTrades > 0 ? (wins / decisiveTrades) * 100 : null,
      currencyCode: currencies.size > 1 ? 'MIXED' : (currencies.values().next().value || 'USD'),
    };
  };

  const yearsWithTrades = Object.keys(dailyData)
    .map(dateKey => Number(dateKey.slice(0, 4)))
    .filter(Number.isFinite);
  const minYear = yearsWithTrades.length ? Math.min(...yearsWithTrades) : currentYear;
  const maxYear = Math.max(currentYear, ...(yearsWithTrades.length ? yearsWithTrades : [currentYear]));
  const years = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y);

  const rows = years.map(year => {
    const months = MONTH_SHORT.map((name, month) => ({ name, ...monthStats(year, month), month }));
    const total = months.reduce((acc, m) => ({
      totalPL: acc.totalPL + m.totalPL,
      tradeCount: acc.tradeCount + m.tradeCount,
    }), { totalPL: 0, tradeCount: 0 });
    const allTrades = months.reduce((acc, m) => {
      const datePrefix = `${year}-${String(m.month + 1).padStart(2, '0')}-`;
      Object.entries(dailyData).forEach(([key, day]) => {
        if (key.startsWith(datePrefix)) {
          day.trades.forEach(trade => {
            if (!isBreakevenTrade(trade)) {
              acc.decisive++;
              if (getTradePL(trade) > 0) acc.wins++;
            }
          });
        }
      });
      return acc;
    }, { decisive: 0, wins: 0 });
    return {
      year,
      months,
      totalPL: total.totalPL,
      tradeCount: total.tradeCount,
      currencyCode: new Set(months.filter(m => m.tradeCount > 0).map(m => m.currencyCode)).size > 1 ? 'MIXED' : (months.find(m => m.tradeCount > 0)?.currencyCode || 'USD'),
      winRate: allTrades.decisive > 0 ? (allTrades.wins / allTrades.decisive) * 100 : null,
    };
  });

  const maxAbsPL = Math.max(1, ...rows.flatMap(row => row.months.map(m => Math.abs(m.totalPL))));
  const maxTrades = Math.max(1, ...rows.flatMap(row => row.months.map(m => m.tradeCount)));
  const formatMoney = (value, currencyCode) => currencyCode === 'MIXED' ? 'Mixed currencies' : formatCurrency(value, currencyCode);

  const cellStyle = (value, max, color) => ({
    backgroundColor: value === 0 ? 'var(--bg-input)' : color === 'pl'
      ? (value > 0
        ? `rgba(34, 197, 94, ${0.10 + (Math.abs(value) / max) * 0.42})`
        : `rgba(239, 68, 68, ${0.10 + (Math.abs(value) / max) * 0.42})`)
      : `rgba(75, 105, 235, ${0.10 + (value / max) * 0.48})`,
    borderColor: 'var(--border)',
  });

  const metrics = [
    { id: 'pl', label: 'P&L' },
    { id: 'winRate', label: 'Win rate' },
    { id: 'trades', label: 'Trades' },
  ];

  const renderCell = (stats, year, month, isTotal = false) => {
    const value = metric === 'pl' ? stats.totalPL : metric === 'winRate' ? stats.winRate : stats.tradeCount;
    const hasTrades = stats.tradeCount > 0;
    const intensityValue = metric === 'pl' ? (value || 0) : (value || 0);
    const intensityMax = metric === 'pl' ? maxAbsPL : metric === 'trades' ? maxTrades : 100;
    const style = hasTrades && !(metric === 'pl' && stats.currencyCode === 'MIXED') ? cellStyle(intensityValue, intensityMax, metric) : {};
    const content = !hasTrades ? '--' : metric === 'pl'
      ? formatMoney(value, stats.currencyCode)
      : metric === 'winRate'
        ? (value === null ? '--' : `${value.toFixed(1)}%`)
        : String(value);

    const colorClass = metric === 'pl' && hasTrades && stats.currencyCode !== 'MIXED'
      ? (value >= 0 ? 'text-positive' : 'text-negative')
      : 'text-text-primary';

    const inner = (
      <>
        <div className={`font-mono text-sm font-bold ${colorClass}`}>{content}</div>
        <div className="text-[10px] text-text-secondary mt-0.5">
          {hasTrades ? `${stats.tradeCount} trade${stats.tradeCount !== 1 ? 's' : ''}` : ''}
        </div>
      </>
    );

    if (isTotal) {
      return (
        <div key="total" className="min-h-[76px] rounded-lg border border-border bg-bg-input flex flex-col items-center justify-center p-2">
          {inner}
        </div>
      );
    }

    return (
      <button
        key={month}
        type="button"
        disabled={!hasTrades}
        onClick={() => onSelectMonth(year, month)}
        title={hasTrades ? `Open ${MONTH_NAMES[month]} ${year}` : 'No trades this month'}
        style={style}
        className={`min-h-[76px] rounded-lg border flex flex-col items-center justify-center p-2 transition-all ${hasTrades ? 'hover:brightness-125 cursor-pointer' : 'cursor-default'}`}
      >
        {inner}
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h4 className="text-text-primary text-sm font-semibold">Yearly calendar</h4>
        <div className="flex bg-bg-input rounded-lg p-0.5 gap-0.5">
          {metrics.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMetric(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${metric === item.id ? 'bg-accent text-accent-text' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1050px]">
          <div className="grid gap-1.5 mb-1.5" style={{ gridTemplateColumns: 'minmax(76px, 0.9fr) repeat(12, minmax(66px, 1fr)) minmax(76px, 0.9fr)' }}>
            <div className="rounded-md border border-border bg-bg-input text-center text-[11px] font-semibold text-text-secondary py-2">Year</div>
            {MONTH_SHORT.map(name => <div key={name} className="rounded-md border border-border bg-bg-input text-center text-[11px] font-semibold text-text-secondary py-2">{name}</div>)}
            <div className="rounded-md border border-border bg-bg-input text-center text-[11px] font-semibold text-text-secondary py-2">Total</div>
          </div>

          {rows.map(row => (
            <div key={row.year} className="grid gap-1.5 mb-1.5" style={{ gridTemplateColumns: 'minmax(76px, 0.9fr) repeat(12, minmax(66px, 1fr)) minmax(76px, 0.9fr)' }}>
              <div className="min-h-[76px] rounded-lg border border-border bg-bg-input flex items-center justify-center text-sm font-semibold text-text-primary">{row.year}</div>
              {row.months.map(m => renderCell(m, row.year, m.month))}
              {renderCell({
                totalPL: row.totalPL,
                tradeCount: row.tradeCount,
                currencyCode: row.currencyCode,
                winRate: row.winRate,
              }, row.year, null, true)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Monthly Grid (P/L per month for the year) ---
const MonthlyGrid = ({ year, dailyData }) => {
  // Helper to aggregate a specific month
  const aggregateMonth = (y, mi) => {
    let totalPL = 0;
    let tradeCount = 0;
    let winDays = 0;
    let lossDays = 0;
    const daysInMonth = new Date(y, mi + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dailyData[dk]) {
        totalPL += dailyData[dk].totalPL;
        tradeCount += dailyData[dk].tradeCount;
        if (dailyData[dk].totalPL > 0) winDays++;
        else if (dailyData[dk].totalPL < 0) lossDays++;
      }
    }
    return { totalPL, tradeCount, winDays, lossDays };
  };

  // Aggregate P/L and trades per month
  const monthlyData = MONTH_NAMES.map((name, mi) => {
    const current = aggregateMonth(year, mi);
    const prevMi = mi === 0 ? 11 : mi - 1;
    const prevY = mi === 0 ? year - 1 : year;
    const prev = aggregateMonth(prevY, prevMi);
    return { name, shortName: MONTH_SHORT[mi], ...current, prevTotalPL: prev.totalPL, prevTradeCount: prev.tradeCount };
  });

  const yearTotal = monthlyData.reduce((s, m) => s + m.totalPL, 0);
  const yearTrades = monthlyData.reduce((s, m) => s + m.tradeCount, 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {monthlyData.map((m, i) => {
          const hasActivity = m.tradeCount > 0;
          let bgClass = 'bg-bg-input';
          if (hasActivity) {
            bgClass = m.totalPL >= 0 ? 'bg-positive/10 border-positive/30' : 'bg-negative/10 border-negative/30';
          }

          return (
            <div key={i} className={`rounded-lg border border-border p-4 ${bgClass}`}>
              <div className="text-sm font-medium text-text-secondary mb-2">{m.name}</div>
              {hasActivity ? (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <div className={`font-mono text-xl font-bold ${m.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>
                      ${m.totalPL.toFixed(2)}
                    </div>
                    {m.prevTradeCount > 0 && (
                      <ChangeIndicator value={calcPercentChange(m.totalPL, m.prevTotalPL)} />
                    )}
                  </div>
                  <div className="text-text-tertiary text-xs mt-1">
                    {m.tradeCount} trade{m.tradeCount !== 1 ? 's' : ''}
                  </div>
                  <div className="flex gap-2 mt-1 text-[10px]">
                    {m.winDays > 0 && <span className="text-positive">{m.winDays} green day{m.winDays !== 1 ? 's' : ''}</span>}
                    {m.lossDays > 0 && <span className="text-negative">{m.lossDays} red day{m.lossDays !== 1 ? 's' : ''}</span>}
                  </div>
                </>
              ) : (
                <div className="text-text-muted text-sm">No trades</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Year summary */}
      <div className={`mt-4 rounded-lg border border-border p-4 ${yearTrades > 0 ? (yearTotal >= 0 ? 'bg-positive/5 border-positive/20' : 'bg-negative/5 border-negative/20') : 'bg-bg-input'}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">Year Total</span>
          <div className="text-right">
            <div className={`font-mono text-xl font-bold ${yearTotal >= 0 ? 'text-positive' : 'text-negative'}`}>
              ${yearTotal.toFixed(2)}
            </div>
            <div className="text-text-tertiary text-xs">{yearTrades} trade{yearTrades !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

module.exports = CalendarView;
