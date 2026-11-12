use crate::{
    diagnostics::STATS,
    invalid,
    source_binding::{NativeBinding, attach, binding_of, edit, require, source_of},
};
use napi::{Env, Result, ValueType, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{ConcatSource, RawStringSource, SourceExt, SourceRef};
use std::cell::RefCell;

pub(crate) struct ConcatSourceBinding {
    inner: RefCell<SourceRef>,
}

impl NativeBinding for ConcatSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.borrow().clone()
    }
}

fn child(item: Unknown<'_>) -> Result<SourceRef> {
    if item.get_type()? == ValueType::String {
        return Ok(RawStringSource::from(super::text(item)?).boxed());
    }
    binding_of(item)?.map(|binding| binding.source())
        .ok_or_else(|| invalid("ConcatSource expects a string or a bound Source; wrap custom objects in CompatSource"))
}

#[napi]
pub fn concat_new(receiver: Object<'_>, items: Vec<Unknown<'_>>) -> Result<()> {
    let children = items.into_iter().map(child).collect::<Result<Vec<_>>>()?;
    attach(receiver, ConcatSource::new(children).boxed(), |source| {
        ConcatSourceBinding {
            inner: RefCell::new(source),
        }
    })
}

#[napi]
pub fn concat_get_children<'env>(
    env: &'env Env,
    receiver: Object<'env>,
) -> Result<Vec<Either<Object<'env>, String>>> {
    let bound = source_of::<ConcatSourceBinding>(receiver)?;
    let concat = bound
        .as_ref()
        .as_any()
        .downcast_ref::<ConcatSource>()
        .expect("ConcatSource binding");
    concat
        .children()
        .iter()
        .map(|child| {
            if let Some(owner) = child.jsobject() {
                return owner
                    .get(env)?
                    .map(Either::A)
                    .ok_or_else(|| invalid("ConcatSource child has been collected"));
            }
            // Only literals and their merged native RawStringSource have no JS owner.
            Ok(Either::B(child.source().into_string_lossy().into_owned()))
        })
        .collect()
}

#[napi]
pub fn concat_add(receiver: Object<'_>, item: Unknown<'_>) -> Result<()> {
    let binding = require::<ConcatSourceBinding>(receiver)?;
    let source = child(item)?;
    edit(
        &binding.inner,
        "ConcatSource",
        |concat: &mut ConcatSource| concat.add(source),
    )?;
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(())
}

#[napi]
pub fn concat_add_all_skip_optimizing(receiver: Object<'_>, items: Vec<Unknown<'_>>) -> Result<()> {
    let binding = require::<ConcatSourceBinding>(receiver)?;
    let children = items.into_iter().map(child).collect::<Result<Vec<_>>>()?;
    edit(
        &binding.inner,
        "ConcatSource",
        |concat: &mut ConcatSource| concat.add_all_skip_optimizing(children),
    )?;
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(())
}

#[napi(catch_unwind)]
pub fn concat_source(receiver: Object<'_>) -> Result<Either<String, Buffer>> {
    Ok(super::js_source(
        source_of::<ConcatSourceBinding>(receiver)?.source(),
    ))
}

#[napi(catch_unwind)]
pub fn concat_buffer(receiver: Object<'_>) -> Result<Buffer> {
    Ok(source_of::<ConcatSourceBinding>(receiver)?
        .buffer()
        .into_owned()
        .into())
}

#[napi(catch_unwind)]
pub fn concat_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<ConcatSourceBinding>(receiver)?.size() as f64)
}

#[napi(catch_unwind)]
pub fn concat_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<ConcatSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn concat_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(
        source_of::<ConcatSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi(catch_unwind)]
pub fn concat_buffers(receiver: Object<'_>) -> Result<Vec<Buffer>> {
    let bound = source_of::<ConcatSourceBinding>(receiver)?;
    let concat = bound
        .as_ref()
        .as_any()
        .downcast_ref::<ConcatSource>()
        .expect("ConcatSource binding");
    Ok(concat
        .children()
        .iter()
        .map(|child| child.buffer().into_owned().into())
        .collect())
}
