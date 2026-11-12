// „Rote Teile wiederholen“ (WI-0248, `scripts/dev/release-wiederholen.ts`): Für dieselbe SHA laufen nur die roten oder fehlenden Teile neu, die grünen
// werden übernommen, aber nur bei gleicher Umgebung und belegtem Rohbericht. Gearbeitet wird mit echten Dateien in einem Temp-Ordner.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schreibeLaufBuch, leseLaufBuch, type LaufBuch } from "../../../scripts/dev/release-laufbuch.ts";
import {
    RELEASE_BELEGE,
    RELEASE_KLASSEN,
    releaseAusNotiz,
    releaseGruen,
    releaseNotiz,
    type ReleaseNachweis,
    type ReleaseTeil,
} from "../../../scripts/dev/release-nachweis.ts";
import { fingerprint } from "../../../scripts/dev/release-pruefsumme.ts";
import {
    BELEG_DATEI,
    LAUF_ORDNER,
    laeufeFuer,
    liesAltLauf,
    planeWiederholung,
    uebernehmbareTeile,
    uebernimmTeile,
    unterschiede,
} from "../../../scripts/dev/release-wiederholen.ts";

const SHA = "a".repeat(40);
const ANDERE = "b".repeat(40);
const UMGEBUNG = "e".repeat(64);
const KOMP = {
    node: "n1",
    postgres: "p1",
    martin: "m1",
    browser: "b1",
    fixtures: "f1",
    lock: "l1",
    runner: "r1",
    vertrag: "v1",
    platform: "win32-x64",
};

