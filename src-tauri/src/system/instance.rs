use crate::{contract::AppError, storage::io_error};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows::{
    Win32::{
        Foundation::*,
        Security::{Authorization::*, *},
        Storage::FileSystem::*,
        System::{Pipes::*, Threading::*},
    },
    core::{PCWSTR, PWSTR},
};
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Handle(HANDLE);
impl Handle {
    fn raw(&self) -> HANDLE {
        self.0
    }
}
// Owned kernel handles may be transferred between threads; closed exactly once.
unsafe impl Send for Handle {}
unsafe impl Sync for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
pub struct Instance {
    _mutex: Handle,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}
impl Drop for Instance {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
struct Security(PSECURITY_DESCRIPTOR);
impl Drop for Security {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0.0)));
        }
    }
}
fn security() -> Result<Security, AppError> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(io_error)?;
        let token = Handle(token);
        let mut size = 0;
        let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        GetTokenInformation(
            token.0,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            size,
            &mut size,
        )
        .map_err(io_error)?;
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut sid = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut sid).map_err(io_error)?;
        let text = sid.to_string().map_err(io_error)?;
        let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
        let sddl = wide(&format!("D:P(A;;GA;;;{text})"));
        let mut descriptor = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            SDDL_REVISION_1,
            &mut descriptor,
            None,
        )
        .map_err(io_error)?;
        Ok(Security(descriptor))
    }
}
impl Instance {
    pub fn acquire(
        key: &str,
        on_show: impl Fn() + Send + 'static,
    ) -> Result<Option<Self>, AppError> {
        let descriptor = security()?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0.0,
            bInheritHandle: false.into(),
        };
        let mutex_name = wide(&format!(r"Local\{key}"));
        let mutex = Handle(
            unsafe { CreateMutexW(Some(&attributes), false, PCWSTR(mutex_name.as_ptr())) }
                .map_err(io_error)?,
        );
        let exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        // Local named pipes + user-only DACL. A fixed 4-byte show request, no paths or arbitrary payloads.
        let mut session = 0;
        unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &mut session) }.map_err(io_error)?;
        let pipe_name = wide(&format!(r"\\.\pipe\{key}.{session}"));
        if exists {
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if let Ok(pipe) = unsafe {
                    CreateFileW(
                        PCWSTR(pipe_name.as_ptr()),
                        GENERIC_WRITE.0,
                        FILE_SHARE_NONE,
                        None,
                        OPEN_EXISTING,
                        FILE_ATTRIBUTE_NORMAL,
                        None,
                    )
                } {
                    let pipe = Handle(pipe);
                    // The newly launched foreground process can transfer its focus permission
                    // to this profile's pipe server before asking that server to show its window.
                    let mut server_pid = 0;
                    if unsafe { GetNamedPipeServerProcessId(pipe.raw(), &mut server_pid) }.is_ok() {
                        let _ = unsafe {
                            windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(
                                server_pid,
                            )
                        };
                    }
                    let mut written = 0;
                    unsafe { WriteFile(pipe.raw(), Some(b"SHOW"), Some(&mut written), None) }
                        .map_err(io_error)?;
                    if written == 4 {
                        return Ok(None);
                    }
                }
                if Instant::now() >= deadline {
                    return Err(io_error("Existing profile instance did not accept handoff"));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
        let pipe = unsafe {
            CreateNamedPipeW(
                PCWSTR(pipe_name.as_ptr()),
                PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_MESSAGE
                    | PIPE_READMODE_MESSAGE
                    | PIPE_NOWAIT
                    | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                4,
                4,
                0,
                Some(&attributes),
            )
        };
        if pipe == INVALID_HANDLE_VALUE {
            return Err(io_error(windows::core::Error::from_thread()));
        }
        let pipe = Handle(pipe);
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let worker = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                let connected = unsafe { ConnectNamedPipe(pipe.raw(), None) };
                let error = unsafe { GetLastError() };
                if connected.is_ok() || error == ERROR_PIPE_CONNECTED || error == ERROR_NO_DATA {
                    let deadline = Instant::now() + Duration::from_millis(250);
                    loop {
                        let mut bytes = [0u8; 5];
                        let mut count = 0;
                        if unsafe { ReadFile(pipe.raw(), Some(&mut bytes), Some(&mut count), None) }
                            .is_ok()
                        {
                            if count == 4 && &bytes[..4] == b"SHOW" {
                                on_show();
                            }
                            break;
                        }
                        if Instant::now() >= deadline {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    unsafe {
                        let _ = DisconnectNamedPipe(pipe.raw());
                    }
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        });
        Ok(Some(Self {
            _mutex: mutex,
            stop,
            worker: Some(worker),
        }))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::Profile;
    #[test]
    fn same_profile_handoff_is_bounded_and_mutex_released() {
        let temp = tempfile::Builder::new()
            .prefix("ereader-test-")
            .tempdir()
            .unwrap();
        let profile = Profile::resolve(
            Some(temp.path().join("profile").into_os_string()),
            || panic!(),
        )
        .unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let first = Instance::acquire(&profile.key(), move || {
            send.send(()).unwrap();
        })
        .unwrap()
        .unwrap();
        assert!(
            Instance::acquire(&profile.key(), || panic!(
                "Secondary cannot become receiver"
            ))
            .unwrap()
            .is_none()
        );
        receive.recv_timeout(Duration::from_secs(1)).unwrap();
        drop(first);
        assert!(Instance::acquire(&profile.key(), || {}).unwrap().is_some());
    }
    #[test]
    fn different_profiles_run_independently() {
        let temp = tempfile::Builder::new()
            .prefix("ereader-test-")
            .tempdir()
            .unwrap();
        let a =
            Profile::resolve(Some(temp.path().join("a").into_os_string()), || panic!()).unwrap();
        let b =
            Profile::resolve(Some(temp.path().join("b").into_os_string()), || panic!()).unwrap();
        let _a = Instance::acquire(&a.key(), || {}).unwrap().unwrap();
        let _b = Instance::acquire(&b.key(), || {}).unwrap().unwrap();
    }
}
