// Der Ablauf der Teile eines Release-Tests (WI-0248, `scripts/dev/release-ablauf.ts`): immer bis zum Ende, mit allen roten Fällen aller Teile.
// Gefahren wird mit Ersatzteilen (kein Prozess, kein Git): Geprüft wird die Reihenfolge, was weiterläuft, was entfällt und was im Status steht.
import { describe, expect, it } from "vitest";
import {
    BAU_SCHRITTE,
    TeileRot,
    VOLL_SCHRITTE,
    WACKELIG_GRUEN,
    browserBefund,
    datenBefund,
    exitBefund,
    fehlerText,
    fuehreAus,
    zeitBefund,
    type AblaufIo,
    type AblaufPlan,
    type Befund,
    type SchrittStatus,
} from "../../../scripts/dev/release-ablauf.ts";
import { notizGrundTeile, rotNotiz } from "../../../scripts/dev/release-grund.ts";
import {
    releaseBelege,
    releaseGruen,
    releaseKlassen,
    RELEASE_BELEGE,
    type ReleaseNachweis,
    type ReleaseTeil,
} from "../../../scripts/dev/release-nachweis.ts";
import { TEIL_IDS, type TeilZuordnung } from "../../../scripts/dev/release-teile.ts";

const SHA = "a".repeat(40);
const teile: TeilZuordnung[] = TEIL_IDS.map((id, i) => ({
    id,
    name: `Teil ${String(i + 1)}`,
    bereiche: ["orte"],
    specs: [`${id}.spec.ts`],
}));
const voll: AblaufPlan = { voll: true, browser: teile, browserProblem: null };

interface Ersatz {
    io: AblaufIo;
    aufrufe: string[];
}
/** Ersatzteile: `rot` nennt die Schritte (und Browserteile), die rot enden; alles andere ist grün. */
function ersatz(rot: Record<string, Befund> = {}, bereit: string | null = null): Ersatz {
    const aufrufe: string[] = [];
    const io: AblaufIo = {
        schritt: (name) => {
            aufrufe.push(name);
            return Promise.resolve(rot[name] ?? null);
        },
        vitest: () => {
            aufrufe.push("tests");
            return Promise.resolve(rot["tests"] ?? null);
        },
        daten: () => {
            aufrufe.push("daten");
            return Promise.resolve(rot["daten"] ?? null);
        },
        browserBereit: () => {
            aufrufe.push("bereit");
            return Promise.resolve(bereit);
        },
        browser: (teil) => {
            aufrufe.push(teil.id);
            return Promise.resolve(rot[teil.id] ?? null);
        },
        beleg: (klasse) => `${klasse.length.toString(16).padStart(2, "0")}`.repeat(32),
    };
    return { io, aufrufe };
}
const befund = (text: string, kurz = text): Befund => ({ meldung: text, kurz });

describe("Alles grün", () => {
    it("fährt Lint, Format, Typen, Vitest, Bau, Besucherpaket und die vier Browserteile, in dieser Reihenfolge", async () => {
        const { io, aufrufe } = ersatz();
        const e = await fuehreAus(SHA, voll, io);
        expect(aufrufe).toEqual([
            "lint",
            "format",
            "typen",
            "tests",
            "bau",
            "besucherpaket",
            "bereit",
            "browser-1",
            "browser-2",
            "browser-3",
            "browser-4",
        ]);
        expect(e.rot).toEqual([]);
        expect(e.teile.map((t) => [t.klasse, t.status, t.exit])).toEqual([
            ["voll", "gruen", 0],
            ["browser-1", "gruen", 0],
            ["browser-2", "gruen", 0],
            ["browser-3", "gruen", 0],
            ["browser-4", "gruen", 0],
        ]);
        // Die Browserteile tragen ihren Namen und, mit jedem grünen Teil, den Beleg des Rohberichts.
        expect(e.teile[2]).toMatchObject({ klasse: "browser-2", name: "Teil 2" });
        for (const t of e.teile) expect(t.beleg, t.klasse).toMatch(/^[a-f0-9]{64}$/);
    });

    it("🔴 daraus wird der Nachweis Version 3, den Claudios Leser kennen (fünf Klassen, alle grün)", async () => {
        const e = await fuehreAus(SHA, voll, ersatz().io);
        const n: ReleaseNachweis = {
            version: 3,
            sha: SHA,
            umgebung: "b".repeat(64),
            start: new Date(Date.now() - 2000).toISOString(),
            ende: new Date().toISOString(),
            status: "gruen",
            teile: e.teile,
            belege: Object.fromEntries(RELEASE_BELEGE.map((d) => [d, "c".repeat(64)])),
        };
        expect(releaseGruen(n, SHA, "b".repeat(64))).toBe(true);
    });
});

