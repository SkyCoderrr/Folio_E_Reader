/** Shared interruption hook for held motion and the auto-scroll lane. */
const listeners = new Set<() => void>();
export const subscribeReadingPause = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const pauseReading = () => {
  for (const listener of listeners) listener();
};
