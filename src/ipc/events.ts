import { listen as tauriListen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { EventName, EventPayload } from '@contract/types';
import { ipcError } from './commands';
export async function listen<E extends EventName>(
  name: E,
  handler: (payload: EventPayload<E>) => void,
): Promise<UnlistenFn> {
  try {
    return await tauriListen<EventPayload<E>>(name, (event) => handler(event.payload));
  } catch (reason) {
    throw ipcError(reason);
  }
}
