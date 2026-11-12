use crate::{
    diagnostics::STATS,
    invalid,
    js::{Js, WeakJs, check},
    maps::MapInput,
    sources::{self, replace::Replacement},
};
use napi::{Result, bindgen_prelude::*, sys};
use rspack_sources::{SourceExt, SourceRef, ThreadsafeWeakRef};
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    ffi::c_void,
    ptr,
    rc::{Rc, Weak},
    sync::Arc,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Raw,
    Original,
    SourceMap,
    Concat,
    Replace,
    Cached,
    Prefix,
    SizeOnly,
    Compat,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Text {
    pub(crate) units: Vec<u16>,
    pub(crate) well_formed: bool,
    pub(crate) reference: usize,
}

#[derive(Clone, PartialEq)]
pub(crate) enum Field {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    Text(Rc<Text>),
    Ref(usize),
}

#[derive(Clone)]
pub(crate) enum Child {
    Text(Vec<u16>),
    Node(Rc<SourceNode>),
    // Index in this node's JS reference store.
    Foreign(usize),
}

pub(crate) struct SourceNode {
    pub(crate) kind: Kind,
    pub(crate) original: Option<Box<sources::original::BoundOriginal>>,
    pub(crate) store: WeakJs,
    receiver: Arc<ThreadsafeWeakRef>,
    pub(crate) fields: RefCell<HashMap<String, Field>>,
    cached: Option<Box<RefCell<sources::cached::Cache>>>,
    pub(crate) free_refs: RefCell<Vec<usize>>,
    pub(crate) children: RefCell<Vec<Child>>,
    pub(crate) parents: RefCell<Vec<Weak<SourceNode>>>,
    pub(crate) edits: RefCell<Vec<Replacement>>,
    pub(crate) snapshot: RefCell<Option<SourceRef>>,
    pub(crate) dirty: Cell<bool>,
    concat: Option<Box<sources::concat::BoundConcat>>,
    pub(crate) edits_view: Cell<bool>,
    pub(crate) generated: Cell<bool>,
    pub(crate) last_maps: RefCell<Option<(MapInput, Option<MapInput>)>>,
}
static TAG_ANCHOR: u8 = 0;

fn tag() -> sys::napi_type_tag {
    sys::napi_type_tag {
        lower: ptr::addr_of!(TAG_ANCHOR) as usize as u64,
        upper: 0xcf41876e21ae9d03,
    }
}

pub(crate) fn node(value: Js) -> Result<Option<Rc<SourceNode>>> {
    if !matches!(
        value.ty()?,
        sys::ValueType::napi_object | sys::ValueType::napi_function
    ) {
        return Ok(None);
    }
    let mut matches = false;
    check(unsafe { sys::napi_check_object_type_tag(value.env, value.raw, &tag(), &mut matches) })?;
    if !matches {
        return Ok(None);
    }
    let mut data = ptr::null_mut();
    check(unsafe { sys::napi_unwrap(value.env, value.raw, &mut data) })?;
    if data.is_null() {
        return Err(invalid("Invalid Source receiver"));
    }
    // napi_wrap owns this Rc until finalization; the active receiver is rooted.
    Ok(Some(unsafe { (&*data.cast::<Rc<SourceNode>>()).clone() }))
}

unsafe extern "C" fn finalize(_env: sys::napi_env, data: *mut c_void, _hint: *mut c_void) {
    drop(unsafe { Box::from_raw(data.cast::<Rc<SourceNode>>()) });
}

impl SourceNode {
    pub(crate) fn allocate(receiver: Js, store: Js, kind: Kind) -> Result<Rc<Self>> {
        Self::new(receiver, kind, WeakJs::new(store)?, None)
    }

    pub(crate) fn allocate_original(
        receiver: Js,
        original: sources::original::BoundOriginal,
    ) -> Result<Rc<Self>> {
        Self::new(
            receiver,
            Kind::Original,
            WeakJs::empty(receiver.env),
            Some(Box::new(original)),
        )
    }

