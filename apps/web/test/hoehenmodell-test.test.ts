import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AdminHoehenmodell,
    GEBIRGS_PRESETS_VORGABE,
    type HoehenmodellFassung,
    type HoehenmodellTest,
} from "@avesmaps3d/shared";
import { createHoehenmodell, fassungName, gueltigFelder } from "../src/auth/hoehenmodell.ts";
import {
    abnehmenSperre,
    kacheln,
    leiste,
    neu,
    testUnter,
    verlauf,
    werteAus,
    datei,
    bereichKarte,
    folge,
    typWerte,
    zeile,
} from "../src/auth/hoehenmodell-test.ts";

/**
 * Die Werte von „19 (Test)“ ohne Browser (WI-0240). Problemfälle: Ein getippter Wert gleich dem gespeicherten zählt als Änderung; ein
 * Preset-Wert außerhalb seiner Grenzen geht durch; Speichern schickt nur das Getippte statt des ganzen Stands (dann fielen frühere Werte
 * weg); die Leiste lässt ohne Grund speichern; Abnehmen geht mit Ungespeichertem oder während die Kette noch mit der Fassung rechnet; der
 * Verlauf nimmt eine Revision zurück, deren Werte seither wieder geändert sind; der Name verliert „(Test)“.
 */

const NOW = new Date("2026-10-19T20:00:00Z");
const REGLER = {
    radius: 16,
    saturation: 10,
    iterations: 20,
    streamPowerK: 0.08,
    diffusion: 0.015,
    continentalHeight: 300,
    detailAmplitude: 220,
    fineDetailAmplitude: 80,
    flankGrade: 0.1,
    maximumGrade: 0.7,
};
const zeit = (iso: string): string => iso;
/** Ein Ausschnitt der übrigen Werte (`flacheRezeptWerte`): zwei aus dem Gelände, einer der Gipfel, zwei Landschaftsarten. */
const REZEPT = {
    "generator.timeStep": 1,
    "generator.detail.wavelength": 4,
    "mountainMorphology.interior.alpine.summit.grade.minimum": 0.6,
    "mountainMorphology.interior.alpine.summit.grade.maximum": 0.8,
    "topographie.gebirge.upliftWeight": 20,
    "topographie.gebirge.influence.outward": 12,
    "vegetation.wald.upliftWeight": 1,
};

function testVon(patch: Partial<HoehenmodellTest> = {}): HoehenmodellTest {
    const vorgabe = GEBIRGS_PRESETS_VORGABE;
    const presets = {
        ...vorgabe,
        typen: {
            ...vorgabe.typen,
            bergland: { ...vorgabe.typen.bergland, werte: { ...vorgabe.typen.bergland.werte, koernung: 24 } },
        },
    };
    return {
        version: 19,
        name: "Fassung 19 (Test)",
        werte: { regler: { diffusion: 0.02 }, presets: { typen: { bergland: { werte: { koernung: 24 } } } } },
        revision: 2,
        gerechnet: 2,
        geaendertAm: "2026-10-19T19:26:00Z",
        wer: "Valentin",
        grund: "Bergland mit mehr Zellen",
        gesperrt: false,
        regler: { ...REGLER, diffusion: 0.02 },
        reglerDatei: REGLER,
        rezept: REZEPT,
        rezeptDatei: REZEPT,
        technik: { "generator.size": 4096, "generator.seed": 67001 },
        presets,
        presetsDatei: GEBIRGS_PRESETS_VORGABE,
        verlauf: [
            {
                revision: 2,
                am: "2026-10-19T19:26:00Z",
                wer: "Valentin",
                grund: "Bergland mit mehr Zellen",
                vorher: { regler: { diffusion: 0.02 } },
                werte: { regler: { diffusion: 0.02 }, presets: { typen: { bergland: { werte: { koernung: 24 } } } } },
            },
            {
                revision: 1,
                am: "2026-10-19T18:50:00Z",
                wer: "Valentin",
                grund: "Täler weicher",
                vorher: {},
                werte: { regler: { diffusion: 0.02 } },
            },
        ],
        ...patch,
    };
}

function fassung19(): HoehenmodellFassung {
    return {
        version: 19,
        regional: true,
        unterschied: [],
        regler: REGLER,
        landschaften: [
            { art: "gebirge", upliftWeight: 20, erodibility: 0.08, diffusivity: 1, runoff: 1, channelBias: 0 },
        ],
        werte: 306,
        abnahme: null,
        inDatei: false,
        kreis: "halb",
        gilt: true,
    };
}

