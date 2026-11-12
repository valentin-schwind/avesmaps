import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
    FlaechenVereinigenPruefung,
    FlaechenVereinigenReceipt,
    editorLandscapeRestoreSeriesUrl,
} from "@avesmaps3d/shared";
import { freieStelle, liste } from "./landschaftseditor-vereinigen-stub.ts";
import { EDITOR_MODE, openMap, settleFrame } from "./map-handle.ts";
import { editorPanelAuf } from "./ortseditor-stub.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, type Beobachtung } from "./welt.ts";

/**
 * „Flächen vereinigen ›“ gegen den ECHTEN Server in der Wegwerf-Welt (`welt.ts`), ohne Stub (WI-0252; Betreiber 2026-10-25 auf der Stage:
 * „die menüoption taucht auf, aber wenn ich zwei fläche vereinige, passiert nichts“). `landschaftseditor-vereinigen.spec.ts` prüft den
 * Ablauf mit Stubs; hier rechnet der Server an den Flächen, die es gibt.
 *
 * Aufruf (Welt läuft, Vite auf `E2E_PORT`, Fastify auf `PORT`):
 *     WELT_TOKEN_DATEI=<Sitzung> E2E_PORT=<Vite> PORT=<Fastify> npm run bank -- npx playwright test e2e/flaechen-echt.spec.ts --workers=1
 *
 * Die Namen und Orte gelten für die Kopie der Entwicklungsdatenbank (Oktober 2026) und lassen sich über die Umgebung ersetzen
 * (`WELT_FLAECHEN_GEHT`, `WELT_FLAECHEN_NACHBAR`, `WELT_FLAECHEN_RAND`, je „Name;Name“ und `…_ORT` als Kartenadresse; `WELT_MEER_IDS`).
 *
 * Problemfälle, an echten Daten gemessen (Stubs zeigten keinen): Die Prüfung antwortet 500, weil der Rand einer Fläche sich selbst kreuzt
 * (`GEOSUnaryUnion: TopologyException`, Gebirge); sie braucht über die Zeitgrenze der Anfrage (5 s) hinaus, weil die Nachbarabfrage ganze
 * große Flächen liest (Meer, 99 s) und der Server 503 sagt; nach dem Scheitern bleibt die Prüfung für diese Auswahl stehen, obwohl der
 * Grund „das Menü noch einmal öffnen“ sagt; das Grau steht ohne sichtbaren Grund da und sieht aus wie „tut nichts“.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

interface Fall {
    readonly namen: readonly string[];
    readonly ort: string;
}
const namenAus = (wert: string | undefined, standard: string): string[] => (wert ?? standard).split(";");
const FAELLE = {
    // Zwei Regionen der Derographie, die sich an einer Kante berühren und deren Nachbarn angeschlossen bleiben.
    geht: {
        namen: namenAus(process.env["WELT_FLAECHEN_GEHT"], "Bargenta;Almada"),
        ort:
            process.env["WELT_FLAECHEN_GEHT_ORT"] ??
            "x=489&y=443&z=6&series=original&view=landscapes&layer=derographisch",
    },
    // Zwei Regionen, bei denen eine Nachbarfläche ihre gemeinsame Kante verlöre: grau, mit dem Grund.
    nachbar: {
        namen: namenAus(process.env["WELT_FLAECHEN_NACHBAR"], "Greifener Land;Mittelaventurien"),
        ort:
            process.env["WELT_FLAECHEN_NACHBAR_ORT"] ??
            "x=514&y=585&z=6&series=original&view=landscapes&layer=derographisch",
    },
    // Zwei Gebirge, von denen eines einen Rand hat, der sich selbst kreuzt: vorher 500 „side location conflict“.
    rand: {
        namen: namenAus(process.env["WELT_FLAECHEN_RAND"], "Tolakshöhen;Sturmfelser Massiv"),
        ort:
            process.env["WELT_FLAECHEN_RAND_ORT"] ??
            "x=587&y=486&z=6&series=original&view=landscapes&layer=topographie",
    },
} satisfies Record<string, Fall>;

/** Wohin das Bild vom grauen Eintrag mit seinem Grund geht (Abnahme): nur, wenn der Ordner genannt ist. */
const BILDER = process.env["FLAECHEN_VEREINIGEN_BILDER"];

