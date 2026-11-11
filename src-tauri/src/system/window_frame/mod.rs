//! Production native frame (ADR-003). HWNDs and COM objects stay on the UI thread.
//! Windows visual/DPI/Snap acceptance is separate from compile/geometry checks.
pub mod geometry;
#[cfg(windows)]
mod native;
#[cfg(windows)]
pub use native::{install, set_caption_rects, set_fullscreen, start_drag};

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Manager, WebviewWindow};

/// Epoch invalidates work already queued across reload/fullscreen/hide/null.
#[derive(Default)]
pub struct FrameGate {
    epoch: AtomicU64,
    loaded: AtomicBool,
    fullscreen: AtomicBool,
}
impl FrameGate {
    fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }
    fn accepts(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::Acquire) == epoch
            && self.loaded.load(Ordering::Acquire)
            && !self.fullscreen.load(Ordering::Acquire)
    }
}

pub fn page_load(window: &WebviewWindow, event: tauri::webview::PageLoadEvent) {
    let gate = window.state::<FrameGate>();
    match event {
        tauri::webview::PageLoadEvent::Started => {
            gate.loaded.store(false, Ordering::Release);
            gate.invalidate();
            disable(window);
        }
        tauri::webview::PageLoadEvent::Finished => {
            gate.loaded.store(true, Ordering::Release);
        }
    }
}

pub fn fullscreen(window: &WebviewWindow, fullscreen: bool) {
    let gate = window.state::<FrameGate>();
    gate.fullscreen.store(fullscreen, Ordering::Release);
    gate.invalidate();
    disable(window);
}

fn disable(window: &WebviewWindow) {
    #[cfg(windows)]
    native::disable(window);
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_geometry_cannot_cross_invalidation() {
        let gate = FrameGate::default();
        assert!(!gate.accepts(0));
        gate.loaded.store(true, Ordering::Release);
        assert!(gate.accepts(0));
        gate.invalidate();
        assert!(!gate.accepts(0));
        assert!(gate.accepts(1));
        gate.fullscreen.store(true, Ordering::Release);
        assert!(!gate.accepts(1));
        gate.invalidate();
        gate.fullscreen.store(false, Ordering::Release);
        assert!(!gate.accepts(1));
        assert!(gate.accepts(2));
    }
}
