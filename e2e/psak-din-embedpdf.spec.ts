import { test, expect, Page } from "@playwright/test";

/* ─── Helpers ─── */

async function goHome(page: Page) {
  await page.goto("/");
  await page.waitForSelector("[data-active-tab]", { timeout: 15_000 });
}

async function openPsakeiDinTab(page: Page) {
  // Scope to the top <nav> to avoid matching sidebar buttons like "חיפוש פסקי דין"
  const btn = page.getByRole("navigation").getByRole("button", { name: "פסקי דין", exact: true });
  await btn.waitFor({ state: "attached", timeout: 10_000 });
  await btn.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    el.click();
  });
  await page.waitForSelector("text=פסקי דין", { timeout: 10_000 });
}

async function openFirstPsak(page: Page) {
  const firstPsak = page.locator("button:has-text('פתח')").first();
  if (await firstPsak.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await firstPsak.click();
  } else {
    await page.locator("[class*='cursor-pointer']").first().click();
  }
}

/* ─── Tests ─── */

test.describe("פסקי דין — צפיין אחד (EmbedPDF)", () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
  });

  test("1. לחיצה על פסק דין פותחת את הצפיין בחלון מעל הדף", async ({ page }) => {
    await openPsakeiDinTab(page);
    await openFirstPsak(page);

    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    // The dialog embeds the viewer page itself
    const frame = dialog.locator("iframe[src*='/embedpdf-viewer?']");
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("src", /embedded=1/);
    await expect(frame).toHaveAttribute("src", /psakId=/);

    // The list is still there behind the dialog — no navigation happened
    await expect(page).toHaveURL(/\/$|\/\?/);
  });

  test("2. 'עמוד מלא' עובר לעמוד הצפיין", async ({ page }) => {
    await openPsakeiDinTab(page);
    await openFirstPsak(page);

    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.getByTitle("פתח בעמוד מלא").click();

    await expect(page).toHaveURL(/\/embedpdf-viewer\?/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/embedded=1/);
  });

  test("3. 'חזור' בעמוד הצפיין חוזר לדף שממנו באנו", async ({ page }) => {
    await openPsakeiDinTab(page);
    await openFirstPsak(page);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await dialog.getByTitle("פתח בעמוד מלא").click();
    await expect(page).toHaveURL(/\/embedpdf-viewer\?/, { timeout: 10_000 });

    await page.getByTitle("חזור").click();
    await expect(page).not.toHaveURL(/\/embedpdf-viewer/, { timeout: 10_000 });
  });

  test("4. אין יותר תפריט בחירת צפיין", async ({ page }) => {
    await openPsakeiDinTab(page);
    await openFirstPsak(page);
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    await expect(dialog.getByText("צפיין רגיל")).toHaveCount(0);
    await expect(dialog.getByText("PDF מוטמע")).toHaveCount(0);
  });
});
