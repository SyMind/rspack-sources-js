use crate::source_binding::{NativeBinding, attach, edit, require, source_of};
use crate::{diagnostics::STATS, invalid, positions::ByteOffsets};
use crate::{source_binding::buffer_owner_of, source_buffer::SourceBuffer};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{ReplaceSource, SourceExt, SourceRef};
use std::cell::{OnceCell, RefCell};
use std::sync::Arc;

pub(crate) struct ReplaceSourceBinding {
    inner: RefCell<Arc<SourceRef>>,
    offsets: OnceCell<Option<ByteOffsets>>,
}

impl NativeBinding for ReplaceSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.borrow().as_ref().clone()
    }

    fn buffer_owner(&self) -> Arc<SourceRef> {
        self.inner.borrow().clone()
    }
}

#[napi]
pub fn replace_new(receiver: Object<'_>, original: Unknown<'_>) -> Result<()> {
    let source = ReplaceSource::new(super::bound_input(original)?).boxed();
    attach(receiver, source, |source| ReplaceSourceBinding {
        inner: RefCell::new(Arc::new(source)),
        offsets: OnceCell::new(),
    })
}

fn record(
    receiver: Object<'_>,
    start: f64,
    end: f64,
    content: String,
    name: Option<String>,
) -> Result<()> {
    let binding = require::<ReplaceSourceBinding>(receiver)?;
    edit(
        &binding.inner,
        "ReplaceSource",
        |target: &mut ReplaceSource| -> Result<()> {
            let offsets = binding
                .offsets
                .get_or_init(|| ByteOffsets::new(target.inner()))
                .as_ref()
                .ok_or_else(|| invalid("Source exceeds the native offset range"))?;
            let start = offsets
                .byte_at(start)
                .ok_or_else(|| invalid("Invalid UTF-16 start position"))?;
            let end = offsets
                .byte_at(end)
                .filter(|end| *end >= start)
                .ok_or_else(|| invalid("Invalid UTF-16 end position"))?;
            target.replace(start, end, content, name);
            Ok(())
        },
    )??;
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(())
}

#[napi(catch_unwind)]
pub fn replace_replace(
    receiver: Object<'_>,
    start: f64,
    end: f64,
    content: String,
    name: Option<String>,
) -> Result<()> {
    if end.fract() != 0. {
        return Err(invalid("Invalid UTF-16 end position"));
    }
    record(receiver, start, end + 1., content, name)
}

#[napi(catch_unwind)]
pub fn replace_insert(
    receiver: Object<'_>,
    position: f64,
    content: String,
    name: Option<String>,
) -> Result<()> {
    record(receiver, position, position, content, name)
}

type ReplacementArgs = FnArgs<(f64, f64, String, Either<String, Undefined>)>;

#[napi]
pub fn replace_get_replacements<'env>(
    receiver: Object<'env>,
    constructor: Function<'env, ReplacementArgs>,
) -> Result<Vec<Unknown<'env>>> {
    let binding = require::<ReplaceSourceBinding>(receiver)?;
    let Some(offsets) = binding.offsets.get().and_then(Option::as_ref) else {
        return Ok(Vec::new());
    };
    let records = {
        let bound = binding.inner.borrow();
        let replace = bound
            .as_ref()
            .as_ref()
            .as_any()
            .downcast_ref::<ReplaceSource>()
            .expect("ReplaceSource binding");
        replace
            .replacements()
            .iter()
            .map(|r| {
                (
                    offsets.utf16_at(r.start()) as f64,
                    offsets.utf16_at(r.end()) as f64 - 1.,
                    r.content().to_owned(),
                    r.name().map(str::to_owned),
                )
            })
            .collect::<Vec<_>>()
    };
    records
        .into_iter()
        .map(|(start, end, content, name)| {
            let name = name.map_or(Either::B(()), Either::A);
            constructor.new_instance((start, end, content, name).into())
        })
        .collect()
}

#[napi(catch_unwind)]
pub fn replace_source(receiver: Object<'_>) -> Result<Either<String, SourceBuffer>> {
    Ok(SourceBuffer::source(&buffer_owner_of::<
        ReplaceSourceBinding,
    >(receiver)?))
}

#[napi(catch_unwind)]
pub fn replace_buffer(receiver: Object<'_>) -> Result<SourceBuffer> {
    Ok(SourceBuffer::buffer(&buffer_owner_of::<
        ReplaceSourceBinding,
    >(receiver)?))
}

#[napi(catch_unwind)]
pub fn replace_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<ReplaceSourceBinding>(receiver)?.size() as f64)
}

#[napi(catch_unwind)]
pub fn replace_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<ReplaceSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn replace_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(&buffer_owner_of::<ReplaceSourceBinding>(receiver)?, columns)
}
