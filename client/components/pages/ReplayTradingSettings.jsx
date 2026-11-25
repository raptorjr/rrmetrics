const React = require('react');
const { LABEL_UNITS, formatTradingAmounts } = require('../../utils/replayTradingDisplay');

function ReplayTradingSettings({ dialogRef, units, onChange, spec }) {
  const entry = spec.basePrice;
  const preview = (ticks) => formatTradingAmounts({
    side: 'buy', entryPrice: entry, currentPrice: entry + ticks * spec.tickSize, openQuantity: 1,
  }, spec, units);
  return (
    <dialog ref={dialogRef} aria-labelledby="rr-trading-settings-title"
      style={{ width: 440, maxWidth: "calc(100% - 2rem)", maxHeight: "calc(100% - 2rem)" }}
      className="overflow-y-auto m-auto rounded-xl border border-border bg-bg-surface text-text-primary shadow-2xl p-0 backdrop:bg-black/60"
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="rr-trading-settings-title" className="text-lg font-semibold">Trading settings</h2>
          <button type="button" aria-label="Close trading settings" onClick={() => dialogRef.current?.close()} className="text-text-muted hover:text-text-primary text-xl px-2">×</button>
        </div>
        <div>
          <h3 className="font-semibold text-sm">Order and position labels</h3>
          <p className="text-xs text-text-muted mt-1">Choose one or more units. Changes apply immediately to every replay chart.</p>
          <div className="mt-3 space-y-2">
            {LABEL_UNITS.map(unit => (
              <label key={unit.id} className="flex items-center gap-3 text-sm cursor-pointer">
                <input type="checkbox" checked={units.includes(unit.id)}
                  disabled={units.length === 1 && units.includes(unit.id)}
                  onChange={event => {
                    const checked = event.currentTarget.checked;
                    onChange(previous => {
                      if (!checked && previous.length === 1) return previous;
                      return checked ? [...new Set([...previous, unit.id])] : previous.filter(id => id !== unit.id);
                    });
                  }} />
                {unit.label}
              </label>
            ))}
          </div>
        </div>
        <div className="border border-border rounded-lg p-3 space-y-2 bg-bg-page text-xs">
          <div className="font-medium text-text-secondary">Preview · one contract</div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-emerald-400 font-semibold">TP</span><span>{preview(96)}</span></div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-blue-400 font-semibold">Long</span><span>{preview(24)}</span></div>
          <div className="flex flex-wrap items-center gap-2"><span className="text-red-400 font-semibold">SL</span><span>{preview(-80)}</span></div>
        </div>
        <p className="text-xs text-text-muted">Currency includes all contracts. Points, ticks and percentage describe price movement. Pending entries show distance from the current market, not profit or loss.</p>
        <div className="flex justify-between gap-2 border-t border-border pt-3">
          <button type="button" className="text-sm text-text-secondary hover:text-text-primary" onClick={() => onChange(['currency'])}>Reset defaults</button>
          <button type="button" className="rounded-lg bg-accent text-accent-text px-4 py-2 text-sm font-semibold" onClick={() => dialogRef.current?.close()}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
module.exports = ReplayTradingSettings;
