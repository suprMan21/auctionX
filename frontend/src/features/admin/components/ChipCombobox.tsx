/**
 * Admin console UX-2: pick the replacement chip by typing its name or the end
 * of its serial (WAI-ARIA combobox, list autocomplete).
 *
 * Choosing an option only reports the chip id to the dialog. It never calls
 * the API, and Enter selects the highlighted option without submitting
 * anything: the dialog's typed reason, typed confirmation and Confirm button
 * stay the only way to act.
 *
 * The list renders inline (not floating) so it never covers the reason or
 * confirmation fields, and works at 375px.
 */

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { chipLabel, type AdminTag } from '../api/adminApi';
import { ADMIN_FIELD_CLASS } from './AdminDialog';
import { formatDay } from '../lib/display';

/** Case-insensitive match on the chip name, serial suffix, UID suffix or full label. */
const chipMatches = (chip: AdminTag, query: string): boolean => {
  const q = query.trim().toLowerCase().replace(/^…/, '');
  if (!q) return true;
  return [chip.chipName, chip.serialSuffix, chip.uidSuffix, chipLabel(chip)]
    .some((s) => (s ?? '').toLowerCase().includes(q));
};

interface ChipComboboxProps {
  candidates: AdminTag[] | null;
  loadError: string | null;
  /** The selected chip id, '' for none. */
  value: string;
  onChange: (id: string) => void;
}

export const ChipCombobox = ({ candidates, loadError, value, onChange }: ChipComboboxProps) => {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const options = useMemo(() => (candidates ?? []).filter((c) => chipMatches(c, query)), [candidates, query]);
  const selected = candidates?.find((c) => c.id === value) ?? null;
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const expanded = open && candidates !== null && candidates.length > 0;

  const choose = (chip: AdminTag) => {
    onChange(chip.id);
    setQuery(chip.chipName ?? chipLabel(chip));
    setOpen(false);
    setActive(-1);
  };

  const onType = (text: string) => {
    setQuery(text);
    setOpen(true);
    setActive(-1);
    // Editing the text drops an earlier choice, so a stale chip is never kept.
    if (value) onChange('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) { setOpen(true); setActive(options.length ? 0 : -1); return; }
        setActive((i) => (options.length ? (i + 1) % options.length : -1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) { setOpen(true); setActive(options.length ? options.length - 1 : -1); return; }
        setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1));
        return;
      case 'Enter': {
        // Never submits: Enter only picks the highlighted (or the only) match.
        e.preventDefault();
        e.stopPropagation();
        if (!expanded) return;
        const pick = active >= 0 ? options[active] : options.length === 1 ? options[0] : undefined;
        if (pick) choose(pick);
        return;
      }
      case 'Escape':
        // First Escape closes the list; the dialog's own Escape handler runs only when it is already closed.
        if (expanded) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActive(-1);
        }
        return;
      default:
    }
  };

  const statusText = loadError
    ? null
    : candidates === null
      ? 'Loading available chips…'
      : candidates.length === 0
        ? 'No blank chips are ready. Set up a new chip with the encoder first.'
        : null;

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-200">
        Replacement chip (set up, not yet claimed)
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 && active < options.length ? optionId(active) : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a chip name or serial ending"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onKeyDown={onKeyDown}
        className={`${ADMIN_FIELD_CLASS} min-h-[44px]`}
      />
      <p id={hintId} className="text-xs text-gray-400">
        {selected
          ? <>Chosen: <span className="text-gray-200">{chipLabel(selected)}</span></>
          : 'Type a chip name (chip_005) or the end of its serial number, then choose it from the list.'}
      </p>
      {loadError && <p role="alert" className="text-sm text-red-400">{loadError}</p>}
      {statusText && (
        <p role="status" className={`text-sm ${candidates?.length === 0 ? 'text-amber-300' : 'text-gray-400'}`}>{statusText}</p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Available chips"
        hidden={!expanded}
        className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-dark-800 py-1"
      >
        {options.map((c, i) => (
          <li
            key={c.id}
            id={optionId(i)}
            role="option"
            aria-selected={c.id === value}
            // Keep focus in the input so the click does not blur and close the list first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(c)}
            className={`flex min-h-[44px] cursor-pointer items-center px-3 py-2 text-sm ${
              i === active ? 'bg-primary-600 text-white' : 'text-gray-200 hover:bg-dark-700'
            }`}
          >
            {chipLabel(c)} <span className={`ml-1 ${i === active ? 'text-white' : 'text-gray-400'}`}>(set up {formatDay(c.registeredAt)})</span>
          </li>
        ))}
        {expanded && options.length === 0 && (
          <li role="presentation" className="px-3 py-2 text-sm text-gray-400">No chip matches “{query.trim()}”.</li>
        )}
      </ul>
    </div>
  );
};
