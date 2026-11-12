// Der Starter des Release-Tests (WI-0248 R2, `scripts/dev/release-abholer.ts`): Notizen lesen und wählen, entscheiden, den Stand eines Laufs lesen,
// und der ganze Start gegen ein echtes Origin (bare Repository im Temp-Ordner) mit untergeschobenem Testpaket und Runner-Start.
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReleaseTestKandidat, ReleaseTestLauf, ReleaseTestStartvorgang } from "@avesmaps3d/shared";
import {
    STARTVERMERK_MAX_MS,
    abbrecheReleaseTest,
    entscheide,
    lebtPid,
    lebtRunnerProzess,
    leseKandidat,
    leseStartvermerke,
    leseStartvorgang,
    releaseTestAnsicht,
    schliesseOffenenStartvermerk,
    schreibeStartvermerk,
    startvermerkOrdner,
    waehleStage,
    parseAuftragsNotiz,
    parseErgebnisNotiz,
    pruefeSperre,
    archiviereLauf,
    kompakteZeit,
    leseVorigenLauf,
    releaseTestStand,
    schreibeProtokoll,
    starteReleaseTest,
    waehleAuftrag,
    type StartOptionen,
    type VolltestStart,
    type VolltestTeil,
} from "../../../scripts/dev/release-abholer.ts";
import {
    RELEASE_BELEGE,
    RELEASE_KLASSEN,
    releaseNotiz,
    type ReleaseNachweis,
} from "../../../scripts/dev/release-nachweis.ts";
import { fingerprint } from "../../../scripts/dev/release-pruefsumme.ts";
import { BELEG_DATEI } from "../../../scripts/dev/release-wiederholen.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const zeile = (sha: string, art = "auftrag", zeit = "2026-10-23T10:00:00Z", ops = "OPS-000123"): string =>
    `${sha} ${zeit} ${art} ${ops}`;

describe("Auftragsnotiz lesen", () => {
    it("liest die strenge erste Zeile (auftrag und abgebrochen, mit und ohne Millisekunden)", () => {
        expect(parseAuftragsNotiz(zeile(A))).toEqual({
            sha: A,
            zeit: "2026-10-23T10:00:00Z",
            ops: "OPS-000123",
            art: "auftrag",
        });
        expect(parseAuftragsNotiz(zeile(A, "abgebrochen", "2026-10-23T10:00:00.123Z"))?.art).toBe("abgebrochen");
        expect(parseAuftragsNotiz(`${zeile(A)}\r\nKlartext danach\n`)?.sha).toBe(A);
    });

    it.each([
        ["leer", ""],
        ["SHA zu kurz", zeile("a".repeat(39))],
        ["SHA mit Großbuchstaben", zeile("A".repeat(40))],
        ["unbekannte Art", zeile(A, "freigabe")],
        ["Zeit ohne Z", zeile(A, "auftrag", "2026-10-23T10:00:00")],
        ["Zeit unmöglich", zeile(A, "auftrag", "2026-13-45T10:00:00Z")],
        ["OPS-ID fehlt", `${A} 2026-10-23T10:00:00Z auftrag`],
        ["OPS-ID kaputt", zeile(A, "auftrag", "2026-10-23T10:00:00Z", "PROD-1")],
        ["doppeltes Leerzeichen", `${A}  2026-10-23T10:00:00Z auftrag OPS-000123`],
        ["führendes Leerzeichen", ` ${zeile(A)}`],
        ["Rest in der Zeile", `${zeile(A)} extra`],
        ["gültige Zeile erst an Stelle zwei", `Kopf\n${zeile(A)}`],
    ])("lehnt ab: %s", (_name, text) => {
        expect(parseAuftragsNotiz(text)).toBeUndefined();
    });
});

describe("Auftrag wählen", () => {
    it("nimmt den jüngsten gültigen Auftrag", () => {
        const wahl = waehleAuftrag([
            { objekt: A, text: zeile(A, "auftrag", "2026-10-22T10:00:00Z", "OPS-000100") },
            { objekt: B, text: zeile(B, "auftrag", "2026-10-23T09:00:00Z", "OPS-000101") },
            { objekt: C, text: zeile(C, "auftrag", "2026-10-21T10:00:00Z", "OPS-000099") },
        ]);
        expect(wahl).toEqual({ sha: B, zeit: "2026-10-23T09:00:00Z", ops: "OPS-000101" });
    });

    it("abgebrochen gewinnt für denselben Commit, auch wenn der Auftrag jünger aussieht", () => {
        expect(
            waehleAuftrag([
                { objekt: A, text: zeile(A, "abgebrochen", "2026-10-23T08:00:00Z") },
                { objekt: A, text: zeile(A, "auftrag", "2026-10-23T09:00:00Z") },
            ]),
        ).toBeUndefined();
    });

    it("ein abgebrochener Commit lässt den Auftrag eines anderen unberührt", () => {
        const wahl = waehleAuftrag([
            { objekt: A, text: zeile(A, "abgebrochen", "2026-10-23T12:00:00Z") },
            { objekt: B, text: zeile(B, "auftrag", "2026-10-23T09:00:00Z") },
        ]);
        expect(wahl?.sha).toBe(B);
    });

    it("ignoriert kaputte Zeilen und Notizen, deren Zeile einen anderen Commit nennt als der, an dem sie hängt", () => {
        const wahl = waehleAuftrag([
            { objekt: A, text: "Quatsch" },
            { objekt: B, text: zeile(C) },
            { objekt: C, text: `${zeile(A, "auftrag", "2026-10-23T10:00:00Z")}` },
            { objekt: C, text: zeile(C, "auftrag", "2026-10-20T10:00:00Z", "OPS-000001") },
        ]);
        expect(wahl).toEqual({ sha: C, zeit: "2026-10-20T10:00:00Z", ops: "OPS-000001" });
    });

    it("liest nur die erste Zeile: Eine gültige Zeile weiter unten zählt nicht", () => {
        expect(waehleAuftrag([{ objekt: A, text: `Notiz\n${zeile(A)}` }])).toBeUndefined();
    });

    it("ohne Notizen kein Auftrag", () => {
        expect(waehleAuftrag([])).toBeUndefined();
    });
});

const gruenerNachweis = (sha: string): ReleaseNachweis => ({
    version: 3,
    belege: Object.fromEntries(RELEASE_BELEGE.map((p) => [p, "e".repeat(64)])),
    sha,
    umgebung: "b".repeat(64),
    start: new Date(Date.now() - 2000).toISOString(),
    ende: new Date(Date.now() - 1000).toISOString(),
    status: "gruen",
    teile: RELEASE_KLASSEN.map((klasse) => ({ klasse, sha, exit: 0, status: "gruen" })),
});

describe("Ergebnisnotiz lesen", () => {
    it("erkennt rot, offen und einen gültigen grünen Nachweis Version 3", () => {
        expect(parseErgebnisNotiz(`${A} 2026-10-23T10:00:00.000Z rot\nRelease-Auftrag fehlgeschlagen.\n`, A)).toBe(
            "rot",
        );
        expect(parseErgebnisNotiz(`${A} 2026-10-23T10:00:00.000Z offen\nRelease-Auftrag läuft.\n`, A)).toBe("offen");
        expect(parseErgebnisNotiz(releaseNotiz(gruenerNachweis(A)), A)).toBe("gruen");
    });

    it("ein Grün ohne gültigen Nachweis Version 3 stoppt keinen neuen Lauf", () => {
        expect(parseErgebnisNotiz(`${A} 2026-10-23T10:00:00.000Z gruen\nirgendwas\n`, A)).toBeUndefined();
    });

    it("Notizen des früheren periodischen Sammellaufs sind kein Ergebnis eines Release-Laufs", () => {
        const alt = `${A} 2026-10-20T03:03:31.370Z rot\nSammellauf (WI-0228): vor-dem-push --voll grün, Browserfälle (alle) 1669 grün, 3 rot\n`;
        expect(parseErgebnisNotiz(alt, A)).toBeUndefined();
    });

    it("lehnt eine Notiz für einen anderen Commit und kaputte Zeilen ab", () => {
        expect(parseErgebnisNotiz(`${B} 2026-10-23T10:00:00.000Z rot\n`, A)).toBeUndefined();
        expect(parseErgebnisNotiz("rot", A)).toBeUndefined();
        expect(parseErgebnisNotiz(`${A} gestern rot\n`, A)).toBeUndefined();
        expect(parseErgebnisNotiz("", A)).toBeUndefined();
    });
});

describe("Entscheidung", () => {
    const frueher = { start: Date.parse("2026-10-23T10:00:00Z"), gruen: false };
    const frei = { ergebnis: undefined, laufOrdner: false, sperre: false };

    it("startet, wenn nichts dagegen spricht; ein „offen“ auf Origin stört nicht", () => {
        expect(entscheide(frei)).toEqual({ aktion: "starten", neuerVersuch: false });
        expect(entscheide({ ...frei, ergebnis: "offen" })).toEqual({ aktion: "starten", neuerVersuch: false });
    });

    it("ein ausdrücklicher Start nach einem nicht grünen Lauf ist ein neuer Versuch (Ordner oder rote Notiz)", () => {
        expect(entscheide({ ...frei, laufOrdner: true, vorigerLauf: frueher })).toEqual({
            aktion: "starten",
            neuerVersuch: true,
        });
        expect(entscheide({ ...frei, ergebnis: "rot", vorigerLauf: frueher })).toEqual({
            aktion: "starten",
            neuerVersuch: true,
        });
        expect(entscheide({ ...frei, laufOrdner: true })).toEqual({ aktion: "starten", neuerVersuch: true });
    });

    it("nichts bei einem grünen Stand, auch wenn gerade ein Lauf aktiv ist", () => {
        expect(entscheide({ ...frei, ergebnis: "gruen" })).toEqual({ aktion: "nichts", grund: "gruen" });
        expect(entscheide({ ...frei, laufOrdner: true, vorigerLauf: { ...frueher, gruen: true } })).toEqual({
            aktion: "nichts",
            grund: "gruen",
        });
        expect(entscheide({ ...frei, ergebnis: "gruen", sperre: true })).toEqual({ aktion: "nichts", grund: "gruen" });
    });

    it("nichts neben einem aktiven Lauf, für diese SHA und für jede andere", () => {
        expect(entscheide({ ...frei, sperre: true })).toEqual({ aktion: "nichts", grund: "sperre" });
        expect(entscheide({ ...frei, sperre: true, laufOrdner: true, vorigerLauf: frueher, ergebnis: "rot" })).toEqual({
            aktion: "nichts",
            grund: "sperre",
        });
    });
});

describe("Früherer Lauf lesen und verschieben", () => {
    let ordner = "";
    beforeAll(() => {
        ordner = mkdtempSync(join(tmpdir(), "abholer-lauf-"));
    });
    afterAll(() => {
        rmSync(ordner, { recursive: true, force: true });
    });

    it("liest Start und Grün aus status.json", () => {
        const lauf = join(ordner, "a");
        mkdirSync(lauf);
        writeFileSync(join(lauf, "status.json"), JSON.stringify({ status: "rot", start: "2026-10-23T09:50:00.000Z" }));
        expect(leseVorigenLauf(lauf)).toEqual({
            start: Date.parse("2026-10-23T09:50:00.000Z"),
            gruen: false,
            nurBericht: false,
        });
        writeFileSync(
            join(lauf, "status.json"),
            JSON.stringify({ status: "gruen", start: "2026-10-23T09:50:00.000Z" }),
        );
        expect(leseVorigenLauf(lauf).gruen).toBe(true);
    });

    it("behandelt fehlenden oder kaputten Status als nicht grün und nimmt dann das Alter des Ordners", () => {
        const leer = join(ordner, "leer");
        mkdirSync(leer);
        const ohne = leseVorigenLauf(leer);
        expect(ohne.gruen).toBe(false);
        expect(Number.isFinite(ohne.start)).toBe(true);
        writeFileSync(join(leer, "status.json"), "kein json");
        expect(leseVorigenLauf(leer).gruen).toBe(false);
    });

    it("benennt den Zeitanteil kompakt", () => {
        expect(kompakteZeit(Date.parse("2026-10-23T10:05:00.123Z"))).toBe("20261023T100500Z");
    });

    it("verschiebt statt zu löschen und nummeriert bei gleichem Namen weiter", () => {
        const laeufe = join(ordner, "laeufe");
        const start = Date.parse("2026-10-23T10:05:00Z");
        for (const inhalt of ["eins", "zwei"]) {
            mkdirSync(join(laeufe, A), { recursive: true });
            writeFileSync(join(laeufe, A, "ergebnis.txt"), inhalt);
            archiviereLauf(laeufe, A, start);
        }
        expect(readdirSync(laeufe).sort()).toEqual([`${A}-20261023T100500Z`, `${A}-20261023T100500Z-2`]);
        expect(readFileSync(join(laeufe, `${A}-20261023T100500Z`, "ergebnis.txt"), "utf8")).toBe("eins");
        expect(readFileSync(join(laeufe, `${A}-20261023T100500Z-2`, "ergebnis.txt"), "utf8")).toBe("zwei");
    });
});

