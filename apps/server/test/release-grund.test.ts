import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    GRUND_MAX,
    VoraussetzungFehlt,
    bereinigeGrund,
    notizGrund,
    offenNotiz,
    rotNotiz,
    vitestMeldung,
    type VitestBericht,
} from "../../../scripts/dev/release-grund.ts";

/**
 * Die Notizen `offen` und `rot` des Release-Runners (WI-0248 R1, `scripts/dev/release-grund.ts`). Problemfälle: Die Notiz steht im öffentlichen
 * Git, die zweite Zeile trägt deshalb nie einen lokalen Pfad, eine Adresse mit Zugangsdaten oder ein Geheimnis; und eine fehlende Voraussetzung
 * (Testpaket, Manifest) darf die Prüfung nicht als „beauftragt“ ohne Ende stehen lassen, sondern ergibt eine rote Notiz mit Grund.
 */
const sha = "a".repeat(40);

describe("bereinigeGrund", () => {
    it("🔴 nimmt Pfade, Adressen und Geheimnisse heraus", () => {
        const roh =
            "ENOENT: C:\\Users\\mail\\Daten\\x.txt, \\\\server\\freigabe\\y, /home/mail/geheim/key.pem, postgres://app:pw@127.0.0.1:5/db, PASSWORD=hunter2";
        const grund = bereinigeGrund(roh);
        for (const nicht of ["Users", "mail", "freigabe", "/home", "app:pw", "hunter2"])
            expect(grund, nicht).not.toContain(nicht);
        expect(grund).toContain("<pfad>");
        expect(grund).toContain("<url>");
        expect(grund).toContain("<verborgen>");
    });

    it("lässt repository-relative Pfade und Migrationsnamen stehen", () => {
        expect(bereinigeGrund("keine Migrationen unter apps/server/migrations/ (0009_neu)")).toBe(
            "keine Migrationen unter apps/server/migrations/ (0009_neu)",
        );
    });

    it("nur die erste nicht leere Zeile, in einer Zeile, höchstens GRUND_MAX Zeichen", () => {
        expect(bereinigeGrund("\n\n  erste   Zeile\nzweite Zeile")).toBe("erste Zeile");
        const lang = bereinigeGrund("x".repeat(500));
        expect(lang.length).toBe(GRUND_MAX);
        expect(lang.endsWith("…")).toBe(true);
        expect(bereinigeGrund("   ")).toBe("unbekannter Fehler");
    });
});

describe("notizGrund", () => {
    it("🔴 eine fehlende Voraussetzung nennt „Voraussetzung fehlt“ und den Satz", () => {
        expect(notizGrund(new VoraussetzungFehlt("Testpaket ohne manifest.json: altes Testpaketformat"))).toBe(
            "Voraussetzung fehlt: Testpaket ohne manifest.json: altes Testpaketformat",
        );
    });

    it("🔴 ein gescheiterter Schritt nennt nur Namen und Exitcode, nie das Protokoll des Schritts (Daten, Pfade)", () => {
        expect(notizGrund(new Error("installation: Exit 1"))).toBe("Lauf fehlgeschlagen: installation: Exit 1");
        expect(
            notizGrund(
                new Error(
                    "korpus-laden: pg_restore Exit 1: pg_restore: Fehler: COPY ort, line 5: Gareth;person@example.org | Die Anweisung war: COPY",
                ),
            ),
        ).toBe("Lauf fehlgeschlagen: korpus-laden: Exit 1");
    });

    it("Zeitüberschreitung, unbekannter Fehler und Nicht-Fehler", () => {
        expect(notizGrund(new Error("timeout"))).toBe("Lauf fehlgeschlagen: Zeitüberschreitung eines Schritts");
        expect(notizGrund(new Error("Vitest: 0 rot, 0 übersprungen, 40 todo (Fälle ohne Inhalt)"))).toBe(
            "Lauf fehlgeschlagen: Vitest: 0 rot, 0 übersprungen, 40 todo (Fälle ohne Inhalt)",
        );
        expect(notizGrund("irgendwas")).toBe("Lauf fehlgeschlagen: Runner fehlgeschlagen");
    });
});

