//! Unzoomed viewport CSS pixels -> parent-client physical pixels, exactly once.
use crate::contract::{CaptionRects, Rect, ResizeDirection};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}
impl PhysicalRect {
    pub fn contains(self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
    fn overlaps(self, other: Self) -> bool {
        self.left < other.right
            && other.left < self.right
            && self.top < other.bottom
            && other.top < self.bottom
    }
}

pub fn scale_for_dpi(dpi: u32) -> Result<f64, &'static str> {
    if dpi == 0 {
        Err("DPI must be positive")
    } else {
        Ok(f64::from(dpi) / 96.0)
    }
}

pub fn resize_width(scale: f64) -> Result<i32, &'static str> {
    if !scale.is_finite() || scale <= 0.0 || scale * 6.0 > f64::from(i32::MAX) {
        return Err("Invalid DPI scale");
    }
    Ok((scale * 6.0).ceil() as i32)
}

/// The native frame outside the client area, in window-relative physical pixels.
/// Normal windows retain Tao's shadow insets; maximized/fullscreen have none.
/// Paint these bands only: neither a light reader surface nor WebView2 is covered.
pub fn nonclient_bands(
    width: i32,
    height: i32,
    client: PhysicalRect,
) -> Result<[PhysicalRect; 4], &'static str> {
    if width <= 0 || height <= 0 || client.right < client.left || client.bottom < client.top {
        return Err("Invalid native frame bounds");
    }
    let left = client.left.clamp(0, width);
    let right = client.right.clamp(0, width);
    let top = client.top.clamp(0, height);
    let bottom = client.bottom.clamp(0, height);
    Ok([
        PhysicalRect {
            left: 0,
            top: 0,
            right: width,
            bottom: top,
        },
        PhysicalRect {
            left: 0,
            top: bottom,
            right: width,
            bottom: height,
        },
        PhysicalRect {
            left: 0,
            top,
            right: left,
            bottom,
        },
        PhysicalRect {
            left: right,
            top,
            right: width,
            bottom,
        },
    ])
}

/// Physical monitor coordinates throughout, including negative monitor origins.
/// An auto-hide edge needs only a two-pixel reveal target, never a taskbar-height
/// reservation. Do not add another inset if rcWork already leaves enough room.
pub fn maximized_bounds(
    monitor: PhysicalRect,
    work: PhysicalRect,
    auto_hide: [bool; 4], // left, top, right, bottom
) -> PhysicalRect {
    PhysicalRect {
        left: work
            .left
            .max(monitor.left + if auto_hide[0] { 2 } else { 0 }),
        top: work.top.max(monitor.top + if auto_hide[1] { 2 } else { 0 }),
        right: work
            .right
            .min(monitor.right - if auto_hide[2] { 2 } else { 0 }),
        bottom: work
            .bottom
            .min(monitor.bottom - if auto_hide[3] { 2 } else { 0 }),
    }
}

#[cfg(test)]
mod maximized_tests {
    use super::*;

    #[test]
    fn visible_taskbar_uses_work_area_at_both_dpis() {
        for (monitor, work) in [
            (
                PhysicalRect {
                    left: 0,
                    top: 0,
                    right: 1920,
                    bottom: 1080,
                },
                PhysicalRect {
                    left: 0,
                    top: 0,
                    right: 1920,
                    bottom: 1032,
                },
            ),
            (
                PhysicalRect {
                    left: -2560,
                    top: -520,
                    right: 0,
                    bottom: 1080,
                },
                PhysicalRect {
                    left: -2560,
                    top: -520,
                    right: 0,
                    bottom: 1008,
                },
            ),
        ] {
            assert_eq!(maximized_bounds(monitor, work, [false; 4]), work);
        }
    }

    #[test]
    fn auto_hide_reveal_is_two_physical_pixels_on_each_monitor_edge() {
        for monitor in [
            PhysicalRect {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            },
            PhysicalRect {
                left: -2560,
                top: -520,
                right: 0,
                bottom: 1080,
            },
        ] {
            for edge in 0..4 {
                let mut auto_hide = [false; 4];
                auto_hide[edge] = true;
                let bounds = maximized_bounds(monitor, monitor, auto_hide);
                let insets = [
                    bounds.left - monitor.left,
                    bounds.top - monitor.top,
                    monitor.right - bounds.right,
                    monitor.bottom - bounds.bottom,
                ];
                for (index, inset) in insets.into_iter().enumerate() {
                    assert_eq!(inset, if index == edge { 2 } else { 0 });
                }
                // A one-pixel work-area reservation becomes two, not three.
                let one = PhysicalRect {
                    bottom: monitor.bottom - 1,
                    ..monitor
                };
                assert_eq!(
                    maximized_bounds(monitor, one, [false, false, false, true]).bottom,
                    monitor.bottom - 2
                );
                assert_eq!(maximized_bounds(monitor, bounds, auto_hide), bounds);
            }
        }
    }
}

