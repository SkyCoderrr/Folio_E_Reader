# Dev-only: real mouse click / double-click at window-client CSS coords of a test window, and report IsZoomed.
param([Parameter(Mandatory)][int]$ProcessId, [double]$X = -1, [double]$Y = -1, [double]$Scale = 1, [switch]$Double, [switch]$Hover, [switch]$Query, [switch]$Restore, [int]$HoverMs = 400, [int]$DragX = 0, [int]$DragY = 0)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Clk {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  public static bool Foreground(IntPtr h) {
    uint pid; uint fore = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint current = GetCurrentThreadId(); bool attached = fore != current && AttachThreadInput(current, fore, true);
    try { BringWindowToTop(h); SetForegroundWindow(h); } finally { if(attached) AttachThreadInput(current, fore, false); }
    return GetForegroundWindow() == h;
  }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static IntPtr Find(uint want) { IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == want && IsWindowVisible(h) && found == IntPtr.Zero) found = h; return true; }, IntPtr.Zero); return found; }
}
"@
[Clk]::SetProcessDPIAware() | Out-Null
$h = [Clk]::Find([uint32]$ProcessId); if ($h -eq [IntPtr]::Zero) { throw 'no window' }
if ($Restore) { [Clk]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 700 }
if (-not $Query -and -not $Restore) {
  if (-not [Clk]::Foreground($h)) { throw 'Cannot foreground the test window; no input sent' }; Start-Sleep -Milliseconds 200
  $p = New-Object Clk+POINT; $p.X = [int]($X * $Scale); $p.Y = [int]($Y * $Scale); [Clk]::ClientToScreen($h, [ref]$p) | Out-Null
  [Clk]::SetCursorPos($p.X, $p.Y) | Out-Null; Start-Sleep -Milliseconds $HoverMs
  if ([Clk]::GetForegroundWindow() -ne $h -or [Clk]::GetAncestor([Clk]::WindowFromPoint($p), 2) -ne $h) { throw 'Test window is not under the pointer; no click sent' }
  if (-not $Hover) { $n = if ($Double) { 2 } else { 1 }; for ($i = 0; $i -lt $n; $i++) { [Clk]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; if ($DragX -ne 0 -or $DragY -ne 0) { for ($step = 1; $step -le 10; $step++) { [Clk]::SetCursorPos(($p.X + $DragX * $step / 10), ($p.Y + $DragY * $step / 10)) | Out-Null; Start-Sleep -Milliseconds 30 } }; [Clk]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80 } }
  Start-Sleep -Milliseconds 700
}
"zoomed=$([Clk]::IsZoomed($h))"
"minimized=$([Clk]::IsIconic($h))"
$client = New-Object Clk+RECT; [Clk]::GetClientRect($h, [ref]$client) | Out-Null
$outer = New-Object Clk+RECT; [Clk]::GetWindowRect($h, [ref]$outer) | Out-Null
"client=$($client.R),$($client.B) outer=$($outer.L),$($outer.T),$($outer.R),$($outer.B)"
