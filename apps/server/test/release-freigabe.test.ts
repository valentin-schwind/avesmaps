// Die Entscheidung „bei Grün diese SHA ausliefern“ (WI-0248; Vali 2026-10-26: „Nein das passiert automatisch, sobald der test grün war“).
// Gezielt, weil sie Production auslöst: Grün liefert genau die SHA der Freigabe aus, Rot nichts, ein neuerer Stage-Stand nie, ein fremdes Grün
// nach dem Druck nicht, ein Abbruch nichts; dazu der Aufruf gegen ein echtes Repository so, wie Claudios Abholer ihn macht.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    abbruchNotiz,
    bereinigeZeile,
    entscheideAusRepo,
    entscheideFreigabe,
    freigabeNotiz,
    parseFreigabe,
    pruefeNotizUnterschrift,
    signaturNachricht,
    unterschreibeNotiz,
    waehleFreigabe,
    type Freigabe,
} from "../../../scripts/dev/release-freigabe.ts";
import { generateKeyPairSync } from "node:crypto";
import { offenNotiz, rotNotiz } from "../../../scripts/dev/release-grund.ts";
import {
    RELEASE_PROFILE,
    releaseBelege,
    releaseNotiz,
    type ReleaseNachweis,
} from "../../../scripts/dev/release-nachweis.ts";

const S1 = "1".repeat(40);
const S2 = "2".repeat(40);
const K1 = "RT-11111111-1111-4111-8111-111111111111";
const K2 = "RT-22222222-2222-4222-8222-222222222222";
const DRUCK = "2026-10-25T10:00:00.000Z";

/** Ein gültiger grüner Nachweis Version 3 nach Prüfprofil B für `sha`. */
const nachweis = (sha: string, patch: Partial<ReleaseNachweis> = {}): ReleaseNachweis => ({
    version: 3,
    sha,
    umgebung: "b".repeat(64),
    start: "2026-10-25T10:05:00.000Z",
    ende: "2026-10-25T11:30:00.000Z",
    status: "gruen",
    profil: "B",
    teile: RELEASE_PROFILE.B.map((klasse) => ({ sha, klasse, status: "gruen", exit: 0 })),
    belege: Object.fromEntries(releaseBelege("B").map((p) => [p, "c".repeat(64)])),
    ...patch,
});
/** Ein gültiger grüner Nachweis Version 3 nach dem Release-Tor (Profil `tor`, WI-0264) für `sha`. */
const torNachweis = (sha: string, patch: Partial<ReleaseNachweis> = {}): ReleaseNachweis =>
    nachweis(sha, {
        profil: "tor",
        teile: RELEASE_PROFILE.tor.map((klasse) => ({ sha, klasse, status: "gruen", exit: 0 })),
        belege: Object.fromEntries(releaseBelege("tor").map((p) => [p, "c".repeat(64)])),
        ...patch,
    });
const freigabe = (patch: Partial<Freigabe> = {}): Freigabe => ({
    sha: S1,
    zeit: DRUCK,
    art: "auftrag",
    kennung: K1,
    von: "Vali",
    grund: null,
    ...patch,
});

