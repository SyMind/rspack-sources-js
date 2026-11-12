use std::{
  borrow::Cow,
  io::{self, Write},
};

use crate::{
  MapOptions, Source, SourceMap, SourceRef, SourceValue,
  helpers::{Chunks, StreamChunks},
};

/// The native representation of an adapted Source-like input.
#[derive(Clone, Debug, Hash, Eq, PartialEq)]
pub struct CompatSource {
  inner: SourceRef,
  pub(crate) byte_source: Option<SourceRef>,
}

impl CompatSource {
  pub fn new(inner: SourceRef) -> Self {
    Self {
      inner,
      byte_source: None,
    }
  }

  /// Capture the byte representation supplied by an external source-like.
  pub fn with_byte_source(inner: SourceRef, byte_source: SourceRef) -> Self {
    Self {
      inner,
      byte_source: Some(byte_source),
    }
  }

  fn bytes(&self) -> &SourceRef {
    self.byte_source.as_ref().unwrap_or(&self.inner)
  }

  pub fn inner(&self) -> &SourceRef {
    &self.inner
  }
}

impl Source for CompatSource {
  fn source(&self) -> SourceValue<'_> {
    self.inner().source()
  }
  fn rope<'a>(&'a self, f: &mut dyn FnMut(&'a str)) {
    self.inner().rope(f);
  }
  fn buffer(&self) -> Cow<'_, [u8]> {
    self.bytes().buffer()
  }
  fn size(&self) -> usize {
    self.inner().size()
  }
  fn map(&self, options: &MapOptions) -> Option<SourceMap> {
    self.inner().map(options)
  }
  fn to_writer(&self, writer: &mut dyn Write) -> io::Result<()> {
    self.bytes().to_writer(writer)
  }
}

impl StreamChunks for CompatSource {
  fn stream_chunks(&self) -> Box<dyn Chunks<'_> + '_> {
    self.inner().stream_chunks()
  }
}
