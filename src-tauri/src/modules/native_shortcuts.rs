#[cfg(target_os = "macos")]
pub mod macos {
    use objc2::{
        ffi, msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject, Bool, Imp, Sel},
        sel,
    };
    use objc2_app_kit::{NSEvent, NSEventType};
    use std::{ffi::CStr, io, sync::OnceLock};
    use tauri::{AppHandle, Manager};

    extern "C-unwind" fn cancel_operation(_: &AnyObject, _: Sel, _: *mut AnyObject) {}

    type KeyEquivalent = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent) -> Bool;
    type KeyDown = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent);

    struct WindowKeyMethods {
        key_equivalent: KeyEquivalent,
        key_down: KeyDown,
        send_event: KeyDown,
    }

    static WINDOW_KEY_METHODS: OnceLock<WindowKeyMethods> = OnceLock::new();

    fn is_escape_key_down(event: &NSEvent) -> bool {
        event.r#type() == NSEventType::KeyDown && event.keyCode() == 0x35
    }

    fn handle_escape(window: &AnyObject, event: &NSEvent) -> bool {
        if !is_escape_key_down(event) {
            return false;
        }
        // Deliver Escape once to the focused view before NSWindow can apply fullscreen defaults.
        let responder: Option<Retained<AnyObject>> = unsafe { msg_send![window, firstResponder] };
        if let Some(responder) = responder {
            if !std::ptr::eq(&*responder, window) {
                let _: () = unsafe { msg_send![&responder, keyDown: event] };
            }
        }
        true
    }

    extern "C-unwind" fn perform_key_equivalent(
        window: &AnyObject,
        selector: Sel,
        event: &NSEvent,
    ) -> Bool {
        if handle_escape(window, event) {
            return Bool::YES;
        }
        unsafe { (WINDOW_KEY_METHODS.get().unwrap().key_equivalent)(window, selector, event) }
    }

    extern "C-unwind" fn send_event(window: &AnyObject, selector: Sel, event: &NSEvent) {
        if handle_escape(window, event) {
            return;
        }
        unsafe { (WINDOW_KEY_METHODS.get().unwrap().send_event)(window, selector, event) };
    }

    extern "C-unwind" fn key_down(window: &AnyObject, selector: Sel, event: &NSEvent) {
        if is_escape_key_down(event) {
            return;
        }
        unsafe { (WINDOW_KEY_METHODS.get().unwrap().key_down)(window, selector, event) };
    }

    fn install_key_methods(class: &AnyClass) -> bool {
        let Some(key_equivalent) = class.instance_method(sel!(performKeyEquivalent:)) else {
            return false;
        };
        let Some(key_down_method) = class.instance_method(sel!(keyDown:)) else {
            return false;
        };
        let Some(send_event_method) = class.instance_method(sel!(sendEvent:)) else {
            return false;
        };
        // Saved IMPs and native type encodings retain non-Escape keyboard and mouse events.
        unsafe {
            if WINDOW_KEY_METHODS
                .set(WindowKeyMethods {
                    key_equivalent: std::mem::transmute::<Imp, KeyEquivalent>(
                        key_equivalent.implementation(),
                    ),
                    key_down: std::mem::transmute::<Imp, KeyDown>(key_down_method.implementation()),
                    send_event: std::mem::transmute::<Imp, KeyDown>(
                        send_event_method.implementation(),
                    ),
                })
                .is_err()
            {
                return false;
            }
            let pointer = (class as *const AnyClass).cast_mut();
            // Tao owns sendEvent:, so replace only this subclass's implementation.
            ffi::class_replaceMethod(
                pointer,
                sel!(sendEvent:),
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &NSEvent), Imp>(
                    send_event,
                ),
                ffi::method_getTypeEncoding(send_event_method),
            );
            ffi::class_addMethod(
                pointer,
                sel!(performKeyEquivalent:),
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &NSEvent) -> Bool, Imp>(
                    perform_key_equivalent,
                ),
                ffi::method_getTypeEncoding(key_equivalent),
            )
            .as_bool()
                && ffi::class_addMethod(
                    pointer,
                    sel!(keyDown:),
                    std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &NSEvent), Imp>(
                        key_down,
                    ),
                    ffi::method_getTypeEncoding(key_down_method),
                )
                .as_bool()
        }
    }

    fn prevent_escape_fullscreen_exit(class: &AnyClass) -> bool {
        // Override only the app's window subclass. WebView responders still receive Escape.
        unsafe {
            ffi::class_addMethod(
                (class as *const AnyClass).cast_mut(),
                sel!(cancelOperation:),
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject), Imp>(
                    cancel_operation,
                ),
                c"v@:@".as_ptr(),
            )
            .as_bool()
        }
    }

    fn find_window_class<'a>(mut class: &'a AnyClass, name: &CStr) -> Option<&'a AnyClass> {
        while class.name() != name {
            class = class.superclass()?;
        }
        Some(class)
    }

    pub fn install(app: &AppHandle) -> tauri::Result<()> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| io::Error::other("main window is missing"))?;
        let pointer = window.ns_window()?;
        // Setup runs on the main thread; Tauri owns this window for the app's lifetime.
        let native = unsafe { &*pointer.cast::<AnyObject>() };
        let class = find_window_class(native.class(), c"TaoWindow")
            .ok_or_else(|| io::Error::other("Tauri window subclass is missing"))?;
        if !prevent_escape_fullscreen_exit(class) || !install_key_methods(class) {
            return Err(
                io::Error::other("could not install native Escape fullscreen guard").into(),
            );
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2::{msg_send, rc::Retained, runtime::ClassBuilder, ClassType};
        use objc2_app_kit::NSEventModifierFlags;
        use objc2_foundation::{NSObject, NSPoint, NSString};
        use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

        static CANCELS: AtomicUsize = AtomicUsize::new(0);
        static EQUIVALENTS: AtomicUsize = AtomicUsize::new(0);
        static WINDOW_KEYS: AtomicUsize = AtomicUsize::new(0);
        static VIEW_KEYS: AtomicUsize = AtomicUsize::new(0);
        static WINDOW_EVENTS: AtomicUsize = AtomicUsize::new(0);
        static RESPONDER: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
        static WINDOW: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

        extern "C-unwind" fn parent_equivalent(_: &AnyObject, _: Sel, _: &NSEvent) -> Bool {
            EQUIVALENTS.fetch_add(1, Ordering::Relaxed);
            Bool::NO
        }

        extern "C-unwind" fn parent_key_down(_: &AnyObject, _: Sel, _: &NSEvent) {
            WINDOW_KEYS.fetch_add(1, Ordering::Relaxed);
        }

        extern "C-unwind" fn parent_send_event(_: &AnyObject, _: Sel, _: &NSEvent) {
            WINDOW_EVENTS.fetch_add(1, Ordering::Relaxed);
        }

        extern "C-unwind" fn first_responder(_: &AnyObject, _: Sel) -> *mut AnyObject {
            RESPONDER.load(Ordering::Relaxed)
        }

        extern "C-unwind" fn view_key_down(_: &AnyObject, _: Sel, event: &NSEvent) {
            VIEW_KEYS.fetch_add(1, Ordering::Relaxed);
            let window = WINDOW.load(Ordering::Relaxed);
            unsafe {
                let _: () = msg_send![window, keyDown: event];
                let _: () = msg_send![window, cancelOperation: std::ptr::null_mut::<AnyObject>()];
            }
        }

        fn event(code: u16, flags: NSEventModifierFlags, repeat: bool) -> Retained<NSEvent> {
            let text = NSString::from_str(if code == 0x35 { "\u{1b}" } else { "a" });
            NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                NSEventType::KeyDown,
                NSPoint::ZERO,
                flags,
                0.0,
                0,
                None,
                &text,
                &text,
                repeat,
                code,
            ).unwrap()
        }

        extern "C-unwind" fn parent_cancel(_: &AnyObject, _: Sel, _: *mut AnyObject) {
            CANCELS.fetch_add(1, Ordering::Relaxed);
        }

        #[test]
        fn escape_bypasses_window_defaults_for_every_focus_target() {
            let mut parent =
                ClassBuilder::new(c"TeraxEscapeTestParent", NSObject::class()).unwrap();
            unsafe {
                parent.add_method(
                    sel!(cancelOperation:),
                    parent_cancel as extern "C-unwind" fn(_, _, _),
                );
                parent.add_method(
                    sel!(performKeyEquivalent:),
                    parent_equivalent as extern "C-unwind" fn(_, _, _) -> _,
                );
                parent.add_method(
                    sel!(keyDown:),
                    parent_key_down as extern "C-unwind" fn(_, _, _),
                );
                parent.add_method(
                    sel!(sendEvent:),
                    parent_send_event as extern "C-unwind" fn(_, _, _),
                );
                parent.add_method(
                    sel!(firstResponder),
                    first_responder as extern "C-unwind" fn(_, _) -> _,
                );
            }
            let parent = parent.register();
            let child = ClassBuilder::new(c"TeraxEscapeTestWindow", parent)
                .unwrap()
                .register();
            let observed = ClassBuilder::new(c"TeraxEscapeTestObservedWindow", child)
                .unwrap()
                .register();
            let target = find_window_class(observed, c"TeraxEscapeTestWindow").unwrap();
            assert_eq!(target, child);
            assert!(find_window_class(observed, c"TeraxMissingWindowClass").is_none());
            assert!(prevent_escape_fullscreen_exit(target));
            assert!(install_key_methods(target));
            let mut view_class =
                ClassBuilder::new(c"TeraxEscapeTestView", NSObject::class()).unwrap();
            unsafe {
                view_class.add_method(
                    sel!(keyDown:),
                    view_key_down as extern "C-unwind" fn(_, _, _),
                );
            }
            let view_class = view_class.register();
            let sender = std::ptr::null_mut::<AnyObject>();
            unsafe {
                let window: Retained<NSObject> = msg_send![observed, new];
                let _: () = msg_send![&window, cancelOperation: sender];
                assert_eq!(CANCELS.load(Ordering::Relaxed), 0);
                let object: Retained<NSObject> = msg_send![parent, new];
                let _: () = msg_send![&object, cancelOperation: sender];
                assert_eq!(CANCELS.load(Ordering::Relaxed), 1);
                CANCELS.store(0, Ordering::Relaxed);
                let view: Retained<AnyObject> = msg_send![view_class, new];
                let window_pointer = Retained::as_ptr(&window).cast::<AnyObject>().cast_mut();
                WINDOW.store(window_pointer, Ordering::Relaxed);
                RESPONDER.store(Retained::as_ptr(&view).cast_mut(), Ordering::Relaxed);
                for flags in [
                    NSEventModifierFlags::empty(),
                    NSEventModifierFlags::Shift,
                    NSEventModifierFlags::Control,
                    NSEventModifierFlags::Option,
                    NSEventModifierFlags::Command,
                ] {
                    for repeat in [false, true] {
                        let escape = event(0x35, flags, repeat);
                        let claimed: Bool = msg_send![&window, performKeyEquivalent: &*escape];
                        assert!(claimed.as_bool());
                    }
                }
                assert_eq!(VIEW_KEYS.load(Ordering::Relaxed), 10);
                assert_eq!(EQUIVALENTS.load(Ordering::Relaxed), 0);
                assert_eq!(WINDOW_KEYS.load(Ordering::Relaxed), 0);
                assert_eq!(CANCELS.load(Ordering::Relaxed), 0);

                let escape = event(0x35, NSEventModifierFlags::empty(), false);
                let _: () = msg_send![&window, sendEvent: &*escape];
                assert_eq!(VIEW_KEYS.load(Ordering::Relaxed), 11);
                assert_eq!(WINDOW_EVENTS.load(Ordering::Relaxed), 0);
                for responder in [window_pointer, std::ptr::null_mut()] {
                    RESPONDER.store(responder, Ordering::Relaxed);
                    let claimed: Bool = msg_send![&window, performKeyEquivalent: &*escape];
                    assert!(claimed.as_bool());
                    let _: () = msg_send![&window, keyDown: &*escape];
                    let _: () = msg_send![&window, sendEvent: &*escape];
                }
                assert_eq!(VIEW_KEYS.load(Ordering::Relaxed), 11);
                assert_eq!(WINDOW_EVENTS.load(Ordering::Relaxed), 0);
                assert_eq!(WINDOW_KEYS.load(Ordering::Relaxed), 0);

                let ordinary = event(0x00, NSEventModifierFlags::Command, false);
                let claimed: Bool = msg_send![&window, performKeyEquivalent: &*ordinary];
                assert!(!claimed.as_bool());
                let _: () = msg_send![&window, keyDown: &*ordinary];
                assert_eq!(EQUIVALENTS.load(Ordering::Relaxed), 1);
                assert_eq!(WINDOW_KEYS.load(Ordering::Relaxed), 1);
                let _: () = msg_send![&window, sendEvent: &*ordinary];
                assert_eq!(WINDOW_EVENTS.load(Ordering::Relaxed), 1);
                let claimed: Bool = msg_send![&object, performKeyEquivalent: &*escape];
                assert!(!claimed.as_bool());
                assert_eq!(EQUIVALENTS.load(Ordering::Relaxed), 2);
                RESPONDER.store(std::ptr::null_mut(), Ordering::Relaxed);
                WINDOW.store(std::ptr::null_mut(), Ordering::Relaxed);
            }
        }
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_shortcut_event(
    key: u32,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
) -> Option<&'static str> {
    if !ctrl || alt || shift || meta {
        return None;
    }
    match key {
        0x57 => Some("terax:close-pane"),
        0x54 => Some("terax:new-terminal"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
pub mod windows {
    use std::cell::RefCell;
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
            COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
        },
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    struct Registration {
        controller: ICoreWebView2Controller,
        token: i64,
    }

    impl Drop for Registration {
        fn drop(&mut self) {
            let _ = unsafe { self.controller.remove_AcceleratorKeyPressed(self.token) };
        }
    }

    thread_local! {
        static REGISTRATION: RefCell<Option<Registration>> = const { RefCell::new(None) };
    }

    fn pressed(key: u16) -> bool {
        unsafe { GetKeyState(i32::from(key)) < 0 }
    }

    pub fn install(
        controller: ICoreWebView2Controller,
        dispatch: impl Fn(&'static str) + 'static,
    ) -> ::windows::core::Result<()> {
        uninstall();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            unsafe { args.KeyEventKind(&mut kind)? };
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
            {
                return Ok(());
            }
            let mut key = 0;
            unsafe { args.VirtualKey(&mut key)? };
            let Some(event) = super::windows_shortcut_event(
                key,
                pressed(VK_CONTROL),
                pressed(VK_MENU),
                pressed(VK_SHIFT),
                pressed(VK_LWIN) || pressed(VK_RWIN),
            ) else {
                return Ok(());
            };
            unsafe { args.SetHandled(true)? };
            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            unsafe { args.PhysicalKeyStatus(&mut status)? };
            if !status.WasKeyDown.as_bool() {
                dispatch(event);
            }
            Ok(())
        }));
        let mut token = 0;
        unsafe { controller.add_AcceleratorKeyPressed(&handler, &mut token)? };
        REGISTRATION.with_borrow_mut(|registration| {
            *registration = Some(Registration { controller, token });
        });
        Ok(())
    }

    pub fn uninstall() {
        REGISTRATION.with_borrow_mut(|registration| *registration = None);
    }
}

#[cfg(test)]
mod tests {
    use super::windows_shortcut_event;

    #[test]
    fn windows_control_shortcuts_use_the_existing_frontend_events() {
        assert_eq!(
            windows_shortcut_event(0x57, true, false, false, false),
            Some("terax:close-pane")
        );
        assert_eq!(
            windows_shortcut_event(0x54, true, false, false, false),
            Some("terax:new-terminal")
        );
    }

    #[test]
    fn unrelated_keys_and_modified_bindings_are_not_consumed() {
        assert_eq!(
            windows_shortcut_event(0x41, true, false, false, false),
            None
        );
        for key in [0x57, 0x54] {
            for (ctrl, alt, shift, meta) in [
                (false, false, false, false),
                (false, false, false, true),
                (true, true, false, false),
                (true, false, true, false),
                (true, false, false, true),
            ] {
                assert_eq!(windows_shortcut_event(key, ctrl, alt, shift, meta), None);
            }
        }
    }
}
