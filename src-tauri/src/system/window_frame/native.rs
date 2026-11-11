//! All functions touching Frame run on the window thread. No Chromium HWND discovery.
use super::{
    FrameGate,
    geometry::{self, PhysicalRect},
};
use crate::contract::{
    AppError, CaptionButton, CaptionRects, CaptionStatePayload, ErrorCode, ResizeDirection,
    TitleBarMode, event,
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::atomic::Ordering,
};
use tauri::{Emitter, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
use windows::{
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{
                DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
                DwmSetWindowAttribute,
            },
            Gdi::{
                BeginPaint, ClientToScreen, CreateSolidBrush, DeleteObject, EndPaint, FillRect,
                GetMonitorInfoW, GetWindowDC, HDC, MONITOR_DEFAULTTONEAREST, MONITORINFO,
                MonitorFromRect, MonitorFromWindow, PAINTSTRUCT, RDW_FRAME, RDW_INVALIDATE,
                RedrawWindow, ReleaseDC, ScreenToClient,
            },
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Controls::WM_MOUSELEAVE,
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{
                GetCapture, ReleaseCapture, SetCapture, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
                TrackMouseEvent,
            },
            Shell::{
                ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_GETAUTOHIDEBAREX, APPBARDATA,
                DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass,
            },
            WindowsAndMessaging::*,
        },
    },
    core::w,
};

const SUBCLASS_ID: usize = 0x4552_0006;
const RELAYOUT: u32 = WM_APP + 0x306;
// COLORREF is 0x00BBGGRR. Keep the native margins equal to the dark shell (#111214).
const FRAME_COLOR: COLORREF = COLORREF(0x0014_1211);
const BUTTONS: [CaptionButton; 3] = [
    CaptionButton::Minimize,
    CaptionButton::Maximize,
    CaptionButton::Close,
];
thread_local! {
    static FRAMES: RefCell<HashMap<isize, Rc<Frame>>> = RefCell::new(HashMap::new());
}
struct Frame {
    window: WebviewWindow,
    hwnd: HWND,
    controller: ICoreWebView2Controller,
    children: RefCell<Vec<HWND>>, // three caption children, then four edge strips
    rects: Cell<Option<[PhysicalRect; 3]>>,
    rect_epoch: Cell<u64>,
    hovered: Cell<Option<CaptionButton>>,
    pressed: Cell<Option<CaptionButton>>,
    capture: Cell<Option<HWND>>,
    laying_out: Cell<bool>,
    maximized_before_fullscreen: Cell<Option<RECT>>,
    fullscreen: Cell<bool>,
}
fn frame(hwnd: HWND) -> Option<Rc<Frame>> {
    FRAMES.with(|frames| frames.borrow().get(&(hwnd.0 as isize)).cloned())
}
fn error(e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::WindowOpFailed, e.to_string())
        .with_details(serde_json::json!({"op":"window_set_caption_rects"}))
}

fn configure_dwm(hwnd: HWND) {
    // Windows 10 may reject these Windows 11 attributes. Do not disable DWM
    // non-client rendering: that also removes the shadow and rounded corners.
    unsafe {
        let corner = DWMWCP_ROUND;
        if let Err(e) = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::from_ref(&corner).cast(),
            std::mem::size_of_val(&corner) as u32,
        ) {
            log::info!("DWM corner preference unavailable: {e}");
        }
        let border: u32 = 0xffff_fffe; // documented DWMWA_COLOR_NONE
        if let Err(e) = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            std::ptr::from_ref(&border).cast(),
            std::mem::size_of_val(&border) as u32,
        ) {
            log::info!("DWM border suppression unavailable: {e}");
        }
    }
}

fn fill_nonclient(hwnd: HWND, dc: HDC) -> Result<(), AppError> {
    unsafe {
        let mut outer = RECT::default();
        let mut client = RECT::default();
        GetWindowRect(hwnd, &mut outer).map_err(error)?;
        GetClientRect(hwnd, &mut client).map_err(error)?;
        let mut first = POINT {
            x: client.left,
            y: client.top,
        };
        let mut last = POINT {
            x: client.right,
            y: client.bottom,
        };
        ClientToScreen(hwnd, &mut first).ok().map_err(error)?;
        ClientToScreen(hwnd, &mut last).ok().map_err(error)?;
        let difference = |a: i32, b: i32| {
            a.checked_sub(b)
                .ok_or_else(|| error("Native frame coordinate overflow"))
        };
        let bands = geometry::nonclient_bands(
            difference(outer.right, outer.left)?,
            difference(outer.bottom, outer.top)?,
            PhysicalRect {
                left: difference(first.x, outer.left)?,
                top: difference(first.y, outer.top)?,
                right: difference(last.x, outer.left)?,
                bottom: difference(last.y, outer.top)?,
            },
        )
        .map_err(error)?;
        let brush = CreateSolidBrush(FRAME_COLOR);
        if brush.is_invalid() {
            return Err(error(windows::core::Error::from_thread()));
        }
        let result = bands.into_iter().try_for_each(|r| {
            if r.right > r.left
                && r.bottom > r.top
                && FillRect(
                    dc,
                    &RECT {
                        left: r.left,
                        top: r.top,
                        right: r.right,
                        bottom: r.bottom,
                    },
                    brush,
                ) == 0
            {
                return Err(error("Cannot paint native frame"));
            }
            Ok(())
        });
        let _ = DeleteObject(brush.into());
        result
    }
}

