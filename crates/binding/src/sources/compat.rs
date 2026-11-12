use crate::{
    js::Js,
    model::{Kind, SourceNode, argument, into_js, object, require},
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use std::rc::Rc;

#[napi]
pub fn compat_new(receiver: Object<'_>, store: Object<'_>, source_like: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, object(&store), Kind::Compat)?;
    n.put("_sourceLike", argument(receiver.env, &source_like))?;
    n.finish()
}

fn call_optional(n: &Rc<SourceNode>, method: &str, args: &[Js]) -> Result<Js> {
    let source_like = n.get("_sourceLike")?;
    if source_like.get(method)?.ty()? == napi::sys::ValueType::napi_function {
        source_like.method(method, args)
    } else {
        let base = n.helpers()?.get("sourcePrototype")?;
        base.get(method)?.call(n.receiver()?, args)
    }
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_sourceLike")?.method("source", &[])
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    call_optional(n, "buffer", &[])
}

fn buffers(n: &Rc<SourceNode>) -> Result<Js> {
    call_optional(n, "buffers", &[])
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    call_optional(n, "size", &[])
}

pub(crate) fn map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    call_optional(n, "map", &[options])
}

pub(crate) fn source_and_map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    call_optional(n, "sourceAndMap", &[options])
}

#[napi]
pub fn compat_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Compat)?;
    into_js(source(&n)?)
}

#[napi]
pub fn compat_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Compat)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn compat_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Compat)?;
    into_js(buffers(&n)?)
}

#[napi]
pub fn compat_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Compat)?;
    into_js(size(&n)?)
}

#[napi]
pub fn compat_map<'env>(receiver: Object<'env>, options: Unknown<'env>) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Compat)?;
    into_js(map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn compat_source_and_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Compat)?;
    into_js(source_and_map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn compat_get_field<'env>(receiver: Object<'env>, field: String) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Compat)?;
    into_js(crate::model::get_field(&n, &field)?)
}

#[napi]
pub fn compat_set_field(receiver: Object<'_>, field: String, value: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Compat)?;
    crate::model::set_field(&n, &field, argument(receiver.env, &value))
}
