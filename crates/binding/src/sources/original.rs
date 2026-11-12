use crate::source_binding::{NativeBinding, attach, edit, require, source_of};
use crate::{output_buffer::OutputBuffer, source_binding::buffer_owner_of};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{OriginalSource, SourceExt, SourceRef};
use std::cell::RefCell;
use std::sync::Arc;

pub(crate) struct OriginalSourceBinding {
    inner: RefCell<Arc<SourceRef>>,
}

impl NativeBinding for OriginalSourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.borrow().as_ref().clone()
    }

    fn buffer_owner(&self) -> Arc<SourceRef> {
        self.inner.borrow().clone()
    }
}

#[napi]
pub fn original_new(receiver: Object<'_>, value: Unknown<'_>, name: String) -> Result<()> {
    let source = OriginalSource::new(super::text(value)?, name).boxed();
    attach(receiver, source, |source| OriginalSourceBinding {
        inner: RefCell::new(Arc::new(source)),
    })
}

#[napi]
pub fn debug_original_restore(receiver: Object<'_>, text: Option<String>) -> Result<()> {
    if let Some(text) = text {
        let binding = require::<OriginalSourceBinding>(receiver)?;
        edit(
            &binding.inner,
            "OriginalSource",
            |source: &mut OriginalSource| {
                *source = OriginalSource::new(text, source.name());
            },
        )?;
    }
    Ok(())
}

#[napi]
pub fn original_get_name(receiver: Object<'_>) -> Result<String> {
    let bound = source_of::<OriginalSourceBinding>(receiver)?;
    let source = bound
        .as_ref()
        .as_any()
        .downcast_ref::<OriginalSource>()
        .expect("OriginalSource binding");
    Ok(source.name().to_owned())
}

#[napi]
pub fn original_source(receiver: Object<'_>) -> Result<Either<String, OutputBuffer>> {
    Ok(OutputBuffer::source(&buffer_owner_of::<
        OriginalSourceBinding,
    >(receiver)?))
}

#[napi]
pub fn original_buffer(receiver: Object<'_>) -> Result<OutputBuffer> {
    Ok(OutputBuffer::buffer(&buffer_owner_of::<
        OriginalSourceBinding,
    >(receiver)?))
}

#[napi]
pub fn original_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<OriginalSourceBinding>(receiver)?.size() as f64)
}

#[napi]
pub fn original_map(receiver: Object<'_>, columns: bool) -> Result<serde_json::Value> {
    super::source_map(
        source_of::<OriginalSourceBinding>(receiver)?.as_ref(),
        columns,
    )
}

#[napi]
pub fn original_source_and_map(receiver: Object<'_>, columns: bool) -> Result<super::SourceAndMap> {
    super::source_and_map(
        &buffer_owner_of::<OriginalSourceBinding>(receiver)?,
        columns,
    )
}
