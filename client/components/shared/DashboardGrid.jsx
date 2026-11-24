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
  getResizedTileGeometry,
  normalizeLayout,
  readLayoutFromValue,
  createStarterLayout,
  STARTER_LAYOUTS,
} = require('../../utils/dashboardLayout');

const GRID_GAP = 16;
const ROW_UNIT = 128;

// Convert the saved eight-column layout into a collision-free layout for the
// narrower display grid. Saved positions remain untouched, so changing the
// browser width never rewrites the user's desktop arrangement.
const getResponsivePositions = (visibleItems, layout, columns) => {
  const entries = visibleItems.map((item, index) => {
    const size = layout.sizes[item.id] || getDefaultSize(item);
    const saved = layout.positions[item.id] || { col: 1, row: 1 };
    const width = Math.min(columns, Math.max(1, Math.round(size.w * columns / MAX_COLUMNS)));
    return {
      id: item.id,
      index,
      width,
      height: size.h,
      preferredCol: clamp(Math.floor((saved.col - 1) * columns / MAX_COLUMNS) + 1, 1, columns - width + 1),
      preferredRow: saved.row,
    };
  }).sort((a, b) => a.preferredRow - b.preferredRow || a.preferredCol - b.preferredCol || a.index - b.index);

  const placed = [];
  entries.forEach(entry => {
    let position = null;
    for (let row = entry.preferredRow; !position; row += 1) {
      const columnsToTry = [
        ...Array.from({ length: columns - entry.width - entry.preferredCol + 2 }, (_, i) => entry.preferredCol + i),
        ...Array.from({ length: entry.preferredCol - 1 }, (_, i) => i + 1),
      ];
      for (const col of columnsToTry) {
        const candidate = { col, row };
        if (!placed.some(other =>
          candidate.col < other.col + other.width
          && candidate.col + entry.width > other.col
          && candidate.row < other.row + other.height
          && candidate.row + entry.height > other.row
        )) {
          position = candidate;
          break;
        }
      }
    }
    placed.push({ id: entry.id, ...position, width: entry.width, height: entry.height });
  });

  return Object.fromEntries(placed.map(({ id, col, row, width }) => [id, { col, row, width }]));
};

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

const makeDashboardId = () => 'dashboard-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const cloneLayout = value => JSON.parse(JSON.stringify(value));
const readDashboardCollection = (storageKey, defaultOrder, defaultVisible, items) => {
  const base = readLayout(storageKey, defaultOrder, defaultVisible, items);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey + '_dashboards') || 'null');
    if (saved && Array.isArray(saved.items) && saved.items.length) return saved.items.map(d => ({...d, layout: readLayoutFromValue(d.layout, defaultOrder, defaultVisible, items)}));
  } catch {}
  const migrated = [{id: makeDashboardId(), name: 'My Dashboard', layout: base}];
  readTemplates(storageKey).forEach(t => migrated.push({id: makeDashboardId(), name: t.name, layout: readLayoutFromValue(t.layout, defaultOrder, defaultVisible, items)}));
  return migrated;
}

