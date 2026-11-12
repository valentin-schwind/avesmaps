import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AdminKarteneinstellungen,
    KARTENEINSTELLUNGEN,
    KARTENEINSTELLUNG_PANELE,
    karteneinstellung,
    karteneinstellungGleich,
    karteneinstellungImRahmen,
    kurvenWert,
} from "@avesmaps3d/shared";
import { isMessageKey, locale } from "../src/i18n/i18n.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italiano } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import {
    createKarteneinstellungen,
    kartenansichtAusAdresse,
    leseEingabe,
    panele,
    schienenWert,
} from "../src/auth/karteneinstellungen.ts";
import { ladeStartansicht, leseKartenEinstellungen, startansicht } from "../src/map/start-view.ts";

/**
 * Der Eintrag „Karteneinstellungen“ (WI-0166) ohne Browser: die Zeilen aus Tafel und Abweichungen, die getippten Werte samt
 * Punkt mit zwei Feldern, die Ansicht aus der Adresse, der Schreibweg gegen einen nachgebauten Server, der tolerante Leseweg
 * beim Start der Karte und die Vollständigkeit der Sprachtafeln.
 */

const NOW = new Date("2026-10-15T20:00:00Z");

function stand(patch: Partial<AdminKarteneinstellungen> = {}): AdminKarteneinstellungen {
    const body: AdminKarteneinstellungen = {
        now: NOW.toISOString(),
        revision: 4,
        source: "database",
        rows: [{ id: "startZoom", value: 3, changedAt: "2026-10-15T19:14:00Z", changedBy: "Rondrikan" }],
        unknownKeys: [],
        ...patch,
    };
    expect(Value.Check(AdminKarteneinstellungen, body)).toBe(true);
    return body;
}

describe("Panel „OceanShader an/aus“ (WI-0288, Betreiber 2026-11-08)", () => {
    it("🔴 Schalter (Vorgabe an), Größe des Glanzpunkts und Stärke des Glanzes (je 1); die Startansicht liest tolerant", () => {
        const panel = KARTENEINSTELLUNG_PANELE.find((eintrag) => eintrag.id === "ozeanShader");
        expect(panel?.werte.map((wert) => [wert.id, wert.art, wert.vorgabe])).toEqual([
            ["ozeanShaderAn", "schalter", true],
            ["ozeanGlanzpunkt", "zahl", 1],
            ["ozeanGlanz", "zahl", 1],
        ]);
        // Der Schalter belegt zwei Zeilen, damit beide Zahlen untereinander in der zweiten Spalte stehen.
        expect(panel?.werte[0]?.rasterZeilen).toBe(2);
        expect(leseKartenEinstellungen({ ozeanGlanz: 2.5, ozeanGlanzpunkt: 9 })).toMatchObject({
            ozeanGlanz: 2.5,
            ozeanGlanzpunkt: 1,
        });
        expect(leseKartenEinstellungen({}).ozeanShaderAn).toBe(true);
        expect(leseKartenEinstellungen({ ozeanShaderAn: false }).ozeanShaderAn).toBe(false);
        expect(leseKartenEinstellungen({ ozeanShaderAn: "aus" }).ozeanShaderAn).toBe(true);
    });
});

