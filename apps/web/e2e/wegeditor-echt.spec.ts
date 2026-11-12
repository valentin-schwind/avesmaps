import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
    OperationReceipt,
    editorPathRestoreSeriesUrl,
    type EditorPathRow,
    type EditorPathStreet,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, type Beobachtung } from "./welt.ts";
import {
    gewaehltNach,
    handgriffeAuf,
    rechtsKlick,
    umschaltKlick,
    wegeDerKarte,
    type Weg,
} from "./wegeditor-mehrfach-hilfen.ts";

/**
 * „Weg entfernen …“ an der Mehrfachauswahl gegen den ECHTEN Server in der Wegwerf-Welt (`welt.ts`), ohne Stub (WI-0252; Betreiber 2026-10-25
 * auf der Stage: „Wege-Mehrfachauswahl löschen geht noch nicht“). `wegeditor-mehrfach.spec.ts` prüft dasselbe mit Stubs; hier laufen
 * Seite, Vite-Proxy, Fastify, PostgreSQL und echte Straßen mit ihren echten Abschnitten.
 *
 * Aufruf (Welt läuft, Vite auf `E2E_PORT`, Fastify auf `PORT`):
 *     WELT_TOKEN_DATEI=<Sitzung> E2E_PORT=<Vite> PORT=<Fastify> npm run bank -- npx playwright test e2e/wegeditor-echt.spec.ts --workers=1
 *
 * Problemfälle: Der Server antwortet auf die Anfrage der Oberfläche mit 4xx oder 5xx (Schema, Revision, fehlender Abschnitt einer Straße,
 * Sperre, Rechte); die Quittung nennt nicht ALLE Abschnitte beider Wege; die Liste zeigt die Wege danach weiter auf der Karte; ↺ holt sie
 * nicht zurück.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const offen = (page: Page) => page.locator('dialog[open][data-testid^="wegeditor-"]');

/** Alle Abschnitte der Straße dieses Namens, wie der echte Server sie liest (Kennung und Revision). */
async function abschnitteVon(page: Page, name: string): Promise<{ id: string; revision: number }[]> {
    const liste = (await (await page.request.get("/api/editor/paths")).json()) as { rows: EditorPathRow[] };
    const zeile = liste.rows.find((r) => r.name === name && r.offMap !== true && r.deleted !== true);
    expect(zeile, `die Straße „${name}“ steht in der Liste des echten Servers`).toBeDefined();
    const strasse = (await (
        await page.request.get(`/api/editor/paths/${zeile!.id}/street`)
    ).json()) as EditorPathStreet;
    return strasse.segments.map((s) => ({ id: s.id, revision: s.revision }));
}