describe("vitestMeldung", () => {
    const erwartet = ["/k/apps/server/test/a.test.ts", "/k/apps/web/test/b.test.ts"];
    const dateien = [
        { name: "/k/apps/server/test/a.test.ts", status: "passed" },
        { name: "/k/apps/web/test/b.test.ts", status: "passed" },
    ];
    /** Ein grüner Bericht aus fünf Fällen; `extra` überschreibt Felder. */
    const bericht = (extra: Partial<VitestBericht> = {}): VitestBericht => ({
        success: true,
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numFailedTestSuites: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        testResults: dateien,
        ...extra,
    });

    it("ein grüner Bericht mit allen erwarteten Dateien ergibt keine Meldung", () => {
        expect(vitestMeldung(bericht(), erwartet)).toBeNull();
        // Windows-Pfade im Bericht stimmen mit den Pfaden mit Schrägstrich überein.
        expect(
            vitestMeldung(
                bericht({ testResults: dateien.map((d) => ({ ...d, name: d.name.replace(/\//gu, "\\") })) }),
                erwartet,
            ),
        ).toBeNull();
    });

    it("🔴 nur `todo` (der erste vollständige Lauf, SHA d66917064): die Meldung nennt 40 Fälle ohne Inhalt", () => {
        expect(vitestMeldung(bericht({ numTotalTests: 45, numPassedTests: 5, numTodoTests: 40 }), erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 40 todo (Fälle ohne Inhalt)",
        );
    });

    it("rote und übersprungene Fälle stehen mit ihrer Zahl da", () => {
        expect(
            vitestMeldung(
                bericht({
                    success: false,
                    numTotalTests: 9,
                    numPassedTests: 5,
                    numFailedTests: 3,
                    numPendingTests: 1,
                }),
                erwartet,
            ),
        ).toBe("Vitest: 3 rot, 1 übersprungen, 0 todo");
    });

    it("eine Datei, die gar nicht lief, zählt als ein roter Fall; eine Datei, die im Bericht fehlt, wird genannt", () => {
        expect(
            vitestMeldung(
                bericht({
                    success: false,
                    numFailedTestSuites: 1,
                    testResults: [dateien[0]!, { name: "/k/apps/web/test/b.test.ts", status: "failed" }],
                }),
                erwartet,
            ),
        ).toBe("Vitest: 1 rot, 0 übersprungen, 0 todo");
        expect(vitestMeldung(bericht({ testResults: [dateien[0]!] }), erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 0 todo, 1 erwartete Testdatei fehlt im Bericht",
        );
        expect(vitestMeldung(bericht({ testResults: [] }), erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 0 todo, 2 erwartete Testdateien fehlen im Bericht",
        );
    });

    it("ein Bericht ohne Fälle oder ohne Erfolg sagt es, statt nur Nullen zu zeigen", () => {
        expect(vitestMeldung({}, erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 0 todo, 2 erwartete Testdateien fehlen im Bericht, keine Fälle im Bericht",
        );
        expect(vitestMeldung(bericht({ numPassedTests: 3 }), erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 0 todo, 2 ohne Ergebnis",
        );
        expect(vitestMeldung(bericht({ success: false }), erwartet)).toBe(
            "Vitest: 0 rot, 0 übersprungen, 0 todo, Bericht ist nicht grün",
        );
    });

    it("🔴 die Meldung nennt nur Zahlen, nie einen Pfad (sie steht in der öffentlichen Notiz)", () => {
        const meldung = vitestMeldung(bericht({ testResults: [] }), erwartet)!;
        expect(meldung).not.toContain("/k/");
        expect(notizGrund(new Error(meldung))).toBe(`Lauf fehlgeschlagen: ${meldung}`);
    });
});

describe("Notiztexte", () => {
    it("offen: zwei Zeilen, die erste von den Lesern lesbar", () => {
        const zeilen = offenNotiz(sha, "2026-10-23T08:00:00.000Z").trimEnd().split("\n");
        expect(zeilen[0]).toBe(`${sha} 2026-10-23T08:00:00.000Z offen`);
        expect(zeilen).toHaveLength(2);
    });

    it("rot: genau zwei Zeilen, auch wenn die Begründung mehrzeilig ist", () => {
        const zeilen = rotNotiz(sha, "2026-10-23T09:00:00.000Z", "Voraussetzung fehlt: a\nb C:\\x\\y")
            .trimEnd()
            .split("\n");
        expect(zeilen).toEqual([`${sha} 2026-10-23T09:00:00.000Z rot`, "Voraussetzung fehlt: a"]);
    });
});

// Der echte Runner gegen ein Wegwerf-Repository mit eigenem „origin“ (ein nacktes Repository im Temp-Ordner): Nichts davon berührt das
// echte origin. Der Lauf endet vor jeder Installation, weil schon das Testpaket nicht passt.
describe("Runner: fehlende Voraussetzung", { timeout: 120_000 }, () => {
    const runner = fileURLToPath(new URL("../../../scripts/dev/release-runner.ts", import.meta.url));
    const sauber = (): NodeJS.ProcessEnv => {
        const env = { ...process.env };
        for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
        return env;
    };
    const git = (cwd: string, ...args: string[]): string =>
        execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            env: sauber(),
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        }).trim();

    /** Ein Wegwerf-Repository mit einem Commit (eine Migration) und seinem nackten „origin“. */
    const welt = (): { wurzel: string; repo: string; bare: string; kandidat: string } => {
        const wurzel = mkdtempSync(join(tmpdir(), "release-grund-"));
        const bare = join(wurzel, "origin.git");
        const repo = join(wurzel, "repo");
        mkdirSync(bare);
        mkdirSync(join(repo, "apps", "server", "migrations"), { recursive: true });
        git(bare, "init", "--bare", "-b", "master");
        git(repo, "init", "-b", "master");
        for (const [name, wert] of [
            ["user.name", "Test"],
            ["user.email", "test@avesmaps3d.local"],
            ["commit.gpgsign", "false"],
            ["core.autocrlf", "false"],
            ["core.hooksPath", join(wurzel, "keine-hooks")],
        ] as const)
            git(repo, "config", name, wert);
        writeFileSync(join(repo, "apps", "server", "migrations", "0001_a.sql"), "SELECT 1;\n");
        writeFileSync(join(repo, "package-lock.json"), "{}\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "Anfang");
        git(repo, "remote", "add", "origin", bare);
        git(repo, "push", "origin", "master");
        return { wurzel, repo, bare, kandidat: git(repo, "rev-parse", "HEAD") };
    };

    const paket = (wurzel: string, manifest?: unknown): string => {
        const ordner = join(wurzel, "testpaket");
        mkdirSync(join(ordner, "tiles"), { recursive: true });
        mkdirSync(join(ordner, "media"), { recursive: true });
        writeFileSync(join(ordner, "daten.dump"), "x");
        if (manifest !== undefined) writeFileSync(join(ordner, "manifest.json"), JSON.stringify(manifest));
        return ordner;
    };

    const lauf = (repo: string, kandidat: string, fixtures: string) =>
        spawnSync(process.execPath, [runner, "--commit", kandidat, "--fixtures", fixtures], {
            cwd: repo,
            encoding: "utf8",
            env: sauber(),
            timeout: 90_000,
            windowsHide: true,
        });

    /** Die Notiz im „origin“ und alle ihre früheren Stände (neueste zuerst). */
    const notiz = (bare: string, kandidat: string): { aktuell: string[]; verlauf: string } => ({
        aktuell: git(bare, "notes", "--ref=sammellauf", "show", kandidat).split(/\r?\n/),
        verlauf: git(bare, "log", "-p", "refs/notes/sammellauf"),
    });

    it.each([
        [
            "ohne manifest.json",
            undefined,
            /^Voraussetzung fehlt: Testpaket ohne manifest\.json: altes Testpaketformat/u,
        ],
        [
            "mit einer Migration, die der Kandidat nicht kennt",
            {
                schema: 2,
                erstellt: "2026-10-23T08:00:00.000Z",
                quelle: { migrationen: ["0001_a", "0009_neu"] },
            },
            /^Voraussetzung fehlt: Testpaket neuer als der Kandidat: 1 Migration\(en\).*0009_neu/u,
        ],
    ])("🔴 ein Testpaket %s: erst „offen“, dann „rot“ mit Grund und ohne lokalen Pfad", (_name, manifest, erwartet) => {
        const w = welt();
        try {
            const ergebnis = lauf(w.repo, w.kandidat, paket(w.wurzel, manifest));
            expect(ergebnis.status, ergebnis.stderr).toBe(1);
            const { aktuell, verlauf } = notiz(w.bare, w.kandidat);
            expect(aktuell).toHaveLength(2);
            expect(aktuell[0]).toMatch(new RegExp(`^${w.kandidat} \\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z rot$`, "u"));
            expect(aktuell[1]).toMatch(erwartet);
            expect(aktuell.join("\n"), "kein lokaler Pfad").not.toMatch(/[A-Za-z]:[\\/]|\/tmp\/|release-grund-/u);
            expect(verlauf, "vorher angekündigt").toContain("offen");
            const lokal = JSON.parse(
                readFileSync(join(w.repo, ".release-runs", w.kandidat, "status.json"), "utf8"),
            ) as {
                status: string;
            };
            expect(lokal.status).toBe("rot");
            expect(existsSync(join(w.repo, ".release-runs", "aktiv")), "Sperre aufgehoben").toBe(false);
        } finally {
            rmSync(w.wurzel, { recursive: true, force: true });
        }
    });

    it("🔴 ein unvollständiges Testpaket (kein Dump) ist ebenfalls rot mit Grund", () => {
        const w = welt();
        try {
            const leer = join(w.wurzel, "leer");
            mkdirSync(leer);
            expect(lauf(w.repo, w.kandidat, leer).status).toBe(1);
            const { aktuell } = notiz(w.bare, w.kandidat);
            expect(aktuell[0]).toMatch(/ rot$/u);
            expect(aktuell[1]).toMatch(/^Voraussetzung fehlt: Testpaket unvollständig: manifest\.json/u);
        } finally {
            rmSync(w.wurzel, { recursive: true, force: true });
        }
    });

    it("🔴 liegt schon ein Ergebnis vor (Wiederverwendung), wird nichts angekündigt und keine Notiz geschrieben", () => {
        const w = welt();
        try {
            mkdirSync(join(w.repo, ".release-runs", w.kandidat), { recursive: true });
            writeFileSync(join(w.repo, ".release-runs", w.kandidat, "ergebnis.json"), "{}");
            expect(lauf(w.repo, w.kandidat, paket(w.wurzel)).status).toBe(1);
            expect(git(w.bare, "for-each-ref", "refs/notes/"), "keine Notiz im origin").toBe("");
        } finally {
            rmSync(w.wurzel, { recursive: true, force: true });
        }
    });
});