    fn new(
        receiver: Js,
        kind: Kind,
        store: WeakJs,
        original: Option<Box<sources::original::BoundOriginal>>,
    ) -> Result<Rc<Self>> {
        if node(receiver)?.is_some() {
            return Err(invalid("Source is already bound"));
        }
        // The constructor's receiver is an object in this N-API handle scope.
        let wrapper = unsafe { Object::from_napi_value(receiver.env, receiver.raw)? };
        Ok(Rc::new(Self {
            kind,
            original,
            store,
            receiver: Arc::new(ThreadsafeWeakRef::new(&wrapper)?),
            fields: RefCell::default(),
            cached: (kind == Kind::Cached).then(Box::default),
            free_refs: RefCell::default(),
            children: RefCell::default(),
            parents: RefCell::default(),
            edits: RefCell::default(),
            snapshot: RefCell::default(),
            dirty: Cell::new(true),
            concat: (kind == Kind::Concat).then(Box::default),
            edits_view: Cell::new(false),
            generated: Cell::new(false),
            last_maps: RefCell::default(),
        }))
    }

    pub(crate) fn receiver(&self) -> Result<Js> {
        resolve_jsobject(&self.receiver, self.store.env)
    }

    pub(crate) fn concat(&self) -> &sources::concat::BoundConcat {
        self.concat.as_deref().expect("ConcatSource node")
    }

    pub(crate) fn current_children(&self) -> Vec<Child> {
        self.children.borrow().clone()
    }

    pub(crate) fn cache(&self) -> &RefCell<sources::cached::Cache> {
        self.cached.as_deref().expect("CachedSource node")
    }

