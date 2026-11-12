// Der eine Bericht am Ende eines Release-Tests (WI-0248; Vali 2026-10-26: „Am Ende gibt es eine einzige Seite mit allem, was rot ist …, und darunter,
// was noch offen ist“). Ohne Prozess: ein Ergebnisordner mit Status, Meldung, Berichten und Protokollen im Temp-Ordner.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    BERICHT_DATEI,
    baueBerichtSeite,
    faelleAusFormat,
    faelleAusLint,
    faelleAusTypen,
    leseBerichtSeite,
    offenAusCurrent,
    schreibeBerichtSeite,
} from "../../../scripts/dev/release-seite.ts";
import { FAELLE_MAX } from "../../../scripts/dev/release-bericht.ts";

const SHA = "d".repeat(40);
const CURRENT = [
    "# Stand",
    "",
    "## Aktive und zu überprüfende Arbeitsstränge",
    "",
    "| Bereich | Belegbarer Stand | Nächster sinnvoller Schritt | Detailquelle |",
    "|---|---|---|---|",
    "| **Topographie** | gebaut | Sichtabnahme durch Vali | WI-0249 |",
    "| Release-Weg | gebaut | Erster Lauf mit Freigabe | WI-0248 |",
    "",
].join("\n");

let ordner = "";
afterEach(() => {
    if (ordner !== "") rmSync(ordner, { recursive: true, force: true });
    ordner = "";
});

