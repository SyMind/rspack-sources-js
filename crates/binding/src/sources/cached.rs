use crate::{
    js::Js,
    model::{Field, Kind, SourceNode, argument, into_js, node, object, require},
    source_helpers::source_context,
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{
    CachedData, CachedSource, RawStringSource, Source, SourceExt, SourceRef,
};
use std::{borrow::Cow, rc::Rc};

// A lazy or JS-only original can produce a size or a map before it produces text.
enum Backing {
    Pending(Box<CachedData>),
    Bound(CachedSource),
}

impl Default for Backing {
    fn default() -> Self {
        Self::Pending(Box::default())
    }
}

#[derive(Default)]
pub(crate) struct Cache {
    backing: Backing,
}

impl Cache {
    fn data(&self) -> &CachedData {
        match &self.backing {
            Backing::Bound(source) => source.cached_data(),
            Backing::Pending(data) => data,
        }
    }

    pub(crate) fn text(&self) -> Option<Cow<'_, str>> {
        self.data().chunks().map(|chunks| match chunks {
            [text] => Cow::Borrowed(*text),
            chunks => Cow::Owned(chunks.concat()),
        })
    }

    fn bind(&mut self, inner: SourceRef) -> &CachedSource {
        let same = matches!(&self.backing, Backing::Bound(source) if source.inner().ptr_eq(&inner));
        if !same {
            let data = match &mut self.backing {
                Backing::Pending(data) => std::mem::take(data.as_mut()),
                Backing::Bound(old) => old.cached_data().without_source(),
            };
            self.backing = Backing::Bound(CachedSource::with_cached_data(inner, data));
        }
        match &self.backing {
            Backing::Bound(source) => source,
            Backing::Pending(_) => unreachable!(),
        }
    }

    fn store_text(&mut self, text: String, original: Option<SourceRef>) {
        if let Some(inner) = original {
            // A JS override may have returned different text.
            // Only retain original chunk boundaries when they spell the observed text.
            let mut remaining = Some(text.as_str());
            self.bind(inner).rope(&mut |chunk| {
                remaining = remaining.and_then(|text| text.strip_prefix(chunk));
            });
            if remaining == Some("") {
                return;
            }
        } else if self
            .data()
            .chunks()
            .is_some_and(|chunks| matches!(chunks, [only] if *only == text))
        {
            return;
        }
        self.bind(RawStringSource::from(text).boxed())
            .rope(&mut |_| {});
    }
}

fn original_snapshot(original: Js) -> Result<Option<SourceRef>> {
    Ok(node(original)?.and_then(|n| n.prepared_snapshot()))
}

pub(crate) fn stored_source(n: &SourceNode) -> Result<Js> {
    if let Some(text) = n.cache().borrow().text() {
        return Js::string(n.store.env, &text);
    }
    n.get("_cachedSource")
}

#[napi]
pub fn cached_new(
    receiver: Object<'_>,
    source_type: Unknown<'_>,
    buffer: Unknown<'_>,
    size: Unknown<'_>,
) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, source_context(receiver)?, Kind::Cached)?;
    for (key, value) in [
        ("_cachedSourceType", source_type),
        ("_cachedBuffer", buffer),
    ] {
        let value = argument(receiver.env, &value);
        if !value.is_undefined()? {
            n.put(key, value)?;
        }
    }
    let size = argument(receiver.env, &size);
    if !size.is_undefined()? {
        store_size(&n, size)?;
    }
    n.finish()
}

pub(crate) fn store_source(n: &SourceNode, value: Js, original: Option<Js>) -> Result<()> {
    if value.ty()? == napi::sys::ValueType::napi_string
        && let Ok(text) = String::from_utf16(&value.units()?)
    {
        let snapshot = original.map(original_snapshot).transpose()?.flatten();
        n.cache().borrow_mut().store_text(text, snapshot);
        n.put_field("_cachedSource", Field::Undefined);
    } else {
        let mut cache = n.cache().borrow_mut();
        cache.backing = Backing::Pending(Box::new(cache.data().without_source()));
        n.put("_cachedSource", value)?;
    }
    n.dirty();
    Ok(())
}

