/**
 * The Receipt download: the private half of an Ownership ID as a JSON file.
 *
 * Built in the browser from GET /:tagId/receipt so nothing is stored server
 * side as a file. Anyone holding it can recompute the Ownership ID; it
 * authorizes nothing.
 */

import type { Receipt } from '../api/schemas';

export const receiptDocument = (tagId: string, receipt: Receipt) => ({
  kind: 'authentic-materials.ownership-receipt',
  version: 1,
  tagId,
  ...receipt,
  note: 'Keep this private. It proves you held this ownership. It cannot be used to transfer or claim the token.',
});

export const receiptFileName = (receipt: Receipt): string =>
  `ownership-receipt-${receipt.ownershipId.slice(0, 10)}.json`;

/** Triggers a browser download. Kept separate so tests can assert the document. */
export const downloadJson = (fileName: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
