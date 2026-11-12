import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    ABGLEICH_JOBARTEN,
    ABGLEICH_KATEGORIE,
    ABGLEICH_KATEGORIE_QUELLEN,
    ABGLEICH_QUELLEN,
    LEGACY_ZUG_GEMEINSAM,
    LEGACY_ZUG_KATEGORIEN,
    LEGACY_ZUG_NIE,
    LEGACY_ZUG_OHNE_KATEGORIE,
    legacyZugKategorie,
} from "@avesmaps3d/shared";
import { PIPELINE_STEPS } from "../src/migration/pipeline-steps.ts";

/**
 * Die Tafelliste des Legacy-Zugs je Kategorie (WI-0141, Handover `2026-10-13-legacy-zug-nach-production-je-kategorie.md` §3.3).
 *
 * Claudios Kopie Stage → Production nimmt `tafeln` wörtlich: Was dort fehlt, wandert nicht mit, und was zu viel darin steht,
 * wird in Production ersetzt, obwohl es niemand gezogen hat. Diese Prüfungen sind darum keine Formalien:
 *
 * 1. **Vollständig:** Jede Tafel, die ein Schritt dieser Kategorie schreibt (`pipeline-steps.ts`), steht in ihrer Liste.
 * 2. **Nicht zu viel:** Keine Tafel steht in `tafeln`, die kein Schritt dieser Kategorie schreibt — ausgenommen, was die
 *    Ableitung eines Schritts nebenbei mitführt und hier ausdrücklich benannt ist.
 * 3. **Herrschaftsgebiete nie:** Keine Gebietstafel in irgendeiner Kategorie (Betreiber 2026-10-13, wörtlich).
 * 4. **Jede Tafel existiert** als `CREATE TABLE` in den Migrationen — ein Tippfehler in der Liste wäre sonst erst auf dem VPS
 *    zu sehen, mitten in einer Kopie nach Production.
 * 5. **Die Schritte und Prüfungen gibt es:** jede Kennung in `PIPELINE_STEPS`, jeder Prüfername als npm-Skript.
 *
 * Reiner Textabgleich gegen die Migrationen und `package.json`; kein Cluster, keine Datenbank.
 *
 * 🪤 Ein Eintrag in `schritte` ist entweder eine Kennung der ganzen Kette (`I5`, in `pipeline-steps.ts`) oder der npm-Name
 * einer Ableitung, die nur ein Zug DIESER Kategorie braucht, weil die ganze Kette sie mitrechnet (`derive:path-profiles`
 * nach I7; die ganze Kette rechnet die Profile in I11). Der zweite Fall hat keine `writes`-Zeile, deshalb steht seine Tafel
 * in `MITGEFUEHRT`.
 */

const SERVER_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..", "..");

/** Alle Tafeln, die die Migrationen anlegen (ohne Schema-Präfix: die Liste nennt nur `public`-Tafeln). */
const tafelnImSchema = (() => {
    const files = globSync("*.sql", { cwd: resolve(SERVER_ROOT, "migrations") }).sort();
    const names = new Set<string>();
    for (const file of files) {
        const sql = readFileSync(resolve(SERVER_ROOT, "migrations", file), "utf8");
        for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?("?)([a-z_]+)\1\s*\(/gi)) {
            names.add(match[2] as string);
        }
    }
    return names;
})();

const npmScripts = Object.keys(
    (JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> })
        .scripts,
);

/**
 * Was eine Kategorie führt, ohne dass ein Schritt es als `writes` nennt. Jede Zeile ist eine Aussage, nicht eine Ausnahme:
 * `terrain_continental_base` legt `derive:terrain` (I11) als Zwischenstand an (`terrain/continental-derive.ts`), und
 * `path_visual`/`path_label_run` gehören zu den Wegen, auch wo die Schrittliste sie über eigene Schritte schreibt.
 * `terrain_path_profile` schreibt bei den Wegen `derive:path-profiles` nach I7 (Betreiber 2026-10-14) — ein Schritt ohne
 * I-Nummer, weil die ganze Kette die Profile in I11 rechnet, und deshalb ohne `writes`-Zeile in `pipeline-steps.ts`.
 */
const MITGEFUEHRT: Readonly<Record<string, readonly string[]>> = {
    landschaften: ["terrain_continental_base"],
    wege: ["terrain_path_profile"],
    orte: [],
};

