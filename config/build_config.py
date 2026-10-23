"""Builds the opencode configuration folder of Gota 2.0 (opencode.json, the "gota" theme and the persona) from the owner's Gota profile, and prints its path.
The official opencode (the one that may use opencode's free models) reads it through OPENCODE_CONFIG_DIR: persona, Gota abilities (MCP), permissions, theme."""
import json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = Path(os.environ.get("GOTA_HOME") or (Path(os.environ.get("APPDATA", Path.home())) / "Gota"))
OUT = Path(os.environ.get("GOTA2_CONFIG") or (HOME / "opencode-config"))

# ---------------------------------------------------------------------- persona (the voice of Gota, addressed to the owner)
def persona():
    try:
        p = json.loads((HOME / "profile.json").read_text("utf-8"))
    except Exception:
        p = {}
    name, treatment = (p.get("name") or "").strip(), p.get("treatment", "senhor")
    address = f"{treatment} {name}".strip() if treatment else (name or "senhor")
    sir = treatment or name or "senhor"
    pronoun = {"senhor": "o senhor", "senhora": "a senhora"}.get(treatment, "você")
    facts = "".join(f"- {f}\n" for f in (p.get("facts") or [])[-40:])
    calls = "".join(f"- {n}\n" for n in (p.get("call_notes") or [])[-10:])
    return f"""Você é o Gota, mordomo pessoal de {address}: um gato mordomo clássico, educado e leal que vive no computador. Apresente-se sempre como Gota.
- Português do Brasil, formal e cordial (outro idioma: responda nele). Chame o dono de "{sir}" (trate por "{pronoun}"). Ex.: "Pois não, {sir}.", "Às suas ordens."
- Rigorosamente factual. Se não souber: "Não tenho informações suficientes para responder com certeza, {sir}."
- Perguntas e conversa: só o que foi perguntado, em 1 ou 2 frases elegantes, sem conselhos nem perguntas no fim. Tarefas de programação ou do computador: o necessário.
- Ferramentas `gota_...`: para perguntas técnicas (TI, segurança, backup/Veeam, redes/Cisco, Windows, Linux) consulte antes `gota_kb_search`; WhatsApp, e-mail e agenda, tela e memória têm ferramenta própria: use-as em vez de adivinhar.
- Status curtos ("Lendo o arquivo…", "Rodando os testes…").

{"# Sobre " + address + chr(10) + facts if facts else ""}{"# Ligações recentes" + chr(10) + calls if calls else ""}"""


# ---------------------------------------------------------------------- terminal theme (Gota palette, dark; same colours in "light" so the identity never changes)
def theme():
    p = {"bg": "#0B0E1F", "panel": "#0F1328", "element": "#171C38", "hover": "#232A52", "border": "#2B3263", "muted": "#8F96C0", "faint": "#6F78A8", "text": "#E8EAF6",
         "primary": "#6F63F2", "primary2": "#8579F5", "accent": "#38BDF8", "green": "#22C58B", "green2": "#7EE0A8", "red": "#E5484D", "orange": "#FFB86B", "pink": "#FF9AC1", "blue": "#59C3FF", "violet": "#9AA5FF"}
    both = lambda k: {"dark": p[k] if k in p else k, "light": p[k] if k in p else k}
    t = {"primary": "primary2", "secondary": "primary", "accent": "accent", "error": "red", "warning": "orange", "success": "green", "info": "accent", "text": "text", "textMuted": "muted",
         "background": "bg", "backgroundPanel": "panel", "backgroundElement": "element", "border": "border", "borderActive": "primary2", "borderSubtle": "element",
         "diffContext": "faint", "diffHunkHeader": "faint", "diffHighlightAdded": "green2", "diffHighlightRemoved": "red", "diffLineNumber": "faint",
         "markdownText": "text", "markdownHeading": "primary2", "markdownLink": "accent", "markdownLinkText": "blue", "markdownCode": "green2", "markdownBlockQuote": "orange", "markdownEmph": "orange",
         "markdownStrong": "pink", "markdownHorizontalRule": "border", "markdownListItem": "primary2", "markdownListEnumeration": "accent", "markdownImage": "accent", "markdownImageText": "blue",
         "markdownCodeBlock": "text", "syntaxComment": "faint", "syntaxKeyword": "violet", "syntaxFunction": "blue", "syntaxVariable": "pink", "syntaxString": "green2", "syntaxNumber": "orange",
         "syntaxType": "orange", "syntaxOperator": "text", "syntaxPunctuation": "muted"}
    out = {k: both(v) for k, v in t.items()}
    out.update({"diffAdded": both("green2"), "diffRemoved": both("red"), "diffAddedBg": {"dark": "#0F2A24", "light": "#0F2A24"}, "diffRemovedBg": {"dark": "#2A1218", "light": "#2A1218"},
                "diffContextBg": both("panel"), "diffAddedLineNumberBg": {"dark": "#0C2320", "light": "#0C2320"}, "diffRemovedLineNumberBg": {"dark": "#220E14", "light": "#220E14"}})
    return {"$schema": "https://opencode.ai/theme.json", "theme": out}


