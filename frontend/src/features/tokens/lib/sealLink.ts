/** The public seal page for a code (S-SEAL1 Ph2b). Same site as the app: CloudFront /s/* goes to the server page. */
export const sealPageUrl = (code: string): string => `${window.location.origin}/s/${code}`;
