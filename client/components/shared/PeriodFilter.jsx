const React = require('react');
const { useState, useEffect, useRef } = React;
const { MONTH_LABELS } = require('../../utils/periodUtils');
const Icons = require('./Icons');
const DateRangePicker = require('./DateRangePicker');

const PeriodFilter = ({ value, onChange, trades }) => {
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const pickerRef = useRef(null);
  const isMonthSelected = typeof value === 'string' && value.startsWith('month-');
  const isCustomRange = value && typeof value === 'object' && value.type === 'custom';

  // Determine years that have trades for the month picker
  const tradeYears = (() => {
    const years = new Set();
    (trades || []).forEach(t => years.add(new Date(t.exitTime).getFullYear()));
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  })();
  const [pickerYear, setPickerYear] = useState(tradeYears[0] || new Date().getFullYear());

  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handleClick);
    return (
    <div className="flex items-center gap-2">
      <DateRangePicker
        startDate={isCustomRange ? value.startDate : isMonthSelected ? `${value.slice(6, 10)}-${value.slice(11, 13)}-01` : ''}
        endDate={isCustomRange ? value.endDate : isMonthSelected ? (() => { const y = Number(value.slice(6, 10)); const m = Number(value.slice(11, 13)); return `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; })() : ''}
        onChange={({ startDate, endDate }) => onChange(startDate || endDate ? { type: 'custom', startDate, endDate } : 'all')}
      />

      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
            isMonthSelected
              ? 'bg-accent text-accent-text border-accent'
              : 'bg-bg-input text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          <Icons.Calendar className="w-3.5 h-3.5" />
          {getLabel()}
        </button>
        {showMonthPicker && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border rounded-xl shadow-lg p-4 w-[260px]">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setPickerYear(pickerYear - 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors"><Icons.ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-semibold text-text-primary">{pickerYear}</span>
              <button onClick={() => setPickerYear(pickerYear + 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors"><Icons.ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_LABELS.map((label, mi) => {
                const monthVal = `month-${pickerYear}-${String(mi + 1).padStart(2, '0')}`;
                const isActive = value === monthVal;
                const hasTrades = monthsWithTrades.has(mi);
                return <button key={mi} onClick={() => { onChange(monthVal); setShowMonthPicker(false); }} className={`px-2 py-1.5 text-xs font-medium rounded-lg transition-all ${isActive ? 'bg-accent text-accent-text' : hasTrades ? 'bg-bg-input text-text-primary hover:bg-accent/20' : 'text-text-muted hover:bg-bg-input'}`}>{label}</button>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}; React = require('react');
const { useState, useEffect, useRef } = React;
const { MONTH_LABELS } = require('../../utils/periodUtils');
const Icons = require('./Icons');
const DateRangePicker = require('./DateRangePicker');

const PeriodFilter = ({ value, onChange, trades }) => {
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const pickerRef = useRef(null);
  const isMonthSelected = typeof value === 'string' && value.startsWith('month-');
  const isCustomRange = value && typeof value === 'object' && value.type === 'custom';

  // Determine years that have trades for the month picker
  const tradeYears = (() => {
    const years = new Set();
    (trades || []).forEach(t => years.add(new Date(t.exitTime).getFullYear()));
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  })();
  const [pickerYear, setPickerYear] = useState(tradeYears[0] || new Date().getFullYear());

  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const getLabel = () => {
    if (isMonthSelected) {
      const m = value.match(/^month-(\\d{4})-(\\d{2})$/);
      if (m) return `${MONTH_LABELS[parseInt(m[2], 10) - 1]} ${m[1]}`;
    }
    return 'Select Month';
  };

  // Check which months have trades for the picker year
  const monthsWithTrades = new Set();
  (trades || []).forEach(t => {
    const d = new Date(t.exitTime);
    if (d.getFullYear() === pickerYear) monthsWithTrades.add(d.getMonth());
  });

  return (
    <div className="flex items-center gap-2">
      {/* Preset dropdown */}
      <div className="relative">
        <select
          value={isMonthSelected ? '__month__' : value}
          onChange={(e) => {
            if (e.target.value === '__month__') return;
            onChange(e.target.value);
          }}
          className="appearance-none bg-bg-input border border-border rounded-lg pl-3 pr-8 py-1.5 text-sm text-text-primary font-medium cursor-pointer focus:outline-none focus:border-accent transition-colors"
        >
          {presets.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          {isMonthSelected && <option value="__month__">{getLabel()}</option>}
        </select>
        <Icons.ChevronDown className="w-3.5 h-3.5 text-text-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* Month picker button + popover */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
            isMonthSelected
              ? 'bg-accent text-accent-text border-accent'
              : 'bg-bg-input text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          <Icons.Calendar className="w-3.5 h-3.5" />
          {isMonthSelected ? getLabel() : 'Select Month'}
        </button>

        {showMonthPicker && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border rounded-xl shadow-lg p-4 w-[260px]">
            {/* Year nav */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setPickerYear(pickerYear - 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors">
                <Icons.ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-text-primary">{pickerYear}</span>
              <button onClick={() => setPickerYear(pickerYear + 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors">
                <Icons.ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* Month grid */}
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_LABELS.map((label, mi) => {
                const monthVal = `month-${pickerYear}-${String(mi + 1).padStart(2, '0')}`;
                const isActive = value === monthVal;
                const hasTrades = monthsWithTrades.has(mi);
                return (
                  <button
                    key={mi}
                    onClick={() => { onChange(monthVal); setShowMonthPicker(false); }}
                    className={`px-2 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      isActive
                        ? 'bg-accent text-accent-text'
                        : hasTrades
                          ? 'bg-bg-input text-text-primary hover:bg-accent/20'
                          : 'text-text-muted hover:bg-bg-input'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

module.exports = PeriodFilter;
