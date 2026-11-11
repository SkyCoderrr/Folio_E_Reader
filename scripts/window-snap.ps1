# Dev-only: snap a test window (by pid) with Win+Left, or capture the real screen around it (incl. 12 px of desktop) to check edges as the user sees them.
param([Parameter(Mandatory)][int]$ProcessId, [ValidateSet('snap','unsnap','screen')][string]$Action = 'screen', [string]$OutFile = '')
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class WinSnap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  public static IntPtr Find(uint want) { IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == want && IsWindowVisible(h) && found == IntPtr.Zero) found = h; return true; }, IntPtr.Zero); return found; }
}
"@
[WinSnap]::SetProcessDPIAware() | Out-Null
$h = [WinSnap]::Find([uint32]$ProcessId); if ($h -eq [IntPtr]::Zero) { throw "no window" }
[WinSnap]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 300
if ($Action -ne 'screen') {
  $arrow = if ($Action -eq 'snap') { 0x25 } else { 0x27 }
  [WinSnap]::keybd_event(0x5B,0,0,[UIntPtr]::Zero); [WinSnap]::keybd_event($arrow,0,0,[UIntPtr]::Zero); [WinSnap]::keybd_event($arrow,0,2,[UIntPtr]::Zero); [WinSnap]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900; [WinSnap]::keybd_event(0x1B,0,0,[UIntPtr]::Zero); [WinSnap]::keybd_event(0x1B,0,2,[UIntPtr]::Zero); "sent $Action"; return
}
$r = New-Object WinSnap+RECT; [WinSnap]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
$pad = 12; $x = [Math]::Max(0, $r.L - $pad); $y = [Math]::Max(0, $r.T - $pad); $w = ($r.R - $r.L) + 2*$pad; $hh = ($r.B - $r.T) + 2*$pad
$bmp = New-Object System.Drawing.Bitmap $w, $hh; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $g.Dispose()
# scan the 3 px just inside the visible frame on left/right for light pixels
$light = 0; foreach ($side in @(($r.L - $x), ($r.R - $x - 1))) { for ($yy = ($r.T - $y + 40); $yy -lt ($r.B - $y - 40); $yy += 4) { for ($d = 0; $d -lt 2; $d++) { $px = $side + $(if ($side -lt 20) { $d } else { -$d }); if ($px -ge 0 -and $px -lt $w -and $yy -lt $hh) { $c = $bmp.GetPixel($px, $yy); if (($c.R + $c.G + $c.B) / 3 -gt 90) { $light++ } } } } }
New-Item -ItemType Directory -Force (Split-Path $OutFile) | Out-Null; $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
"screen capture $OutFile frame=$($r.L),$($r.T),$($r.R),$($r.B) lightEdgePixels=$light"