describe("Panel „PDF Exporter“ (WI-0306, Vali 2026-11-10)", () => {
    it("🔴 „Jede Etappe“ und Reisetagebuch aus ab Werk; der Dateiname ist ein Text, leer heißt der Satz der Sprachtafel", () => {
        expect(karteneinstellung("pdfEtappenArt")?.vorgabe).toBe("lang");
        expect(karteneinstellung("pdfTagebuch")?.vorgabe).toBe(false);
        const datei = karteneinstellung("pdfDateiname");
        if (datei === undefined || datei.art !== "text") throw new Error("pdfDateiname fehlt in der Tafel");
        expect(leseEingabe(datei, { pdfDateiname: "  Avesmaps   {von} bis {bis} " }, "")).toBe(
            "Avesmaps {von} bis {bis}",
        );
        expect(leseEingabe(datei, { pdfDateiname: "a/b" }, "")).toEqual({
            key: "admin.karteneinstellungen.invalid.text",
            params: { max: "120" },
        });
        expect(leseEingabe(datei, { pdfDateiname: "x".repeat(121) }, "")).toMatchObject({
            key: "admin.karteneinstellungen.invalid.text",
        });
        expect(leseKartenEinstellungen({ pdfDateiname: "x:y" }).pdfDateiname).toBe("");
        expect(leseKartenEinstellungen({ pdfEtappenArt: "kurz", pdfTagebuch: true })).toMatchObject({
            pdfEtappenArt: "kurz",
            pdfTagebuch: true,
        });
        expect(leseKartenEinstellungen({ pdfEtappenArt: "mittel" }).pdfEtappenArt).toBe("lang");
    });

    it("die Wahlen heißen wie im Dialog „Reise als PDF“", () => {
        const zeilen = panele(stand({ rows: [] }), NOW).find((panel) => panel.id === "pdfExporter")!.zeilen;
        const texte = (id: string): string[] =>
            zeilen.find((zeile) => zeile.einstellung.id === id)!.optionen.map((option) => option.text);
        expect(texte("pdfEtappenArt")).toEqual([de["reisePdf.etappen.kurz"], de["reisePdf.etappen.lang"]]);
        expect(texte("pdfKartenbild")).toEqual(["Ganze Route", "Ausschnitt", "Ohne Bild"]);
        expect(texte("pdfKarte")[0]).toBe("Was die Karte gerade zeigt");
        expect(texte("pdfKarte")).toContain("Politisch");
        expect(texte("pdfKarte")).toContain("Derographie, Höhenstufen");
        expect(texte("pdfSprache").slice(0, 2)).toEqual(["Sprache der Seite", "Deutsch"]);
        expect(zeilen.find((zeile) => zeile.einstellung.id === "pdfDateiname")!.vorgabeText).toBe("leer");
    });
});

describe("Panel „Zoomkurve“ (Betreiber 2026-11-09: „wie bei lüfterkurven“)", () => {
    const einstellung = karteneinstellung("zoomKurve");

    it("🔴 eine Kurve aus Stützpunkten: Vorgabe 25° bei 1, 45° bei 5, 80° bei 8,5 (angezeigter Zoom); geprüft wird Zahl, Grenzen und Folge", () => {
        if (einstellung === undefined || einstellung.art !== "kurve") throw new Error("zoomKurve fehlt in der Tafel");
        expect(einstellung.vorgabe).toEqual([
            { zoom: 2, neigung: 25 },
            { zoom: 6, neigung: 45 },
            { zoom: 9.5, neigung: 80 },
        ]);
        const gut = [
            { zoom: 2, neigung: 30 },
            { zoom: 7.25, neigung: 60 },
        ];
        expect(karteneinstellungImRahmen(einstellung, gut)).toBe(true);
        for (const falsch of [
            [{ zoom: 2, neigung: 30 }],
            [
                { zoom: 7, neigung: 30 },
                { zoom: 5, neigung: 40 },
            ],
            [
                { zoom: 2, neigung: 30 },
                { zoom: 9.6, neigung: 40 },
            ],
            [
                { zoom: 2, neigung: 30 },
                { zoom: 4, neigung: 81 },
            ],
            [
                { zoom: 2, neigung: 30, x: 1 },
                { zoom: 4, neigung: 40 },
            ],
            "25",
        ])
            expect(karteneinstellungImRahmen(einstellung, falsch)).toBe(false);
        expect(leseEingabe(einstellung, { zoomKurve: JSON.stringify(gut) }, einstellung.vorgabe)).toEqual(gut);
        expect(leseEingabe(einstellung, { zoomKurve: "kaputt" }, einstellung.vorgabe)).toMatchObject({
            key: "admin.karteneinstellungen.invalid.curve",
        });
    });

    it("🔴 gleich heißt Punkt für Punkt gleich; die Karte liest die Kurve tolerant", () => {
        expect(karteneinstellungGleich([{ zoom: 2, neigung: 25 }], [{ zoom: 2, neigung: 25 }])).toBe(true);
        expect(karteneinstellungGleich([{ zoom: 2, neigung: 25 }], [{ zoom: 2, neigung: 26 }])).toBe(false);
        expect(leseKartenEinstellungen({}).zoomKurve).toEqual(einstellung?.vorgabe);
        const eigene = [
            { zoom: 3, neigung: 20 },
            { zoom: 8, neigung: 70 },
        ];
        expect(leseKartenEinstellungen({ zoomKurve: eigene }).zoomKurve).toEqual(eigene);
        expect(leseKartenEinstellungen({ zoomKurve: [{ zoom: 3 }] }).zoomKurve).toEqual(einstellung?.vorgabe);
    });

    it("die Kurve zwischen den Punkten gerade, außen waagerecht", () => {
        const punkte = [
            { zoom: 2, neigung: 20 },
            { zoom: 4, neigung: 40 },
        ];
        expect([1, 2, 3, 4, 9].map((z) => kurvenWert(punkte, z))).toEqual([20, 20, 30, 40, 40]);
    });
});

