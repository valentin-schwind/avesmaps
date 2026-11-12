import { Value } from "@sinclair/typebox/value";
import { describe, expect, it, vi } from "vitest";
import { SubjectRef, type MapHistoryEntry, type MapHistoryObject, type MapHistoryObjectKind } from "@avesmaps3d/shared";
import { detailGegenstaende, serienDetail, zeilenAusFeldern } from "../src/aenderungen/aenderung-detail-modell";
import {
    bezeichneMit,
    feldBezeichnung,
    feldNameFuer,
    feldWert,
    nurFormGeaendert,
} from "../src/aenderungen/aenderung-felder";
import { ladeKnotenNamen, knotenName, setzeGebietsnamen, setzeKnotenNamen } from "../src/aenderungen/aenderung-namen";
import {
    GEBIRGE_PRAEFIX,
    objektZiel,
    oeffnenPlan,
    subjektRefVon,
    type ObjektZiel,
} from "../src/aenderungen/aenderung-modell";
import { lesbar, wertText } from "../src/aenderungen/aenderung-text";
import { t } from "../src/i18n/i18n";
import { createSubjectSelection, type OpenSubjectOptions } from "../src/info-panel/subject-selection";
import { createRevisionCache } from "../src/info-panel/subject-cache";
import type { SubjectAnswer, SubjectClient } from "../src/info-panel/subject-client";

/**
 * Feldnamen und Werte in „Änderungen“ ohne rohe Schlüssel und ohne rohes JSON (WI-0265 B5a2), und der Sprung vom Reiter in den Verlauf eines Objekts
 * je Art (Weg, Gebiet, Landschaft, Gipfel, Kraftlinie, Sprache, Ort). Die Texte selbst stehen in den Sprachtafeln; geprüft wird, dass jede Art ihre
 * Namen aus der Tafel ihres Editors bekommt und dass nirgends ein Schlüssel oder eine Klammer als Standardanzeige stehen bleibt.
 */

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const gegenstand = (
    kind: MapHistoryObjectKind,
    changes: MapHistoryObject["changes"],
    rest: Partial<MapHistoryObject> = {},
): MapHistoryObject => ({
    kind,
    id: id(1),
    name: "Blutzinnen",
    action: `${kind}.updated`,
    revisionBefore: 3,
    revisionAfter: 4,
    changes,
    ...rest,
});
const eintrag = (n: number, objects: MapHistoryObject[]): MapHistoryEntry => ({
    operationId: id(100 + n),
    seq: 1000 + n,
    at: new Date(2026, 9, 31, 14, n).toISOString(),
    operation: "landscape.update",
    source: "editor",
    actor: { kind: "person", name: "Vali" },
    objects,
});

