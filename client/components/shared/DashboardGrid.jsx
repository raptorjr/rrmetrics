const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;

const MAX_COLUMNS = 4;
const GRID_GAP = 16;
const ROW_UNIT = 128;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getDefaultSize = (item) => ({
  w: clamp(Number(item.defaultColumns) || 1, Number(item.minColumns) || 1, MAX_COLUMNS),
  h: Math.max(Number(item.minRows) || 1, Number(item.defaultRows) || 1),
});

const readLayout = (storageKey, defaultOrder, defaultVisible, items) => {
  const ids = items.map(item => item.id);
  const valid = new Set(ids);
  const defaults = [...defaultOrder.filter(id => valid.has(id)), ...ids.filter(id => !defaultOrder.includes(id))];

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) {
      return {
        order: defaults,
        hidden: defaults.filter(id => !defaultVisible.includes(id)),
        sizes: Object.fromEntries(items.map(item => [item.id, getDefaultSize(item)])),
      };
    }

    const newIds = defaults.filter(id => !saved.order.includes(id));
    const order = [...saved.order.filter(id => valid.has(id)), ...newIds];
    const hidden = [
      ...saved.hidden.filter(id => valid.has(id)),
      ...newIds.filter(id => !defaultVisible.includes(id)),
    ];
    const sizes = Object.fromEntries(items.map(item => {
      const fallback = getDefaultSize(item);
      const savedSize = saved.sizes && saved.sizes[item.id];
      return [item.id, {
        w: clamp(Number(savedSize && savedSize.w) || fallback.w, Number(item.minColumns) || 1, MAX_COLUMNS),
        h: Math.max(Number(item.minRows) || 1, Number(savedSize && savedSize.h) || fallback.h),
      }];
    }));

    return { order, hidden, sizes };
  } catch {
    return {
      order: defaults,
      hidden: defaults.filter(id => !defaultVisible.includes(id)),
      sizes: Object.fromEntries(items.map(item => [item.id, getDefaultSize(item)])),
    };
  }
};

