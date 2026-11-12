use napi_derive::napi;
use rspack_sources::SourceMap;
use std::borrow::Cow;

#[napi(object)]
#[derive(Clone, PartialEq)]
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
    pub(crate) fn into_map(self) -> Option<SourceMap> {
        if !valid_mappings(&self.mappings, self.sources.len(), self.names.len()) {
            return None;
        }
        let mut map = SourceMap::new(
            self.mappings.into(),
            self.sources.into_iter().map(Into::into).collect(),
            self.sources_content
                .into_iter()
                .map(|s| Some(s.into()))
                .collect(),
            self.names.into_iter().map(Into::into).collect(),
        );
        map.set_source_root(self.source_root.map(Into::into));
        map.set_file(self.file.map(Into::into));
        map.set_debug_id(self.debug_id.map(Into::into));
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
