/**
 * Accessible modal shell for admin actions (S-ADMIN1).
 *
 * WCAG 2.2 AA: role="dialog" + aria-modal, labelled by its title, focus moves
 * into the dialog on open, Tab is trapped inside, Escape closes, and focus
 * returns to the element that opened it.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface AdminDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Red accent for irreversible actions. */
  danger?: boolean;
}

export const AdminDialog = ({ open, title, description, onClose, children, danger = false }: AdminDialogProps) => {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`relative glass rounded-2xl w-full max-w-lg p-6 space-y-4 border ${danger ? 'border-red-500/40' : 'border-white/10'}`}
      >
        <h2 id={titleId} className={`text-lg font-semibold ${danger ? 'text-red-300' : 'text-white'}`}>
          {title}
        </h2>
        {description && (
          <div id={descId} className="text-sm text-gray-300">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

/** Shared field styling for admin dialogs. */
export const ADMIN_FIELD_CLASS =
  'w-full px-3 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-500 border border-white/10 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800';

export const ADMIN_BUTTON_CLASS =
  'px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800';
