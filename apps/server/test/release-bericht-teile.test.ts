// Mehrere rote Teile und die Browserteile in der Ansicht (WI-0248, `scripts/dev/release-bericht.ts`): Der Lauf geht bis zum Ende, und der Bericht nennt ALLE
// roten Fälle aller Teile (höchstens zwanzig sichtbar, die Gesamtzahl zählt alle), jeden mit seinem Teil. Dazu: Zustand, Fälle und Zeit je Browserteil.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ReleaseTestFehler, ReleaseTestTeil } from "@avesmaps3d/shared";
import {
    FAELLE_MAX,
    RELEASE_SCHRITTE,
    baueFehlerBericht,
    baueTeileAnsicht,
    berechneFortschritt,
    erwarteteFaelle,
    fehlerSchrittAus,
    neuerFaelleSammler,
    faelleVonPlaywright,
    faelleVonVitest,
    leseProfil,
    schritteAusFehlerText,
    schritteJeProfil,
    wackeligeFaelle,
    zaehleBrowserFaelle,
    type Erwartung,
    type SchrittId,
    type SchrittStand,
} from "../../../scripts/dev/release-bericht.ts";
import { schreibeLaufBuch, type LaufBuch } from "../../../scripts/dev/release-laufbuch.ts";

const erw = (ms: number): Erwartung => ({
    ms: Object.fromEntries(RELEASE_SCHRITTE.map((id) => [id, ms])) as Record<SchrittId, number>,
    schaetzung: Object.fromEntries(RELEASE_SCHRITTE.map((id) => [id, false])) as Record<SchrittId, boolean>,
});

/** Ein Playwright-Bericht mit `rot` roten Fällen in `datei` und `gruen` grünen Zahlen. */
const playwright = (datei: string, rot: number, gruen = 10, uebersprungen = 0): unknown => ({
    stats: { expected: gruen, unexpected: rot, flaky: 0, skipped: uebersprungen },
    errors: [],
    suites: [
        {
            file: datei,
            title: datei,
            specs: Array.from({ length: rot }, (_v, i) => ({
                title: `Fall ${String(i + 1)}`,
                ok: false,
                tests: [
                    {
                        status: "unexpected",
                        results: [{ status: "failed", error: { message: `Fehler ${String(i + 1)}` } }],
                    },
                ],
            })),
        },
    ],
});
const vitest = (datei: string, rot: number): unknown => ({
    testResults: [
        {
            name: `/x/checkout/${datei}`,
            status: "failed",
            assertionResults: Array.from({ length: rot }, (_v, i) => ({
                status: "failed",
                fullName: `Test ${String(i + 1)}`,
                failureMessages: [`erwartet ${String(i)}`],
            })),
        },
    ],
});

