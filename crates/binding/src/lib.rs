pub mod diagnostics;
mod js;
mod maps;
mod model;
mod positions;
mod source_helpers;
pub mod sources;

pub(crate) fn invalid(message: &str) -> napi::Error {
    napi::Error::new(napi::Status::InvalidArg, message.to_owned())
}
