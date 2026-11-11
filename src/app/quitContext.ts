import { createContext } from 'react';

/** Lets the Library's existing caption use the same bounded flush as the reader. */
export const QuitContext = createContext<(() => void) | undefined>(undefined);
