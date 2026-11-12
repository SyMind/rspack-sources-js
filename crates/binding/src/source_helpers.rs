use crate::{invalid, js::Js, model::object};
use napi::{Env, Result, bindgen_prelude::*, sys};
use napi_derive::napi;

struct SourceHelpers(Option<ObjectRef>);

#[napi]
pub fn register_source_helpers(env: &Env, helpers: Object<'_>) -> Result<()> {
    if env.get_instance_data::<SourceHelpers>()?.is_none() {
        env.set_instance_data(SourceHelpers(None), (), |ctx| {
            if let Some(helpers) = ctx.value.0 {
                let _ = helpers.unref(&ctx.env);
            }
        })?;
    }
    let slot = env
        .get_instance_data::<SourceHelpers>()?
        .expect("initialized helper slot");
    if let Some(previous) = slot.0.replace(helpers.create_ref()?) {
        previous.unref(env)?;
    }
    Ok(())
}

fn helpers(raw_env: sys::napi_env) -> Result<Js> {
    let env = Env::from(raw_env);
    let reference = env
        .get_instance_data::<SourceHelpers>()?
        .and_then(|slot| slot.0.as_ref())
        .ok_or_else(|| invalid("Source helpers have not been registered"))?;
    Ok(object(&reference.get_value(&env)?))
}

pub(crate) fn create_raw_source(value: Js, convert_to_string: bool) -> Result<Js> {
    helpers(value.env)?.method(
        "createSourceJsObject",
        &[
            Js::string(value.env, "RawSource")?,
            value,
            Js::boolean(value.env, convert_to_string)?,
        ],
    )
}

pub(crate) fn source_context(receiver: Js) -> Result<Js> {
    helpers(receiver.env)?.method("contextOf", &[receiver])
}
