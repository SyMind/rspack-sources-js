use crate::source_binding::{NativeBinding, attach, source_of};
use crate::{output_buffer::OutputBuffer, source_binding::buffer_owner_of};
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
pub fn raw_source(receiver: Object<'_>) -> Result<Either<String, OutputBuffer>> {
    Ok(OutputBuffer::source(&buffer_owner_of::<RawSourceBinding>(
        receiver,
    )?))
}

#[napi]
pub fn raw_buffer(receiver: Object<'_>) -> Result<OutputBuffer> {
    Ok(OutputBuffer::buffer(&buffer_owner_of::<RawSourceBinding>(
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

#[cfg(feature = "benchmark-legacy-api")]
#[napi]
pub fn raw_benchmark_generic_new(
    receiver: Object<'_>,
    kind: String,
    args: Vec<Unknown<'_>>,
) -> Result<Vec<String>> {
    let [value, convert] = args.as_slice() else {
        return Err(crate::invalid("Expected value and convertToString"));
    };
    if kind != "raw" {
        return Err(crate::invalid("Unsupported benchmark kind"));
    }
    raw_new(receiver, *value, convert.coerce_to_bool()?)?;
    Ok(Vec::new())
}
