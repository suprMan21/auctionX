import { useCallback, useRef, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import type { StepUpAction } from '../api/mfaApi';
import { StepUpPanel } from './StepUpPanel';

interface Pending {
  action: StepUpAction;
  targetId: string;
  purpose: string;
}

/**
 * For screens that are not already a dialog (Security settings, admin pricing).
 *
 *   const { confirm, dialog } = useStepUpDialog();
 *   const token = await confirm({ action, targetId, purpose });  // null = cancelled
 *   ...render {dialog}
 */
export const useStepUpDialog = () => {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<((token: string | null) => void) | null>(null);

  const settle = useCallback((token: string | null) => {
    resolver.current?.(token);
    resolver.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback((p: Pending): Promise<string | null> => {
    resolver.current?.(null);
    setPending(p);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const dialog = (
    <Modal isOpen={pending !== null} onClose={() => settle(null)} title="Confirm it's you">
      {pending && (
        <StepUpPanel
          action={pending.action}
          targetId={pending.targetId}
          purpose={pending.purpose}
          onConfirmed={(token) => settle(token)}
          onCancel={() => settle(null)}
        />
      )}
    </Modal>
  );

  return { confirm, dialog };
};
