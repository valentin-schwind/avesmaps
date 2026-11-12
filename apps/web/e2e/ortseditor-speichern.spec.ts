import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPlaceDetail, PlaceUpdateBody } from "@avesmaps3d/shared";
import { GRATENFELS, GRATENFELS_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * Speichern im Ortseditor (WI-0128 E11; EDIT-0001 §4.3; Gesamtmockup Version 7, „Eigenschaften & Overrides“).
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): Lesen und Schreiben des Orts (`GET`/`PATCH /api/editor/places/:id`) und
 * der Stand des Bearbeitens kommen aus einem Stub; den echten Schreibweg prüft `apps/server/test/editor-place-edit.test.ts` gegen die
 * Testdatenbank. Die Sitzung trägt das Recht `edit_map_objects` (Stub der Anmeldung).
 */

const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

function ort(revision: number, ueber: Partial<EditorPlaceDetail> = {}): EditorPlaceDetail {
    return {
        publicId: GRATENFELS,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: GRATENFELS_LAGE,
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: "Hauptstadt der Grafschaft Gratenfels." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [],
        ...ueber,
    };
}

interface Server {
    lesen: EditorPlaceDetail[];
    antworten: { status: number; body: unknown }[];
    gesendet: PlaceUpdateBody[];
}

async function stubOrt(page: Page, server: Server): Promise<void> {
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}`, async (route: Route) => {
        if (route.request().method() === "PATCH") {
            server.gesendet.push(route.request().postDataJSON() as PlaceUpdateBody);
            const antwort = server.antworten.shift()!;
            return route.fulfill({
                status: antwort.status,
                contentType: "application/json",
                body: JSON.stringify(antwort.body),
            });
        }
        const stand = server.lesen.length > 1 ? server.lesen.shift()! : server.lesen[0]!;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stand) });
    });
}

const quittung = (revision: number) => ({
    status: 200,
    body: {
        operationId: "00000000-0000-4000-8000-000000000001",
        status: "applied",
        environment: "development",
        affected: [{ kind: "place", id: GRATENFELS, revision }],
        derivedWork: [],
        warnings: [],
    },
});

const status = (page: Page) => fenster(page).locator('[data-testid$="-status"]');
const feld = (page: Page, name: string) =>
    fenster(page)
        .locator(`[data-testid$="-feld-${name}"]`)
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();

test("🔴 ein Feld ändern: Beschriftung eigen, Wiki-Wert durchgestrichen mit ↺; Speichern sendet nur das Feld, „Gespeichert als Revision 8“", async ({
    page,
}) => {
    const server: Server = { lesen: [ort(7), ort(8)], antworten: [quittung(8)], gesendet: [] };
    await stubOrt(page, server);
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await expect(status(page)).toHaveText("Keine Änderung · Revision 7");
    await expect(feld(page, "einwohner")).toHaveValue("2.200");

    await feld(page, "einwohner").fill("2.500");
    await expect(fenster(page).locator('[data-testid$="-zeile-einwohner-wiki"] s')).toHaveText("2.200");
    await expect(status(page)).toHaveText("Ungespeichert: Einwohner");

    // ↺ setzt im Entwurf zurück; danach wieder geändert.
    await fenster(page).locator('[data-testid$="-zeile-einwohner-zurueck"]').click();
    await expect(status(page)).toHaveText("Keine Änderung · Revision 7");
    await feld(page, "einwohner").fill("2.500");

    await fenster(page).locator('[data-testid$="-speichern"]').click();
    await expect(status(page)).toHaveText("Gespeichert als Revision 8.");
    expect(server.gesendet).toEqual([
        { operationId: expect.any(String), baseRevision: 7, changes: { einwohner: { value: "2.500" } } },
    ]);
});

test("🔴 Konflikt: „Jemand war schneller“ mit Person und Feldern; ohne Überschneidung geht die eigene Änderung auf die neue Revision", async ({
    page,
}) => {
    const fremd = ort(8, { hidden: true });
    const server: Server = {
        lesen: [ort(7), fremd, ort(9, { hidden: true, name: "Gratenfels am Breitenfluss" })],
        antworten: [
            {
                status: 409,
                body: {
                    error: {
                        code: "edit_conflict",
                        message: "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                        details: { currentRevision: 8, changedBy: { id: "p", displayName: "Rondrikan" } },
                    },
                },
            },
            quittung(9),
        ],
        gesendet: [],
    };
    await stubOrt(page, server);
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    await feld(page, "name").fill("Gratenfels am Breitenfluss");
    await fenster(page).locator('[data-testid$="-speichern"]').click();

    const kasten = fenster(page).locator('[data-testid$="-konflikt"]');
    await expect(kasten).toContainText("Jemand war schneller");
    await expect(kasten).toContainText("Rondrikan hat Gratenfels");
    await expect(kasten).toContainText("(Revision 8): Verborgen.");
    await expect(kasten).toContainText("Eigene Änderung: Name.");
    await expect(kasten).toContainText("Die Änderungen überschneiden sich nicht.");
    await kasten.locator('[data-testid$="-konflikt-anwenden"]').click();
    await expect(status(page)).toHaveText("Gespeichert als Revision 9.");
    expect(server.gesendet[1]).toEqual({
        operationId: expect.any(String),
        baseRevision: 8,
        changes: { name: "Gratenfels am Breitenfluss" },
    });
});

test("ohne Recht zum Bearbeiten bleibt der Ortseditor lesend und Speichern sagt warum", async ({ page }) => {
    await stubOrt(page, { lesen: [ort(7)], antworten: [], gesendet: [] });
    await oeffneOrtseditor(page, { rechte: ["use_editor_menu"] });
    await zeile(page, "Gratenfels").click();
    await expect(fenster(page).locator('[data-testid$="-felder"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-speichern"]')).toHaveAttribute(
        "title",
        "Zum Speichern fehlt das Recht, Kartenobjekte zu bearbeiten.",
    );
});

test("🔴 Merkmale: sechs Haken; Seehafen setzt der Editor, ein Hinweis sagt, wenn kein Wasser in Reichweite liegt; Verborgen heißt unsuchbar", async ({
    page,
}) => {
    const server: Server = {
        lesen: [ort(7, { waterNearby: false }), ort(8, { seaport: true })],
        antworten: [quittung(8)],
        gesendet: [],
    };
    await stubOrt(page, server);
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    for (const merkmal of ["ruined", "hidden", "seaport", "nodix", "underground", "withdrawn"])
        await expect(fenster(page).locator(`[data-testid$="-feld-${merkmal}"]`)).toHaveCount(1);
    // Kein Satz mehr von Seewegen oder Kraftlinien; Verborgen nach dem Entscheid vom 05.10.2026.
    await expect(fenster(page)).not.toContainText("Seewegen");
    await expect(fenster(page).locator('[data-testid$="-feld-hidden"]').locator("..")).toContainText("in keiner Suche");

    await expect(fenster(page).locator('[data-testid$="-befund-wasser"]')).toHaveCount(0);
    await fenster(page).locator('[data-testid$="-feld-seaport"]').click();
    // Der Hinweis steht unter „Prüfen“ (E20): ein Befund, keine Sperre.
    await expect(fenster(page).locator('[data-testid$="-befund-wasser"]')).toContainText(
        "Kein Meer und kein See in Reichweite",
    );
    await fenster(page).getByRole("button", { name: "Speichern" }).click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]?.changes).toEqual({ seaport: true });
});

test("🔴 Prüfen (E20): Befunde stehen oben im Formular, ein doppelter Name ist einer davon, und Speichern bleibt möglich", async ({
    page,
}) => {
    const server: Server = { lesen: [ort(7), ort(8, { name: "Ferdok" })], antworten: [quittung(8)], gesendet: [] };
    await stubOrt(page, server);
    await oeffneOrtseditor(page, { rechte: RECHTE });
    await zeile(page, "Gratenfels").click();
    // Ohne Wegende am Ort: „Kein Weg führt zu diesem Ort.“ (die Attrappe hat keine Wegenden).
    await expect(fenster(page).locator('[data-testid$="-befund-unverbunden"]')).toBeVisible();
    await expect(fenster(page).locator('[data-testid$="-befund-name"]')).toHaveCount(0);
    await feld(page, "name").fill("Ferdok");
    await expect(fenster(page).locator('[data-testid$="-befund-name"]')).toContainText("schon ein anderer Ort");
    await fenster(page).locator('[data-testid$="-speichern"]').click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]?.changes).toEqual({ name: "Ferdok" });
});