describe("🔴 Ein roter Schritt bricht den Lauf nicht ab", () => {
    it("rotes Lint: Format, Typen, Vitest, Bau, Besucherpaket und alle vier Browserteile laufen trotzdem", async () => {
        const { io, aufrufe } = ersatz({ lint: exitBefund("lint", 1) });
        const e = await fuehreAus(SHA, voll, io);
        expect(aufrufe).toEqual([
            "lint",
            "format",
            "typen",
            "tests",
            "bau",
            "besucherpaket",
            "bereit",
            "browser-1",
            "browser-2",
            "browser-3",
            "browser-4",
        ]);
        expect(e.rot.map((r) => [r.klasse, r.schritt, r.art])).toEqual([["voll", "lint", "rot"]]);
        expect(e.teile.find((t) => t.klasse === "voll")).toMatchObject({ status: "rot", exit: 1 });
        // Ein roter Teil trägt keinen Beleg (es gibt nichts zu übernehmen).
        expect(e.teile.find((t) => t.klasse === "voll")?.beleg).toBeUndefined();
        expect(e.teile.filter((t) => t.status === "gruen")).toHaveLength(4);
    });

    it("roter Vitest und zwei rote Browserteile: Die Liste nennt alle, der letzte Browserteil lief auch", async () => {
        const { io, aufrufe } = ersatz({
            tests: befund("Vitest: 3 rot, 0 übersprungen, 0 todo"),
            "browser-2": befund("Browserteil 2 (Teil 2): 1 rot", "Browserteil 2: 1 rot"),
            "browser-4": befund("Browserteil 4 (Teil 4): 2 rot", "Browserteil 4: 2 rot"),
        });
        const e = await fuehreAus(SHA, voll, io);
        expect(aufrufe).toContain("browser-4");
        expect(e.rot.map((r) => r.schritt)).toEqual(["tests", "browser-2", "browser-4"]);
        expect(e.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["voll", "rot"],
            ["browser-1", "gruen"],
            ["browser-2", "rot"],
            ["browser-3", "gruen"],
            ["browser-4", "rot"],
        ]);
        // fehler.txt: eine Zeile je roten Schritt, in der Reihenfolge des Laufs; die Notiz: die Kurzfassungen.
        expect(fehlerText(e.rot)).toBe(
            "Vitest: 3 rot, 0 übersprungen, 0 todo\nBrowserteil 2 (Teil 2): 1 rot\nBrowserteil 4 (Teil 4): 2 rot",
        );
        const fehler = new TeileRot(e.rot);
        expect(fehler.message).toBe(fehlerText(e.rot));
        expect(rotNotiz(SHA, "2026-10-24T00:00:00.000Z", notizGrundTeile(fehler.eintraege.map((r) => r.kurz)))).toBe(
            `${SHA} 2026-10-24T00:00:00.000Z rot\nLauf fehlgeschlagen: Vitest: 3 rot, 0 übersprungen, 0 todo; Browserteil 2: 1 rot; Browserteil 4: 2 rot\n`,
        );
    });

    it("alle sechs Schritte von voll rot und alle Browserteile rot: zehn Zeilen, nichts bleibt ungefahren", async () => {
        const rot: Record<string, Befund> = {};
        for (const s of ["lint", "format", "typen", "bau"]) rot[s] = exitBefund(s, 1);
        rot["tests"] = befund("Vitest: 1 rot");
        for (const id of TEIL_IDS) rot[id] = befund(`Browserteil ${id.slice(-1)} (x): 1 rot`);
        const e = await fuehreAus(SHA, voll, ersatz(rot).io);
        // Das Besucherpaket entfällt hinter dem roten Bau (eigene Zeile), die übrigen neun sind rot.
        expect(e.rot).toHaveLength(10);
        expect(e.rot.filter((r) => r.art === "uebersprungen").map((r) => r.schritt)).toEqual(["besucherpaket"]);
        expect(e.teile.every((t) => t.status === "rot")).toBe(true);
    });

    it("ein roter Bau: das Besucherpaket entfällt mit Grund, die Browserteile laufen weiter", async () => {
        const { io, aufrufe } = ersatz({ bau: exitBefund("bau", 1) });
        const gemeldet: [string, SchrittStatus, string | undefined][] = [];
        const e = await fuehreAus(SHA, voll, io, { schritt: (id, s, g) => gemeldet.push([id, s, g]) });
        expect(aufrufe).not.toContain("besucherpaket");
        expect(aufrufe).toContain("browser-1");
        expect(e.rot.map((r) => [r.schritt, r.art])).toEqual([
            ["bau", "rot"],
            ["besucherpaket", "uebersprungen"],
        ]);
        expect(e.rot[1]?.meldung).toBe("besucherpaket nicht gelaufen: der Release-Bau ist rot");
        expect(gemeldet).toContainEqual(["besucherpaket", "uebersprungen", "der Release-Bau ist rot"]);
    });

    it("ein Schritt, der wirft (statt einen Befund zu liefern), ist rot und hält den Lauf nicht an", async () => {
        const { io, aufrufe } = ersatz();
        const kaputt: AblaufIo = {
            ...io,
            schritt: (name) => {
                aufrufe.push(name);
                return name === "format"
                    ? Promise.reject(new Error("spawn node ENOENT\nzweite Zeile"))
                    : Promise.resolve(null);
            },
        };
        const e = await fuehreAus(SHA, voll, kaputt);
        expect(aufrufe).toContain("browser-4");
        expect(e.rot).toHaveLength(1);
        expect(e.rot[0]).toMatchObject({ schritt: "format", art: "rot", meldung: "spawn node ENOENT" });
    });

    it("🔴 ein roter Lauf ergibt keinen gültigen Nachweis", async () => {
        const e = await fuehreAus(SHA, voll, ersatz({ "browser-3": befund("Browserteil 3 (x): 1 rot") }).io);
        const n: ReleaseNachweis = {
            version: 3,
            sha: SHA,
            umgebung: "b".repeat(64),
            start: new Date(Date.now() - 2000).toISOString(),
            ende: new Date().toISOString(),
            status: "gruen",
            teile: e.teile,
            belege: Object.fromEntries(RELEASE_BELEGE.map((d) => [d, "c".repeat(64)])),
        };
        expect(releaseGruen(n, SHA, "b".repeat(64))).toBe(false);
    });
});

