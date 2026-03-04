import { useAgeVerification } from './useAgeVerification';
import { AgeGate } from './AgeGate';

export function AgeGateGuard({ children }: { children: React.ReactNode }) {
  const { verified } = useAgeVerification();

  if (!verified) {
    return <AgeGate />;
  }

  return <>{children}</>;
}
