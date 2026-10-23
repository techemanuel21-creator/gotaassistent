import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useQueryClient } from "@tanstack/solid-query"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { GotaCat } from "@opencode-ai/ui/gota-cat"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { DialogConnectProvider, useProviderConnectController } from "@/components/dialog-connect-provider"
import { GIcon, type GotaIconName } from "./icons"
import { openCall, openCalls, openConnections, openNicks, openProfile, openQuick, openRoutines, openScreens } from "./panels"
import { automatedSessions, connectEngine, native, openPopup, refreshAutomated } from "./native"
import { openSessionMenu, SessionMenu, type SessionMenuState } from "./session-menu"

const COLLAPSE_KEY = "gota.sidebar.collapsed"
const SESSIONS_PER_PROJECT = 6

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1"
  } catch {
    return false
  }
}

function NavItem(props: { icon: GotaIconName; label: string; onClick: () => void; accent?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="group flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[14px] transition-colors hover:bg-v2-background-bg-layer-02"
      classList={{ "text-v2-text-text-base": true }}
    >
      <GIcon
        name={props.icon}
        class="shrink-0"
        style={{ color: props.accent ? "var(--v2-blue-400)" : "var(--v2-text-text-muted)" }}
      />
      <span class="flex-1 truncate">{props.label}</span>
      <Show when={props.hint}>
        <span class="text-[11px] text-v2-text-text-faint">{props.hint}</span>
      </Show>
    </button>
  )
}