function stand(patch: Partial<AdminHoehenmodell> = {}): AdminHoehenmodell {
    const body: AdminHoehenmodell = {
        now: NOW.toISOString(),
        profil: "voll",
        eingestellt: {
            version: 19,
            quelle: "auswahl",
            seit: "2026-10-19T18:00:00Z",
            wer: "Valentin",
            grund: "Gebirgs-Presets erproben",
            revision: 4,
            unbekannt: null,
        },
        wirksam: { version: 19, gerechnetAm: "2026-10-19T19:53:00Z", vorlaeufig: false },
        kette: null,
        rueckweg: 18,
        fassungen: [fassung19()],
        entwuerfe: [],
        gipfel: null,
        test: testVon(),
        ...patch,
    };
    expect(Value.Check(AdminHoehenmodell, body)).toBe(true);
    return body;
}

describe("Zeilen", () => {
    it("🔴 getippt und gültig ist geändert; gleich dem gespeicherten nicht; „statt“ nennt den gespeicherten, „Datei“ die Datei", () => {
        const test = testVon();
        const z = zeile(test, { "r:diffusion": "0,03" }, "r:diffusion");
        expect(z).toMatchObject({ geaendert: true, abweichend: true, statt: "statt 0,02", datei: "Datei: 0,015" });
        expect(zeile(test, { "r:diffusion": "0,02" }, "r:diffusion")).toMatchObject({
            geaendert: false,
            statt: null,
            datei: "Datei: 0,015",
            ruecksetzbar: true,
        });
        expect(zeile(test, {}, "r:iterations")).toMatchObject({ abweichend: false, ruecksetzbar: false, datei: null });
        // ↺ auf die Datei eingetragen: geändert gegen den gespeicherten, aber nicht mehr abweichend.
        expect(zeile(test, { "r:diffusion": "0,015" }, "r:diffusion")).toMatchObject({
            geaendert: true,
            abweichend: false,
            datei: null,
        });
    });

    it("🔴 Grenzen der Regler und der Presets (wie der Server), ganze Stufen, Tausenderpunkt; abgenommen ruht ↺", () => {
        const test = testVon();
        expect(zeile(test, { "r:iterations": "2,5" }, "r:iterations").problem).toBe("nur ganze Zahlen");
        expect(zeile(test, { "r:flankGrade": "2" }, "r:flankGrade").problem).toBe("zwischen 0 und 1");
        expect(zeile(test, { "p:karst:sattel": "0,2" }, "p:karst:sattel").problem).toBe("zwischen 0,3 und 1");
        expect(zeile(test, { "p:karst:erosion": "2,5" }, "p:karst:erosion").problem).toBe("nur ganze Zahlen");
        expect(zeile(test, { "p:karst:einschnitt": "1.925" }, "p:karst:einschnitt").problem).toBeUndefined();
        expect(neu(test, { "p:karst:einschnitt": "2.000" }).get("p:karst:einschnitt")).toBe(2000);
        expect(zeile(testVon({ gesperrt: true }), {}, "r:diffusion").ruecksetzbar).toBe(false);
        expect(zeile(test, {}, "r:radius").einheit).toBe("E (48 Meilen)");
        // Das Grundmuster steht im Segmentschalter mit seinem Wert, nicht mit dem Namen (sonst ist kein Segment gewählt).
        expect(zeile(test, {}, "m:kammgebirge").feld).toBe("rauschen");
        expect(zeile(test, { "m:kammgebirge": "zellen" }, "m:kammgebirge")).toMatchObject({
            feld: "zellen",
            geaendert: true,
        });
    });
});

