import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
    OperationReceipt,
    RuecknahmeReceipt,
    type EditorLandscapeDetail,
    type EditorLandscapeList,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { editorPanelVorn } from "./ortseditor-stub.ts";
import { hebeSperrenAuf } from "./tor-hilfen.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, weltToken, type WeltPerson } from "./welt.ts";

/**
 * Zurücknehmen aus „Änderungen“ (WI-0265 B5c; WI-0265 §6: „mindestens ein Zwei-Kontext-Browsertest, der mit dem echten Server schreibt“, U6): ZWEI Personen in zwei
 * Browserkontexten gegen den ECHTEN Server der Testwelt (`scripts/dev/tor-welt.ts`: „Tor-Editor“ und „Tor-Zweiter“), kein `page.route` auf `/api`.
 *
 * Person A schreibt drei „Fertig“ am selben Gebirge (eine Arbeitsserie). Person B ändert danach dasselbe Gebirge. Dann versucht A im Reiter „Änderungen“ die Serie
 * zurückzunehmen:
 *
 * 1. **Konflikt (U6):** Die Oberfläche zeigt die Konfliktliste mit der Person B, der Server hat NICHTS geschrieben (dieselbe jüngste Operation, die Werte stehen,
 *    wie B sie ließ) und keinen Folgeauftrag angelegt.
 * 2. **Ohne Fremdänderung:** B nimmt die eigene Änderung zurück (beide heben einander auf, Fachvertrag C.3); A fragt noch einmal, die Rückfrage nennt die drei Schritte,
 *    „Serie zurücknehmen (3)“ schreibt EINE Rücknahme mit Verknüpfungen auf alle drei, das Gebirge hat seine Werte von vorher, und die Liste zeigt die Originale als
 *    „zurückgenommen durch Tor-Editor“.
 *
 * 3. **Eine EINZELNE Änderung (B5d):** Eine Gebirgsänderung ohne Serie hat im Reiter ebenfalls ihr ↺ (die Teilfläche nennt ihre Landschaft) und nimmt sich über dieselbe Route zurück.
 *
 * Läuft nur mit der Testwelt (`WELT_TOKEN_DATEI`); Aufruf: `scripts/dev/tor-lokal.ts --testpaket <Ordner> e2e/aenderungen-ruecknahme.spec.ts` (WI-0264).
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const kopfVon = (wer: WeltPerson, herkunft: string) => ({
    cookie: `avesmaps-session=${weltToken(wer)}`,
    origin: herkunft,
});

interface Gebirge {
    readonly landschaft: string;
    readonly name: string;
    readonly flaeche: string;
}

/** Ein aktives Gebirge der Testwelt, an dem noch nie jemand etwas geändert hat (eine Wiederholung stößt so nie an den Rest des ersten Versuchs). */
async function unberuehrtesGebirge(request: APIRequestContext, kopf: Record<string, string>): Promise<Gebirge> {
    const liste = (await (
        await request.get("/api/editor/landscapes", { headers: kopf })
    ).json()) as EditorLandscapeList;
    for (const zeile of liste.rows.filter((r) => r.type === "gebirge" && r.state === undefined && r.areas === 1)) {
        const detail = (await (
            await request.get(`/api/editor/landscapes/${zeile.id}`, { headers: kopf })
        ).json()) as EditorLandscapeDetail;
        const flaeche = detail.areas[0];
        if (flaeche?.gebirge === undefined) continue;
        const geschichte = (await (
            await request.get(`/api/editor/changes?object=landscape:${zeile.id}&limit=1`, { headers: kopf })
        ).json()) as MapHistoryPage;
        if (geschichte.entries.length === 0) return { landschaft: zeile.id, name: zeile.name, flaeche: flaeche.id };
    }
    throw new Error("kein unberührtes Gebirge in der Testwelt");
}

