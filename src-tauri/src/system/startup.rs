use std::sync::atomic::{AtomicBool, Ordering};
/// Second-instance shows must wait until window, boss registration and tray setup finish.
#[derive(Default)]
pub struct ShowQueue {
    ready: AtomicBool,
    pending: AtomicBool,
}
impl ShowQueue {
    pub fn request(&self) -> bool {
        self.pending.store(true, Ordering::SeqCst);
        self.ready.load(Ordering::SeqCst) && self.pending.swap(false, Ordering::SeqCst)
    }
    pub fn mark_ready(&self) -> bool {
        self.ready.store(true, Ordering::SeqCst);
        self.pending.swap(false, Ordering::SeqCst)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_show_waits_for_window_boss_and_tray() {
        let queue = ShowQueue::default();
        assert!(!queue.request());
        assert!(!queue.request());
        assert!(queue.mark_ready());
        assert!(!queue.mark_ready());
    }
    #[test]
    fn handoff_after_startup_shows_immediately() {
        let queue = ShowQueue::default();
        assert!(!queue.mark_ready());
        assert!(queue.request());
        assert!(queue.request());
    }
    #[test]
    fn racing_startup_and_handoff_never_lose_or_duplicate_show() {
        for _ in 0..100 {
            let queue = std::sync::Arc::new(ShowQueue::default());
            let other = queue.clone();
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
            let worker_barrier = barrier.clone();
            let worker = std::thread::spawn(move || {
                worker_barrier.wait();
                other.request()
            });
            barrier.wait();
            let ready = queue.mark_ready();
            let request = worker.join().unwrap();
            assert_ne!(ready, request);
        }
    }
}
