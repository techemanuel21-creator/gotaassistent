"""Routines (things Gota does by itself at a time of day) and background tasks. Each run is an unattended session of the opencode agent: READ-ONLY, because nobody is there
to approve anything (every permission request is refused). The result arrives as a Windows notification and in the task list of the window."""
import threading, time
from gota_native import oc as oc_mod
from datetime import datetime

REPEATS = ("daily", "weekdays", "weekly", "hourly")
UNATTENDED = ("Você está executando uma TAREFA AUTOMÁTICA em segundo plano, sem ninguém para aprovar ações. Faça apenas leitura e análise: não altere arquivos, não rode comandos que mudem o "
              "computador e não envie mensagens. Use as ferramentas do Gota (tela, WhatsApp, Outlook, base de conhecimento) para ler o que for preciso. Termine com um resumo curto do "
              "resultado, em português do Brasil, sem markdown pesado.")


class Routines:
    def __init__(self, native):
        self.native = native
        self.tasks = []   # newest first: {"id", "name", "goal", "started", "ended", "status": running|done|error, "result"}
        self._next = 1
        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    # ------------------------------------------------------------------ the routines
    def items(self):
        return list(self.native.settings.get("routines") or [])

    def _save(self, items):
        self.native.settings.set("routines", items)

    def add(self, name, goal, when="08:00", repeat="daily"):
        if not goal.strip() or not __import__("re").fullmatch(r"\d{1,2}:\d{2}", str(when)):
            raise ValueError("preencha o que fazer e o horário (HH:MM)")
        items = self.items()
        r = {"id": max([i["id"] for i in items] + [0]) + 1, "name": name or goal[:40], "goal": goal, "when": when, "repeat": repeat if repeat in REPEATS else "daily", "last": 0}
        self._save(items + [r])
        return r

    def delete(self, rid):
        self._save([i for i in self.items() if i["id"] != rid])

    @staticmethod
    def due(r, now):
        """True when the routine's time has come today (or this hour) and it has not run since."""
        hh, mm = (int(x) for x in r["when"].split(":"))
        last = datetime.fromtimestamp(r["last"]) if r.get("last") else None
        if r["repeat"] == "hourly":
            return now.minute >= mm and (last is None or (now - last).total_seconds() > 3300)
        if r["repeat"] == "weekdays" and now.weekday() >= 5:
            return False
        if r["repeat"] == "weekly" and last is not None and (now - last).days < 6:
            return False
        scheduled = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        return now >= scheduled and (last is None or last < scheduled) and (now - scheduled).total_seconds() < 6 * 3600   # not a day-old miss

    def _loop(self):
        while not self._stop.wait(30):
            try:
                now = datetime.now()
                for r in self.items():
                    if self.due(r, now) and self.native.connection:
                        self._mark(r["id"])
                        self.start_task(f"Rotina: {r['name']}", r["goal"])
            except Exception:
                pass

    def _mark(self, rid):
        items = self.items()
        for i in items:
            if i["id"] == rid:
                i["last"] = time.time()
        self._save(items)

    def run_now(self, rid):
        r = next((i for i in self.items() if i["id"] == rid), None)
        if r is None:
            raise ValueError("rotina não encontrada")
        return self.start_task(f"Rotina: {r['name']}", r["goal"])

    def connection_ready(self):
        pass

    # ------------------------------------------------------------------ background tasks
    def start_task(self, name, goal):
        task = {"id": self._next, "name": name, "goal": goal, "started": time.time(), "ended": None, "status": "running", "result": ""}
        self._next += 1
        self.tasks.insert(0, task)
        del self.tasks[40:]
        self.native.emit({"type": "task", "task": task})

        def work():
            try:
                answer, _ = self.native.oc().ask(goal, system=UNATTENDED, timeout=600, without=oc_mod.Client.CODING_TOOLS)
                task.update(status="done", result=answer or "(sem resposta)")
            except Exception as e:
                task.update(status="error", result=str(e))
            task["ended"] = time.time()
            self.native.emit({"type": "task", "task": task})
            self.native.toast(name, task["result"][:240])
        threading.Thread(target=work, daemon=True).start()
        return task
