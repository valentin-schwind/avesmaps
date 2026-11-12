import type { Page } from "@playwright/test";
import type { ApiZahlen, BesuchZahlen } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Die gestellten Zahlen der Besucherstatistik (WI-0138). Sie stammen aus Legacys echtem Abzug vom 2026-10-12
 * (`project-control/discovery/legacy-nutzung-2026-10-12/`), damit Test und Blatt dasselbe zeigen wie die Anwendung später.
 */

const ZAHLEN: BesuchZahlen = {
    sorte: "visitor",
    tage: 30,
    von: "2026-09-13",
    bis: "2026-10-12",
    kennungAktiv: true,
    kennzahlen: {
        aufrufe: 21156,
        eindeutigeMittel: 520,
        routen: 11100,
        editorenSpitze: 18,
        editorenAb: null,
        besterTag: 1080,
        besterTagAm: "2026-10-04",
        wachstum: 0.44,
        sucheLeer: 318,
        // Die Spitze gab es in Legacy nicht (WI-0213); erfunden, mit dem Tag der Spitze (Betreiber 2026-10-19).
        gleichzeitigSpitze: 64,
        gleichzeitigAm: "2026-10-07",
    },
    verlauf: Array.from({ length: 30 }, (_, tag) => ({
        // 🪤 Datum richtig fortzählen, nicht den Tag hochzählen: `2026-09-42` stand am 2026-10-13 im Bild.
        tag: new Date(Date.UTC(2026, 8, 13 + tag)).toISOString().slice(0, 10),
        aufrufe:
            [
                440, 499, 461, 392, 469, 477, 516, 524, 372, 443, 523, 465, 464, 613, 669, 552, 569, 478, 516, 534, 600,
                827, 1401, 1402, 1213, 1096, 1047, 1365, 1416, 813,
            ][tag] ?? 0,
        eindeutige:
            [
                346, 351, 341, 309, 346, 365, 360, 386, 292, 319, 378, 349, 368, 400, 468, 405, 424, 387, 405, 411, 459,
                602, 1034, 1080, 934, 824, 808, 900, 941, 610,
            ][tag] ?? 0,
        editoren:
            [
                5, 14, 18, 15, 8, 10, 6, 7, 9, 10, 4, 8, 15, 7, 10, 16, 13, 17, 10, 12, 7, 11, 13, 13, 7, 10, 12, 14, 9,
                10,
            ][tag] ?? 0,
    })),
    tafel: Array.from({ length: 7 }, (_, zeile) =>
        Array.from({ length: 24 }, (_, stunde) =>
            Math.round(80 * Math.exp(-((stunde - 18) ** 2) / 30) + 20 + zeile * 3),
        ),
    ),
    dauer: {
        sitzungen: 75477,
        median: 40,
        mittel: 210,
        koerbe: [
            { name: "00000", wert: 28152 },
            { name: "00030", wert: 6155 },
            { name: "00060", wert: 9361 },
            { name: "00300", wert: 15232 },
            { name: "01800", wert: 889 },
        ],
        ohne: 0,
    },
    filter: null,
    ausgeschlossen: { aufrufe: 0, gruende: [] },
    zoom: {
        ruhen: 7600,
        median: 4,
        mittel: 3.9,
        stufen: [
            { name: "2", wert: 900 },
            { name: "3", wert: 1600 },
            { name: "4", wert: 2500 },
            { name: "5", wert: 1600 },
            { name: "6", wert: 700 },
            { name: "7", wert: 300 },
        ],
    },
    listen: {
        // Zwölf Länder: mehr als die ersten acht, damit das Aufklappen etwas zu zeigen hat (WI-0191).
        land: {
            eintraege: [
                { name: "AT", wert: 5067 },
                { name: "CH", wert: 2155 },
                { name: "NL", wert: 980 },
                { name: "FR", wert: 870 },
                { name: "IT", wert: 760 },
                { name: "ES", wert: 640 },
                { name: "PL", wert: 521 },
                { name: "BE", wert: 410 },
                { name: "DK", wert: 330 },
                { name: "SE", wert: 260 },
                { name: "CZ", wert: 190 },
                { name: "LU", wert: 120 },
            ],
            gesamt: 12,
        },
        // Die Kennung nach ISO 3166-2, wie der Geodatensatz sie künftig liefert; „Hessen“ steht für die Zeilen, die noch
        // mit dem Namen gezählt wurden (der Rückfall in `regionWert`).
        region: {
            eintraege: [
                { name: "NW", wert: 22708 },
                { name: "Hessen", wert: 14900 },
                { name: "BY", wert: 13046 },
            ],
            gesamt: 3,
        },
        einstieg: {
            eintraege: [
                { name: "direkt", wert: 65229 },
                { name: "Google", wert: 19948 },
                { name: "Wiki-Aventurica", wert: 6519 },
            ],
            gesamt: 3,
        },
        geraet: {
            eintraege: [
                { name: "rechner", wert: 81163 },
                { name: "telefon", wert: 24029 },
                { name: "tablet", wert: 618 },
            ],
            gesamt: 3,
        },
        system: {
            eintraege: [
                { name: "Windows", wert: 51000 },
                { name: "iOS", wert: 17000 },
                { name: "Android", wert: 19000 },
            ],
            gesamt: 3,
        },
        browser: {
            eintraege: [
                { name: "Chrome", wert: 54000 },
                { name: "Safari", wert: 23000 },
            ],
            gesamt: 2,
        },
        zoomband: {
            eintraege: [
                { name: "mittel", wert: 4100 },
                { name: "nah", wert: 2600 },
                { name: "weit", wert: 900 },
            ],
            gesamt: 3,
        },
        fenster: { eintraege: [{ name: "bis1600", wert: 5200 }], gesamt: 1 },
        faehig: {
            eintraege: [
                { name: "3d", wert: 99000 },
                { name: "finger", wert: 24000 },
            ],
            gesamt: 2,
        },
        sprache: {
            eintraege: [
                { name: "de", wert: 94126 },
                { name: "en", wert: 9940 },
            ],
            gesamt: 2,
        },
        spracheEingestellt: {
            eintraege: [
                { name: "de", wert: 8800 },
                { name: "en", wert: 1100 },
            ],
            gesamt: 2,
        },
        theme: {
            eintraege: [
                { name: "light", wert: 6100 },
                { name: "dark", wert: 3800 },
            ],
            gesamt: 2,
        },
        // Der Server schreibt Legacys Namen auf unsere um (heutigeDimension), deshalb steht hier „standard“, nicht
        // „deregraphic“. Was Legacy allein kannte, kommt roh an und braucht im Panel einen Namen: „old“, „klima“.
        ansicht: {
            eintraege: [
                { name: "standard", wert: 9053 },
                { name: "political", wert: 8340 },
                { name: "landscapes", wert: 2400 },
            ],
            gesamt: 3,
        },
        untergrund: { eintraege: [{ name: "old", wert: 412 }], gesamt: 1 },
        ebene: {
            eintraege: [
                { name: "klima", wert: 318 },
                { name: "topographie", wert: 210 },
                { name: "hoehenstufen", wert: 90 },
            ],
            gesamt: 3,
        },
        mittel: {
            eintraege: [
                { name: "riverSailer", wert: 20744 },
                { name: "groupFoot", wert: 18932 },
            ],
            gesamt: 2,
        },
        option: {
            eintraege: [
                { name: "schnellste", wert: 26077 },
                { name: "kuerzeste", wert: 2771 },
            ],
            gesamt: 2,
        },
        orte: {
            eintraege: [
                { name: "Gareth", wert: 3617 },
                { name: "Punin", wert: 1774 },
            ],
            gesamt: 2,
        },
        routen: { eintraege: [{ name: "Gareth → Punin", wert: 113 }], gesamt: 1 },
        schalter: { eintraege: [], gesamt: 0 },
        // Gesuchte Ziele: zehn kommen mit, 318 gab es - der aufgeklappte Block sagt das (WI-0191 A9).
        suche: {
            eintraege: [
                { name: "Gareth", wert: 68 },
                { name: "Punin", wert: 54 },
                { name: "Havena", wert: 41 },
                { name: "Thorwal", wert: 37 },
                { name: "Al'Anfa", wert: 33 },
                { name: "Festum", wert: 28 },
                { name: "Elenvina", wert: 24 },
                { name: "Riva", wert: 19 },
                { name: "Grangor", wert: 15 },
                { name: "Khunchom", wert: 11 },
            ],
            gesamt: 318,
        },
        angesehen: {
            eintraege: [
                { name: "place", wert: 4820 },
                { name: "region", wert: 640 },
            ],
            gesamt: 2,
        },
        fehlschlag: {
            eintraege: [
                { name: "no_route", wert: 212 },
                { name: "point_not_on_land", wert: 61 },
            ],
            gesamt: 2,
        },
        dreid: {
            eintraege: [
                { name: "nur2d", wert: 7060 },
                { name: "in3d", wert: 2840 },
            ],
            gesamt: 2,
        },
    },
    // Das experimentelle Wetter (WI-0288): erfunden, aber in der Form, die `lesen.ts` liefert - `gerät:klasse`, nach Gerät und Klasse geordnet.
    wetter: {
        schalter: {
            eintraege: [
                { name: "wetter_wolken:on", wert: 412 },
                { name: "wetter_wind:on", wert: 268 },
                { name: "wetter_regenUndSchnee:on", wert: 190 },
                { name: "wetter_wolken:off", wert: 151 },
                { name: "wetter_niederschlag:on", wert: 133 },
                { name: "wetter_schneedecke:on", wert: 96 },
                { name: "wetter_stroemungen:on", wert: 58 },
                { name: "wetter_schneefallgrenze:on", wert: 12 },
            ],
            gesamt: 8,
        },
        lauf: {
            eintraege: [
                { name: "rechner", wert: 640 },
                { name: "telefon", wert: 215 },
            ],
            gesamt: 2,
        },
        start: {
            eintraege: [
                { name: "rechner:u1s", wert: 20 },
                { name: "rechner:1-2s", wert: 100 },
                { name: "rechner:2-3s", wert: 160 },
                { name: "rechner:3-4s", wert: 110 },
                { name: "rechner:4-5s", wert: 40 },
                { name: "rechner:5-6s", wert: 60 },
                { name: "rechner:6-7s", wert: 40 },
                { name: "rechner:7-8s", wert: 25 },
                { name: "rechner:8-9s", wert: 15 },
                { name: "rechner:9-10s", wert: 10 },
                { name: "rechner:10-15s", wert: 30 },
                { name: "rechner:15-20s", wert: 20 },
                { name: "rechner:20-30s", wert: 8 },
                { name: "rechner:ab30s", wert: 2 },
                { name: "telefon:2-3s", wert: 15 },
                { name: "telefon:3-4s", wert: 25 },
                { name: "telefon:4-5s", wert: 30 },
                { name: "telefon:5-6s", wert: 35 },
                { name: "telefon:6-7s", wert: 30 },
                { name: "telefon:7-8s", wert: 20 },
                { name: "telefon:8-9s", wert: 10 },
                { name: "telefon:10-15s", wert: 30 },
                { name: "telefon:15-20s", wert: 15 },
                { name: "telefon:20-30s", wert: 5 },
            ],
            gesamt: 24,
        },
        bildrate: {
            eintraege: [
                { name: "rechner:20-30", wert: 15 },
                { name: "rechner:30-40", wert: 45 },
                { name: "rechner:40-50", wert: 90 },
                { name: "rechner:50-60", wert: 240 },
                { name: "rechner:60-70", wert: 70 },
                { name: "rechner:110-120", wert: 25 },
                { name: "rechner:ab120", wert: 15 },
                { name: "telefon:u10", wert: 30 },
                { name: "telefon:10-20", wert: 35 },
                { name: "telefon:20-30", wert: 55 },
                { name: "telefon:30-40", wert: 45 },
                { name: "telefon:40-50", wert: 25 },
                { name: "telefon:50-60", wert: 25 },
            ],
            gesamt: 13,
        },
        spitze: {
            eintraege: [
                { name: "rechner:10-20", wert: 260 },
                { name: "rechner:20-30", wert: 150 },
                { name: "rechner:30-40", wert: 60 },
                { name: "rechner:40-50", wert: 30 },
                { name: "rechner:50-60", wert: 20 },
                { name: "rechner:60-70", wert: 10 },
                { name: "rechner:ab100", wert: 5 },
                { name: "telefon:20-30", wert: 30 },
                { name: "telefon:30-40", wert: 40 },
                { name: "telefon:40-50", wert: 30 },
                { name: "telefon:50-60", wert: 25 },
                { name: "telefon:60-70", wert: 15 },
                { name: "telefon:70-80", wert: 10 },
                { name: "telefon:90-100", wert: 5 },
                { name: "telefon:ab100", wert: 20 },
            ],
            gesamt: 15,
        },
        aufloesung: {
            eintraege: [
                { name: "rechner:25", wert: 90 },
                { name: "rechner:40", wert: 210 },
                { name: "rechner:60", wert: 150 },
                { name: "rechner:100", wert: 90 },
                { name: "telefon:15", wert: 80 },
                { name: "telefon:25", wert: 50 },
            ],
            gesamt: 6,
        },
        gpu: {
            eintraege: [
                { name: "rechner:nvidia", wert: 270 },
                { name: "rechner:amd", wert: 110 },
                { name: "rechner:intel", wert: 160 },
                { name: "rechner:apple", wert: 70 },
                { name: "rechner:software", wert: 8 },
                { name: "telefon:adreno", wert: 90 },
                { name: "telefon:mali", wert: 55 },
                { name: "telefon:apple", wert: 60 },
                { name: "telefon:unbekannt", wert: 5 },
            ],
            gesamt: 9,
        },
        fehler: {
            eintraege: [
                { name: "telefon:gleitkomma", wert: 24 },
                { name: "rechner:webgl2", wert: 6 },
                { name: "rechner:laden", wert: 3 },
            ],
            gesamt: 3,
        },
    },
    jetzt: { gesamt: 4, aktiv: 2, lesend: 2, verborgen: 0, editoren: 1, fensterMinuten: 5 },
    speicher: { zeilen: 5955, bytes: 1_130_496 },
};

