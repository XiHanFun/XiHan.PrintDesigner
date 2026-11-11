// Copyright (c) 2021-Present XiHanFun and contributors.
// Licensed under the MIT License. See LICENSE in the project root for license information.

//! 经 WinVerifyTrust 校验文件内嵌的 Authenticode 签名（含整条链的吊销检查），再核对签名者的 CN 或 O 是否为预期的发布者

use std::path::Path;

use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::Security::Cryptography::{CERT_CONTEXT, CERT_NAME_ATTR_TYPE, CERT_NAME_SIMPLE_DISPLAY_TYPE, CertGetNameStringW, szOID_ORGANIZATION_NAME};
use windows::Win32::Security::WinTrust::{
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOKE_WHOLECHAIN, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY,
    WTD_UI_NONE, WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
};
use windows::core::{HSTRING, PCWSTR};

use crate::SignatureState;

const TRUST_E_NOSIGNATURE: i32 = 0x800B0100_u32 as i32;

/// 校验文件签名与签名者
pub(crate) fn verify(path: &Path, publisher: &str) -> SignatureState {
    let file_path = HSTRING::from(path.as_os_str());
    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(file_path.as_ptr()),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_WHOLECHAIN,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
        dwStateAction: WTD_STATEACTION_VERIFY,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: data 与 file 在两次调用期间都有效
    let code = unsafe { WinVerifyTrust(HWND(-1isize as _), &mut action, (&mut data as *mut WINTRUST_DATA).cast()) };
    let names = if code == 0 { signer_names(data.hWVTStateData) } else { (None, None) };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: 关掉上一次校验留下的状态
    unsafe { WinVerifyTrust(HWND(-1isize as _), &mut action, (&mut data as *mut WINTRUST_DATA).cast()) };

    if code == TRUST_E_NOSIGNATURE {
        return SignatureState::Unsigned;
    }
    if code != 0 {
        return SignatureState::Untrusted(code);
    }
    let (common_name, organization) = names;
    let matches = |name: &Option<String>| !publisher.is_empty() && name.as_deref().is_some_and(|name| name.eq_ignore_ascii_case(publisher));
    if matches(&common_name) || matches(&organization) {
        SignatureState::Trusted
    } else {
        SignatureState::WrongPublisher(organization.or(common_name).unwrap_or_default())
    }
}

/// 签名者证书的 CN 与 O
fn signer_names(state: HANDLE) -> (Option<String>, Option<String>) {
    // SAFETY: state 是校验成功后留下的状态，在 STATEACTION_CLOSE 之前有效
    unsafe {
        let provider = WTHelperProvDataFromStateData(state);
        if provider.is_null() {
            return (None, None);
        }
        let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
        if signer.is_null() || (*signer).csCertChain == 0 || (*signer).pasCertChain.is_null() {
            return (None, None);
        }
        let certificate = (*(*signer).pasCertChain).pCert;
        if certificate.is_null() {
            return (None, None);
        }
        (
            name(certificate, CERT_NAME_SIMPLE_DISPLAY_TYPE, None),
            name(certificate, CERT_NAME_ATTR_TYPE, Some(szOID_ORGANIZATION_NAME.0.cast())),
        )
    }
}

/// 证书上的某个名字；没有时为 None
///
/// # Safety
/// certificate 必须指向有效的证书
unsafe fn name(certificate: *const CERT_CONTEXT, kind: u32, parameter: Option<*const core::ffi::c_void>) -> Option<String> {
    // SAFETY: 由调用方保证证书有效；先问长度再取
    let length = unsafe { CertGetNameStringW(certificate, kind, 0, parameter, None) };
    if length <= 1 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    // SAFETY: buffer 按上面问到的长度分配
    let written = unsafe { CertGetNameStringW(certificate, kind, 0, parameter, Some(&mut buffer)) };
    let text = String::from_utf16_lossy(&buffer[..written.saturating_sub(1) as usize]);
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_unsigned_files() {
        let path = std::env::temp_dir().join(format!("xihan-print-unsigned-{}.exe", std::process::id()));
        std::fs::write(&path, b"MZ not really").unwrap();
        assert!(matches!(verify(&path, "XiHanFun"), SignatureState::Unsigned | SignatureState::Untrusted(_)));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn checks_the_publisher_of_a_signed_system_file() {
        let notepad = Path::new(&std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into()))
            .join("System32")
            .join("WindowsPowerShell\\v1.0\\powershell.exe");
        if !notepad.exists() {
            return;
        }
        match verify(&notepad, "XiHanFun") {
            SignatureState::WrongPublisher(name) => assert!(name.contains("Microsoft"), "{name}"),
            SignatureState::Unsigned => {}
            other => panic!("意外的结论：{other:?}"),
        }
    }
}