describe("Die Zeile eines roten Browserteils in fehler.txt", () => {
    it("den Schritt nennt auch die neue Zeile mit Namen: `Browserteil 2 (Name): 3 rot`", () => {
        expect(fehlerSchrittAus("Browserteil 2 (Gebiete, Landschaften): 3 rot", undefined)).toBe("browser-2");
        expect(fehlerSchrittAus("Browserteil 3 unvollständig", undefined)).toBe("browser-3");
        expect(fehlerSchrittAus("Browserteil 4 (X) nicht gelaufen: Martin", undefined)).toBe("browser-4");
    });

    it("🔴 die Stichprobe von Prüfprofil B heißt `kern`, nicht `browser-<n>`: auch ihre Zeilen nennen den Schritt", () => {
        expect(fehlerSchrittAus("Browserteil kern (Kernabläufe): 3 rot", undefined)).toBe("kern");
        expect(
            schritteAusFehlerText(
                [
                    "Vitest: 1 rot, 0 übersprungen, 0 todo",
                    "Browserteil kern (Kernabläufe): 2 rot",
                    "Browserteil kern (Kernabläufe) nicht gelaufen: Martin",
                ].join("\n"),
            ),
        ).toEqual({ rot: ["tests", "kern"], uebersprungen: ["kern"] });
    });

    it("🔴 das Tor (WI-0264): `kern-echt` wird vor `kern` erkannt, `Daten: …` ist der Schritt `daten`", () => {
        // 🪤 `\b` trifft schon nach „kern“ in „kern-echt“: Die Muster müssen `kern-echt` zuerst prüfen.
        expect(fehlerSchrittAus("Browserteil kern-echt (Tor): 2 rot", undefined)).toBe("kern-echt");
        expect(fehlerSchrittAus("Browserteil kern (Kernabläufe): 2 rot", undefined)).toBe("kern");
        expect(fehlerSchrittAus("Daten: 3 rot, 0 übersprungen, 0 todo", undefined)).toBe("daten");
        expect(fehlerSchrittAus("daten: Exit 1", undefined)).toBe("daten");
        expect(
            schritteAusFehlerText(
                [
                    "lint: Exit 1",
                    "bau: Exit 2",
                    "Daten: 3 rot, 0 übersprungen, 0 todo",
                    "Browserteil kern-echt (Tor): Welt nicht angelegt (Exit 1, tor-welt.txt im Ergebnisordner)",
                    "Browserteil kern-echt (Tor) nicht gelaufen: Martin ließ sich nicht starten",
                ].join("\n"),
            ),
        ).toEqual({ rot: ["lint", "bau", "daten", "kern-echt"], uebersprungen: ["kern-echt"] });
    });

    it("🔴 alle roten und entfallenen Schritte aus den Zeilen, in der Reihenfolge, ohne Doppelte", () => {
        const text = [
            "lint: Exit 1",
            "Vitest: 3 rot, 0 übersprungen, 0 todo",
            "bau: Zeitüberschreitung (30 min)",
            "besucherpaket nicht gelaufen: der Release-Bau ist rot",
            "Browserteil 2 (Gebiete, Landschaften, Darstellung): 3 rot",
            "Browserteil 3 (Kamera) nicht gelaufen: Martin ließ sich nicht starten",
            "Browserteil 2 (Gebiete, Landschaften, Darstellung): 3 rot",
            "etwas ganz anderes",
        ].join("\n");
        expect(schritteAusFehlerText(text)).toEqual({
            rot: ["lint", "tests", "bau", "browser-2"],
            uebersprungen: ["besucherpaket", "browser-3"],
        });
        expect(schritteAusFehlerText("")).toEqual({ rot: [], uebersprungen: [] });
        // Ein Name, der wie ein Schritt aussieht, aber keiner ist, zählt nicht.
        expect(schritteAusFehlerText("fremd: Exit 2")).toEqual({ rot: [], uebersprungen: [] });
    });
});

