use crate::{
    diagnostics::STATS,
    js::Js,
    model::{
        Child, Kind, SourceNode, argument, into_js, node, object, prepare_concat, require,
        resolve_jsobject, source_text,
    },
    source_helpers::{create_raw_source, source_context},
};
use napi::{Result, bindgen_prelude::*, sys};
use napi_derive::napi;
use rspack_sources::{ConcatSource, RawStringSource, Source, SourceExt, SourceRef};
use std::{
    cell::{Cell, RefCell},
    collections::HashSet,
    rc::Rc,
};

#[derive(Default)]
pub(crate) struct BoundConcat {
    pub(crate) source: RefCell<ConcatSource>,
    optimized: Cell<bool>,
}

fn as_source_ref(child: &Child) -> Option<SourceRef> {
    match child {
        Child::Text(text) => String::from_utf16(text)
            .ok()
            .map(|s| RawStringSource::from(s).boxed()),
        Child::Node(node) => node.prepared_snapshot(),
        Child::Foreign(_) => None,
    }
}

// Validate before writing to either the native source or its GC roots.
fn append(
    n: &Rc<SourceNode>,
    items: impl Iterator<Item = Js>,
    skip_optimizing: bool,
) -> Result<bool> {
    let mut values = Vec::new();
    for value in items {
        if value.ty()? != sys::ValueType::napi_string {
            let child = node(value)?.ok_or_else(|| crate::invalid(
                "ConcatSource expects a string or a bound Source; wrap custom objects in CompatSource",
            ))?;
            if !skip_optimizing && child.kind == Kind::Concat {
                for entry in child.current_children() {
                    values.push(child.child_value(&entry)?);
                }
                continue;
            }
        }
        values.push(value);
    }

    let mut children = Vec::with_capacity(values.len());
    for value in values {
        let child = if skip_optimizing && value.ty()? == sys::ValueType::napi_string {
            Child::Node(raw_literal(value)?)
        } else {
            n.child(value)?
        };
        children.push(child);
    }

    let mut complete = true;
    let edges = n.store.get()?.get("edges")?;
    let mut next_edge = edges.len()?;
    for child in children {
        if let Child::Node(child) = &child {
            edges.set_index(next_edge, child.receiver()?)?;
            next_edge += 1;
            let parent = Rc::downgrade(n);
            let mut parents = child.parents.borrow_mut();
            if !parents.iter().any(|p| p.ptr_eq(&parent)) {
                parents.push(parent);
            }
        }
        if let Some(source) = as_source_ref(&child) {
            let mut concat = n.concat().source.borrow_mut();
            if skip_optimizing {
                concat.add_all_skip_optimizing([source]);
            } else {
                concat.add(source);
            }
        } else {
            complete = false;
        }
        n.children.borrow_mut().push(child);
        n.dirty();
    }
    if !skip_optimizing {
        n.concat().optimized.set(false);
    }
    Ok(complete)
}

#[napi]
pub fn concat_new(receiver: Object<'_>, items: Vec<Unknown<'_>>) -> Result<()> {
    let receiver = object(&receiver);
    let store = source_context(receiver)?;
    let n = SourceNode::allocate(receiver, store, Kind::Concat)?;
    store.set("edges", Js::array(receiver.env, &[])?)?;
    let complete = append(&n, items.iter().map(|v| argument(receiver.env, v)), false)?;
    n.concat().optimized.set(items.is_empty());
    n.finish()?;
    if complete {
        n.mark_prepared();
    }
    Ok(())
}

fn raw_literal(value: Js) -> Result<Rc<SourceNode>> {
    let raw = require(create_raw_source(value, false)?, Kind::Raw)?;
    raw.generated.set(true);
    Ok(raw)
}

fn is_literal(child: &Child) -> bool {
    matches!(child, Child::Text(_)) || matches!(child, Child::Node(n) if n.generated.get())
}

// Only literals and RawSources produced from literals are merged.
fn merge_literals(n: &Rc<SourceNode>, old: &[Child]) -> Result<Vec<Child>> {
    let mut children = Vec::with_capacity(old.len());
    for run in old.chunk_by(|a, b| is_literal(a) && is_literal(b)) {
        if let [child @ (Child::Foreign(_) | Child::Node(_))] = run {
            children.push(child.clone());
            continue;
        }
        let mut text = Vec::new();
        for child in run {
            match child {
                Child::Text(t) => text.extend_from_slice(t),
                Child::Node(child) => {
                    text.extend(child.receiver()?.method("source", &[])?.units()?)
                }
                Child::Foreign(_) => unreachable!(),
            }
        }
        children.push(Child::Node(raw_literal(Js::utf16(n.store.env, &text)?)?));
    }
    Ok(children)
}

fn child_object(source: &SourceRef, env: sys::napi_env) -> Result<Js> {
    let weak = source
        .jsobject()
        .ok_or_else(|| crate::invalid("Expected a JS-bound ConcatSource child"))?;
    resolve_jsobject(weak, env)
}