describe("Wiederholung", () => {
    let wurzel = "";
    let nummer = 0;
    beforeAll(() => {
        wurzel = mkdtempSync(join(tmpdir(), "wiederholen-"));
    });
    afterAll(() => {
        rmSync(wurzel, { recursive: true, force: true });
    });

    /** Ein früherer Lauf mit Rohberichten; `gruen` nennt die Teile, die als grün (mit Beleg) im Status stehen. */
    function lauf(o: {
        gruen: string[];
        rot?: string[];
        sha?: string;
        umgebung?: string;
        status?: string;
        start?: string;
        name?: string;
        komponenten?: Record<string, string>;
        ohneBelege?: string[];
    }): { laeufe: string; name: string; ordner: string } {
        nummer += 1;
        const laeufe = join(wurzel, `laeufe-${String(nummer)}`);
        const sha = o.sha ?? SHA;
        const name = o.name ?? sha;
        const ordner = join(laeufe, name);
        mkdirSync(ordner, { recursive: true });
        const teile: ReleaseTeil[] = [];
        for (const klasse of o.gruen) {
            const datei = BELEG_DATEI[klasse] as string;
            writeFileSync(join(ordner, datei), JSON.stringify({ klasse, bericht: "grün" }));
            teile.push({
                sha,
                klasse,
                status: "gruen",
                exit: 0,
                ...(klasse === "voll" ? {} : { name: `Name ${klasse}` }),
                ...(o.ohneBelege?.includes(klasse) ? {} : { beleg: fingerprint(join(ordner, datei)) }),
            });
        }
        for (const klasse of o.rot ?? []) {
            writeFileSync(join(ordner, BELEG_DATEI[klasse] as string), JSON.stringify({ klasse, bericht: "rot" }));
            teile.push({ sha, klasse, status: "rot", exit: 1 });
        }
        writeFileSync(
            join(ordner, "status.json"),
            JSON.stringify({
                version: 3,
                sha,
                umgebung: o.umgebung ?? UMGEBUNG,
                start: o.start ?? "2026-10-24T01:00:00.000Z",
                ende: "2026-10-24T03:00:00.000Z",
                status: o.status ?? "rot",
                teile,
                belege: {},
            }),
        );
        if (o.komponenten !== undefined)
            schreibeLaufBuch(ordner, {
                version: 1,
                teile: [],
                problem: null,
                komponenten: o.komponenten,
                wiederholung: null,
                schritte: {},
            });
        return { laeufe, name, ordner };
    }

    const alt = (o: Parameters<typeof lauf>[0]) => {
        const l = lauf(o);
        const a = liesAltLauf(l.ordner, l.name);
        if (a === undefined) throw new Error("Lauf nicht lesbar");
        return { ...l, alt: a };
    };

    it("liest den Lauf; ein Name, der kein Laufordner ist, oder ein kaputter Status zählt nicht", () => {
        const l = lauf({ gruen: ["voll"], rot: ["browser-1"], komponenten: KOMP });
        const a = liesAltLauf(l.ordner, l.name);
        expect(a).toMatchObject({ sha: SHA, status: "rot", umgebung: UMGEBUNG, komponenten: KOMP });
        expect(a?.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["voll", "gruen"],
            ["browser-1", "rot"],
        ]);
        expect(liesAltLauf(l.ordner, "..")).toBeUndefined();
        expect(liesAltLauf(l.ordner, "nicht-ein-laufordner")).toBeUndefined();
        const kaputt = join(wurzel, "kaputt");
        mkdirSync(join(kaputt, SHA), { recursive: true });
        writeFileSync(join(kaputt, SHA, "status.json"), "{ kaputt");
        expect(liesAltLauf(join(kaputt, SHA), SHA)).toBeUndefined();
        expect(LAUF_ORDNER.test(`${SHA}-20261024T010000Z-2`)).toBe(true);
    });

    it("die früheren Läufe einer SHA, der jüngste zuerst; andere SHAs zählen nicht", () => {
        const l = lauf({ gruen: [], start: "2026-10-24T05:00:00.000Z" });
        for (const [name, start, sha] of [
            [`${SHA}-20261024T010000Z`, "2026-10-24T01:00:00.000Z", SHA],
            [`${SHA}-20261024T030000Z`, "2026-10-24T03:00:00.000Z", SHA],
            [`${ANDERE}`, "2026-10-24T09:00:00.000Z", ANDERE],
        ] as const) {
            const ordner = join(l.laeufe, name);
            mkdirSync(ordner, { recursive: true });
            writeFileSync(join(ordner, "status.json"), JSON.stringify({ sha, start, status: "rot", teile: [] }));
        }
        expect(laeufeFuer(l.laeufe, SHA).map((x) => x.name)).toEqual([
            SHA,
            `${SHA}-20261024T030000Z`,
            `${SHA}-20261024T010000Z`,
        ]);
        expect(laeufeFuer(join(wurzel, "gibt-es-nicht"), SHA)).toEqual([]);
    });

    describe("welche Teile sich übernehmen lassen", () => {
        it("grüne Teile mit passendem Beleg; rote, fehlende und entfallene nie", () => {
            const l = alt({ gruen: ["voll", "browser-2", "browser-4"], rot: ["browser-1"] });
            expect(uebernehmbareTeile(l.alt, fingerprint)).toEqual({
                gut: ["voll", "browser-2", "browser-4"],
                schlecht: [],
            });
        });

        it("🔴 ein Rohbericht, der sich seit dem Lauf verändert hat, wird nicht übernommen", () => {
            const l = alt({ gruen: ["voll", "browser-3"] });
            writeFileSync(join(l.ordner, "browser-3.json"), JSON.stringify({ geaendert: true }));
            const u = uebernehmbareTeile(l.alt, fingerprint);
            expect(u.gut).toEqual(["voll"]);
            expect(u.schlecht).toEqual([
                { klasse: "browser-3", grund: "Rohbericht stimmt nicht mit dem Beleg überein" },
            ]);
        });

        it("ein grüner Teil ohne Beleg (Lauf aus der Zeit davor) oder ohne Rohbericht wird nicht übernommen", () => {
            const l = alt({ gruen: ["voll", "browser-1", "browser-2"], ohneBelege: ["browser-1"] });
            rmSync(join(l.ordner, "browser-2.json"));
            const u = uebernehmbareTeile(l.alt, fingerprint);
            expect(u.gut).toEqual(["voll"]);
            expect(u.schlecht).toEqual([
                { klasse: "browser-1", grund: "Beleg fehlt" },
                { klasse: "browser-2", grund: "Rohbericht fehlt" },
            ]);
        });
    });

    describe("🔴 die Umgebung entscheidet", () => {
        it("gleiche Umgebung: grüne Teile übernommen, der Rest neu, in der Reihenfolge der Klassen", () => {
            const l = alt({ gruen: ["voll", "browser-2"], rot: ["browser-1"], komponenten: KOMP });
            const w = planeWiederholung(l.alt, { sha: SHA, umgebung: UMGEBUNG, komponenten: KOMP }, fingerprint);
            expect(w).toEqual({
                uebernehmen: ["voll", "browser-2"],
                neu: ["browser-1", "browser-3", "browser-4"],
                grund: null,
            });
        });

        it("veränderte Umgebung: nichts wird übernommen, der Grund nennt, WAS sich verändert hat", () => {
            const l = alt({ gruen: ["voll", "browser-2"], komponenten: KOMP });
            const w = planeWiederholung(
                l.alt,
                {
                    sha: SHA,
                    umgebung: "f".repeat(64),
                    komponenten: { ...KOMP, fixtures: "f2", runner: "r2", vertrag: "v2" },
                },
                fingerprint,
            );
            expect(w.uebernehmen).toEqual([]);
            expect(w.neu).toEqual([...RELEASE_KLASSEN]);
            expect(w.grund).toBe("Umgebung verändert (Testpaket, Runner, Prüfwerkzeuge): alle Teile laufen neu");
        });

        it("🔴 nur das Prüfprogramm geändert: Fortsetzung, die grünen Teile werden übernommen (Release-Test d1feba8)", () => {
            const l = alt({ gruen: [...RELEASE_KLASSEN], komponenten: KOMP });
            const w = planeWiederholung(
                l.alt,
                { sha: SHA, umgebung: "f".repeat(64), komponenten: { ...KOMP, runner: "r2", vertrag: "v2" } },
                fingerprint,
            );
            expect(w.uebernehmen).toEqual([...RELEASE_KLASSEN]);
            expect(w.neu).toEqual([]);
            expect(w.grund).toBe(
                "Fortsetzung: nur Runner, Prüfwerkzeuge geändert, die Umgebung der Tests ist dieselbe",
            );
        });

        it("🔴 Browser anders: Fortsetzung nur, wenn er seit dem Start des alten Laufs bloß in seinen Protokollen anders ist", () => {
            const l = alt({ gruen: [...RELEASE_KLASSEN], komponenten: KOMP });
            const neu = { sha: SHA, umgebung: "f".repeat(64), komponenten: { ...KOMP, browser: "b2", runner: "r2" } };
            const gefragt: number[] = [];
            const fort = planeWiederholung(l.alt, neu, fingerprint, (ms) => {
                gefragt.push(ms);
                return true;
            });
            expect(gefragt).toEqual([l.alt.start]);
            expect(fort.uebernehmen).toEqual([...RELEASE_KLASSEN]);
            expect(fort.grund).toBe(
                "Fortsetzung: nur Browser, Runner geändert (Browser nur in seinen Protokollen), die Umgebung der Tests ist dieselbe",
            );
            const neuLauf = planeWiederholung(l.alt, neu, fingerprint, () => false);
            expect(neuLauf.uebernehmen).toEqual([]);
            expect(neuLauf.grund).toBe("Umgebung verändert (Browser, Runner): alle Teile laufen neu");
            // Ohne Auskunft über den Browser (Vorgabe) gilt er als verändert.
            expect(planeWiederholung(l.alt, neu, fingerprint).uebernehmen).toEqual([]);
        });

        it("ein Lauf ohne aufbewahrte Bestandteile (aus der Zeit davor): der Grund nennt den Fingerabdruck", () => {
            const l = alt({ gruen: ["voll"] });
            const w = planeWiederholung(l.alt, { sha: SHA, umgebung: "f".repeat(64), komponenten: KOMP }, fingerprint);
            expect(w.uebernehmen).toEqual([]);
            expect(w.grund).toBe("Umgebung verändert (Fingerabdruck weicht ab): alle Teile laufen neu");
        });

        it("ein anderer Stand: nichts wird übernommen", () => {
            const l = alt({ gruen: ["voll"], sha: ANDERE, name: ANDERE });
            const w = planeWiederholung(l.alt, { sha: SHA, umgebung: UMGEBUNG, komponenten: KOMP }, fingerprint);
            expect(w.uebernehmen).toEqual([]);
            expect(w.grund).toContain("anderen Stand");
        });

        it("gleiche Umgebung, aber ein Beleg stimmt nicht: Dieser Teil läuft neu, die anderen werden übernommen, der Grund nennt ihn", () => {
            const l = alt({ gruen: ["voll", "browser-1"], komponenten: KOMP });
            writeFileSync(join(l.ordner, "browser-1.json"), "geändert");
            const w = planeWiederholung(l.alt, { sha: SHA, umgebung: UMGEBUNG, komponenten: KOMP }, fingerprint);
            expect(w.uebernehmen).toEqual(["voll"]);
            expect(w.neu).toEqual(["browser-1", "browser-2", "browser-3", "browser-4"]);
            expect(w.grund).toContain("browser-1: Rohbericht stimmt nicht mit dem Beleg überein");
        });

        it("die Bestandteile: nur die abweichenden, in Wörtern, ohne Doppelte", () => {
            expect(unterschiede(undefined, KOMP)).toEqual([]);
            expect(unterschiede(KOMP, KOMP)).toEqual([]);
            expect(unterschiede(KOMP, { ...KOMP, node: "n2", platform: "linux-x64" })).toEqual(["Node", "Plattform"]);
            expect(unterschiede({ node: "a" }, { node: "a", neu: "x" })).toEqual(["neu"]);
        });
    });

    describe("Übernehmen", () => {
        it("kopiert die Rohberichte der Teile in den neuen Ordner und liefert deren Einträge samt Beleg und Name", () => {
            const l = alt({ gruen: ["voll", "browser-2"] });
            const ziel = join(wurzel, `ziel-${String(nummer)}`);
            mkdirSync(ziel);
            const eintraege = uebernimmTeile(l.alt, ziel, ["voll", "browser-2"], fingerprint);
            expect(eintraege.map((e) => [e.klasse, e.status, e.name])).toEqual([
                ["voll", "gruen", undefined],
                ["browser-2", "gruen", "Name browser-2"],
            ]);
            for (const e of eintraege) {
                const datei = join(ziel, BELEG_DATEI[e.klasse] as string);
                expect(existsSync(datei)).toBe(true);
                // Der Beleg des Eintrags ist die Prüfsumme der Datei im NEUEN Ordner (so liest ihn der Nachweis).
                expect(fingerprint(datei)).toBe(e.beleg);
                expect(readFileSync(datei, "utf8")).toBe(
                    readFileSync(join(l.ordner, BELEG_DATEI[e.klasse] as string), "utf8"),
                );
            }
        });

        it("überschreibt nie eine vorhandene Datei", () => {
            const l = alt({ gruen: ["browser-1"] });
            const ziel = join(wurzel, `ziel-ue-${String(nummer)}`);
            mkdirSync(ziel);
            writeFileSync(join(ziel, "browser-1.json"), "da");
            expect(() => uebernimmTeile(l.alt, ziel, ["browser-1"], fingerprint)).toThrow();
            expect(readFileSync(join(ziel, "browser-1.json"), "utf8")).toBe("da");
        });

        it("wirft, wenn die Prüfsumme nach dem Kopieren nicht stimmt, und für einen Teil ohne Beleg", () => {
            const l = alt({ gruen: ["browser-1", "browser-2"], ohneBelege: ["browser-2"] });
            const ziel = join(wurzel, `ziel-pr-${String(nummer)}`);
            mkdirSync(ziel);
            expect(() => uebernimmTeile(l.alt, ziel, ["browser-1"], () => "0".repeat(64))).toThrow(
                /Prüfsumme nach dem Kopieren/,
            );
            const ziel2 = join(wurzel, `ziel-pr2-${String(nummer)}`);
            mkdirSync(ziel2);
            expect(() => uebernimmTeile(l.alt, ziel2, ["browser-2"], fingerprint)).toThrow(/Beleg fehlt/);
            expect(() => uebernimmTeile(l.alt, ziel2, ["browser-3"], fingerprint)).toThrow(/Teil oder Beleg fehlt/);
        });
    });

    describe("🔴 Der Nachweis wird erst grün, wenn alle Teile dieser SHA grün sind", () => {
        const nachweis = (teile: readonly ReleaseTeil[]): ReleaseNachweis => ({
            version: 3,
            sha: SHA,
            umgebung: UMGEBUNG,
            start: new Date(Date.now() - 2000).toISOString(),
            ende: new Date().toISOString(),
            status: "gruen",
            teile: [...teile],
            belege: Object.fromEntries(RELEASE_BELEGE.map((d) => [d, "c".repeat(64)])),
        });
        const gruen = (klasse: string, extra: Partial<ReleaseTeil> = {}): ReleaseTeil => ({
            sha: SHA,
            klasse,
            status: "gruen",
            exit: 0,
            ...extra,
        });

        it("übernommene Teile (mit Name und Beleg) und neue Teile ergeben einen gültigen Nachweis und eine lesbare Notiz", () => {
            const n = nachweis([
                gruen("voll", { beleg: "1".repeat(64) }),
                gruen("browser-1", { name: "Orte, Wege, Kraftlinien", beleg: "2".repeat(64) }),
                gruen("browser-2", { name: "Gebiete", beleg: "3".repeat(64) }),
                gruen("browser-3"),
                gruen("browser-4"),
            ]);
            expect(releaseGruen(n, SHA, UMGEBUNG)).toBe(true);
            expect(releaseAusNotiz(releaseNotiz(n), SHA)?.teile).toHaveLength(5);
        });

        it("ein roter, entfallener oder fehlender Teil verhindert Grün", () => {
            const ganz = RELEASE_KLASSEN.map((k) => gruen(k));
            expect(releaseGruen(nachweis(ganz), SHA, UMGEBUNG)).toBe(true);
            expect(releaseGruen(nachweis(ganz.slice(0, 4)), SHA, UMGEBUNG)).toBe(false);
            expect(
                releaseGruen(
                    nachweis([...ganz.slice(0, 4), { ...gruen("browser-4"), status: "rot", exit: 1 }]),
                    SHA,
                    UMGEBUNG,
                ),
            ).toBe(false);
            expect(
                releaseGruen(
                    nachweis([...ganz.slice(0, 4), { ...gruen("browser-4"), status: "uebersprungen", exit: 1 }]),
                    SHA,
                    UMGEBUNG,
                ),
            ).toBe(false);
            // Auch ein Teil doppelt (der alte rote neben dem neuen grünen) ist kein Nachweis.
            expect(
                releaseGruen(nachweis([...ganz, { ...gruen("browser-4"), status: "rot", exit: 1 }]), SHA, UMGEBUNG),
            ).toBe(false);
        });
    });

    it("das Laufbuch bleibt beim Schreiben ganz und liest sich zurück; Unlesbares ist keines", () => {
        const ordner = join(wurzel, "buch");
        mkdirSync(ordner);
        const buch: LaufBuch = {
            version: 1,
            teile: [{ id: "browser-1", name: "Orte", bereiche: ["orte", "wege"], specs: 60 }],
            problem: null,
            komponenten: KOMP,
            wiederholung: { von: `${SHA}-20261024T010000Z`, uebernommen: ["voll"], neu: ["browser-1"], grund: null },
            schritte: {
                lint: { status: "uebernommen" },
                "browser-1": { status: "rot", grund: "Browserteil 1: 1 rot" },
            },
        };
        schreibeLaufBuch(ordner, buch);
        expect(existsSync(join(ordner, "teile.json.tmp"))).toBe(false);
        expect(leseLaufBuch(ordner)).toEqual(buch);
        writeFileSync(join(ordner, "teile.json"), JSON.stringify({ version: 2 }));
        expect(leseLaufBuch(ordner)).toBeUndefined();
        writeFileSync(join(ordner, "teile.json"), "{ kaputt");
        expect(leseLaufBuch(ordner)).toBeUndefined();
        expect(leseLaufBuch(join(wurzel, "gibt-es-nicht"))).toBeUndefined();
    });
});