describe("Eine Farbe als Einstellung (Kanal OPS-000083)", () => {
    const einstellung = karteneinstellung("ortFarbeInoffiziell");

    it("🔴 Vorgaben aus dem Kanon, getippt wird #rrggbb, Großbuchstaben werden klein, alles andere wird abgewiesen", () => {
        if (einstellung === undefined) throw new Error("ortFarbeInoffiziell fehlt in der Tafel");
        expect(einstellung.vorgabe).toBe("#a66a3f");
        expect(karteneinstellung("ortFarbeOffiziell")?.vorgabe).toBe("#cc2f2a");
        expect(karteneinstellung("bauwerkFarbeOffiziell")?.vorgabe).toBe("#635497");
        expect(karteneinstellung("bauwerkFarbeInoffiziell")?.vorgabe).toBe("#c49ac7");
        expect(leseEingabe(einstellung, { ortFarbeInoffiziell: " #A66A40 " }, "#a66a3f")).toBe("#a66a40");
        for (const falsch of ["rot", "#a66", "#a66a3g", "a66a3f"]) {
            expect(leseEingabe(einstellung, { ortFarbeInoffiziell: falsch }, "#a66a3f")).toEqual({
                key: "admin.karteneinstellungen.invalid.colour",
            });
        }
    });

    it("🔴 ein gespeicherter Wert, der keine Farbe ist, gilt beim Start der Karte nicht", () => {
        expect(leseKartenEinstellungen({ ortFarbeOffiziell: "url(x)" }).ortFarbeOffiziell).toBe("#cc2f2a");
        expect(leseKartenEinstellungen({ ortFarbeOffiziell: "#102030" }).ortFarbeOffiziell).toBe("#102030");
    });
});

describe("Die Zeilen der Panele", () => {
    it("🔴 die Startansicht mit Startposition und Startzoom; der verstellte Zoom trägt „statt 2,5“", () => {
        locale.value = "de";
        const [startansichtPanel] = panele(stand(), NOW);
        expect(startansichtPanel?.titel).toBe("Startansicht");
        const [position, zoom] = startansichtPanel?.zeilen ?? [];
        expect(position).toMatchObject({
            name: "Startposition",
            abweichend: false,
            texte: { "startPosition.x": "518,75", "startPosition.y": "504" },
            vorgabeText: "x 518,75 · y 504",
            folgeSatz: "Wirkt beim nächsten Öffnen der Karte.",
            statt: null,
            stand: null,
        });
        expect(zoom).toMatchObject({
            name: "Startzoom",
            abweichend: true,
            eingestellt: 3,
            texte: { startZoom: "3" },
            statt: "statt 2,5",
        });
        expect(zoom?.stand).toContain("Rondrikan");
    });

    it("die Schiene nennt, wie viele Einstellungen verstellt sind, und schweigt ohne", () => {
        expect(schienenWert(stand())).toBe("1 verstellt");
        expect(schienenWert(stand({ rows: [] }))).toBeUndefined();
        expect(schienenWert(null)).toBeUndefined();
    });
});

describe("Getippte Werte", () => {
    const position = karteneinstellung("startPosition")!;
    const zoom = karteneinstellung("startZoom")!;

    it("🔴 ein Punkt aus zwei Feldern; ein ungetipptes Feld behält seinen Wert", () => {
        expect(leseEingabe(position, { "startPosition.x": "500" }, { x: 518.75, y: 504 })).toEqual({ x: 500, y: 504 });
        expect(leseEingabe(position, { "startPosition.x": "500,5", "startPosition.y": "480" }, { x: 1, y: 1 })).toEqual(
            {
                x: 500.5,
                y: 480,
            },
        );
    });

    it("🔴 außerhalb der Karte oder keine Zahl: ein Satz am Feld, nichts geht hinaus", () => {
        expect(leseEingabe(position, { "startPosition.y": "2000" }, { x: 518.75, y: 504 })).toEqual({
            key: "admin.karteneinstellungen.invalid.pointRange",
            params: { minX: "0", maxX: "1.024", minY: "0", maxY: "1.024" },
        });
        expect(leseEingabe(zoom, { startZoom: "viel" }, 2.5)).toEqual({
            key: "admin.karteneinstellungen.invalid.number",
        });
        expect(leseEingabe(zoom, { startZoom: "12" }, 2.5)).toMatchObject({
            key: "admin.karteneinstellungen.invalid.range",
        });
        expect(leseEingabe(zoom, { startZoom: "3,25" }, 2.5)).toBe(3.25);
    });
});

