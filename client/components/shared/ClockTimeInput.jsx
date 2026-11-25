const React = require('react');
const { useEffect, useRef, useState } = React;
const { parseClockTime, formatClockTime } = require('../../utils/clockTime');

const fieldClass = 'w-full px-3 py-2.5 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors';
const selectClass = 'bg-bg-input border border-border rounded-md text-text-primary text-sm px-2 py-2 focus:outline-none focus:border-accent';
const pad = n => String(n).padStart(2, '0');
const minutes = Array.from({length:60}, (_,i) => i);

function ClockTimeInput({
  id, name, label = 'Time', value, defaultValue = '', onChange,
  timeFormat = '24h', includeSeconds = true, disabled = false,
  open, onToggle, invalid = false, placement = 'below',
  className = '', title,
}) {
  const ref = useRef(null);
  const [text, setText] = useState(defaultValue);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = value !== undefined;
  const externallyManaged = open !== undefined;
  const shown = !disabled && (externallyManaged ? open : internalOpen);
  const current = controlled ? value : text;
  const update = next => {
    if (!controlled) setText(next);
    onChange?.(next);
  };
  useEffect(() => {
    if (externallyManaged || !shown) return;
    const outside = event => { if (!ref.current?.contains(event.target)) setInternalOpen(false); };
    const key = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setInternalOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [externallyManaged, shown]);
  useEffect(() => { if (disabled) setInternalOpen(false); }, [disabled]);
  const parts = parseClockTime(current, timeFormat, includeSeconds) || { hour:9, minute:30, second:0 };
  const is24 = timeFormat === '24h';
  const hours = Array.from({length:is24?24:12}, (_,i) => is24?i:i+1);
  const changePart = patch => update(formatClockTime({...parts,...patch}, timeFormat, includeSeconds));
  const changeHour = hour => changePart({hour:is24?hour:hour%12+(parts.hour>=12?12:0)});
  const changePeriod = period => changePart({hour:parts.hour%12+(period==='PM'?12:0)});
  const placeholder = (is24?'HH:mm':'hh:mm') + (includeSeconds?':ss':'') + (is24?'':' AM/PM');
  return <div ref={ref} className={'relative min-w-0 '+className} title={title}>
    <input id={id} name={name} type="text" aria-label={label} aria-invalid={invalid||undefined}
      value={current} placeholder={placeholder} disabled={disabled}
      onChange={event=>update(event.target.value)}
      className={fieldClass+' pr-12 disabled:opacity-40'+(invalid?' border-negative':'')}/>
    <button type="button" aria-label={'Open '+label.toLowerCase()+' selector'} aria-expanded={shown} disabled={disabled}
      onClick={()=>externallyManaged?onToggle?.():setInternalOpen(v=>!v)}
      className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-text-primary hover:text-accent disabled:opacity-40">
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    </button>
    {shown&&<div data-time-picker role="group" aria-label={label+' selector'}
      className={'absolute right-0 z-30 flex items-center gap-1.5 p-2 bg-bg-surface border border-border rounded-lg shadow-xl '+(placement==='above'?'bottom-full mb-1':'top-full mt-1')}>
      <select aria-label="Hour" data-part="hour" value={is24?parts.hour:parts.hour%12||12} onChange={e=>changeHour(Number(e.target.value))} className={selectClass}>{hours.map(h=><option key={h} value={h}>{pad(h)}</option>)}</select>
      <span className="text-text-secondary">:</span>
      <select aria-label="Minute" data-part="minute" value={parts.minute} onChange={e=>changePart({minute:Number(e.target.value)})} className={selectClass}>{minutes.map(m=><option key={m} value={m}>{pad(m)}</option>)}</select>
      {includeSeconds&&<><span className="text-text-secondary">:</span><select aria-label="Second" data-part="second" value={parts.second} onChange={e=>changePart({second:Number(e.target.value)})} className={selectClass}>{minutes.map(s=><option key={s} value={s}>{pad(s)}</option>)}</select></>}
      {!is24&&<select aria-label="AM or PM" data-part="period" value={parts.hour>=12?'PM':'AM'} onChange={e=>changePeriod(e.target.value)} className={selectClass}><option>AM</option><option>PM</option></select>}
    </div>}
  </div>;
}
module.exports = ClockTimeInput;