/** Die Zahlen des Unterreiters „API"; die Form ist echt, die Werte stammen aus Legacys Abzug. */
const API_ZAHLEN: ApiZahlen = {
    tage: 30,
    von: "2026-09-13",
    bis: "2026-10-12",
    kennzahlen: { anfragen: 2_943_800, fehlerquote: 0.032, spitzenstunde: 18, takt: 811_626 },
    klassen: [
        { name: "2xx", wert: 2_849_933 },
        { name: "gestorben", wert: 81_777 },
        { name: "4xx", wert: 11_092 },
        { name: "5xx", wert: 998 },
    ],
    zonen: [
        { name: "karte", wert: 1_900_067 },
        { name: "editor", wert: 1_003_995 },
        { name: "offen", wert: 34_364 },
        { name: "uebrige", wert: 5_374 },
    ],
    wege: [
        { name: "/api/karte/kacheln", wert: 612_000 },
        { name: "/api/route", wert: 148_000 },
        { name: "/api/subjects/:kind/:id", wert: 96_000 },
    ],
    fehler: [
        { name: "/api/route|point_not_on_land", wert: 412 },
        { name: "/api/karte/kacheln|5xx", wert: 188 },
    ],
    stunden: Array.from({ length: 24 }, (_, stunde) =>
        Math.round(90_000 * Math.exp(-((stunde - 18) ** 2) / 30) + 9000),
    ),
    speicher: { zeilen: 5955, bytes: 1_130_496 },
};

