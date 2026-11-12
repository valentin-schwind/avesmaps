// Die vier Browserteile des Release-Tests nach Thema (WI-0248, `scripts/dev/release-teile.ts`, `apps/web/e2e/release-teile.json`):
// Jede Spec der Hauptconfig liegt in genau einem Teil, keine fehlt, und der Filter, den Playwright bekommt, wählt genau diese Specs.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    TEIL_IDS,
    TeileFehler,
    ladeKern,
    ladeTor,
    ladeZuordnung,
    leseTeileDatei,
    listeSpecs,
    listeSpecsMitGenannten,
    musterRegex,
    ordneZu,
    playwrightFilter,
    pruefeTeileDatei,
    zuordnungProblem,
} from "../../../scripts/dev/release-teile.ts";
import { istHauptconfigSpec, NUR_GENANNT } from "../../web/e2e/spec-auswahl.ts";

const wurzel = fileURLToPath(new URL("../../../", import.meta.url));
const e2e = fileURLToPath(new URL("../../web/e2e/", import.meta.url));

const datei = (teile: Record<string, string[]>): unknown => ({
    version: 1,
    teile: TEIL_IDS.map((id, i) => ({
        id,
        name: `Teil ${String(i + 1)}`,
        bereiche: ["orte"],
        dateien: teile[id] ?? ["nichts.spec.ts"],
    })),
});

