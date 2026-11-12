use crate::{
    js::Js,
    model::{Child, Kind, SourceNode, argument, into_js, object, require, source_text},
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use std::{collections::HashSet, rc::Rc};

#[napi]
pub fn prefix_new(
    receiver: Object<'_>,
    store: Object<'_>,
    prefix: Unknown<'_>,
    source: Unknown<'_>,
) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, object(&store), Kind::Prefix)?;
    let mut source = argument(receiver.env, &source);
    n.put("_prefix", argument(receiver.env, &prefix))?;
    if source.ty()? == napi::sys::ValueType::napi_string || source.is_buffer()? {
        source = crate::source_helpers::create_raw_source(source, true)?;
    }
    n.put("_source", source)?;
    n.set_children(vec![n.child(source)?])?;
    n.finish()
}

pub(crate) fn text(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
) -> Result<Option<Vec<u16>>> {
    let Some(prefix) = n.text("_prefix") else {
        return Ok(None);
    };
    if prefix.contains(&(b'$' as u16)) {
        return Ok(None);
    }
    let Some(Child::Node(child)) = n.children.borrow().first().cloned() else {
        return Ok(None);
    };
    let Some(text) = source_text(&child, visiting)? else {
        return Ok(None);
    };
    let mut result = prefix.clone();
    for (i, ch) in text.iter().enumerate() {
        result.push(*ch);
        if *ch == 10 && i + 1 < text.len() {
            result.extend_from_slice(&prefix);
        }
    }
    Ok(Some(result))
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    super::composite_source(n)
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    super::composite_buffer(n)
}

fn buffers(n: &Rc<SourceNode>) -> Result<Js> {
    super::single_buffer(n.store.env, buffer(n)?)
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    super::buffer_size(buffer(n)?)
}

pub(crate) fn map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    super::map_result(n, options, false)
}

pub(crate) fn source_and_map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    super::map_result(n, options, true)
}

fn original(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_source")
}

fn get_prefix(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_prefix")
}

#[napi]
pub fn prefix_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(source(&n)?)
}

#[napi]
pub fn prefix_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn prefix_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(buffers(&n)?)
}

#[napi]
pub fn prefix_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(size(&n)?)
}

#[napi]
pub fn prefix_original<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(original(&n)?)
}

#[napi]
pub fn prefix_get_prefix<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(get_prefix(&n)?)
}

#[napi]
pub fn prefix_map<'env>(receiver: Object<'env>, options: Unknown<'env>) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Prefix)?;
    into_js(map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn prefix_source_and_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Prefix)?;
    into_js(source_and_map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn prefix_get_field<'env>(receiver: Object<'env>, field: String) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Prefix)?;
    into_js(crate::model::get_field(&n, &field)?)
}

#[napi]
pub fn prefix_set_field(receiver: Object<'_>, field: String, value: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Prefix)?;
    crate::model::set_field(&n, &field, argument(receiver.env, &value))
}
