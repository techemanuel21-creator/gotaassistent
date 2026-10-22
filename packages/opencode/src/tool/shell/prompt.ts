import { Schema } from "effect"
import DESCRIPTION from "./shell.txt"
import { PositiveInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { ShellID } from "./id"

const PS = new Set(["powershell", "pwsh"])
const CMD = new Set(["cmd"])

export type Limits = {
  maxLines: number
  maxBytes: number
}

export function parameterSchema() {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to execute" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "Optional timeout in milliseconds" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
  })
}

export const Parameters = parameterSchema()
export type Parameters = Schema.Schema.Type<typeof Parameters>

function renderPrompt(template: string, values: Record<string, string>) {
  return template.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Missing shell prompt value: ${key}`)
    return value
  })
}

function shellDisplayName(name: string) {
  if (name === "pwsh") return "PowerShell (7+)"
  if (name === "powershell") return "Windows PowerShell (5.1)"
  if (name === "cmd") return "cmd.exe"
  return name
}

function powershellNotes(name: string) {
  const chain = name === "pwsh" ? "Supports `&&` and `||`." : "Chain dependent commands with `cmd1; if ($?) { cmd2 }` (no `&&`)."
  return `# ${shellDisplayName(name)} notes\n- ${chain} Double quotes interpolate, single quotes are verbatim. Prefer full cmdlet names over aliases. Call executables with spaces in the path as \`& "path" args\`; escape with the backtick.`
}

function chainGuidance(name: string) {
  if (name === "powershell") return "Dependent commands: `cmd1; if ($?) { cmd2 }` ('&&' does not exist in Windows PowerShell 5.1)."
  if (CMD.has(name)) return "Dependent commands: chain with `&&` in a single call."
  return "Dependent commands: chain with '&&' in a single call (e.g. mkdir before cp, git add before git commit)."
}

function bashCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return `Rules:
- Quote paths with spaces. Before creating files or directories, check that the parent exists.
- Default timeout ${defaultTimeoutMs}ms. Output over ${limits.maxLines} lines or ${limits.maxBytes} bytes is truncated and saved to a file: read it with Read offset/limit or Grep; do not add head/tail.
- Prefer the dedicated tools over shell: Glob (not find/ls), Grep (not grep/rg), Read (not cat/head/tail), Edit (not sed/awk), Write (not echo >), plain text for messages (not echo).
- Independent commands: several shell calls in one message. ${chain} Use ';' only when later commands should run regardless. No newlines between commands.
- Do not use \`cd dir && cmd\`: use the \`workdir\` parameter.`
}

function powershellCommandSection(
  name: string,
  chain: string,
  pathSep: string,
  limits: Limits,
  defaultTimeoutMs: number,
) {
  return `${powershellNotes(name)}

Rules:
- Quote paths with spaces. Before creating files or directories, check the parent with \`Test-Path -LiteralPath\` (paths use \`${pathSep}\`).
- Default timeout ${defaultTimeoutMs}ms. Output over ${limits.maxLines} lines or ${limits.maxBytes} bytes is truncated and saved to a file: read it with Read offset/limit or Grep; do not add Select-Object -First/-Last.
- Prefer the dedicated tools over shell: Glob (not Get-ChildItem), Grep (not Select-String), Read (not Get-Content), Edit (not Set-Content), Write (not Out-File/here-strings), plain text for messages (not Write-Host).
- Independent commands: several shell calls in one message. ${chain} Use \`;\` only when later commands should run regardless. No newlines between commands.
- Do not change directory inside the command: use the \`workdir\` parameter.`
}

function cmdCommandSection(chain: string, limits: Limits, defaultTimeoutMs: number) {
  return `# cmd.exe notes
- Quote paths with spaces; %VAR% for variables; \`if exist\` for checks; \`call\` for batch files.

Rules:
- Before creating files or directories, check the parent exists (\`if exist\`).
- Default timeout ${defaultTimeoutMs}ms. Output over ${limits.maxLines} lines or ${limits.maxBytes} bytes is truncated and saved to a file: read it with Read offset/limit or Grep; do not add more.
- Prefer the dedicated tools over shell: Glob (not dir /s), Grep (not findstr), Read (not type), Edit, Write (not echo >), plain text for messages.
- Independent commands: several shell calls in one message. ${chain} Use \`&\` only when later commands should run regardless.
- Do not change directory inside the command: use the \`workdir\` parameter.`
}

function profile(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const isPowerShell = PS.has(name)
  const chain = chainGuidance(name)
  if (CMD.has(name)) {
    return {
      intro: `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: cmdCommandSection(chain, limits, defaultTimeoutMs),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using a temporary body file so cmd.exe quoting stays simple.",
      createPrExample: `(\n  echo ## Summary\n  echo - ^<1-3 bullet points^>\n) > pr-body.txt\ngh pr create --title "the pr title" --body-file pr-body.txt`,
    }
  }
  if (isPowerShell) {
    return {
      intro: `Executes a given ${shellDisplayName(name)} command with optional timeout, ensuring proper handling and security measures.`,
      workdirSection:
        "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID changing directories inside the command - use `workdir` instead.",
      commandSection: powershellCommandSection(
        name,
        chain,
        platform === "win32" ? "\\" : "/",
        limits,
        defaultTimeoutMs,
      ),
      gitCommands: "git commands",
      gitCommandRestriction: "git commands",
      createPrInstruction: "Create PR using gh pr create with a PowerShell here-string to pass the body correctly.",
      createPrExample: `gh pr create --title "the pr title" --body @'
## Summary
- <1-3 bullet points>
'@`,
    }
  }
  return {
    intro:
      "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.",
    workdirSection:
      "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.",
    commandSection: bashCommandSection(chain, limits, defaultTimeoutMs),
    gitCommands: "bash commands",
    gitCommandRestriction: "git bash commands",
    createPrInstruction:
      "Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.",
    createPrExample: `gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>`,
  }
}

export function render(name: string, platform: NodeJS.Platform, limits: Limits, defaultTimeoutMs: number) {
  const selected = profile(name, platform, limits, defaultTimeoutMs)
  return {
    description: renderPrompt(DESCRIPTION, {
      intro: selected.intro,
      os: platform,
      shell: name,
      tmp: Global.Path.tmp,
      workdirSection: selected.workdirSection,
      commandSection: selected.commandSection,
      gitCommands: selected.gitCommands,
      toolName: ShellID.ToolID,
      gitCommandRestriction: selected.gitCommandRestriction,
      createPrInstruction: selected.createPrInstruction,
      createPrExample: selected.createPrExample,
    }),
    parameters: parameterSchema(),
  }
}

export * as ShellPrompt from "./prompt"
