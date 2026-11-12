import { randomUUID } from "node:crypto";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import type { Faelle, Person, Welt } from "./welt.ts";

/**
 * Landschaften (Derographie-Editor), Gipfel, Kraftlinienpunkte und Stätten am Ort (WI-0248, Rauchtest der Schreibwege): jeder Schreibweg
 * einmal als App-Rolle. Rezepte aus `landscape-create`, `-retire`, `-boolean`, `-parts`, `-split`, `-copy`, `-brush`, `-batch`,
 * `peak-create`, `-update`, `-retire`, `kraftlinien-anlegen`, `kraftlinien-schreiben` und `site-edit`. Zeilen legt der Superuser an
 * (Revision 1), geschrieben wird nur über die Route; wo ein Weg ein früheres Schreiben braucht (↺), geht dieses ebenfalls über seine Route.
 */

const operationId = (): string => randomUUID();
let naechste = 0;
/** Eigener Nummernkreis (`5e0c1a4d-…`), damit keine Kennung eines anderen Fall-Moduls wiederkehrt. */
const kennung = (): string => `5e0c1a4d-0000-4000-8000-${(0x100 + (naechste += 1)).toString(16).padStart(12, "0")}`;

const redakteurin = (welt: Welt): Promise<Person> => welt.jemand("editor");
/** Form, Hierarchie und Gebirge stehen ab Admin (WI-0279, Paket 6). */
const formRecht = (welt: Welt): Promise<Person> => welt.jemand("admin");

/** Ein Rechteck als Ring in WKT; mehrere davon ergeben eine Fläche aus mehreren Stücken. */
const rechteck = (x0: number, y0: number, x1: number, y1: number): string =>
    `((${String(x0)} ${String(y0)}, ${String(x1)} ${String(y0)}, ${String(x1)} ${String(y1)}, ${String(x0)} ${String(y1)}, ${String(x0)} ${String(y0)}))`;

/** Die Ecken eines Rechtecks für einen Körper der Route (ohne Schlusspunkt). */
const ecken = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
];

interface Landschaft {
    readonly regionId: string;
    readonly areaId: string;
    readonly labelId: string;
}

/**
 * Eine Landschaft mit EINER Teilfläche aus diesen Stücken und einer Beschriftung, angelegt vom Superuser (Revision 1). `wald` in der
 * Ebene Vegetation oder `huegelland` in der Topographie; der Name trägt die Kennung, sonst hießen alle gleich.
 */
async function landschaft(
    welt: Welt,
    stuecke: readonly string[],
    art: { layer?: "vegetation" | "topographie"; type?: string } = {},
): Promise<Landschaft> {
    const regionId = kennung();
    const areaId = kennung();
    const labelId = kennung();
    const layer = art.layer ?? "vegetation";
    const type = art.type ?? (layer === "vegetation" ? "wald" : "huegelland");
    const wkt = stuecke.length === 1 ? `POLYGON${stuecke[0]!}` : `MULTIPOLYGON(${stuecke.join(", ")})`;
    await welt.cluster.admin`
        WITH r AS (
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
            VALUES (${regionId}, 'aventuria', ${`Rauchland ${regionId}`}, ${layer}, ${type}, 'rauchtest')
            RETURNING id
        ), a AS (
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${areaId}, r.id, 'aventuria', ST_SetSRID(ST_GeomFromText(${wkt}), 0), 'rauchtest' FROM r
        )
        INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
        SELECT ${labelId}, 'aventuria', r.id, ${`Rauchland ${regionId}`}, ST_SetSRID(ST_MakePoint(400, 400), 0), 'rauchtest'
          FROM r
    `;
    return { regionId, areaId, labelId };
}

/** Ein Berggipfel, angelegt vom Superuser (Revision 1). */
async function gipfel(welt: Welt, x: number, y: number): Promise<string> {
    const publicId = kennung();
    await welt.cluster.admin`
        INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}, 'aventuria', ${`Rauchgipfel ${publicId}`}, 'berggipfel', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0),
                'rauchtest', TRUE)
    `;
    return publicId;
}

