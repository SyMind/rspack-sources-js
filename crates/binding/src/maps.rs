use crate::invalid;
use napi::{Result, ValueType, bindgen_prelude::*};
use rspack_sources::SourceMap;

pub(crate) fn parse_map(value: Unknown<'_>) -> Result<Option<SourceMap>> {
    let map = match value.get_type()? {
        ValueType::Undefined | ValueType::Null => return Ok(None),
        ValueType::String => SourceMap::from_json(crate::sources::text(value)?),
        _ if value.is_buffer()? => {
            SourceMap::from_bytes(unsafe { value.cast::<Buffer>()? }.to_vec())
        }
        ValueType::Object => {
            let env = napi::Env::from(value.value().env);
            let json: Object = env.get_global()?.get_named_property("JSON")?;
            let stringify: Function<Unknown, String> = json.get_named_property("stringify")?;
            SourceMap::from_json(stringify.apply(json, value)?)
        }
        _ => {
            return Err(invalid(
                "Expected a source map object, JSON string or Buffer",
            ));
        }
    }
    .map_err(|e| invalid(&e.to_string()))?;
    if !valid_mappings(map.mappings(), map.sources().len(), map.names().len()) {
        return Err(invalid("Invalid source map mappings"));
    }
    Ok(Some(map))
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