describe("Was entfällt", () => {
    it("Martin lässt sich nicht starten: Alle Browserteile entfallen mit dem Grund, voll läuft, der Lauf ist rot", async () => {
        const { io, aufrufe } = ersatz({}, "Martin ließ sich nicht starten");
        const e = await fuehreAus(SHA, voll, io);
        expect(aufrufe).toContain("bereit");
        for (const id of TEIL_IDS) expect(aufrufe).not.toContain(id);
        expect(e.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["voll", "gruen"],
            ["browser-1", "uebersprungen"],
            ["browser-2", "uebersprungen"],
            ["browser-3", "uebersprungen"],
            ["browser-4", "uebersprungen"],
        ]);
        expect(e.rot).toHaveLength(4);
        expect(e.rot[0]).toMatchObject({
            klasse: "browser-1",
            art: "uebersprungen",
            meldung: "Browserteil 1 (Teil 1) nicht gelaufen: Martin ließ sich nicht starten",
            kurz: "Browserteil 1 nicht gelaufen: Martin ließ sich nicht starten",
        });
    });

    it("eine unbrauchbare Teilzuordnung: Die Browserteile entfallen, ohne dass nach Martin gefragt wird", async () => {
        const { io, aufrufe } = ersatz();
        const e = await fuehreAus(
            SHA,
            { ...voll, browserProblem: "Teilzuordnung fehlt (apps/web/e2e/release-teile.json)" },
            io,
        );
        expect(aufrufe).not.toContain("bereit");
        expect(e.rot.map((r) => r.art)).toEqual(["uebersprungen", "uebersprungen", "uebersprungen", "uebersprungen"]);
        expect(e.rot[0]?.meldung).toContain("Teilzuordnung fehlt");
        expect(e.teile.find((t) => t.klasse === "voll")?.status).toBe("gruen");
    });

    it("eine Frage nach Martin, die wirft, lässt die Browserteile entfallen statt den Lauf zu beenden", async () => {
        const { io } = ersatz();
        const e = await fuehreAus(SHA, voll, { ...io, browserBereit: () => Promise.reject(new Error("Port belegt")) });
        expect(e.rot).toHaveLength(4);
        expect(e.rot[0]?.meldung).toContain("Port belegt");
    });
});

