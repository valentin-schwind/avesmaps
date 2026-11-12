// Das Routing-Gate im Release-Test bei bewegten Daten (WI-0248; Vali wählte am 2026-10-26: „Ja: Der Runner prüft vor dem Lauf, ob die Routing-Revision
// zur Basislinie passt, und macht bei Abweichung die Gegenprobe mit dem Code der Basislinie selbst.“). Ohne Datenbank: Kindprozesse und Git sind ersetzt,
// die Dateien liegen echt im Temp-Ordner, die Verweise sind echte Junctions (unter Windows) bzw. Symlinks.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GATE_VERGLEICH_ENV, loadComparison } from "../src/routing/corpus-gate-run.ts";
import { schritteAusFehlerText } from "../../../scripts/dev/release-bericht.ts";
import {
    BASISLINIE_CODE_PFADE,
    BASISLINIE_PFAD,
    bereiteRoutingGateVor,
    datenAusreisser,
    entscheideRoutingWeg,
    leseRoutingWeg,
    ROUTING_DATEI,
    ROUTING_VERGLEICH_ENV,
    routingZeilen,
    vitestMitRouting,
    type Faelle,
    type RoutingIo,
} from "../../../scripts/dev/release-routing.ts";
import { baueBerichtSeite } from "../../../scripts/dev/release-seite.ts";

const SHA = "d".repeat(40);
const BASIS_COMMIT = "b".repeat(40);

const fall = (label: string, travelHours: number, outcome = "route") => ({
    label,
    result: { outcome, travelHours, path: "p", segments: 3 },
});

const ordner: string[] = [];
afterEach(() => {
    for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});
const temp = (name: string): string => {
    const o = mkdtempSync(join(tmpdir(), `release-routing-${name}-`));
    ordner.push(o);
    return o;
};

describe("Entscheidung und Ausreißer", () => {
    it("die Basislinie passt nur bei gleichem Kurzschlüssel der Routing-Revision", () => {
        expect(entscheideRoutingWeg("94e028166a9a", "94e028166a9a")).toBe("passt");
        expect(entscheideRoutingWeg("94e028166a9a", "6a32b79f9cfc")).toBe("gegenprobe");
    });

    it("🔴 Ausreißer der Daten: über 15 % Reisezeit oder ein anderer Ausgang, der größte zuerst; ein neuer Fall ist keiner", () => {
        const basislinie: Faelle = {
            a: fall("A", 100),
            b: fall("B", 100),
            c: fall("C", 64.9),
            d: fall("D", 166.3),
            e: fall("E", 0, "no_route:network_disconnected"),
        };
        const vergleich: Faelle = {
            a: fall("A", 115), // genau 15 %: kein Ausreißer
            b: fall("B", 80), // −20 %
            c: fall("C", 113.4), // +75 %
            d: fall("D", 0, "unresolved:not_found:Schwarzkuhl"),
            e: fall("E", 0, "no_route:network_disconnected"),
            neu: fall("Neu", 10),
        };
        const gefunden = datenAusreisser(basislinie, vergleich);
        expect(gefunden.map((x) => x.id)).toEqual(["d", "c", "b"]);
        expect(gefunden[0]).toMatchObject({ anteil: null, ausgang: "route → unresolved:not_found:Schwarzkuhl" });
        expect(gefunden[1]?.anteil).toBeCloseTo(0.747, 3);
    });
});

