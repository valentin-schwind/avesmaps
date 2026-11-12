import { createHash, randomUUID } from "node:crypto";
import { mitgliederHash } from "../../../src/editor/arbeitsserie.ts";
import type { Faelle, Welt } from "./welt.ts";

/**
 * Das Fenster „Inhalte bearbeiten“, Reiter „Quellen“ und „Literatur“ (WI-0254): alle vier Schreibwege einmal, als App-Rolle. Der Fall der Änderung deckt die
 * Zeilensperre auf Quelle und Verknüpfung (`FOR UPDATE` braucht UPDATE), das Anlegen und Stilllegen einer Verknüpfung (auch an der Straße eines Wegs, auf allen Abschnitten), das Fachprotokoll
 * (`map_audit_event.source_public_id`) und das Neurechnen des Kanon-Etiketts des berührten Trägers (INSERT in `territory_canon`). Die Fälle der
 * Literatur decken die Zeilensperre auf Werk und Ortszeilen, das Ordnen (UPDATE der Nummern), das Anlegen und Stilllegen einer Zeile, den
 * Herkunftsvermerk je Feld (INSERT … ON CONFLICT DO UPDATE in `adventure_field_origin`) und das Fachprotokoll (`map_audit_event.work_public_id`).
 * Der Fall der Vorkommen deckt die Zeilensperre auf Eintrag, Ortszeile und Quellenverknüpfung, die Treffer einer neuen Zeile (INSERT und DELETE in
 * `lore_place_target`, UPDATE der abgeleiteten Spalten an `lore_place`), das Stilllegen und den Herkunftsvermerk (`lore_entry_field_origin`). Die Fälle der Korpora
 * decken das Anlegen (INSERT in `source_corpus`, UPDATE der Quellen ohne Korpus), die Zeilensperre auf Korpus und Quellen und das Durchschreiben der Vorgabe
 * auf die Quellen einer Belegstelle (UPDATE an `feature_source`, Kanon-Etikett der Träger neu). Der Fall der Quellen am Kartenobjekt (Klappbox der Karteneditoren) deckt die Zeilensperre auf der
 * Verknüpfung von Ort, Gebiet, Landschaft und der Straße eines Wegs (`<träger>_source`, beim Weg auf allen Abschnitten), das Anhängen, Ändern und Lösen, das Etikett des Objekts (`<träger>_canon`) und das Fachprotokoll am Objekt.
 */

const QUELLEN = "/api/editor/inhalte/quellen";
const LITERATUR = "/api/editor/inhalte/literatur";
const VORKOMMEN = "/api/editor/inhalte/vorkommen";
const KORPORA = "/api/editor/inhalte/korpora";
const TRAEGER = "/api/editor/inhalte/traeger";
const operationId = (): string => randomUUID();

/** Eine Katalogquelle mit Adresse, als Besitzer angelegt (Revision 1); gibt ihre Kennung zurück. */
async function quelle(welt: Welt): Promise<string> {
    const url = `https://rauchtest.example/${randomUUID()}`;
    const schluessel = `url:${createHash("sha256").update(url, "utf8").digest("hex")}`;
    const [zeile] = await welt.cluster.admin<{ public_id: string }[]>`
        INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
        VALUES (${schluessel}, 'final', ${url}, 'Rauchquelle', 'briefspiel', FALSE, 'rauchtest')
        RETURNING public_id::text
    `;
    return zeile!.public_id;
}

/** Ein Herrschaftsgebiet (Wurzel, ohne Fläche) als Besitzer; gibt seine Kennung zurück. */
async function gebiet(welt: Welt): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
        VALUES (${publicId}::uuid, 'aventuria', ${`Rauchgebiet ${publicId}`}, '#b2b065', 0.7, 'rauchtest')
    `;
    return publicId;
}

/** Eine Landschaft (Tafel `region`) als Besitzer; gibt ihre Kennung zurück. */
async function landschaft(welt: Welt): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
        VALUES (${publicId}::uuid, 'aventuria', ${`Rauchlandschaft ${publicId}`}, 'topographie', 'wald', TRUE)
    `;
    return publicId;
}