describe("Eine Wiederholung fährt nur den Rest", () => {
    it("voll übernommen: Vitest und Co. laufen nicht, die roten Browserteile schon", async () => {
        const { io, aufrufe } = ersatz();
        const e = await fuehreAus(
            SHA,
            { voll: false, browser: [teile[1] as TeilZuordnung, teile[3] as TeilZuordnung], browserProblem: null },
            io,
        );
        expect(aufrufe).toEqual(["bereit", "browser-2", "browser-4"]);
        for (const s of VOLL_SCHRITTE) expect(aufrufe).not.toContain(s);
        expect(e.teile.map((t) => t.klasse)).toEqual(["browser-2", "browser-4"]);
        expect(e.rot).toEqual([]);
    });

    it("nur voll neu: Martin wird nicht gefragt", async () => {
        const { io, aufrufe } = ersatz();
        await fuehreAus(SHA, { voll: true, browser: [], browserProblem: null }, io);
        expect(aufrufe).not.toContain("bereit");
        expect(aufrufe).toContain("tests");
    });

    it("🔴 übernommene und neue Teile zusammen sind erst grün, wenn alle fünf grün sind", async () => {
        const { io } = ersatz();
        const neu = await fuehreAus(
            SHA,
            { voll: false, browser: [teile[1] as TeilZuordnung], browserProblem: null },
            io,
        );
        const uebernommen: ReleaseTeil[] = ["voll", "browser-1", "browser-3", "browser-4"].map((klasse) => ({
            sha: SHA,
            klasse,
            status: "gruen",
            exit: 0,
            beleg: "d".repeat(64),
        }));
        const n = (teile: ReleaseTeil[]): ReleaseNachweis => ({
            version: 3,
            sha: SHA,
            umgebung: "b".repeat(64),
            start: new Date(Date.now() - 2000).toISOString(),
            ende: new Date().toISOString(),
            status: "gruen",
            teile,
            belege: Object.fromEntries(RELEASE_BELEGE.map((d) => [d, "c".repeat(64)])),
        });
        expect(releaseGruen(n([...uebernommen, ...neu.teile]), SHA, "b".repeat(64))).toBe(true);
        expect(releaseGruen(n(uebernommen), SHA, "b".repeat(64))).toBe(false);
        const rot = await fuehreAus(
            SHA,
            { voll: false, browser: [teile[1] as TeilZuordnung], browserProblem: null },
            ersatz({ "browser-2": befund("Browserteil 2 (x): 1 rot") }).io,
        );
        expect(releaseGruen(n([...uebernommen, ...rot.teile]), SHA, "b".repeat(64))).toBe(false);
    });
});

