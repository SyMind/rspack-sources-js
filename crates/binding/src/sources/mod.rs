pub mod cached;
pub mod compat;
pub mod concat;
pub mod original;
pub mod prefix;
pub mod raw;
pub mod replace;
pub mod size_only;
pub mod source_map;

use crate::{
    js::Js,
    model::{Field, Kind, SourceNode, prepare_concat, snapshot, source_text},
};
use napi::{Result, sys};
use rspack_sources::{Source, SourceRef};
use std::{collections::HashSet, rc::Rc};

pub(crate) fn initial_snapshot(n: &Rc<SourceNode>) -> Result<Option<SourceRef>> {
    match n.kind {
        Kind::Raw => raw::initial(n),
        Kind::Original => Ok(n.original.as_ref().and_then(|s| s.snapshot())),
        Kind::Replace => replace::initial(n),
        _ => Ok(None),
    }
}

pub(crate) fn validate_snapshot(n: &Rc<SourceNode>) -> Result<bool> {
    match n.kind {
        Kind::Raw => raw::validate(n),
        Kind::Original => Ok(n.snapshot.borrow().is_some()),
        Kind::SourceMap => source_map::validate(n),
        Kind::Concat => concat::validate(n),
        Kind::Replace => n.sort_edits(),
        _ => Ok(false),
    }
}

pub(crate) fn compile_snapshot(
    n: &Rc<SourceNode>,
    children: Vec<SourceRef>,
) -> Result<Option<SourceRef>> {
    match n.kind {
        Kind::Raw => raw::compile(n, children),
        Kind::SourceMap => source_map::compile(n, children),
        Kind::Replace => replace::compile(n, children),
        _ => Ok(None),
    }
}

pub(crate) fn text(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
) -> Result<Option<Vec<u16>>> {
    match n.kind {
        Kind::Raw => Ok(n.text("_value")),
        Kind::Original => Ok(original::text(n)),
        Kind::SourceMap => Ok(n.text("_valueAsString")),
        Kind::Cached => {
            if let Some(text) = n.cache().borrow().text() {
                return Ok(Some(text.encode_utf16().collect()));
            }
            Ok(n.text("_cachedSource"))
        }
        Kind::Concat => concat::text(n, visiting),
        Kind::Replace => replace::text(n, visiting),
        Kind::Prefix => prefix::text(n, visiting),
        _ => Ok(None),
    }
}

pub(crate) fn leaf_source(n: &Rc<SourceNode>, key: &str) -> Result<Js> {
    let value = n.get(key)?;
    if !value.is_undefined()? {
        return Ok(value);
    }
    let buffer = n.get("_valueAsBuffer")?;
    let value = if buffer.is_buffer()? {
        let text = String::from_utf8_lossy(&buffer.bytes()?).into_owned();
        Js::string(n.store.env, &text)?
    } else {
        buffer.method("toString", &[Js::string(n.store.env, "utf8")?])?
    };
    if n.helper("dual", &[])?.truthy()? {
        n.put(key, value)?;
    }
    Ok(value)
}

pub(crate) fn leaf_buffer(n: &Rc<SourceNode>, key: &str) -> Result<Js> {
    let value = n.get("_valueAsBuffer")?;
    if !value.is_undefined()? {
        return Ok(value);
    }
    let value = if let Some(source) = n.snapshot.borrow().as_ref() {
        // Raw and SourceMap snapshots already own the generated UTF-8.
        // Give JS a writable copy without aliasing the snapshot.
        Js::buffer(n.store.env, &source.buffer())?
    } else if let Field::Text(text) = n.field(key) {
        Js::buffer(
            n.store.env,
            String::from_utf16_lossy(&text.units).as_bytes(),
        )?
    } else {
        Js::buffer_constructor(n.store.env)?
            .method("from", &[n.get(key)?, Js::string(n.store.env, "utf8")?])?
    };
    if n.helper("dual", &[])?.truthy()? {
        n.put("_valueAsBuffer", value)?;
    }
    Ok(value)
}

pub(crate) fn leaf_size(n: &Rc<SourceNode>, key: &str) -> Result<Js> {
    let cached = n.get("_cachedSize")?;
    if !cached.is_undefined()? {
        return Ok(cached);
    }
    let buffer = n.get("_valueAsBuffer")?;
    let size = if buffer.is_buffer()? {
        Some(buffer.bytes()?.len())
    } else {
        n.text(key)
            .map(|text| String::from_utf16_lossy(&text).len())
    };
    let value = match size {
        Some(size) => Js::number(n.store.env, size as f64)?,
        None if buffer.is_undefined()? => Js::buffer_constructor(n.store.env)?.method(
            "byteLength",
            &[n.get(key)?, Js::string(n.store.env, "utf8")?],
        )?,
        None => buffer.get("length")?,
    };
    n.put("_cachedSize", value)?;
    Ok(value)
}

pub(crate) fn composite_source(n: &Rc<SourceNode>) -> Result<Js> {
    if let Some(text) = source_text(n, &mut HashSet::new())? {
        Js::utf16(n.store.env, &text)
    } else {
        Js::undefined(n.store.env)
    }
}

pub(crate) fn composite_buffer(n: &Rc<SourceNode>) -> Result<Js> {
    if let Some(text) = source_text(n, &mut HashSet::new())? {
        Js::buffer(n.store.env, String::from_utf16_lossy(&text).as_bytes())
    } else {
        Js::undefined(n.store.env)
    }
}

pub(crate) fn single_buffer(env: sys::napi_env, buffer: Js) -> Result<Js> {
    if buffer.is_undefined()? {
        Ok(buffer)
    } else {
        Js::array(env, &[buffer])
    }
}

pub(crate) fn buffer_size(buffer: Js) -> Result<Js> {
    if buffer.is_undefined()? {
        Ok(buffer)
    } else {
        Js::number(buffer.env, buffer.bytes()?.len() as f64)
    }
}

pub(crate) fn map_result(n: &Rc<SourceNode>, options: Js, include_source: bool) -> Result<Js> {
    let columns = n.helper("columns", &[options])?;
    let columns = if columns.is_undefined()? {
        None
    } else {
        Some(columns.truthy()?)
    };
    map_result_columns(n, columns, include_source)
}

pub(crate) fn map_result_columns(
    n: &Rc<SourceNode>,
    columns: Option<bool>,
    include_source: bool,
) -> Result<Js> {
    if let Some(columns) = columns {
        let read = |source: &dyn Source| -> Result<_> {
            let map = crate::diagnostics::source_map(source, columns)?;
            let text = include_source.then(|| source.source().into_string_lossy().into_owned());
            Ok((map, text))
        };
        let output = if n.kind == Kind::Concat {
            if prepare_concat(n)? {
                Some(read(&*n.concat().source.borrow())?)
            } else {
                None
            }
        } else {
            snapshot(n)?.as_deref().map(read).transpose()?
        };
        if let Some((map, text)) = output {
            crate::diagnostics::STATS.with(|s| s.borrow_mut().native_reads += 1);
            let map = crate::diagnostics::map_value(n.store.env, map)?;
            return match text {
                Some(text) => pair(n, Js::string(n.store.env, &text)?, map),
                None => Ok(map),
            };
        }
    }
    crate::diagnostics::STATS.with(|s| s.borrow_mut().fallbacks += 1);
    Js::undefined(n.store.env)
}

pub(crate) fn pair(n: &Rc<SourceNode>, source: Js, map: Js) -> Result<Js> {
    let result = Js::object(n.store.env)?;
    result.set("source", source)?;
    result.set("map", map)?;
    Ok(result)
}
