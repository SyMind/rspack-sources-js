use std::{any::Any, cell::RefCell, rc::Rc, sync::Arc};

use napi::{Result, ValueType, bindgen_prelude::*, check_status, sys};
use rspack_sources::{Source, SourceRef, ThreadsafeWeakRef};

use crate::{diagnostics::STATS, invalid};

pub(crate) trait NativeBinding: Any {
    fn source(&self) -> SourceRef;

    fn buffer_owner(&self) -> Arc<SourceRef> {
        Arc::new(self.source())
    }
}

// napi_unwrap may return a foreign addon's pointer. Check our tag before
// asking napi-rs to inspect the wrapped Rust value.
static TAG_ANCHOR: u8 = 0;
fn binding_tag() -> sys::napi_type_tag {
    sys::napi_type_tag {
        lower: std::ptr::addr_of!(TAG_ANCHOR) as usize as u64,
        upper: 0xcf41876e21ae9d03,
    }
}

pub(crate) fn binding_of(value: Unknown<'_>) -> Result<Option<Rc<dyn NativeBinding>>> {
    if value.get_type()? != ValueType::Object {
        return Ok(None);
    }
    let mut tagged = false;
    check_status!(unsafe {
        sys::napi_check_object_type_tag(value.value().env, value.raw(), &binding_tag(), &mut tagged)
    })?;
    if !tagged {
        return Ok(None);
    }
    Ok(Some(Rc::clone(
        unsafe { value.cast::<Object>()? }.unwrap::<Rc<dyn NativeBinding>>()?,
    )))
}

pub(crate) fn require<T: NativeBinding>(receiver: Object<'_>) -> Result<Rc<T>> {
    binding_of(receiver.to_unknown())?
        .and_then(|binding| (binding as Rc<dyn Any>).downcast::<T>().ok())
        .ok_or_else(|| invalid("Invalid Source receiver"))
}

pub(crate) fn source_of<T: NativeBinding>(receiver: Object<'_>) -> Result<SourceRef> {
    let source = require::<T>(receiver)?.source();
    STATS.with(|s| s.borrow_mut().native_reads += 1);
    Ok(source)
}

pub(crate) fn buffer_owner_of<T: NativeBinding>(receiver: Object<'_>) -> Result<Arc<SourceRef>> {
    let owner = require::<T>(receiver)?.buffer_owner();
    STATS.with(|s| s.borrow_mut().native_reads += 1);
    Ok(owner)
}

pub(crate) fn attach<T: NativeBinding>(
    mut receiver: Object<'_>,
    source: SourceRef,
    build: impl FnOnce(SourceRef) -> T,
) -> Result<()> {
    let owner = Arc::new(ThreadsafeWeakRef::new(&receiver)?);
    let binding: Rc<dyn NativeBinding> = Rc::new(build(source.with_jsobject(owner)));
    receiver.wrap(binding, None)?;
    check_status!(unsafe {
        sys::napi_type_tag_object(receiver.value().env, receiver.raw(), &binding_tag())
    })?;
    STATS.with(|stats| stats.borrow_mut().creations += 1);
    Ok(())
}

// Do not call JS inside the edit closure.
pub(crate) fn edit<T: Source + Clone + 'static, R>(
    inner: &RefCell<Arc<SourceRef>>,
    class: &str,
    apply: impl FnOnce(&mut T) -> R,
) -> Result<R> {
    let mut bound = inner.borrow_mut();
    // Parents and diagnostic snapshots own independent SourceRefs and keep
    // their existing exclusive-edit rule. Only exported Buffers share this
    // outer Arc; detach those views on the first subsequent edit.
    if Arc::get_mut(&mut bound).is_none() {
        let snapshot = bound
            .clone_for_edit::<T>()
            .ok_or_else(|| napi::Error::from_reason(format!("Cannot modify shared {class}")))?;
        *bound = Arc::new(snapshot);
    }
    let source = Arc::get_mut(&mut bound)
        .unwrap()
        .get_mut()
        .ok_or_else(|| napi::Error::from_reason(format!("Cannot modify shared {class}")))?;
    let source = source
        .as_any_mut()
        .downcast_mut::<T>()
        .ok_or_else(|| invalid("Invalid Source receiver"))?;
    Ok(apply(source))
}
