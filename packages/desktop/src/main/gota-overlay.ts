import { app, BrowserWindow, ipcMain, screen } from "electron"
import { join } from "node:path"
import { startGotaNative } from "./gota-native"

// The popup of GotaAssistent: the cat slides up from the bottom-right corner over any program, with a speech bubble that grows upwards, and slides down again.
// "call" stays until you hang up; "quick" asks one question, answers aloud and goes away by itself. It never takes the keyboard focus from the program you are using.
export type OverlayMode = "call" | "quick"

const WIDTH = 440
let win: BrowserWindow | undefined
let current: OverlayMode = "quick"
let height = 240
let slide: ReturnType<typeof setInterval> | undefined

function area() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return display.workArea
}

function target() {
  const work = area()
  return { x: work.x + work.width - WIDTH - 12, y: work.y + work.height - height - 8, bottom: work.y + work.height }
}

function glide(toY: number, done?: () => void) {
  clearInterval(slide)
  slide = setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(slide)
    const bounds = win.getBounds()
    const next = toY + Math.round((bounds.y - toY) * 0.72) // ease-out, like the original Gota
    win.setBounds({ ...bounds, y: next })
    if (Math.abs(next - toY) > 1) return
    clearInterval(slide)
    win.setBounds({ ...bounds, y: toY })
    done?.()
  }, 16)
}

function slideIn() {
  if (!win || win.isDestroyed()) return
  const t = target()
  win.setBounds({ x: t.x, y: t.bottom, width: WIDTH, height })
  win.showInactive()
  win.setAlwaysOnTop(true, "screen-saver")
  glide(t.y)
}

function slideOut() {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const t = target()
  const hidden = win
  clearInterval(slide)
  slide = setInterval(() => {
    if (hidden.isDestroyed()) return clearInterval(slide)
    const bounds = hidden.getBounds()
    if (bounds.y >= t.bottom) {
      clearInterval(slide)
      hidden.hide()
      return
    }
    hidden.setBounds({ ...bounds, y: bounds.y + 24 })
  }, 16)
}

export async function showGotaOverlay(mode: OverlayMode) {
  const info = await startGotaNative()
  if (!info) return
  if (win && !win.isDestroyed()) {
    if (win.isVisible() && current === "call" && mode === "call") {
      win.webContents.send("gota-overlay-hangup") // the same shortcut again hangs up
      return
    }
    current = mode
    win.webContents.send("gota-overlay-restart", { mode })
    if (!win.isVisible()) slideIn()
    return
  }
  current = mode
  win = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: { preload: join(app.getAppPath(), "src", "overlay", "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.setMenu(null)
  void win.loadFile(join(app.getAppPath(), "src", "overlay", "overlay.html"), { query: { url: info.url, token: info.token, mode } })
  win.once("ready-to-show", slideIn)
  win.on("closed", () => (win = undefined))
}

export function registerGotaOverlayIpc() {
  ipcMain.on("gota-overlay-resize", (_event, next: number) => {
    if (!win || win.isDestroyed() || !Number.isFinite(next)) return
    height = Math.max(160, Math.min(Math.round(next), area().height - 40))
    const bounds = win.getBounds()
    const bottom = bounds.y + bounds.height // grow upwards: the bottom edge stays where it is
    win.setBounds({ x: bounds.x, y: bottom - height, width: WIDTH, height })
  })
  ipcMain.on("gota-overlay-hide", slideOut)
  ipcMain.handle("gota-overlay", (_event, mode: OverlayMode) => showGotaOverlay(mode))
}