const lese = async (request: APIRequestContext, kopf: Record<string, string>, g: Gebirge) => {
    const detail = (await (
        await request.get(`/api/editor/landscapes/${g.landschaft}`, { headers: kopf })
    ).json()) as EditorLandscapeDetail;
    return detail.areas.find((flaeche) => flaeche.id === g.flaeche)!.gebirge!;
};

/** „Fertig“ am Gebirge: eine Operation `landscape.update` mit einer Änderung der Kammhöhe, gegen die Revision der Gebirgswerte. */
async function fertig(
    request: APIRequestContext,
    kopf: Record<string, string>,
    g: Gebirge,
    kammhoehe: number,
): Promise<string> {
    const stand = await lese(request, kopf, g);
    const antwort = await request.patch(`/api/editor/landscapes/${g.landschaft}`, {
        headers: kopf,
        data: {
            operationId: randomUUID(),
            gebirge: [{ area: g.flaeche, changes: { kammhoehe, baseRevision: stand.revision } }],
        },
    });
    expect(antwort.status(), await antwort.text()).toBe(200);
    return vertragGilt(OperationReceipt, await antwort.json(), "Die Quittung der Gebirgsänderung").operationId;
}

/** Person B nimmt EINE eigene Operation zurück, wie die Oberfläche es täte (Vorprüfung, dann Rücknahme). */
async function nimmZurueck(request: APIRequestContext, kopf: Record<string, string>, g: Gebirge, operationId: string) {
    const url = `/api/editor/landscapes/${g.landschaft}/restore-series`;
    const vorschau = await request.post(`${url}/preview`, { headers: kopf, data: { members: [operationId] } });
    expect(vorschau.status(), await vorschau.text()).toBe(200);
    // 🪤 Ohne `vertragGilt`: Das Format `date-time` des Vertrags kennt der Prüfer im Browserlauf nicht (der Server registriert es selbst).
    const pruefung = (await vorschau.json()) as RuecknahmePruefung;
    expect(pruefung.ergebnis).toBe("ok");
    const antwort = await request.post(url, {
        headers: kopf,
        data: { operationId: randomUUID(), members: [operationId], membersHash: pruefung.membersHash },
    });
    expect(antwort.status(), await antwort.text()).toBe(200);
}

/** Die jüngste `seq` aller Operationen: Was nicht geschrieben wurde, ändert sie nicht. */
async function juengsteSeq(request: APIRequestContext, kopf: Record<string, string>): Promise<number> {
    const seite = (await (
        await request.get("/api/editor/changes?limit=1", { headers: kopf })
    ).json()) as MapHistoryPage;
    return seite.entries[0]!.seq;
}

async function oeffneAenderungen(page: Page): Promise<void> {
    await meldeAn(page, "editor");
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-reiter-aenderungen").click();
    await page.getByTestId("aenderungen-wer-reiter-meine").click();
}

