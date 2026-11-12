import { describe, expect, it } from "vitest";
import {
    DB_DURCHGANG_RAM_BEDARF_BYTES,
    DB_DURCHGANG_RAM_BODEN_BYTES,
    HANDOVER_KOPF_TEST,
    RELEASE_TEILE_TEST,
    beruehrtHandover,
    GELAENDE_SICHT_TEST,
    beruehrtGelaendeLeser,
    beruehrtReleaseTeile,
    datenbankParallel,
    datenbankRot,
    datenbankSatz,
    liesUebersprungene,
    mitFrist,
    nurMarkdownDoku,
    planeDurchgaenge,
    waehleTests,
    type TestDatei,
} from "../../../scripts/dev/pruef-auswahl.ts";
import { TESTDB_VAR, skipZeilen } from "./support/test-umgebung.ts";

/**
 * Die Pfadregel für `vor-dem-push --tests` (`scripts/dev/pruef-auswahl.ts`, Hauptorchestrierung 2026-10-17): Eine Doku-Zeile muss nicht
 * hinter einen vollen Lauf von 38 min. Problemfälle: eine Änderung, die doch Code berührt, läuft nur mit der kleinen Stufe; eine Doku, die
 * ein Test liest, wird nicht geprüft; eine Weboberfläche, die ein Servertest liest, wird nicht geprüft; eine unbestimmbare Änderung
 * läuft nur klein.
 */
const TESTS: TestDatei[] = [
    { pfad: "apps/server/test/regelwerk-nummern.test.ts", text: "// prüft die Nummern" },
    { pfad: "apps/server/test/regelwerk-verweise.test.ts", text: "// prüft die Verweise" },
    { pfad: "apps/server/test/coordination.test.ts", text: 'join("project-control/handovers", name)' },
    { pfad: "apps/server/test/route-api.test.ts", text: "// Routen" },
    { pfad: "apps/server/test/sprachtafel-gleich.test.ts", text: 'readFileSync("apps/web/src/i18n/de.ts")' },
    { pfad: "apps/web/test/camera.test.ts", text: "// Kamera, docs/design/3d-navigation.md" },
    { pfad: "apps/web/test/panel.test.ts", text: "// Panel" },
    { pfad: "packages/shared/test/zoom-bands.test.ts", text: "// Bänder" },
];
const waehle = (geaendert: string[] | undefined, voll = false) => waehleTests({ geaendert, voll, testDateien: TESTS });

describe("Pfadregel für den Testteil", () => {
    it("🔴 nur Doku, Handover, Zustand: die Wächter und die Tests, die Doku lesen", () => {
        const a = waehle(["project-control/handovers/2026-10-17-x.md", "docs/regeln/entwicklung.md", "AGENTS.md"]);
        expect(a.stufe).toBe("doku");
        expect(a.filter).toEqual([
            "apps/server/test/coordination.test.ts",
            "apps/server/test/regelwerk-nummern.test.ts",
            "apps/server/test/regelwerk-verweise.test.ts",
            "apps/web/test/camera.test.ts",
        ]);
        expect(a.grund).toMatch(/nur Doku \(3 Dateien\)/);
    });

    it("🔴 Web und Doku: Web-, shared- und Doku-Tests, dazu die Servertests, die Dateien der Weboberfläche lesen", () => {
        const a = waehle([
            "apps/web/src/controls/x.vue",
            "apps/web/test/x.test.ts",
            "project-control/state/current.md",
        ]);
        expect(a.stufe).toBe("web");
        expect(a.filter).toContain("apps/web/test");
        expect(a.filter).toContain("packages/shared/test");
        expect(a.filter, "ein Servertest, der apps/web liest").toContain("apps/server/test/sprachtafel-gleich.test.ts");
        expect(a.filter, "Doku-Leser bleiben dabei").toContain("apps/server/test/coordination.test.ts");
        expect(a.filter, "andere Servertests nicht").not.toContain("apps/server/test/route-api.test.ts");
    });

    it("🔴 alles, was mehr als Doku und Web berührt, läuft in der Stufe bereich (WI-0228: leicht vor dem Push, voll im Sammellauf)", () => {
        for (const datei of [
            "apps/server/src/routes/route.ts",
            "apps/server/migrations/0150_x.sql",
            "packages/shared/src/index.ts",
            "config/design-canon/avesmaps.json",
            "scripts/dev/vor-dem-push.ts",
            "package.json",
            "vitest.config.ts",
        ]) {
            const a = waehle(["docs/regeln/x.md", datei]);
            expect(a.stufe, datei).toBe("bereich");
            expect(a.filter, `${datei}: die Regelwerk-Wächter immer`).toContain(
                "apps/server/test/regelwerk-nummern.test.ts",
            );
            expect(a.grund, datei).toContain(datei);
        }
    });

    it("🔴 ein einziger Code-Pfad neben vielen Doku-Pfaden macht die Stufe bereich, nie doku", () => {
        const doku = Array.from({ length: 30 }, (_, i) => `project-control/handovers/h${String(i)}.md`);
        expect(waehle([...doku, "apps/server/src/app.ts"]).stufe).toBe("bereich");
    });

    it("🔴 `--voll` erzwingt alles, auch bei reiner Doku", () => {
        const a = waehle(["docs/x.md"], true);
        expect(a).toMatchObject({ stufe: "voll", grund: "--voll", filter: [] });
    });

    it("🔴 unbestimmbare oder leere Änderung: voll", () => {
        expect(waehle(undefined).stufe).toBe("voll");
        expect(waehle([]).stufe).toBe("voll");
    });

    it("Windows-Trenner und Markdown überall zählen als Doku; keine Doku-Tests gefunden: voll", () => {
        expect(waehle(["apps\\server\\README.md"]).stufe).toBe("doku");
        const leer = waehleTests({ geaendert: ["docs/x.md"], voll: false, testDateien: [] });
        expect(leer).toMatchObject({ stufe: "voll", filter: [] });
    });
});

