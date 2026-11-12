import { randomUUID } from "node:crypto";
import {
    editorWikiBoxRestoreSeriesPreviewUrl,
    editorWikiBoxRestoreSeriesUrl,
    wikiBoxEntfernenUrl,
    wikiBoxSyncUrl,
    wikiBoxZuweisenUrl,
    type WikiBoxArt,
} from "@avesmaps3d/shared";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import type { Faelle, Welt } from "./welt.ts";

/**
 * Die Wiki-Box im Objekteditor (WI-0253): jeder Schreibweg einmal als App-Rolle. Zuweisen und Entfernen schreiben je Art in andere Tafeln (Ort, Weg, Kraftlinie in ihre Zuordnungstafel, Gebiet und
 * Landschaft an der Zeile selbst, dazu die Tafel X2 und die Vermerke je Feld); darum läuft jede Route für ALLE sechs Arten (der Gipfel schreibt in seine Zuordnungstafel und in den Vermerk seiner Höhe), damit ein fehlendes Recht an irgendeiner Tafel auffällt. Der Sync reiht nur einen
 * Auftrag ein. Jeder Fall räumt seine Zeilen selbst ab.
 */

const operationId = (): string => randomUUID();
const ARTEN: readonly WikiBoxArt[] = ["ort", "weg", "gebiet", "region", "gipfel", "kraftlinie"];

interface Objekte {
    ids: Record<WikiBoxArt, string>;
    /** Der Schlüssel eines zweiten Artikels je Art (zum Zuweisen). */
    anderer: Record<WikiBoxArt, string>;
}

let zaehler = 0;

