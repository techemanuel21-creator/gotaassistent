// The floating popup of GotaAssistent (call and quick question). It talks to the native Gota service (python/gota_native) directly: events in, call start/stop out.
const query = new URLSearchParams(location.search)
const NATIVE = { url: query.get("url"), token: query.get("token") }
const FRAMES = "../../../ui/src/assets/gota-cat/"

const cat = document.getElementById("cat")
const bubble = document.getElementById("bubble")
const answer = document.getElementById("answer")
const heard = document.getElementById("heard")
const hangup = document.getElementById("hangup")

let mode = query.get("mode") || "quick"
let source
let timer
let hideTimer
let animation = ""
let ended = false

function play(name) {
  if (name === animation) return
  animation = name
  clearTimeout(timer)
  const sequence = ANIMATIONS[name] || ANIMATIONS.anim_cat_idle
  const step = (index) => {
    cat.src = FRAMES + sequence[index][0] + ".png"
    timer = setTimeout(() => step((index + 1) % sequence.length), sequence[index][1])
  }
  step(0)
}

const phone = (cat, call) => (mode === "call" ? call : cat)

function say(text, options = {}) {
  answer.className = options.dim ? "dim" : ""
  if (options.dots) answer.innerHTML = `${text}<span class="dots"></span>`
  else answer.textContent = text
  fit()
}

function fit() {
  // the window follows the content, glued to the bottom: the bubble grows upwards
  requestAnimationFrame(() => window.overlay?.resize(Math.ceil(document.getElementById("stage").getBoundingClientRect().height) + 4))
}

function native(path, body) {
  return fetch(NATIVE.url + path, { method: "POST", headers: { "X-Gota-Token": NATIVE.token, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => undefined)
}

function finish(delay) {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => window.overlay?.hide(), delay)
}

function handle(event) {
  if (event.type !== "call" || ended) return
  switch (event.state) {
    case "starting":
      play(phone("anim_cat_idle", "anim_phone_idle"))
      say(mode === "call" ? "Ligando" : "Pode falar", { dots: true, dim: true })
      break
    case "listening":
      play(phone("anim_cat_listen", "anim_phone_listen"))
      if (event.partial) say(event.partial, { dim: true })
      else say(mode === "call" ? "Estou ouvindo" : "Pode falar", { dots: true, dim: true })
      break
    case "heard":
      heard.style.display = "block"
      heard.textContent = "“" + event.you + "”"
      break
    case "thinking":
      play(phone("anim_cat_read", "anim_phone_think"))
      say("Pensando", { dots: true, dim: true })
      break
    case "drafting":
      play(phone("anim_cat_talk", "anim_phone_talk"))
      say(event.draft)
      break
    case "reply":
      say(event.reply)
      break
    case "speaking":
      play(phone("anim_cat_talk", "anim_phone_talk"))
      break
    case "error":
      say(event.message || "Algo deu errado", { dim: true })
      break
    case "ended":
      ended = true
      play(phone("anim_cat_idle", "anim_phone_idle"))
      finish(mode === "quick" ? 1800 : 600)
      break
  }
}

function start(nextMode) {
  mode = nextMode
  ended = false
  animation = ""
  heard.style.display = "none"
  heard.textContent = ""
  hangup.parentElement.style.display = mode === "call" ? "flex" : "none"
  clearTimeout(hideTimer)
  play(phone("anim_cat_idle", "anim_phone_idle"))
  say(mode === "call" ? "Ligando" : "Pode falar", { dots: true, dim: true })
  source?.close()
  source = new EventSource(`${NATIVE.url}/events?token=${encodeURIComponent(NATIVE.token)}`)
  source.onmessage = (message) => {
    try {
      handle(JSON.parse(message.data))
    } catch {}
  }
  void native("/call/start", { oneShot: mode === "quick" })
}

function stop() {
  ended = true
  void native("/call/stop")
  source?.close()
  window.overlay?.hide()
}

hangup.addEventListener("click", stop)
cat.addEventListener("click", () => mode === "quick" && stop())
bubble.addEventListener("click", () => mode === "quick" && stop())
window.overlay?.on("restart", (data) => start(data.mode))
window.overlay?.on("hangup", stop)
start(mode)