describe("Stand eines Release-Tests lesen", () => {
    let klon = "";
    beforeAll(() => {
        klon = mkdtempSync(join(tmpdir(), "abholer-stand-"));
    });
    afterAll(() => {
        rmSync(klon, { recursive: true, force: true });
    });
    const lauf = (sha: string, status: Record<string, unknown>, dateien: Record<string, string> = {}): string => {
        const ordner = join(klon, ".release-runs", sha);
        mkdirSync(ordner, { recursive: true });
        writeFileSync(join(ordner, "status.json"), JSON.stringify(status));
        for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt);
        return ordner;
    };
    const sperre = (an: boolean): void => {
        const pfad = join(klon, ".release-runs", "aktiv");
        if (an) mkdirSync(pfad, { recursive: true });
        else rmSync(pfad, { recursive: true, force: true });
    };
    const inhalt = (ordner: string): string[] => readdirSync(ordner, { recursive: true }).map(String).sort();

    it("ohne Läufe: keiner", () => {
        expect(releaseTestStand(undefined, { klon })).toEqual({ zustand: "keiner", fertigeTeile: [], sperre: false });
        expect(releaseTestStand(A, { klon })).toEqual({ zustand: "keiner", sha: A, fertigeTeile: [], sperre: false });
    });

    it("läuft: Schritt ist das zuletzt beschriebene Schrittprotokoll, fertige Teile stehen daneben", () => {
        const ordner = lauf(A, {
            status: "laeuft",
            start: "2026-10-23T10:00:00.000Z",
            ende: "",
            teile: [{ sha: A, klasse: "voll", status: "gruen", exit: 0 }],
        });
        writeFileSync(join(ordner, "installation.log"), "x");
        writeFileSync(join(ordner, "browser-1.log"), "x");
        utimesSync(join(ordner, "installation.log"), new Date(Date.now() - 20_000), new Date(Date.now() - 20_000));
        sperre(true);
        const stand = releaseTestStand(A, { klon });
        expect(stand).toMatchObject({
            zustand: "laeuft",
            sha: A,
            schritt: "browser-1",
            fertigeTeile: ["voll"],
            start: "2026-10-23T10:00:00.000Z",
            sperre: true,
        });
        expect(stand.statuspfad).toBe(join(ordner, "status.json"));
        expect(stand.ende).toBeUndefined();
        expect(stand.grund).toBeUndefined();
    });

    it("grün: mit Ende, ohne Schritt und Grund", () => {
        sperre(false);
        lauf(B, { status: "gruen", start: "2026-10-23T11:00:00.000Z", ende: "2026-10-23T14:00:00.000Z", teile: [] });
        const stand = releaseTestStand(B, { klon });
        expect(stand).toMatchObject({ zustand: "gruen", ende: "2026-10-23T14:00:00.000Z" });
        expect(stand.schritt).toBeUndefined();
        expect(stand.grund).toBeUndefined();
    });

    it("rot: der Grund ist die erste Zeile von fehler.txt, ohne Pfade und Adressen", () => {
        lauf(
            C,
            { status: "rot", start: "2026-10-23T12:00:00.000Z", ende: "2026-10-23T12:05:00.000Z" },
            { "fehler.txt": "tests: Exit 1 in C:\\Users\\mail\\x\\test.log siehe https://example.org/a\nzweite Zeile" },
        );
        const stand = releaseTestStand(C, { klon });
        expect(stand.zustand).toBe("rot");
        expect(stand.grund).toContain("tests: Exit 1");
        expect(stand.grund).not.toContain("C:\\");
        expect(stand.grund).not.toContain("https://");
        expect(stand.grund).not.toContain("zweite");
    });

    it("abgebrochen und Zeitüberschreitung haben einen Satz, ein Lauf ohne Sperre und Ergebnis gilt als abgebrochen", () => {
        const D = "d".repeat(40);
        const E = "e".repeat(40);
        const F = "f".repeat(40);
        lauf(D, { status: "abgebrochen", start: "2026-10-23T09:00:00.000Z", ende: "2026-10-23T09:01:00.000Z" });
        lauf(E, { status: "timeout", start: "2026-10-23T08:00:00.000Z", ende: "2026-10-23T20:00:00.000Z" });
        lauf(F, { status: "laeuft", start: "2026-10-23T07:00:00.000Z", ende: "" });
        expect(releaseTestStand(D, { klon })).toMatchObject({
            zustand: "abgebrochen",
            grund: expect.stringContaining("abgebrochen"),
        });
        expect(releaseTestStand(E, { klon })).toMatchObject({
            zustand: "rot",
            grund: expect.stringContaining("zwölf Stunden"),
        });
        expect(releaseTestStand(F, { klon })).toMatchObject({
            zustand: "abgebrochen",
            grund: expect.stringContaining("ohne Ergebnis"),
        });
    });

    it("ohne SHA: der Lauf mit dem jüngsten Start; kaputte Status stören nicht", () => {
        // 🪤 Weit in der Zukunft: Der kaputte Status unten fällt auf die Anlegezeit seines Ordners (jetzt) zurück; ein festes Datum von gestern wurde heute zur Zeitbombe.
        lauf("1".repeat(40), { status: "rot", start: "2099-01-01T00:00:00.000Z", ende: "2099-01-01T00:10:00.000Z" });
        const kaputt = join(klon, ".release-runs", "2".repeat(40));
        mkdirSync(kaputt);
        writeFileSync(join(kaputt, "status.json"), "{ kaputt");
        expect(releaseTestStand(undefined, { klon }).sha).toBe("1".repeat(40));
        expect(releaseTestStand("2".repeat(40), { klon }).zustand).toBe("rot");
    });

    it("liest nur: kein Ordner, keine Datei, keine Änderung", () => {
        const vorher = inhalt(klon);
        const zeiten = statSync(join(klon, ".release-runs")).mtimeMs;
        releaseTestStand(undefined, { klon });
        releaseTestStand(A, { klon });
        releaseTestStand("9".repeat(40), { klon });
        expect(inhalt(klon)).toEqual(vorher);
        expect(statSync(join(klon, ".release-runs")).mtimeMs).toBe(zeiten);
    });
});

describe("Protokoll", () => {
    it("schreibt eine Zeile je Handlung und wiederholt einen anhaltenden Zustand nicht", () => {
        const ordner = mkdtempSync(join(tmpdir(), "abholer-log-"));
        const datei = join(ordner, "abholer.log");
        try {
            expect(schreibeProtokoll(datei, "Sperre ohne Prozess", new Date("2026-10-23T10:00:00Z"))).toBe(true);
            expect(schreibeProtokoll(datei, "Sperre ohne Prozess", new Date("2026-10-23T10:15:00Z"))).toBe(false);
            expect(schreibeProtokoll(datei, "Runner gestartet", new Date("2026-10-23T10:30:00Z"))).toBe(true);
            expect(schreibeProtokoll(datei, "Sperre ohne Prozess", new Date("2026-10-23T10:45:00Z"))).toBe(true);
            const zeilen = readFileSync(datei, "utf8").trim().split("\n");
            expect(zeilen).toEqual([
                "2026-10-23T10:00:00.000Z Sperre ohne Prozess",
                "2026-10-23T10:30:00.000Z Runner gestartet",
                "2026-10-23T10:45:00.000Z Sperre ohne Prozess",
            ]);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });
});

// ───────────── Der Start gegen ein echtes Origin ─────────────

const IDENTITAET = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@avesmaps3d.local",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@avesmaps3d.local",
};
const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...IDENTITAET },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();

