import { lazy, Suspense } from "solid-js"
import { Loader } from "@opencode/ui/loader"
import { FileViewer, type FileViewerProps } from "../file/contract"
import { bindExtension, type Setup } from "../sdk"
import type DocumentText from "./index"

/** HWPX is a zip archive; HWP 5.0 and the 97-2003 Office formats are Compound Files. */
const signatures = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
]

const View = lazy(() => import("./view"))

const setup: Setup<typeof DocumentText> = (ctx) => {
  ctx.add(FileViewer, {
    kinds: ["hangul", "legacy-office"],
    // Bytes in neither container fail here, before the converter loads.
    problem: (bytes) =>
      signatures.some((signature) => signature.every((byte, index) => bytes[index] === byte))
        ? undefined
        : ctx.t("problem.format"),
    View: bindExtension((props: FileViewerProps) => (
      <Suspense
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center">
            <Loader />
          </div>
        }
      >
        <View {...props} />
      </Suspense>
    )),
  })
}

export default setup
