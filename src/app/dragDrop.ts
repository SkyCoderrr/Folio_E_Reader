import { getCurrentWebview } from '@tauri-apps/api/webview';

/** Attach before import commands; native Tauri events also carry folder paths. */
export function listenForBookDrops(
  visible: (value: boolean) => void,
  importPaths: (paths: string[]) => void,
) {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    visible(payload.type === 'enter' || payload.type === 'over');
    if (payload.type === 'drop') importPaths(payload.paths);
  });
}
