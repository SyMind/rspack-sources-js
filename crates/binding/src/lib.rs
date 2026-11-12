pub mod diagnostics;
mod maps;
mod positions;
mod source_binding;
mod source_buffer;
pub mod sources;

pub(crate) fn invalid(message: &str) -> napi::Error {
    napi::Error::new(napi::Status::InvalidArg, message.to_owned())
}
