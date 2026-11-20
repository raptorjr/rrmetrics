const React = require('react');
const ChangeIndicator = require('./ChangeIndicator');
const InfoTooltip = require('./InfoTooltip');

const WinRateCard = ({ wins, losses, breakevens = 0, total, change, tooltip = 'Win rate is winning trades divided by winning plus losing trades. Breakeven trades are excluded from the percentage but included in the trade count.' }) => {
  const neutral = breakevens || Math.max(0, total - wins - losses);
  const decisive = wins + losses;
  const winRate = decisive > 0 ? (wins / decisive * 100) : 0;
  // Stroke-dasharray gauge: circle starts at 3-o'clock and goes CW.
  // rotate(180) moves start to 9-o'clock; CW from there traces 9→12→3 = top semicircle.
  const cx = 36, cy = 32, r = 28, sw = 6;
  const C = 2 * Math.PI * r;
  const half = Math.PI * r;
  const winsLen = total > 0 ? (wins / total) * half : 0;
  const neuLen = total > 0 ? (neutral / total) * half : 0;
  const losLen = total > 0 ? (losses / total) * half : 0;
  const neuStartDeg = 180 + (total > 0 ? (wins / total) * 180 : 0);
  const losStartDeg = 180 + (total > 0 ? ((wins + neutral) / total) * 180 : 0);

  return (
    <div className="win-rate-card relative flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-bg-surface p-5" style={{ containerType: 'size', containerName: 'win-rate' }}>
      <style>{`
        @container win-rate (max-height: 150px) {
          .win-rate-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 1fr; align-items: start; gap: 8px; }
          .win-rate-header { grid-column: 1; grid-row: 1; }
          .win-rate-gauge-area { grid-column: 2; grid-row: 1; align-self: center; justify-self: end; }
          .win-rate-gauge { width: 96px !important; }
        }
        @container win-rate (min-height: 151px) {
          .win-rate-card { display: flex; flex-direction: column; }
          .win-rate-gauge-area { flex: 1 1 0%; min-height: 0; display: flex; align-items: center; justify-content: center; }
          .win-rate-gauge { width: min(100%, 90cqh, 720px) !important; }
        }
      `}</style>
      <div className="win-rate-header relative z-10 min-w-0 shrink-0">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-secondary">
          Win Rate <InfoTooltip text={tooltip} />
        </div>
        <div className="flex items-baseline gap-2">
          <div className="font-mono text-2xl font-bold text-text-primary">{winRate.toFixed(1)}%</div>
          {change !== null && change !== undefined && <ChangeIndicator value={change} />}
        </div>
      </div>

      <div className="win-rate-gauge-area flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
        <div
          className="win-rate-gauge flex w-full max-w-full min-w-0 flex-col items-center gap-1"
          style={{ width: 'min(100%, 90cqh, 720px)' }}
        >
          <svg className="block h-auto w-full overflow-visible" viewBox="0 0 72 38" role="img" aria-label={`Trade distribution: ${wins} wins, ${neutral} breakeven, ${losses} losses`}>
            <circle cx={cx} cy={cy} r={r} fill="none"
              stroke="rgb(var(--border))" strokeWidth={sw} strokeLinecap="butt"
              strokeDasharray={`${half} ${C - half}`}
              transform={`rotate(180, ${cx}, ${cy})`} />
            {winsLen > 0.01 && (
              <circle cx={cx} cy={cy} r={r} fill="none"
                stroke="rgb(var(--positive))" strokeWidth={sw} strokeLinecap="butt"
                strokeDasharray={`${winsLen} ${C - winsLen}`}
                transform={`rotate(180, ${cx}, ${cy})`} />
            )}
            {neuLen > 0.01 && (
              <circle cx={cx} cy={cy} r={r} fill="none"
                stroke="rgb(var(--accent))" strokeWidth={sw} strokeLinecap="butt"
                strokeDasharray={`${neuLen} ${C - neuLen}`}
                transform={`rotate(${neuStartDeg}, ${cx}, ${cy})`} />
            )}
            {losLen > 0.01 && (
              <circle cx={cx} cy={cy} r={r} fill="none"
                stroke="rgb(var(--negative))" strokeWidth={sw} strokeLinecap="butt"
                strokeDasharray={`${losLen} ${C - losLen}`}
                transform={`rotate(${losStartDeg}, ${cx}, ${cy})`} />
            )}
          </svg>
          <div className="flex w-full justify-between gap-1">
            <span className="inline-flex h-[clamp(20px,3cqw,30px)] min-w-[clamp(20px,3cqw,30px)] items-center justify-center rounded-full bg-positive/20 px-1 text-[clamp(9px,1.4cqw,14px)] font-bold text-positive">{wins}</span>
            {neutral > 0 && <span className="inline-flex h-[clamp(20px,3cqw,30px)] min-w-[clamp(20px,3cqw,30px)] items-center justify-center rounded-full bg-accent/20 px-1 text-[clamp(9px,1.4cqw,14px)] font-bold text-accent">{neutral}</span>}
            <span className="inline-flex h-[clamp(20px,3cqw,30px)] min-w-[clamp(20px,3cqw,30px)] items-center justify-center rounded-full bg-negative/20 px-1 text-[clamp(9px,1.4cqw,14px)] font-bold text-negative">{losses}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

module.exports = WinRateCard;
