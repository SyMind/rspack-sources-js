//! Weak Node-API references shared by native source handles.
use std::{
  cell::RefCell,
  collections::HashMap,
  ffi::c_void,
  ptr,
  sync::{Arc, Weak},
  thread::{self, ThreadId},
};

use napi::{
  Env, Error, Result, Status,
  bindgen_prelude::{FromNapiValue, JsValue, Object, check_status},
  sys,
  threadsafe_function::ThreadsafeFunctionHandle,
};

thread_local! {
  // Only accessed when creating a reference on a JS thread. Drop uses the captured owner.
  static OWNERS: RefCell<HashMap<sys::napi_env, Arc<ReferenceOwner>>> = RefCell::default();
}

struct ReferenceOwner {
  env: sys::napi_env,
  thread: ThreadId,
  handle: Arc<ThreadsafeFunctionHandle>,
}

// SAFETY: Only the owner thread uses env. Other threads synchronize TSFN calls with shutdown.
unsafe impl Send for ReferenceOwner {}
unsafe impl Sync for ReferenceOwner {}

extern "C" fn finalize(_env: sys::napi_env, data: *mut c_void, _hint: *mut c_void) {
  let weak = unsafe { Weak::<ThreadsafeFunctionHandle>::from_raw(data.cast()) };
  if let Some(handle) = weak.upgrade() {
    handle.with_write_aborted(|mut closed| *closed = true);
  }
}

extern "C" fn delete_reference(
  env: sys::napi_env,
  _callback: sys::napi_value,
  _context: *mut c_void,
  reference: *mut c_void,
) {
  if !env.is_null() {
    unsafe { sys::napi_delete_reference(env, reference.cast()) };
  }
}

impl ReferenceOwner {
  fn for_env(env: sys::napi_env) -> Result<Arc<Self>> {
    let current = OWNERS.with_borrow(|owners| {
      owners
        .get(&env)
        .filter(|owner| owner.handle.with_read_aborted(|closed| !closed))
        .cloned()
    });
    if let Some(owner) = current {
      return Ok(owner);
    }
    // Creating the TSFN can run Node async hooks that create another source.
    let owner = Arc::new(Self::new(env)?);
    Ok(OWNERS.with_borrow_mut(|owners| {
      owners.retain(|_, owner| owner.handle.with_read_aborted(|closed| !closed));
      Arc::clone(owners.entry(env).or_insert(owner))
    }))
  }

  fn new(env: sys::napi_env) -> Result<Self> {
    let name = c"delete_source_weak_ref";
    let mut resource = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_string_utf8(
        env,
        name.as_ptr(),
        name.to_bytes().len() as isize,
        &mut resource,
      )
    })?;
    let handle = ThreadsafeFunctionHandle::null();
    let finalize_data = Weak::into_raw(Arc::downgrade(&handle));
    let mut raw = ptr::null_mut();
    let status = unsafe {
      sys::napi_create_threadsafe_function(
        env,
        ptr::null_mut(),
        ptr::null_mut(),
        resource,
        0,
        1,
        finalize_data.cast_mut().cast(),
        Some(finalize),
        ptr::null_mut(),
        Some(delete_reference),
        &mut raw,
      )
    };
    if status != sys::Status::napi_ok {
      unsafe {
        drop(Weak::from_raw(finalize_data));
      }
      return Err(Error::new(
        Status::from(status),
        "Creating weak reference cleanup TSFN",
      ));
    }
    handle.set_raw(raw);
    check_status!(unsafe { sys::napi_unref_threadsafe_function(env, raw) })?;
    Ok(Self {
      env,
      thread: thread::current().id(),
      handle,
    })
  }

  fn delete(&self, reference: sys::napi_ref) {
    if self.thread == thread::current().id() {
      self.handle.with_read_aborted(|closed| {
        if !closed {
          unsafe { sys::napi_delete_reference(self.env, reference) };
        }
      });
      return;
    }
    self.handle.with_write_aborted(|mut closed| {
      if *closed {
        return;
      }
      let status = unsafe {
        sys::napi_call_threadsafe_function(
          self.handle.get_raw(),
          reference.cast(),
          sys::ThreadsafeFunctionCallMode::nonblocking,
        )
      };
      if status == sys::Status::napi_closing {
        *closed = true;
      }
      debug_assert!(status == sys::Status::napi_ok || status == sys::Status::napi_closing);
    });
  }
}

/// A weak JS object reference. Native owners can share and drop it on any thread.
pub struct ThreadsafeWeakRef {
  reference: sys::napi_ref,
  owner: Arc<ReferenceOwner>,
}

// SAFETY: The handle is opaque off-thread. get checks both thread and env, and
// Drop routes deletion through the captured owner, even after a worker exits.
unsafe impl Send for ThreadsafeWeakRef {}
unsafe impl Sync for ThreadsafeWeakRef {}

impl ThreadsafeWeakRef {
  /// Create on the object's JS thread. A reference count of zero allows V8 to collect it.
  pub fn new(object: &Object<'_>) -> Result<Self> {
    let value = object.value();
    let owner = ReferenceOwner::for_env(value.env)?;
    let mut reference = ptr::null_mut();
    check_status!(unsafe {
      sys::napi_create_reference(value.env, value.value, 0, &mut reference)
    })?;
    Ok(Self { reference, owner })
  }

  /// Resolve in the current handle scope. A collected object returns None.
  pub fn get<'env>(&self, env: &'env Env) -> Result<Option<Object<'env>>> {
    if self.owner.thread != thread::current().id() || self.owner.env != env.raw() {
      return Err(Error::new(
        Status::InvalidArg,
        "JS reference belongs to another thread or environment",
      ));
    }
    self.owner.handle.with_read_aborted(|closed| {
      if closed {
        return Err(Error::new(Status::Closing, "JS environment is closing"));
      }
      let mut raw = ptr::null_mut();
      check_status!(unsafe { sys::napi_get_reference_value(env.raw(), self.reference, &mut raw) })?;
      if raw.is_null() {
        Ok(None)
      } else {
        unsafe { Object::from_napi_value(env.raw(), raw) }.map(Some)
      }
    })
  }
}

impl Drop for ThreadsafeWeakRef {
  fn drop(&mut self) {
    self.owner.delete(self.reference);
  }
}
