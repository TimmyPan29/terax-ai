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
