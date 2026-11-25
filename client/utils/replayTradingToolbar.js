// TradeCanvas's host buttons normally participate in the overflow menu.
// Trading settings is a workspace control, like the shared layout picker:
// keep it visible in the active native toolbar, even after responsive refits.
function createSettingsGear(doc) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', 'M12 2.5h2l.6 2.7 1.7 1 2.6-.9 2 3.4-2 1.9v2l2 1.9-2 3.4-2.6-.9-1.7 1-.6 2.7h-4l-.6-2.7-1.7-1-2.6.9-2-3.4 2-1.9v-2l-2-1.9 2-3.4 2.6.9 1.7-1 .6-2.7z');
  const circle = doc.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '3');
  svg.append(path, circle);
  return svg;
}

function addReplayTradingSettingsButton(widget, onClick, doc = globalThis.document) {
  const handle = widget.addToolbarButton({
    id: 'rr-trading-settings', label: 'Settings', icon: createSettingsGear(doc),
    text: '', side: 'right', onClick,
  });
  if (!handle) return null;
  // The installed TradeCanvas toolbar refits only .tcw-toolbar-overflow items.
  // Remove the class and any folding marker left by an initial narrow fit.
  handle.element.classList.remove('tcw-toolbar-overflow');
  handle.element.removeAttribute('data-tcw-folded');
  handle.element.setAttribute('aria-label', 'Settings');
  return handle;
}

module.exports = { addReplayTradingSettingsButton };