describe("Die Ansicht der Karte aus der Adresse", () => {
    it("🔴 Mitte und Zoom, auf zwei Stellen gerundet", () => {
        expect(kartenansichtAusAdresse("#x=512.345&y=498.001&z=3.14159&series=original&view=standard")).toMatchObject({
            startPosition: { x: 512.35, y: 498 },
            startZoom: 3.14,
        });
    });

    it("unvollständig oder außerhalb der Karte: keine Ansicht", () => {
        expect(kartenansichtAusAdresse("")).toBeNull();
        expect(kartenansichtAusAdresse("#x=512&y=498")).toBeNull();
        expect(kartenansichtAusAdresse("#x=2048&y=498&z=3")).toBeNull();
    });
});

type Answer = { status: number; body?: unknown };
function server(...answers: Answer[]) {
    const calls: { url: string; method: string; body: Record<string, unknown> | undefined }[] = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        });
        const answer = answers.shift() ?? { status: 500 };
        return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), { status: answer.status });
    };
    return { calls, fetcher: fetcher as typeof fetch };
}
const RECEIPT: Answer = {
    status: 200,
    body: { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
};

describe("Verstellen, Zurücksetzen, Ansicht übernehmen", () => {
    it("🔴 ein Punkt geht als EIN Wert hinaus, mit Revision und Kennung", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, {
            status: 200,
            body: stand({ revision: 5 }),
        });
        const h = createKarteneinstellungen({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("startPosition.x", "520");
        h.tippe("startPosition.y", "500");
        await h.uebernimm("startPosition");
        const posts = calls.filter((call) => call.method === "POST");
        expect(posts).toHaveLength(1);
        expect(posts[0]?.url).toBe("/api/admin/system/karteneinstellungen");
        expect(posts[0]?.body).toMatchObject({ baseRevision: 4, id: "startPosition", value: { x: 520, y: 500 } });
        expect(h.felder.value["startPosition.x"]).toBeUndefined();
        expect(h.busy.value).toBeNull();
    });

    it("🔴 die Vorgabe eingetippt heißt löschen, nicht speichern; derselbe Wert ist keine Änderung", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, {
            status: 200,
            body: stand({ rows: [], revision: 5 }),
        });
        const h = createKarteneinstellungen({ fetcher, ask: async () => true });
        await h.load();
        h.tippe("startZoom", "2,5");
        await h.uebernimm("startZoom");
        expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ id: "startZoom", value: null });
        h.tippe("startZoom", "2,5");
        await h.uebernimm("startZoom");
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    });

    it("🔴 Ansicht übernehmen schreibt nur, was sich unterscheidet, nacheinander mit der jeweils neuen Revision", async () => {
        const { calls, fetcher } = server({ status: 200, body: stand() }, RECEIPT, {
            status: 200,
            body: stand({
                revision: 5,
                rows: [
                    { id: "startPosition", value: { x: 400, y: 600 }, changedAt: null, changedBy: null },
                    { id: "startZoom", value: 3, changedAt: null, changedBy: null },
                ],
            }),
        });
        const h = createKarteneinstellungen({ fetcher, ask: async () => true });
        await h.load();
        await h.uebernimmAnsicht({ startPosition: { x: 400, y: 600 }, startZoom: 3 });
        const posts = calls.filter((call) => call.method === "POST");
        // Der Zoom stand schon auf 3: nur die Position geht hinaus.
        expect(posts.map((post) => post.body?.["id"])).toEqual(["startPosition"]);
        expect(h.busy.value).toBeNull();
    });

    it("eine Ablehnung steht an der Einstellung; der zweite Wert einer Ansicht bleibt dann liegen", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: stand({ rows: [] }) },
            { status: 409, body: { error: { code: "edit_conflict", message: "x" } } },
            { status: 200, body: stand({ rows: [], revision: 6 }) },
        );
        const h = createKarteneinstellungen({ fetcher, ask: async () => true });
        await h.load();
        await h.uebernimmAnsicht({ startPosition: { x: 400, y: 600 }, startZoom: 4 });
        expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
        expect(h.ergebnis.value?.id).toBe("startPosition");
        expect(h.ergebnis.value?.result.ok).toBe(false);
    });
});