# ---------------------------------------------------------------------- permissions: everything unknown asks, the usual development commands run, destructive ones are denied
SAFE = ["python *", "py *", "pytest *", "pip list*", "pip show*", "git status*", "git diff*", "git log*", "git add*", "git commit*", "git branch*", "git checkout*", "npm test*", "npm run *",
        "npx *", "node *", "tsc*", "bun *", "go test*", "go build*", "cargo test*", "cargo build*", "dotnet build*", "dotnet test*", "dir*", "ls*", "cat *", "type *", "echo *", "findstr *", "where *",
        "mkdir *", "pwd*", "make*", "ruff *", "black *", "eslint*", "prettier*"]
DENIED = ["rm -rf*", "rm -r *", "rmdir /s*", "rd /s*", "del /s*", "del /f*", "Remove-Item *-Recurse*", "format *", "shutdown*", "git push --force*", "git push -f*", "git reset --hard*",
          "git clean*", "reg delete*", "diskpart*", "cipher /w*", "Invoke-Expression*"]


def config():
    candidates = (ROOT / "python" / "runtime" / "python.exe", ROOT / "python" / ".venv" / "Scripts" / "python.exe", ROOT.parent / "desktop" / ".venv" / "Scripts" / "python.exe")
    python = next((p for p in candidates if p.exists()), candidates[1])
    return {
        "$schema": "https://opencode.ai/config.json",
        "theme": "gota",
        "disabled_providers": ["opencode", "opencode-go"],
        # the cheap DeepSeek model by default (the window would otherwise pick the expensive Pro one); the owner changes it in the model picker
        "model": os.environ.get("GOTA2_MODEL", "deepseek/deepseek-flash"),
        "small_model": os.environ.get("GOTA2_MODEL", "deepseek/deepseek-flash"),
        "autoupdate": False,
        "share": "disabled",
        "instructions": [str(OUT / "persona.md")],
        "mcp": {"gota": {"type": "local", "command": [str(python) if python.exists() else "python", str(ROOT / "python" / "gota_mcp" / "server.py")], "enabled": True, "timeout": 120000}},
        "permission": {"bash": dict([("*", "ask")] + [(c, "allow") for c in SAFE] + [(c, "deny") for c in DENIED]), "edit": "allow", "external_directory": "ask",
                       "gota_whatsapp_send": "ask", "gota_speak": "allow"},
    }


def main():
    (OUT / "themes").mkdir(parents=True, exist_ok=True)
    (OUT / "persona.md").write_text(persona(), "utf-8")
    (OUT / "themes" / "gota.json").write_text(json.dumps(theme(), indent=2), "utf-8")
    (OUT / "opencode.json").write_text(json.dumps(config(), indent=2, ensure_ascii=False), "utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
