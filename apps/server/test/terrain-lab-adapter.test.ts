import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
    AuftragFehler,
    auftragFingerprint,
    kanonisch,
    normalisiere,
} from "../../../scripts/dev/terrain-lab/auftrag.ts";
import {
    ausGebirge,
    samplesFingerprint,
    schreibeRaster,
    schritteZuSamples,
    spiegeleZeilen,
} from "../../../scripts/dev/terrain-lab/austausch.ts";
import { fensterUm, gruppiere, schneideAus } from "../../../scripts/dev/terrain-lab/endgelaende.ts";
import { median, Stoppuhr } from "../../../scripts/dev/terrain-lab/messung.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { rueckennetzGitter } from "../src/terrain/inputs.ts";
import { pruefeBaum } from "../../../scripts/dev/terrain-lab/stand.ts";

/**
 * Der Generatoradapter des Terrain-Labs (WI-0250 Phase B, `scripts/dev/terrain-lab/`): Auftrag und Fingerabdruck, Austauschformat,
 * Sauberkeit des Baums, Fenster und Phasengruppen als reine Funktionen; dazu der Adapter als Prozess an einer kleinen Fixture (Vorschau)
 * und an einem Mini-Gelände (Endgelände ohne die ganze Karte, `TERRAIN_LAB`-Schnappschuss selbst gebaut).
 */

const WURZEL = fileURLToPath(new URL("../../../", import.meta.url));
const SKRIPT = join(WURZEL, "scripts", "dev", "terrain-lab", "rechne.ts");
const aufgeraeumt: string[] = [];
const tmp = (name: string): string => {
    const ordner = mkdtempSync(join(tmpdir(), `${name}-`));
    aufgeraeumt.push(ordner);
    return ordner;
};
afterAll(() => {
    for (const o of aufgeraeumt) rmSync(o, { recursive: true, force: true });
});

const grundauftrag = { gebirge: { fixture: "nordwalser-hoehen" }, stufe: "vorschau" };