export { ZAHLEN, API_ZAHLEN };

/** Öffnet die Karte im Editormodus mit gestellter Sitzung und gestellten Zahlen; der Reiter „Status“ ist danach wählbar. */
export async function oeffneStatistik(page: Page, zahlen: Partial<BesuchZahlen> = {}): Promise<void> {
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "editor" });
    await page.route("**/api/besuch/zahlen*", (route) => {
        const sorte = new URL(route.request().url()).searchParams.get("sorte") ?? "visitor";
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ...ZAHLEN, sorte, ...zahlen }),
        });
    });
    await page.route("**/api/besuch/schnittstellen*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(API_ZAHLEN) }),
    );
    await page.route("**/api/messwerte", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                server: {
                    cpu: 0.07,
                    rss: 588 * 1024 * 1024,
                    ramBelegt: 3.1 * 1024 ** 3,
                    ramGesamt: 8 * 1024 ** 3,
                    last: 0.21,
                    kerne: 4,
                    laeuftSeit: 9480,
                },
                jetzt: { besucher: 4, editoren: 1, fensterMinuten: 5 },
            }),
        }),
    );
    // Der Verlauf des Unterreiters „Server“ (WI-0141): 24 h in Fünf-Minuten-Fächern, sieben Tage, die Wochentafel.
    await page.route("**/api/messwerte/verlauf", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SERVER_VERLAUF()) }),
    );
    // Wer im Editor ist (WI-0141b, WI-0276): zwei online, einer davon an einem Objekt, einer nicht da — mit Rolle, Verantwortung und Gerät.
    await page.route("**/api/besuch/editoren", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                fensterMinuten: 5,
                editoren: [
                    {
                        id: "p1",
                        name: "Rondrikan",
                        rolle: "operator",
                        bezeichnung: "feminin",
                        sonderrollen: [
                            { sonderrolle: "ortskundiger", region: "Greifenfurt" },
                            { sonderrolle: "ortskundiger", region: "Weiden" },
                            { sonderrolle: "kurator", region: null },
                        ],
                        verantwortung: "Karte und Routen",
                        zuletzt: new Date().toISOString(),
                        online: true,
                        geraet: "Chrome auf Windows",
                        ansicht: "editor.status",
                        sitzungen: 2,
                        tageAktiv: 27,
                        bearbeitet: {
                            art: "path",
                            id: "b0000000-0000-4000-8000-000000000001",
                            name: "Tarle",
                            woran: "form",
                            seit: new Date(Date.now() - 12 * 60_000).toISOString(),
                        },
                        zuletztGeaendert: {
                            art: "path",
                            id: "b0000000-0000-4000-8000-000000000001",
                            name: "Tarle",
                            am: new Date(Date.now() - 3_600_000).toISOString(),
                        },
                        aenderungen: 157,
                    },
                    {
                        id: "p2",
                        name: "nics",
                        rolle: "editor",
                        verantwortung: "Landschaften",
                        zuletzt: new Date(Date.now() - 60_000).toISOString(),
                        online: true,
                        geraet: "Safari auf iPhone",
                        ansicht: "karte.landscapes",
                        sitzungen: 1,
                        tageAktiv: 12,
                        bearbeitet: null,
                        zuletztGeaendert: null,
                        aenderungen: 0,
                    },
                    {
                        id: "p3",
                        name: "alrik",
                        rolle: "editor",
                        verantwortung: null,
                        zuletzt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
                        online: false,
                        geraet: null,
                        ansicht: null,
                        sitzungen: 0,
                        tageAktiv: 3,
                        bearbeitet: null,
                        zuletztGeaendert: {
                            art: "place",
                            id: "b0000000-0000-4000-8000-000000000002",
                            name: "Luring",
                            am: new Date(Date.now() - 86_400_000).toISOString(),
                        },
                        aenderungen: 4,
                    },
                ],
            }),
        }),
    );
    // Die letzten Änderungen einer aufgeklappten Karte (WI-0276): drei am selben Weg, eine am Ort.
    await page.route("**/api/editor/changes?*", (route) => {
        const eintrag = (n: number, kind: string, id: string, name: string, summary: string) => ({
            operationId: `b0000000-0000-4000-9000-00000000000${String(n)}`,
            seq: 10 - n,
            at: new Date(Date.now() - n * 3_600_000).toISOString(),
            operation: `${kind}.update`,
            source: "editor",
            summary,
            actor: { kind: "person", id: "p1", name: "Rondrikan" },
            objects: [{ kind, id, name, action: `${kind}.updated`, changes: {} }],
        });
        const wegId = "b0000000-0000-4000-8000-000000000001";
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                entries: [
                    eintrag(1, "path", wegId, "Tarle", "Tarle geändert"),
                    eintrag(2, "path", wegId, "Tarle", "Tarle geändert"),
                    eintrag(3, "path", wegId, "Tarle", "Tarle geändert"),
                    eintrag(4, "place", "b0000000-0000-4000-8000-000000000002", "Luring", "Luring verschoben"),
                ],
                series: [],
            }),
        });
    });
    await page.route("**/api/besuch", (route) => route.fulfill({ status: 204, body: "" }));
    await page.route("**/api/besuch/ping", (route) => route.fulfill({ status: 204, body: "" }));
    await openMap(page, EDITOR_MODE);
    // 🪤 Seit WI-0141 steht das Panel am Rechner beim Laden offen (Betreiber 2026-10-14). Die Lasche ist ein Schalter:
    // Ein Klick auf das offene Panel würde es zuklappen. Darum nur klicken, wenn es wirklich zu ist.
    const panel = page.getByTestId("editor-panel");
    if (!(await panel.isVisible().catch(() => false))) await page.getByTestId("editor-panel-tab").click();
    await panel.waitFor({ state: "visible" });
}

