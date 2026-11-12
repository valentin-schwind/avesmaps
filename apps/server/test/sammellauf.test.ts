import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    ersterRoterCommit,
    fehlendeMigrationen,
    genannteDateien,
    nachlaufGruen,
    notizText,
    offeneTeile,
    browserTeilGruen,
    playwrightAuswertung,
    roteSchritte,
    roteTestDateien,
    sitzungFuer,
    stageAusNotiz,
    urteilOhneMigrationen,
    urteilVon,
    vereineBerichte,
    wiAus,
    type SammellaufErgebnis,
    type Schuldiger,
    type ViertelLauf,
} from "../../../scripts/dev/sammellauf-auswertung.ts";
import {
    BEKANNT_ROT,
    BEKANNT_TAGE,
    bekanntFuer,
    giltNoch,
    type BekanntRot,
} from "../../../scripts/dev/sammellauf-bekannt.ts";

/**
 * Der Sammellauf nach dem Push (`scripts/dev/sammellauf.ts`, WI-0228, Betreiber 2026-10-18 „A, ab jetzt immer“). Problemfälle: der falsche
 * Commit gilt als schuldig; eine rote Datei wird übersehen; die erste Zeile der Git-Notiz passt nicht zu Claudios `freigabe-stand.sh`.
 */
const LOG = [
    "  ok   Typcheck aus der Wurzel (110 s)",
    "  ROT  Tests ohne Datenbank, Durchgang Server (ohne Isolierung) (905 s)",
    "        FAIL  apps/server/test/territory-reshape.test.ts > Fläche > 🔴 Kante",
    "        FAIL  apps/server/test/territory-reshape.test.ts > Fläche > zweiter Fall",
    "   FAIL  apps/web/test/panel.test.ts > Panel",
    "  ROT  Lint (alles: npm run lint) (52 s)",
    "C:\\x\\apps\\server\\src\\editor\\path-edit.ts  18:10  error  'mapOperation' is defined but never used",
].join("\n");

