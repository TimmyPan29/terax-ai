use std::io;

use tauri::{
    menu::{Menu, MenuEvent, MenuId, MenuItem},
    AppHandle, Emitter, Manager, Runtime,
};

const GUARDED_QUIT_MENU_ID: &str = "terax.quit";
const CLOSE_PANE_MENU_ID: &str = "terax.close-pane";
const CLOSE_PANE_EVENT: &str = "terax:close-pane";
const NEW_TERMINAL_MENU_ID: &str = "terax.new-terminal";
const NEW_TERMINAL_EVENT: &str = "terax:new-terminal";
const QUIT_ACCELERATOR: &str = "Command+Q";

fn invalid_default_menu(message: &'static str) -> tauri::Error {
    io::Error::new(io::ErrorKind::InvalidData, message).into()
}

fn is_guarded_quit(id: &MenuId) -> bool {
    id == GUARDED_QUIT_MENU_ID
}

fn replace_window_close<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
    let mut replaced = false;
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        for (index, item) in submenu.items()?.into_iter().enumerate() {
            let Some(predefined) = item.as_predefined_menuitem() else {
                continue;
            };
            let text = predefined.text()?;
            if text != "Close Window" {
                continue;
            }
            let replacement = if replaced {
                MenuItem::new(app, text, false, None::<&str>)?
            } else {
                MenuItem::with_id(
                    app,
                    CLOSE_PANE_MENU_ID,
                    "Close Tab or Pane",
                    true,
                    Some("Command+W"),
                )?
            };
            submenu.remove_at(index)?;
            submenu.insert(&replacement, index)?;
            replaced = true;
        }
    }
    if !replaced {
        return Err(invalid_default_menu(
            "macOS default Close Window item is missing",
        ));
    }
    Ok(())
}

fn add_new_terminal<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
    for item in menu.items()? {
        let Some(submenu) = item.as_submenu() else {
            continue;
        };
        if submenu.text()? == "File" {
            let new_terminal = MenuItem::with_id(
                app,
                NEW_TERMINAL_MENU_ID,
                "New Terminal Tab",
                true,
                Some("Command+T"),
            )?;
            submenu.insert(&new_terminal, 0)?;
            return Ok(());
        }
    }
    Err(invalid_default_menu("macOS default File menu is missing"))
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    replace_window_close(app, &menu)?;
    add_new_terminal(app, &menu)?;
    let app_menu = menu
        .items()?
        .into_iter()
        .next()
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| invalid_default_menu("macOS default app menu is missing"))?;
    let items = app_menu.items()?;
    let quit_index = items
        .len()
        .checked_sub(1)
        .ok_or_else(|| invalid_default_menu("macOS default app menu is empty"))?;
    let native_quit = items[quit_index]
        .as_predefined_menuitem()
        .ok_or_else(|| invalid_default_menu("macOS default Quit item is not predefined"))?;
    let quit_text = native_quit.text()?;
    if quit_text != "Quit" && !quit_text.starts_with("Quit ") {
        return Err(invalid_default_menu(
            "macOS default app menu does not end with Quit",
        ));
    }

    let guarded_quit = MenuItem::with_id(
        app,
        GUARDED_QUIT_MENU_ID,
        quit_text,
        true,
        Some(QUIT_ACCELERATOR),
    )?;
    app_menu.remove_at(quit_index)?;
    app_menu.insert(&guarded_quit, quit_index)?;

    Ok(menu)
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == NEW_TERMINAL_MENU_ID {
        if let Some(main) = app.get_webview_window("main") {
            if main.is_focused().unwrap_or(false) {
                if let Err(error) = main.emit_to(main.label(), NEW_TERMINAL_EVENT, ()) {
                    log::error!("could not request new terminal tab: {error}");
                }
            }
        }
        return;
    }
    if event.id() == CLOSE_PANE_MENU_ID {
        if let Some(window) = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
        {
            let result = if window.label() == "main" {
                window.emit(CLOSE_PANE_EVENT, ())
            } else {
                window.close()
            };
            if let Err(error) = result {
                log::error!("could not request guarded pane close: {error}");
            }
        }
        return;
    }
    if !is_guarded_quit(event.id()) {
        return;
    }

    let Some(main) = app.get_webview_window("main") else {
        app.exit(0);
        return;
    };

    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_focus();
    if let Err(error) = main.close() {
        log::error!("could not request guarded app quit: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{is_guarded_quit, CLOSE_PANE_MENU_ID, GUARDED_QUIT_MENU_ID, NEW_TERMINAL_MENU_ID};
    use tauri::menu::MenuId;

    #[test]
    fn only_guarded_quit_id_requests_window_close() {
        assert!(is_guarded_quit(&MenuId::new(GUARDED_QUIT_MENU_ID)));
        assert!(!is_guarded_quit(&MenuId::new("unrelated")));
        assert!(!is_guarded_quit(&MenuId::new(CLOSE_PANE_MENU_ID)));
        assert!(!is_guarded_quit(&MenuId::new(NEW_TERMINAL_MENU_ID)));
    }
}
