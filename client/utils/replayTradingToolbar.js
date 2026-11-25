// TradeCanvas's host buttons normally participate in the overflow menu.
// Trading settings is a workspace control, like the shared layout picker:
// keep it visible in the active native toolbar, even after responsive refits.
function addReplayTradingSettingsButton(widget, onClick) {
  const handle = widget.addToolbarButton({
    id: 'rr-trading-settings', label: 'Settings', icon: 'settings',
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