describe("Sammellauf: Auswertung", () => {
    it("🔴 rote Testdateien und Schritte aus der Ausgabe von vor-dem-push, jede Datei einmal", () => {
        expect(roteTestDateien(LOG)).toEqual([
            "apps/server/test/territory-reshape.test.ts",
            "apps/web/test/panel.test.ts",
        ]);
        expect(roteSchritte(LOG)).toEqual([
            "Tests ohne Datenbank, Durchgang Server (ohne Isolierung)",
            "Lint (alles: npm run lint)",
        ]);
    });

    it("ein roter Schritt ohne Testdatei nennt die geänderten Dateien, die in der Meldung stehen", () => {
        expect(genannteDateien(LOG, ["apps/server/src/editor/path-edit.ts", "apps/server/src/routes/x.ts"])).toEqual([
            "apps/server/src/editor/path-edit.ts",
        ]);
    });

    it("Work Item aus dem Commit-Titel, Sitzung aus der Anspruchsliste", () => {
        expect(wiAus("fix(WI-0209): Lint der Gebiete")).toBe("WI-0209");
        expect(wiAus("docs(EDIT-0003): Paragraph 6")).toBe("EDIT-0003");
        expect(wiAus("fix: ohne Nummer")).toBeUndefined();
        const liste = [{ workItem: "WI-0209", notiz: "Herrschaftsgebiete" }];
        expect(sitzungFuer("WI-0209", liste)).toBe("Herrschaftsgebiete");
        expect(sitzungFuer("WI-0177", liste)).toBeUndefined();
    });

    it("🔴 binäre Suche: findet den ersten roten Commit mit höchstens ceil(log2 n) Läufen", async () => {
        const commits = Array.from({ length: 13 }, (_, i) => `c${String(i)}`);
        for (const schuld of [0, 1, 6, 11, 12]) {
            const gefragt: string[] = [];
            const r = await ersterRoterCommit(commits, (sha) => {
                gefragt.push(sha);
                return Promise.resolve(Number(sha.slice(1)) < schuld);
            });
            expect(r.sha, `Schuld bei c${String(schuld)}`).toBe(`c${String(schuld)}`);
            expect(r.laeufe).toBeLessThanOrEqual(Math.ceil(Math.log2(commits.length)));
            expect(gefragt, "der rote Kopf wird nicht noch einmal gefahren").not.toContain("c12");
        }
        expect(await ersterRoterCommit([], () => Promise.resolve(true))).toEqual({ sha: undefined, laeufe: 0 });
        expect((await ersterRoterCommit(["nur"], () => Promise.resolve(true))).sha, "ein Commit: er ist es").toBe(
            "nur",
        );
    });

    it("Playwright-Bericht: rote Specs (auch verschachtelt) und Zahlen", () => {
        const bericht = {
            stats: { expected: 300, unexpected: 2, flaky: 1, skipped: 4 },
            suites: [
                {
                    file: "a.spec.ts",
                    title: "a.spec.ts",
                    specs: [
                        { ok: true, title: "gut" },
                        { ok: false, title: "kaputt" },
                    ],
                },
                {
                    file: "b.spec.ts",
                    title: "b.spec.ts",
                    suites: [{ title: "Gruppe", specs: [{ ok: false, title: "auch kaputt" }] }],
                },
                { file: "c.spec.ts", specs: [{ ok: true }] },
            ],
        };
        expect(playwrightAuswertung(bericht)).toEqual({
            rot: ["a.spec.ts", "b.spec.ts"],
            faelle: [
                { datei: "a.spec.ts", titel: "kaputt" },
                { datei: "b.spec.ts", titel: "Gruppe › auch kaputt" },
            ],
            zahlen: { erwartet: 300, rot: 2, wackelig: 1, uebersprungen: 4 },
        });
        expect(playwrightAuswertung(undefined).rot).toEqual([]);
    });

    it("🔴 Nachlauf: ein bekannter roter Fall macht die Datei nicht rot, ein anderer schon; ohne roten Fall zählt der Exit-Code", () => {
        const bericht = (titel: readonly string[]) => ({
            stats: { expected: 30, unexpected: titel.length },
            suites: [{ file: "playmode.spec.ts", specs: titel.map((t) => ({ ok: false, title: t })) }],
        });
        const bekannt = (datei: string, titel: string): boolean =>
            datei === "playmode.spec.ts" && titel.includes("Kamera folgt im Gebirge ruhig");
        expect(nachlaufGruen(1, bericht(["🔴 Kamera folgt im Gebirge ruhig"]), bekannt)).toBe(true);
        expect(nachlaufGruen(1, bericht(["🔴 Kamera folgt im Gebirge ruhig", "🔴 2D ↔ 3D"]), bekannt)).toBe(false);
        expect(nachlaufGruen(0, bericht([]), bekannt)).toBe(true);
        expect(nachlaufGruen(1, bericht([]), bekannt), "Abbruch ohne roten Fall").toBe(false);
        expect(nachlaufGruen(1, undefined, bekannt)).toBe(false);
    });

    it("🔴 die erste Zeile der Git-Notiz ist der Vertrag mit freigabe-stand.sh: `<sha40> <ISO-Zeit> gruen|rot`", () => {
        const sha = "a".repeat(40);
        const e: SammellaufErgebnis = {
            sha,
            start: "2026-10-18T20:00:00.000Z",
            ende: "2026-10-18T20:41:00.000Z",
            gruen: false,
            urteil: "rot",
            dauer: { vorDemPush: 1200, browser: 1300 },
            vorDemPushExit: 1,
            roteSchritte: ["Lint (alles: npm run lint)"],
            roteTests: ["apps/server/test/x.test.ts"],
            browser: { erwartet: 300, rot: 0, wackelig: 0, uebersprungen: 0 },
            roteBrowser: [],
            bekanntRot: ["apps/web/e2e/playmode.spec.ts „Kamera folgt im Gebirge ruhig“"],
            schuldige: [
                {
                    datei: "apps/server/test/x.test.ts",
                    art: "test",
                    wie: "eingegrenzt",
                    commit: { sha: "b".repeat(40), betreff: "fix(WI-0209): x", autor: "Claudia" },
                    wi: "WI-0209",
                    sitzung: "Herrschaftsgebiete",
                },
            ],
            letzterGruen: "c".repeat(40),
        };
        const zeilen = notizText(e).split("\n");
        expect(zeilen[0]).toBe(`${sha} 2026-10-18T20:41:00.000Z rot`);
        expect(zeilen[0]).toMatch(/^[0-9a-f]{40} \S+ (gruen|rot)$/);
        expect(zeilen.join("\n")).toContain(
            "eingegrenzt: apps/server/test/x.test.ts -> bbbbbbbbb Claudia: fix(WI-0209): x [WI-0209, Herrschaftsgebiete]",
        );
        expect(() => notizText({ ...e, gruen: true })).toThrow("Unvollständiger Release-Nachweis");
        const vollstaendig: SammellaufErgebnis = {
            ...e,
            gruen: true,
            urteil: "gruen",
            vorDemPushExit: 0,
            roteSchritte: [],
            roteTests: [],
            bekanntRot: [],
            schuldige: [],
            viertel: [{ sha, teile: [1, 2, 3, 4], gruen: true, exitCode: 0, ende: e.ende }],
        };
        expect(notizText(vollstaendig).split("\n")[0]).toBe(`${sha} ${e.ende} gruen`);
        expect(() => notizText({ ...vollstaendig, sha: "b".repeat(40) })).toThrow("Unvollständiger Release-Nachweis");
        expect(() => notizText({ ...vollstaendig, vorDemPushExit: null })).toThrow("Unvollständiger Release-Nachweis");

        expect(notizText({ ...e, browserTeil: "2/4" }), "die Notiz nennt das geprüfte Viertel").toContain(
            "Browserfälle (Teil 2/4)",
        );
        expect(notizText(e)).toContain("bekannt rot: apps/web/e2e/playmode.spec.ts „Kamera folgt im Gebirge ruhig“");
        const viertel: ViertelLauf[] = [
            { sha: "d".repeat(40), teile: [1], gruen: true, exitCode: 0, ende: "x" },
            { sha: sha, teile: [2], gruen: true, exitCode: 0, ende: "y" },
        ];
        expect(
            notizText({ ...e, viertel, vorDemPushExit: 0, vorDemPushFrueher: true }),
            "welche Viertel auf welchem Commit",
        ).toContain("Viertel: Teil 1 grün auf ddddddddd, Teil 2 grün auf ");
        expect(notizText({ ...e, vorDemPushExit: 0, vorDemPushFrueher: true })).toContain(
            "grün (früherer Lauf auf diesem Commit)",
        );
    });

    it("der alte periodische Schreiber ist stillgelegt", () => {
        const text = readFileSync(
            join(import.meta.dirname, "..", "..", "..", "scripts", "dev", "sammellauf.ts"),
            "utf8",
        );
        expect(text).toContain("process.exitCode = 2");
        expect(text).toContain("release-start.ps1");
        expect(text).not.toContain("git(");
    });
});