fn paint_nonclient(hwnd: HWND) -> Result<(), AppError> {
    unsafe {
        let dc = GetWindowDC(Some(hwnd));
        if dc.is_invalid() {
            return Err(error(windows::core::Error::from_thread()));
        }
        let result = fill_nonclient(hwnd, dc);
        ReleaseDC(Some(hwnd), dc);
        result
    }
}

/// with_webview dispatches to the UI thread, where subclassing is legal.
pub fn install(window: &WebviewWindow) -> Result<(), AppError> {
    if window.state::<crate::AppState>().applied_title_bar == TitleBarMode::Native {
        return Ok(());
    }
    let owned = window.clone();
    window
        .with_webview(move |view| {
            let result = unsafe { install_ui(owned, view.controller().clone()) };
            if let Err(e) = result {
                // Frame setup is essential; do not silently ship a window with broken borders.
                log::error!("Native frame setup failed: {e}");
                std::process::exit(2);
            }
        })
        .map_err(error)
}

unsafe fn install_ui(
    window: WebviewWindow,
    controller: ICoreWebView2Controller,
) -> Result<(), AppError> {
    unsafe {
        let hwnd = HWND(window.hwnd().map_err(error)?.0);
        let instance = GetModuleHandleW(None).map_err(error)?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(child_proc),
            hInstance: instance.into(),
            lpszClassName: w!("EReaderCaptionHitTestM06"),
            // Null brush, no native caption style, no layered or click-through window.
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(error(windows::core::Error::from_thread()));
        }
        let state = Rc::new(Frame {
            window,
            hwnd,
            controller,
            children: RefCell::new(Vec::new()),
            rects: Cell::new(None),
            rect_epoch: Cell::new(0),
            hovered: Cell::new(None),
            pressed: Cell::new(None),
            capture: Cell::new(None),
            laying_out: Cell::new(false),
            maximized_before_fullscreen: Cell::new(None),
            fullscreen: Cell::new(false),
        });
        FRAMES.with(|frames| frames.borrow_mut().insert(hwnd.0 as isize, state.clone()));
        if !SetWindowSubclass(hwnd, Some(parent_proc), SUBCLASS_ID, 0).as_bool() {
            FRAMES.with(|frames| frames.borrow_mut().remove(&(hwnd.0 as isize)));
            return Err(error(windows::core::Error::from_thread()));
        }
        // Keep sizing/Snap styles and the DWM frame, but remove the system caption.
        // STYLECHANGING below also applies this when Tao rewrites styles on restore/DPI.
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & !WS_CAPTION.0;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(error)?;
        for _ in 0..7 {
            let child = CreateWindowExW(
                WS_EX_NOACTIVATE,
                class.lpszClassName,
                w!(""),
                WS_CHILD,
                0,
                0,
                0,
                0,
                Some(hwnd),
                None,
                Some(instance.into()),
                None,
            )
            .map_err(error)?;
            SetWindowLongPtrW(child, GWLP_USERDATA, hwnd.0 as isize);
            state.children.borrow_mut().push(child);
        }
        configure_dwm(hwnd);
        paint_nonclient(hwnd)?;
        state.layout()?;
        Ok(())
    }
}

pub async fn set_caption_rects(
    window: WebviewWindow,
    rects: Option<CaptionRects>,
) -> Result<(), AppError> {
    let gate = window.state::<FrameGate>();
    if rects.is_none() {
        gate.invalidate();
    }
    let epoch = gate.epoch.load(Ordering::Acquire);
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let hwnd = HWND(owned.hwnd().map_err(error)?.0);
                let Some(frame) = frame(hwnd) else {
                    return if owned.state::<crate::AppState>().applied_title_bar
                        == TitleBarMode::Native
                    {
                        Ok(())
                    } else {
                        Err(error("Native frame not installed"))
                    };
                };
                // A queued old report must never clear geometry accepted in a newer epoch.
                if owned.state::<FrameGate>().epoch.load(Ordering::Acquire) != epoch {
                    return Ok(());
                }
                if let Some(rects) = rects {
                    if !owned.state::<FrameGate>().accepts(epoch) {
                        return Ok(());
                    }
                    let physical = frame.viewport().and_then(|viewport| {
                        geometry::caption_rects(&rects, viewport, frame.scale()?)
                            .map_err(|message| AppError::new(ErrorCode::InvalidArgument, message))
                    });
                    let physical = match physical {
                        Ok(physical) => physical,
                        Err(e) => {
                            frame.clear();
                            return Err(e);
                        }
                    };
                    // ResizeObserver reports are idempotent. Hiding/re-showing unchanged
                    // children emits leave/hover events and cancels an in-progress press.
                    if frame.rect_epoch.get() == epoch && frame.rects.get() == Some(physical) {
                        return Ok(());
                    }
                    frame.clear();
                    frame.rects.set(Some(physical));
                    frame.rect_epoch.set(epoch);
                } else {
                    frame.clear();
                }
                frame.layout()
            })();
            let _ = sender.try_send(result);
        })
        .map_err(error)?;
    receiver
        .recv()
        .await
        .ok_or_else(|| error("Window thread closed"))?
}

