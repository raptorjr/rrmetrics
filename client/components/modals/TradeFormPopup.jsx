const React = require('react');
const { useState, useEffect, useRef } = React;
const helper = require('../../helper.js');
const { authFetch, postScreenshot } = helper;
const Icons = require('../shared/Icons');
const TickerAutofill = require('../shared/TickerAutofill');
const ScreenshotMarkupModal = require('../shared/ScreenshotMarkupModal');
const RuleChecklist = require('../shared/RuleChecklist');
const { resizeImage } = require('../../utils/imageUtils');
const { getDisplayTimeZone } = require('../../utils/dateUtils');
const { SidePanelContext } = require('../../utils/contexts');
const { useWindowWidth } = require('../../utils/hooks');
const { TAG_COLOR_PRESETS } = require('../../utils/tagConstants');

// =====================================================
// TRADE FORM POPUP
// =====================================================

const TradeFormPopup = ({ isOpen, onClose, onBack, triggerReload, editingTrade, prefillDate, tags, strategyRules, trades, sidebarCollapsed, forceModal = false }) => {
  const [screenshot, setScreenshot] = useState(null);
  const [pastedImage, setPastedImage] = useState(null);
  const [isMarkupOpen, setIsMarkupOpen] = useState(false);
  const [markupSource, setMarkupSource] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [showNewTag, setShowNewTag] = useState(false);
  const [quickTagName, setQuickTagName] = useState('');
  const [quickTagColor, setQuickTagColor] = useState(TAG_COLOR_PRESETS[0]);
  const [creatingTag, setCreatingTag] = useState(false);
  const [account, setAccount] = useState('');
  const [isEval, setIsEval] = useState(false);
  const [tradeRuleChecks, setTradeRuleChecks] = useState([]);
  const [pendingRuleChecks, setPendingRuleChecks] = useState([]);
  const [ruleChecksLoading, setRuleChecksLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const windowWidth = useWindowWidth();
  const isUltrawide = windowWidth >= 2000;
  const isSidePanel = !forceModal && (isUltrawide || (sidebarCollapsed && windowWidth >= 1280));
  const isRightOverlay = forceModal || isSidePanel;
  const setSidePanelOffset = React.useContext(SidePanelContext);
  const tradeRules = strategyRules ? strategyRules.filter(r => r.type === 'trade') : [];
  useEffect(() => {
    // A calendar edit modal sits above the existing daily-trades panel.
    // Leave that panel's layout offset untouched so the dashboard does not resize.
    if (forceModal) return;
    if (!isOpen) { setSidePanelOffset(0); return; }
    if (isSidePanel) setSidePanelOffset(520);
    else setSidePanelOffset(0);
    return () => setSidePanelOffset(0);
  }, [isOpen, isSidePanel, forceModal, setSidePanelOffset]);

  const handleQuickCreateTag = async () => {
    if (!quickTagName.trim() || creatingTag) return;
    setCreatingTag(true);
    try {
      const response = await authFetch('/api/makeTag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickTagName.trim(), color: quickTagColor }),
      });
      const data = await response.json();
      if (!data.error && data._id) {
        setSelectedTags(prev => [...prev, data._id]);
        setQuickTagName('');
        setQuickTagColor(TAG_COLOR_PRESETS[0]);
        setShowNewTag(false);
        triggerReload();
      }
    } catch (err) {
      console.error('Failed to create tag:', err);
    }
    setCreatingTag(false);
  };

  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      if (!isRightOverlay) document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, isRightOverlay]);

  useEffect(() => {
    if (!isOpen) {
      setScreenshot(null); setPastedImage(null); setSelectedTags([]);
      setAccount(''); setIsEval(false); setTradeRuleChecks([]); setPendingRuleChecks([]);
      return;
    }
    if (editingTrade && editingTrade.screenshot) setScreenshot(editingTrade.screenshot);
    if (editingTrade && editingTrade.tags) setSelectedTags(editingTrade.tags);
    else setSelectedTags([]);
    if (editingTrade) {
      setAccount(editingTrade?.account || '');
      setIsEval(editingTrade.isEval || false);
      if (editingTrade._id && tradeRules.length > 0) {
        authFetch(`/api/strategy/checks/trade/${editingTrade._id}`)
          .then(r => r.json())
          .then(data => { if (!data.error) setTradeRuleChecks(data.checks || []); })
          .catch(() => {});
      }
    } else {
      setIsEval(false);
    }

    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => setPastedImage(event.target.result);
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen, editingTrade]);

  if (!isOpen) return null;

  const isEditing = editingTrade !== null;

  const uploadScreenshot = async (dataUrl) => {
    setIsUploading(true);
    try {
      return await postScreenshot(dataUrl);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setPastedImage(event.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRuleToggle = async (ruleId, followed) => {
    if (isEditing && editingTrade?._id) {
      setRuleChecksLoading(true);
      try {
        const resp = await authFetch('/api/strategy/checks/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeId: editingTrade._id, ruleId, followed }),
        });
        const check = await resp.json();
        if (!check.error) {
          setTradeRuleChecks(prev => {
            const filtered = prev.filter(ch => ch.ruleId !== ruleId);
            return [...filtered, check];
          });
        }
      } catch (err) {
        console.error('Failed to toggle rule:', err);
      } finally {
        setRuleChecksLoading(false);
      }
    } else {
      setPendingRuleChecks(prev => {
        const filtered = prev.filter(ch => ch.ruleId !== ruleId);
        return [...filtered, { ruleId, followed }];
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    helper.hideError();
    const ticker = e.target.querySelector('#ticker').value;
    const enterDateRaw = e.target.querySelector('#enterDate').value;
    const enterClockRaw = e.target.querySelector('#enterClock').value;
    const exitDateRaw = e.target.querySelector('#exitDate').value;
    const exitClockRaw = e.target.querySelector('#exitClock').value;
    const enterPrice = e.target.querySelector('#enterPrice').value;
    const exitPrice = e.target.querySelector('#exitPrice').value;
    const quantity = e.target.querySelector('#quantity').value;
    const manualPL = e.target.querySelector('#manualPL').value;
    const comments = e.target.querySelector('#comments').value;
    const hasPrices = enterPrice && exitPrice;
    const hasPL = manualPL;
    if (!ticker || !enterDateRaw || !enterClockRaw || !exitDateRaw || !exitClockRaw || !quantity) {
      helper.handleError('Ticker, enter date/time, exit date/time, and quantity are required');
      return;
    }
    if (!hasPrices && !hasPL) {
      helper.handleError('Either enter/exit prices or a manual P/L is required');
      return;
    }
    const localInputToISO = (value) => {
      const [datePart, timePart] = value.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute, second = 0] = timePart.split(':').map(Number);
      const target = Date.UTC(year, month - 1, day, hour, minute, second);
      let timestamp = target;
      const zone = getDisplayTimeZone();
      for (let i = 0; i < 3; i++) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date(timestamp));
        const part = type => Number(parts.find(item => item.type === type).value);
        const represented = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
        timestamp += target - represented;
      }
      return new Date(timestamp).toISOString();
    };
    const parseDisplayDateTime = (dateValue, timeValue) => {
      const dateMatch = dateValue.trim().match(/^(\d{2})\\.(\d{2})\\.(\d{4})$/);
      if (!dateMatch) return null;
      const [, day, month, year] = dateMatch;
      let hour, minute, second = 0;
      const timeFormat = localStorage.getItem('rrmetrics_time_format') === '24h' ? '24h' : '12h';
      if (timeFormat === '24h') {
        const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        hour = Number(match[1]); minute = Number(match[2]); second = Number(match[3] || 0);
      } else {
        const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
        if (!match) return null;
        hour = Number(match[1]) % 12 + (match[4].toUpperCase() === 'PM' ? 12 : 0);
        minute = Number(match[2]); second = Number(match[3] || 0);
      }
      const d = Number(day), m = Number(month), y = Number(year);
      const check = new Date(Date.UTC(y, m - 1, d, hour, minute, second));
      if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || hour > 23 || minute > 59 || second > 59) return null;
      return localInputToISO(`${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`);
    };
    const enterTime = parseDisplayDateTime(enterDateRaw, enterClockRaw);
    const exitTime = parseDisplayDateTime(exitDateRaw, exitClockRaw);
    if (!enterTime || !exitTime) {
      helper.handleError('Enter dates as DD.MM.YYYY and times in the selected 12/24-hour format');
      return;
    }
    const tradeData = {
      ticker, enterTime, exitTime,
      enterPrice: enterPrice ? parseFloat(enterPrice) : 0,
      exitPrice: exitPrice ? parseFloat(exitPrice) : 0,
      quantity: parseFloat(quantity),
      comments, isEval,
      account: account || null,
    };
    if (hasPL) tradeData.manualPL = parseFloat(manualPL);
    if (screenshot) tradeData.screenshot = screenshot;
    if (selectedTags.length > 0) tradeData.tags = selectedTags;
    try {
      if (isEditing) {
        tradeData._id = editingTrade._id;
        const resp = await authFetch('/api/updateTrade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData),
        });
        const result = await resp.json();
        if (result.error) { helper.handleError(result.error); return; }
      } else {
        const resp = await authFetch('/api/trades', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeData),
        });
        const result = await resp.json();
        if (result.error) { helper.handleError(result.error); return; }
        if (result._id && pendingRuleChecks.length > 0) {
          await Promise.all(
            pendingRuleChecks.filter(ch => ch.followed).map(ch =>
              authFetch('/api/strategy/checks/trade', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tradeId: result._id, ruleId: ch.ruleId, followed: ch.followed }),
              }).catch(() => {})
            )
          );
        }
      }
      triggerReload();
      onClose();
    } catch (err) {
      helper.handleError(err.message || 'An error occurred');
    }
  };

  const formatDateTimeForInput = (dateString) => {
    if (!dateString) return { date: '', time: '' };
    const date = new Date(dateString);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: getDisplayTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = type => parts.find(item => item.type === type)?.value || '00';
    const dateValue = `${part('day')}.${part('month')}.${part('year')}`;
    const timeFormat = localStorage.getItem('rrmetrics_time_format') === '24h' ? '24h' : '12h';
    const timeValue = new Intl.DateTimeFormat('en-US', {
      timeZone: getDisplayTimeZone(), hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: timeFormat !== '24h', hourCycle: timeFormat === '24h' ? 'h23' : 'h12',
    }).format(date);
    return { date: dateValue, time: timeValue };
  };
  const defaultDateTime = (dateString) => {
    const value = dateString ? new Date(`${dateString}T09:30:00`) : new Date();
    return formatDateTimeForInput(value.toISOString());
  };
  const enterDefaults = isEditing ? formatDateTimeForInput(editingTrade.enterTime) : defaultDateTime(prefillDate);
  const exitDefaults = isEditing ? formatDateTimeForInput(editingTrade.exitTime) : defaultDateTime(prefillDate);

  const inputClass = "w-full px-3 py-2.5 bg-bg-input border border-border rounded-lg text-text-primary text-sm placeholder-text-muted focus:outline-none focus:border-accent transition-colors";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1.5";

  return (
    <>
      <div className={isRightOverlay ? "fixed inset-0 z-50 flex justify-end" : "fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"} onClick={isRightOverlay ? (e) => e.stopPropagation() : onClose}>
        <div className={isRightOverlay ? (forceModal ? "w-[480px] h-full overflow-y-auto bg-bg-surface border-l border-border shadow-2xl" : "w-[520px] h-full overflow-y-auto bg-bg-surface border-l border-border shadow-2xl") : "bg-bg-surface border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface z-10">
            <div className="flex items-center gap-3">
              {isEditing && onBack && <button type="button" className="text-text-secondary hover:text-text-primary transition-colors" onClick={onBack} aria-label="Back to trades"><Icons.ChevronLeft /></button>}
              <h2 className="text-lg font-semibold text-text-primary">{isEditing ? 'Edit Trade' : 'New Trade'}</h2>
            </div>
            <button className="text-text-secondary hover:text-text-primary transition-colors" onClick={onClose} aria-label="Close"><Icons.X /></button>
          </div>

          <form
            id="tradeForm"
            onSubmit={handleSubmit}
            name="tradeForm"
            action={isEditing ? "/api/updateTrade" : "/api/trades"}
            method="POST"
            className="p-6 space-y-4"
          >
            <div>
              <label htmlFor="ticker" className={labelClass}>Ticker</label>
              <TickerAutofill id="ticker" name="ticker" placeholder="AAPL" defaultValue={isEditing ? editingTrade.ticker : ''} className={inputClass} trades={trades} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={labelClass}>Enter Time</label>
                <input id="enterDate" type="text" name="enterDate" placeholder="DD.MM.YYYY" aria-label="Enter date (DD.MM.YYYY)" defaultValue={enterDefaults.date} className={inputClass} />
                <input id="enterClock" type="text" name="enterClock" placeholder={localStorage.getItem('rrmetrics_time_format') === '24h' ? 'HH:mm:ss' : 'hh:mm:ss AM/PM'} aria-label="Enter time" defaultValue={enterDefaults.time} className={inputClass} />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Exit Time</label>
                <input id="exitDate" type="text" name="exitDate" placeholder="DD.MM.YYYY" aria-label="Exit date (DD.MM.YYYY)" defaultValue={exitDefaults.date} className={inputClass} />
                <input id="exitClock" type="text" name="exitClock" placeholder={localStorage.getItem('rrmetrics_time_format') === '24h' ? 'HH:mm:ss' : 'hh:mm:ss AM/PM'} aria-label="Exit time" defaultValue={exitDefaults.time} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="enterPrice" className={labelClass}>Enter Price <span className="text-text-muted font-normal normal-case">(or use P/L)</span></label>
                <input id="enterPrice" type="number" step="0.01" min="0" name="enterPrice" placeholder="0.00" defaultValue={isEditing ? editingTrade.enterPrice || '' : ''} className={inputClass} />
              </div>
              <div>
                <label htmlFor="exitPrice" className={labelClass}>Exit Price <span className="text-text-muted font-normal normal-case">(or use P/L)</span></label>
                <input id="exitPrice" type="number" step="0.01" min="0" name="exitPrice" placeholder="0.00" defaultValue={isEditing ? editingTrade.exitPrice || '' : ''} className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="quantity" className={labelClass}>Quantity</label>
                <input id="quantity" type="number" step="0.01" name="quantity" placeholder="1" defaultValue={isEditing ? editingTrade.quantity : ''} className={inputClass} />
                <p className="text-text-muted text-xs mt-0.5">Use negative for short trades</p>
              </div>
              <div>
                <label htmlFor="manualPL" className={labelClass}>P/L <span className="text-text-muted font-normal normal-case">(or use prices)</span></label>
                <input id="manualPL" type="number" step="0.01" name="manualPL" placeholder="Required if no prices" defaultValue={isEditing && editingTrade.manualPL ? editingTrade.manualPL : ''} className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="comments" className={labelClass}>Comments</label>
              <textarea id="comments" name="comments" placeholder="Trade notes..." rows="3" defaultValue={isEditing ? editingTrade.comments : ''} className={`${inputClass} resize-none`}></textarea>
            </div>

            {/* Account field */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Account (optional)</label>
              <input
                type="text"
                list="account-suggestions"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="e.g. Topstep 50K"
                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
              />
              <datalist id="account-suggestions">
                {[...new Set((trades || []).map(t => t.account).filter(Boolean))].sort().map(a => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            {/* Eval checkbox */}
            <div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    isEval ? 'bg-accent border-accent' : 'border-border group-hover:border-accent/60'
                  }`}
                  onClick={() => setIsEval(prev => !prev)}
                >
                  {isEval && <Icons.Check className="w-3 h-3 text-accent-text" />}
                </div>
                <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors" onClick={() => setIsEval(prev => !prev)}>
                  Evaluation trade
                </span>
                {isEval && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-accent/15 text-accent">EVAL</span>
                )}
              </label>
              <p className="text-text-muted text-xs mt-1 ml-7">Mark this trade as taken on an evaluation account. Eval trades can be excluded from analytics.</p>
            </div>

            {/* Strategy rule checklist */}
            {tradeRules.length > 0 && (
              <div>
                <label className={labelClass}>Strategy Checklist</label>
                <RuleChecklist
                  rules={tradeRules}
                  checks={isEditing ? tradeRuleChecks : pendingRuleChecks.map(ch => ({ ruleId: ch.ruleId, followed: ch.followed }))}
                  onToggle={handleRuleToggle}
                  loading={ruleChecksLoading}
                />
              </div>
            )}

            {/* Tags section */}
            <div>
              <label className={labelClass}>Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags && tags.map(tag => {
                  const isSelected = selectedTags.includes(tag._id);
                  return (
                    <button
                      key={tag._id}
                      type="button"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        !isSelected ? 'bg-bg-input border-border text-text-secondary hover:text-text-primary' : ''
                      }`}
                      style={isSelected ? {
                        borderColor: tag.color,
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                      } : undefined}
                      onClick={() => {
                        setSelectedTags(prev =>
                          prev.includes(tag._id)
                            ? prev.filter(id => id !== tag._id)
                            : [...prev, tag._id]
                        );
                      }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                      {tag.name}
                    </button>
                  );
                })}
                {!showNewTag && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-border text-text-tertiary hover:text-text-primary hover:border-accent transition-colors"
                    onClick={() => setShowNewTag(true)}
                  >
                    <Icons.Plus className="w-3 h-3" />
                    New Tag
                  </button>
                )}
              </div>
              {showNewTag && (
                <div className="flex flex-wrap items-center gap-2 mt-2 p-3 bg-bg-input border border-border rounded-lg">
                  <input
                    type="text"
                    value={quickTagName}
                    onChange={(e) => setQuickTagName(e.target.value)}
                    placeholder="Tag name"
                    className="px-2.5 py-1.5 bg-bg-surface border border-border rounded-md text-text-primary text-xs focus:outline-none focus:border-accent transition-colors w-28"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateTag(); } }}
                  />
                  <div className="flex gap-1">
                    {TAG_COLOR_PRESETS.slice(0, 4).map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`w-5 h-5 rounded-full border-2 transition-all ${
                          quickTagColor === color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setQuickTagColor(color)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="px-2.5 py-1.5 bg-accent text-accent-text text-xs font-semibold rounded-md hover:brightness-110 transition-all disabled:opacity-50"
                    onClick={handleQuickCreateTag}
                    disabled={creatingTag || !quickTagName.trim()}
                  >
                    {creatingTag ? '...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1.5 text-text-tertiary text-xs hover:text-text-primary transition-colors"
                    onClick={() => { setShowNewTag(false); setQuickTagName(''); }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Screenshot section */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className={labelClass + ' mb-0'}>Screenshot</label>
              </div>
              <>
                  {!screenshot && !pastedImage && (
                    <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                      <Icons.Download className="w-8 h-8 text-text-muted mx-auto mb-2" />
                      <p className="text-text-tertiary text-sm mb-3">Paste (Ctrl+V) or drag an image here, or</p>
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-bg-input border border-border text-text-secondary text-xs rounded-lg hover:border-accent hover:text-text-primary transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose File
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    </div>
                  )}

                  {pastedImage && !screenshot && (
                    <div className="space-y-3">
                      <img src={pastedImage} alt="Pasted screenshot" className="rounded-lg max-h-48 w-full object-contain bg-bg-input cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxOpen(true)} />
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 py-2 text-xs bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110" onClick={() => { setMarkupSource(pastedImage); setIsMarkupOpen(true); }}>
                          Annotate
                        </button>
                        <button type="button" className="flex-1 py-2 text-xs bg-bg-input border border-border text-text-primary rounded-lg hover:border-accent disabled:opacity-50" disabled={isUploading} onClick={async () => {
                          try {
                            const resized = await resizeImage(pastedImage);
                            const url = await uploadScreenshot(resized);
                            setScreenshot(url);
                            setPastedImage(null);
                          } catch (err) {
                            helper.handleError('Failed to upload screenshot: ' + err.message);
                          }
                        }}>
                          {isUploading ? 'Uploading...' : 'Use As-Is'}
                        </button>
                        <button type="button" className="py-2 px-3 text-xs bg-bg-input border border-border text-text-secondary rounded-lg hover:text-negative hover:border-negative/50" onClick={() => { setScreenshot(null); setPastedImage(null); }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  {screenshot && (
                    <div className="space-y-3">
                      <img src={screenshot} alt="Trade screenshot" className="rounded-lg max-h-48 w-full object-contain bg-bg-input cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setLightboxOpen(true)} />
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 py-2 text-xs bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110" onClick={() => { setMarkupSource(screenshot); setIsMarkupOpen(true); }}>
                          Annotate
                        </button>
                        <button type="button" className="py-2 px-3 text-xs bg-bg-input border border-border text-text-secondary rounded-lg hover:text-negative hover:border-negative/50" onClick={() => { setScreenshot(null); setPastedImage(null); }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </>
            </div>

            {/* Image Lightbox */}
            {lightboxOpen && (screenshot || pastedImage) && (
              <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxOpen(false)}>
                <button className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors" onClick={() => setLightboxOpen(false)}>
                  <Icons.X />
                </button>
                <img src={screenshot || pastedImage} alt="Screenshot preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
              </div>
            )}

            <div id="errorDiv" className="hidden">
              <div className="p-3 bg-negative/10 border border-negative/30 rounded-lg">
                <span id="errorMessage" className="text-negative text-sm"></span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-accent text-accent-text font-semibold rounded-lg hover:brightness-110 transition-all"
            >
              {isEditing ? 'Update Trade' : 'Add Trade'}
            </button>
          </form>
        </div>
      </div>

      <ScreenshotMarkupModal
        isOpen={isMarkupOpen}
        onClose={() => setIsMarkupOpen(false)}
        onSave={async (annotatedImage) => {
          try {
            const url = await uploadScreenshot(annotatedImage);
            setScreenshot(url);
            setPastedImage(null);
            setMarkupSource(null);
          } catch (err) {
            helper.handleError('Failed to upload screenshot: ' + err.message);
          }
        }}
        initialImage={markupSource}
      />
    </>
  );
};

module.exports = TradeFormPopup;