describe("Sammellauf: Urteil und Stage-Commit", () => {
    const basis = {
        vorDemPushExit: 0,
        schritte: [] as string[],
        browserLief: true,
        browserAuswertbar: true,
        browserRot: 0,
        schuldige: [] as Schuldiger[],
    };
    const test = (wie: Schuldiger["wie"]): Schuldiger => ({ datei: "apps/server/test/x.test.ts", art: "test", wie });

    it("🔴 grün nur, wenn vor-dem-push grün ist und kein Browserfall rot", () => {
        expect(urteilVon(basis)).toBe("gruen");
        expect(
            urteilVon({ ...basis, browserLief: false, browserAuswertbar: false }),
            "Hauptorchestrierung 2026-10-19: kein Lauf öffnet den Knopf ohne Browserfälle",
        ).toBe("offen");
    });

    it("🔴 Vertrag: Rot nur für echte Fehler; nur wackelige Dateien oder ein Abbruch schreiben keine Notiz", () => {
        const roteTests = {
            ...basis,
            vorDemPushExit: 1,
            schritte: ["Tests ohne Datenbank, Durchgang Server (ohne Isolierung)"],
        };
        expect(urteilVon({ ...roteTests, schuldige: [test("wackelig")] }), "im Nachlauf grün: Last").toBe("wackelig");
        expect(urteilVon({ ...roteTests, schuldige: [test("wackelig"), test("eingegrenzt")] })).toBe("rot");
        expect(urteilVon({ ...roteTests, schuldige: [test("vermutet")] }), "auch ohne grünen Vorgänger rot").toBe(
            "rot",
        );
        expect(
            urteilVon({ ...basis, vorDemPushExit: 1, schritte: ["Lint (alles: npm run lint)"] }),
            "Lint wackelt nicht",
        ).toBe("rot");
        expect(urteilVon({ ...basis, vorDemPushExit: 1, schritte: ["Kopie nicht angelegt: EBUSY"] })).toBe(
            "ungeprueft",
        );
        expect(urteilVon({ ...basis, vorDemPushExit: 1, schritte: ["PostgreSQL fehlt auf diesem Rechner"] })).toBe(
            "ungeprueft",
        );
        expect(urteilVon({ ...basis, vorDemPushExit: null }), "abgebrochen ohne roten Schritt").toBe("ungeprueft");
        expect(urteilVon({ ...basis, browserAuswertbar: false }), "Browserfälle liefen nicht").toBe("ungeprueft");
        // 2026-10-19: der lokalen Datenbank fehlten 0194 bis 0209, ohne 0208 kein Wegenetz und 22 unechte Rote in einem Viertel.
        expect(fehlendeMigrationen(["0207_a", "0209_c", "0208_b"], ["0207_a"])).toEqual(["0208_b", "0209_c"]);
        expect(fehlendeMigrationen(["0207_a"], ["0207_a", "0210_neu"]), "mehr eingespielt ist kein Fehlen").toEqual([]);
        expect(urteilOhneMigrationen("gruen", 2), "kein Grün ohne die Migrationen des Commits").toBe("ungeprueft");
        expect(urteilOhneMigrationen("offen", 1)).toBe("ungeprueft");
        expect(urteilOhneMigrationen("rot", 3), "ein Rot des vollen Laufs bleibt rot").toBe("rot");
        expect(urteilOhneMigrationen("gruen", 0)).toBe("gruen");
        expect(urteilVon({ ...basis, browserRot: 2, schuldige: [{ ...test("wackelig"), art: "browser" }] })).toBe(
            "wackelig",
        );
    });

    it("Stage-Commit aus Claudios Notiz: erste Zeile `<sha40> <ISO-Zeit> stage`", () => {
        const sha = "d".repeat(40);
        expect(
            stageAusNotiz(`${sha} 2026-10-18T22:10:00+02:00 stage
Rollout grün`),
        ).toEqual({ sha, zeit: "2026-10-18T22:10:00+02:00" });
        expect(stageAusNotiz(`${sha} 2026-10-18T22:10:00+02:00 gruen`)).toBeUndefined();
        expect(stageAusNotiz("kaputt")).toBeUndefined();
    });
});

