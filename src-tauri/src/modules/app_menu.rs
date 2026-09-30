use std::io;

use tauri::{
    menu::{Menu, MenuEvent, MenuId, MenuItem},
    AppHandle, Manager, Runtime,
};

const GUARDED_QUIT_MENU_ID: &str = "terax.quit";
const QUIT_ACCELERATOR: &str = "Command+Q";

fn invalid_default_menu(message: &'static str) -> tauri::Error {
    io::Error::new(io::ErrorKind::InvalidData, message).into()
}

fn is_guarded_quit(id: &MenuId) -> bool {
    id == GUARDED_QUIT_MENU_ID
}

fn disable_window_close<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
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
            let disabled = MenuItem::new(app, text, false, None::<&str>)?;
            submenu.remove_at(index)?;
            submenu.insert(&disabled, index)?;
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

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    disable_window_close(app, &menu)?;
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
    use super::{is_guarded_quit, GUARDED_QUIT_MENU_ID};
    use tauri::menu::MenuId;

    #[test]
    fn only_guarded_quit_id_requests_window_close() {
        assert!(is_guarded_quit(&MenuId::new(GUARDED_QUIT_MENU_ID)));
        assert!(!is_guarded_quit(&MenuId::new("unrelated")));
    }
}
