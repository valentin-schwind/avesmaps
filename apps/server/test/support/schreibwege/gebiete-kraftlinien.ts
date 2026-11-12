import { randomUUID } from "node:crypto";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import type { Faelle, Person, Welt } from "./welt.ts";

/**
 * Herrschaftsgebiete (WI-0209) und Kraftlinien (WI-0205): jeder Schreibweg einmal, der noch keinen Fall hatte (WI-0248). Rezepte aus
 * `territory-create`, `territory-update`, `territory-retire`, `territory-display`, `territory-sammel` und `editor-kraftlinien-*`.
 * Gebiete, Flächen, Nodices und Linien legt der Superuser an (Revision 1); geschrieben wird nur über die Route, als App-Rolle.
 */

const operationId = (): string => randomUUID();
const redakteurin = (welt: Welt): Promise<Person> => welt.jemand("editor");
/** Form, Hierarchie und Gebirge stehen ab Admin (WI-0279, Paket 6). */
const formRecht = (welt: Welt): Promise<Person> => welt.jemand("admin");

let feld = 0;
/**
 * Ein Quadrat von zehn Einheiten auf einem eigenen Feld eines Rasters: Jeder Fall zeichnet woanders, damit keiner einem früheren in die
 * Quere kommt (eine Überlappung wäre nur ein Befund, aber dann hinge der Fall an der Reihenfolge).
 */
function quadrat(): [number, number][] {
    feld += 1;
    const x = 300 + (feld % 10) * 12;
    const y = 340 + Math.floor(feld / 10) * 12;
    return [
        [x, y],
        [x + 10, y],
        [x + 10, y + 10],
        [x, y + 10],
    ];
}

