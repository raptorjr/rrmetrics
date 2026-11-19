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

  const tradeYears = (() => {
    const years = new Set();
    (trades || []).forEach(t => years.add(new Date(t.exitTime).getFullYear()));
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  })();
  const [pickerYear, setPickerYear] = useState(tradeYears[0] || new Date().getFullYear());

  useEffect(() => {
    const handleClick = event => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const getLabel = () => {
    if (isMonthSelected) {
      const match = value.match(/^month-(\d{4})-(\d{2})$/);
      if (match) return \`\${MONTH_LABELS[parseInt(match[2], 10) - 1]} \${match[1]}\`;
    }
    return 'Select Month';
  };

  const monthsWithTrades = new Set();
  (trades || []).forEach(trade => {
    const date = new Date(trade.exitTime);
    if (date.getFullYear() === pickerYear) monthsWithTrades.add(date.getMonth());
  });

  const monthStart = isMonthSelected ? \`\${value.slice(6, 10)}-\${value.slice(11, 13)}-01\` : '';
  const monthEnd = isMonthSelected ? (() => {
    const year = Number(value.slice(6, 10));
    const month = Number(value.slice(11, 13));
    return \`\${year}-\${String(month).padStart(2, '0')}-\${String(new Date(year, month, 0).getDate()).padStart(2, '0')}\`;
  })() : '';

  return (
    <div className="flex items-center gap-2">
      <DateRangePicker
        startDate={isCustomRange ? value.startDate : monthStart}
        endDate={isCustomRange ? value.endDate : monthEnd}
        onChange={({ startDate, endDate }) => onChange(startDate || endDate ? { type: 'custom', startDate, endDate } : 'all')}
      />
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setShowMonthPicker(!showMonthPicker)}
          className={\`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-all \${isMonthSelected ? 'bg-accent text-accent-text border-accent' : 'bg-bg-input text-text-secondary border-border hover:text-text-primary'}\`}
        >
          <Icons.Calendar className="w-3.5 h-3.5" />
          {getLabel()}
        </button>
        {showMonthPicker && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border rounded-xl shadow-lg p-4 w-[260px]">
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={() => setPickerYear(pickerYear - 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors"><Icons.ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-semibold text-text-primary">{pickerYear}</span>
              <button type="button" onClick={() => setPickerYear(pickerYear + 1)} className="p-1 rounded hover:bg-bg-input text-text-secondary transition-colors"><Icons.ChevronRight className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_LABELS.map((label, index) => {
                const monthValue = \`month-\${pickerYear}-\${String(index + 1).padStart(2, '0')}\`;
                const active = value === monthValue;
                const hasTrades = monthsWithTrades.has(index);
                return (
                  <button key={index} type="button" onClick={() => { onChange(monthValue); setShowMonthPicker(false); }}
                    className={\`px-2 py-1.5 text-xs font-medium rounded-lg transition-all \${active ? 'bg-accent text-accent-text' : hasTrades ? 'bg-bg-input text-text-primary hover:bg-accent/20' : 'text-text-muted hover:bg-bg-input'}\`}>
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
