use crate::{
    diagnostics::STATS,
    js::Js,
    model::{Child, Field, Kind, SourceNode, argument, into_js, object, require, source_text},
    positions::{Edit, byte_offsets},
};
use napi::{Result, bindgen_prelude::*};
use napi_derive::napi;
use rspack_sources::{ReplaceSource, SourceExt, SourceRef};
use std::{collections::HashSet, rc::Rc};

#[derive(Clone, PartialEq)]
pub(crate) struct Replacement {
    pub(crate) start: f64,
    pub(crate) end: f64,
    pub(crate) content: Vec<u16>,
    pub(crate) name: Option<Vec<u16>>,
}

#[napi]
pub fn replace_new(
    receiver: Object<'_>,
    store: Object<'_>,
    source: Unknown<'_>,
    name: Unknown<'_>,
) -> Result<()> {
    let receiver = object(&receiver);
    let n = SourceNode::allocate(receiver, object(&store), Kind::Replace)?;
    let source = argument(receiver.env, &source);
    n.put("_source", source)?;
    n.put("_name", argument(receiver.env, &name))?;
    n.put_field("_isSorted", Field::Bool(true));
    n.set_children(vec![n.child(source)?])?;
    n.finish()
}

pub(crate) fn initial(n: &Rc<SourceNode>) -> Result<Option<SourceRef>> {
    Ok(n.children
        .borrow()
        .first()
        .and_then(|c| match c {
            Child::Node(n) => n.prepared_snapshot(),
            _ => None,
        })
        .map(|source| ReplaceSource::new(source).boxed()))
}

pub(crate) fn compile(
    n: &Rc<SourceNode>,
    mut children: Vec<SourceRef>,
) -> Result<Option<SourceRef>> {
    if children.len() != 1 {
        return Ok(None);
    }
    let child = children.remove(0);
    let mut edits = Vec::new();
    let mut previous = 0.;
    for edit in n.edits.borrow().iter() {
        if edit.start.fract() != 0.
            || edit.end.fract() != 0.
            || edit.start < 0.
            || edit.end < edit.start - 1.
            || edit.end >= u32::MAX as f64
            || edit.start > u32::MAX as f64
            || edit.start < previous
        {
            return Ok(None);
        }
        let Ok(content) = String::from_utf16(&edit.content) else {
            return Ok(None);
        };
        let name = match &edit.name {
            Some(name) => {
                let Ok(name) = String::from_utf16(name) else {
                    return Ok(None);
                };
                Some(name)
            }
            None => None,
        };
        previous = edit.end + 1.;
        edits.push(Edit {
            start: edit.start as u32,
            end: (edit.end + 1.) as u32,
            content,
            name,
        });
    }
    let offsets = if edits.is_empty() {
        Vec::new()
    } else {
        let text = child.source().into_string_lossy();
        let Some(offsets) = byte_offsets(&text, &edits) else {
            return Ok(None);
        };
        offsets
    };
    let mut result = ReplaceSource::new(child);
    for (edit, (start, end)) in edits.into_iter().zip(offsets) {
        result.replace(start, end, edit.content, edit.name);
    }
    Ok(Some(result.boxed()))
}

pub(crate) fn text(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
) -> Result<Option<Vec<u16>>> {
    if !n.sort_edits()? {
        return Ok(None);
    }
    let Some(Child::Node(child)) = n.children.borrow().first().cloned() else {
        return Ok(None);
    };
    let Some(text) = source_text(&child, visiting)? else {
        return Ok(None);
    };
    let mut result = Vec::new();
    let mut pos = 0.;
    for edit in n.edits.borrow().iter() {
        let start = edit.start.floor();
        let end = (edit.end + 1.).floor();
        if pos < start {
            let from = (pos.max(0.) as usize).min(text.len());
            let to = (start.max(0.) as usize).min(text.len());
            if from < to {
                result.extend_from_slice(&text[from..to]);
            }
            pos = start;
        }
        result.extend_from_slice(&edit.content);
        if pos < end {
            pos = end;
        }
    }
    if pos < (text.len() as f64) {
        result.extend_from_slice(&text[(pos.max(0.) as usize).min(text.len())..]);
    }
    Ok(Some(result))
}

fn empty(n: &Rc<SourceNode>) -> Result<bool> {
    Ok(n.sync_edits()? && n.edits.borrow().is_empty())
}

