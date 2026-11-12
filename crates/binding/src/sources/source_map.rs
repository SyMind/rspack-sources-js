use crate::{
    js::Js,
    maps::MapInput,
    model::{Field, Kind, SourceNode, argument, into_js, object, require},
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{SourceExt, SourceMapSource, SourceMapSourceOptions, SourceRef};
use std::rc::Rc;

// Keep the public constructor positional to avoid rebuilding a JS argument object.
#[allow(clippy::too_many_arguments)]
#[napi]
pub fn source_map_new(
    receiver: Object<'_>,
    store: Object<'_>,
    value: Unknown<'_>,
    name: Unknown<'_>,
    source_map: Unknown<'_>,
    original_source: Unknown<'_>,
    inner_source_map: Unknown<'_>,
    remove_original_source: Unknown<'_>,
) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, object(&store), Kind::SourceMap)?;
    let env = receiver.env;
    let undefined = Js::undefined(env)?;
    for (value, string, buffer) in [
        (argument(env, &value), "_valueAsString", "_valueAsBuffer"),
        (
            argument(env, &original_source),
            "_originalSourceAsString",
            "_originalSourceAsBuffer",
        ),
    ] {
        let is_buffer = value.is_buffer()?;
        n.put(string, if is_buffer { undefined } else { value })?;
        n.put(buffer, if is_buffer { value } else { undefined })?;
    }
    n.put("_name", argument(env, &name))?;
    n.put(
        "_removeOriginalSource",
        argument(env, &remove_original_source),
    )?;
    n.put_field(
        "_hasOriginalSource",
        Field::Bool(argument(env, &original_source).truthy()?),
    );
    for (value, has, object, string, buffer, inner) in [
        (
            argument(env, &source_map),
            "_hasSourceMap",
            "_sourceMapAsObject",
            "_sourceMapAsString",
            "_sourceMapAsBuffer",
            false,
        ),
        (
            argument(env, &inner_source_map),
            "_hasInnerSourceMap",
            "_innerSourceMapAsObject",
            "_innerSourceMapAsString",
            "_innerSourceMapAsBuffer",
            true,
        ),
    ] {
        let is_buffer = value.is_buffer()?;
        let is_string = value.ty()? == napi::sys::ValueType::napi_string;
        n.put_field(has, Field::Bool(value.truthy()?));
        n.put(
            object,
            if is_buffer || is_string || inner && !value.truthy()? {
                undefined
            } else {
                value
            },
        )?;
        n.put(string, if is_string { value } else { undefined })?;
        n.put(buffer, if is_buffer { value } else { undefined })?;
    }
    n.finish()
}

fn safe_map(n: &Rc<SourceNode>, value: Js) -> Result<Option<MapInput>> {
    let value = n.helper("mapInput", &[value])?;
    if value.is_undefined()? {
        return Ok(None);
    }
    Ok(Some(unsafe {
        MapInput::from_napi_value(value.env, value.raw)
    }?))
}

pub(crate) fn validate(n: &Rc<SourceNode>) -> Result<bool> {
    if [
        "_valueAsBuffer",
        "_sourceMapAsBuffer",
        "_innerSourceMapAsBuffer",
        "_originalSourceAsBuffer",
    ]
    .iter()
    .any(|key| n.field(key) != Field::Undefined)
        || !n.well_formed("_valueAsString")
        || !n.well_formed("_name")
    {
        return Ok(false);
    }
    let Some(outer) = safe_map(n, OUTER_MAP.as_object(n)?)? else {
        return Ok(false);
    };
    let inner = if n.boolean("_hasInnerSourceMap") {
        let Some(inner) = safe_map(n, INNER_MAP.as_object(n)?)? else {
            return Ok(false);
        };
        Some(inner)
    } else {
        None
    };
    if n.boolean("_hasOriginalSource") && !n.well_formed("_originalSourceAsString") {
        return Ok(false);
    }
    let maps = (outer, inner);
    if n.last_maps.borrow().as_ref() != Some(&maps) {
        n.dirty();
        n.last_maps.replace(Some(maps));
    }
    Ok(true)
}

pub(crate) fn compile(n: &Rc<SourceNode>, _: Vec<SourceRef>) -> Result<Option<SourceRef>> {
    let Some((outer, inner)) = n.last_maps.borrow().clone() else {
        return Ok(None);
    };
    let Some(source_map) = outer.into_map() else {
        return Ok(None);
    };
    let inner_source_map = match inner {
        Some(inner) => {
            let Some(inner) = inner.into_map() else {
                return Ok(None);
            };
            Some(inner)
        }
        None => None,
    };
    Ok(Some(
        SourceMapSource::new(SourceMapSourceOptions {
            value: n.string("_valueAsString").unwrap(),
            name: n.string("_name").unwrap(),
            source_map,
            original_source: if n.boolean("_hasOriginalSource") {
                n.string("_originalSourceAsString")
                    .map(String::into_boxed_str)
            } else {
                None
            },
            inner_source_map,
            remove_original_source: n.boolean("_removeOriginalSource"),
        })
        .boxed(),
    ))
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_source(n, "_valueAsString")
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_buffer(n, "_valueAsString")
}

fn buffers(n: &Rc<SourceNode>) -> Result<Js> {
    Js::array(n.store.env, &[buffer(n)?])
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_size(n, "_valueAsString")
}

pub(crate) fn map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    if !n.boolean("_hasInnerSourceMap") {
        OUTER_MAP.as_object(n)
    } else {
        super::map_result(n, options, false)
    }
}

