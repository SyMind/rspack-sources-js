use crate::invalid;
use crate::source_binding::binding_of;
use crate::sources::{SourceAndMap, js_source, source_and_map, source_map};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::SourceRef;
use serde_json::Value;
use std::cell::RefCell;

#[napi(object)]
#[derive(Default, Clone)]
pub struct SourceStats {
    pub creations: u32,
    pub mutations: u32,
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

#[napi]
impl NativeSource {
    #[napi(catch_unwind)]
    pub fn source(&self) -> Either<String, Buffer> {
        js_source(self.source.source())
    }

    #[napi(catch_unwind)]
    pub fn buffer(&self) -> Buffer {
        // JS receives its own writable allocation, never shared Rust backing storage.
        self.source.buffer().into_owned().into()
    }

    #[napi(catch_unwind)]
    pub fn size(&self) -> f64 {
        self.source.size() as f64
    }

    #[napi(catch_unwind)]
    pub fn map(&self, columns: bool) -> Result<Value> {
        source_map(self.source.as_ref(), columns)
    }

    #[napi(catch_unwind)]
    pub fn source_and_map(&self, columns: bool) -> Result<SourceAndMap> {
        source_and_map(self.source.as_ref(), columns)
    }
}

#[napi]
pub fn debug_bound_source_type(receiver: Object<'_>) -> Result<&'static str> {
    let binding = crate::source_binding::binding_of(receiver.to_unknown())?
        .ok_or_else(|| invalid("Invalid Source receiver"))?;
    let source = binding.source();
    Ok(source.as_ref().type_name().rsplit("::").next().unwrap())
}

#[napi]
pub fn debug_source_snapshot(receiver: Object<'_>) -> Result<Option<NativeSource>> {
    Ok(
        binding_of(receiver.to_unknown())?.map(|binding| NativeSource {
            source: binding.source(),
        }),
    )
}
