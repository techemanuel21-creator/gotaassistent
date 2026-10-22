import { createEffect, onCleanup } from "solid-js"
import { createSignal } from "solid-js"
import animations from "../assets/gota-cat/animations.json"

// The Gota cat, animated exactly like the desktop Gota: each animation is a list of [frame, milliseconds].
const frames = import.meta.glob("../assets/gota-cat/*.png", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>

export type GotaCatAnimation = keyof typeof animations

const sequences = animations as Record<GotaCatAnimation, [string, number][]>

export const GotaCat = (props: { name?: GotaCatAnimation; class?: string }) => {
  const [frame, setFrame] = createSignal("cat_idle")

  createEffect(() => {
    const sequence = sequences[props.name ?? "anim_cat_idle"]
    let timer: ReturnType<typeof setTimeout> | undefined
    const play = (index: number) => {
      setFrame(sequence[index][0])
      timer = setTimeout(() => play((index + 1) % sequence.length), sequence[index][1])
    }
    play(0)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <img
      data-component="gota-cat"
      classList={{ [props.class ?? ""]: !!props.class }}
      src={frames[`../assets/gota-cat/${frame()}.png`]}
      alt="Gota"
      draggable={false}
      style={{ "object-fit": "contain", "aspect-ratio": "1 / 1" }}
    />
  )
}
