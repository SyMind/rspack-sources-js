use crate::source_binding::{NativeBinding, attach, source_of};
use crate::{source_binding::buffer_owner_of, source_buffer::SourceBuffer};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{RawBufferSource, SourceRef};

pub(crate) struct RawSourceBinding {
    inner: SourceRef,
}

impl NativeBinding for RawSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi]
pub fn raw_new(receiver: Object<'_>, value: Unknown<'_>, convert_to_string: bool) -> Result<()> {
    let source = super::raw_input(value, convert_to_string)?;
    attach(receiver, source, |inner| RawSourceBinding { inner })
}

#[napi]
pub fn raw_is_buffer(receiver: Object<'_>) -> Result<bool> {
    Ok(source_of::<RawSourceBinding>(receiver)?
        .as_ref()
        .as_any()
        .is::<RawBufferSource>())
}

#[napi]
pub fn raw_source(receiver: Object<'_>) -> Result<Either<String, SourceBuffer>> {
    Ok(SourceBuffer::source(&buffer_owner_of::<RawSourceBinding>(
        receiver,
    )?))
}

#[napi]
pub fn raw_buffer(receiver: Object<'_>) -> Result<SourceBuffer> {
    Ok(SourceBuffer::buffer(&buffer_owner_of::<RawSourceBinding>(
        receiver,
    )?))
}

#[napi]
pub fn raw_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<RawSourceBinding>(receiver)?.size() as f64)
}

#[napi]
pub fn raw_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(source_of::<RawSourceBinding>(receiver)?.as_ref(), columns)
}

#[napi]
pub fn raw_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(&buffer_owner_of::<RawSourceBinding>(receiver)?, columns)
}
