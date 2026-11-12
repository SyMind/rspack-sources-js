//! Rusty [`webpack-sources`](https://github.com/webpack/webpack-sources) port.

#![allow(
  clippy::collapsible_if,
  clippy::get_unwrap,
  clippy::let_and_return,
  clippy::manual_string_new,
  clippy::map_unwrap_or,
  clippy::rc_buffer,
  clippy::redundant_clone,
  clippy::rest_pat_in_fully_bound_structs,
  clippy::trivial_regex,
  clippy::uninlined_format_args,
  clippy::unreadable_literal,
  clippy::unwrap_used
)]

mod cached_source;
mod compat_source;
mod concat_source;
mod decoder;
mod encoder;
mod error;
mod helpers;
mod line_index;
mod linear_map;
mod mapping_source;
mod original_source;
mod prefix_source;
mod raw_source;
mod replace_source;
mod size_only_source;
mod source;
mod source_content_lines;
mod source_map_source;
#[cfg(feature = "binding")]
mod threadsafe_weak_ref;

#[cfg(feature = "binding")]
pub use threadsafe_weak_ref::ThreadsafeWeakRef;

/// Feature for rspack persistent cache serialization/deserialization.
#[cfg(feature = "rspack_cacheable")]
pub mod cacheable;

pub use cached_source::{CachedData, CachedSource};
pub use compat_source::CompatSource;
pub use concat_source::ConcatSource;
pub use error::{Error, Result};
pub use mapping_source::MappingSource;
pub use original_source::OriginalSource;
pub use prefix_source::PrefixSource;
pub use raw_source::{RawBufferSource, RawStringSource};
pub use replace_source::{ReplaceSource, Replacement, ReplacementEnforce};
pub use size_only_source::SizeOnlySource;
pub use source::{
  MapOptions, Mapping, OriginalLocation, Source, SourceExt, SourceMap, SourceRef, SourceValue,
};
pub use source_map_source::{SourceMapSource, SourceMapSourceOptions, WithoutOriginalOptions};

/// Reexport `StreamChunks` related types.
pub mod stream_chunks {
  pub use super::helpers::{
    Chunks, GeneratedInfo, OnChunk, OnName, OnSource, StreamChunks, TextSpan, stream_chunks_default,
  };
}

pub use helpers::{decode_mappings, encode_mappings, utf8_column_to_utf16_column, utf16_len};