const DashboardGrid = ({ storageKey, items, defaultOrder, defaultVisible = defaultOrder }) => {
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const [dashboards, setDashboards] = useState(() => readDashboardCollection(storageKey, defaultOrder, defaultVisible, items));
  const [activeDashboardId, setActiveDashboardId] = useState(() => { try { return localStorage.getItem(storageKey + '_active_dashboard'); } catch { return null; } });
  const [layout, setLayout] = useState(() => { const ds = readDashboardCollection(storageKey, defaultOrder, defaultVisible, items); return (ds.find(d => d.id === (localStorage.getItem(storageKey + '_active_dashboard'))) || ds[0]).layout; });
  const [editing, setEditing] = useState(false);
  const [dashboardMenuOpen, setDashboardMenuOpen] = useState(false);
  const [actionMenuId, setActionMenuId] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState('starter');
  const [newStarter, setNewStarter] = useState('trading-overview');
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [columns, setColumns] = useState(2);
  const [addPickerPosition, setAddPickerPosition] = useState(null);
  const [addPickerQuery, setAddPickerQuery] = useState('');
  const [hoveredEmptyCell, setHoveredEmptyCell] = useState(null);
  const [storageWarning, setStorageWarning] = useState(null);
  const [dashboardReady, setDashboardReady] = useState(false);
  const [dashboardLoadError, setDashboardLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const saveQueueRef = useRef(Promise.resolve());
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueCategory, setCatalogueCategory] = useState('all');
  const [catalogueStatus, setCatalogueStatus] = useState('all');
  const [settingDrafts, setSettingDrafts] = useState({});
  const gridRef = useRef(null);
  const resizeRef = useRef(null);
  const dragOffsetRef = useRef({ col: 0, row: 0 });
  const previewDialogRef = useRef(null);
  const dashboardMenuRef = useRef(null);

  useEffect(() => {
    if (!dashboardMenuOpen) return undefined;
    const closeOnOutsidePointer = event => {
      if (dashboardMenuRef.current && !dashboardMenuRef.current.contains(event.target)) {
        setDashboardMenuOpen(false);
        setActionMenuId(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [dashboardMenuOpen]);

  useEffect(() => {
    if (!addPickerPosition) return undefined;
    const previouslyFocused = document.activeElement;
    const dialog = previewDialogRef.current;
    if (dialog) dialog.focus();

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAddPickerPosition(null);
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
  }, [addPickerPosition]);

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
    let cancelled = false;
    setDashboardReady(false);
    setDashboardLoadError(null);
    const load = async () => {
      try {
        const response = await fetch('/api/dashboards?key=' + encodeURIComponent(storageKey), { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('The server could not load dashboard settings.');
        const result = await response.json();
        if (cancelled) return;
        let collection = result.collection;
        if (!collection || !Array.isArray(collection.items) || collection.items.length === 0) {
          const localItems = readDashboardCollection(storageKey, defaultOrder, defaultVisible, items);
          let localActive = null;
          try { localActive = localStorage.getItem(storageKey + '_active_dashboard'); } catch {}
          const active = localItems.find(d => d.id === localActive) || localItems[0];
          collection = { version: 1, items: localItems, activeDashboardId: active.id };
          const save = await fetch('/api/dashboards', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: storageKey, collection }),
          });
          if (!save.ok) throw new Error('Your existing dashboards could not be migrated to the server. Your browser copy has been kept.');
        }
        if (cancelled) return;
        const normalized = collection.items.map(d => ({
          ...d,
          layout: readLayoutFromValue(d.layout, defaultOrder, defaultVisible, items),
        }));
        const active = normalized.find(d => d.id === collection.activeDashboardId) || normalized[0];
        setDashboards(normalized);
        setActiveDashboardId(active.id);
        setLayout(active.layout);
        try {
          localStorage.setItem(storageKey + '_dashboards', JSON.stringify({ version: 1, items: normalized }));
          localStorage.setItem(storageKey + '_active_dashboard', active.id);
        } catch {}
        setDashboardLoadError(null);
        setDashboardReady(true);
      } catch (error) {
        if (cancelled) return;
        setDashboardLoadError(error?.message || 'Could not connect to the RR Metrics server.');
      }
    };
    load();
    return () => { cancelled = true; };
  }, [storageKey, ids.join('|'), loadAttempt]);

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
    setDashboards(current => current.map(d => d.id === activeDashboardId ? {...d, layout} : d));
  }, [layout, activeDashboardId]);

  useEffect(() => {
    if (!dashboardReady || !activeDashboardId || dashboards.length === 0) return;
    const collection = { version: 1, items: dashboards, activeDashboardId };
    persistValue(storageKey + '_dashboards', { version: 1, items: dashboards });
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(async () => {
      const response = await fetch('/api/dashboards', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: storageKey, collection }),
      });
      if (!response.ok) {
        let message = 'Dashboard changes could not be saved to the server.';
        try { const result = await response.json(); if (result.error) message = result.error; } catch {}
        throw new Error(message);
      }
      setStorageWarning(current => current?.key === 'server' ? null : current);
    }).catch(error => {
      setStorageWarning({ key: 'server', message: (error?.message || 'Dashboard changes could not be saved.') + ' Your browser copy is retained, but changes will not appear on other computers until the server save succeeds.' });
    });
  }, [storageKey, dashboards, activeDashboardId, dashboardReady]);

  useEffect(() => {
    if (activeDashboardId) { try { localStorage.setItem(storageKey + '_active_dashboard', activeDashboardId); } catch {} }
  }, [storageKey, activeDashboardId]);

  if (!dashboardReady) return <div className="rounded-xl border border-border bg-bg-surface p-5 text-sm text-text-secondary" role="status">{dashboardLoadError ? <><p>{dashboardLoadError}</p><button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="mt-3 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-text">Retry connection</button></> : 'Loading dashboards from RR Metrics…'}</div>;

  const orderedItems = layout.order
    .map(id => items.find(item => item.id === id))
    .filter(Boolean);
  const visibleItems = orderedItems.filter(item => !layout.hidden.includes(item.id));
  const renderSettingsControl = item => {
    if (!Array.isArray(item.settings) || item.settings.length === 0) return null;
    return (
      <details className="relative">
        <summary className="dashboard-tile-icon-button list-none cursor-pointer" aria-label={`Configure ${item.label}`} title={`Configure ${item.label}`}>⚙</summary>
        <div className="absolute right-0 top-9 z-50 w-64 max-w-[80vw] rounded-lg border border-border bg-bg-surface p-3 shadow-xl space-y-3 text-left normal-case tracking-normal">
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
                onBlur={event => commitSettingDraft(item.id + ':' + setting.id, setting)}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                className="w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            </label>
          ))}
          <p className="text-[10px] text-text-tertiary">Press Enter or leave a field to apply its value.</p>
        </div>
      </details>
    );
  };


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
  };

  const removeItem = id => {
    setLayout(current => {
      const hidden = current.hidden.includes(id) ? current.hidden : current.hidden.concat(id);
      return { ...current, hidden };
    });
  };

  const addItemAtPosition = id => {
    if (!addPickerPosition) return;
    const item = items.find(candidate => candidate.id === id);
    if (!item) return;
    const size = layout.sizes[id] || getDefaultSize(item);
    setLayout(current => {
      const hidden = current.hidden.filter(value => value !== id);
      const sizes = { ...current.sizes, [id]: size };
      return {
        ...current,
        hidden,
        positions: placeTileAndDisplace(id, addPickerPosition, current.order, hidden, sizes, current.positions),
      };
    });
    setAddPickerPosition(null);
    setAddPickerQuery('');
  };

  const activeDashboard = dashboards.find(d => d.id === activeDashboardId) || dashboards[0];
  const switchDashboard = dashboard => { setLayout(dashboard.layout); setActiveDashboardId(dashboard.id); setEditing(false); setDashboardMenuOpen(false); setActionMenuId(null); };
  const saveRename = () => { const name = renameValue.trim(); if (!name || !renameId) return; setDashboards(ds => ds.map(d => d.id === renameId ? {...d, name} : d)); setRenameId(null); setRenameValue(''); };
  const createDashboard = () => {
    const name = newName.trim(); if (!name) return;
    const starter = STARTER_LAYOUTS.find(x => x.id === newStarter) || STARTER_LAYOUTS[0];
    const nextLayout = newMode === 'blank' ? readLayoutFromValue({order: defaultOrder, hidden: defaultOrder, sizes: {}, positions: {}}, defaultOrder, [], items) : newMode === 'copy' ? cloneLayout(layout) : createStarterLayout(starter, items, layout.order);
    const d = {id: makeDashboardId(), name, layout: nextLayout};
    setDashboards(ds => [...ds, d]); setActiveDashboardId(d.id); setLayout(nextLayout); setEditing(false); setCreateOpen(false); setDashboardMenuOpen(false); setNewName(''); setNewMode('starter');
  };
  const confirmDelete = () => { if (!deleteId || dashboards.length < 2) return; const ds = dashboards.filter(d => d.id !== deleteId); setDashboards(ds); if (deleteId === activeDashboardId) { setActiveDashboardId(ds[0].id); setLayout(ds[0].layout); setEditing(false); } setDeleteId(null); };
  const startResize = (event, item, corner) => {
    event.preventDefault();
    event.stopPropagation();
    const currentSize = layout.sizes[item.id] || getDefaultSize(item);
    const currentPosition = layout.positions[item.id] || { col: 1, row: 1 };
    const tileElement = event.currentTarget.closest('[data-dashboard-tile]');
    // Prevent the tile's native HTML drag operation from competing with resizing.
    if (tileElement) tileElement.draggable = false;

    const doc = event.currentTarget.ownerDocument;
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
      tileElement,
      doc,
    };
    // Capture at document level so the drag cannot be swallowed by the
    // draggable tile or by another tile crossed during the resize.
    doc.addEventListener('pointermove', moveResize, true);
    doc.addEventListener('pointerup', stopResize, true);
    doc.addEventListener('pointercancel', stopResize, true);
  };

  const moveResize = (event) => {
    const start = resizeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const item = items.find(candidate => candidate.id === start.id);
    if (!item) return;
    const minW = Number(item.minColumns) || 1;
    const minH = Number(item.minRows) || 1;
    const minArea = Number(item.minArea) || 1;
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
      minArea,
      maxW,
      maxH: Number(item.maxRows) || MAX_ROWS,
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
    const active = resizeRef.current;
    if (!active || (event.pointerId !== undefined && active.pointerId !== event.pointerId)) return;
    active.doc.removeEventListener('pointermove', moveResize, true);
    active.doc.removeEventListener('pointerup', stopResize, true);
    active.doc.removeEventListener('pointercancel', stopResize, true);
    if (active.tileElement) active.tileElement.draggable = true;
    resizeRef.current = null;
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


  const responsivePositions = getResponsivePositions(visibleItems, layout, columns);
  const lastOccupiedRow = visibleItems.reduce((lastRow, item) => {
    const position = responsivePositions[item.id] || { row: 1 };
    const size = layout.sizes[item.id] || getDefaultSize(item);
    return Math.max(lastRow, position.row + size.h - 1);
  }, 0);
  // Keep spare rows available while editing, but collapse unused space in view mode.
  const gridRowCount = lastOccupiedRow + (editing ? 2 : 0);

  return (
    <div className="space-y-3">
      {storageWarning && <p className="text-xs text-amber-600" role="alert">{storageWarning.message}</p>}
      <div className="flex items-center justify-between gap-3">
        {editing && <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-text">Done editing</button>}
        <div ref={dashboardMenuRef} className="relative ml-auto">
          <button type="button" aria-haspopup="true" aria-expanded={dashboardMenuOpen} onClick={() => setDashboardMenuOpen(v => !v)} className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary hover:border-accent">
            {activeDashboard ? activeDashboard.name : "Dashboard"} <span className="text-text-tertiary">▾</span>
          </button>
          {dashboardMenuOpen && <div className="absolute right-0 top-full z-[90] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-bg-surface p-2 shadow-2xl">
            <div className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Your dashboards</div>
            {dashboards.map(d => <div key={d.id} className={"flex items-center gap-2 rounded-lg px-2 py-2 " + (d.id === activeDashboardId ? "bg-bg-input" : "hover:bg-bg-input/70")}>
              <button type="button" onClick={() => switchDashboard(d)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-text-primary">{d.name}</span>{d.id === activeDashboardId && <span className="text-[10px] text-accent">Currently active</span>}</button>
              <div className="relative"><button type="button" aria-label={"Actions for " + d.name} onClick={() => setActionMenuId(v => v === d.id ? null : d.id)} className="rounded-md px-2 py-1 text-lg text-text-secondary hover:bg-bg-page">•••</button>
                {actionMenuId === d.id && <div className="absolute right-0 top-full z-[95] mt-1 w-44 rounded-lg border border-border bg-bg-page p-1 shadow-xl">
                  <button type="button" onClick={() => {setRenameId(d.id); setRenameValue(d.name); setActionMenuId(null);}} className="block w-full rounded-md px-3 py-2 text-left text-xs text-text-primary hover:bg-bg-input">Rename dashboard</button>
                  <button type="button" onClick={() => {switchDashboard(d); setEditing(true);}} className="block w-full rounded-md px-3 py-2 text-left text-xs text-text-primary hover:bg-bg-input">Edit tiles</button>
                  <button type="button" disabled={dashboards.length < 2} onClick={() => {setDeleteId(d.id); setActionMenuId(null);}} className="block w-full rounded-md px-3 py-2 text-left text-xs text-red-500 hover:bg-bg-input disabled:opacity-40">Delete dashboard</button>
                </div>}
              </div>
            </div>)}
            <div className="my-2 border-t border-border" />
            <button type="button" onClick={() => {setCreateOpen(true); setDashboardMenuOpen(false);}} className="w-full rounded-lg bg-accent px-3 py-3 text-sm font-semibold text-accent-text">＋ Create new dashboard</button>
          </div>}
        </div>
      </div>
      {editing && <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-surface p-3"><p className="text-xs text-text-secondary">Drag, resize, add or remove tiles to customise this dashboard.</p><button type="button" onClick={reset} className="text-xs text-text-secondary underline">Reset layout</button></div>}
      {renameId && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4"><div role="dialog" aria-modal="true" aria-label="Rename dashboard" className="w-full max-w-sm rounded-xl border border-border bg-bg-surface p-5 shadow-2xl"><h2 className="text-base font-semibold text-text-primary">Rename dashboard</h2><input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => {if(e.key==="Enter")saveRename(); if(e.key==="Escape")setRenameId(null);}} className="mt-4 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary" maxLength={48}/><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRenameId(null)} className="rounded-lg border border-border px-3 py-2 text-xs">Cancel</button><button type="button" disabled={!renameValue.trim()} onClick={saveRename} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-text disabled:opacity-40">Save name</button></div></div></div>}
      {deleteId && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4"><div role="dialog" aria-modal="true" aria-label="Delete dashboard" className="w-full max-w-sm rounded-xl border border-border bg-bg-surface p-5 shadow-2xl"><h2 className="text-base font-semibold text-text-primary">Delete dashboard?</h2><p className="mt-2 text-sm text-text-secondary">This will permanently delete “{dashboards.find(d => d.id === deleteId)?.name}”.</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDeleteId(null)} className="rounded-lg border border-border px-3 py-2 text-xs">Cancel</button><button type="button" onClick={confirmDelete} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white">Delete dashboard</button></div></div></div>}
      {createOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4"><div role="dialog" aria-modal="true" aria-label="Create dashboard" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-bg-surface p-5 shadow-2xl"><h2 className="text-lg font-semibold text-text-primary">Create new dashboard</h2><label className="mt-4 block text-xs text-text-secondary">Dashboard name</label><input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. My trading dashboard" maxLength={48} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary"/>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{[["starter","Starter layout"],["blank","Blank"],["copy","Copy current"]].map(([id,label]) => <button key={id} type="button" onClick={() => setNewMode(id)} className={"rounded-lg border p-3 text-left text-sm " + (newMode===id ? "border-accent bg-accent/10" : "border-border")}>{label}</button>)}</div>
        {newMode === "starter" && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{STARTER_LAYOUTS.map(st => <button key={st.id} type="button" onClick={() => setNewStarter(st.id)} className={"rounded-lg border p-3 text-left " + (newStarter===st.id ? "border-accent bg-accent/10" : "border-border")}><span className="block text-sm font-semibold text-text-primary">{st.name}</span><span className="mt-1 block text-xs text-text-secondary">{st.description}</span></button>)}</div>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border border-border px-3 py-2 text-xs">Cancel</button><button type="button" disabled={!newName.trim()} onClick={createDashboard} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-text disabled:opacity-40">Create dashboard</button></div></div></div>}

      <div
        ref={gridRef}
        onMouseMove={editing ? event => {
          if (event.target.closest('[data-dashboard-tile]')) {
            setHoveredEmptyCell(null);
            return;
          }
          const target = getDropPositionFromGrab({
            clientX: event.clientX,
            clientY: event.clientY,
            bounds: gridRef.current.getBoundingClientRect(),
            columns,
            grabOffset: { col: 0, row: 0 },
            gap: GRID_GAP,
            rowUnit: ROW_UNIT,
          });
          const occupied = visibleItems.some(item => {
            const position = layout.positions[item.id] || { col: 1, row: 1 };
            const size = layout.sizes[item.id] || getDefaultSize(item);
            return target.col >= position.col && target.col < position.col + size.w
              && target.row >= position.row && target.row < position.row + size.h;
          });
          setHoveredEmptyCell(occupied ? null : { ...target, visualCol: clamp(Math.floor((event.clientX - gridRef.current.getBoundingClientRect().left) / (((gridRef.current.clientWidth - GRID_GAP * (columns - 1)) / columns) + GRID_GAP)), 0, columns - 1) });
        } : undefined}
        onMouseLeave={() => setHoveredEmptyCell(null)}
        onClick={editing && hoveredEmptyCell ? event => {
          if (event.target.closest('[data-dashboard-tile]')) return;
          event.stopPropagation();
          setAddPickerPosition({ col: hoveredEmptyCell.col, row: hoveredEmptyCell.row });
        } : undefined}
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
        className="relative grid items-stretch gap-4"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridRowCount}, ${ROW_UNIT - GRID_GAP}px)`,
          gridAutoRows: `${ROW_UNIT - GRID_GAP}px`,
          gridAutoFlow: 'none',
          backgroundImage: editing ? 'linear-gradient(to right, rgba(148,163,184,0.11) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.11) 1px, transparent 1px)' : 'none',
          backgroundSize: editing ? `calc((100% + ${GRID_GAP}px) / ${columns}) ${ROW_UNIT}px` : undefined,
          backgroundPosition: '0 0',
        }}
      >
        {editing && hoveredEmptyCell && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); setAddPickerPosition({ col: hoveredEmptyCell.col, row: hoveredEmptyCell.row }); }}
            style={{ gridColumn: `${hoveredEmptyCell.visualCol + 1} / span 1`, gridRow: hoveredEmptyCell.row }}
            className="z-10 flex min-h-[112px] items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 px-3 text-center text-sm font-semibold text-accent opacity-90 hover:bg-accent/20"
          >
            + Click to add a tile
          </button>
        )}
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
                gridColumn: `${(responsivePositions[item.id] || { col: 1, width: getColumnSpan(size) }).col} / span ${(responsivePositions[item.id] || { width: getColumnSpan(size) }).width}`,
                gridRow: `${(responsivePositions[item.id] || { row: 1 }).row} / span ${size.h}`,
              }}
            >
              {editing && dropTarget && dropTarget.id === item.id && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute z-40 left-1 right-1 ${dropTarget.position === 'before' ? 'top-0' : 'bottom-0'} h-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(99,102,241,0.18)]`}
                />
              )}
              {editing && (
                <div className="absolute z-40 top-3 right-3">
                  <button
                    type="button"
                    aria-label={`Remove ${item.label} from dashboard`}
                    title="Remove tile"
                    onClick={() => removeItem(item.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/70 bg-accent/15 text-base font-semibold leading-none text-accent shadow-sm transition-colors hover:border-accent hover:bg-accent/30 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                  ><span className="inline-block -translate-y-px leading-none">×</span></button>
                </div>
              )}
              {item.render({ settingsControl: renderSettingsControl(item) })}
              {editing && [
                { corner: 'nw', style: { top: -6, left: -6 }, cursor: 'cursor-nwse-resize' },
                { corner: 'ne', style: { top: -6, right: -6 }, cursor: 'cursor-nesw-resize' },
                { corner: 'sw', style: { bottom: -6, left: -6 }, cursor: 'cursor-nesw-resize' },
                { corner: 'se', style: { bottom: -6, right: -6 }, cursor: 'cursor-nwse-resize' },
              ].map(handle => (
                <button
                  key={handle.corner}
                  type="button"
                  draggable={false}
                  data-dashboard-resize-handle={handle.corner}
                  aria-label={`Resize ${item.label} from ${handle.corner.toUpperCase()} corner`}
                  title={`Drag to resize from ${handle.corner.toUpperCase()} corner`}
                  onPointerDown={event => startResize(event, item, handle.corner)}
                  className={`dashboard-resize-handle dashboard-resize-handle-${handle.corner} absolute z-30 box-border appearance-none border-0 bg-transparent p-0 text-accent ${handle.cursor} touch-none select-none`}
                  style={{ ...handle.style, width: 28, height: 28, minWidth: 28, minHeight: 28, flex: "none" }}
                />
              ))}
            </div>
          );
        })}
      </div>

      {editing && addPickerPosition && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAddPickerPosition(null); }}>
          <div ref={previewDialogRef} role="dialog" aria-modal="true" aria-labelledby="dashboard-add-tile-title" tabIndex={-1} onMouseDown={event => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl focus:outline-none">
            <div className="flex items-center justify-between gap-4 border-b border-border p-5">
              <div>
                <h2 id="dashboard-add-tile-title" className="text-lg font-semibold text-text-primary">Add a dashboard tile</h2>
                <p className="mt-1 text-sm text-text-secondary">Choose a tile that is not already on your dashboard.</p>
              </div>
              <button type="button" onClick={() => setAddPickerPosition(null)} aria-label="Close tile picker" className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="border-b border-border p-4">
              <input autoFocus type="search" value={addPickerQuery} onChange={event => setAddPickerQuery(event.target.value)} placeholder="Search available tiles…" aria-label="Search available tiles" className="w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary" />
            </div>
            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
              {items.filter(item => layout.hidden.includes(item.id) && [item.label, item.description, item.category].some(value => String(value || '').toLowerCase().includes(addPickerQuery.trim().toLowerCase()))).map(item => (
                <div key={item.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-bg-page p-3 transition-colors hover:border-accent">
                  <div className="flex min-h-[190px] items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-surface p-3 [&>*]:max-w-full">
                    {item.preview || <div className="flex h-40 w-full items-center justify-center text-sm text-text-tertiary">{item.label}</div>}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-text-primary">{item.label}</h3>
                      <p className="mt-1 text-xs text-text-tertiary">{item.category || 'Metrics'}</p>
                    </div>
                    <button type="button" onClick={() => addItemAtPosition(item.id)} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-text">Add tile</button>
                  </div>
                </div>
              ))}
              {items.filter(item => layout.hidden.includes(item.id) && [item.label, item.description, item.category].some(value => String(value || '').toLowerCase().includes(addPickerQuery.trim().toLowerCase()))).length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">All available tiles have been added, or no tiles match your search.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {visibleItems.length === 0 && !editing && (
        <div className="bg-bg-surface border border-border rounded-xl p-6 text-center text-sm text-text-secondary">No dashboard tiles selected.</div>
      )}
    </div>
  );
};

module.exports = DashboardGrid;