describe("Die Meldung eines Browserteils aus seinem Bericht", () => {
    const bericht = (stats: Record<string, number>, extra: object = {}): unknown => ({
        stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...stats },
        suites: [],
        errors: [],
        ...extra,
    });
    const teil = { id: "browser-2", name: "Gebiete" };

    it("grün: Exit 0, Fälle gelaufen, nichts rot, nichts übersprungen", () => {
        expect(browserBefund(teil, 0, bericht({ expected: 400 }))).toBeNull();
    });

    it("rot: nennt die Zahlen, in der langen und der kurzen Fassung", () => {
        expect(browserBefund(teil, 1, bericht({ expected: 397, unexpected: 3 }))).toEqual({
            meldung: "Browserteil 2 (Gebiete): 3 rot",
            kurz: "Browserteil 2: 3 rot",
        });
        expect(browserBefund(teil, 1, bericht({ expected: 300, unexpected: 2, flaky: 1, skipped: 4 }))?.meldung).toBe(
            "Browserteil 2 (Gebiete): 2 rot, 1 wackelig, 4 übersprungen",
        );
    });

    it("🔴 ein übersprungener Fall macht den Teil rot, auch bei Exit 0", () => {
        expect(browserBefund(teil, 0, bericht({ expected: 399, skipped: 1 }))?.meldung).toBe(
            "Browserteil 2 (Gebiete): 1 übersprungen",
        );
    });

    it("kein gelaufener Fall oder Fehler im Lauf ist rot", () => {
        expect(browserBefund(teil, 0, bericht({}))?.meldung).toBe("Browserteil 2 (Gebiete): kein Fall gelaufen");
        expect(browserBefund(teil, 1, bericht({ expected: 10 }, { errors: [{ message: "x" }] }))?.meldung).toBe(
            "Browserteil 2 (Gebiete): 1 Fehler im Lauf",
        );
    });

    it("ohne lesbaren Bericht (Absturz) nennt die Meldung den Exitcode", () => {
        expect(browserBefund(teil, 1, undefined)).toEqual({
            meldung: "Browserteil 2 (Gebiete): Bericht fehlt oder ist unlesbar (Exit 1)",
            kurz: "Browserteil 2: Bericht fehlt oder ist unlesbar (Exit 1)",
        });
        expect(browserBefund(teil, null, null)?.meldung).toContain("Exit null");
    });

    it("Exit ungleich 0 bei sonst grünen Zahlen ist rot und nennt den Exitcode", () => {
        expect(browserBefund(teil, 3, bericht({ expected: 10 }))?.meldung).toBe("Browserteil 2 (Gebiete): Exit 3");
    });

    it("Exit- und Zeitmeldungen anderer Schritte", () => {
        expect(exitBefund("lint", 2)).toEqual({ meldung: "lint: Exit 2", kurz: "lint: Exit 2" });
        expect(zeitBefund("tests", 120)).toEqual({
            meldung: "tests: Zeitüberschreitung (120 min)",
            kurz: "tests: Zeitüberschreitung",
        });
    });
});

describe("Haken", () => {
    it("melden jeden Schritt und jeden Teil, sobald er endet", async () => {
        const schritte: string[] = [];
        const abgeschlossen: string[] = [];
        await fuehreAus(
            SHA,
            voll,
            ersatz({ "browser-1": befund("Browserteil 1 (x): 1 rot", "Browserteil 1: 1 rot") }).io,
            {
                schritt: (id, status, grund) =>
                    schritte.push(`${id}:${status}${grund === undefined ? "" : `:${grund}`}`),
                teil: (t) => abgeschlossen.push(`${t.klasse}:${t.status}`),
            },
        );
        expect(schritte).toEqual([
            "lint:gruen",
            "format:gruen",
            "typen:gruen",
            "tests:gruen",
            "bau:gruen",
            "besucherpaket:gruen",
            "browser-1:rot:Browserteil 1: 1 rot",
            "browser-2:gruen",
            "browser-3:gruen",
            "browser-4:gruen",
        ]);
        expect(abgeschlossen).toEqual([
            "voll:gruen",
            "browser-1:rot",
            "browser-2:gruen",
            "browser-3:gruen",
            "browser-4:gruen",
        ]);
    });
});