describe("🔴 Die Entscheidung: bei Grün genau diese SHA, bei Rot nichts", () => {
    it("grün mit der Kennung dieser Freigabe: genau ihre SHA wird ausgeliefert", () => {
        const e = entscheideFreigabe(freigabe(), releaseNotiz(nachweis(S1, { auftrag: K1 })));
        expect(e).toMatchObject({ zustand: "gruen", ausliefern: true, sha: S1, kennung: K1, von: "Vali" });
    });

    it("rot nach dem Druck: nichts wird ausgeliefert, der Grund steht da", () => {
        const e = entscheideFreigabe(
            freigabe(),
            rotNotiz(S1, "2026-10-25T11:00:00.000Z", "Lauf fehlgeschlagen: Vitest: 3 rot"),
        );
        expect(e.ausliefern).toBe(false);
        expect(e.zustand).toBe("rot");
        expect(e.grund).toContain("Vitest: 3 rot");
    });

    it("🔴 rot, danach ein grüner Lauf ohne diese Kennung (etwa von Hand gestartet): nichts; der nächste Start ist wieder die Wahl des Betreibers", () => {
        const fremd = releaseNotiz(nachweis(S1, { ende: "2026-10-25T15:00:00.000Z" }));
        const e = entscheideFreigabe(freigabe(), fremd);
        expect(e).toMatchObject({ zustand: "fremd", ausliefern: false });
        // Ebenso ein Grün mit der Kennung einer ANDEREN Freigabe.
        expect(entscheideFreigabe(freigabe(), releaseNotiz(nachweis(S1, { auftrag: K2 }))).ausliefern).toBe(false);
    });

    it("schon vor dem Druck grün geprüft (dieselbe SHA): der Druck gibt sie frei, ausgeliefert wird sofort", () => {
        const vorher = releaseNotiz(
            nachweis(S1, { start: "2026-10-25T07:00:00.000Z", ende: "2026-10-25T08:00:00.000Z" }),
        );
        expect(entscheideFreigabe(freigabe(), vorher)).toMatchObject({ zustand: "gruen", ausliefern: true, sha: S1 });
    });

    it("🔴 die Stage hat sich bewegt: Die Entscheidung nennt die geprüfte SHA der Freigabe, nie eine neuere", () => {
        // Das Urteil hängt an S1; ob die Stage inzwischen S2 trägt, spielt keine Rolle, ausgeliefert wird S1.
        const e = entscheideFreigabe(freigabe({ sha: S1 }), releaseNotiz(nachweis(S1, { auftrag: K1 })));
        expect(e.sha).toBe(S1);
        // Ein Urteil für eine andere SHA zählt für diese Freigabe nicht: Sie wartet.
        const anderer = entscheideFreigabe(freigabe({ sha: S1 }), releaseNotiz(nachweis(S2, { auftrag: K1 })));
        expect(anderer).toMatchObject({ zustand: "wartet", ausliefern: false, sha: S1 });
    });

    it("ohne Urteil, mit „offen“ oder einem Rot von vor dem Druck: wartet oder läuft, nichts wird ausgeliefert", () => {
        expect(entscheideFreigabe(freigabe(), undefined)).toMatchObject({ zustand: "wartet", ausliefern: false });
        expect(entscheideFreigabe(freigabe(), offenNotiz(S1, "2026-10-25T10:05:00.000Z"))).toMatchObject({
            zustand: "laeuft",
            ausliefern: false,
        });
        expect(entscheideFreigabe(freigabe(), offenNotiz(S1, "2026-10-25T09:00:00.000Z")).zustand).toBe("wartet");
        expect(entscheideFreigabe(freigabe(), rotNotiz(S1, "2026-10-25T09:00:00.000Z", "alt")).zustand).toBe("wartet");
    });

    it("eine grüne Zeile ohne gültigen Nachweis Version 3 liefert nichts aus", () => {
        const kaputt = `${S1} 2026-10-25T11:30:00.000Z gruen\nrelease-nachweis-v3 {}\n`;
        expect(entscheideFreigabe(freigabe(), kaputt)).toMatchObject({ zustand: "ungueltig", ausliefern: false });
        // Ein Nachweis mit einem roten Teil ist kein Grün.
        const teilRot = nachweis(S1, { auftrag: K1 });
        teilRot.teile[1] = { sha: S1, klasse: "kern", status: "rot", exit: 1 };
        const text = `${S1} ${teilRot.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(teilRot)}\n`;
        expect(entscheideFreigabe(freigabe(), text).ausliefern).toBe(false);
    });

    it("🔴 das Tor (Profil tor, WI-0264): grün mit genau bau, daten und kern-echt liefert die SHA aus; fehlt ein Teil, nichts", () => {
        const text = releaseNotiz(torNachweis(S1, { auftrag: K1 }));
        expect(text).toContain('"profil":"tor"');
        expect(entscheideFreigabe(freigabe(), text)).toMatchObject({
            zustand: "gruen",
            ausliefern: true,
            sha: S1,
            kennung: K1,
        });
        // Ein Nachweis, dem `daten` fehlt, ist kein Grün, auch mit gültigem Kopf: das Tor lässt nichts aus.
        const ohneDaten = torNachweis(S1, { auftrag: K1 });
        ohneDaten.teile = ohneDaten.teile.filter((t) => t.klasse !== "daten");
        const kaputt = `${S1} ${ohneDaten.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(ohneDaten)}\n`;
        expect(entscheideFreigabe(freigabe(), kaputt)).toMatchObject({ zustand: "ungueltig", ausliefern: false });
        // Die Teile von B sind kein Tor.
        const alsTor = nachweis(S1, { auftrag: K1, profil: "tor" });
        const text2 = `${S1} ${alsTor.ende} gruen\nrelease-nachweis-v3 ${JSON.stringify(alsTor)}\n`;
        expect(entscheideFreigabe(freigabe(), text2).ausliefern).toBe(false);
    });

    it("eine abgebrochene Freigabe liefert nie aus, auch wenn die SHA grün ist", () => {
        const ab = freigabe({ art: "abgebrochen", von: null, grund: "Abgebrochen von Vali" });
        const e = entscheideFreigabe(ab, releaseNotiz(nachweis(S1, { auftrag: K1 })));
        expect(e).toMatchObject({ zustand: "abgebrochen", ausliefern: false, grund: "Abgebrochen von Vali" });
        expect(entscheideFreigabe(undefined, undefined)).toMatchObject({ zustand: "keine", ausliefern: false });
    });
});