describe("Auftrag", () => {
    it("füllt die Vorgaben und prüft die Stelle", () => {
        const a = normalisiere(grundauftrag, "x");
        expect(a).toMatchObject({
            name: "x",
            typ: null,
            reglerQuelle: "fixture",
            vorschau: { aufloesung: 1, kante: 640, talboden: "typ" },
            endgelaende: null,
            rezept: { fassung: null, ueberlagerung: null, roh: null },
        });
        expect(() => normalisiere({ ...grundauftrag, stufe: "unsinn" })).toThrow(/stufe/);
        expect(() => normalisiere({ ...grundauftrag, vorschau: { aufloesung: 3 } })).toThrow(/vorschau.aufloesung/);
        expect(() => normalisiere({ ...grundauftrag, regler: { erosion: "viel" } })).toThrow(/regler.erosion/);
        expect(() => normalisiere({ ...grundauftrag, modell: { unbekannt: 1 } })).toThrow(/modell.unbekannt/);
        expect(() => normalisiere({ ...grundauftrag, stufe: "saat", vorschau: {} })).toThrow(/nur bei stufe/);
        expect(() => normalisiere({ gebirge: { fixture: "a", datei: "b" }, stufe: "saat" })).toThrow(/genau eines/);
        expect(() => normalisiere({ gebirge: { fixture: "../x" }, stufe: "saat" })).toThrow(AuftragFehler);
    });

    it("der Fingerabdruck hängt am Ergebnis, nicht an Name, Reihenfolge oder Pfad", () => {
        const inhalte = { gebirgeDatei: null, schnappschuss: null };
        const fp = (o: object): string => auftragFingerprint(normalisiere(o), inhalte);
        const basis = fp(grundauftrag);
        expect(fp({ name: "anders", ...grundauftrag })).toBe(basis);
        expect(fp({ stufe: "vorschau", gebirge: { fixture: "nordwalser-hoehen" } })).toBe(basis);
        expect(fp({ ...grundauftrag, regler: { erosion: 7, koernung: 3 } })).toBe(
            fp({ ...grundauftrag, regler: { koernung: 3, erosion: 7 } }),
        );
        for (const anders of [
            { regler: { erosion: 7 } },
            { saat: 1 },
            { typ: "plateaugebirge" },
            { vorschau: { aufloesung: 2 } },
            { rezept: { fassung: 19 } },
            { modell: { talboden: 0.3 } },
            { gebirge: { fixture: "trollzacken" } },
        ])
            expect(fp({ ...grundauftrag, ...anders })).not.toBe(basis);
        // Dateien zählen mit Inhalt, nicht mit Pfad.
        const d1 = normalisiere({ gebirge: { datei: "a.json" }, stufe: "saat" });
        const d2 = normalisiere({ gebirge: { datei: "b.json" }, stufe: "saat" });
        const inh = (h: string) => ({ gebirgeDatei: h, schnappschuss: null });
        expect(auftragFingerprint(d1, inh("x"))).toBe(auftragFingerprint(d2, inh("x")));
        expect(auftragFingerprint(d1, inh("x"))).not.toBe(auftragFingerprint(d1, inh("y")));
        const e1 = normalisiere({
            ...grundauftrag,
            stufe: "endgelaende-lokal",
            vorschau: undefined,
            endgelaende: { schnappschuss: "p1" },
        });
        const e2 = normalisiere({
            ...grundauftrag,
            stufe: "endgelaende-lokal",
            vorschau: undefined,
            endgelaende: { schnappschuss: "p2" },
        });
        expect(auftragFingerprint(e1, { gebirgeDatei: null, schnappschuss: "s" })).toBe(
            auftragFingerprint(e2, { gebirgeDatei: null, schnappschuss: "s" }),
        );
    });

    it("kanonisch sortiert Schlüssel und lässt undefined weg", () => {
        expect(kanonisch({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
            '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
        );
    });
});

describe("Austauschformat", () => {
    it("spiegelt die Zeilen und maskiert außerhalb der Fläche mit NaN", () => {
        const eigen = Uint8Array.from([1, 1, 0, 1]);
        const r = ausGebirge([10, 20, 30, 40], eigen, 2, 2, 0.25, { a: 1 });
        expect(r.zellgroesse_m).toBe(750);
        // Zeile 0 war Süd (10, 20) und steht danach unten; 30 liegt außerhalb der Fläche.
        expect(Array.from(r.hoehen.slice(0, 2)).map(Number.isNaN)).toEqual([true, false]);
        expect(r.hoehen[2]).toBe(10);
        expect(r.hoehen[3]).toBe(20);
        expect(Array.from(spiegeleZeilen(Uint16Array.from([1, 2, 3, 4, 5, 6]), 2, 3))).toEqual([5, 6, 3, 4, 1, 2]);
        expect(() => spiegeleZeilen(new Float32Array(5), 2, 3)).toThrow(RangeError);
    });

    it("Schritt wird gerundet und geklemmt, Fingerabdruck über die little-endian-Bytes", () => {
        const s = schritteZuSamples([-5, 0.4, 0.5, 1.49, 70000, 12], Uint8Array.from([1, 1, 1, 1, 1, 0]));
        expect(Array.from(s)).toEqual([0, 0, 1, 1, 65535, 0]);
        const bytes = Buffer.from([1, 0, 0, 1]); // 1 und 256
        expect(samplesFingerprint(Uint16Array.from([1, 256]))).toBe(createHash("sha256").update(bytes).digest("hex"));
    });

    it("schreibt Kopf und Prüfsumme so, wie terrainlab.raster sie liest", () => {
        const ordner = tmp("austausch");
        const hoehen = Float32Array.from([1.5, Number.NaN, 3, 4]);
        const g = schreibeRaster(ordner, "r", {
            breite: 2,
            hoehe: 2,
            zellgroesse_m: 750,
            hoehen,
            herkunft: { quelle: "test" },
        });
        const kopf = JSON.parse(readFileSync(join(ordner, "r.json"), "utf8")) as Record<string, unknown>;
        const bytes = readFileSync(join(ordner, "r.f32"));
        expect(bytes.length).toBe(16);
        expect(kopf).toEqual({
            format: "avesmaps-hoehenraster",
            version: 1,
            breite: 2,
            hoehe: 2,
            zellgroesse_m: 750,
            hoehe_einheit: "m",
            nodata: null,
            herkunft: { quelle: "test" },
            sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        expect(g.sha256).toBe(kopf["sha256"]);
        expect(bytes.readFloatLE(0)).toBe(1.5);
        expect(Number.isNaN(bytes.readFloatLE(4))).toBe(true);
    });
});

describe("Fenster und Phasen des Endgeländes", () => {
    it("das Fenster um den Rahmen, vom Norden gezählt", () => {
        const f = fensterUm({ min_x: 424.873, min_y: 658.495, max_x: 466.19, max_y: 710.238 }, 6, 8192);
        expect(f.cell_e).toBe(0.125);
        expect(f.gx0).toBe(Math.floor((424.873 - 6) / 0.125));
        expect(f.gy0).toBe(Math.floor((1024 - (710.238 + 6)) / 0.125));
        expect(f.w).toBe(Math.ceil((466.19 + 6) / 0.125) - f.gx0);
        // am Rand der Karte wird abgeschnitten
        const rand = fensterUm({ min_x: 0, min_y: 0, max_x: 10, max_y: 1024 }, 6, 512);
        expect(rand.gx0).toBe(0);
        expect(rand.gy0).toBe(0);
        expect(rand.h).toBe(512);
    });

    it("schneidet je nach Lage von Zeile 0 dasselbe Fenster aus", () => {
        const n = 8;
        const nord = new Float32Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) nord[j * n + i] = j * 10 + i;
        const sued = spiegeleZeilen(nord, n, n);
        const f = { n, gx0: 2, gy0: 1, w: 3, h: 2, cell_e: 128 };
        const a = schneideAus({ n, cell: 128, zeile0: "nord", hoehe: nord }, f);
        const b = schneideAus({ n, cell: 128, zeile0: "sued", hoehe: sued }, f);
        expect(Array.from(a)).toEqual([12, 13, 14, 22, 23, 24]);
        expect(Array.from(b)).toEqual(Array.from(a));
    });

    it("gruppiert die Phasen beider Wege gleich", () => {
        const produktiv = { saat: 5, "grob:mask": 10, "grob:seed": 20, "grob:abschluss": 1, fein: 7, schluss: 3 };
        expect(gruppiere(produktiv, false)).toEqual({ saat: 5, grob: 31, fein: 7, schluss: 3 });
        const nachbau = {
            saat: 5,
            landforms: 10,
            seed: 20,
            "grob-constraints-summits": 1,
            "fine-tiles": 7,
            "fein-constraints-water": 2,
            "fein-verify": 1,
        };
        expect(gruppiere(nachbau, true)).toEqual({ saat: 5, grob: 31, fein: 7, schluss: 3 });
    });

    it("Stoppuhr und Median", () => {
        const u = new Stoppuhr();
        u.markiere("a");
        u.markiere("a");
        u.markiere("b");
        expect(Object.keys(u.ms)).toEqual(["a", "b"]);
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 2, 3])).toBe(2.5);
        expect(Number.isNaN(median([]))).toBe(true);
    });
});

