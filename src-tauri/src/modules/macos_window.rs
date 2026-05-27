//! macOS-specific window behavior tweaks.
//!
//! In native fullscreen, AppKit responds to Esc by sending
//! `cancelOperation:` up the responder chain — NSWindow's default handler
//! then toggles fullscreen off. That's exactly what we want to disable:
//! users running CLIs like Claude / Aider in fullscreen frequently fat-finger
//! Esc and get yanked out of fullscreen mid-task.
//!
//! We replace `cancelOperation:` on the window's class with a no-op. The
//! Esc keystroke still reaches the WebView (xterm, modals, AI panel, etc.) —
//! only the NSWindow-level side effect is silenced.

#![cfg(target_os = "macos")]

use std::os::raw::c_char;
use std::sync::Once;

use tauri::WebviewWindow;

#[repr(C)]
struct ObjcObject {
    _private: [u8; 0],
}

#[repr(C)]
struct ObjcClass {
    _private: [u8; 0],
}

#[repr(transparent)]
#[derive(Copy, Clone)]
struct Sel(*const std::ffi::c_void);

type Imp = unsafe extern "C" fn();

unsafe extern "C" {
    fn object_getClass(obj: *mut ObjcObject) -> *mut ObjcClass;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn class_replaceMethod(
        cls: *mut ObjcClass,
        name: Sel,
        imp: Imp,
        types: *const c_char,
    ) -> Option<Imp>;
}

unsafe extern "C" fn cancel_operation_noop(
    _self: *mut ObjcObject,
    _sel: Sel,
    _sender: *mut ObjcObject,
) {
}

/// Suppress macOS' Esc-exits-fullscreen behavior on the main window.
/// Safe to call more than once — the swizzle is installed at most once.
pub fn suppress_esc_exit_fullscreen(window: &WebviewWindow) {
    static ONCE: Once = Once::new();

    let Ok(ns_window_ptr) = window.ns_window() else {
        return;
    };
    if ns_window_ptr.is_null() {
        return;
    }

    ONCE.call_once(|| unsafe {
        let obj = ns_window_ptr as *mut ObjcObject;
        let cls = object_getClass(obj);
        if cls.is_null() {
            return;
        }
        let sel = sel_registerName(c"cancelOperation:".as_ptr());
        // Encoded signature: void return, (id self, SEL _cmd, id sender)
        let types = c"v@:@".as_ptr();
        let imp: Imp = std::mem::transmute::<
            unsafe extern "C" fn(*mut ObjcObject, Sel, *mut ObjcObject),
            Imp,
        >(cancel_operation_noop);
        class_replaceMethod(cls, sel, imp, types);
    });
}