fn get_cached_source(n: &Rc<SourceNode>) -> Result<Js> {
    let cached = stored_source(n)?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let buffer = n.get("_cachedBuffer")?;
    let kind = n.get("_cachedSourceType")?;
    if !buffer.is_undefined()? && !kind.is_undefined()? {
        let value = if kind.truthy()? {
            buffer.method("toString", &[Js::string(n.store.env, "utf8")?])?
        } else {
            buffer
        };
        if n.helper("dual", &[])?.truthy()? {
            store_source(n, value, None)?;
        }
        return Ok(value);
    }
    Js::undefined(n.store.env)
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    let cached = get_cached_source(n)?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let original = n.receiver()?.method("original", &[])?;
    let value = original.method("source", &[])?;
    store_source(n, value, Some(original))?;
    Ok(value)
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    let cached = n.get("_cachedBuffer")?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let buffers = n.get("_cachedBuffers")?;
    let receiver = n.receiver()?;
    if buffers.is_undefined()? {
        let text_buffer = n
            .cache()
            .borrow()
            .text()
            .map(|text| Js::buffer(n.store.env, text.as_bytes()))
            .transpose()?;
        if let Some(buffer) = text_buffer {
            if n.helper("dual", &[])?.truthy()? {
                n.put("_cachedBuffer", buffer)?;
                n.dirty();
            }
            return Ok(buffer);
        }
    }
    let mut value = n.get("_cachedSource")?;
    let buffer = if !buffers.is_undefined()? {
        Js::buffer_constructor(n.store.env)?.method("concat", &[buffers])?
    } else if value.is_undefined()?
        && receiver.method("original", &[])?.get("buffer")?.ty()?
            == napi::sys::ValueType::napi_function
    {
        receiver.method("original", &[])?.method("buffer", &[])?
    } else {
        let from_source = value.is_undefined()?;
        if from_source {
            value = receiver.method("source", &[])?;
        }
        let is_buffer = value.is_buffer()?;
        let buffer = if is_buffer {
            value
        } else {
            Js::buffer_constructor(n.store.env)?
                .method("from", &[value, Js::string(n.store.env, "utf8")?])?
        };
        let cache_buffer = (from_source && is_buffer) || n.helper("dual", &[])?.truthy()?;
        if !cache_buffer {
            return Ok(buffer);
        }
        buffer
    };
    n.put("_cachedBuffer", buffer)?;
    n.dirty();
    Ok(buffer)
}

fn buffers(n: &Rc<SourceNode>) -> Result<Js> {
    let cached = n.get("_cachedBuffers")?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let buffer = n.get("_cachedBuffer")?;
    let buffers = if !buffer.is_undefined()? {
        Js::array(n.store.env, &[buffer])?
    } else {
        let receiver = n.receiver()?;
        let original = receiver.method("original", &[])?;
        if original.get("buffers")?.ty()? == napi::sys::ValueType::napi_function {
            original.method("buffers", &[])?
        } else {
            Js::array(n.store.env, &[receiver.method("buffer", &[])?])?
        }
    };
    n.put("_cachedBuffers", buffers)?;
    n.dirty();
    Ok(buffers)
}

pub(crate) fn stored_size(n: &SourceNode) -> Result<Js> {
    if let Some(field) = n.fields.borrow().get("_cachedSize").cloned() {
        return n.value(field);
    }
    match n.cache().borrow().data().size() {
        Some(size) => Js::number(n.store.env, size as f64),
        None => Js::undefined(n.store.env),
    }
}

fn store_size(n: &SourceNode, value: Js) -> Result<()> {
    if !n.fields.borrow().contains_key("_cachedSize")
        && value.ty()? == napi::sys::ValueType::napi_number
    {
        let size = value.float()?;
        if !size.is_sign_negative()
            && size <= (usize::MAX as f64).min(9_007_199_254_740_991.0)
            && size.fract() == 0.0
        {
            n.cache().borrow().data().store_size(size as usize);
            return Ok(());
        }
    }
    // Preserve custom JS sizes and values supplied by the diagnostics adapter.
    n.put("_cachedSize", value)
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    let cached = stored_size(n)?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let buffer = n.get("_cachedBuffer")?;
    let text_size = match &n.cache().borrow().backing {
        Backing::Bound(source)
            if source.cached_data().chunks().is_some() && buffer.is_undefined()? =>
        {
            if n.fields.borrow().contains_key("_cachedSize") {
                source
                    .cached_data()
                    .chunks()
                    .map(|chunks| chunks.iter().map(|chunk| chunk.len()).sum())
            } else {
                Some(source.size())
            }
        }
        _ => None,
    };
    let size = if !buffer.is_undefined()? {
        buffer.get("length")?
    } else if let Some(size) = text_size {
        Js::number(n.store.env, size as f64)?
    } else {
        let source = get_cached_source(n)?;
        if source.ty()? == napi::sys::ValueType::napi_string {
            Js::number(
                n.store.env,
                String::from_utf16_lossy(&source.units()?).len() as f64,
            )?
        } else if source.is_buffer()? {
            Js::number(n.store.env, source.bytes()?.len() as f64)?
        } else if source.is_undefined()? {
            n.receiver()?.method("original", &[])?.method("size", &[])?
        } else {
            Js::buffer_constructor(n.store.env)?.method("byteLength", &[source])?
        }
    };
    store_size(n, size)?;
    Ok(size)
}

#[napi]
pub fn cached_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Cached)?;
    into_js(source(&n)?)
}

#[napi]
pub fn cached_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Cached)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn cached_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Cached)?;
    into_js(buffers(&n)?)
}

#[napi]
pub fn cached_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Cached)?;
    into_js(size(&n)?)
}

#[napi]
pub fn cached_source_and_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Cached)?;
    let value = source(&n)?;
    let map = receiver.method("map", &[argument(receiver.env, &options)])?;
    into_js(super::pair(&n, value, map)?)
}
