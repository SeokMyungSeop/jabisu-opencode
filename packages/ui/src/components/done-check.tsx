import { createSignal, onMount } from "solid-js"
import { useSpring } from "./motion-spring"
import "./done-check.css"

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The check of a finished piece of work. With `greet` it draws its line and settles with a small bounce
 * (0.9 → about 1.04 → 1), once, within --motion-done; otherwise, and with reduced motion, it is simply there.
 */
export function DoneCheck(props: { greet?: boolean; class?: string }) {
  const lively = () => !!props.greet && !reduced()
  const [settled, setSettled] = createSignal(!lively())
  const scale = useSpring(() => (settled() ? 1 : 0.9), { visualDuration: 0.3, bounce: 0.4 })

  onMount(() => setSettled(true))

  return (
    <svg
      data-component="done-check"
      data-greet={lively() ? "" : undefined}
      class={props.class}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      style={{ transform: lively() ? `scale(${scale()})` : undefined }}
    >
      <path
        d="M3.5 8.6 6.6 11.6 12.6 4.9"
        pathLength="1"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// The one lively motion 자비수 allows: a finished piece of work is greeted once. A window nobody is looking at is
// skipped, since the work notification speaks for it, and several things finishing together are greeted as one.

const QUIET_MS = 1000

let last = 0

/** Whether a completion may be greeted now. Answering true takes the turn, so ask once per completion. */
export function doneMoment(now = Date.now(), visible = () => document.visibilityState === "visible") {
  if (!visible()) return false

  if (now - last < QUIET_MS) return false
  last = now

  return true
}

/** For tests: forget the last greeting. */
export function resetDoneMoment() {
  last = 0
}