/** Eine Höhle (Landmarke ohne Gelände, Tafel `terrain_peak`) als Besitzer; gibt ihre Kennung zurück. */
async function hoehle(welt: Welt): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}::uuid, 'aventuria', ${`Rauchhöhle ${publicId}`}, 'hoehle', ST_SetSRID(ST_MakePoint(301, 301), 0), 'rauchtest', TRUE)
    `;
    return publicId;
}

/** Eine Straße mit zwei Abschnitten (gleicher Name, eigener je Aufruf) als Besitzer; gibt die Kennung des ersten Abschnitts zurück. */
async function strasse(welt: Welt): Promise<string> {
    const name = `Rauchstraße ${randomUUID()}`;
    const kennungen = [randomUUID(), randomUUID()];
    for (const [nummer, publicId] of kennungen.entries()) {
        await welt.cluster.admin`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${publicId}::uuid, 'aventuria', ${name}, 'Strasse', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${300 + nummer * 10}, 305), ST_MakePoint(${310 + nummer * 10}, 305)), 0), 'rauchtest', TRUE)
        `;
    }
    return kennungen[0]!;
}

/** Ein Ort als Besitzer; gibt seine Kennung zurück. */
async function ort(welt: Welt, name: string): Promise<string> {
    const publicId = randomUUID();
    await welt.cluster.admin`
        INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
        VALUES (${publicId}::uuid, 'aventuria', ${`${name} ${publicId}`}, 'stadt', ST_SetSRID(ST_MakePoint(300, 300), 0), 'rauchtest', TRUE)
    `;
    return publicId;
}

/** Ein Werk aus Legacy (Revision 1) mit zwei ungeklärten Ortszeilen; gibt seine Kennung und die Nummern der Zeilen zurück. */
async function werk(welt: Welt): Promise<{ id: string; zeilen: string[] }> {
    const [zeile] = await welt.cluster.admin<{ id: string; public_id: string }[]>`
        INSERT INTO adventure (public_id, title, product_type, edition, bf_year, bf_label, is_official, source_system)
        VALUES (gen_random_uuid(), 'Rauchwerk', 'gruppenabenteuer', 'DSA5', 1040, 'Praios 1040', TRUE, 'rauchtest')
        RETURNING id::text, public_id::text
    `;
    const zeilen: string[] = [];
    for (const [nummer, name] of ["Erste", "Zweite"].entries()) {
        const [eine] = await welt.cluster.admin<{ id: string }[]>`
            INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, source_system)
            VALUES (${zeile!.id}::bigint, ${nummer}, ${nummer}, ${name.toLowerCase()}, ${name}, 'play', 'unresolved', 'rauchtest')
            RETURNING id::text
        `;
        zeilen.push(eine!.id);
    }
    return { id: zeile!.public_id, zeilen };
}

/** Ein Lore-Eintrag aus dem Wiki (Revision 1) mit einer Ortszeile und einem Treffer; gibt seine Kennung, den Ort mit Wiki-Schlüssel und die Zeile zurück. */
async function eintrag(welt: Welt): Promise<{ id: string; ort: string }> {
    const nummer = randomUUID().slice(0, 8);
    const ort = await ortMitSchluessel(welt, `Rauchort ${nummer}`, `rauchort-${nummer}`);
    const [zeile] = await welt.cluster.admin<{ id: string; public_id: string }[]>`
        INSERT INTO lore_entry (wiki_key, kind, name, gruppe, source_system)
        VALUES (${`rauchlore-${nummer}`}, 'fauna', ${`Rauchtier ${nummer}`}, 'Test', 'rauchtest')
        RETURNING id::text, public_id::text
    `;
    await welt.cluster.admin`
        INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, sort_order, key_class, target_state, target_count, source_system)
        VALUES (${zeile!.id}::bigint, 'rauchfern', 'verbreitung', 0, 'other', 'unmatched', 0, 'rauchtest')
    `;
    return { id: zeile!.public_id, ort };
}

/** Ein Belegstellen-Korpus (Revision 1) mit zwei Quellen seiner Domain, eine davon an einem Ort; gibt die Kennung des Korpus und der Domain zurück. */
async function korpus(welt: Welt): Promise<{ id: string; key: string }> {
    const key = `rauch${randomUUID().slice(0, 8)}.example`;
    const [zeile] = await welt.cluster.admin<{ public_id: string }[]>`
        INSERT INTO source_corpus (corpus_key, label, form, source_system) VALUES (${key}, 'Rauchkorpus', 'belegstelle', 'rauchtest')
        RETURNING public_id::text
    `;
    const traeger = await ort(welt, "Rauchort des Korpus");
    for (const nummer of [1, 2]) {
        const url = `https://www.${key}/seite-${String(nummer)}`;
        const schluessel = `url:${createHash("sha256").update(url, "utf8").digest("hex")}`;
        const [quelleZeile] = await welt.cluster.admin<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, corpus_key, source_system)
            VALUES (${schluessel}, 'final', ${url}, ${`Rauchseite ${String(nummer)}`}, 'sonstiges', FALSE, ${key}, 'rauchtest')
            RETURNING id::text
        `;
        if (nummer === 1) {
            await welt.cluster.admin`
                INSERT INTO place_source (place_id, source_id, position, source_system)
                SELECT p.id, ${quelleZeile!.id}::bigint, 0, 'rauchtest' FROM place p WHERE p.public_id = ${traeger}::uuid
            `;
        }
    }
    return { id: zeile!.public_id, key };
}

/** Ein Ort, dem die Zuordnung einen Wiki-Schlüssel gibt (das Ziel einer Ortszeile); gibt seine Kennung zurück. */
async function ortMitSchluessel(welt: Welt, name: string, schluessel: string): Promise<string> {
    const publicId = await ort(welt, name);
    await welt.cluster.admin`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES ('siedlung', ${publicId}::uuid, ${`wiki:${schluessel}`})
    `;
    return publicId;
}

export const INHALTE: Faelle = {
    // „Anlegen“ im Reiter Quellen (`source.create`): eine Quelle mit Adresse, source_system editor, ein Eintrag im Fachprotokoll.
    "POST /api/editor/inhalte/quellen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post(QUELLEN, person.cookie, {
                operationId: operationId(),
                url: `https://rauchtest.example/neu/${randomUUID()}`,
                title: "Neue Rauchquelle",
                sourceType: "briefspiel",
            });
        },
    },
    // „Speichern“ (`source.update`): Titel und „offiziell“ der Quelle, dazu eine Verwendung am Gebiet (anlegen), das Etikett des Gebiets folgt. Dazu die Straße eines Wegs
    // (WI-0254 §12, Runde 6): anhängen (INSERT in `path_source` an beiden Abschnitten, Sperre auf den Anker, `path_canon`), ändern (UPDATE, Zeilensperre `FOR UPDATE`) und lösen,
    // jeweils samt Eintrag `path.sources_changed` am Anker neben `source.updated`.
    "POST /api/editor/inhalte/quellen/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const id = await quelle(welt);
            const traeger = await gebiet(welt);
            const aenderung = await welt.post(`${QUELLEN}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                fields: { title: "Rauchquelle, bearbeitet", isOfficial: true },
                links: [{ op: "add", kind: "territory", carrierId: traeger, referenceKind: "erwaehnung", pages: "12" }],
            });
            if (aenderung.statusCode !== 200) return aenderung;
            const weg = await strasse(welt);
            const amWeg = `${QUELLEN}/${id}/update`;
            const angehaengt = await welt.post(amWeg, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                links: [
                    {
                        op: "add",
                        kind: "path",
                        carrierId: weg,
                        vorher: null,
                        referenceKind: "ausfuehrlich",
                        pages: "5",
                    },
                ],
            });
            if (angehaengt.statusCode !== 200) return angehaengt;
            const geaendert = await welt.post(amWeg, person.cookie, {
                operationId: operationId(),
                baseRevision: 3,
                links: [
                    {
                        op: "update",
                        kind: "path",
                        carrierId: weg,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "5", note: null },
                        pages: "6",
                    },
                ],
            });
            if (geaendert.statusCode !== 200) return geaendert;
            return welt.post(amWeg, person.cookie, {
                operationId: operationId(),
                baseRevision: 4,
                links: [
                    {
                        op: "remove",
                        kind: "path",
                        carrierId: weg,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "6", note: null },
                    },
                ],
            });
        },
    },
    // Eine Quelle zurücknehmen (WI-0265 B6g1): zwei „Speichern“ über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle (Zeilensperre `FOR UPDATE` auf die Quelle,
    // UPDATE über denselben Schreibweg wie `source.update`, Revision über den Trigger, Fachprotokoll mit Grund, Verknüpfung zu beiden Originalen). Seit B6g3 trägt die Änderung auch
    // Verwendungen an einem Ort, einem Gebiet und der Straße eines Wegs: Die Rücknahme setzt sie direkt zurück (Zeilensperre und UPDATE an `<träger>_source`, Etikett neu, Eintrag am Anker).
    "POST /api/editor/inhalte/quellen/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const id = await quelle(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${QUELLEN}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { title: "Rauchquelle, erst" },
                    links: [
                        {
                            op: "add",
                            kind: "place",
                            carrierId: await ort(welt, "Rauchort der Vorschau"),
                            referenceKind: "erwaehnung",
                            pages: "12",
                        },
                    ],
                }),
            );
            return welt.post(`${QUELLEN}/${id}/restore-series/preview`, person.cookie, {
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    "POST /api/editor/inhalte/quellen/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const id = await quelle(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${QUELLEN}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { title: "Rauchquelle, erst", isOfficial: true },
                    links: [
                        {
                            op: "add",
                            kind: "place",
                            carrierId: await ort(welt, "Rauchort der Verwendung"),
                            referenceKind: "erwaehnung",
                            pages: "12",
                        },
                        {
                            op: "add",
                            kind: "territory",
                            carrierId: await gebiet(welt),
                            referenceKind: "erwaehnung",
                            pages: "13",
                        },
                        {
                            op: "add",
                            kind: "path",
                            carrierId: await strasse(welt),
                            vorher: null,
                            referenceKind: "ausfuehrlich",
                            pages: "5",
                        },
                    ],
                }),
            );
            return welt.post(`${QUELLEN}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    // Ein Werk zurücknehmen (WI-0265 B6g1): ein „Speichern“ mit Feldern und neuer Ortsliste, dann zurück (Zeilensperre auf Werk und Ortszeilen, Zeile belebt und still gelegt, Nummern neu,
    // Herkunftsvermerk je Feld, Fachprotokoll mit Grund).
    "POST /api/editor/inhalte/literatur/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id } = await werk(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${LITERATUR}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { genre: "Abenteuer" },
                }),
            );
            return welt.post(`${LITERATUR}/${id}/restore-series/preview`, person.cookie, {
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    "POST /api/editor/inhalte/literatur/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id, zeilen } = await werk(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${LITERATUR}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { genre: "Abenteuer", bfYear: 1044, editorNote: "Eine Notiz" },
                    orte: [
                        { rowId: zeilen[1], role: "start" },
                        { rawName: "Dritte", role: "play" },
                    ],
                }),
            );
            return welt.post(`${LITERATUR}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    // Einen Korpus zurücknehmen (WI-0265 B6g1): ein „Speichern“, das Art und „offiziell“ auf die Quellen der Belegstelle durchschreibt, dann zurück (Zeilensperre auf Korpus und Quellen,
    // UPDATE der Angaben und der Quellen in einer Anweisung, Revision über den Trigger, Etikett der Träger neu).
    "POST /api/editor/inhalte/korpora/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id } = await korpus(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${KORPORA}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { label: "Rauchkorpus, erst" },
                }),
            );
            return welt.post(`${KORPORA}/${id}/restore-series/preview`, person.cookie, {
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    "POST /api/editor/inhalte/korpora/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            // Das Anlegen zurück (WI-0265 B8d): Der Korpus wird stillgelegt (UPDATE von Zustand, Zeitpunkt und Herkunft, `source_corpus_retired_consistent`), nie gelöscht.
            const anlegen = operationId();
            const angelegt = welt.muss(
                await welt.post(KORPORA, person.cookie, {
                    operationId: anlegen,
                    key: `rauchanlegen${anlegen.slice(0, 8)}.example`,
                }),
            );
            const neu = (angelegt.json() as { affected: { kind: string; id: string }[] }).affected.find(
                (eines) => eines.kind === "corpus",
            )!.id;
            welt.muss(
                await welt.post(`${KORPORA}/${neu}/restore-series`, person.cookie, {
                    operationId: operationId(),
                    members: [anlegen],
                    membersHash: mitgliederHash([anlegen]),
                }),
            );
            const { id } = await korpus(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${KORPORA}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { sourceType: "briefspiel", isOfficial: true, attribution: "Rauchautor" },
                }),
            );
            return welt.post(`${KORPORA}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    // Die Klappbox der Karteneditoren (`traeger.sources`, WI-0254 §12): vom Objekt her anhängen (INSERT in `<träger>_source`, Zeilensperre, Etikett neu in `<träger>_canon`),
    // am Ort dazu lösen (UPDATE der Verknüpfung, Etikett weg) und ändern, am Gebiet und an der Landschaft anhängen, am Gipfel (einer Höhle) anhängen und lösen. An der Straße eines Wegs (Runde 6) anhängen, ändern und lösen, auf beiden
    // Abschnitten (`path_source`: INSERT, UPDATE, Zeilensperre `FOR UPDATE`, `path_canon`). Das Fachprotokoll (`map_audit_event.place_public_id`,
    // `territory_public_id`, `region_public_id`, `peak_public_id`, `path_public_id`) schreibt dieselbe Operation.
    "POST /api/editor/inhalte/traeger/:kind/:id/quellen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const id = await quelle(welt);
            const nachbar = await quelle(welt);
            const traeger = await ort(welt, "Rauchort der Quellen");
            const anhaengen = (angaben: object) => ({
                operationId: operationId(),
                aenderungen: [{ op: "add", sourceId: id, vorher: null, ...angaben }],
            });
            const angehaengt = await welt.post(
                `${TRAEGER}/place/${traeger}/quellen`,
                person.cookie,
                anhaengen({ referenceKind: "ausfuehrlich", pages: "3" }),
            );
            if (angehaengt.statusCode !== 200) return angehaengt;
            const geaendert = await welt.post(`${TRAEGER}/place/${traeger}/quellen`, person.cookie, {
                operationId: operationId(),
                aenderungen: [
                    {
                        op: "update",
                        sourceId: id,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "3", note: null },
                        pages: "4",
                    },
                    { op: "add", sourceId: nachbar, vorher: null },
                ],
            });
            if (geaendert.statusCode !== 200) return geaendert;
            const geloest = await welt.post(`${TRAEGER}/place/${traeger}/quellen`, person.cookie, {
                operationId: operationId(),
                aenderungen: [
                    {
                        op: "remove",
                        sourceId: id,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "4", note: null },
                    },
                ],
            });
            if (geloest.statusCode !== 200) return geloest;
            const amGebiet = await welt.post(
                `${TRAEGER}/territory/${await gebiet(welt)}/quellen`,
                person.cookie,
                anhaengen({ referenceKind: "erwaehnung" }),
            );
            if (amGebiet.statusCode !== 200) return amGebiet;
            const anLandschaft = await welt.post(
                `${TRAEGER}/area/${await landschaft(welt)}/quellen`,
                person.cookie,
                anhaengen({ pages: "9" }),
            );
            if (anLandschaft.statusCode !== 200) return anLandschaft;
            // Der Gipfel (WI-0271 L4): anhängen und lösen an einer Höhle (`terrain_peak_source`, Etikett in `terrain_peak_canon`, Fachprotokoll `peak_public_id`).
            const amGipfel = await hoehle(welt);
            const anGipfel = await welt.post(
                `${TRAEGER}/peak/${amGipfel}/quellen`,
                person.cookie,
                anhaengen({ referenceKind: "erwaehnung", pages: "2" }),
            );
            if (anGipfel.statusCode !== 200) return anGipfel;
            const vomGipfel = await welt.post(`${TRAEGER}/peak/${amGipfel}/quellen`, person.cookie, {
                operationId: operationId(),
                aenderungen: [
                    {
                        op: "remove",
                        sourceId: id,
                        vorher: { state: "active", referenceKind: "erwaehnung", pages: "2", note: null },
                    },
                ],
            });
            if (vomGipfel.statusCode !== 200) return vomGipfel;
            // Die Straße: anhängen (INSERT an beiden Abschnitten), ändern (UPDATE), lösen (UPDATE auf gelöst), jeweils mit Zeilensperre.
            const weg = await strasse(welt);
            const amWeg = `${TRAEGER}/path/${weg}/quellen`;
            const wegAngehaengt = await welt.post(
                amWeg,
                person.cookie,
                anhaengen({ referenceKind: "ausfuehrlich", pages: "5" }),
            );
            if (wegAngehaengt.statusCode !== 200) return wegAngehaengt;
            const wegGeaendert = await welt.post(amWeg, person.cookie, {
                operationId: operationId(),
                aenderungen: [
                    {
                        op: "update",
                        sourceId: id,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "5", note: null },
                        pages: "6",
                    },
                ],
            });
            if (wegGeaendert.statusCode !== 200) return wegGeaendert;
            return welt.post(amWeg, person.cookie, {
                operationId: operationId(),
                aenderungen: [
                    {
                        op: "remove",
                        sourceId: id,
                        vorher: { state: "active", referenceKind: "ausfuehrlich", pages: "6", note: null },
                    },
                ],
            });
        },
    },
    // „Anlegen“ im Reiter Literatur (`work.create`): ein Werk der Redaktion, die Herkunftsvermerke je Feld, ein Eintrag im Fachprotokoll.
    "POST /api/editor/inhalte/literatur": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post(LITERATUR, person.cookie, {
                operationId: operationId(),
                title: "Neues Rauchwerk",
                productType: "gruppenabenteuer",
            });
        },
    },
    // „Speichern“ (`work.update`): Felder (mit Vermerk je Feld, die Jahresangabe in Worten fällt), die Ortsliste neu geordnet (Nummern ändern sich),
    // eine Zeile stillgelegt, eine neue angelegt.
    "POST /api/editor/inhalte/literatur/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id, zeilen } = await werk(welt);
            const neuerOrt = await ort(welt, "Rauchort");
            return welt.post(`${LITERATUR}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                fields: { genre: "Abenteuer", bfYear: 1044, editorNote: "Eine Notiz" },
                orte: [
                    { kind: "place", carrierId: neuerOrt, role: "start" },
                    { rowId: zeilen[1], role: "play" },
                ],
            });
        },
    },
    // „Anlegen“ im Reiter Vorkommen (`lore.create`, Vali wählte B am Gate „Vorkommen ohne Wiki-Artikel“): ein Eintrag ohne Wiki-Schlüssel, die Herkunft je Feld,
    // ein Eintrag im Fachprotokoll.
    "POST /api/editor/inhalte/vorkommen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post(VORKOMMEN, person.cookie, {
                operationId: operationId(),
                name: "Rauchmoos",
                art: "flora",
                gruppe: "Moos",
            });
        },
    },
    // „Anlegen“ im Reiter Korpora (`corpus.create`): ein Korpus für eine Domain, source_system editor, ein Eintrag im Fachprotokoll.
    "POST /api/editor/inhalte/korpora": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            return welt.post(KORPORA, person.cookie, {
                operationId: operationId(),
                key: `neu${randomUUID().slice(0, 8)}.example`,
                label: "Neuer Rauchkorpus",
            });
        },
    },
    // „Wirkung prüfen“ (nur rechnen): liest Korpus, Quellen und Verwendungen; schreibt nichts.
    "POST /api/editor/inhalte/korpora/:id/wirkung": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id } = await korpus(welt);
            return welt.post(`${KORPORA}/${id}/wirkung`, person.cookie, {
                fields: { sourceType: "briefspiel", isOfficial: false },
            });
        },
    },
    // „Speichern“ im Reiter Korpora (`corpus.update`): die Vorgabe einer Belegstelle auf die Quellen durchschreiben (Zeilensperre, UPDATE an der Quelle, das
    // Etikett des Trägers neu gerechnet), der Name des Angebots dazu.
    "POST /api/editor/inhalte/korpora/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id } = await korpus(welt);
            return welt.post(`${KORPORA}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                fields: {
                    label: "Rauchkorpus, bearbeitet",
                    sourceType: "briefspiel",
                    isOfficial: true,
                    attribution: "Rauchautor",
                },
            });
        },
    },
    // „Speichern“ im Reiter Vorkommen (`lore.update`): ein Feld, eine neue Ortszeile (Ziel mit Wiki-Schlüssel, Treffer neu gerechnet), die vorhandene
    // Zeile gelöst, eine Quelle angehängt. Dazu die Regeln (Regeleditor, WI-0254 `--weiter`): anlegen (INSERT an Regel, Bedingung und Art samt der neuen Spalte
    // `wiki_basis_key`), ersetzen (die alte still legen: UPDATE der fünf Zustandsspalten), entfernen und eine still gelegte mit demselben Fingerabdruck beleben; zuletzt eine Regel mit Lage zu einer
    // Linie (WI-0254, Migration 0250: INSERT der drei neuen Spalten `line_*` an der Bedingung).
    "POST /api/editor/inhalte/vorkommen/:id/update": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id, ort: zielOrt } = await eintrag(welt);
            const quellenId = await quelle(welt);
            const [zeile] = await welt.cluster.admin<{ id: string }[]>`
                SELECT p.id::text FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.public_id = ${id}::uuid LIMIT 1
            `;
            const res = await welt.post(`${VORKOMMEN}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 1,
                fields: { gruppe: "Geändert" },
                orte: [
                    { op: "add", kind: "place", carrierId: zielOrt, relation: "vorkommen" },
                    // Ein ungeklärter Name (Migration 0235): kein Schlüssel, keine Treffer.
                    { op: "add", name: "Rauchdorf im Norden", relation: "verbreitung" },
                    { op: "remove", rowId: zeile!.id },
                ],
                quellen: [{ op: "add", sourceId: quellenId, pages: "7" }],
            });
            // Das Zurückholen der gelösten Zeile rechnet ihre Treffer neu (DELETE und INSERT in `lore_place_target`).
            if (res.statusCode !== 200) return res;
            const zurueck = await welt.post(`${VORKOMMEN}/${id}/update`, person.cookie, {
                operationId: operationId(),
                baseRevision: 2,
                orte: [{ op: "restore", rowId: zeile!.id }],
            });
            if (zurueck.statusCode !== 200) return zurueck;
            // Die Regeln: anlegen, ersetzen, entfernen, beleben. Jeder Schritt ist ein Speichern mit der Revision des vorigen.
            const wald = {
                verknuepfung: "und",
                arten: [{ ebene: "vegetation", art: "wald" }],
                klima: { von: "boreal", bis: "gemaessigt" },
            };
            const steppe = { verknuepfung: "und", arten: [{ ebene: "vegetation", art: "steppe" }] };
            const speichern = async (baseRevision: number, regeln: unknown[]) =>
                welt.post(`${VORKOMMEN}/${id}/update`, person.cookie, {
                    operationId: operationId(),
                    baseRevision,
                    regeln,
                });
            const aktive = async (): Promise<string[]> =>
                (
                    await welt.cluster.admin<{ id: string }[]>`
                        SELECT r.id::text FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id WHERE e.public_id = ${id}::uuid AND r.state = 'active' ORDER BY r.id
                    `
                ).map((eine) => eine.id);
            const angelegt = await speichern(3, [{ op: "add", relation: "verbreitung", bedingungen: [wald] }]);
            if (angelegt.statusCode !== 200) return angelegt;
            const [erste] = await aktive();
            const ersetzt = await speichern(4, [
                { op: "add", relation: "verbreitung", ersetzt: erste, bedingungen: [steppe, wald] },
            ]);
            if (ersetzt.statusCode !== 200) return ersetzt;
            const [zweite] = await aktive();
            const entfernt = await speichern(5, [{ op: "remove", ruleId: zweite }]);
            if (entfernt.statusCode !== 200) return entfernt;
            // Dieselbe Kette wie die erste: Die still gelegte Zeile lebt wieder auf (kein zweiter Fingerabdruck, kein 23505).
            const belebt = await speichern(6, [{ op: "add", relation: "verbreitung", bedingungen: [wald] }]);
            if (belebt.statusCode !== 200) return belebt;
            // Die Lage zu einer Linie (Migration 0250): INSERT der Bedingung mit den drei neuen Spalten (Richtung, Ort A und B als Fremdschlüssel auf `place`), als App-Rolle.
            const lage = { verknuepfung: "und", arten: [], lage: { richtung: "sued", orte: [zielOrt] } };
            return speichern(7, [{ op: "add", relation: "verbreitung", bedingungen: [lage] }]);
        },
    },
    // Ein Vorkommen zurücknehmen (WI-0265 B6g2): ein „Speichern“ mit Feld, Ortszeilen, Quelle und Regel über die Route, dann die Vorprüfung (liest nur) und die Rücknahme als App-Rolle (Zeilensperre `FOR UPDATE`
    // auf Eintrag, Ortszeile, Verknüpfung und Regel; UPDATE von Eintrag, Zeilen und den fünf Zustandsspalten der Regel; die Treffer der wieder aktiven Zeile neu: DELETE und INSERT in `lore_place_target`;
    // Herkunftsvermerk je Feld; Fachprotokoll mit Grund, Verknüpfung zum Original).
    "POST /api/editor/inhalte/vorkommen/:id/restore-series/preview": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id } = await eintrag(welt);
            const eins = operationId();
            welt.muss(
                await welt.post(`${VORKOMMEN}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { gruppe: "Geändert" },
                }),
            );
            return welt.post(`${VORKOMMEN}/${id}/restore-series/preview`, person.cookie, {
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    "POST /api/editor/inhalte/vorkommen/:id/restore-series": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const { id, ort: zielOrt } = await eintrag(welt);
            const quellenId = await quelle(welt);
            const [zeile] = await welt.cluster.admin<{ id: string }[]>`
                SELECT p.id::text FROM lore_place p JOIN lore_entry e ON e.id = p.lore_entry_id WHERE e.public_id = ${id}::uuid LIMIT 1
            `;
            const eins = operationId();
            welt.muss(
                await welt.post(`${VORKOMMEN}/${id}/update`, person.cookie, {
                    operationId: eins,
                    baseRevision: 1,
                    fields: { gruppe: "Geändert", editorNote: "Eine Notiz" },
                    orte: [
                        { op: "add", kind: "place", carrierId: zielOrt, relation: "vorkommen" },
                        { op: "remove", rowId: zeile!.id },
                    ],
                    quellen: [{ op: "add", sourceId: quellenId, pages: "7" }],
                    regeln: [
                        {
                            op: "add",
                            relation: "verbreitung",
                            bedingungen: [{ verknuepfung: "und", arten: [{ ebene: "vegetation", art: "wald" }] }],
                        },
                    ],
                }),
            );
            return welt.post(`${VORKOMMEN}/${id}/restore-series`, person.cookie, {
                operationId: operationId(),
                members: [eins],
                membersHash: mitgliederHash([eins]),
            });
        },
    },
    // „Regeln als Text“ prüfen (WI-0254 §13): liest Flächen, Orte, Einträge, Quellen, Regeln, wartende Titel und den Vorschlag des WikiSync in EINER lesenden Transaktion (repeatable read, read only) als App-Rolle.
    "POST /api/editor/inhalte/vorkommen-text/pruefen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("reviewer");
            return welt.post(`${VORKOMMEN}-text/pruefen`, person.cookie, {
                text: ["Rauchtier (Fauna)", "| Verbreitung = [[Wald]]"].join("\n"),
            });
        },
    },
    // „Regeln als Text“ übernehmen (`lore.rules_text`, WI-0254 §13): EINE Operation über mehrere Einträge als App-Rolle. Ein Eintrag mit Wiki-Schlüssel bekommt eine Regel und eine Quelle (INSERT an Regel, Bedingung und Art, an der
    // Verknüpfung; Zeilensperre auf dem Eintrag; UPDATE der Revision und von `source_system`), ein neuer Eintrag wird angelegt (INSERT in `lore_entry` und `lore_entry_field_origin`) und bekommt eine Regel; ein Eintrag im Fachprotokoll je Eintrag.
    // Die Quelle und die Fläche stehen mit Kennungsanfang im Text: Mehrere Fälle legen Quellen gleichen Titels an.
    "POST /api/editor/inhalte/vorkommen-text/uebernehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await welt.jemand("editor");
            const nummer = randomUUID().slice(0, 8);
            const name = `Rauchtext ${nummer}`;
            const quellenId = await quelle(welt);
            const flaecheId = await landschaft(welt);
            await welt.cluster.admin`
                INSERT INTO lore_entry (wiki_key, kind, name, source_system) VALUES (${`rauchtext-${nummer}`}, 'flora', ${name}, 'rauchtest')
            `;
            const text = [
                `Quelle: [[#${quellenId.slice(0, 8)}|Rauchquelle]], S. 3`,
                `${name} (Flora)`,
                `| Verbreitung = [[Wald]] in [[#${flaecheId.slice(0, 8)}]]`,
                `Rauchmoos ${nummer} (Fauna, neu)`,
                "| Herkunft = [[Wald]] Klima boreal bis gemäßigt",
            ].join("\n");
            return welt.post(`${VORKOMMEN}-text/uebernehmen`, person.cookie, { operationId: operationId(), text });
        },
    },
};