describe("Der Start der Karte (map/start-view.ts)", () => {
    it("🔴 ohne Antwort gelten die Vorgaben: über dem Namen „Aventurien“ auf Zoom 2,5", async () => {
        const kaputt = (async () => {
            throw new Error("offline");
        }) as typeof fetch;
        expect(await ladeStartansicht(kaputt)).toMatchObject({ startPosition: { x: 518.75, y: 504 }, startZoom: 2.5 });
    });

    it("🔴 tolerant: unbekannte Felder übergangen, ein unpassendes Feld fällt auf die Vorgabe", () => {
        expect(
            leseKartenEinstellungen({
                revision: 3,
                startPosition: { x: 2000, y: 1 },
                startZoom: 4,
                spaeterHinzugekommen: true,
            }),
        ).toMatchObject({ startPosition: { x: 518.75, y: 504 }, startZoom: 4 });
        expect(leseKartenEinstellungen(null)).toMatchObject({ startPosition: { x: 518.75, y: 504 }, startZoom: 2.5 });
    });

    it("eine Antwort des Servers wird die Startansicht", async () => {
        const { fetcher, calls } = server({
            status: 200,
            body: { revision: 7, startPosition: { x: 300, y: 700 }, startZoom: 4.5 },
        });
        await ladeStartansicht(fetcher);
        expect(calls[0]?.url).toBe("/api/map-settings");
        expect(startansicht()).toMatchObject({ startPosition: { x: 300, y: 700 }, startZoom: 4.5 });
    });
});

describe("Sprachtafeln", () => {
    it("🔴 jede Einstellung und jedes Panel hat Namen und Satz in allen fünf Sprachen", () => {
        const tafeln = { de, en, fr, nl, it: italiano } as Record<string, Record<string, string>>;
        const schluessel = [
            ...KARTENEINSTELLUNG_PANELE.flatMap((panel) => [
                `admin.karteneinstellungen.panel.${panel.id}.titel`,
                `admin.karteneinstellungen.panel.${panel.id}.wirkung`,
            ]),
            ...KARTENEINSTELLUNGEN.flatMap((einstellung) => [
                `admin.karteneinstellungen.wert.${einstellung.id}.name`,
                `admin.karteneinstellungen.wert.${einstellung.id}.satz`,
                `admin.karteneinstellungen.folge.${einstellung.folge}`,
            ]),
            ...KARTENEINSTELLUNGEN.flatMap((einstellung) =>
                einstellung.abschnitt === undefined
                    ? []
                    : [`admin.karteneinstellungen.abschnitt.${einstellung.abschnitt}`],
            ),
            "admin.karteneinstellungen.wert.planerReisestunden.einheit",
            "admin.karteneinstellungen.on",
            "admin.karteneinstellungen.off",
            "admin.tab.karteneinstellungen",
            "admin.foot.karteneinstellungen",
            "admin.event.system.map_setting_changed",
        ];
        for (const key of schluessel) {
            expect(isMessageKey(key), key).toBe(true);
            for (const [sprache, tafel] of Object.entries(tafeln))
                expect(tafel[key], `${sprache}: ${key}`).toBeTruthy();
        }
    });
});

describe("Name des Reiters", () => {
    it("🔴 der Reiter heißt „Standardwerte“ (Vali 2026-11-04), auch wo ein Satz ihn nennt; das Panel Routenplaner bleibt", () => {
        expect(de["admin.tab.karteneinstellungen"]).toBe("Standardwerte");
        expect(de["admin.karteneinstellungen.loadFailed"]).toBe("Die Standardwerte ließen sich nicht laden.");
        expect(de["admin.karteneinstellungen.leadFirst"]).toBe("Die Standardwerte");
        expect(de["admin.event.system.map_setting_changed"]).toBe("Standardwert verstellt");
        expect(en["admin.tab.karteneinstellungen"]).toBe("Default values");
        for (const tafel of [de, en, fr, nl, italiano] as Record<string, string>[])
            for (const [key, text] of Object.entries(tafel))
                if (key.startsWith("admin."))
                    expect(text, key).not.toMatch(/Karteneinstellung|Map setting|map setting/);
        expect(de["admin.karteneinstellungen.panel.routenplaner.titel"]).toBe("Routenplaner");
    });
});

