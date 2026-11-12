use crate::{
    diagnostics::STATS,
    js::{Js, WeakJs},
    model::{Kind, SourceNode, argument, into_js, object, require},
};
use napi::{Result, bindgen_prelude::*, sys};
use napi_derive::napi;
use rspack_sources::{MapOptions, OriginalSource, Source, SourceRef};
use std::{
    cell::{Cell, OnceCell},
    sync::Arc,
};

// Rust strings replace each isolated surrogate with one U+FFFD. This preserves
// UTF-16 columns and token boundaries. Keep the original units for JS output.
fn decode_units(units: Vec<u16>) -> (String, Option<Box<[u16]>>) {
    match String::from_utf16(&units) {
        Ok(text) => (text, None),
        Err(_) => (String::from_utf16_lossy(&units), Some(units.into())),
    }
}

struct OriginalText {
    source: Arc<OriginalSource>,
    exact_value: Option<Box<[u16]>>,
    exact_name: Option<Box<[u16]>>,
}

impl OriginalText {
    fn new(value: String, exact_value: Option<Box<[u16]>>, name: Vec<u16>) -> Self {
        let (name, exact_name) = decode_units(name);
        Self {
            source: Arc::new(OriginalSource::new(value, name)),
            exact_value,
            exact_name,
        }
    }

    fn value(&self, env: sys::napi_env) -> Result<Js> {
        match &self.exact_value {
            Some(units) => Js::utf16(env, units),
            None => Js::string(env, self.source.value()),
        }
    }

    fn name(&self, env: sys::napi_env) -> Result<Js> {
        match &self.exact_name {
            Some(units) => Js::utf16(env, units),
            None => Js::string(env, self.source.name()),
        }
    }
}

struct BufferInput {
    // The JS wrapper retains the caller's writable Buffer.
    bytes: WeakJs,
    name: Vec<u16>,
    decoded: OnceCell<OriginalText>,
}

impl BufferInput {
    fn decode(&self) -> Result<String> {
        let bytes = self.bytes.get()?.bytes()?;
        Ok(String::from_utf8(bytes)
            .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()))
    }
}

enum OriginalInput {
    Text(OriginalText),
    Buffer(Box<BufferInput>),
}

pub(crate) struct BoundOriginal {
    input: OriginalInput,
    size: Cell<Option<f64>>,
}

impl BoundOriginal {
    pub(crate) fn snapshot(&self) -> Option<SourceRef> {
        let OriginalInput::Text(text) = &self.input else {
            return None;
        };
        (text.exact_value.is_none() && text.exact_name.is_none())
            .then(|| SourceRef::from(text.source.clone()))
    }

    fn materialize(&self) -> Result<&OriginalText> {
        match &self.input {
            OriginalInput::Text(text) => Ok(text),
            OriginalInput::Buffer(input) => {
                if let Some(text) = input.decoded.get() {
                    return Ok(text);
                }
                let value = input.decode()?;
                Ok(input
                    .decoded
                    .get_or_init(|| OriginalText::new(value, None, input.name.clone())))
            }
        }
    }
}

fn original(node: &SourceNode) -> &BoundOriginal {
    node.original.as_deref().expect("OriginalSource node")
}

#[napi]
pub fn original_new(receiver: Object<'_>, value: Unknown<'_>, name: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let value = argument(receiver.env, &value);
    let name = argument(receiver.env, &name).units()?;
    let input = if value.is_buffer()? {
        OriginalInput::Buffer(Box::new(BufferInput {
            bytes: WeakJs::new(value)?,
            name,
            decoded: OnceCell::new(),
        }))
    } else {
        let (value, exact_value) = decode_units(value.units()?);
        OriginalInput::Text(OriginalText::new(value, exact_value, name))
    };
    SourceNode::allocate_original(
        receiver,
        BoundOriginal {
            input,
            size: Cell::new(None),
        },
    )?
    .finish()
}

