import { randomUUID } from "node:crypto";
import {
    editorWikiSyncEditRestoreSeriesPreviewUrl,
    editorWikiSyncEditRestoreSeriesUrl,
    editorWikiSyncRestoreSeriesPreviewUrl,
    editorWikiSyncRestoreSeriesUrl,
    WIKISYNC_BEGRIFFE_URL,
    WIKISYNC_ARTIKEL_URL,
    WIKISYNC_DUMP_URL,
    WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZURUECK_URL,
    WIKISYNC_REGELN_UEBERNEHMEN_URL,
    WIKISYNC_REGELN_ZURUECK_URL,
    WIKISYNC_TAFELN_URL,
    WIKISYNC_UEBERNEHMEN_URL,
    WIKISYNC_VORSCHAU_URL,
    WIKISYNC_ZURUECKNEHMEN_URL,
} from "@avesmaps3d/shared";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import { WIKISYNC_PARSER_VERSION } from "../../../src/wiki/abgleich/plan.ts";
import type { Faelle, Welt } from "./welt.ts";

/**
 * Der WikiSync (WI-0253 D-1): jeder Schreibweg einmal als App-Rolle, Rezepte aus `wikisync-uebernahme.test.ts`. Die Routen reihen Aufträge ein; was
 * die Aufträge als Jobs-Rolle schreiben, prüft jener Test. Jeder Fall räumt seine Zeilen selbst ab (der Rauchtest setzt nur Betriebszustand und Aufträge zurück).
 */

const operationId = (): string => randomUUID();

async function zahl(welt: Welt, sql: string): Promise<number> {
    const [row] = await welt.cluster.admin.unsafe<{ n: number | null }[]>(sql);
    return row?.n ?? 0;
}

/** Ein fertiger Lauf der Vorschau für die Kraftlinien: die Voraussetzung, damit die Route einreiht. */
async function legeVoraussetzungAn(welt: Welt): Promise<number> {
    const [lauf] = await welt.cluster.admin<{ id: number }[]>`
        INSERT INTO wikisync_lauf (art, bereiche, status, dump_datei, dump_sha256, dump_seiten, dump_vollstaendig, parser_version, beendet_am)
        VALUES ('vorschau', ARRAY['kraftlinie'], 'fertig', 'rauchtest.xml', ${"a".repeat(64)}, 1, TRUE, ${WIKISYNC_PARSER_VERSION}, now())
        RETURNING id::int AS id
    `;
    return lauf!.id;
}

/**
 * Die Umgebung eines Stage-Prozesses für die Dauer EINES Aufrufs: Die Routen, die das Wiki anfragen lassen, fragen zuerst die harte Sperre (`wikiAbrufErlaubt`, lokal nie). Der Rauchtest prüft den Weg
 * bis in die Datenbank, nicht den Abruf; die Route fragt das Wiki nie, sie reiht einen Auftrag ein.
 */
async function alsStage<T>(arbeit: () => Promise<T>): Promise<T> {
    const alt = {
        env: process.env["AVESMAPS_ENV"],
        release: process.env["RELEASE_ID"],
        takt: process.env["WIKI_TAKT_ROOT"],
        dump: process.env["WIKI_DUMP_ROOT"],
    };
    process.env["AVESMAPS_ENV"] = "staging";
    process.env["RELEASE_ID"] = "rauchtest";
    process.env["WIKI_TAKT_ROOT"] = "C:/rauchtest-takt";
    process.env["WIKI_DUMP_ROOT"] = "C:/rauchtest-dump";
    try {
        return await arbeit();
    } finally {
        for (const [name, wert] of [
            ["AVESMAPS_ENV", alt.env],
            ["RELEASE_ID", alt.release],
            ["WIKI_TAKT_ROOT", alt.takt],
            ["WIKI_DUMP_ROOT", alt.dump],
        ] as const) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
    }
}

