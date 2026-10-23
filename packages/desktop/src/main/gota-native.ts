import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { app, globalShortcut } from "electron"
import { FROM_SOURCE } from "./constants"

// The native Gota service (python/gota_native): voice call, microphone, screens, WhatsApp, Outlook, routines. It runs next to the app, only on this computer,
// behind a secret token that only this window receives.
export type GotaNativeInfo = { url: string; token: string }

let child: ChildProcess | undefined
let starting: Promise<GotaNativeInfo | null> | undefined

function projectRoot() {
  return process.env.GOTA_ROOT ?? join(app.getAppPath(), "..", "..")
}

/** The installed program keeps its caches and crash dumps in a `data` folder next to GotaAssistent.exe. What belongs to the user (API key, chats, window settings,
 * profile, memory) lives in %APPDATA%\Gota. From the source tree everything stays where it always was. */
export function portableDataDir() {
  if (FROM_SOURCE && !process.env.GOTA_PORTABLE) return undefined
  return process.env.GOTA_DATA ?? join(projectRoot(), "data")
}

function pythonPath(root: string) {
  const candidates = [
    process.env.GOTA_PYTHON,
    join(root, "python", "runtime", "python.exe"), // the installer (MSI) carries its own Python
    join(root, "python", ".venv", "Scripts", "python.exe"),
    join(root, "..", "desktop", ".venv", "Scripts", "python.exe"),
  ]
  return candidates.find((item) => item && existsSync(item)) ?? "python"
}

/** Writes the engine's configuration (persona, permissions, Gota tools) and points the engine to it, so the app also starts right when Windows launches it (no run.ps1). */
export function prepareGotaConfig() {
  if (process.env.OPENCODE_CONFIG_DIR) return
  const root = projectRoot()
  const script = join(root, "config", "build_config.py")
  if (!existsSync(script)) return
  const done = spawnSync(pythonPath(root), [script], { cwd: root, windowsHide: true, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } })
  const dir = done.stdout?.trim().split(/\r?\n/).pop()
  if (done.status === 0 && dir && existsSync(dir)) process.env.OPENCODE_CONFIG_DIR = dir
}

export function startGotaNative() {
  starting ??= new Promise<GotaNativeInfo | null>((resolve) => {
    const root = projectRoot()
    const script = join(root, "python", "gota_native", "server.py")
    if (!existsSync(script)) return resolve(null)
    const token = randomBytes(24).toString("hex")
    const proc = spawn(pythonPath(root), [script, "--port", "0", "--token", token], {
      cwd: join(root, "python"),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    })
    child = proc
    let settled = false
    const finish = (value: GotaNativeInfo | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    proc.stdout?.on("data", (chunk: Buffer) => {
      const match = /READY (\d+)/.exec(chunk.toString())
      if (match) finish({ url: `http://127.0.0.1:${match[1]}`, token })
    })
    proc.on("exit", () => {
      child = undefined
      starting = undefined
      finish(null)
    })
    proc.on("error", () => finish(null))
    setTimeout(() => finish(null), 30_000)
  })
  return starting
}

export type GotaShortcut = "call" | "quick"

/** Ctrl+Alt+L starts a voice call and Ctrl+Alt+G asks one quick question, over any program: the cat popup slides up (see gota-overlay.ts). */
export function registerGotaShortcuts(open: (action: GotaShortcut) => void) {
  globalShortcut.register("Control+Alt+L", () => open("call"))
  globalShortcut.register("Control+Alt+G", () => open("quick"))
}

export function stopGotaNative() {
  globalShortcut.unregisterAll()
  child?.kill()
  child = undefined
  starting = undefined
}