/** Zyklopensee und das große Meer der Kopie (topographie/meer). */
const MEERE = "00ca0769-b8b1-469f-911b-92a3dd89f109,23d223f1-fc26-4d67-bf7d-2b8109d6d069";

/** So lange darf die Prüfung höchstens brauchen: die Zeitgrenze des Servers (5 s) mit Luft darunter. */
const PRUEFUNG_HOECHSTENS_MS = 4000;

/** Öffnet die Welt an diesem Ort, das Landschaftsfenster, hakt die Flächen an und öffnet das Kartenmenü an einer freien Stelle. */
async function waehle(page: Page, fall: Fall): Promise<void> {
    await meldeAn(page);
    await openMap(page, `${EDITOR_MODE}#${fall.ort}`);
    await settleFrame(page);
    await editorPanelAuf(page);
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await liste(page)
        .getByTestId(/-landschaften-mehrfach$/)
        .click();
    const loesen = liste(page).getByTestId(/-landschaften-haken-loesen$/);
    if (await loesen.isVisible()) await loesen.click();
    const suche = liste(page).locator("input").first();
    for (const name of fall.namen) {
        await suche.fill(name);
        await page.waitForTimeout(600);
        // Genau dieser Name: "Meer" träfe sonst auch "Mittelmeer" und jedes Meer des Namens davor.
        const zeile = liste(page)
            .getByTestId(/-landschaften-zeile$/)
            .filter({ has: page.getByText(name, { exact: true }) })
            .first();
        await expect(
            zeile,
            `die Fläche „${name}“ steht in der Liste der Welt (andere Namen: WELT_FLAECHEN_*)`,
        ).toBeVisible({
            timeout: 15_000,
        });
        await zeile.click();
        await suche.fill("");
    }
    await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-mehrfach$/)).toContainText("2 Landschaften gewählt");
    await settleFrame(page);
    const stelle = await freieStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(page.getByTestId("context-editor")).toBeVisible();
}

/** Die Prüfung des echten Servers, die das Menü gestellt hat (es fragt, sobald es aufgeht): Status und Zeit ihrer letzten Antwort. */
async function pruefungDes(beob: Beobachtung) {
    const treffer = () =>
        beob.antworten.filter((a) => a.methode === "GET" && a.url.startsWith("/api/editor/landscapes/vereinigen?"));
    await expect
        .poll(() => treffer().length, { message: "das Menü hat die Auswahl geprüft", timeout: 15_000 })
        .toBeGreaterThan(0);
    return treffer().at(-1)!;
}

function keinFehler(beob: Beobachtung): void {
    expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
}

