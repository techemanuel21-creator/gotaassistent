import { type ComponentProps } from "solid-js"
import { GotaCat } from "../../components/gota-cat"

// Gota identity: the animated butler cat above the name, in place of opencode's pixel wordmark.
export function WordmarkV2(props: Pick<ComponentProps<"div">, "class">) {
  return (
    <div
      classList={{ [props.class ?? ""]: !!props.class }}
      style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "10px" }}
    >
      <GotaCat class="size-44" name="anim_cat_idle" />
      <span
        style={{
          "font-family": "Segoe UI, Inter, sans-serif",
          "font-size": "40px",
          "font-weight": "700",
          "letter-spacing": "0.1em",
          "line-height": "1",
          opacity: "0.6",
        }}
      >
        GotaAssistent
      </span>
    </div>
  )
}