/** Was als Standardanzeige nie stehen darf: eine Klammer, ein Anführungszeichen, ein Unterstrich, ein Schlüssel im camelCase. */
const roh = /[{}[\]"_]|[a-z][A-Z]/u;

describe("Feldnamen je Art: dieselben Texte wie im Editor der Art", () => {
    const FAELLE: readonly [MapHistoryObjectKind, string, Parameters<typeof t>[0]][] = [
        ["path", "subtype", "wegeditor.fenster.feld.wegtyp"],
        ["path", "labelVisible", "wegeditor.fenster.feld.nameAufKarte"],
        ["path", "wasserHoehen", "wegeditor.verlauf.wasserHoehen"],
        ["powerline", "curve", "kraftlinieneditor.verlauf.bogen"],
        ["powerline", "from", "kraftlinieneditor.verlauf.von"],
        ["landscape", "layer", "landschaftseditor.feld.ebene"],
        ["landscape", "gebirge", "landschaftseditor.teil.gebirge"],
        ["label", "showName", "landschaftseditor.feld.anzeigen"],
        ["peak", "height", "landschaftseditor.gipfel.feld.hoehe"],
        ["territory", "shortName", "gebietseditor.feld.kurzname"],
        ["territory", "parent", "gebietseditor.feld.obergebiet"],
        ["territory", "ruler", "infoPanel.field.oberhaupt"],
        ["sprache", "legende", "spracheditor.feld.legende"],
        ["area", "geometry", "entwurf.form"],
        // Die Inhalte (WI-0265 B6f): die Namen aus dem Fenster „Inhalte bearbeiten“.
        ["source", "sourceType", "inhalte.feld.typ"],
        ["source", "isOfficial", "inhalte.feld.offiziell"],
        ["source", "url", "inhalte.feld.adresse"],
        ["source", "attribution", "inhalte.feld.nennung"],
        ["source", "editorNote", "inhalte.literatur.feld.notiz"],
        ["work", "productType", "inhalte.literatur.feld.art"],
        ["work", "bfYear", "inhalte.literatur.feld.jahr"],
        ["work", "places", "inhalte.literatur.feld.orte"],
        ["lore", "art", "inhalte.vorkommen.feld.kategorie"],
        ["lore", "continent", "inhalte.vorkommen.kontinent"],
        ["lore", "sources", "inhalte.quellen.titel"],
        ["corpus", "key", "inhalte.korpora.feld.schluessel"],
        ["corpus", "licenseKey", "inhalte.feld.lizenz"],
    ];
    it.each(FAELLE)("🔴 %s · %s heißt wie in der Tafel seines Editors", (kind, feld, schluessel) => {
        const bez = feldBezeichnung(kind, feld);
        expect(bez.text).toBe(t(schluessel));
        expect(bez.schluessel).toBeUndefined();
    });

    it("🔴 `subtype` ist beim Ort die Ortsgröße und beim Weg die Wegart: kein Name einer fremden Art", () => {
        expect(feldNameFuer("place", "subtype")).not.toBe(feldNameFuer("path", "subtype"));
    });

    it("🔴 ein Feld ohne Namen steht als lesbares Wort da, der Schlüssel nur als Hinweis", () => {
        const bez = feldBezeichnung("source", "grat_breite");
        expect(bez.text).toBe("Grat breite");
        expect(bez.schluessel).toBe("grat_breite");
        expect(lesbar("showName")).toBe("Show name");
        expect(lesbar("x")).toBe("X");
        for (const kind of [
            "place",
            "path",
            "powerline",
            "landscape",
            "peak",
            "territory",
            "sprache",
            "source",
        ] as const)
            expect(roh.test(feldBezeichnung(kind, "irgendein_feld").text), kind).toBe(false);
    });

    it("🔴 B6f: kein Feld der Inhalte steht als camelCase-Schlüssel da (Quelle, Werk, Vorkommen, Korpus; ohne die Wiki-Stände)", () => {
        const felder: Readonly<Record<"source" | "work" | "lore" | "corpus", readonly string[]>> = {
            source: [
                "url",
                "title",
                "sourceType",
                "isOfficial",
                "licenseStatement",
                "licenseKey",
                "attribution",
                "editorNote",
                "active",
                "links",
                "created",
            ],
            work: [
                "title",
                "productType",
                "edition",
                "series",
                "bfYear",
                "bfLabel",
                "genre",
                "isOfficial",
                "editorNote",
                "active",
                "places",
                "complexityGm",
                "complexityPl",
                "authors",
                "fshopCode",
            ],
            lore: [
                "name",
                "art",
                "gruppe",
                "typ",
                "lebensraum",
                "synonyme",
                "continent",
                "kurzbeschreibung",
                "editorNote",
                "active",
                "places",
                "sources",
                "rules",
            ],
            corpus: [
                "key",
                "label",
                "form",
                "sourceType",
                "isOfficial",
                "licenseStatement",
                "licenseKey",
                "attribution",
                "editorNote",
                "quellen",
            ],
        };
        for (const [kind, liste] of Object.entries(felder))
            for (const feld of liste)
                expect(roh.test(feldBezeichnung(kind as "source", feld).text), kind + "." + feld).toBe(false);
        // Die Quellen eines Trägers (`traeger.sources`) stehen am Ort, am Weg und an der Fläche als `quellen`.
        for (const kind of ["place", "path", "landscape", "territory"] as const)
            expect(feldBezeichnung(kind, "quellen").text, kind).toBe("Quellen");
    });

    it("im Verlauf eines Objekts gilt der Name des Editors; gibt er den Schlüssel zurück, greift der lesbare Rückfall", () => {
        expect(bezeichneMit((feld) => (feld === "name" ? "Name" : feld), "name")).toEqual({ text: "Name" });
        expect(bezeichneMit((feld) => feld, "lock_state")).toEqual({ text: "Lock state", schluessel: "lock_state" });
    });
});

describe("Werte der Inhalte in Worten (WI-0265 B6f)", () => {
    it("🔴 eine Liste mit Titeln oder Namen als Satz, sonst die Zahl der Einträge; nie JSON", () => {
        expect(feldWert("work", "places", [{ rowId: "a", name: "Gareth", role: "Handlung" }, { name: "Punin" }])).toBe(
            "Gareth, Punin",
        );
        expect(feldWert("lore", "sources", [{ sourceId: id(1), title: "Wiki Aventurica", pages: "12" }])).toBe(
            "Wiki Aventurica",
        );
        // Die Quellen eines Orts (`traeger.sources`).
        expect(feldWert("place", "quellen", [{ sourceId: id(2), title: "Regionalband", state: "added" }])).toBe(
            "Regionalband",
        );
        for (const wert of [
            feldWert("lore", "rules", [{ id: id(3) }, { id: id(4) }]),
            feldWert("corpus", "quellen", [{ id: id(5), sourceType: "web" }, { id: id(6) }, { id: id(7) }]),
            feldWert("work", "places", [{ rowId: "a" }, { name: "Punin" }]),
            feldWert("source", "links", [{ href: "https://example.org" }]),
        ]) {
            expect(wert).toMatch(/\d/u);
            expect(wert).not.toMatch(/[{}[\]"]/u);
        }
        expect(feldWert("corpus", "quellen", [{ id: id(5) }, { id: id(6) }])).toBe(
            t("aenderungen.wert.eintraege", { n: "2" }),
        );
        expect(feldWert("source", "isOfficial", true)).toBe(t("editorListe.ja"));
        expect(feldWert("source", "title", "Wiki Aventurica")).toBe("Wiki Aventurica");
    });
});

describe("Werte je Art in Worten", () => {
    it("🔴 die Wegart mit Namen, die Kurve als Zahl der Stützpunkte", () => {
        expect(feldWert("path", "subtype", "Pfad")).toBe(t("path.Pfad"));
        expect(
            feldWert("path", "geometry", [
                [1, 2],
                [3, 4],
                [5, 6],
            ]),
        ).toBe(t("wegeditor.fenster.stuetzpunkte", { n: "3" }));
        expect(feldWert("path", "isBach", true)).toBe(t("editorListe.ja"));
    });

    it("🔴 die weiteren Straßennamen (WI-0302) heißen so und stehen als Namen mit Komma, leer „keine“", () => {
        expect(feldBezeichnung("path", "weitere").text).toBe(t("wegeditor.weitere.name"));
        expect(
            feldWert("path", "weitere", [
                { key: "goldfelser-stieg", name: "Goldfelser Stieg" },
                { key: "pilgerweg", name: "Pilgerweg" },
            ]),
        ).toBe("Goldfelser Stieg, Pilgerweg");
        expect(feldWert("path", "weitere", [])).toBe(t("wegeditor.weitere.keine"));
    });

    it("Ebene und Art mit Namen, die Fläche als Zahl der Ecken", () => {
        expect(feldWert("landscape", "layer", "vegetation")).toBe(t("layer.vegetation"));
        expect(feldWert("landscape", "type", "wald")).toBe(t("landscape.type.wald"));
        expect(
            feldWert("area", "geometry", [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ]),
        ).toBe(t("landschaftseditor.verlauf.ecken", { n: "4" }));
    });

    it("die Höhe eines Gipfels in Schritt, der Bogen einer Kraftlinie in Prozent, ein Obergebiet ohne Kennung als „keins“", () => {
        expect(feldWert("peak", "height", 3050)).toBe(t("scale.schritt", { n: "3.050" }));
        expect(feldWert("powerline", "curve", 12)).toBe("⌒ +12 %");
        expect(feldWert("territory", "parent", null)).toBe(t("gebietseditor.obergebiet.keins"));
    });

    it("🔴 eine Kennung ist ein „anderer Eintrag“, nie die UUID; ein unbekanntes Objekt ein Satz, nie JSON", () => {
        expect(feldWert("territory", "parent", id(9))).toBe(t("aenderungen.wert.verweis"));
        expect(feldWert("powerline", "to", id(9))).toBe(t("aenderungen.wert.verweis"));
        const objekt = wertText("x", { grat_breite: 14, muster: "rauschen", tief: { a: 1 } });
        expect(objekt).toBe("Grat breite 14 · Muster rauschen …");
        expect(objekt).not.toMatch(/[{}"]/u);
        expect(wertText("x", { a: { b: 1 } })).toBe(t("aenderungen.wert.angaben", { n: "1" }));
        expect(wertText("x", {})).toBe("–");
    });

    it("das Obergebiet steht mit Namen da, sobald die Liste der Gebiete ihn kennt; sonst bleibt es der „andere Eintrag“", () => {
        setzeGebietsnamen(new Map([[id(9), "Mittelreich"]]));
        try {
            expect(feldWert("territory", "parent", id(9))).toBe("Mittelreich");
            expect(feldWert("territory", "parent", id(8))).toBe(t("aenderungen.wert.verweis"));
        } finally {
            setzeGebietsnamen(new Map());
        }
    });

    it("🔴 „Nur die Form ist anders“ nur, wo zwei gleiche Texte verschiedene Werte tragen, nie bei zwei Kennungen", () => {
        expect(nurFormGeaendert("Kämme 3", "Kämme 3", { form: 1 }, { form: 2 })).toBe(true);
        expect(nurFormGeaendert("Kämme 3", "Kämme 4", { form: 1 }, { form: 2 })).toBe(false);
        expect(nurFormGeaendert("Kämme 3", "Kämme 3", { form: 1 }, { form: 1 })).toBe(false);
        expect(nurFormGeaendert("anderer Eintrag", "anderer Eintrag", id(1), id(2))).toBe(false);
    });

    it("🔴 kein Beispiel quer durch die Arten zeigt als Standardanzeige Klammern oder Anführungszeichen", () => {
        const beispiele: [MapHistoryObjectKind, string, unknown][] = [
            ["place", "wiki", { titel: "Gareth", url: "https://x" }],
            ["path", "reisen", { liste: ["foot", "nope_mittel"], fenster: { foot: [1, 2] } }],
            ["path", "wiki", { titel: "Reichsstraße" }],
            ["landscape", "curve", { enabled: true, max: 2 }],
            ["landscape", "zoom", [3, 8]],
            ["landscape", "gebirge:netz", { kaemme: [{ rang: "tal" }, {}], nebengipfel: [1, 2], mulden: [1] }],
            ["sprache", "wiki", [{ titel: "Garethi" }]],
            ["source", "meta", { a: 1, b: [1, 2] }],
            ["lore", "tags", ["a", "b"]],
            ["corpus", "x", [{ a: 1 }]],
        ];
        for (const [kind, feld, wert] of beispiele) {
            const text = feldWert(kind, feld, wert) ?? "";
            expect(text, `${kind}.${feld}`).not.toMatch(/[{}"[\]]/u);
        }
    });
});

describe("Das Gebirge als Spalten mit Namen und Einheit", () => {
    const netz = (gipfel: number): unknown => ({
        kaemme: [{}, {}, {}],
        nebengipfel: Array.from({ length: gipfel }, () => ({})),
    });
    const gebirge = (before: unknown, after: unknown): MapHistoryEntry =>
        eintrag(1, [gegenstand("landscape", { gebirge: { before, after } })]);

    it("🔴 eine Zeile je geänderter Spalte: „Gratbreite 14 → 18“, das Netz als „Kämme 3 · Nebengipfel 4 → 5“; Gleiches fällt weg", () => {
        const e = gebirge(
            { grat_breite: 14, talbreite: 6, netz: netz(4) },
            { grat_breite: 18, talbreite: 6, netz: netz(5) },
        );
        const zeilen = detailGegenstaende(e)[0]!.zeilen;
        expect(zeilen.map((z) => z.feld)).toEqual([`${GEBIRGE_PRAEFIX}grat_breite`, `${GEBIRGE_PRAEFIX}netz`]);
        const [grat, netzZeile] = zeilen;
        expect(feldNameFuer("landscape", grat!.feld)).toBe("Gratbreite");
        expect([
            feldWert("landscape", grat!.feld, grat!.vorher),
            feldWert("landscape", grat!.feld, grat!.nachher),
        ]).toEqual(["14", "18"]);
        expect(feldNameFuer("landscape", netzZeile!.feld)).toBe(t("aenderungen.feld.netz"));
        expect(feldWert("landscape", netzZeile!.feld, netzZeile!.vorher)).toBe("Kämme 3 · Nebengipfel 4");
        expect(feldWert("landscape", netzZeile!.feld, netzZeile!.nachher)).toBe("Kämme 3 · Nebengipfel 5");
    });

    it("die Höhe des Kamms in Schritt, die Erosionsfestigkeit in Prozent, Typ und Muster mit Namen, ohne Wert „Vorgabe“", () => {
        const w = (spalte: string, wert: unknown): string | undefined =>
            feldWert("landscape", `${GEBIRGE_PRAEFIX}${spalte}`, wert);
        expect(w("maximalhoehe", 3000)).toBe(`3.000 ${t("landschaftseditor.gebirge.hoehe.einheit")}`);
        expect(w("erosionsfestigkeit", 40)).toBe("40 %");
        expect(w("gebirgstyp", "kammgebirge")).toBe(t("landschaftseditor.gebirge.typ.kammgebirge"));
        expect(w("muster", "zellen")).toBe(t("landschaftseditor.gebirge.muster.zellen"));
        expect(w("grat_breite", null)).toBe(t("landschaftseditor.gebirge.wert.vorgabe"));
        expect(feldNameFuer("landscape", `${GEBIRGE_PRAEFIX}maximalhoehe`)).toBe(
            t("landschaftseditor.gebirge.hoehe.kamm"),
        );
        expect(feldNameFuer("landscape", `${GEBIRGE_PRAEFIX}unbekannte_spalte`)).toBe("Unbekannte spalte");
    });

    it("🔴 ohne frühere Tafel bleibt „Frühere Form nicht gespeichert“ je Spalte; ein noch nicht geladenes Netz bleibt EINE Zeile", () => {
        const ohneVorher = eintrag(1, [gegenstand("landscape", { gebirge: { after: { grat_breite: 18 } } })]);
        const nur = detailGegenstaende(ohneVorher)[0]!.zeilen;
        expect(nur.map((z) => [z.feld, z.formFehlt, z.hatVorher])).toEqual([
            [`${GEBIRGE_PRAEFIX}grat_breite`, true, false],
        ]);
        const offen = detailGegenstaende(eintrag(1, [gegenstand("landscape", { gebirge: { omitted: true } })]))[0]!
            .zeilen;
        expect(offen.map((z) => [z.feld, z.omitted])).toEqual([["gebirge", true]]);
    });

    it("🔴 eine Serie zeigt je Spalte den ersten Wert vorher und den letzten nachher", () => {
        const g = (n: number, before: unknown, after: unknown): MapHistoryEntry =>
            eintrag(n, [gegenstand("landscape", { gebirge: { before, after } })]);
        const serie = serienDetail(
            [
                g(1, { grat_breite: 14 }, { grat_breite: 16 }),
                g(2, { talbreite: 2 }, { talbreite: 3 }),
                g(3, { grat_breite: 16 }, { grat_breite: 18 }),
            ],
            new Map(),
        );
        const zeilen = serie.gegenstaende[0]!.zeilen;
        const grat = zeilen.find((z) => z.feld === `${GEBIRGE_PRAEFIX}grat_breite`)!;
        expect([grat.vorher, grat.nachher]).toEqual([14, 18]);
        expect(zeilen.find((z) => z.feld === `${GEBIRGE_PRAEFIX}talbreite`)).toMatchObject({ vorher: 2, nachher: 3 });
    });

    it("im Verlauf eines Objekts zerlegt das Detail die Tafel genauso", () => {
        const e = gebirge({ grat_breite: 14 }, { grat_breite: 18 });
        const zeilen = zeilenAusFeldern(
            [{ feld: "gebirge", vorher: { grat_breite: 14 }, nachher: { grat_breite: 18 } }],
            e.objects,
        );
        expect(zeilen.map((z) => z.feld)).toEqual([`${GEBIRGE_PRAEFIX}grat_breite`]);
    });
});

describe("Sprung vom Reiter in den Verlauf eines Objekts, je Art", () => {
    const ARTEN: readonly [MapHistoryObjectKind, ObjektZiel["subject"], ObjektZiel["werkzeug"]][] = [
        ["place", "place", "ortseditor"],
        ["path", "path", "wegeditor"],
        ["landscape", "area", "landschaftseditor"],
        ["peak", "peak", "landschaftseditor"],
        ["territory", "territory", "gebietseditor"],
        ["powerline", "powerline", "kraftlinieneditor"],
        ["sprache", "sprache", "spracheditor"],
    ];

    it.each(ARTEN)(
        "🔴 %s → Subjekt %s im Werkzeug %s mit einem Subjekt, das das Schema der Auswahl annimmt",
        (kind, subject, werkzeug) => {
            const ziel = objektZiel(kind)!;
            expect([ziel.subject, ziel.werkzeug]).toEqual([subject, werkzeug]);
            const plan = oeffnenPlan(ziel, id(7));
            expect(Value.Check(SubjectRef, plan.ref), JSON.stringify(plan.ref)).toBe(true);
            expect(plan.ref.kind).toBe(subject);
        },
    );

    it("🔴 ein Weg und eine Kraftlinie heißen `anchor`, alle anderen `id` (mit `id` öffnete die Karte nichts)", () => {
        expect(subjektRefVon(objektZiel("path")!, id(7))).toEqual({ kind: "path", anchor: id(7) });
        expect(subjektRefVon(objektZiel("powerline")!, id(7))).toEqual({ kind: "powerline", anchor: id(7) });
        expect(subjektRefVon(objektZiel("territory")!, id(7))).toEqual({ kind: "territory", id: id(7) });
    });

    /**
     * Die Bedingungen, unter denen die Fenster der Editoren ein Subjekt aufnehmen, wie `geoeffnet` in den `*-steuerung.ts` sie stellen:
     * eine Öffnung der Karte, nicht „still“, im Editormodus; das Wegefenster und das Sprachfenster nur bei schon offenem Fenster.
     */
    const AUFNAHME: Readonly<
        Record<string, (ref: { kind: string }, o: OpenSubjectOptions, fensterOffen: boolean) => boolean>
    > = {
        wegeditor: (ref, o, offen) => o.source === "map" && o.still !== true && ref.kind === "path" && offen,
        landschaftseditor: (ref, o) =>
            o.source === "map" && o.still !== true && (ref.kind === "area" || ref.kind === "peak"),
        gebietseditor: (ref, o) => o.source === "map" && o.still !== true && ref.kind === "territory",
        kraftlinieneditor: (ref, o) => o.source === "map" && o.still !== true && ref.kind === "powerline",
        spracheditor: (ref, o, offen) => o.source === "map" && o.still !== true && ref.kind === "sprache" && offen,
    };

    function oeffneUeberAuswahl(ziel: ObjektZiel, kennung: string, fensterOffen: boolean): boolean {
        let aufgenommen = false;
        const client: SubjectClient = {
            detail: () => new Promise<SubjectAnswer | null>(() => undefined),
            resolveLink: () => Promise.reject(new Error("nicht gebraucht")),
        };
        const auswahl = createSubjectSelection({
            client,
            canPin: false,
            cache: createRevisionCache<SubjectAnswer>({ ttlMs: 60_000, size: 10, now: () => 0 }),
            effects: { present: () => undefined, clear: () => undefined, fly: () => undefined },
            onOpened: (ref, optionen) => {
                aufgenommen = AUFNAHME[ziel.werkzeug]?.(ref, optionen, fensterOffen) ?? false;
            },
        });
        const plan = oeffnenPlan(ziel, kennung);
        auswahl.openSubject(plan.ref, plan.optionen);
        return aufgenommen;
    }

    it.each(ARTEN.filter(([kind]) => kind !== "place"))(
        "🔴 %s: das Fenster des Werkzeugs nimmt die Öffnung auf (Weg und Sprache nach dem Öffnen des Werkzeugs)",
        (kind) => {
            const ziel = objektZiel(kind)!;
            const plan = oeffnenPlan(ziel, id(7));
            expect(plan.werkzeugZuerst).toBe(kind === "path" || kind === "sprache");
            expect(plan.optionen).toEqual({ source: "map", camera: "target" });
            expect(oeffneUeberAuswahl(ziel, id(7), plan.werkzeugZuerst)).toBe(true);
        },
    );

    it("🔴 ohne offenes Fenster nähme das Wegefenster nichts auf: darum öffnet das Werkzeug zuerst", () => {
        expect(oeffneUeberAuswahl(objektZiel("path")!, id(7), false)).toBe(false);
    });

    it("der Ort bleibt bei ⚙: gewählt über `link` und `still`, das Werkzeug öffnet danach für das gewählte Subjekt", () => {
        const plan = oeffnenPlan(objektZiel("place")!, id(7));
        expect(plan.optionen).toEqual({ source: "link", camera: "target", still: true });
        expect(plan.werkzeugZuerst).toBe(false);
    });
});

describe("B6b: Knoten der Kraftlinie mit Namen", () => {
    it("🔴 das Ende eines Abschnitts steht mit dem Namen des Knotens da, sobald die Linie ihn nennt; sonst bleibt es der „andere Eintrag“", () => {
        setzeKnotenNamen(new Map([[id(31), "Gareth"]]));
        try {
            expect(feldWert("powerline", "from", id(31))).toBe("Gareth");
            expect(feldWert("powerline", "to", id(32))).toBe(t("aenderungen.wert.verweis"));
            // Nur die Enden: ein anderes Feld bleibt, wie es war.
            expect(feldWert("powerline", "curve", 12)).not.toBe("Gareth");
        } finally {
            setzeKnotenNamen(new Map());
        }
    });

    it("🔴 die Linie liest ihre Knoten einmal: ein Kraftlinienpunkt ohne Namen heißt „Nodix“, ein fehlender Knoten steht nicht da; ein Fehler lässt eine spätere Frage zu", async () => {
        setzeKnotenNamen(new Map());
        const detail = {
            nodes: [
                { id: id(41), kind: "place", name: "Havena", nodix: true, meets: [] },
                { id: id(42), kind: "nodix", nodix: true, meets: [] },
                { id: id(43), kind: "missing", nodix: false, meets: [] },
            ],
        };
        let antworten = 0;
        const fetcher = vi.fn(async () => {
            antworten += 1;
            return antworten === 1 ? new Response("{}", { status: 503 }) : Response.json(detail);
        });
        await ladeKnotenNamen(id(40), fetcher as never);
        expect(knotenName(id(41))).toBeUndefined();
        await ladeKnotenNamen(id(40), fetcher as never);
        expect(knotenName(id(41))).toBe("Havena");
        expect(knotenName(id(42))).toBe(t("kraftlinieneditor.punkt"));
        expect(knotenName(id(43))).toBeUndefined();
        // Gelesen ist gelesen: keine dritte Frage.
        await ladeKnotenNamen(id(40), fetcher as never);
        expect(fetcher).toHaveBeenCalledTimes(2);
        setzeKnotenNamen(new Map());
    });
});

describe("B6i: Rohfelder, Wiki-Stand und Codes in der Liste und im Detail", () => {
    const artikel = (changes: MapHistoryObject["changes"]): MapHistoryEntry =>
        eintrag(7, [
            gegenstand("sprache_artikel", changes, { name: "Garethi", action: "sprache_artikel.wikisync_uebernommen" }),
        ]);
    const neu = (after: unknown): { before: null; after: unknown } => ({ before: null, after });

    it("🔴 das Detail zeigt `rohSchrift` nicht neben `schrift`; allein steht es als „Schrift (Wiki-Quelltext)“", () => {
        const beide = detailGegenstaende(
            artikel({
                name: neu("Garethi"),
                schrift: neu("Kusliker Zeichen"),
                rohSchrift: neu("[[Kusliker Zeichen]]"),
                rohVorstufen: neu("[[Urtulamidya]]"),
            }),
        )[0]!.zeilen;
        // `rohVorstufen` steht allein (`vorstufen` fehlt) und bleibt.
        expect(beide.map((z) => z.feld)).toEqual(["name", "schrift", "rohVorstufen"]);
        expect(feldNameFuer("sprache_artikel", "rohVorstufen")).toBe("Vorstufen (Wiki-Quelltext)");
        expect(feldWert("sprache_artikel", "schrift", "Kusliker Zeichen")).toBe("Kusliker Zeichen");
    });

    it("🔴 eine Serie führt das Rohfeld ebenso nur, wenn die bereinigte Fassung fehlt", () => {
        const mitglieder = [
            artikel({ schrift: neu("A"), rohSchrift: neu("[[A]]") }),
            { ...artikel({ rohOffizielleSprache: neu("[[Garethi]]") }), operationId: id(300), seq: 2000 },
        ];
        const felder = serienDetail(mitglieder, new Map()).gegenstaende.flatMap((g) => g.zeilen.map((z) => z.feld));
        expect(felder).toEqual(["schrift", "rohOffizielleSprache"]);
    });

    it("🔴 die Herkunft einer Sprache und ihrer Teilfläche, die Herkunft eines Felds und der Typ einer Quelle haben ihre Anzeigenamen", () => {
        expect(feldWert("sprache", "herkunft", "redaktion")).toBe(t("spracheditor.herkunft.redaktion"));
        expect(feldWert("sprache_flaeche", "herkunft", "sprachenkarte")).toBe(t("spracheditor.herkunft.sprachenkarte"));
        expect(feldWert("place", "nameOrigin", "wiki")).toBe(t("ortseditor.herkunft.wiki"));
        expect(feldWert("territory", "rulerOrigin", "manual")).toBe(t("ortseditor.herkunft.redaktion"));
        expect(feldWert("source", "sourceType", "regelbuch")).toBe(t("infoPanel.sourceType.regelbuch"));
        // Ein Code ohne Namen im Web bleibt, wie er ist; und `herkunft` an einer anderen Art ist kein Code der Sprachen.
        expect(feldWert("sprache", "herkunft", "neuer_code")).toBe("neuer_code");
        expect(feldWert("lore", "herkunft", "redaktion")).toBe("redaktion");
    });

    it("die angelegte Quelle steht mit ihrem Titel da, nicht mit den englischen Schlüsseln ihres Objekts", () => {
        const text = feldWert("source", "created", { key: "wa-x", title: "Wiki Aventurica", sourceType: "web" });
        expect(text).toBe("Wiki Aventurica");
        expect(feldBezeichnung("source", "created").text).toBe(t("aenderungen.feld.angelegt"));
    });
});
