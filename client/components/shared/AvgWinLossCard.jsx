const React = require('react');
const InfoTooltip = require('./InfoTooltip');

const AvgWinLossCard = ({ avgWin, avgLoss, tooltip = 'Compares the average size of a winning trade with the average size of a losing trade. A ratio above 1.00 means your average win is larger than your average loss. The bar compares the two average amounts.' }) => {
  const absLoss = Math.abs(avgLoss);
  const total = avgWin + absLoss;
  const ratio = absLoss > 0 ? (avgWin / absLoss).toFixed(2) : avgWin > 0 ? '∞' : '0.00';
  const winPct = total > 0 ? (avgWin / total) * 100 : 50;
  return (
    <div className="avg-win-loss-card bg-bg-surface border border-border rounded-xl p-3 sm:p-5">
      <div className="avg-win-loss-layout flex items-center gap-3 sm:gap-4">
        <div className="avg-win-loss-ratio min-w-0 shrink-0">
          <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">
            Avg Win / Loss <InfoTooltip text={tooltip} />
          </div>
          <div className="font-mono text-2xl font-bold text-text-primary">{ratio}</div>
        </div>
        <div className="avg-win-loss-breakdown flex-1 flex flex-col gap-2 ml-0 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden">
            <div className="bg-positive shrink-0" style={{ width: winPct + '%', flex: '0 0 ' + winPct + '%' }} />
            <div className="bg-negative shrink-0" style={{ width: (100 - winPct) + '%', flex: '0 0 ' + (100 - winPct) + '%' }} />
          </div>
          <div className="flex justify-between text-[12px] font-mono gap-2">
            <span className="text-positive">{'$'}{avgWin.toFixed(0)}</span>
            <span className="text-negative">-{ '$' }{absLoss.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

module.exports = AvgWinLossCard;