/** Ein Kraftlinienpunkt, angelegt vom Superuser (Revision 1), ohne Linie. */
async function nodix(welt: Welt, x: number, y: number): Promise<string> {
    const publicId = kennung();
    await welt.cluster.admin`
        INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system, is_active)
        VALUES (${publicId}, 'aventuria', 'junction', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'rauchtest', TRUE)
    `;
    return publicId;
}

/** Ein Ort in der Testwelt, angelegt vom Superuser (Revision 1). */
async function ort(welt: Welt): Promise<string> {
    const publicId = kennung();
    await welt.cluster.admin`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}, 'aventuria', ${`Rauchstaette ${publicId}`}, 'stadt', ST_SetSRID(ST_MakePoint(${250 + naechste}, 470), 0),
                'rauchtest', TRUE)
    `;
    return publicId;
}

/** Ein Gebirge mit zwei „Fertig“ derselben Person (eine Arbeitsserie), über die Route des PATCH, wie der Reiter sie schickt. */
async function gebirgsSerie(
    welt: Welt,
    stuecke: readonly string[],
): Promise<{ person: Person; gebirge: Landschaft; mitglieder: string[] }> {
    const person = await formRecht(welt);
    const gebirge = await landschaft(welt, stuecke, { layer: "topographie", type: "gebirge" });
    const mitglieder: string[] = [];
    for (const rauschen of [0.4, 0.5]) {
        const id = operationId();
        welt.muss(
            await welt.post(
                `/api/editor/landscapes/${gebirge.regionId}`,
                person.cookie,
                { operationId: id, gebirge: [{ area: gebirge.areaId, changes: { werte: { rauschen } } }] },
                "PATCH",
            ),
        );
        mitglieder.push(id);
    }
    return { person, gebirge, mitglieder };
}