describe("Fortschritt mit mehreren roten, übernommenen und entfallenen Schritten", () => {
    const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
    const zeiten = (ids: SchrittId[]): { id: SchrittId; start: number; ende: number | null; belegt: boolean }[] =>
        ids.map((id, i) => ({ id, start: T0 + i * 1000, ende: T0 + (i + 1) * 1000, belegt: true }));

    it("🔴 jeder rote Schritt steht als fehlerhaft da, die Schritte dahinter als fertig; entfallene und übernommene zählen nicht zur Erwartung", () => {
        const f = berechneFortschritt({
            zeiten: zeiten([
                "vorbereitung",
                "installation",
                "shared",
                "lint",
                "format",
                "typen",
                "korpus-laden",
                "tests",
                "bau",
                "browser-1",
                "browser-2",
            ]),
            erwartung: erw(10_000),
            zustand: "rot",
            jetzt: T0 + 60_000,
            fehlerSchritte: ["lint", "tests", "browser-2"],
            // Ein Lauf im Profil `voll`: die Stichprobe `kern` und die Teile des Tors (`daten`, `kern-echt`) gehören nicht dazu.
            uebersprungen: ["besucherpaket", "kern", "daten", "kern-echt"],
            uebernommen: ["browser-3", "browser-4"],
        });
        const zustand = (id: SchrittId): string | undefined => f.schritte.find((s) => s.id === id)?.zustand;
        expect(zustand("lint")).toBe("fehler");
        expect(zustand("format")).toBe("fertig");
        expect(zustand("tests")).toBe("fehler");
        expect(zustand("bau")).toBe("fertig");
        expect(zustand("besucherpaket")).toBe("uebersprungen");
        expect(zustand("browser-1")).toBe("fertig");
        expect(zustand("browser-2")).toBe("fehler");
        expect(zustand("browser-3")).toBe("uebernommen");
        expect(zustand("browser-4")).toBe("uebernommen");
        // Elf Schritte tragen eine Erwartung, die sechs nicht gelaufenen nicht.
        expect(f.schritte.filter((s) => s.erwartetMs === 0).map((s) => s.id)).toEqual([
            "besucherpaket",
            "daten",
            "browser-3",
            "browser-4",
            "kern",
            "kern-echt",
        ]);
        expect(f.erwartetMs).toBe(11 * 10_000);
        expect(f.fortschritt).toBeLessThanOrEqual(0.99);
    });

    it("während der Lauf weiterläuft, zeigt ein roter Schritt schon Rot; der laufende bleibt laufend", () => {
        const z = zeiten(["vorbereitung", "installation", "lint", "format"]);
        z[3] = { id: "format", start: T0 + 3000, ende: null, belegt: false };
        const f = berechneFortschritt({
            zeiten: z,
            erwartung: erw(10_000),
            zustand: "laeuft",
            jetzt: T0 + 5000,
            fehlerSchritte: ["lint"],
        });
        expect(f.schritte.filter((s) => s.zustand === "fehler").map((s) => s.id)).toEqual(["lint"]);
        expect(f.schritte.find((s) => s.id === "format")?.zustand).toBe("laeuft");
    });

    it("sind alle Schritte übernommen, gibt es keine Teilung durch Null", () => {
        const f = berechneFortschritt({
            zeiten: [],
            erwartung: erw(10_000),
            zustand: "rot",
            jetzt: T0,
            uebernommen: RELEASE_SCHRITTE.filter((id) => id !== "vorbereitung"),
            uebersprungen: ["vorbereitung"],
        });
        expect(f.erwartetMs).toBe(0);
        expect(f.fortschritt).toBe(0);
    });

    it("ohne die neuen Angaben gilt das Verhalten von vorher: nur der letzte Schritt ist fehlerhaft", () => {
        const f = berechneFortschritt({
            zeiten: zeiten(["vorbereitung", "installation", "shared"]),
            erwartung: erw(10_000),
            zustand: "rot",
            jetzt: T0 + 9000,
        });
        expect(f.schritte.filter((s) => s.zustand === "fehler").map((s) => s.id)).toEqual(["shared"]);
    });
});

