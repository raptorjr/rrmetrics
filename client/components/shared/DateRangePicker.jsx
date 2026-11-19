const React = require('react');
const { useState, useEffect, useRef } = React;

const pad = n => String(n).padStart(2, '0');
const toISO = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
const fromISO = value => value ? new Date(value + 'T12:00:00') : null;
const monthStart = date => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const sameDay = (a, b) => a && b && toISO(a) === toISO(b);
const monthLabel = date => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const displayDate = value => value ? fromISO(value).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Start date';

const DateRangePicker = ({ startDate, endDate, onChange }) => {
  const [open, setOpen] = useState(false);
  const [leftMonth, setLeftMonth] = useState(() => monthStart(fromISO(startDate) || new Date()));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const close = event => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const start = fromISO(startDate);
  const end = fromISO(endDate);
  const today = new Date();
  const presets = [
    { label: 'Today', range: () => [today, today] },
    { label: 'This week', range: () => { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [d, today]; } },
    { label: 'This month', range: () => [new Date(today.getFullYear(), today.getMonth(), 1), today] },
    { label: 'Last 30 days', range: () => { const d = new Date(today); d.setDate(d.getDate() - 29); return [d, today]; } },
    { label: 'Last month', range: () => [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)] },
    { label: 'This quarter', range: () => [new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1), today] },
    { label: 'YTD (year to date)', range: () => [new Date(today.getFullYear(), 0, 1), today] },
    { label: 'All time', range: () => [null, null] },
  ];

  const applyPreset = preset => {
    const [from, to] = preset.range();
    onChange({ startDate: from ? toISO(from) : '', endDate: to ? toISO(to) : '' });
    setLeftMonth(monthStart(from || today));
    setSelectingEnd(false);
    setOpen(false);
  };

  const chooseDate = date => {
    if (!selectingEnd || !start) {
      onChange({ startDate: toISO(date), endDate: '' });
      setSelectingEnd(true);
      if (date.getMonth() !== leftMonth.getMonth() || date.getFullYear() !== leftMonth.getFullYear()) setLeftMonth(monthStart(date));
      return;
    }
    const from = date < start ? date : start;
    const to = date < start ? start : date;
    onChange({ startDate: toISO(from), endDate: toISO(to) });
    setSelectingEnd(false);
    setOpen(false);
  };

  const renderMonth = date => {
    const first = monthStart(date);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => {
      const day = i - offset + 1;
      if (day < 1 || day > days) return null;
      return new Date(date.getFullYear(), date.getMonth(), day);
    });
    return (
      <div className="min-w-[248px]">
        <div className="flex items-center justify-center font-semibold text-sm text-text-primary mb-3">{monthLabel(date)}</div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Mo','Tu','We','Th','Fr','Sa','Su'].map(label => <div key={label} className="text-center text-[10px] text-text-muted py-1">{label}</div>)}
          {cells.map((day, index) => {
            if (!day) return <span key={index} />;
            const iso = toISO(day);
            const active = sameDay(day, start) || sameDay(day, end);
            const inRange = start && end && day > start && day < end;
            return <button key={iso} type="button" onClick={() => chooseDate(day)} className={'h-8 rounded-full text-xs transition-colors ' + (active ? 'bg-accent text-accent-text font-semibold' : inRange ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-input')}>{day.getDate()}</button>;
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-3 px-3 py-2.5 bg-bg-input border border-border rounded-lg text-sm text-text-primary hover:border-accent transition-colors min-w-[270px]">
        <span className="text-text-secondary">{startDate ? displayDate(startDate) : 'All dates'}</span>
        <span className="text-text-muted">→</span>
        <span className="text-text-secondary">{endDate ? displayDate(endDate) : startDate ? 'Select end' : 'Any date'}</span>
        <span className="ml-auto text-text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-[80] bg-bg-surface border border-border rounded-xl shadow-2xl overflow-hidden w-[min(760px,calc(100vw-32px))]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
            <div className="font-semibold text-sm text-text-primary">{displayDate(startDate)} <span className="text-text-muted mx-2">→</span> {displayDate(endDate)}</div>
            <button type="button" onClick={() => { onChange({ startDate: '', endDate: '' }); setSelectingEnd(false); }} className="text-xs text-text-secondary hover:text-text-primary">Clear dates</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_180px]">
            <div className="p-4 sm:border-r border-border">
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, -1))} className="px-2 py-1 text-text-secondary hover:text-text-primary">‹</button>
                <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, 1))} className="px-2 py-1 text-text-secondary hover:text-text-primary">›</button>
              </div>
              {renderMonth(leftMonth)}
            </div>
            <div className="p-4 sm:border-r border-border">
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, -1))} className="px-2 py-1 text-text-secondary hover:text-text-primary">‹</button>
                <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, 1))} className="px-2 py-1 text-text-secondary hover:text-text-primary">›</button>
              </div>
              {renderMonth(addMonths(leftMonth, 1))}
            </div>
            <div className="p-3 flex flex-row sm:flex-col flex-wrap gap-1">
              {presets.map(preset => <button key={preset.label} type="button" onClick={() => applyPreset(preset)} className="text-left px-2.5 py-2 rounded-md text-xs text-text-secondary hover:bg-accent/15 hover:text-text-primary">{preset.label}</button>)}
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <span className="text-[11px] text-text-muted">{selectingEnd ? 'Choose an end date' : 'Choose a start date'}</span>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md bg-accent text-accent-text text-xs font-semibold">Done</button>
          </div>
        </div>
      )}
    </div>
  );
};

module.exports = DateRangePicker;
