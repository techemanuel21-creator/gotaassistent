"""Gota native: the part of Gota 2.0 that talks to the computer itself, served to the window over a local HTTP API (127.0.0.1, secret token, server-sent events):
the voice call and "Hey Gota", the microphone, the screens (with nicknames), the WhatsApp and Outlook connections, routines and background tasks.
The Electron app starts it and passes the address and token to the interface. Run by hand:  python server.py --port 4777 --token SECRET"""
import argparse, json, os, queue, re, subprocess, sys, tempfile, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("GOTA_MODELS", str(HERE.parent.parent / "models"))

from gota import store  # noqa: E402  (after the path set-up)
from gota_native import oc as oc_mod  # noqa: E402


class Native:
    def __init__(self):
        self.settings = store.Settings()
        self.subscribers = []
        self.lock = threading.Lock()
        self._listener = self._speaker = None
        self.call = None
        self.connection = None   # the opencode server: {"url", "username", "password"}; sent by the window
        if os.environ.get("GOTA_OC_URL"):
            self.connection = {"url": os.environ["GOTA_OC_URL"], "username": os.environ.get("GOTA_OC_USER", "opencode"), "password": os.environ.get("GOTA_OC_PASSWORD", "")}
        self.wake_stop = None
        self.tasks = []
        self.outlook_state = {"state": "idle"}
        self.whatsapp_state = {"state": "idle"}
        from gota_native.routines import Routines
        self.routines = Routines(self)

    # ------------------------------------------------------------------ plumbing
    def emit(self, event):
        with self.lock:
            for q in list(self.subscribers):
                q.put(event)

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            self.subscribers.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.subscribers:
                self.subscribers.remove(q)

    def profile(self):
        return store.Profile()

    def warm(self, delay=4):
        """Loads the voice (Piper), the recognizers (Vosk, Whisper) and renders the greeting in the background, a few seconds after the service starts:
        by the time Ctrl+Alt+L is pressed there is nothing left to load, so the call starts and speaks at once."""
        try:
            time.sleep(delay)
            from gota_native.call import greeting
            self.speaker().prerender(greeting(self.profile()))
            self.listener.preload()
        except Exception:
            pass

    def save_profile(self, name, treatment):
        """Stores the owner's name and form of address and rebuilds the persona the agent reads (config/build_config.py)."""
        import importlib.util
        store.Profile().set_name(name or "Dono", treatment if treatment in ("senhor", "senhora", "") else "senhor")
        threading.Thread(target=self.warm, args=(0,), daemon=True).start()   # the greeting now carries the new name
        spec = importlib.util.spec_from_file_location("gota_build_config", HERE.parent.parent / "config" / "build_config.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.main()

    def oc(self):
        if not self.connection:
            raise oc_mod.OpenCodeError("o Gota ainda não recebeu a conexão com o motor (abra a janela)")
        return oc_mod.Client(self.connection["url"], self.connection.get("username", "opencode"), self.connection.get("password", ""))

    def listener(self):
        if self._listener is None:
            from gota import voice
            self._listener = voice.Listener()
            self._listener.preferred = self.settings.get("mic_device") or ""
        return self._listener

    listener = property(listener)

    def speaker(self):
        if self._speaker is None:
            from gota import voice
            self._speaker = voice.Speaker()
            self._speaker.english = self.settings.get("english_speech") is not False
        return self._speaker

    def feeder(self):
        from gota import voice
        return voice.SentenceFeeder(self.speaker())

    def toast(self, title, text):
        ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
              "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
              "$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode($env:G_TITLE)) | Out-Null; $t.Item(1).AppendChild($x.CreateTextNode($env:G_TEXT)) | Out-Null;"
              "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Gota').Show([Windows.UI.Notifications.ToastNotification]::new($x))")
        try:
            subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], env=dict(os.environ, G_TITLE=title, G_TEXT=text[:300]),
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            pass
        self.emit({"type": "notify", "title": title, "text": text[:300]})

    # ------------------------------------------------------------------ voice call and wake word
    def start_call(self, one_shot=False):
        from gota_native.call import Call
        with self.lock:
            if self.call is not None:
                return False
            self.call = Call(self, one_shot=one_shot)
        self.stop_wake(restart_after=False)
        self.call.start()
        return True

    def stop_call(self):
        c = self.call
        if c:
            c.stop()
        return bool(c)

    def call_finished(self, call):
        with self.lock:
            if self.call is call:
                self.call = None
        if self.settings.get("hey_gota"):
            self.start_wake()

    def start_wake(self):
        if self.wake_stop is not None and not self.wake_stop.is_set():
            return
        stop = self.wake_stop = threading.Event()

        def work():
            try:
                self.emit({"type": "wake", "state": "listening"})
                if self.listener.wait_for_wake_word(stop) and not stop.is_set():
                    self.emit({"type": "wake", "state": "heard"})
                    self.start_call(one_shot=True)
            except Exception as e:
                self.emit({"type": "wake", "state": "error", "message": str(e)})
        threading.Thread(target=work, daemon=True).start()

    def stop_wake(self, restart_after=False):
        if self.wake_stop is not None:
            self.wake_stop.set()
            self.listener.cancel.set()
            self.emit({"type": "wake", "state": "off"})

    # ------------------------------------------------------------------ screens
    def screens(self):
        from gota import tools
        nicks = self.settings.get("screen_nicks") or {}
        mons = tools.monitors()
        cur = tools.active_monitor(mons) if mons else None
        return [{"n": m["n"], "primary": m["primary"], "where": m["where"], "width": m["rect"][2] - m["rect"][0], "height": m["rect"][3] - m["rect"][1],
                 "nick": nicks.get(str(m["n"]), ""), "active": bool(cur and cur["n"] == m["n"])} for m in mons]

    def set_nick(self, n, nick):
        nicks = dict(self.settings.get("screen_nicks") or {})
        if nick.strip():
            nicks[str(n)] = nick.strip()
        else:
            nicks.pop(str(n), None)
        self.settings.set("screen_nicks", nicks)

    def grab(self, screen):
        from gota import tools
        mons = tools.monitors()
        if screen in (None, "", "active"):
            chosen = [tools.active_monitor(mons)]
        elif str(screen).lower() == "all":
            chosen = mons
        else:
            nicks = {tools.norm(v): int(k) for k, v in (self.settings.get("screen_nicks") or {}).items()}
            want = nicks.get(tools.norm(str(screen)), None)
            want = int(screen) if want is None and str(screen).isdigit() else want
            chosen = [m for m in mons if m["n"] == want] or [tools.active_monitor(mons)]
        return [(m, tools.grab_rect(*m["rect"])) for m in chosen if m]

    def screen_png(self, n, width=480):
        import io
        from gota import tools
        mon = next((m for m in tools.monitors() if m["n"] == n), None)
        if mon is None:
            return None
        img = tools.grab_rect(*mon["rect"]).convert("RGB")
        img.thumbnail((width, width))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()

    def read_screen(self, screen):
        from gota import tools
        out = []
        for m, img in self.grab(screen):
            path = os.path.join(tempfile.gettempdir(), f"gota_native_screen_{m['n']}.png")
            img.save(path)
            text = tools.ocr_tiles(path)
            out.append({"n": m["n"], "nick": (self.settings.get("screen_nicks") or {}).get(str(m["n"]), ""), "problems": tools.problem_lines(text), "text": text})
        return out

    # ------------------------------------------------------------------ microphone
    def mics(self):
        from gota import voice
        chosen = self.settings.get("mic_device") or ""
        rows = []
        try:
            for item in voice.input_devices():
                name = item[1] if isinstance(item, (tuple, list)) else item.get("name")
                rows.append({"name": name, "selected": name == chosen})
        except Exception:
            pass
        return {"devices": rows, "chosen": chosen}

    def set_mic(self, name):
        self.settings.set("mic_device", name)
        self.listener.preferred = name

    def mic_test(self):
        """Listens for a few seconds and says what was heard and how loud it was."""
        l = self.listener
        text = l.listen(silence=1.0, timeout=6.0, max_seconds=8.0)
        return {"device": l.device_name, "peak": l.peak, "text": text, "hint": "" if text else l.explain_silence()}

    # ------------------------------------------------------------------ WhatsApp and Outlook
    def whatsapp_status(self):
        from gota import whatsapp
        return {"connected": whatsapp.WhatsApp(self.settings).connected(), **self.whatsapp_state}

    def whatsapp_connect(self):
        from gota import whatsapp

        def work():
            wa = whatsapp.WhatsApp(self.settings)
            self.whatsapp_state = {"state": "waiting", "message": "Abri o WhatsApp Web no Edge: leia o QR code com o celular."}
            self.emit({"type": "whatsapp", **self.whatsapp_state})
            try:
                ok = wa.connect(on_status=lambda s: self.emit({"type": "whatsapp", "state": "waiting", "message": s}), wait=240)
            except Exception as e:
                ok, err = False, str(e)
            else:
                err = "" if ok else "Não deu tempo de ler o QR code."
            if ok:
                self.settings.set("whatsapp_connected", True)
            self.whatsapp_state = {"state": "connected" if ok else "error", "message": "" if ok else err}
            self.emit({"type": "whatsapp", **self.whatsapp_state})
        threading.Thread(target=work, daemon=True).start()

    def whatsapp_disconnect(self):
        from gota import whatsapp
        whatsapp.WhatsApp(self.settings).disconnect()
        self.settings.set("whatsapp_connected", False)
        self.whatsapp_state = {"state": "idle"}

    def outlook_status(self):
        from gota import outlook
        ol = outlook.Outlook(self.settings)
        return {"connected": ol.connected(), "account": ol.who() if ol.connected() else "", **self.outlook_state}

    def outlook_login(self):
        from gota import outlook
        ol = outlook.Outlook(self.settings)
        flow = ol.begin_login()
        self.outlook_state = {"state": "waiting", "code": flow["user_code"], "uri": flow["verification_uri"]}
        self.emit({"type": "outlook", **self.outlook_state})

        def work():
            try:
                who = ol.finish_login(flow)
                self.outlook_state = {"state": "connected", "account": who}
            except Exception as e:
                self.outlook_state = {"state": "error", "message": str(e)}
            self.emit({"type": "outlook", **self.outlook_state})
        threading.Thread(target=work, daemon=True).start()
        return self.outlook_state

    def outlook_disconnect(self):
        from gota import outlook
        outlook.Outlook(self.settings).disconnect()
        self.outlook_state = {"state": "idle"}

    # ------------------------------------------------------------------ everything at a glance
    def state(self):
        out = {"call": self.call.state if self.call else "idle", "wake": bool(self.wake_stop and not self.wake_stop.is_set()), "hey_gota": bool(self.settings.get("hey_gota")),
               "connection": bool(self.connection), "profile": {"name": self.profile().name, "sir": self.profile().sir()}, "automated": {sid: info["kind"] for sid, info in oc_mod.AUTOMATED.items()}}
        for key, fn in (("whatsapp", self.whatsapp_status), ("outlook", self.outlook_status)):
            try:
                out[key] = fn()
            except Exception as e:
                out[key] = {"connected": False, "error": str(e)}
        return out