describe("Sammellauf: vier grüne Viertel öffnen den Knopf (Hauptorchestrierung 2026-10-19)", () => {
    const lauf = (teil: number | number[], gruen = true, sha = "a".repeat(40)): ViertelLauf => ({
        sha,
        teile: Array.isArray(teil) ? teil : [teil],
        gruen,
        exitCode: gruen ? 0 : 1,
        ende: "2026-10-19T00:00:00Z",
    });

    it("🔴 ein einzelnes grünes Viertel öffnet ihn nicht, vier reihum grüne schon", () => {
        expect(offeneTeile([lauf(1)], 4, "a".repeat(40))).toEqual([2, 3, 4]);
        expect(offeneTeile([lauf(1), lauf(2), lauf(3)], 4, "a".repeat(40))).toEqual([4]);
        expect(offeneTeile([lauf(3), lauf(4), lauf(1), lauf(2)], 4, "a".repeat(40))).toEqual([]);
        expect(offeneTeile([], 4, "a".repeat(40)), "ohne Stand (stand.json verloren) bleibt er zu").toEqual([
            1, 2, 3, 4,
        ]);
    });

    it("🔴 ein rotes Viertel hält ihn zu, bis es selbst wieder grün lief", () => {
        expect(offeneTeile([lauf(1), lauf(2, false), lauf(3), lauf(4)], 4, "a".repeat(40))).toEqual([2]);
        expect(offeneTeile([lauf(1), lauf(2, false), lauf(3), lauf(4), lauf(1), lauf(2)], 4, "a".repeat(40))).toEqual(
            [],
        );
    });

    it("🔴 `--alle-viertel`: vier Berichte zählen wie einer, kein roter Fall eines Viertels geht verloren", () => {
        const bericht = (datei: string, ok: boolean, zahlen: { expected: number; unexpected: number }): unknown => ({
            suites: [{ file: datei, title: datei, specs: [{ ok, file: datei, title: `Fall in ${datei}` }] }],
            stats: { ...zahlen, flaky: 0, skipped: 0 },
        });
        const a = playwrightAuswertung(
            vereineBerichte([
                bericht("a.spec.ts", true, { expected: 100, unexpected: 0 }),
                bericht("b.spec.ts", false, { expected: 90, unexpected: 1 }),
                undefined,
                bericht("d.spec.ts", false, { expected: 80, unexpected: 2 }),
            ]),
        );
        expect(a.rot).toEqual(["b.spec.ts", "d.spec.ts"]);
        expect(a.zahlen).toEqual({ erwartet: 270, rot: 3, wackelig: 0, uebersprungen: 0 });
    });

    it("nur die jüngsten vier Läufe zählen; ein Lauf über alle Fälle deckt alle Viertel", () => {
        expect(
            offeneTeile([lauf(1), lauf(2), lauf(3), lauf(4), lauf(2), lauf(3)], 4, "a".repeat(40)),
            "Teil 1 liegt fünf Läufe zurück",
        ).toEqual([1]);
        expect(offeneTeile([lauf(2, false), lauf([1, 2, 3, 4])], 4, "a".repeat(40))).toEqual([]);
        expect(offeneTeile([lauf([1, 2, 3, 4]), lauf(3, false)], 4, "a".repeat(40))).toEqual([3]);
    });

    it("bindet jedes Viertel an die vollständige Kandidaten-SHA", () => {
        const a = "a".repeat(40);
        const b = "b".repeat(40);
        const mixed = [lauf(1), lauf(2), lauf(3), lauf(4, true, b)];
        expect(offeneTeile(mixed, 4, a)).toEqual([4]);
        expect(offeneTeile(mixed, 4, b)).toEqual([1, 2, 3]);
        expect(offeneTeile([lauf([1, 2, 3, 4])], 4, b), "neue Stage erbt keinen alten Nachweis").toEqual([1, 2, 3, 4]);
        expect(offeneTeile([lauf([1, 2, 3, 4])], 4, "aaaaaaa")).toEqual([1, 2, 3, 4]);
    });

    it("akzeptiert weder abgebrochene Teile noch alte Berichte ohne Exitcode", () => {
        const all = lauf([1, 2, 3, 4]);
        expect(offeneTeile([all, { ...lauf(2), exitCode: null }], 4, all.sha)).toEqual([2]);
        expect(offeneTeile([{ ...all, exitCode: undefined } as unknown as ViertelLauf], 4, all.sha)).toEqual([
            1, 2, 3, 4,
        ]);
    });

    it("ein Teilbericht ist kein Erfolg bei Abbruch, Timeout, Fehler oder leerem Lauf", () => {
        const report = { stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 } };
        expect(browserTeilGruen(0, report)).toBe(true);
        expect(browserTeilGruen(null, report)).toBe(false);
        expect(browserTeilGruen(1, report)).toBe(false);
        expect(browserTeilGruen(124, report)).toBe(false);
        expect(browserTeilGruen(0, { ...report, errors: [{ message: "interrupted" }] })).toBe(false);
        expect(browserTeilGruen(0, { stats: { expected: 0 } })).toBe(false);
        expect(browserTeilGruen(0, undefined)).toBe(false);
        expect(browserTeilGruen(0, { stats: { expected: 1, unexpected: 1 } })).toBe(false);
        expect(browserTeilGruen(0, { stats: { expected: 1, flaky: 1 } })).toBe(false);
    });
});

