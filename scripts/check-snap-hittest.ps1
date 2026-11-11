# Non-intrusive Snap Layouts check: asks the window under the custom maximize button what WM_NCHITTEST returns
# (9 = HTMAXBUTTON, which is what Windows 11 needs to show the Snap Layouts flyout). Does not move the mouse.
param([int]$ProcessId)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Hit {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static IntPtr FindMain(uint want) { IntPtr f = IntPtr.Zero; int best = 0;
    EnumWindows((h,p)=>{ uint pid; GetWindowThreadProcessId(h,out pid); if(pid==want && IsWindowVisible(h)){ RECT r; GetWindowRect(h,out r); int a=(r.R-r.L)*(r.B-r.T); if(a>best){best=a;f=h;} } return true; }, IntPtr.Zero); return f; }
  public static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
}
"@
[Hit]::SetProcessDPIAware() | Out-Null
$h=[Hit]::FindMain([uint32]$ProcessId); $r=New-Object Hit+RECT; [Hit]::GetWindowRect($h,[ref]$r)|Out-Null; $scale=[Hit]::GetDpiForWindow($h)/96.0
"main hwnd=$h class=$([Hit]::Cls($h)) rect=$($r.L),$($r.T),$($r.R),$($r.B) scale=$scale"
$names=@{1='HTCLIENT';2='HTCAPTION';8='HTMINBUTTON';9='HTMAXBUTTON';20='HTCLOSE';12='HTTOP';14='HTTOPRIGHT'}
foreach ($b in @(@{n='close';i=0},@{n='maximize';i=1},@{n='minimize';i=2},@{n='title-area';i=6})) {
  $x=[int]($r.R - ($b.i*46 + 23)*$scale); $y=[int]($r.T + 20*$scale)
  $pt=New-Object Hit+POINT; $pt.X=$x; $pt.Y=$y; $w=[Hit]::WindowFromPoint($pt)
  $l=[IntPtr](($y -band 0xFFFF) -shl 16 -bor ($x -band 0xFFFF)); $res=[int][Hit]::SendMessage($w,0x84,[IntPtr]::Zero,$l)
  "{0,-10} at ({1},{2}) -> hwnd {3} [{4}] WM_NCHITTEST={5} {6}" -f $b.n,$x,$y,$w,[Hit]::Cls($w),$res,$names[$res]
}

