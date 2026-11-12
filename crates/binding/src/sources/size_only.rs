use crate::source_binding::{NativeBinding, attach, source_of};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{SizeOnlySource, SourceExt, SourceRef};

pub(crate) struct SizeOnlySourceBinding {
    inner: SourceRef,
}

impl NativeBinding for SizeOnlySourceBinding {
    fn source(&self) -> SourceRef {
        self.inner.clone()
    }
}

#[napi]
pub fn size_only_new(receiver: Object<'_>, size: f64) -> Result<()> {
    if size.fract() != 0.
        || !(0.0..=(usize::MAX as f64).min(9_007_199_254_740_991.)).contains(&size)
    {
        return Err(crate::invalid("Expected a non-negative integer size"));
    }
    attach(receiver, SizeOnlySource(size as usize).boxed(), |inner| {
        SizeOnlySourceBinding { inner }
    })
}

#[napi]
pub fn size_only_size(receiver: Object<'_>) -> Result<f64> {
    Ok(source_of::<SizeOnlySourceBinding>(receiver)?.size() as f64)
}
