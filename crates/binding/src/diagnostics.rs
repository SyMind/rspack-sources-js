use crate::{
    invalid,
    js::Js,
    model::{argument, get_field, into_js, node, object, set_field, snapshot},
};
use napi::{Result, bindgen_prelude::*, sys};
use napi_derive::napi;
use rspack_sources::{MapOptions, Source, SourceRef};
use serde_json::Value;
use std::cell::RefCell;

#[napi(object)]
#[derive(Default, Clone)]
pub struct SourceStats {
    pub creations: u32,
    pub mutations: u32,
    pub compilations: u32,
    pub compiled_nodes: u32,
    pub native_reads: u32,
    pub fallbacks: u32,
}

thread_local! {pub(crate) static STATS:RefCell<SourceStats>=RefCell::default();}

#[napi]
pub fn debug_source_stats(reset: Option<bool>) -> SourceStats {
    STATS.with(|s| {
        if reset.unwrap_or(false) {
            s.replace(SourceStats::default());
        }
        s.borrow().clone()
    })
}

#[napi]
pub struct NativeSource {
    pub(crate) source: SourceRef,
}

#[napi(object)]
pub struct SourceAndMap {
    pub source: String,
    pub map: Value,
}

#[napi]
impl NativeSource {
    #[napi]
    pub fn source(&self) -> String {
        self.source.source().into_string_lossy().into_owned()
    }

    #[napi]
    pub fn buffer(&self) -> Buffer {
        // JS receives its own writable allocation, never shared Rust backing storage.
        self.source.buffer().into_owned().into()
    }

    #[napi]
    pub fn size(&self) -> f64 {
        self.source.size() as f64
    }

    #[napi]
    pub fn map(&self, columns: bool) -> Result<Value> {
        source_map(self.source.as_ref(), columns)
    }

    #[napi]
    pub fn source_and_map(&self, columns: bool) -> Result<SourceAndMap> {
        Ok(SourceAndMap {
            source: self.source(),
            map: self.map(columns)?,
        })
    }
}

pub(crate) fn source_map(source: &dyn Source, columns: bool) -> Result<Value> {
    match source.map(&MapOptions::new(columns)) {
        Some(map) => {
            let mut value = serde_json::to_value(map).map_err(|e| invalid(&e.to_string()))?;
            // webpack-sources uses a placeholder file for generated maps.
            value["file"] = Value::String("x".into());
            Ok(value)
        }
        None => Ok(Value::Null),
    }
}

pub(crate) fn map_value(env: sys::napi_env, value: Value) -> Result<Js> {
    if value.is_null() {
        return Js::null(env);
    }
    let raw = unsafe { serde_json::Value::to_napi_value(env, value) }?;
    let raw = Js { env, raw };
    let out = Js::object(env)?;
    // Preserve webpack-sources JSON property order as well as values.
    for key in [
        "version",
        "file",
        "mappings",
        "sources",
        "sourcesContent",
        "names",
    ] {
        out.set(key, raw.get(key)?)?;
    }
    Ok(out)
}

#[napi]
pub fn debug_source_snapshot(receiver: Object<'_>) -> Result<Option<NativeSource>> {
    let n = node(object(&receiver))?.ok_or_else(|| invalid("Invalid Source receiver"))?;
    Ok(snapshot(&n)?.map(|source| NativeSource { source }))
}

// Development tools inspect or restore captured state without exposing fields
// on public Source instances.
#[napi]
pub fn debug_source_get_field<'env>(
    receiver: Object<'env>,
    field: String,
) -> Result<Unknown<'env>> {
    let n = node(object(&receiver))?.ok_or_else(|| invalid("Invalid Source receiver"))?;
    into_js(get_field(&n, &field)?)
}

#[napi]
pub fn debug_source_set_field(
    receiver: Object<'_>,
    field: String,
    value: Unknown<'_>,
) -> Result<()> {
    let receiver = object(&receiver);
    let n = node(receiver)?.ok_or_else(|| invalid("Invalid Source receiver"))?;
    set_field(&n, &field, argument(receiver.env, &value))
}