// ───────────────────────── Das Release-Tor (Profil `tor`, WI-0264) ─────────────────────────

const KERN_ECHT: TeilZuordnung = {
    id: "kern-echt",
    name: "Tor",
    bereiche: ["wege"],
    specs: ["wegeditor-echt.spec.ts"],
};
const tor: AblaufPlan = { voll: false, bau: true, daten: true, browser: [KERN_ECHT], browserProblem: null };

describe("🔴 Das Tor fährt bau, daten und kern-echt, in dieser Folge", () => {
    it("alles grün: Lint, Typen, Bau, dann daten, dann kern-echt; kein Format, kein Vitest, kein Besucherpaket", async () => {
        const { io, aufrufe } = ersatz();
        const e = await fuehreAus(SHA, tor, io);
        expect(aufrufe).toEqual(["lint", "typen", "bau", "daten", "bereit", "kern-echt"]);
        expect([...BAU_SCHRITTE]).toEqual(["lint", "typen", "bau"]);
        expect(e.rot).toEqual([]);
        expect(e.teile.map((t) => [t.klasse, t.status, t.exit])).toEqual([
            ["bau", "gruen", 0],
            ["daten", "gruen", 0],
            ["kern-echt", "gruen", 0],
        ]);
        expect(e.teile[2]).toMatchObject({ name: "Tor" });
        for (const t of e.teile) expect(t.beleg, t.klasse).toMatch(/^[a-f0-9]{64}$/);
    });

    it("🔴 daraus wird ein gültiger Nachweis mit Profil tor (genau die drei Teile), ohne daten oder ohne kern-echt nicht", async () => {
        const e = await fuehreAus(SHA, tor, ersatz().io);
        const n = (teile: ReleaseTeil[]): ReleaseNachweis => ({
            version: 3,
            sha: SHA,
            umgebung: "b".repeat(64),
            start: new Date(Date.now() - 2000).toISOString(),
            ende: new Date().toISOString(),
            status: "gruen",
            profil: "tor",
            teile,
            belege: Object.fromEntries(releaseBelege("tor").map((d) => [d, "c".repeat(64)])),
        });
        expect(releaseKlassen("tor")).toEqual(["bau", "daten", "kern-echt"]);
        expect(releaseGruen(n(e.teile), SHA, "b".repeat(64))).toBe(true);
        expect(releaseGruen(n(e.teile.filter((t) => t.klasse !== "daten")), SHA, "b".repeat(64))).toBe(false);
        expect(releaseGruen(n(e.teile.filter((t) => t.klasse !== "kern-echt")), SHA, "b".repeat(64))).toBe(false);
    });

    it("ein roter Lint hält Typen und Bau nicht an, daten und kern-echt laufen auch; der Teil bau ist rot", async () => {
        const { io, aufrufe } = ersatz({ lint: exitBefund("lint", 1) });
        const e = await fuehreAus(SHA, tor, io);
        expect(aufrufe).toEqual(["lint", "typen", "bau", "daten", "bereit", "kern-echt"]);
        expect(e.rot.map((r) => [r.klasse, r.schritt, r.art])).toEqual([["bau", "lint", "rot"]]);
        expect(e.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["bau", "rot"],
            ["daten", "gruen"],
            ["kern-echt", "gruen"],
        ]);
        expect(e.teile[0]?.beleg).toBeUndefined();
    });

    it("ein roter Teil daten hält kern-echt nicht an; die Zeile in fehler.txt nennt ihn", async () => {
        const rot = befund("Daten: 2 rot, 0 übersprungen, 0 todo");
        const e = await fuehreAus(SHA, tor, ersatz({ daten: rot }).io);
        expect(e.rot.map((r) => [r.klasse, r.schritt])).toEqual([["daten", "daten"]]);
        expect(e.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["bau", "gruen"],
            ["daten", "rot"],
            ["kern-echt", "gruen"],
        ]);
        expect(fehlerText(e.rot)).toBe("Daten: 2 rot, 0 übersprungen, 0 todo");
    });

    it("Martin lässt sich nicht starten: kern-echt entfällt mit Grund, bau und daten laufen", async () => {
        const { io } = ersatz({}, "Martin ließ sich nicht starten");
        const e = await fuehreAus(SHA, tor, io);
        expect(e.teile.map((t) => [t.klasse, t.status])).toEqual([
            ["bau", "gruen"],
            ["daten", "gruen"],
            ["kern-echt", "uebersprungen"],
        ]);
        expect(e.rot[0]).toMatchObject({
            klasse: "kern-echt",
            art: "uebersprungen",
            meldung: "Browserteil kern-echt (Tor) nicht gelaufen: Martin ließ sich nicht starten",
        });
    });

    it("eine Wiederholung: bau und daten übernommen, nur kern-echt läuft (Martin wird gefragt)", async () => {
        const { io, aufrufe } = ersatz();
        const plan: AblaufPlan = { voll: false, bau: false, daten: false, browser: [KERN_ECHT], browserProblem: null };
        const e = await fuehreAus(SHA, plan, io);
        expect(aufrufe).toEqual(["bereit", "kern-echt"]);
        expect(e.teile.map((t) => t.klasse)).toEqual(["kern-echt"]);
    });

    it("die Haken melden jeden Schritt (lint, typen, bau, daten, kern-echt) und jeden Teil", async () => {
        const schritte: string[] = [];
        const teileGemeldet: string[] = [];
        await fuehreAus(SHA, tor, ersatz({ typen: exitBefund("typen", 2) }).io, {
            schritt: (id, status) => schritte.push(`${id}:${status}`),
            teil: (t) => teileGemeldet.push(`${t.klasse}:${t.status}`),
        });
        expect(schritte).toEqual(["lint:gruen", "typen:rot", "bau:gruen", "daten:gruen", "kern-echt:gruen"]);
        expect(teileGemeldet).toEqual(["bau:rot", "daten:gruen", "kern-echt:gruen"]);
    });

    it("Profil B und voll fahren weder bau noch daten (der Plan ohne die neuen Felder ist der alte)", async () => {
        const { io, aufrufe } = ersatz();
        await fuehreAus(SHA, voll, io);
        expect(aufrufe).not.toContain("daten");
        expect(aufrufe.filter((a) => a === "lint")).toHaveLength(1);
    });
});

