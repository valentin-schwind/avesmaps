import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leseHerkunft, setzeHerkunft } from "../src/editor/feld-herkunft.ts";
import { postgresBin, startVpsCluster, type Privilege, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte der App-Rolle an den Kartentabellen des Ortseditors (WI-0128 E8, EDIT-0001 §5.1 N2), so wie auf dem VPS: Werkzeug
 * (`grants_sql_tmpl`), dann `media-grants.psql`, `system-grants.psql` und `map-grants.psql` in einem Wegwerf-Cluster.
 *
 * 🔴 Problemfälle: Die App ändert oder löscht eine Operation oder eine Protokollzeile; die App löscht einen Ort (statt ihn stillzulegen);
 * die App ändert an einem Weg mehr als seine Linie oder setzt beim Anlegen mehr als die Spalten eines neuen Wegs (WI-0177); der Trigger
 * der Revision scheitert an fehlenden Spaltenrechten der App.
 */

const ENV = "mapgrants";
const db = (name: string): string => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url));

/** Was die App an den Tabellen des Ortseditors darf. */
const APP_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    map_operation: ["SELECT", "INSERT"],
    map_audit_event: ["SELECT", "INSERT"],
    // Die Verknüpfung einer Rücknahme mit den Operationen, die sie zurücknimmt (WI-0265 B1, 0262): nur anhängen wie die Mutter.
    map_operation_revert_link: ["SELECT", "INSERT"],
    place: ["SELECT", "INSERT", "UPDATE"],
    place_detail: ["SELECT", "INSERT", "UPDATE"],
    place_wiki_assignment: ["SELECT", "INSERT", "UPDATE"],
    // Die Spalte `geom` darf sie ändern; das zeigt `has_table_privilege` nicht, der Fall unten prüft es.
    path: ["SELECT"],
    path_visual: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    // Landschaften (WI-0178 B1): schreiben ja, löschen nie; die Ableitungen nur lesen (`landscape-revision.test.ts` prüft es als App).
    region: ["SELECT", "INSERT", "UPDATE"],
    region_area: ["SELECT", "INSERT", "UPDATE"],
    map_label: ["SELECT", "INSERT", "UPDATE"],
    region_area_smooth: ["SELECT"],
    landscape_label_run: ["SELECT"],
    // Kraftlinien (WI-0205 K4): schreiben ja, löschen nie (`editor-kraftlinien-daten.test.ts` prüft es als App).
    powerline: ["SELECT", "INSERT", "UPDATE"],
    nodix: ["SELECT", "INSERT", "UPDATE"],
    powerline_wiki_assignment: ["SELECT", "INSERT", "UPDATE"],
    // Gipfel und Landmarken (WI-0271 L4): Die Wiki-Box ordnet zu und löst; löschen nie (`wiki-box.test.ts` fährt den Weg als App).
    terrain_peak_wiki_assignment: ["SELECT", "INSERT", "UPDATE"],
    // Herrschaftsgebiete (WI-0209 B1): schreiben ja, löschen nie (`territory-revision.test.ts` prüft es als App).
    territory: ["SELECT", "INSERT", "UPDATE"],
    territory_area: ["SELECT", "INSERT", "UPDATE"],
    territory_claim: ["SELECT", "INSERT", "UPDATE"],
    // Die Sperre während der Bearbeitung (0138): nehmen, schlagen, freigeben, wegräumen; leeren nie (`editor-lock.test.ts`).
    editor_lock: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    // Die Bitte um Freigabe einer Sperre (0253): bitten, antworten, Alte wegräumen; leeren nie (`editor-lock-request.test.ts`).
    editor_lock_request: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    // Herkunft je Feld mit Wiki-Wert (WI-0225, 0183): setzen mit „Fertig“, löschen nie (Fall unten, als App).
    field_origin: ["SELECT", "INSERT", "UPDATE"],
    // Stätten (0099) liest der Editor nur; eine für einen Kartenpunkt legt er über `site_punkt_fuer_ort` an (WI-0196, Fall unten).
    site: ["SELECT"],
    site_settlement: ["SELECT", "INSERT", "UPDATE"],
    // Korpora (WI-0254, 0236): anlegen und ändern (Angaben, Vorgabe für die Quellen); löschen nie.
    source_corpus: ["SELECT", "INSERT", "UPDATE"],
    // Quellen (WI-0254, 0232): anlegen, ändern, still legen; löschen nie. Die Kanon-Tafeln behalten DELETE (abgeleitet, Fall in `inhalte-quellen.test.ts`).
    feature_source: ["SELECT", "INSERT", "UPDATE"],
    place_source: ["SELECT", "INSERT", "UPDATE"],
    territory_source: ["SELECT", "INSERT", "UPDATE"],
    region_source: ["SELECT", "INSERT", "UPDATE"],
    terrain_peak_source: ["SELECT", "INSERT", "UPDATE"],
    // Literatur (WI-0254, 0233): Werke anlegen und ändern, Ortszeilen anlegen, ändern und still legen, Herkunftsvermerke je Feld; löschen nie.
    adventure: ["SELECT", "INSERT", "UPDATE"],
    adventure_place: ["SELECT", "INSERT", "UPDATE"],
    adventure_field_origin: ["SELECT", "INSERT", "UPDATE"],
    // Vorkommen (WI-0254, 0234): Einträge ändern, Ortszeilen und Quellenverknüpfungen anlegen, ändern, still legen; löschen nie. Die abgeleiteten Treffer
    // der Ortszeilen legt die App an und ersetzt sie (INSERT, DELETE).
    lore_entry: ["SELECT", "INSERT", "UPDATE"],
    lore_place: ["SELECT", "INSERT", "UPDATE"],
    lore_entry_field_origin: ["SELECT", "INSERT", "UPDATE"],
    lore_entry_source: ["SELECT", "INSERT", "UPDATE"],
    lore_place_target: ["SELECT", "INSERT", "DELETE"],
    // Sprachen (WI-0261 S2, 0254): Sprachen und Teilflächen anlegen, ändern, still legen; löschen nie.
    sprache: ["SELECT", "INSERT", "UPDATE"],
    sprache_flaeche: ["SELECT", "INSERT", "UPDATE"],
    // Wiki-Artikel einer Sprache (WI-0261 S3, 0255): zuordnen, umordnen, still legen; löschen nie.
    sprache_wiki: ["SELECT", "INSERT", "UPDATE"],
};

