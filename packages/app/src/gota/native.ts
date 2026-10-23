// GotaAssistent native: the local service (python/gota_native) that talks to the computer itself: voice call, microphone, screens, WhatsApp, Outlook, routines.
// The Electron app starts it and tells the interface where it is; in a plain browser the address can be saved by hand (localStorage "gota.native").
import { createSignal, onCleanup } from "solid-js"

export type NativeInfo = { url: string; token: string }

type ElectronBridge = {
  api?: {
    gotaNative?: () => Promise<NativeInfo | null>
    onGotaShortcut?: (callback: (action: "call" | "quick") => void) => () => void
    openGotaOverlay?: (mode: "call" | "quick") => Promise<void>
  }
}

let cached: Promise<NativeInfo | null> | undefined

export function nativeInfo() {
  cached ??= (async () => {
    try {
      const fromApp = await (window as unknown as ElectronBridge).api?.gotaNative?.()
      if (fromApp) return fromApp
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem("gota.native") ?? "null") as NativeInfo | null
      if (saved?.url && saved.token) return saved
    } catch {}
    return null
  })()
  return cached
}

export async function native<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const info = await nativeInfo()
  if (!info) throw new Error("native-unavailable")
  const response = await fetch(info.url + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "X-Gota-Token": info.token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({ error: response.statusText }))).error ?? response.statusText)
  return (await response.json()) as T
}

// The conversations the voice call ("call") and the routines ("task") run through the engine: {session id: kind}. They are kept out of the list of chats
// (calls have their own "Chamadas" button) and the window stays quiet about them.
const [automated, setAutomated] = createSignal<Record<string, string>>({})
export const automatedSessions = automated

export async function refreshAutomated() {
  try {
    setAutomated(await native<Record<string, string>>("/automated"))
  } catch {}
}

export async function isAutomatedSession(sessionID: string | undefined) {
  if (!sessionID) return false
  if (automated()[sessionID]) return true
  await refreshAutomated()
  return !!automated()[sessionID]
}

export async function nativeImageUrl(path: string) {
  const info = await nativeInfo()
  return info ? `${info.url}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(info.token)}` : undefined
}

export type NativeEvent = Record<string, unknown> & { type: string }

/** Live events of the native service (call states, connection progress, finished tasks). Reconnects by itself. */
export function onNativeEvent(handler: (event: NativeEvent) => void) {
  let source: EventSource | undefined
  let closed = false
  void nativeInfo().then((info) => {
    if (!info || closed) return
    source = new EventSource(`${info.url}/events?token=${encodeURIComponent(info.token)}`)
    source.onmessage = (message) => {
      try {
        handler(JSON.parse(message.data) as NativeEvent)
      } catch {}
    }
  })
  onCleanup(() => {
    closed = true
    source?.close()
  })
}

/** The global shortcuts of the desktop app (Ctrl+Alt+L: call, Ctrl+Alt+G: quick question). */
export function onGotaShortcut(handler: (action: "call" | "quick") => void) {
  const off = (window as unknown as ElectronBridge).api?.onGotaShortcut?.(handler)
  if (off) onCleanup(off)
}

/** Opens the floating cat popup of the desktop app; false in a plain browser (the panel is used instead). */
export function openPopup(mode: "call" | "quick") {
  const open = (window as unknown as ElectronBridge).api?.openGotaOverlay
  if (!open) return false
  void open(mode)
  return true
}

/** Gives the native service the address of the engine (the local server) so the call and the routines can use the agent. */
export async function connectEngine(connection: { url: string; username?: string; password?: string }) {
  try {
    await native("/connect", connection)
  } catch {}
}

export function createNativeState() {
  const [state, setState] = createSignal<Record<string, any> | undefined>()
  const refresh = () => native<Record<string, any>>("/state").then(setState, () => setState(undefined))
  void refresh()
  onNativeEvent((event) => {
    if (["whatsapp", "outlook", "wake", "call"].includes(event.type)) void refresh()
  })
  return { state, refresh }
}
