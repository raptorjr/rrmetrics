const React = require('react');
const ChangeIndicator = require('./ChangeIndicator');
const InfoTooltip = require('./InfoTooltip');
const StatCard = ({ label, value, subValue, color, change, tooltip }) => {
  const valueLength = String(value).length;
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5 relative [container-type:inline-size]">
      <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">{label}<InfoTooltip text={tooltip} /></div>
      <div className="flex min-w-0 items-baseline gap-2">
        <div
          className={"min-w-0 whitespace-nowrap font-mono font-bold " + (color || 'text-text-primary')}
          style={{ fontSize: `clamp(1rem, calc((100cqw - 2.5rem) / (${Math.max(valueLength, 1)} * 0.62)), 1.5rem)` }}
        >{value}</div>
        {change !== undefined && change !== null && <ChangeIndicator value={change} />}
      </div>
      {subValue && <div className="text-text-tertiary text-xs mt-1">{subValue}</div>}
    </div>
  );
};
module.exports = StatCard;