pub fn disable(window: &WebviewWindow) {
    let owned = window.clone();
    if let Err(e) = window.run_on_main_thread(move || {
        if let Ok(hwnd) = owned.hwnd()
            && let Some(frame) = frame(HWND(hwnd.0))
        {
            frame.clear();
            if let Err(e) = frame.layout() {
                log::warn!("Native frame disable: {e}");
            }
        }
    }) {
        log::warn!("Native frame disable dispatch: {e}");
    }
}

/// Run the entire transition on the window thread. Tauri setters otherwise enqueue
/// work, so clearing the gate / publishing immediately races Tao's style and size work.
pub async fn set_fullscreen(window: WebviewWindow, fullscreen: bool) -> Result<(), AppError> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                if owned.is_fullscreen().map_err(error)? == fullscreen {
                    return Ok(());
                }
                let hwnd = HWND(owned.hwnd().map_err(error)?.0);
                let frame = frame(hwnd);
                if fullscreen && let Some(frame) = &frame {
                    let mut outer = RECT::default();
                    unsafe {
                        GetWindowRect(hwnd, &mut outer).map_err(error)?;
                    }
                    frame
                        .maximized_before_fullscreen
                        .set(unsafe { IsZoomed(hwnd).as_bool() }.then_some(outer));
                }
                super::fullscreen(&owned, true);
                if let Some(frame) = &frame {
                    frame.fullscreen.set(fullscreen);
                }
                if let Err(e) = owned.set_fullscreen(fullscreen) {
                    if let Some(frame) = &frame {
                        frame.fullscreen.set(owned.is_fullscreen().unwrap_or(false));
                    }
                    super::fullscreen(&owned, owned.is_fullscreen().unwrap_or(false));
                    return Err(error(e));
                }
                // Tao restores WINDOWPLACEMENT while the HWND still has WS_MAXIMIZE.
                // Windows then leaves its outer bounds at the fullscreen monitor rectangle.
                // Reapply the pre-transition maximized bounds and recalculate the client.
                let restore_result = if !fullscreen
                    && let Some(frame) = &frame
                    && let Some(outer) = frame.maximized_before_fullscreen.take()
                {
                    restore_maximized_bounds(hwnd, outer)
                } else {
                    Ok(())
                };
                super::fullscreen(&owned, fullscreen);
                crate::system::window::publish(&owned);
                restore_result
            })();
            let _ = sender.try_send(result);
        })
        .map_err(error)?;
    receiver
        .recv()
        .await
        .ok_or_else(|| error("Window thread closed"))?
}

fn restore_maximized_bounds(hwnd: HWND, outer: RECT) -> Result<(), AppError> {
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            outer.left,
            outer.top,
            outer.right - outer.left,
            outer.bottom - outer.top,
            SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(error)
    }
}

/// Match the actual HWND to the per-monitor work area. Tao's undecorated
/// NCCALCSIZE restricts only the client, leaving the default maximized outer
/// window (and our NC painter) extending a taskbar-height past that client.
fn maximized_monitor_bounds(hwnd: HWND, proposed: Option<&RECT>) -> Option<RECT> {
    unsafe {
        let monitor = proposed.map_or_else(
            || MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
            |rect| MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST),
        );
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let auto_hide = [ABE_LEFT, ABE_TOP, ABE_RIGHT, ABE_BOTTOM].map(|edge| {
            let mut data = APPBARDATA {
                cbSize: std::mem::size_of::<APPBARDATA>() as u32,
                uEdge: edge,
                rc: info.rcMonitor,
                ..Default::default()
            };
            // GETAUTOHIDEBAR queries the primary taskbar even on another monitor.
            SHAppBarMessage(ABM_GETAUTOHIDEBAREX, &mut data) != 0
        });
        let physical = |r: RECT| PhysicalRect {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        };
        let bounds =
            geometry::maximized_bounds(physical(info.rcMonitor), physical(info.rcWork), auto_hide);
        Some(RECT {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
        })
    }
}

fn constrain_maximized_position(hwnd: HWND, pos: &mut WINDOWPOS) {
    if pos.flags.contains(SWP_NOMOVE | SWP_NOSIZE) {
        return;
    }
    let mut current = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut current) }.is_err() {
        return;
    }
    let left = if pos.flags.contains(SWP_NOMOVE) {
        current.left
    } else {
        pos.x
    };
    let top = if pos.flags.contains(SWP_NOMOVE) {
        current.top
    } else {
        pos.y
    };
    let width = if pos.flags.contains(SWP_NOSIZE) {
        current.right - current.left
    } else {
        pos.cx
    };
    let height = if pos.flags.contains(SWP_NOSIZE) {
        current.bottom - current.top
    } else {
        pos.cy
    };
    let proposed = RECT {
        left,
        top,
        right: left.saturating_add(width),
        bottom: top.saturating_add(height),
    };
    if let Some(bounds) = maximized_monitor_bounds(hwnd, Some(&proposed)) {
        pos.x = bounds.left;
        pos.y = bounds.top;
        pos.cx = bounds.right - bounds.left;
        pos.cy = bounds.bottom - bounds.top;
        pos.flags &= !(SWP_NOMOVE | SWP_NOSIZE);
    }
}