pub(crate) fn text(node: &SourceNode) -> Option<Vec<u16>> {
    let text = match &original(node).input {
        OriginalInput::Text(text) => text,
        OriginalInput::Buffer(input) => input.decoded.get()?,
    };
    Some(match &text.exact_value {
        Some(units) => units.to_vec(),
        None => text.source.value().encode_utf16().collect(),
    })
}

#[napi]
pub fn original_source<'env>(receiver: Object<'env>, cache: bool) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let node = require(receiver, Kind::Original)?;
    let state = original(&node);
    if !cache
        && let OriginalInput::Buffer(input) = &state.input
        && input.decoded.get().is_none()
    {
        return into_js(Js::string(receiver.env, &input.decode()?)?);
    }
    into_js(state.materialize()?.value(receiver.env)?)
}

#[napi]
pub fn original_size(receiver: Object<'_>, buffer_size: Option<f64>) -> Result<f64> {
    let node = require(object(&receiver), Kind::Original)?;
    let state = original(&node);
    if let Some(size) = state.size.get() {
        return Ok(size);
    }
    let size = match buffer_size {
        Some(size) => size,
        None => state.materialize()?.source.size() as f64,
    };
    state.size.set(Some(size));
    Ok(size)
}

#[napi]
pub fn original_buffer<'env>(receiver: Object<'env>, cache: bool) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let node = require(receiver, Kind::Original)?;
    let state = original(&node);
    if let OriginalInput::Buffer(input) = &state.input {
        return into_js(input.bytes.get()?);
    }
    let bytes = Js::buffer(receiver.env, &state.materialize()?.source.buffer())?;
    if cache {
        // Parent buffer reads must observe later mutations to these bytes.
        node.dirty();
    }
    into_js(bytes)
}

fn map_result<'env>(
    receiver: Object<'env>,
    columns: bool,
    include_source: bool,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let node = require(receiver, Kind::Original)?;
    let env = receiver.env;
    let text = original(&node).materialize()?;
    let map = text.source.map(&MapOptions::new(columns));
    STATS.with(|stats| stats.borrow_mut().native_reads += 1);
    let value = if map.is_some() || include_source {
        text.value(env)?
    } else {
        Js::undefined(env)?
    };
    let map = match map {
        Some(map) => {
            let result = Js::object(env)?;
            result.set("version", Js::number(env, 3.0)?)?;
            result.set("file", Js::string(env, "x")?)?;
            result.set("mappings", Js::string(env, map.mappings())?)?;
            result.set("sources", Js::array(env, &[text.name(env)?])?)?;
            result.set("sourcesContent", Js::array(env, &[value])?)?;
            result.set("names", Js::array(env, &[])?)?;
            result
        }
        None => Js::null(env)?,
    };
    into_js(if include_source {
        super::pair(&node, value, map)?
    } else {
        map
    })
}

#[napi]
pub fn original_map<'env>(receiver: Object<'env>, columns: bool) -> Result<Unknown<'env>> {
    map_result(receiver, columns, false)
}

#[napi]
pub fn original_source_and_map<'env>(
    receiver: Object<'env>,
    columns: bool,
) -> Result<Unknown<'env>> {
    map_result(receiver, columns, true)
}

// Rehydrate the separately captured decoded text and byte length of a fixture.
#[napi]
pub fn debug_original_restore(
    receiver: Object<'_>,
    text: Unknown<'_>,
    size: Option<f64>,
) -> Result<()> {
    let receiver = object(&receiver);
    let node = require(receiver, Kind::Original)?;
    let state = original(&node);
    let text = argument(receiver.env, &text);
    if let OriginalInput::Buffer(input) = &state.input
        && !text.is_undefined()?
    {
        let (value, exact_value) = decode_units(text.units()?);
        input
            .decoded
            .set(OriginalText::new(value, exact_value, input.name.clone()))
            .map_err(|_| crate::invalid("OriginalSource text is already initialized"))?;
    }
    state.size.set(size);
    Ok(())
}
