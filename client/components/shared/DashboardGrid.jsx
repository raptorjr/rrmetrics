const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;

const {
  MAX_COLUMNS,
  MAX_ROWS,
  clamp,
  getDefaultSize,
  completePositions,
  placeTileAndDisplace,
  getDropPositionFromGrab,
  normalizeLayout,
  readLayoutFromValue,
  createStarterLayout,
  STARTER_LAYOUTS,
} = require('../../utils/dashboardLayout');

const GRID_GAP = 16;
const ROW_UNIT = 128;

const readTemplates = (storageKey) => {
  try {
    const saved = JSON.parse(localStorage.getItem(`${storageKey}_templates`) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(template =>
      template &&
      typeof template.name === 'string' &&
      template.name.trim() &&
      template.layout &&
      Array.isArray(template.layout.order) &&
      Array.isArray(template.layout.hidden)
    );
  } catch {
    return [];
  }
};

const readLayout = (storageKey, defaultOrder, defaultVisible, items) => {
  try {
    return readLayoutFromValue(JSON.parse(localStorage.getItem(storageKey)), defaultOrder, defaultVisible, items);
  } catch {
    return readLayoutFromValue(null, defaultOrder, defaultVisible, items);
  }
};

const DashboardGrid = ({ storageKey, items, defaultOrder, defaultVisible = defaultOrder }) => {
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const [layout, setLayout] = useState(() => readLayout(storageKey, defaultOrder, defaultVisible, items));
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [columns, setColumns] = useState(2);
  const [templates, setTemplates] = useState(() => readTemplates(storageKey));
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedStarter, setSelectedStarter] = useState('');
  const [previewItemId, setPreviewItemId] = useState(null);
  const [storageWarning, setStorageWarning] = useState(null);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueCategory, setCatalogueCategory] = useState('all');
  const [catalogueStatus, setCatalogueStatus] = useState('all');
  const [settingDrafts, setSettingDrafts] = useState({});
  const gridRef = useRef(null);
  const resizeRef = useRef(null);
  const dragOffsetRef = useRef({ col: 0, row: 0 });
  const previewDialogRef = useRef(null);

  useEffect(() => {
    if (!previewItemId) return undefined;
    const previouslyFocused = document.activeElement;
    const dialog = previewDialogRef.current;
    if (dialog) dialog.focus();

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPreviewItemId(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [previewItemId]);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return undefined;
    const updateColumns = () => {
      const width = element.clientWidth;
      setColumns(width < 640 ? 2 : width < 1024 ? 4 : 8);
    };
    updateColumns();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateColumns);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  useEffect(() => {
    setLayout(readLayout(storageKey, defaultOrder, defaultVisible, items));
    setTemplates(readTemplates(storageKey));
    setSelectedTemplate('');
  }, [storageKey, ids.join('|')]);

  const persistValue = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setStorageWarning(current => current && current.key === key ? null : current);
      return true;
    } catch {
      setStorageWarning({
        key,
        message: 'Browser storage is unavailable or full. Your changes are active for this session but may not be saved after you leave or reload the page.',
      });
      return false;
    }
  };

  useEffect(() => {
    persistValue(storageKey, layout);
  }, [storageKey, layout]);

  const orderedItems = layout.order
    .map(id => items.find(item => item.id === id))
    .filter(Boolean);
  const visibleItems = orderedItems.filter(item => !layout.hidden.includes(item.id));

  const toggleItem = (id) => {
    setLayout(current => {
      const hidden = current.hidden.includes(id)
        ? current.hidden.filter(value => value !== id)
        : current.hidden.concat(id);
      return {
        ...current,
        hidden,
        positions: completePositions(current.order, hidden, current.sizes, current.positions),
      };
    });
  };

  const moveItem = (fromId, toId, position = 'before') => {
    if (!fromId || !toId || fromId === toId) return;
    setLayout(current => {
      const order = [...current.order];
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from < 0 || to < 0) return current;
      order.splice(from, 1);
      const target = order.indexOf(toId);
      if (target < 0) return current;
      order.splice(target + (position === 'after' ? 1 : 0), 0, fromId);
      return { ...current, order, positions: completePositions(order, current.hidden, current.sizes, current.positions) };
    });
  };

  const reset = () => {
    setLayout(readLayoutFromValue(null, defaultOrder, defaultVisible, items));
    setSelectedTemplate('');
    setSelectedStarter('');
  };

  const selectedTemplateData = templates.find(template => template.name === selectedTemplate);
  const selectedTemplateLayout = selectedTemplateData
    ? readLayoutFromValue(selectedTemplateData.layout, defaultOrder, defaultVisible, items)
    : null;
  const selectedTemplateHasChanges = Boolean(selectedTemplateLayout && (
    JSON.stringify(selectedTemplateLayout.order) !== JSON.stringify(layout.order)
    || JSON.stringify(selectedTemplateLayout.hidden) !== JSON.stringify(layout.hidden)
    || JSON.stringify(selectedTemplateLayout.positions) !== JSON.stringify(layout.positions)
    || items.some(item => {
      const savedSize = selectedTemplateLayout.sizes[item.id];
      const currentSize = layout.sizes[item.id];
      return !savedSize || !currentSize || savedSize.w !== currentSize.w || savedSize.h !== currentSize.h;
    })
  ));

  const updateSelectedTemplate = () => {
    if (!selectedTemplate || !selectedTemplateHasChanges) return;
    const next = templates.map(template => template.name === selectedTemplate
      ? { ...template, layout: JSON.parse(JSON.stringify(layout)) }
      : template);
    setTemplates(next);
    persistValue(`${storageKey}_templates`, next);
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next = [...templates.filter(template => template.name.toLowerCase() !== name.toLowerCase()), {
      name,
      layout: JSON.parse(JSON.stringify(layout)),
    }];
    setTemplates(next);
    persistValue(`${storageKey}_templates`, next);
    setSelectedTemplate(name);
    setTemplateName('');
  };

  const applyTemplate = () => {
    const template = templates.find(candidate => candidate.name === selectedTemplate);
    if (!template) return;
    const normalized = readLayoutFromValue(template.layout, defaultOrder, defaultVisible, items);
    setLayout(normalized);
    setSelectedStarter('');
  };

  const applyStarterLayout = () => {
    const starter = STARTER_LAYOUTS.find(candidate => candidate.id === selectedStarter);
    if (!starter) return;
    setLayout(createStarterLayout(starter, items, layout.order));
    setSelectedTemplate('');
    setSelectedStarter('');
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) return;
    const next = templates.filter(template => template.name !== selectedTemplate);
    setTemplates(next);
    persistValue(`${storageKey}_templates`, next);
    setSelectedTemplate('');
  };

  const startResize = (event, item, corner) => {
    event.preventDefault();
    event.stopPropagation();
    const currentSize = layout.sizes[item.id] || getDefaultSize(item);
    const currentPosition = layout.positions[item.id] || { col: 1, row: 1 };
    resizeRef.current = {
      id: item.id,
      corner,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: currentSize.w,
      startH: currentSize.h,
      startCol: currentPosition.col,
      startRow: currentPosition.row,
      gridWidth: gridRef.current ? gridRef.current.clientWidth : 1200,
    };
    if (gridRef.current && gridRef.current.setPointerCapture) gridRef.current.setPointerCapture(event.pointerId);
  };

  const moveResize = (event) => {
    const start = resizeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const item = items.find(candidate => candidate.id === start.id);
    if (!item) return;
    const minW = Number(item.minColumns) || 1;
    const minH = Number(item.minRows) || 1;
    const maxW = columns === 2 ? 2 : MAX_COLUMNS;
    const geometry = getResizedTileGeometry({
      position: { col: start.startCol, row: start.startRow },
      size: { w: start.startW, h: start.startH },
      corner: start.corner,
      deltaX: event.clientX - start.startX,
      deltaY: event.clientY - start.startY,
      gridWidth: start.gridWidth,
      columns,
      gap: GRID_GAP,
      rowUnit: ROW_UNIT,
      minW,
      minH,
      maxW,
      maxH: MAX_ROWS,
    });
    setLayout(current => {
      const sizes = { ...current.sizes, [start.id]: geometry.size };
      return {
        ...current,
        sizes,
        positions: placeTileAndDisplace(
          start.id,
          geometry.position,
          current.order,
          current.hidden,
          sizes,
          current.positions
        ),
      };
    });
  };

  const stopResize = (event) => {
    if (resizeRef.current && resizeRef.current.pointerId === event.pointerId) {
      resizeRef.current = null;
    }
  };

  const getColumnSpan = size => Math.min(columns, Math.max(1, Math.round(size.w * columns / MAX_COLUMNS)));

  const getEmptyDropPosition = event => getDropPositionFromGrab({
    clientX: event.clientX,
    clientY: event.clientY,
    bounds: gridRef.current.getBoundingClientRect(),
    columns,
    grabOffset: dragOffsetRef.current,
    gap: GRID_GAP,
    rowUnit: ROW_UNIT,
  });

  const dropOnEmptySpace = event => {
    event.preventDefault();
    const fromId = event.dataTransfer.getData('text/plain') || draggedId;
    const item = items.find(candidate => candidate.id === fromId);
    if (!item) return;
    const size = layout.sizes[fromId] || getDefaultSize(item);
    const target = getEmptyDropPosition(event);
    setLayout(current => {
      const preferred = {
        col: clamp(target.col, 1, Math.max(1, MAX_COLUMNS - size.w + 1)),
        row: Math.max(1, target.row),
      };
      return {
        ...current,
        positions: placeTileAndDisplace(
          fromId,
          preferred,
          current.order,
          current.hidden,
          current.sizes,
          current.positions
        ),
      };
    });
    setDraggedId(null);
    setDropTarget(null);
  };

  const catalogueCategories = [...new Set(items.map(item => item.category || 'Metrics'))].sort((a, b) => a.localeCompare(b));
  const normalizedQuery = catalogueQuery.trim().toLowerCase();
  const catalogueItems = orderedItems.filter(item => {
    const category = item.category || 'Metrics';
    const matchesCategory = catalogueCategory === 'all' || category === catalogueCategory;
    const isAdded = !layout.hidden.includes(item.id);
    const matchesStatus = catalogueStatus === 'all'
      || (catalogueStatus === 'added' && isAdded)
      || (catalogueStatus === 'not-added' && !isAdded);
    const matchesQuery = !normalizedQuery || [item.label, item.description, category]
      .some(value => String(value || '').toLowerCase().includes(normalizedQuery));
    return matchesCategory && matchesStatus && matchesQuery;
  });
  const addedCount = items.filter(item => !layout.hidden.includes(item.id)).length;

  const updateSettingDraft = (key, value) => {
    setSettingDrafts(current => ({ ...current, [key]: value }));
  };

  const commitSettingDraft = (key, setting) => {
    const raw = settingDrafts[key];
    if (raw === undefined) return;
    const value = Number(raw);
    const valid = raw.trim() !== ''
      && Number.isFinite(value)
      && (setting.min === undefined || value >= Number(setting.min))
      && (setting.max === undefined || value <= Number(setting.max));
    setSettingDrafts(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (valid && typeof setting.onChange === 'function') setting.onChange(value);
  };


  return (
    <div className="space-y-3">
      {storageWarning && <p className="text-xs text-amber-600" role="alert">{storageWarning.message}</p>}
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
              <p className="text-xs text-text-tertiary mt-1">Add or remove tiles, drag them to reorder, and resize them directly on the grid. Use the arrow and size controls for precise keyboard- and touch-friendly adjustments.</p>
              <p className="text-xs text-text-secondary mt-2" aria-live="polite">{addedCount} of {items.length} tiles on dashboard · {catalogueItems.length} shown</p>
            </div>
            <button type="button" onClick={reset} className="text-xs text-text-secondary hover:text-text-primary underline">Reset layout</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-page p-3">
            <div className="flex flex-1 min-w-[220px] items-center gap-2">
              <select value={selectedStarter} onChange={event => setSelectedStarter(event.target.value)} aria-label="Starter dashboard layouts" className="min-w-0 flex-1 rounded-md border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary">
                <option value="">Choose a starter layout…</option>
                {STARTER_LAYOUTS.map(starter => <option key={starter.id} value={starter.id}>{starter.name}</option>)}
              </select>
              <button type="button" onClick={applyStarterLayout} disabled={!selectedStarter} className="rounded-md border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40">Use</button>
            </div>
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
              <button type="button" onClick={updateSelectedTemplate} disabled={!selectedTemplateHasChanges} title={selectedTemplateHasChanges ? 'Save the current dashboard over the selected template' : 'No unsaved changes to this template'} className="rounded-md border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40">Update</button>
              <button type="button" onClick={deleteTemplate} disabled={!selectedTemplate} className="rounded-md border border-border px-3 py-2 text-xs text-text-secondary disabled:opacity-40">Delete</button>
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary">Starter layouts are starting points. Your saved layouts remain separate and are never overwritten when you apply one.</p>
          <p className="text-[10px] text-text-tertiary">Saved layouts are stored in this browser. Saving an existing name replaces that template.</p>
          {selectedTemplate && (
            <p className="text-xs text-text-secondary" role="status" aria-live="polite">
              {selectedTemplateHasChanges
                ? <><span className="font-semibold text-amber-600">Unsaved changes</span> — the dashboard differs from “{selectedTemplate}”. Select Update to save the current arrangement to this template.</>
                : <>The current dashboard matches “{selectedTemplate}”.</>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={catalogueQuery}
              onChange={event => setCatalogueQuery(event.target.value)}
              placeholder="Search tiles…"
              aria-label="Search dashboard tiles"
              className="min-w-[180px] flex-1 rounded-md border border-border bg-bg-page px-3 py-2 text-xs text-text-primary"
            />
            <select
              value={catalogueCategory}
              onChange={event => setCatalogueCategory(event.target.value)}
              aria-label="Filter tiles by category"
              className="min-w-[150px] rounded-md border border-border bg-bg-page px-3 py-2 text-xs text-text-primary"
            >
              <option value="all">All categories</option>
              {catalogueCategories.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
            <select
              value={catalogueStatus}
              onChange={event => setCatalogueStatus(event.target.value)}
              aria-label="Filter tiles by dashboard status"
              className="min-w-[150px] rounded-md border border-border bg-bg-page px-3 py-2 text-xs text-text-primary"
            >
              <option value="all">All tiles</option>
              <option value="added">On dashboard</option>
              <option value="not-added">Not on dashboard</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {catalogueItems.map(item => {
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
            {catalogueItems.length === 0 && (
              <div className="sm:col-span-2 xl:col-span-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-secondary">
                No tiles match this search. Try another name or choose a different category.
              </div>
            )}
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
              ref={previewDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="dashboard-tile-preview-title"
              aria-describedby="dashboard-tile-preview-description"
              tabIndex={-1}
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl focus:outline-none"
              onMouseDown={event => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{item.category || 'Metrics'} · {size.w}×{size.h} grid units</div>
                  <h2 id="dashboard-tile-preview-title" className="text-lg font-semibold text-text-primary mt-1">{item.label}</h2>
                  <p id="dashboard-tile-preview-description" className="text-sm text-text-secondary mt-2">{item.description || 'A reusable dashboard component based on your selected trading data and period filters.'}</p>
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
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResize}
        onDragOver={editing ? event => {
          const targetTile = event.target.closest('[data-dashboard-tile]');
          if (!targetTile || targetTile.dataset.dashboardTile === draggedId) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        } : undefined}
        onDrop={editing ? event => {
          const targetTile = event.target.closest('[data-dashboard-tile]');
          if (!targetTile || targetTile.dataset.dashboardTile === draggedId) {
            dropOnEmptySpace(event);
          }
        } : undefined}
        className="grid items-stretch gap-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_UNIT - GRID_GAP}px`,
          gridAutoFlow: 'none',
          backgroundImage: editing ? 'linear-gradient(to right, rgba(148,163,184,0.11) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.11) 1px, transparent 1px)' : 'none',
          backgroundSize: editing ? `calc((100% + ${GRID_GAP}px) / ${columns}) ${ROW_UNIT}px` : undefined,
          backgroundPosition: '0 0',
        }}
      >
        {visibleItems.map((item, itemIndex) => {
          const size = layout.sizes[item.id] || getDefaultSize(item);
          return (
            <div
              key={item.id}
              data-dashboard-tile={item.id}
              draggable={editing}
              onDragStart={editing ? event => {
                if (event.target.closest && event.target.closest('button, details, input, select, textarea')) {
                  event.preventDefault();
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const size = layout.sizes[item.id] || getDefaultSize(item);
                dragOffsetRef.current = {
                  col: clamp(Math.floor((event.clientX - bounds.left) / Math.max(1, bounds.width) * size.w), 0, size.w - 1),
                  row: clamp(Math.floor((event.clientY - bounds.top) / Math.max(1, bounds.height) * size.h), 0, size.h - 1),
                };
                setDraggedId(item.id);
                setDropTarget(null);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.id);
              } : undefined}
              onDragOver={editing ? event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (!draggedId || draggedId === item.id) {
                  setDropTarget(null);
                  return;
                }
                const bounds = event.currentTarget.getBoundingClientRect();
                const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                setDropTarget(current => current && current.id === item.id && current.position === position
                  ? current
                  : { id: item.id, position });
              } : undefined}
              onDragLeave={editing ? event => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setDropTarget(current => current && current.id === item.id ? null : current);
                }
              } : undefined}
              onDrop={editing ? event => {
                event.preventDefault();
                event.stopPropagation();
                dropOnEmptySpace(event);
              } : undefined}
              onDragEnd={editing ? () => { setDraggedId(null); setDropTarget(null); } : undefined}
              className={`relative min-w-0 h-full [&>*]:h-full ${editing ? `rounded-xl outline outline-1 outline-dashed outline-accent cursor-grab ${draggedId === item.id ? 'opacity-35' : ''} ${dropTarget && dropTarget.id === item.id ? 'bg-accent/10' : ''}` : ''}`}
              style={{
                gridColumn: `${clamp(Math.floor(((layout.positions[item.id] || { col: 1 }).col - 1) * columns / MAX_COLUMNS) + 1, 1, Math.max(1, columns - getColumnSpan(size) + 1))} / span ${getColumnSpan(size)}`,
                gridRow: `${(layout.positions[item.id] || { row: 1 }).row} / span ${size.h}`,
              }}
            >
              {editing && dropTarget && dropTarget.id === item.id && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute z-40 left-1 right-1 ${dropTarget.position === 'before' ? 'top-0' : 'bottom-0'} h-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(99,102,241,0.18)]`}
                />
              )}
              {editing && (
                <div className="absolute z-20 top-2 right-2 flex items-center gap-1 rounded-md bg-bg-page/95 border border-border px-1.5 py-1 text-[10px] text-text-secondary">
                  <span className="select-none pointer-events-none">⠿ Move</span>
                  <button
                    type="button"
                    disabled={itemIndex === 0}
                    aria-label={`Move ${item.label} earlier`}
                    title="Move earlier"
                    onClick={() => {
                      const previous = visibleItems[itemIndex - 1];
                      if (previous) moveItem(item.id, previous.id, 'before');
                    }}
                    className="w-5 h-5 rounded hover:bg-bg-input disabled:opacity-30"
                  >↑</button>
                  <button
                    type="button"
                    disabled={itemIndex === visibleItems.length - 1}
                    aria-label={`Move ${item.label} later`}
                    title="Move later"
                    onClick={() => {
                      const next = visibleItems[itemIndex + 1];
                      if (next) moveItem(item.id, next.id, 'after');
                    }}
                    className="w-5 h-5 rounded hover:bg-bg-input disabled:opacity-30"
                  >↓</button>
                  {Array.isArray(item.settings) && item.settings.length > 0 && (
                    <details className="relative">
                      <summary className="list-none cursor-pointer w-6 h-5 rounded hover:bg-bg-input flex items-center justify-center text-xs" aria-label={`Configure ${item.label}`} title={`Configure ${item.label}`}>⚙</summary>
                      <div className="absolute right-0 top-7 z-50 w-64 max-w-[80vw] rounded-lg border border-border bg-bg-surface p-3 shadow-xl space-y-3 text-left normal-case tracking-normal">
                        <div className="text-xs font-semibold text-text-primary">{item.label} settings</div>
                        {item.settings.map(setting => (
                          <label key={setting.id} className="block space-y-1">
                            <span className="block text-xs text-text-secondary">{setting.label}</span>
                            {setting.description && <span className="block text-[10px] text-text-tertiary">{setting.description}</span>}
                            <input
                              type={setting.type || 'number'}
                              value={settingDrafts[item.id + ':' + setting.id] ?? setting.value}
                              min={setting.min}
                              max={setting.max}
                              step={setting.step || 'any'}
                              onFocus={() => updateSettingDraft(item.id + ':' + setting.id, String(setting.value))}
                              onChange={event => updateSettingDraft(item.id + ':' + setting.id, event.target.value)}
                              onBlur={() => commitSettingDraft(item.id + ':' + setting.id, setting)}
                              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                              className="w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                            />
                          </label>
                        ))}
                        <p className="text-[10px] text-text-tertiary">Press Enter or leave a field to apply its value.</p>
                      </div>
                    </details>
                  )}
                </div>
              )}
              {item.render()}
              {editing && [
                { corner: 'nw', style: { top: 4, left: 4 }, cursor: 'cursor-nwse-resize' },
                { corner: 'ne', style: { top: 4, right: 4 }, cursor: 'cursor-nesw-resize' },
                { corner: 'sw', style: { bottom: 4, left: 4 }, cursor: 'cursor-nesw-resize' },
                { corner: 'se', style: { bottom: 4, right: 4 }, cursor: 'cursor-nwse-resize' },
              ].map(handle => (
                <button
                  key={handle.corner}
                  type="button"
                  draggable={false}
                  data-dashboard-resize-handle={handle.corner}
                  aria-label={`Resize ${item.label} from ${handle.corner.toUpperCase()} corner`}
                  title={`Drag to resize from ${handle.corner.toUpperCase()} corner`}
                  onPointerDown={event => startResize(event, item, handle.corner)}
                                    className={`absolute z-30 appearance-none box-border rounded-sm border-[3px] border-accent bg-bg-page shadow-md p-0 ${handle.cursor} touch-none select-none`}
                  style={{ ...handle.style, width: 18, height: 18, minWidth: 18, minHeight: 18, flex: 'none' }}
                />
              ))}
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