async function raeumeAuf(welt: Welt): Promise<void> {
    await welt.cluster.admin`DELETE FROM wikisync_artikel`;
    await welt.cluster.admin`DELETE FROM wiki_key_assignment WHERE wiki_key = 'wiki:rauchtest-artikel'`;
    await welt.cluster.admin`DELETE FROM wikisync_wiki_teil`;
    await welt.cluster.admin`DELETE FROM wikisync_uebernahme`;
    await welt.cluster.admin`DELETE FROM wikisync_lauf`;
    await welt.cluster
        .admin`UPDATE job SET state = 'CANCELLED', finished_at = now() WHERE state IN ('QUEUED', 'RUNNING')`;
}

/** Ein Eintrag mit einem fertigen Lauf der Vorschau, seinem Kopf der Ableitung und EINEM wählbaren Vorschlag (Wald überall): die Voraussetzung der Übernahme von Regeln. */
async function legeRegelLaufAn(welt: Welt): Promise<{ lauf: number; vorschlag: number }> {
    const admin = welt.cluster.admin;
    const [eintrag] = await admin<{ id: string }[]>`
        INSERT INTO lore_entry (wiki_key, kind, name, wiki_title, wiki_url, legacy_origin, state, source_system, is_active)
        VALUES ('rauchtest-regel', 'fauna', 'Rauchtest-Regel', 'Rauchtest Regel', 'https://de.wiki-aventurica.de/wiki/Rauchtest_Regel', 'wiki', 'active', 'legacy', TRUE)
        RETURNING id::text AS id
    `;
    const [lauf] = await admin<{ id: number }[]>`
        INSERT INTO wikisync_lauf (art, bereiche, status, dump_datei, dump_sha256, dump_seiten, dump_vollstaendig, parser_version, beendet_am)
        VALUES ('vorschau', ARRAY['vorkommen'], 'fertig', 'rauchtest.xml', ${"a".repeat(64)}, 1, TRUE, ${WIKISYNC_PARSER_VERSION}, now())
        RETURNING id::int AS id
    `;
    await admin`INSERT INTO wikisync_regel_lauf (lauf_id, begriffe_revision, zahlen) VALUES (${lauf!.id}, (SELECT revision FROM wikisync_begriff_state WHERE id = 1), '{}')`;
    const regel = {
        beziehung: "verbreitung",
        status: "neu",
        bedingungen: [
            {
                verknuepfung: "und",
                flaeche: null,
                arten: [{ ebene: "vegetation", art: "wald" }],
                klima: null,
                woerter: ["wald"],
                rueckfragen: [],
            },
        ],
        bisher: null,
        teile: [],
        bisherIds: [],
        bisherSchluessel: [],
        schluessel: "b".repeat(64),
    };
    const [vorschlag] = await admin<{ id: number }[]>`
        INSERT INTO wikisync_regel_vorschlag (lauf_id, position, lore_entry_id, eintrag_name, art, typ, status, wartet, vorgewaehlt, waehlbar, suchtext, payload)
        VALUES (${lauf!.id}, 0, ${eintrag!.id}::bigint, 'Rauchtest-Regel', 'fauna', 'vollstaendig', 'neu', FALSE, TRUE, TRUE, 'rauchtest', ${admin.json({ original: [], regeln: [regel] } as never)})
        RETURNING id::int AS id
    `;
    return { lauf: lauf!.id, vorschlag: vorschlag!.id };
}