describe("Sauberkeit des Baums", () => {
    function git(cwd: string, ...args: string[]): void {
        const r = spawnSync(
            "git",
            ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
            { cwd, encoding: "utf8" },
        );
        if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    }

    it("meldet Änderungen nur in den Generator-Verzeichnissen", () => {
        const repo = tmp("baum");
        git(repo, "init", "-q");
        mkdirSync(join(repo, "packages", "shared", "src"), { recursive: true });
        mkdirSync(join(repo, "docs"), { recursive: true });
        writeFileSync(join(repo, "packages", "shared", "src", "a.ts"), "export const a = 1;\n");
        writeFileSync(join(repo, "docs", "d.md"), "x\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "start");
        const sauber = pruefeBaum(repo);
        expect(sauber).toMatchObject({ art: "arbeitsbaum", sauber: true, geaendert: [], aenderung_sha256: null });
        expect(sauber.commit).toMatch(/^[0-9a-f]{40}$/);

        writeFileSync(join(repo, "docs", "d.md"), "geändert\n");
        expect(pruefeBaum(repo).sauber).toBe(true);

        writeFileSync(join(repo, "packages", "shared", "src", "a.ts"), "export const a = 2;\n");
        const geaendert = pruefeBaum(repo);
        expect(geaendert.sauber).toBe(false);
        expect(geaendert.geaendert.join(" ")).toContain("packages/shared/src/a.ts");
        expect(geaendert.aenderung_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(pruefeBaum(repo).aenderung_sha256).toBe(geaendert.aenderung_sha256);

        writeFileSync(join(repo, "packages", "shared", "src", "neu.ts"), "export const b = 1;\n");
        const mitNeuer = pruefeBaum(repo);
        expect(mitNeuer.geaendert.some((z) => z.startsWith("??") && z.includes("neu.ts"))).toBe(true);
        expect(mitNeuer.aenderung_sha256).not.toBe(geaendert.aenderung_sha256);

        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "zwei");
        expect(pruefeBaum(repo).sauber).toBe(true);
    });
});

/** Die Felder der `meta.json`, die die Tests lesen (vollständig: tools/terrain-lab/docs/lauf.md). */
interface Meta {
    laeufe: { art: string; wall_ms: number; cpu_ms: number; rss_spitze_mib: number; fremdlast_kerne: number }[];
    deterministisch: boolean;
    eingabe_fingerprint: string;
    raster: { ergebnis_fingerprint: string; zellgroesse_m: number; dateien: { name: string }[] };
    phasenproben: { ergebnis_gleich: boolean; phasen_ms: Record<string, number> } | null;
    stand: { art: string };
    rezept: { fassung: number; roh_angewendet: boolean };
    zusatz: { voll_fingerprint: string; fein_kacheln_gerechnet: number; erosion: { iterationen: number } };
    parameter: {
        schnappschuss: { inhalt_sha256: string };
        rueckennetz_gitter?: { zelle: number; mitte: number } | null;
        rueckennetz_netz?: boolean;
        rueckennetz_aktiv?: boolean;
    };
    gruppen_ms: Record<string, number>;
    phasen_ms: Record<string, number>;
    zwischenstaende: { phase: string; name: string; fingerprint: string }[] | null;
}

function adapter(
    auftrag: object,
    ausgabe: string,
    ...optionen: string[]
): { status: number; meta: Meta | null; stderr: string } {
    const datei = join(
        ausgabe,
        "..",
        `${createHash("sha1").update(JSON.stringify(auftrag)).digest("hex").slice(0, 8)}.json`,
    );
    writeFileSync(datei, JSON.stringify(auftrag));
    const r = spawnSync(
        process.execPath,
        ["--expose-gc", "--max-old-space-size=4096", SKRIPT, datei, ausgabe, ...optionen],
        {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        },
    );
    const meta = join(ausgabe, "meta.json");
    return {
        status: r.status ?? -1,
        meta: existsSync(meta) ? (JSON.parse(readFileSync(meta, "utf8")) as Meta) : null,
        stderr: r.stderr,
    };
}

describe("Adapter als Prozess: Vorschau", () => {
    it("misst kalt und warm, schreibt Meta und Raster, bleibt bei denselben Bytes", () => {
        const ausgabe = join(tmp("vorschau"), "o");
        const r = adapter(
            { ...grundauftrag, rezept: { fassung: 19 } },
            ausgabe,
            "--warm",
            "1",
            "--phasen",
            "--phasen-wiederholungen",
            "1",
            "--schmutzig-erlauben",
        );
        expect(r.stderr).toBe("");
        expect(r.status).toBe(0);
        const m = r.meta!;
        expect(m.laeufe.map((l) => l.art)).toEqual(["kalt", "warm"]);
        expect(m.deterministisch).toBe(true);
        expect(m.raster.ergebnis_fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(m.raster.zellgroesse_m).toBe(750);
        expect(m.raster.dateien[0]!.name).toBe("vorschau-1x");
        expect(m.phasenproben!.ergebnis_gleich).toBe(true);
        expect(Object.keys(m.phasenproben!.phasen_ms)).toEqual(["netz_hebung", "landschaft"]);
        for (const l of m.laeufe) {
            expect(l.wall_ms).toBeGreaterThan(0);
            expect(l.cpu_ms).toBeGreaterThan(0);
            expect(l.rss_spitze_mib).toBeGreaterThan(50);
            expect(l.fremdlast_kerne).toBeGreaterThanOrEqual(0);
        }
        expect(existsSync(join(ausgabe, "vorschau-1x.f32"))).toBe(true);
        expect(m.stand).toMatchObject({ art: "arbeitsbaum" });
        expect(m.rezept.fassung).toBe(19);
        // Dieselbe Rechnung noch einmal in einem frischen Prozess: dieselben Bytes.
        const zweiter = adapter(
            { ...grundauftrag, rezept: { fassung: 19 } },
            join(tmp("vorschau"), "o"),
            "--ohne-raster",
            "--schmutzig-erlauben",
        );
        expect(zweiter.meta!.raster.ergebnis_fingerprint).toBe(m.raster.ergebnis_fingerprint);
        expect(zweiter.meta!.raster.dateien).toEqual([]);
        // Ein Regler ändert das Gelände und den Fingerabdruck der Eingabe.
        const anders = adapter(
            { ...grundauftrag, rezept: { fassung: 19 }, regler: { erosion: 9 } },
            join(tmp("vorschau"), "o"),
            "--ohne-raster",
            "--schmutzig-erlauben",
        );
        expect(anders.meta!.raster.ergebnis_fingerprint).not.toBe(m.raster.ergebnis_fingerprint);
        expect(anders.meta!.eingabe_fingerprint).not.toBe(m.eingabe_fingerprint);
    }, 120_000);

    it("verweigert die Messung eines unsauberen Baums und meldet falsche Eingaben", () => {
        const ordner = tmp("fehler");
        const falsch = adapter({ ...grundauftrag, stufe: "unsinn" }, join(ordner, "o"));
        expect(falsch.status).toBe(2);
        expect(falsch.stderr).toMatch(/stufe/);
        const fremd = adapter(grundauftrag, join(ordner, "p"), "--fingerprint", "--commit", "gibt-es-nicht");
        expect(fremd.status).toBe(4);
    }, 60_000);
});

/** Ein Schnappschuss wie der des echten Laufs, aber mit 12 × 12 Saaten und einer Karte, die in Sekunden rechnet. */
function mini(ordner: string): { fixture: string; schnappschuss: string } {
    const polygon = (x0: number, y0: number, x1: number, y1: number) => ({
        type: "Polygon" as const,
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    });
    const rn = polygon(200, 200, 248, 248);
    const v12 = polygon(600, 600, 648, 648);
    const land = polygon(0, 0, 1024, 1024);
    const saat = (x0: number) => {
        const samples = new Uint16Array(144);
        for (let k = 0; k < samples.length; k++)
            samples[k] = Math.round(1600 + 500 * Math.cos(((k % 12) * 2 * Math.PI) / 4));
        return { cell: 4, originX: x0 + 2, originY: x0 + 2, width: 12, height: 12, samples };
    };
    const seeds = [saat(200), saat(600)];
    let offset = 0;
    const seedsMeta = seeds.map((s, i) => {
        const m = {
            id: i === 0 ? "rn-mini" : "v12-mini",
            name: i === 0 ? "RN" : "V12",
            cell: s.cell,
            originX: s.originX,
            originY: s.originY,
            width: s.width,
            height: s.height,
            offset,
        };
        offset += s.samples.byteLength;
        return m;
    });
    const snap = join(ordner, "snap");
    mkdirSync(snap, { recursive: true });
    writeFileSync(
        join(snap, "inputs.json"),
        JSON.stringify({
            continent: { id: "land", fingerprint: "land", geometry: land },
            land: [land],
            water: [],
            landscapes: [
                { layer: "topographie", type: "gebirge", geometry: rn },
                { layer: "topographie", type: "gebirge", geometry: v12 },
            ],
            peaks: [{ id: "p", name: "Gipfel", x: 224, y: 224, h: 2200 }],
            rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
            fingerprint: "mini",
            seedsMeta,
        }),
    );
    writeFileSync(join(snap, "seeds.u16"), Buffer.concat(seeds.map((s) => Buffer.from(s.samples.buffer))));
    writeFileSync(
        join(snap, "gebirge.json"),
        JSON.stringify({
            id: "rn-mini",
            name: "RN",
            input: { bounds: { min_x: 200, min_y: 200, max_x: 248, max_y: 248 } },
        }),
    );
    writeFileSync(join(snap, "master.json"), JSON.stringify({ fingerprint: "mini", size: 512 }));
    writeFileSync(join(snap, "master.u16"), Buffer.alloc(512 * 512 * 2));
    const fixture = join(ordner, "mini-fixture.json");
    writeFileSync(
        fixture,
        JSON.stringify({
            name: "Mini",
            area: "rn-mini",
            input: {
                bounds: { min_x: 200, min_y: 200, max_x: 248, max_y: 248 },
                geometry: { type: "MultiPolygon", coordinates: [rn.coordinates] },
                peaks: [{ x: 224, y: 224, h: 2200 }],
                kurve: [],
                fluesse: [],
                seen: [],
                regler: {
                    koernung: 9,
                    stufen: 4,
                    erosion: 5,
                    plateau: 1,
                    hypsometrie: 0.4,
                    maximalhoehe: 2300,
                    bergform: 2.5,
                    rauschen: 0.5,
                    sattel: 0.92,
                    talbreite: 1.1,
                    einschnitt: 1100,
                },
                saat: 42,
                nebengipfel: [{ x: 236, y: 212, h: 1800 }],
                kaemme: [
                    {
                        punkte: [
                            [208, 208],
                            [220, 224],
                            [232, 232],
                            [242, 242],
                        ],
                        rang: "haupt",
                    },
                ],
            },
            paesse: [],
        }),
    );
    return { fixture, schnappschuss: snap };
}

describe("Adapter als Prozess: Endgelände an einem Mini-Gelände", () => {
    it("beide Wege (computeLocalTerrain und Nachbau mit Beobachter) rechnen dieselben Bytes", () => {
        const wurzel = tmp("mini");
        const { fixture, schnappschuss } = mini(wurzel);
        const auftrag = (zwischenstaende: boolean) => ({
            gebirge: { datei: fixture },
            stufe: "endgelaende-lokal",
            modell: { talboden: 0.3 },
            endgelaende: { schnappschuss, rand: 20, zwischenstaende },
            // Verkleinerte Größen wie im Test des Beobachters; dafür gibt es keinen Katalogwert, also roh.
            rezept: {
                fassung: 19,
                roh: { generator: { size: 256, iterations: 3, fine: { size: 512, tiles: 2, halo: 16, blend: 8 } } },
            },
        });
        const a = adapter(auftrag(false), join(wurzel, "a"), "--schmutzig-erlauben");
        expect(a.stderr).toBe("");
        expect(a.status).toBe(0);
        const b = adapter(auftrag(true), join(wurzel, "b"), "--schmutzig-erlauben");
        expect(b.status).toBe(0);
        const ma = a.meta!;
        const mb = b.meta!;
        expect(mb.raster.ergebnis_fingerprint).toBe(ma.raster.ergebnis_fingerprint);
        expect(mb.zusatz.voll_fingerprint).toBe(ma.zusatz.voll_fingerprint);
        expect(ma.zusatz.fein_kacheln_gerechnet).toBeGreaterThan(0);
        expect(ma.zusatz.erosion).toMatchObject({ iterationen: 3 });
        expect(ma.parameter.schnappschuss.inhalt_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(ma.rezept.roh_angewendet).toBe(true);
        // Phasen: kurz und in vier Gruppen für beide Wege.
        expect(Object.keys(ma.gruppen_ms)).toEqual(["saat", "grob", "fein", "schluss"]);
        expect(Object.keys(mb.gruppen_ms)).toEqual(["saat", "grob", "fein", "schluss"]);
        expect(Object.keys(ma.phasen_ms)).toContain("grob:erosion-1");
        // Zwischenstände nur mit Beobachter, jeder als Raster im Austauschformat.
        expect(ma.zwischenstaende).toBeNull();
        const phasen = mb.zwischenstaende!.map((z) => z.phase);
        expect(phasen).toEqual(
            expect.arrayContaining([
                "landforms",
                "initial",
                "seed",
                "erosion-1-stream",
                "erosion",
                "mountain-interior",
                "fine-tiles",
            ]),
        );
        for (const z of mb.zwischenstaende!) {
            expect(z.fingerprint).toMatch(/^[0-9a-f]{64}$/);
            expect(existsSync(join(wurzel, "b", `${z.name}.json`))).toBe(true);
        }
        // Das Hauptraster ist das Fenster um das Gebirge auf dem feinen Gitter (2 E je Zelle bei 512²).
        expect(mb.raster.zellgroesse_m).toBe(6000);
        expect(mb.raster.dateien[0]!.name).toBe("endgelaende");
    }, 240_000);
});

describe("Adapter und Server geben dem Generator dieselben Optionen (WI-0249 P2)", () => {
    const rezept = (fassung: number) => {
        const r = AVENTURIA_TERRAIN_RECIPES.get(fassung);
        if (!r) throw new Error(`Fassung ${String(fassung)}`);
        return r;
    };
    const saat = (fassung: number) => ({
        gebirge: { fixture: "nordwalser-hoehen" },
        typ: "bergland",
        stufe: "saat",
        rezept: { fassung },
    });

    it("die Saat rechnet mit dem Formerhalt der Fassung auf dem Gitter des Geländes", () => {
        const ausgabe = join(tmp("gitter"), "o");
        const r = adapter(saat(19), ausgabe, "--schmutzig-erlauben");
        expect(r.status).toBe(0);
        // Der Adapter übergibt, was `rueckennetzGitter` des Servers sagt (die Funktion selbst, nicht ihr Nachbau).
        const soll = rueckennetzGitter(rezept(19));
        expect(soll).toEqual({ zelle: 0.25, mitte: 0.125 });
        expect(r.meta!.parameter.rueckennetz_gitter).toEqual(soll);
        expect(r.meta!.parameter.rueckennetz_aktiv).toBe(true);
        // Die Zellmitten des Rasters liegen auf dem Gitter des Geländes: mitte + k · zelle.
        const kopf = JSON.parse(readFileSync(join(ausgabe, "saat.json"), "utf8")) as {
            herkunft: { grenzen_e: { min_x: number; min_y: number }; zellweite_e: number };
        };
        const k = (v: number): number => (v - soll!.mitte) / soll!.zelle;
        expect(kopf.herkunft.zellweite_e).toBeCloseTo(soll!.zelle, 12);
        expect(Math.abs(k(kopf.herkunft.grenzen_e.min_x) - Math.round(k(kopf.herkunft.grenzen_e.min_x)))).toBeLessThan(
            1e-6,
        );
        expect(Math.abs(k(kopf.herkunft.grenzen_e.min_y) - Math.round(k(kopf.herkunft.grenzen_e.min_y)))).toBeLessThan(
            1e-6,
        );
    }, 120_000);

    it("ohne den Formerhalt der Fassung (Fassung 18) rechnet die Saat wie zuvor ab dem Rahmen der Fläche", () => {
        const r = adapter(saat(18), join(tmp("gitter18"), "o"), "--ohne-raster", "--schmutzig-erlauben");
        expect(r.status).toBe(0);
        expect(rueckennetzGitter(rezept(18))).toBeNull();
        expect(r.meta!.parameter.rueckennetz_gitter).toBeNull();
    }, 120_000);

    it("das lokale Endgelände rechnet mit Gitter und mit dem Netz der Kämme (Mini-Gelände)", () => {
        const wurzel = tmp("mini-p2");
        const { fixture, schnappschuss } = mini(wurzel);
        const a = adapter(
            {
                gebirge: { datei: fixture },
                stufe: "endgelaende-lokal",
                modell: { talboden: 0.3 },
                endgelaende: { schnappschuss, rand: 20, zwischenstaende: false },
                rezept: {
                    fassung: 19,
                    roh: { generator: { size: 256, iterations: 3, fine: { size: 512, tiles: 2, halo: 16, blend: 8 } } },
                },
            },
            join(wurzel, "a"),
            "--ohne-raster",
            "--schmutzig-erlauben",
        );
        expect(a.status).toBe(0);
        // Das Mini-Gelände rechnet mit 256 statt 4096 Zellen je Kante; der Typ des Rezepts kennt nur die echte Größe.
        const verkleinert = {
            ...rezept(19),
            generator: { ...rezept(19).generator, size: 256 },
        } as unknown as Parameters<typeof rueckennetzGitter>[0];
        expect(a.meta!.parameter.rueckennetz_gitter).toEqual(rueckennetzGitter(verkleinert));
        expect(a.meta!.parameter.rueckennetz_gitter).toEqual({ zelle: 4, mitte: 2 });
        expect(a.meta!.parameter.rueckennetz_netz).toBe(true);
    }, 240_000);
});
