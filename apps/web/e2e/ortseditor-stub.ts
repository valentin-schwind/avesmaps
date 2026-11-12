import { expect, type Locator, type Page } from "@playwright/test";
import type { EditorPlaceList, EditorPlaceRow } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die Ortsliste der Browsertests des Ortseditors (WI-0128 E6, E7). 🪤 Die Liste verlangt eine Anmeldung (`use_editor_menu`, 401 ohne
 * Sitzung); die Tests legen deshalb eine kleine Liste hin. Das Detail jedes Orts kommt echt vom Server (öffentlicher Leseweg), die
 * Koordinaten sind die echten.
 */
export const GRATENFELS = "7527ed5b-303a-57af-926e-ed41a8b82dfc";
export const FERDOK = "0bed218d-758a-5100-a581-d480debd6647";
export const GRATENFELS_LAGE = { x: 450.2, y: 535.64 };
export const FERDOK_LAGE = { x: 492.97, y: 524.69 };

export const LISTE: EditorPlaceList = {
    wikiListe: false,
    rows: [
        {
            key: GRATENFELS,
            origin: "karte",
            name: "Gratenfels",
            circle: "voll",
            assignment: "assigned",
            subtype: "stadt",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels" },
            ...GRATENFELS_LAGE,
            hasCoat: true,
        },
        {
            key: FERDOK,
            origin: "karte",
            name: "Ferdok",
            circle: "voll",
            assignment: "assigned",
            subtype: "stadt",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Ferdok", title: "Ferdok" },
            ...FERDOK_LAGE,
        },
        {
            key: "staette:probe",
            origin: "wiki",
            name: "Albenhuser Tor",
            circle: "leer",
            assignment: "none",
            kind: "Stadttor",
            within: "Gratenfels",
        },
        {
            // Ein Bauwerk außerorts aus dem Wiki: Mit ihm hat die Vorbelegung der Lage („außerorts + unklar“) einen Wert, der vorkommt.
            key: "wiki:wachturm-am-grossen-fluss",
            origin: "wiki",
            name: "Wachturm am Großen Fluss",
            circle: "leer",
            assignment: "none",
            subtype: "gebaeude",
            kind: "Turm",
        },
    ],
};

/** Die Liste mit vielen Orten davor, damit sie rollen muss (T7.10). Die Füllorte haben keine Lage. */
export function langeListe(anzahl = 200): EditorPlaceList {
    const fuell: EditorPlaceRow[] = Array.from({ length: anzahl }, (_, i) => ({
        key: `staette:fuell-${String(i).padStart(3, "0")}`,
        origin: "wiki",
        name: `Aarhain ${String(i).padStart(3, "0")}`,
        circle: "leer",
        assignment: "none",
    }));
    return { ...LISTE, rows: [...fuell, ...LISTE.rows] };
}

/**
 * Öffnet die Karte im Editor-Modus mit der Liste und dem Editorpanel. `verb`: gleich den Ortseditor dazu (ohne gewählten Ort ein
 * leeres Fenster).
 */
/** Die Rechte eines Editors am Ortseditor, wenn ein Test nichts anderes sagt. */
export const ORTSEDITOR_RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];

/**
 * Die Sperre während der Bearbeitung (EDIT-0003 §4, WI-0208) als Stub, nie gegen die Datenbank der Entwicklung: Ohne `gehaltenVon` ist
 * jeder Ort frei; mit Namen hält ihn diese Person, und Nehmen antwortet 409 `object_locked`. Die Liste der Sperren an Orten nennt dann
 * Gratenfels (WI-0215: Kasten und Schild), bis ein Admin sie aufhebt. Zurück kommen die Aufrufe in Reihenfolge.
 */