/** Ein Gebiet in der Testwelt (Wurzel, Revision 1), mit einer Fläche, wenn `mitFlaeche` gilt; gibt seine Kennung zurück. */
async function gebiet(welt: Welt, mitFlaeche: boolean): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
        VALUES (${publicId}::uuid, 'aventuria', ${`Rauchgebiet ${publicId}`}, '#b2b065', 0.7, 'rauchtest')
    `;
    if (mitFlaeche) {
        const ring = quadrat();
        const wkt = `POLYGON((${[...ring, ring[0]!].map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")}))`;
        await welt.cluster.admin`
            INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
            SELECT ${randomUUID()}::uuid, t.id, 'aventuria', ST_Multi(ST_SetSRID(ST_GeomFromText(${wkt}), 0)), 'rauchtest'
              FROM territory t WHERE t.public_id = ${publicId}::uuid
        `;
    }
    return publicId;
}

/** Ein Nodix (Kraftlinienpunkt) an einer eigenen Stelle, als Besitzer angelegt; gibt seine Kennung zurück. */
async function nodix(welt: Welt): Promise<string> {
    feld += 1;
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system)
        VALUES (${publicId}::uuid, 'aventuria', 'junction', ST_SetSRID(ST_MakePoint(${430 + feld}, 440), 0), 'rauchtest')
    `;
    return publicId;
}

/**
 * Ein Abschnitt einer Kraftlinie im gewünschten Stand, als Besitzer angelegt (Revision 1); gibt seine Kennung zurück. Seine Enden sind
 * echte Nodices: Zurück auf die Karte kommt eine Linie nur, wenn beide Enden noch an einem hängen.
 */
async function linie(welt: Welt, stand: { aktiv: boolean; abgenommen: boolean }): Promise<string> {
    const publicId = randomUUID();
    const von = await nodix(welt);
    const nach = await nodix(welt);
    await welt.cluster.admin`
        INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom,
                               source_system, is_active, off_map)
        VALUES (${publicId}::uuid, 'aventuria', ${`Rauchlinie ${publicId}`}, TRUE, ${von}::uuid, ${nach}::uuid,
                ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), ST_GeomFromText('LINESTRING(713 287, 723 287)', 0),
                'rauchtest', ${stand.aktiv}, ${stand.abgenommen})
    `;
    return publicId;
}

const GEBIET = "/api/editor/territories";
const LINIE = "/api/editor/powerlines";

/** Ein Gebiet mit zwei „Fertig“ derselben Person (eine Arbeitsserie), über die Route des PATCH, wie der Reiter sie schickt. */
async function gebietsSerie(welt: Welt): Promise<{ person: Person; id: string; mitglieder: string[] }> {
    const person = await redakteurin(welt);
    const id = await gebiet(welt, true);
    const mitglieder: string[] = [];
    let revision = 1;
    for (const status of ["Rauch", "Nebel"]) {
        const op = operationId();
        welt.muss(
            await welt.post(
                `${GEBIET}/${id}`,
                person.cookie,
                { operationId: op, baseRevision: revision, changes: { status } },
                "PATCH",
            ),
        );
        mitglieder.push(op);
        revision += 1;
    }
    return { person, id, mitglieder };
}

/** Eine Linie mit zwei „Fertig“ derselben Person (eine Arbeitsserie): Beschriftung aus, dann eine Beschreibung. */
async function linienSerie(welt: Welt): Promise<{ person: Person; id: string; mitglieder: string[] }> {
    const person = await redakteurin(welt);
    const id = await linie(welt, { aktiv: true, abgenommen: false });
    const mitglieder: string[] = [];
    let revision = 1;
    for (const aenderung of [{ labelVisible: false }, { description: "Rauchader" }]) {
        const op = operationId();
        welt.muss(
            await welt.post(`${LINIE}/${id}/update`, person.cookie, {
                operationId: op,
                segments: [{ id, baseRevision: revision }],
                ...aenderung,
            }),
        );
        mitglieder.push(op);
        revision += 1;
    }
    return { person, id, mitglieder };
}

export const GEBIETE_KRAFTLINIEN: Faelle = {
    // „Neue Fläche“ (WI-0209 C3, `territory.create`): Gebiet und erste Fläche in EINER Operation; der Ring entsteht in `territory_area`.
    "POST /api/editor/territories": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            return welt.post(GEBIET, person.cookie, { operationId: operationId(), color: "#a1b2c3", ring: quadrat() });
        },
    },
    // „Fertig“ im Gebietseditor (B2, `territory.update`): `FOR UPDATE` am Gebiet, geschrieben wird der Name.
    "PATCH /api/editor/territories/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await gebiet(welt, true);
            return welt.post(
                `${GEBIET}/${id}`,
                person.cookie,
                { operationId: operationId(), baseRevision: 1, changes: { name: `Rauchland ${id}`, status: "Rauch" } },
                "PATCH",
            );
        },
    },
    // „Grenze zeichnen“ (C3, `territory_area.create`): eine Fläche an einem Gebiet ohne eigene Fläche, gegen die Revision des Gebiets.
    "POST /api/editor/territories/:id/areas": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const id = await gebiet(welt, false);
            return welt.post(`${GEBIET}/${id}/areas`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                ring: quadrat(),
            });
        },
    },
    // „Entfernen“ (D3, `territory.retire`): „Ganz löschen“ legt das Gebiet und seine Fläche still; die App-Rolle hat kein DELETE.
    "POST /api/editor/territories/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const id = await gebiet(welt, true);
            return welt.post(`${GEBIET}/${id}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                stage: "retire",
            });
        },
    },
    // ↺ im Verlauf (D3, `territory.restore`): erst entfernen, dann die Operation `reverts` umkehren.
    "POST /api/editor/territories/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const id = await gebiet(welt, true);
            const entfernen = operationId();
            welt.muss(
                await welt.post(`${GEBIET}/${id}/retire`, person.cookie, {
                    operationId: entfernen,
                    baseRevision: 1,
                    stage: "retire",
                }),
            );
            return welt.post(`${GEBIET}/${id}/restore`, person.cookie, {
                operationId: operationId(),
                reverts: entfernen,
            });
        },
    },
    // „Flächen vereinigen ›“ (WI-0252, `territory.merge`): die Form der Vorlage, die Fläche des anderen still; danach ↺ über
    // `…/:id/restore` (liest `territory_area.merged`), alles als App-Rolle.
    "POST /api/editor/territories/vereinigen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const a = await gebiet(welt, true);
            const b = await gebiet(welt, true);
            const vereinigt = operationId();
            welt.muss(
                await welt.post(`${GEBIET}/vereinigen`, person.cookie, {
                    operationId: vereinigt,
                    objects: [
                        { publicId: a, baseRevision: 1 },
                        { publicId: b, baseRevision: 1 },
                    ],
                    vorlage: a,
                }),
            );
            return welt.post(`${GEBIET}/${a}/restore`, person.cookie, {
                operationId: operationId(),
                reverts: vereinigt,
            });
        },
    },
    // „Farben und Zoombänder“ (D2, D4, `territory.display`): Farbe und Spanne; mit Spanne verlieren die Flächen ihr eigenes Band.
    "POST /api/editor/territories/display": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const id = await gebiet(welt, true);
            return welt.post(`${GEBIET}/display`, person.cookie, {
                operationId: operationId(),
                territories: [{ id, baseRevision: 1, color: "#336699", zoom: { minZoom: 2, maxZoom: 6 } }],
            });
        },
    },
    // „Fertig“ der Mehrfachauswahl (T57, `territory.sammel`): Art, Status, Farbe und Spanne für alle gewählten in EINER Operation.
    "POST /api/editor/territories/sammel": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const ids = [await gebiet(welt, true), await gebiet(welt, true)];
            return welt.post(`${GEBIET}/sammel`, person.cookie, {
                operationId: operationId(),
                territories: ids.map((id) => ({ id, baseRevision: 1 })),
                changes: { type: "Baronie", status: "Rauch" },
                color: "#996633",
            });
        },
    },
    // „Unter neues Obergebiet …“ (T57, `territory.create_parent`): ein Gebiet ohne Fläche und das Umhängen der gewählten darunter.
    "POST /api/editor/territories/sammel/obergebiet": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const ids = [await gebiet(welt, true), await gebiet(welt, true)];
            return welt.post(`${GEBIET}/sammel/obergebiet`, person.cookie, {
                operationId: operationId(),
                territories: ids.map((id) => ({ id, baseRevision: 1 })),
                color: "#669933",
                zoom: { minZoom: 0, maxZoom: 3 },
            });
        },
    },
    // „Entfernen …“ der Mehrfachauswahl (T57): EINE Operation `territory.retire` für alle gewählten.
    "POST /api/editor/territories/sammel/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const ids = [await gebiet(welt, true), await gebiet(welt, true)];
            return welt.post(`${GEBIET}/sammel/retire`, person.cookie, {
                operationId: operationId(),
                territories: ids.map((id) => ({ id, baseRevision: 1 })),
                stage: "retire",
            });
        },
    },
    // Liest nur (POST wegen der Länge der Kennungen), Klasse `account`: der Stand der Mehrfachauswahl.
    "POST /api/editor/territories/sammel/stand": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const ids = [await gebiet(welt, true), await gebiet(welt, false)];
            return welt.post(`${GEBIET}/sammel/stand`, person.cookie, { ids });
        },
    },
    // Ein Gebiet zurücknehmen (WI-0265 B6b): zwei „Fertig“ am Gebiet über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle.
    "POST /api/editor/territories/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await gebietsSerie(welt);
            return welt.post(`${GEBIET}/${id}/restore-series/preview`, person.cookie, {
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/territories/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await gebietsSerie(welt);
            return welt.post(`${GEBIET}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    // Eine Kraftlinie zurücknehmen (WI-0265 B6b): zwei „Fertig“ an der Linie, dann die Vorprüfung und die Rücknahme als App-Rolle.
    "POST /api/editor/powerlines/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await linienSerie(welt);
            return welt.post(`${LINIE}/${id}/restore-series/preview`, person.cookie, {
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/powerlines/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await linienSerie(welt);
            return welt.post(`${LINIE}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    // „Neue Kraftlinie“ (WI-0205 K9, `powerline.create`): ein gerader Abschnitt von Nodix zu Nodix; die Bahn zieht `zieheKraftlinienNach`.
    "POST /api/editor/powerlines": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(LINIE, person.cookie, {
                operationId: operationId(),
                from: await nodix(welt),
                to: await nodix(welt),
            });
        },
    },
    // Der Stand einer Linie (K10, T43): von der Karte nehmen, zurück auf die Karte, löschen und zurückholen, je an ALLEN Abschnitten.
    "POST /api/editor/powerlines/:id/take-off-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await linie(welt, { aktiv: true, abgenommen: false });
            return welt.post(`${LINIE}/${id}/take-off-map`, person.cookie, {
                operationId: operationId(),
                segments: [{ id, baseRevision: 1 }],
            });
        },
    },
    "POST /api/editor/powerlines/:id/put-on-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await linie(welt, { aktiv: false, abgenommen: true });
            return welt.post(`${LINIE}/${id}/put-on-map`, person.cookie, {
                operationId: operationId(),
                segments: [{ id, baseRevision: 1 }],
            });
        },
    },
    "POST /api/editor/powerlines/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await linie(welt, { aktiv: false, abgenommen: false });
            return welt.post(`${LINIE}/${id}/restore`, person.cookie, {
                operationId: operationId(),
                segments: [{ id, baseRevision: 1 }],
            });
        },
    },
};
