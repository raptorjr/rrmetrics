const React = require('react');
const { useEffect, useMemo, useState } = React;

const readLayout = (storageKey, defaults, defaultVisible, availableIds) => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) return { order: defaults, hidden: defaults.filter(id => !defaultVisible.includes(id)) };
    const valid = new Set(availableIds);
    const newIds = defaults.filter(id => !saved.order.includes(id));
    const order = [...saved.order.filter(id => valid.has(id)), ...newIds];
    return { order, hidden: [...saved.hidden.filter(id => valid.has(id)), ...newIds] };
  } catch {
    return { order: defaults, hidden: [] };
  }
};

const CustomizableStats = ({ storageKey, items, defaultOrder, defaultVisible = defaultOrder, gridClassName = 'grid grid-cols-2 md:grid-cols-4 gap-4' }) => {
  const ids = useMemo(() => items.map(item => item.id), [items]);
  const [layout, setLayout] = useState(() => readLayout(storageKey, defaultOrder, defaultVisible, ids));
  const [editing, setEditing] = useState(false);
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    setLayout(readLayout(storageKey, defaultOrder, defaultVisible, ids));
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
        : [...current.hidden, id],
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

  const reset = () => setLayout({ order: defaultOrder, hidden: defaultOrder.filter(id => !defaultVisible.includes(id)) });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setEditing(value => !value)}
          className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${editing ? 'bg-accent text-accent-text border-accent' : 'bg-bg-surface border-border text-text-secondary hover:text-text-primary hover:border-accent'}`}
        >
          <span>{editing ? 'Done' : 'Edit tiles'}</span>
        </button>
      </div>

      {editing && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Customize metrics</h3>
              <p className="text-xs text-text-tertiary mt-1">Choose from all available metrics, then drag the tiles into your preferred order.</p>
            </div>
            <button type="button" onClick={reset} className="text-xs text-text-secondary hover:text-text-primary underline">Reset to default</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {orderedItems.map(item => (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDraggedId(item.id)}
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); moveItem(draggedId, item.id); setDraggedId(null); }}
                onDragEnd={() => setDraggedId(null)}
                className={`rounded-lg border p-2.5 transition-colors ${draggedId === item.id ? 'border-accent opacity-50' : 'border-border hover:border-accent/60'}`}
              >
                {item.preview || <div className="h-[82px] rounded-md bg-bg-page border border-border flex items-center justify-center text-xs text-text-tertiary">{item.label}</div>}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-text-tertiary cursor-grab select-none" title="Drag to reorder">⠿</span>
                  <label className="flex-1 flex items-center gap-2 min-w-0 cursor-pointer">
                    <input type="checkbox" checked={!layout.hidden.includes(item.id)} onChange={() => toggleItem(item.id)} className="accent-[rgb(var(--accent))]" />
                    <span className="text-xs text-text-primary truncate">{item.label}</span>
                  </label>
                  <span className="text-[10px] text-text-tertiary">{item.defaultColumns || 1}×{item.defaultRows || 1}</span>
                </div>
                <div className="text-[10px] text-text-tertiary ml-6 mt-0.5">{item.category || 'Metrics'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={gridClassName}>
        {visibleItems.map(item => (
          <div
            key={item.id}
            draggable={editing}
            onDragStart={editing ? () => setDraggedId(item.id) : undefined}
            onDragOver={editing ? event => event.preventDefault() : undefined}
            onDrop={editing ? event => { event.preventDefault(); moveItem(draggedId, item.id); setDraggedId(null); } : undefined}
            onDragEnd={editing ? () => setDraggedId(null) : undefined}
            className={editing ? `relative rounded-xl outline outline-1 outline-dashed outline-accent cursor-grab ${draggedId === item.id ? 'opacity-50' : ''}` : ''}
          >
            {editing && <span className="absolute z-10 top-1 right-1 rounded bg-bg-page/90 px-1.5 py-0.5 text-[10px] text-text-secondary pointer-events-none">⠿ Move</span>}
            {item.render()}
          </div>
        ))}
      </div>
      {visibleItems.length === 0 && (
        <div className="bg-bg-surface border border-border rounded-xl p-6 text-center text-sm text-text-secondary">No metric tiles selected. Choose Edit tiles to add some.</div>
      )}
    </div>
  );
};

module.exports = CustomizableStats;
