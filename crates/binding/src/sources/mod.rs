pub mod cached;
pub mod compat;
pub mod concat;
pub mod original;
pub mod prefix;
pub mod raw;
pub mod replace;
pub mod size_only;
pub mod source_map;

use crate::{invalid, maps::parse_map, source_binding::binding_of};
use napi::{Result, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{
    MapOptions, RawBufferSource, RawStringSource, Source, SourceExt, SourceMapSource, SourceRef,
    SourceValue, WithoutOriginalOptions,
};
use serde_json::Value;

pub(crate) fn text(value: Unknown<'_>) -> Result<String> {
    if value.is_buffer()? {
        Ok(String::from_utf8_lossy(&unsafe { value.cast::<BufferSlice>()? }).into_owned())
    } else if value.get_type()? == ValueType::String {
        unsafe { value.cast::<String>() }
    } else {
        Err(invalid("Expected a string or Buffer"))
    }
}

pub(crate) fn raw_input(value: Unknown<'_>, convert_to_string: bool) -> Result<SourceRef> {
    if value.is_buffer()? && !convert_to_string {
        Ok(RawBufferSource::from(unsafe { value.cast::<BufferSlice>()? }.to_vec()).boxed())
    } else {
        Ok(RawStringSource::from(text(value)?).boxed())
    }
}

pub(crate) fn bound_input(value: Unknown<'_>) -> Result<SourceRef> {
    if let Some(binding) = binding_of(value)? {
        return Ok(binding.source());
    }
    // Adapt external JS input once, before putting it into the immutable Rust graph.
    let object: Object = unsafe { value.cast()? };
    let pair: Option<Function<(), Object>> = object.get_named_property("sourceAndMap")?;
    let (content, map) = if let Some(pair) = pair {
        let pair = pair.apply(object, ())?;
        (
            pair.get_named_property("source")?,
            parse_map(pair.get_named_property("map")?)?,
        )
    } else {
        let source: Function<(), Unknown> = object.get_named_property("source")?;
        let content = source.apply(object, ())?;
        let map: Option<Function<(), Unknown>> = object.get_named_property("map")?;
        (
            content,
            match map {
                Some(map) => parse_map(map.apply(object, ())?)?,
                None => None,
            },
        )
    };
    match map {
        Some(source_map) => Ok(SourceMapSource::new(WithoutOriginalOptions {
            value: text(content)?,
            name: source_map.file().unwrap_or_default().to_owned(),
            source_map,
        })
        .boxed()),
        None => raw_input(content, false),
    }
}

pub(crate) fn js_source(value: SourceValue<'_>) -> Either<String, Buffer> {
    match value {
        SourceValue::String(s) => Either::A(s.into_owned()),
        SourceValue::Buffer(b) => Either::B(b.into_owned().into()),
    }
}

#[napi(object, object_from_js = false)]
pub struct SourceAndMap {
    pub source: Either<String, Buffer>,
    pub map: Value,
}

pub(crate) fn source_map(source: &dyn Source, columns: bool) -> Result<Value> {
    Ok(serde_json::to_value(source.map(&MapOptions::new(columns)))?)
}

pub(crate) fn source_and_map(source: &dyn Source, columns: bool) -> Result<SourceAndMap> {
    Ok(SourceAndMap {
        source: js_source(source.source()),
        map: source_map(source, columns)?,
    })
}
