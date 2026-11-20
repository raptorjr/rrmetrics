const React = require('react');
const ReactDOM = require('react-dom');
const { useState } = React;
const InfoTooltip = ({ text }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 8 });
  if (!text) return null;
  const show = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 8;
    const top = below + 180 <= window.innerHeight ? below : Math.max(8, rect.top - 188);
    setPosition({ top, left });
    setOpen(true);
  };
  const hide = () => setOpen(false);
  return (
    <span className="inline-flex items-center">
      <button type="button" className="dashboard-tile-icon-button shrink-0"
        aria-label="Metric information" aria-expanded={open}
        onClick={event => { event.stopPropagation(); if (open) hide(); else show(event); }}
        onMouseEnter={show} onMouseLeave={hide}
        onFocus={show} onBlur={hide}
      >?</button>
      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div role="tooltip" style={{ position: 'fixed', top: position.top, left: position.left, width: 'min(16rem, calc(100vw - 16px))', zIndex: 10000 }}
          className="bg-bg-input border border-border rounded-lg p-3 shadow-xl text-xs text-text-secondary leading-relaxed whitespace-pre-line normal-case font-normal tracking-normal pointer-events-none">
          {text}
        </div>,
        document.body
      )}
    </span>
  );
};
module.exports = InfoTooltip;