describe("🔴 Ein wackeliger Fall zählt nur in kern-echt als grün", () => {
    const bericht = (stats: Record<string, number>, extra: object = {}): unknown => ({
        stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...stats },
        suites: [],
        errors: [],
        ...extra,
    });

    it("kern-echt: ein Fall im zweiten Versuch grün (Exit 0): grün", () => {
        expect(browserBefund(KERN_ECHT, 0, bericht({ expected: 19, flaky: 1 }))).toBeNull();
        expect(browserBefund(KERN_ECHT, 0, bericht({ expected: 0, flaky: 2 }))).toBeNull();
    });

    it("kern-echt: Rot bleibt rot, die Meldung nennt dann die roten Fälle, nicht die wackeligen", () => {
        expect(browserBefund(KERN_ECHT, 1, bericht({ expected: 17, unexpected: 2, flaky: 1 }))?.meldung).toBe(
            "Browserteil kern-echt (Tor): 2 rot",
        );
    });

    it("kern-echt: übersprungene Fälle, kein gelaufener Fall, Fehler im Lauf und Exit ungleich 0 bleiben rot", () => {
        expect(browserBefund(KERN_ECHT, 0, bericht({ expected: 19, skipped: 1 }))?.meldung).toBe(
            "Browserteil kern-echt (Tor): 1 übersprungen",
        );
        expect(browserBefund(KERN_ECHT, 0, bericht({}))?.meldung).toBe(
            "Browserteil kern-echt (Tor): kein Fall gelaufen",
        );
        expect(browserBefund(KERN_ECHT, 0, bericht({ expected: 5 }, { errors: [{ message: "x" }] }))?.meldung).toBe(
            "Browserteil kern-echt (Tor): 1 Fehler im Lauf",
        );
        expect(browserBefund(KERN_ECHT, 2, bericht({ expected: 5, flaky: 1 }))?.meldung).toBe(
            "Browserteil kern-echt (Tor): Exit 2",
        );
    });

    it("jeder andere Teil und jedes andere Profil hält an der alten Regel fest: wackelig ist rot", () => {
        expect([...WACKELIG_GRUEN]).toEqual(["kern-echt"]);
        for (const id of ["browser-1", "browser-2", "browser-3", "browser-4", "kern"])
            expect(browserBefund({ id, name: "x" }, 0, bericht({ expected: 19, flaky: 1 }))?.meldung, id).toContain(
                "1 wackelig",
            );
    });
});