/** Der Aufruf, an dem die Pfadregel eine Mock-Datei erkennt, als Zeichenkette zusammengesetzt: Diese Testdatei soll nicht selbst „vi.mock“ im Quelltext tragen und damit im isolierten Durchgang landen. */
const MOCKEN = ["vi", "mock"].join(".");

describe("Durchgänge des vollen Laufs", () => {
    const MIT_MOCK: TestDatei[] = [
        ...TESTS,
        { pfad: "apps/web/test/route-client.test.ts", text: `${MOCKEN}("../src/besuch/besuch-melden.ts", () => ({}))` },
        { pfad: "apps/web/test/geometrie-besitzer.test.ts", text: `  ${MOCKEN}('../src/map/x.ts');` },
        {
            pfad: "apps/web/test/kein-mock.test.ts",
            text: "// erwähnt vi.mocked(melde) und vi.mockClear(), mockt aber nichts",
        },
    ];
    const voll = waehleTests({ geaendert: ["apps/server/src/app.ts"], voll: true, testDateien: MIT_MOCK });

    it("🔴 voll: Server ohne Isolierung, Web und shared ohne Isolierung ohne die Mock-Dateien, die Mock-Dateien isoliert", () => {
        const plan = planeDurchgaenge({ auswahl: voll, testDateien: MIT_MOCK, isoliert: false });
        expect(plan.durchgaenge.map((d) => d.name)).toEqual([
            "Tests ohne Datenbank, Durchgang Server (ohne Isolierung)",
            "Tests ohne Datenbank, Durchgang Web und shared (ohne Isolierung)",
            "Tests ohne Datenbank, Durchgang mit vi.mock (isoliert, 2 Dateien)",
        ]);
        const [server, rest, mocks] = plan.durchgaenge;
        const ausgeschlossen = [
            "--exclude",
            "apps/web/test/geometrie-besitzer.test.ts",
            "--exclude",
            "apps/web/test/route-client.test.ts",
        ];
        expect(server?.args).toEqual(["--", "--no-isolate", ...ausgeschlossen, "apps/server/test"]);
        expect(rest?.args).toEqual(["--", "--no-isolate", ...ausgeschlossen, "apps/web/test", "packages/shared/test"]);
        expect(mocks?.args).toEqual([
            "--",
            "apps/web/test/geometrie-besitzer.test.ts",
            "apps/web/test/route-client.test.ts",
        ]);
        expect(plan.isoliert).toEqual([
            "apps/web/test/geometrie-besitzer.test.ts",
            "apps/web/test/route-client.test.ts",
        ]);
    });

    it("🔴 die Zeile im Lauf nennt, welche Dateien isoliert liefen; `vi.mocked` und `vi.mockClear` zählen nicht", () => {
        const plan = planeDurchgaenge({ auswahl: voll, testDateien: MIT_MOCK, isoliert: false });
        expect(plan.zeile).toBe(
            "  Isoliert liefen 2 Dateien mit vi.mock: geometrie-besitzer, route-client; alles andere in zwei Durchgängen ohne Isolierung (Server, Web und shared).",
        );
        expect(plan.isoliert).not.toContain("apps/web/test/kein-mock.test.ts");
    });

    it("ohne Datei mit vi.mock gibt es nur die zwei Durchgänge ohne Isolierung, und die Zeile sagt es", () => {
        const plan = planeDurchgaenge({ auswahl: voll, testDateien: TESTS, isoliert: false });
        expect(plan.durchgaenge).toHaveLength(2);
        expect(plan.isoliert).toEqual([]);
        expect(plan.zeile).toMatch(/keine Datei benutzt vi\.mock/);
    });

    it("🔴 `--isoliert` erzwingt den alten Lauf: ein Durchgang, kein `--no-isolate`", () => {
        const plan = planeDurchgaenge({ auswahl: voll, testDateien: MIT_MOCK, isoliert: true });
        expect(plan.durchgaenge).toHaveLength(1);
        expect(plan.durchgaenge[0]?.args).toEqual([]);
        expect(JSON.stringify(plan)).not.toContain("--no-isolate");
        expect(plan.zeile).toMatch(/--isoliert/);
    });

    it("🔴 die kleinen Stufen behalten ihren einen isolierten Durchgang mit den Filtern", () => {
        const doku = waehleTests({ geaendert: ["docs/x.md"], voll: false, testDateien: MIT_MOCK });
        const plan = planeDurchgaenge({ auswahl: doku, testDateien: MIT_MOCK, isoliert: false });
        expect(plan.durchgaenge).toHaveLength(1);
        expect(plan.durchgaenge[0]?.args).toEqual(["--", ...doku.filter]);
        expect(plan.durchgaenge[0]?.name).toMatch(/Stufe doku/);
        expect(plan.zeile).toMatch(/Stufe doku: klein genug/);
        expect(JSON.stringify(plan)).not.toContain("--no-isolate");
    });

    it("🔴 die Stufe web teilt den Prozess wie der volle Lauf: Web und shared ohne Isolierung, vi.mock und die übrigen Leser isoliert", () => {
        const web = waehleTests({ geaendert: ["apps/web/src/x.vue"], voll: false, testDateien: MIT_MOCK });
        const plan = planeDurchgaenge({ auswahl: web, testDateien: MIT_MOCK, isoliert: false });
        expect(plan.durchgaenge.map((d) => d.name)).toEqual([
            "Tests Web und shared (ohne Isolierung, Stufe web)",
            "Tests mit vi.mock (isoliert, 2 Dateien)",
            `Tests, die Weboberfläche oder Doku lesen (isoliert, ${String(web.filter.length - 2)} Dateien)`,
        ]);
        const [geteilt, mocks, leser] = plan.durchgaenge;
        expect(geteilt?.args).toEqual([
            "--",
            "--no-isolate",
            "--exclude",
            "apps/web/test/geometrie-besitzer.test.ts",
            "--exclude",
            "apps/web/test/route-client.test.ts",
            "apps/web/test",
            "packages/shared/test",
        ]);
        expect(mocks?.args).toEqual([
            "--",
            "apps/web/test/geometrie-besitzer.test.ts",
            "apps/web/test/route-client.test.ts",
        ]);
        expect(leser?.direkt).toBe(true);
        expect(leser?.args).toContain("apps/server/test/sprachtafel-gleich.test.ts");
        expect(
            planeDurchgaenge({ auswahl: web, testDateien: MIT_MOCK, isoliert: true }).durchgaenge,
            "--isoliert: der alte Lauf",
        ).toHaveLength(1);
    });

    it("eine Mock-Datei im Server steht in dessen Ausschlüssen und im isolierten Durchgang", () => {
        const mitServerMock: TestDatei[] = [
            ...TESTS,
            { pfad: "apps/server/test/x-mock.test.ts", text: `${MOCKEN}("../src/x.ts")` },
        ];
        const auswahl = waehleTests({ geaendert: ["package.json"], voll: true, testDateien: mitServerMock });
        const plan = planeDurchgaenge({ auswahl, testDateien: mitServerMock, isoliert: false });
        expect(plan.durchgaenge[0]?.args).toEqual([
            "--",
            "--no-isolate",
            "--exclude",
            "apps/server/test/x-mock.test.ts",
            "apps/server/test",
        ]);
        expect(plan.durchgaenge.at(-1)?.args).toEqual(["--", "apps/server/test/x-mock.test.ts"]);
    });
});