describe("Start gegen ein echtes Origin", () => {
    let wurzel = "";
    let origin = "";
    let arbeit = "";
    let nummer = 0;

    beforeAll(() => {
        wurzel = mkdtempSync(join(tmpdir(), "abholer-start-"));
        origin = join(wurzel, "origin.git");
        mkdirSync(origin);
        git(origin, "init", "--bare", "--quiet", "-b", "master");
        arbeit = join(wurzel, "arbeit");
        git(wurzel, "clone", "--quiet", origin, arbeit);
        git(arbeit, "checkout", "--quiet", "-b", "master");
        git(arbeit, "config", "user.name", "Quelle");
        git(arbeit, "config", "user.email", "quelle@avesmaps3d.local");
        git(arbeit, "commit", "--quiet", "--allow-empty", "-m", "Anfang");
        git(arbeit, "push", "--quiet", "origin", "master");
    }, 60_000);

    afterAll(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    /** Ein frischer Commit auf master, ein frischer Klon, ein frisches Datenverzeichnis. */
    function uebung(): { sha: string; klon: string; daten: string; notiere: (ref: string, text: string) => void } {
        nummer += 1;
        // Jede Übung beginnt ohne Notizen: sonst entscheiden Aufträge früherer Übungen mit.
        for (const ref of ["release-auftrag", "sammellauf", "stage"])
            for (const ort of [origin, arbeit]) git(ort, "update-ref", "-d", `refs/notes/${ref}`);
        git(arbeit, "commit", "--quiet", "--allow-empty", "-m", `Stand ${String(nummer)}`);
        git(arbeit, "push", "--quiet", "origin", "master");
        const sha = git(arbeit, "rev-parse", "HEAD");
        const klon = join(wurzel, `klon-${String(nummer)}`);
        git(wurzel, "clone", "--quiet", origin, klon);
        const daten = join(wurzel, `daten-${String(nummer)}`);
        const notiere = (ref: string, text: string): void => {
            git(arbeit, "notes", `--ref=${ref}`, "add", "-f", "-m", text, sha);
            git(arbeit, "push", "--quiet", "origin", `+refs/notes/${ref}:refs/notes/${ref}`);
        };
        return { sha, klon, daten, notiere };
    }

    interface Spur {
        fixtures: string[];
        runner: string[];
    }
    /** Optionen mit untergeschobenem Testpaket und Runner; der untergeschobene Runner legt Ordner, Status und Sperre an wie der echte. */
    function optionen(
        u: { sha: string; klon: string; daten: string },
        spur: Spur,
        zusatz: Partial<StartOptionen> = {},
    ): StartOptionen {
        return {
            commit: u.sha,
            klon: u.klon,
            daten: u.daten,
            quelle: arbeit,
            statusWarteMs: 3000,
            lebtRunner: () => false,
            baueFixtures: (sha) => {
                spur.fixtures.push(sha);
                return Promise.resolve(join(u.daten, "release-fixtures", sha));
            },
            starteRunner: (sha) => {
                spur.runner.push(sha);
                mkdirSync(join(u.klon, ".release-runs", sha), { recursive: true });
                mkdirSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true });
                writeFileSync(
                    join(u.klon, ".release-runs", sha, "status.json"),
                    JSON.stringify({ status: "laeuft", start: new Date().toISOString() }),
                );
                return Promise.resolve(4242);
            },
            ...zusatz,
        };
    }
    /** Der Lauf endet: Status gesetzt, Sperre weg, wie es der Runner am Ende tut. */
    function beende(klon: string, sha: string, status: string, fehler?: string): void {
        const ordner = join(klon, ".release-runs", sha);
        const alt = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8")) as Record<string, unknown>;
        writeFileSync(join(ordner, "status.json"), JSON.stringify({ ...alt, status, ende: new Date().toISOString() }));
        if (fehler !== undefined) writeFileSync(join(ordner, "fehler.txt"), fehler);
        rmSync(join(klon, ".release-runs", "aktiv"), { recursive: true, force: true });
    }
    const protokollZeilen = (daten: string): string[] => {
        const datei = join(daten, "release-abholer", "abholer.log");
        return existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n") : [];
    };
    const leer: Spur = { fixtures: [], runner: [] };
    /** Dieselben Optionen ohne `commit`: Dann entscheidet der jüngste offene Auftrag. */
    function ohneCommit(o: StartOptionen): StartOptionen {
        const kopie: { -readonly [K in keyof StartOptionen]: StartOptionen[K] } = { ...o };
        delete kopie.commit;
        return kopie;
    }

    it("ohne --commit und ohne Auftragsverweis: ein klarer Satz, nichts gebaut, kein Protokolleintrag", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(ohneCommit(optionen(u, spur)));
        expect(ergebnis.status).toBe("kein-auftrag");
        expect(ergebnis.grund).toContain("keinen offenen Auftrag");
        expect(ergebnis.grund).toContain("--commit");
        expect(spur).toEqual(leer);
        expect(protokollZeilen(u.daten)).toEqual([]);
    }, 60_000);

    it("ohne --commit startet der jüngste offene Auftrag und meldet Status, SHA, OPS-ID und Pfad der status.json", async () => {
        const u = uebung();
        u.notiere("release-auftrag", zeile(u.sha, "auftrag", "2026-10-23T10:00:00Z", "OPS-000777"));
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(ohneCommit(optionen(u, spur)));
        expect(ergebnis).toMatchObject({
            status: "gestartet",
            sha: u.sha,
            ops: "OPS-000777",
            pid: 4242,
            statuspfad: join(u.klon, ".release-runs", u.sha, "status.json"),
        });
        expect(ergebnis.grund).toContain(ergebnis.statuspfad);
        expect(spur).toEqual({ fixtures: [u.sha], runner: [u.sha] });
        expect(git(u.klon, "rev-parse", "HEAD")).toBe(git(u.klon, "rev-parse", "origin/master"));
        const zeilen = protokollZeilen(u.daten);
        expect(zeilen).toHaveLength(2);
        expect(zeilen[0]).toContain("Testpaket");
        expect(zeilen[1]).toContain("OPS-000777");
    }, 90_000);

    it("ein ausdrücklicher Start braucht keine Auftragsnotiz; läuft er, startet ein zweiter Aufruf nichts", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const erster = await starteReleaseTest(optionen(u, spur));
        expect(erster.status).toBe("gestartet");
        expect(erster.ops).toBeUndefined();
        const zweiter = await starteReleaseTest(optionen(u, spur, { lebtRunner: () => true }));
        expect(zweiter.status).toBe("laeuft");
        expect(zweiter.statuspfad).toBe(erster.statuspfad);
        expect(spur.runner).toEqual([u.sha]);
        expect(protokollZeilen(u.daten)).toHaveLength(2);
    }, 90_000);

    it("ein aktiver Lauf einer anderen SHA hält auch diesen Start auf; der Klon wird dabei nicht angefasst", async () => {
        const u = uebung();
        mkdirSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true });
        const kopf = git(u.klon, "rev-parse", "HEAD");
        git(arbeit, "commit", "--quiet", "--allow-empty", "-m", "neuer als der Klon");
        git(arbeit, "push", "--quiet", "origin", "master");
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { lebtRunner: () => true }));
        expect(ergebnis.status).toBe("laeuft");
        expect(spur).toEqual(leer);
        expect(git(u.klon, "rev-parse", "HEAD")).toBe(kopf);
    }, 90_000);

    it("eine Sperre ohne lebenden Prozess wird gemeldet (einmal im Protokoll), nie entsperrt und startet nichts", async () => {
        const u = uebung();
        mkdirSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true });
        const spur: Spur = { fixtures: [], runner: [] };
        const erster = await starteReleaseTest(optionen(u, spur));
        const zweiter = await starteReleaseTest(optionen(u, spur));
        expect(erster.status).toBe("sperre-ohne-prozess");
        expect(zweiter.status).toBe("sperre-ohne-prozess");
        expect(spur).toEqual(leer);
        expect(existsSync(join(u.klon, ".release-runs", "aktiv"))).toBe(true);
        const zeilen = protokollZeilen(u.daten);
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]).toContain("nicht entsperrt");
    }, 90_000);

    it("🔴 eine Sperre ohne lebenden Prozess, deren Lauf abgebrochen wurde, gibt der Start frei, schreibt eine Zeile ins Protokoll und startet", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const erster = await starteReleaseTest(optionen(u, spur));
        expect(erster.status).toBe("gestartet");
        // Wie nach dem Abbruch über die Karte: Status „abgebrochen“ mit ende, die Sperre blieb stehen, kein Runner lebt.
        const ordner = join(u.klon, ".release-runs", u.sha);
        const alt = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8")) as Record<string, unknown>;
        writeFileSync(
            join(ordner, "status.json"),
            JSON.stringify({ ...alt, status: "abgebrochen", ende: new Date().toISOString() }),
        );
        expect(existsSync(join(u.klon, ".release-runs", "aktiv"))).toBe(true);

        // Die Vorprüfung ändert nichts und sagt, was sie täte.
        const trocken = await starteReleaseTest(optionen(u, spur, { trocken: true }));
        expect(trocken.status).toBe("trocken");
        expect(trocken.grund).toContain("zuerst freigegeben");
        expect(existsSync(join(u.klon, ".release-runs", "aktiv"))).toBe(true);
        expect(spur.runner).toEqual([u.sha]);

        const zweiter = await starteReleaseTest(optionen(u, spur));
        expect(zweiter.status).toBe("gestartet");
        expect(spur.runner).toEqual([u.sha, u.sha]);
        const zeilen = protokollZeilen(u.daten);
        expect(zeilen.filter((z) => z.includes("freigegeben"))).toHaveLength(1);
        expect(zeilen.find((z) => z.includes("freigegeben"))).toContain(`${u.sha.slice(0, 12)} (abgebrochen`);
    }, 90_000);

    it("🔴 eine Sperre ohne lebenden Prozess und ohne Endzustand des Laufs (Absturz) bleibt: gemeldet mit dem Grund, nicht entsperrt, nichts gestartet", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const erster = await starteReleaseTest(optionen(u, spur));
        expect(erster.status).toBe("gestartet");
        // Der Runner ist abgestürzt: Status „laeuft“ ohne ende, die Sperre steht, kein Prozess.
        const zweiter = await starteReleaseTest(optionen(u, spur));
        expect(zweiter.status).toBe("sperre-ohne-prozess");
        expect(zweiter.grund).toContain("abgestürzt");
        expect(zweiter.grund).toContain("nicht entsperrt");
        expect(existsSync(join(u.klon, ".release-runs", "aktiv"))).toBe(true);
        expect(spur.runner).toEqual([u.sha]);
        expect(protokollZeilen(u.daten).some((z) => z.includes("freigegeben"))).toBe(false);
    }, 90_000);

    it("lebt ein Runner (oder ist es nicht feststellbar), gibt der Start auch die Sperre eines beendeten Laufs nicht frei", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        beende(u.klon, u.sha, "abgebrochen");
        mkdirSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true });
        const lebt = await starteReleaseTest(optionen(u, spur, { lebtRunner: () => true }));
        expect(lebt.status).toBe("laeuft");
        const unklar = await starteReleaseTest(optionen(u, spur, { lebtRunner: () => undefined }));
        expect(unklar.status).toBe("laeuft");
        expect(existsSync(join(u.klon, ".release-runs", "aktiv"))).toBe(true);
        expect(spur.runner).toEqual([u.sha]);
    }, 90_000);

    it("ein ausdrücklicher neuer Start nach Rot benennt den alten Ordner um und startet neu", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const erster = await starteReleaseTest(optionen(u, spur));
        expect(erster.status).toBe("gestartet");
        const alt = join(u.klon, ".release-runs", u.sha);
        const start = (JSON.parse(readFileSync(join(alt, "status.json"), "utf8")) as { start: string }).start;
        beende(u.klon, u.sha, "rot", "tests: Exit 1");
        const zweiter = await starteReleaseTest(optionen(u, spur));
        expect(zweiter.status).toBe("gestartet");
        expect(spur.runner).toEqual([u.sha, u.sha]);
        const name = `${u.sha}-${new Date(start)
            .toISOString()
            .replace(/\.\d+Z$/, "Z")
            .replace(/[-:]/g, "")}`;
        expect(zweiter.verschoben).toBe(name);
        // Der alte Ergebnisordner ist erhalten, der Name <sha> gehört dem neuen Lauf.
        expect(readFileSync(join(u.klon, ".release-runs", name, "fehler.txt"), "utf8")).toBe("tests: Exit 1");
        expect(existsSync(join(alt, "fehler.txt"))).toBe(false);
        expect(protokollZeilen(u.daten).join("\n")).toContain(`.release-runs/${name}`);
    }, 90_000);

    it("nach Abbruch und nach Zeitüberschreitung gilt dasselbe, auch zweimal hintereinander", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        beende(u.klon, u.sha, "abgebrochen");
        expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
        beende(u.klon, u.sha, "timeout");
        const dritter = await starteReleaseTest(optionen(u, spur));
        expect(dritter.status).toBe("gestartet");
        expect(readdirSync(join(u.klon, ".release-runs")).filter((n) => n.startsWith(`${u.sha}-`))).toHaveLength(2);
    }, 90_000);

    it("ein gescheitertes Testpaket lässt den alten Ergebnisordner unberührt; der nächste Aufruf versucht es erneut", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        beende(u.klon, u.sha, "rot", "alter Befund");
        const gescheitert = await starteReleaseTest(
            optionen(u, spur, { baueFixtures: () => Promise.reject(new Error("Quelle kennt neuere Migration")) }),
        );
        expect(gescheitert.status).toBe("fehler");
        expect(gescheitert.grund).toContain("neuere Migration");
        expect(readFileSync(join(u.klon, ".release-runs", u.sha, "fehler.txt"), "utf8")).toBe("alter Befund");
        expect(readdirSync(join(u.klon, ".release-runs")).filter((n) => n.startsWith(`${u.sha}-`))).toEqual([]);
        expect(spur.runner).toHaveLength(1);
        expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
    }, 90_000);

    it("ein grüner Lauf-Ordner oder eine grüne Notiz auf Origin: nichts gestartet", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        beende(u.klon, u.sha, "gruen");
        const ordnerGruen = await starteReleaseTest(optionen(u, spur));
        expect(ordnerGruen.status).toBe("gruen");
        expect(spur.runner).toHaveLength(1);

        const v = uebung();
        v.notiere("sammellauf", releaseNotiz(gruenerNachweis(v.sha)));
        const notizGruen = await starteReleaseTest(optionen(v, spur));
        expect(notizGruen.status).toBe("gruen");
        expect(notizGruen.grund).toContain("grün");
        expect(spur.runner).toHaveLength(1);
    }, 90_000);

    describe("🔴 Der Volltest (WI-0264): Teil 1 und Teil 2, nur Bericht", () => {
        interface VolltestSpur extends Spur {
            volltest: (VolltestStart | undefined)[];
            freigabe: (string | undefined)[];
        }
        /** Der untergeschobene Runner wie oben, dazu `nurBericht`, Profil und Vorlauf in `status.json`, wie der echte sie schreibt. */
        const mitVolltest = (u: { klon: string }, spur: VolltestSpur): Partial<StartOptionen> => ({
            starteRunner: (sha, _fixtures, _uebernehmen, freigabe, volltest) => {
                spur.runner.push(sha);
                spur.volltest.push(volltest);
                spur.freigabe.push(freigabe);
                mkdirSync(join(u.klon, ".release-runs", sha), { recursive: true });
                mkdirSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true });
                writeFileSync(
                    join(u.klon, ".release-runs", sha, "status.json"),
                    JSON.stringify({
                        status: "laeuft",
                        start: new Date().toISOString(),
                        sha,
                        ...(volltest === undefined
                            ? { profil: "tor" }
                            : {
                                  profil: volltest.profil,
                                  nurBericht: true,
                                  ...(volltest.vorlauf === undefined
                                      ? {}
                                      : { vorlauf: { ordner: volltest.vorlauf, status: "gruen", profil: "tor" } }),
                              }),
                    }),
                );
                return Promise.resolve(4242);
            },
        });

        it("läuft auch nach einem grünen Schnelltest, ohne Freigabe; Teil 2 bekommt Teil 1 als Vorlauf; danach ist ein Schnelltest wieder nötig", async () => {
            const u = uebung();
            const spur: VolltestSpur = { fixtures: [], runner: [], volltest: [], freigabe: [] };
            const extra = mitVolltest(u, spur);
            await starteReleaseTest(optionen(u, spur, extra));
            beende(u.klon, u.sha, "gruen");

            const teil1 = await starteReleaseTest(optionen(u, spur, { ...extra, volltest: "tor" }));
            expect(teil1.status).toBe("gestartet");
            expect(teil1.volltest).toBe(true);
            expect(teil1.verschoben).toMatch(new RegExp(`^${u.sha}-`));
            expect(spur.volltest.at(-1)).toEqual({ profil: "tor" });
            expect(spur.freigabe.at(-1)).toBeUndefined();
            beende(u.klon, u.sha, "gruen");

            const teil2 = await starteReleaseTest(optionen(u, spur, { ...extra, volltest: "voll" }));
            expect(teil2.status).toBe("gestartet");
            expect(teil2.vorlauf).toBe(teil2.verschoben);
            expect(spur.volltest.at(-1)).toEqual({ profil: "voll", vorlauf: teil2.verschoben });
            beende(u.klon, u.sha, "rot", "Browserteil 3 (Karte): 2 Fälle rot");

            // Die Karte: ein Lauf des Volltests, Teil 2, mit dem Ergebnis von Teil 1; „Rote Teile wiederholen“ gibt es für ihn nicht.
            const ansicht = releaseTestAnsicht(undefined, { klon: u.klon, daten: u.daten, lebtRunner: () => false });
            expect(ansicht).toMatchObject({ zustand: "rot", volltest: true, profil: "voll", wiederholbar: false });
            expect(ansicht.vorlauf).toEqual({ zustand: "gruen" });
            // Die Wiederholung setzt nie einen Lauf des Volltests fort.
            expect((await starteReleaseTest(optionen(u, spur, { ...extra, wiederholen: true }))).status).toBe(
                "kein-roter-lauf",
            );
            // Ein grüner Volltest gibt nichts frei: Der Schnelltest danach läuft (er ist nicht „schon grün“).
            const v = uebung();
            const spurV: VolltestSpur = { fixtures: [], runner: [], volltest: [], freigabe: [] };
            const extraV = mitVolltest(v, spurV);
            await starteReleaseTest(optionen(v, spurV, { ...extraV, volltest: "tor" }));
            beende(v.klon, v.sha, "gruen");
            const schnell = await starteReleaseTest(optionen(v, spurV, extraV));
            expect(schnell.status).toBe("gestartet");
            expect(spurV.volltest.at(-1)).toBeUndefined();
        }, 120_000);

        it("🔴 nie mit Freigabe, nie als Wiederholung, nur tor oder voll", async () => {
            const u = uebung();
            const spur: VolltestSpur = { fixtures: [], runner: [], volltest: [], freigabe: [] };
            const extra = mitVolltest(u, spur);
            const kennung = "RT-00000000-0000-4000-8000-000000000001";
            expect(
                (await starteReleaseTest(optionen(u, spur, { ...extra, volltest: "tor", freigabe: kennung }))).status,
            ).toBe("fehler");
            expect(
                (await starteReleaseTest(optionen(u, spur, { ...extra, volltest: "tor", wiederholen: true }))).status,
            ).toBe("fehler");
            expect(
                (await starteReleaseTest(optionen(u, spur, { ...extra, volltest: "alles" as VolltestTeil }))).status,
            ).toBe("fehler");
            expect(spur.runner).toEqual([]);
        }, 60_000);
    });

    it("eine rote Notiz auf Origin ohne Ordner: ausdrücklicher Start; eine Altnotiz des früheren Sammellaufs zählt nicht", async () => {
        const u = uebung();
        u.notiere("sammellauf", `${u.sha} 2026-10-23T10:30:00.000Z rot\nLauf fehlgeschlagen: tests: Exit 1\n`);
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur));
        expect(ergebnis.status).toBe("gestartet");
        expect(ergebnis.verschoben).toBeUndefined();

        const v = uebung();
        v.notiere(
            "sammellauf",
            `${v.sha} 2026-10-20T03:03:31.370Z rot\nSammellauf (WI-0228): vor-dem-push --voll rot (Exit 1)\n`,
        );
        expect((await starteReleaseTest(optionen(v, spur))).status).toBe("gestartet");
    }, 90_000);

    it("ein überschriebener Auftrag („abgebrochen“) ist kein offener Auftrag", async () => {
        const u = uebung();
        u.notiere("release-auftrag", zeile(u.sha, "auftrag", "2026-10-23T10:00:00Z"));
        u.notiere("release-auftrag", zeile(u.sha, "abgebrochen", "2026-10-23T11:00:00Z"));
        const spur: Spur = { fixtures: [], runner: [] };
        expect((await starteReleaseTest(ohneCommit(optionen(u, spur)))).status).toBe("kein-auftrag");
        expect(spur).toEqual(leer);
    }, 90_000);

    it("eine unbekannte SHA endet mit einem Satz, ohne Testpaket, ohne Lauf, ohne Änderung am Klon", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const unbekannt = "1234567890abcdef1234567890abcdef12345678";
        const ergebnis = await starteReleaseTest(optionen(u, spur, { commit: unbekannt }));
        expect(ergebnis).toMatchObject({ status: "fehler", sha: unbekannt });
        expect(ergebnis.grund).toContain("nicht in origin/master");
        expect(spur).toEqual(leer);
        expect(existsSync(join(u.klon, ".release-runs"))).toBe(false);
    }, 90_000);

    it("ein Stand außerhalb von origin/master startet nichts", async () => {
        const u = uebung();
        git(arbeit, "checkout", "--quiet", "-b", `nebenzweig-${String(nummer)}`);
        git(arbeit, "commit", "--quiet", "--allow-empty", "-m", "nur im Nebenzweig");
        const fremd = git(arbeit, "rev-parse", "HEAD");
        git(arbeit, "push", "--quiet", "origin", `nebenzweig-${String(nummer)}`);
        git(arbeit, "checkout", "--quiet", "master");
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { commit: fremd }));
        expect(ergebnis.status).toBe("fehler");
        expect(ergebnis.grund).toContain("nicht in origin/master");
        expect(spur).toEqual(leer);
    }, 90_000);

    it("eine unvollständige SHA wird abgelehnt, ehe etwas geschieht", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { commit: "abc123" }));
        expect(ergebnis.status).toBe("fehler");
        expect(ergebnis.grund).toContain("40 Hexziffern");
        expect(spur).toEqual(leer);
    }, 60_000);

    it("ein unerreichbares Origin ist ein Fehler im Protokoll, kein Start und kein Rückgriff auf alte Notizen", async () => {
        const u = uebung();
        u.notiere("release-auftrag", zeile(u.sha));
        const spur: Spur = { fixtures: [], runner: [] };
        const ohne = ohneCommit(optionen(u, spur));
        expect((await starteReleaseTest({ ...ohne, trocken: true })).status).toBe("trocken");
        git(u.klon, "remote", "set-url", "origin", join(wurzel, "gibt-es-nicht.git"));
        const ergebnis = await starteReleaseTest(ohne);
        expect(ergebnis.status).toBe("fehler");
        expect(spur).toEqual(leer);
        expect(protokollZeilen(u.daten).join("\n")).toContain("Notizen nicht geholt");
    }, 90_000);

    it("ein Runner ohne Status ist ein Fehler mit Hinweis", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(
            optionen(u, spur, { starteRunner: () => Promise.resolve(99), statusWarteMs: 1200 }),
        );
        expect(ergebnis.status).toBe("fehler");
        expect(ergebnis.grund).toContain("kein Status");
    }, 90_000);

    it("trocken entscheidet nur und startet nichts", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { trocken: true }));
        expect(ergebnis.status).toBe("trocken");
        expect(spur).toEqual(leer);
        expect(protokollZeilen(u.daten)).toEqual([]);
    }, 90_000);

    describe("🔴 Rote Teile wiederholen (WI-0248)", () => {
        /** Der Lauf hört auf: Status, Teile (grün mit Beleg des Rohberichts, rot ohne), Sperre weg, wie es der Runner am Ende tut. */
        function beendeMitTeilen(
            klon: string,
            sha: string,
            status: string,
            teile: { gruen: string[]; rot: string[] },
        ): void {
            const ordner = join(klon, ".release-runs", sha);
            const eintraege: Record<string, unknown>[] = [];
            for (const klasse of teile.gruen) {
                const datei = join(ordner, BELEG_DATEI[klasse] as string);
                writeFileSync(datei, JSON.stringify({ klasse, bericht: "grün" }));
                eintraege.push({ sha, klasse, status: "gruen", exit: 0, beleg: fingerprint(datei) });
            }
            for (const klasse of teile.rot) {
                writeFileSync(join(ordner, BELEG_DATEI[klasse] as string), JSON.stringify({ klasse, bericht: "rot" }));
                eintraege.push({ sha, klasse, status: "rot", exit: 1 });
            }
            const alt = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8")) as Record<string, unknown>;
            writeFileSync(
                join(ordner, "status.json"),
                JSON.stringify({
                    ...alt,
                    sha,
                    status,
                    umgebung: "e".repeat(64),
                    ende: new Date().toISOString(),
                    teile: eintraege,
                }),
            );
            rmSync(join(klon, ".release-runs", "aktiv"), { recursive: true, force: true });
        }
        /** Optionen für die Wiederholung; merkt sich, mit welchem früheren Lauf der Runner gestartet wird. */
        function wiederholung(
            u: { sha: string; klon: string; daten: string },
            spur: Spur,
            gemerkt: { uebernehmen?: string | undefined },
            zusatz: Partial<StartOptionen> = {},
        ): StartOptionen {
            const basis = optionen(u, spur);
            return {
                ...basis,
                wiederholen: true,
                starteRunner: (sha, fixtures, uebernehmen) => {
                    gemerkt.uebernehmen = uebernehmen;
                    return basis.starteRunner?.(sha, fixtures) ?? Promise.resolve(undefined);
                },
                ...zusatz,
            };
        }

        it("ohne früheren Lauf gibt es nichts zu wiederholen: nichts gebaut, nichts gestartet, ein Satz im Protokoll", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            const e = await starteReleaseTest(wiederholung(u, spur, {}));
            expect(e.status).toBe("kein-roter-lauf");
            expect(e.sha).toBe(u.sha);
            expect(e.grund).toContain("nichts zu wiederholen");
            expect(spur).toEqual(leer);
            expect(protokollZeilen(u.daten).join("\n")).toContain("nichts zu wiederholen");
        }, 90_000);

        it("nach einem roten Lauf: Der alte Ordner wird umbenannt, der Runner bekommt seinen Namen, die übernehmbaren Teile werden genannt", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
            beendeMitTeilen(u.klon, u.sha, "rot", { gruen: ["voll", "browser-2"], rot: ["browser-1"] });
            const gemerkt: { uebernehmen?: string | undefined } = {};
            const e = await starteReleaseTest(wiederholung(u, spur, gemerkt));
            expect(e.status).toBe("gestartet");
            expect(e.verschoben).toMatch(new RegExp(`^${u.sha}-\\d{8}T\\d{6}Z`));
            expect(gemerkt.uebernehmen).toBe(e.verschoben);
            expect(e.wiederholt).toEqual({ von: e.verschoben, uebernehmbar: ["voll", "browser-2"] });
            expect(e.grund).toContain("(Wiederholung)");
            // Der frühere Lauf liegt unter dem neuen Namen, samt Rohberichten; <sha> gehört dem neuen Lauf.
            expect(existsSync(join(u.klon, ".release-runs", e.verschoben ?? "?", "browser-2.json"))).toBe(true);
            expect(JSON.parse(readFileSync(join(u.klon, ".release-runs", u.sha, "status.json"), "utf8")).status).toBe(
                "laeuft",
            );
            expect(protokollZeilen(u.daten).join("\n")).toContain(
                `Wiederholung für ${u.sha.slice(0, 12)} von ${e.verschoben ?? "?"}`,
            );
            expect(spur.fixtures).toEqual([u.sha, u.sha]);
        }, 120_000);

        it("trocken nennt, was sich übernehmen ließe, und ändert nichts", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
            beendeMitTeilen(u.klon, u.sha, "rot", { gruen: ["browser-3"], rot: ["voll"] });
            const e = await starteReleaseTest(wiederholung(u, spur, {}, { trocken: true }));
            expect(e.status).toBe("trocken");
            expect(e.wiederholt).toEqual({ von: u.sha, uebernehmbar: ["browser-3"] });
            expect(e.grund).toContain("wiederholen");
            expect(e.grund).toContain("browser-3");
            expect(spur.fixtures).toEqual([u.sha]);
            expect(existsSync(join(u.klon, ".release-runs", u.sha, "status.json"))).toBe(true);
            expect(readdirSync(join(u.klon, ".release-runs")).filter((n) => n.startsWith(`${u.sha}-`))).toEqual([]);
        }, 120_000);

        it("ein grüner Stand wird nicht wiederholt; neben einem aktiven Lauf startet nichts", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
            // Der Lauf läuft noch (Sperre da): nichts zu wiederholen, ein Lauf ist aktiv.
            expect((await starteReleaseTest(wiederholung(u, spur, {}, { lebtRunner: () => true }))).status).toBe(
                "laeuft",
            );
            beendeMitTeilen(u.klon, u.sha, "gruen", { gruen: ["voll"], rot: [] });
            expect((await starteReleaseTest(wiederholung(u, spur, {}))).status).toBe("gruen");
            expect(spur.runner).toEqual([u.sha]);
        }, 120_000);

        it("liegt der frühere Lauf schon unter einem umbenannten Namen, wird er nicht noch einmal verschoben", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
            beendeMitTeilen(u.klon, u.sha, "abgebrochen", { gruen: ["voll"], rot: [] });
            const name = archiviereLauf(join(u.klon, ".release-runs"), u.sha, Date.parse("2026-10-24T01:00:00.000Z"));
            const gemerkt: { uebernehmen?: string | undefined } = {};
            const e = await starteReleaseTest(wiederholung(u, spur, gemerkt));
            expect(e.status).toBe("gestartet");
            expect(gemerkt.uebernehmen).toBe(name);
            expect(e.verschoben).toBeUndefined();
            expect(e.wiederholt).toEqual({ von: name, uebernehmbar: ["voll"] });
        }, 120_000);

        it("ein Lauf mit Status „läuft“ ohne Sperre (abgestürzt) ist ein früherer, nicht grüner Lauf", async () => {
            const u = uebung();
            const spur: Spur = { fixtures: [], runner: [] };
            expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
            rmSync(join(u.klon, ".release-runs", "aktiv"), { recursive: true, force: true });
            const gemerkt: { uebernehmen?: string | undefined } = {};
            const e = await starteReleaseTest(wiederholung(u, spur, gemerkt));
            expect(e.status).toBe("gestartet");
            expect(gemerkt.uebernehmen).toBe(e.verschoben);
            expect(e.wiederholt?.uebernehmbar).toEqual([]);
        }, 120_000);
    });

    it("beim allerersten Mal fehlt der Werkzeugklon: Er wird aus der Quelle angelegt (Remote, Identität), dann geht es weiter", async () => {
        const u = uebung();
        const neu = join(wurzel, `neuer-klon-${String(nummer)}`);
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { klon: neu, trocken: true }));
        expect(ergebnis.status).toBe("trocken");
        expect(existsSync(join(neu, ".git"))).toBe(true);
        expect(git(neu, "remote", "get-url", "origin")).toBe(git(arbeit, "remote", "get-url", "origin"));
        expect(git(neu, "config", "--get", "user.name")).toBe("Quelle");
        expect(git(neu, "config", "--get", "user.email")).toBe("quelle@avesmaps3d.local");
        expect(protokollZeilen(u.daten).join("\n")).toContain("Werkzeugklon angelegt");
        // Derselbe Aufruf mit angelegtem Klon legt nichts mehr an.
        expect((await starteReleaseTest(optionen(u, spur, { klon: neu, trocken: true }))).status).toBe("trocken");
        expect(protokollZeilen(u.daten).filter((z) => z.includes("Werkzeugklon angelegt"))).toHaveLength(1);
    }, 120_000);

    it("ein vorhandener Ordner ohne Git wird nie als Klon überschrieben", async () => {
        const u = uebung();
        const fremd = join(wurzel, `fremd-${String(nummer)}`);
        mkdirSync(fremd);
        writeFileSync(join(fremd, "wichtig.txt"), "bleibt");
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { klon: fremd }));
        expect(ergebnis.status).toBe("fehler");
        expect(ergebnis.grund).toContain("kein Git-Klon");
        expect(readFileSync(join(fremd, "wichtig.txt"), "utf8")).toBe("bleibt");
    }, 60_000);

    it("die Kommandozeile: unbekannte SHA endet mit Exit 1 und einer Zeile; --stand liest nur; --commit ohne Wert wird abgelehnt", () => {
        const u = uebung();
        const skript = fileURLToPath(new URL("../../../scripts/dev/release-abholer.ts", import.meta.url));
        const lauf = (...argumente: string[]): { status: number | null; ausgabe: string; fehler: string } => {
            const r = spawnSync(process.execPath, [skript, ...argumente, "--daten", u.daten, "--klon", u.klon], {
                encoding: "utf8",
                env: { ...process.env, ...IDENTITAET },
                timeout: 60_000,
                windowsHide: true,
            });
            return { status: r.status, ausgabe: r.stdout, fehler: r.stderr };
        };
        const unbekannt = lauf("--commit", "1234567890abcdef1234567890abcdef12345678");
        expect(unbekannt.status).toBe(1);
        expect(unbekannt.ausgabe.trim().split("\n")).toHaveLength(1);
        expect(unbekannt.ausgabe).toMatch(/^fehler: .*nicht in origin\/master/);
        const stand = lauf("--stand");
        expect(stand.status).toBe(0);
        expect(stand.ausgabe.trim()).toBe("keiner");
        const ohneWert = lauf("--commit");
        expect(ohneWert.status).toBe(1);
        expect(ohneWert.fehler).toContain("--commit benötigt eine SHA");
        const keinAuftrag = lauf();
        expect(keinAuftrag.status).toBe(1);
        expect(keinAuftrag.ausgabe).toMatch(/^kein-auftrag: /);
    }, 120_000);

    it("die Kommandozeile: --wiederholen braucht eine SHA; für eine SHA ohne früheren Lauf endet sie mit „kein-roter-lauf“ und Exit 1", () => {
        const u = uebung();
        const skript = fileURLToPath(new URL("../../../scripts/dev/release-abholer.ts", import.meta.url));
        const lauf = (...argumente: string[]): { status: number | null; ausgabe: string; fehler: string } => {
            const r = spawnSync(process.execPath, [skript, ...argumente, "--daten", u.daten, "--klon", u.klon], {
                encoding: "utf8",
                env: { ...process.env, ...IDENTITAET },
                timeout: 60_000,
                windowsHide: true,
            });
            return { status: r.status, ausgabe: r.stdout, fehler: r.stderr };
        };
        const ohneWert = lauf("--wiederholen");
        expect(ohneWert.status).toBe(1);
        expect(ohneWert.fehler).toContain("--wiederholen benötigt eine SHA");
        const json = lauf("--wiederholen", u.sha, "--trocken", "--json");
        expect(json.status).toBe(1);
        const antwort = JSON.parse(json.ausgabe.trim().split("\n").at(-1) ?? "{}") as {
            status?: string;
            sha?: string;
            grund?: string;
        };
        expect(antwort).toMatchObject({ status: "kein-roter-lauf", sha: u.sha });
        expect(antwort.grund).toContain("nichts zu wiederholen");
    }, 120_000);

    it("🔴 liest den Kandidaten aus den Notizen (jüngster Stage-Stand, jüngster Auftrag) und holt nur Notizen", () => {
        const u = uebung();
        expect(leseKandidat(u.klon)).toEqual({ stage: null, auftrag: null });
        u.notiere("stage", `${u.sha} 2026-10-23T08:00:00Z stage`);
        u.notiere("release-auftrag", zeile(u.sha, "auftrag", "2026-10-23T09:00:00Z", "OPS-000555"));
        expect(leseKandidat(u.klon)).toEqual({
            stage: { sha: u.sha, zeit: "2026-10-23T08:00:00Z" },
            auftrag: { sha: u.sha, zeit: "2026-10-23T09:00:00Z", ops: "OPS-000555" },
        });
        // Der Vertrag mit dem Server: Der Kandidat erfüllt `ReleaseTestKandidat` ohne Nacharbeit.
        expect(Value.Check(ReleaseTestKandidat, leseKandidat(u.klon))).toBe(true);
        // Nur Notizen wurden geholt: Zweig und Arbeitskopie des Klons sind unverändert.
        expect(git(u.klon, "status", "--porcelain")).toBe("");
        expect(git(u.klon, "rev-parse", "HEAD")).toBe(git(u.klon, "rev-parse", "origin/master"));
        // Ein überschriebener Auftrag („abgebrochen“) ist kein Kandidat mehr, der Stage-Stand bleibt.
        u.notiere("release-auftrag", zeile(u.sha, "abgebrochen", "2026-10-23T09:30:00Z", "OPS-000555"));
        expect(leseKandidat(u.klon)).toEqual({ stage: { sha: u.sha, zeit: "2026-10-23T08:00:00Z" }, auftrag: null });
    }, 60_000);

    it("--kandidat --json: EINE JSON-Zeile mit stage und auftrag; ohne Netz zum Origin ein Fehler mit Satz und Exit 1", () => {
        const u = uebung();
        u.notiere("stage", `${u.sha} 2026-10-23T08:00:00Z stage`);
        const skript = fileURLToPath(new URL("../../../scripts/dev/release-abholer.ts", import.meta.url));
        const lauf = (klon: string, ...zusatz: string[]): { status: number | null; ausgabe: string } => {
            const r = spawnSync(
                process.execPath,
                [skript, "--kandidat", ...zusatz, "--daten", u.daten, "--klon", klon],
                {
                    encoding: "utf8",
                    env: { ...process.env, ...IDENTITAET },
                    timeout: 60_000,
                    windowsHide: true,
                },
            );
            return { status: r.status, ausgabe: r.stdout };
        };
        const gut = lauf(u.klon, "--json");
        expect(gut.status).toBe(0);
        expect(gut.ausgabe.trim().split("\n")).toHaveLength(1);
        expect(JSON.parse(gut.ausgabe)).toEqual({ stage: { sha: u.sha, zeit: "2026-10-23T08:00:00Z" }, auftrag: null });
        const text = lauf(u.klon);
        expect(text.ausgabe).toContain(`Stage: ${u.sha} (2026-10-23T08:00:00Z)`);
        expect(text.ausgabe).toContain("Auftrag: keiner");
        // Ein Klon, dessen Origin nicht mehr da ist: ein Satz statt eines Absturzes.
        const kaputt = join(wurzel, `kaputt-${String(nummer)}`);
        git(wurzel, "clone", "--quiet", origin, kaputt);
        git(kaputt, "remote", "set-url", "origin", join(wurzel, "gibt-es-nicht.git"));
        const schlecht = lauf(kaputt, "--json");
        expect(schlecht.status).toBe(1);
        expect(JSON.parse(schlecht.ausgabe)).toEqual({ fehler: expect.stringContaining("Notizen nicht geholt") });
    }, 120_000);

    // ───── Der Startvermerk (Fehlerbehebung 2026-10-23): Der Stand eines Starts steht in einer Datei, nicht im Speicher des Servers ─────

    const vermerkDatei = (daten: string, sha: string): string => join(startvermerkOrdner(daten), `${sha}.json`);
    const vermerkLesen = (daten: string, sha: string): Record<string, unknown> =>
        JSON.parse(readFileSync(vermerkDatei(daten, sha), "utf8")) as Record<string, unknown>;
    const ansichtVon = (u: { klon: string; daten: string }, zusatz = {}) =>
        releaseTestAnsicht(undefined, { klon: u.klon, daten: u.daten, lebtRunner: () => true, ...zusatz });

    it("🔴 der Start führt seinen Vermerk: baut mit der Prozessnummer, solange das Testpaket gebaut wird; danach gestartet (und dann zählt er nicht mehr)", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        let mitten: Record<string, unknown> | undefined;
        let ansichtMitten: ReturnType<typeof releaseTestAnsicht> | undefined;
        const ergebnis = await starteReleaseTest(
            optionen(u, spur, {
                baueFixtures: (sha) => {
                    mitten = vermerkLesen(u.daten, sha);
                    ansichtMitten = ansichtVon(u);
                    return Promise.resolve(join(u.daten, "release-fixtures", sha));
                },
            }),
        );
        expect(ergebnis).toMatchObject({ status: "gestartet", startvermerk: true });
        expect(mitten).toMatchObject({ sha: u.sha, zustand: "baut", grund: null, pid: process.pid });
        expect(ansichtMitten?.startvorgang).toMatchObject({ commit: u.sha, zustand: "baut", grund: null });
        expect(vermerkLesen(u.daten, u.sha)).toMatchObject({ zustand: "gestartet", pid: process.pid });
        expect(vermerkLesen(u.daten, u.sha)["grund"]).toContain("gestartet");
        // Gestartet zählt nicht: Dann steht der Lauf da.
        expect(ansichtVon(u).startvorgang).toBeUndefined();
        // Keine Hilfsdatei bleibt liegen.
        expect(readdirSync(startvermerkOrdner(u.daten))).toEqual([`${u.sha}.json`]);
        // Der Vertrag mit dem Server.
        expect(Value.Check(ReleaseTestStartvorgang, ansichtMitten?.startvorgang)).toBe(true);
    }, 90_000);

    it("🔴 ein gescheiterter Start steht als Fehler mit Grund in der Ansicht, neben dem alten Lauf; ein gelungener nimmt ihn wieder weg", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        beende(u.klon, u.sha, "rot", "alter Befund");
        const gescheitert = await starteReleaseTest(
            optionen(u, spur, { baueFixtures: () => Promise.reject(new Error("kein Platz auf dem Laufwerk")) }),
        );
        expect(gescheitert.status).toBe("fehler");
        expect(vermerkLesen(u.daten, u.sha)).toMatchObject({ zustand: "fehler" });
        const ansicht = ansichtVon(u);
        // Der alte Lauf bleibt als Lauf stehen; der Fehler des Starts kommt dazu und gehört dem Start, nicht dem Lauf.
        expect(ansicht.zustand).toBe("rot");
        expect(ansicht.startvorgang).toMatchObject({ commit: u.sha, zustand: "fehler" });
        expect(ansicht.startvorgang?.grund).toContain("kein Platz auf dem Laufwerk");
        expect(Value.Check(ReleaseTestStartvorgang, ansicht.startvorgang)).toBe(true);
        expect([...Value.Errors(ReleaseTestLauf, ansicht)]).toEqual([]);
        // Der nächste Versuch gelingt: Der Fehler ist weg.
        expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gestartet");
        expect(ansichtVon(u).startvorgang).toBeUndefined();
    }, 120_000);

    it("ein Start, der abgewiesen wird (Sperre eines Laufs), und ein grüner Stand hinterlassen keinen Fehler", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        await starteReleaseTest(optionen(u, spur));
        const zweiter = await starteReleaseTest(optionen(u, spur, { lebtRunner: () => true }));
        expect(zweiter.status).toBe("laeuft");
        expect(vermerkLesen(u.daten, u.sha)["zustand"]).toBe("gestartet");
        expect(ansichtVon(u).startvorgang).toBeUndefined();
        beende(u.klon, u.sha, "gruen");
        expect((await starteReleaseTest(optionen(u, spur))).status).toBe("gruen");
        expect(ansichtVon(u).startvorgang).toBeUndefined();
    }, 120_000);

    it("🔴 ein Start, dessen Starter beendet wurde, bleibt nicht auf „baut“ stehen: Ohne lebenden Prozess ist er gescheitert, mit Hinweis auf die Ausgabe", () => {
        const u = uebung();
        const tot = spawnSync(process.execPath, ["-e", ""], { windowsHide: true }).pid;
        expect(tot).toBeGreaterThan(0);
        expect(lebtPid(tot)).toBe(false);
        expect(lebtPid(process.pid)).toBe(true);
        const jetzt = Date.now();
        schreibeStartvermerk(u.daten, {
            sha: u.sha,
            seit: new Date(jetzt - 60_000).toISOString(),
            zustand: "baut",
            grund: null,
            pid: tot,
        });
        const vorgang = leseStartvorgang({ klon: u.klon, daten: u.daten, jetzt: () => jetzt });
        expect(vorgang).toMatchObject({ commit: u.sha, zustand: "fehler" });
        expect(vorgang?.grund).toContain("beendet");
        expect(vorgang?.grund).toContain(`starter-${u.sha.slice(0, 12)}.log`);
        // Die Datei selbst wurde dabei nicht verändert (lesen heißt lesen).
        expect(vermerkLesen(u.daten, u.sha)["zustand"]).toBe("baut");
        // Lebt der Starter noch, baut er; und über der Zeitgrenze gilt auch ein lebender als gescheitert (Prozessnummern werden wiederverwendet).
        expect(
            leseStartvorgang({ klon: u.klon, daten: u.daten, jetzt: () => jetzt, lebtStarter: () => true }),
        ).toMatchObject({
            zustand: "baut",
        });
        const spaet = leseStartvorgang({
            klon: u.klon,
            daten: u.daten,
            jetzt: () => jetzt + STARTVERMERK_MAX_MS,
            lebtStarter: () => true,
        });
        expect(spaet).toMatchObject({ zustand: "fehler" });
        expect(spaet?.grund).toContain("Zeitgrenze");
    });

    it("🔴 neben einem lebenden Start startet kein zweiter, auch nicht trocken; ein toter Start steht nicht im Weg", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const fremd = {
            sha: "f".repeat(40),
            seit: new Date().toISOString(),
            zustand: "baut" as const,
            grund: null,
            pid: 987_654,
        };
        schreibeStartvermerk(u.daten, fremd);
        const lebend = { lebtStarter: () => true };
        for (const trocken of [false, true]) {
            const ergebnis = await starteReleaseTest(optionen(u, spur, { ...lebend, trocken }));
            expect(ergebnis).toMatchObject({ status: "laeuft", sha: u.sha });
            expect(ergebnis.grund).toContain("fffffffffff");
        }
        expect(spur).toEqual(leer);
        // Der abgewiesene Start hat keinen eigenen Vermerk angelegt und den fremden nicht angefasst.
        expect(existsSync(vermerkDatei(u.daten, u.sha))).toBe(false);
        expect(vermerkLesen(u.daten, fremd.sha)).toMatchObject({ zustand: "baut", pid: 987_654 });
        // Ist der fremde Starter tot, geht es weiter.
        const frei = await starteReleaseTest(optionen(u, spur, { lebtStarter: () => false }));
        expect(frei.status).toBe("gestartet");
        // Der eigene frühere Vermerk derselben SHA stört nicht (er wird ersetzt).
        expect(vermerkLesen(u.daten, u.sha)["zustand"]).toBe("gestartet");
    }, 120_000);

    it("trocken legt keinen Vermerk an und kennzeichnet den Starter als einen mit Startvermerk", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(optionen(u, spur, { trocken: true }));
        expect(ergebnis).toMatchObject({ status: "trocken", startvermerk: true });
        expect(existsSync(startvermerkOrdner(u.daten))).toBe(false);
    }, 90_000);

    it("die Zeitgrenze und ein Absturz schließen den offenen Vermerk als Fehler; danach überschreibt ihn das späte Ende des Kerns nicht", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        const ergebnis = await starteReleaseTest(
            optionen(u, spur, {
                baueFixtures: () => {
                    schliesseOffenenStartvermerk("Zeitgrenze erreicht, Starter beendet");
                    return Promise.reject(new Error("beendet"));
                },
            }),
        );
        expect(ergebnis.status).toBe("fehler");
        expect(vermerkLesen(u.daten, u.sha)).toMatchObject({
            zustand: "fehler",
            grund: "Zeitgrenze erreicht, Starter beendet",
        });
        // Ohne offenen Vermerk tut der Aufruf nichts.
        expect(() => schliesseOffenenStartvermerk("nochmal")).not.toThrow();
        expect(vermerkLesen(u.daten, u.sha)["grund"]).toBe("Zeitgrenze erreicht, Starter beendet");
    }, 90_000);

    it("ohne --commit steht der Vermerk, sobald der Auftrag die SHA nennt; ohne Auftrag legt der Aufruf keinen an", async () => {
        const u = uebung();
        const spur: Spur = { fixtures: [], runner: [] };
        expect((await starteReleaseTest(ohneCommit(optionen(u, spur)))).status).toBe("kein-auftrag");
        expect(existsSync(startvermerkOrdner(u.daten))).toBe(false);
        u.notiere("release-auftrag", zeile(u.sha, "auftrag", "2026-10-23T10:00:00Z", "OPS-000778"));
        expect((await starteReleaseTest(ohneCommit(optionen(u, spur)))).status).toBe("gestartet");
        expect(vermerkLesen(u.daten, u.sha)["zustand"]).toBe("gestartet");
    }, 120_000);

    it("🔴 die Kommandozeile liefert den Start mit --stand --json (startvorgang), ohne ihn dem Lauf zu geben, den es nicht gibt", () => {
        const u = uebung();
        const skript = fileURLToPath(new URL("../../../scripts/dev/release-abholer.ts", import.meta.url));
        const stand = (): Record<string, unknown> => {
            const r = spawnSync(process.execPath, [skript, "--stand", "--json", "--daten", u.daten, "--klon", u.klon], {
                encoding: "utf8",
                timeout: 60_000,
                windowsHide: true,
            });
            expect(r.status).toBe(0);
            return JSON.parse(r.stdout) as Record<string, unknown>;
        };
        expect(stand()["startvorgang"]).toBeUndefined();
        schreibeStartvermerk(u.daten, {
            sha: u.sha,
            seit: new Date().toISOString(),
            zustand: "fehler",
            grund: "Testpaket nicht gebaut (Exit 1): kein Platz",
            pid: 1,
        });
        const mit = stand();
        expect(mit["zustand"]).toBe("keiner");
        expect(mit["startvorgang"]).toMatchObject({ commit: u.sha, zustand: "fehler" });
        expect([...Value.Errors(ReleaseTestLauf, mit)]).toEqual([]);
    }, 120_000);
});

