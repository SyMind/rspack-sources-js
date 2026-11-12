use crate::source_binding::{NativeBinding, attach, source_of};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{CompatSource, SourceExt, SourceRef};

pub(crate) struct CompatSourceBinding {
    inner: SourceRef,
}

impl NativeBinding for CompatSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi(strict)]
pub fn compat_new(receiver: Object<'_>, original: Object<'_>) -> Result<()> {
    let source = CompatSource::new(super::bound_input(original.to_unknown())?).boxed();
    attach(receiver, source, |inner| CompatSourceBinding { inner })
}

#[napi(catch_unwind)]
pub fn compat_source(receiver: Object<'_>) -> Result<Either<String, Buffer>> {
    Ok(super::js_source(
        source_of::<CompatSourceBinding>(receiver)?.source(),
    ))
}

#[napi(catch_unwind)]
pub fn compat_buffer(receiver: Object<'_>) -> Result<Buffer> {
    Ok(source_of::<CompatSourceBinding>(receiver)?
        .buffer()
        .into_owned()
        .into())
}

#[napi(catch_unwind)]
pub fn compat_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<CompatSourceBinding>(receiver)?.size() as f64)
}

#[napi(catch_unwind)]
pub fn compat_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<CompatSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn compat_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(
        source_of::<CompatSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}