    pub(crate) fn finish(self: &Rc<Self>) -> Result<()> {
        let receiver = self.receiver()?;
        let data = Box::into_raw(Box::new(self.clone()));
        let status = unsafe {
            sys::napi_wrap(
                receiver.env,
                receiver.raw,
                data.cast(),
                Some(finalize),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if status != sys::Status::napi_ok {
            drop(unsafe { Box::from_raw(data) });
            check(status)?;
        }
        check(unsafe { sys::napi_type_tag_object(receiver.env, receiver.raw, &tag()) })?;
        STATS.with(|s| s.borrow_mut().creations += 1);
        if let Some(source) = sources::initial_snapshot(self)? {
            self.publish(source);
        }
        Ok(())
    }

    pub(crate) fn helpers(&self) -> Result<Js> {
        self.store.get()?.get("helpers")
    }

    pub(crate) fn helper(&self, name: &str, args: &[Js]) -> Result<Js> {
        self.helpers()?.method(name, args)
    }

    fn reference_values(&self) -> Result<Js> {
        self.store.get()?.get("values")
    }

    pub(crate) fn root(&self, value: Js) -> Result<Field> {
        let values = self.reference_values()?;
        let index = match self.free_refs.borrow_mut().pop() {
            Some(i) => i,
            None => values.len()?,
        };
        values.set_index(index, value)?;
        Ok(Field::Ref(index))
    }

    pub(crate) fn capture(&self, value: Js) -> Result<Field> {
        Ok(match value.ty()? {
            sys::ValueType::napi_undefined => Field::Undefined,
            sys::ValueType::napi_null => Field::Null,
            sys::ValueType::napi_boolean => Field::Bool(value.truthy()?),
            sys::ValueType::napi_number => Field::Number(value.float()?),
            sys::ValueType::napi_string => {
                let units = value.units()?;
                let well_formed = char::decode_utf16(units.iter().copied()).all(|c| c.is_ok());
                let Field::Ref(reference) = self.root(value)? else {
                    unreachable!()
                };
                Field::Text(Rc::new(Text {
                    units,
                    well_formed,
                    reference,
                }))
            }
            _ => return self.root(value),
        })
    }

    pub(crate) fn value(&self, field: Field) -> Result<Js> {
        let env = self.store.env;
        match field {
            Field::Undefined => Js::undefined(env),
            Field::Null => Js::null(env),
            Field::Bool(v) => Js::boolean(env, v),
            Field::Number(v) => Js::number(env, v),
            Field::Text(v) => self.reference_values()?.index(v.reference),
            Field::Ref(i) => self.reference_values()?.index(i),
        }
    }

    pub(crate) fn field(&self, key: &str) -> Field {
        self.fields
            .borrow()
            .get(key)
            .cloned()
            .unwrap_or(Field::Undefined)
    }

    pub(crate) fn get(&self, key: &str) -> Result<Js> {
        self.value(self.field(key))
    }

    pub(crate) fn put(&self, key: &str, value: Js) -> Result<()> {
        let value = self.capture(value)?;
        self.put_field(key, value);
        Ok(())
    }

    pub(crate) fn put_field(&self, key: &str, value: Field) {
        let old = self.fields.borrow_mut().insert(key.into(), value);
        if let Some(i) = match old {
            Some(Field::Ref(i)) => Some(i),
            Some(Field::Text(t)) => Some(t.reference),
            _ => None,
        } {
            // The store and its plain internal array are rooted in this call;
            // clearing a slot cannot invoke application code.
            if let Ok(values) = self.reference_values()
                && let Ok(undefined) = Js::undefined(self.store.env)
            {
                let _ = values.set_index(i, undefined);
                self.free_refs.borrow_mut().push(i);
            }
        }
    }

    pub(crate) fn text(&self, key: &str) -> Option<Vec<u16>> {
        if let Field::Text(v) = self.field(key) {
            Some(v.units.clone())
        } else {
            None
        }
    }

    pub(crate) fn well_formed(&self, key: &str) -> bool {
        matches!(self.field(key),Field::Text(t)if t.well_formed)
    }

    pub(crate) fn string(&self, key: &str) -> Option<String> {
        String::from_utf16(&self.text(key)?).ok()
    }

    pub(crate) fn boolean(&self, key: &str) -> bool {
        matches!(self.field(key), Field::Bool(true))
    }

    pub(crate) fn dirty(&self) {
        if self.dirty.replace(true) {
            return;
        }
        self.snapshot.borrow_mut().take();
        let mut parents: Vec<_> = self
            .parents
            .borrow()
            .iter()
            .filter_map(Weak::upgrade)
            .collect();
        while let Some(parent) = parents.pop() {
            if parent.dirty.replace(true) {
                continue;
            }
            parent.snapshot.borrow_mut().take();
            parent
                .parents
                .borrow_mut()
                .retain(|p| p.strong_count() != 0);
            parents.extend(parent.parents.borrow().iter().filter_map(Weak::upgrade));
        }
    }

    pub(crate) fn set_children(self: &Rc<Self>, children: Vec<Child>) -> Result<()> {
        let old = self.children.replace(children.clone());
        self.update_edges(&old, &children)
    }

    fn update_edges(self: &Rc<Self>, old: &[Child], children: &[Child]) -> Result<()> {
        self.retain_child_values(old, children)?;
        for child in old {
            if let Child::Node(child) = child {
                child
                    .parents
                    .borrow_mut()
                    .retain(|w| w.upgrade().is_some_and(|p| !Rc::ptr_eq(&p, self)));
            }
        }
        let mut seen = HashSet::new();
        for child in children {
            if let Child::Node(child) = child
                && seen.insert(Rc::as_ptr(child))
            {
                child.parents.borrow_mut().push(Rc::downgrade(self));
            }
        }
        self.dirty();
        Ok(())
    }

    fn retain_child_values(&self, old: &[Child], children: &[Child]) -> Result<()> {
        // V8 must be able to trace JS cycles through native source graphs.
        let roots = children
            .iter()
            .map(|c| self.child_value(c))
            .collect::<Result<Vec<_>>>()?;
        let edges = Js::array(self.store.env, &roots)?;
        self.store.get()?.set("edges", edges)?;
        let live_foreign: HashSet<_> = children
            .iter()
            .filter_map(|c| match c {
                Child::Foreign(i) => Some(*i),
                _ => None,
            })
            .collect();
        let mut retired = HashSet::new();
        for child in old {
            if let Child::Foreign(i) = child
                && !live_foreign.contains(i)
                && retired.insert(*i)
            {
                self.reference_values()?
                    .set_index(*i, Js::undefined(self.store.env)?)?;
                self.free_refs.borrow_mut().push(*i);
            }
        }
        Ok(())
    }

    fn native_child(self: &Rc<Self>, value: Js) -> Result<Option<Child>> {
        if value.ty()? == sys::ValueType::napi_string {
            return Ok(Some(Child::Text(value.units()?)));
        }
        if let Some(child) = node(value)? {
            let mut seen = HashSet::new();
            // An unparented node cannot already be reachable from another
            // native node. Avoid walking entire subtrees during construction.
            let has_parents = self.parents.borrow().iter().any(|p| p.strong_count() != 0);
            let mut stack = if has_parents {
                vec![child.clone()]
            } else {
                Vec::new()
            };
            let mut cyclic = Rc::ptr_eq(&child, self);
            while let Some(n) = stack.pop() {
                if Rc::ptr_eq(&n, self) {
                    cyclic = true;
                    break;
                }
                if seen.insert(Rc::as_ptr(&n)) {
                    for c in n.children.borrow().iter() {
                        if let Child::Node(c) = c {
                            stack.push(c.clone());
                        }
                    }
                }
            }
            if !cyclic {
                return Ok(Some(Child::Node(child)));
            }
        }
        Ok(None)
    }

    pub(crate) fn child(self: &Rc<Self>, value: Js) -> Result<Child> {
        if let Some(child) = self.native_child(value)? {
            return Ok(child);
        }
        for child in self.children.borrow().iter() {
            if let Child::Foreign(i) = child
                && self.value(Field::Ref(*i))?.equal(value)?
            {
                return Ok(child.clone());
            }
        }
        let Field::Ref(i) = self.root(value)? else {
            unreachable!()
        };
        Ok(Child::Foreign(i))
    }

    pub(crate) fn child_value(&self, child: &Child) -> Result<Js> {
        match child {
            Child::Text(v) => Js::utf16(self.store.env, v),
            Child::Node(n) => n.receiver(),
            Child::Foreign(i) => self.value(Field::Ref(*i)),
        }
    }

    pub(crate) fn child_call(&self, method: &str, args: &[Js]) -> Result<Js> {
        let source = self.get("_source")?;
        source.method(method, args)
    }

    pub(crate) fn mark_prepared(&self) {
        self.dirty.set(false);
        STATS.with(|s| s.borrow_mut().compiled_nodes += 1);
    }

    pub(crate) fn prepared_snapshot(&self) -> Option<SourceRef> {
        if self.dirty.get() {
            return None;
        }
        let mut snapshot = self.snapshot.borrow_mut();
        if snapshot.is_none()
            && let Some(concat) = &self.concat
        {
            // A parent or a snapshot consumer can keep this version across later JS edits.
            *snapshot = Some(
                concat
                    .source
                    .borrow()
                    .clone()
                    .boxed()
                    .with_jsobject(self.receiver.clone()),
            );
        }
        snapshot.clone()
    }

    pub(crate) fn publish(&self, source: SourceRef) {
        self.snapshot
            .replace(Some(source.with_jsobject(self.receiver.clone())));
        self.mark_prepared();
    }
}

// The active binding call owns the handle scope. Parent JS arrays keep their
// children reachable, so a cleared reference here signals a lost owner.
pub(crate) fn resolve_jsobject(reference: &ThreadsafeWeakRef, env: sys::napi_env) -> Result<Js> {
    let env = napi::Env::from(env);
    let wrapper = reference
        .get(&env)?
        .ok_or_else(|| invalid("Source JS object has been collected"))?;
    Ok(object(&wrapper))
}

pub(crate) fn require(receiver: Js, kind: Kind) -> Result<Rc<SourceNode>> {
    node(receiver)?
        .filter(|n| n.kind == kind)
        .ok_or_else(|| invalid("Invalid Source receiver"))
}

pub(crate) fn into_js<'env>(value: Js) -> Result<Unknown<'env>> {
    unsafe { Unknown::from_napi_value(value.env, value.raw) }
}

pub(crate) fn object(value: &Object<'_>) -> Js {
    Js {
        env: value.value().env,
        raw: value.raw(),
    }
}

pub(crate) fn argument(env: sys::napi_env, value: &Unknown<'_>) -> Js {
    Js {
        env,
        raw: value.raw(),
    }
}

pub(crate) fn get_field(n: &Rc<SourceNode>, field: &str) -> Result<Js> {
    match n.kind {
        Kind::Original => return Err(invalid("OriginalSource has no named fields")),
        Kind::Concat => return Err(invalid("ConcatSource has no named fields")),
        _ => {}
    }
    match field {
        "_cachedSize" if n.kind == Kind::Cached => sources::cached::stored_size(n),
        "_cachedSource" if n.kind == Kind::Cached => sources::cached::stored_source(n),
        "_replacements" => n.replacements(),
        _ => n.get(field),
    }
}

pub(crate) fn set_field(n: &Rc<SourceNode>, field: &str, value: Js) -> Result<()> {
    match n.kind {
        Kind::Original => return Err(invalid("OriginalSource has no named fields")),
        Kind::Concat => return Err(invalid("ConcatSource has no named fields")),
        _ => {}
    }
    match (n.kind, field) {
        (Kind::Cached, "_cachedSource") => sources::cached::store_source(n, value, None)?,
        (
            Kind::Cached,
            "_cachedBuffer" | "_cachedBuffers" | "_cachedSize" | "_cachedSourceType",
        ) => n.put(field, value)?,
        (Kind::Cached, _) => return Err(invalid("Unknown native CachedSource field")),
        _ => n.put(field, value)?,
    }
    match field {
        "_replacements" => {
            n.edits_view.set(true);
            n.sync_edits()?;
        }
        "_source" => {
            if value.ty()? == sys::ValueType::napi_function {
                n.set_children(Vec::new())?
            } else {
                n.set_children(vec![n.child(value)?])?
            }
        }
        _ => {}
    }
    n.dirty();
    Ok(())
}

pub(crate) fn source_text(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
) -> Result<Option<Vec<u16>>> {
    let id = Rc::as_ptr(n);
    if !visiting.insert(id) {
        return Ok(None);
    }
    let result = sources::text(n, visiting);
    visiting.remove(&id);
    result
}

pub(crate) fn snapshot(n: &Rc<SourceNode>) -> Result<Option<SourceRef>> {
    track_compilation(|| native_snapshot(n, &mut HashSet::new(), &mut HashMap::new()))
}

pub(crate) fn prepare_concat(n: &Rc<SourceNode>) -> Result<bool> {
    track_compilation(|| prepare_node(n, &mut HashSet::from([Rc::as_ptr(n)]), &mut HashMap::new()))
}

fn track_compilation<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    let before = STATS.with(|s| s.borrow().compiled_nodes);
    let result = f();
    if STATS.with(|s| s.borrow().compiled_nodes) != before {
        STATS.with(|s| s.borrow_mut().compilations += 1)
    }
    result
}

fn native_snapshot(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
    memo: &mut HashMap<*const SourceNode, Option<SourceRef>>,
) -> Result<Option<SourceRef>> {
    let id = Rc::as_ptr(n);
    if let Some(source) = memo.get(&id) {
        return Ok(source.clone());
    }
    if !visiting.insert(id) {
        return Ok(None);
    }
    let result = prepare_node(n, visiting, memo)
        .map(|ready| if ready { n.prepared_snapshot() } else { None });
    visiting.remove(&id);
    if let Ok(source) = &result {
        memo.insert(id, source.clone());
    }
    result
}

fn prepare_node(
    n: &Rc<SourceNode>,
    visiting: &mut HashSet<*const SourceNode>,
    memo: &mut HashMap<*const SourceNode, Option<SourceRef>>,
) -> Result<bool> {
    if !sources::validate_snapshot(n)? {
        return Ok(false);
    }
    let mut children = Vec::new();
    for child in n.current_children() {
        match child {
            Child::Text(text) => {
                let Ok(text) = String::from_utf16(&text) else {
                    return Ok(false);
                };
                children.push(rspack_sources::RawStringSource::from(text).boxed())
            }
            Child::Node(child) => {
                let Some(source) = native_snapshot(&child, visiting, memo)? else {
                    return Ok(false);
                };
                children.push(source)
            }
            Child::Foreign(_) => return Ok(false),
        }
    }
    if !n.dirty.get() {
        return Ok(true);
    }
    if let Some(concat) = &n.concat {
        concat.source.borrow_mut().set_optimized_children(children);
        n.mark_prepared();
    } else if let Some(source) = sources::compile_snapshot(n, children)? {
        n.publish(source);
    } else {
        return Ok(false);
    }
    Ok(true)
}
