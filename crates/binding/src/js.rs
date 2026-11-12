use crate::invalid;
use napi::{Result, bindgen_prelude::*, sys};
use std::ptr;

pub(crate) fn check(status: sys::napi_status) -> Result<()> {
    if status == sys::Status::napi_ok {
        Ok(())
    } else {
        Err(Error::new(
            Status::from(status),
            "Source bridge operation failed",
        ))
    }
}

// Scope-local handles. A Js never escapes the N-API callback which roots it.
#[derive(Clone, Copy)]
pub(crate) struct Js {
    pub(crate) env: sys::napi_env,
    pub(crate) raw: sys::napi_value,
}

impl Js {
    pub(crate) fn make(
        env: sys::napi_env,
        f: impl FnOnce(*mut sys::napi_value) -> sys::napi_status,
    ) -> Result<Self> {
        let mut raw = ptr::null_mut();
        check(f(&mut raw))?;
        Ok(Self { env, raw })
    }

    pub(crate) fn undefined(env: sys::napi_env) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_get_undefined(env, p) })
    }

    pub(crate) fn null(env: sys::napi_env) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_get_null(env, p) })
    }

    pub(crate) fn boolean(env: sys::napi_env, v: bool) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_get_boolean(env, v, p) })
    }

    pub(crate) fn number(env: sys::napi_env, v: f64) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_create_double(env, v, p) })
    }

    pub(crate) fn string(env: sys::napi_env, v: &str) -> Result<Self> {
        Self::make(env, |p| unsafe {
            sys::napi_create_string_utf8(env, v.as_ptr().cast(), v.len() as isize, p)
        })
    }

    pub(crate) fn utf16(env: sys::napi_env, v: &[u16]) -> Result<Self> {
        Self::make(env, |p| unsafe {
            sys::napi_create_string_utf16(env, v.as_ptr(), v.len() as isize, p)
        })
    }

    pub(crate) fn object(env: sys::napi_env) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_create_object(env, p) })
    }

    pub(crate) fn array(env: sys::napi_env, values: &[Self]) -> Result<Self> {
        let a = Self::make(env, |p| unsafe {
            sys::napi_create_array_with_length(env, values.len(), p)
        })?;
        for (i, v) in values.iter().enumerate() {
            a.set_index(i, *v)?;
        }
        Ok(a)
    }

    pub(crate) fn buffer(env: sys::napi_env, bytes: &[u8]) -> Result<Self> {
        Self::make(env, |p| unsafe {
            sys::napi_create_buffer_copy(
                env,
                bytes.len(),
                bytes.as_ptr().cast(),
                ptr::null_mut(),
                p,
            )
        })
    }

    pub(crate) fn global(env: sys::napi_env, name: &str) -> Result<Self> {
        Self::make(env, |p| unsafe { sys::napi_get_global(env, p) })?.get(name)
    }

    pub(crate) fn buffer_constructor(env: sys::napi_env) -> Result<Self> {
        Self::global(env, "Buffer")
    }

    pub(crate) fn get(self, key: &str) -> Result<Self> {
        let key = Self::string(self.env, key)?;
        Self::make(self.env, |p| unsafe {
            sys::napi_get_property(self.env, self.raw, key.raw, p)
        })
    }

    pub(crate) fn set(self, key: &str, value: Self) -> Result<()> {
        let key = Self::string(self.env, key)?;
        check(unsafe { sys::napi_set_property(self.env, self.raw, key.raw, value.raw) })
    }

    pub(crate) fn index(self, i: usize) -> Result<Self> {
        Self::make(self.env, |p| unsafe {
            sys::napi_get_element(self.env, self.raw, i as u32, p)
        })
    }

    pub(crate) fn set_index(self, i: usize, value: Self) -> Result<()> {
        check(unsafe { sys::napi_set_element(self.env, self.raw, i as u32, value.raw) })
    }

    pub(crate) fn len(self) -> Result<usize> {
        let mut len = 0;
        check(unsafe { sys::napi_get_array_length(self.env, self.raw, &mut len) })?;
        Ok(len as usize)
    }

    pub(crate) fn values(self) -> Result<Vec<Self>> {
        (0..self.len()?).map(|i| self.index(i)).collect()
    }

    pub(crate) fn ty(self) -> Result<sys::napi_valuetype> {
        let mut ty = 0;
        check(unsafe { sys::napi_typeof(self.env, self.raw, &mut ty) })?;
        Ok(ty)
    }

    pub(crate) fn is_undefined(self) -> Result<bool> {
        Ok(self.ty()? == sys::ValueType::napi_undefined)
    }

    pub(crate) fn truthy(self) -> Result<bool> {
        let v = Self::make(self.env, |p| unsafe {
            sys::napi_coerce_to_bool(self.env, self.raw, p)
        })?;
        let mut b = false;
        check(unsafe { sys::napi_get_value_bool(self.env, v.raw, &mut b) })?;
        Ok(b)
    }

    pub(crate) fn float(self) -> Result<f64> {
        let mut n = 0.;
        check(unsafe { sys::napi_get_value_double(self.env, self.raw, &mut n) })?;
        Ok(n)
    }

    pub(crate) fn units(self) -> Result<Vec<u16>> {
        let mut len = 0;
        check(unsafe {
            sys::napi_get_value_string_utf16(self.env, self.raw, ptr::null_mut(), 0, &mut len)
        })?;
        let mut text = vec![0; len + 1];
        check(unsafe {
            sys::napi_get_value_string_utf16(
                self.env,
                self.raw,
                text.as_mut_ptr(),
                text.len(),
                &mut len,
            )
        })?;
        text.truncate(len);
        Ok(text)
    }

    pub(crate) fn is_buffer(self) -> Result<bool> {
        let mut b = false;
        check(unsafe { sys::napi_is_buffer(self.env, self.raw, &mut b) })?;
        Ok(b)
    }

    pub(crate) fn bytes(self) -> Result<Vec<u8>> {
        let mut p = ptr::null_mut();
        let mut len = 0;
        check(unsafe { sys::napi_get_buffer_info(self.env, self.raw, &mut p, &mut len) })?;
        if len == 0 {
            Ok(Vec::new())
        } else {
            Ok(unsafe { std::slice::from_raw_parts(p.cast::<u8>(), len) }.to_vec())
        }
    }

    pub(crate) fn call(self, receiver: Self, args: &[Self]) -> Result<Self> {
        let args: Vec<_> = args.iter().map(|x| x.raw).collect();
        Self::make(self.env, |p| unsafe {
            sys::napi_call_function(
                self.env,
                receiver.raw,
                self.raw,
                args.len(),
                args.as_ptr(),
                p,
            )
        })
    }

    pub(crate) fn method(self, key: &str, args: &[Self]) -> Result<Self> {
        self.get(key)?.call(self, args)
    }

    pub(crate) fn equal(self, other: Self) -> Result<bool> {
        let mut b = false;
        check(unsafe { sys::napi_strict_equals(self.env, self.raw, other.raw, &mut b) })?;
        Ok(b)
    }
}

pub(crate) struct WeakJs {
    pub(crate) env: sys::napi_env,
    reference: sys::napi_ref,
}

impl WeakJs {
    // Nodes with Rust-owned state only need the environment for their JS results.
    pub(crate) fn empty(env: sys::napi_env) -> Self {
        Self {
            env,
            reference: ptr::null_mut(),
        }
    }

    pub(crate) fn new(value: Js) -> Result<Self> {
        let mut reference = ptr::null_mut();
        check(unsafe { sys::napi_create_reference(value.env, value.raw, 0, &mut reference) })?;
        Ok(Self {
            env: value.env,
            reference,
        })
    }

    pub(crate) fn get(&self) -> Result<Js> {
        if self.reference.is_null() {
            return Err(invalid("Source has no JS store"));
        }
        let v = Js::make(self.env, |p| unsafe {
            sys::napi_get_reference_value(self.env, self.reference, p)
        })?;
        if v.raw.is_null() {
            Err(invalid("Source JS references have been collected"))
        } else {
            Ok(v)
        }
    }
}

impl Drop for WeakJs {
    fn drop(&mut self) {
        if !self.reference.is_null() {
            unsafe { sys::napi_delete_reference(self.env, self.reference) };
        }
    }
}
