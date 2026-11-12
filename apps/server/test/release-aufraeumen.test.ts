// Alte Laufordner des Release-Tests aufräumen (WI-0248, `scripts/dev/release-aufraeumen.ts`): welche Ordner unter `.release-runs` wegfallen, was nie
// gelöscht wird (Sperre, laufende Läufe, Cluster, Verweise) und dass der Runner sie vor dem ersten Platzbedarf räumt. Gearbeitet wird mit echten
// Dateien und Junctions in einem Temp-Ordner; nichts davon berührt `C:\avesmaps3d-data`.
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    FREI_WARNUNG_BYTES,
    LAUF_GRENZE_MS,
    entferneLaufOrdner,
    gb,
    leseLaufInfo,
    postmasterPid,
    raeumeLaeufeAuf,
    verweiseUnter,
    zuLoeschendeLaeufe,
    type AufraeumOptionen,
} from "../../../scripts/dev/release-aufraeumen.ts";

const sha = (zeichen: string): string => zeichen.repeat(40);
const A = sha("a");
const B = sha("b");
const C = sha("c");
const D = sha("d");
const JETZT = Date.parse("2026-10-24T12:00:00.000Z");
const tag = (t: number): string => `2026-10-${String(t).padStart(2, "0")}T08:00:00.000Z`;
const GB = 1024 ** 3;

describe("zuLoeschendeLaeufe: welche Läufe wegfallen", () => {
    const laeufe = [
        { name: A, start: Date.parse(tag(1)) },
        { name: B, start: Date.parse(tag(2)) },
        { name: C, start: Date.parse(tag(3)) },
        { name: D, start: Date.parse(tag(4)) },
    ];

    it("es bleiben der aktuelle Lauf und der jüngste andere", () => {
        expect(zuLoeschendeLaeufe(laeufe, 2, D).sort()).toEqual([A, B].sort());
        // Der aktuelle Lauf zählt immer, auch wenn er älter ist als die übrigen.
        expect(zuLoeschendeLaeufe(laeufe, 2, A).sort()).toEqual([B, C].sort());
    });

    it("höchstens zwei, bei weniger Läufen fällt nichts weg", () => {
        expect(zuLoeschendeLaeufe(laeufe.slice(0, 2), 2, B)).toEqual([]);
        expect(zuLoeschendeLaeufe([], 2, A)).toEqual([]);
        // Der aktuelle Lauf besteht vielleicht noch nicht in der Liste: Er belegt trotzdem einen Platz.
        expect(zuLoeschendeLaeufe(laeufe.slice(0, 2), 2, D).sort()).toEqual([A]);
    });

    it("🔴 der Ordner, den eine Wiederholung übernimmt, fällt nie weg, auch wenn er der älteste ist", () => {
        expect(zuLoeschendeLaeufe(laeufe, 2, D, [A]).sort()).toEqual([B, C].sort());
        // Er belegt den zweiten Platz: Der jüngste andere Lauf fällt dafür weg (höchstens zwei).
        expect(zuLoeschendeLaeufe(laeufe, 2, D, [A])).not.toContain(A);
    });

    it("ein übernommener Ordner, den es nicht gibt, verbraucht keinen Platz", () => {
        expect(zuLoeschendeLaeufe(laeufe, 2, D, [sha("9")]).sort()).toEqual([A, B].sort());
    });

    it("gleiche Startzeit: nach Namen, damit die Wahl stabil ist", () => {
        const gleich = [
            { name: A, start: 5 },
            { name: B, start: 5 },
            { name: C, start: 5 },
        ];
        expect(zuLoeschendeLaeufe(gleich, 2, C).sort()).toEqual([A]);
        expect(zuLoeschendeLaeufe(gleich, 2, C)).toEqual(zuLoeschendeLaeufe([...gleich].reverse(), 2, C));
    });
});