fn optimize(n: &Rc<SourceNode>) -> Result<()> {
    if n.concat().optimized.get() {
        return Ok(());
    }
    let children = merge_literals(n, &n.current_children())?;
    let sources: Option<Vec<_>> = children.iter().map(as_source_ref).collect();
    n.set_children(children)?;
    if let Some(sources) = sources {
        n.concat()
            .source
            .borrow_mut()
            .set_optimized_children(sources);
        n.mark_prepared();
    }
    n.concat().optimized.set(true);
    Ok(())
}

#[napi]
pub fn concat_get_children<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Concat)?;
    into_js(children_array(&n)?)
}

fn children_array(n: &Rc<SourceNode>) -> Result<Js> {
    optimize(n)?;
    let env = n.store.env;
    let values = if !n.dirty.get() {
        n.concat()
            .source
            .borrow()
            .children()
            .iter()
            .map(|source| child_object(source, env))
            .collect::<Result<Vec<_>>>()?
    } else {
        // A bound child such as CompatSource can have a JS receiver without a native snapshot.
        n.current_children()
            .iter()
            .map(|child| n.child_value(child))
            .collect::<Result<Vec<_>>>()?
    };
    Js::array(env, &values)
}

#[napi]
pub fn concat_add(receiver: Object<'_>, item: Unknown<'_>) -> Result<()> {
    let n = require(object(&receiver), Kind::Concat)?;
    append(&n, std::iter::once(argument(n.store.env, &item)), false)?;
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(())
}

#[napi]
pub fn concat_add_all_skip_optimizing(receiver: Object<'_>, items: Vec<Unknown<'_>>) -> Result<()> {
    let n = require(object(&receiver), Kind::Concat)?;
    append(&n, items.iter().map(|v| argument(n.store.env, v)), true)?;
    STATS.with(|s| s.borrow_mut().mutations += 1);
    Ok(())
}

pub(crate) fn validate(n: &Rc<SourceNode>) -> Result<bool> {
    optimize(n)?;
    Ok(!n
        .children
        .borrow()
        .iter()
        .any(|c| matches!(c, Child::Text(_))))
}

pub(crate) fn text(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
) -> Result<Option<Vec<u16>>> {
    optimize(n)?;
    let mut text = Vec::new();
    for child in n.current_children() {
        match child {
            Child::Text(_) => return Ok(None),
            Child::Node(child) => {
                let Some(t) = source_text(&child, visiting)? else {
                    return Ok(None);
                };
                text.extend(t)
            }
            Child::Foreign(_) => return Ok(None),
        }
    }
    Ok(Some(text))
}

#[napi]
pub fn concat_source<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Concat)?;
    if prepare_concat(&n)? {
        let source = n.concat().source.borrow();
        return into_js(Js::string(
            n.store.env,
            &source.source().into_string_lossy(),
        )?);
    }
    into_js(super::composite_source(&n)?)
}

#[napi]
pub fn concat_map<'env>(receiver: Object<'env>, columns: Option<bool>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Concat)?;
    into_js(super::map_result_columns(&n, columns, false)?)
}

#[napi]
pub fn concat_source_and_map<'env>(
    receiver: Object<'env>,
    columns: Option<bool>,
) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Concat)?;
    into_js(super::map_result_columns(&n, columns, true)?)
}

#[napi]
pub fn concat_size(receiver: Object<'_>) -> Result<Option<f64>> {
    let n = require(object(&receiver), Kind::Concat)?;
    Ok(prepare_concat(&n)?.then(|| n.concat().source.borrow().size() as f64))
}

#[napi]
pub fn concat_buffer(receiver: Object<'_>) -> Result<Option<Buffer>> {
    let n = require(object(&receiver), Kind::Concat)?;
    Ok(prepare_concat(&n)?.then(|| n.concat().source.borrow().buffer().into_owned().into()))
}

#[napi]
pub fn concat_buffers<'env>(receiver: Object<'env>) -> Result<Unknown<'env>> {
    let n = require(object(&receiver), Kind::Concat)?;
    let env = n.store.env;
    let children = children_array(&n)?;
    let mut buffers = Vec::new();
    for i in 0..children.len()? {
        let child = children.index(i)?;
        let method = child.get("buffers")?;
        if method.ty()? == sys::ValueType::napi_function {
            buffers.extend(method.call(child, &[])?.values()?);
        } else {
            let method = child.get("buffer")?;
            let buffer = if method.ty()? == sys::ValueType::napi_function {
                method.call(child, &[])?
            } else {
                let value = child.method("source", &[])?;
                if value.is_buffer()? {
                    value
                } else {
                    Js::buffer_constructor(env)?.method("from", &[value])?
                }
            };
            buffers.push(buffer);
        }
    }
    into_js(Js::array(env, &buffers)?)
}