export const LANDSCHAFTEN: Faelle = {
    // „Neue Fläche“ (T47, `landscape.create`): Fläche samt erster Teilfläche, der Griff „Fläche-001“ aus der nächsten freien Nummer.
    "POST /api/editor/landscapes": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            return welt.post("/api/editor/landscapes", person.cookie, {
                operationId: operationId(),
                layer: "vegetation",
                ring: ecken(300, 300, 320, 320),
            });
        },
    },
    // „Fläche entfernen …“ (`landscape.retire`): weich, samt Teilflächen und Beschriftungen; danach räumt die Schreibnaht Schriftläufe und
    // geglättete Formen (Aufträge der Ableitung).
    "POST /api/editor/landscapes/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(310, 340, 330, 360)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                stage: "retire",
            });
        },
    },
    // Die Derographie zurücknehmen (WI-0265 B3 Gebirge, B6c alles übrige): zwei „Fertig“ am Gebirge über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle.
    // Was die Rücknahme an Landschaft, Teilfläche und Beschriftung schreibt, steckt im Fall „Flächen vereinigen“ weiter unten und in den Fällen des Gipfels.
    "POST /api/editor/landscapes/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const { person, gebirge, mitglieder } = await gebirgsSerie(welt, [rechteck(430, 340, 450, 360)]);
            return welt.post(`/api/editor/landscapes/${gebirge.regionId}/restore-series/preview`, person.cookie, {
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/landscapes/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const { person, gebirge, mitglieder } = await gebirgsSerie(welt, [rechteck(460, 340, 480, 360)]);
            return welt.post(`/api/editor/landscapes/${gebirge.regionId}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    // „Mit anderer Fläche ›“ (Werkzeug 1): die Vorschau rechnet nur (PostGIS), trägt aber die Klasse `map`.
    "POST /api/editor/landscapes/:id/boolean-preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(370, 340, 400, 370)]);
            const hain = await landschaft(welt, [rechteck(390, 340, 420, 370)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/boolean-preview`, person.cookie, {
                operation: "vereinigen",
                areaId: wald.areaId,
                targetAreaId: hain.areaId,
            });
        },
    },
    // Vereinigen schreibt EINE Operation: die Quelle bekommt die neue Form, die andere Teilfläche geht samt ihrer Landschaft von der Karte.
    "POST /api/editor/landscapes/:id/boolean": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(430, 340, 460, 370)]);
            const hain = await landschaft(welt, [rechteck(450, 340, 480, 370)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/boolean`, person.cookie, {
                operationId: operationId(),
                operation: "vereinigen",
                areaId: wald.areaId,
                baseRevision: 1,
                targetAreaId: hain.areaId,
                targetBaseRevision: 1,
            });
        },
    },
    // „Flächen vereinigen ›“ (WI-0252, `landscape.merge`): zwei Nachbarn werden eine Fläche, die andere Landschaft samt Beschriftung geht
    // von der Karte; danach ↺ über `…/:id/restore-series` (WI-0265 B6c: Form, Landschaft, Teilfläche und Beschriftung zurück), alles als App-Rolle.
    "POST /api/editor/landscapes/vereinigen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(640, 380, 660, 400)]);
            const hain = await landschaft(welt, [rechteck(660, 380, 680, 400)]);
            const vereinigt = operationId();
            welt.muss(
                await welt.post("/api/editor/landscapes/vereinigen", person.cookie, {
                    operationId: vereinigt,
                    objects: [
                        { publicId: wald.regionId, baseRevision: 1 },
                        { publicId: hain.regionId, baseRevision: 1 },
                    ],
                    vorlage: wald.regionId,
                }),
            );
            return welt.post(`/api/editor/landscapes/${wald.regionId}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [vereinigt],
                membersHash: mitgliederHash([vereinigt]),
            });
        },
    },
    // „Unterflächen ›“ (Werkzeug 3): Herauslösen macht den ersten Teil einer Fläche aus zwei Stücken zu einer neuen Landschaft (INSERT).
    "POST /api/editor/landscapes/:id/parts": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(500, 340, 520, 360), rechteck(540, 340, 560, 360)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/parts`, person.cookie, {
                operationId: operationId(),
                operation: "herausloesen",
                areaId: wald.areaId,
                baseRevision: 1,
                part: 1,
            });
        },
    },
    // „Zerschneiden“ (Werkzeug 5): Die Linie quert die Fläche ganz; das kleinere Stück wird eine neue Landschaft.
    "POST /api/editor/landscapes/:id/split": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(580, 340, 620, 370)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/split`, person.cookie, {
                operationId: operationId(),
                areaId: wald.areaId,
                baseRevision: 1,
                line: [
                    [590, 330],
                    [590, 380],
                ],
            });
        },
    },
    // „Kopieren …“ (Werkzeug 8) als Umziehen: in eine neue Landschaft der Topographie, die Quelle (die letzte ihrer Landschaft) geht mit.
    "POST /api/editor/landscapes/:id/copy": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(640, 340, 670, 370)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/copy`, person.cookie, {
                operationId: operationId(),
                areaId: wald.areaId,
                baseRevision: 1,
                layer: "topographie",
                name: `Rauchkopie ${wald.regionId}`,
                type: "huegelland",
                deleteSource: true,
            });
        },
    },
    // „Fläche malen“ (Werkzeug 6): EIN Strich, gerechnet; schreibt nichts, trägt aber die Klasse `map`.
    "POST /api/editor/landscapes/:id/brush": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(700, 340, 720, 360)]);
            return welt.post(`/api/editor/landscapes/${wald.regionId}/brush`, person.cookie, {
                areaId: wald.areaId,
                mode: "malen",
                polygons: [[ecken(700, 340, 720, 360)]],
                line: [
                    [710, 350],
                    [730, 350],
                ],
                radius: 4,
                quadSegs: 4,
            });
        },
    },
    // Die Mehrfachauswahl (T57): „Verbergen“ für eine Fläche und einen Gipfel in EINER Operation.
    "POST /api/editor/landscapes/batch": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(740, 340, 760, 360)]);
            const berg = await gipfel(welt, 750, 380);
            return welt.post("/api/editor/landscapes/batch", person.cookie, {
                operationId: operationId(),
                ids: [wald.regionId],
                peaks: [berg],
                changes: { hidden: true },
            });
        },
    },
    // … und „Entfernen …“ für alle: Fläche samt Teilfläche und Beschriftung und der Gipfel gehen weich in EINER Operation.
    "POST /api/editor/landscapes/batch-retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const wald = await landschaft(welt, [rechteck(780, 340, 800, 360)]);
            const berg = await gipfel(welt, 790, 380);
            return welt.post("/api/editor/landscapes/batch-retire", person.cookie, {
                operationId: operationId(),
                ids: [wald.regionId],
                peaks: [berg],
                stage: "retire",
            });
        },
    },

    // Gipfel und Vulkane (WI-0178 P1, P7): anlegen, ändern (Höhe und Lage reihen das Gelände im Umkreis ein), entfernen und ↺.
    "POST /api/editor/peaks": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            return welt.post("/api/editor/peaks", person.cookie, { operationId: operationId(), position: [330, 420] });
        },
    },
    "PATCH /api/editor/peaks/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const berg = await gipfel(welt, 340, 420);
            return welt.post(
                `/api/editor/peaks/${berg}`,
                person.cookie,
                {
                    operationId: operationId(),
                    baseRevision: 1,
                    changes: { name: `Rauchspitze ${berg}`, height: 2400, showName: true, position: [342, 421] },
                },
                "PATCH",
            );
        },
    },
    "POST /api/editor/peaks/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const berg = await gipfel(welt, 350, 420);
            return welt.post(`/api/editor/peaks/${berg}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    // Einen Gipfel zurücknehmen (WI-0265 B6c): „Gipfel entfernen …“ über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle.
    "POST /api/editor/peaks/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const berg = await gipfel(welt, 360, 420);
            const entfernen = operationId();
            welt.muss(
                await welt.post(`/api/editor/peaks/${berg}/retire`, person.cookie, {
                    operationId: entfernen,
                    baseRevision: 1,
                }),
            );
            return welt.post(`/api/editor/peaks/${berg}/restore-series/preview`, person.cookie, {
                members: [entfernen],
                membersHash: mitgliederHash([entfernen]),
            });
        },
    },
    "POST /api/editor/peaks/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const berg = await gipfel(welt, 365, 425);
            const entfernen = operationId();
            welt.muss(
                await welt.post(`/api/editor/peaks/${berg}/retire`, person.cookie, {
                    operationId: entfernen,
                    baseRevision: 1,
                }),
            );
            return welt.post(`/api/editor/peaks/${berg}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [entfernen],
                membersHash: mitgliederHash([entfernen]),
            });
        },
    },

    // Kraftlinienpunkte (K5, K9, K10): anlegen, verschieben (die Bahnen an ihm folgen) und weich entfernen (nur ohne Linie).
    "POST /api/editor/nodices": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post("/api/editor/nodices", person.cookie, { operationId: operationId(), x: 370, y: 430 });
        },
    },
    "POST /api/editor/nodices/:id/move": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const punkt = await nodix(welt, 380, 430);
            return welt.post(`/api/editor/nodices/${punkt}/move`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                x: 384,
                y: 432,
            });
        },
    },
    "POST /api/editor/nodices/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const punkt = await nodix(welt, 390, 430);
            return welt.post(`/api/editor/nodices/${punkt}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },

    // „Innerorts hinzufügen“ (WI-0196, `site.add`): bindet eine Stätte an den Ort (INSERT in `site_settlement`); sperrt die Stätte zuvor.
    "POST /api/editor/places/:id/sites/add": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const [site] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO site (source_kind, source_key, name, site_type, source_system)
                VALUES ('weg', ${`wiki:rauch-${randomUUID()}`}, 'Rauchpfad', 'Weg', 'rauchtest')
                RETURNING id::text
            `;
            return welt.post(`/api/editor/places/${await ort(welt)}/sites/add`, person.cookie, {
                operationId: operationId(),
                sites: [site!.id],
                places: [],
            });
        },
    },
};
