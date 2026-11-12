import { createHash, randomInt, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { LightMyRequestResponse } from "fastify";
import { AVENTURIA_SERIES, ROUTE_DEFAULTS } from "@avesmaps3d/shared";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import { aenderung, nachweis, opsId, status } from "../../../src/kanal/db.ts";
import { abgeschickt, mitglied, signaturKoepfe } from "../discord-signatur.ts";
import { betroffen, type Faelle, type Person, type Welt } from "./welt.ts";

/**
 * Ortseditor und Wegkurve (WI-0128, WI-0177), die Sperre während der Bearbeitung (WI-0178, EDIT-0003 §4), die öffentlichen Wege ohne
 * Anmeldung, der Betreiber-Kanal (WI-0124) und die Benachrichtigungen (WI-0136): jeder Schreibweg einmal. Rezepte aus `editor-place-edit`, `editor-place-sites`, `editor-path-edit`,
 * `route-landscapes`, `stage-lore`, `share`, `besucher-schalter`, `kanal-routes`, `kanal-bilder` und `benachrichtigungen`.
 */

const operationId = (): string => randomUUID();
const SHA = "b7e2d41c9a3f5e08d2a6b7c44f09e3d1a5c8b621";
let naechste = 0;
const kennung = (): string => `5e0c0000-0000-4000-8000-${(0x900 + (naechste += 1)).toString(16).padStart(12, "0")}`;

/** Ein Ort in der Testwelt, angelegt vom Superuser (Revision 1), weit weg von jedem Weg. */
async function ort(welt: Welt): Promise<string> {
    const publicId = kennung();
    const x = 300 + naechste;
    await welt.cluster.admin`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}, 'aventuria', ${`Rauchort ${String(naechste)}`}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, 432), 0),
                'rauchtest', TRUE)
    `;
    return publicId;
}

const redakteurin = (welt: Welt): Promise<Person> => welt.jemand("editor");
/** Form, Hierarchie und Gebirge stehen ab Admin (WI-0279, Paket 6). */
const formRecht = (welt: Welt): Promise<Person> => welt.jemand("admin");

/**
 * Ein Ort mit zwei „Fertig“ derselben Person (eine Arbeitsserie), über die Route des PATCH, wie der Ortseditor sie schickt, und einer Änderung seiner Quellen (WI-0265 B6g3: `traeger.sources` teilt die
 * Serie des Orts): Die Rücknahme der Serie setzt die Felder und die Verknüpfung als App-Rolle zurück.
 */
async function ortMitSerie(welt: Welt): Promise<{ person: Person; id: string; mitglieder: string[] }> {
    const person = await redakteurin(welt);
    const id = await ort(welt);
    const mitglieder: string[] = [];
    for (const [revision, changes] of [
        [1, { hidden: true }],
        [2, { ruined: true }],
    ] as const) {
        const nummer = operationId();
        welt.muss(
            await welt.post(
                `/api/editor/places/${id}`,
                person.cookie,
                { operationId: nummer, baseRevision: revision, changes },
                "PATCH",
            ),
        );
        mitglieder.push(nummer);
    }
    // Die Quellen des Orts (Klappbox): eine Katalogquelle als Besitzer, über die Route angehängt.
    const adresse = `https://rauchtest.example/${randomUUID()}`;
    const schluessel = `url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`;
    const [quelle] = await welt.cluster.admin<{ public_id: string }[]>`
        INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
        VALUES (${schluessel}, 'final', ${adresse}, 'Rauchquelle am Ort', 'briefspiel', FALSE, 'rauchtest')
        RETURNING public_id::text
    `;
    const quellenNummer = operationId();
    welt.muss(
        await welt.post(`/api/editor/inhalte/traeger/place/${id}/quellen`, person.cookie, {
            operationId: quellenNummer,
            aenderungen: [
                { op: "add", sourceId: quelle!.public_id, vorher: null, referenceKind: "erwaehnung", pages: "3" },
            ],
        }),
    );
    mitglieder.push(quellenNummer);
    return { person, id, mitglieder };
}

/** Ein Weg zum Bearbeiten, als Besitzer angelegt (Revision 1). */
async function rauchweg(welt: Welt, stand: { aktiv?: boolean; abgenommen?: boolean } = {}): Promise<string> {
    const publicId = kennung();
    await welt.cluster.admin`
        INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active, off_map)
        VALUES (${publicId}, 'aventuria', 'Rauchweg', 'Weg', FALSE, FALSE,
                ST_GeomFromText('LINESTRING(713 287, 716 288, 719 286, 723 287)', 0), 'rauchtest', ${stand.aktiv ?? true},
                ${stand.abgenommen ?? false})
    `;
    return publicId;
}
/** Ein Weg mit zwei „Fertig“ derselben Person (eine Arbeitsserie), über die Route des Updates, wie der Wegeditor sie schickt. */
async function wegMitSerie(welt: Welt): Promise<{ person: Person; id: string; mitglieder: string[] }> {
    const person = await redakteurin(welt);
    const id = await eigenerWeg(welt, "Rauchserie");
    const mitglieder: string[] = [];
    for (const [revision, felder] of [
        [1, { labelVisible: false }],
        [2, { subtype: "Pfad" }],
    ] as const) {
        const nummer = operationId();
        welt.muss(
            await welt.post(`/api/editor/paths/${id}/update`, person.cookie, {
                operationId: nummer,
                sections: [{ publicId: id, baseRevision: revision }],
                ...felder,
            }),
        );
        mitglieder.push(nummer);
    }
    return { person, id, mitglieder };
}
/** Ein Weg mit eigenem Namen: Alle Rauchwege heißen gleich und wären EINE Straße mit mehr Abschnitten. */
async function eigenerWeg(welt: Welt, name: string): Promise<string> {
    const publicId = kennung();
    await welt.cluster.admin`
        INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
        VALUES (${publicId}, 'aventuria', ${`${name} ${publicId}`}, 'Weg', TRUE, FALSE,
                ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), 'rauchtest')
    `;
    return publicId;
}
const betreiber = (welt: Welt): Promise<Person> => welt.jemand("operator");

/** Ein neuer Ort über die Route; gibt seine Kennung zurück. */
async function neuerOrt(welt: Welt, person: Person): Promise<string> {
    const antwort = welt.muss(
        await welt.post("/api/editor/places", person.cookie, {
            operationId: operationId(),
            name: `Rauch Neu ${randomUUID().slice(0, 6)}`,
            subtype: "dorf",
            position: { x: 441 + randomInt(0, 50), y: 445 },
        }),
    );
    return betroffen(antwort).id;
}

/** Ein Vorgang im Kanal: gibt OPS-Kennung und Nummer zurück. */
async function melde(welt: Welt, person: Person): Promise<{ ops: string; id: number }> {
    const antwort = welt.muss(
        await welt.post("/api/kanal/vorgaenge", person.cookie, {
            operationId: operationId(),
            kategorie: "bug",
            prioritaet: "hoch",
            titel: "Rauchtest",
            nachricht: "Ein Vorgang des Rauchtests.",
        }),
    );
    const ops = betroffen(antwort).id;
    return { ops, id: Number(ops.slice(4)) };
}

/**
 * Claudio trägt einen Fix ein und legt den Vorgang zur Abnahme vor (`kanal-routes.test.ts`). Als Besitzerin des Schemas: Die Funktionen
 * des Kanals nehmen nur sie (mit genanntem Agenten) oder die Rollen `_claudia`/`_claudio` an, nie den Superuser.
 */
async function zurAbnahme(welt: Welt, id: number): Promise<number> {
    const database = welt.cluster.migrator;
    await status(database, id, "in_arbeit", { als: "claudio" });
    await aenderung(
        database,
        { vorgang: id, klasse: "A", art: "code", was: "Rauchtest", commit: SHA },
        { als: "claudio" },
    );
    await nachweis(database, id, "fix_committed", { commit: SHA, als: "claudio" });
    await nachweis(database, id, "auf_stage", { release: "r1", als: "claudio" });
    await status(database, id, "auf_stage", { als: "claudio" });
    return status(database, id, "zur_abnahme", { als: "claudio", kurztitel: "Rauchtest" });
}

/**
 * Eine Meldung aus Discord (WI-0255 Paket 2), signiert wie von Discord, über den Empfänger als App-Rolle. Je Fall eine eigene Discord-Person, damit
 * die Grenze je Person und Stunde keinen Fall anhält. Die Konfiguration des Empfängers setzt `schreibwege-app-rolle.test.ts`.
 */
let discordPerson = 0;
async function ausDiscord(welt: Welt, pfad = "/api/discord/interactions"): Promise<LightMyRequestResponse> {
    discordPerson += 1;
    const person = {
        id: `11000000000000${String(10000 + discordPerson)}`,
        username: `rauch${String(discordPerson)}`,
        global_name: null,
    };
    const rumpf = JSON.stringify(
        abgeschickt(
            "bug",
            { titel: "Rauchtest", text: "Eine Meldung des Rauchtests aus Discord." },
            { wer: mitglied("Rauch", person) },
        ),
    );
    return welt.app.inject({ method: "POST", url: pfad, headers: signaturKoepfe(rumpf), payload: rumpf });
}

/** Die Nummer aus der Antwort des Empfängers (reine Zahl in Klammern); ohne Nummer ist der Vorgang nicht angelegt, und der Fall bricht ab. */
function opsAus(antwort: LightMyRequestResponse): { ops: string; id: number } {
    const nummer = /\(`(\d+)`\)/u.exec(antwort.body)?.[1];
    if (nummer === undefined) throw new Error(`Discord-Meldung ohne Vorgang: ${antwort.body}`);
    return { ops: opsId(nummer), id: Number(nummer) };
}

async function revision(welt: Welt, id: number): Promise<number> {
    const [row] = await welt.cluster.admin<{ revision: number }[]>`
        SELECT revision::int AS revision FROM avesmaps_kanal.vorgang WHERE id = ${id}
    `;
    return row!.revision;
}

const bild = (): Promise<Buffer> =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .png()
        .toBuffer();

/**
 * Was die Besuchszählung nach der Antwort schreibt, kommt etwas später an. Gemessen wird die Veränderung durch den Aufruf, nicht der
 * Bestand: Auf echten Daten (SCHREIBWEGE_DUMP, WI-0264) steht in `visitor_metric` schon die Summe der Entwicklungsdatenbank. `visitor_metric`
 * zählt die Summe der Spalte `count` (ein Upsert erhöht sie, auch wenn die Zeile schon da ist), `visitor_live` die Zeilen, die seit dem
 * Beginn des Aufrufs gesehen wurden (das Aufräumen löscht alte Zeilen, die Zeilenzahl allein sagte nichts).
 */
async function bisZeilen(
    welt: Welt,
    tafel: "visitor_metric" | "visitor_live",
    aufruf: () => Promise<LightMyRequestResponse>,
) {
    const messe = async (seit: Date): Promise<number> => {
        const [row] =
            tafel === "visitor_metric"
                ? await welt.cluster.admin<
                      { n: string }[]
                  >`SELECT COALESCE(sum(count), 0)::text AS n FROM visitor_metric`
                : await welt.cluster.admin<
                      { n: string }[]
                  >`SELECT count(*)::text AS n FROM visitor_live WHERE last_seen >= ${seit}`;
        return Number(row!.n);
    };
    const [uhr] = await welt.cluster.admin<{ jetzt: Date }[]>`SELECT now() AS jetzt`;
    const seit = uhr!.jetzt;
    const vorher = await messe(seit);
    const antwort = await aufruf();
    const ende = Date.now() + 5000;
    for (;;) {
        const nachher = await messe(seit);
        if (nachher > vorher) return antwort;
        if (Date.now() > ende)
            throw new Error(`${tafel} blieb unverändert: Die Zählung hat die Datenbank nicht erreicht`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** Eine Landschaft mit `n` Beschriftungen an Punkten, angelegt vom Superuser (alles Revision 1; `landscape-labels.test.ts`). */
async function rauchlandschaft(welt: Welt, n: number): Promise<{ regionId: string; labelIds: string[] }> {
    const regionId = kennung();
    const labelIds = Array.from({ length: n }, () => kennung());
    await welt.cluster.admin`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
        VALUES (${regionId}, 'aventuria', ${`Rauchheide ${regionId}`}, 'vegetation', 'steppe', 'rauchtest')
    `;
    for (const [i, labelId] of labelIds.entries())
        await welt.cluster.admin`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
            SELECT ${labelId}, 'aventuria', r.id, r.name, ST_SetSRID(ST_MakePoint(${640 + i * 4}, 330), 0), 'rauchtest'
              FROM region r WHERE r.public_id = ${regionId}
        `;
    return { regionId, labelIds };
}

/** Eine Sperre an einer Landschaft, genommen über die Route; gibt Lauf und Ziel zurück (`editor-lock.test.ts`). */
async function sperre(welt: Welt, person: Person): Promise<{ run: string; kind: "landscape"; id: string }> {
    const ziel = { run: randomUUID(), kind: "landscape" as const, id: kennung() };
    welt.muss(await welt.post("/api/editor/locks", person.cookie, { ...ziel, part: "form" }));
    return ziel;
}

export const KARTE_UND_KANAL: Faelle = {
    // Der Landschaftseditor (WI-0178 B2, `landscape.update`): Name, Beschriftung und Gebirge in EINER Operation; `FOR UPDATE` an
    // `region`, `map_label` und `terrain_control` braucht das UPDATE-Recht der App-Rolle. Am Gebirge (P4, WI-0245) legt die App-Rolle die
    // Zeile der Werte an und ersetzt das gezeichnete Netz (löschen und einfügen in `terrain_ridge_edge` und `terrain_ridge_point`), mit
    // Höhen je Stützpunkt (P9).
    "PATCH /api/editor/landscapes/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const regionId = kennung();
            const labelId = kennung();
            const areaId = kennung();
            await welt.cluster.admin`
                WITH r AS (
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
                    VALUES (${regionId}, 'aventuria', ${`Rauchberge ${regionId}`}, 'topographie', 'gebirge', 'rauchtest')
                    RETURNING id
                ), a AS (
                    INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
                    SELECT ${areaId}, r.id, 'aventuria', ST_GeomFromText('POLYGON((630 320, 650 320, 650 340, 630 340, 630 320))', 0),
                           'rauchtest'
                      FROM r
                )
                INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, source_system)
                SELECT ${labelId}, 'aventuria', r.id, ${`Rauchberge ${regionId}`}, ST_SetSRID(ST_MakePoint(640, 330), 0), 'rauchtest'
                  FROM r
            `;
            return welt.post(
                `/api/editor/landscapes/${regionId}`,
                person.cookie,
                {
                    operationId: operationId(),
                    baseRevision: 1,
                    changes: { name: `Rauchgrat ${regionId}` },
                    labels: [{ id: labelId, baseRevision: 1, changes: { size: 14 } }],
                    gebirge: [
                        {
                            area: areaId,
                            changes: {
                                kammhoehe: 2000,
                                modell: { grat: 0.1 },
                                netz: {
                                    kaemme: [
                                        {
                                            punkte: [
                                                [632, 330],
                                                [648, 331],
                                            ],
                                            rang: "haupt",
                                            // Eine Höhe je Stützpunkt (WI-0249 P9, `heights_schritt`, Migration 0219).
                                            hoehen: [[0, 2100]],
                                        },
                                    ],
                                    nebengipfel: [{ x: 640, y: 335 }],
                                },
                                baseRevision: 0,
                            },
                        },
                    ],
                },
                "PATCH",
            );
        },
    },
    // Beschriftungen anlegen und löschen (WI-0232, `label.create` und `label.retire`): INSERT in `map_label`, `FOR UPDATE` an `region`
    // und `map_label`, die Landschaft wird über ihre Revision berührt.
    "POST /api/editor/landscapes/:id/labels": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const { regionId, labelIds } = await rauchlandschaft(welt, 1);
            return welt.post(`/api/editor/landscapes/${regionId}/labels`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                position: [652, 334],
                from: labelIds[0],
            });
        },
    },
    // Still gelegt, nicht hart gelöscht (die App-Rolle hat kein DELETE); zwei Beschriftungen, sonst wäre es die letzte (409 `last_label`).
    "POST /api/editor/landscapes/:id/labels/:labelId/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const { regionId, labelIds } = await rauchlandschaft(welt, 2);
            return welt.post(`/api/editor/landscapes/${regionId}/labels/${labelIds[1]!}/retire`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                labelRevision: 1,
            });
        },
    },
    "POST /api/editor/locks": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            return welt.post("/api/editor/locks", person.cookie, {
                run: randomUUID(),
                kind: "landscape",
                id: kennung(),
                part: "form",
            });
        },
    },
    "POST /api/editor/locks/heartbeat": {
        erwartet: 200,
        async rufe(welt) {
            const person = await formRecht(welt);
            const { run, kind, id } = await sperre(welt, person);
            return welt.post("/api/editor/locks/heartbeat", person.cookie, { run, locks: [{ kind, id }] });
        },
    },
    "POST /api/editor/locks/lift": {
        erwartet: 204,
        async rufe(welt) {
            const { kind, id } = await sperre(welt, await formRecht(welt));
            return welt.post("/api/editor/locks/lift", (await welt.jemand("admin")).cookie, { kind, id });
        },
    },
    "POST /api/editor/locks/release": {
        erwartet: 204,
        async rufe(welt) {
            const person = await formRecht(welt);
            return welt.post("/api/editor/locks/release", person.cookie, await sperre(welt, person));
        },
    },
    "PATCH /api/editor/places/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(
                `/api/editor/places/${await ort(welt)}`,
                person.cookie,
                { operationId: operationId(), baseRevision: 1, changes: { hidden: true } },
                "PATCH",
            );
        },
    },
    "POST /api/editor/places/:id/move": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post(`/api/editor/places/${await ort(welt)}/move`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                to: { x: 432, y: 433 },
                pathEnds: [],
            });
        },
    },
    "POST /api/editor/places": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post("/api/editor/places", person.cookie, {
                operationId: operationId(),
                name: `Rauch Neu ${randomUUID().slice(0, 6)}`,
                subtype: "dorf",
                position: { x: 441, y: 445 },
            });
        },
    },
    "POST /api/editor/places/:id/take-off-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await neuerOrt(welt, person);
            return welt.post(`/api/editor/places/${id}/take-off-map`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    "POST /api/editor/places/:id/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await neuerOrt(welt, person);
            return welt.post(`/api/editor/places/${id}/delete`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    // Die Mehrfachauswahl der Ortsliste (WI-0237): ↺ auf Wiki-Werte und „Ganz löschen“ für mehrere, je EINE Operation.
    "POST /api/editor/places/sammel": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await neuerOrt(welt, person);
            // Ein eigener Wert und ein Wiki-Artikel mit anderem Wert: ↺ setzt ihn auf den Wiki-Wert (ohne Wiki-Wert bliebe er).
            const [artikel] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, einwohner, synced_at)
                VALUES (${`rauch-${id}`}, ${`https://de.wiki-aventurica.de/wiki/Rauch_${id}`}, 'Rauch', 'Rauch', '300', now())
                RETURNING id::text
            `;
            await welt.cluster.admin`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, ${`https://de.wiki-aventurica.de/wiki/Rauch_${id}`}, ${artikel!.id}, 'assigned', 'unknown'
                  FROM place WHERE public_id = ${id}::uuid
            `;
            await welt.cluster.admin`
                INSERT INTO place_detail (place_id, einwohner, einwohner_origin)
                SELECT id, '120', 'manual' FROM place WHERE public_id = ${id}::uuid
            `;
            return welt.post("/api/editor/places/sammel", person.cookie, {
                operationId: operationId(),
                orte: [{ id, baseRevision: 1 }],
                wiki: ["einwohner"],
            });
        },
    },
    "POST /api/editor/places/sammel/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const orte = [await neuerOrt(welt, person), await neuerOrt(welt, person)];
            return welt.post("/api/editor/places/sammel/delete", person.cookie, {
                operationId: operationId(),
                orte: orte.map((id) => ({ id, baseRevision: 1 })),
            });
        },
    },
    "POST /api/editor/places/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const id = await neuerOrt(welt, person);
            const geloescht = operationId();
            welt.muss(
                await welt.post(`/api/editor/places/${id}/delete`, person.cookie, {
                    operationId: geloescht,
                    baseRevision: 1,
                }),
            );
            return welt.post(`/api/editor/places/${id}/restore`, person.cookie, {
                operationId: operationId(),
                reverts: geloescht,
            });
        },
    },
    // Orte zurücknehmen (WI-0265 B4): zwei „Fertig“ am Ort über die Route, dann die Vorprüfung (liest nur) und die Rücknahme der Serie als App-Rolle.
    "POST /api/editor/places/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await ortMitSerie(welt);
            return welt.post(`/api/editor/places/${id}/restore-series/preview`, person.cookie, {
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/places/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await ortMitSerie(welt);
            return welt.post(`/api/editor/places/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/places/:id/sites/relation": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const [site] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO site (source_kind, source_key, name, site_type, source_system)
                VALUES ('weg', ${`wiki:rauch-${randomUUID()}`}, 'Rauchpfad', 'Weg', 'rauchtest')
                RETURNING id::text
            `;
            return welt.post(`/api/editor/places/${await ort(welt)}/sites/relation`, person.cookie, {
                operationId: operationId(),
                siteId: site!.id,
                weg: "hierher",
            });
        },
    },
    // „Neuer Weg“ (WI-0177): legt den Weg als App-Rolle an (Spalten-INSERT, Folge, Kurve), danach liest die Route die Enden.
    "POST /api/editor/paths": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post("/api/editor/paths", person.cookie, {
                operationId: operationId(),
                points: [
                    { x: 731, y: 291 },
                    { x: 734, y: 293 },
                    { x: 737, y: 291 },
                ],
            });
        },
    },
    // Teilen, Löschen, ↺, Abnehmen und Zurück (WI-0177 Stufe 3): Spalten-UPDATE an `path`, INSERT des hinteren Teils samt Wiki und Quellen.
    "POST /api/editor/paths/:id/split": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await rauchweg(welt);
            return welt.post(`/api/editor/paths/${publicId}/split`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                index: 1,
                at: { x: 716, y: 288 },
            });
        },
    },
    "POST /api/editor/paths/:id/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await rauchweg(welt);
            return welt.post(`/api/editor/paths/${publicId}/delete`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    "POST /api/editor/paths/:id/restore": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await rauchweg(welt, { aktiv: false });
            return welt.post(`/api/editor/paths/${publicId}/restore`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    // Wege zurücknehmen (WI-0265 B6a): zwei „Fertig“ derselben Person an einem Weg (eine Arbeitsserie, über die Route des Updates), dann die Vorprüfung (liest nur) und die Rücknahme der Serie als App-Rolle.
    "POST /api/editor/paths/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await wegMitSerie(welt);
            return welt.post(`/api/editor/paths/${id}/restore-series/preview`, person.cookie, {
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/paths/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const { person, id, mitglieder } = await wegMitSerie(welt);
            return welt.post(`/api/editor/paths/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: mitglieder,
                membersHash: mitgliederHash(mitglieder),
            });
        },
    },
    "POST /api/editor/paths/:id/take-off-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await rauchweg(welt);
            return welt.post(`/api/editor/paths/${publicId}/take-off-map`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    // Die Felder der Straße (W5b): Spalten-UPDATE an `path` (Name, Art, „Name auf der Karte“), FOR UPDATE über die Abschnitte.
    "POST /api/editor/paths/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            // Ein eigener Name: Alle Rauchwege heißen gleich und wären EINE Straße mit mehr Abschnitten.
            const publicId = kennung();
            await welt.cluster.admin`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                VALUES (${publicId}, 'aventuria', ${`Rauchstraße alt ${publicId}`}, 'Weg', TRUE, FALSE,
                        ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), 'rauchtest')
            `;
            // Ein weiterer Straßenname im selben Schreiben (WI-0302): die App-Rolle legt eine Zeile in `path_wiki_assignment` an.
            await welt.cluster.admin`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                VALUES (${`rauch-weiter-${publicId}`}, ${`https://de.wiki-aventurica.de/wiki/Rauch_Weiter_${publicId}`}, 'Rauch Weiter', 'strasse')
            `;
            return welt.post(`/api/editor/paths/${publicId}/update`, person.cookie, {
                operationId: operationId(),
                sections: [{ publicId, baseRevision: 1, weitere: [`rauch-weiter-${publicId}`] }],
                name: `Rauchstraße ${publicId}`,
                subtype: "Pfad",
                labelVisible: false,
                // Die Kurve im selben Schreiben (W5b Schritt 3, vorher `path.reshape`): die App-Rolle schreibt `geom` und `path_visual`.
                shape: {
                    publicId,
                    points: [
                        { x: 713, y: 287 },
                        { x: 718, y: 289 },
                        { x: 723, y: 287 },
                    ],
                    carried: [],
                },
            });
        },
    },
    // „Auswahl zu neuem Weg“ (WI-0252): Name an zwei Abschnitten, ihre Wiki-Zuordnung (beide Tafeln) still gelegt, danach ↺ derselben
    // Operation über die Rücknahme der Wege (WI-0265 B6a2: liest das Protokoll, holt die Zeilen zurück), alles als App-Rolle.
    "POST /api/editor/paths/neuer-weg": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = kennung();
            const b = kennung();
            for (const [id, x] of [
                [a, 713],
                [b, 723],
            ] as const) {
                await welt.cluster.admin`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                    VALUES (${id}, 'aventuria', ${`Rauchweg alt ${id}`}, 'Weg', TRUE, FALSE,
                            ST_GeomFromText(${`LINESTRING(${String(x)} 287, ${String(x + 10)} 287)`}, 0), 'rauchtest')
                `;
                await welt.cluster.admin`
                    INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state, assignment_origin)
                    SELECT id, 'main', ${`https://de.wiki-aventurica.de/wiki/Rauch_${id}`}, 'address_only', 'legacy_editor'
                      FROM path WHERE public_id = ${id}::uuid
                `;
                await welt.cluster.admin`
                    INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url)
                    VALUES ('weg', ${id}::uuid, ${`wiki:rauch-${id}`}, ${`https://de.wiki-aventurica.de/wiki/Rauch_${id}`})
                `;
            }
            const neu = operationId();
            welt.muss(
                await welt.post("/api/editor/paths/neuer-weg", person.cookie, {
                    operationId: neu,
                    name: `Rauchweg neu ${a}`,
                    sections: [
                        { publicId: a, baseRevision: 1 },
                        { publicId: b, baseRevision: 1 },
                    ],
                }),
            );
            return welt.post(`/api/editor/paths/${a}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [neu],
                membersHash: mitgliederHash([neu]),
            });
        },
    },
    // Der Straßen-Assistent (WI-0310): die Strecke liest Wege, Orte, Zuordnungen und Quellen als App-Rolle.
    "POST /api/editor/paths/strassen-assistent/strecke": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = kennung();
            await welt.cluster.admin`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                VALUES (${a}, 'aventuria', ${`Rauchstrecke ${a}`}, 'Strasse', TRUE, FALSE, ST_GeomFromText('LINESTRING(713 250, 723 250)', 0), 'rauchtest')
            `;
            return welt.post("/api/editor/paths/strassen-assistent/strecke", person.cookie, { anker: a, key: null });
        },
    },
    // Zuweisen (WI-0310, `path.assign_street`): Name, Hauptzuweisung und X2 angelegt, die weitere Zuweisung desselben Artikels still gelegt, eine Quelle angelegt und eine
    // belebt, das Etikett (`path_canon`) und die Herkunft des Namens, alles als App-Rolle; danach ↺ derselben Operation über die Rücknahme der Wege (setzt die Zeilen zurück).
    "POST /api/editor/paths/strassen-assistent/zuweisen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = kennung();
            const b = kennung();
            const strasse = `Rauchassistent ${a}`;
            const adm = welt.cluster.admin;
            await adm`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                VALUES (${a}, 'aventuria', ${strasse}, 'Strasse', TRUE, FALSE, ST_GeomFromText('LINESTRING(713 240, 718 240)', 0), 'rauchtest'),
                       (${b}, 'aventuria', 'Strasse-11192', 'Strasse', TRUE, FALSE, ST_GeomFromText('LINESTRING(718 240, 723 240)', 0), 'rauchtest')
            `;
            const [stand] = await adm<{ id: string }[]>`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                VALUES (${`rauch-assistent-${a}`}, ${`https://de.wiki-aventurica.de/wiki/Rauch_Assistent_${a}`}, ${strasse}, 'strasse')
                RETURNING id::text AS id
            `;
            await adm`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, 'further', ${`https://de.wiki-aventurica.de/wiki/Rauch_Assistent_${a}`}, ${stand!.id}::bigint, 'assigned', 'legacy_editor'
                  FROM path WHERE public_id = ${b}::uuid
            `;
            const quellen = await adm<{ id: string }[]>`
                INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official)
                VALUES (${`legacy-id:${String(931000 + naechste)}`}, 'provisional', ${931000 + naechste}, 'Rauchquelle Eins', 'regelbuch', TRUE),
                       (${`legacy-id:${String(932000 + naechste)}`}, 'provisional', ${932000 + naechste}, 'Rauchquelle Zwei', 'abenteuer', FALSE)
                RETURNING id::text AS id
            `;
            await adm`
                INSERT INTO path_source (path_id, source_id, position, source_system)
                SELECT p.id, q.id::bigint, 0, 'legacy' FROM path p, unnest(${quellen.map((q) => q.id)}::text[]) AS q(id) WHERE p.public_id = ${a}::uuid
            `;
            await adm`
                INSERT INTO path_source (path_id, source_id, position, state, is_active, retired_at, retired_origin, source_system)
                SELECT id, ${quellen[0]!.id}::bigint, 0, 'retired', FALSE, now(), 'editor', 'legacy' FROM path WHERE public_id = ${b}::uuid
            `;
            const zugewiesen = operationId();
            welt.muss(
                await welt.post("/api/editor/paths/strassen-assistent/zuweisen", person.cookie, {
                    operationId: zugewiesen,
                    name: strasse,
                    key: `rauch-assistent-${a}`,
                    quellen: true,
                    sections: [
                        { publicId: a, baseRevision: 1 },
                        { publicId: b, baseRevision: 1 },
                    ],
                    entfernen: [],
                }),
            );
            return welt.post(`/api/editor/paths/${b}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [zugewiesen],
                membersHash: mitgliederHash([zugewiesen]),
            });
        },
    },
    // „Wege verbinden“ (WI-0252): zwei Abschnitte Ende an Ende werden einer (Linie und `is_active` als App-Rolle, `path_visual`),
    // danach ↺ derselben Operation über die Rücknahme der Wege (WI-0265 B6a2: liest das Protokoll, holt den zweiten zurück).
    "POST /api/editor/paths/verbinden": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = kennung();
            const b = kennung();
            for (const [id, linie] of [
                [a, "LINESTRING(713 270, 716 271, 718 270)"],
                [b, "LINESTRING(718 270, 721 269, 723 270)"],
            ] as const)
                await welt.cluster.admin`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
                    VALUES (${id}, 'aventuria', ${`Rauchkette ${a}`}, 'Weg', TRUE, FALSE, ST_GeomFromText(${linie}, 0), 'rauchtest')
                `;
            const verbunden = operationId();
            welt.muss(
                await welt.post("/api/editor/paths/verbinden", person.cookie, {
                    operationId: verbunden,
                    vorlage: a,
                    sections: [
                        { publicId: a, baseRevision: 1 },
                        { publicId: b, baseRevision: 1 },
                    ],
                }),
            );
            return welt.post(`/api/editor/paths/${a}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [verbunden],
                membersHash: mitgliederHash([verbunden]),
            });
        },
    },
    // Die ganze Straße (T49): derselbe Wechsel für alle Abschnitte in EINER Operation.
    "POST /api/editor/paths/:id/street/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await eigenerWeg(welt, "Rauchstraße");
            return welt.post(`/api/editor/paths/${publicId}/street/delete`, person.cookie, {
                operationId: operationId(),
                sections: [{ publicId, baseRevision: 1 }],
            });
        },
    },
    "POST /api/editor/paths/:id/street/take-off-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await eigenerWeg(welt, "Rauchstraße");
            return welt.post(`/api/editor/paths/${publicId}/street/take-off-map`, person.cookie, {
                operationId: operationId(),
                sections: [{ publicId, baseRevision: 1 }],
            });
        },
    },
    // Mehrere Wege auf einmal (WI-0252, „Weg entfernen …“ an der Mehrfachauswahl): zwei Wege in EINER Operation als App-Rolle,
    // danach ↺ derselben Operation über die Rücknahme der Wege (WI-0265 B6a: liest das Protokoll, holt beide zurück).
    "POST /api/editor/paths/sammel/delete": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = await eigenerWeg(welt, "Rauchwege a");
            const b = await eigenerWeg(welt, "Rauchwege b");
            const geloescht = operationId();
            welt.muss(
                await welt.post("/api/editor/paths/sammel/delete", person.cookie, {
                    operationId: geloescht,
                    sections: [
                        { publicId: a, baseRevision: 1 },
                        { publicId: b, baseRevision: 1 },
                    ],
                }),
            );
            return welt.post(`/api/editor/paths/${a}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [geloescht],
                membersHash: mitgliederHash([geloescht]),
            });
        },
    },
    "POST /api/editor/paths/sammel/take-off-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const a = await eigenerWeg(welt, "Rauchwege c");
            const b = await eigenerWeg(welt, "Rauchwege d");
            return welt.post("/api/editor/paths/sammel/take-off-map", person.cookie, {
                operationId: operationId(),
                sections: [
                    { publicId: a, baseRevision: 1 },
                    { publicId: b, baseRevision: 1 },
                ],
            });
        },
    },
    "POST /api/editor/paths/:id/put-on-map": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = await rauchweg(welt, { aktiv: false, abgenommen: true });
            return welt.post(`/api/editor/paths/${publicId}/put-on-map`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
            });
        },
    },
    // Die Felder einer Kraftlinie (WI-0205 K6): sperrt alle Abschnitte (FOR UPDATE) und schreibt sie als App-Rolle.
    "POST /api/editor/powerlines/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = kennung();
            await welt.cluster.admin`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom,
                                       source_system)
                VALUES (${publicId}, 'aventuria', ${`Rauchlinie ${publicId}`}, TRUE, ${kennung()}, ${kennung()},
                        ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), ST_GeomFromText('LINESTRING(713 287, 723 287)', 0),
                        'rauchtest')
            `;
            return welt.post(`/api/editor/powerlines/${publicId}/update`, person.cookie, {
                operationId: operationId(),
                segments: [{ id: publicId, baseRevision: 1 }],
                labelVisible: false,
                description: "Rauch",
            });
        },
    },
    // Eine Kraftlinie entfernen (WI-0205 K10 knapp, T39): alle Abschnitte still, gesperrt mit FOR UPDATE, als App-Rolle.
    "POST /api/editor/powerlines/:id/retire": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = kennung();
            await welt.cluster.admin`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom,
                                       source_system)
                VALUES (${publicId}, 'aventuria', ${`Rauchlinie ${publicId}`}, TRUE, ${kennung()}, ${kennung()},
                        ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), ST_GeomFromText('LINESTRING(713 287, 723 287)', 0),
                        'rauchtest')
            `;
            return welt.post(`/api/editor/powerlines/${publicId}/retire`, person.cookie, {
                operationId: operationId(),
                segments: [{ id: publicId, baseRevision: 1 }],
            });
        },
    },
    // Mehrere Kraftlinien auf einmal entfernen (WI-0238, T57): EINE Operation, jede Linie gesperrt mit FOR UPDATE, als App-Rolle.
    "POST /api/editor/powerlines/sammel/stand": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const linien = [kennung(), kennung()];
            for (const publicId of linien)
                await welt.cluster.admin`
                    INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom,
                                           source_system)
                    VALUES (${publicId}, 'aventuria', ${`Rauchlinie ${publicId}`}, TRUE, ${kennung()}, ${kennung()},
                            ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), ST_GeomFromText('LINESTRING(713 287, 723 287)', 0),
                            'rauchtest')
                `;
            return welt.post("/api/editor/powerlines/sammel/stand", person.cookie, {
                operationId: operationId(),
                wechsel: "powerline.retire",
                lines: linien.map((anker) => ({ anker, segments: [{ id: anker, baseRevision: 1 }] })),
            });
        },
    },
    // ↺ auf Wiki-Werte für mehrere Kraftlinien (WI-0238): liest Artikel und Herkunft, schreibt Linie und `field_origin` als App-Rolle.
    "POST /api/editor/powerlines/sammel/wiki": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            const publicId = kennung();
            const schluessel = `k-rauch-${publicId}`;
            await welt.cluster.admin`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, description, from_public_id, to_public_id, geom,
                                       drawn_geom, source_system)
                VALUES (${publicId}, 'aventuria', ${`Rauchlinie ${publicId}`}, TRUE, 'Eigene Zeile.', ${kennung()}, ${kennung()},
                        ST_GeomFromText('LINESTRING(713 287, 723 287)', 0), ST_GeomFromText('LINESTRING(713 287, 723 287)', 0),
                        'rauchtest')
            `;
            await welt.cluster.admin`
                WITH abzug AS (
                    INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, description, staerke, affinitaet, laenge, regionen)
                    VALUES (${schluessel}, ${`https://de.wiki-aventurica.de/wiki/${schluessel}`}, 'Rauchader', 'Aus dem Wiki.',
                            NULL, NULL, NULL, NULL)
                    RETURNING id
                )
                INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT p.id, ${`https://de.wiki-aventurica.de/wiki/${schluessel}`}, abzug.id, 'assigned', 'unknown'
                  FROM powerline p, abzug WHERE p.public_id = ${publicId}::uuid
            `;
            return welt.post("/api/editor/powerlines/sammel/wiki", person.cookie, {
                operationId: operationId(),
                felder: ["description"],
                lines: [{ anker: publicId, segments: [{ id: publicId, baseRevision: 1 }] }],
            });
        },
    },
    "POST /api/route/landscapes": {
        erwartet: 200,
        rufe: (welt) =>
            welt.post("/api/route/landscapes", undefined, {
                stages: [
                    [
                        [
                            [95, 105],
                            [125, 105],
                        ],
                    ],
                ],
            }),
    },
    "POST /api/route/stage/lore": {
        erwartet: 200,
        rufe: (welt) => welt.post("/api/route/stage/lore", undefined, { paths: [] }),
    },
    "POST /api/route/unterwegs": {
        erwartet: 200,
        rufe: (welt) => welt.post("/api/route/unterwegs", undefined, { stages: [{ paths: [] }] }),
    },
    "POST /api/share": {
        erwartet: 201,
        rufe: (welt) =>
            welt.post("/api/share", undefined, {
                v: 1,
                waypoints: [`p:${String(randomInt(1, 999))}.456:789.5`, "p:200.5:300.5"],
                options: {
                    optimize: "fastest",
                    minimizeTransfers: false,
                    enabled: { land: true, river: true, sea: true },
                    transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
                    hoursPerDay: 8,
                },
                view: { series: AVENTURIA_SERIES.defaultSeries, view: "standard", layer: "alle" },
            }),
    },
    "POST /api/besuch": {
        erwartet: 204,
        async rufe(welt) {
            return bisZeilen(welt, "visitor_metric", () =>
                welt.post("/api/besuch", undefined, { ereignisse: [{ metrik: "pageview" }], stunde: 12 }),
            );
        },
    },
    "POST /api/besuch/ping": {
        erwartet: 204,
        async rufe(welt) {
            return bisZeilen(welt, "visitor_live", () =>
                welt.post("/api/besuch/ping", undefined, { zustand: "active" }),
            );
        },
    },
    "POST /api/kanal/vorgaenge": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            return welt.post("/api/kanal/vorgaenge", person.cookie, {
                operationId: operationId(),
                kategorie: "bug",
                prioritaet: "hoch",
                titel: "Rauchtest",
                nachricht: "Ein Vorgang des Rauchtests.",
            });
        },
    },
    // Discord (WI-0255 Paket 2): Erst mit einer Vorgangsnummer in der Antwort hat die App-Rolle wirklich angelegt.
    "POST /api/discord/interactions": {
        erwartet: 200,
        async rufe(welt) {
            const antwort = await ausDiscord(welt);
            opsAus(antwort);
            return antwort;
        },
    },
    "POST /api/discord/interactions.php": {
        erwartet: 200,
        async rufe(welt) {
            const antwort = await ausDiscord(welt, "/api/discord/interactions.php");
            opsAus(antwort);
            return antwort;
        },
    },
    "POST /api/kanal/vorgaenge/:ops/sichten": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops, id } = opsAus(await ausDiscord(welt));
            return welt.post(`/api/kanal/vorgaenge/${ops}/sichten`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, id),
                an: "claudia",
            });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/nachricht": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops } = await melde(welt, person);
            return welt.post(`/api/kanal/vorgaenge/${ops}/nachricht`, person.cookie, {
                operationId: operationId(),
                text: "Nachtrag",
            });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/abschliessen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops, id } = await melde(welt, person);
            return welt.post(`/api/kanal/vorgaenge/${ops}/abschliessen`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, id),
                art: "erledigt",
            });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/loeschen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops, id } = await melde(welt, person);
            welt.muss(
                await welt.post(`/api/kanal/vorgaenge/${ops}/abschliessen`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: await revision(welt, id),
                    art: "erledigt",
                }),
            );
            return welt.post(`/api/kanal/vorgaenge/${ops}/loeschen`, person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/wieder-oeffnen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops, id } = await melde(welt, person);
            await zurAbnahme(welt, id);
            return welt.post(`/api/kanal/vorgaenge/${ops}/wieder-oeffnen`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, id),
                kommentar: "Noch nicht behoben",
            });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/abnehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops, id } = await melde(welt, person);
            await zurAbnahme(welt, id);
            return welt.post(`/api/kanal/vorgaenge/${ops}/abnehmen`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(welt, id),
            });
        },
    },
    "POST /api/kanal/vorgaenge/:ops/bilder": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops } = await melde(welt, person);
            return welt.post(`/api/kanal/vorgaenge/${ops}/bilder`, person.cookie, {
                operationId: operationId(),
                file: { name: "rauch.png", dataBase64: (await bild()).toString("base64") },
            });
        },
    },
    "POST /api/kanal/bilder/:id/entfernen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { ops } = await melde(welt, person);
            const hochgeladen = operationId();
            welt.muss(
                await welt.post(`/api/kanal/vorgaenge/${ops}/bilder`, person.cookie, {
                    operationId: hochgeladen,
                    file: { name: "rauch.png", dataBase64: (await bild()).toString("base64") },
                }),
            );
            const [row] = await welt.cluster.admin<{ id: string }[]>`
                SELECT id::text FROM avesmaps_kanal.bild WHERE operation_id = ${hochgeladen}::uuid
            `;
            return welt.post(`/api/kanal/bilder/${row!.id}/entfernen`, person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/benachrichtigungen/gelesen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await redakteurin(welt);
            return welt.post("/api/benachrichtigungen/gelesen", person.cookie, { bis: 1 });
        },
    },
    "POST /api/benachrichtigungen/:id/antwort": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiber(welt);
            const { id } = await melde(welt, person);
            await zurAbnahme(welt, id);
            const [row] = await welt.cluster.admin<{ id: string }[]>`
                SELECT id::text FROM public.benachrichtigung WHERE an_person = ${person.id} AND frage_geloest
                 ORDER BY id DESC LIMIT 1
            `;
            return welt.post(`/api/benachrichtigungen/${row!.id}/antwort`, person.cookie, {
                operationId: operationId(),
                antwort: "geloest",
            });
        },
    },
};
