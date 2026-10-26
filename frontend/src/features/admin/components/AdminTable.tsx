/**
 * One table style for every admin list (UX-2).
 *
 * - Whole-row click opens the row's record. The first cell keeps a real link,
 *   so keyboard and screen-reader users get a normal link, and cmd/ctrl/middle
 *   click opens a new tab. Clicking a link, button or field inside the row, or
 *   finishing a text selection, does not navigate. A row click only ever
 *   navigates: it never runs an action.
 * - Columns resize by dragging the handle in the header, or by focusing the
 *   handle and pressing the arrow keys. Widths are remembered per browser
 *   (localStorage, best effort).
 * - Long values (emails) wrap instead of being cut off.
 */

import { useCallback, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export interface AdminColumn<T> {
  /** Stable id, used for remembered widths. */
  key: string;
  header: string;
  /** Visually hidden header (e.g. an actions column). */
  hideHeader?: boolean;
  cell: (row: T) => ReactNode;
  /** Starting width in px. Columns without one share the leftover space. */
  width?: number;
  minWidth?: number;
  className?: string;
}

interface AdminTableProps<T> {
  /** Names the table for screen readers and keys its remembered widths. */
  id: string;
  label: string;
  columns: ReadonlyArray<AdminColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  /** Where a row click goes. Omit for rows with no record page. */
  rowHref?: (row: T) => string | null;
  /** Extra content under a row (spans every column). */
  rowDetail?: (row: T) => ReactNode;
  testId?: string;
}

const MIN_WIDTH = 80;
const KEY_STEP = 16;
const STORAGE_PREFIX = 'am-admin-table:';

const readWidths = (id: string): Record<string, number> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
      ),
    );
  } catch {
    return {};
  }
};

const writeWidths = (id: string, widths: Record<string, number>) => {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(widths));
  } catch {
    // Private mode or storage blocked: widths just are not remembered.
  }
};

/** True when the click landed on something that has its own behaviour. */
const isInteractive = (target: EventTarget | null, row: HTMLElement): boolean => {
  let el = target instanceof Element ? target : null;
  while (el && el !== row) {
    if (el.matches('a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"]')) return true;
    el = el.parentElement;
  }
  return false;
};

const hasSelection = (): boolean => {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
};

export const AdminTable = <T,>({ id, label, columns, rows, rowKey, rowHref, rowDetail, testId }: AdminTableProps<T>) => {
  const navigate = useNavigate();
  const [widths, setWidths] = useState<Record<string, number>>(() => readWidths(id));

  const widthOf = (col: AdminColumn<T>): number | undefined => widths[col.key] ?? col.width;

  const setWidth = useCallback(
    (key: string, px: number, min: number) => {
      setWidths((prev) => {
        const next = { ...prev, [key]: Math.max(min, Math.round(px)) };
        writeWidths(id, next);
        return next;
      });
    },
    [id],
  );

  const startDrag = (col: AdminColumn<T>) => (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const startX = e.clientX;
    const startWidth = th?.getBoundingClientRect().width ?? widthOf(col) ?? 160;
    const min = col.minWidth ?? MIN_WIDTH;
    const onMove = (ev: globalThis.PointerEvent) => setWidth(col.key, startWidth + ev.clientX - startX, min);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onHandleKey = (col: AdminColumn<T>) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const th = e.currentTarget.parentElement;
    const current = widthOf(col) ?? th?.getBoundingClientRect().width ?? 160;
    setWidth(col.key, current + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP), col.minWidth ?? MIN_WIDTH);
  };

  const onRowClick = (href: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.button !== 0 || e.defaultPrevented) return;
    if (isInteractive(e.target, e.currentTarget) || hasSelection()) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    navigate(href);
  };

  const onRowAuxClick = (href: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.button !== 1 || isInteractive(e.target, e.currentTarget)) return;
    e.preventDefault();
    window.open(href, '_blank', 'noopener');
  };

  const anyWidth = columns.some((c) => widthOf(c) !== undefined);

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10" data-testid={testId}>
      <table aria-label={label} className={`w-full text-sm ${anyWidth ? 'table-fixed min-w-full' : ''}`}>
        <colgroup>
          {columns.map((c) => {
            const w = widthOf(c);
            return <col key={c.key} style={w ? { width: `${w}px` } : undefined} />;
          })}
        </colgroup>
        <thead className="bg-dark-700 text-gray-400">
          <tr>
            {columns.map((c, i) => (
              <th key={c.key} scope="col" className="relative text-left px-4 py-3 font-medium align-bottom">
                <span id={`${id}-col-${c.key}`} className={c.hideHeader ? 'sr-only' : undefined}>{c.header}</span>
                {i < columns.length - 1 && (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize column"
                    aria-describedby={`${id}-col-${c.key}`}
                    aria-valuenow={widthOf(c)}
                    aria-valuemin={c.minWidth ?? MIN_WIDTH}
                    tabIndex={0}
                    onPointerDown={startDrag(c)}
                    onKeyDown={onHandleKey(c)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`resize-${c.key}`}
                    className="absolute top-0 right-0 h-full w-3 cursor-col-resize touch-none select-none
                      after:absolute after:right-1 after:top-2 after:bottom-2 after:w-px after:bg-white/15
                      hover:after:bg-primary-400 focus:outline-none focus-visible:after:bg-primary-400
                      focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row) ?? null;
            const detail = rowDetail?.(row);
            return (
              <AdminTableRow
                key={rowKey(row)}
                href={href}
                onClick={href ? onRowClick(href) : undefined}
                onAuxClick={href ? onRowAuxClick(href) : undefined}
                cells={columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-top break-words [overflow-wrap:anywhere] ${c.className ?? 'text-gray-300'}`}>
                    {c.cell(row)}
                  </td>
                ))}
                detail={detail ? <td colSpan={columns.length} className="px-6 py-4">{detail}</td> : null}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const AdminTableRow = ({
  href, onClick, onAuxClick, cells, detail,
}: {
  href: string | null;
  onClick?: (e: MouseEvent<HTMLTableRowElement>) => void;
  onAuxClick?: (e: MouseEvent<HTMLTableRowElement>) => void;
  cells: ReactNode;
  detail: ReactNode;
}) => (
  <>
    <tr
      onClick={onClick}
      onAuxClick={onAuxClick}
      data-href={href ?? undefined}
      className={`border-t border-white/5 bg-dark-800 hover:bg-white/[0.04] focus-within:bg-white/[0.04] ${href ? 'cursor-pointer' : ''}`}
    >
      {cells}
    </tr>
    {detail && <tr className="bg-dark-700">{detail}</tr>}
  </>
);

/** An email (or any long value) that wraps, with the full text on hover. */
export const Wrap = ({ text, className }: { text: string; className?: string }) => (
  <span title={text} className={`break-all ${className ?? ''}`}>{text}</span>
);