describe("Die Notiz der Freigabe", () => {
    it("schreibt und liest die strenge Form; der Name verliert Steuerzeichen und Trenner", () => {
        const text = freigabeNotiz({ sha: S1, zeit: DRUCK, kennung: K1, von: "Va|li\nRT-x" });
        expect(text).toBe(`${S1} ${DRUCK} auftrag ${K1}\nvon Va li RT-x\n`);
        expect(parseFreigabe(text, S1)).toEqual({
            sha: S1,
            zeit: DRUCK,
            art: "auftrag",
            kennung: K1,
            von: "Va li RT-x",
            grund: null,
        });
        // An einem anderen Commit ist sie ungültig, ebenso ohne Namen, mit kaputter Kennung oder als OPS-Zeile der Stage.
        expect(parseFreigabe(text, S2)).toBeUndefined();
        expect(parseFreigabe(`${S1} ${DRUCK} auftrag ${K1}\n`)).toBeUndefined();
        expect(parseFreigabe(`${S1} ${DRUCK} auftrag RT-1234\nvon Vali\n`)).toBeUndefined();
        expect(parseFreigabe(`${S1} ${DRUCK} auftrag OPS-000050\nvon Vali\n`)).toBeUndefined();
        expect(() => freigabeNotiz({ sha: S1, zeit: DRUCK, kennung: K1, von: " \n " })).toThrow();
        expect(() => freigabeNotiz({ sha: "kurz", zeit: DRUCK, kennung: K1, von: "Vali" })).toThrow();
        expect(bereinigeZeile("x".repeat(100), 80)).toHaveLength(80);
    });

    it("der Abbruch trägt den Grund; die jüngste Freigabe löst jede ältere ab", () => {
        const ab = abbruchNotiz({ sha: S1, zeit: "2026-10-25T12:00:00.000Z", kennung: K1, grund: "Release-Test rot" });
        expect(parseFreigabe(ab, S1)).toMatchObject({ art: "abgebrochen", grund: "Release-Test rot", von: null });
        const neu = freigabeNotiz({ sha: S2, zeit: "2026-10-25T13:00:00.000Z", kennung: K2, von: "Vali" });
        expect(
            waehleFreigabe([
                { objekt: S1, text: ab },
                { objekt: S2, text: neu },
            ])?.sha,
        ).toBe(S2);
        expect(waehleFreigabe([{ objekt: S1, text: `${S1} ${DRUCK} auftrag OPS-000050` }])).toBeUndefined();
    });
});