export async function stubOrtSperre(page: Page, gehaltenVon?: string): Promise<string[]> {
    const aufrufe: string[] = [];
    let gehalten = gehaltenVon;
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") {
            const fremd =
                gehalten !== undefined && url.includes("kind=place")
                    ? [
                          {
                              kind: "place",
                              id: GRATENFELS,
                              part: "felder",
                              person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: gehalten },
                              since: new Date().toISOString(),
                              heartbeatAt: new Date().toISOString(),
                              own: false,
                              at: GRATENFELS_LAGE,
                          },
                      ]
                    : [];
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ locks: fremd }),
            });
        }
        aufrufe.push(url.slice(url.indexOf("/api/editor/locks")));
        if (url.endsWith("/lift")) gehalten = undefined;
        if (url.endsWith("/release") || url.endsWith("/lift")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat"))
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lost: [] }) });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        const lock = {
            kind: body.kind,
            id: body.id,
            part: body.part,
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: gehaltenVon ?? "Ich" },
            since: "2026-10-16T12:00:00.000Z",
            heartbeatAt: "2026-10-16T12:00:00.000Z",
            own: gehaltenVon === undefined,
        };
        return gehaltenVon === undefined
            ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lock }) })
            : route.fulfill({
                  status: 409,
                  contentType: "application/json",
                  body: JSON.stringify({ error: { code: "object_locked", message: "…", details: { lock } } }),
              });
    });
    return aufrufe;
}

export async function oeffneOrtseditor(
    page: Page,
    optionen: { rechte?: string[]; liste?: EditorPlaceList; verb?: boolean; sperreVon?: string } = {},
): Promise<void> {
    // Immer eine gestellte Sitzung: Die Editor-Ansicht der Instanz hängt am laufenden Server (mit `authEnabled` hat sie keine Rechte,
    // 2026-10-12 wurden so alle Ortseditor-Tests rot). Ohne Angabe die drei Rechte des Ortseditors, mit Angabe genau diese.
    await stubAdmin(page, { capabilities: optionen.rechte ?? ORTSEDITOR_RECHTE, role: "editor" });
    // Die Sperre fragt nie den Server der Entwicklung; ein Test, der die Aufrufe zählen will, ruft `stubOrtSperre` selbst danach.
    await stubOrtSperre(page, optionen.sperreVon);
    const liste = optionen.liste ?? LISTE;
    await page.route("**/api/editor/places", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste) }),
    );
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    if (optionen.verb !== false) await page.getByTestId("editorpanel-verb").click();
}

/**
 * Das Editorpanel nach vorn holen. 🪤 Seit `dd9f7476` (Betreiber 2026-10-14: „im editor-modus [soll] das editor-panel auftauchen.
 * IMMER, wenn ein editor eingeloggt ist“) steht es am Rechner beim Laden schon offen; ein Klick auf die Lasche SCHLÖSSE es. Bis
 * dahin begann jeder Test mit geschlossenem Panel und klickte blind - danach war der ganze Strang rot, ohne dass sich etwas an der
 * Bedienung geändert hatte.
 */
export async function editorPanelVorn(page: Page): Promise<void> {
    const lasche = page.getByTestId("editor-panel-tab");
    if ((await lasche.getAttribute("aria-expanded")) !== "true") await lasche.click();
    await expect(lasche).toHaveAttribute("aria-expanded", "true");
}

/**
 * Wie `editorPanelVorn`, auch am Telefon: Dort verschwindet die Lasche, solange das Panel offen ist (WI-0128 E3); geprüft wird darum das
 * Panel selbst (WI-0252).
 */
export async function editorPanelAuf(page: Page): Promise<void> {
    const lasche = page.getByTestId("editor-panel-tab");
    if ((await lasche.getAttribute("aria-expanded")) !== "true") await lasche.click();
    await expect(page.getByTestId("editor-panel")).toBeVisible();
}

/**
 * Das Editorpanel steht für diesen Test gemerkt zu (VOR dem Laden aufrufen). Ein Test, der das Infopanel eines Orts oder das
 * Menü am Objekt prüft, braucht es aus dem Weg: Steht das Editorpanel vorn, zieht das Infopanel nur im Hintergrund nach
 * (`subject-selection.ts`, Legacy: zwei Laschen, ein Slot). Derselbe Schlüssel, den die Lasche beim Zuklappen schreibt.
 */
export async function editorPanelGemerktZu(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            localStorage.setItem("avesmaps3d.panel.editorpanel", "zu");
        } catch {
            // ohne Speicher steht es offen; der Test sieht es dann am Infopanel
        }
    });
}

/** Das sichtbare Ortseditor-Fenster (ein abgelegtes ist eingehängt, aber nicht gezeichnet). */
export const fenster = (page: Page): Locator => page.locator('dialog[data-lage][open][data-testid^="ortseditor-"]');
export const zeile = (page: Page, name: string): Locator =>
    fenster(page).locator('[data-testid$="-orte-zeile"]', { hasText: new RegExp(`^${name}`) });