describe("Startvermerke lesen", () => {
    let daten = "";
    let klon = "";
    const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
    beforeAll(() => {
        daten = mkdtempSync(join(tmpdir(), "abholer-vermerk-daten-"));
        klon = mkdtempSync(join(tmpdir(), "abholer-vermerk-klon-"));
    });
    afterAll(() => {
        rmSync(daten, { recursive: true, force: true });
        rmSync(klon, { recursive: true, force: true });
    });
    const vermerk = (
        sha: string,
        ms: number,
        zustand: "baut" | "gestartet" | "fehler",
        grund: string | null = null,
    ) => ({
        sha,
        seit: new Date(ms).toISOString(),
        zustand,
        grund,
        pid: 4711,
    });
    const lese = (extra: Partial<Parameters<typeof leseStartvorgang>[0]> = {}) =>
        leseStartvorgang({ daten, klon, jetzt: () => T0 + 60_000, lebtStarter: () => true, ...extra });
    const leeren = (): void => {
        rmSync(startvermerkOrdner(daten), { recursive: true, force: true });
        rmSync(join(klon, ".release-runs"), { recursive: true, force: true });
    };

    it("ohne Vermerke nichts; der jüngste gewinnt; Kaputtes, Fremdes und ein Name, der nicht zur SHA passt, zählen nicht", () => {
        leeren();
        expect(lese()).toBeUndefined();
        expect(leseStartvermerke(daten)).toEqual([]);
        schreibeStartvermerk(daten, vermerk(A, T0, "fehler", "alt"));
        schreibeStartvermerk(daten, vermerk(B, T0 + 5_000, "fehler", "neu"));
        const ordner = startvermerkOrdner(daten);
        writeFileSync(join(ordner, `${C}.json`), "{ kaputt");
        writeFileSync(join(ordner, "notizen.json"), "{}");
        writeFileSync(
            join(ordner, `${"d".repeat(40)}.json`),
            JSON.stringify(vermerk(A, T0 + 9_000, "fehler", "falscher Name")),
        );
        writeFileSync(
            join(ordner, `${"e".repeat(40)}.json`),
            JSON.stringify({ ...vermerk("e".repeat(40), T0, "baut"), zustand: "was" }),
        );
        expect(leseStartvermerke(daten).map((v) => v.sha)).toEqual([B, A]);
        expect(lese()).toMatchObject({ commit: B, zustand: "fehler", grund: "neu" });
    });

    it("ein Start, der VOR dem Start des jüngsten Laufs liegt, ist erledigt; ein späterer gilt", () => {
        leeren();
        schreibeStartvermerk(daten, vermerk(A, T0 + 10_000, "fehler", "Testpaket nicht gebaut"));
        const laufOrdner = join(klon, ".release-runs", B);
        mkdirSync(laufOrdner, { recursive: true });
        writeFileSync(
            join(laufOrdner, "status.json"),
            JSON.stringify({ status: "rot", start: new Date(T0 + 20_000).toISOString() }),
        );
        expect(lese()).toBeUndefined();
        writeFileSync(
            join(laufOrdner, "status.json"),
            JSON.stringify({ status: "rot", start: new Date(T0 + 5_000).toISOString() }),
        );
        expect(lese()).toMatchObject({ commit: A, zustand: "fehler" });
    });

    it("liest nur: kein Ordner, keine Datei, keine Änderung", () => {
        leeren();
        expect(lese()).toBeUndefined();
        expect(existsSync(startvermerkOrdner(daten))).toBe(false);
        expect(existsSync(join(klon, ".release-runs"))).toBe(false);
    });
});

