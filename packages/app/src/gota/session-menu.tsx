import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import type { HomeController } from "@/pages/home/home-controller"
import { showToast } from "@/utils/toast"

type Engine = NonNullable<ReturnType<HomeController["server"]["focusedContext"]>>["sdk"]["client"]

const button =
  "rounded-lg bg-v2-background-bg-layer-03 px-3 py-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-04 disabled:opacity-50"
const primary = "rounded-lg bg-v2-background-bg-accent px-3 py-1.5 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
const danger = "rounded-lg bg-red-600 px-3 py-1.5 text-[13px] text-white hover:opacity-90 disabled:opacity-50"
const field =
  "w-full rounded-lg border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-2 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-focus"

const MAX_PER_SESSION = 30_000   // characters of one conversation carried into the one it is merged with (the most recent part)

/** What the sidebar list does after a change: drop deleted conversations at once and fetch the list again (the engine's events do not always reach it). */
export type ListSync = { forget: (sessionID: string) => void; refresh: () => void }

function fail(t: (key: string) => string, cause: unknown) {
  showToast({ title: t("common.requestFailed"), description: cause instanceof Error ? cause.message : String(cause) })
}

type Part = { type: string; text?: string; synthetic?: boolean; ignored?: boolean; tool?: string }

/** A conversation as plain text: who said what, with tools only named (their output is not carried over). */
async function transcript(client: Engine, session: Session) {
  const result = await client.session.messages({ sessionID: session.id, directory: session.directory })
  const lines: string[] = []
  for (const message of (result.data ?? []) as { info: { role: string }; parts: Part[] }[]) {
    const who = message.info.role === "user" ? "Usuário" : "Gota"
    const text = message.parts
      .flatMap((part) => (part.type === "text" && part.text && !part.synthetic && !part.ignored ? [part.text.trim()] : part.type === "tool" && part.tool ? [`[usou a ferramenta ${part.tool}]`] : []))
      .join("\n")
    if (text) lines.push(`${who}: ${text}`)
  }
  const all = lines.join("\n\n")
  return all.length <= MAX_PER_SESSION ? all : `[... início omitido ...]\n${all.slice(all.length - MAX_PER_SESSION)}`
}

/** Brings the context of the other conversations into `target` (as notes the agent reads, without answering), then deletes them: it all lives in `target` now. */
async function merge(client: Engine, list: ListSync, target: Session, others: Session[]) {
  for (const other of [...others].sort((a, b) => a.time.created - b.time.created)) {
    const body = await transcript(client, other)
    if (!body) continue
    await client.session.prompt({
      sessionID: target.id,
      directory: target.directory,
      noReply: true,
      parts: [{ type: "text", text: `[Contexto mesclado da conversa "${other.title}"]\n\n${body}` }],
    })
  }
  for (const other of others) {
    await client.session.delete({ sessionID: other.id, directory: other.directory })
    list.forget(other.id)
  }
  list.refresh()
}

// ---------------------------------------------------------------------- dialogs
function RenameDialog(props: { client: Engine; list: ListSync; session: Session }) {
  const t = useLanguage().t
  const dialog = useDialog()
  const [title, setTitle] = createSignal(props.session.title)
  const save = () => {
    const next = title().trim()
    if (!next) return
    dialog.close()
    props.client.session.update({ sessionID: props.session.id, directory: props.session.directory, title: next }).then(props.list.refresh, (cause: unknown) => fail(t, cause))
  }
  return (
    <Dialog title={t("gota.session.rename")} size="normal">
      <div class="flex flex-col gap-3 p-4">
        <input
          class={field}
          value={title()}
          ref={(el) => setTimeout(() => (el.focus(), el.select()))}
          onInput={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => event.key === "Enter" && save()}
        />
        <div class="flex justify-end gap-2">
          <button type="button" class={button} onClick={() => dialog.close()}>{t("gota.session.cancel")}</button>
          <button type="button" class={primary} onClick={save}>{t("gota.session.save")}</button>
        </div>
      </div>
    </Dialog>
  )
}

