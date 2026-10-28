import type { ReactNode } from 'react';

/** A rounded window with three dots in the corner. Line-art scenes sit inside it instead of cards. */
export const SceneWindow = ({ children }: { children: ReactNode }) => <div className="win">{children}</div>;