describe("Typcheck und shared-Bau bei reiner Markdown-Doku", () => {
    it("🔴 nur .md unter docs/, project-control/, AGENTS.md, CLAUDE.md: ohne Bau", () => {
        expect(
            nurMarkdownDoku(["docs/regeln/entwicklung.md", "project-control/handovers/x.md", "AGENTS.md", "CLAUDE.md"]),
        ).toBe(true);
        expect(nurMarkdownDoku(["docs\\regeln\\befehle.md"])).toBe(true);
    });

    it("🔴 jede andere Datei, auch Doku-artige, hält den Typcheck: JSON, Skripte, Konfiguration, Markdown anderswo, Review-Blätter", () => {
        for (const datei of [
            "project-control/migration/contracts/places.yaml",
            "project-control/discovery/corpus/route-gate-baseline.json",
            "docs/design/bild.png",
            "scripts/dev/x.ts",
            "config/design-canon/avesmaps.json",
            "apps/server/README.md",
            "review/wi-0001/blatt.md",
            "docs.md",
            "package.json",
        ]) {
            expect(nurMarkdownDoku(["docs/x.md", datei]), datei).toBe(false);
        }
    });

    it("eine leere Liste ist nicht „nur Doku“", () => {
        expect(nurMarkdownDoku([])).toBe(false);
    });
});

