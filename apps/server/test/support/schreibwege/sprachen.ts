import { randomUUID } from "node:crypto";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import type { Faelle, Person, Welt } from "./welt.ts";

/**
 * Der Spracheditor (WI-0261 S5d, Inhalte › Auf der Karte › Sprachen): alle Schreibwege einmal, als App-Rolle. Die Fälle decken die Zeilensperre auf Sprache,
 * Teilfläche und Zuordnung (`FOR UPDATE` braucht UPDATE), das Anlegen (INSERT in `sprache`, `sprache_flaeche`, `sprache_wiki`), das Stilllegen und Beleben
 * (UPDATE), das Hochzählen der Revision über den Trigger, das Lesen der Sperre (`editor_lock`), das Fachprotokoll mit den Zielen `sprache_public_id` und
 * `sprache_flaeche_public_id` (Migration 0258) und das Einreihen des Auftrags `sprache_treffer` (`sprache_treffer_sammeln`, SECURITY DEFINER).
 */

const SPRACHEN = "/api/editor/sprachen";
/** Sprachen schreibt der Linguist, darüber Admins und Betreiber (WI-0279 E17a); ein Admin trägt das Recht aus der Vorlage. */
const sprachRecht = (welt: Welt): Promise<Person> => welt.jemand("admin");
const operationId = (): string => randomUUID();
const QUELLE = "e0619e909dcc".padEnd(64, "0");

/** Eine Sprache der Redaktion (Revision 1) als Besitzer; gibt ihre Kennung zurück. */
async function sprache(welt: Welt): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO sprache (public_id, schluessel, name, farbe, reihenfolge, herkunft)
        VALUES (${publicId}::uuid, ${`rauch-${publicId.slice(0, 8)}`}, 'Rauchsprache', '#8f6fb3', 0, 'redaktion')
    `;
    return publicId;
}

/** Eine Teilfläche aus der Sprachenkarte (Revision 1) als Besitzer, vorgegeben das Quadrat 300–340; gibt ihre Kennung zurück. */
async function flaeche(
    welt: Welt,
    spracheId: string,
    aktiv = true,
    wkt = "POLYGON((300 300, 340 300, 340 340, 300 340, 300 300))",
): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision, is_active, retired_at, retired_origin)
        SELECT ${publicId}::uuid, s.id, 'aventuria', ST_GeomFromText(${wkt}, 0),
               'sprachenkarte', ${QUELLE}, ${aktiv}, ${aktiv ? null : welt.cluster.admin`now()`}, ${aktiv ? null : "editor"}
          FROM sprache s WHERE s.public_id = ${spracheId}::uuid
    `;
    return publicId;
}

/** Das Quadrat rechts neben der vorgegebenen Teilfläche, überlappend (für Vereinigen und „Mit anderer Fläche“). */
const DANEBEN = "POLYGON((330 300, 370 300, 370 340, 330 340, 330 300))";

/** Ein Wiki-Artikel im Stand des WikiSync; gibt seine Kennung zurück. */
async function artikel(welt: Welt): Promise<string> {
    const titel = `Rauchartikel ${randomUUID()}`;
    const [zeile] = await welt.cluster.admin<{ public_id: string }[]>`
        INSERT INTO wiki_sprache_artikel (schluessel, titel) VALUES (${titel.toLowerCase()}, ${titel}) RETURNING public_id::text
    `;
    return zeile!.public_id;
}

/** Eine Redakteurin mit der Sperre der Sprache (über die Route, wie das Fenster sie nimmt); mit `auch` hält sie dazu diese Sprachen. */
async function mitSperre(welt: Welt, spracheId: string, ...auch: string[]): Promise<Person> {
    const person = await sprachRecht(welt);
    for (const id of [spracheId, ...auch])
        welt.muss(
            await welt.post("/api/editor/locks", person.cookie, {
                run: randomUUID(),
                kind: "sprache",
                id,
                part: "form",
            }),
        );
    return person;
}

const QUADRAT = [
    [
        [
            [360, 300],
            [400, 300],
            [400, 340],
            [360, 340],
        ],
    ],
];

