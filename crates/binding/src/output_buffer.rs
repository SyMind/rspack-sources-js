//! Source-backed Buffers and every view of their ArrayBuffer are read-only by
//! contract. Node permits writes, which would violate Rust's shared references
//! and, for string storage, its UTF-8 invariant. Copy before writing.
use std::{borrow::Cow, ffi::c_void, ptr, sync::Arc};

use napi::{Result, bindgen_prelude::*, check_status, sys};
use rspack_sources::{SourceRef, SourceValue};

pub struct OutputBuffer(Storage);

enum Storage {
    Owned(Vec<u8>),
    Borrowed {
        data: *const u8,
        len: usize,
        owner: Arc<SourceRef>,
    },
}

impl OutputBuffer {
    pub(crate) fn owned(bytes: Vec<u8>) -> Self {
        Self(Storage::Owned(bytes))
    }

    /// `bytes` must be part of the immutable source graph rooted at `owner`
    /// and stay at the same address until that owner is dropped.
    pub(crate) unsafe fn borrowed(owner: &Arc<SourceRef>, bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self::owned(Vec::new());
        }
        Self(Storage::Borrowed {
            data: bytes.as_ptr(),
            len: bytes.len(),
            owner: owner.clone(),
        })
    }

    /// The borrowed variant must satisfy the lifetime requirements of borrowed().
    unsafe fn from_cow(owner: &Arc<SourceRef>, bytes: Cow<'_, [u8]>) -> Self {
        match bytes {
            Cow::Owned(bytes) => Self::owned(bytes),
            Cow::Borrowed(bytes) => unsafe { Self::borrowed(owner, bytes) },
        }
    }

    pub(crate) fn buffer(owner: &Arc<SourceRef>) -> Self {
        // Source::buffer ties its borrow to this exact source.
        unsafe { Self::from_cow(owner, owner.buffer()) }
    }

    pub(crate) fn source(owner: &Arc<SourceRef>) -> Either<String, Self> {
        match owner.source() {
            SourceValue::String(text) => Either::A(text.into_owned()),
            SourceValue::Buffer(bytes) => Either::B(unsafe { Self::from_cow(owner, bytes) }),
        }
    }
}

unsafe extern "C" fn release_owner(_: sys::napi_env, _: *mut c_void, hint: *mut c_void) {
    drop(unsafe { Arc::from_raw(hint.cast::<SourceRef>()) });
}

impl ToNapiValue for OutputBuffer {
    unsafe fn to_napi_value(env: sys::napi_env, value: Self) -> Result<sys::napi_value> {
        let (data, len, owner) = match value.0 {
            Storage::Owned(bytes) => return unsafe { Buffer::to_napi_value(env, bytes.into()) },
            Storage::Borrowed { data, len, owner } => (data, len, owner),
        };

        let mut result = ptr::null_mut();
        if !cfg!(target_family = "wasm") {
            // The backing store retains its owner even when only a subarray or
            // DataView survives. Never manufacture a mutable Rust slice here.
            let hint = Arc::into_raw(owner.clone()).cast_mut().cast();
            let status = unsafe {
                sys::napi_create_external_buffer(
                    env,
                    len,
                    data.cast_mut().cast(),
                    Some(release_owner),
                    hint,
                    &mut result,
                )
            };
            if status == sys::Status::napi_ok {
                return Ok(result);
            }
            // Node's Buffer::New invokes the deleter on creation failure once it
            // has taken ownership (reported by Node-API as napi_generic_failure).
            // Argument/preamble errors and sandbox rejection precede adoption.
            if status != sys::Status::napi_generic_failure {
                unsafe { release_owner(env, ptr::null_mut(), hint) };
            }
            if status != sys::Status::napi_no_external_buffers_allowed {
                check_status!(status, "Failed to create a Source-backed Buffer")?;
            }
        }
        // Sandboxed V8 cannot expose external pointers. emnapi's external
        // views can be detached on wasm memory growth. Keep owner live for the copy.
        check_status!(unsafe {
            sys::napi_create_buffer_copy(env, len, data.cast(), ptr::null_mut(), &mut result)
        })?;
        Ok(result)
    }
}
