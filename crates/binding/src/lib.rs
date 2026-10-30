use std::{borrow::Cow, sync::Arc};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rspack_sources::{
    BoxSource, ConcatSource, MapOptions, OriginalSource, RawStringSource, ReplaceSource, SourceExt,
    SourceMap, SourceMapSource, SourceMapSourceOptions,
};
use serde_json::Value;

#[napi(object)]
pub struct MapInput {
    pub mappings: String,
    pub sources: Vec<String>,
    pub sources_content: Vec<String>,
    pub names: Vec<String>,
    pub source_root: Option<String>,
    pub file: Option<String>,
    pub debug_id: Option<String>,
    pub ignore_list: Option<Vec<u32>>,
}

impl MapInput {
    fn into_map(self) -> Option<SourceMap<'static>> {
        if !valid_mappings(&self.mappings, self.sources.len(), self.names.len()) {
            return None;
        }
        let mut map = SourceMap::new(
            self.mappings,
            self.sources.into_iter().map(Cow::Owned).collect(),
            self.sources_content.into_iter().map(Cow::Owned).collect(),
            self.names.into_iter().map(Cow::Owned).collect(),
        );
        map.set_source_root(self.source_root.map(Cow::Owned));
        map.set_file(self.file.map(Cow::Owned));
        map.set_debug_id(self.debug_id.map(Cow::Owned));
        map.set_ignore_list(self.ignore_list.map(Cow::Owned));
        Some(map)
    }
}

fn valid_mappings(mappings: &str, sources: usize, names: usize) -> bool {
    let mut previous = [0_i64; 5];
    for line in mappings.split(';') {
        previous[0] = 0;
        for segment in line.split(',').filter(|s| !s.is_empty()) {
            let mut field = 0;
            let mut value = 0_i64;
            let mut shift = 0;
            for byte in segment.bytes() {
                let digit = match byte {
                    b'A'..=b'Z' => byte - b'A',
                    b'a'..=b'z' => byte - b'a' + 26,
                    b'0'..=b'9' => byte - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    _ => return false,
                };
                if shift > 30 || field >= 5 {
                    return false;
                }
                value |= i64::from(digit & 31) << shift;
                if digit & 32 != 0 {
                    shift += 5;
                    continue;
                }
                let delta = if value & 1 == 1 {
                    -(value >> 1)
                } else {
                    value >> 1
                };
                if field == 0 && delta < 0 {
                    return false;
                }
                previous[field] += delta;
                if previous[field] < 0 || previous[field] > i64::from(u32::MAX) - 1 {
                    return false;
                }
                field += 1;
                value = 0;
                shift = 0;
            }
            if shift != 0 || !matches!(field, 1 | 4 | 5) {
                return false;
            }
            if field >= 4 && previous[1] as usize >= sources {
                return false;
            }
            if field == 5 && previous[4] as usize >= names {
                return false;
            }
        }
    }
    true
}

#[napi(object)]
pub struct Edit {
    /// UTF-16 boundaries; end is exclusive. Conversion happens once per batch.
    pub start: u32,
    pub end: u32,
    pub content: String,
    pub name: Option<String>,
}

#[napi(object)]
pub struct Node {
    pub kind: String,
    pub text: Option<String>,
    pub name: Option<String>,
    /// Nonnegative indices refer to earlier records, negative indices to existing handles.
    pub children: Option<Vec<i32>>,
    pub edits: Option<Vec<Edit>>,
    pub source_map: Option<MapInput>,
    pub original_source: Option<String>,
    pub inner_source_map: Option<MapInput>,
    pub remove_original_source: Option<bool>,
}

#[napi]
pub struct NativeSource {
    source: BoxSource,
}

fn invalid(message: &str) -> Error {
    Error::new(Status::InvalidArg, message.to_owned())
}

fn required<T>(value: Option<T>, message: &str) -> Result<T> {
    value.ok_or_else(|| invalid(message))
}

fn resolve(
    index: i32,
    built: &[NativeSource],
    existing: &[ClassInstance<NativeSource>],
) -> Result<BoxSource> {
    let source = if index >= 0 {
        built.get(index as usize).map(|node| &node.source)
    } else {
        existing
            .get((-1_i64 - i64::from(index)) as usize)
            .map(|node| &node.source)
    };
    source
        .map(Arc::clone)
        .ok_or_else(|| invalid("Invalid source reference"))
}