pub(crate) fn source_and_map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    if !n.boolean("_hasInnerSourceMap") {
        super::pair(n, source(n)?, OUTER_MAP.as_object(n)?)
    } else {
        super::map_result(n, options, true)
    }
}

fn args_as_buffers(n: &Rc<SourceNode>) -> Result<Js> {
    Js::array(
        n.store.env,
        &[
            n.receiver()?.method("buffer", &[])?,
            n.get("_name")?,
            OUTER_MAP.as_buffer(n)?,
            original_source_buffer(n)?,
            INNER_MAP.as_buffer(n)?,
            n.get("_removeOriginalSource")?,
        ],
    )
}

fn cache_conversion(n: &SourceNode, field: &str, value: Js) -> Result<Js> {
    if n.helper("dual", &[])?.truthy()? {
        n.put(field, value)?;
        n.dirty();
    }
    Ok(value)
}

fn to_utf8_buffer(value: Js) -> Result<Js> {
    Js::buffer_constructor(value.env)?.method("from", &[value, Js::string(value.env, "utf8")?])
}

fn decode_utf8(buffer: Js) -> Result<Js> {
    buffer.method("toString", &[Js::string(buffer.env, "utf8")?])
}

fn original_source_buffer(n: &Rc<SourceNode>) -> Result<Js> {
    let buffer = n.get("_originalSourceAsBuffer")?;
    if !buffer.is_undefined()? || !n.boolean("_hasOriginalSource") {
        return Ok(buffer);
    }
    cache_conversion(
        n,
        "_originalSourceAsBuffer",
        to_utf8_buffer(n.get("_originalSourceAsString")?)?,
    )
}

fn original_source_string(n: &Rc<SourceNode>) -> Result<Js> {
    let string = n.get("_originalSourceAsString")?;
    if !string.is_undefined()? || !n.boolean("_hasOriginalSource") {
        return Ok(string);
    }
    cache_conversion(
        n,
        "_originalSourceAsString",
        decode_utf8(n.get("_originalSourceAsBuffer")?)?,
    )
}

struct MapFields {
    object: &'static str,
    string: &'static str,
    buffer: &'static str,
    inner: bool,
}

const OUTER_MAP: MapFields = MapFields {
    object: "_sourceMapAsObject",
    string: "_sourceMapAsString",
    buffer: "_sourceMapAsBuffer",
    inner: false,
};

const INNER_MAP: MapFields = MapFields {
    object: "_innerSourceMapAsObject",
    string: "_innerSourceMapAsString",
    buffer: "_innerSourceMapAsBuffer",
    inner: true,
};

impl MapFields {
    fn missing(&self, n: &SourceNode) -> bool {
        self.inner && !n.boolean("_hasInnerSourceMap")
    }

    fn as_string(&self, n: &SourceNode) -> Result<Js> {
        let cached = n.get(self.string)?;
        if !cached.is_undefined()? || self.missing(n) {
            return Ok(cached);
        }
        let buffer = n.get(self.buffer)?;
        let string = if buffer.is_undefined()? {
            Js::global(n.store.env, "JSON")?.method("stringify", &[n.get(self.object)?])?
        } else {
            decode_utf8(buffer)?
        };
        cache_conversion(n, self.string, string)
    }

    fn as_buffer(&self, n: &SourceNode) -> Result<Js> {
        let cached = n.get(self.buffer)?;
        if !cached.is_undefined()? || self.missing(n) {
            return Ok(cached);
        }
        cache_conversion(n, self.buffer, to_utf8_buffer(self.as_string(n)?)?)
    }

    fn as_object(&self, n: &SourceNode) -> Result<Js> {
        let cached = n.get(self.object)?;
        if !cached.is_undefined()? || self.missing(n) {
            return Ok(cached);
        }
        let map = Js::global(n.store.env, "JSON")?.method("parse", &[self.as_string(n)?])?;
        cache_conversion(n, self.object, map)
    }
}

#[napi]
pub fn source_map_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(source(&n)?)
}

#[napi]
pub fn source_map_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn source_map_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(buffers(&n)?)
}

#[napi]
pub fn source_map_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(size(&n)?)
}

#[napi]
pub fn source_map_get_args_as_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(args_as_buffers(&n)?)
}

#[napi]
pub fn source_map_original_source_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(original_source_buffer(&n)?)
}

#[napi]
pub fn source_map_original_source_string<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(original_source_string(&n)?)
}

#[napi]
pub fn source_map_inner_source_map_object<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(INNER_MAP.as_object(&n)?)
}

#[napi]
pub fn source_map_inner_source_map_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(INNER_MAP.as_buffer(&n)?)
}

#[napi]
pub fn source_map_source_map_object<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(OUTER_MAP.as_object(&n)?)
}

#[napi]
pub fn source_map_source_map_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(OUTER_MAP.as_buffer(&n)?)
}

#[napi]
pub fn source_map_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::SourceMap)?;
    into_js(map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn source_map_source_and_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::SourceMap)?;
    into_js(source_and_map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn source_map_get_field<'env>(receiver: Object<'env>, field: String) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SourceMap)?;
    into_js(crate::model::get_field(&n, &field)?)
}

#[napi]
pub fn source_map_set_field(receiver: Object<'_>, field: String, value: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::SourceMap)?;
    crate::model::set_field(&n, &field, argument(receiver.env, &value))
}