// ───────────── Kandidat, Ansicht und Abbruch für die lokale Oberfläche (WI-0248 L) ─────────────

describe("Stage-Stand wählen", () => {
    const stage = (sha: string, zeit: string, art = "stage"): string => `${sha} ${zeit} ${art}`;

    it("nimmt die jüngste gültige Notiz, bei gleicher Zeit die größere SHA", () => {
        expect(
            waehleStage([
                { objekt: A, text: stage(A, "2026-10-23T08:00:00Z") },
                { objekt: C, text: stage(C, "2026-10-23T10:00:00Z") },
                { objekt: B, text: stage(B, "2026-10-23T09:00:00Z") },
            ]),
        ).toEqual({ sha: C, zeit: "2026-10-23T10:00:00Z" });
        expect(
            waehleStage([
                { objekt: A, text: stage(A, "2026-10-23T08:00:00Z") },
                { objekt: B, text: stage(B, "2026-10-23T08:00:00Z") },
            ])?.sha,
        ).toBe(B);
    });

    it("ignoriert andere Arten, kaputte Zeilen, unlesbare Zeiten und eine SHA, die nicht zum Commit der Notiz passt", () => {
        expect(
            waehleStage([
                { objekt: A, text: stage(A, "2026-10-23T10:00:00Z", "gruen") },
                { objekt: B, text: "kaputt" },
                { objekt: C, text: stage(C, "gestern") },
                { objekt: A, text: stage(B, "2026-10-23T10:00:00Z") },
            ]),
        ).toBeUndefined();
        expect(waehleStage([])).toBeUndefined();
    });

    it("liest nur die erste Zeile", () => {
        expect(
            waehleStage([
                { objekt: A, text: `${stage(A, "2026-10-23T08:00:00Z")}\n${stage(B, "2026-10-23T12:00:00Z")}\n` },
            ])?.sha,
        ).toBe(A);
    });
});

