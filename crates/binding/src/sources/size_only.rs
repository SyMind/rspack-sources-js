use crate::model::{Kind, SourceNode, argument, into_js, object, require};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;

#[napi]
pub fn size_only_new(receiver: Object<'_>, store: Object<'_>, size: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, object(&store), Kind::SizeOnly)?;
    n.put("_size", argument(receiver.env, &size))?;
    n.finish()
}

#[napi]
pub fn size_only_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SizeOnly)?;
    into_js(n.get("_size")?)
}

#[napi]
pub fn size_only_get_field<'env>(receiver: Object<'env>, field: String) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::SizeOnly)?;
    into_js(crate::model::get_field(&n, &field)?)
}

#[napi]
pub fn size_only_set_field(receiver: Object<'_>, field: String, value: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::SizeOnly)?;
    crate::model::set_field(&n, &field, argument(receiver.env, &value))
}
