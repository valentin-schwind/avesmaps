import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn } from "./welt.ts";

/**
 * Release-Tor, Kernabläufe 6, 7 und 20: Anmeldung und Systemsteuerung, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`).
 * Kein `page.route` auf `/api`: Die Sitzung kommt aus dem Cookie einer Person der Tor-Welt (`welt.ts`, `tor-welt.ts`), das Recht aus
 * der Rolle in der Datenbank des Laufs.
 *
 * Was die Fachspecs im Detail prüfen (Abstände, Reihenfolge der Einträge, jede Pille), gehört nicht hierher: Das Tor soll nur fallen,
 * wenn eine Kernfunktion fehlt.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

test.describe("Tor: Anmeldung und Systemsteuerung", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    test("6 als Editor angemeldet steht die Editor-Leiste da", async ({ page }) => {
        const beob = beobachte(page);
        await meldeAn(page);
        await openMap(page, EDITOR_MODE);
        // Der echte Server kennt die Person: Name, Rolle und das Recht, das den Editor öffnet. 🪤 Gefragt über den Kontext der Seite (dasselbe
        // Cookie), nicht über die Antwort, die die Seite beim Laden holte: Navigiert sie danach weiter, ist deren Körper nicht mehr lesbar
        // (Release-Test 9d259853dc8e, 2026-10-31: „Response body is not available for a response that was navigated away from“).
        const sitzung = await page.request.get("/api/auth/session");
        expect(sitzung.status(), await sitzung.text()).toBe(200);
        const koerper = (await sitzung.json()) as {
            person: { displayName: string; role: string } | null;
            capabilities: string[];
        };
        expect(koerper.person?.displayName).toBe("Tor-Editor");
        expect(koerper.person?.role).toBe("editor");
        expect(koerper.capabilities).toContain("use_editor_menu");

        const leiste = page.getByTestId("kopfleiste");
        await expect(leiste).toBeVisible();
        await expect(leiste).toContainText("Tor-Editor");
        await expect(page.getByTestId("kopfleiste-umgebung")).toHaveText("LOKAL · Entwicklung");
        // Angemeldet geht kein Anmeldefenster von selbst auf; das Editorpanel steht da.
        await expect(page.getByRole("dialog", { name: "Anmelden" })).toHaveCount(0);
        await expect(page.getByTestId("editor-panel")).toBeVisible({ timeout: 30_000 });
        expect(beob.fehler).toEqual([]);
    });

    test("7 ohne Anmeldung bleibt alles lesend", async ({ page, request }) => {
        const beob = beobachte(page);
        await openMap(page, EDITOR_MODE);
        // Der Editor-Modus ohne Sitzung zeigt das Anmeldefenster, aber keine Werkzeuge.
        await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible({ timeout: 30_000 });
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("editor-panel")).toHaveCount(0);
        await expect(page.getByTestId("kopfleiste")).not.toContainText("Tor-Editor");
        // Die öffentliche Karte kennt gar keine Editor-Leiste.
        await openMap(page);
        await expect(page.getByTestId("editor-panel")).toHaveCount(0);
        await expect(page.getByTestId("kopfleiste")).toHaveCount(0);

        // Der Server verweigert das Schreiben jedem, der keine Sitzung hat: ohne Cookie weder Lesen noch Schreiben der Editorroute.
        const herkunft = new URL(page.url()).origin;
        const schreiben = await request.post("/api/editor/places", {
            headers: { origin: herkunft },
            data: { operationId: randomUUID(), name: `Tor-Ohne-Sitzung ${String(Date.now())}`, subtype: "dorf" },
        });
        expect([401, 403], `POST /api/editor/places ohne Cookie: ${await schreiben.text()}`).toContain(
            schreiben.status(),
        );
        const lesen = await request.get("/api/editor/places");
        expect([401, 403], `GET /api/editor/places ohne Cookie: ${await lesen.text()}`).toContain(lesen.status());
        expect(beob.fehler).toEqual([]);
    });

    test("20 die Systemsteuerung öffnet, der Zustand lädt", async ({ page }) => {
        test.setTimeout(180_000);
        const beob = beobachte(page);
        await meldeAn(page, "admin");
        await openMap(page, EDITOR_MODE);
        await page.getByTestId("kopfleiste-menue").click();
        await page.getByTestId("menue-systemsteuerung").click();
        await expect(page.getByRole("dialog", { name: "Systemsteuerung" })).toBeVisible();
        const [zustand] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith("/api/admin/system/health") && r.request().method() === "GET",
                { timeout: 60_000 },
            ),
            page.getByTestId("verwaltung-eintrag-systemzustand").click(),
        ]);
        // Der echte Server antwortet mit dem Zustand der Bausteine (ohne Statusdatei von Claudio sind manche „unbekannt“, das ist ein Zustand).
        expect(zustand.status(), await zustand.text()).toBe(200);
        const stand = (await zustand.json()) as { komponenten: { id: string; zustand: string }[] };
        expect(stand.komponenten.map((k) => k.id)).toEqual(expect.arrayContaining(["fastify", "postgresql"]));
        await expect(page.getByTestId("systemzustand-komponenten")).toBeVisible();
        await expect(page.getByTestId("systemzustand-fastify")).toBeVisible();
        await expect(page.getByTestId("systemzustand-postgresql")).toBeVisible();
        expect(beob.fehler).toEqual([]);
    });
});