/** The GotaAssistent side strip: what you do (create, search, call, screens, connections, routines, models), then your conversations grouped by project. */
export function GotaSidebar(): JSX.Element {
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const location = useLocation()
  const home = createHomeController()
  const sessions = createHomeSessionsController(home)
  const projects = createHomeProjectsController(home)
  const connect = useProviderConnectController()
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const [closed, setClosed] = createSignal<Record<string, boolean>>({})
  const queryClient = useQueryClient()
  const [menu, setMenu] = createSignal<SessionMenuState>()

  const toggle = () => {
    const next = !collapsed()
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
    } catch {}
  }

  const byProject = createMemo(() => {
    const groups = new Map<string, { name: string; worktree: string; items: ReturnType<typeof sessions.data.records> }>()
    for (const record of sessions.data.records()) {
      if (automatedSessions()[record.session.id]) continue // calls and routines are not chats: they have their own button
      const key = record.project.worktree
      const group = groups.get(key) ?? { name: record.projectName, worktree: key, items: [] }
      group.items.push(record)
      groups.set(key, group)
    }
    return [...groups.values()]
  })

  const t = language.t
  const conn = () => home.server.focused()

  // the engine's "session created/renamed" events do not always reach the list: fetch it again when the conversation changes and every few seconds (it is local and small)
  const refreshList = () => {
    void refreshAutomated()
    void queryClient.refetchQueries({ queryKey: home.server.focusedSync().homeSessions.indexKey, exact: true, type: "active" })
  }
  void refreshAutomated()
  createEffect(on(() => location.pathname, refreshList, { defer: true }))
  const timer = setInterval(refreshList, 5000)
  onCleanup(() => clearInterval(timer))

  // first run: ask who the owner is (the persona greets "senhor <name>")
  // (the native service can still be starting: try again for a while instead of giving up)
  const askName = (attempt = 0) =>
    void native<{ profile: { name: string } }>("/state").then(
      (state) => {
        if (!state.profile.name) openProfile(dialog)
      },
      () => {
        if (attempt < 40) setTimeout(() => askName(attempt + 1), 1500)
      },
    )
  askName()

  // the native service (call, routines) talks to the same engine as this window
  createEffect(() => {
    const current = conn()
    if (current?.http?.url) void connectEngine({ url: current.http.url, username: current.http.username, password: current.http.password })
  })

  return (
    <aside
      data-component="gota-sidebar"
      class="h-full shrink-0 flex flex-col overflow-hidden border-r border-v2-border-border-muted bg-v2-background-bg-deep transition-[width] duration-150"
      style={{ width: collapsed() ? "52px" : "284px" }}
    >
      <div class="flex items-center gap-2 px-3 pt-3 pb-2" classList={{ "justify-center px-1": collapsed() }}>
        <Show when={!collapsed()}>
          <GotaCat name="anim_cat_idle" class="size-8 shrink-0" />
          <span class="flex-1 truncate text-[15px] font-semibold tracking-wide text-v2-text-text-base">GotaAssistent</span>
        </Show>
        <button
          type="button"
          onClick={toggle}
          aria-label={t("gota.sidebar.toggle")}
          class="rounded-md p-1.5 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02"
        >
          <GIcon name="panel" />
        </button>
      </div>

      <Show when={!collapsed()}>
        <nav class="flex flex-col gap-px px-2 pt-1" aria-label={t("gota.sidebar.actions")}>
          <NavItem icon="plus" label={t("gota.nav.create")} onClick={() => sessions.session.create()} />
          <NavItem icon="search" label={t("gota.nav.search")} onClick={() => command.trigger("command.palette")} />
          <NavItem
            icon="folder"
            label={t("gota.nav.projects")}
            onClick={() => {
              const c = conn()
              if (c) projects.project.choose(c)
            }}
          />
          <NavItem icon="phone" label={t("gota.nav.call")} hint="Ctrl+Alt+L" onClick={() => openPopup("call") || openCall(dialog)} accent />
          <NavItem icon="mic" label={t("gota.nav.quick")} hint="Ctrl+Alt+G" onClick={() => openPopup("quick") || openQuick(dialog)} accent />
          <NavItem icon="screen" label={t("gota.nav.screens")} onClick={() => openScreens(dialog)} />
          <NavItem icon="link" label={t("gota.nav.connections")} onClick={() => openConnections(dialog)} />
          <NavItem
            icon="history"
            label={t("gota.nav.calls")}
            onClick={() => {
              const all = sessions.data.allSessions()
              const calls = all
                .filter((session) => automatedSessions()[session.id] === "call")
                .map((session) => ({ id: session.id, title: session.title, time: session.time.updated ?? session.time.created }))
                .sort((a, b) => b.time - a.time)
              openCalls(dialog, calls, (id) => {
                const session = all.find((item) => item.id === id)
                if (session) sessions.session.open(session)
              })
            }}
          />
          <NavItem icon="clock" label={t("gota.nav.routines")} onClick={() => openRoutines(dialog)} />
          <NavItem icon="tag" label={t("gota.nav.nicks")} onClick={() => openNicks(dialog)} />
          <NavItem
            icon="sparkle"
            label={t("gota.nav.models")}
            onClick={() => void dialog.show(() => <DialogConnectProvider controller={connect} />)}
          />
        </nav>

        <div class="mt-3 flex-1 min-h-0 overflow-y-auto px-2 pb-2 no-scrollbar">
          <Show
            when={byProject().length > 0}
            fallback={<p class="px-3 pt-3 text-[13px] text-v2-text-text-faint">{t("gota.sidebar.empty")}</p>}
          >
            <For each={byProject()}>
              {(group) => (
                <section class="mb-2">
                  <div class="flex items-center gap-1 px-3 pt-3 pb-1 text-[12px] font-medium text-v2-text-text-muted">
                    <button
                      type="button"
                      class="flex flex-1 items-center gap-1 truncate text-left"
                      onClick={() => setClosed((value) => ({ ...value, [group.worktree]: !value[group.worktree] }))}
                    >
                      <span class="truncate">{group.name}</span>
                      <GIcon
                        name="chevron"
                        size={12}
                        class="shrink-0 transition-transform"
                        style={{ transform: closed()[group.worktree] ? "rotate(-90deg)" : "none" }}
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={t("gota.nav.create")}
                      class="rounded p-1 hover:bg-v2-background-bg-layer-02"
                      onClick={() => {
                        const c = conn()
                        if (c) home.project.openProjectNewSession(c, group.worktree)
                      }}
                    >
                      <GIcon name="plus" size={14} />
                    </button>
                  </div>
                  <Show when={!closed()[group.worktree]}>
                    <For each={group.items.slice(0, SESSIONS_PER_PROJECT)}>
                      {(record) => (
                        <button
                          type="button"
                          onClick={() => sessions.session.open(record.session)}
                          onContextMenu={(event) => openSessionMenu(event, record.session, setMenu)}
                          title={record.session.title}
                          class="block w-full truncate rounded-lg px-3 py-[7px] text-left text-[14px] hover:bg-v2-background-bg-layer-02"
                          classList={{
                            "bg-v2-background-bg-layer-03 text-v2-text-text-base": location.pathname.includes(record.session.id),
                            "text-v2-text-text-muted": !location.pathname.includes(record.session.id),
                          }}
                        >
                          {record.session.title}
                        </button>
                      )}
                    </For>
                  </Show>
                </section>
              )}
            </For>
          </Show>
        </div>

        <div class="flex items-center gap-2 border-t border-v2-border-border-muted px-3 py-2.5">
          <button type="button" class="flex flex-1 items-center gap-2 truncate text-left" onClick={() => openProfile(dialog)} title={t("gota.profile.title")}>
            <GotaCat name="anim_cat_idle" class="size-7 shrink-0" />
            <span class="flex-1 truncate text-[13px] text-v2-text-text-muted">{t("gota.sidebar.footer")}</span>
          </button>
          <button
            type="button"
            aria-label={t("gota.nav.settings")}
            class="rounded-md p-1.5 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02"
            onClick={() => projects.utility.settings()}
          >
            <GIcon name="gear" />
          </button>
        </div>
      </Show>
      <Show when={menu()} keyed>
        {(state) => (
          <SessionMenu
            state={state}
            client={() => home.server.focusedContext()?.sdk.client}
            list={{
              forget: (id) => home.server.focusedSync().homeSessions.remove(id),
              refresh: () => void queryClient.refetchQueries({ queryKey: home.server.focusedSync().homeSessions.indexKey, exact: true }),
            }}
            others={() => sessions.data.searchRecords().map((record) => record.session).filter((item) => item.id !== state.session.id)}
            close={() => setMenu(undefined)}
          />
        )}
      </Show>
    </aside>
  )
}