export const SPRACHEN_FAELLE: Faelle = {
    // „Neue Sprache anlegen“ (`sprache.create`) gleich mit einem Wiki-Artikel, den eine andere Sprache trägt: Schlüssel, Stelle der Legende, Zuordnung und Abgabe.
    "POST /api/editor/sprachen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await sprachRecht(welt);
            const andere = await sprache(welt);
            const id = await artikel(welt);
            await welt.cluster.admin`
                INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
                SELECT s.id, a.id, 0, 'import' FROM sprache s, wiki_sprache_artikel a
                 WHERE s.public_id = ${andere}::uuid AND a.public_id = ${id}::uuid
            `;
            return welt.post(SPRACHEN, person.cookie, {
                operationId: operationId(),
                name: "Rauchsprache Neu",
                farbe: "#AABBCC",
                wiki: [id],
            });
        },
    },
    // Eine Fläche der Derographie in eine NEUE Sprache (WI-0261, `sprache.flaeche_aus_landschaft`): liest `region` und `region_area` (nur SELECT), legt Sprache und
    // Teilfläche an (INSERT, Advisory-Lock des Anlegens) und schreibt das Fachprotokoll.
    "POST /api/editor/sprachen/aus-landschaft": {
        erwartet: 200,
        async rufe(welt) {
            const person = await sprachRecht(welt);
            const regionId = randomUUID();
            const areaId = randomUUID();
            await welt.cluster.admin`
                WITH r AS (
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
                    VALUES (${regionId}, 'aventuria', 'Rauchwald', 'vegetation', 'wald', 'rauchtest')
                    RETURNING id
                )
                INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
                SELECT ${areaId}, r.id, 'aventuria', ST_GeomFromText('POLYGON((300 300, 340 300, 340 340, 300 340, 300 300))', 0), 'rauchtest'
                  FROM r
            `;
            return welt.post(`${SPRACHEN}/aus-landschaft`, person.cookie, {
                operationId: operationId(),
                regionId,
                areaId,
                neueSprache: { name: "Rauchsprache aus dem Wald" },
            });
        },
    },
    "POST /api/editor/sprachen/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                name: "Rauchsprache, bearbeitet",
                farbe: "#112233",
                legende: "Rauch / Qualm",
                reihenfolge: 3,
            });
        },
    },
    // Zuordnen, dann umsortieren (zweistufig über Zwischenstellen) und eines lösen.
    "POST /api/editor/sprachen/:id/wiki": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const person = await mitSperre(welt, id);
            const [a, b, c] = [await artikel(welt), await artikel(welt), await artikel(welt)];
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/wiki`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    artikel: [a, b, c],
                }),
            );
            return welt.post(`${SPRACHEN}/${id}/wiki`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                artikel: [c, a],
            });
        },
    },
    "POST /api/editor/sprachen/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/wiki`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    artikel: [await artikel(welt)],
                }),
            );
            return welt.post(`${SPRACHEN}/${id}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
            });
        },
    },
    "POST /api/editor/sprachen/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/wiki`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 1,
                    artikel: [await artikel(welt)],
                }),
            );
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/retire`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: 2,
                }),
            );
            return welt.post(`${SPRACHEN}/${id}/restore`, person.cookie, {
                operationId: operationId(),
                baseRevision: 3,
            });
        },
    },
    // Eine Sprache zurücknehmen (WI-0265 B6e): zwei „Fertig“ an den Feldern über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle (Zeilensperre auf Sprache,
    // Teilfläche und Zuordnung, UPDATE der Sprache, Revision über den Trigger, Fachprotokoll mit Grund, Auftrag `sprache_treffer` über `sprache_treffer_sammeln`).
    "POST /api/editor/sprachen/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const person = await mitSperre(welt, id);
            const eins = operationId();
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    name: "Rauchsprache, erst",
                }),
            );
            const zwei = operationId();
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/update`, person.cookie, {
                    operationId: zwei,
                    baseRevision: 2,
                    farbe: "#112233",
                }),
            );
            return welt.post(`${SPRACHEN}/${id}/restore-series/preview`, person.cookie, {
                members: [eins, zwei],
                membersHash: mitgliederHash([eins, zwei]),
            });
        },
    },
    "POST /api/editor/sprachen/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            const still = operationId();
            welt.muss(
                await welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/retire`, person.cookie, {
                    operationId: still,
                    baseRevision: 1,
                }),
            );
            return welt.post(`${SPRACHEN}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [still],
                membersHash: mitgliederHash([still]),
            });
        },
    },
    "POST /api/editor/sprachen/:id/treffer": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const person = await sprachRecht(welt);
            return welt.post(`${SPRACHEN}/${id}/treffer`, person.cookie);
        },
    },
    "POST /api/editor/sprachen/:id/flaechen": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                polygons: QUADRAT,
            });
        },
    },
    // Umformen einer Fläche der Sprachenkarte: Sie wird eine der Redaktion (Herkunft und Revision der Quelle, T-1).
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/reshape": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/reshape`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                polygons: QUADRAT,
            });
        },
    },
    // „Fläche malen“ an einer Teilfläche (WI-0261 Stufe 2): EIN Strich, gerechnet; schreibt nichts und braucht keine Sperre, trägt aber die Klasse `map`.
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/brush": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const person = await sprachRecht(welt);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/brush`, person.cookie, {
                mode: "malen",
                polygons: QUADRAT,
                line: [
                    [380, 320],
                    [420, 320],
                ],
                radius: 4,
                quadSegs: 4,
            });
        },
    },
    // „Alle Unterflächen vereinigen“ (WI-0261 Stufe 3): die zusammenhängende Teilfläche derselben Sprache geht in der Quelle auf (Zusammenhang über
    // `ST_ClusterDBSCAN`, Zeilensperre beider, Stilllegen der zweiten).
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/parts": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            await flaeche(welt, id, true, DANEBEN);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/parts`, person.cookie, {
                operationId: operationId(),
                operation: "vereinigen",
                baseRevision: 1,
            });
        },
    },
    // „Zerschneiden“ (Stufe 3): Die Linie quert das Quadrat; das Stück wird eine neue Teilfläche (INSERT).
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/split": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/split`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                line: [
                    [310, 290],
                    [310, 350],
                ],
            });
        },
    },
    // „Mit anderer Fläche“ rechnen (Stufe 3): schreibt nichts, braucht keine Sperre, trägt aber die Klasse `map`.
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean-preview": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const andere = await flaeche(welt, await sprache(welt), true, DANEBEN);
            const person = await sprachRecht(welt);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/boolean-preview`, person.cookie, {
                operation: "vereinigen",
                targetAreaId: andere,
            });
        },
    },
    // „Mit anderer vereinigen …“ (Stufe 3): EINE Operation an zwei Sprachen; die andere Teilfläche wird stillgelegt (beide Sperren).
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/boolean": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const zweite = await sprache(welt);
            const andere = await flaeche(welt, zweite, true, DANEBEN);
            const person = await mitSperre(welt, id, zweite);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/boolean`, person.cookie, {
                operationId: operationId(),
                operation: "vereinigen",
                baseRevision: 1,
                targetAreaId: andere,
                targetBaseRevision: 1,
            });
        },
    },
    // „Kopieren …“ mit „Originalfläche löschen“ (Stufe 3): die Kopie in der Zielsprache (INSERT), die Quelle stillgelegt.
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/copy": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const ziel = await sprache(welt);
            const person = await mitSperre(welt, id, ziel);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/copy`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                targetId: ziel,
                deleteSource: true,
            });
        },
    },
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/retire": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    "POST /api/editor/sprachen/:id/flaechen/:flaeche/restore": {
        erwartet: 200,
        async rufe(welt) {
            const id = await sprache(welt);
            const teil = await flaeche(welt, id, false);
            const person = await mitSperre(welt, id);
            return welt.post(`${SPRACHEN}/${id}/flaechen/${teil}/restore`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
};
