"""The voice call: Gota listens (microphone -> text, offline), the agent of opencode thinks, and Gota answers aloud sentence by sentence while it is still being written.
The window animates the cat from the states this emits: starting, listening, thinking, speaking, ended."""
import re, threading, time
from gota_native import oc as oc_mod

GOODBYE = re.compile(r"\b(tchau|encerrar|encerra a ligacao|desligar|desliga|ate logo|pode desligar|era so isso)\b")


def _norm(text):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def _similar(heard, spoken):
    """True when what the microphone heard is (a garbled) part of what Gota itself just said through the speakers."""
    import difflib
    a, b = _norm(heard), _norm(spoken)
    if not a or not b:
        return False
    if a in b:
        return True
    return max((difflib.SequenceMatcher(None, a, _norm(chunk)).ratio() for chunk in re.split(r"[.!?]\s*", spoken) if chunk.strip()), default=0.0) >= 0.55


class ShortFeeder:
    """Speaks a reply sentence by sentence while it is written, but never more than `limit` sentences (and `max_chars` characters): a phone call is not a reading of the whole answer.
    The rest stays on the screen."""

    def __init__(self, speaker, limit=3, max_chars=340):
        self.speaker, self.limit, self.max_chars = speaker, limit, max_chars
        self.done, self.count, self.chars = 0, 0, 0
        self.said = []
        self.end = re.compile(r'[.!?…]["”)]*\s')

    def _say(self, chunk):
        chunk = chunk.strip()
        if chunk and self.count < self.limit and self.chars < self.max_chars:
            self.count += 1
            self.chars += len(chunk)
            self.said.append(chunk)
            self.speaker.speak(chunk)

    def feed(self, text):
        from gota import voice
        s = voice.speakable(text)
        while True:
            m = self.end.search(s, self.done)
            if not m:
                return
            chunk, self.done = s[self.done:m.end()], m.end()
            self._say(chunk)

    def finish(self, text, done):
        from gota import voice
        s = voice.speakable(text)
        rest = s[self.done:]
        self.done = len(s)
        for part in re.split(r'(?<=[.!?…])\s+', rest.strip()) if rest.strip() else []:
            self._say(part)
        self.speaker.after(done)


def greeting(who):
    """What Gota says when it picks up: the same text is rendered ahead of time (see NativeService.warm), so the voice starts at once."""
    return f"Pois não, {who.address()}. Pode falar."


class Call:
    def __init__(self, native, one_shot=False):
        self.native, self.one_shot = native, one_shot
        self.stopped = threading.Event()
        self.injected = []
        self.session = None
        self.recent = ""   # what Gota said last: the microphone must not take it for the owner's voice
        self.thread = None
        self.state = "idle"

    # ------------------------------------------------------------------ control
    def start(self):
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stopped.set()
        n = self.native
        n.listener.cancel.set()
        try:
            n.speaker().stop()
        except Exception:
            pass

    def say(self, text):
        """Text typed (or heard elsewhere) as if the owner had said it: answered like speech."""
        self.injected.append(text)
        self.native.listener.cancel.set()

    def _state(self, state, **extra):
        self.state = state
        self.native.emit({"type": "call", "state": state, **extra})

    # ------------------------------------------------------------------ the conversation
    def _system(self):
        who = self.native.profile()
        return (f"Você está em uma LIGAÇÃO POR VOZ com {who.address()}. Responda como quem fala ao telefone: NO MÁXIMO DUAS FRASES CURTAS (menos de 30 palavras no total), em português do Brasil, sem markdown, "
                "sem listas, sem símbolos e sem código. Vá direto ao ponto, sem introdução. Se o assunto pedir comandos, código ou tabelas, diga em uma frase que deixou o detalhe na tela e escreva-o na resposta mesmo assim. "
                f"Trate-o por \"{who.address()}\". Use as ferramentas do Gota (telas, WhatsApp, Outlook, base de conhecimento) quando o pedido pedir. "
                "Você PODE e DEVE agir direto quando ele pedir, sem pedir confirmação: abrir aplicativos (gota_app_open), enviar mensagem de WhatsApp (gota_whatsapp_send, em primeira pessoa, "
                "pelo apelido do contato se houver), ler a tela, ver e-mails e agenda. Depois diga em uma frase o que fez. Comandos do sistema e edição de arquivos não estão disponíveis na ligação.")

    def _heard(self):
        n = self.native
        if self.injected:
            return self.injected.pop(0)
        n.listener.cancel.clear()
        heard = n.listener.listen(on_partial=lambda t: n.emit({"type": "call", "state": "listening", "partial": t}), silence=1.6, timeout=10.0,
                                  on_level=lambda p: None)
        if heard and _similar(heard, self.recent[-600:]):   # its own voice coming back through the speakers
            return ""
        return heard

    def _speak_and_wait(self, text):
        done = threading.Event()
        self.recent += " " + text
        self.native.speaker().speak(text, done.set)
        done.wait(90)
        time.sleep(1.0)

    def _run(self):
        n = self.native
        try:
            self._state("starting")
            sp = n.speaker()
            sp.on_state = lambda on: n.emit({"type": "call", "state": "speaking" if on else self.state, "speaking": bool(on)})
            n.listener.preload()
            who = n.profile()
            if not self.one_shot:
                self._state("speaking")
                self._speak_and_wait(greeting(who))
            silent = 0
            while not self.stopped.is_set():
                self._state("listening")
                try:
                    text = self._heard()
                except Exception as e:
                    n.emit({"type": "call", "state": "error", "message": str(e)})
                    self._speak_and_wait("Perdão, não consegui usar o microfone.")
                    break
                if self.stopped.is_set():
                    break
                if not text:
                    silent += 1
                    if self.one_shot or silent >= 6:
                        break
                    continue
                silent = 0
                n.emit({"type": "call", "state": "heard", "you": text})
                if GOODBYE.search(_norm(text)):
                    self._state("speaking")
                    self._speak_and_wait(f"Até logo, {who.address()}.")
                    break
                self._state("thinking")
                feeder = ShortFeeder(n.speaker())
                last = [0.0]

                def on_text(draft):
                    feeder.feed(draft)
                    if time.time() - last[0] > 0.2:   # the popup shows the answer growing, a few times a second
                        last[0] = time.time()
                        n.emit({"type": "call", "state": "drafting", "draft": draft})
                try:
                    answer, self.session = n.oc().ask(text, session=self.session, system=self._system(), on_text=on_text, stop=self.stopped, timeout=180, without=oc_mod.Client.NO_TOOLS, source="call")
                except Exception as e:
                    n.emit({"type": "call", "state": "error", "message": str(e)})
                    self._state("speaking")
                    self._speak_and_wait(f"Perdão, {who.address()}, não consegui falar com o modelo. Confira a conexão em Modelos de IA.")
                    if self.one_shot:
                        break
                    continue
                if self.stopped.is_set():
                    break
                n.emit({"type": "call", "state": "reply", "reply": answer})
                self._state("speaking")
                done = threading.Event()
                feeder.finish(answer, done.set)
                done.wait(120)
                self.recent = " ".join(feeder.said)
                time.sleep(1.0)
                if self.one_shot:
                    break
        finally:
            try:
                n.speaker().stop()
            except Exception:
                pass
            self._state("ended")
            n.call_finished(self)
