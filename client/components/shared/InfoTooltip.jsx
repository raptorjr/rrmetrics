const React = require('react');
const { useState } = React;
const InfoTooltip = ({ text }) => {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <span className="relative inline-flex items-center">
      <button type="button" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-text-tertiary/50 text-text-tertiary text-[9px] font-semibold leading-none hover:border-accent hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        aria-label="Metric information" aria-expanded={open}
        onClick={event => { event.stopPropagation(); setOpen(value => !value); }}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      >?</button>
      {open && <span role="tooltip" className="absolute z-[60] left-0 top-full mt-2 w-64 max-w-[min(16rem,80vw)] bg-bg-input border border-border rounded-lg p-3 shadow-xl text-xs text-text-secondary leading-relaxed whitespace-pre-line normal-case font-normal tracking-normal">{text}</span>}
    </span>
  );
};
module.exports = InfoTooltip;