describe("Die Zeile im Bericht", () => {
    it("nennt, welcher Weg galt: Basislinie passt, Gegenprobe mit Commit und Revision samt Ausreißern, oder gescheitert", () => {
        expect(routingZeilen({ weg: "passt", revision: "94e028166a9a" })).toEqual([
            "- Routing-Gate: Basislinie passt (Revision `94e028166a9a`)",
        ]);
        const gegenprobe = routingZeilen({
            weg: "gegenprobe",
            commit: BASIS_COMMIT,
            revision: "abcdefabcdef",
            basislinie: "94e028166a9a",
            ausreisser: [
                { id: "corpus-16", label: "Boronaya > Moorburg", vorher: 64.9, nachher: 113.4, anteil: 0.747 },
                {
                    id: "corpus-12",
                    label: "Unterfels > Schwarzkuhl",
                    vorher: 166.3,
                    nachher: 0,
                    anteil: null,
                    ausgang: "route → unresolved:not_found:Schwarzkuhl",
                },
                { id: "corpus-14", label: "Horasia > Oase", vorher: 170.1, nachher: 120.3, anteil: -0.292 },
            ],
        });
        expect(gegenprobe[0]).toBe(
            "- Routing-Gate: Gegenprobe mit `bbbbbbbbbbbb` auf Revision `abcdefabcdef` (Basislinie `94e028166a9a`); Ausreißer der Daten über 15 % Reisezeit: 3",
        );
        expect(gegenprobe.slice(1)).toEqual([
            "  - corpus-16 (Boronaya > Moorburg): 64,9 → 113,4 h (+75 %)",
            "  - corpus-12 (Unterfels > Schwarzkuhl): route → unresolved:not_found:Schwarzkuhl",
            "  - corpus-14 (Horasia > Oase): 170,1 → 120,3 h (−29 %)",
        ]);
        expect(
            routingZeilen({
                weg: "gegenprobe",
                commit: BASIS_COMMIT,
                revision: "abcdefabcdef",
                basislinie: "94e028166a9a",
                ausreisser: [],
            }),
        ).toEqual([
            "- Routing-Gate: Gegenprobe mit `bbbbbbbbbbbb` auf Revision `abcdefabcdef` (Basislinie `94e028166a9a`); keine Ausreißer der Daten über 15 %",
        ]);
        expect(routingZeilen({ weg: "gescheitert", grund: "Commit der Basislinie nicht gefunden" })).toEqual([
            "- Routing-Gate: gescheitert, der Vitest-Teil ist rot: Commit der Basislinie nicht gefunden",
        ]);
    });

    it("steht im Kopf von bericht.md, wenn der Lauf sie ablegte, und fehlt bei Läufen von vorher", () => {
        const lauf = temp("seite");
        writeFileSync(
            join(lauf, "status.json"),
            JSON.stringify({ version: 3, sha: SHA, status: "gruen", profil: "B", teile: [], belege: {} }),
        );
        expect(baueBerichtSeite({ ordner: lauf, offen: null })).not.toContain("Routing-Gate");
        writeFileSync(
            join(lauf, ROUTING_DATEI),
            JSON.stringify({
                weg: "gegenprobe",
                commit: BASIS_COMMIT,
                revision: "abcdefabcdef",
                basislinie: "94e028166a9a",
                ausreisser: [
                    { id: "corpus-16", label: "Boronaya > Moorburg", vorher: 64.9, nachher: 113.4, anteil: 0.747 },
                ],
            }),
        );
        const seite = baueBerichtSeite({ ordner: lauf, offen: null });
        expect(seite).toContain("- Routing-Gate: Gegenprobe mit `bbbbbbbbbbbb` auf Revision `abcdefabcdef`");
        expect(seite).toContain("  - corpus-16 (Boronaya > Moorburg): 64,9 → 113,4 h (+75 %)");
        expect(leseRoutingWeg(lauf)?.weg).toBe("gegenprobe");
    });
});

describe("Der Befund des Vitest-Teils", () => {
    it("ohne gescheiterte Vorbereitung bleibt er, wie Vitest ihn meldet", () => {
        const v = { meldung: "Vitest: 1 rot, 0 übersprungen, 0 todo", kurz: "Vitest: 1 rot, 0 übersprungen, 0 todo" };
        expect(vitestMitRouting(null, v)).toBe(v);
        expect(vitestMitRouting(null, null)).toBeNull();
    });

    it("🔴 eine gescheiterte Vorbereitung ist rot, auch wenn Vitest sonst nichts meldet, und gehört zum Schritt tests", () => {
        const routing = {
            meldung: "Routing-Gate: Code der Basislinie bbbbbbbbbbbb lässt sich nicht bauen (shared, Exit 2)",
            kurz: "Routing-Gate: Vorbereitung gescheitert",
        };
        const allein = vitestMitRouting(routing, null);
        expect(allein?.meldung).toBe(
            "Vitest: Routing-Gate: Code der Basislinie bbbbbbbbbbbb lässt sich nicht bauen (shared, Exit 2)",
        );
        const mit = vitestMitRouting(routing, {
            meldung: "Vitest: 0 rot, 8 übersprungen, 0 todo",
            kurz: "Vitest: 0 rot, 8 übersprungen, 0 todo",
        });
        expect(mit?.meldung).toBe(
            "Vitest: Routing-Gate: Code der Basislinie bbbbbbbbbbbb lässt sich nicht bauen (shared, Exit 2); 0 rot, 8 übersprungen, 0 todo",
        );
        expect(mit?.kurz).toBe("Vitest: Routing-Gate: Vorbereitung gescheitert; 0 rot, 8 übersprungen, 0 todo");
        expect(schritteAusFehlerText(mit?.meldung ?? "").rot).toEqual(["tests"]);
    });
});