pub fn caption_rects(
    rects: &CaptionRects,
    viewport: PhysicalRect,
    scale: f64,
) -> Result<[PhysicalRect; 3], &'static str> {
    resize_width(scale)?;
    let width = f64::from(viewport.right) - f64::from(viewport.left);
    let height = f64::from(viewport.bottom) - f64::from(viewport.top);
    if width <= 0.0 || height <= 0.0 || width > f64::from(i32::MAX) || height > f64::from(i32::MAX)
    {
        return Err("Empty viewport");
    }
    let css = [&rects.minimize, &rects.maximize, &rects.close];
    for r in css {
        if ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
            || r.width <= 0.0
            || r.height <= 0.0
            || r.x < 0.0
            || r.y < 0.0
            || (r.x + r.width) * scale > width + 1e-7
            || (r.y + r.height) * scale > height + 1e-7
        {
            return Err("Caption rectangle must be finite, positive and inside viewport");
        }
    }
    for i in 0..3 {
        for j in i + 1..3 {
            let (a, b) = (css[i], css[j]);
            if a.x < b.x + b.width
                && b.x < a.x + a.width
                && a.y < b.y + b.height
                && b.y < a.y + a.height
            {
                return Err("Caption rectangles overlap");
            }
        }
    }
    let convert = |r: &Rect| PhysicalRect {
        // Round shared boundaries identically: no overlaps from floor/ceil expansion.
        left: (r.x * scale).round() as i32 + viewport.left,
        top: (r.y * scale).round() as i32 + viewport.top,
        right: ((r.x + r.width) * scale).round() as i32 + viewport.left,
        bottom: ((r.y + r.height) * scale).round() as i32 + viewport.top,
    };
    let physical = css.map(convert);
    for (i, r) in physical.iter().enumerate() {
        if r.right <= r.left
            || r.bottom <= r.top
            || physical[i + 1..].iter().any(|other| r.overlaps(*other))
        {
            return Err("Caption rectangles collapse or overlap at this DPI");
        }
    }
    Ok(physical)
}

