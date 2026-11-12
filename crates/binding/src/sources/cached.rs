use crate::source_binding::{NativeBinding, attach, source_of};
use crate::{output_buffer::OutputBuffer, source_binding::buffer_owner_of};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{CachedSource, SourceExt, SourceRef};

pub(crate) struct CachedSourceBinding {
    inner: SourceRef,
}

impl NativeBinding for CachedSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi(strict)]
pub fn cached_new(receiver: Object<'_>, original: Object<'_>) -> Result<()> {
    let source = CachedSource::new(super::bound_input(original.to_unknown())?).boxed();
    attach(receiver, source, |inner| CachedSourceBinding { inner })
}

#[napi(catch_unwind)]
pub fn cached_source(receiver: Object<'_>) -> Result<Either<String, OutputBuffer>> {
    Ok(OutputBuffer::source(
        &buffer_owner_of::<CachedSourceBinding>(receiver)?,
    ))
}

#[napi(catch_unwind)]
pub fn cached_buffer(receiver: Object<'_>) -> Result<OutputBuffer> {
    Ok(OutputBuffer::buffer(
        &buffer_owner_of::<CachedSourceBinding>(receiver)?,
    ))
}

#[napi(catch_unwind)]
pub fn cached_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<CachedSourceBinding>(receiver)?.size() as f64)
}

#[napi(catch_unwind)]
pub fn cached_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<CachedSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn cached_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(&buffer_owner_of::<CachedSourceBinding>(receiver)?, columns)
}
