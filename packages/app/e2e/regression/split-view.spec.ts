import { expect, test } from "@playwright/test"
import { expectPath, sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const a = { id: "ses_split_a", title: "Split A session" }

const b = { id: "ses_split_b", title: "Split B session" }

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } })

test("opens a tab's session beside the routed one, keeps the split across a reload, and closes it", async ({
  page,
}) => {
  await mockWorkspace(page, { name: "Split", sessions: [a, b], seed: { tabs: [a.id, b.id] } })
  await page.goto(sessionHref(a.id))
  await expectSessionTitle(page, a.title)

  const tab = page.locator("[data-titlebar-tab-slot]").filter({ hasText: b.title })
  await tab.locator("[data-titlebar-tab-link]").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Open in split view" }).click()

  // The routed session keeps the main pane; the second pane shows the tab's session with its own composer.
  const pane = page.locator('[data-component="session-split-pane"]')
  await expect(pane.getByRole("heading", { name: b.title })).toBeVisible()
  await expect(pane.locator('[data-component="composer-editor"]')).toHaveCount(1)
  await expectPath(page, sessionHref(a.id))
  await expect(page.getByRole("heading", { name: a.title })).toBeVisible()

  await page.reload()
  await expect(pane.getByRole("heading", { name: b.title })).toBeVisible()

  await pane.getByRole("button", { name: "Close split view" }).click()
  await expect(pane).toHaveCount(0)
  await expectSessionTitle(page, a.title)
})

test("hides the split on narrow windows and shows it again once there is room", async ({ page }) => {
  await mockWorkspace(page, { name: "Split", sessions: [a, b], seed: { tabs: [a.id, b.id] } })
  await page.goto(sessionHref(a.id))
  await expectSessionTitle(page, a.title)

  const tab = page.locator("[data-titlebar-tab-slot]").filter({ hasText: b.title })
  await tab.locator("[data-titlebar-tab-link]").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Open in split view" }).click()

  const pane = page.locator('[data-component="session-split-pane"]')
  await expect(pane.getByRole("heading", { name: b.title })).toBeVisible()

  await page.setViewportSize({ width: 900, height: 900 })
  await expect(pane).toHaveCount(0)
  await expectSessionTitle(page, a.title)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(pane.getByRole("heading", { name: b.title })).toBeVisible()
})