pub fn resize_hit(x: i32, y: i32, width: i32, height: i32, border: i32) -> Option<ResizeDirection> {
    use ResizeDirection::*;
    if x < 0 || y < 0 || x >= width || y >= height || border <= 0 {
        return None;
    }
    let (left, right, top, bottom) = (
        x < border,
        x >= width - border,
        y < border,
        y >= height - border,
    );
    match (left, right, top, bottom) {
        (true, _, true, _) => Some(NorthWest),
        (_, true, true, _) => Some(NorthEast),
        (true, _, _, true) => Some(SouthWest),
        (_, true, _, true) => Some(SouthEast),
        (true, _, _, _) => Some(West),
        (_, true, _, _) => Some(East),
        (_, _, true, _) => Some(North),
        (_, _, _, true) => Some(South),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rects() -> CaptionRects {
        let r = |x| Rect {
            x,
            y: 0.0,
            width: 46.0,
            height: 40.0,
        };
        CaptionRects {
            minimize: r(662.0),
            maximize: r(708.0),
            close: r(754.0),
        }
    }
    fn viewport(scale: f64) -> PhysicalRect {
        PhysicalRect {
            left: 0,
            top: 0,
            right: (800.0 * scale) as i32,
            bottom: (600.0 * scale) as i32,
        }
    }
    #[test]
    fn css_scaled_once_at_three_dpis() {
        for dpi in [96, 144, 192] {
            let s = scale_for_dpi(dpi).unwrap();
            let result = caption_rects(&rects(), viewport(s), s).unwrap();
            assert_eq!(result[1].right - result[1].left, (46.0 * s) as i32);
            assert_eq!(result[1].bottom, (40.0 * s) as i32);
            assert_eq!(result[1].right, result[2].left);
            assert_eq!(resize_width(s).unwrap(), (6.0 * s) as i32);
        }
    }
    #[test]
    fn viewport_origin_is_added_after_scaling() {
        let v = PhysicalRect {
            left: -2000,
            top: -50,
            right: -800,
            bottom: 850,
        };
        let p = caption_rects(&rects(), v, 1.5).unwrap();
        assert_eq!(p[0].left, -1007);
        assert_eq!(p[2].right, -800);
        assert_eq!(p[0].top, -50);
    }
    #[test]
    fn fractional_boundaries_are_shared() {
        let p = caption_rects(&rects(), viewport(1.25), 1.25).unwrap();
        assert_eq!(p[0].right, p[1].left);
        assert_eq!(resize_width(1.25).unwrap(), 8);
    }
    #[test]
    fn rejects_bad_scales() {
        for s in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::MAX] {
            assert!(caption_rects(&rects(), viewport(1.0), s).is_err());
        }
        assert!(scale_for_dpi(0).is_err());
    }
    #[test]
    fn rejects_nonfinite_coordinates_and_sizes() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for field in 0..4 {
                let mut r = rects();
                match field {
                    0 => r.close.x = value,
                    1 => r.close.y = value,
                    2 => r.close.width = value,
                    _ => r.close.height = value,
                }
                assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
            }
        }
    }
    #[test]
    fn rejects_nonpositive_dimensions() {
        for v in [0.0, -1.0] {
            let mut r = rects();
            r.close.width = v;
            assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
            r = rects();
            r.close.height = v;
            assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
        }
    }
    #[test]
    fn rejects_outside_viewport() {
        for (x, y) in [(-1.0, 0.0), (754.0, -1.0), (755.0, 0.0), (754.0, 561.0)] {
            let mut r = rects();
            r.close.x = x;
            r.close.y = y;
            assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
        }
    }
    #[test]
    fn rejects_overlap_but_accepts_touching_edges() {
        let mut r = rects();
        r.maximize.x -= 0.01;
        assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
        assert!(caption_rects(&rects(), viewport(1.0), 1.0).is_ok());
    }
    #[test]
    fn rejects_collapsed_physical_rectangles() {
        let mut r = rects();
        r.minimize.width = 0.01;
        assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
    }
    #[test]
    fn rejects_empty_viewport_and_overflow() {
        assert!(caption_rects(&rects(), PhysicalRect::default(), 1.0).is_err());
        let mut r = rects();
        r.close.x = f64::MAX;
        r.close.width = f64::MAX;
        assert!(caption_rects(&r, viewport(1.0), 1.0).is_err());
    }
    #[test]
    fn all_edges_and_corners_at_three_dpis() {
        use ResizeDirection::*;
        for s in [1.0, 1.5, 2.0] {
            let b = resize_width(s).unwrap();
            let (w, h) = (800, 600);
            for (x, y, expected) in [
                (0, 0, NorthWest),
                (w - 1, 0, NorthEast),
                (0, h - 1, SouthWest),
                (w - 1, h - 1, SouthEast),
                (0, 100, West),
                (w - 1, 100, East),
                (100, 0, North),
                (100, h - 1, South),
            ] {
                assert_eq!(resize_hit(x, y, w, h, b), Some(expected));
            }
            assert_eq!(resize_hit(b, b, w, h, b), None);
            assert_eq!(resize_hit(w - b - 1, h - b - 1, w, h, b), None);
        }
    }
    #[test]
    fn signed_outside_points_do_not_resize() {
        for (x, y) in [(-1, 1), (1, -1), (800, 1), (1, 600)] {
            assert_eq!(resize_hit(x, y, 800, 600, 6), None);
        }
    }
    #[test]
    fn hit_bounds_are_half_open() {
        let p = caption_rects(&rects(), viewport(1.0), 1.0).unwrap();
        assert!(!p[0].contains(708, 20));
        assert!(p[1].contains(708, 20));
        assert!(!p[1].contains(720, 40));
    }
    #[test]
    fn native_bands_partition_only_nonclient_pixels_at_three_dpis() {
        for (width, height, border, top) in [(100, 80, 8, 1), (150, 120, 12, 2), (200, 160, 16, 2)]
        {
            let client = PhysicalRect {
                left: border,
                top,
                right: width - border,
                bottom: height - border,
            };
            let bands = nonclient_bands(width, height, client).unwrap();
            for y in 0..height {
                for x in 0..width {
                    let count = bands.iter().filter(|r| r.contains(x, y)).count();
                    assert_eq!(
                        count,
                        usize::from(!client.contains(x, y)),
                        "({x},{y}) at {width}px"
                    );
                }
            }
        }
    }
    #[test]
    fn maximized_insets_do_not_paint_over_work_area() {
        // HWND extends 12px beyond work area at 150%: preserve Tao's client inset,
        // rather than scaling or subtracting it a second time in the WebView.
        let client = PhysicalRect {
            left: 12,
            top: 12,
            right: 1932,
            bottom: 1092,
        };
        let bands = nonclient_bands(1944, 1104, client).unwrap();
        for point in [(12, 12), (1931, 12), (12, 1091), (1931, 1091)] {
            assert!(bands.iter().all(|r| !r.contains(point.0, point.1)));
        }
        assert!(bands[0].contains(100, 11));
        assert!(bands[3].contains(1932, 100));
    }
    #[test]
    fn full_client_and_fullscreen_have_no_painted_bands() {
        let client = PhysicalRect {
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
        };
        for r in nonclient_bands(800, 600, client).unwrap() {
            assert!(r.right == r.left || r.bottom == r.top);
        }
    }
    #[test]
    fn native_bands_clip_client_extending_outside_window() {
        let client = PhysicalRect {
            left: -8,
            top: -8,
            right: 808,
            bottom: 608,
        };
        for r in nonclient_bands(800, 600, client).unwrap() {
            assert!(r.right == r.left || r.bottom == r.top);
        }
    }
    #[test]
    fn native_bands_reject_inverted_or_empty_bounds() {
        let client = PhysicalRect {
            left: 20,
            top: 20,
            right: 10,
            bottom: 10,
        };
        assert!(nonclient_bands(800, 600, client).is_err());
        assert!(nonclient_bands(0, 600, PhysicalRect::default()).is_err());
        assert!(nonclient_bands(800, -1, PhysicalRect::default()).is_err());
    }
}