/** Eine Kennung der ganzen Kette (`I5`), im Unterschied zum npm-Namen einer Ableitung nur dieser Kategorie. */
const istKettenSchritt = (eintrag: string): boolean => /^I\d+$/.test(eintrag);

describe("Legacy-Zug je Kategorie: die Tafelliste (WI-0141 §3.3)", () => {
    const writesOf = (schritte: readonly string[]): Set<string> => {
        const tafeln = new Set<string>();
        for (const id of schritte) {
            if (!istKettenSchritt(id)) continue; // Ableitung nur dieser Kategorie: ihre Tafel steht in MITGEFUEHRT.
            const step = PIPELINE_STEPS.find((candidate) => candidate.id === id);
            expect(step, `Schritt ${id} steht nicht in pipeline-steps.ts`).toBeDefined();
            for (const tafel of step?.writes ?? []) tafeln.add(tafel);
        }
        return tafeln;
    };

    it.each([...LEGACY_ZUG_KATEGORIEN])("%s: jede geschriebene Tafel steht in der Liste", (kategorie) => {
        const spec = legacyZugKategorie(kategorie);
        const geschrieben = writesOf(spec.schritte);
        const fehlend = [...geschrieben].filter((tafel) => !spec.tafeln.includes(tafel)).sort();
        expect(fehlend, `${kategorie}: diese Tafeln schreibt ein Schritt, die Kopie ersetzt sie aber nicht`).toEqual(
            [],
        );
    });

    it.each([...LEGACY_ZUG_KATEGORIEN])("%s: keine Tafel zu viel in der Liste", (kategorie) => {
        const spec = legacyZugKategorie(kategorie);
        const geschrieben = writesOf(spec.schritte);
        const erlaubt = new Set([...geschrieben, ...(MITGEFUEHRT[kategorie] ?? [])]);
        const zuViel = spec.tafeln.filter((tafel) => !erlaubt.has(tafel)).sort();
        expect(zuViel, `${kategorie}: diese Tafeln ersetzt die Kopie, ohne dass ein Schritt sie schreibt`).toEqual([]);
    });

    it("🔴 keine Herrschaftsgebiete in einer Kategorie (Betreiber 2026-10-13: „auf keinen fall“)", () => {
        const verboten = new Set(LEGACY_ZUG_NIE.tafeln);
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            const spec = legacyZugKategorie(kategorie);
            expect(spec.tafeln.filter((tafel) => verboten.has(tafel))).toEqual([]);
            expect(spec.schritte.filter((id) => LEGACY_ZUG_NIE.schritte.includes(id))).toEqual([]);
            expect(spec.quellen.filter((quelle) => LEGACY_ZUG_NIE.quellen.includes(quelle))).toEqual([]);
        }
        // Und die Gebietstafeln sind wirklich genannt, nicht nur eine leere Liste.
        expect(LEGACY_ZUG_NIE.tafeln).toContain("territory");
        expect(LEGACY_ZUG_NIE.schritte).toEqual(["I14", "I15", "I23"]);
    });

    /**
     * 🔴 Betreiber 2026-10-13, wörtlich: „gipfel kommen mit, kraftlinien nicht“. Beide Hälften sind hier festgenagelt, weil
     * sie sonst nur in einem Kommentar stünden: Gipfel und Vulkane (`terrain_peak`) schreibt I10 zusammen mit den Reglern,
     * also fahren sie mit „Landschaften“; Kraftlinien und Kraftlinienpunkte fasst kein Zug an.
     */
    it("🔴 Gipfel und Vulkane fahren mit Landschaften, Kraftlinien mit keiner Kategorie (Betreiber 2026-10-13)", () => {
        const landschaften = legacyZugKategorie("landschaften");
        expect(landschaften.schritte).toContain("I10");
        expect(landschaften.tafeln).toContain("terrain_peak");
        // Und an keiner anderen Kategorie: ein Ortezug müsste sonst die ganze Geländekette mitziehen.
        for (const kategorie of ["wege", "orte"] as const) {
            expect(legacyZugKategorie(kategorie).tafeln).not.toContain("terrain_peak");
            expect(legacyZugKategorie(kategorie).schritte).not.toContain("I10");
        }
        // Kraftlinien: in keiner Kategorie, und der Schritt I8 läuft in keinem Kategoriezug.
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            const spec = legacyZugKategorie(kategorie);
            expect(spec.schritte).not.toContain("I8");
            for (const tafel of ["powerline", "nodix"]) expect(spec.tafeln).not.toContain(tafel);
        }
        expect(LEGACY_ZUG_OHNE_KATEGORIE.tafeln).toEqual(["powerline", "nodix", "crossing", "place_unplaced"]);
        expect(LEGACY_ZUG_OHNE_KATEGORIE.grund).toContain("kraftlinien nicht");
    });

    it("jede genannte Tafel gibt es im Schema", () => {
        const alle = [
            ...LEGACY_ZUG_KATEGORIEN.flatMap((kategorie) => legacyZugKategorie(kategorie).tafeln),
            ...LEGACY_ZUG_NIE.tafeln,
            ...LEGACY_ZUG_OHNE_KATEGORIE.tafeln,
            ...LEGACY_ZUG_GEMEINSAM.tafeln,
        ];
        const unbekannt = [...new Set(alle)].filter((tafel) => !tafelnImSchema.has(tafel)).sort();
        expect(unbekannt, "diese Tafeln nennt die Liste, aber keine Migration legt sie an").toEqual([]);
    });

    it("jede Prüfung gibt es als npm-Skript, jeder Idempotenz-Schritt gehört zur Kategorie", () => {
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            const spec = legacyZugKategorie(kategorie);
            expect(spec.pruefungen.filter((name) => !npmScripts.includes(name))).toEqual([]);
            expect(spec.idempotenz.filter((id) => !spec.schritte.includes(id))).toEqual([]);
            // Ein Schritt ohne I-Nummer ist eine Ableitung nur dieser Kategorie; sein Name ist der des npm-Skripts.
            const ableitungen = spec.schritte.filter((eintrag) => !istKettenSchritt(eintrag));
            expect(ableitungen.filter((name) => !npmScripts.includes(name))).toEqual([]);
            // Und sie taugt nicht als Idempotenzprobe: die prüft den zweiten Lauf des IMPORTERS.
            expect(spec.idempotenz.filter((id) => !istKettenSchritt(id))).toEqual([]);
            // Dateien: `shared/tiles` hält die Rasterserien (ADR-0008), die kein Zug berührt; DEM-Kacheln stehen in der
            // Datenbank. Die Kopie nach Production ist reine Datenbankarbeit — deshalb hier für jede Kategorie leer.
            expect(spec.dateien).toEqual([]);
        }
    });

    /**
     * Die JSON wählt die Schritte, beide Läufer halten sich daran: Claudios `kategorie-import.sh` auf Stage und Production und
     * lokal `legacy:update --kategorie`. Lokal fragt jeder Schritt `laeuft(step("Ix"))`; ein Schritt, der hinter `kategorie ===
     * null` steht, fiele in einem Zug seiner Kategorie still aus. So lagen I27 und I28 bis WI-0199.
     */
    it("🔴 jeder Kettenschritt einer Kategorie läuft auch im lokalen Zug je Kategorie", () => {
        const cli = readFileSync(resolve(SERVER_ROOT, "src", "migration", "legacy-update-cli.ts"), "utf8");
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            const ohne = legacyZugKategorie(kategorie)
                .schritte.filter(istKettenSchritt)
                .filter((id) => !cli.includes(`laeuft(step("${id}"))`));
            expect(ohne, `${kategorie}: diese Schritte fragt legacy-update-cli nicht nach der Kategorie`).toEqual([]);
        }
    });

    /**
     * Die Gegenseite auf Stage und Production: Claudios `ops/deploy/kategorie-import.sh` verdrahtet die Schritte und Prüfer je
     * Kategorie fest und verspricht in seinem Kopf, dass ein Test sie gegen die JSON hält. Das ist dieser (WI-0199). Gelesen werden
     * nur die Marken `log STEP "<Schritt> …"` und `vchk|vrep <Prüfer>` in den Blöcken „# 1 Import“ und „# 2 Pruefer“, in
     * Laufreihenfolge (der zweite Lauf hat seinen eigenen Block und bleibt hier außen vor).
     */
    it("🔴 Claudios Läufer fährt je Kategorie genau die Schritte und Prüfer der JSON, in derselben Reihenfolge", () => {
        const skript = readFileSync(resolve(REPO_ROOT, "ops", "deploy", "kategorie-import.sh"), "utf8");
        const blockNach = (titel: string): string => {
            const ab = skript.indexOf(`\n${titel}`);
            expect(ab, `kategorie-import.sh: Abschnitt „${titel}“`).toBeGreaterThan(0);
            return skript.slice(skript.indexOf('case "$KAT" in\n', ab));
        };
        const bloecke = [blockNach("# 1 Import"), blockNach("# 2 Pruefer")];
        const lies = (block: string, marke: RegExp): Map<string, string[]> => {
            const je = new Map<string, string[]>();
            let kategorie: string | undefined;
            for (const zeile of block.slice(0, block.indexOf("\nesac")).split("\n")) {
                const kopf = /^ {2}(wege|orte|landschaften)\)/.exec(zeile);
                if (kopf) kategorie = kopf[1];
                if (kategorie === undefined) continue;
                for (const treffer of zeile.matchAll(marke))
                    je.set(kategorie, [...(je.get(kategorie) ?? []), treffer[1]!]);
            }
            return je;
        };
        // `log STEP "I5 Wege (…)"` → I5; ein Schritt ohne I-Nummer trägt seinen npm-Namen in Klammern.
        const schritte = lies(bloecke[0]!, /log STEP "(I\d+\b|[^"(]*\((derive:[a-z-]+)\))/g);
        const pruefer = lies(bloecke[1]!, /\b(?:vchk|vrep) ([a-z-]+) /g);
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            const spec = legacyZugKategorie(kategorie);
            const gefahren = (schritte.get(kategorie) ?? []).map(
                (marke) => /\((derive:[a-z-]+)\)/.exec(marke)?.[1] ?? marke,
            );
            expect(gefahren, `${kategorie}: Schritte in kategorie-import.sh`).toEqual(spec.schritte);
            expect(
                (pruefer.get(kategorie) ?? []).map((name) => `verify:${name}`).sort(),
                `${kategorie}: Prüfer in kategorie-import.sh`,
            ).toEqual([...spec.pruefungen].sort());
        }
    });

    it("🔴 der Orte-Zug fährt Stätten und Wiki-Siedlungsregistry mit (Betreiber 2026-10-16 „A ja“)", () => {
        // Handover `2026-10-16-orte-zug-wiki-register-und-staetten-an-claudia.md`: Der Ortseditor liest beide (Innerorts, Reiter
        // „Fehlt“, Trichter „Nicht auf der Karte“); ohne sie bliebe die Stage nach einem Orte-Zug bei leeren Tafeln stehen.
        const orte = legacyZugKategorie("orte");
        expect(orte.schritte).toEqual(["I1", "I9", "I27", "I28"]);
        expect(orte.quellen).toEqual(
            expect.arrayContaining(["staetten-rohquellen-export.php", "wiki-siedlungen-export.php"]),
        );
        expect(orte.pruefungen).toEqual(expect.arrayContaining(["verify:staetten", "verify:wiki-settlements"]));
        // Ihr zweiter Lauf meldet nur (Betreiber 2026-10-03, keine Tore, die er nicht definiert hat).
        expect(orte.idempotenz).toEqual(["I1"]);
        // Die Landschaften und Wege rühren beide nicht an.
        for (const andere of ["landschaften", "wege"] as const) {
            expect(legacyZugKategorie(andere).schritte).not.toContain("I27");
            expect(legacyZugKategorie(andere).schritte).not.toContain("I28");
        }
    });

    /**
     * 🔴 Betreiber 2026-10-14, wörtlich: „ja, danke der nachfrage“ (Handover `2026-10-14-vorarbeit-sieben-punkte-an-claudia.md`,
     * Nachtrag zu §7). I5 schreibt die Geometrie der Wege neu, damit passt ihr Steigungsprofil nicht mehr. Die ganze Kette
     * rechnet es in I11, ein Zug nur der Wege rührt die Geländekette aber nicht an — ohne diesen Schritt bliebe jede Route
     * über einen geänderten Weg bis zur nächsten Geländerechnung steigungslos. Claudios Läufer ruft ihn nach I7
     * (`ops/deploy/kategorie-import.sh`, `dist/derive/path-profile-cli.js`), hier steht die Gegenseite.
     */
    it("🔴 der Wege-Zug rechnet die Steigungsprofile selbst, nach I7 (Betreiber 2026-10-14)", () => {
        const wege = legacyZugKategorie("wege");
        expect(wege.schritte).toEqual(["I5", "I6", "I7", "derive:path-profiles"]);
        expect(npmScripts).toContain("derive:path-profiles");
        // Kein Schritt der ganzen Kette: dort rechnet I11 die Profile mit, ein zweiter numerierter Schritt wäre eine
        // doppelte Rechnung — und `pipeline-parity.test.ts` verlangte ihn dann in der CLI und im Stage-Korridor.
        expect(PIPELINE_STEPS.map((step) => step.id)).not.toContain("derive:path-profiles");
        expect(PIPELINE_STEPS.find((step) => step.id === "I11")?.writes).toContain("terrain_path_profile");
        // Die Kopie nach Production nimmt die Tafel mit, sonst bliebe Production auf den alten Profilen stehen.
        expect(wege.tafeln).toContain("terrain_path_profile");
        expect(legacyZugKategorie("landschaften").tafeln).toContain("terrain_path_profile");
        // Und nur diese eine Tafel: die übrige Geländekette bleibt bei den Landschaften.
        for (const tafel of ["terrain_control", "terrain_raster", "terrain_dem", "terrain_dem_tile"]) {
            expect(wege.tafeln).not.toContain(tafel);
        }
    });

    it("sea_route_graph und terrain_path_profile gehören bewusst zu zwei Kategorien, sonst überschneidet sich nichts", () => {
        const zuordnung = new Map<string, string[]>();
        for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
            for (const tafel of legacyZugKategorie(kategorie).tafeln) {
                zuordnung.set(tafel, [...(zuordnung.get(tafel) ?? []), kategorie]);
            }
        }
        const doppelt = [...zuordnung.entries()].filter(([, wo]) => wo.length > 1).map(([tafel]) => tafel);
        // `sea_route_graph`: Orte und Landschaften speisen ihn beide (I9 liest place, region_area, climate_band), beide
        // leiten ihn neu ab. `terrain_path_profile`: die Landschaften rechnen ihn in I11, die Wege nach I7 für die Wege mit
        // neuer Geometrie (Betreiber 2026-10-14). Beide Male ersetzt die Kopie die ganze Tafel, in jedem der beiden Züge.
        expect(doppelt.sort()).toEqual(["sea_route_graph", "terrain_path_profile"]);
    });

    it("die drei Zeilen der Abgleiche hängen an den drei Kategorien und an der Jobart legacy_zug", () => {
        expect(ABGLEICH_KATEGORIE_QUELLEN).toEqual(["legacy_landschaften", "legacy_wege", "legacy_orte"]);
        for (const quelle of ABGLEICH_KATEGORIE_QUELLEN) {
            expect(ABGLEICH_JOBARTEN[quelle]).toBe("legacy_zug");
            expect(LEGACY_ZUG_KATEGORIEN).toContain(ABGLEICH_KATEGORIE[quelle]);
        }
        // Die Gesamtzeile, die Medien und der Production-Zug (WI-0144) bleiben, was sie waren: keine Kategorie, eigene Jobart.
        for (const quelle of ["legacy", "medien", "production"] as const) {
            expect(ABGLEICH_KATEGORIE[quelle]).toBeNull();
            expect(ABGLEICH_KATEGORIE_QUELLEN).not.toContain(quelle);
        }
        expect(ABGLEICH_QUELLEN).toEqual([
            "legacy",
            "legacy_landschaften",
            "legacy_wege",
            "legacy_orte",
            "medien",
            "production",
        ]);
    });

    it("🔴 die Migration und die Datenbank lassen nur diese drei Kategorien in einen Auftrag", () => {
        const sql = readFileSync(resolve(SERVER_ROOT, "migrations", "0120_legacy_zug_kategorie.sql"), "utf8");
        // Die Sperre steht in `job_enqueue`, nicht nur im Werkzeug: kein Aufrufer kann sie umgehen.
        expect(sql).toContain("NOT IN ('landschaften', 'wege', 'orte')");
        // Und `political-territories-export.php` kommt in keiner Kategorie vor: der Zug ruft sie nie ab.
        expect(sql).not.toContain("political-territories-export");
        // Die vier Korridor-Funktionen nehmen die neue Art an, und die Rechte-Vorlage kennt die neue Lesefunktion.
        for (const fn of ["job_sync_claim", "job_sync_phase", "job_sync_finish", "job_sync_kategorie"]) {
            expect(sql, `${fn} fehlt in 0120`).toContain(fn);
        }
        const grants = readFileSync(resolve(SERVER_ROOT, "src", "db", "jobs-grants.psql"), "utf8");
        expect(grants).toContain("job_sync_kategorie");
    });
});