/** Die sechs Objekte mit Artikel, Wiki-Stand und einem zweiten Artikel; `zugewiesen: false` lässt die Objekte ohne Artikel. */
async function legeObjekteAn(welt: Welt, zugewiesen: boolean): Promise<Objekte> {
    zaehler += 1;
    const n = zaehler;
    const db = welt.cluster.admin;
    const ids = Object.fromEntries(ARTEN.map((art) => [art, randomUUID()])) as Record<WikiBoxArt, string>;
    const adresse = (titel: string): string => `https://de.wiki-aventurica.de/wiki/${titel}`;
    const x = 600 + n * 4;

    // Zwei Wiki-Stände je Art.
    await db`
        INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, description, einwohner)
        VALUES (${`rauchbox-ort-${n}`}, ${adresse(`Rauchort${n}`)}, ${`Rauchort ${n}`}, ${`Rauchort ${n}`}, 'Text', '100'),
               (${`rauchbox-ort2-${n}`}, ${adresse(`Rauchort2-${n}`)}, ${`Rauchort2 ${n}`}, ${`Rauchort2 ${n}`}, NULL, NULL)
    `;
    await db`
        INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name)
        VALUES (${`rauchbox-weg-${n}`}, ${adresse(`Rauchweg${n}`)}, ${`Rauchweg ${n}`}), (${`rauchbox-weg2-${n}`}, ${adresse(`Rauchweg2-${n}`)}, ${`Rauchweg2 ${n}`})
    `;
    await db`
        INSERT INTO wiki_territory_snapshot (wiki_key, ruler)
        VALUES (${`wiki:rauchbox-gebiet-${n}`}, 'Wer'), (${`wiki:rauchbox-gebiet2-${n}`}, NULL)
    `;
    await db`
        INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name)
        VALUES (${`rauchbox-region-${n}`}, ${adresse(`Rauchregion${n}`)}, ${`Rauchregion ${n}`}), (${`rauchbox-region2-${n}`}, ${adresse(`Rauchregion2-${n}`)}, ${`Rauchregion2 ${n}`}),
               (${`rauchbox-gipfel-${n}`}, ${adresse(`Rauchgipfel${n}`)}, ${`Rauchgipfel ${n}`}), (${`rauchbox-gipfel2-${n}`}, ${adresse(`Rauchgipfel2-${n}`)}, ${`Rauchgipfel2 ${n}`})
    `;
    await db`
        INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, description)
        VALUES (${`rauchbox-linie-${n}`}, ${adresse(`Rauchlinie${n}`)}, ${`Rauchlinie ${n}`}, 'Beschreibung'),
               (${`rauchbox-linie2-${n}`}, ${adresse(`Rauchlinie2-${n}`)}, ${`Rauchlinie2 ${n}`}, NULL)
    `;

    // Die Objekte.
    await db`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
        VALUES (${ids.ort}, 'aventuria', ${`Rauchbox-Ort ${n}`}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, 610), 0), 'rauchtest')
    `;
    await db`
        INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
        VALUES (${ids.weg}, 'aventuria', ${`Rauchbox-Weg ${n}`}, 'Weg', TRUE, FALSE,
                ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 620), ST_MakePoint(${x + 1}, 621)), 0), 'rauchtest', TRUE)
    `;
    await db`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
        VALUES (${ids.gebiet}, 'aventuria', ${`Rauchbox-Gebiet ${n}`}, '#336699', 0.7, 'rauchtest')
    `;
    await db`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type)
        VALUES (${ids.region}, 'aventuria', ${`Rauchbox-Region ${n}`}, 'derographisch', 'kontinent')
    `;
    // Der Gipfel trägt eine Höhe: Entfernen schreibt ihren Vermerk (`field_origin`, Art peak).
    await db`
        INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
        VALUES (${ids.gipfel}, 'aventuria', ${`Rauchbox-Gipfel ${n}`}, 'berggipfel', ST_SetSRID(ST_MakePoint(${x}, 640), 0), 1500)
    `;
    await db`
        INSERT INTO powerline (public_id, map_domain_id, name, description, from_public_id, to_public_id, geom, drawn_geom, source_system)
        VALUES (${ids.kraftlinie}, 'aventuria', ${`Rauchbox-Linie ${n}`}, NULL, ${randomUUID()}, ${randomUUID()},
                ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 630), ST_MakePoint(${x + 1}, 631)), 0),
                ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, 630), ST_MakePoint(${x + 1}, 631)), 0), 'rauchtest')
    `;
    if (zugewiesen) {
        await db`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, s.wiki_url, s.id, 'assigned', 'legacy_editor' FROM place p, wiki_settlement_snapshot s
             WHERE p.public_id = ${ids.ort} AND s.wiki_key = ${`rauchbox-ort-${n}`}
        `;
        await db`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, 'main', s.wiki_url, s.id, 'assigned', 'legacy_editor' FROM path p, wiki_path_snapshot s
             WHERE p.public_id = ${ids.weg} AND s.wiki_key = ${`rauchbox-weg-${n}`}
        `;
        await db`
            UPDATE territory SET wiki_key = ${`wiki:rauchbox-gebiet-${n}`}, wiki_url = ${adresse(`Rauchgebiet${n}`)} WHERE public_id = ${ids.gebiet}
        `;
        await db`
            UPDATE region SET wiki_region_key = ${`rauchbox-region-${n}`}, wiki_url = ${adresse(`Rauchregion${n}`)} WHERE public_id = ${ids.region}
        `;
        await db`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, s.wiki_url, s.id, 'assigned', 'legacy_editor' FROM powerline p, wiki_powerline_snapshot s
             WHERE p.public_id = ${ids.kraftlinie} AND s.wiki_key = ${`rauchbox-linie-${n}`}
        `;
        await db`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT tp.id, s.wiki_url, s.id, 'assigned', 'unknown' FROM terrain_peak tp, wiki_region_snapshot s
             WHERE tp.public_id = ${ids.gipfel} AND s.wiki_key = ${`rauchbox-gipfel-${n}`}
        `;
        // Vermerke „wiki“ an Namen, damit das Lösen sie in „manual“ verwandelt.
        await db`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            VALUES ('place', ${ids.ort}, 'name', 'wiki'), ('path', ${ids.weg}, 'name', 'wiki'), ('landscape', ${ids.region}, 'name', 'wiki'),
                   ('powerline', ${ids.kraftlinie}, 'name', 'wiki')
        `;
    }
    return {
        ids,
        anderer: {
            ort: `rauchbox-ort2-${n}`,
            weg: `rauchbox-weg2-${n}`,
            gebiet: `wiki:rauchbox-gebiet2-${n}`,
            region: `rauchbox-region2-${n}`,
            gipfel: `rauchbox-gipfel2-${n}`,
            kraftlinie: `rauchbox-linie2-${n}`,
        },
    };
}

