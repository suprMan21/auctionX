export interface SunMessageParts {
  encPiccData: string;
  cmac: string;
}

export interface ValidateScanParams {
  tagUid: string;
  sunMessage: string;
  storedAesKey: string;
  lastCounter: number;
}

export interface ScanValidationResult {
  valid: boolean;
  decryptedUid: string | null;
  counterValue: number | null;
  error?: string;
}
