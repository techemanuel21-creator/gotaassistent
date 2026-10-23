import { app, BrowserWindow, ipcMain, screen } from "electron"
import { join } from "node:path"
import { startGotaNative, type GotaNativeInfo } from "./gota-native"

// The popup of GotaAssistent: the cat slides up from the bottom-right corner over any program, with a speech bubble that grows upwards, and slides down again.
// "call" stays until you hang up; "quick" asks one question, answers aloud and goes away by itself. It never takes the keyboard focus from the program you are using.
export type OverlayMode = "call" | "quick"

const WIDTH = 440
let win: BrowserWindow | undefined
let current: OverlayMode = "quick"
let height = 240
let slide: ReturnType<typeof setInterval> | undefined
let sliding: "in" | "out" | undefined

function area() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return display.workArea
}

// The popup sits flush on the taskbar: the bottom of the window is the bottom of the work area (the cat's feet touch the taskbar)
function target() {
  const work = area()
  return { x: work.x + work.width - WIDTH - 12, y: work.y + work.height - height, bottom: work.y + work.height }
}

function glide(done?: () => void) {
  clearInterval(slide)
  sliding = "in"
  slide = setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(slide)
    const bounds = win.getBounds()
    const toY = target().y // read again every step: the window grows while it slides (the bubble), and the stop must follow
    const next = toY + Math.round((bounds.y - toY) * 0.72) // ease-out, like the original Gota
    win.setBounds({ ...bounds, y: next })
    if (Math.abs(next - toY) > 1) return
    clearInterval(slide)
    sliding = undefined
    win.setBounds({ ...win.getBounds(), y: target().y })
    done?.()
  }, 16)
}

function slideIn() {
  if (!win || win.isDestroyed()) return
  const t = target()
  win.setBounds({ x: t.x, y: t.bottom, width: WIDTH, height })
  win.showInactive()
  win.setAlwaysOnTop(true, "screen-saver")
  glide()
}

function slideOut() {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const t = target()
  const hidden = win
  clearInterval(slide)
  sliding = "out"
  slide = setInterval(() => {
    if (hidden.isDestroyed()) return clearInterval(slide)
    const bounds = hidden.getBounds()
    if (bounds.y >= t.bottom) {
      clearInterval(slide)
      sliding = undefined
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
    const open = () => {
      win?.webContents.send("gota-overlay-restart", { mode })
      if (win && !win.isVisible()) slideIn()
    }
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", open)
    else open()
    return
  }
  create(info, mode, false)
}

/** Creates the popup window ahead of time, hidden, so the first Ctrl+Alt+L / Ctrl+Alt+G does not wait for it to load. */
export async function prepareGotaOverlay() {
  const info = await startGotaNative()
  if (!info || (win && !win.isDestroyed())) return
  create(info, "quick", true)
}

function create(info: GotaNativeInfo, mode: OverlayMode, idle: boolean) {
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
  void win.loadFile(join(app.getAppPath(), "src", "overlay", "overlay.html"), {
    query: { url: info.url, token: info.token, mode, ...(idle ? { idle: "1" } : {}) },
  })
  if (!idle) win.once("ready-to-show", slideIn)
  win.on("closed", () => (win = undefined))
}

export function registerGotaOverlayIpc() {
  ipcMain.on("gota-overlay-resize", (_event, next: number) => {
    if (!win || win.isDestroyed() || !Number.isFinite(next)) return
    height = Math.max(160, Math.min(Math.round(next), area().height - 40))
    const bounds = win.getBounds()
    // grow upwards: the bottom edge stays on the taskbar (while it slides in or out the animation keeps its own position)
    win.setBounds({ x: bounds.x, y: sliding ? bounds.y : target().y, width: WIDTH, height })
  })
  ipcMain.on("gota-overlay-hide", slideOut)
  ipcMain.handle("gota-overlay", (_event, mode: OverlayMode) => showGotaOverlay(mode))
}
