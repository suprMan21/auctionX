import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Creator ID checks (2026-10-26): support may open a record but not change its
 * status; admin and super admin may. The API enforces the same rule.
 */

const api = vi.hoisted(() => ({ getYotiVerificationDetail: vi.fn(), overrideYotiVerification: vi.fn() }));
vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

import { AdminVerificationDetailPage } from './AdminVerificationDetailPage';
import { AdminRoleContext } from '../lib/adminRole';
import { accessFor } from '../test/adminAccess';

const USER = '22222222-2222-4222-8222-222222222222';

const renderAs = (role: string) =>
  render(
    <AdminRoleContext.Provider value={accessFor(role)}>
      <MemoryRouter initialEntries={[`/admin/verifications/${USER}`]}>
        <Routes>
          <Route path="/admin/verifications/:userId" element={<AdminVerificationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AdminRoleContext.Provider>,
  );

beforeEach(() => {
  api.getYotiVerificationDetail.mockReset().mockResolvedValue({
    success: true,
    data: {
      user: {
        id: USER, email: 'creator@example.com', display_name: 'Creator', role: 'user',
        seller_verification_status: 'PENDING', seller_verification_submitted_at: null, seller_verification_reviewed_at: null,
        seller_verification_rejection_reason: null, age_verified: false, age_verified_at: null, age_verification_provider: null,
        yoti_session_id: null, yoti_age_estimate: null, yoti_last_event_at: null, created_at: '2026-10-01T00:00:00Z',
      },
      sessions: [],
      reviews: [],
    },
  });
});

describe('creator ID record by role', () => {
  it('support can open it but sees no way to change the status', async () => {
    renderAs('support');
    expect(await screen.findByText('creator@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Change status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set to/ })).not.toBeInTheDocument();
  });

  it.each(['admin', 'super_admin'])('%s can change the status', async (role) => {
    renderAs(role);
    expect(await screen.findByRole('heading', { name: 'Change status' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Set to/ }).length).toBeGreaterThan(0);
  });
});
