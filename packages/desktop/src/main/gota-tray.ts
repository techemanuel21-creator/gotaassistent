import { app, Menu, nativeImage, Tray } from "electron"
import { FROM_SOURCE } from "./constants"

// GotaAssistent keeps running in the background: closing the window only hides it, the cat stays next to the clock (system tray) and the shortcuts, the voice
// call, "Hey Gota" and the routines keep working. Only "Sair" in the tray menu really quits.
let quitRequested = false
let tray: Tray | undefined

/** Started by Windows at login (or with --hidden): no window at first, only the tray icon. */
export const startedHidden = process.argv.includes("--hidden")

export function markQuitting() {
  quitRequested = true
}

/** True when closing a window should only hide it. */
export function shouldHideOnClose() {
  return !quitRequested && process.platform === "win32"
}

export function startsWithWindows() {
  return app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin
}

function setStartsWithWindows(value: boolean) {
  // packaged or not, Windows must start this very executable (GotaAssistent.exe), plus the app folder when it is not a packaged build
  const args = FROM_SOURCE ? [app.getAppPath(), "--hidden"] : ["--hidden"]
  app.setLoginItemSettings({ openAtLogin: value, path: process.execPath, args })
}

type Actions = { open: () => void; call: () => void; quick: () => void }

export function createGotaTray(icon: string, actions: Actions) {
  if (tray) return tray
  const image = nativeImage.createFromPath(icon)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip("GotaAssistent")
  const refresh = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir o GotaAssistent", click: actions.open },
        { type: "separator" },
        { label: "Ligar para o Gota\tCtrl+Alt+L", click: actions.call },
        { label: "Pergunta rápida\tCtrl+Alt+G", click: actions.quick },
        { type: "separator" },
        {
          label: "Iniciar com o Windows",
          type: "checkbox",
          checked: startsWithWindows(),
          click: (item) => {
            setStartsWithWindows(item.checked)
            refresh()
          },
        },
        { type: "separator" },
        {
          label: "Sair",
          click: () => {
            markQuitting()
            app.quit()
          },
        },
      ]),
    )
  refresh()
  tray.on("click", actions.open)
  return tray
}
