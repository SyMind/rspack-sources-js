use std::{
  borrow::Cow,
  io::{self, Write},
};

use crate::{
  MapOptions, Source, SourceMap, SourceValue,
  helpers::{Chunks, StreamChunks},
};

/// A size-only asset. Content reads at the JS boundary raise the webpack error.
#[derive(Debug, Hash, PartialEq, Eq)]
pub struct SizeOnlySource(pub usize);

impl SizeOnlySource {
  pub const UNAVAILABLE: &'static str =
    "Content and Map of this Source is not available (only size() is supported)";
}

impl Source for SizeOnlySource {
  fn source(&self) -> SourceValue<'_> {
    panic!("{}", Self::UNAVAILABLE)
  }
  fn rope<'a>(&'a self, _: &mut dyn FnMut(&'a str)) {
    panic!("{}", Self::UNAVAILABLE)
  }
  fn buffer(&self) -> Cow<'_, [u8]> {
    panic!("{}", Self::UNAVAILABLE)
  }
  fn size(&self) -> usize {
    self.0
  }
  fn map(&self, _: &MapOptions) -> Option<SourceMap> {
    panic!("{}", Self::UNAVAILABLE)
  }
  fn to_writer(&self, _: &mut dyn Write) -> io::Result<()> {
    Err(io::Error::other(Self::UNAVAILABLE))
  }
}
impl StreamChunks for SizeOnlySource {
  fn stream_chunks(&self) -> Box<dyn Chunks<'_> + '_> {
    panic!("{}", Self::UNAVAILABLE)
  }
}
