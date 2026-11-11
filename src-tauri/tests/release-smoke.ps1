param([string]$Exe = "$PSScriptRoot/../target/release/e-reader.exe", [switch]$Baseline, [switch]$SkipColdBudget, [switch]$SoftwareRendering)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath("$PSScriptRoot/../..")
$profile = Join-Path $workspace ('.test-profile/native-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile | Out-Null
$env:E_READER_PROFILE_DIR = $profile
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--enable-logging --log-file="' + (Join-Path $profile 'webview2.log') + '"'
if ($SoftwareRendering) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS += ' --disable-gpu --disable-gpu-compositing --disable-gpu-rasterization --disable-software-rasterizer' }
[IO.File]::WriteAllText((Join-Path $profile 'settings.json'), '{"version":1,"bossKey":{"enabled":true,"shortcut":"Ctrl+Alt+B"}}')
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeNative {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr value);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr value);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder value, int size);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd,int index);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd,uint cmd);
  public static IntPtr[] Windows(int pid) { var list=new List<IntPtr>(); EnumWindows((hwnd,unused)=>{uint id;GetWindowThreadProcessId(hwnd,out id);if(id==pid)list.Add(hwnd);return true;},IntPtr.Zero);return list.ToArray(); }
  public static string Title(IntPtr hwnd) {var value=new StringBuilder(1024);GetWindowText(hwnd,value,value.Capacity);return value.ToString();}
  public static string Class(IntPtr hwnd) {var value=new StringBuilder(1024);GetClassName(hwnd,value,value.Capacity);return value.ToString();}
  [DllImport("advapi32.dll")] static extern IntPtr OpenThreadWaitChainSession(uint flags,IntPtr callback);
  [DllImport("advapi32.dll")] static extern bool GetThreadWaitChain(IntPtr session,IntPtr context,uint flags,uint thread,ref uint count,IntPtr nodes,out bool cycle);
  [DllImport("advapi32.dll")] static extern void CloseThreadWaitChainSession(IntPtr session);
  public static string Chain(uint thread) {var session=OpenThreadWaitChainSession(0,IntPtr.Zero);var nodes=Marshal.AllocHGlobal(280*16);try {uint count=16;bool cycle;if(!GetThreadWaitChain(session,IntPtr.Zero,7,thread,ref count,nodes,out cycle))return "unavailable";var text=new StringBuilder("cycle="+cycle);for(int i=0;i<count;i++){var node=IntPtr.Add(nodes,i*280);int type=Marshal.ReadInt32(node);text.Append(" [type="+type+" status="+Marshal.ReadInt32(node,4));if(type==8)text.Append(" pid="+Marshal.ReadInt32(node,8)+" tid="+Marshal.ReadInt32(node,12));else text.Append(" object="+Marshal.PtrToStringUni(IntPtr.Add(node,8),128).TrimEnd('\0'));text.Append("]");}return text.ToString();}finally {Marshal.FreeHGlobal(nodes);CloseThreadWaitChainSession(session);}}
  public static IntPtr FindMain(int pid) {foreach(var hwnd in Windows(pid))if(Title(hwnd)=="Folio" && Class(hwnd)=="Tauri Window")return hwnd;return IntPtr.Zero;}
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out uint data,uint size,IntPtr needed);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
  public static string LaunchContext() {uint flags;var job=QueryInformationJobObject(IntPtr.Zero,4,out flags,4,IntPtr.Zero);using(var identity=System.Security.Principal.WindowsIdentity.GetCurrent())return "restrictedToken="+IsTokenRestricted(identity.Token)+" jobUiFlags="+(job?flags.ToString():"unavailable");}
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,IntPtr buffer,uint size,out uint needed);
  public static string CommandLine(int pid) {var handle=OpenProcess(0x1000,false,pid);if(handle==IntPtr.Zero)return "";IntPtr buffer=IntPtr.Zero;try{uint needed;NtQueryInformationProcess(handle,60,IntPtr.Zero,0,out needed);if(needed==0)return "";buffer=Marshal.AllocHGlobal((int)needed);if(NtQueryInformationProcess(handle,60,buffer,needed,out needed)!=0)return "";return Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer,8),Marshal.ReadInt16(buffer)/2);}finally{if(buffer!=IntPtr.Zero)Marshal.FreeHGlobal(buffer);CloseHandle(handle);}}
  public static bool TaskbarCandidate(IntPtr hwnd) {long ex=GetWindowLongPtrW(hwnd,-20).ToInt64();return IsWindowVisible(hwnd) && ((ex&0x40000)!=0 || ((ex&0x80)==0 && GetWindow(hwnd,4)==IntPtr.Zero));}
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
  [StructLayout(LayoutKind.Sequential)] struct IconId {public uint size;public IntPtr hwnd;public uint id;public Guid guid;}
  [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref IconId icon,out Rect rect);
  public static bool TrayPresent(int pid) {foreach(var hwnd in Windows(pid))for(uint id=0;id<32;id++){var icon=new IconId{size=(uint)Marshal.SizeOf(typeof(IconId)),hwnd=hwnd,id=id};Rect rect;if(Shell_NotifyIconGetRect(ref icon,out rect)==0)return true;}return false;}
  [StructLayout(LayoutKind.Sequential)] struct Keyboard {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Explicit,Size=32)] struct InputUnion {[FieldOffset(0)]public Keyboard keyboard;}
  [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public InputUnion data;}
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  public static void Boss() {ushort[] keys={0x11,0x12,0x42,0x42,0x12,0x11};var inputs=new Input[keys.Length];for(int i=0;i<keys.Length;i++)inputs[i]=new Input{type=1,data=new InputUnion{keyboard=new Keyboard{vk=keys[i],flags=(uint)(i>=3?2:0)}}};if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input)))!=inputs.Length)throw new Exception("SendInput failed "+Marshal.GetLastWin32Error());}
}
'@
$owned = [Collections.Generic.List[Diagnostics.Process]]::new()
function Wait-Condition([scriptblock]$Condition, [int]$Budget=2000) {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $Budget) { if (& $Condition) { return $watch.ElapsedMilliseconds }; Start-Sleep -Milliseconds 5 }
    throw "Condition timed out after ${Budget}ms"
}
try {
    [SmokeNative]::LaunchContext()
    $timer=[Diagnostics.Stopwatch]::StartNew()
    # Normal show mode lets observed visibility reflect the app's own startup.
    $process=Start-Process -FilePath ([IO.Path]::GetFullPath($Exe)) -PassThru
    $owned.Add($process)
    $null=Wait-Condition { $script:hwnd=[SmokeNative]::FindMain($process.Id); $script:hwnd -ne [IntPtr]::Zero -and [SmokeNative]::IsWindowVisible($script:hwnd) } 30000
    $cold=$timer.ElapsedMilliseconds
    $logPath=Join-Path $profile 'logs/e_reader.log'
    if (!$Baseline) {
        $null=Wait-Condition { [SmokeNative]::TrayPresent($process.Id) }
        $hide=0
        foreach ($mode in @('normal','maximized','minimized')) {
            if ($mode -eq 'maximized') { $null=[SmokeNative]::ShowWindow($script:hwnd,3) }
            if ($mode -eq 'minimized') { $null=[SmokeNative]::ShowWindow($script:hwnd,6) }
            [SmokeNative]::Boss()
            $hide=Wait-Condition { ![SmokeNative]::IsWindowVisible($script:hwnd) } 500
            if ([SmokeNative]::TaskbarCandidate($script:hwnd)) { throw 'Hidden window remains a taskbar candidate' }
            if ($hide -ge 100) { throw "Hide latency ${hide}ms exceeds budget" }
            # Released events must not toggle a second time.
            Start-Sleep -Milliseconds 100
            if ([SmokeNative]::IsWindowVisible($script:hwnd)) { throw 'Release toggled the window' }
            if (![SmokeNative]::TrayPresent($process.Id)) { throw 'Tray disappeared while hidden' }
            [SmokeNative]::Boss()
            $null=Wait-Condition { [SmokeNative]::IsWindowVisible($script:hwnd) -and ![SmokeNative]::IsIconic($script:hwnd) -and [SmokeNative]::GetForegroundWindow() -eq $script:hwnd }
            if ($mode -eq 'maximized' -and ![SmokeNative]::IsZoomed($script:hwnd)) { throw 'Maximized state lost' }
        }
        [SmokeNative]::Boss()
        $null=Wait-Condition { ![SmokeNative]::IsWindowVisible($script:hwnd) }
        $second=Start-Process -FilePath ([IO.Path]::GetFullPath($Exe)) -PassThru
        $owned.Add($second)
        $null=Wait-Condition { [SmokeNative]::IsWindowVisible($script:hwnd) -and [SmokeNative]::GetForegroundWindow() -eq $script:hwnd }
        if (!$second.WaitForExit(3000) -or $second.ExitCode -ne 0) { throw 'Second instance failed handoff' }
        $null=Wait-Condition { (Get-Content -Raw $logPath).Contains('boss shown source=secondInstance') }
        $log=Get-Content -Raw $logPath
        $last=-1
        foreach ($marker in @('Profile instance acquired','Settings loaded','Asset scope configured','window build begin','WebView2 ready','boss ready','Tray installed','Main window shown')) {
            $at=$log.IndexOf($marker)
            if ($at -le $last) { throw "Startup ordering failed at $marker" }; $last=$at
        }
    }
    [pscustomobject]@{ Profile=$profile; Pid=$process.Id; Hwnd=$script:hwnd.ToInt64(); ColdVisibleMs=$cold; LastHideMs=$hide; Visible=[SmokeNative]::IsWindowVisible($script:hwnd); Focused=([SmokeNative]::GetForegroundWindow() -eq $script:hwnd); ExStyle=('0x{0:X}' -f [SmokeNative]::GetWindowLongPtrW($script:hwnd,-20).ToInt64()); Tray=[SmokeNative]::TrayPresent($process.Id) } | ConvertTo-Json
    Get-Content $logPath
    if (!$SkipColdBudget -and $cold -ge 1500) { throw "Cold visible latency ${cold}ms exceeds 1500ms" }
} catch {
    "Smoke failed in $profile (PID $($process.Id))"
    Get-Content (Join-Path $profile 'logs/e_reader.log') -ErrorAction SilentlyContinue
    foreach ($handle in [SmokeNative]::Windows($process.Id)) { "HWND=$handle class=$([SmokeNative]::Class($handle)) title=$([SmokeNative]::Title($handle)) visible=$([SmokeNative]::IsWindowVisible($handle))" }
    $process.Refresh()
    foreach ($thread in $process.Threads) { "Thread=$($thread.Id) $([SmokeNative]::Chain($thread.Id))" }
    Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object { $line=[SmokeNative]::CommandLine($_.Id); if ($line.Contains($profile)) { "WebView PID=$($_.Id) $line" } }
    throw
} finally {
    foreach ($process in $owned) { if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue } }
    Get-Process msedgewebview2 -ErrorAction SilentlyContinue | ForEach-Object { if ([SmokeNative]::CommandLine($_.Id).Contains($profile)) { Stop-Process -Id $_.Id -ErrorAction SilentlyContinue } }
}