/**
 * Ein Tag Serverlast mit Tagesgang, dazu sieben Tage und die Wochentafel (WI-0141). Eine Lücke am Vormittag ist Absicht:
 * Das Bild muss zeigen, dass dort nicht gemessen wurde, statt die Linie auf null zu ziehen.
 */
function SERVER_VERLAUF() {
    const jetzt = Date.UTC(2026, 9, 14, 12, 0, 0);
    const welle = (stunde: number): number => 0.18 + 0.22 * Math.sin(((stunde - 6) / 24) * 2 * Math.PI) ** 2;
    const tag = Array.from({ length: 288 }, (_, i) => {
        const zeit = new Date(jetzt - (287 - i) * 5 * 60_000);
        const stunde = zeit.getUTCHours();
        const luecke = i > 120 && i < 140;
        return {
            zeit: zeit.toISOString(),
            cpu: luecke ? null : Number((welle(stunde) + (i % 7) * 0.004).toFixed(3)),
            last: luecke ? null : Number((welle(stunde) * 1.2).toFixed(3)),
            ramBelegt: luecke ? null : Math.round((0.36 + welle(stunde) * 0.2) * 8 * 1024 ** 3),
            ramGesamt: luecke ? null : 8 * 1024 ** 3,
        };
    });
    const tage = Array.from({ length: 7 }, (_, i) => ({
        tag: `2026-10-${String(8 + i).padStart(2, "0")}`,
        cpu: Number((0.16 + i * 0.012).toFixed(3)),
        cpuSpitze: Number((0.42 + i * 0.03).toFixed(3)),
        ram: Math.round(3.1 * 1024 ** 3),
        ramSpitze: Math.round(4.4 * 1024 ** 3),
    }));
    const tafel = Array.from({ length: 7 }, (_, zeile) =>
        Array.from({ length: 24 }, (_, stunde) =>
            zeile > 4 && stunde < 7 ? null : Number((welle(stunde) * (zeile > 4 ? 0.6 : 1)).toFixed(3)),
        ),
    );
    return { tag, tage, tafel, stunden: 168 };
}