describe("Die Meldung des Teils daten aus dem Vitest-Bericht", () => {
    const DATEI = "apps/server/test/schreibwege-app-rolle.test.ts";
    const erwartet = [`/x/checkout/${DATEI}`];
    const bericht = (v: Record<string, unknown> = {}): unknown => ({
        success: true,
        numTotalTests: 120,
        numPassedTests: 120,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        testResults: [{ name: `/x/checkout/${DATEI}`, status: "passed" }],
        ...v,
    });

    it("grün: Exit 0, alle Fälle gelaufen, die Testdatei grün im Bericht", () => {
        expect(datenBefund(0, bericht(), erwartet)).toBeNull();
    });

    it("rot: nennt die Zahlen mit dem Wort „Daten“ (nicht „Vitest“), kurz und lang gleich", () => {
        const b = datenBefund(
            1,
            bericht({
                success: false,
                numFailedTests: 3,
                numPassedTests: 117,
                testResults: [{ name: erwartet[0], status: "failed" }],
            }),
            erwartet,
        );
        expect(b).toEqual({
            meldung: "Daten: 3 rot, 0 übersprungen, 0 todo",
            kurz: "Daten: 3 rot, 0 übersprungen, 0 todo",
        });
    });

    it("🔴 todo ist grün: eine Route ohne eigenen Fall meldet der Test, sie hält nichts an (2 im Stand 2026-10-30)", () => {
        expect(
            datenBefund(0, bericht({ numTotalTests: 220, numPassedTests: 218, numTodoTests: 2 }), erwartet),
        ).toBeNull();
    });

    it("🔴 übersprungen ist rot: Ohne PostgreSQL überspringt sich der Test still, das ist kein Tor", () => {
        const b = datenBefund(0, bericht({ numTotalTests: 120, numPassedTests: 1, numPendingTests: 119 }), erwartet);
        expect(b?.meldung).toContain("119 übersprungen");
    });

    it("die erwartete Testdatei fehlt im Bericht oder gar kein Fall: rot", () => {
        expect(datenBefund(0, bericht({ testResults: [] }), erwartet)?.meldung).toContain("fehlt im Bericht");
        expect(datenBefund(0, bericht({ numTotalTests: 0, numPassedTests: 0 }), erwartet)?.meldung).toContain(
            "keine Fälle im Bericht",
        );
    });

    it("ohne lesbaren Bericht nennt die Meldung den Exitcode; Exit ungleich 0 bei grünem Bericht ist rot", () => {
        expect(datenBefund(1, undefined, erwartet)).toEqual({
            meldung: "Daten: Bericht fehlt oder ist unlesbar (Exit 1)",
            kurz: "Daten: Bericht fehlt oder ist unlesbar (Exit 1)",
        });
        expect(datenBefund(null, null, erwartet)?.meldung).toContain("Exit null");
        expect(datenBefund(3, bericht(), erwartet)).toEqual(exitBefund("daten", 3));
    });
});
