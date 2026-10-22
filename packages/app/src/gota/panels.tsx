import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { GotaCat, type GotaCatAnimation } from "@opencode-ai/ui/gota-cat"
import { useLanguage } from "@/context/language"
import { GIcon } from "./icons"
import { native, nativeImageUrl, onNativeEvent, type NativeEvent } from "./native"

type DialogApi = { show: (element: () => JSX.Element) => unknown }

export const openCall = (dialog: DialogApi) => dialog.show(() => <CallPanel />)
export const openScreens = (dialog: DialogApi) => dialog.show(() => <ScreensPanel />)
export const openConnections = (dialog: DialogApi) => dialog.show(() => <ConnectionsPanel />)
export const openProfile = (dialog: DialogApi) => dialog.show(() => <ProfilePanel />)
export const openQuick = (dialog: DialogApi) => dialog.show(() => <CallPanel quick />)
export const openRoutines = (dialog: DialogApi) => dialog.show(() => <RoutinesPanel />)

const card = "rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-4"
const button =
  "rounded-lg bg-v2-background-bg-layer-03 px-3 py-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-04 disabled:opacity-50"
const primary = "rounded-lg bg-v2-background-bg-accent px-3 py-1.5 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
const field =
  "w-full rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-2 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"

function Unavailable() {
  const language = useLanguage()
  return <p class="text-[13px] text-v2-text-text-muted">{language.t("gota.native.unavailable")}</p>
}