/** Eine Fläche ohne Wiki-Schlüssel und ein Lauf, dessen Vorschlag auf ihren Artikel wartet (offene Fläche mit Kandidat): die Voraussetzung des Knopfs „zuweisen“. */
async function legeFlaecheOhneSchluesselAn(welt: Welt): Promise<{ flaeche: string; titel: string }> {
    const admin = welt.cluster.admin;
    const flaeche = randomUUID();
    const titel = "Rauchtest Südland";
    await admin`INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type) VALUES (${flaeche}, 'aventuria', ${titel}, 'derographisch', 'region')`;
    const [eintrag] = await admin<{ id: string }[]>`
        INSERT INTO lore_entry (wiki_key, kind, name, wiki_title, wiki_url, legacy_origin, state, source_system, is_active)
        VALUES ('rauchtest-regel', 'fauna', 'Rauchtest-Regel', 'Rauchtest Regel', 'https://de.wiki-aventurica.de/wiki/Rauchtest_Regel', 'wiki', 'active', 'legacy', TRUE)
        RETURNING id::text AS id
    `;
    const [lauf] = await admin<{ id: number }[]>`
        INSERT INTO wikisync_lauf (art, bereiche, status, dump_datei, dump_sha256, dump_seiten, dump_vollstaendig, parser_version, beendet_am)
        VALUES ('vorschau', ARRAY['vorkommen'], 'fertig', 'rauchtest.xml', ${"a".repeat(64)}, 1, TRUE, ${WIKISYNC_PARSER_VERSION}, now())
        RETURNING id::int AS id
    `;
    await admin`INSERT INTO wikisync_regel_lauf (lauf_id, begriffe_revision, zahlen) VALUES (${lauf!.id}, (SELECT revision FROM wikisync_begriff_state WHERE id = 1), '{}')`;
    const regel = {
        beziehung: "verbreitung",
        status: "neu",
        bedingungen: [
            {
                verknuepfung: "und",
                flaeche: { name: titel, id: null, kennung: null, offen: true, titel, kandidat: titel },
                arten: [],
                klima: null,
                woerter: [],
                rueckfragen: [],
            },
        ],
        bisher: null,
        teile: [],
    };
    await admin`
        INSERT INTO wikisync_regel_vorschlag (lauf_id, position, lore_entry_id, eintrag_name, art, typ, status, wartet, vorgewaehlt, waehlbar, suchtext, payload)
        VALUES (${lauf!.id}, 0, ${eintrag!.id}::bigint, 'Rauchtest-Regel', 'fauna', 'wartet', 'neu', TRUE, FALSE, TRUE, 'rauchtest', ${admin.json({ original: [], regeln: [regel] } as never)})
    `;
    return { flaeche, titel };
}

async function raeumeFlaecheAuf(welt: Welt, flaeche: string): Promise<void> {
    const admin = welt.cluster.admin;
    await admin`DELETE FROM wiki_key_assignment WHERE legacy_art = 'landschaft' AND object_public_id = ${flaeche}::uuid`;
    await admin`DELETE FROM region WHERE public_id = ${flaeche}::uuid`;
    await admin`DELETE FROM wikisync_lauf`;
    await admin`DELETE FROM lore_entry WHERE wiki_key = 'rauchtest-regel'`;
}

async function raeumeRegelnAuf(welt: Welt): Promise<void> {
    const admin = welt.cluster.admin;
    await admin`DELETE FROM wikisync_regel_uebernahme_zeile`;
    await admin`DELETE FROM wikisync_regel_uebernahme`;
    await admin`DELETE FROM lore_rule_term_type`;
    await admin`DELETE FROM lore_rule_term`;
    await admin`DELETE FROM lore_rule`;
    await admin`DELETE FROM wikisync_lauf`;
    await admin`DELETE FROM lore_entry WHERE wiki_key = 'rauchtest-regel'`;
}

/**
 * Eine Operation des WikiSync in der Karte (Quelle `wikisync`) samt dem Protokoll der Übernahme, auf das das ↺ in „Änderungen“ zeigt (WI-0265 B8d): ein Lauf je Bereich oder eine Übernahme von Regelvorschlägen.
 * Gibt die Kennung der Operation zurück.
 */
async function legeUebernahmeOperationAn(welt: Welt, art: "lauf" | "regeln"): Promise<string> {
    const admin = welt.cluster.admin;
    const id = operationId();
    await admin`
        INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, summary, environment, actor_kind, actor_label)
        VALUES (${id}, 'aventuria', decode(repeat('ab', 32), 'hex'), ${admin.json({ operationId: id, status: "applied", environment: "test", affected: [], derivedWork: [], warnings: [] })},
                ${art === "lauf" ? "wikisync.uebernehmen" : "lore.rules_wikisync"}, 'wikisync', 'WikiSync: Rauchtest', 'test', 'system', 'wikisync')
    `;
    if (art === "lauf") {
        const lauf = await legeVoraussetzungAn(welt);
        await admin`
            INSERT INTO wikisync_uebernahme (art, bereich, lauf_id, status, operation_id, beendet_am, zahlen)
            VALUES ('uebernahme', 'kraftlinie', ${lauf}, 'fertig', ${id}, now(), '{"objekte": 2}'::jsonb)
        `;
    } else await admin`INSERT INTO wikisync_regel_uebernahme (operation_id, actor_label) VALUES (${id}, 'Rauchtest')`;
    return id;
}

