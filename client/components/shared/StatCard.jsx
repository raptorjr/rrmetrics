const React = require('react');
const ChangeIndicator = require('./ChangeIndicator');
const InfoTooltip = require('./InfoTooltip');
const StatCard = ({ label, value, subValue, color, change, tooltip }) => (
  <div className="bg-bg-surface border border-border rounded-xl p-5 relative">
    <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">{label}<InfoTooltip text={tooltip} /></div>
    <div className="flex items-baseline gap-2">
      <div className={\`font-mono text-2xl font-bold \${color || 'text-text-primary'}\`}>{value}</div>
      {change !== undefined && change !== null && <ChangeIndicator value={change} />}
    </div>
    {subValue && <div className="text-text-tertiary text-xs mt-1">{subValue}</div>}
  </div>
);
module.exports = StatCard;
