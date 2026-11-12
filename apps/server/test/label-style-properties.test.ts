import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Die Eigenschaften, die der Kartenstil an den Beschriftungen LIEST - gemessen an der echten
 * Relation, nicht an einem selbst gebauten Feature.
 *
 * 💣 DIESER TEST EXISTIERT WEGEN EINES FEHLERS, DEN EIN ANDERER TEST NICHT GEFUNDEN HAT. WI-0014
 * gab jeder Landschaftsart ihren eigenen Namenston und fuenf Arten Versalien; beides las
 * `["get", "region_type"]`. Die Eigenschaft lag in `region_area_render` (den FLAECHEN) und fehlte in
 * `map_label_render` und `landscape_label_run_render` (den NAMEN). MapLibre wirft dafuer nichts: ein
 * `match` ohne Treffer nimmt seinen Auffangwert. Also sah die Karte einfarbig und ohne Versalien
 * aus, waehrend der Stiltest gruen blieb - denn der hatte dem Ausdruck ein Feature MIT `region_type`
 * hingelegt.
 *
 * 🔴 Die Lehre steht in der Bauform dieses Tests: wer pruefen will, ob eine Kachel eine Eigenschaft
 * traegt, darf sie nicht selbst mitbringen. Gefragt wird die Relation.
 *
 * 🪤 Geprueft werden nur die Eigenschaften, an denen die DARSTELLUNG haengt. Sichtbarkeit,
 * Zoombaender und Kollisionsrang haben eigene Tests; hier ginge es sonst wieder durcheinander.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Was der Stil an welcher Relation liest, mit dem Layer, der es tut. */
const GELESEN: { relation: string; layer: string; eigenschaften: string[] }[] = [
    {
        relation: "place_render",
        layer: "place-label / place-marker",
        // `is_ruined` traegt die Kursive der Ruinen (0026), `subtype` Groesse und Erscheinungsstufe.
        eigenschaften: ["name", "subtype", "is_hidden", "is_ruined", "collision_rank"],
    },
    {
        relation: "map_label_render",
        layer: "map-label",
        // `label_type` traegt Namenston und Versalien (0031, vorher region_type aus 0027 - der fehlte
        // bei 87 Beschriftungen), `region_layer` die Ebenenauswahl.
        // `name_twin` und `region_type` tragen die Art-Zeile in der Ebene „Alle“ (WI-0135, Migration 0109).
        eigenschaften: [
            "name",
            "label_size",
            "region_layer",
            "label_type",
            "has_curve_run",
            "collision_rank",
            "name_twin",
            "region_type",
        ],
    },
    {
        relation: "landscape_label_run_render",
        layer: "landscape-label-run",
        eigenschaften: ["name", "label_size", "region_layer", "label_type", "collision_rank"],
    },
    {
        // Seit 2026-10-05 (WI-0012, Nachtrag) rechnet die Seite die Punkte der Zonennamen aus den Bändern selbst
        // (`climate-labels.ts`): Name und Ton kommen aus der Fläche, nicht mehr aus `climate_label_render`.
        relation: "climate_band_render",
        layer: "climate-label (Punkte aus climate-fill)",
        eigenschaften: ["label", "type_key"],
    },
    {
        // WI-0062: der Gebietsname liest Größe für die Rangfolge der Kollision (`area`), die Tiefe und den Namen.
        relation: "territory_label_render",
        layer: "territory-label",
        eigenschaften: ["name", "territory_public_id", "sort_order", "depth", "area"],
    },
    {
        // Die Füllung liest Farbe und Deckkraft je Gebiet; die Auswahl liest Kennung, Namen und Obergebiet.
        relation: "territory_fill_render",
        layer: "territory-fill",
        eigenschaften: [
            "territory_public_id",
            "name",
            "parent_name",
            "parent_public_id",
            "color",
            "opacity",
            "sort_order",
            "area",
        ],
    },
    {
        // Die Linien lesen Art (außen/innen) und Ebene (Reich oder darunter).
        relation: "territory_border_render",
        layer: "territory-border",
        eigenschaften: ["kind", "level", "territory_public_id"],
    },
    {
        // Die Hauptstädte gezeigter Gebiete bleiben in der politischen Ansicht stehen (Legacy `shouldShowLocationMarker`).
        relation: "place_render",
        layer: "place-marker (Hauptstadt)",
        eigenschaften: ["capital_bands"],
    },
];