// ---------------------------------------------------------------------- who you are
function ProfilePanel() {
  const t = useLanguage().t
  const dialog = useDialog()
  const [form, setForm] = createSignal({ name: "", treatment: "senhor" })
  const [saved, setSaved] = createSignal(false)
  void native<{ name: string; treatment: string }>("/profile").then((profile) => setForm({ name: profile.name, treatment: profile.treatment }), () => undefined)

  const save = () => {
    void native("/profile", form()).then(() => {
      setSaved(true)
      setTimeout(() => dialog.close(), 900)
    }, () => undefined)
  }

  return (
    <Dialog title={t("gota.profile.title")} size="normal">
      <div class="flex flex-col gap-3 p-4">
        <p class="text-[13px] text-v2-text-text-muted">{t("gota.profile.hint")}</p>
        <input class={field} placeholder={t("gota.profile.name")} value={form().name} onInput={(event) => setForm({ ...form(), name: event.currentTarget.value })} />
        <select class={field} value={form().treatment} onChange={(event) => setForm({ ...form(), treatment: event.currentTarget.value })}>
          <option value="senhor">{t("gota.profile.sir")}</option>
          <option value="senhora">{t("gota.profile.madam")}</option>
          <option value="">{t("gota.profile.none")}</option>
        </select>
        <button type="button" class={primary + " self-start"} onClick={save}>
          {saved() ? t("gota.profile.saved") : t("gota.profile.save")}
        </button>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------- the voice call
const PHONE: Record<string, GotaCatAnimation> = {
  starting: "anim_phone_idle",
  listening: "anim_phone_listen",
  heard: "anim_phone_think",
  thinking: "anim_phone_think",
  reply: "anim_phone_talk",
  speaking: "anim_phone_talk",
  ended: "anim_phone_idle",
  error: "anim_phone_idle",
}

function CallPanel(props: { quick?: boolean }) {
  const language = useLanguage()
  const dialog = useDialog()
  const t = language.t
  const [state, setState] = createSignal("starting")
  const [lines, setLines] = createSignal<{ who: "you" | "gota"; text: string }[]>([])
  const [partial, setPartial] = createSignal("")
  const [typed, setTyped] = createSignal("")
  const [error, setError] = createSignal("")
  const [settings, setSettings] = createSignal(false)

  onNativeEvent((event: NativeEvent) => {
    if (event.type !== "call") return
    const next = String(event.state ?? "")
    if (next === "drafting") return
    if (next === "listening" && event.partial) return setPartial(String(event.partial))
    if (next === "heard") setLines((all) => [...all, { who: "you", text: String(event.you ?? "") }])
    if (next === "reply") setLines((all) => [...all, { who: "gota", text: String(event.reply ?? "") }])
    if (next === "error") setError(String(event.message ?? ""))
    if (event.speaking !== undefined) return
    setPartial("")
    setState(next)
    if (next === "ended" && props.quick) setTimeout(() => dialog.close(), 2500)   // a quick question closes by itself once answered
  })

  onMount(() => {
    native("/call/start", { oneShot: !!props.quick }).catch((cause: Error) => setError(cause.message === "native-unavailable" ? t("gota.native.unavailable") : cause.message))
  })
  onCleanup(() => void native("/call/stop", {}).catch(() => undefined))

  const label = createMemo(
    () =>
      ({
        starting: t("gota.call.starting"),
        listening: t("gota.call.listening"),
        heard: t("gota.call.thinking"),
        thinking: t("gota.call.thinking"),
        reply: t("gota.call.speaking"),
        speaking: t("gota.call.speaking"),
        ended: t("gota.call.ended"),
        error: t("gota.call.error"),
      })[state()] ?? "",
  )

  const send = () => {
    const text = typed().trim()
    if (!text) return
    setTyped("")
    void native("/call/say", { text }).catch(() => undefined)
  }

  return (
    <Dialog title={props.quick ? t("gota.quick.title") : t("gota.call.title")} size="large">
      <div class="flex flex-col items-center gap-3 p-4">
        <GotaCat name={PHONE[state()] ?? "anim_phone_idle"} class="size-40" />
        <p class="text-[15px] font-medium text-v2-text-text-base" data-slot="call-state">
          {label()}
        </p>
        <Show when={partial()}>
          <p class="text-[13px] italic text-v2-text-text-muted">{partial()}</p>
        </Show>
        <Show when={error()}>
          <p class="text-[13px] text-v2-state-fg-danger">{error()}</p>
        </Show>
        <div class="max-h-48 w-full overflow-y-auto no-scrollbar flex flex-col gap-1.5">
          <For each={lines()}>
            {(line) => (
              <p
                class="rounded-lg px-3 py-1.5 text-[13px]"
                classList={{
                  "self-end bg-v2-background-bg-layer-03 text-v2-text-text-base": line.who === "you",
                  "self-start bg-v2-background-bg-layer-02 text-v2-text-text-muted": line.who === "gota",
                }}
              >
                {line.text}
              </p>
            )}
          </For>
        </div>
        <div class="flex w-full gap-2">
          <input
            class={field}
            value={typed()}
            placeholder={t("gota.call.type")}
            onInput={(event) => setTyped(event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Enter" && send()}
          />
          <button type="button" class={button} onClick={send}>
            {t("gota.call.send")}
          </button>
        </div>
        <div class="flex gap-2">
          <button type="button" class={button} onClick={() => setSettings(!settings())}>
            <GIcon name="mic" size={14} class="mr-1 inline" />
            {t("gota.call.voiceSettings")}
          </button>
          <button
            type="button"
            class="rounded-lg bg-v2-state-fg-danger px-3 py-1.5 text-[13px] text-white hover:opacity-90"
            onClick={() => void native("/call/stop", {}).catch(() => undefined)}
          >
            {t("gota.call.hangup")}
          </button>
        </div>
        <Show when={settings()}>
          <VoiceSettings />
        </Show>
      </div>
    </Dialog>
  )
}

function VoiceSettings() {
  const t = useLanguage().t
  const [mics, { refetch }] = createResource(() => native<{ devices: { name: string; selected: boolean }[]; chosen: string }>("/mics").catch(() => undefined))
  const [wake, setWake] = createSignal(false)
  const [test, setTest] = createSignal("")
  const [testing, setTesting] = createSignal(false)
  void native<{ hey_gota: boolean }>("/state").then((state) => setWake(!!state.hey_gota), () => undefined)

  const choose = (name: string) => void native("/mic", { name }).then(() => refetch())
  const toggleWake = () => {
    const next = !wake()
    setWake(next)
    void native("/wake", { enabled: next }).catch(() => setWake(!next))
  }
  const run = () => {
    setTesting(true)
    setTest(t("gota.mic.testing"))
    void native<{ device: string; peak: number; text: string; hint: string }>("/mic/test", {})
      .then((result) => setTest(result.text ? `“${result.text}” (${result.device})` : result.hint || t("gota.mic.silent")))
      .catch((cause: Error) => setTest(cause.message))
      .finally(() => setTesting(false))
  }

  return (
    <div class={card + " w-full"}>
      <label class="mb-1 block text-[12px] text-v2-text-text-muted">{t("gota.mic.device")}</label>
      <select class={field} onChange={(event) => choose(event.currentTarget.value)}>
        <option value="" selected={!mics()?.chosen}>
          {t("gota.mic.auto")}
        </option>
        <For each={mics()?.devices ?? []}>{(device) => <option value={device.name} selected={device.selected}>{device.name}</option>}</For>
      </select>
      <div class="mt-3 flex items-center gap-2">
        <button type="button" class={button} disabled={testing()} onClick={run}>
          {t("gota.mic.test")}
        </button>
        <span class="text-[12px] text-v2-text-text-muted">{test()}</span>
      </div>
      <label class="mt-3 flex items-center gap-2 text-[13px] text-v2-text-text-base">
        <input type="checkbox" checked={wake()} onChange={toggleWake} />
        {t("gota.mic.wake")}
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------- screens
type Screen = { n: number; primary: boolean; where: string; width: number; height: number; nick: string; active: boolean }
type Reading = { n: number; nick: string; problems: string[]; text: string }

function ScreensPanel() {
  const t = useLanguage().t
  const [screens, { refetch }] = createResource(() => native<Screen[]>("/screens").catch(() => undefined))
  const [reading, setReading] = createSignal<Reading[] | undefined>()
  const [busy, setBusy] = createSignal(false)
  const stamp = Date.now()

  const analyze = (screen: number | "all") => {
    setBusy(true)
    setReading(undefined)
    void native<Reading[]>("/screens/read", { screen })
      .then(setReading)
      .catch(() => setReading([]))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog title={t("gota.screens.title")} size="x-large">
      <div class="flex flex-col gap-3 p-4">
        <Show when={screens() !== undefined} fallback={<Unavailable />}>
          <p class="text-[13px] text-v2-text-text-muted">{t("gota.screens.hint")}</p>
          <div class="grid gap-3" style={{ "grid-template-columns": "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <For each={screens()}>
              {(screen) => {
                const [src] = createResource(() => nativeImageUrl(`/screens/${screen.n}.png?w=420&t=${stamp}`))
                return (
                  <div class={card}>
                    <Show when={src()}>
                      <img src={src()} alt="" class="mb-2 max-h-36 w-full rounded-lg border border-v2-border-border-muted object-contain" />
                    </Show>
                    <div class="mb-2 flex items-center justify-between text-[12px] text-v2-text-text-muted">
                      <span>
                        {t("gota.screens.number", { n: String(screen.n) })} · {screen.where} · {screen.width}×{screen.height}
                      </span>
                      <Show when={screen.active}>
                        <span class="rounded bg-v2-background-bg-accent px-1.5 text-white">{t("gota.screens.active")}</span>
                      </Show>
                    </div>
                    <input
                      class={field}
                      value={screen.nick}
                      placeholder={t("gota.screens.nick")}
                      onChange={(event) => void native("/screens/nick", { n: screen.n, nick: event.currentTarget.value }).then(() => refetch())}
                    />
                    <button type="button" class={primary + " mt-2 w-full"} disabled={busy()} onClick={() => analyze(screen.n)}>
                      {t("gota.screens.analyze")}
                    </button>
                  </div>
                )
              }}
            </For>
          </div>
          <Show when={(screens()?.length ?? 0) > 1}>
            <button type="button" class={button + " self-start"} disabled={busy()} onClick={() => analyze("all")}>
              {t("gota.screens.all")}
            </button>
          </Show>
          <Show when={busy()}>
            <p class="text-[13px] text-v2-text-text-muted">{t("gota.screens.reading")}</p>
          </Show>
          <For each={reading()}>
            {(item) => (
              <div class={card}>
                <p class="mb-1 text-[13px] font-medium text-v2-text-text-base">
                  {item.nick || t("gota.screens.number", { n: String(item.n) })}
                </p>
                <Show when={item.problems.length > 0}>
                  <p class="text-[12px] font-medium text-v2-state-fg-danger">{t("gota.screens.problems")}</p>
                  <ul class="mb-2 list-disc pl-5 text-[12px] text-v2-text-text-base">
                    <For each={item.problems}>{(problem) => <li>{problem}</li>}</For>
                  </ul>
                </Show>
                <pre class="max-h-56 overflow-auto whitespace-pre-wrap text-[12px] text-v2-text-text-muted">{item.text}</pre>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------- WhatsApp and Outlook
type WhatsApp = { connected: boolean; state?: string; message?: string }
type Outlook = { connected: boolean; account?: string; state?: string; code?: string; uri?: string; message?: string }

function ConnectionsPanel() {
  const t = useLanguage().t
  const [whatsapp, setWhatsapp] = createSignal<WhatsApp | undefined>()
  const [outlook, setOutlook] = createSignal<Outlook | undefined>()
  const [failed, setFailed] = createSignal(false)
  const refresh = () => {
    void native<WhatsApp>("/whatsapp/status").then(setWhatsapp, () => setFailed(true))
    void native<Outlook>("/outlook/status").then(setOutlook, () => setFailed(true))
  }
  onMount(refresh)
  onNativeEvent((event) => {
    if (event.type === "whatsapp" || event.type === "outlook") refresh()
  })

  const post = (path: string) => void native(path, {}).then(refresh, refresh)

  return (
    <Dialog title={t("gota.connections.title")} size="large">
      <div class="flex flex-col gap-3 p-4">
        <Show when={!failed()} fallback={<Unavailable />}>
          <div class={card}>
            <p class="text-[14px] font-medium text-v2-text-text-base">WhatsApp</p>
            <p class="mb-3 text-[13px] text-v2-text-text-muted">
              <Show when={whatsapp()?.connected} fallback={whatsapp()?.message || t("gota.connections.whatsapp.off")}>
                {t("gota.connections.connected")}
              </Show>
            </p>
            <div class="flex gap-2">
              <Show
                when={whatsapp()?.connected}
                fallback={
                  <button type="button" class={primary} disabled={whatsapp()?.state === "waiting"} onClick={() => post("/whatsapp/connect")}>
                    {whatsapp()?.state === "waiting" ? t("gota.connections.waitingQr") : t("gota.connections.whatsapp.connect")}
                  </button>
                }
              >
                <button type="button" class={button} onClick={() => post("/whatsapp/disconnect")}>
                  {t("gota.connections.disconnect")}
                </button>
              </Show>
            </div>
          </div>
          <div class={card}>
            <p class="text-[14px] font-medium text-v2-text-text-base">Outlook</p>
            <p class="mb-3 text-[13px] text-v2-text-text-muted">
              <Show when={outlook()?.connected} fallback={outlook()?.message || t("gota.connections.outlook.off")}>
                {t("gota.connections.connectedAs", { account: outlook()?.account ?? "" })}
              </Show>
            </p>
            <Show when={outlook()?.state === "waiting" && outlook()?.code}>
              <div class="mb-3 rounded-lg bg-v2-background-bg-layer-02 p-3 text-[13px] text-v2-text-text-base">
                <p>{t("gota.connections.outlook.step", { uri: outlook()?.uri ?? "" })}</p>
                <p class="mt-1 text-[22px] font-semibold tracking-widest">{outlook()?.code}</p>
                <button type="button" class={button + " mt-2"} onClick={() => window.open(outlook()?.uri, "_blank")}>
                  {t("gota.connections.outlook.open")}
                </button>
              </div>
            </Show>
            <div class="flex gap-2">
              <Show
                when={outlook()?.connected}
                fallback={
                  <button type="button" class={primary} onClick={() => post("/outlook/login")}>
                    {t("gota.connections.outlook.connect")}
                  </button>
                }
              >
                <button type="button" class={button} onClick={() => post("/outlook/disconnect")}>
                  {t("gota.connections.disconnect")}
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------- routines and background tasks
type Routine = { id: number; name: string; goal: string; when: string; repeat: string }
type Task = { id: number; name: string; status: string; result: string; started: number }

function RoutinesPanel() {
  const t = useLanguage().t
  const [routines, { refetch }] = createResource(() => native<Routine[]>("/routines").catch(() => undefined))
  const [tasks, setTasks] = createSignal<Task[]>([])
  const [form, setForm] = createSignal({ name: "", goal: "", when: "08:00", repeat: "daily" })
  const [message, setMessage] = createSignal("")
  const loadTasks = () => void native<Task[]>("/tasks").then(setTasks, () => undefined)
  onMount(loadTasks)
  onNativeEvent((event) => event.type === "task" && loadTasks())

  const add = () => {
    setMessage("")
    void native("/routines", form())
      .then(() => {
        setForm({ ...form(), name: "", goal: "" })
        return refetch()
      })
      .catch((cause: Error) => setMessage(cause.message))
  }
  const repeatLabel = (value: string) => t(`gota.routines.repeat.${value}` as "gota.routines.repeat.daily")

  return (
    <Dialog title={t("gota.routines.title")} size="x-large">
      <div class="flex flex-col gap-3 p-4">
        <Show when={routines() !== undefined} fallback={<Unavailable />}>
          <p class="text-[13px] text-v2-text-text-muted">{t("gota.routines.hint")}</p>
          <For each={routines()}>
            {(routine) => (
              <div class={card + " flex items-center gap-3"}>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[14px] font-medium text-v2-text-text-base">{routine.name}</p>
                  <p class="truncate text-[12px] text-v2-text-text-muted">
                    {routine.when} · {repeatLabel(routine.repeat)} · {routine.goal}
                  </p>
                </div>
                <button type="button" class={button} onClick={() => void native("/routines/run", { id: routine.id }).then(loadTasks)}>
                  <GIcon name="play" size={13} class="mr-1 inline" />
                  {t("gota.routines.run")}
                </button>
                <button type="button" class={button} aria-label={t("gota.routines.delete")} onClick={() => void native(`/routines/${routine.id}`, undefined, "DELETE").then(() => refetch())}>
                  <GIcon name="trash" size={14} />
                </button>
              </div>
            )}
          </For>
          <div class={card + " flex flex-col gap-2"}>
            <input class={field} placeholder={t("gota.routines.name")} value={form().name} onInput={(event) => setForm({ ...form(), name: event.currentTarget.value })} />
            <textarea class={field} rows={2} placeholder={t("gota.routines.goal")} value={form().goal} onInput={(event) => setForm({ ...form(), goal: event.currentTarget.value })} />
            <div class="flex gap-2">
              <input class={field} type="time" value={form().when} onInput={(event) => setForm({ ...form(), when: event.currentTarget.value })} />
              <select class={field} value={form().repeat} onChange={(event) => setForm({ ...form(), repeat: event.currentTarget.value })}>
                <For each={["daily", "weekdays", "weekly", "hourly"]}>{(value) => <option value={value}>{repeatLabel(value)}</option>}</For>
              </select>
              <button type="button" class={primary + " shrink-0"} onClick={add}>
                {t("gota.routines.add")}
              </button>
            </div>
            <Show when={message()}>
              <p class="text-[12px] text-v2-state-fg-danger">{message()}</p>
            </Show>
          </div>
          <p class="pt-2 text-[13px] font-medium text-v2-text-text-base">{t("gota.routines.tasks")}</p>
          <Show when={tasks().length > 0} fallback={<p class="text-[12px] text-v2-text-text-muted">{t("gota.routines.noTasks")}</p>}>
            <For each={tasks()}>
              {(task) => (
                <div class={card}>
                  <p class="text-[13px] font-medium text-v2-text-text-base">
                    {task.name} <span class="text-v2-text-text-muted">· {t(`gota.routines.status.${task.status}` as "gota.routines.status.done")}</span>
                  </p>
                  <Show when={task.result}>
                    <p class="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-[12px] text-v2-text-text-muted">{task.result}</p>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