describe("Vergleichsstand: derselbe Vertrag auf beiden Seiten", () => {
    it("Runner und Gate nennen dieselbe Variable; das Gate liest nur einen echten Vergleichsstand", () => {
        expect(ROUTING_VERGLEICH_ENV).toBe(GATE_VERGLEICH_ENV);
        const o = temp("vergleich");
        const gut = join(o, "gut.json");
        writeFileSync(
            gut,
            JSON.stringify({ recorded: "2026-10-26", code: BASIS_COMMIT, revision: { map: "m" }, keys: {}, cases: {} }),
        );
        expect(loadComparison(gut).code).toBe(BASIS_COMMIT);
        const ohneCode = join(o, "ohne.json");
        writeFileSync(ohneCode, JSON.stringify({ recorded: "2026-10-26", revision: { map: "m" }, cases: {} }));
        expect(() => loadComparison(ohneCode)).toThrow("kein Vergleichsstand");
    });
});

describe("🔴 Vorbereitung vor dem Vitest-Teil (Kindprozesse und Git ersetzt)", () => {
    interface Aufruf {
        exe: string;
        args: readonly string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
    }

    /** Ein Klon des Kandidaten mit Basislinie und Installation (eine Markierung in `node_modules`, die das Aufräumen nie treffen darf). */
    function welt(basislinieSchluessel = "94e028166a9a") {
        const kopie = temp("kopie");
        const basis = temp("lauf");
        mkdirSync(dirname(join(kopie, ...BASISLINIE_PFAD.split("/"))), { recursive: true });
        writeFileSync(
            join(kopie, ...BASISLINIE_PFAD.split("/")),
            JSON.stringify({
                keys: { routing_graph_revision: basislinieSchluessel },
                cases: { c1: fall("Eins", 100), c2: fall("Zwei", 50) },
            }),
        );
        mkdirSync(join(kopie, "node_modules", "paket"), { recursive: true });
        writeFileSync(join(kopie, "node_modules", "paket", "markierung.txt"), "bleibt");
        return { kopie, basis, markierung: join(kopie, "node_modules", "paket", "markierung.txt") };
    }

    function io(o: {
        schluessel: string;
        commit?: string;
        revisionExit?: number;
        bauExit?: number;
        faelle?: Faelle;
    }): RoutingIo & { aufrufe: Aufruf[] } {
        const aufrufe: Aufruf[] = [];
        return {
            aufrufe,
            git: (args) => {
                expect(args).toEqual(["log", "-1", "--format=%H", SHA, "--", BASISLINIE_PFAD]);
                return `${o.commit ?? BASIS_COMMIT}\n`;
            },
            async prozess(exe, args, cwd, env) {
                aufrufe.push({ exe, args, cwd, env });
                if (args[1] === "revision") {
                    if ((o.revisionExit ?? 0) !== 0) return o.revisionExit ?? 1;
                    writeFileSync(
                        args[3] as string,
                        JSON.stringify({
                            revision: { map: "neu" },
                            schluessel: o.schluessel,
                            faelle: [{ id: "c1" }, { id: "c2" }],
                        }),
                    );
                    return 0;
                }
                if (exe === "git") {
                    // Der Code der Basislinie im Arbeitsbaum des Laufs, so wie `git checkout <commit> -- <pfade>` ihn schriebe.
                    const ziel = args[args.indexOf("--work-tree") + 1] as string;
                    mkdirSync(join(ziel, "packages", "shared"), { recursive: true });
                    mkdirSync(join(ziel, "apps", "server", "src"), { recursive: true });
                    writeFileSync(join(ziel, "apps", "server", "src", "alt.ts"), "export {};");
                    return 0;
                }
                if (String(args[0]).endsWith("tsc")) {
                    // Die Installation des Kandidaten ist über den Verweis erreichbar.
                    expect(readFileSync(join(cwd, "..", "..", "node_modules", "paket", "markierung.txt"), "utf8")).toBe(
                        "bleibt",
                    );
                    return o.bauExit ?? 0;
                }
                if (args[1] === "faelle") {
                    writeFileSync(
                        args[4] as string,
                        JSON.stringify({ faelle: o.faelle ?? { c1: fall("Eins", 160), c2: fall("Zwei", 51) } }),
                    );
                    return 0;
                }
                throw new Error(`unerwarteter Aufruf ${exe} ${args.join(" ")}`);
            },
        };
    }

    it("passt die Revision, gilt die Basislinie wie bisher: kein Vergleichsstand, kein alter Code", async () => {
        const w = welt();
        const ersatz = io({ schluessel: "94e028166a9a" });
        const r = await bereiteRoutingGateVor({ basis: w.basis, kopie: w.kopie, sha: SHA, env: {}, io: ersatz });
        expect(r).toEqual({ weg: { weg: "passt", revision: "94e028166a9a" }, vergleich: null, befund: null });
        expect(ersatz.aufrufe).toHaveLength(1);
        expect(leseRoutingWeg(w.basis)).toEqual({ weg: "passt", revision: "94e028166a9a" });
    });

    it("🔴 weicht sie ab: Code der Basislinie auschecken, bauen, die Fälle des Kandidaten rechnen; Vergleichsstand im Laufordner, alter Code wieder weg", async () => {
        const w = welt();
        const ersatz = io({ schluessel: "abcdefabcdef" });
        const r = await bereiteRoutingGateVor({
            basis: w.basis,
            kopie: w.kopie,
            sha: SHA,
            env: { DATABASE_URL: "postgres://korpus" },
            io: ersatz,
            heute: "2026-10-26",
        });
        expect(r.befund).toBeNull();
        expect(r.weg).toEqual({
            weg: "gegenprobe",
            commit: BASIS_COMMIT,
            revision: "abcdefabcdef",
            basislinie: "94e028166a9a",
            ausreisser: [{ id: "c1", label: "Eins", vorher: 100, nachher: 160, anteil: 0.6 }],
        });
        expect(r.vergleich).toBe(join(w.basis, "routing-vergleich.json"));
        expect(loadComparison(r.vergleich as string)).toEqual({
            recorded: "2026-10-26",
            code: BASIS_COMMIT,
            revision: { map: "neu" },
            keys: { routing_graph_revision: "abcdefabcdef", map_revision: "", terrain_revision: null },
            cases: { c1: fall("Eins", 160), c2: fall("Zwei", 51) },
        });
        // Nur die Pfade der Routenrechnung, mit eigenem Index im Laufordner (der Klon des Kandidaten bleibt unberührt).
        const checkout = ersatz.aufrufe.find((a) => a.exe === "git");
        expect(checkout?.args.slice(-BASISLINIE_CODE_PFADE.length - 2)).toEqual([
            BASIS_COMMIT,
            "--",
            ...BASISLINIE_CODE_PFADE,
        ]);
        expect(checkout?.env["GIT_INDEX_FILE"]).toBe(join(w.basis, "routing-basislinie.index"));
        // Gerechnet mit dem alten Code, gegen den Korpus der Schritte.
        const rechnen = ersatz.aufrufe.find((a) => a.args[1] === "faelle");
        expect(rechnen?.args[2]).toBe(join(w.basis, "routing-basislinie"));
        expect(rechnen?.env["DATABASE_URL"]).toBe("postgres://korpus");
        // Aufgeräumt: alter Code und Index weg, die Installation des Kandidaten unberührt.
        expect(existsSync(join(w.basis, "routing-basislinie"))).toBe(false);
        expect(existsSync(join(w.basis, "routing-basislinie.index"))).toBe(false);
        expect(readFileSync(w.markierung, "utf8")).toBe("bleibt");
    });

    it.each([
        [
            "der alte Code baut nicht",
            { schluessel: "abcdefabcdef", bauExit: 2 },
            "Code der Basislinie bbbbbbbbbbbb lässt sich nicht bauen (shared, Exit 2)",
        ],
        [
            "die Revision des Korpus ist nicht lesbar",
            { schluessel: "abcdefabcdef", revisionExit: 1 },
            "Routing-Revision des Korpus nicht lesbar (Exit 1, routing-gate.txt)",
        ],
        [
            "der Commit der Basislinie fehlt",
            { schluessel: "abcdefabcdef", commit: "" },
            "Commit der Basislinie nicht gefunden",
        ],
        [
            "der alte Code liefert nicht jeden Fall",
            { schluessel: "abcdefabcdef", faelle: { c1: fall("Eins", 100) } },
            "Gegenprobe mit bbbbbbbbbbbb ohne Ergebnis für c2",
        ],
    ])("🔴 scheitert die Gegenprobe (%s), ist der Teil rot mit genau diesem Grund", async (_, ersatz, grund) => {
        const w = welt();
        const r = await bereiteRoutingGateVor({ basis: w.basis, kopie: w.kopie, sha: SHA, env: {}, io: io(ersatz) });
        expect(r.weg).toEqual({ weg: "gescheitert", grund });
        expect(r.vergleich).toBeNull();
        expect(r.befund).toEqual({ meldung: `Routing-Gate: ${grund}`, kurz: "Routing-Gate: Vorbereitung gescheitert" });
        expect(leseRoutingWeg(w.basis)).toEqual({ weg: "gescheitert", grund });
        expect(existsSync(join(w.basis, "routing-vergleich.json"))).toBe(false);
        expect(existsSync(join(w.basis, "routing-basislinie"))).toBe(false);
        expect(readFileSync(w.markierung, "utf8")).toBe("bleibt");
    });
});