const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Kartentabellen: Rechte der Rollen wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster;

    beforeAll(async () => {
        cluster = await startVpsCluster(
            ENV,
            [db("media-grants.psql"), db("system-grants.psql"), db("map-grants.psql")],
            { mapDomains: true },
        );
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 die App darf an Operation und Protokoll nur anhängen, Orte nie löschen, an Wegen nur die Linie", async () => {
        for (const [table, may] of Object.entries(APP_MAY)) {
            expect(await cluster.granted(cluster.roles.app, table), `App an ${table}`).toEqual(may);
            expect(await cluster.granted("public", table), `PUBLIC an ${table}`).toEqual([]);
            expect(await cluster.granted(cluster.roles.tiles, table), `Kachelrolle an ${table}`).toEqual([]);
        }
    });

    it("🔴 als App-Rolle: Operation anhängen, Ort ändern, Wegelinie ziehen, Weg anlegen geht und zählt die Revision; der Rest nicht", async () => {
        const ort = "e8e8e8e8-0000-4000-8000-0000000000a1";
        const weg = "e8e8e8e8-0000-4000-8000-0000000000a2";
        await cluster.migrator`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ort}, 'aventuria', 'E8 Rechte', 'dorf', ST_SetSRID(ST_MakePoint(401, 402), 0), 'legacy', TRUE)
        `;
        await cluster.migrator`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${weg}, 'aventuria', 'E8 Rechteweg', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(401, 402), ST_MakePoint(410, 410)), 0), 'legacy', TRUE)
        `;
        const op = "e8e8e8e8-0000-4000-9000-0000000000a1";
        const receipt = `{"operationId":"${op}","status":"applied","environment":"test","affected":[],"derivedWork":[],"warnings":[]}`;
        const codes = await cluster.codesAs(cluster.app, [
            `INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, environment, actor_kind, actor_person_id)
             VALUES ('${op}', 'aventuria', sha256('x'::bytea), '${receipt}', 'place.move', 'test', 'person', gen_random_uuid())`,
            `INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after)
             VALUES ('${op}', 'place.moved', '${ort}', 1, 2)`,
            `UPDATE place SET geom = ST_SetSRID(ST_MakePoint(402, 402), 0) WHERE public_id = '${ort}' AND revision = 1`,
            `UPDATE path SET geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(402, 402), ST_MakePoint(410, 410)), 0) WHERE public_id = '${weg}'`,
            `DO $$ BEGIN
                 IF (SELECT revision FROM place WHERE public_id = '${ort}') <> 2 OR (SELECT revision FROM path WHERE public_id = '${weg}') <> 2 THEN
                     RAISE EXCEPTION 'Revision nicht gezählt' USING ERRCODE = 'P0001';
                 END IF;
             END $$`,
            `UPDATE map_operation SET summary = 'anders' WHERE operation_id = '${op}'`,
            `DELETE FROM map_audit_event`,
            `DELETE FROM place WHERE public_id = '${ort}'`,
            `UPDATE path SET source_system = 'umgeschrieben' WHERE public_id = '${weg}'`,
            `DELETE FROM path WHERE public_id = '${weg}'`,
            // Ein neuer Weg und der hintere Teil beim Teilen (WI-0177) setzen genau ihre Spalten, auch die Reisemittel des Originals,
            // und ziehen ihre Nummer; die Herkunft aus Legacy setzt nur der Import. „Ganz löschen“ ist weich (`is_active`), „Von der Karte nehmen“ setzt
            // `off_map` (Migration 0150).
            `INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active,
                               flow_direction, flow_factor, allowed_transports, transport_domain, transport_seasons)
             VALUES (gen_random_uuid(), 'aventuria', 'Weg-1', 'Weg', FALSE, FALSE,
                     ST_SetSRID(ST_MakeLine(ST_MakePoint(401, 402), ST_MakePoint(410, 410)), 0), 'avesmaps3d', TRUE,
                     NULL, NULL, ARRAY['groupFoot'], 'land', NULL)`,
            `INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, legacy_public_id)
             VALUES (gen_random_uuid(), 'aventuria', 'Weg-2', 'Weg',
                     ST_SetSRID(ST_MakeLine(ST_MakePoint(401, 402), ST_MakePoint(410, 410)), 0), 'avesmaps3d', gen_random_uuid())`,
            `UPDATE path SET is_active = FALSE WHERE public_id = '${weg}'`,
            `UPDATE path SET off_map = TRUE WHERE public_id = '${weg}'`,
            // Die Felder der Straße (WI-0177 W5b, `path.update`): Name, Art, „Name auf der Karte“; die Herkunft oben nie.
            `UPDATE path SET name = 'Umbenannt', subtype = 'Pfad', label_visible = TRUE WHERE public_id = '${weg}'`,
            // Flüsse und Bäche (WI-0177, Plan Fluss/Bach): umstellen zwischen Landweg, Fluss und Bach, die Fließrichtung drehen.
            `UPDATE path SET subtype = 'Flussweg', is_bach = TRUE, transport_domain = 'river', flow_direction = 'reverse' WHERE public_id = '${weg}'`,
        ]);
        expect(codes).toEqual([
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "42501",
            "42501",
            "42501",
            "42501",
            "42501",
            "ok",
            "42501",
            "ok",
            "ok",
            "ok",
            "ok",
        ]);
    });

    it("🔴 WI-0265 B1: die App hängt die Verknüpfung einer Rücknahme an und liest sie, ändert, löscht und leert sie nie; Selbstverweis, Doppelte und Fremdes weist die Tafel ab", async () => {
        const op = (n: number): string => `e8e8e8e8-0000-4000-9000-0000000000c${String(n)}`;
        const operation = (n: number): string =>
            `INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, environment, actor_kind, actor_person_id)
             VALUES ('${op(n)}', 'aventuria', sha256('x'::bytea),
                     '{"operationId":"${op(n)}","status":"applied","environment":"test","affected":[],"derivedWork":[],"warnings":[]}',
                     'place.move', 'test', 'person', gen_random_uuid())`;
        const link = (von: string, nach: string, position: number): string =>
            `INSERT INTO map_operation_revert_link (restore_operation_id, reverted_operation_id, position)
             VALUES ('${von}', '${nach}', ${String(position)})`;
        const codes = await cluster.codesAs(cluster.app, [
            operation(1),
            operation(2),
            operation(3),
            operation(4),
            link(op(3), op(1), 0),
            link(op(3), op(2), 1),
            `SELECT * FROM map_operation_revert_link WHERE reverted_operation_id = '${op(1)}'`,
            `UPDATE map_operation_revert_link SET position = 5`,
            `DELETE FROM map_operation_revert_link`,
            `TRUNCATE map_operation_revert_link`,
            // Die Tafel weist ab: den Selbstverweis, dieselbe Zeile noch einmal, eine zweite Zeile an derselben Position, eine
            // Operation, die es nicht gibt, und eine negative Position.
            link(op(3), op(3), 2),
            link(op(3), op(1), 3),
            link(op(3), op(4), 0),
            link(op(3), "e8e8e8e8-0000-4000-9000-0000000000cf", 9),
            link(op(4), op(1), -1),
        ]);
        expect(codes).toEqual([
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "ok",
            "42501",
            "42501",
            "42501",
            "23514",
            "23505",
            "23505",
            "23503",
            "23514",
        ]);
    });

    it("🔴 Konto auflösen (WI-0265 B7, 0273): die App ruft redact_person_map_operation und schwärzt so, was sie selbst nicht ändern darf; sonst niemand", async () => {
        const callable = async (role: string): Promise<boolean> => {
            const [row] = await cluster.admin.unsafe<{ ok: boolean }[]>(
                `SELECT has_function_privilege($1, 'public.redact_person_map_operation(uuid)', 'EXECUTE') AS ok`,
                [role],
            );
            return row?.ok ?? false;
        };
        // Aus den Default-Privilegien des Werkzeugs (`sql_env`), ohne Zeile in map-grants.psql; PUBLIC nahm die Migration weg.
        expect(await callable(cluster.roles.app)).toBe(true);
        expect(await callable("public")).toBe(false);
        expect(await callable(cluster.roles.tiles)).toBe(false);
        expect(await callable(cluster.roles.jobs)).toBe(false);

        const op = "e8e8e8e8-0000-4000-9000-0000000000d1";
        const person = "7e570000-0000-4000-8000-0000000000d1";
        const receipt = `{"operationId":"${op}","status":"applied","environment":"test","affected":[],"derivedWork":[],"warnings":[]}`;
        const codes = await cluster.codesAs(cluster.app, [
            `INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_person_id)
             VALUES ('${op}', 'aventuria', sha256('x'::bytea), '${receipt}', 'place.restore_series', 'restore', 'test', 'person', '${person}')`,
            `INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
             VALUES ('${op}', 'place.updated', gen_random_uuid(), 1, 2,
                     '{"name": {"before": "a", "after": "b"}, "restoreReason": {"after": "Mail von Rondrikan"}}')`,
            // Direkt darf die App weder den Grund noch den Hash ändern.
            `UPDATE map_audit_event SET changes = '{}'::jsonb WHERE operation_id = '${op}'`,
            `UPDATE map_operation SET request_hash = NULL WHERE operation_id = '${op}'`,
            `SELECT redact_person_map_operation('${person}')`,
            `DO $$ BEGIN
                 IF (SELECT changes -> 'restoreReason' ->> 'after' FROM map_audit_event WHERE operation_id = '${op}') <> '[geschwärzt]'
                    OR (SELECT changes -> 'name' ->> 'after' FROM map_audit_event WHERE operation_id = '${op}') <> 'b'
                    OR (SELECT request_hash FROM map_operation WHERE operation_id = '${op}') IS NOT NULL THEN
                     RAISE EXCEPTION 'nicht geschwärzt' USING ERRCODE = 'P0001';
                 END IF;
             END $$`,
            // Wiederholbar, und sonst bleibt die Operation, wie sie ist (die Funktion hängt der App nichts weiter auf).
            `DO $$ BEGIN
                 IF public.redact_person_map_operation('${person}') <> 0 THEN
                     RAISE EXCEPTION 'zweiter Aufruf änderte etwas' USING ERRCODE = 'P0001';
                 END IF;
             END $$`,
            `UPDATE map_operation SET summary = 'anders' WHERE operation_id = '${op}'`,
        ]);
        expect(codes).toEqual(["ok", "ok", "42501", "42501", "ok", "ok", "ok", "42501"]);
    });

    it("🔴 WI-0196: die Stätte eines Kartenpunkts legt die App nur über site_punkt_fuer_ort an, einmal, nie direkt", async () => {
        const haus = "e8e8e8e8-0000-4000-8000-0000000000b1";
        const dorf = "e8e8e8e8-0000-4000-8000-0000000000b2";
        await cluster.migrator`
            INSERT INTO place (public_id, map_domain_id, name, subtype, place_kind, geom, source_system, is_active)
            VALUES (${haus}, 'aventuria', 'E8 Tempel', 'gebaeude', 'Tempel', ST_SetSRID(ST_MakePoint(403, 404), 0), 'legacy', TRUE),
                   (${dorf}, 'aventuria', 'E8 Dorf', 'dorf', NULL, ST_SetSRID(ST_MakePoint(405, 406), 0), 'legacy', TRUE)
        `;
        const genau = (anzahl: number) => `DO $$ BEGIN
                 IF (SELECT count(*) FROM site WHERE source_kind = 'punkt' AND source_key = '${haus}' AND source_system = 'avesmaps3d'
                       AND site_class = 'gebaeude' AND site_type = 'Tempel' AND on_map AND name = 'E8 Tempel') <> ${String(anzahl)} THEN
                     RAISE EXCEPTION 'nicht genau eine Stätte' USING ERRCODE = 'P0001';
                 END IF;
             END $$`;
        const codes = await cluster.codesAs(cluster.app, [
            `SELECT public.site_punkt_fuer_ort('${haus}')`,
            genau(1),
            // Ein zweiter Aufruf legt nichts an.
            `SELECT public.site_punkt_fuer_ort('${haus}')`,
            genau(1),
            // Nur Gebäude und Stadtviertel.
            `SELECT public.site_punkt_fuer_ort('${dorf}')`,
            // Direkt schreiben darf die App die Stätte nicht.
            `INSERT INTO site (source_kind, source_key, name) VALUES ('punkt', gen_random_uuid()::text, 'Direkt')`,
            `UPDATE site SET name = 'Anders' WHERE source_key = '${haus}'`,
        ]);
        expect(codes).toEqual(["ok", "ok", "ok", "ok", "22023", "42501", "42501"]);
        expect(await cluster.granted("public", "site")).toEqual([]);
    });

    it("🔴 WI-0225: als App-Rolle setzt der Schreibweg die Herkunft je Feld und überschreibt sie; löschen darf die App nicht", async () => {
        const weg = "e8e8e8e8-0000-4000-8000-0000000000c1";
        const abschnitt = "e8e8e8e8-0000-4000-8000-0000000000c2";
        // ↺ am Namen der Straße (zwei Abschnitte, einer doppelt genannt), der Wegtyp getippt.
        await setzeHerkunft(cluster.app, "path", [weg, abschnitt, weg], { name: "wiki", subtype: "manual" });
        expect(await leseHerkunft(cluster.app, "path", [weg, abschnitt])).toEqual(
            new Map([
                [weg, { name: "wiki", subtype: "manual" }],
                [abschnitt, { name: "wiki", subtype: "manual" }],
            ]),
        );
        // Getippt nach ↺: nur der Name wird manual, der Wegtyp bleibt; eine andere Art sieht nichts davon.
        await setzeHerkunft(cluster.app, "path", [weg], { name: "manual" });
        expect((await leseHerkunft(cluster.app, "path", [weg])).get(weg)).toEqual({
            name: "manual",
            subtype: "manual",
        });
        expect(await leseHerkunft(cluster.app, "landscape", [weg])).toEqual(new Map());
        // Felder, die eine Art nicht hier führt (der Ort hat seine Herkunft in place_detail), nimmt der Server nicht an.
        await expect(setzeHerkunft(cluster.app, "place", [weg], { einwohner: "wiki" })).rejects.toThrow(/einwohner/);
        await expect(setzeHerkunft(cluster.app, "path", [weg], { geom: "manual" })).rejects.toThrow(/geom/);
        const codes = await cluster.codesAs(cluster.app, [
            `DELETE FROM field_origin WHERE object_id = '${weg}'`,
            `TRUNCATE field_origin`,
            `INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('path', '${weg}', 'name', 'legacy')`,
            `INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('kanal', '${weg}', 'name', 'wiki')`,
        ]);
        expect(codes).toEqual(["42501", "42501", "23514", "23514"]);
    });
});