function DeleteDialog(props: { client: Engine; list: ListSync; session: Session }) {
  const t = useLanguage().t
  const dialog = useDialog()
  const remove = () => {
    dialog.close()
    props.client.session.delete({ sessionID: props.session.id, directory: props.session.directory }).then(
      () => {
        props.list.forget(props.session.id)
        props.list.refresh()
      },
      (cause: unknown) => fail(t, cause),
    )
  }
  return (
    <Dialog title={t("gota.session.delete")} size="normal">
      <div class="flex flex-col gap-3 p-4">
        <p class="text-[13px] text-v2-text-text-muted">{t("gota.session.deleteConfirm").replace("{{name}}", props.session.title)}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class={button} onClick={() => dialog.close()}>{t("gota.session.cancel")}</button>
          <button type="button" class={danger} onClick={remove}>{t("gota.session.delete")}</button>
        </div>
      </div>
    </Dialog>
  )
}

function MergeDialog(props: { client: Engine; list: ListSync; session: Session; options: Session[] }) {
  const t = useLanguage().t
  const dialog = useDialog()
  const [chosen, setChosen] = createSignal<Record<string, boolean>>({})
  const [busy, setBusy] = createSignal(false)
  const picked = () => props.options.filter((item) => chosen()[item.id])
  const run = () => {
    const others = picked()
    if (!others.length) return
    setBusy(true)
    merge(props.client, props.list, props.session, others).then(
      () => {
        dialog.close()
        showToast({ title: t("gota.session.merged") })
      },
      (cause: unknown) => {
        setBusy(false)
        fail(t, cause)
      },
    )
  }
  return (
    <Dialog title={t("gota.session.merge")} size="normal">
      <div class="flex flex-col gap-3 p-4">
        <p class="text-[13px] text-v2-text-text-muted">{t("gota.session.mergeHint").replace("{{name}}", props.session.title)}</p>
        <div class="flex max-h-[40vh] flex-col gap-px overflow-y-auto">
          <For each={props.options} fallback={<p class="text-[13px] text-v2-text-text-faint">{t("gota.session.mergeNone")}</p>}>
            {(item) => (
              <label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-v2-background-bg-layer-02">
                <input type="checkbox" checked={!!chosen()[item.id]} onChange={(event) => setChosen({ ...chosen(), [item.id]: event.currentTarget.checked })} />
                <span class="truncate">{item.title}</span>
              </label>
            )}
          </For>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class={button} onClick={() => dialog.close()}>{t("gota.session.cancel")}</button>
          <button type="button" class={primary} disabled={busy() || picked().length === 0} onClick={run}>
            {busy() ? t("gota.session.merging") : t("gota.session.mergeAction")}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------- the right-click menu
export type SessionMenuState = { x: number; y: number; session: Session }

export function SessionMenu(props: { state: SessionMenuState; client: () => Engine | undefined; list: ListSync; others: () => Session[]; close: () => void }): JSX.Element {
  const t = useLanguage().t
  const dialog = useDialog()
  const close = () => props.close()
  onMount(() => {
    const keys = (event: KeyboardEvent) => event.key === "Escape" && close()
    window.addEventListener("keydown", keys)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    onCleanup(() => {
      window.removeEventListener("keydown", keys)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    })
  })
  const act = (open: (client: Engine) => unknown) => () => {
    const client = props.client()
    close()
    if (client) open(client)
  }
  const item = "block w-full rounded-md px-3 py-1.5 text-left text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-03"
  const left = () => Math.min(props.state.x, window.innerWidth - 190)
  const top = () => Math.min(props.state.y, window.innerHeight - 130)
  return (
    <Portal>
      <div class="fixed inset-0 z-[1000]" onClick={close} onContextMenu={(event) => (event.preventDefault(), close())} onWheel={close} />
      <div
        class="fixed z-[1001] w-44 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-02 p-1 shadow-lg"
        style={{ left: `${left()}px`, top: `${top()}px` }}
        role="menu"
      >
        <button type="button" role="menuitem" class={item} onClick={act((client) => dialog.show(() => <RenameDialog client={client} list={props.list} session={props.state.session} />))}>
          {t("gota.session.rename")}
        </button>
        <button
          type="button"
          role="menuitem"
          class={item}
          onClick={act((client) => dialog.show(() => <MergeDialog client={client} list={props.list} session={props.state.session} options={props.others()} />))}
        >
          {t("gota.session.merge")}
        </button>
        <button type="button" role="menuitem" class={item + " !text-red-400"} onClick={act((client) => dialog.show(() => <DeleteDialog client={client} list={props.list} session={props.state.session} />))}>
          {t("gota.session.delete")}
        </button>
      </div>
    </Portal>
  )
}

export function openSessionMenu(event: MouseEvent, session: Session, set: (state: SessionMenuState) => void) {
  event.preventDefault()
  set({ x: event.clientX, y: event.clientY, session })
}
