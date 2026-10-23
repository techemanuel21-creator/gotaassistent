"""Gota's own abilities for Gota 2.0 (the opencode fork), served over MCP (stdio). They are what opencode does not have: reading the screen with OCR, WhatsApp, Outlook,
the curated IT knowledge base and skills, memory, instant Cisco scripts, and speaking aloud. The code is the Gota desktop package (single source of truth): it is found next
to this project (../../desktop), in GOTA_PY, or vendored in ./vendor."""
import json, os, sys, tempfile, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
for cand in (os.environ.get("GOTA_PY"), HERE.parent):   # python/gota is part of this project (self-contained)
    if cand and (Path(cand) / "gota" / "__init__.py").exists():
        sys.path.insert(0, str(cand))
        break

PROTOCOL = "2025-06-18"


def _settings():
    from gota import store
    return store.Settings()


def _profile():
    from gota import store
    return store.Profile()


def _text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=1, default=str)


# ---------------------------------------------------------------------- tools
def screen_read(screen=None, max_chars=3500):
    """Photographs a screen and reads its text with Windows OCR (offline, tiles enlarged). Returns the problem lines first, then the text (capped at max_chars; ask for more if needed)."""
    from gota import tools
    mons = tools.monitors()
    if screen in (None, "", "active"):
        mon = tools.active_monitor(mons)
    elif str(screen).lower() == "all":
        mon = None
    else:
        mon = next((m for m in mons if m["n"] == int(screen)), None) or tools.active_monitor(mons)
    rects = [m["rect"] for m in mons] if mon is None else [mon["rect"]]
    out = []
    for rect in rects:
        img = tools.grab_rect(*rect)
        path = os.path.join(tempfile.gettempdir(), f"gota_screen_{os.getpid()}.png")
        img.save(path)
        text = tools.ocr_tiles(path)
        problems = tools.problem_lines(text)
        cut = text if len(text) <= int(max_chars) else text[:int(max_chars)] + f"\n[... {len(text) - int(max_chars)} caracteres omitidos: peça max_chars maior se precisar]"
        out.append(("Linhas com erro:\n" + "\n".join(f"- {p}" for p in problems) + "\n\n" if problems else "") + "Texto lido da tela:\n" + cut)
    return "\n\n=== próxima tela ===\n\n".join(out)


def whatsapp_unread():
    from gota import whatsapp
    wa = whatsapp.WhatsApp(_settings())
    try:
        return wa.unread()
    except whatsapp.NotConnected:
        return "O WhatsApp não está conectado: abra o Gota e conecte pelo QR code em Conexões."


def _nick(table, spoken):
    """The real name behind a nickname the owner gave ("chefe" -> "Carlos Souza"), or None."""
    from gota import tools
    s = tools.norm(spoken)
    return next((real for nick, real in (table or {}).items() if tools.norm(nick) == s), None)


def app_open(name):
    from gota import tools
    found = tools.find_app(name, _settings().get("aliases") or {})
    if not found:
        return f"Não encontrei o aplicativo \"{name}\"."
    tools.launch(found[1])
    return f"Abri {found[0]}."


def app_nickname(nickname, app):
    from gota import tools
    found = tools.find_app(app, {})
    if not found:
        return f"Não encontrei o aplicativo \"{app}\"."
    s = _settings()
    s.set("aliases", {**(s.get("aliases") or {}), nickname.strip(): found[0]})
    return f"Pronto: \"{nickname}\" agora abre {found[0]}."


def whatsapp_nickname(nickname, contact):
    s = _settings()
    s.set("wa_nicks", {**(s.get("wa_nicks") or {}), nickname.strip(): contact.strip()})
    return f"Pronto: \"{nickname}\" agora é {contact} no WhatsApp."


def whatsapp_send(contact, message="", screenshot=False):
    from gota import whatsapp, tools
    contact = _nick(_settings().get("wa_nicks"), contact) or contact   # a nickname means the contact he gave it to
    wa = whatsapp.WhatsApp(_settings())
    image = None
    if screenshot:
        mons = tools.monitors()
        mon = tools.active_monitor(mons)
        image = os.path.join(tempfile.gettempdir(), f"gota_wa_{os.getpid()}.png")
        tools.grab_rect(*mon["rect"]).save(image)
    try:
        sent_to = wa.send(contact, message, image=image)
    except whatsapp.NotConnected:
        return "O WhatsApp não está conectado: abra o Gota e conecte pelo QR code em Conexões."
    return f"Enviado para {sent_to}."


def outlook_agenda(days=1):
    from gota import outlook
    ol = outlook.Outlook(_settings())
    try:
        return ol.agenda(int(days))
    except outlook.NotConnected:
        return "O Outlook não está conectado: abra o Gota e conecte em Conexões."


def outlook_emails(unread_only=False, days=14):
    from gota import outlook
    ol = outlook.Outlook(_settings())
    try:
        return _short(ol.emails(top=25, unread_only=bool(unread_only), days=int(days)))
    except outlook.NotConnected:
        return "O Outlook não está conectado: abra o Gota e conecte em Conexões."


def _short(value, limit=200):
    """Long text fields (mail previews, bodies) cut to `limit` characters: the model needs the gist, not the whole message."""
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    if isinstance(value, list):
        return [_short(v, limit) for v in value]
    if isinstance(value, dict):
        return {k: _short(v, limit) for k, v in value.items()}
    return value