/**
 * Die Zuweisung eines Artikels an eine Fläche, wie das Regelfenster sie schreibt (WI-0265 B8e): Der Fall legt Fläche und Lauf an und weist zu; gibt die Fläche und die Operation der Zuweisung zurück, auf die das ↺ in
 * „Änderungen“ zeigt.
 */
async function weiseFlaecheZuFuerRauchtest(
    welt: Welt,
    cookie: string,
): Promise<{ flaeche: string; zuweisung: string }> {
    const fall = await legeFlaecheOhneSchluesselAn(welt);
    const zuweisung = operationId();
    welt.muss(
        await welt.post(WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL, cookie, {
            operationId: zuweisung,
            flaeche: fall.flaeche,
            titel: fall.titel,
        }),
    );
    return { flaeche: fall.flaeche, zuweisung };
}

export const WIKISYNC: Faelle = {
    // Das ↺ in „Änderungen“ (WI-0265 B8d): die Vorprüfung liest nur (Operation, Tafel der Übernahme, Zustand), die Rücknahme reiht GENAU die Rücknahme des WikiSync ein beziehungsweise ruft die der Regelvorschläge auf.
    "POST /api/editor/wikisync/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            try {
                const lauf = await legeUebernahmeOperationAn(welt, "lauf");
                welt.muss(
                    await welt.post(editorWikiSyncRestoreSeriesPreviewUrl(lauf), person.cookie, {
                        members: [lauf],
                        membersHash: mitgliederHash([lauf]),
                    }),
                );
                const regeln = await legeUebernahmeOperationAn(welt, "regeln");
                return await welt.post(editorWikiSyncRestoreSeriesPreviewUrl(regeln), person.cookie, {
                    members: [regeln],
                    membersHash: mitgliederHash([regeln]),
                });
            } finally {
                await raeumeAuf(welt);
                await raeumeRegelnAuf(welt);
                await welt.cluster
                    .admin`DELETE FROM map_operation WHERE source = 'wikisync' AND summary = 'WikiSync: Rauchtest'`;
            }
        },
    },
    "POST /api/editor/wikisync/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            try {
                const lauf = await legeUebernahmeOperationAn(welt, "lauf");
                welt.muss(
                    await welt.post(editorWikiSyncRestoreSeriesUrl(lauf), person.cookie, {
                        operationId: operationId(),
                        members: [lauf],
                        membersHash: mitgliederHash([lauf]),
                        reason: "Rauchtest",
                    }),
                );
                const regeln = await legeUebernahmeOperationAn(welt, "regeln");
                return await welt.post(editorWikiSyncRestoreSeriesUrl(regeln), person.cookie, {
                    operationId: operationId(),
                    members: [regeln],
                    membersHash: mitgliederHash([regeln]),
                    reason: "Rauchtest",
                });
            } finally {
                await raeumeAuf(welt);
                await raeumeRegelnAuf(welt);
                await welt.cluster
                    .admin`DELETE FROM map_operation WHERE source = 'wikisync' AND summary = 'WikiSync: Rauchtest'`;
            }
        },
    },
    // Das ↺ an den Schritten des Editors (WI-0265 B8e): die Zuweisung einer Fläche (sofort, in der Anfrage); der Sync eines Objekts reiht einen Auftrag ein (Wiki-Box-Test).
    "POST /api/editor/wikisync-schritt/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            const fall = await weiseFlaecheZuFuerRauchtest(welt, person.cookie);
            try {
                return await welt.post(editorWikiSyncEditRestoreSeriesPreviewUrl(fall.zuweisung), person.cookie, {
                    members: [fall.zuweisung],
                    membersHash: mitgliederHash([fall.zuweisung]),
                });
            } finally {
                await raeumeFlaecheAuf(welt, fall.flaeche);
            }
        },
    },
    "POST /api/editor/wikisync-schritt/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            const fall = await weiseFlaecheZuFuerRauchtest(welt, person.cookie);
            try {
                // Die Zuweisung geht zurück; deren Rücknahme (B8e2) stellt sie wieder her.
                const rueck = operationId();
                welt.muss(
                    await welt.post(editorWikiSyncEditRestoreSeriesUrl(fall.zuweisung), person.cookie, {
                        operationId: rueck,
                        members: [fall.zuweisung],
                        membersHash: mitgliederHash([fall.zuweisung]),
                        reason: "Rauchtest",
                    }),
                );
                return await welt.post(editorWikiSyncEditRestoreSeriesUrl(rueck), person.cookie, {
                    operationId: operationId(),
                    members: [rueck],
                    membersHash: mitgliederHash([rueck]),
                    reason: "Rauchtest",
                });
            } finally {
                await raeumeFlaecheAuf(welt, fall.flaeche);
            }
        },
    },
    "POST /api/admin/wikisync/vorschau": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("tester");
            const antwort = await welt.post(WIKISYNC_VORSCHAU_URL, person.cookie, { operationId: operationId() });
            await raeumeAuf(welt);
            return antwort;
        },
    },
    "POST /api/admin/wikisync/uebernehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            await legeVoraussetzungAn(welt);
            try {
                return await welt.post(WIKISYNC_UEBERNEHMEN_URL, person.cookie, {
                    operationId: operationId(),
                    bereiche: ["kraftlinie"],
                });
            } finally {
                await raeumeAuf(welt);
            }
        },
    },
    // Einen Artikel vergleichen (D-2): ein Objekt der Karte hängt an dem Titel; die Route reiht den leichten Auftrag ein.
    "POST /api/admin/wikisync/artikel": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            await welt.cluster.admin`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns)
                VALUES ('siedlung', ${randomUUID()}, 'wiki:rauchtest-artikel', 'https://de.wiki-aventurica.de/wiki/Rauchtest_Artikel', 'Rauchtest Artikel', 0)
            `;
            try {
                return await alsStage(() =>
                    welt.post(WIKISYNC_ARTIKEL_URL, person.cookie, {
                        operationId: operationId(),
                        titel: "Rauchtest Artikel",
                    }),
                );
            } finally {
                await raeumeAuf(welt);
            }
        },
    },
    // „Dump holen“ (WI-0253 §22): Der Betreiber reiht den Auftrag für Claudios Korridor ein; die Route holt nichts und fragt das Wiki nie.
    "POST /api/admin/wikisync/dump": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("operator");
            try {
                return await alsStage(() =>
                    welt.post(WIKISYNC_DUMP_URL, person.cookie, { operationId: operationId() }),
                );
            } finally {
                await raeumeAuf(welt);
            }
        },
    },
    "POST /api/admin/wikisync/zuruecknehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            const lauf = await legeVoraussetzungAn(welt);
            await welt.cluster.admin`
                INSERT INTO wikisync_uebernahme (art, bereich, lauf_id, status, operation_id, beendet_am)
                VALUES ('uebernahme', 'kraftlinie', ${lauf}, 'fertig', ${randomUUID()}, now())
            `;
            try {
                return await welt.post(WIKISYNC_ZURUECKNEHMEN_URL, person.cookie, {
                    operationId: operationId(),
                    lauf,
                    bereich: "kraftlinie",
                });
            } finally {
                await raeumeAuf(welt);
            }
        },
    },
    // Die Kanon-Tafeln (WI-0253 UI-1): der Raum 444 offiziell und die Gipfel mit Pille, danach beides zurück (der Rauchtest hinterlässt keine Zeile).
    "POST /api/admin/wikisync/tafeln": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            const revision = (): Promise<number> =>
                zahl(welt, "SELECT revision::int AS n FROM canon_table_state WHERE id = 1");
            const antwort = await welt.post(WIKISYNC_TAFELN_URL, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(),
                namensraeume: [
                    { ns: 444, praefix: "Ilaris", kanon: "offiziell", einsammeln: false, bezeichner: "Rauchtest" },
                ],
                objektarten: [{ art: "peak", anzeigen: true, bezeichner: "Avesmaps" }],
            });
            if (antwort.statusCode === 200) {
                welt.muss(
                    await welt.post(WIKISYNC_TAFELN_URL, person.cookie, {
                        operationId: operationId(),
                        baseRevision: await revision(),
                        entfernen: [444],
                        objektarten: [{ art: "peak", anzeigen: false, bezeichner: "Avesmaps" }],
                    }),
                );
            }
            return antwort;
        },
    },
    // Die Begriffstafel der Regelableitung (WI-0253 §24): „Gewässer“ bekommt zwei Pillen, danach ↺ (der Rauchtest hinterlässt keine Zeile).
    "POST /api/admin/wikisync/begriffe": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            const revision = (): Promise<number> =>
                zahl(welt, "SELECT revision::int AS n FROM wikisync_begriff_state WHERE id = 1");
            const antwort = await welt.post(WIKISYNC_BEGRIFFE_URL, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(),
                aenderungen: [{ wort: "gewässer", pillen: ["topographie|see", "topographie|meer"] }],
            });
            if (antwort.statusCode === 200) {
                welt.muss(
                    await welt.post(WIKISYNC_BEGRIFFE_URL, person.cookie, {
                        operationId: operationId(),
                        baseRevision: await revision(),
                        aenderungen: [{ wort: "gewässer", zuruecksetzen: true }],
                    }),
                );
            }
            return antwort;
        },
    },
    // Die ausgewählten Regelvorschläge übernehmen (WI-0253 §24): ein Eintrag, ein Lauf mit Kopf und einem Vorschlag; die Route legt die Regel an, der Fall räumt alles wieder ab.
    "POST /api/admin/wikisync/regeln/uebernehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            const lauf = await legeRegelLaufAn(welt);
            try {
                return await welt.post(WIKISYNC_REGELN_UEBERNEHMEN_URL, person.cookie, {
                    operationId: operationId(),
                    lauf: lauf.lauf,
                    vorschlaege: [lauf.vorschlag],
                });
            } finally {
                await raeumeRegelnAuf(welt);
            }
        },
    },
    // Einer Fläche ohne Wiki-Schlüssel ihren Artikel zuweisen (WI-0253 §25): die Fläche und den Lauf mit der offenen Fläche legt der Fall an, die Route schreibt Adresse, Tafel X2 und Fachprotokoll.
    "POST /api/admin/wikisync/regeln/flaeche-zuweisen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            const fall = await legeFlaecheOhneSchluesselAn(welt);
            try {
                return await welt.post(WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL, person.cookie, {
                    operationId: operationId(),
                    flaeche: fall.flaeche,
                    titel: fall.titel,
                });
            } finally {
                await raeumeFlaecheAuf(welt, fall.flaeche);
            }
        },
    },
    // Diese Zuweisung zurücknehmen: der Fall weist erst zu, die Route nimmt zurück (der Schlüssel ist danach wieder leer).
    "POST /api/admin/wikisync/regeln/flaeche-zuruecknehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor", { frisch: true, passkey: true });
            const fall = await legeFlaecheOhneSchluesselAn(welt);
            try {
                welt.muss(
                    await welt.post(WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL, person.cookie, {
                        operationId: operationId(),
                        flaeche: fall.flaeche,
                        titel: fall.titel,
                    }),
                );
                return await welt.post(WIKISYNC_REGELN_FLAECHE_ZURUECK_URL, person.cookie, {
                    operationId: operationId(),
                    flaeche: fall.flaeche,
                });
            } finally {
                await raeumeFlaecheAuf(welt, fall.flaeche);
            }
        },
    },
    // Eine Übernahme von Regeln zurücknehmen (WI-0253 §24): die Übernahme legt der Fall an, die Route trägt die Rücknahme nach.
    "POST /api/admin/wikisync/regeln/zuruecknehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("admin", { frisch: true, passkey: true });
            const [uebernahme] = await welt.cluster.admin<{ id: number }[]>`
                INSERT INTO wikisync_regel_uebernahme (actor_label) VALUES ('Rauchtest') RETURNING id::int AS id
            `;
            try {
                return await welt.post(WIKISYNC_REGELN_ZURUECK_URL, person.cookie, {
                    operationId: operationId(),
                    uebernahme: uebernahme!.id,
                });
            } finally {
                await raeumeRegelnAuf(welt);
            }
        },
    },
};