/** Räumt Objekte, Zuordnungen, Wiki-Stände und Vermerke dieses Falls ab (die Operationen und das Fachprotokoll bleiben: Sie sind angehängt, nicht gelöscht). */
async function raeumeAb(welt: Welt, objekte: Objekte): Promise<void> {
    const db = welt.cluster.admin;
    const ids = Object.values(objekte.ids);
    await db`DELETE FROM wikisync_objekt WHERE objekt_id = ANY(${ids}::uuid[])`;
    await db`DELETE FROM wiki_key_assignment WHERE object_public_id = ANY(${ids}::uuid[])`;
    await db`DELETE FROM field_origin WHERE object_id = ANY(${ids}::uuid[])`;
    await db`DELETE FROM place_wiki_assignment WHERE place_id IN (SELECT id FROM place WHERE public_id = ${objekte.ids.ort})`;
    await db`DELETE FROM place_detail WHERE place_id IN (SELECT id FROM place WHERE public_id = ${objekte.ids.ort})`;
    await db`DELETE FROM place WHERE public_id = ${objekte.ids.ort}`;
    await db`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE public_id = ${objekte.ids.weg})`;
    await db`DELETE FROM path WHERE public_id = ${objekte.ids.weg}`;
    await db`DELETE FROM territory_detail WHERE territory_id IN (SELECT id FROM territory WHERE public_id = ${objekte.ids.gebiet})`;
    await db`DELETE FROM territory WHERE public_id = ${objekte.ids.gebiet}`;
    await db`DELETE FROM region WHERE public_id = ${objekte.ids.region}`;
    await db`DELETE FROM terrain_peak_wiki_assignment WHERE terrain_peak_id IN (SELECT id FROM terrain_peak WHERE public_id = ${objekte.ids.gipfel})`;
    await db`DELETE FROM terrain_peak WHERE public_id = ${objekte.ids.gipfel}`;
    await db`DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE public_id = ${objekte.ids.kraftlinie})`;
    await db`DELETE FROM powerline WHERE public_id = ${objekte.ids.kraftlinie}`;
    await db`DELETE FROM wiki_settlement_snapshot WHERE wiki_key LIKE 'rauchbox-%'`;
    await db`DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'rauchbox-%'`;
    await db`DELETE FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:rauchbox-%'`;
    await db`DELETE FROM wiki_region_snapshot WHERE wiki_key LIKE 'rauchbox-%'`;
    await db`DELETE FROM wiki_powerline_snapshot WHERE wiki_key LIKE 'rauchbox-%'`;
}

/**
 * Die Rücknahme der Box (WI-0265 B8d): je Art zuweisen und lösen, dann das Zuweisen zurück (`weise` oder `entferne`, Zuordnungstafel, Tafel X2, Herkunft der Zuordnung als UPDATE auf die Zuordnungstafel,
 * Revision des Trägers) und das Lösen zurück. Gibt für die Vorschau den Aufruf zurück, für die Rücknahme den des letzten Falls (Kraftlinie).
 */
async function ruecknahmeAllerArten(welt: Welt, vorschau: boolean): Promise<Awaited<ReturnType<Welt["post"]>>> {
    const person = await welt.jemand("editor");
    const objekte = await legeObjekteAn(welt, true);
    try {
        let letzte: Awaited<ReturnType<Welt["post"]>> | undefined;
        for (const art of ARTEN) {
            // Zuweisen (ein zweiter Artikel) und, davon unabhängig, die Rücknahme dieses Schritts; danach Lösen und dessen Rücknahme.
            const zuweisen = operationId();
            welt.muss(
                await welt.post(wikiBoxZuweisenUrl(art, objekte.ids[art]), person.cookie, {
                    operationId: zuweisen,
                    key: objekte.anderer[art],
                }),
            );
            const url = vorschau
                ? editorWikiBoxRestoreSeriesPreviewUrl(art, objekte.ids[art])
                : editorWikiBoxRestoreSeriesUrl(art, objekte.ids[art]);
            letzte = await welt.post(url, person.cookie, {
                ...(vorschau ? {} : { operationId: operationId() }),
                members: [zuweisen],
                membersHash: mitgliederHash([zuweisen]),
            });
            if (art !== ARTEN[ARTEN.length - 1]) welt.muss(letzte);
        }
        return letzte!;
    } finally {
        await raeumeAb(welt, objekte);
    }
}

