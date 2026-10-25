/** What an admin types to confirm a Delete: the part of the account email before '@'. */
export const deleteConfirmationOf = (email: string | null): string => (email ?? '').split('@')[0] ?? '';
