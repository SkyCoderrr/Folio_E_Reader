# App icon

- `icon.svg` is the master (open two-page spread on the dark tile). It is drawn on an 8-unit grid, so edges land on whole pixels at 32, 64, 128 and 256 px.
- `icon-24.svg` is hand-tuned for 24 px (the taskbar at 100 % scale).
- `icon-16.svg` is hand-tuned for 16 px, pixel-exact (title bar, tray, small lists).
- `preview/` holds the shipped renders at 16/24/32/256 px, plus `zoom-small-sizes.png`. Its top row is on dark and its bottom row on light, in this order: 16 hand-tuned, 16 master (not shipped), 24 hand-tuned, 24 master (not shipped), 32, 48.

## Regenerate `src-tauri/icons/`

Run from the repo root (bash). `$T` is any scratch dir outside the repo.

```sh
npx tauri icon assets/icon/icon.svg -o "$T/full"            # standard Tauri set
npx tauri icon assets/icon/icon.svg -o "$T/m" -p 32 -p 48 -p 64 -p 256
npx tauri icon assets/icon/icon-24.svg -o "$T/s24" -p 24
npx tauri icon assets/icon/icon-16.svg -o "$T/s16" -p 16
cp "$T"/full/{32x32.png,64x64.png,128x128.png,128x128@2x.png,icon.png,icon.icns,StoreLogo.png} "$T"/full/Square*.png src-tauri/icons/
python -I assets/icon/make-ico.py src-tauri/icons/icon.ico "$T"/s16/16x16.png "$T"/s24/24x24.png "$T"/m/{32x32,48x48,64x64,256x256}.png
```

`make-ico.py` writes the ICO by hand so that each size uses its own render. The `tauri icon` ICO would downscale the master to 16 and 24 px, which blurs the spine. Entries up to 64 px are 32-bit BMP; the 256 px entry is PNG.

On Windows the exe icon resource is built from `icon.ico`. Tauri takes the window, taskbar and tray icons from that resource, so rebuild the app after changing it.
