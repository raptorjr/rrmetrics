const NO_ACCOUNTS = '__rrmetrics_no_accounts__';

const getTradeAccountKey = (trade, accountBrokers = {}) => {
  if (trade.domain === 'backtesting' && trade.replaySessionId) return 'replay::'+trade.replaySessionId;
  const name = trade.account || 'Manual';

  // ProjectX/Topstep trade IDs encode both the connection and exchange account ID.
  if (trade.projectxSource === 'projectx' && trade.projectxTradeId) {
    const match = String(trade.projectxTradeId).match(/^px:([^:]+):px:([^:]+):/);
    if (match) return `projectx::${match[1]}::${match[2]}`;
  }

  // TradeZella accounts can share display names with live broker accounts.
  if (trade.tradovateSource === 'tradezella') return `tradezella::${name}`;

  if (trade.brokerConnectionId) {
    return `broker::${trade.brokerConnectionId}::${name}`;
  }

  return `manual::${name}`;
};

const getTradeAccountEntries = (trades = [], accountBrokers = {}) => {
  const entries = new Map();
  for (const trade of trades || []) {
    const name = trade.account || 'Manual';
    const key = getTradeAccountKey(trade, accountBrokers);
    if (!entries.has(key)) {
      let provider = 'manual';
      if (key.startsWith('projectx::')) provider = 'projectx';
      else if (key.startsWith('tradezella::')) provider = 'tradezella';
      else if (trade.brokerConnectionId) provider = trade.provider || accountBrokers[name] || 'broker';
      entries.set(key, { key, name, provider });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider));
};

module.exports = { NO_ACCOUNTS, getTradeAccountKey, getTradeAccountEntries };