describe("Sammellauf: bekannte Rote (Betreiber 2026-10-19 „A“)", () => {
    const eintrag = {
        datei: "apps/web/e2e/playmode.spec.ts",
        fall: "Kamera folgt im Gebirge ruhig",
        grund: "x",
        sitzung: "Kamera",
        seit: "2026-10-19",
    };

    it("🔴 deckt nur den genannten Fall der Datei, nicht ihre übrigen Fälle", () => {
        const heute = new Date("2026-10-19T12:00:00Z");
        expect(bekanntFuer(eintrag.datei, "Playmode › 🔴 Kamera folgt im Gebirge ruhig", heute, [eintrag])).toBe(
            eintrag,
        );
        expect(bekanntFuer(eintrag.datei, "Playmode › anderer Fall", heute, [eintrag])).toBeUndefined();
        expect(
            bekanntFuer("apps/web/e2e/andere.spec.ts", "Kamera folgt im Gebirge ruhig", heute, [eintrag]),
        ).toBeUndefined();
        const ganzeDatei: BekanntRot = {
            datei: eintrag.datei,
            grund: eintrag.grund,
            sitzung: eintrag.sitzung,
            seit: eintrag.seit,
        };
        expect(bekanntFuer(eintrag.datei, undefined, heute, [ganzeDatei]), "ohne Fall gilt die ganze Datei").toBe(
            ganzeDatei,
        );
    });

    it(`🔴 ein Eintrag verfällt nach ${String(BEKANNT_TAGE)} Tagen und zählt danach wieder als rot`, () => {
        expect(giltNoch(eintrag, new Date("2026-10-26T23:59:00Z"))).toBe(true);
        expect(giltNoch(eintrag, new Date("2026-10-27T00:00:01Z"))).toBe(false);
    });

    it("die Liste nennt im Kopf ihren einzigen Freigeber, und jeder Eintrag trägt Grund, Sitzung und Tag", () => {
        const kopf = readFileSync(
            join(import.meta.dirname, "..", "..", "..", "scripts", "dev", "sammellauf-bekannt.ts"),
            "utf8",
        );
        expect(kopf).toMatch(/Einziger Freigeber dieser Liste ist die Hauptorchestrierung/);
        for (const e of BEKANNT_ROT) {
            expect(e.grund.length, e.datei).toBeGreaterThan(10);
            expect(e.sitzung.length, e.datei).toBeGreaterThan(3);
            expect(e.seit, e.datei).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});