pub(crate) fn source(n: &Rc<SourceNode>) -> Result<Js> {
    if empty(n)? {
        n.child_call("source", &[])
    } else {
        super::composite_source(n)
    }
}

pub(crate) fn buffer(n: &Rc<SourceNode>) -> Result<Js> {
    if empty(n)? {
        n.child_call("buffer", &[])
    } else {
        super::composite_buffer(n)
    }
}

fn buffers(n: &Rc<SourceNode>) -> Result<Js> {
    if empty(n)? {
        n.child_call("buffers", &[])
    } else {
        super::single_buffer(n.store.env, buffer(n)?)
    }
}

pub(crate) fn size(n: &Rc<SourceNode>) -> Result<Js> {
    super::buffer_size(buffer(n)?)
}

pub(crate) fn map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    if empty(n)? {
        n.child_call("map", &[options])
    } else {
        super::map_result(n, options, false)
    }
}

pub(crate) fn source_and_map(n: &Rc<SourceNode>, options: Js) -> Result<Js> {
    if empty(n)? {
        n.child_call("sourceAndMap", &[options])
    } else {
        super::map_result(n, options, true)
    }
}

fn original(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_source")
}

fn get_name(n: &Rc<SourceNode>) -> Result<Js> {
    n.get("_name")
}

fn get_replacements(n: &Rc<SourceNode>) -> Result<Js> {
    sort(n)?;
    n.replacements()
}

fn sort(n: &Rc<SourceNode>) -> Result<Js> {
    if !n.boolean("_isSorted") && !n.sort_edits()? {
        n.sort_replacements_array()?;
    }
    Js::undefined(n.store.env)
}

fn edit(
    n: &Rc<SourceNode>,
    start: Js,
    end: Js,
    content: Js,
    name: Js,
    insert: bool,
) -> Result<bool> {
    if start.ty()? != napi::sys::ValueType::napi_number
        || (!insert && end.ty()? != napi::sys::ValueType::napi_number)
        || content.ty()? != napi::sys::ValueType::napi_string
        || (!name.is_undefined()? && name.ty()? != napi::sys::ValueType::napi_string)
        || !n.sync_edits()?
    {
        return Ok(false);
    }
    let start = start.float()?;
    let end = if insert { start - 1. } else { end.float()? };
    let replacement = Replacement {
        start,
        end,
        content: content.units()?,
        name: if name.is_undefined()? {
            None
        } else {
            Some(name.units()?)
        },
    };
    if n.edits_view.get() {
        let array = n.get("_replacements")?;
        array.set_index(array.len()?, n.replacement_value(&replacement)?)?;
    }
    n.edits.borrow_mut().push(replacement);
    n.put_field("_isSorted", Field::Bool(false));
    n.dirty();
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(true)
}

#[napi]
pub fn replace_replace(
    receiver: Object<'_>,
    start: Unknown<'_>,
    end: Unknown<'_>,
    content: Unknown<'_>,
    name: Unknown<'_>,
) -> Result<bool> {
    let receiver = object(&receiver);
    let n = crate::model::require(receiver, Kind::Replace)?;
    edit(
        &n,
        argument(receiver.env, &start),
        argument(receiver.env, &end),
        argument(receiver.env, &content),
        argument(receiver.env, &name),
        false,
    )
}

#[napi]
pub fn replace_insert(
    receiver: Object<'_>,
    position: Unknown<'_>,
    content: Unknown<'_>,
    name: Unknown<'_>,
) -> Result<bool> {
    let receiver = object(&receiver);
    let n = crate::model::require(receiver, Kind::Replace)?;
    edit(
        &n,
        argument(receiver.env, &position),
        Js::undefined(receiver.env)?,
        argument(receiver.env, &content),
        argument(receiver.env, &name),
        true,
    )
}

#[napi]
pub fn replace_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(source(&n)?)
}

#[napi]
pub fn replace_buffer<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(buffer(&n)?)
}

#[napi]
pub fn replace_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(buffers(&n)?)
}

#[napi]
pub fn replace_size<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(size(&n)?)
}

#[napi]
pub fn replace_original<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(original(&n)?)
}

#[napi]
pub fn replace_get_name<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(get_name(&n)?)
}

#[napi]
pub fn replace_get_replacements<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(get_replacements(&n)?)
}

#[napi]
pub fn replace_sort_replacements<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(sort(&n)?)
}