fn screen_lparam(point: POINT) -> LPARAM {
    LPARAM(((u32::from(point.y as u16) << 16) | u32::from(point.x as u16)) as isize)
}

/// Tao 0.37's drag helper posts a stack POINTS pointer as LPARAM. WM_NCLBUTTONDOWN
/// requires packed screen coordinates; those random bits can move the window offscreen.
pub fn start_drag(window: &WebviewWindow) -> Result<(), AppError> {
    let handle = window.hwnd().map_err(error)?.0 as isize;
    window
        .run_on_main_thread(move || unsafe {
            let hwnd = HWND(handle as *mut _);
            let result = (|| {
                let mut point = POINT::default();
                GetCursorPos(&mut point).map_err(error)?;
                let _ = ReleaseCapture();
                PostMessageW(
                    Some(hwnd),
                    WM_NCLBUTTONDOWN,
                    WPARAM(HTCAPTION as usize),
                    screen_lparam(point),
                )
                .map_err(error)
            })();
            if let Err(e) = result {
                log::warn!("Native title-bar drag: {e}");
            }
        })
        .map_err(error)
}

impl Frame {
    fn scale(&self) -> Result<f64, AppError> {
        geometry::scale_for_dpi(unsafe { GetDpiForWindow(self.hwnd) }).map_err(error)
    }
    fn viewport(&self) -> Result<PhysicalRect, AppError> {
        let mut rect = RECT::default();
        unsafe {
            self.controller.Bounds(&mut rect).map_err(error)?;
            // Controller bounds belong to its own parent, which need not be our HWND.
            // Map both physical boundaries before applying the CSS scale exactly once.
            let mut parent = HWND::default();
            self.controller.ParentWindow(&mut parent).map_err(error)?;
            let mut first = POINT {
                x: rect.left,
                y: rect.top,
            };
            let mut last = POINT {
                x: rect.right,
                y: rect.bottom,
            };
            for point in [&mut first, &mut last] {
                ClientToScreen(parent, point).ok().map_err(error)?;
                ScreenToClient(self.hwnd, point).ok().map_err(error)?;
            }
            rect = RECT {
                left: first.x,
                top: first.y,
                right: last.x,
                bottom: last.y,
            };
        }
        Ok(PhysicalRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        })
    }
    fn client(&self) -> Result<RECT, AppError> {
        let mut rect = RECT::default();
        unsafe {
            GetClientRect(self.hwnd, &mut rect).map_err(error)?;
        }
        Ok(rect)
    }
    fn state(&self, hovered: Option<CaptionButton>, pressed: Option<CaptionButton>) {
        let old_hovered = self.hovered.replace(hovered);
        let old_pressed = self.pressed.replace(pressed);
        if (old_hovered != hovered || old_pressed != pressed)
            && let Err(e) = self.window.emit(
                event::WINDOW_CAPTION_STATE,
                CaptionStatePayload { hovered, pressed },
            )
        {
            log::warn!("caption state: {e}");
        }
    }
    fn reset(&self) {
        self.state(None, None);
        if let Some(capture) = self.capture.take() {
            unsafe {
                if GetCapture() == capture {
                    let _ = ReleaseCapture();
                }
            }
        }
    }
    fn clear(&self) {
        self.rects.set(None);
        self.reset();
        let children = self.children.borrow().clone();
        for child in children.iter().take(3) {
            unsafe {
                let _ = ShowWindow(*child, SW_HIDE);
            }
        }
    }
    fn blocked(&self) -> bool {
        let gate = self.window.state::<FrameGate>();
        gate.fullscreen.load(Ordering::Acquire)
            || unsafe { !IsWindowVisible(self.hwnd).as_bool() || IsIconic(self.hwnd).as_bool() }
    }
    fn layout(&self) -> Result<(), AppError> {
        if self.laying_out.replace(true) {
            return Ok(());
        }
        let result = self.layout_inner();
        self.laying_out.set(false);
        result
    }
    fn layout_inner(&self) -> Result<(), AppError> {
        let children = self.children.borrow().clone();
        let client = self.client()?;
        let (w, h) = (client.right, client.bottom);
        let b = geometry::resize_width(self.scale()?)
            .map_err(error)?
            .min(w / 2)
            .min(h / 2);
        let resize = !self.blocked() && unsafe { !IsZoomed(self.hwnd).as_bool() };
        let edges = [
            PhysicalRect {
                left: 0,
                top: 0,
                right: w,
                bottom: b,
            },
            PhysicalRect {
                left: 0,
                top: h - b,
                right: w,
                bottom: h,
            },
            PhysicalRect {
                left: 0,
                top: b,
                right: b,
                bottom: h - b,
            },
            PhysicalRect {
                left: w - b,
                top: b,
                right: w,
                bottom: h - b,
            },
        ];
        for (index, child) in children.iter().enumerate() {
            let rect = if index < 3 {
                if self.blocked()
                    || !self
                        .window
                        .state::<FrameGate>()
                        .accepts(self.rect_epoch.get())
                {
                    None
                } else {
                    self.rects.get().map(|r| r[index])
                }
            } else if resize {
                Some(edges[index - 3])
            } else {
                None
            };
            unsafe {
                if let Some(r) = rect {
                    SetWindowPos(
                        *child,
                        Some(HWND_TOP),
                        r.left,
                        r.top,
                        r.right - r.left,
                        r.bottom - r.top,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    )
                    .map_err(error)?;
                } else {
                    let _ = ShowWindow(*child, SW_HIDE);
                }
            }
        }
        Ok(())
    }
    fn point(&self, lparam: LPARAM) -> Option<POINT> {
        // GET_X/Y_LPARAM semantics: sign extend, including monitors left/above primary.
        let mut point = POINT {
            x: lparam.0 as i16 as i32,
            y: (lparam.0 >> 16) as i16 as i32,
        };
        unsafe {
            ScreenToClient(self.hwnd, &mut point)
                .as_bool()
                .then_some(point)
        }
    }
    fn button_at(&self, point: POINT) -> Option<CaptionButton> {
        if self.blocked()
            || self.resize_at(point).is_some()
            || !self
                .window
                .state::<FrameGate>()
                .accepts(self.rect_epoch.get())
        {
            return None;
        }
        self.rects
            .get()
            .and_then(|rects| rects.iter().position(|r| r.contains(point.x, point.y)))
            .map(|i| BUTTONS[i])
    }
    fn hit(&self, point: POINT) -> u32 {
        if self.blocked() {
            return HTCLIENT;
        }
        if let Some(edge) = self.resize_at(point) {
            return resize_code(edge);
        }
        match self.button_at(point) {
            Some(CaptionButton::Minimize) => HTMINBUTTON,
            Some(CaptionButton::Maximize) => HTMAXBUTTON,
            Some(CaptionButton::Close) => HTCLOSE,
            None => HTCLIENT,
        }
    }
    fn resize_at(&self, point: POINT) -> Option<ResizeDirection> {
        if !self.blocked()
            && !unsafe { IsZoomed(self.hwnd).as_bool() }
            && let (Ok(c), Ok(s)) = (self.client(), self.scale())
            && let Ok(b) = geometry::resize_width(s)
            && let Some(edge) = geometry::resize_hit(point.x, point.y, c.right, c.bottom, b)
        {
            return Some(edge);
        }
        None
    }
    fn activate(&self, button: CaptionButton) {
        // Queue exactly one system command to the real top-level HWND; normal WM_CLOSE
        // reaches Tauri's prevented CloseRequested and the bounded application handshake.
        let command = match button {
            CaptionButton::Minimize => SC_MINIMIZE,
            CaptionButton::Maximize => {
                if unsafe { IsZoomed(self.hwnd).as_bool() } {
                    SC_RESTORE
                } else {
                    SC_MAXIMIZE
                }
            }
            CaptionButton::Close => SC_CLOSE,
        };
        unsafe {
            if let Err(e) = PostMessageW(
                Some(self.hwnd),
                WM_SYSCOMMAND,
                WPARAM(command as usize),
                LPARAM(0),
            ) {
                log::warn!("caption activation: {e}");
            }
        }
    }
}