describeWithDatabase("Beschriftung: der Stil findet, was er liest", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    }, 180_000);

    afterAll(async () => {
        await database?.end();
    });

    it("🔴 jede Renderrelation traegt die Eigenschaften ihres Layers", async () => {
        const fehlend: string[] = [];
        for (const eintrag of GELESEN) {
            const spalten = await database<{ column_name: string }[]>`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = ${eintrag.relation}
            `;
            const vorhanden = new Set(spalten.map((zeile) => zeile.column_name));
            if (vorhanden.size === 0) {
                fehlend.push(`${eintrag.relation}: Relation fehlt ganz`);
                continue;
            }
            for (const eigenschaft of eintrag.eigenschaften) {
                if (!vorhanden.has(eigenschaft)) {
                    fehlend.push(`${eintrag.relation}.${eigenschaft} (gelesen von ${eintrag.layer})`);
                }
            }
        }
        expect(fehlend).toEqual([]);
    });

    /**
     * 🪤 Die Kachelfunktion der Schriftlaeufe baut ihre MVT aus einer AUSDRUECKLICHEN Spaltenliste.
     * Eine neue Spalte in der Sicht erreicht sie nicht von allein - genau daran waere `region_type`
     * ein zweites Mal gescheitert, diesmal nur fuer die Kurvenbeschriftung.
     */
    it("🪤 die Kachelfunktion der Schriftlaeufe reicht label_type durch", async () => {
        const [quelle] = await database<{ prosrc: string }[]>`
            SELECT prosrc FROM pg_proc WHERE proname = 'landscape_label_run_tile'
        `;
        expect(quelle?.prosrc, "landscape_label_run_tile fehlt").toBeDefined();
        expect(quelle?.prosrc).toContain("run.label_type");
    });

    /**
     * Die Spalten sind nicht nur eingetragen, sie lassen sich auch lesen.
     *
     * 🪤 `information_schema` allein reicht nicht: eine Sicht kann eine Spalte fuehren und beim
     * SELECT scheitern (fehlende Funktion, fehlendes Recht auf eine Basistabelle). Deshalb hier ein
     * echter Zugriff - er muss durchlaufen, und WIE VIELE Zeilen er liefert, ist ausdruecklich egal.
     *
     * 💣 Ausdruecklich NICHT geprueft wird, ob irgendwo ein Wert GESETZT ist. Die Testdatenbank
     * traegt Fixtures, keinen Legacy-Import: sie hat Orte, aber keine Ruinen, und eine Erwartung
     * „es gibt mindestens eine Ruine" waere hier eine Aussage ueber die Fixture statt ueber den
     * Code. Dass der Bestand stimmt, pruefen die Paritaetslaeufe der Migration.
     */
    it("🪤 die Spalten lassen sich auch wirklich lesen, nicht nur auflisten", async () => {
        await database`SELECT name, subtype, is_ruined FROM place_render LIMIT 1`;
        await database`SELECT name, region_layer, label_type FROM map_label_render LIMIT 1`;
        await database`SELECT name, region_layer, label_type FROM landscape_label_run_render LIMIT 1`;
        await database`SELECT label, type_key FROM climate_band_render LIMIT 1`;
        await database`SELECT name, sort_order, depth, area FROM territory_label_render LIMIT 1`;
        await database`SELECT name, parent_name, color, opacity FROM territory_fill_render LIMIT 1`;
        await database`SELECT kind, level FROM territory_border_render LIMIT 1`;
        await database`SELECT capital_bands FROM place_render LIMIT 1`;
        expect(true).toBe(true);
    });
});