describe("Aufräumen mit echten Ordnern", () => {
    let wurzel = "";
    let laeufe = "";
    let ausserhalb = "";
    beforeEach(() => {
        wurzel = mkdtempSync(join(tmpdir(), "release-aufraeumen-"));
        laeufe = join(wurzel, ".release-runs");
        ausserhalb = join(wurzel, "ausserhalb");
        mkdirSync(laeufe);
        mkdirSync(ausserhalb);
        writeFileSync(join(ausserhalb, "wichtig.txt"), "darf nie verschwinden");
    });
    afterEach(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    /** Ein Laufordner mit `status.json`, einer Datei und einer Junction aus `node_modules` heraus (wie die Workspaces von `npm ci`). */
    const lege = (name: string, tagNr: number, status = "rot"): string => {
        const ordner = join(laeufe, name);
        mkdirSync(join(ordner, "checkout", "node_modules", "@avesmaps3d"), { recursive: true });
        writeFileSync(
            join(ordner, "status.json"),
            JSON.stringify({ sha: name.slice(0, 40), start: tag(tagNr), status }),
        );
        writeFileSync(join(ordner, "checkout", "groß.bin"), "x".repeat(1000));
        symlinkSync(ausserhalb, join(ordner, "checkout", "node_modules", "@avesmaps3d", "shared"), "junction");
        return ordner;
    };
    const namen = (): string[] => readdirSync(laeufe).sort();
    const optionen = (extra: Partial<AufraeumOptionen> = {}): AufraeumOptionen => ({
        laeufe,
        aktuell: D,
        jetzt: () => JETZT,
        lebt: () => false,
        freierPlatz: () => 50 * GB,
        ...extra,
    });

    it("🔴 löscht die älteren Läufe samt Junctions und lässt deren Ziele unberührt", async () => {
        lege(A, 1);
        lege(B, 2);
        lege(C, 3);
        lege(D, 4, "laeuft");
        const zeilen: string[] = [];
        const ergebnis = await raeumeLaeufeAuf(optionen({ sag: (z) => zeilen.push(z) }));
        expect([...ergebnis.geloescht].sort()).toEqual([A, B].sort());
        expect(namen()).toEqual([C, D].sort());
        expect(readFileSync(join(ausserhalb, "wichtig.txt"), "utf8"), "das Ziel der Junctions").toBe(
            "darf nie verschwinden",
        );
        expect(
            existsSync(join(laeufe, C, "checkout", "node_modules", "@avesmaps3d", "shared")),
            "behaltene Läufe bleiben ganz",
        ).toBe(true);
        expect(zeilen.join("\n")).toMatch(/gelöscht: a{40}/u);
        expect(zeilen.join("\n")).toMatch(/behalten: c{40} \(jüngster anderer Lauf\)/u);
        expect(zeilen.join("\n")).toMatch(/behalten: d{40} \(aktueller Lauf\)/u);
    });

    it("🔴 die Sperre und fremde Einträge bleiben, auch wenn sie älter als alles sind", async () => {
        mkdirSync(join(laeufe, "aktiv"));
        mkdirSync(join(laeufe, "notizen"));
        writeFileSync(join(laeufe, "notizen", "x.txt"), "x");
        writeFileSync(join(laeufe, "lose-datei.txt"), "x");
        lege(A, 1);
        lege(B, 2);
        lege(D, 4, "laeuft");
        await raeumeLaeufeAuf(optionen());
        expect(namen()).toEqual([B, D, "aktiv", "lose-datei.txt", "notizen"].sort());
    });

    it("🔴 ein Lauf, der noch laufen kann (Status „laeuft“ innerhalb der Gesamtzeit), bleibt liegen", async () => {
        lege(A, 1, "laeuft");
        lege(B, 2);
        lege(C, 3);
        lege(D, 4, "laeuft");
        const ergebnis = await raeumeLaeufeAuf(optionen({ jetzt: () => Date.parse(tag(1)) + LAUF_GRENZE_MS - 1000 }));
        expect(ergebnis.uebersprungen.map((u) => u.name)).toEqual([A]);
        expect(ergebnis.geloescht).toEqual([B]);
        expect(namen()).toEqual([A, C, D].sort());
    });

    it("ein „laeuft“ nach der Gesamtzeit des Runners ist ein abgestürzter Lauf und fällt weg", async () => {
        lege(A, 1, "laeuft");
        lege(C, 3);
        lege(D, 4, "laeuft");
        const ergebnis = await raeumeLaeufeAuf(optionen({ jetzt: () => Date.parse(tag(1)) + LAUF_GRENZE_MS + 1000 }));
        expect(ergebnis.geloescht).toEqual([A]);
    });

    it("🔴 ein Lauf mit lebendem Datenbank-Cluster bleibt liegen, einer mit totem fällt weg", async () => {
        for (const [name, pid] of [
            [A, 4242],
            [B, 4343],
        ] as const) {
            lege(name, name === A ? 1 : 2);
            mkdirSync(join(laeufe, name, "avesmaps3d-testdb-xyz", "data"), { recursive: true });
            writeFileSync(
                join(laeufe, name, "avesmaps3d-testdb-xyz", "data", "postmaster.pid"),
                `${String(pid)}\nC:/x/data\n1\n`,
            );
        }
        lege(C, 3);
        lege(D, 4, "laeuft");
        const zeilen: string[] = [];
        const ergebnis = await raeumeLaeufeAuf(optionen({ lebt: (pid) => pid === 4242, sag: (z) => zeilen.push(z) }));
        expect(ergebnis.uebersprungen.map((u) => u.name)).toEqual([A]);
        expect(ergebnis.geloescht).toEqual([B]);
        expect(zeilen.join("\n")).toMatch(
            /bleibt liegen: a{40} \(ein Datenbank-Cluster in diesem Ordner läuft noch \(PostgreSQL-Prozess 4242\)\)/u,
        );
        expect(namen()).toEqual([A, C, D].sort());
    });

    it("🔴 ein Lauf, für dessen SHA ein Starter lebt (Startvermerk „baut“), bleibt liegen", async () => {
        lege(A, 1);
        lege(B, 2);
        lege(C, 3);
        lege(D, 4, "laeuft");
        const ergebnis = await raeumeLaeufeAuf(optionen({ geschuetzteShas: new Set([A]) }));
        expect(ergebnis.geloescht).toEqual([B]);
        expect(namen()).toEqual([A, C, D].sort());
    });

    it("🔴 bei einer Wiederholung bleibt der übernommene Ordner, auch der archivierte `<sha>-<Zeit>`", async () => {
        const archiv = `${D}-20261020T080000Z`;
        lege(archiv, 3);
        lege(A, 1);
        lege(B, 2);
        lege(C, 3);
        lege(D, 4, "laeuft");
        const ergebnis = await raeumeLaeufeAuf(optionen({ erhalten: archiv }));
        expect([...ergebnis.geloescht].sort()).toEqual([A, B, C].sort());
        expect(namen()).toEqual([archiv, D].sort());
    });

    it("🔴 ein Eintrag mit Laufnamen, der ein Verweis ist, wird weder gelöscht noch verfolgt", async () => {
        symlinkSync(ausserhalb, join(laeufe, A), "junction");
        lege(B, 2);
        lege(C, 3);
        lege(D, 4, "laeuft");
        expect(leseLaufInfo(laeufe, A)).toBeUndefined();
        await raeumeLaeufeAuf(optionen());
        expect(readFileSync(join(ausserhalb, "wichtig.txt"), "utf8")).toBe("darf nie verschwinden");
        expect(existsSync(join(laeufe, A))).toBe(true);
        expect(namen()).toEqual([A, C, D].sort());
    });

    it("misst den freien Platz vor und nach dem Aufräumen und schreibt beide ins Protokoll", async () => {
        lege(A, 1);
        lege(D, 4, "laeuft");
        const messungen = [12 * GB, 40.5 * GB];
        const zeilen: string[] = [];
        const ergebnis = await raeumeLaeufeAuf(
            optionen({ freierPlatz: () => messungen.shift(), sag: (z) => zeilen.push(z) }),
        );
        expect([ergebnis.freiVorher, ergebnis.freiNachher]).toEqual([12 * GB, 40.5 * GB]);
        expect(zeilen.join("\n")).toContain("freier Platz vorher 12,0 GB");
        expect(zeilen.join("\n")).toContain("freier Platz nachher 40,5 GB");
        expect(ergebnis.warnung).toBe(false);
        expect(zeilen.join("\n")).not.toContain("WARNUNG");
    });

    it("🔴 unter 10 GB nach dem Aufräumen steht eine deutliche Warnzeile, der Lauf wird nicht angehalten", async () => {
        lege(D, 4, "laeuft");
        const messungen = [3 * GB, 8.4 * GB];
        const zeilen: string[] = [];
        const ergebnis = await raeumeLaeufeAuf(
            optionen({ freierPlatz: () => messungen.shift(), sag: (z) => zeilen.push(z) }),
        );
        expect(ergebnis.warnung).toBe(true);
        expect(zeilen.at(-1)).toMatch(/^WARNUNG: Nach dem Aufräumen sind nur 8,4 GB frei \(Schwelle 10,0 GB\)/u);
        expect(FREI_WARNUNG_BYTES).toBe(10 * GB);
    });

    it("lässt sich der freie Platz nicht messen, gibt es keine Warnung und keinen Abbruch", async () => {
        lege(D, 4, "laeuft");
        const ergebnis = await raeumeLaeufeAuf(optionen({ freierPlatz: () => undefined }));
        expect(ergebnis.warnung).toBe(false);
        expect(gb(undefined)).toBe("unbekannt");
    });

    it("ohne Ordner `.release-runs` passiert nichts und es wird nichts angelegt", async () => {
        rmSync(laeufe, { recursive: true });
        const ergebnis = await raeumeLaeufeAuf(optionen());
        expect(ergebnis.geloescht).toEqual([]);
        expect(existsSync(laeufe)).toBe(false);
    });
});

describe("Verweise und Hilfen", () => {
    let wurzel = "";
    beforeEach(() => {
        wurzel = mkdtempSync(join(tmpdir(), "release-aufraeumen-hilfe-"));
    });
    afterEach(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    it("findet Junctions, ohne ihnen zu folgen, und löst sie vor dem Löschen", async () => {
        const ziel = join(wurzel, "ziel");
        mkdirSync(join(ziel, "tief"), { recursive: true });
        writeFileSync(join(ziel, "tief", "datei.txt"), "x");
        const ordner = join(wurzel, "lauf");
        mkdirSync(join(ordner, "a", "b"), { recursive: true });
        symlinkSync(ziel, join(ordner, "a", "b", "verweis"), "junction");
        symlinkSync(ziel, join(ordner, "verweis2"), "junction");
        expect(verweiseUnter(ordner).sort()).toEqual(
            [join(ordner, "a", "b", "verweis"), join(ordner, "verweis2")].sort(),
        );
        const ergebnis = await entferneLaufOrdner(ordner);
        expect(ergebnis).toEqual({ ok: true, verweise: 2 });
        expect(existsSync(ordner)).toBe(false);
        expect(readFileSync(join(ziel, "tief", "datei.txt"), "utf8")).toBe("x");
    });

    it("liest die Prozessnummer aus der ersten Zeile von postmaster.pid", () => {
        writeFileSync(join(wurzel, "postmaster.pid"), "1234\nC:/daten\n170000\n");
        expect(postmasterPid(wurzel)).toBe(1234);
        writeFileSync(join(wurzel, "postmaster.pid"), "kaputt\n");
        expect(postmasterPid(wurzel)).toBeUndefined();
        expect(postmasterPid(join(wurzel, "gibt-es-nicht"))).toBeUndefined();
    });

    it("schreibt Größen deutsch", () => {
        expect(gb(8.4 * GB)).toBe("8,4 GB");
        expect(gb(0)).toBe("0,0 GB");
    });
});

// Der echte Runner gegen ein Wegwerf-Repository mit eigenem „origin“ (ein nacktes Repository im Temp-Ordner): Er räumt vor allem anderen auf und
// endet danach wegen des leeren Testpakets, ohne Installation und ohne Kontakt zum echten origin.
describe("Runner: räumt alte Läufe vor dem ersten Platzbedarf", { timeout: 120_000 }, () => {
    const runner = fileURLToPath(new URL("../../../scripts/dev/release-runner.ts", import.meta.url));
    const sauber = (): NodeJS.ProcessEnv => {
        const env = { ...process.env };
        for (const name of Object.keys(env)) if (name.startsWith("GIT_") || name === "AVESMAPS_DATEN") delete env[name];
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

    it("🔴 es bleiben der aktuelle Lauf und der jüngste andere, die Sperre wird danach gelöst, das Protokoll liegt im Ergebnisordner", () => {
        const wurzel = mkdtempSync(join(tmpdir(), "release-aufraeumen-runner-"));
        try {
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
            const kandidat = git(repo, "rev-parse", "HEAD");

            const ausserhalb = join(wurzel, "ausserhalb");
            mkdirSync(ausserhalb);
            writeFileSync(join(ausserhalb, "wichtig.txt"), "darf nie verschwinden");
            for (const [name, t] of [
                [A, 1],
                [B, 2],
                [C, 3],
            ] as const) {
                const ordner = join(repo, ".release-runs", name);
                mkdirSync(join(ordner, "checkout", "node_modules", "@avesmaps3d"), { recursive: true });
                writeFileSync(join(ordner, "status.json"), JSON.stringify({ sha: name, start: tag(t), status: "rot" }));
                symlinkSync(ausserhalb, join(ordner, "checkout", "node_modules", "@avesmaps3d", "shared"), "junction");
            }

            const leer = join(wurzel, "leer");
            mkdirSync(leer);
            const lauf = spawnSync(process.execPath, [runner, "--commit", kandidat, "--fixtures", leer], {
                cwd: repo,
                encoding: "utf8",
                env: sauber(),
                timeout: 90_000,
                windowsHide: true,
            });
            expect(lauf.status, lauf.stderr).toBe(1);
            const laeufe = join(repo, ".release-runs");
            expect(readdirSync(laeufe).sort()).toEqual([C, kandidat].sort());
            expect(existsSync(join(laeufe, "aktiv")), "Sperre aufgehoben").toBe(false);
            expect(readFileSync(join(ausserhalb, "wichtig.txt"), "utf8"), "Ziel der Junctions").toBe(
                "darf nie verschwinden",
            );
            const protokoll = readFileSync(join(laeufe, kandidat, "aufraeumen.txt"), "utf8");
            expect(protokoll).toMatch(/freier Platz vorher/u);
            expect(protokoll).toMatch(/freier Platz nachher/u);
            expect(protokoll).toMatch(/gelöscht: a{40}/u);
            expect(protokoll).toMatch(/gelöscht: b{40}/u);
            expect(protokoll).toMatch(/behalten: c{40} \(jüngster anderer Lauf\)/u);
            // Das Urteil des Laufs bleibt davon unberührt: rot wegen des leeren Testpakets, nicht wegen des Aufräumens.
            expect(readFileSync(join(laeufe, kandidat, "fehler.txt"), "utf8")).toMatch(/^Testpaket unvollständig/u);
        } finally {
            rmSync(wurzel, { recursive: true, force: true });
        }
    });
});