describe("Speichern", () => {
    it("🔴 der ganze neue Stand gegen die Datei: Früheres bleibt, gleich der Datei fällt weg", () => {
        const test = testVon();
        expect(werteAus(neu(test, { "r:streamPowerK": "0,1", "r:diffusion": "0,015" }), datei(test))).toEqual({
            regler: { streamPowerK: 0.1 },
            presets: { typen: { bergland: { werte: { koernung: 24 } } } },
        });
        expect(werteAus(neu(test, { "m:kammgebirge": "zellen", "s:tiefland": "200" }), datei(test))).toMatchObject({
            presets: { typen: { kammgebirge: { muster: "zellen" } }, hoehenstufen: { tiefland: 200 } },
        });
    });

    it("🔴 die Leiste: ohne Grund und ohne Änderung ruht Speichern mit Satz; Ungespeichertes zählt und sagt, dass neu gerechnet wird", () => {
        const s = stand();
        const test = s.test!;
        const ruhig = leiste(s, test, {}, "", null, zeit);
        expect(ruhig.sperre).toBe("Nichts zu speichern.");
        expect(ruhig.saetze[0]).toBe("Revision 2 gespeichert · die Karte ist damit gerechnet");
        expect(ruhig.saetze.at(-1)).toContain("2 gespeicherte Werte weichen von der Datei 19.json ab");
        const offen = leiste(s, test, { "r:streamPowerK": "0,1" }, "", null, zeit);
        expect(offen.saetze[0]).toBe("Ungespeichert: 1 Wert · Speichern rechnet die Karte neu");
        expect(offen.sperre).toBe("Der Grund fehlt.");
        expect(leiste(s, test, { "r:streamPowerK": "x" }, "Probe", null, zeit).sperre).toBe(
            "Erst die markierten Werte richten.",
        );
        expect(leiste(s, test, { "r:streamPowerK": "0,1" }, "Probe", null, zeit).sperre).toBeUndefined();
        expect(leiste(s, testVon({ gerechnet: 1 }), {}, "", null, zeit).saetze[0]).toBe(
            "Revision 2 gespeichert · die Karte rechnet noch mit einem anderen Stand",
        );
        const andere = stand({ eingestellt: { ...s.eingestellt, version: 18 } });
        expect(leiste(andere, andere.test!, {}, "", null, zeit).saetze[0]).toBe(
            "Revision 2 gespeichert · gilt, sobald Fassung 19 (Test) aktiviert ist",
        );
        const zu = leiste(s, testVon({ gesperrt: true }), {}, "", null, zeit);
        expect(zu).toMatchObject({ gesperrt: true, formular: false });
        expect(zu.saetze[0]).toBe("Abgenommen: Werte stehen fest");
    });

    it("🔴 Speichern schickt Revision, ganzen Stand und Grund an /test; danach sind die Felder leer", async () => {
        const calls: { url: string; body: unknown }[] = [];
        const antworten = [
            stand(),
            { operationId: "x", status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] },
            stand(),
        ];
        const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push({
                url: String(url),
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
            });
            return new Response(JSON.stringify(antworten.shift()), { status: 200 });
        }) as typeof fetch;
        const h = createHoehenmodell({ fetcher, ask: async () => true });
        await h.load();
        h.testTippe("r:streamPowerK", "0,1");
        expect((await h.testSpeichern()).ok).toBe(false);
        h.test.value = { ...h.test.value, grund: "  kräftiger  " };
        expect((await h.testSpeichern()).ok).toBe(true);
        expect(calls[1]).toMatchObject({
            url: "/api/admin/system/hoehenmodell/test",
            body: {
                baseRevision: 2,
                reason: "kräftiger",
                werte: {
                    regler: { diffusion: 0.02, streamPowerK: 0.1 },
                    presets: { typen: { bergland: { werte: { koernung: 24 } } } },
                },
            },
        });
        expect(h.test.value.felder).toEqual({});
    });
});

describe("Abnehmen, Verlauf, Kacheln und Name", () => {
    it("🔴 Abnehmen ruht mit Ungespeichertem und solange die Kette mit der offenen Fassung rechnet", () => {
        expect(abnehmenSperre(stand(), { "r:streamPowerK": "0,1" })).toBe("Erst speichern oder verwerfen.");
        const rechnet = stand({
            kette: {
                jobId: "j",
                art: "terrain_full",
                state: "RUNNING",
                phase: "Erosion",
                progress: 0.4,
                waitReason: null,
            },
        });
        expect(abnehmenSperre(rechnet, {})).toBe("Wartet auf den Lauf mit Revision 2.");
        expect(abnehmenSperre(stand(), {})).toBeUndefined();
    });

    it("🔴 der Verlauf zeigt alt → neu; eine Revision, deren Wert seither wieder geändert ist, ist nicht zurücknehmbar", () => {
        const [zwei, eins] = verlauf(testVon(), zeit);
        expect(zwei).toMatchObject({
            kopf: "Revision 2 · „Bergland mit mehr Zellen“",
            aenderungen: [{ key: "p:bergland:koernung", name: "Bergland · Zahl der Erhebungen", alt: "18", neu: "24" }],
            konflikt: [],
            zurueck: { "p:bergland:koernung": "18" },
        });
        expect(eins).toMatchObject({ aenderungen: [{ key: "r:diffusion", alt: "0,015", neu: "0,02" }], konflikt: [] });
        const spaeter = testVon({
            verlauf: [
                {
                    revision: 3,
                    am: "2026-10-19T19:40:00Z",
                    wer: "Valentin",
                    grund: null,
                    vorher: { regler: { diffusion: 0.02 } },
                    werte: { regler: { diffusion: 0.03 } },
                },
                ...testVon().verlauf,
            ],
        });
        expect(verlauf(spaeter, zeit)[2]?.konflikt).toEqual(["Ausgleich"]);
    });

    it("Kacheln zählen Geändertes vor Abweichendem; die Liste und „Wirksam“ tragen „(Test)“ und die gerechnete Revision", () => {
        const test = testVon();
        const marken = Object.fromEntries(
            kacheln(test, { "p:kammgebirge:sattel": "0,9" }).map((k) => [k.typ, k.marke]),
        );
        expect(marken).toMatchObject({ kammgebirge: "1 geändert", bergland: "1 abweichend", karst: null });
        expect(testUnter(test)).toBe("Testwerte: Revision 2, 2 Werte über der Datei");
        const s = stand();
        expect(fassungName(fassung19(), s)).toBe("Fassung 19 (Test) · FastScape mit regionaler Isostasie");
        expect(gueltigFelder(s, NOW).find((f) => f.id === "wirksam")?.wert).toContain(
            "Fassung 19 (Test), Revision 2, gerechnet",
        );
    });
});