function lauf(dateien: Record<string, string | object>): string {
    ordner = mkdtempSync(join(tmpdir(), "release-seite-"));
    for (const [name, inhalt] of Object.entries(dateien))
        writeFileSync(join(ordner, name), typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
    return ordner;
}

const status = (zustand: string, teile: { klasse: string; status: string }[], auftrag?: string) => ({
    version: 3,
    sha: SHA,
    start: "2026-10-25T10:00:00.000Z",
    ende: "2026-10-25T11:30:00.000Z",
    status: zustand,
    profil: "B",
    ...(auftrag === undefined ? {} : { auftrag }),
    teile: teile.map((t) => ({ sha: SHA, exit: t.status === "gruen" ? 0 : 1, ...t })),
    belege: {},
});

describe("🔴 Rot: alles aus allen Teilen, ohne Kürzung auf die ersten n", () => {
    it("nennt jeden roten Vitest-Fall, auch über die Grenze der Karte hinaus, die Kernabläufe und die statische Prüfung", () => {
        const viele = Array.from({ length: FAELLE_MAX + 5 }, (_, i) => ({
            status: "failed",
            fullName: `Fall ${String(i + 1)}`,
            failureMessages: [
                `AssertionError: erwartet ${String(i)}\n    at C:/x/.release-runs/abc/checkout/apps/server/test/a.test.ts:5:3\n    at node_modules/vitest/x.js:1:1`,
            ],
        }));
        const o = lauf({
            "status.json": status("rot", [
                { klasse: "voll", status: "rot" },
                { klasse: "kern", status: "rot" },
            ]),
            "fehler.txt":
                "lint: Exit 1\ntypen: Exit 2\nVitest: 25 rot, 0 übersprungen, 0 todo\nBrowserteil kern (Kernabläufe): 1 rot\n",
            "teile.json": {
                version: 1,
                teile: [],
                problem: null,
                komponenten: {},
                wiederholung: null,
                schritte: { lint: { status: "rot" } },
            },
            "vitest.json": {
                testResults: [
                    { name: "C:/x/checkout/apps/server/test/a.test.ts", status: "failed", assertionResults: viele },
                ],
            },
            "kern.json": {
                suites: [
                    {
                        file: "freigabe-knopf.spec.ts",
                        specs: [
                            {
                                ok: false,
                                title: "Knopf",
                                tests: [
                                    { results: [{ status: "failed", error: { message: "Locator nicht gefunden" } }] },
                                ],
                            },
                        ],
                    },
                ],
            },
            "lint.log":
                "C:\\x\\checkout\\apps\\web\\src\\a.ts\n  3:7  error  'x' is defined but never used  @typescript-eslint/no-unused-vars\n  4:1  warning  egal  regel\n",
            "typen.log":
                "> @avesmaps3d/web@0.0.0 typecheck\n> vue-tsc --noEmit\n\nsrc/b.vue(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n  Folgezeile der Meldung\n",
        });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        for (let i = 1; i <= FAELLE_MAX + 5; i++) expect(seite).toContain(`Fall ${String(i)}`);
        expect(seite).toContain("### Vitest (25)");
        expect(seite).toContain("`apps/server/test/a.test.ts`");
        // Nur die erste Stapelzeile bleibt, ohne den Ergebnisordner davor.
        expect(seite).toContain("at apps/server/test/a.test.ts:5:3");
        expect(seite).not.toContain("node_modules/vitest");
        expect(seite).toContain("### Kernabläufe (Browser) (1)");
        expect(seite).toContain("Locator nicht gefunden");
        expect(seite).toContain("### Statische Prüfung: Lint (1)");
        expect(seite).toContain("`apps/web/src/a.ts` — [rot] 3:7 @typescript-eslint/no-unused-vars");
        expect(seite).not.toContain("egal");
        expect(seite).toContain("`apps/web/src/b.vue` — [rot] 12:5 TS2322");
        expect(seite).toContain("Folgezeile der Meldung");
        expect(seite).toContain("Freigabe: keine (von Hand gestartet).");
    });

    it("grün mit Freigabe: nichts rot, und der Satz sagt, dass genau dieser Stand nach Production geht", () => {
        const o = lauf({
            "status.json": status(
                "gruen",
                [
                    { klasse: "voll", status: "gruen" },
                    { klasse: "kern", status: "gruen" },
                ],
                "RT-00000000-0000-4000-8000-000000000001",
            ),
        });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        expect(seite).toContain("# Release-Test dddddddddddd: grün");
        expect(seite).toContain("## Rot (0)");
        expect(seite).toContain("Nichts ist rot.");
        expect(seite).toContain("genau dieser Stand geht jetzt automatisch nach Production");
    });
});

describe("🔴 Das Release-Tor im Bericht (Profil tor, WI-0264)", () => {
    const torStatus = (zustand: string, teile: { klasse: string; status: string }[]) => ({
        ...status(zustand, teile),
        profil: "tor",
    });
    const gruenTeile = [
        { klasse: "bau", status: "gruen" },
        { klasse: "daten", status: "gruen" },
        { klasse: "kern-echt", status: "gruen" },
    ];
    /** Ein Playwright-Bericht mit einem wackeligen Fall (im zweiten Versuch grün) und einem grünen. */
    const wackeligBericht = {
        stats: { expected: 1, unexpected: 0, flaky: 1, skipped: 0 },
        suites: [
            {
                file: "wegeditor-echt.spec.ts",
                suites: [
                    {
                        title: "Wege",
                        specs: [
                            {
                                title: "Weg zeichnen",
                                ok: true,
                                tests: [{ status: "expected", results: [{ status: "passed" }] }],
                            },
                            {
                                title: "Weg entfernen",
                                ok: true,
                                tests: [
                                    {
                                        status: "flaky",
                                        results: [
                                            { status: "failed", error: { message: "Timeout 5000 ms beim Speichern" } },
                                            { status: "passed" },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    it("🔴 ein grüner Lauf mit einem wackeligen Fall: nichts ist rot, aber der Bericht nennt den Fall als „wackelig“", () => {
        const o = lauf({ "status.json": torStatus("gruen", gruenTeile), "kern-echt.json": wackeligBericht });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        expect(seite).toContain("- Prüfprofil: tor");
        expect(seite).toContain("## Rot (0)");
        expect(seite).toContain("Nichts ist rot.");
        expect(seite).toContain("## Wackelig (1)");
        expect(seite).toContain("`wegeditor-echt.spec.ts` — [wackelig] Wege › Weg entfernen");
        expect(seite).toContain("Timeout 5000 ms beim Speichern");
        expect(seite).not.toContain("Weg zeichnen");
        // Die Reihenfolge der Seite: Rot, Wackelig, Offen.
        expect(seite.indexOf("## Rot")).toBeLessThan(seite.indexOf("## Wackelig"));
        expect(seite.indexOf("## Wackelig")).toBeLessThan(seite.indexOf("## Offen"));
    });

    it("ohne wackeligen Fall (und in jedem anderen Profil) gibt es keinen Abschnitt „Wackelig“", () => {
        const o = lauf({
            "status.json": torStatus("gruen", gruenTeile),
            "kern-echt.json": { stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 }, suites: [] },
        });
        expect(baueBerichtSeite({ ordner: o, offen: CURRENT })).not.toContain("Wackelig");
        const andere = lauf({ "status.json": status("gruen", [{ klasse: "voll", status: "gruen" }]) });
        expect(baueBerichtSeite({ ordner: andere, offen: CURRENT })).not.toContain("Wackelig");
    });

    it("ein roter Teil daten und ein roter kern-echt: ihre Fälle stehen unter ihren Namen, das Wackelige trotzdem", () => {
        const o = lauf({
            "status.json": torStatus("rot", [
                { klasse: "bau", status: "gruen" },
                { klasse: "daten", status: "rot" },
                { klasse: "kern-echt", status: "rot" },
            ]),
            "fehler.txt":
                "Daten: 1 rot, 0 übersprungen, 0 todo\nBrowserteil kern-echt (Tor: Kernabläufe gegen den echten Server): 1 rot, 1 übersprungen\n",
            "daten.json": {
                testResults: [
                    {
                        name: "C:/x/checkout/apps/server/test/schreibwege-app-rolle.test.ts",
                        status: "failed",
                        assertionResults: [
                            {
                                status: "failed",
                                fullName: "POST /api/editor/orte",
                                failureMessages: ["permission denied for table places (42501)"],
                            },
                        ],
                    },
                ],
            },
            "kern-echt.json": {
                stats: { expected: 0, unexpected: 1, flaky: 1, skipped: 0 },
                suites: [
                    {
                        file: "wegeditor-echt.spec.ts",
                        specs: [
                            {
                                ok: false,
                                title: "Weg anlegen",
                                tests: [{ results: [{ status: "failed", error: { message: "Fehler der Seite" } }] }],
                            },
                            {
                                ok: true,
                                title: "Weg verschieben",
                                tests: [
                                    {
                                        status: "flaky",
                                        results: [
                                            { status: "failed", error: { message: "erster Versuch" } },
                                            { status: "passed" },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        expect(seite).toContain("### Daten (Migrationen und Rechte) (1)");
        expect(seite).toContain("`apps/server/test/schreibwege-app-rolle.test.ts` — [rot] POST /api/editor/orte");
        expect(seite).toContain("permission denied for table places (42501)");
        expect(seite).toContain("### Kernabläufe gegen den echten Server (Browser) (1)");
        expect(seite).toContain("[rot] Weg anlegen");
        expect(seite).toContain("## Wackelig (1)");
        expect(seite).toContain("[wackelig] Weg verschieben");
        expect(seite).not.toContain("Vitest (");
    });

    it("kern-echt rot ohne Bericht (die Welt ließ sich nicht anlegen): die Meldung des Runners steht da, der Abschnitt sagt es", () => {
        const o = lauf({
            "status.json": torStatus("rot", [
                { klasse: "bau", status: "gruen" },
                { klasse: "daten", status: "gruen" },
                { klasse: "kern-echt", status: "rot" },
            ]),
            "fehler.txt": "Browserteil kern-echt (Tor): Welt nicht angelegt (Exit 1, tor-welt.txt im Ergebnisordner)\n",
        });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        expect(seite).toContain("Welt nicht angelegt (Exit 1");
        expect(seite).toContain("### Kernabläufe gegen den echten Server (Browser) (0)");
        expect(seite).toContain("Kein Bericht im Ergebnisordner.");
    });
});

describe("Offen: aus current.md, nicht aus einer neuen Liste", () => {
    it("nimmt die Spalte „Nächster sinnvoller Schritt“ der Tafel, je Bereich mit Quelle", () => {
        expect(offenAusCurrent(CURRENT)).toEqual([
            { bereich: "Topographie", schritt: "Sichtabnahme durch Vali", quelle: "WI-0249" },
            { bereich: "Release-Weg", schritt: "Erster Lauf mit Freigabe", quelle: "WI-0248" },
        ]);
        expect(offenAusCurrent("# ohne Tafel\n")).toBeNull();
        const o = lauf({ "status.json": status("rot", [{ klasse: "voll", status: "rot" }]) });
        const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
        expect(seite).toContain("## Offen (aus `project-control/state/current.md` im Stand dddddddddddd)");
        expect(seite).toContain("- **Topographie**: Sichtabnahme durch Vali (WI-0249)");
        expect(baueBerichtSeite({ ordner: o, offen: null })).toContain("ließ sich im geprüften Stand nicht lesen");
    });
});

describe("Die Datei", () => {
    it("schreibt bericht.md und liest sie wieder; ohne Datei baut sie der Leser aus dem Ordner", () => {
        const o = lauf({
            "status.json": status("abgebrochen", []),
            "fehler.txt": "Lauf abgebrochen (ABBRUCH im Ergebnisordner)",
        });
        expect(leseBerichtSeite(o, () => CURRENT)).toContain("Lauf abgebrochen");
        expect(schreibeBerichtSeite(o, CURRENT)).toBe(true);
        expect(readFileSync(join(o, BERICHT_DATEI), "utf8")).toContain("# Release-Test dddddddddddd: abgebrochen");
        expect(leseBerichtSeite(join(o, "fehlt"), () => null)).toBeUndefined();
    });

    it("die Leser der statischen Prüfung nehmen nur Fehler: Prettier-Dateien, ESLint-Fehler, tsc in beiden Formen", () => {
        expect(
            faelleAusFormat(
                "[warn] apps/x.ts\n[warn] Code style issues found in 1 file. Run Prettier with --write to fix.\n",
            ),
        ).toEqual([
            {
                datei: "apps/x.ts",
                name: "[rot] Format",
                meldung: ["Nicht im Prettier-Format"],
                teil: "format",
                teilName: "Format",
            },
        ]);
        expect(faelleAusLint("✖ 3 problems (0 errors, 3 warnings)\n")).toEqual([]);
        expect(
            faelleAusTypen("> @avesmaps3d/server@0.0.0 typecheck\nsrc/a.ts:3:4 - error TS1005: ';' expected.\n")[0],
        ).toMatchObject({
            datei: "apps/server/src/a.ts",
            name: "[rot] 3:4 TS1005",
        });
    });
});

describe("🔴 Der Volltest (WI-0264): eine Seite für beide Teile, nichts geht nach Production", () => {
    it("Teil 2 nennt sich „nur Bericht“ und enthält den Bericht von Teil 1 vor „Offen“, ohne dessen eigenes „Offen“", () => {
        const teil1 = mkdtempSync(join(tmpdir(), "release-seite-teil1-"));
        try {
            writeFileSync(
                join(teil1, BERICHT_DATEI),
                [
                    "# Release-Test dddddddddddd: rot",
                    "",
                    "- Prüfprofil: tor",
                    "",
                    "## Rot (1)",
                    "",
                    "### Kernabläufe (1)",
                    "",
                    "- `e2e/tor-orte.spec.ts` — Ort anlegen",
                    "",
                    "## Offen (aus `project-control/state/current.md` im Stand dddddddddddd)",
                    "",
                    "- **Topographie**: Sichtabnahme durch Vali (WI-0249)",
                    "",
                ].join("\n"),
            );
            const o = lauf({
                "status.json": {
                    ...status("gruen", [{ klasse: "voll", status: "gruen" }]),
                    profil: "voll",
                    nurBericht: true,
                    vorlauf: { ordner: basename(teil1), status: "rot", profil: "tor" },
                },
            });
            const seite = baueBerichtSeite({ ordner: o, offen: CURRENT });
            expect(seite).toContain("Volltest, Teil 2 (voller Lauf): nur Bericht; liefert nichts aus.");
            expect(seite).not.toContain("nach Production.");
            expect(seite).toContain("## Teil 1 des Volltests: Schnelltest");
            expect(seite).toContain("## Release-Test dddddddddddd: rot");
            expect(seite).toContain("#### Kernabläufe (1)");
            expect(seite).toContain("Ort anlegen");
            // „Offen“ steht genau einmal, unten, aus dem Stand dieser Seite.
            expect(seite.match(/## Offen/gu)).toHaveLength(1);
            expect(seite.indexOf("## Teil 1 des Volltests")).toBeLessThan(seite.indexOf("## Offen"));
        } finally {
            rmSync(teil1, { recursive: true, force: true });
        }
    });

    it("Teil 1 (ohne Vorlauf) sagt nur, dass er nichts ausliefert; fehlt der Bericht von Teil 1, sagt die Seite das", () => {
        const o = lauf({ "status.json": { ...status("gruen", []), profil: "tor", nurBericht: true } });
        expect(baueBerichtSeite({ ordner: o, offen: CURRENT })).toContain(
            "Volltest: nur Bericht; dieser Lauf liefert nichts aus und schreibt keine Notiz nach origin.",
        );
        rmSync(o, { recursive: true, force: true });
        const ohne = lauf({
            "status.json": {
                ...status("rot", []),
                profil: "voll",
                nurBericht: true,
                vorlauf: { ordner: "gibt-es-nicht", status: "gruen" },
            },
        });
        expect(baueBerichtSeite({ ordner: ohne, offen: CURRENT })).toContain(
            "Der Bericht von Teil 1 (gibt-es-nicht) ließ sich nicht lesen.",
        );
    });
});
