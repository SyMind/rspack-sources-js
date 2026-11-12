use crate::{
    js::{Js, check},
    model::{Field, Kind, SourceNode, argument, into_js, object, require},
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{RawStringSource, SourceExt, SourceRef};
use std::rc::Rc;

pub(crate) fn new_node(
    receiver: Js,
    store: Js,
    value: Js,
    convert: bool,
) -> Result<Rc<SourceNode>> {
    let n = SourceNode::allocate(receiver, store, Kind::Raw)?;
    let buffer = value.is_buffer()?;
    if !buffer && value.ty()? != napi::sys::ValueType::napi_string {
        let message = Js::string(
            receiver.env,
            "argument 'value' must be either string or Buffer",
        )?;
        let error = Js::make(receiver.env, |p| unsafe {
            napi::sys::napi_create_type_error(receiver.env, std::ptr::null_mut(), message.raw, p)
        })?;
        check(unsafe { napi::sys::napi_throw(receiver.env, error.raw) })?;
        return Err(napi::Error::new(
            napi::Status::PendingException,
            "Invalid raw value",
        ));
    }
    let undefined = Js::undefined(receiver.env)?;
    n.put("_value", if buffer && convert { undefined } else { value })?;
    n.put("_valueAsBuffer", if buffer { value } else { undefined })?;
    n.put_field("_valueIsBuffer", Field::Bool(buffer && !convert));
    n.put("_valueAsString", if buffer { undefined } else { value })?;
    n.finish()?;
    Ok(n)
}

#[napi]
pub fn raw_new(
    receiver: Object<'_>,
    store: Object<'_>,
    value: Unknown<'_>,
    convert_to_string: bool,
) -> Result<()> {
    let receiver = object(&receiver);
    new_node(
        receiver,
        object(&store),
        argument(receiver.env, &value),
        convert_to_string,
    )?;
    Ok(())
}

pub(crate) fn initial(n: &Rc<SourceNode>) -> Result<Option<SourceRef>> {
    Ok(n.string("_value").map(|s| RawStringSource::from(s).boxed()))
}

pub(crate) fn validate(n: &Rc<SourceNode>) -> Result<bool> {
    Ok(n.field("_valueAsBuffer") == Field::Undefined && n.well_formed("_value"))
}

pub(crate) fn compile(n: &Rc<SourceNode>, _: Vec<SourceRef>) -> Result<Option<SourceRef>> {
    initial(n)
}

fn is_buffer(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_valueIsBuffer")
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_source(n, "_value")
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_buffer(n, "_value")
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    super::leaf_size(n, "_valueAsString")
}

#[napi]
pub fn raw_is_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Raw)?;
    into_js(is_buffer(&n)?)
}

#[napi]
pub fn raw_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Raw)?;
    into_js(source(&n)?)
}

#[napi]
pub fn raw_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Raw)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn raw_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Raw)?;
    into_js(size(&n)?)
}

#[napi]
pub fn raw_text<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Raw)?;
    into_js(super::leaf_source(&n, "_valueAsString")?)
}

// Historical benchmark control only. The production API never transports kind
// strings or argument arrays. Enabling this feature reproduces that old ABI.
#[cfg(feature = "benchmark-legacy-api")]
#[napi]
pub fn raw_benchmark_generic_new(
    receiver: Object<'_>,
    store: Object<'_>,
    kind: String,
    args: Vec<Unknown<'_>>,
) -> Result<Vec<String>> {
    if kind != "raw" {
        return Err(crate::invalid("Unsupported benchmark kind"));
    }
    let receiver = object(&receiver);
    let undefined = Js::undefined(receiver.env)?;
    let args: Vec<_> = args.iter().map(|v| argument(receiver.env, v)).collect();
    let value = args.first().copied().unwrap_or(undefined);
    let convert = args.get(1).copied().unwrap_or(undefined).truthy()?;
    new_node(receiver, object(&store), value, convert)?;
    Ok(Vec::new())
}
