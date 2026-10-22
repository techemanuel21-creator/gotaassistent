import { type ComponentProps } from "solid-js"
import cat from "../assets/gota-cat.png"
import { GotaCat } from "./gota-cat"

// Gota identity: the butler cat replaces opencode's pixel "o" mark, and the wordmark spells Gota.
export const Mark = (props: { class?: string }) => {
  return <GotaCat class={props.class} name="anim_cat_idle" />
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <image href={cat} x="0" y="10" width="80" height="80" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <image href={cat} x="0" y="0" width="42" height="42" />
      <text
        x="52"
        y="31"
        font-family="Segoe UI, Inter, sans-serif"
        font-size="25"
        font-weight="700"
        letter-spacing="1"
        fill="var(--icon-strong-base)"
      >
        GotaAssistent
      </text>
    </svg>
  )
}