/** Das Wege-Fenster an der Stelle Gratenfels; zwei Straßen mit echtem Namen, die ein Klick dort wählt (wie `wegeditor-mehrfach.spec.ts`). */
async function oeffneMitZweiWegen(page: Page): Promise<{ a: Weg; b: Weg }> {
    await meldeAn(page);
    await openMap(page, EDITOR_MODE);
    await page.getByTestId("route-planner-tab").click();
    await editorPanelVorn(page);
    await showPlace(page, GRATENFELS_LAGE, 7);
    await settleFrame(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(offen(page)).toHaveCount(1);
    await offen(page).locator('[data-testid$="-listenschalter"]').first().click();
    await settleFrame(page);
    const gefunden: Weg[] = [];
    const versuche: string[] = [];
    // Die echte Karte ist dichter als die Probe der Stubs: bei Zoom 7 liegt nur eine Straße frei, höher rücken.
    for (const zoom of [8, 9, 10, 11]) {
        if (gefunden.length >= 2) break;
        gefunden.length = 0;
        await showPlace(page, GRATENFELS_LAGE, zoom);
        for (const weg of (await wegeDerKarte(page)).wege) {
            const bekommen = await gewaehltNach(page, weg);
            versuche.push(`z${String(zoom)} ${weg.name} → ${String(bekommen)}`);
            if (bekommen === undefined || gefunden.some((g) => `name:${g.name}` === bekommen)) continue;
            gefunden.push({ ...weg, name: bekommen.slice("name:".length) });
            if (gefunden.length === 2) break;
        }
    }
    expect(gefunden, `zwei Straßen mit echtem Namen, je an einer eigenen Stelle (${versuche.join("; ")})`).toHaveLength(
        2,
    );
    return { a: gefunden[0]!, b: gefunden[1]! };
}

/** ↺ über die Rücknahme der Wege (`restore-series`, WI-0265 B6a): EINE Operation zurück, unter einem Abschnitt, den sie berührte; die Prüfsumme der Liste rechnet der Server genauso. */
async function holeZurueck(page: Page, quittung: OperationReceipt): Promise<number> {
    const abschnitte = quittung.affected.filter((e) => e.kind === "path");
    const antwort = await page.request.post(editorPathRestoreSeriesUrl(abschnitte[0]!.id), {
        headers: { origin: new URL(page.url()).origin },
        data: {
            operationId: randomUUID(),
            members: [quittung.operationId],
            membersHash: createHash("sha256").update(quittung.operationId.toLowerCase()).digest("hex"),
        },
    });
    return antwort.status();
}

function keinFehler(beob: Beobachtung): void {
    expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
}

test.describe("Weg entfernen an der Mehrfachauswahl, echter Server (Wegwerf-Welt)", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    test("🔴 Kartenmenü: zwei angehakte Straßen, „Weg entfernen …“ › „Ganz löschen“: EINE Operation über ALLE Abschnitte, 200; ↺ holt sie zurück", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        const { a, b } = await oeffneMitZweiWegen(page);
        const erwartet = [...(await abschnitteVon(page, a.name)), ...(await abschnitteVon(page, b.name))];
        await page.waitForTimeout(500);
        expect(await gewaehltNach(page, a)).toBe(`name:${a.name}`);
        await page.waitForTimeout(500);
        await umschaltKlick(page, b);
        await expect(offen(page).locator('[data-testid$="-wege-haken"]').first()).toContainText("2 angehakt");
        await page.waitForTimeout(800);

        await rechtsKlick(page, a);
        await handgriffeAuf(page);
        await page.getByTestId("context-editor-weg-entfernen").click();
        const blatt = page.getByTestId("weg-entfernen");
        await expect(blatt).toContainText("2 Wege gewählt", { timeout: 30_000 });
        await page.getByTestId("weg-entfernen-loeschen").click();
        await expect(page.getByTestId("weg-entfernen-los")).toHaveText("2 Wege ganz löschen");

        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith("/api/editor/paths/sammel/delete") && r.request().method() === "POST",
            ),
            page.getByTestId("weg-entfernen-los").click(),
        ]);
        // Der echte Server nimmt EINE Operation über alle Abschnitte beider Wege an und antwortet in der Form des Vertrags.
        expect(antwort.status(), await antwort.text()).toBe(200);
        const quittung = vertragGilt(OperationReceipt, await antwort.json(), "Die Quittung des echten Servers");
        expect(
            quittung.affected
                .filter((e) => e.kind === "path")
                .map((e) => e.id)
                .sort(),
        ).toEqual(erwartet.map((x) => x.id).sort());
        await expect(page.getByText("2 Wege gelöscht")).toBeVisible();
        await expect(blatt).toBeHidden();
        await expect(offen(page).locator('[data-testid$="-sammel"]')).toHaveCount(0);

        // In der Liste des echten Servers sind beide gelöscht.
        const liste = (await (await page.request.get("/api/editor/paths")).json()) as { rows: EditorPathRow[] };
        for (const weg of [a, b])
            expect(liste.rows.find((r) => r.name === weg.name)?.deleted, `${weg.name} steht als gelöscht`).toBe(true);

        // ↺ des Verlaufs holt beide zurück (dieselbe Rücknahme der Wege, auch über mehrere Straßen).
        expect(await holeZurueck(page, quittung)).toBe(200);
        keinFehler(beob);
    });

    test("🔴 Sammelansicht: zwei angehakte Straßen in der Liste, „Weg entfernen …“ › „Von der Karte nehmen“, 200; ↺ holt sie zurück", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await meldeAn(page);
        await openMap(page, EDITOR_MODE);
        await page.getByTestId("route-planner-tab").click();
        await editorPanelVorn(page);
        await page.getByTestId("editorpanel-kachel-wege").click();
        await page.getByTestId("editorpanel-verb").click();
        await expect(offen(page)).toHaveCount(1);
        // Zwei mittelgroße Straßen mit echtem Namen aus der Liste des echten Servers.
        const liste = (await (await page.request.get("/api/editor/paths")).json()) as { rows: EditorPathRow[] };
        const namen = liste.rows
            .filter(
                (r) =>
                    r.offMap !== true &&
                    r.deleted !== true &&
                    r.segments >= 2 &&
                    r.segments <= 12 &&
                    !/-\d+$/.test(r.name),
            )
            .filter((r, i, alle) => alle.filter((x) => x.name.includes(r.name)).length === 1)
            .slice(0, 2)
            .map((r) => r.name);
        expect(namen, "zwei Straßen mit 2 bis 12 Abschnitten und eindeutigem Namen").toHaveLength(2);
        const erwartet = [...(await abschnitteVon(page, namen[0]!)), ...(await abschnitteVon(page, namen[1]!))];

        await offen(page).locator('[data-testid$="-wege-mehrfach"]').first().click();
        const suche = offen(page).locator('input[type="search"], input[type="text"]').first();
        for (const name of namen) {
            await suche.fill(name);
            await page.waitForTimeout(800);
            await offen(page)
                .locator('[data-testid$="-wege-zeile"]')
                .filter({ hasText: name })
                .first()
                .locator('[data-testid$="-zeile-haken"]')
                .click();
        }
        await suche.fill("");
        await expect(offen(page).locator('[data-testid$="-wege-haken"]').first()).toContainText("2 angehakt");
        const knopf = offen(page).locator('[data-testid$="-sammel-entfernen"]').first();
        await expect(knopf).toBeEnabled({ timeout: 30_000 });
        await knopf.click();
        const blatt = page.getByTestId("weg-entfernen");
        await expect(blatt).toContainText("2 Wege gewählt", { timeout: 30_000 });
        await page.getByTestId("weg-entfernen-abnehmen").click();
        await expect(page.getByTestId("weg-entfernen-los")).toHaveText("2 Wege von der Karte nehmen");

        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith("/api/editor/paths/sammel/take-off-map") && r.request().method() === "POST",
            ),
            page.getByTestId("weg-entfernen-los").click(),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const quittung = vertragGilt(OperationReceipt, await antwort.json(), "Die Quittung des echten Servers");
        expect(
            quittung.affected
                .filter((e) => e.kind === "path")
                .map((e) => e.id)
                .sort(),
        ).toEqual(erwartet.map((x) => x.id).sort());
        await expect(page.getByText("2 Wege von der Karte genommen")).toBeVisible();
        await expect(blatt).toBeHidden();

        expect(await holeZurueck(page, quittung)).toBe(200);
        keinFehler(beob);
    });
});