export const WIKI_BOX: Faelle = {
    "POST /api/editor/wiki-box/:art/:id/restore-series/preview": {
        erwartet: 200,
        rufe: (welt) => ruecknahmeAllerArten(welt, true),
    },
    "POST /api/editor/wiki-box/:art/:id/restore-series": {
        erwartet: 200,
        rufe: (welt) => ruecknahmeAllerArten(welt, false),
    },
    // Den Artikel zuordnen, für alle sechs Arten; die Antwort des letzten Aufrufs (Kraftlinie) ist das Ergebnis.
    "POST /api/editor/wiki-box/:art/:id/zuweisen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const objekte = await legeObjekteAn(welt, true);
            try {
                for (const art of ARTEN.slice(0, -1)) {
                    welt.muss(
                        await welt.post(wikiBoxZuweisenUrl(art, objekte.ids[art]), person.cookie, {
                            operationId: operationId(),
                            key: objekte.anderer[art],
                        }),
                    );
                }
                return await welt.post(wikiBoxZuweisenUrl("kraftlinie", objekte.ids.kraftlinie), person.cookie, {
                    operationId: operationId(),
                    key: objekte.anderer.kraftlinie,
                });
            } finally {
                await raeumeAb(welt, objekte);
            }
        },
    },
    // Die Zuordnung lösen, für alle sechs Arten: Vermerke werden „manual“ (beim Gipfel der Vermerk der Höhe), Beschreibungen eigen, die Zuordnungen still.
    "POST /api/editor/wiki-box/:art/:id/entfernen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const objekte = await legeObjekteAn(welt, true);
            try {
                for (const art of ARTEN.slice(0, -1)) {
                    welt.muss(
                        await welt.post(wikiBoxEntfernenUrl(art, objekte.ids[art]), person.cookie, {
                            operationId: operationId(),
                        }),
                    );
                }
                return await welt.post(wikiBoxEntfernenUrl("kraftlinie", objekte.ids.kraftlinie), person.cookie, {
                    operationId: operationId(),
                });
            } finally {
                await raeumeAb(welt, objekte);
            }
        },
    },
    // Den Sync einreihen: Die Route fragt das Wiki nie; sie braucht die Umgebung eines Stage-Prozesses und einen Bereich, der dem WikiSync gehört (fest, jeder mit angeschlossener Übernahme).
    "POST /api/editor/wiki-box/:art/:id/sync": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const objekte = await legeObjekteAn(welt, true);
            const alt = {
                env: process.env["AVESMAPS_ENV"],
                release: process.env["RELEASE_ID"],
                takt: process.env["WIKI_TAKT_ROOT"],
            };
            process.env["AVESMAPS_ENV"] = "staging";
            process.env["RELEASE_ID"] = "rauchtest";
            process.env["WIKI_TAKT_ROOT"] = "C:/rauchtest-takt";
            try {
                return await welt.post(wikiBoxSyncUrl("ort", objekte.ids.ort), person.cookie, {
                    operationId: operationId(),
                });
            } finally {
                for (const [name, wert] of [
                    ["AVESMAPS_ENV", alt.env],
                    ["RELEASE_ID", alt.release],
                    ["WIKI_TAKT_ROOT", alt.takt],
                ] as const) {
                    if (wert === undefined) delete process.env[name];
                    else process.env[name] = wert;
                }
                await welt.cluster
                    .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
                await raeumeAb(welt, objekte);
            }
        },
    },
};