def kb_search(query):
    """The Gota knowledge base (IT, security, backup/Veeam, networks, Windows/Linux...) and the step-by-step skills that match the question."""
    from gota import kb, skills
    kb.install_seed()
    parts = []
    for h in [h for h in skills.search(query, 1) if not h[1]["name"].startswith("desenvolver")][:1]:
        parts.append(skills.prompt_block([h], 4500))
    hits = kb.search(query, 3)
    if hits and kb.good_enough(hits, query):
        top = hits[0][0]
        for n, (score, title, _src, txt) in enumerate(hits[:2]):   # the best note in full, a second one only when it is about as good
            if n and score < top * 0.7:
                break
            parts.append(f"[{title}]\n{txt[:5000 if n == 0 else 2500]}")
    return "\n\n".join(parts) or "Nada na base de conhecimento sobre isso."


def memory_add(text):
    from gota import memory
    return memory.Memory().add("fato", text) or "Anotado."


def memory_search(query):
    from gota import memory
    return memory.Memory().search(query, 5)


def cisco_script(request):
    """Instant Cisco IOS script for a port/VLAN table ("41; Link02", "28 a 37; Antenas" under headings such as "Trunk:"), built exactly by the skill's rules."""
    from gota import netconf
    res = netconf.analyze(request, _profile().sir())
    if res is None:
        return "O pedido não é uma tabela de portas que eu monte instantaneamente; descreva as portas e VLANs em linhas 'porta; descrição' sob títulos como 'Trunk:'."
    return res["draft"] + ("" if res["complete"] else "\n\n(Rascunho parcial: o pedido tem requisitos além da tabela de portas; complete ou valide o restante.)")


def speak(text):
    from gota import voice
    sp = voice.Speaker()
    sp.speak(text)
    return "Falado."


STR = {"type": "string"}
TOOLS = {
    "screen_read": (screen_read, "Lê a tela com OCR (linhas de erro primeiro).",
                    {"screen": {"type": ["string", "integer"], "description": "número da tela, \"all\" ou omitido (ativa)"}, "max_chars": {"type": "integer"}}, []),
    "whatsapp_unread": (whatsapp_unread, "Conversas não lidas do WhatsApp (quem e quantas).", {}, []),
    "whatsapp_send": (whatsapp_send, "Envia mensagem e/ou print da tela a um contato do WhatsApp, na voz do dono (1ª pessoa).",
                      {"contact": STR, "message": STR, "screenshot": {"type": "boolean"}}, ["contact"]),
    "whatsapp_nickname": (whatsapp_nickname, "Dá um apelido a um contato do WhatsApp (ex.: \"chefe\"); depois ele pode ser chamado por esse apelido.", {"nickname": STR, "contact": STR}, ["nickname", "contact"]),
    "app_open": (app_open, "Abre um aplicativo do computador pelo nome ou apelido, na hora e sem pedir confirmação.", {"name": STR}, ["name"]),
    "app_nickname": (app_nickname, "Dá um apelido a um aplicativo (ex.: \"navegador\" = Chrome).", {"nickname": STR, "app": STR}, ["nickname", "app"]),
    "outlook_agenda": (outlook_agenda, "Compromissos do Outlook dos próximos N dias.", {"days": {"type": "integer"}}, []),
    "outlook_emails": (outlook_emails, "E-mails do Outlook (importantes, pendentes, não lidos).", {"unread_only": {"type": "boolean"}, "days": {"type": "integer"}}, []),
    "kb_search": (kb_search, "Base de conhecimento e habilidades do Gota (TI, segurança, Veeam, redes/Cisco, Windows, Linux, virtualização). Use antes de perguntas técnicas.", {"query": STR}, ["query"]),
    "memory_add": (memory_add, "Guarda um fato sobre o dono.", {"text": STR}, ["text"]),
    "memory_search": (memory_search, "Busca na memória do dono.", {"query": STR}, ["query"]),
    "cisco_script": (cisco_script, "Script Cisco IOS instantâneo de uma tabela de portas/VLANs.", {"request": STR}, ["request"]),
    "speak": (speak, "Fala o texto em voz alta.", {"text": STR}, ["text"]),
}


# ---------------------------------------------------------------------- MCP over stdio (newline-delimited JSON-RPC)
def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    msg.update({"error": error} if error else {"result": result})
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if method == "initialize":
        return reply(id_, {"protocolVersion": params.get("protocolVersion", PROTOCOL), "capabilities": {"tools": {}}, "serverInfo": {"name": "gota", "version": "2.0"}})
    if method == "tools/list":
        return reply(id_, {"tools": [{"name": n, "description": d, "inputSchema": {"type": "object", "properties": props, "required": req}} for n, (_f, d, props, req) in TOOLS.items()]})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in TOOLS:
            return reply(id_, error={"code": -32602, "message": f"ferramenta desconhecida: {name}"})
        try:
            return reply(id_, {"content": [{"type": "text", "text": _text(TOOLS[name][0](**args))}]})
        except Exception as e:
            try:   # a record of what failed, for finding the cause afterwards (%APPDATA%\Gota\mcp_errors.log)
                import time
                from gota import store
                with open(store.ROOT / "mcp_errors.log", "a", encoding="utf-8") as log:
                    log.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {name}({args}): {e}\n{traceback.format_exc(limit=4)}\n")
            except Exception:
                pass
            return reply(id_, {"content": [{"type": "text", "text": f"Erro: {e}\n{traceback.format_exc(limit=2)}"}], "isError": True})
    if method == "ping":
        return reply(id_, {})
    if id_ is not None:
        reply(id_, error={"code": -32601, "message": f"método não suportado: {method}"})


def main():
    def warm():   # the list of installed apps takes a few seconds the first time: have it ready before "abra o ..." is asked
        try:
            from gota import tools
            tools.installed_apps()
        except Exception:
            pass
    import threading
    threading.Thread(target=warm, daemon=True).start()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            handle(json.loads(line))
        except Exception:
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