describe("Kopfprüfung der Handovers in jeder Stufe", () => {
    it("🔴 ein Push, der ein Handover oder den Parser der Köpfe berührt, löst die Kopfprüfung aus", () => {
        expect(beruehrtHandover(["project-control/handovers/2026-10-18-x-an-claudio.md"])).toBe(true);
        expect(beruehrtHandover(["docs/x.md", "project-control/handovers/README.md"])).toBe(true);
        expect(beruehrtHandover(["project-control\\handovers\\2026-10-18-x.md"])).toBe(true);
        expect(beruehrtHandover(["scripts/coordination/handover-protocol.ts"])).toBe(true);
    });

    it("🔴 andere Pfade lösen sie nicht aus, auch ähnliche nicht; nicht bestimmbar heißt ja, leer heißt nein", () => {
        for (const datei of [
            "project-control/state/current.md",
            "project-control/handovers.md",
            "docs/project-control/handovers/x.md",
            "scripts/coordination/listener.ts",
            "apps/server/test/regelwerk-handover-koepfe.test.ts",
        ]) {
            expect(beruehrtHandover(["docs/x.md", datei]), datei).toBe(false);
        }
        expect(beruehrtHandover(undefined)).toBe(true);
        expect(beruehrtHandover([])).toBe(false);
    });

    it("der Wächter, den der Lauf allein fährt, ist ein Regelwerk-Wächter und steht damit in der Stufe doku", () => {
        const doku = waehleTests({
            geaendert: ["project-control/handovers/2026-10-18-x.md"],
            voll: false,
            testDateien: [{ pfad: HANDOVER_KOPF_TEST, text: "// Köpfe" }],
        });
        expect(doku.filter).toEqual([HANDOVER_KOPF_TEST]);
    });
});