// Return None for edits that Rust cannot represent losslessly. No JS callbacks have run.
fn byte_offsets(text: &str, edits: &[Edit]) -> Option<Vec<(u32, u32)>> {
    if text.len() > u32::MAX as usize {
        return None;
    }
    let mut boundaries = Vec::with_capacity(edits.len() * 2);
    for edit in edits {
        if edit.start > edit.end {
            return None;
        }
        boundaries.push(edit.start);
        boundaries.push(edit.end);
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    let mut offsets = Vec::with_capacity(boundaries.len());
    let mut wanted = boundaries.iter().copied().peekable();
    let mut column = 0_u32;
    for (byte, ch) in text.char_indices() {
        if wanted.peek() == Some(&column) {
            offsets.push(byte as u32);
            wanted.next();
        }
        column = column.checked_add(ch.len_utf16() as u32)?;
        if wanted.peek().is_some_and(|next| *next < column) {
            return None;
        }
    }
    if wanted.peek() == Some(&column) {
        offsets.push(text.len() as u32);
        wanted.next();
    }
    if wanted.next().is_some() {
        return None;
    }
    edits
        .iter()
        .map(|edit| {
            Some((
                offsets[boundaries.binary_search(&edit.start).ok()?],
                offsets[boundaries.binary_search(&edit.end).ok()?],
            ))
        })
        .collect()
}

#[napi]
pub fn compile_sources(
    nodes: Vec<Node>,
    existing: Vec<ClassInstance<NativeSource>>,
) -> Result<Option<Vec<NativeSource>>> {
    let mut built: Vec<NativeSource> = Vec::with_capacity(nodes.len());
    for node in nodes {
        let source: BoxSource = match node.kind.as_str() {
            "raw" => RawStringSource::from(required(node.text, "Missing raw text")?).boxed(),
            "original" => OriginalSource::new(
                required(node.text, "Missing original text")?,
                required(node.name, "Missing original name")?,
            )
            .boxed(),
            "concat" => {
                let children = required(node.children, "Missing concat children")?
                    .into_iter()
                    .map(|id| resolve(id, &built, &existing))
                    .collect::<Result<Vec<_>>>()?;
                ConcatSource::new(children).boxed()
            }
            "replace" => {
                let children = required(node.children, "Missing replacement child")?;
                if children.len() != 1 {
                    return Err(invalid("Replacement requires one child"));
                }
                let child = resolve(children[0], &built, &existing)?;
                let edits = required(node.edits, "Missing edits")?;
                let offsets = if edits.is_empty() {
                    Vec::new()
                } else {
                    let text = child.source().into_string_lossy();
                    let Some(offsets) = byte_offsets(&text, &edits) else {
                        return Ok(None);
                    };
                    offsets
                };
                let mut replaced = ReplaceSource::new(child);
                for (edit, (start, end)) in edits.into_iter().zip(offsets) {
                    replaced.replace(start, end, edit.content, edit.name);
                }
                replaced.boxed()
            }
            "mapped" => {
                let Some(source_map) = required(node.source_map, "Missing source map")?.into_map()
                else {
                    return Ok(None);
                };
                let inner_source_map = match node.inner_source_map {
                    Some(map) => {
                        let Some(map) = map.into_map() else {
                            return Ok(None);
                        };
                        Some(map)
                    }
                    None => None,
                };
                SourceMapSource::new(SourceMapSourceOptions {
                    value: required(node.text, "Missing mapped text")?,
                    name: required(node.name, "Missing mapped name")?,
                    source_map,
                    original_source: node.original_source.map(String::into_boxed_str),
                    inner_source_map,
                    remove_original_source: node.remove_original_source.unwrap_or(false),
                })
                .boxed()
            }
            _ => return Err(invalid("Unsupported source kind")),
        };
        built.push(NativeSource { source });
    }
    Ok(Some(built))
}

#[napi(object)]
pub struct SourceAndMap {
    pub source: String,
    pub map: Value,
}

#[napi]
impl NativeSource {
    #[napi]
    pub fn source(&self) -> String {
        self.source.source().into_string_lossy().into_owned()
    }

    #[napi]
    pub fn buffer(&self) -> Buffer {
        // JS receives its own writable allocation, never shared Rust backing storage.
        self.source.buffer().into_owned().into()
    }

    #[napi]
    pub fn size(&self) -> f64 {
        self.source.size() as f64
    }

    #[napi]
    pub fn map(&self, columns: bool) -> Result<Value> {
        match self.source.map(&MapOptions::new(columns)) {
            Some(map) => {
                let mut value = serde_json::to_value(map).map_err(|e| invalid(&e.to_string()))?;
                // webpack-sources uses a placeholder file for generated maps.
                value["file"] = Value::String("x".into());
                Ok(value)
            }
            None => Ok(Value::Null),
        }
    }

    #[napi]
    pub fn source_and_map(&self, columns: bool) -> Result<SourceAndMap> {
        Ok(SourceAndMap {
            source: self.source(),
            map: self.map(columns)?,
        })
    }
}