describe("Panel Routenplaner im Reiter", () => {
    it("🔴 14 Zeilen in zwei Abschnitten mit den Wörtern des Planers; die Vorgaben stehen in den Feldern", () => {
        locale.value = "de";
        const routenplaner = panele(stand({ rows: [] }), NOW).find((panel) => panel.id === "routenplaner")!;
        expect(routenplaner.titel).toBe("Routenplaner");
        expect(routenplaner.zeilen).toHaveLength(14);
        expect(routenplaner.zeilen.flatMap((zeile) => zeile.einstellung.abschnitt ?? [])).toEqual([
            "transportmittel",
            "reiseoptionen",
        ]);
        const land = routenplaner.zeilen.find((zeile) => zeile.einstellung.id === "planerLandTransport")!;
        expect(land.optionen.find((option) => option.wert === land.texte["planerLandTransport"])?.text).toBe(
            "Reisegruppe zu Fuß",
        );
        const eile = routenplaner.zeilen.find((zeile) => zeile.einstellung.id === "planerEiltempo")!;
        expect(eile.texte).toEqual({ planerEiltempo: "false" });
        expect(eile.vorgabeText).toBe("aus");
        const beginn = routenplaner.zeilen.find((zeile) => zeile.einstellung.id === "planerReisebeginn")!;
        expect(beginn.optionen[0]).toEqual({ wert: "unbestimmt", text: "Unbestimmt" });
        expect(beginn.optionen).toHaveLength(14);
        expect(beginn.optionen.at(-1)).toEqual({ wert: "namenlos", text: "Namenlose Tage (Frühling)" });
        expect(beginn.vorgabeText).toBe("Unbestimmt (keine Jahreszeiten)");
    });

    it("🔴 Auswahl, Kästchen und Reisebeginn werden gelesen wie die Felder; der Tag allein behält seinen Monat", () => {
        const beginn = karteneinstellung("planerReisebeginn")!;
        expect(leseEingabe(beginn, { "planerReisebeginn.monat": "praios" }, "unbestimmt")).toEqual({
            monat: "praios",
            tag: 1,
        });
        expect(leseEingabe(beginn, { "planerReisebeginn.tag": "12" }, { monat: "praios", tag: 1 })).toEqual({
            monat: "praios",
            tag: 12,
        });
        expect(leseEingabe(beginn, { "planerReisebeginn.tag": "31" }, { monat: "praios", tag: 1 })).toMatchObject({
            key: "admin.karteneinstellungen.invalid.day",
        });
        expect(leseEingabe(beginn, { "planerReisebeginn.tag": "5" }, { monat: "namenlos", tag: 1 })).toEqual({
            monat: "namenlos",
            tag: 5,
        });
        expect(leseEingabe(beginn, { "planerReisebeginn.tag": "6" }, { monat: "namenlos", tag: 1 })).toMatchObject({
            key: "admin.karteneinstellungen.invalid.day",
            params: { min: "1", max: "5" },
        });
        expect(leseEingabe(beginn, { "planerReisebeginn.monat": "unbestimmt" }, { monat: "praios", tag: 3 })).toBe(
            "unbestimmt",
        );
        expect(leseEingabe(karteneinstellung("planerEiltempo")!, { planerEiltempo: "true" }, false)).toBe(true);
        expect(leseEingabe(karteneinstellung("planerRoutenwahl")!, { planerRoutenwahl: "shortest" }, "fastest")).toBe(
            "shortest",
        );
        expect(leseEingabe(karteneinstellung("planerReisestunden")!, { planerReisestunden: "8,3" }, 8)).toMatchObject({
            key: "admin.karteneinstellungen.invalid.rangeStep",
        });
    });

    it("🔴 eine Wahl geht sofort hinaus, ohne Tippen; die Vorgabe zu wählen setzt zurück", async () => {
        const { calls, fetcher } = server(
            { status: 200, body: stand({ rows: [] }) },
            RECEIPT,
            {
                status: 200,
                body: stand({
                    revision: 5,
                    rows: [{ id: "planerEiltempo", value: true, changedAt: null, changedBy: null }],
                }),
            },
            RECEIPT,
            { status: 200, body: stand({ revision: 6, rows: [] }) },
        );
        const h = createKarteneinstellungen({ fetcher, ask: async () => true });
        await h.load();
        await h.waehle("planerEiltempo", "true");
        await h.waehle("planerEiltempo", "false");
        const posts = calls.filter((call) => call.method === "POST").map((call) => call.body);
        expect(posts).toEqual([
            expect.objectContaining({ id: "planerEiltempo", value: true, baseRevision: 4 }),
            expect.objectContaining({ id: "planerEiltempo", value: null, baseRevision: 5 }),
        ]);
    });
});