describe("🔴 Gegen ein echtes Repository, wie Claudios Abholer es ruft", () => {
    let repo = "";
    let a = "";
    let b = "";
    const g = (...args: string[]): string =>
        execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
    const notiere = (ref: string, sha: string, text: string): void => {
        const datei = join(repo, "..", `notiz-${ref}.txt`);
        writeFileSync(datei, text);
        g("notes", `--ref=${ref}`, "add", "-f", "-F", datei, sha);
    };
    const cli = (...args: string[]) =>
        spawnSync(
            process.execPath,
            [
                fileURLToPath(new URL("../../../scripts/dev/release-freigabe.ts", import.meta.url)),
                "entscheide",
                "--repo",
                repo,
                ...args,
            ],
            { encoding: "utf8", windowsHide: true },
        );

    beforeAll(() => {
        const wurzel = mkdtempSync(join(tmpdir(), "release-freigabe-"));
        repo = join(wurzel, "repo");
        execFileSync("git", ["init", "--quiet", "-b", "master", repo], { windowsHide: true });
        g("config", "user.name", "Test");
        g("config", "user.email", "test@avesmaps3d.local");
        g("commit", "--quiet", "--allow-empty", "-m", "A");
        a = g("rev-parse", "HEAD");
        g("commit", "--quiet", "--allow-empty", "-m", "B");
        b = g("rev-parse", "HEAD");
    }, 60_000);
    afterAll(() => {
        if (repo !== "") rmSync(join(repo, ".."), { recursive: true, force: true });
    });

    it("grün für die freigegebene SHA: Exit 0 und genau diese SHA, auch wenn ein neuerer Commit (die Stage) existiert", () => {
        notiere("release-auftrag", a, freigabeNotiz({ sha: a, zeit: DRUCK, kennung: K1, von: "Vali" }));
        notiere("sammellauf", a, releaseNotiz(nachweis(a, { auftrag: K1 })));
        const r = cli();
        expect(r.status).toBe(0);
        const e = JSON.parse(r.stdout) as { zustand: string; sha: string; ausliefern: boolean };
        expect(e).toMatchObject({ zustand: "gruen", ausliefern: true, sha: a });
        expect(e.sha).not.toBe(b);
        expect(entscheideAusRepo(repo, a).ausliefern).toBe(true);
    });

    it("rot: Exit 2 und nichts auszuliefern; eine neuere Freigabe für einen anderen Stand löst die alte ab", () => {
        notiere(
            "sammellauf",
            a,
            rotNotiz(a, "2026-10-25T11:00:00.000Z", "Lauf fehlgeschlagen: Browserteil kern: 1 rot"),
        );
        const rot = cli();
        expect(rot.status).toBe(2);
        expect(JSON.parse(rot.stdout)).toMatchObject({ zustand: "rot", ausliefern: false, sha: a });
        notiere(
            "release-auftrag",
            b,
            freigabeNotiz({ sha: b, zeit: "2026-10-25T12:00:00.000Z", kennung: K2, von: "Vali" }),
        );
        expect(JSON.parse(cli().stdout)).toMatchObject({ zustand: "wartet", sha: b });
        // Gezielt nach einer SHA gefragt, gilt deren Freigabe.
        expect(JSON.parse(cli("--sha", a).stdout)).toMatchObject({ zustand: "rot", sha: a });
        expect(cli("--sha", "kurz").status).toBe(1);
    });

    it("🔴 ein grüner Lauf im Profil tor (WI-0264) mit passender Freigabe: Exit 0 und genau diese SHA", () => {
        notiere("sammellauf", b, releaseNotiz(torNachweis(b, { auftrag: K2, ende: "2026-10-25T13:30:00.000Z" })));
        const r = cli("--sha", b);
        expect(r.status).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ zustand: "gruen", ausliefern: true, sha: b, kennung: K2 });
        expect(entscheideAusRepo(repo, b).ausliefern).toBe(true);
    });
});

