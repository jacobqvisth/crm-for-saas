'use client';

import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import { SlideOver } from '@/components/ui/slide-over';
import { COLUMNS, COLUMN_BY_ID, DEFAULT_COLUMN_IDS, type ColumnId } from './column-config';

interface ColumnCustomizerProps {
  open: boolean;
  onClose: () => void;
  visibleIds: ColumnId[];
  onChange: (next: ColumnId[]) => void;
}

export function ColumnCustomizer({ open, onClose, visibleIds, onChange }: ColumnCustomizerProps) {
  const visibleSet = new Set(visibleIds);
  const hiddenIds: ColumnId[] = COLUMNS.map((c) => c.id).filter((id) => !visibleSet.has(id));

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const next = [...visibleIds];
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    onChange(next);
  };

  const hide = (id: ColumnId) => onChange(visibleIds.filter((x) => x !== id));
  const show = (id: ColumnId) => onChange([...visibleIds, id]);

  return (
    <SlideOver open={open} onClose={onClose} title="Customize columns">
      <div className="space-y-6">
        <p className="text-xs text-slate-500">
          Drag to reorder visible columns. Click the eye to hide or show a column. Changes save automatically and apply to this browser only.
        </p>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Visible ({visibleIds.length})
          </h3>
          {visibleIds.length === 0 ? (
            <p className="text-xs italic text-slate-400 px-3 py-4 border border-dashed border-slate-200 rounded-lg">
              No columns visible — pick at least one below.
            </p>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="visible">
                {(provided) => (
                  <ul ref={provided.innerRef} {...provided.droppableProps} className="space-y-1">
                    {visibleIds.map((id, index) => {
                      const col = COLUMN_BY_ID[id];
                      if (!col) return null;
                      return (
                        <Draggable key={id} draggableId={id} index={index}>
                          {(p, snap) => (
                            <li
                              ref={p.innerRef}
                              {...p.draggableProps}
                              className={`flex items-center gap-2 px-2 py-1.5 bg-white border rounded-lg ${
                                snap.isDragging ? 'border-indigo-300 shadow-md' : 'border-slate-200'
                              }`}
                            >
                              <span
                                {...p.dragHandleProps}
                                className="text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
                                aria-label={`Reorder ${col.label}`}
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
                              <span className="flex-1 text-sm text-slate-800">{col.label}</span>
                              <button
                                type="button"
                                onClick={() => hide(id)}
                                className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
                                aria-label={`Hide ${col.label}`}
                                title="Hide column"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Hidden ({hiddenIds.length})
          </h3>
          {hiddenIds.length === 0 ? (
            <p className="text-xs italic text-slate-400">All columns are visible.</p>
          ) : (
            <ul className="space-y-1">
              {hiddenIds.map((id) => {
                const col = COLUMN_BY_ID[id];
                if (!col) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <span className="w-4 h-4" />
                    <span className="flex-1 text-sm text-slate-500">{col.label}</span>
                    <button
                      type="button"
                      onClick={() => show(id)}
                      className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-white"
                      aria-label={`Show ${col.label}`}
                      title="Show column"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_COLUMN_IDS)}
            className="text-xs text-indigo-600 hover:text-indigo-700"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
          >
            Done
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