describe("Wächter der Release-Teile in jeder Stufe", () => {
    it("🔴 eine neue oder geänderte Spec und die Zuordnung selbst lösen ihn aus (Release-Test 98e0eab: zwei Specs ohne Teil)", () => {
        expect(beruehrtReleaseTeile(["apps/web/e2e/gebirge-vorschau-hoehe.spec.ts"])).toBe(true);
        expect(beruehrtReleaseTeile(["apps\\web\\e2e\\wegeditor-mehrfach.spec.ts"])).toBe(true);
        expect(beruehrtReleaseTeile(["apps/web/e2e/release-teile.json"])).toBe(true);
        expect(beruehrtReleaseTeile(["apps/web/playwright.config.ts"])).toBe(true);
        expect(beruehrtReleaseTeile(["apps/web/e2e/spec-auswahl.ts"])).toBe(true);
    });

    it("🔴 Helfer der Specs, App-Code und Doku lösen ihn nicht aus; nicht bestimmbar heißt ja, leer heißt nein", () => {
        for (const datei of ["apps/web/e2e/stage-groups.ts", "apps/web/src/app.vue", "docs/regeln/befehle.md"]) {
            expect(beruehrtReleaseTeile([datei]), datei).toBe(false);
        }
        expect(beruehrtReleaseTeile(undefined)).toBe(true);
        expect(beruehrtReleaseTeile([])).toBe(false);
        expect(RELEASE_TEILE_TEST).toBe("apps/server/test/release-teile.test.ts");
    });
});

describe("Datenbanktests, die der Prüflauf nicht fuhr", () => {
    const keine = { testdatenbank: 0, entwicklungsdatenbank: 0 };

    it("🔴 die Zahlen kommen aus genau den Zeilen, die `vitest.global-setup.ts` druckt (Wortlaut-Kopplung)", () => {
        const ausgabe = `Test Files  1 passed\n${skipZeilen({ testdatenbank: 187, entwicklungsdatenbank: 5 }).join("\n")}\n`;
        expect(liesUebersprungene(ausgabe)).toEqual({ testdatenbank: 187, entwicklungsdatenbank: 5 });
        expect(liesUebersprungene(skipZeilen({ testdatenbank: 3, entwicklungsdatenbank: 0 }).join("\n"))).toEqual({
            testdatenbank: 3,
            entwicklungsdatenbank: 0,
        });
    });

    it("keine Meldung heißt nichts übersprungen; zwei Meldungen in einer Ausgabe zählen zusammen", () => {
        expect(liesUebersprungene("Tests  12 passed (12)\n")).toEqual(keine);
        expect(
            liesUebersprungene(skipZeilen({ testdatenbank: 2, entwicklungsdatenbank: 0 }).join("\n").repeat(2)),
        ).toEqual({
            testdatenbank: 4,
            entwicklungsdatenbank: 0,
        });
    });

    it("🔴 der Satz nennt die Zahl und beide Arten; ohne Übersprungenes gibt es keinen Satz", () => {
        expect(datenbankSatz({ testdatenbank: 3, entwicklungsdatenbank: 5 }, 176)).toBe(
            "Datenbanktests nicht gelaufen (fehlende Datenbank: 3; ausgelassen nach Pfadregel: 176; brauchen die Entwicklungsdatenbank: 5)",
        );
        expect(datenbankSatz(keine, 12)).toBe("Datenbanktests nicht gelaufen (ausgelassen nach Pfadregel: 12)");
        expect(datenbankSatz({ testdatenbank: 10, entwicklungsdatenbank: 0 })).toBe(
            "Datenbanktests nicht gelaufen (fehlende Datenbank: 10)",
        );
        expect(datenbankSatz(keine)).toBeUndefined();
    });

    it("🔴 rot wird nur der volle Lauf, ohne Quittung und mit übersprungenen Dateien der Testdatenbank", () => {
        const fehlt = { testdatenbank: 187, entwicklungsdatenbank: 5 };
        expect(datenbankRot({ voll: true, quittiert: false, uebersprungen: fehlt })).toBe(true);
        expect(datenbankRot({ voll: true, quittiert: false, uebersprungen: { ...keine, testdatenbank: 1 } })).toBe(
            true,
        );
        expect(datenbankRot({ voll: true, quittiert: true, uebersprungen: fehlt }), "bewusst quittiert").toBe(false);
        expect(datenbankRot({ voll: false, quittiert: false, uebersprungen: fehlt }), "kleine Stufe bleibt grün").toBe(
            false,
        );
        expect(datenbankRot({ voll: true, quittiert: false, uebersprungen: keine }), "Datenbank da").toBe(false);
        expect(
            datenbankRot({ voll: true, quittiert: false, uebersprungen: { ...keine, entwicklungsdatenbank: 5 } }),
            "die Entwicklungsdatenbank (echte Kartendaten) bleibt nur gemeldet",
        ).toBe(false);
    });
});

