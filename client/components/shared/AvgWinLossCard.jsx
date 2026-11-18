const React = require('react');
const InfoTooltip = require('./InfoTooltip');

const AvgWinLossCard = ({ avgWin, avgLoss, tooltip = 'Compares the average size of a winning trade with the average size of a losing trade. A ratio above 1.00 means your average win is larger than your average loss. The bar compares the two average amounts.' }) => {
  const absLoss = Math.abs(avgLoss);
  const total = avgWin + absLoss;
  const ratio = absLoss > 0 ? (avgWin / absLoss).toFixed(2) : avgWin > 0 ? '∞' : '0.00';
  const winPct = total > 0 ? (avgWin / total) * 100 : 50;
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0">
          <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">
            Avg Win / Loss <InfoTooltip text={tooltip} />
          </div>
          <div className="font-mono text-2xl font-bold text-text-primary">{ratio}</div>
        </div>
        <div className="flex-1 flex flex-col gap-3 ml-8 min-w-0">
          <div className="flex h-2 rounded-full overflow-hidden">
            <div className="bg-positive" style={{ width: winPct + '%' }} />
            <div className="bg-negative flex-1" />
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
