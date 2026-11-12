use crate::source_binding::{NativeBinding, attach, source_of};
use crate::{source_binding::buffer_owner_of, source_buffer::SourceBuffer};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{PrefixSource, SourceExt, SourceRef};

pub(crate) struct PrefixSourceBinding {
    inner: SourceRef,
}

impl NativeBinding for PrefixSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi]
pub fn prefix_new(receiver: Object<'_>, prefix: String, original: Unknown<'_>) -> Result<()> {
    let source = PrefixSource::new(prefix, super::bound_input(original)?).boxed();
    attach(receiver, source, |inner| PrefixSourceBinding { inner })
}

#[napi]
pub fn prefix_get_prefix(receiver: Object<'_>) -> Result<String> {
    let bound = source_of::<PrefixSourceBinding>(receiver)?;
    let source = bound
        .as_ref()
        .as_any()
        .downcast_ref::<PrefixSource>()
        .expect("PrefixSource binding");
    Ok(source.prefix().to_owned())
}

#[napi(catch_unwind)]
pub fn prefix_source(receiver: Object<'_>) -> Result<Either<String, SourceBuffer>> {
    Ok(SourceBuffer::source(
        &buffer_owner_of::<PrefixSourceBinding>(receiver)?,
    ))
}

#[napi(catch_unwind)]
pub fn prefix_buffer(receiver: Object<'_>) -> Result<SourceBuffer> {
    Ok(SourceBuffer::buffer(
        &buffer_owner_of::<PrefixSourceBinding>(receiver)?,
    ))
}

#[napi(catch_unwind)]
pub fn prefix_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<PrefixSourceBinding>(receiver)?.size() as f64)
}

#[napi(catch_unwind)]
pub fn prefix_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<PrefixSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn prefix_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(&buffer_owner_of::<PrefixSourceBinding>(receiver)?, columns)
}