describe("Durchgang der Datenbanktests im Wegwerf-Postgres", () => {
    /** Zusammengesetzt, damit diese Testdatei nicht selbst als Datenbanktest zählt (die Pfadregel erkennt sie am Quelltext). */
    const ENTWICKLUNGSDB_VAR = ["DATABASE", "URL"].join("_");
    const MIT_DB: TestDatei[] = [
        ...TESTS,
        { pfad: "apps/server/test/z-konto.test.ts", text: 'const url = process.env["' + TESTDB_VAR + '"];' },
        { pfad: "apps/server/test/a-orte.test.ts", text: 'const url = process.env["' + TESTDB_VAR + '"];' },
        { pfad: "apps/server/test/korpus.test.ts", text: 'const url = process.env["' + ENTWICKLUNGSDB_VAR + '"];' },
    ];
    const voll = waehleTests({ geaendert: ["apps/server/src/app.ts"], voll: true, testDateien: MIT_DB });
    const DB_DATEIEN = ["apps/server/test/a-orte.test.ts", "apps/server/test/z-konto.test.ts"];

    it("🔴 voll mit Datenbank: ein letzter Durchgang mit genau den Dateien, die die Testdatenbank lesen, sortiert und isoliert", () => {
        const plan = planeDurchgaenge({
            auswahl: voll,
            testDateien: MIT_DB,
            isoliert: false,
            datenbankDateien: DB_DATEIEN,
        });
        const letzter = plan.durchgaenge.at(-1);
        expect(letzter).toMatchObject({
            name: "Datenbanktests im Wegwerf-Postgres (isoliert, 2 Dateien)",
            datenbank: true,
            args: ["apps/server/test/a-orte.test.ts", "apps/server/test/z-konto.test.ts"],
        });
        expect(plan.durchgaenge.slice(0, -1).every((d) => d.datenbank !== true)).toBe(true);
        expect(plan.zeile).toMatch(/Datenbanktests: 2 Dateien im Wegwerf-Postgres/);
        expect(JSON.stringify(letzter), "ohne Teilen des Prozesses").not.toContain("--no-isolate");
    });

    it("🔴 `--isoliert` behält den Durchgang; ohne Dateien gibt es keinen, die kleinen Stufen bekommen ihn mit gewählten Dateien", () => {
        const alt = planeDurchgaenge({
            auswahl: voll,
            testDateien: MIT_DB,
            isoliert: true,
            datenbankDateien: DB_DATEIEN,
        });
        expect(alt.durchgaenge).toHaveLength(2);
        expect(alt.durchgaenge[0]?.args).toEqual([]);
        expect(alt.durchgaenge[1]?.datenbank).toBe(true);
        const ohne = planeDurchgaenge({ auswahl: voll, testDateien: MIT_DB, isoliert: false });
        expect(ohne.durchgaenge.some((d) => d.datenbank === true)).toBe(false);
        const doku = waehleTests({ geaendert: ["docs/x.md"], voll: false, testDateien: MIT_DB });
        const klein = planeDurchgaenge({
            auswahl: doku,
            testDateien: MIT_DB,
            isoliert: false,
            datenbankDateien: DB_DATEIEN,
        });
        // Seit der Pfadregel für die kleinen Stufen (Hauptorchestrierung 2026-10-18) bekommt auch die Stufe doku einen Datenbank-Durchgang, wenn sie Dateien wählt.
        expect(klein.durchgaenge.map((d) => d.datenbank === true)).toEqual([false, true]);
        expect(klein.durchgaenge[1]?.args).toEqual(DB_DATEIEN);
        const kleinOhne = planeDurchgaenge({
            auswahl: doku,
            testDateien: MIT_DB,
            isoliert: false,
            datenbankDateien: [],
        });
        expect(kleinOhne.durchgaenge.some((d) => d.datenbank === true)).toBe(false);
    });

    it("🔴 nur die gewählten Dateien laufen, nicht alle mit Datenbank; keine Auswahl: kein leerer Durchgang", () => {
        const gewaehlt = planeDurchgaenge({
            auswahl: voll,
            testDateien: MIT_DB,
            isoliert: false,
            datenbankDateien: ["apps/server/test/z-konto.test.ts"],
        });
        expect(gewaehlt.durchgaenge.at(-1)).toMatchObject({
            name: "Datenbanktests im Wegwerf-Postgres (isoliert, 1 Dateien)",
            args: ["apps/server/test/z-konto.test.ts"],
        });
        const plan = planeDurchgaenge({ auswahl: voll, testDateien: MIT_DB, isoliert: false, datenbankDateien: [] });
        expect(plan.durchgaenge.some((d) => d.datenbank === true)).toBe(false);
    });
});