describe("🔴 Der Bericht nennt die roten Fälle ALLER Teile", () => {
    let ordner = "";
    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "bericht-teile-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });
    const buch = (): LaufBuch => ({
        version: 1,
        teile: [1, 2, 3, 4].map((n) => ({
            id: `browser-${String(n)}`,
            name: `Teil ${String(n)}`,
            bereiche: ["orte"],
            specs: 10,
        })),
        problem: null,
        komponenten: {},
        wiederholung: null,
        schritte: {},
    });

    it("Vitest, Browserteil 2 und Browserteil 4: jeder Fall trägt seinen Teil, die Gesamtzahl zählt alle, sichtbar sind zwanzig", () => {
        const dir = join(ordner, "mehrere");
        mkdirSync(dir);
        writeFileSync(
            join(dir, "fehler.txt"),
            "Vitest: 2 rot, 0 übersprungen, 0 todo\nBrowserteil 2 (Teil 2): 1 rot\nBrowserteil 4 (Teil 4): 25 rot",
        );
        writeFileSync(join(dir, "vitest.json"), JSON.stringify(vitest("apps/server/test/a.test.ts", 2)));
        writeFileSync(join(dir, "browser-2.json"), JSON.stringify(playwright("b.spec.ts", 1)));
        writeFileSync(join(dir, "browser-4.json"), JSON.stringify(playwright("d.spec.ts", 25)));
        // Grüne Teile werden nicht gelesen: Ihr (hier kaputter) Bericht stört nicht.
        writeFileSync(join(dir, "browser-1.json"), "{ kaputt");
        writeFileSync(
            join(dir, "status.json"),
            JSON.stringify({
                teile: [
                    { klasse: "browser-1", status: "gruen", exit: 0, sha: "a" },
                    { klasse: "browser-3", status: "gruen", exit: 0, sha: "a" },
                ],
            }),
        );
        schreibeLaufBuch(dir, buch());
        const b = baueFehlerBericht(dir, "Satz", undefined);
        expect(b.schritt).toBe("tests");
        expect(b.faelleGesamt).toBe(28);
        expect(b.faelle).toHaveLength(FAELLE_MAX);
        expect(b.faelle.slice(0, 3).map((f) => [f.teil, f.teilName])).toEqual([
            ["tests", "Alle Tests"],
            ["tests", "Alle Tests"],
            ["browser-2", "Teil 2"],
        ]);
        expect(new Set(b.faelle.map((f) => f.teil))).toEqual(new Set(["tests", "browser-2", "browser-4"]));
        expect(b.faelle.at(-1)).toMatchObject({ teil: "browser-4", teilName: "Teil 4" });
        expect(b.grund.split("\n")).toHaveLength(3);
        // Der Bericht erfüllt den Vertrag der Oberfläche.
        expect([...Value.Errors(ReleaseTestFehler, b)]).toEqual([]);
    });

    it("rote Fälle vor übersprungenen und `todo` über alle Teile hinweg: Das Rote verdrängt nie etwas, und nichts Rotes fällt der Kürzung zum Opfer", () => {
        const sammler = neuerFaelleSammler();
        // Zuerst ein Teil mit 30 übersprungenen Fällen, danach einer mit 3 roten.
        faelleVonPlaywright(playwright("a.spec.ts", 0, 5, 0), { id: "browser-1", name: "Eins" }, sammler);
        const uebersprungen = {
            stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 30 },
            suites: [
                {
                    file: "u.spec.ts",
                    title: "u.spec.ts",
                    specs: Array.from({ length: 30 }, (_v, i) => ({
                        title: `U ${String(i)}`,
                        ok: true,
                        tests: [{ status: "skipped", results: [] }],
                    })),
                },
            ],
        };
        faelleVonPlaywright(uebersprungen, { id: "browser-1", name: "Eins" }, sammler);
        faelleVonVitest(vitest("apps/x/test/b.test.ts", 3), { id: "tests", name: "Alle Tests" }, sammler);
        const e = sammler.ergebnis();
        expect(e.gesamt).toBe(33);
        expect(e.faelle).toHaveLength(FAELLE_MAX);
        expect(e.faelle.slice(0, 3).every((f) => f.name.startsWith("[rot]"))).toBe(true);
        expect(e.faelle[3]?.name.startsWith("[übersprungen]")).toBe(true);
    });

    it("ein Bericht ohne Teilangabe (Aufrufer von vorher) liefert Fälle ohne Teil", () => {
        const f = faelleVonVitest(vitest("apps/server/test/a.test.ts", 1));
        expect(f.faelle[0]).toEqual({
            datei: "apps/server/test/a.test.ts",
            name: "[rot] Test 1",
            meldung: ["erwartet 0"],
        });
    });

    it("🔴 ein roter `kern` (Prüfprofil B) liefert seine Fälle aus kern.json, mit seinem Teil", () => {
        const dir = join(ordner, "kern-rot");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "Browserteil kern (Kernabläufe): 2 rot");
        writeFileSync(join(dir, "kern.json"), JSON.stringify(playwright("k.spec.ts", 2)));
        writeFileSync(join(dir, "kern.log"), "Running 12 tests\n  2 failed\n");
        const b = baueFehlerBericht(dir, "Satz", undefined);
        expect(b.schritt).toBe("kern");
        expect(b.faelle.map((f) => f.teil)).toEqual(["kern", "kern"]);
        expect(b.protokollEnde.join("\n")).toContain("2 failed");
    });

    it("🔴 das Tor: ein roter Teil `daten` liefert seine Fälle aus daten.json, ein roter `kern-echt` die seinen, jeder mit seinem Teil", () => {
        const dir = join(ordner, "tor-rot");
        mkdirSync(dir);
        writeFileSync(
            join(dir, "fehler.txt"),
            "Daten: 1 rot, 0 übersprungen, 0 todo\nBrowserteil kern-echt (Tor): 2 rot",
        );
        writeFileSync(
            join(dir, "daten.json"),
            JSON.stringify(vitest("apps/server/test/schreibwege-app-rolle.test.ts", 1)),
        );
        writeFileSync(join(dir, "kern-echt.json"), JSON.stringify(playwright("wegeditor-echt.spec.ts", 2)));
        writeFileSync(join(dir, "daten.log"), "FAIL  schreibwege\n");
        const b = baueFehlerBericht(dir, "Satz", undefined);
        expect(b.schritt).toBe("daten");
        expect(b.faelle.map((f) => f.teil)).toEqual(["daten", "kern-echt", "kern-echt"]);
        expect(b.faelle[0]?.teilName).toBe("Daten (Migrationen und Rechte)");
        expect(b.protokollEnde.join("\n")).toContain("FAIL");
        // Der Vertrag der Karte nimmt den Bericht (strenge Form, `teil` aus der Schrittliste).
        expect(Value.Check(ReleaseTestFehler, { ...b, faelle: b.faelle.slice(0, 20) })).toBe(true);
    });

    it("🔴 Schritte je Prüfprofil: das Tor fährt weder Format noch Vitest noch Besucherpaket, B und voll kein `daten`", () => {
        const tor = schritteJeProfil("tor");
        for (const id of ["lint", "typen", "bau", "daten", "kern-echt", "korpus-laden"] as const)
            expect(tor, id).toContain(id);
        for (const id of ["format", "tests", "besucherpaket", "kern", "browser-1"] as const)
            expect(tor, id).not.toContain(id);
        expect(schritteJeProfil("B")).toContain("kern");
        expect(schritteJeProfil("B")).not.toContain("daten");
        expect(schritteJeProfil("B")).not.toContain("kern-echt");
        // Ohne Profil in der Status-Datei: ein Lauf aus der Zeit vor den Profilen, also voll.
        expect(schritteJeProfil(undefined)).toEqual(schritteJeProfil("voll"));
        expect(schritteJeProfil("voll")).toContain("browser-4");
        expect(schritteJeProfil("voll")).not.toContain("daten");
        // Jeder Schritt der Liste gehört zu mindestens einem Profil (kein vergessener Schritt bliebe ewig „offen“).
        const alle = new Set([...tor, ...schritteJeProfil("B"), ...schritteJeProfil("voll")]);
        expect([...RELEASE_SCHRITTE].filter((id) => !alle.has(id))).toEqual([]);
    });

    it("das Profil eines Laufs steht in status.json; fehlt die Datei oder das Feld, ist es unbekannt", () => {
        const dir = join(ordner, "profil");
        mkdirSync(dir);
        expect(leseProfil(dir)).toBeUndefined();
        writeFileSync(join(dir, "status.json"), JSON.stringify({ profil: "tor" }));
        expect(leseProfil(dir)).toBe("tor");
        writeFileSync(join(dir, "status.json"), JSON.stringify({ status: "rot" }));
        expect(leseProfil(dir)).toBeUndefined();
    });

    it("🔴 wackelige Fälle (im zweiten Versuch grün) nennt der Bericht mit der Meldung des ersten Versuchs", () => {
        const bericht = {
            stats: { expected: 3, unexpected: 0, flaky: 1, skipped: 0 },
            suites: [
                {
                    file: "wegeditor-echt.spec.ts",
                    title: "wegeditor-echt.spec.ts",
                    suites: [
                        {
                            title: "Wege",
                            specs: [
                                {
                                    title: "Weg entfernen",
                                    ok: true,
                                    tests: [
                                        {
                                            status: "flaky",
                                            results: [
                                                { status: "failed", error: { message: "Timeout 5000 ms" } },
                                                { status: "passed" },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Weg zeichnen",
                                    ok: true,
                                    tests: [{ status: "expected", results: [{ status: "passed" }] }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const f = wackeligeFaelle(bericht, { id: "kern-echt", name: "Tor" });
        expect(f).toEqual([
            {
                datei: "wegeditor-echt.spec.ts",
                name: "[wackelig] Wege › Weg entfernen",
                meldung: ["Timeout 5000 ms"],
                teil: "kern-echt",
                teilName: "Tor",
            },
        ]);
        expect(wackeligeFaelle(playwright("a.spec.ts", 2))).toEqual([]);
        expect(wackeligeFaelle(undefined)).toEqual([]);
    });

    it("ein grüner voll-Teil wird nicht gelesen (Vitests Bericht ist mehrere Megabyte), ein roter schon", () => {
        const dir = join(ordner, "voll-gruen");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "Browserteil 1 (Teil 1): 1 rot");
        writeFileSync(join(dir, "vitest.json"), JSON.stringify(vitest("apps/x/test/a.test.ts", 1)));
        writeFileSync(join(dir, "browser-1.json"), JSON.stringify(playwright("a.spec.ts", 1)));
        writeFileSync(
            join(dir, "status.json"),
            JSON.stringify({ teile: [{ klasse: "voll", status: "gruen", exit: 0, sha: "a" }] }),
        );
        const b = baueFehlerBericht(dir, "Satz", undefined);
        expect(b.faelle.map((f) => f.teil)).toEqual(["browser-1"]);
        expect(b.schritt).toBe("browser-1");
        expect(b.faelle[0]?.teilName).toBe("browser-1");
    });
});

describe("Die Browserteile in der Ansicht", () => {
    let ordner = "";
    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "bericht-ansicht-teile-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });
    const definitionen = [1, 2, 3, 4].map((n) => ({
        id: `browser-${String(n)}`,
        name: `Teil ${String(n)}`,
        bereiche: ["orte", "wege"],
        specs: 10 * n,
    }));
    const schritt = (
        id: string,
        zustand: SchrittStand["zustand"],
        dauerMs?: number,
        erwartetMs = 1_200_000,
    ): SchrittStand => ({
        id: id as SchrittId,
        zustand,
        ...(dauerMs === undefined ? {} : { dauerMs }),
        erwartetMs,
        schaetzung: false,
    });

    it("🔴 Name, Bereiche, Zahl der Fälle, Zustand und Zeit je Teil; rot zählt die roten Fälle; ein übernommener Teil hat keine Erwartung", () => {
        const dir = join(ordner, "lauf");
        mkdirSync(dir);
        writeFileSync(join(dir, "browser-1.json"), JSON.stringify(playwright("a.spec.ts", 0, 373)));
        writeFileSync(join(dir, "browser-2.json"), JSON.stringify(playwright("b.spec.ts", 2, 435)));
        writeFileSync(join(dir, "browser-4.json"), JSON.stringify(playwright("d.spec.ts", 0, 497)));
        const buch: LaufBuch = {
            ...{ version: 1 as const, teile: [], problem: null, komponenten: {}, wiederholung: null },
            schritte: {
                "browser-1": { status: "gruen" },
                "browser-2": { status: "rot", grund: "Browserteil 2: 2 rot" },
                "browser-3": { status: "uebersprungen", grund: "Martin ließ sich nicht starten" },
                "browser-4": { status: "uebernommen" },
            },
        };
        const teile = baueTeileAnsicht({
            definitionen,
            laufbuch: buch,
            teileStatus: [{ klasse: "browser-1", status: "gruen" }],
            schritte: [
                schritt("browser-1", "fertig", 1_700_000),
                schritt("browser-2", "fertig", 1_900_000),
                schritt("browser-3", "uebersprungen", undefined, 0),
                schritt("browser-4", "uebernommen", undefined, 0),
            ],
            ordner: dir,
            erwartet: { "browser-3": 427 },
        });
        expect(teile.map((t) => [t.id, t.zustand, t.uebernommen])).toEqual([
            ["browser-1", "gruen", false],
            ["browser-2", "rot", false],
            ["browser-3", "uebersprungen", false],
            ["browser-4", "gruen", true],
        ]);
        expect(teile[0]).toMatchObject({
            name: "Teil 1",
            bereiche: ["orte", "wege"],
            specs: 10,
            faelle: 373,
            dauerMs: 1_700_000,
            erwartetMs: 1_200_000,
        });
        expect(teile[0]?.rot).toBe(0);
        expect(teile[0]?.faelleSchaetzung).toBeUndefined();
        expect(teile[1]).toMatchObject({ faelle: 437, rot: 2 });
        // Ein Teil ohne Bericht (hier: entfallen) zeigt die Schätzung aus einem früheren Lauf und sagt es dazu.
        expect(teile[2]).toMatchObject({
            grund: "Martin ließ sich nicht starten",
            faelle: 427,
            faelleSchaetzung: true,
        });
        expect(teile[2]).not.toHaveProperty("rot");
        expect(teile[3]).toMatchObject({ faelle: 497, erwartetMs: 0 });
        for (const t of teile) expect([...Value.Errors(ReleaseTestTeil, t)], t.id).toEqual([]);
    });

    it("🔴 solange ein Teil nicht gelaufen ist: offen oder laufend, Fälle als Schätzung aus dem früheren Lauf", () => {
        const teile = baueTeileAnsicht({
            definitionen,
            laufbuch: undefined,
            teileStatus: [],
            schritte: [
                schritt("browser-1", "laeuft", 120_000),
                schritt("browser-2", "offen"),
                schritt("browser-3", "offen"),
                schritt("browser-4", "offen"),
            ],
            ordner: undefined,
            erwartet: { "browser-1": 373, "browser-2": 437 },
        });
        expect(teile.map((t) => t.zustand)).toEqual(["laeuft", "offen", "offen", "offen"]);
        expect(teile[0]).toMatchObject({ faelle: 373, faelleSchaetzung: true, dauerMs: 120_000 });
        expect(teile[2]).not.toHaveProperty("faelle");
        expect(teile.every((t) => !t.uebernommen)).toBe(true);
    });

    it("ein Lauf aus der Zeit davor (kein Laufbuch): ein beendeter Schritt gilt als grün, ein fehlerhafter als rot", () => {
        const teile = baueTeileAnsicht({
            definitionen,
            laufbuch: undefined,
            teileStatus: [],
            schritte: [
                schritt("browser-1", "fertig", 1),
                schritt("browser-2", "fehler", 1),
                schritt("browser-3", "offen"),
                schritt("browser-4", "offen"),
            ],
            ordner: undefined,
            erwartet: {},
        });
        expect(teile.map((t) => t.zustand)).toEqual(["gruen", "rot", "offen", "offen"]);
    });

    it("die Zahlen eines Berichts: Fälle insgesamt, rote mit wackeligen", () => {
        expect(zaehleBrowserFaelle({ stats: { expected: 90, unexpected: 3, flaky: 2, skipped: 5 } })).toEqual({
            faelle: 100,
            rot: 5,
        });
        expect(zaehleBrowserFaelle(undefined)).toEqual({ faelle: 0, rot: 0 });
    });

    it("erwartete Fälle: nur aus Läufen mit Laufbuch (vorher meinte browser-2 ein anderes Viertel), der jüngste gewinnt", () => {
        const laeufe = join(ordner, ".release-runs");
        const lauf = (name: string, start: string, zahl: number, mitBuch: boolean): void => {
            const dir = join(laeufe, name);
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, "status.json"),
                JSON.stringify({ sha: name.slice(0, 40), start, status: "rot", teile: [] }),
            );
            writeFileSync(
                join(dir, "browser-2.json"),
                JSON.stringify({ stats: { expected: zahl, unexpected: 0, flaky: 0, skipped: 0 } }),
            );
            if (mitBuch)
                schreibeLaufBuch(dir, {
                    version: 1,
                    teile: [],
                    problem: null,
                    komponenten: {},
                    wiederholung: null,
                    schritte: {},
                });
        };
        lauf("1".repeat(40), "2026-10-20T00:00:00.000Z", 999, false);
        lauf("2".repeat(40), "2026-10-22T00:00:00.000Z", 430, true);
        lauf("3".repeat(40), "2026-10-23T00:00:00.000Z", 437, true);
        expect(erwarteteFaelle(laeufe)).toEqual({ "browser-2": 437 });
        expect(erwarteteFaelle(join(ordner, "gibt-es-nicht"))).toEqual({});
    });
});