test.describe("Zurücknehmen: zwei Personen am selben Gebirge", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Sperren überleben das Ende eines Falls (ein geschlossener Browser gibt nichts frei): jeder Fall beginnt und endet ohne.
    test.beforeEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));
    test.afterEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));

    test("🔴 U6: A hat eine Serie, B ändert dasselbe Gebirge: Konfliktliste und NICHTS geschrieben; ohne Fremdänderung gelingt die Rücknahme", async ({
        page,
        browser,
        baseURL,
    }) => {
        test.setTimeout(300_000);
        const herkunft = new URL(baseURL!).origin;
        const beob = beobachte(page);
        // Zwei Kontexte: A ist die Seite des Falls, B schreibt aus einem eigenen Kontext mit eigener Sitzung (kein geteiltes Cookie).
        const kontextB = await browser.newContext({ baseURL: baseURL! });
        try {
            const a = kopfVon("editor", herkunft);
            const b = kopfVon("editor2", herkunft);
            const requestA = page.request;
            const requestB = kontextB.request;

            const gebirge = await unberuehrtesGebirge(requestA, a);
            const vorher = await lese(requestA, a, gebirge);

            // A: drei „Fertig“ hintereinander = eine Arbeitsserie.
            const meine = [
                await fertig(requestA, a, gebirge, 2510),
                await fertig(requestA, a, gebirge, 2620),
                await fertig(requestA, a, gebirge, 2730),
            ];
            // B: dasselbe Gebirge, danach.
            const seine = await fertig(requestB, b, gebirge, 3880);
            const seqNachB = await juengsteSeq(requestA, a);
            expect((await lese(requestA, a, gebirge)).kammhoehe).toBe(3880);

            await oeffneAenderungen(page);
            const serie = page.getByTestId("editorpanel-aenderung-serie").filter({ hasText: gebirge.name });
            await expect(serie).toBeVisible({ timeout: 30_000 });
            await expect(serie).toContainText("3 Änderungen");
            await serie.getByTestId("editorpanel-aenderung-serie-zeile").click();
            const ruecknahme = serie.getByTestId("editorpanel-aenderung-ruecknahme");
            await expect(ruecknahme).toContainText("Serie zurücknehmen (3)");

            // 1. Konflikt: Der Server prüft vor dem Schreiben; die Liste nennt Person B, es gibt keine Rückfrage zum Bestätigen.
            await ruecknahme.click();
            const blockiert = serie.getByTestId("editorpanel-aenderung-ruecknahme-blockiert");
            await expect(blockiert).toBeVisible({ timeout: 30_000 });
            await expect(blockiert).toContainText("Rücknahme nicht möglich");
            await expect(blockiert).toContainText("Tor-Zweiter");
            await expect(serie.getByTestId("editorpanel-aenderung-ruecknahme-konflikt").first()).toBeVisible();
            // B5d: Die Meldung nennt die Felder in Worten des Reiters „Gebirge“ - kein roher Schlüssel, kein Sammelwort „Gebirge“, kein deutscher Satz des Servers.
            const konflikte = serie.getByTestId("editorpanel-aenderung-ruecknahme-konflikte");
            await expect(konflikte).toContainText("Höhe des Kamms");
            await expect(konflikte).not.toContainText("maximalhoehe");
            await expect(konflikte).not.toContainText("Felder: Gebirge");
            await expect(serie.getByTestId("editorpanel-aenderung-ruecknahme-frage")).toHaveCount(0);
            await expect(serie.getByTestId("editorpanel-aenderung-ruecknahme-konflikt-pruefen")).toBeVisible();
            // 0 Änderungen: dieselbe jüngste Operation, die Werte sind die von B.
            expect(await juengsteSeq(requestA, a)).toBe(seqNachB);
            expect((await lese(requestA, a, gebirge)).kammhoehe).toBe(3880);

            // 2. Ohne Fremdänderung: B nimmt die eigene Änderung zurück; beide heben einander auf.
            await nimmZurueck(requestB, b, gebirge, seine);
            expect((await lese(requestA, a, gebirge)).kammhoehe).toBe(2730);
            await serie.getByTestId("editorpanel-aenderung-ruecknahme-schliessen").click();
            await ruecknahme.click();
            const frage = serie.getByTestId("editorpanel-aenderung-ruecknahme-frage");
            await expect(frage).toBeVisible({ timeout: 30_000 });
            await expect(frage).toContainText("Die gesamte Serie zurücknehmen?");
            await expect(frage.getByTestId("editorpanel-aenderung-ruecknahme-betroffen").locator("li")).toHaveCount(3);
            await expect(frage).toContainText("Gelände");
            // A nimmt die eigenen Änderungen zurück: kein Pflichtgrund.
            await expect(frage.getByTestId("editorpanel-aenderung-ruecknahme-grund")).toHaveCount(0);
            const [antwort] = await Promise.all([
                page.waitForResponse(
                    (r) =>
                        r.url().endsWith(`/api/editor/landscapes/${gebirge.landschaft}/restore-series`) &&
                        r.request().method() === "POST",
                ),
                frage.getByRole("button", { name: "Serie zurücknehmen (3)", exact: true }).click(),
            ]);
            expect(antwort.status(), await antwort.text()).toBe(200);
            const quittung = vertragGilt(RuecknahmeReceipt, await antwort.json(), "Die Quittung der Rücknahme");
            // EINE Operation mit den Verknüpfungen auf alle drei (in der Folge der Serie).
            expect(quittung.reverts).toEqual(meine);
            await expect(serie.getByTestId("editorpanel-aenderung-ruecknahme-ergebnis")).toBeVisible();

            // Das Gebirge hat die Werte von vorher, und die Liste führt die Originale als zurückgenommen.
            expect((await lese(requestA, a, gebirge)).kammhoehe).toBe(vorher.kammhoehe);
            const seite = (await (
                await requestA.get(`/api/editor/changes?object=landscape:${gebirge.landschaft}&limit=20`, {
                    headers: a,
                })
            ).json()) as MapHistoryPage;
            for (const id of meine)
                expect(seite.entries.find((e) => e.operationId === id)).toMatchObject({
                    status: "bereits_zurueckgenommen",
                    revertedBy: { operationId: quittung.operationId, actor: { name: "Tor-Editor" } },
                });
            // Die Serie in der Liste zeigt es im Kreis (○ „zurückgenommen“), nicht nur im Ergebnis der Rückfrage.
            await expect(
                serie
                    .getByTestId("editorpanel-aenderung-serie-zeile")
                    .getByRole("img", { name: "zurückgenommen", exact: true }),
            ).toBeVisible({ timeout: 30_000 });
            expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
        } finally {
            await kontextB.close();
        }
    });

    test("🔴 B5d: eine EINZELNE Gebirgsänderung ohne Serie hat im Reiter ihr ↺ und nimmt sich über dieselbe Route zurück", async ({
        page,
        baseURL,
    }) => {
        test.setTimeout(240_000);
        const herkunft = new URL(baseURL!).origin;
        const beob = beobachte(page);
        const a = kopfVon("editor", herkunft);
        const gebirge = await unberuehrtesGebirge(page.request, a);
        const vorher = await lese(page.request, a, gebirge);
        // Eine einzige Änderung: keine Arbeitsserie, die Landschaft steht nur am Gegenstand der Teilfläche.
        const operation = await fertig(page.request, a, gebirge, 2480);
        expect((await lese(page.request, a, gebirge)).kammhoehe).toBe(2480);

        await oeffneAenderungen(page);
        const eintrag = page.locator(`[data-aenderung-id="${operation}"]`);
        await expect(eintrag).toBeVisible({ timeout: 30_000 });
        await eintrag.getByTestId("editorpanel-aenderung-zeile").click();
        const ruecknahme = eintrag.getByTestId("editorpanel-aenderung-ruecknahme");
        await expect(ruecknahme).toContainText("Zurücknehmen");
        await expect(ruecknahme).toBeEnabled();
        await ruecknahme.click();
        const frage = eintrag.getByTestId("editorpanel-aenderung-ruecknahme-frage");
        await expect(frage).toBeVisible({ timeout: 30_000 });
        await expect(frage).toContainText("Diese Änderung zurücknehmen?");
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) =>
                    r.url().endsWith(`/api/editor/landscapes/${gebirge.landschaft}/restore-series`) &&
                    r.request().method() === "POST",
            ),
            frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click(),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const quittung = vertragGilt(RuecknahmeReceipt, await antwort.json(), "Die Quittung der Rücknahme");
        expect(quittung.reverts).toEqual([operation]);
        await expect(eintrag.getByTestId("editorpanel-aenderung-ruecknahme-ergebnis")).toBeVisible();
        expect((await lese(page.request, a, gebirge)).kammhoehe).toBe(vorher.kammhoehe);
        expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
    });
});