describe("Ansicht der Oberfläche und Abbruch", () => {
    let klon = "";
    let daten = "";
    // In der Vergangenheit: Die Anlegezeit eines Protokolls ist die frühere von Anlege- und Änderungszeit, und die Änderungszeit setzen die Tests.
    const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
    beforeAll(() => {
        klon = mkdtempSync(join(tmpdir(), "abholer-ansicht-"));
        daten = mkdtempSync(join(tmpdir(), "abholer-ansicht-daten-"));
    });
    afterAll(() => {
        rmSync(klon, { recursive: true, force: true });
        rmSync(daten, { recursive: true, force: true });
    });
    const lauf = (
        sha: string,
        status: Record<string, unknown>,
        protokolle: Record<string, number> = {},
        dateien: Record<string, string> = {},
    ): string => {
        const ordner = join(klon, ".release-runs", sha);
        mkdirSync(ordner, { recursive: true });
        writeFileSync(join(ordner, "status.json"), JSON.stringify({ start: new Date(T0).toISOString(), ...status }));
        // Erst die Dateien, dann die Änderungszeiten der Protokolle: Ein späteres Schreiben setzte sie auf jetzt zurück.
        for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt);
        for (const [name, sekunden] of Object.entries(protokolle)) {
            const pfad = join(ordner, `${name}.log`);
            if (!existsSync(pfad)) writeFileSync(pfad, `${name}\n`);
            const zeit = new Date(T0 + sekunden * 1000);
            utimesSync(pfad, zeit, zeit);
        }
        return ordner;
    };
    const sperre = (an: boolean): void => {
        const pfad = join(klon, ".release-runs", "aktiv");
        if (an) mkdirSync(pfad, { recursive: true });
        else rmSync(pfad, { recursive: true, force: true });
    };
    const D = "d".repeat(40);
    const E = "e".repeat(40);
    /** 🔴 Der Vertrag mit dem Server: Was der Starter ausgibt, erfüllt `ReleaseTestLauf` ohne Nacharbeit (der Server streift nur Fremdes ab). */
    const gueltig = (ansicht: unknown): void => {
        const fehler = [...Value.Errors(ReleaseTestLauf, ansicht)].map((e) => `${e.path}: ${e.message}`);
        expect(fehler).toEqual([]);
    };

    it("ein laufender Test: Schritte mit Zeiten, Fortschritt nach erwarteter Dauer, verbleibende Zeit; kein Pfad der Statusdatei", () => {
        const ordner = lauf(A, { status: "laeuft", ende: "" }, { installation: 60, shared: 200, lint: 220 });
        sperre(true);
        const ansicht = releaseTestAnsicht(A, { klon, daten, jetzt: () => T0 + 300_000, lebtRunner: () => true });
        gueltig(ansicht);
        expect(ansicht).toMatchObject({
            zustand: "laeuft",
            sha: A,
            schritt: expect.any(String),
            ordner,
            sperre: true,
            lebt: true,
        });
        // Ein laufender Test ohne lebenden Prozess (abgestürzt, die Sperre bleibt stehen) sagt das; ist es nicht feststellbar, fehlt die Angabe.
        expect(releaseTestAnsicht(A, { klon, daten, lebtRunner: () => false }).lebt).toBe(false);
        expect("lebt" in releaseTestAnsicht(A, { klon, daten, lebtRunner: () => undefined })).toBe(false);
        expect("statuspfad" in ansicht).toBe(false);
        expect(ansicht.schritte.map((s) => s.zustand).slice(0, 5)).toEqual([
            "fertig",
            "fertig",
            "fertig",
            "laeuft",
            "offen",
        ]);
        expect(ansicht.schritte[0]).toMatchObject({ id: "vorbereitung", dauerMs: 60_000 });
        expect(ansicht.schritte[3]).toMatchObject({ id: "lint", dauerMs: 80_000, schaetzung: true });
        expect(ansicht.erwartetSchaetzung).toBe(true);
        expect(ansicht.fortschritt).toBeGreaterThan(0);
        expect(ansicht.fortschritt).toBeLessThan(0.1);
        expect(ansicht.verbleibendMs).toBeGreaterThan(0);
        expect(ansicht.fehler).toBeUndefined();
        expect(ansicht.jetzt).toBe(new Date(T0 + 300_000).toISOString());
    });

    it("🔴 ein roter Test: der Schritt steht als fehlerhaft da, dazu Grund, rote Fälle und Protokollende ohne Zugangsdaten", () => {
        sperre(false);
        lauf(
            B,
            { status: "rot", ende: new Date(T0 + 900_000).toISOString() },
            { installation: 60, shared: 120, tests: 400 },
            {
                "fehler.txt": "tests: Exit 1\n",
                "tests.log": "läuft\nPGPASSWORD=geheim123\nFAIL a.test.ts\n",
                "vitest.json": JSON.stringify({
                    testResults: [
                        {
                            name: "/x/checkout/apps/server/test/a.test.ts",
                            status: "failed",
                            assertionResults: [
                                { status: "failed", fullName: "A rechnet", failureMessages: ["erwartet 2\nbekam 3"] },
                            ],
                        },
                    ],
                }),
            },
        );
        const ansicht = releaseTestAnsicht(B, { klon, daten });
        gueltig(ansicht);
        expect(ansicht.zustand).toBe("rot");
        expect(ansicht.schritte.find((s) => s.id === "tests")).toMatchObject({ zustand: "fehler", dauerMs: 500_000 });
        expect(ansicht.schritte.find((s) => s.id === "bau")?.zustand).toBe("offen");
        expect(ansicht.verbleibendMs).toBeUndefined();
        expect(ansicht.fehler).toEqual({
            schritt: "tests",
            grund: "tests: Exit 1",
            faelle: [
                {
                    datei: "apps/server/test/a.test.ts",
                    name: "[rot] A rechnet",
                    meldung: ["erwartet 2", "bekam 3"],
                    teil: "tests",
                    teilName: "Alle Tests",
                },
            ],
            faelleGesamt: 1,
            protokollEnde: ["läuft", "PGPASSWORD=<verborgen>", "FAIL a.test.ts"],
        });
        expect(ansicht.grund).toContain("tests: Exit 1");
    });

    it("ein abgebrochener Lauf nennt den zuletzt begonnenen Schritt; grün ist 100 % und hat keinen Bericht", () => {
        sperre(false);
        lauf(
            D,
            { status: "abgebrochen", ende: new Date(T0 + 200_000).toISOString() },
            { installation: 30, shared: 100 },
        );
        const abgebrochen = releaseTestAnsicht(D, { klon, daten });
        gueltig(abgebrochen);
        expect(abgebrochen.zustand).toBe("abgebrochen");
        expect(abgebrochen.fehler).toMatchObject({ schritt: "shared", faelleGesamt: 0 });
        expect(abgebrochen.fehler?.grund).toContain("abgebrochen");
        expect(abgebrochen.schritte.find((s) => s.id === "shared")?.zustand).toBe("fehler");

        // Der jüngste Lauf (Start 10 s nach den anderen): Seine Dauern gelten als gemessen.
        lauf(
            E,
            {
                status: "gruen",
                start: new Date(T0 + 10_000).toISOString(),
                ende: new Date(T0 + 1000_000).toISOString(),
            },
            { installation: 30, shared: 100 },
        );
        const gruen = releaseTestAnsicht(E, { klon, daten });
        gueltig(gruen);
        expect(gruen).toMatchObject({ zustand: "gruen", fortschritt: 1 });
        expect(gruen.fehler).toBeUndefined();
        expect(gruen.verbleibendMs).toBeUndefined();
        // Die Erwartung nimmt den jüngsten Lauf, in dem der Schritt belegt zu Ende ging: Installation 70 s aus dem grünen Lauf E.
        expect(gruen.schritte.find((s) => s.id === "installation")).toMatchObject({
            erwartetMs: 70_000,
            schaetzung: false,
        });
    });

    it("ohne Lauf: alles offen, erwartete Gesamtdauer aus den Schätzwerten, und die Ansicht ändert nichts", () => {
        const leerKlon = mkdtempSync(join(tmpdir(), "abholer-ansicht-leer-"));
        try {
            const ansicht = releaseTestAnsicht(undefined, { klon: leerKlon, daten });
            gueltig(ansicht);
            expect(ansicht.zustand).toBe("keiner");
            expect(ansicht.schritte.every((s) => s.zustand === "offen" && s.schaetzung)).toBe(true);
            expect(ansicht.erwartetMs).toBeGreaterThan(0);
            expect(ansicht.fortschritt).toBe(0);
            expect(readdirSync(leerKlon)).toEqual([]);
        } finally {
            rmSync(leerKlon, { recursive: true, force: true });
        }
    });

    it("🔴 die Browserteile nach Thema, die Wiederholung und was sie übernahm: Zustand je Teil, übernommene Schritte, rote Fälle mit Teil, wiederholbar", () => {
        sperre(false);
        const F = "f".repeat(40);
        const buch = {
            version: 1,
            teile: [1, 2, 3, 4].map((n) => ({
                id: `browser-${String(n)}`,
                name: `Teil ${String(n)}`,
                bereiche: ["orte", "wege"],
                specs: 10 * n,
            })),
            problem: null,
            komponenten: {},
            wiederholung: {
                von: `${F}-20261024T010000Z`,
                uebernommen: ["voll", "browser-1"],
                neu: ["browser-2", "browser-3", "browser-4"],
                grund: null,
            },
            schritte: {
                lint: { status: "uebernommen" },
                format: { status: "uebernommen" },
                typen: { status: "uebernommen" },
                tests: { status: "uebernommen" },
                bau: { status: "uebernommen" },
                besucherpaket: { status: "uebernommen" },
                "browser-1": { status: "uebernommen" },
                "browser-2": { status: "gruen" },
                "browser-3": { status: "rot", grund: "Browserteil 3: 1 rot" },
            },
        };
        const bericht = (rot: number, gruen: number): string =>
            JSON.stringify({
                stats: { expected: gruen, unexpected: rot, flaky: 0, skipped: 0 },
                suites: [
                    {
                        file: "c.spec.ts",
                        title: "c.spec.ts",
                        specs: Array.from({ length: rot }, () => ({
                            title: "geht",
                            ok: false,
                            tests: [{ results: [{ status: "failed", error: { message: "boom" } }] }],
                        })),
                    },
                ],
            });
        lauf(
            F,
            {
                status: "rot",
                ende: new Date(T0 + 4000_000).toISOString(),
                teile: [
                    { sha: F, klasse: "voll", status: "gruen", exit: 0 },
                    { sha: F, klasse: "browser-1", status: "gruen", exit: 0 },
                    { sha: F, klasse: "browser-2", status: "gruen", exit: 0 },
                    { sha: F, klasse: "browser-3", status: "rot", exit: 1 },
                ],
            },
            { installation: 60, shared: 120, "browser-2": 400, "browser-3": 1600 },
            {
                "fehler.txt": "Browserteil 3 (Teil 3): 1 rot\nBrowserteil 4 (Teil 4) nicht gelaufen: Zeitgrenze",
                "teile.json": JSON.stringify(buch),
                "browser-1.json": bericht(0, 373),
                "browser-2.json": bericht(0, 435),
                "browser-3.json": bericht(1, 496),
            },
        );
        const ansicht = releaseTestAnsicht(F, { klon, daten });
        gueltig(ansicht);
        expect(ansicht.zustand).toBe("rot");
        expect(ansicht.teile?.map((x) => [x.id, x.zustand, x.uebernommen])).toEqual([
            ["browser-1", "gruen", true],
            ["browser-2", "gruen", false],
            ["browser-3", "rot", false],
            ["browser-4", "uebersprungen", false],
        ]);
        expect(ansicht.teile?.[0]).toMatchObject({
            name: "Teil 1",
            bereiche: ["orte", "wege"],
            faelle: 373,
            erwartetMs: 0,
        });
        expect(ansicht.teile?.[2]).toMatchObject({ faelle: 497, rot: 1 });
        expect(ansicht.wiederholung).toEqual(buch.wiederholung);
        expect(ansicht.wiederholbar).toBe(true);
        const zustand = (id: string): string | undefined => ansicht.schritte.find((s) => s.id === id)?.zustand;
        expect(zustand("lint")).toBe("uebernommen");
        expect(zustand("tests")).toBe("uebernommen");
        expect(zustand("browser-1")).toBe("uebernommen");
        expect(zustand("browser-2")).toBe("fertig");
        expect(zustand("browser-3")).toBe("fehler");
        expect(zustand("browser-4")).toBe("uebersprungen");
        // Übernommene Schritte tragen keine Erwartung: Die Erwartung des Laufs ist die der Schritte, die in ihm liefen.
        expect(ansicht.schritte.filter((s) => s.erwartetMs === 0).map((s) => s.id)).toContain("tests");
        expect(ansicht.fehler?.schritt).toBe("browser-3");
        expect(ansicht.fehler?.faelle[0]).toMatchObject({ teil: "browser-3", teilName: "Teil 3" });
        expect(ansicht.fehler?.grund.split("\n")).toHaveLength(2);
        // Ein Lauf, der gerade läuft, ist nicht wiederholbar; ein grüner auch nicht.
        sperre(true);
        expect(releaseTestAnsicht(F, { klon, daten, lebtRunner: () => true }).wiederholbar).toBe(false);
        sperre(false);
    });

    it("ohne Lauf stehen die vier Browserteile aus der Zuordnung des Repositorys da: offen, mit Namen und Bereichen; ohne wiederholbar", () => {
        sperre(false);
        const leer = mkdtempSync(join(tmpdir(), "abholer-ohne-lauf-"));
        try {
            const ansicht = releaseTestAnsicht(undefined, { klon: leer, daten });
            gueltig(ansicht);
            expect(ansicht.zustand).toBe("keiner");
            expect(ansicht.teile?.map((x) => x.id)).toEqual(["browser-1", "browser-2", "browser-3", "browser-4"]);
            expect(ansicht.teile?.every((x) => x.zustand === "offen" && !x.uebernommen && x.bereiche.length > 2)).toBe(
                true,
            );
            expect(ansicht.wiederholbar).toBeUndefined();
            expect(ansicht.wiederholung).toBeUndefined();
        } finally {
            rmSync(leer, { recursive: true, force: true });
        }
    });

    it("🔴 Abbrechen legt ABBRUCH in den Ordner des laufenden Tests, meldet ein zweites Mal „schon angefordert“ und protokolliert", () => {
        const ordner = lauf(A, { status: "laeuft", ende: "" }, { installation: 60 });
        sperre(true);
        const erste = abbrecheReleaseTest(A, { klon, daten, jetzt: () => new Date("2026-10-23T10:00:00Z") });
        expect(erste).toMatchObject({ status: "abbruch-angefordert", sha: A });
        expect(existsSync(join(ordner, "ABBRUCH"))).toBe(true);
        expect(statSync(join(ordner, "ABBRUCH")).size).toBe(0);
        const zweite = abbrecheReleaseTest(A, { klon, daten });
        expect(zweite.status).toBe("abbruch-angefordert");
        expect(zweite.grund).toContain("schon angefordert");
        const protokoll = readFileSync(join(daten, "release-abholer", "abholer.log"), "utf8")
            .trim()
            .split("\n");
        expect(protokoll).toEqual([
            "2026-10-23T10:00:00.000Z Abbruch angefordert für aaaaaaaaaaaa (Datei ABBRUCH im Ergebnisordner)",
        ]);
    });

    it("Abbrechen ohne laufenden Test legt nichts an: grüner oder roter Lauf, unbekannte SHA, ungültige SHA", () => {
        sperre(false);
        const gruenOrdner = join(klon, ".release-runs", E);
        for (const sha of [E, B, "9".repeat(40)]) {
            expect(abbrecheReleaseTest(sha, { klon, daten }), sha).toMatchObject({ status: "kein-lauf" });
        }
        expect(existsSync(join(gruenOrdner, "ABBRUCH"))).toBe(false);
        expect(existsSync(join(klon, ".release-runs", "9".repeat(40)))).toBe(false);
        expect(abbrecheReleaseTest("zu-kurz", { klon, daten })).toMatchObject({ status: "fehler" });
        // Eine Statusdatei, die „läuft“ sagt, aber ohne Sperre: abgestürzt, kein laufender Test, nichts zu beenden.
        lauf("f".repeat(40), { status: "laeuft", ende: "" });
        expect(abbrecheReleaseTest("f".repeat(40), { klon, daten })).toMatchObject({ status: "kein-lauf" });
    });

    it("die Kommandozeile gibt mit --json EINE JSON-Zeile aus, ohne --json bleibt es Text", () => {
        const skript = fileURLToPath(new URL("../../../scripts/dev/release-abholer.ts", import.meta.url));
        const lauf2 = (...argumente: string[]): { status: number | null; ausgabe: string } => {
            const r = spawnSync(process.execPath, [skript, ...argumente, "--daten", daten, "--klon", klon], {
                encoding: "utf8",
                timeout: 60_000,
                windowsHide: true,
            });
            return { status: r.status, ausgabe: r.stdout };
        };
        const stand = lauf2("--stand", E, "--json");
        expect(stand.status).toBe(0);
        expect(stand.ausgabe.trim().split("\n")).toHaveLength(1);
        expect(JSON.parse(stand.ausgabe)).toMatchObject({ zustand: "gruen", sha: E, fortschritt: 1 });
        const text = lauf2("--stand", E);
        expect(text.ausgabe).toMatch(/^gruen · Commit eeeeeeeeeeee/u);
        expect(text.ausgabe.startsWith("{")).toBe(false);
        const abbruch = lauf2("--abbrechen", E, "--json");
        expect(abbruch.status).toBe(1);
        expect(JSON.parse(abbruch.ausgabe)).toMatchObject({ status: "kein-lauf", sha: E });
        const ohneSha = lauf2("--abbrechen", "--json");
        expect(JSON.parse(ohneSha.ausgabe)).toMatchObject({ status: "fehler" });
    }, 120_000);
});