describe("Datenbank-Durchgang neben den anderen oder danach", () => {
    const GB = 1024 ** 3;

    it("🔴 parallel nur mit Bedarf plus Boden frei; die Grenze selbst zählt, knapp darunter nicht", () => {
        const noetig = DB_DURCHGANG_RAM_BEDARF_BYTES + DB_DURCHGANG_RAM_BODEN_BYTES;
        expect(datenbankParallel(noetig).parallel).toBe(true);
        expect(datenbankParallel(noetig - 1).parallel).toBe(false);
        expect(datenbankParallel(31 * GB).parallel).toBe(true);
        expect(datenbankParallel(5 * GB).parallel, "so knapp war der Rechner am 2026-10-18").toBe(false);
    });

    it("🔴 ohne Angabe zum Arbeitsspeicher läuft er danach; der Grund nennt Zahlen", () => {
        expect(datenbankParallel(undefined)).toEqual({ parallel: false, grund: "freier Arbeitsspeicher unbekannt" });
        expect(datenbankParallel(5 * GB).grund).toMatch(/^nur 5 GB RAM frei, nötig \d/);
        expect(datenbankParallel(20 * GB).grund).toMatch(/^20 GB RAM frei, nötig \d/);
    });
});

describe("Frist je Testfall und Hook der Durchgänge ohne Datenbank", () => {
    it("🔴 hängt beide Fristen an, mit `--` wo es fehlt, ohne es zu verdoppeln", () => {
        const fristen = ["--testTimeout=30000", "--hookTimeout=120000"];
        expect(mitFrist([])).toEqual(["--", ...fristen]);
        expect(mitFrist(["--", "apps/web/test"])).toEqual(["--", "apps/web/test", ...fristen]);
        expect(mitFrist(["--", "--no-isolate", "--exclude", "x.test.ts", "apps/server/test"])).toEqual([
            "--",
            "--no-isolate",
            "--exclude",
            "x.test.ts",
            "apps/server/test",
            ...fristen,
        ]);
    });
});

describe("Wächter der Gelände-Sicht in jeder Stufe (WI-0271 L1)", () => {
    it("🔴 Geländeleser, Gebirge-Teile und der Wächter selbst lösen ihn aus", () => {
        for (const datei of [
            "apps/server/src/terrain/inputs.ts",
            "apps\\server\\src\\terrain\\domain\\input-index.ts",
            "packages/shared/src/gebirge/rueckennetz/hebung.ts",
            "apps/server/src/editor/landscapes.ts",
            "apps/server/src/abgleiche/bezuege.ts",
            GELAENDE_SICHT_TEST,
        ]) {
            expect(beruehrtGelaendeLeser([datei]), datei).toBe(true);
        }
    });

    it("anderes löst ihn nicht aus; nicht bestimmbar heißt ja, leer heißt nein", () => {
        for (const datei of [
            "apps/server/src/editor/place-edit.ts",
            "apps/web/src/app.vue",
            "docs/regeln/befehle.md",
        ]) {
            expect(beruehrtGelaendeLeser([datei]), datei).toBe(false);
        }
        expect(beruehrtGelaendeLeser(undefined)).toBe(true);
        expect(beruehrtGelaendeLeser([])).toBe(false);
        expect(GELAENDE_SICHT_TEST).toBe("apps/server/test/terrain-peak-gelaende.test.ts");
    });
});
