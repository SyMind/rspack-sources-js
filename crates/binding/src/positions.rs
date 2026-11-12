// JS records UTF-16 offsets, while ReplaceSource takes UTF-8 byte offsets.
// ASCII needs no offset table. Keep the cumulative offsets after each wide char.
pub(crate) struct ByteOffsets {
    wide: Vec<WideChar>,
}

struct WideChar {
    end_utf16: u32,
    end_byte: u32,
    surrogate_pair: bool,
}

impl ByteOffsets {
    pub(crate) fn new(source: &rspack_sources::SourceRef) -> Option<Self> {
        let mut wide = Vec::new();
        let mut bytes = 0usize;
        let mut units = 0u32;
        source.rope(&mut |text| {
            let start = bytes;
            bytes += text.len();
            if bytes > u32::MAX as usize {
                return;
            }
            if text.is_ascii() {
                units += text.len() as u32;
                return;
            }
            for (offset, ch) in text.char_indices() {
                units += ch.len_utf16() as u32;
                if !ch.is_ascii() {
                    wide.push(WideChar {
                        end_utf16: units,
                        end_byte: (start + offset + ch.len_utf8()) as u32,
                        surrogate_pair: ch.len_utf16() == 2,
                    });
                }
            }
        });
        (bytes <= u32::MAX as usize).then_some(Self { wide })
    }

    /// Map a known UTF-8 character boundary in a core replacement back to JS.
    pub(crate) fn utf16_at(&self, byte: u32) -> u32 {
        let i = self.wide.partition_point(|ch| ch.end_byte <= byte);
        let extra = self.wide[..i]
            .last()
            .map_or(0, |ch| ch.end_byte - ch.end_utf16);
        byte - extra
    }

    pub(crate) fn byte_at(&self, pos: f64) -> Option<u32> {
        if pos.fract() != 0. || pos < 0. || pos > u32::MAX as f64 {
            return None;
        }
        let pos = pos as u32;
        let i = self.wide.partition_point(|ch| ch.end_utf16 <= pos);
        if self
            .wide
            .get(i)
            .is_some_and(|ch| ch.surrogate_pair && ch.end_utf16 - pos == 1)
        {
            return None;
        }
        let extra = self.wide[..i]
            .last()
            .map_or(0, |ch| ch.end_byte - ch.end_utf16);
        pos.checked_add(extra)
    }
}
