use std::{
  borrow::Cow,
  io::{self, Write},
};

use crate::{
  MapOptions, Mapping, Source, SourceMap, SourceRef, SourceValue,
  helpers::{Chunks, GeneratedInfo, OnChunk, OnName, OnSource, StreamChunks, TextSpan, get_map},
};

/// Prepends a prefix to the first line and to each line following a newline.
#[derive(Debug, Eq, PartialEq, Hash)]
pub struct PrefixSource {
  prefix: String,
  inner: SourceRef,
}

impl PrefixSource {
  pub fn new(prefix: impl Into<String>, inner: SourceRef) -> Self {
    Self {
      prefix: prefix.into(),
      inner,
    }
  }

  pub fn prefix(&self) -> &str {
    &self.prefix
  }
  pub fn inner(&self) -> &SourceRef {
    &self.inner
  }
}

impl Source for PrefixSource {
  fn source(&self) -> SourceValue<'_> {
    if self.prefix.is_empty() {
      return self.inner.source();
    }
    let mut text = String::new();
    self.rope(&mut |part| text.push_str(part));
    SourceValue::String(Cow::Owned(text))
  }
  fn rope<'a>(&'a self, visit: &mut dyn FnMut(&'a str)) {
    if self.prefix.is_empty() {
      return self.inner.rope(visit);
    }
    visit(&self.prefix);
    let mut newline = false;
    self.inner.rope(&mut |part| {
      for line in part.split_inclusive('\n') {
        if newline {
          visit(&self.prefix);
        }
        visit(line);
        newline = line.ends_with('\n');
      }
    });
  }
  fn buffer(&self) -> Cow<'_, [u8]> {
    if self.prefix.is_empty() {
      self.inner.buffer()
    } else {
      self.source().into_bytes()
    }
  }
  fn size(&self) -> usize {
    if self.prefix.is_empty() {
      return self.source().into_bytes().len();
    }
    let mut size = 0;
    self.rope(&mut |part| size += part.len());
    size
  }
  fn map(&self, options: &MapOptions) -> Option<SourceMap> {
    get_map(self.stream_chunks().as_ref(), options)
  }
  fn to_writer(&self, writer: &mut dyn Write) -> io::Result<()> {
    if self.prefix.is_empty() {
      return self.inner.to_writer(writer);
    }
    let mut result = Ok(());
    self.rope(&mut |text| {
      if result.is_ok() {
        result = writer.write_all(text.as_bytes());
      }
    });
    result
  }
}

struct PrefixChunks<'a> {
  prefix: &'a str,
  inner: Box<dyn Chunks<'a> + 'a>,
}

impl<'a> Chunks<'a> for PrefixChunks<'a> {
  fn stream<'chunk>(
    &'chunk self,
    options: &MapOptions,
    on_chunk: OnChunk<'_, 'chunk>,
    on_source: OnSource<'_>,
    on_name: OnName<'_>,
  ) -> GeneratedInfo {
    let width = self.prefix.encode_utf16().count() as u32;
    let mut info = self.inner.stream(
      options,
      &mut |text, mut mapping| {
        if mapping.generated_column == 0 && text.is_some() && width != 0 {
          on_chunk(
            Some(TextSpan::new(self.prefix)),
            Mapping {
              original: if options.columns {
                None
              } else {
                mapping.original
              },
              ..mapping
            },
          );
        }
        if options.columns || text.is_some() || mapping.generated_column != 0 {
          mapping.generated_column += width;
        }
        on_chunk(text, mapping);
      },
      on_source,
      on_name,
    );
    if info.generated_column != 0 {
      info.generated_column += width;
    }
    info
  }
}

impl StreamChunks for PrefixSource {
  fn stream_chunks(&self) -> Box<dyn Chunks<'_> + '_> {
    Box::new(PrefixChunks {
      prefix: &self.prefix,
      inner: self.inner.stream_chunks(),
    })
  }
}