#[napi]
pub fn replace_map<'env>(receiver: Object<'env>, options: Unknown<'env>) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Replace)?;
    into_js(map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn replace_source_and_map<'env>(
    receiver: Object<'env>,
    options: Unknown<'env>,
) -> Result<Unknown<'env>> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Replace)?;
    into_js(source_and_map(&n, argument(receiver.env, &options))?)
}

#[napi]
pub fn replace_get_field<'env>(receiver: Object<'env>, field: String) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Replace)?;
    into_js(crate::model::get_field(&n, &field)?)
}

#[napi]
pub fn replace_set_field(receiver: Object<'_>, field: String, value: Unknown<'_>) -> Result<()> {
    let receiver = object(&receiver);
    let n = require(receiver, Kind::Replace)?;
    crate::model::set_field(&n, &field, argument(receiver.env, &value))
}

impl SourceNode {
    pub(crate) fn replacements(self: &Rc<Self>) -> Result<Js> {
        if !self.edits_view.get() {
            let edits = self.edits.borrow().clone();
            let mut values = Vec::with_capacity(edits.len());
            for e in edits {
                values.push(self.replacement_value(&e)?);
            }
            let array = Js::array(self.store.env, &values)?;
            self.put("_replacements", array)?;
            self.edits_view.set(true);
        }
        self.get("_replacements")
    }

    pub(crate) fn replacement_value(&self, e: &Replacement) -> Result<Js> {
        let env = self.store.env;
        self.helper(
            "replacement",
            &[
                Js::number(env, e.start)?,
                Js::number(env, e.end)?,
                Js::utf16(env, &e.content)?,
                match &e.name {
                    Some(v) => Js::utf16(env, v)?,
                    None => Js::undefined(env)?,
                },
            ],
        )
    }

    pub(crate) fn sync_edits(self: &Rc<Self>) -> Result<bool> {
        if !self.edits_view.get() {
            return Ok(true);
        }
        let array = self.get("_replacements")?;
        let env = self.store.env;
        let fields = Js::array(
            env,
            &[
                Js::string(env, "start")?,
                Js::string(env, "end")?,
                Js::string(env, "content")?,
                Js::string(env, "name")?,
            ],
        )?;
        if !self.helper("plainArray", &[array, fields])?.truthy()? {
            return Ok(false);
        }
        let mut edits = Vec::new();
        for item in array.values()? {
            let start = item.get("start")?;
            let end = item.get("end")?;
            let content = item.get("content")?;
            let name = item.get("name")?;
            if start.ty()? != sys::ValueType::napi_number
                || end.ty()? != sys::ValueType::napi_number
                || content.ty()? != sys::ValueType::napi_string
                || (!name.is_undefined()? && name.ty()? != sys::ValueType::napi_string)
            {
                return Ok(false);
            }
            edits.push(Replacement {
                start: start.float()?,
                end: end.float()?,
                content: content.units()?,
                name: if name.is_undefined()? {
                    None
                } else {
                    Some(name.units()?)
                },
            });
        }
        if *self.edits.borrow() != edits {
            self.edits.replace(edits);
            self.dirty();
        }
        Ok(true)
    }

    fn sort_replacements_array(self: &Rc<Self>) -> Result<()> {
        self.helper("sortReplacements", &[self.replacements()?])?;
        self.put_field("_isSorted", Field::Bool(true));
        self.dirty();
        Ok(())
    }

    pub(crate) fn sort_edits(self: &Rc<Self>) -> Result<bool> {
        if !self.sync_edits()? {
            return Ok(false);
        }
        if self.boolean("_isSorted") {
            return Ok(true);
        }
        if self.edits_view.get() {
            // An exposed array may have its own sort implementation. Import
            // exactly what that implementation leaves behind, without first
            // sorting a second, independently authoritative copy.
            self.sort_replacements_array()?;
            return self.sync_edits();
        }
        if !self.helper("sortAllowed", &[])?.truthy()? {
            return Ok(false);
        }
        if self
            .edits
            .borrow()
            .iter()
            .any(|e| !e.start.is_finite() || !e.end.is_finite())
        {
            return Ok(false);
        }
        self.edits.borrow_mut().sort_by(|a, b| {
            a.start
                .partial_cmp(&b.start)
                .unwrap()
                .then_with(|| a.end.partial_cmp(&b.end).unwrap())
        });
        self.put_field("_isSorted", Field::Bool(true));
        Ok(true)
    }
}