describe("🔴 Der Starter schreibt die Freigabe nach origin (der Weg zu Claudios Abholer)", () => {
    let wurzel = "";
    let origin = "";
    let klon = "";
    let daten = "";
    let sha = "";
    const g = (cwd: string, ...args: string[]): string =>
        execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
    const aufOrigin = (ref: string, commit: string): string => {
        try {
            return g(origin, "notes", `--ref=${ref}`, "show", commit);
        } catch {
            return "";
        }
    };

    beforeAll(() => {
        wurzel = mkdtempSync(join(tmpdir(), "release-freigabe-origin-"));
        origin = join(wurzel, "origin.git");
        execFileSync("git", ["init", "--bare", "--quiet", "-b", "master", origin], { windowsHide: true });
        const arbeit = join(wurzel, "arbeit");
        g(wurzel, "clone", "--quiet", origin, arbeit);
        g(arbeit, "checkout", "--quiet", "-b", "master");
        g(arbeit, "config", "user.name", "Quelle");
        g(arbeit, "config", "user.email", "quelle@avesmaps3d.local");
        g(arbeit, "commit", "--quiet", "--allow-empty", "-m", "A");
        g(arbeit, "push", "--quiet", "origin", "master");
        sha = g(arbeit, "rev-parse", "HEAD");
        // Eine fremde Notiz an einem anderen Commit liegt schon auf origin (eine alte Nacht-Freigabe der Stage): Sie muss stehen bleiben.
        g(arbeit, "commit", "--quiet", "--allow-empty", "-m", "B");
        g(arbeit, "push", "--quiet", "origin", "master");
        const b = g(arbeit, "rev-parse", "HEAD");
        g(arbeit, "notes", "--ref=release-auftrag", "add", "-m", `${b} 2026-10-23T10:00:00Z auftrag OPS-000050`, b);
        g(arbeit, "push", "--quiet", "origin", "refs/notes/release-auftrag:refs/notes/release-auftrag");
        klon = join(wurzel, "klon");
        g(wurzel, "clone", "--quiet", origin, klon);
        g(klon, "config", "user.name", "Claudia");
        g(klon, "config", "user.email", "claudia@avesmaps3d.local");
        daten = join(wurzel, "daten");
    }, 60_000);
    afterAll(() => {
        if (wurzel !== "") rmSync(wurzel, { recursive: true, force: true });
    });

    it("schreibt genau diese SHA mit Kennung und Person; eine fremde Notiz bleibt; der Kandidat zeigt die Freigabe als „wartet“", async () => {
        const { leseKandidat, schreibeFreigabe } = await import("../../../scripts/dev/release-abholer.ts");
        const e = schreibeFreigabe({ sha, kennung: K1, von: "Vali", zeit: DRUCK, klon, daten });
        expect(e).toMatchObject({ status: "geschrieben", sha, kennung: K1, freigabe: true });
        expect(aufOrigin("release-auftrag", sha)).toBe(`${sha} ${DRUCK} auftrag ${K1}\nvon Vali`);
        expect(g(origin, "notes", "--ref=release-auftrag", "list").split("\n")).toHaveLength(2);
        expect(leseKandidat(klon).freigabe).toMatchObject({
            sha,
            kennung: K1,
            von: "Vali",
            zustand: "wartet",
            ausliefern: false,
        });
    }, 60_000);

    it("beenden nur über genau diese Freigabe: eine andere Kennung lässt sie stehen, die richtige schreibt „abgebrochen“", async () => {
        const { beendeFreigabe, leseKandidat } = await import("../../../scripts/dev/release-abholer.ts");
        expect(beendeFreigabe({ sha, kennung: K2, grund: "x", klon, daten }).status).toBe("unveraendert");
        expect(aufOrigin("release-auftrag", sha)).toContain(`auftrag ${K1}`);
        expect(beendeFreigabe({ sha, kennung: K1, grund: "Release-Test rot: Vitest: 1 rot", klon, daten }).status).toBe(
            "geschrieben",
        );
        const [erste, zweite] = aufOrigin("release-auftrag", sha).split("\n");
        expect(erste).toMatch(new RegExp(`^${sha} \\S+ abgebrochen ${K1}$`, "u"));
        expect(zweite).toBe("Release-Test rot: Vitest: 1 rot");
        expect(beendeFreigabe({ sha, kennung: K1, grund: "noch einmal", klon, daten }).status).toBe("unveraendert");
        expect(leseKandidat(klon).freigabe).toMatchObject({ zustand: "abgebrochen", ausliefern: false });
    }, 60_000);

    it("ein Start mit Freigabe gibt ihre Kennung an den Runner weiter; ohne bleibt sie weg", async () => {
        const { starteReleaseTest } = await import("../../../scripts/dev/release-abholer.ts");
        const runner: (string | undefined)[] = [];
        const start = (freigabe?: string) =>
            starteReleaseTest({
                commit: sha,
                klon,
                daten,
                statusWarteMs: 3000,
                lebtRunner: () => false,
                ...(freigabe === undefined ? {} : { freigabe }),
                baueFixtures: (s) => Promise.resolve(join(daten, "release-fixtures", s)),
                starteRunner: (s, _fixtures, _uebernehmen, kennung) => {
                    runner.push(kennung);
                    const ordner = join(klon, ".release-runs", s);
                    rmSync(ordner, { recursive: true, force: true });
                    mkdirSync(ordner, { recursive: true });
                    writeFileSync(
                        join(ordner, "status.json"),
                        JSON.stringify({
                            status: "rot",
                            start: new Date().toISOString(),
                            ende: new Date().toISOString(),
                        }),
                    );
                    return Promise.resolve(1);
                },
            });
        expect((await start(K1)).status).toBe("gestartet");
        expect((await start()).status).toBe("gestartet");
        expect(runner).toEqual([K1, undefined]);
        expect((await start("RT-kaputt")).status).toBe("fehler");
    }, 90_000);
});

