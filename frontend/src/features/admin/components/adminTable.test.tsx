import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminTable, type AdminColumn } from './AdminTable';

/**
 * UX-2 shared table: whole-row click only navigates; links, buttons and text
 * selection keep their own behaviour; columns resize by keyboard and are
 * remembered when storage works.
 */

interface Row { id: string; email: string }
const ROWS: Row[] = [{ id: 'a1', email: 'fan@example.com' }];

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

const renderTable = (onAction = vi.fn()) => {
  const columns: AdminColumn<Row>[] = [
    { key: 'email', header: 'Email', cell: (r) => <Link to={`/admin/users/${r.id}`}>{r.email}</Link> },
    { key: 'note', header: 'Note', cell: () => 'plain text' },
    { key: 'act', header: 'Actions', hideHeader: true, cell: () => <button type="button" onClick={onAction}>Revoke…</button> },
  ];
  render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route path="*" element={<><AdminTable id="t" label="Accounts" columns={columns} rows={ROWS} rowKey={(r) => r.id} rowHref={(r) => `/admin/users/${r.id}`} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
  return onAction;
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('AdminTable', () => {
  it('a click anywhere on the row opens the record', async () => {
    renderTable();
    await userEvent.click(screen.getByText('plain text'));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/users/a1');
  });

  it('a button in the row runs only its own handler and does not navigate', async () => {
    const onAction = renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke…' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/users');
    expect(screen.getByTestId('where')).not.toHaveTextContent('a1');
  });

  it('cmd/ctrl-click and middle-click open a new tab instead', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderTable();
    fireEvent.click(screen.getByText('plain text'), { button: 0, metaKey: true });
    fireEvent(screen.getByText('plain text'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith('/admin/users/a1', '_blank', 'noopener');
    expect(screen.getByTestId('where')).not.toHaveTextContent('a1');
  });

  it('finishing a text selection does not navigate', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, toString: () => 'fan@' } as unknown as Selection);
    renderTable();
    fireEvent.click(screen.getByText('plain text'), { button: 0 });
    expect(screen.getByTestId('where')).not.toHaveTextContent('a1');
  });

  it('the first cell stays a real link', () => {
    renderTable();
    expect(screen.getByRole('link', { name: 'fan@example.com' })).toHaveAttribute('href', '/admin/users/a1');
  });

  it('columns resize with the arrow keys and the width is remembered', async () => {
    renderTable();
    const handle = screen.getAllByRole('separator', { name: 'Resize column' })[0];
    handle.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    const stored = JSON.parse(window.localStorage.getItem('am-admin-table:t') ?? '{}') as Record<string, number>;
    expect(stored.email).toBeGreaterThan(0);
    expect(handle).toHaveAttribute('aria-valuenow', String(stored.email));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/users');
  });

  it('still works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderTable();
    const handle = screen.getAllByRole('separator', { name: 'Resize column' })[0];
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('table', { name: 'Accounts' })).toBeInTheDocument();
  });
});
