import { createUniqueId, For, Show, type ComponentProps } from "solid-js"

/** Whether this build is 자비수(諮備秀), the jabisu redistribution, which shows its own name where OpenCode's goes. */
export const JABISU = import.meta.env.VITE_OPENCODE_CHANNEL === "jabisu"

// "자비수" drawn on the OpenCode logo's 6-unit pixel grid, 8 cells tall, signed by its developer at the lower right.
// The view box keeps the logo's 234-unit width and centres the name with its signature.
const viewBox = "-18 0 234 48"

const glyphs = [
  "M0 0H30V6H18V18H24V30H30V36H18V24H12V36H0V30H6V18H12V6H0ZM36 0H42V18H48V24H42V48H36Z",
  "M54 0H60V12H72V0H78V36H54ZM84 0H90V48H84ZM60 18V30H72V18Z",
  "M114 0H120V6H126V12H132V18H138V24H126V18H120V12H114V18H108V24H96V18H102V12H108V6H114ZM96 30H138V36H120V48H114V36H96Z",
]

// The lower half of ㅂ's counter, shaded like the counters of o, p and d.
const shadow = "M60 24H72V30H60Z"

// The signature is set in the app's font, about a fifth of the name's height, on its baseline.
const Signature = (props: { fill?: string }) => (
  <text x="145" y="47" font-size="9" font-weight="600" fill={props.fill}>
    개발자 : 명상
  </text>
)

export const JabisuLogo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d={shadow} fill="var(--icon-weak-base)" />
      <For each={glyphs}>{(d) => <path d={d} fill="var(--icon-strong-base)" />}</For>
      <Signature fill="var(--icon-strong-base)" />
    </svg>
  )
}

/** The Wordmark's 자비수 counterpart, with the same muted, fading and outline-drawing options. */
export function JabisuWordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <For each={glyphs}>{(d) => <path pathLength={props.outline ? 1 : undefined} d={d} />}</For>
          </g>
        </g>
        {/* Outside the fade, which would hide text this low; the outline drawing has no filled text to draw. */}
        <Show when={!props.outline}>
          <g opacity={props.muted === false ? 1 : 0.16 * 0.7}>
            <Signature fill="currentColor" />
          </g>
        </Show>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="-18" y="0" width="234" height="48">
          <rect x="-18" width="234" height="48" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="99" y1="25" x2="99" y2="48" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
