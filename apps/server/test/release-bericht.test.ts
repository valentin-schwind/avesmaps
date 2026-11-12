// Die Sicht auf einen Release-Test für die lokale Oberfläche (WI-0248 L, `scripts/dev/release-bericht.ts`): Zugangsdaten bereinigen, Schrittzeiten aus
// den Protokollen, erwartete Dauer aus früheren Läufen, Fortschritt und der Bericht zu einem Fehlschlag.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RELEASE_TEST_SCHRITTE } from "@avesmaps3d/shared";
import {
    FAELLE_MAX,
    PROTOKOLL_ZEILEN,
    RELEASE_SCHRITTE,
    SCHRITT_SCHAETZUNG_MS,
    baueFehlerBericht,
    berechneFortschritt,
    bereinigeZugang,
    erwarteteDauern,
    faelleVonPlaywright,
    faelleVonVitest,
    fehlerSchrittAus,
    leseDateiEnde,
    leseSchrittzeiten,
    zeileFuerAnzeige,
    type Erwartung,
    type SchrittId,
} from "../../../scripts/dev/release-bericht.ts";
import { TEIL_IDS } from "../../../scripts/dev/release-teile.ts";

const SHA = "a".repeat(40);

describe("Die Schritte des Runners", () => {
    it("🔴 Starter und Vertrag nennen dieselben Schritte in derselben Reihenfolge", () => {
        expect([...RELEASE_SCHRITTE]).toEqual([...RELEASE_TEST_SCHRITTE]);
    });

    it("jeder Schritt hinter der Vorbereitung ist ein Protokoll des Runners (`<schritt>.log`)", () => {
        // Die Namen, unter denen `release-runner.ts` und `release-testpaket.ts` ihre Protokolle anlegen.
        const runner = readFileSync(new URL("../../../scripts/dev/release-runner.ts", import.meta.url), "utf8");
        const testpaket = readFileSync(new URL("../../../scripts/dev/release-testpaket.ts", import.meta.url), "utf8");
        for (const id of RELEASE_SCHRITTE) {
            if (id === "vorbereitung") continue;
            const browser = /^browser-\d$/u.test(id);
            // Die Browserteile heißen seit WI-0248 nach ihrer Kennung aus `release-teile.ts` (`lauf(teil.id, …)`), nicht mehr `browser-${n}` in einer Schleife.
            const gefunden = browser
                ? /lauf\(\s*teil\.id,/u.test(runner) && (TEIL_IDS as readonly string[]).includes(id)
                : runner.includes(`"${id}"`) || testpaket.includes(`"${id}.log"`);
            expect(gefunden, id).toBe(true);
        }
    });
});

describe("Zugangsdaten bereinigen", () => {
    it("🔴 verbirgt Benutzer und Kennwort einer Verbindungsadresse, behält Host und Datenbank", () => {
        expect(bereinigeZugang("connect postgres://app:geheim123@127.0.0.1:5432/avesmaps failed")).toBe(
            "connect postgres://<verborgen>@127.0.0.1:5432/avesmaps failed",
        );
        expect(bereinigeZugang("git clone https://user:pw@example.org/repo.git")).toBe(
            "git clone https://<verborgen>@example.org/repo.git",
        );
        // Eine Adresse ohne Zugang bleibt unberührt.
        expect(bereinigeZugang("http://127.0.0.1:3000/health")).toBe("http://127.0.0.1:3000/health");
    });

    it("🔴 verbirgt benannte Geheimnisse in Umgebung, Kopfzeilen und JSON", () => {
        for (const roh of [
            "PGPASSWORD=sehrgeheim",
            "DISCORD_CLIENT_SECRET: abc123",
            "GITHUB_TOKEN=ghx",
            "authorization: Bearer abcdef0123456789",
            '"api_key": "ein-wert"',
            "Cookie=sid=1234",
        ]) {
            const sauber = bereinigeZugang(roh);
            expect(sauber, roh).toContain("<verborgen>");
            expect(sauber, roh).not.toMatch(/sehrgeheim|abc123|abcdef0123456789|ein-wert|1234/u);
        }
    });

    it("🔴 verbirgt Token-ähnliche Zeichenfolgen, lässt SHAs und Prüfsummen stehen", () => {
        const token = "Zk3Hq9TnW2xYc8LpVb5RmD7sEj4FaGu6";
        expect(bereinigeZugang(`Antwort mit ${token} im Text`)).toBe("Antwort mit <verborgen> im Text");
        expect(bereinigeZugang("ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4")).toBe("<verborgen>");
        expect(bereinigeZugang("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl")).toBe("<verborgen>");
        expect(bereinigeZugang(`Commit ${SHA}`)).toBe(`Commit ${SHA}`);
        const sha256 = "0123456789abcdef".repeat(4);
        expect(bereinigeZugang(`sha256 ${sha256}`)).toBe(`sha256 ${sha256}`);
    });

    it("die Anzeigezeile hat keine Farbcodes, keine Zugangsdaten und höchstens die Länge", () => {
        expect(zeileFuerAnzeige("\u001b[31mFehler\u001b[0m bei postgres://a:b@h/d\r")).toBe(
            "Fehler bei postgres://<verborgen>@h/d",
        );
        const lang = zeileFuerAnzeige("x".repeat(1000), 50);
        expect(lang).toHaveLength(50);
        expect(lang.endsWith("…")).toBe(true);
    });
});

describe("Zeiten der Schritte, erwartete Dauer und Fortschritt", () => {
    let wurzel = "";
    // In der Vergangenheit: `anlegezeit` nimmt die frühere von Anlege- und Änderungszeit, und die Änderungszeit setzen die Tests.
    const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
    beforeAll(() => {
        wurzel = mkdtempSync(join(tmpdir(), "release-bericht-"));
    });
    afterAll(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    /** Legt Protokolle an, deren Anlegezeit in der Vergangenheit liegt (über die Änderungszeit; `anlegezeit` nimmt die frühere). */
    const protokolle = (ordner: string, beginne: Partial<Record<SchrittId, number>>): void => {
        mkdirSync(ordner, { recursive: true });
        for (const [id, sekunden] of Object.entries(beginne)) {
            const pfad = join(ordner, `${id}.log`);
            writeFileSync(pfad, "x");
            const zeit = new Date(T0 + (sekunden ?? 0) * 1000);
            utimesSync(pfad, zeit, zeit);
        }
    };
    const lauf = (
        name: string,
        status: Record<string, unknown>,
        beginne: Partial<Record<SchrittId, number>>,
    ): string => {
        const ordner = join(wurzel, ".release-runs", name);
        protokolle(ordner, beginne);
        writeFileSync(join(ordner, "status.json"), JSON.stringify(status));
        return ordner;
    };

    it("Beginn eines Schritts ist sein Protokoll, Ende der Beginn des nächsten; die Vorbereitung reicht bis zum ersten Protokoll", () => {
        const ordner = join(wurzel, "zeiten");
        protokolle(ordner, { installation: 100, shared: 220, lint: 240 });
        const zeiten = leseSchrittzeiten(ordner, T0, null, false);
        expect(zeiten.map((z) => z.id)).toEqual(["vorbereitung", "installation", "shared", "lint"]);
        expect(zeiten.map((z) => [z.start - T0, z.ende === null ? null : z.ende - T0, z.belegt])).toEqual([
            [0, 100_000, true],
            [100_000, 220_000, true],
            [220_000, 240_000, true],
            [240_000, null, false],
        ]);
    });

    it("das Ende eines Laufs beendet den letzten Schritt; belegt ist es nur bei Grün", () => {
        const ordner = join(wurzel, "zeiten-ende");
        protokolle(ordner, { installation: 10, shared: 20 });
        expect(leseSchrittzeiten(ordner, T0, T0 + 50_000, true).at(-1)).toMatchObject({
            ende: T0 + 50_000,
            belegt: true,
        });
        expect(leseSchrittzeiten(ordner, T0, T0 + 50_000, false).at(-1)).toMatchObject({
            ende: T0 + 50_000,
            belegt: false,
        });
        // Ohne Protokoll endet die Vorbereitung mit dem Lauf.
        expect(leseSchrittzeiten(join(wurzel, "leer"), T0, T0 + 5000, false)).toEqual([
            { id: "vorbereitung", start: T0, ende: T0 + 5000, belegt: false },
        ]);
    });

    it("ohne frühere Läufe gelten die festen Schätzungen, alle als Schätzung gekennzeichnet", () => {
        const erwartung = erwarteteDauern(join(wurzel, "gibt-es-nicht"));
        expect(erwartung.ms).toEqual(SCHRITT_SCHAETZUNG_MS);
        expect(Object.values(erwartung.schaetzung).every(Boolean)).toBe(true);
    });

    it("🔴 gemessene Dauern ersetzen die Schätzung, der jüngste Lauf gewinnt, ein roter Schritt zählt nicht", () => {
        lauf(
            SHA,
            { status: "gruen", start: new Date(T0).toISOString(), ende: new Date(T0 + 900_000).toISOString() },
            { installation: 60, shared: 200, lint: 220, format: 400, typen: 450 },
        );
        // Ein jüngerer, roter Lauf: installation (belegt durch shared) zählt neu, lint war der rote Schritt und zählt nicht.
        const jung = "b".repeat(40);
        lauf(
            jung,
            {
                status: "rot",
                start: new Date(T0 + 86_400_000).toISOString(),
                ende: new Date(T0 + 86_400_000 + 500_000).toISOString(),
            },
            Object.fromEntries(
                Object.entries({ installation: 30, shared: 130, lint: 150 }).map(([id, s]) => [id, s + 86_400]),
            ) as Partial<Record<SchrittId, number>>,
        );
        const erwartung = erwarteteDauern(join(wurzel, ".release-runs"));
        expect(erwartung.ms.installation).toBe(100_000); // jüngerer Lauf: 130 − 30
        expect(erwartung.schaetzung.installation).toBe(false);
        expect(erwartung.ms.shared).toBe(20_000); // jüngerer Lauf: 150 − 130
        expect(erwartung.ms.lint).toBe(180_000); // der rote Schritt des jüngeren Laufs zählt nicht: aus dem älteren (400 − 220)
        expect(erwartung.ms.vorbereitung).toBe(30_000); // jüngerer Lauf: erstes Protokoll 30 s nach dem Start
        expect(erwartung.ms.format).toBe(50_000); // nur im älteren Lauf: 450 − 400
        expect(erwartung.ms.typen).toBe(450_000); // letzter Schritt des grünen Laufs endet mit dem Lauf: 900 − 450
        expect(erwartung.schaetzung.typen).toBe(false);
        expect(erwartung.ms.tests).toBe(SCHRITT_SCHAETZUNG_MS.tests);
        expect(erwartung.schaetzung.tests).toBe(true);
    });

    const erw = (ms: number): Erwartung => ({
        ms: Object.fromEntries(RELEASE_SCHRITTE.map((id) => [id, ms])) as Record<SchrittId, number>,
        schaetzung: Object.fromEntries(RELEASE_SCHRITTE.map((id) => [id, id === "tests"])) as Record<
            SchrittId,
            boolean
        >,
    });

    it("Fortschritt nach erwarteter Dauer: Erledigtes voll, der laufende Schritt anteilig, der Rest als verbleibend", () => {
        const zeiten = [
            { id: "vorbereitung" as const, start: T0, ende: T0 + 1000, belegt: true },
            { id: "installation" as const, start: T0 + 1000, ende: T0 + 3000, belegt: true },
            { id: "shared" as const, start: T0 + 3000, ende: null, belegt: false },
        ];
        const f = berechneFortschritt({ zeiten, erwartung: erw(10_000), zustand: "laeuft", jetzt: T0 + 8000 });
        expect(f.schritte.map((s) => s.zustand).slice(0, 4)).toEqual(["fertig", "fertig", "laeuft", "offen"]);
        expect(f.schritte[2]).toMatchObject({ dauerMs: 5000, erwartetMs: 10_000 });
        // Jeder Schritt des Runners trägt 10 s; die Zahl der Schritte kommt aus dem Starter, nicht aus einer Abschrift.
        const schritte = RELEASE_SCHRITTE.length;
        expect(f.erwartetMs).toBe(schritte * 10_000);
        expect(f.erwartetSchaetzung).toBe(true);
        expect(f.fortschritt).toBeCloseTo((20_000 + 5000) / (schritte * 10_000), 5);
        // verbleibend: 5 s im laufenden Schritt + alle offenen (alle außer Vorbereitung, Installation und dem laufenden)
        expect(f.verbleibendMs).toBe(5000 + (schritte - 3) * 10_000);
    });

    it("ein Schritt über seiner Erwartung hält den Fortschritt unter 100 %, verbleibend wird nie negativ", () => {
        const zeiten = [
            { id: "vorbereitung" as const, start: T0, ende: T0 + 1000, belegt: true },
            { id: "installation" as const, start: T0 + 1000, ende: null, belegt: false },
        ];
        const f = berechneFortschritt({ zeiten, erwartung: erw(1000), zustand: "laeuft", jetzt: T0 + 600_000 });
        expect(f.fortschritt).toBeLessThan(1);
        expect(f.verbleibendMs).toBe((RELEASE_SCHRITTE.length - 2) * 1000);
    });

    it("grün ist 100 %, rot zeigt den Schritt des Fehlschlags als fehlerhaft und rechnet nichts mehr aus", () => {
        const zeiten = [
            { id: "vorbereitung" as const, start: T0, ende: T0 + 1000, belegt: true },
            { id: "installation" as const, start: T0 + 1000, ende: T0 + 5000, belegt: true },
        ];
        const gruen = berechneFortschritt({ zeiten, erwartung: erw(1000), zustand: "gruen", jetzt: T0 + 9000 });
        expect(gruen.fortschritt).toBe(1);
        expect(gruen.verbleibendMs).toBeUndefined();
        const rot = berechneFortschritt({ zeiten, erwartung: erw(1000), zustand: "rot", jetzt: T0 + 9000 });
        expect(rot.schritte.map((s) => s.zustand).slice(0, 3)).toEqual(["fertig", "fehler", "offen"]);
        expect(rot.verbleibendMs).toBeUndefined();
        expect(rot.fortschritt).toBeLessThan(1);
        const gewaehlt = berechneFortschritt({
            zeiten,
            erwartung: erw(1000),
            zustand: "rot",
            jetzt: T0,
            fehlerSchritt: "vorbereitung",
        });
        expect(gewaehlt.schritte.slice(0, 2).map((s) => s.zustand)).toEqual(["fehler", "fertig"]);
    });

    it("ohne Lauf sind alle Schritte offen und die erwartete Gesamtdauer steht da", () => {
        const f = berechneFortschritt({ zeiten: [], erwartung: erw(1000), zustand: "keiner", jetzt: T0 });
        expect(f.schritte.every((s) => s.zustand === "offen")).toBe(true);
        expect(f.fortschritt).toBe(0);
        expect(f.erwartetMs).toBe(RELEASE_SCHRITTE.length * 1000);
        expect(f.schritte).toHaveLength(RELEASE_SCHRITTE.length);
    });
});

describe("Bericht zu einem Fehlschlag", () => {
    let ordner = "";
    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "release-fehler-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    it("der Schritt kommt aus der Meldung des Runners, sonst ist es der zuletzt begonnene", () => {
        const faelle: [string, SchrittId | undefined, SchrittId | null][] = [
            ["tests: Exit 1", undefined, "tests"],
            ["browser-3: Exit 1", "browser-4", "browser-3"],
            ["korpus-laden: pg_restore Exit 1: x", undefined, "korpus-laden"],
            ["Browserteil 2 unvollständig", undefined, "browser-2"],
            ["Vitest: 0 rot, 0 übersprungen, 40 todo (Fälle ohne Inhalt)", "bau", "tests"],
            ["Vitest: 2 rot, 0 übersprungen, 0 todo, 1 erwartete Testdatei fehlt im Bericht", undefined, "tests"],
            // Die älteren Sätze stehen noch in früheren Ergebnisordnern.
            ["Volltests fehlen, sind rot oder übersprungen", "bau", "tests"],
            ["Mindestens eine erwartete Testdatei fehlt im Vollbericht", undefined, "tests"],
            ["Testpaket unvollständig", "installation", "installation"],
            ["irgendwas", undefined, null],
            ["unbekannt: Exit 3", "lint", "lint"],
        ];
        for (const [text, zuletzt, soll] of faelle) expect(fehlerSchrittAus(text, zuletzt), text).toBe(soll);
    });

    it("liest nur das Ende eines Protokolls, ohne leere Zeilen und ohne angeschnittene erste Zeile", () => {
        const datei = join(ordner, "gross.log");
        const zeilen = Array.from({ length: 5000 }, (_, i) => `Zeile ${String(i + 1)} ${"x".repeat(40)}\n\n`);
        writeFileSync(datei, zeilen.join(""));
        const ende = leseDateiEnde(datei, 60, 4096);
        expect(ende).toHaveLength(60);
        expect(ende.at(-1)).toContain("Zeile 5000");
        expect(ende[0]).toMatch(/^Zeile \d+ x+$/u);
        expect(leseDateiEnde(join(ordner, "fehlt.log"))).toEqual([]);
    });

    it("rote Fälle aus Vitest: Datei ohne Checkout-Pfad, Name, erste Zeilen der Meldung; eine Datei, die nicht lief, steht ohne Namen da", () => {
        const { faelle, gesamt } = faelleVonVitest({
            testResults: [
                {
                    name: "C:/avesmaps3d-data/release-werkzeug/.release-runs/x/checkout/apps/server/test/a.test.ts",
                    status: "failed",
                    assertionResults: [
                        {
                            status: "failed",
                            fullName: "A rechnet",
                            failureMessages: ["AssertionError: erwartet 2\n  \u001b[31mgot 3\u001b[0m\n    at x\n"],
                        },
                        { status: "passed", fullName: "A grün", failureMessages: [] },
                    ],
                },
                {
                    name: "/c/x/checkout/apps/web/test/b.test.ts",
                    status: "failed",
                    message: "Cannot find module 'x'",
                    assertionResults: [],
                },
                { name: "/c/x/checkout/apps/web/test/c.test.ts", status: "passed", assertionResults: [] },
            ],
        });
        expect(gesamt).toBe(2);
        expect(faelle).toEqual([
            {
                datei: "apps/server/test/a.test.ts",
                name: "[rot] A rechnet",
                meldung: ["AssertionError: erwartet 2", "  got 3", "    at x"],
            },
            { datei: "apps/web/test/b.test.ts", name: "", meldung: ["Cannot find module 'x'"] },
        ]);
    });

    it("🔴 höchstens zwanzig Fälle werden ausgegeben, die Gesamtzahl bleibt wahr", () => {
        const assertionResults = Array.from({ length: 45 }, (_, i) => ({
            status: "failed",
            fullName: `Fall ${String(i)}`,
            failureMessages: ["kaputt"],
        }));
        const { faelle, gesamt } = faelleVonVitest({
            testResults: [{ name: "/x/checkout/t.test.ts", status: "failed", assertionResults }],
        });
        expect(faelle).toHaveLength(FAELLE_MAX);
        expect(gesamt).toBe(45);
    });

    it("🔴 übersprungene Fälle und `todo` stehen im Bericht, jeder mit seiner Art; ohne Rotes ist ein Lauf aus 40 `todo` nicht leer", () => {
        const todo = Array.from({ length: 40 }, (_, i) => ({
            status: "todo",
            fullName: `Rauchtest › POST /api/x${String(i)}: noch ohne Fall`,
            failureMessages: [],
        }));
        const { faelle, gesamt } = faelleVonVitest({
            testResults: [
                {
                    name: "/c/x/checkout/apps/server/test/schreibwege-app-rolle.test.ts",
                    status: "passed",
                    assertionResults: [{ status: "passed", fullName: "grün", failureMessages: [] }, ...todo],
                },
            ],
        });
        expect(gesamt).toBe(40);
        expect(faelle).toHaveLength(FAELLE_MAX);
        expect(faelle[0]).toEqual({
            datei: "apps/server/test/schreibwege-app-rolle.test.ts",
            name: "[todo] Rauchtest › POST /api/x0: noch ohne Fall",
            meldung: [],
        });
        expect(faelle.every((f) => f.name.startsWith("[todo] "))).toBe(true);
    });

    it("🔴 die Reihenfolge ist rot, übersprungen, todo; die Gesamtzahl zählt alle drei, und kein Rotes fällt der Kürzung zum Opfer", () => {
        const fall = (status: string, n: number) => ({
            status,
            fullName: `${status} ${String(n)}`,
            failureMessages: status === "failed" ? ["kaputt"] : [],
        });
        // Die Fälle ohne Inhalt stehen in der Datei VOR dem Roten und dem Übersprungenen.
        const { faelle, gesamt } = faelleVonVitest({
            testResults: [
                {
                    name: "/x/checkout/a.test.ts",
                    status: "failed",
                    assertionResults: [
                        ...Array.from({ length: 30 }, (_, i) => fall("todo", i)),
                        ...Array.from({ length: 3 }, (_, i) => fall("skipped", i)),
                        ...Array.from({ length: 2 }, (_, i) => fall("failed", i)),
                        fall("passed", 0),
                    ],
                },
            ],
        });
        expect(gesamt).toBe(35);
        expect(faelle).toHaveLength(FAELLE_MAX);
        expect(faelle.map((f) => f.name.split(" ")[0])).toEqual([
            ...Array<string>(2).fill("[rot]"),
            ...Array<string>(3).fill("[übersprungen]"),
            ...Array<string>(15).fill("[todo]"),
        ]);
        expect(faelle[0]?.meldung).toEqual(["kaputt"]);
        // `pending` (nicht zu Ende gelaufen) gilt wie übersprungen, ein grüner Fall steht nirgends.
        expect(
            faelleVonVitest({ testResults: [{ assertionResults: [fall("pending", 0), fall("passed", 1)] }] }),
        ).toEqual({
            faelle: [{ datei: "unbekannt", name: "[übersprungen] pending 0", meldung: [] }],
            gesamt: 1,
        });
    });

    it("🔴 aus Playwright: übersprungene Fälle mit dem Grund der Anmerkung, gekürzt wie die roten", () => {
        const { faelle, gesamt } = faelleVonPlaywright({
            suites: [
                {
                    title: "karte.spec.ts",
                    file: "karte.spec.ts",
                    specs: [
                        { title: "läuft", ok: true, tests: [{ status: "expected", results: [{ status: "passed" }] }] },
                        {
                            title: "nur Desktop",
                            ok: true,
                            tests: [
                                {
                                    status: "skipped",
                                    annotations: [{ type: "skip", description: "nur im Desktopprofil" }],
                                    results: [{ status: "skipped" }],
                                },
                            ],
                        },
                        { title: "wackelt nie", ok: true, tests: [{ status: "skipped", results: [] }] },
                        {
                            title: "bricht",
                            ok: false,
                            tests: [
                                { status: "unexpected", results: [{ status: "failed", error: { message: "boom" } }] },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(gesamt).toBe(3);
        expect(faelle).toEqual([
            { datei: "karte.spec.ts", name: "[rot] bricht", meldung: ["boom"] },
            { datei: "karte.spec.ts", name: "[übersprungen] nur Desktop", meldung: ["nur im Desktopprofil"] },
            { datei: "karte.spec.ts", name: "[übersprungen] wackelt nie", meldung: [] },
        ]);
    });

    it("rote Fälle aus Playwright: Titelpfad mit ›, Datei, Meldung des fehlgeschlagenen Versuchs", () => {
        const { faelle, gesamt } = faelleVonPlaywright({
            suites: [
                {
                    title: "karte.spec.ts",
                    file: "karte.spec.ts",
                    suites: [
                        {
                            title: "Karte",
                            specs: [
                                { title: "grün", ok: true, tests: [{ results: [{ status: "passed" }] }] },
                                {
                                    title: "zeigt Orte",
                                    ok: false,
                                    file: "karte.spec.ts",
                                    tests: [
                                        {
                                            results: [
                                                {
                                                    status: "failed",
                                                    error: { message: "Timeout 5000ms\nlocator('x')" },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(gesamt).toBe(1);
        expect(faelle).toEqual([
            { datei: "karte.spec.ts", name: "[rot] Karte › zeigt Orte", meldung: ["Timeout 5000ms", "locator('x')"] },
        ]);
    });

    it("🔴 der Bericht eines roten Vitest-Laufs: Schritt, Grund, rote Fälle, Protokollende, alles ohne Zugangsdaten", () => {
        const dir = join(ordner, "rot-tests");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "tests: Exit 1\nzweite Zeile mit postgres://app:pw@h/db\n");
        writeFileSync(
            join(dir, "vitest.json"),
            JSON.stringify({
                testResults: [
                    {
                        name: "/x/checkout/apps/server/test/a.test.ts",
                        status: "failed",
                        assertionResults: [
                            {
                                status: "failed",
                                fullName: "A",
                                failureMessages: ["DATABASE_URL=postgres://u:p@h/d fehlt"],
                            },
                        ],
                    },
                ],
            }),
        );
        writeFileSync(
            join(dir, "tests.log"),
            [...Array.from({ length: 100 }, (_, i) => `Zeile ${String(i)}`), "PGPASSWORD=geheim123", "Ende"].join("\n"),
        );
        const b = baueFehlerBericht(dir, "Satz", "tests");
        expect(b.schritt).toBe("tests");
        expect(b.grund).toBe("tests: Exit 1\nzweite Zeile mit postgres://<verborgen>@h/db");
        expect(b.faelle).toHaveLength(1);
        expect(b.faelle[0]?.meldung.join(" ")).toBe("DATABASE_URL=postgres://<verborgen>@h/d fehlt");
        expect(b.faelleGesamt).toBe(1);
        expect(b.protokollEnde).toHaveLength(PROTOKOLL_ZEILEN);
        expect(b.protokollEnde.at(-1)).toBe("Ende");
        expect(b.protokollEnde.join("\n")).not.toContain("geheim123");
        expect(JSON.stringify(b)).not.toMatch(/geheim123|u:p@|app:pw/u);
    });

    it("🔴 ein Lauf, der nur an `todo` scheiterte (WI-0248, SHA d66917064): Schritt tests, die Zahlen im Grund, die Fälle im Bericht", () => {
        const dir = join(ordner, "nur-todo");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "Vitest: 0 rot, 0 übersprungen, 3 todo (Fälle ohne Inhalt)");
        writeFileSync(
            join(dir, "vitest.json"),
            JSON.stringify({
                numTotalTests: 4,
                numTodoTests: 3,
                testResults: [
                    {
                        name: "/x/checkout/apps/server/test/schreibwege-app-rolle.test.ts",
                        status: "passed",
                        assertionResults: [
                            { status: "passed", fullName: "Tafel", failureMessages: [] },
                            ...[1, 2, 3].map((n) => ({
                                status: "todo",
                                fullName: `Rauchtest POST /api/editor/x${String(n)}: noch ohne Fall`,
                                failureMessages: [],
                            })),
                        ],
                    },
                ],
            }),
        );
        const b = baueFehlerBericht(dir, "Satz", "bau");
        expect(b.schritt).toBe("tests");
        expect(b.grund).toBe("Vitest: 0 rot, 0 übersprungen, 3 todo (Fälle ohne Inhalt)");
        expect(b.faelleGesamt).toBe(3);
        expect(b.faelle.map((f) => f.name)).toEqual([
            "[todo] Rauchtest POST /api/editor/x1: noch ohne Fall",
            "[todo] Rauchtest POST /api/editor/x2: noch ohne Fall",
            "[todo] Rauchtest POST /api/editor/x3: noch ohne Fall",
        ]);
    });

    it("ein Browserteil: Fälle aus browser-<n>.json und Protokoll des Teils; ohne Meldung gilt der Satz zum Status", () => {
        const dir = join(ordner, "rot-browser");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "Browserteil 2 unvollständig");
        writeFileSync(
            join(dir, "browser-2.json"),
            JSON.stringify({
                suites: [
                    {
                        file: "a.spec.ts",
                        title: "a.spec.ts",
                        specs: [
                            {
                                title: "geht",
                                ok: false,
                                tests: [{ results: [{ status: "failed", error: { message: "boom" } }] }],
                            },
                        ],
                    },
                ],
            }),
        );
        writeFileSync(join(dir, "browser-2.log"), "Lauf\nEnde\n");
        const b = baueFehlerBericht(dir, "Satz", "browser-2");
        expect(b).toMatchObject({ schritt: "browser-2", faelleGesamt: 1, protokollEnde: ["Lauf", "Ende"] });
        expect(b.faelle[0]).toMatchObject({ datei: "a.spec.ts", name: "[rot] geht" });

        const abbruch = join(ordner, "abbruch");
        mkdirSync(abbruch);
        writeFileSync(join(abbruch, "lint.log"), "läuft\n");
        expect(baueFehlerBericht(abbruch, "Lauf abgebrochen (ABBRUCH im Ergebnisordner)", "lint")).toEqual({
            schritt: "lint",
            grund: "Lauf abgebrochen (ABBRUCH im Ergebnisordner)",
            faelle: [],
            faelleGesamt: 0,
            protokollEnde: ["läuft"],
        });
    });

    it("fehlende oder kaputte Berichte machen keinen Fehler, nur keine Fälle", () => {
        const dir = join(ordner, "kaputt");
        mkdirSync(dir);
        writeFileSync(join(dir, "fehler.txt"), "tests: Exit 1");
        writeFileSync(join(dir, "vitest.json"), "{ kaputt");
        expect(baueFehlerBericht(dir, "Satz", undefined)).toMatchObject({
            schritt: "tests",
            faelle: [],
            faelleGesamt: 0,
            protokollEnde: [],
        });
    });
});
