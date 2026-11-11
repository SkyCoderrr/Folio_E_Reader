# Launch nothing. Run against an already running release build in .test-profile/.
# Example: powershell -File scripts/check-window-edges.ps1 -ProcessId 1234
# Exit codes: 0 = clean, 1 = light edge, 2 = capture/measurement failure.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$ProcessId,
    [string]$OutFile = '',
    [ValidateRange(1, 255)][double]$LightnessTolerance = 40,
    [ValidatePattern('^#[0-9a-fA-F]{6}$')][string]$ShellBackground = '#111214'
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $OutFile) {
        $repoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
        $OutFile = Join-Path $repoRoot ".test-profile/edges/window-$ProcessId.png"
    }
    Add-Type -AssemblyName System.Drawing
    if (-not ('EReaderEdgeCheck' -as [type])) {
        Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class EReaderEdgeCheck {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref Point p);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref MonitorInfo m);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out Rect v, int size);
    [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int DwmGetUInt(IntPtr h, int a, out uint v, int size);
    public class Edge {
        public string Side, BrightestRgb, InnerRgb;
        public int X, Y, Samples, LightPixels;
        public double Brightest = -1, InnerAtBrightest, MaxDelta = -255;
    }
    public class Result {
        public string WindowBounds, VisibleBounds, ClientBounds;
        public uint Dpi, BorderColor, BorderThickness;
        public bool Maximized, Failed;
        public Edge[] Edges;
    }
    static double Luma(Color c) { return .2126*c.R + .7152*c.G + .0722*c.B; }
    static string Rgb(Color c) { return String.Format("#{0:X2}{1:X2}{2:X2}",c.R,c.G,c.B); }
    static string Bounds(Rect r) { return String.Format("{0},{1}..{2},{3}",r.L,r.T,r.R,r.B); }
    static Rect Intersect(Rect a, Rect b) { return new Rect { L=Math.Max(a.L,b.L), T=Math.Max(a.T,b.T), R=Math.Min(a.R,b.R), B=Math.Min(a.B,b.B) }; }
    public static Result Capture(uint pid, string path, double tolerance, string shell) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            IntPtr hwnd=IntPtr.Zero; long best=0;
            EnumWindows((h,p) => { uint id; GetWindowThreadProcessId(h,out id); Rect r;
                if(id==pid && IsWindowVisible(h) && !IsIconic(h) && GetWindowRect(h,out r)) {
                    long area=(long)(r.R-r.L)*(r.B-r.T); if(area>best) { best=area; hwnd=h; }
                } return true;
            },IntPtr.Zero);
            if(hwnd==IntPtr.Zero) throw new InvalidOperationException("No visible, non-minimized window for this process.");
            Rect outer, visible, client; Point origin=new Point();
            if(!GetWindowRect(hwnd,out outer) || !GetClientRect(hwnd,out client) || !ClientToScreen(hwnd,ref origin))
                throw new InvalidOperationException("Cannot read window/client bounds.");
            if(DwmGetWindowAttribute(hwnd,9,out visible,Marshal.SizeOf(typeof(Rect)))!=0) visible=outer;
            visible=Intersect(visible,outer);
            // GetWindowRect includes invisible resize margins. Maximized windows also extend
            // off monitor: measure the visible frame, never black PrintWindow padding.
            if(IsZoomed(hwnd)) {
                MonitorInfo m=new MonitorInfo { Size=Marshal.SizeOf(typeof(MonitorInfo)) };
                if(!GetMonitorInfo(MonitorFromWindow(hwnd,2),ref m)) throw new InvalidOperationException("Cannot read monitor work area.");
                visible=Intersect(visible,m.Work);
            }
            Result result=new Result { WindowBounds=Bounds(outer), VisibleBounds=Bounds(visible),
                ClientBounds=String.Format("{0},{1}..{2},{3}",origin.X,origin.Y,origin.X+client.R,origin.Y+client.B),
                Dpi=GetDpiForWindow(hwnd), Maximized=IsZoomed(hwnd) };
            DwmGetUInt(hwnd,34,out result.BorderColor,4); DwmGetUInt(hwnd,37,out result.BorderThickness,4);
            int width=outer.R-outer.L, height=outer.B-outer.T;
            if(width<64 || height<64 || visible.R-visible.L<64 || visible.B-visible.T<64)
                throw new InvalidOperationException("Window is too small to measure: outer="+Bounds(outer)+" visible="+Bounds(visible));
            using(Bitmap bmp=new Bitmap(width,height,PixelFormat.Format32bppArgb)) {
                using(Graphics g=Graphics.FromImage(bmp)) {
                    // Sentinel distinguishes failed/empty captures from genuinely dark content.
                    g.Clear(Color.Magenta); IntPtr dc=g.GetHdc();
                    try { if(!PrintWindow(hwnd,dc,2)) throw new InvalidOperationException("PrintWindow failed."); }
                    finally { g.ReleaseHdc(dc); }
                }
                bmp.Save(path,ImageFormat.Png);
                int l=visible.L-outer.L,t=visible.T-outer.T,r=visible.R-outer.L,b=visible.B-outer.T;
                Color center=bmp.GetPixel((l+r)/2,(t+b)/2);
                if(center.ToArgb()==Color.Magenta.ToArgb() || center.ToArgb()==Color.Black.ToArgb())
                    throw new InvalidOperationException("PrintWindow returned an empty/sentinel center; capture is inconclusive.");
                int corner=Math.Max(32,(int)Math.Ceiling(32*result.Dpi/96.0));
                int inset=Math.Max(8,(int)Math.Ceiling(8*result.Dpi/96.0));
                double background=Luma(ColorTranslator.FromHtml(shell));
                result.Edges=new Edge[4];
                for(int side=0;side<4;side++) {
                    Edge e=new Edge { Side=new[]{"left","right","top","bottom"}[side] }; result.Edges[side]=e;
                    int start=side<2?t+corner:l+corner, end=side<2?b-corner:r-corner;
                    for(int along=start;along<end;along++) for(int depth=0;depth<3;depth++) {
                        int x=side==0?l+depth:side==1?r-1-depth:along;
                        int y=side==2?t+depth:side==3?b-1-depth:along;
                        int ix=side==0?l+inset:side==1?r-1-inset:x;
                        int iy=side==2?t+inset:side==3?b-1-inset:y;
                        Color pixel=bmp.GetPixel(x,y), inner=bmp.GetPixel(ix,iy);
                        double light=Luma(pixel), inside=Luma(inner), delta=light-inside;
                        e.Samples++; e.MaxDelta=Math.Max(e.MaxDelta,delta);
                        if(light>e.Brightest) { e.Brightest=light; e.InnerAtBrightest=inside; e.BrightestRgb=Rgb(pixel); e.InnerRgb=Rgb(inner); e.X=x; e.Y=y; }
                        // Pair with the local inward UI pixel so a light reading surface is
                        // valid, while a white stroke outside a dark shell is rejected.
                        if(light>background+tolerance && delta>tolerance) e.LightPixels++;
                    }
                    if(e.Samples==0) throw new InvalidOperationException("No straight-edge samples; enlarge window.");
                    result.Failed |= e.LightPixels>0;
                }
            }
            return result;
        } finally { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
    }
}
'@
    }
    $absolute = [System.IO.Path]::GetFullPath($OutFile)
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($absolute)) | Out-Null
    $result = [EReaderEdgeCheck]::Capture([uint32]$ProcessId, $absolute, $LightnessTolerance, $ShellBackground)
    Write-Output "PrintWindow: $absolute; DPI=$($result.Dpi); maximized=$($result.Maximized)"
    Write-Output "Window=$($result.WindowBounds); visible=$($result.VisibleBounds); client=$($result.ClientBounds)"
    Write-Output ('DWM border COLORREF=0x{0:X8}; thickness={1}; shell={2}; tolerance={3}' -f $result.BorderColor, $result.BorderThickness, $ShellBackground, $LightnessTolerance)
    $result.Edges | Select-Object Side, BrightestRgb, InnerRgb, X, Y,
        @{n='Brightest';e={[Math]::Round($_.Brightest,2)}},
        @{n='MaxDelta';e={[Math]::Round($_.MaxDelta,2)}}, LightPixels, Samples | Format-Table -AutoSize | Out-String | Write-Output
    if ($result.Failed) { Write-Output 'FAIL: light pixels in the outer 3 physical pixels of the visible frame.'; exit 1 }
    Write-Output 'PASS: no light edge detected (rounded corners and invisible resize margins excluded).'
    exit 0
} catch {
    Write-Error -ErrorAction Continue $_
    exit 2
}
