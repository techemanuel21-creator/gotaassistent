"""A small client of the opencode server (the engine of Gota 2.0): sends a message to a session, follows the events until the agent is done and hands back the answer
(streaming it while it is written). Used by the voice call and by the routines, where nobody can click "allow": every permission request is refused."""
import base64, json, queue, threading, time, urllib.error, urllib.parse, urllib.request


class OpenCodeError(Exception):
    pass


class Client:
    def __init__(self, url, username="opencode", password="", directory=None):
        self.url, self.directory = url.rstrip("/"), directory
        self.auth = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode() if password else ""

    def _open(self, path, body=None, method=None, timeout=60):
        sep = "&" if "?" in path else "?"
        url = self.url + path + (f"{sep}directory={urllib.parse.quote(self.directory)}" if self.directory else "")
        headers = {"Content-Type": "application/json"}
        if self.auth:
            headers["Authorization"] = self.auth
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode("utf-8"), headers=headers, method=method or ("POST" if body is not None else "GET"))
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            raise OpenCodeError(f"opencode {e.code}: {e.read().decode('utf-8', 'ignore')[:160]}")
        except Exception as e:
            raise OpenCodeError(f"sem resposta do opencode: {e}")

    def json(self, path, body=None, method=None, timeout=60):
        with self._open(path, body, method, timeout) as r:
            raw = r.read().decode("utf-8", "ignore")
        return json.loads(raw) if raw.strip() else {}

    def session(self, title=None):
        return self.json("/session", {"title": title} if title else {})["id"]

    def abort(self, sid):
        try:
            self._open(f"/session/{sid}/abort", {}, timeout=5).close()
        except OpenCodeError:
            pass

    # the engine's own tools, by name: a voice call or a routine does not need the coding tools, and their descriptions are thousands of tokens in every request
    CODING_TOOLS = ["bash", "edit", "write", "patch", "apply_patch", "task", "todowrite", "todoread", "question", "skill", "lsp", "webfetch", "websearch", "list"]
    NO_TOOLS = CODING_TOOLS + ["read", "glob", "grep"]

    def ask(self, text, session=None, system=None, on_text=None, timeout=300, stop=None, without=None):
        """Returns (answer, session id). on_text(answer so far) is called as the answer is written; `stop` is a threading.Event that cancels the request."""
        sid = session or self.session()
        events, stop = queue.Queue(), stop or threading.Event()
        sse = self._open("/event", timeout=timeout + 30)

        def reader():
            try:
                for raw in sse:
                    line = raw.decode("utf-8", "ignore").strip()
                    if line.startswith("data:"):
                        try:
                            events.put(json.loads(line[5:]))
                        except ValueError:
                            pass
            except Exception:
                pass
            events.put(None)
        threading.Thread(target=reader, daemon=True).start()
        body = {"parts": [{"type": "text", "text": text}]}
        if system:
            body["system"] = system
        if without:   # names of tools to leave out of this request
            body["tools"] = {name: False for name in without}
        try:
            self._open(f"/session/{sid}/prompt_async", body, timeout=30).close()
        except OpenCodeError:
            sse.close()
            raise
        roles, texts, order = {}, {}, []
        deadline = time.time() + timeout

        def joined():
            return "\n\n".join(texts[i] for i in order if texts[i].strip()).strip()
        try:
            while not stop.is_set() and time.time() < deadline:
                try:
                    e = events.get(timeout=1)
                except queue.Empty:
                    continue
                if e is None:
                    raise OpenCodeError("a conexão com o opencode caiu")
                kind, p = e.get("type", ""), e.get("properties", {})
                if kind == "message.updated":
                    info = p.get("info", {})
                    if info.get("sessionID") == sid:
                        roles[info["id"]] = info.get("role")
                        if info.get("error"):
                            raise OpenCodeError(str((info["error"].get("data") or {}).get("message") or info["error"].get("name"))[:200])
                elif kind == "message.part.updated":
                    part = p.get("part", {})
                    if part.get("sessionID") == sid and part.get("type") == "text" and roles.get(part.get("messageID")) != "user":
                        if part["id"] not in texts:
                            order.append(part["id"])
                        texts[part["id"]] = part.get("text", "")
                        on_text and on_text(joined())
                elif kind == "message.part.delta" and p.get("sessionID") == sid and p.get("field") == "text" and p.get("partID") in texts:
                    texts[p["partID"]] += p.get("delta", "")
                    on_text and on_text(joined())
                elif kind in ("permission.asked", "permission.v2.asked") and p.get("sessionID") == sid:
                    self.json(f"/permission/{p['id']}/reply", {"reply": "reject"})   # nobody is there to approve it
                elif kind in ("question.asked", "question.v2.asked") and p.get("sessionID") == sid:
                    try:
                        self.json(f"/question/{p['id']}/reject", {})
                    except OpenCodeError:
                        pass
                elif kind == "session.error" and p.get("sessionID") in (sid, None):
                    err = p.get("error") or {}
                    raise OpenCodeError(str((err.get("data") or {}).get("message") or err.get("name") or "erro")[:200])
                elif kind == "session.idle" and p.get("sessionID") == sid:
                    break
            else:
                if stop.is_set():
                    self.abort(sid)
                else:
                    raise OpenCodeError("o opencode demorou demais")
        finally:
            sse.close()
        answer = joined()
        if not answer and not stop.is_set():
            try:
                for m in reversed(self.json(f"/session/{sid}/message?limit=10")):
                    words = "\n".join(pt.get("text", "") for pt in m["parts"] if pt.get("type") == "text").strip()
                    if m["info"].get("role") == "assistant" and words:
                        return words, sid
            except OpenCodeError:
                pass
        return answer, sid
