pub(crate) struct Edit {
    /// UTF-16 boundaries; end is exclusive. Conversion happens once per batch.
    pub start: u32,
    pub end: u32,
    pub content: String,
    pub name: Option<String>,
}

pub(crate) fn byte_offsets(text: &str, edits: &[Edit]) -> Option<Vec<(u32, u32)>> {
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
