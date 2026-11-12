import { test } from "@playwright/test";
import { expectCanonPillsCentred } from "./canon-pill-look.ts";

/**
 * 🔴 Die Kanon-Pille am Telefon: dieselbe Regel wie am Rechner (Betreiber 2026-10-04). Läuft im Profil „telefon“ (Chromium, Pixel 7,
 * Pixeldichte 2,625) und im Profil „iphone“ (WebKit, iPhone 15, Pixeldichte 3); beide sind fein genug für die Toleranz von 0,5 px.
 */

test("🔴 Kanon-Pille am Telefon: fett nur das Kanonwort, exakt mittig, 18 px", async ({ page }) => {
    test.setTimeout(180_000);
    await expectCanonPillsCentred(page);
});
