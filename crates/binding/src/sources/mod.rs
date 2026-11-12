pub mod cached;
pub mod compat;
pub mod concat;
pub mod original;
pub mod prefix;
pub mod raw;
pub mod replace;
pub mod size_only;
pub mod source_map;

use crate::{invalid, maps::parse_map, source_binding::binding_of, source_buffer::SourceBuffer};
use napi::{Result, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{
    CompatSource, MapOptions, RawBufferSource, RawStringSource, Source, SourceExt, SourceMapSource,
    SourceRef, WithoutOriginalOptions,
};
use serde_json::Value;
use std::sync::Arc;

pub(crate) fn text(value: Unknown<'_>) -> Result<String> {
    if value.is_buffer()? {
        Ok(String::from_utf8_lossy(&unsafe { value.cast::<Buffer>()? }).into_owned())
    } else if value.get_type()? == ValueType::String {
        unsafe { value.cast::<String>() }
    } else {
        Err(invalid("Expected a string or Buffer"))
    }
}

pub(crate) fn raw_input(value: Unknown<'_>, convert_to_string: bool) -> Result<SourceRef> {
    if value.is_buffer()? && !convert_to_string {
        Ok(RawBufferSource::from(unsafe { value.cast::<Buffer>()? }.to_vec()).boxed())
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
    let inner = match map {
        Some(source_map) => SourceMapSource::new(WithoutOriginalOptions {
            value: text(content)?,
            name: source_map.file().unwrap_or_default().to_owned(),
            source_map,
        })
        .boxed(),
        None => raw_input(content, false)?,
    };
    let buffer: Option<Function<(), Buffer>> = object.get_named_property("buffer")?;
    if let Some(buffer) = buffer {
        let bytes = RawBufferSource::from(buffer.apply(object, ())?.to_vec());
        return Ok(CompatSource::with_byte_source(inner, bytes.boxed()).boxed());
    }
    Ok(inner)
}

#[napi(object, object_from_js = false)]
pub struct SourceAndMap {
    pub source: Either<String, SourceBuffer>,
    pub map: Value,
}

pub(crate) fn source_map(source: &dyn Source, columns: bool) -> Result<Value> {
    Ok(serde_json::to_value(source.map(&MapOptions::new(columns)))?)
}

pub(crate) fn source_and_map(source: &Arc<SourceRef>, columns: bool) -> Result<SourceAndMap> {
    Ok(SourceAndMap {
        source: SourceBuffer::source(source),
        map: source_map(source.as_ref().as_ref(), columns)?,
    })
}
