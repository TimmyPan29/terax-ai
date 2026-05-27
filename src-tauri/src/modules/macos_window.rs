//! macOS-specific window behavior tweaks.
//!
//! In native fullscreen, AppKit treats an unhandled Esc keystroke as
//! "exit fullscreen" — users running CLIs in fullscreen frequently
//! fat-finger Esc and get yanked out mid-task. We intercept Esc at
//! the application event level via NSEvent's local monitor (which
//! runs before NSApplication's own dispatch, including its
//! fullscreen-exit handler): when the key window is fullscreen, the
//! event is forwarded directly to the first responder so xterm / JS /
//! modals still see it, then swallowed so AppKit's exit path can't
//! run. Exit fullscreen via the green button or ⌃⌘F.

#![cfg(target_os = "macos")]

use std::ptr::NonNull;
use std::sync::Once;

use block2::RcBlock;
use objc2_app_kit::{
    NSApplication, NSEvent, NSEventMask, NSEventType, NSWindowStyleMask,
};
use objc2_foundation::MainThreadMarker;

const KEYCODE_ESC: u16 = 53;

/// Install a process-wide NSEvent monitor that swallows Esc when the
/// key window is in native fullscreen. Safe to call more than once.
pub fn suppress_esc_exit_fullscreen() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let block = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
            let event_ref = unsafe { event.as_ref() };
            if event_ref.r#type() != NSEventType::KeyDown
                || event_ref.keyCode() != KEYCODE_ESC
            {
                return event.as_ptr();
            }

            let Some(mtm) = MainThreadMarker::new() else {
                return event.as_ptr();
            };
            let app = NSApplication::sharedApplication(mtm);
            let Some(window) = app.keyWindow() else {
                return event.as_ptr();
            };
            if !window.styleMask().contains(NSWindowStyleMask::FullScreen) {
                return event.as_ptr();
            }

            if let Some(responder) = window.firstResponder() {
                responder.keyDown(event_ref);
            }
            std::ptr::null_mut()
        });

        unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::KeyDown,
                &block,
            );
        }
        // AppKit retains the block; leak the Rust handle so the monitor
        // stays installed for the life of the process.
        std::mem::forget(block);
    });
}