describe("🔴 Die Teile decken die Specs der Hauptconfig ab", () => {
    it("jede Spec der Hauptconfig liegt in genau einem Teil, keine fehlt, kein Muster läuft ins Leere", () => {
        const z = ladeZuordnung(wurzel);
        // Eine neue Spec, die kein Muster trifft, steht hier: dem Teil zuordnen, zu dem ihr Thema gehört (`release-teile.json`).
        expect(z.fehlend, "Specs in keinem Teil").toEqual([]);
        expect(z.mehrfach, "Specs in mehreren Teilen").toEqual([]);
        // Ein Muster ohne Treffer ist der Rest einer gelöschten oder umbenannten Spec.
        expect(z.leereMuster, "Muster ohne Treffer").toEqual([]);
        expect(zuordnungProblem(z)).toBeNull();
        expect(z.teile.map((t) => t.id)).toEqual([...TEIL_IDS]);
        const alle = z.teile.flatMap((t) => t.specs);
        expect(new Set(alle).size).toBe(alle.length);
        expect(alle.sort()).toEqual(listeSpecs(e2e));
    });

    it("die Auswahl ist die der Hauptconfig: Blätter, Build-Probe und nur genannte Proben fehlen, Touch-Specs sind dabei", () => {
        const specs = listeSpecs(e2e);
        // Jede Datei im Ordner, die als Testdatei gilt, ist entweder in der Auswahl oder ein Blatt, die Build-Probe oder eine nur genannte Probe.
        const alleTestdateien = readdirSync(e2e).filter((n) => /\.spec\.ts$/.test(n));
        const draussen = alleTestdateien.filter((n) => !specs.includes(n));
        for (const n of draussen)
            expect(
                /-review\.spec\.ts$/.test(n) ||
                    n === "production-build.spec.ts" ||
                    n === "status-page-live.spec.ts" ||
                    n === "curve-label-martin.spec.ts" ||
                    n === "wegeditor-echt.spec.ts" ||
                    n === "flaechen-echt.spec.ts" ||
                    // Zwei Personen am selben Gebirge (WI-0265 B5c): braucht die Tor-Welt, ist aber kein Kernablauf des Tors.
                    n === "aenderungen-ruecknahme.spec.ts" ||
                    // Die Kernabläufe des Release-Tors brauchen die Welt (WI-0264): nur genannt, im Teil kern-echt.
                    /^tor-[a-z.-]+\.spec\.ts$/.test(n),
                n,
            ).toBe(true);
        expect(draussen).toContain("production-build.spec.ts");
        expect(draussen).toContain("status-page-live.spec.ts");
        expect(draussen).toContain("curve-label-martin.spec.ts");
        expect(draussen).toContain("wegeditor-echt.spec.ts");
        expect(draussen).toContain("flaechen-echt.spec.ts");
        expect(draussen).toContain("tor-besucher.spec.ts");
        expect(specs).toContain("camera.touch.spec.ts");
        expect(specs).toContain("kamera-fluchtpunkt-editoren.spec.ts");
        expect(specs.some((n) => n.endsWith("-review.spec.ts"))).toBe(false);
        expect(istHauptconfigSpec("x-review.spec.ts")).toBe(false);
        expect(istHauptconfigSpec("production-build.spec.ts")).toBe(false);
        expect(istHauptconfigSpec("status-page-live.spec.ts")).toBe(false);
        expect(istHauptconfigSpec("karte.touch.spec.ts")).toBe(true);
        expect(istHauptconfigSpec("karte-hilfe.ts")).toBe(false);
    });

    it("🔴 die Hauptconfig liest diese Auswahl: dieselben Muster, nicht eine Abschrift", () => {
        const config = readFileSync(fileURLToPath(new URL("../../web/playwright.config.ts", import.meta.url)), "utf8");
        expect(config).toContain('from "./e2e/spec-auswahl.ts"');
        for (const name of ["BUILD_SPEC", "NUR_GENANNT", "SHEET_SPECS"]) {
            expect(config, name).toMatch(
                new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "./e2e/spec-auswahl.ts"`),
            );
            // Kein eigenes Muster neben dem importierten.
            expect(config, name).not.toMatch(new RegExp(`const ${name}\\b`));
        }
    });

    it("die Teile haben Name, Bereiche und feste Kennungen; die Namen sind verschieden", () => {
        const d = leseTeileDatei(wurzel);
        expect(d.teile.map((t) => t.id)).toEqual(["browser-1", "browser-2", "browser-3", "browser-4"]);
        expect(new Set(d.teile.map((t) => t.name)).size).toBe(4);
        for (const t of d.teile) {
            expect(t.name.length, t.id).toBeGreaterThan(3);
            expect(t.bereiche.length, t.id).toBeGreaterThan(2);
            expect(new Set(t.bereiche).size, t.id).toBe(t.bereiche.length);
        }
    });

    it("die Teile sind ungefähr gleich groß (nach Dateien): keiner unter einem Fünftel, keiner über einem Drittel aller Specs", () => {
        const z = ladeZuordnung(wurzel);
        const gesamt = z.teile.reduce((s, t) => s + t.specs.length, 0);
        for (const t of z.teile) {
            expect(t.specs.length / gesamt, t.id).toBeGreaterThan(0.2);
            expect(t.specs.length / gesamt, t.id).toBeLessThan(0.34);
        }
    });
});

describe("Kern-Stichprobe (Prüfprofil B)", () => {
    it("alle genannten Specs gibt es und die Hauptconfig fährt sie", () => {
        const kern = ladeKern(wurzel);
        expect(kern.id).toBe("kern");
        expect(kern.specs.length).toBeGreaterThan(0);
        expect(() => playwrightFilter(kern.specs)).not.toThrow();
    });
});

describe("🔴 Kernabläufe des Release-Tors (Profil tor, WI-0264)", () => {
    it("alle genannten Specs gibt es, auch die nur auf Nennung laufenden; der Teil heißt kern-echt und trägt den Namen der Datei", () => {
        const tor = ladeTor(wurzel);
        const roh = JSON.parse(readFileSync(join(e2e, "release-tor.json"), "utf8")) as {
            name: string;
            specs: string[];
        };
        expect(tor.id).toBe("kern-echt");
        expect(tor.name).toBe(roh.name);
        expect(tor.specs).toContain("wegeditor-echt.spec.ts");
        expect(listeSpecs(e2e)).not.toContain("wegeditor-echt.spec.ts");
        expect(listeSpecsMitGenannten(e2e)).toContain("wegeditor-echt.spec.ts");
        expect(() => playwrightFilter(tor.specs)).not.toThrow();
        // Die Auswahl mit Genannten ist die der Hauptconfig plus die nur genannten Proben, nichts sonst (kein Blatt, keine Build-Probe).
        const mehr = listeSpecsMitGenannten(e2e).filter((n) => !listeSpecs(e2e).includes(n));
        for (const n of mehr)
            expect(
                NUR_GENANNT.some((name) => n.endsWith(`${name}.spec.ts`)),
                n,
            ).toBe(true);
        expect(mehr).not.toContain("production-build.spec.ts");
        expect(mehr.some((n) => n.endsWith("-review.spec.ts"))).toBe(false);
    });

    it("🔴 der Filter des Teils holt jede nur genannte Probe in den Lauf: die Config schließt sie nur aus, wenn ihr Name nicht im Aufruf steht", () => {
        const config = readFileSync(fileURLToPath(new URL("../../web/playwright.config.ts", import.meta.url)), "utf8");
        // Dieselbe Prüfung wie in der Hauptconfig (`NICHT_GENANNT`): das Argument, Schrägstriche vereinheitlicht, enthält den Namen.
        expect(config).toContain('argument.replace(/\\\\/g, "/").includes(name)');
        for (const name of NUR_GENANNT) {
            const argument = playwrightFilter([`${name}.spec.ts`]);
            expect(argument.replace(/\\/g, "/").includes(name), name).toBe(true);
            // Und der Ausdruck trifft die Datei selbst, nicht deren Nachbarn.
            const re = new RegExp(argument.slice(1, -1));
            expect(re.test(`/work/apps/web/e2e/${name}.spec.ts`), name).toBe(true);
            expect(re.test(`/work/apps/web/e2e/x-${name}.spec.ts`), name).toBe(false);
        }
    });

    describe("mit einem eigenen Ordner", () => {
        let w = "";
        const schreibe = (pfad: string, inhalt: string): void => {
            mkdirSync(dirname(join(w, pfad)), { recursive: true });
            writeFileSync(join(w, pfad), inhalt);
        };
        beforeAll(() => {
            w = mkdtempSync(join(tmpdir(), "release-tor-"));
            schreibe("apps/web/e2e/a.spec.ts", "");
            schreibe("apps/web/e2e/wegeditor-echt.spec.ts", "");
            schreibe("apps/web/e2e/x-review.spec.ts", "");
        });
        afterAll(() => rmSync(w, { recursive: true, force: true }));
        const datei = (pfad: string, specs: string[]): void =>
            schreibe(pfad, JSON.stringify({ version: 1, name: "N", bereiche: ["wege"], specs }));

        it("das Tor darf eine nur genannte Probe nennen, die Stichprobe von B nicht", () => {
            datei("apps/web/e2e/release-tor.json", ["a.spec.ts", "wegeditor-echt.spec.ts", "a.spec.ts"]);
            datei("apps/web/e2e/release-kern.json", ["a.spec.ts", "wegeditor-echt.spec.ts"]);
            expect(ladeTor(w)).toEqual({
                id: "kern-echt",
                name: "N",
                bereiche: ["wege"],
                specs: ["a.spec.ts", "wegeditor-echt.spec.ts"],
            });
            expect(() => ladeKern(w)).toThrow(/Kern-Stichprobe: Spec fehlt \(wegeditor-echt\.spec\.ts\)/u);
        });

        it("eine Spec, die es nicht (mehr) gibt, ein Blatt, eine fehlende oder leere Datei machen den Teil unbrauchbar", () => {
            datei("apps/web/e2e/release-tor.json", ["a.spec.ts", "weg.spec.ts"]);
            expect(() => ladeTor(w)).toThrow(/Tor-Kernabläufe: Spec fehlt \(weg\.spec\.ts\)/u);
            datei("apps/web/e2e/release-tor.json", ["x-review.spec.ts"]);
            expect(() => ladeTor(w)).toThrow(TeileFehler);
            datei("apps/web/e2e/release-tor.json", []);
            expect(() => ladeTor(w)).toThrow(/Name oder Specs fehlen/u);
            rmSync(join(w, "apps/web/e2e/release-tor.json"));
            expect(() => ladeTor(w)).toThrow(/Tor-Kernabläufe fehlt oder ist kein JSON/u);
        });
    });
});

describe("Zuordnung prüfen", () => {
    const specs = ["a.spec.ts", "b.spec.ts", "c.touch.spec.ts", "x/d.spec.ts"];

    it("ordnet nach Muster zu; `*` bleibt innerhalb eines Ordners", () => {
        const z = ordneZu(
            pruefeTeileDatei(
                datei({ "browser-1": ["a.spec.ts", "c.*.spec.ts"], "browser-2": ["b.spec.ts", "x/*.spec.ts"] }),
            ),
            specs,
        );
        expect(z.teile[0]?.specs).toEqual(["a.spec.ts", "c.touch.spec.ts"]);
        expect(z.teile[1]?.specs).toEqual(["b.spec.ts", "x/d.spec.ts"]);
        expect(z.fehlend).toEqual([]);
        expect(musterRegex("*.spec.ts").test("x/d.spec.ts")).toBe(false);
        expect(musterRegex("a.spec.ts").test("aXspec.ts")).toBe(false);
    });

    it("nennt eine Spec ohne Teil", () => {
        const z = ordneZu(pruefeTeileDatei(datei({ "browser-1": ["a.spec.ts"], "browser-2": ["b.spec.ts"] })), specs);
        expect(z.fehlend).toEqual(["c.touch.spec.ts", "x/d.spec.ts"]);
        expect(zuordnungProblem(z)).toContain("2 Spec(s) in keinem Teil");
        expect(zuordnungProblem(z)).toContain("c.touch.spec.ts");
    });

    it("nennt eine Spec in zwei Teilen und rechnet sie dem ersten zu", () => {
        const z = ordneZu(
            pruefeTeileDatei(
                datei({
                    "browser-1": ["a.spec.ts", "b.spec.ts", "c.touch.spec.ts", "x/d.spec.ts"],
                    "browser-2": ["b.spec.ts"],
                    "browser-3": ["a.spec.ts"],
                    "browser-4": ["x/*.spec.ts"],
                }),
            ),
            specs,
        );
        expect(z.mehrfach).toEqual([
            { datei: "a.spec.ts", teile: ["browser-1", "browser-3"] },
            { datei: "b.spec.ts", teile: ["browser-1", "browser-2"] },
            { datei: "x/d.spec.ts", teile: ["browser-1", "browser-4"] },
        ]);
        expect(zuordnungProblem(z)).toContain("in mehreren Teilen");
    });

    it("nennt ein Muster ohne Treffer und einen Teil ohne Spec", () => {
        const z = ordneZu(
            pruefeTeileDatei(
                datei({ "browser-1": ["a.spec.ts", "b.spec.ts", "c.touch.spec.ts", "x/d.spec.ts", "weg.spec.ts"] }),
            ),
            specs,
        );
        expect(z.leereMuster).toContainEqual({ teil: "browser-1", muster: "weg.spec.ts" });
        expect(zuordnungProblem(z)).toContain("browser-2 enthält keine Spec");
    });

    it.each([
        ["kein Objekt", "x"],
        ["falsche Version", { version: 2, teile: [] }],
        ["zu wenige Teile", { version: 1, teile: [] }],
        [
            "falsche Kennung",
            {
                version: 1,
                teile: ["browser-2", "browser-1", "browser-3", "browser-4"].map((id) => ({
                    id,
                    name: id,
                    bereiche: ["orte"],
                    dateien: ["a.spec.ts"],
                })),
            },
        ],
        [
            "Name fehlt",
            { version: 1, teile: TEIL_IDS.map((id) => ({ id, bereiche: ["orte"], dateien: ["a.spec.ts"] })) },
        ],
        [
            "Bereich mit Großbuchstaben",
            { version: 1, teile: TEIL_IDS.map((id) => ({ id, name: id, bereiche: ["Orte"], dateien: ["a.spec.ts"] })) },
        ],
        [
            "Muster mit Pfadsprung",
            {
                version: 1,
                teile: TEIL_IDS.map((id) => ({ id, name: id, bereiche: ["orte"], dateien: ["../a.spec.ts"] })),
            },
        ],
        [
            "doppelte Namen",
            {
                version: 1,
                teile: TEIL_IDS.map((id) => ({ id, name: "gleich", bereiche: ["orte"], dateien: ["a.spec.ts"] })),
            },
        ],
    ])("lehnt ab: %s", (_name, roh) => {
        expect(() => pruefeTeileDatei(roh)).toThrow(TeileFehler);
    });

    it("eine fehlende oder kaputte Datei ist ein Satz ohne Pfad", () => {
        let fehler: unknown;
        try {
            leseTeileDatei(fileURLToPath(new URL("./", import.meta.url)));
        } catch (e) {
            fehler = e;
        }
        expect(fehler).toBeInstanceOf(TeileFehler);
        expect((fehler as Error).message).toBe("Teilzuordnung fehlt (apps/web/e2e/release-teile.json)");
        expect((fehler as Error).message).not.toMatch(/[A-Za-z]:[\\/]/);
    });
});

describe("🔴 Der Filter für Playwright", () => {
    /** So liest Playwright 1.63 ein Dateiargument (`forceRegExp` und der Vergleich mit Pfad und Unix-Pfad). */
    const wieplaywright = (arg: string): ((pfad: string) => boolean) => {
        const m = arg.match(/^\/(.*)\/([gi]*)$/);
        const re = m ? new RegExp(m[1] ?? "", m[2]) : new RegExp(arg, "gi");
        return (pfad) => {
            re.lastIndex = 0;
            if (re.test(pfad)) return true;
            re.lastIndex = 0;
            return re.test(pfad.split("\\").join("/"));
        };
    };

    it("wählt genau die Specs des Teils, unter Windows- wie Unix-Pfaden, und keine Namensvettern", () => {
        const filter = wieplaywright(playwrightFilter(["info-panel.spec.ts", "map-fan.touch.spec.ts"]));
        for (const pfad of [
            "C:/x/checkout/apps/web/e2e/info-panel.spec.ts",
            "C:\\x\\checkout\\apps\\web\\e2e\\info-panel.spec.ts",
            "C:/x/checkout/apps/web/e2e/map-fan.touch.spec.ts",
        ])
            expect(filter(pfad), pfad).toBe(true);
        for (const pfad of [
            "C:/x/checkout/apps/web/e2e/legacy-info-panel.spec.ts",
            "C:/x/checkout/apps/web/e2e/info-panel.spec.ts.bak",
            "C:/x/checkout/apps/web/e2e/info-panelxspec.ts",
            "C:/x/checkout/apps/web/e2e/map-fan.spec.ts",
            "C:/x/checkout/apps/web/src/info-panel.spec.ts",
        ])
            expect(filter(pfad), pfad).toBe(false);
    });

    it("jeder Teil wählt über den Filter genau seine Specs und die der anderen nicht", () => {
        const z = ladeZuordnung(wurzel);
        const filter = z.teile.map((t) => ({ id: t.id, passt: wieplaywright(playwrightFilter(t.specs)) }));
        for (const t of z.teile)
            for (const spec of t.specs) {
                const treffer = filter.filter((f) => f.passt(`C:/x/checkout/apps/web/e2e/${spec}`)).map((f) => f.id);
                expect(treffer, spec).toEqual([t.id]);
            }
    });

    it("das Argument ist ein einziges Wort ohne Leerzeichen, Anführungszeichen und Zeilenangabe (kein Shell-Zerlegen, kein `:Zeile`)", () => {
        const z = ladeZuordnung(wurzel);
        for (const t of z.teile) {
            const arg = playwrightFilter(t.specs);
            expect(arg, t.id).toMatch(/^\/.*\/$/);
            expect(arg, t.id).not.toMatch(/[\s"'`]/);
            expect(arg, t.id).not.toMatch(/:\d+(:\d+)?$/);
            // Lang genug für 100 Specs, kurz genug für die Befehlszeile von Windows (32.767 Zeichen).
            expect(arg.length, t.id).toBeLessThan(8_000);
        }
    });

    it("ohne Specs gibt es keinen Filter (er wählte sonst alles)", () => {
        expect(() => playwrightFilter([])).toThrow(TeileFehler);
    });
});