NATIVE = None
TOKEN = ""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("application/json") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Gota-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def _auth(self, query):
        return (self.headers.get("X-Gota-Token") or (query.get("token") or [""])[0]) == TOKEN

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except ValueError:
            return {}

    def _route(self, method):
        url = urlparse(self.path)
        query, path = parse_qs(url.query), url.path
        if not self._auth(query):
            return self._send(401, {"error": "token"})
        n, body = NATIVE, (self._body() if method in ("POST", "DELETE") else {})
        try:
            if path == "/health":
                return self._send(200, {"ok": True})
            if path == "/state":
                return self._send(200, n.state())
            if path == "/automated":   # the conversations the service runs by itself (calls, routines), light enough to ask every few seconds
                return self._send(200, {sid: info["kind"] for sid, info in oc_mod.AUTOMATED.items()})
            if path == "/events":
                return self._events()
            if path == "/connect" and method == "POST":
                n.connection = {"url": body["url"], "username": body.get("username", "opencode"), "password": body.get("password", "")}
                n.routines.connection_ready()
                return self._send(200, {"ok": True})
            # --- profile
            if path == "/profile":
                if method == "POST":
                    n.save_profile(body.get("name", ""), body.get("treatment", "senhor"))
                p = n.profile()
                return self._send(200, {"name": p.name, "treatment": p.treatment})
            # --- call
            if path == "/call/start" and method == "POST":
                return self._send(200, {"started": n.start_call(one_shot=bool(body.get("oneShot")))})
            if path == "/call/stop" and method == "POST":
                return self._send(200, {"stopped": n.stop_call()})
            if path == "/call/say" and method == "POST":
                if not n.call:
                    return self._send(409, {"error": "sem ligação"})
                n.call.say(body.get("text", ""))
                return self._send(200, {"ok": True})
            if path == "/speak" and method == "POST":
                n.speaker().speak(body.get("text", ""))
                return self._send(200, {"ok": True})
            if path == "/speak/stop" and method == "POST":
                n.speaker().stop()
                return self._send(200, {"ok": True})
            if path == "/wake" and method == "POST":
                n.settings.set("hey_gota", bool(body.get("enabled")))
                n.start_wake() if body.get("enabled") else n.stop_wake()
                return self._send(200, {"enabled": bool(body.get("enabled"))})
            # --- microphone
            if path == "/mics":
                return self._send(200, n.mics())
            if path == "/mic" and method == "POST":
                n.set_mic(body.get("name", ""))
                return self._send(200, n.mics())
            if path == "/mic/test" and method == "POST":
                return self._send(200, n.mic_test())
            # --- screens
            if path == "/screens":
                return self._send(200, n.screens())
            if path == "/screens/nick" and method == "POST":
                n.set_nick(body["n"], body.get("nick", ""))
                return self._send(200, n.screens())
            if path == "/screens/read" and method == "POST":
                return self._send(200, n.read_screen(body.get("screen")))
            m = re.fullmatch(r"/screens/(\d+)\.png", path)
            if m:
                png = n.screen_png(int(m.group(1)), int((query.get("w") or ["480"])[0]))
                return self._send(200 if png else 404, png or b"", "image/png")
            # --- WhatsApp / Outlook
            if path == "/whatsapp/status":
                return self._send(200, n.whatsapp_status())
            if path == "/whatsapp/connect" and method == "POST":
                n.whatsapp_connect()
                return self._send(200, {"started": True})
            if path == "/whatsapp/disconnect" and method == "POST":
                n.whatsapp_disconnect()
                return self._send(200, n.whatsapp_status())
            if path == "/outlook/status":
                return self._send(200, n.outlook_status())
            if path == "/outlook/login" and method == "POST":
                return self._send(200, n.outlook_login())
            if path == "/outlook/disconnect" and method == "POST":
                n.outlook_disconnect()
                return self._send(200, n.outlook_status())
            # --- nicknames: for apps ("navegador" = Chrome) and for WhatsApp contacts ("chefe" = Carlos Souza)
            if path == "/nicks":
                s = n.settings
                if method == "POST":
                    key = "aliases" if body.get("kind") == "app" else "wa_nicks"
                    table = dict(s.get(key) or {})
                    nick, target = str(body.get("nick", "")).strip(), str(body.get("target", "")).strip()
                    if body.get("remove"):
                        table.pop(nick, None)
                    elif nick and target:
                        table[nick] = target
                    s.set(key, table)
                from gota import tools
                return self._send(200, {"apps": s.get("aliases") or {}, "contacts": s.get("wa_nicks") or {}, "installed": [name for name, _ in tools.installed_apps()]})
            # --- routines and tasks
            if path == "/routines":
                if method == "POST":
                    return self._send(200, n.routines.add(body["name"], body["goal"], body.get("when", "08:00"), body.get("repeat", "daily")))
                return self._send(200, n.routines.items())
            m = re.fullmatch(r"/routines/(\d+)", path)
            if m and method == "DELETE":
                n.routines.delete(int(m.group(1)))
                return self._send(200, n.routines.items())
            if path == "/routines/run" and method == "POST":
                return self._send(200, n.routines.run_now(body["id"]))
            if path == "/tasks":
                if method == "POST":
                    return self._send(200, n.routines.start_task(body.get("name") or body["goal"][:40], body["goal"]))
                return self._send(200, n.routines.tasks)
            return self._send(404, {"error": "rota desconhecida"})
        except KeyError as e:
            return self._send(400, {"error": f"falta o campo {e}"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return self._send(500, {"error": str(e)})

    def _events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        q = NATIVE.subscribe()
        try:
            self.wfile.write(b": ok\n\n")
            self.wfile.flush()
            while True:
                try:
                    e = q.get(timeout=15)
                    self.wfile.write(b"data: " + json.dumps(e, ensure_ascii=False, default=str).encode("utf-8") + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            NATIVE.unsubscribe(q)

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")


def main():
    global NATIVE, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--token", default=os.environ.get("GOTA_NATIVE_TOKEN", ""))
    args = ap.parse_args()
    TOKEN = args.token
    NATIVE = Native()
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    httpd.daemon_threads = True
    print(f"READY {httpd.server_address[1]}", flush=True)
    threading.Thread(target=NATIVE.warm, daemon=True).start()   # load the voice models now, not when the call starts
    httpd.serve_forever()


if __name__ == "__main__":
    main()