test.describe("Flächen vereinigen, echter Server (Wegwerf-Welt)", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    test("🔴 zwei Regionen, bei denen es geht: Menü › Vorlage › EINE Operation, 200 in der Form des Vertrags, das Fenster zeigt die Vorlage; ↺ holt die andere zurück", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await waehle(page, FAELLE.geht);
        const eintrag = page.getByTestId("context-editor-flaechen-vereinigen");
        await expect(eintrag).toBeEnabled();
        const p = await pruefungDes(beob);
        expect(p.status).toBe(200);
        expect(p.ms, "die Prüfung braucht unter der Zeitgrenze des Servers").toBeLessThan(PRUEFUNG_HOECHSTENS_MS);
        await eintrag.hover();
        const unter = page.getByTestId("context-editor-flaechen-vereinigen-unter");
        await expect(unter).toBeVisible();
        for (const name of FAELLE.geht.namen) await expect(unter).toContainText(name);
        const wahl = unter.locator('[data-testid^="context-editor-flaechen-vereinigen#"]').first();
        await wahl.hover();
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith("/api/editor/landscapes/vereinigen") && r.request().method() === "POST",
            ),
            wahl.click(),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const quittung = vertragGilt(
            FlaechenVereinigenReceipt,
            await antwort.json(),
            "Die Quittung des echten Servers",
        );
        await expect(page.getByText("2 Flächen sind jetzt eine; ↺ im Verlauf.")).toBeVisible();
        await expect(page.getByTestId(/^landschaftseditor-fenster-\d+-mehrfach$/)).toHaveCount(0);

        // ↺: Die andere Landschaft kommt zurück (`restore-series` der Vorlage mit EINEM Mitglied, wie der Verlauf es ruft; WI-0265 B6c).
        const zurueck = await page.request.post(editorLandscapeRestoreSeriesUrl(quittung.publicId), {
            headers: { origin: new URL(page.url()).origin },
            data: {
                operationId: randomUUID(),
                members: [quittung.operationId],
                membersHash: createHash("sha256").update(quittung.operationId.toLowerCase()).digest("hex"),
            },
        });
        expect(zurueck.status(), await zurueck.text()).toBe(200);
        keinFehler(beob);
    });

    test("🔴 zwei Regionen, bei denen eine Nachbarfläche ihre Kante verlöre: grau, und der Grund steht SICHTBAR unter dem Eintrag", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await waehle(page, FAELLE.nachbar);
        const eintrag = page.getByTestId("context-editor-flaechen-vereinigen");
        await expect(eintrag).toBeDisabled();
        await expect(page.getByTestId("context-editor-flaechen-vereinigen-grund")).toHaveText(
            "Eine Nachbarfläche verlöre ihre gemeinsame Kante.",
        );
        const p = await pruefungDes(beob);
        expect(p.status).toBe(200);
        expect(p.ms).toBeLessThan(PRUEFUNG_HOECHSTENS_MS);
        if (BILDER !== undefined) await page.screenshot({ path: `${BILDER}/flaechen-vereinigen-grau-echt.png` });
        keinFehler(beob);
    });

    test("🔴 ein Rand, der sich selbst kreuzt: die Prüfung antwortet 200 statt 500, und das Menü geht (GEOS „side location conflict“)", async ({
        page,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await waehle(page, FAELLE.rand);
        const p = await pruefungDes(beob);
        expect(p.status, "vorher 500: TopologyException an der ungültigen Fläche").toBe(200);
        const antwort = vertragGilt(
            FlaechenVereinigenPruefung,
            await (await page.request.get(p.url)).json(),
            "Die Prüfung des echten Servers",
        );
        // Geht es, steht „Flächen vereinigen“ offen; sonst grau mit sichtbarem Grund: nie ein Grau ohne Satz.
        const eintrag = page.getByTestId("context-editor-flaechen-vereinigen");
        if (antwort.geht) await expect(eintrag).toBeEnabled();
        else await expect(page.getByTestId("context-editor-flaechen-vereinigen-grund")).not.toBeEmpty();
        keinFehler(beob);
    });

    test("🔴 zwei große Meere: die Prüfung bleibt unter der Zeitgrenze (vorher 99 s in der Nachbarabfrage, 503 nach 5 s)", async ({
        page,
    }) => {
        // Zyklopensee (4.669 Ecken) und das große Meer (19.815 Ecken, 214 Nachbarn): Die Kennungen gelten für die Kopie der
        // Entwicklungsdatenbank und lassen sich über `WELT_MEER_IDS` ersetzen.
        const ids = (process.env["WELT_MEER_IDS"] ?? MEERE).split(",");
        await meldeAn(page);
        const t = Date.now();
        const antwort = await page.request.get(`/api/editor/landscapes/vereinigen?ids=${ids.join(",")}`);
        const ms = Date.now() - t;
        expect(antwort.status(), "vorher 503 an der Zeitgrenze von 5 s").toBe(200);
        const pruefung = vertragGilt(
            FlaechenVereinigenPruefung,
            await antwort.json(),
            "Die Prüfung des echten Servers",
        );
        test.skip(pruefung.objekte.length < 2, "die Meere dieser Welt haben andere Kennungen: WELT_MEER_IDS setzen");
        expect(ms, "die Prüfung braucht unter der Zeitgrenze des Servers").toBeLessThan(PRUEFUNG_HOECHSTENS_MS);
        // Ob es geht oder nicht: Der Grund steht in der Antwort, nie ein leeres Grau.
        expect(pruefung.geht || pruefung.grund !== undefined).toBe(true);
    });
});