const DashboardGrid = ({ storageKey, items, defaultOrder, defaultVisible = defaultOrder }) => {
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const [layout, setLayout] = useState(() => readLayout(storageKey, defaultOrder, defaultVisible, items));
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [columns, setColumns] = useState(12);
  const [templates, setTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${storageKey}_templates`) || '[]'); }
    catch { return []; }
  });
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [previewItemId, setPreviewItemId] = useState(null);
  const gridRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    if (!previewItemId) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setPreviewItemId(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewItemId]);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      setColumns(width < 768 ? 2 : width < 1280 ? 6 : 12);
    };
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  useEffect(() => {
    setLayout(readLayout(storageKey, defaultOrder, defaultVisible, items));
    try {
      const savedTemplates = JSON.parse(localStorage.getItem(`${storageKey}_templates`) || '[]');
      setTemplates(Array.isArray(savedTemplates) ? savedTemplates : []);
    } catch { setTemplates([]); }
    setSelectedTemplate('');
  }, [storageKey, ids.join('|')]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [storageKey, layout]);

  const orderedItems = layout.order
    .map(id => items.find(item => item.id === id))
    .filter(Boolean);
  const visibleItems = orderedItems.filter(item => !layout.hidden.includes(item.id));

  const toggleItem = (id) => {
    setLayout(current => ({
      ...current,
      hidden: current.hidden.includes(id)
        ? current.hidden.filter(value => value !== id)
        : current.hidden.concat(id),
    }));
  };

  const moveItem = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setLayout(current => {
      const order = [...current.order];
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from < 0 || to < 0) return current;
      order.splice(from, 1);
      order.splice(to, 0, fromId);
      return { ...current, order };
    });
  };

  const reset = () => setLayout(readLayout('__rrmetrics_no_saved_layout__', defaultOrder, defaultVisible, items));

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next = [...templates.filter(template => template.name.toLowerCase() !== name.toLowerCase()), {
      name,
      layout: JSON.parse(JSON.stringify(layout)),
    }];
    setTemplates(next);
    localStorage.setItem(`${storageKey}_templates`, JSON.stringify(next));
    setSelectedTemplate(name);
    setTemplateName('');
  };

  const applyTemplate = () => {
    const template = templates.find(candidate => candidate.name === selectedTemplate);
    if (!template) return;
    localStorage.setItem(storageKey, JSON.stringify(template.layout));
    setLayout(readLayout(storageKey, defaultOrder, defaultVisible, items));
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) return;
    const next = templates.filter(template => template.name !== selectedTemplate);
    setTemplates(next);
    localStorage.setItem(`${storageKey}_templates`, JSON.stringify(next));
    setSelectedTemplate('');
  };

  const startResize = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    const currentSize = layout.sizes[item.id] || getDefaultSize(item);
    resizeRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: currentSize.w,
      startH: currentSize.h,
      gridWidth: gridRef.current ? gridRef.current.clientWidth : 1200,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event) => {
    const start = resizeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const item = items.find(candidate => candidate.id === start.id);
    if (!item) return;
    const minW = Number(item.minColumns) || 1;
    const minH = Number(item.minRows) || 1;
    const widthStep = (start.gridWidth - GRID_GAP * (MAX_COLUMNS - 1)) / MAX_COLUMNS + GRID_GAP;
    const widthDelta = Math.round((event.clientX - start.startX) / widthStep);
    const heightDelta = Math.round((event.clientY - start.startY) / ROW_UNIT);
    const nextSize = {
      w: clamp(start.startW + widthDelta, minW, MAX_COLUMNS),
      h: Math.max(minH, start.startH + heightDelta),
    };
    setLayout(current => ({
      ...current,
      sizes: { ...current.sizes, [start.id]: nextSize },
    }));
  };

  const stopResize = (event) => {
    if (resizeRef.current && resizeRef.current.pointerId === event.pointerId) {
      resizeRef.current = null;
    }
  };

  const getColumnSpan = (size) => {
    if (columns === 12) return size.w * 3;
    if (columns === 6) return Math.min(6, Math.max(2, Math.round(size.w * 1.5)));
    return Math.min(2, size.w);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing(value => !value)}
          className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${editing ? 'bg-accent text-accent-text border-accent' : 'bg-bg-surface border-border text-text-secondary hover:text-text-primary hover:border-accent'}`}
        >
          {editing ? 'Done' : 'Edit dashboard'}
        </button>
      </div>

      {editing && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Dashboard tile catalogue</h3>
              <p className="text-xs text-text-tertiary mt-1">Add or remove tiles, drag them to reorder, and resize them directly on the grid.</p>
            </div>
            <button type="button" onClick={reset} className="text-xs text-text-secondary hover:text-text-primary underline">Reset layout</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-page p-3">
            <div className="flex flex-1 min-w-[220px] items-center gap-2">
              <input
                value={templateName}
                onChange={event => setTemplateName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') saveTemplate(); }}
                placeholder="Name this layout…"
                aria-label="Layout template name"
                className="min-w-0 flex-1 rounded-md border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary"
              />
              <button type="button" onClick={saveTemplate} disabled={!templateName.trim()} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-text disabled:opacity-40">Save layout</button>
            </div>
            <div className="flex flex-1 min-w-[220px] items-center gap-2">
              <select value={selectedTemplate} onChange={event => setSelectedTemplate(event.target.value)} aria-label="Saved layouts" className="min-w-0 flex-1 rounded-md border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary">
                <option value="">Choose saved layout…</option>
                {templates.map(template => <option key={template.name} value={template.name}>{template.name}</option>)}
              </select>
              <button type="button" onClick={applyTemplate} disabled={!selectedTemplate} className="rounded-md border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40">Load</button>
              <button type="button" onClick={deleteTemplate} disabled={!selectedTemplate} className="rounded-md border border-border px-3 py-2 text-xs text-text-secondary disabled:opacity-40">Delete</button>
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary">Saved layouts are stored in this browser. Saving an existing name replaces that template.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {orderedItems.map(item => {
              const added = !layout.hidden.includes(item.id);
              const size = layout.sizes[item.id] || getDefaultSize(item);
              return (
                <div key={item.id} className="rounded-lg border border-border p-2.5 hover:border-accent/60 transition-colors">
                  <button
                    type="button"
                    onClick={() => setPreviewItemId(item.id)}
                    aria-label={`Preview ${item.label}`}
                    className="block w-full text-left rounded-md focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {item.preview || <div className="h-[82px] rounded-md bg-bg-page border border-border flex items-center justify-center text-xs text-text-tertiary">{item.label}</div>}
                    <span className="sr-only">Open larger preview</span>
                  </button>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="flex-1 text-xs text-text-primary truncate">{item.label}</span>
                    <span className="text-[10px] text-text-tertiary">{size.w}×{size.h}</span>
                    <button
                      type="button"
                      onClick={() => toggleItem(item.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${added ? 'bg-bg-input text-text-secondary' : 'bg-accent text-accent-text'}`}
                    >
                      {added ? 'Added' : 'Add'}
                    </button>
                  </div>
                  <div className="text-[10px] text-text-tertiary mt-1">{item.category || 'Metrics'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {previewItemId && (() => {
        const item = items.find(candidate => candidate.id === previewItemId);
        if (!item) return null;
        const added = !layout.hidden.includes(item.id);
        const size = layout.sizes[item.id] || getDefaultSize(item);
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
            role="presentation"
            onMouseDown={event => { if (event.target === event.currentTarget) setPreviewItemId(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dashboard-tile-preview-title"
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl"
              onMouseDown={event => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{item.category || 'Metrics'} · {size.w}×{size.h} grid units</div>
                  <h2 id="dashboard-tile-preview-title" className="text-lg font-semibold text-text-primary mt-1">{item.label}</h2>
                  <p className="text-sm text-text-secondary mt-2">{item.description || 'A reusable dashboard component based on your selected trading data and period filters.'}</p>
                </div>
                <button type="button" onClick={() => setPreviewItemId(null)} aria-label="Close preview" className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">✕</button>
              </div>
              <div className="rounded-xl border border-border bg-bg-page p-3 sm:p-5 overflow-hidden">
                <div className="min-h-[220px] [&>*]:!h-auto">
                  {item.render()}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-4">
                <span className="text-xs text-text-tertiary">This is a live preview using the current dashboard filters.</span>
                <button
                  type="button"
                  onClick={() => { if (!added) toggleItem(item.id); setPreviewItemId(null); }}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${added ? 'border border-border text-text-secondary' : 'bg-accent text-accent-text'}`}
                >
                  {added ? 'Already on dashboard' : 'Add to dashboard'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div
        ref={gridRef}
        className="grid items-stretch gap-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: `minmax(${ROW_UNIT - GRID_GAP}px, auto)`,
          gridAutoFlow: 'row dense',
        }}
      >
        {visibleItems.map(item => {
          const size = layout.sizes[item.id] || getDefaultSize(item);
          return (
            <div
              key={item.id}
              draggable={editing}
              onDragStart={editing ? event => {
                setDraggedId(item.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.id);
              } : undefined}
              onDragOver={editing ? event => event.preventDefault() : undefined}
              onDrop={editing ? event => {
                event.preventDefault();
                const fromId = event.dataTransfer.getData('text/plain') || draggedId;
                moveItem(fromId, item.id);
                setDraggedId(null);
              } : undefined}
              onDragEnd={editing ? () => setDraggedId(null) : undefined}
              className={`relative min-w-0 h-full [&>*]:h-full ${editing ? `rounded-xl outline outline-1 outline-dashed outline-accent cursor-grab ${draggedId === item.id ? 'opacity-50' : ''}` : ''}`}
              style={{
                gridColumn: `span ${getColumnSpan(size)} / span ${getColumnSpan(size)}`,
                gridRow: `span ${size.h} / span ${size.h}`,
              }}
            >
              {editing && (
                <div className="absolute z-20 top-2 right-2 flex items-center gap-1 rounded-md bg-bg-page/95 border border-border px-1.5 py-1 text-[10px] text-text-secondary">
                  <span className="select-none pointer-events-none">⠿ Move</span>
                  <span className="select-none pointer-events-none">{size.w}×{size.h}</span>
                </div>
              )}
              {item.render()}
              {editing && (
                <div
                  role="separator"
                  aria-label={`Resize ${item.label}`}
                  title="Drag to resize"
                  onPointerDown={event => startResize(event, item)}
                  onPointerMove={moveResize}
                  onPointerUp={stopResize}
                  onPointerCancel={stopResize}
                  className="absolute z-30 bottom-1 right-1 w-6 h-6 rounded-tl-lg border-l border-t border-border bg-bg-page/90 cursor-nwse-resize touch-none flex items-center justify-center text-text-tertiary select-none"
                >
                  ⤡
                </div>
              )}
            </div>
          );
        })}
      </div>

      {visibleItems.length === 0 && (
        <div className="bg-bg-surface border border-border rounded-xl p-6 text-center text-sm text-text-secondary">No dashboard tiles selected. Choose Edit dashboard to add some.</div>
      )}
    </div>
  );
};

module.exports = DashboardGrid;