fn resize_code(direction: ResizeDirection) -> u32 {
    use ResizeDirection::*;
    match direction {
        North => HTTOP,
        South => HTBOTTOM,
        East => HTRIGHT,
        West => HTLEFT,
        NorthEast => HTTOPRIGHT,
        NorthWest => HTTOPLEFT,
        SouthEast => HTBOTTOMRIGHT,
        SouthWest => HTBOTTOMLEFT,
    }
}
fn resize_cursor(hit: u32) -> windows::core::PCWSTR {
    match hit {
        HTLEFT | HTRIGHT => IDC_SIZEWE,
        HTTOP | HTBOTTOM => IDC_SIZENS,
        HTTOPLEFT | HTBOTTOMRIGHT => IDC_SIZENWSE,
        HTTOPRIGHT | HTBOTTOMLEFT => IDC_SIZENESW,
        _ => IDC_ARROW,
    }
}

unsafe extern "system" fn child_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // No pointers to Rust allocations are stored in HWNDs; lookup returns an Rc before any
    // reentrant Win32 call. Never hold a RefCell borrow across a message dispatch.
    unsafe {
        let parent = HWND(GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut _);
        let Some(frame) = frame(parent) else {
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        };
        match msg {
            WM_NCHITTEST => {
                return LRESULT(frame.point(lparam).map_or(HTCLIENT, |p| frame.hit(p)) as isize);
            }
            WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
            WM_ERASEBKGND => return LRESULT(1),
            WM_PAINT => {
                let mut paint = PAINTSTRUCT::default();
                let _ = BeginPaint(hwnd, &mut paint);
                let _ = EndPaint(hwnd, &paint);
                return LRESULT(0);
            }
            WM_NCPAINT => return LRESULT(0),
            WM_SETCURSOR => {
                let hit = lparam.0 as u16 as u32;
                if let Ok(cursor) = LoadCursorW(None, resize_cursor(hit)) {
                    SetCursor(Some(cursor));
                }
                return LRESULT(1);
            }
            WM_NCMOUSEMOVE | WM_MOUSEMOVE => {
                let mut point = POINT::default();
                if GetCursorPos(&mut point).is_ok() && ScreenToClient(parent, &mut point).as_bool()
                {
                    frame.state(frame.button_at(point), frame.pressed.get());
                }
                let mut tracking = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: if msg == WM_NCMOUSEMOVE {
                        TME_LEAVE | TME_NONCLIENT
                    } else {
                        TME_LEAVE
                    },
                    hwndTrack: hwnd,
                    ..Default::default()
                };
                let _ = TrackMouseEvent(&mut tracking);
                // Let the real top-level default procedure observe native maximize hover.
                // Button down/up never take this path (no default painting/activation).
                if msg == WM_NCMOUSEMOVE {
                    let _ = DefWindowProcW(parent, msg, wparam, lparam);
                }
                return LRESULT(0);
            }
            WM_NCMOUSELEAVE | WM_MOUSELEAVE => {
                frame.state(None, frame.pressed.get());
                let _ = DefWindowProcW(parent, WM_NCMOUSELEAVE, WPARAM(0), LPARAM(0));
                return LRESULT(0);
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                if let Some(point) = frame.point(lparam) {
                    let hit = frame.hit(point);
                    if (HTLEFT..=HTBOTTOMRIGHT).contains(&hit) {
                        frame.reset();
                        let _ = ReleaseCapture();
                        // Native modal move/size loop, including Aero Snap and standard constraints.
                        return SendMessageW(
                            parent,
                            WM_NCLBUTTONDOWN,
                            Some(WPARAM(hit as usize)),
                            Some(lparam),
                        );
                    }
                    if let Some(button) = frame.button_at(point) {
                        frame.state(Some(button), Some(button));
                        frame.capture.set(Some(hwnd));
                        SetCapture(hwnd);
                    }
                }
                return LRESULT(0);
            }
            WM_LBUTTONUP | WM_NCLBUTTONUP => {
                let pressed = frame.pressed.get();
                let mut point = POINT::default();
                let hovered = if GetCursorPos(&mut point).is_ok()
                    && ScreenToClient(parent, &mut point).as_bool()
                {
                    frame.button_at(point)
                } else {
                    None
                };
                frame.reset();
                frame.state(hovered, None);
                if let Some(button) = pressed
                    && hovered == Some(button)
                {
                    frame.activate(button);
                }
                return LRESULT(0);
            }
            WM_CAPTURECHANGED | WM_CANCELMODE => {
                frame.reset();
                return LRESULT(0);
            }
            WM_SHOWWINDOW if wparam.0 == 0 => {
                frame.reset();
            }
            WM_NCDESTROY => {
                frame.reset();
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

unsafe extern "system" fn parent_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    unsafe {
        let Some(frame) = frame(hwnd) else {
            return DefSubclassProc(hwnd, msg, wparam, lparam);
        };
        match msg {
            WM_GETMINMAXINFO => {
                // Preserve Tao's minimum/maximum tracking constraints, then own
                // maximized placement as well as its client calculation.
                let result = DefSubclassProc(hwnd, msg, wparam, lparam);
                if !frame.fullscreen.get()
                    && let Some(bounds) = maximized_monitor_bounds(hwnd, None)
                    && let Some(info) = (lparam.0 as *mut MINMAXINFO).as_mut()
                {
                    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                    let mut mi = MONITORINFO {
                        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                        ..Default::default()
                    };
                    if GetMonitorInfoW(monitor, &mut mi).as_bool() {
                        info.ptMaxPosition = POINT {
                            x: bounds.left - mi.rcMonitor.left,
                            y: bounds.top - mi.rcMonitor.top,
                        };
                        info.ptMaxSize = POINT {
                            x: bounds.right - bounds.left,
                            y: bounds.bottom - bounds.top,
                        };
                    }
                }
                return result;
            }
            WM_WINDOWPOSCHANGING if !frame.fullscreen.get() && IsZoomed(hwnd).as_bool() => {
                // Windows adjusts GETMINMAXINFO's primary-monitor dimensions on
                // secondary monitors. Constrain the final physical placement too,
                // after default processing, before NCCALCSIZE / WebView resizing.
                let result = DefSubclassProc(hwnd, msg, wparam, lparam);
                if let Some(pos) = (lparam.0 as *mut WINDOWPOS).as_mut() {
                    constrain_maximized_position(hwnd, pos);
                }
                return result;
            }
            WM_NCCALCSIZE => {
                if frame.fullscreen.get() {
                    // Both NCCALCSIZE forms begin with the proposed RECT. No
                    // work-area clamp, resize inset, or NC pixels in fullscreen.
                    return LRESULT(0);
                }
                if IsZoomed(hwnd).as_bool()
                    && let Some(rect) = (lparam.0 as *mut RECT).as_mut()
                    && let Some(bounds) = maximized_monitor_bounds(hwnd, Some(rect))
                {
                    *rect = bounds;
                    return LRESULT(0);
                }
                // Keep normal-window shadow margins and their white-edge fix.
            }
            WM_NCHITTEST => {
                if let Some(point) = frame.point(lparam) {
                    let hit = frame.hit(point);
                    if hit != HTCLIENT {
                        return LRESULT(hit as isize);
                    }
                }
            }
            WM_STYLECHANGING if wparam.0 as i32 == GWL_STYLE.0 => {
                if let Some(styles) = (lparam.0 as *mut STYLESTRUCT).as_mut() {
                    styles.styleNew &= !WS_CAPTION.0;
                }
                return LRESULT(0);
            }
            // Tao reserves physical non-client margins for its native shadow. Simply
            // discarding NCPAINT leaves those pixels white (including PrintWindow).
            // Own their painting without invoking the system caption/button painter.
            // Maximized/fullscreen have no margins: their HWND and client agree.
            WM_NCPAINT => {
                if let Err(e) = paint_nonclient(hwnd) {
                    log::warn!("Native frame paint: {e}");
                }
                return LRESULT(0);
            }
            WM_NCACTIVATE => return DefWindowProcW(hwnd, msg, wparam, LPARAM(-1)),
            WM_ACTIVATE if wparam.0 as u16 == WA_INACTIVE as u16 => frame.reset(),
            WM_CANCELMODE => frame.reset(),
            WM_SHOWWINDOW if wparam.0 == 0 => {
                frame.window.state::<FrameGate>().invalidate();
                frame.clear();
            }
            WM_SIZE | WM_DPICHANGED => {
                frame.window.state::<FrameGate>().invalidate();
                frame.clear();
                // Run after Tao/WebView2 have applied their new client bounds.
                let _ = PostMessageW(Some(hwnd), RELAYOUT, WPARAM(0), LPARAM(0));
            }
            WM_WINDOWPOSCHANGED => {
                let _ = PostMessageW(Some(hwnd), RELAYOUT, WPARAM(0), LPARAM(0));
            }
            WM_THEMECHANGED | WM_DWMCOMPOSITIONCHANGED | WM_SETTINGCHANGE => {
                let result = DefSubclassProc(hwnd, msg, wparam, lparam);
                configure_dwm(hwnd);
                let _ = RedrawWindow(Some(hwnd), None, None, RDW_FRAME | RDW_INVALIDATE);
                return result;
            }
            RELAYOUT => {
                if let Err(e) = frame.layout() {
                    log::warn!("Native frame layout: {e}");
                }
                return LRESULT(0);
            }
            WM_NCDESTROY => {
                frame.window.state::<FrameGate>().invalidate();
                frame.clear();
                let _ = RemoveWindowSubclass(hwnd, Some(parent_proc), SUBCLASS_ID);
                FRAMES.with(|frames| frames.borrow_mut().remove(&(hwnd.0 as isize)));
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::{
        Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, GetPixel, SelectObject,
        },
        UI::HiDpi::GetSystemMetricsForDpi,
    };
    use windows::core::BOOL;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn PrintWindow(hwnd: HWND, dc: HDC, flags: u32) -> BOOL;
    }

    unsafe extern "system" fn probe_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        unsafe {
            match msg {
                WM_NCCALCSIZE => {
                    // Same shadow insets as Tao, both NCCALCSIZE forms start with RECT.
                    let r = &mut *(lparam.0 as *mut RECT);
                    let dpi = GetDpiForWindow(hwnd);
                    let border = GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi)
                        + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
                    r.left += border;
                    r.right -= border;
                    r.bottom -= border;
                    r.top += (f64::from(dpi) / 96.0).round() as i32;
                    return LRESULT(0);
                }
                WM_NCPAINT => {
                    if GetWindowLongPtrW(hwnd, GWLP_USERDATA) != 0 {
                        let _ = paint_nonclient(hwnd);
                    }
                    return LRESULT(0);
                }
                _ => {}
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
    }

    #[test]
    fn drag_message_packs_signed_screen_coordinates_instead_of_a_pointer() {
        for point in [POINT { x: 1200, y: 40 }, POINT { x: -2500, y: -300 }] {
            let packed = screen_lparam(point);
            assert_eq!(packed.0 as i16 as i32, point.x);
            assert_eq!((packed.0 >> 16) as i16 as i32, point.y);
            assert_eq!(packed.0 as usize >> 32, 0);
        }
    }

    #[test]
    fn maximized_placement_constrains_outer_not_only_client() {
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("EReader maximize placement regression"),
                WS_OVERLAPPEDWINDOW,
                80,
                80,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let result = std::panic::catch_unwind(|| {
                let bounds = maximized_monitor_bounds(hwnd, None).unwrap();
                let mut pos = WINDOWPOS {
                    hwnd,
                    x: bounds.left - 7,
                    y: bounds.top - 7,
                    cx: bounds.right - bounds.left + 14,
                    cy: bounds.bottom - bounds.top + 62,
                    flags: SWP_NOACTIVATE | SWP_NOZORDER,
                    ..Default::default()
                };
                constrain_maximized_position(hwnd, &mut pos);
                assert_eq!(
                    (pos.x, pos.y, pos.cx, pos.cy),
                    (
                        bounds.left,
                        bounds.top,
                        bounds.right - bounds.left,
                        bounds.bottom - bounds.top
                    )
                );
                assert_eq!(pos.flags, SWP_NOACTIVATE | SWP_NOZORDER);
                // A visibility / z-order-only operation must not resize the HWND.
                pos.flags |= SWP_NOMOVE | SWP_NOSIZE;
                pos.cx = 321;
                constrain_maximized_position(hwnd, &mut pos);
                assert_eq!(pos.cx, 321);
            });
            DestroyWindow(hwnd).unwrap();
            if let Err(panic) = result {
                std::panic::resume_unwind(panic);
            }
        }
    }

    fn flush_probe(hwnd: HWND) {
        unsafe {
            use windows::Win32::Graphics::Gdi::RDW_UPDATENOW;
            let _ = RedrawWindow(
                Some(hwnd),
                None,
                None,
                RDW_FRAME | RDW_INVALIDATE | RDW_UPDATENOW,
            );
            for _ in 0..20 {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    DispatchMessageW(&msg);
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }

    #[test]
    fn fullscreen_exit_restores_maximized_outer_bounds_and_restore_placement() {
        // Exercise the actual HWND operation without a WebView or application profile.
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("EReader fullscreen regression"),
                WS_OVERLAPPEDWINDOW,
                80,
                80,
                640,
                480,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let result = std::panic::catch_unwind(|| {
                let _ = ShowWindow(hwnd, SW_SHOWMAXIMIZED);
                let mut before = RECT::default();
                GetWindowRect(hwnd, &mut before).unwrap();
                let mut placement = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    ..Default::default()
                };
                GetWindowPlacement(hwnd, &mut placement).unwrap();
                // A fullscreen transition leaves WS_MAXIMIZE set and moves the bounds.
                SetWindowPos(hwnd, None, 0, 0, 1000, 700, SWP_NOZORDER | SWP_NOACTIVATE).unwrap();
                restore_maximized_bounds(hwnd, before).unwrap();
                let mut after = RECT::default();
                GetWindowRect(hwnd, &mut after).unwrap();
                assert_eq!(after, before);
                assert!(IsZoomed(hwnd).as_bool());
                let mut restored = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    ..Default::default()
                };
                GetWindowPlacement(hwnd, &mut restored).unwrap();
                assert_eq!(restored.rcNormalPosition, placement.rcNormalPosition);
                let _ = ShowWindow(hwnd, SW_RESTORE);
                assert!(!IsZoomed(hwnd).as_bool());
            });
            DestroyWindow(hwnd).unwrap();
            if let Err(panic) = result {
                std::panic::resume_unwind(panic);
            }
        }
    }

    #[test]
    fn printwindow_shadow_margins_are_painted_without_touching_client() {
        // No WebView/runtime or app profile is required. This exercises
        // the real GDI painter and PrintWindow, not just a copy of the geometry logic.
        unsafe {
            let instance = GetModuleHandleW(None).unwrap();
            let client_color = COLORREF(0x0030_2820);
            let brush = CreateSolidBrush(client_color);
            let class = WNDCLASSW {
                lpfnWndProc: Some(probe_proc),
                hInstance: instance.into(),
                hbrBackground: brush,
                lpszClassName: w!("EReaderFramePaintRegression"),
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&class), 0);
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                class.lpszClassName,
                w!(""),
                WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX,
                0,
                0,
                400,
                300,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .unwrap();
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let window_dc = GetWindowDC(Some(hwnd));
            let dc = CreateCompatibleDC(Some(window_dc));
            let bitmap = CreateCompatibleBitmap(window_dc, 400, 300);
            let old = SelectObject(dc, bitmap.into());
            let result = std::panic::catch_unwind(|| {
                flush_probe(hwnd);
                assert!(PrintWindow(hwnd, dc, 2).as_bool());
                let before = GetPixel(dc, 0, 150);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 1);
                flush_probe(hwnd);
                assert!(PrintWindow(hwnd, dc, 2).as_bool());
                assert_eq!(GetPixel(dc, 0, 150), FRAME_COLOR);
                assert_eq!(GetPixel(dc, 399, 150), FRAME_COLOR);
                assert_eq!(GetPixel(dc, 200, 0), FRAME_COLOR);
                assert_eq!(GetPixel(dc, 200, 299), FRAME_COLOR);
                assert_eq!(GetPixel(dc, 200, 150), client_color);
                assert_ne!(
                    before, FRAME_COLOR,
                    "the unpainted NC probe should reproduce the edge defect"
                );
            });
            SelectObject(dc, old);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(dc);
            ReleaseDC(Some(hwnd), window_dc);
            DestroyWindow(hwnd).unwrap();
            UnregisterClassW(class.lpszClassName, Some(instance.into())).unwrap();
            let _ = DeleteObject(brush.into());
            if let Err(panic) = result {
                std::panic::resume_unwind(panic);
            }
        }
    }
}