describe("Runner-Prozess erkennen", () => {
    it("liefert auf Windows ein Ja oder Nein, sonst „nicht feststellbar“, und wirft nie", () => {
        expect(process.platform === "win32" ? "boolean" : "undefined").toBe(typeof lebtRunnerProzess());
    }, 60_000);
});

// ───────────────────────── Eine Sperre ohne Runner: freigeben, wenn der Lauf zu Ende ist (WI-0248, Abbruch am 2026-10-24) ─────────────────────────

describe("🔴 Sperre ohne lebenden Runner: Endzustand frei, Absturz melden", () => {
    let laeufe = "";
    beforeAll(() => {
        laeufe = join(mkdtempSync(join(tmpdir(), "abholer-sperre-")), ".release-runs");
        mkdirSync(laeufe, { recursive: true });
    });
    afterAll(() => {
        rmSync(join(laeufe, ".."), { recursive: true, force: true });
    });
    const sperre = (an: boolean): void => {
        const pfad = join(laeufe, "aktiv");
        if (an) mkdirSync(pfad, { recursive: true });
        else rmSync(pfad, { recursive: true, force: true });
    };
    const lauf = (sha: string, status: Record<string, unknown> | null, start = "2026-10-24T13:30:54.014Z"): void => {
        const ordner = join(laeufe, sha);
        mkdirSync(ordner, { recursive: true });
        if (status !== null) writeFileSync(join(ordner, "status.json"), JSON.stringify({ start, ...status }));
    };
    const aufraeumen = (): void => {
        sperre(false);
        for (const name of readdirSync(laeufe)) rmSync(join(laeufe, name), { recursive: true, force: true });
    };
    const tot = (): boolean => false;

    it("keine Sperre: nichts zu prüfen, und der Runner wird gar nicht erst gefragt", () => {
        aufraeumen();
        let gefragt = false;
        expect(
            pruefeSperre(laeufe, () => {
                gefragt = true;
                return false;
            }),
        ).toEqual({ art: "keine" });
        expect(gefragt).toBe(false);
    });

    it("🔴 ein lebender Runner (oder eine Prozessliste, die sich nicht lesen ließ) hält die Sperre, auch wenn der Lauf einen Endzustand hat", () => {
        aufraeumen();
        sperre(true);
        lauf(A, { status: "abgebrochen", ende: "2026-10-24T13:44:14.457Z" });
        expect(pruefeSperre(laeufe, () => true)).toEqual({ art: "lebt" });
        expect(
            pruefeSperre(laeufe, () => undefined),
            "nicht feststellbar ist kein Beweis für tot",
        ).toEqual({
            art: "lebt",
        });
    });

    it.each(["abgebrochen", "rot", "gruen", "timeout"])(
        "🔴 kein Runner und der Lauf steht im Endzustand „%s“ (mit ende): die Sperre darf frei",
        (status) => {
            aufraeumen();
            sperre(true);
            lauf(A, { status, ende: "2026-10-24T13:44:14.457Z" });
            expect(pruefeSperre(laeufe, tot)).toEqual({
                art: "frei",
                sha: A,
                status,
                ende: "2026-10-24T13:44:14.457Z",
            });
        },
    );

    it("🔴 kein Runner, aber der Lauf hat keinen Endzustand (Absturz: Status „laeuft“, kein ende, keine status.json, kein Laufordner): melden, nicht freigeben", () => {
        aufraeumen();
        sperre(true);
        lauf(A, { status: "laeuft" });
        expect(pruefeSperre(laeufe, tot)).toMatchObject({ art: "offen", grund: expect.stringContaining("abgestürzt") });
        // „ende“ leer: der Endzustand fehlt, auch wenn der Status schon umgestellt ist.
        lauf(A, { status: "rot", ende: "" });
        expect(pruefeSperre(laeufe, tot).art).toBe("offen");
        // Der jüngste Ordner hat gar keine status.json (der Runner stürzte vor dem ersten Schreiben ab): kein Nachweis, auch wenn ein älterer Lauf fertig ist.
        aufraeumen();
        sperre(true);
        lauf(B, { status: "gruen", ende: "2026-10-23T10:00:00.000Z" }, "2026-10-23T08:00:00.000Z");
        lauf(A, null);
        expect(pruefeSperre(laeufe, tot).art).toBe("offen");
        // Kein Laufordner überhaupt.
        aufraeumen();
        sperre(true);
        expect(pruefeSperre(laeufe, tot).art).toBe("offen");
    });

    it("maßgeblich ist der JÜNGSTE Lauf: Ein alter fertiger Lauf neben einem abgestürzten gibt die Sperre nicht frei", () => {
        aufraeumen();
        sperre(true);
        lauf(B, { status: "gruen", ende: "2026-10-23T10:00:00.000Z" }, "2026-10-23T08:00:00.000Z");
        lauf(A, { status: "laeuft" }, "2026-10-24T13:30:54.014Z");
        expect(pruefeSperre(laeufe, tot).art).toBe("offen");
        lauf(A, { status: "abgebrochen", ende: "2026-10-24T13:44:14.457Z" }, "2026-10-24T13:30:54.014Z");
        expect(pruefeSperre(laeufe, tot)).toMatchObject({ art: "frei", sha: A });
    });
});