describe("Weg B: die Freigabe ist unterschrieben (Ed25519)", () => {
    const paar = generateKeyPairSync("ed25519");
    const privat = paar.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const oeffentlich = paar.publicKey.export({ type: "spki", format: "pem" }).toString();
    const notiz = freigabeNotiz({ sha: S1, zeit: DRUCK, kennung: K1, von: "Vali" });

    it("unterschreibt die ersten beiden Zeilen und hängt `sig` als dritte an", () => {
        const signiert = unterschreibeNotiz(notiz, privat);
        const zeilen = signiert.split("\n");
        expect(zeilen.slice(0, 2).join("\n")).toBe(`${S1} ${DRUCK} auftrag ${K1}\nvon Vali`);
        expect(signaturNachricht(signiert)).toBe(`${S1} ${DRUCK} auftrag ${K1}\nvon Vali`);
        expect(zeilen[2]).toMatch(/^sig [A-Za-z0-9+/]{86}==$/u);
        expect(signiert.endsWith("\n")).toBe(true);
        expect(signiert).not.toContain("\r");
        expect(pruefeNotizUnterschrift(signiert, oeffentlich)).toBe(true);
        // Die Leser der Freigabe lesen weiter nur die ersten beiden Zeilen.
        expect(parseFreigabe(signiert, S1)).toEqual(parseFreigabe(notiz, S1));
    });

    it("verwirft eine veränderte, fremde oder fehlende Unterschrift", () => {
        const signiert = unterschreibeNotiz(notiz, privat);
        expect(pruefeNotizUnterschrift(signiert.replace("von Vali", "von Mallory"), oeffentlich)).toBe(false);
        expect(pruefeNotizUnterschrift(signiert.replace(S1, S2), oeffentlich)).toBe(false);
        const fremd = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
        expect(pruefeNotizUnterschrift(signiert, fremd)).toBe(false);
        expect(pruefeNotizUnterschrift(notiz, oeffentlich)).toBe(false);
    });
});
