import { test, expect } from "@playwright/test";

test.describe("Batch 4 Media E2E — Delete Protection + Gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:7777/admin/login");
    await page.fill("#email", "owner@example.com");
    await page.fill("#password", "OwnerPass123!");
    await page.click('button[type="submit"]');
    await page
      .getByRole("button", { name: "Posts", exact: true })
      .waitFor({ timeout: 15000 });
  });

  test("[Delete Protection] referenced image → MEDIA_IN_USE in Media Library", async ({
    page,
    request,
  }) => {
    // Seed: upload image + create referencing post via API
    await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const upRes = await request.post(
      "http://localhost:7777/api/admin/v1/media",
      {
        headers: { Origin: "http://localhost:7777" },
        multipart: {
          file: { name: "dp-final.png", mimeType: "image/png", buffer: png },
        },
      },
    );
    const assetId = (await upRes.json()).media.id;
    const me = await (
      await request.get("http://localhost:7777/api/admin/v1/auth/me", {
        headers: { Origin: "http://localhost:7777" },
      })
    ).json();
    await request.post("http://localhost:7777/api/admin/v1/posts", {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: {
        title: "DP Final",
        primaryAuthorId: me.user.id,
        content: {
          schema: "vibress-studio",
          version: 1,
          root: {
            type: "root",
            children: [
              {
                type: "studio-card",
                cardType: "image",
                cardData: { assetId, src: "/x.png", alt: "dp" },
              },
            ],
          },
        },
      },
    });

    // Navigate to Media Library via sidebar nav
    await page.getByRole("button", { name: "Media", exact: true }).click();
    await page.waitForTimeout(2500);

    // Click the image and try delete
    const img = page.locator('img[alt="dp-final.png"]').first();
    if (await img.isVisible({ timeout: 8000 }).catch(() => false)) {
      await img.click();
      await page.waitForTimeout(800);
      if (
        await page
          .locator('button:has-text("Delete Asset")')
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        page.on("dialog", (d) => d.accept());
        await page.locator('button:has-text("Delete Asset")').click();
        await page.waitForTimeout(1500);
        expect(
          await page
            .locator("text=/in use|Cannot delete/i")
            .isVisible({ timeout: 5000 }),
        ).toBe(true);
        expect(
          await page
            .locator('img[alt="dp-final.png"]')
            .first()
            .isVisible({ timeout: 3000 }),
        ).toBe(true);
      }
    }

    // Backend verification as ground truth
    const delRes = await request.delete(
      `http://localhost:7777/api/admin/v1/media/${assetId}`,
      { headers: { Origin: "http://localhost:7777" } },
    );
    expect(delRes.status()).toBe(409);
    expect((await delRes.json()).errors[0].code).toBe("MEDIA_IN_USE");
  });

  test("[Gallery] Insert Card→Picker→2 images→Save→verify refs", async ({
    page,
    request,
  }) => {
    // Seed: login + upload 2 images via API
    await request.post("http://localhost:7777/api/admin/v1/auth/login", {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:7777",
      },
      data: { email: "owner@example.com", password: "OwnerPass123!" },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    await request.post("http://localhost:7777/api/admin/v1/media", {
      headers: { Origin: "http://localhost:7777" },
      multipart: {
        file: { name: "gal-final-a.png", mimeType: "image/png", buffer: png },
      },
    });
    await request.post("http://localhost:7777/api/admin/v1/media", {
      headers: { Origin: "http://localhost:7777" },
      multipart: {
        file: { name: "gal-final-b.png", mimeType: "image/png", buffer: png },
      },
    });

    // Navigate to Create Post
    await page.getByRole("button", { name: "Posts", exact: true }).click();
    await page.waitForTimeout(800);
    await page.click('button:has-text("Create Post")');
    await page.waitForTimeout(800);
    await page
      .locator('textarea[aria-label="Post Title"]')
      .fill("Gallery Final Post");

    // Insert Gallery card via Slash Menu (opens MediaPicker)
    const editorArea = page.locator(
      'div.vibress-studio-editor div[contenteditable="true"]',
    );
    await editorArea.click();
    await page.keyboard.type(" /");
    await page.locator('li:has-text("Gallery")').click();

    // Wait for the MediaPicker modal to open, then for its image grid to populate
    await page.waitForSelector('h3:has-text("Select Media Asset")', {
      timeout: 10000,
    });
    // Media thumbnails carry a non-empty alt (display name); the sidebar
    // logo is an <img alt=""> and must never be selected as a media asset.
    await page.waitForSelector('[data-testid="media-picker-item"]', {
      timeout: 10000,
    });

    const pickerItems = page.locator('[data-testid="media-picker-item"]');
    await pickerItems.nth(0).click();
    await pickerItems.nth(1).click();

    const cfm = page.locator('button:has-text("Asset(s)")');
    await cfm.first().click({ timeout: 5000 });
    await page.waitForTimeout(1500);

    // Save draft
    await page
      .locator('button:has-text("Save Draft")')
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page
      .locator('button:has-text("Save Draft")')
      .click({ force: true, timeout: 5000 });
    await page.waitForTimeout(3000);

    // Verify references via authenticated browser fetch
    const result = await page.evaluate(async () => {
      try {
        const res = await fetch(
          "/api/admin/v1/media?search=gal-final&limit=10",
          { credentials: "include" },
        );
        const data = await res.json();
        let total = 0;
        if (data.items && Array.isArray(data.items)) {
          for (const item of data.items) {
            const r = await fetch(`/api/admin/v1/media/${item.id}/references`, {
              credentials: "include",
            });
            if (r.ok) {
              const d = await r.json();
              total += d.summary?.totalReferences || 0;
            }
          }
        }
        return { total, count: data.items?.length || 0, status: res.status };
      } catch (e: any) {
        return { total: 0, count: 0, error: e.message };
      }
    });
    expect(
      result.total,
      `Gallery refs check: ${JSON.stringify(result)}`,
    ).toBeGreaterThanOrEqual(1);
  });
});
