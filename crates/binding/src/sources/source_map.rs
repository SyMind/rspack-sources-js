use crate::source_binding::{NativeBinding, attach, source_of};
use crate::{invalid, maps::parse_map};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{SourceExt, SourceMapSource, SourceMapSourceOptions, SourceRef};

pub(crate) struct SourceMapSourceBinding {
    inner: SourceRef,
}

impl NativeBinding for SourceMapSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi]
pub fn source_map_new(
    receiver: Object<'_>,
    value: Unknown<'_>,
    name: String,
    map: Unknown<'_>,
    original: Unknown<'_>,
    inner_map: Unknown<'_>,
    remove_original_source: Option<bool>,
) -> Result<()> {
    let value = super::text(value)?;
    let original = if matches!(original.get_type()?, ValueType::Undefined | ValueType::Null) {
        None
    } else {
        Some(super::text(original)?.into_boxed_str())
    };
    let source_map = parse_map(map)?;
    let inner_source_map = parse_map(inner_map)?;
    let source = match source_map {
        Some(source_map) => SourceMapSource::new(SourceMapSourceOptions {
            value,
            name,
            source_map,
            original_source: original,
            inner_source_map,
            remove_original_source: remove_original_source.unwrap_or(false),
        }),
        None => {
            if inner_source_map.is_some() {
                return Err(invalid("An inner source map requires an outer source map"));
            }
            SourceMapSource::without_map(
                value,
                name,
                original,
                remove_original_source.unwrap_or(false),
            )
        }
    };
    attach(receiver, source.boxed(), |inner| SourceMapSourceBinding {
        inner,
    })
}

type OptionalBuffer = Either<Buffer, Undefined>;
type SourceMapArgs = (
    Buffer,
    String,
    OptionalBuffer,
    OptionalBuffer,
    OptionalBuffer,
    bool,
);

#[napi]
pub fn source_map_get_args_as_buffers(receiver: Object<'_>) -> Result<SourceMapArgs> {
    let bound = source_of::<SourceMapSourceBinding>(receiver)?;
    let s = bound
        .as_ref()
        .as_any()
        .downcast_ref::<SourceMapSource>()
        .expect("SourceMapSource binding");
    let map_buffer = |map: Option<&rspack_sources::SourceMap>| {
        map.map_or(Either::B(()), |map| {
            Either::A(Buffer::from(map.to_json().into_bytes()))
        })
    };
    Ok((
        Buffer::from(s.value().as_bytes()),
        s.name().to_owned(),
        map_buffer(s.input_map()),
        s.original_source().map_or(Either::B(()), |text| {
            Either::A(Buffer::from(text.as_bytes()))
        }),
        map_buffer(s.inner_source_map()),
        s.remove_original_source(),
    ))
}

#[napi]
pub fn source_map_source(receiver: Object<'_>) -> Result<Either<String, Buffer>> {
    Ok(super::js_source(
        source_of::<SourceMapSourceBinding>(receiver)?.source(),
    ))
}

#[napi]
pub fn source_map_buffer(receiver: Object<'_>) -> Result<Buffer> {
    Ok(source_of::<SourceMapSourceBinding>(receiver)?
        .buffer()
        .into_owned()
        .into())
}

#[napi]
pub fn source_map_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<SourceMapSourceBinding>(receiver)?.size() as f64)
}

#[napi]
pub fn source_map_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<SourceMapSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi]
pub fn source_map_source_and_map(
    receiver: Object<'_>,
    columns: bool,
) -> Result<super::SourceAndMap> {
    super::source_and_map(
        source_of::<SourceMapSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}