describe("Typwerte des Rückennetzes (WI-0246)", () => {
    it("🔴 stehen je Typ in der Tafel, gehen als eigene Werte an den Server und rechnen nur Gebirge mit Kamm neu", () => {
        const test = testVon();
        const werte = typWerte(test, {}, "schild");
        expect(werte.rueckennetz).toContain("n:schild:form.grat");
        expect(werte.rueckennetz).not.toContain("n:schild:struktur.abstand");
        expect(datei(test).get("n:schild:form.grat")).toBe(0.14);
        const getippt = { "n:schild:form.grat": "0,2" };
        expect(zeile(test, getippt, "n:schild:form.grat")).toMatchObject({ geaendert: true, problem: undefined });
        expect(zeile(test, { "n:schild:form.grat": "0,5" }, "n:schild:form.grat").problem).toBeDefined();
        expect(werteAus(neu(test, getippt), datei(test)).presets?.typen?.["schild"]).toEqual({
            rueckennetz: { "form.grat": 0.2 },
        });
        expect(folge("n:schild:form.grat")).not.toBe(folge("p:schild:hypsometrie"));
    });
});

describe("Alle Werte in Reitern (Betreiber 2026-10-20: „wenn schon dann richtig“)", () => {
    it("🔴 Bereiche mit Kacheln: Regler an ihrem Platz, übrige Werte je Pfad, Landschaften je Art; leere Kacheln fehlen", () => {
        const test = testVon();
        const gelaende = bereichKarte(test, {}, "gelaende", undefined);
        expect(gelaende.gewaehlt).toBe("kontinent");
        expect(gelaende.keys).toEqual(["r:continentalHeight"]);
        const erosion = bereichKarte(test, {}, "gelaende", "erosion");
        expect(erosion.keys).toEqual(["r:iterations", "w:generator.timeStep", "r:streamPowerK", "r:diffusion"]);
        expect(erosion.kacheln.find((k) => k.id === "erosion")?.marke).toBe("1 abweichend");
        const form = bereichKarte(test, {}, "gebirgsform", "gipfel");
        expect(form.keys).toEqual([
            "w:mountainMorphology.interior.alpine.summit.grade.minimum",
            "w:mountainMorphology.interior.alpine.summit.grade.maximum",
        ]);
        expect(zeile(test, {}, form.keys[0]!).name).toBe("Neigung · von");
        const land = bereichKarte(test, {}, "landschaften", "vegetation.wald");
        expect(land.kacheln.map((k) => k.id)).toEqual(["topographie.gebirge", "vegetation.wald"]);
        expect(land.keys).toEqual(["w:vegetation.wald.upliftWeight"]);
    });

    it("🔴 getippt geht als `rezept` je Pfad an den Server; Grenzen aus dem Katalog", () => {
        const test = testVon();
        const getippt = { "w:generator.detail.wavelength": "6" };
        expect(werteAus(neu(test, getippt), datei(test)).rezept).toEqual({ "generator.detail.wavelength": 6 });
        expect(
            zeile(test, { "w:generator.detail.octaves": "2,5" }, "w:generator.detail.octaves").problem,
        ).toBeDefined();
        expect(
            zeile(test, { "w:topographie.gebirge.upliftWeight": "-1" }, "w:topographie.gebirge.upliftWeight").problem,
        ).toBeDefined();
    });
});
