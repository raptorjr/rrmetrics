const React = require('react');

const TilePreview = ({ item }) => {
  const id = item.id;
  const isPositive = ['totalPL', 'bestTrade', 'expectancy'].includes(id);
  const value = ({
    totalPL: '+$2,450', winRate: '64.2%', totalTrades: '50', avgDuration: '4m 32s',
    avgWinLoss: '1.65', bestTrade: '+$425', worstTrade: '-$210', breakevenRate: '8.0%',
    profitFactor: '1.85', expectancy: '+$49.00', maxDrawdown: '$620',
    sharpeRatio: '1.42', sortinoRatio: '2.10', kellyRisk: '$180',
  })[id] || '—';

  return (
    <div className="h-[82px] rounded-md border border-border bg-bg-page/70 p-2 flex flex-col justify-between overflow-hidden">
      <div className="text-[8px] uppercase tracking-wider text-text-tertiary font-semibold truncate">{item.label}</div>
      <div className={`text-lg font-bold font-sans truncate ${isPositive ? 'text-positive' : 'text-text-primary'}`}>{value}</div>
      {id === 'winRate' || id === 'avgWinLoss' ? (
        <div className="flex h-1.5 gap-0.5">
          <div className="rounded-full bg-positive" style={{ width: id === 'winRate' ? '64%' : '62%' }} />
          <div className="rounded-full bg-negative flex-1" />
        </div>
      ) : (
        <div className="flex items-end gap-0.5 h-3">
          {[35, 60, 42, 78, 54, 92, 68, 84, 48].map((height, index) => (
            <div key={index} className={`flex-1 rounded-t-sm ${isPositive ? 'bg-positive/60' : 'bg-accent/60'}`} style={{ height: `${height}%` }} />
          ))}
        </div>
      )}
    </div>
  );
};

module.exports = TilePreview;
