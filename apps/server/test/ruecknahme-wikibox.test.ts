import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    wikiBoxEntfernenUrl,
    wikiBoxZuweisenUrl,
    editorWikiBoxRestoreSeriesPreviewUrl,
    editorWikiBoxRestoreSeriesUrl,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type WikiBoxArt,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { koenntMitgliedSein, mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange } from "../src/editor/history.ts";
import { mapOperation } from "../src/editor/map-operation.ts";
import { schreibeX2, weitereEintraege, type WeitereZeile } from "../src/wiki/objekt/anschluss.ts";
import { wegAnschluss } from "../src/wiki/objekt/weg.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { welt as baueWelt, type Welt } from "./support/schreibwege/welt.ts";
import { neuerOrdner } from "./support/wiki-dump-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";
import { ID, legeGebieteAn, legeOrteAn, legeWegeAn, raeumeAb } from "./support/wikisync-welt.ts";

/**
 * Die Wiki-Box zurücknehmen (WI-0265 B8d; Fachvertrag C.2, C.3, F.1, Gate 2 und 3): `POST /api/editor/wiki-box/:art/:id/restore-series[/preview]` gegen einen Wegwerf-Cluster mit den Rollen und Rechten des VPS
 * (Fastify als App-Rolle). Ein Schritt der Box ist ein Einzeleintrag (nie in einer Serie) und geht von hinten einzeln zurück.
 *
 * Problemfälle: Die Rücknahme stellt den Artikel her, aber nicht die Herkunft der Zuordnung (der Import verliert sie an die Redaktion); sie weist einen Artikel zu, den es nicht mehr gibt oder der vorher nur an einem Teil der
 * Straße hing; sie überschreibt einen späteren Schritt; ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund zurückgenommen; die Rücknahme der Rücknahme führt nicht zum Stand nach dem Schritt;
 * der Schritt der Box landet in einer Serie mit den Feldern des Trägers.
 */

const ENV = "wikiboxrueck";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;

const config: ServerConfig = {
    port: 0,
    host: "127.0.0.1",
    releaseId: "wi0265-b8d-test",
    databaseUrl: undefined,
    tileRoot: undefined,
    statusPage: true,
    mapEditing: "testwelt",
    auth: TEST_AUTH,
};

describeWithCluster("Wiki-Box zurücknehmen (Wegwerf-Cluster, Rollen wie auf dem VPS)", () => {
    let cluster: VpsCluster | undefined;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let welt: Welt;
    let ordner: Awaited<ReturnType<typeof neuerOrdner>>;

    const admin = (): Database => cluster!.admin;
    const wert = async <T>(sql: string): Promise<T[]> => admin().unsafe<T[]>(sql);

    async function neueWelt(bau: (db: Database) => Promise<void>): Promise<void> {
        await raeumeAb(admin());
        await bau(admin());
        await admin()`DELETE FROM map_audit_event WHERE operation_id IN (SELECT operation_id FROM map_operation WHERE action LIKE 'wikibox.%')`;
        await admin()`DELETE FROM map_operation WHERE action LIKE 'wikibox.%'`;
    }
    const koerper = (members: string[], extra: { operationId?: string; reason?: string } = {}) => ({
        operationId: extra.operationId ?? randomUUID(),
        members,
        membersHash: mitgliederHash(members),
        ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    });
    const zuweisen = async (cookie: string, art: WikiBoxArt, id: string, key: string): Promise<string> => {
        const operationId = randomUUID();
        const ok = await welt.post(wikiBoxZuweisenUrl(art, id), cookie, { operationId, key });
        expect(ok.statusCode, ok.body).toBe(200);
        return operationId;
    };
    const entfernen = async (cookie: string, art: WikiBoxArt, id: string): Promise<string> => {
        const operationId = randomUUID();
        const ok = await welt.post(wikiBoxEntfernenUrl(art, id), cookie, { operationId });
        expect(ok.statusCode, ok.body).toBe(200);
        return operationId;
    };
    /**
     * Ein weiterer Artikel am Weg, wie ihn die Box unter WI-0300 schrieb: hinzufügen oder lösen in EINER Operation an der Karte (als App-Rolle) mit denselben Einträgen
     * (`weitereEintraege`), liefert die Kennung der Operation. Seit WI-0302 hat die Box keinen Schreibweg mehr dafür; die Stage hat solche Schritte, ihre Rücknahme bleibt.
     */
    const weitere = async (
        personId: string,
        richtung: "zuweisen" | "entfernen",
        id: string,
        key: string,
    ): Promise<string> => {
        const operationId = randomUUID();
        const db = cluster!.app;
        const objekt = (await wegAnschluss.lies(db, id))!;
        await mapOperation(
            db,
            { kind: "person", personId, environment: "test" },
            {
                operationId,
                operation: richtung === "zuweisen" ? "wikibox.weitere_zuweisen" : "wikibox.weitere_entfernen",
                mapDomainId: objekt.mapDomainId,
                body: { art: "weg", id, key },
            },
            async (tx) => {
                const vorher = await wegAnschluss.sperre(tx, objekt);
                const zeilen = new Map<string, WeitereZeile>();
                if (richtung === "zuweisen") {
                    // Wie die Box: an jedem Abschnitt, an dem der Artikel noch nicht hängt, eine neue Zeile mit Herkunft editor.
                    const neu = await tx<{ id: string; path: string }[]>`
                        INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
                        SELECT p.id, 'further', s.wiki_url, s.id, 'assigned', 'editor', 'avesmaps3d', TRUE
                          FROM path p, wiki_path_snapshot s
                         WHERE p.public_id = ANY(${objekt.ids}::uuid[]) AND s.wiki_key = ${key} AND s.is_active
                           AND NOT EXISTS (SELECT 1 FROM path_wiki_assignment a WHERE a.path_id = p.id AND a.is_active AND a.snapshot_id = s.id)
                        RETURNING id::text AS id, (SELECT public_id::text FROM path WHERE path.id = path_wiki_assignment.path_id) AS path
                    `;
                    for (const zeile of neu) zeilen.set(zeile.path, { id: zeile.id, herkunft: "editor" });
                } else {
                    // Wie die Box: alle aktiven Zeilen des Artikels still legen, die Herkunft von vorher steht im Protokoll.
                    const alt = await tx<{ id: string; path: string; herkunft: string }[]>`
                        SELECT w.id::text AS id, p.public_id::text AS path, w.assignment_origin AS herkunft
                          FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                         WHERE p.public_id = ANY(${objekt.ids}::uuid[]) AND w.is_active AND w.role = 'further' AND s.wiki_key = ${key}
                    `;
                    for (const zeile of alt) zeilen.set(zeile.path, { id: zeile.id, herkunft: zeile.herkunft });
                    await wegAnschluss.weitere!.legeStill(tx, [...zeilen.values()]);
                }
                expect(zeilen.size).toBeGreaterThan(0);
                const nachher = await wegAnschluss.beruehre(tx, objekt);
                return {
                    receipt: {
                        affected: objekt.ids.map((kennung) => ({
                            kind: "path" as const,
                            id: kennung,
                            revision: nachher.get(kennung) ?? 0,
                        })),
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: weitereEintraege(
                        wegAnschluss,
                        richtung === "zuweisen" ? "wiki_weitere_zugewiesen" : "wiki_weitere_entfernt",
                        objekt,
                        vorher,
                        nachher,
                        key,
                        zeilen,
                    ),
                    ableitung: false,
                };
            },
        );
        return operationId;
    };
    const vorschau = async (cookie: string, art: WikiBoxArt, id: string, members: string[]) =>
        (
            await welt.post(editorWikiBoxRestoreSeriesPreviewUrl(art, id), cookie, {
                members,
                membersHash: mitgliederHash(members),
            })
        ).json() as RuecknahmePruefung;
    const ruecknehmen = (cookie: string, art: WikiBoxArt, id: string, body: ReturnType<typeof koerper>) =>
        welt.post(editorWikiBoxRestoreSeriesUrl(art, id), cookie, body);
    const eintrag = async (personId: string, operationId: string) =>
        (await mapChange(cluster!.app, operationId, { mapDomainId: "aventuria", personId }))!;

    /** Die Zuordnung eines Orts: Artikel, Zustand, Herkunft, System. */
    const ortZuordnung = async (id: string) =>
        (
            await wert<{ key: string | null; state: string; origin: string; system: string; x2: string | null }>(
                `SELECT s.wiki_key AS key, a.assignment_state AS state, a.assignment_origin AS origin, a.source_system AS system,
                        (SELECT x.wiki_key FROM wiki_key_assignment x WHERE x.legacy_art = 'siedlung' AND x.object_public_id = p.public_id AND x.is_active) AS x2
                   FROM place p JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
                   LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id
                  WHERE p.public_id = '${id}'`,
            )
        )[0]!;
    /** Die Straße „Mittelpfad-alt“: Nur Q1 hängt am Artikel Mittelpfad. */
    const MITTE = [ID.mitteQ1, ID.mitteQ2];
    /** Je Abschnitt und aktiver Zuordnung: Rolle, Artikel, Zustand, Herkunft, System, dazu die Tafel X2 und der Vermerk am Namen. */
    const wegZuordnung = async (ids: readonly string[]) =>
        wert<Record<string, string | null>>(
            `SELECT p.public_id::text AS id, w.role, s.wiki_key AS key, w.assignment_state AS state, w.assignment_origin AS origin, w.source_system AS system,
                    (SELECT x.wiki_key FROM wiki_key_assignment x WHERE x.legacy_art = 'weg' AND x.object_public_id = p.public_id AND x.is_active) AS x2,
                    (SELECT f.origin FROM field_origin f WHERE f.object_kind = 'path' AND f.object_id = p.public_id AND f.field = 'name') AS name_origin
               FROM path p LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.is_active
               LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
              WHERE p.public_id = ANY(ARRAY['${ids.join("','")}']::uuid[]) ORDER BY p.public_id, w.role`,
        );
    /** Wie in Production: Die Tafel X2 spiegelt den Hauptartikel von Q1 (die Testwelt legt sie nicht an). */
    const spiegleX2 = async (): Promise<void> => {
        const [stand] = await wert<{ key: string; url: string; name: string | null }>(
            `SELECT wiki_key AS key, wiki_url AS url, name FROM wiki_path_snapshot WHERE wiki_key = 'mittelpfad' AND is_active`,
        );
        await schreibeX2(admin(), "weg", [ID.mitteQ1], stand!);
    };
    const revisionOrt = async (id: string): Promise<number> =>
        Number((await wert<{ r: number }>(`SELECT revision::int AS r FROM place WHERE public_id = '${id}'`))[0]!.r);

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        await seedMapDomains(cluster.migrator);
        ordner = await neuerOrdner("wikibox-rueck");
        fixture = authFixture(cluster.admin);
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
        welt = baueWelt(cluster, app, fixture, ordner.pfad);
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await ordner?.weg();
        await cluster?.stop();
    }, 60_000);

    it("🔴 Zuweisen zurücknehmen: der Artikel von vorher samt Herkunft der Zuordnung (der Import behält sie), Tafel X2 und Revision; eine Operation `wikibox.restore_series` mit Verknüpfung; kein Auftrag", async () => {
        await neueWelt(legeOrteAn);
        const editor = await welt.jemand("editor");
        const zuvor = await ortZuordnung(ID.fasar);
        expect(zuvor).toMatchObject({ key: "fasar", origin: "legacy_editor", system: "legacy" });
        const op = await zuweisen(editor.cookie, "ort", ID.fasar, "havena");
        expect(await ortZuordnung(ID.fasar)).toMatchObject({ key: "havena", origin: "editor", system: "avesmaps3d" });
        const revisionNachSchritt = await revisionOrt(ID.fasar);

        // Der Schritt ist ein Einzeleintrag: nie Mitglied einer Serie, in der Liste rücknehmbar.
        expect(koenntMitgliedSein({ source: "editor", personId: editor.id, action: "wikibox.zuweisen" })).toBe(false);
        expect(koenntMitgliedSein({ source: "editor", personId: editor.id, action: "wikibox.entfernen" })).toBe(false);
        const vor = await vorschau(editor.cookie, "ort", ID.fasar, [op]);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.mitglieder[0]!.series).toBeUndefined();
        expect(vor.folgen).toEqual({ gegenstaende: 1, gelaende: "keines" });
        expect((await eintrag(editor.id, op)).status).toBe("ruecknehmbar");
        const auftraege = Number((await wert<{ n: string }>(`SELECT count(*)::text AS n FROM job`))[0]!.n);

        const rueck = randomUUID();
        const ok = await ruecknehmen(editor.cookie, "ort", ID.fasar, koerper([op], { operationId: rueck }));
        expect(ok.statusCode, ok.body).toBe(200);
        const quittung = ok.json() as RuecknahmeReceipt;
        expect(quittung).toMatchObject({ status: "applied", operationId: rueck, reverts: [op] });
        // Kein Auftrag: Was die Naht als Ableitung meldet, ist erledigt (wie vorwärts).
        expect(quittung.derivedWork.every((arbeit) => arbeit.state === "done")).toBe(true);
        expect(quittung.affected).toMatchObject([{ kind: "place", id: ID.fasar }]);
        // Artikel und Herkunft von vorher, Tafel X2 wieder auf dem Artikel; die Revision zählt einmal.
        expect(await ortZuordnung(ID.fasar)).toMatchObject({
            key: "fasar",
            origin: "legacy_editor",
            system: "legacy",
            x2: "wiki:fasar",
        });
        expect(await revisionOrt(ID.fasar)).toBe(revisionNachSchritt + 1);
        expect(Number((await wert<{ n: string }>(`SELECT count(*)::text AS n FROM job`))[0]!.n)).toBe(auftraege);
        expect(await wert(`SELECT action, source FROM map_operation WHERE operation_id = '${rueck}'`)).toEqual([
            { action: "wikibox.restore_series", source: "restore" },
        ]);
        expect(await wert(`SELECT action, changes FROM map_audit_event WHERE operation_id = '${rueck}'`)).toEqual([
            {
                action: "place.wiki_zugewiesen",
                changes: {
                    wiki: { before: "havena", after: "fasar" },
                    zuordnung: {
                        before: { zustand: "assigned", herkunft: "editor", system: "avesmaps3d" },
                        after: { zustand: "assigned", herkunft: "legacy_editor", system: "legacy" },
                    },
                },
            },
        ]);
        expect((await eintrag(editor.id, op)).status).toBe("bereits_zurueckgenommen");
        expect((await eintrag(editor.id, op)).revertedBy).toMatchObject({ operationId: rueck });
        expect((await eintrag(editor.id, rueck)).status).toBe("ruecknehmbar");

        // Dieselbe Kennung: dieselbe Quittung; eine neue Kennung für dieselbe Liste: nie ein Doppel.
        const nochmal = await ruecknehmen(editor.cookie, "ort", ID.fasar, koerper([op], { operationId: rueck }));
        expect(nochmal.json()).toMatchObject({ status: "replayed", operationId: rueck });
        const doppelt = await ruecknehmen(editor.cookie, "ort", ID.fasar, koerper([op]));
        expect(doppelt.statusCode).toBe(409);
        expect(doppelt.json()).toMatchObject({ error: { code: "already_reverted" } });

        // Die Rücknahme der Rücknahme führt auf den Stand nach dem Schritt zurück (Artikel und Herkunft).
        const beleben = await ruecknehmen(editor.cookie, "ort", ID.fasar, koerper([rueck]));
        expect(beleben.statusCode, beleben.body).toBe(200);
        expect(await ortZuordnung(ID.fasar)).toMatchObject({
            key: "havena",
            origin: "editor",
            system: "avesmaps3d",
            x2: "wiki:havena",
        });
        expect((await eintrag(editor.id, op)).status).toBe("ruecknehmbar");
    });

    it("🔴 Entfernen zurücknehmen: der Artikel kommt zurück (samt Herkunft); die Felder, die das Entfernen zu eigenen machte, bleiben eigene (Grenze, Werte gehen nie verloren)", async () => {
        await neueWelt(legeOrteAn);
        const editor = await welt.jemand("editor");
        const op = await entfernen(editor.cookie, "ort", ID.gareth);
        expect(await ortZuordnung(ID.gareth)).toMatchObject({ key: null, state: "separated", origin: "editor" });
        const einwohner = await wert(
            `SELECT einwohner, einwohner_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.gareth}'`,
        );

        const ok = await ruecknehmen(editor.cookie, "ort", ID.gareth, koerper([op]));
        expect(ok.statusCode, ok.body).toBe(200);
        expect(await ortZuordnung(ID.gareth)).toMatchObject({
            key: "gareth",
            state: "assigned",
            origin: "legacy_editor",
            system: "legacy",
            x2: "wiki:gareth",
        });
        // Die Felder behalten ihre Werte; der Vermerk „wiki“ bleibt „manual“ (das Protokoll kennt die frühere Herkunft je Feld nicht).
        expect(
            await wert(
                `SELECT einwohner, einwohner_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = '${ID.gareth}'`,
            ),
        ).toEqual(einwohner);
        expect(
            await wert(
                `SELECT origin FROM field_origin WHERE object_kind = 'place' AND object_id = '${ID.gareth}' AND field = 'name'`,
            ),
        ).toEqual([{ origin: "manual" }]);
    });

    it("🔴 streng: ein späterer Schritt am Träger (auch von einer anderen Person) hält die Rücknahme an; erst dessen Rücknahme macht den Weg frei, von hinten", async () => {
        await neueWelt(legeOrteAn);
        const anna = await welt.jemand("editor");
        const bernd = await welt.jemand("editor");
        const eins = await zuweisen(anna.cookie, "ort", ID.fasar, "havena");
        const zwei = await zuweisen(bernd.cookie, "ort", ID.fasar, "ludoo");
        const stand = await ortZuordnung(ID.fasar);
        const vor = await vorschau(anna.cookie, "ort", ID.fasar, [eins]);
        expect(vor.ergebnis).toBe("edit_conflict");
        expect(vor.konflikte.map((k) => k.art)).toContain("spaeter");
        const abgelehnt = await ruecknehmen(anna.cookie, "ort", ID.fasar, koerper([eins]));
        expect(abgelehnt.statusCode).toBe(409);
        expect(abgelehnt.json()).toMatchObject({ error: { code: "edit_conflict" } });
        expect(await ortZuordnung(ID.fasar)).toEqual(stand);

        // Bernds Schritt zuerst (eine andere Person: Pflichtgrund), dann Annas.
        const ohneGrund = await ruecknehmen(anna.cookie, "ort", ID.fasar, koerper([zwei]));
        expect(ohneGrund.statusCode).toBe(400);
        expect(ohneGrund.json()).toMatchObject({ error: { code: "reason_required" } });
        const rueckZwei = randomUUID();
        const mitGrund = await ruecknehmen(
            anna.cookie,
            "ort",
            ID.fasar,
            koerper([zwei], { operationId: rueckZwei, reason: "Falscher Artikel" }),
        );
        expect(mitGrund.statusCode, mitGrund.body).toBe(200);
        expect((await eintrag(anna.id, rueckZwei)).reason).toBe("Falscher Artikel");
        expect(await ortZuordnung(ID.fasar)).toMatchObject({ key: "havena" });
        const dann = await ruecknehmen(anna.cookie, "ort", ID.fasar, koerper([eins]));
        expect(dann.statusCode, dann.body).toBe(200);
        expect(await ortZuordnung(ID.fasar)).toMatchObject({ key: "fasar", origin: "legacy_editor" });
    });

    it("🔴 ohne das Recht edit_map_objects 403 (Reviewer liest die Vorprüfung, nimmt nicht zurück), ohne Anmeldung 401; ein Objekt, das es nicht gibt, 404; Besucher sehen nichts", async () => {
        await neueWelt(legeOrteAn);
        const editor = await welt.jemand("editor");
        const reviewer = await welt.jemand("reviewer");
        const op = await zuweisen(editor.cookie, "ort", ID.fasar, "havena");
        const lesen = await vorschau(reviewer.cookie, "ort", ID.fasar, [op]);
        expect(lesen.ergebnis).toBe("forbidden");
        expect(lesen.fehlendeRechte).toEqual(["edit_map_objects"]);
        expect((await ruecknehmen(reviewer.cookie, "ort", ID.fasar, koerper([op]))).statusCode).toBe(403);
        expect(
            (await welt.post(editorWikiBoxRestoreSeriesUrl("ort", ID.fasar), undefined, koerper([op]))).statusCode,
        ).toBe(401);
        expect((await ruecknehmen(editor.cookie, "ort", randomUUID(), koerper([op]))).statusCode).toBe(404);
        // Ein Schritt eines anderen Objekts gehört nicht zu dieser Route.
        const andere = await zuweisen(editor.cookie, "ort", ID.havena, "fasar");
        const fremd = await ruecknehmen(editor.cookie, "ort", ID.fasar, koerper([andere]));
        expect(fremd.statusCode).toBe(400);
        expect(fremd.json()).toMatchObject({ error: { code: "invalid_members" } });
    });

    it("🔴 ehrlich abgelehnt: War der Artikel vorher nur eine Adresse ohne Wiki-Stand, lässt er sich nicht zuweisen (Konflikt wikibox_artikel), nichts wird geschrieben", async () => {
        await neueWelt(legeOrteAn);
        const editor = await welt.jemand("editor");
        // Selem trägt nur eine Adresse (address_only): Der Schlüssel von vorher ist der Seitenanteil der Adresse, ohne Wiki-Stand.
        const op = await zuweisen(editor.cookie, "ort", ID.selem, "havena");
        const stand = await ortZuordnung(ID.selem);
        const vor = await vorschau(editor.cookie, "ort", ID.selem, [op]);
        expect(vor.ergebnis).toBe("edit_conflict");
        const konflikt = vor.konflikte.find((k) => k.art === "wert");
        expect(konflikt?.abweichung?.was).toBe("wikibox_artikel");
        expect(konflikt?.felder).toEqual(["wiki"]);
        const operationen = Number((await wert<{ n: string }>(`SELECT count(*)::text AS n FROM map_operation`))[0]!.n);
        const abgelehnt = await ruecknehmen(editor.cookie, "ort", ID.selem, koerper([op]));
        expect(abgelehnt.statusCode).toBe(409);
        expect(await ortZuordnung(ID.selem)).toEqual(stand);
        expect(Number((await wert<{ n: string }>(`SELECT count(*)::text AS n FROM map_operation`))[0]!.n)).toBe(
            operationen,
        );

        // Gibt es den Wiki-Stand des Artikels von vorher nicht mehr, gilt dasselbe.
        const op2 = await zuweisen(editor.cookie, "ort", ID.gareth, "havena");
        await admin()`UPDATE wiki_settlement_snapshot SET is_active = FALSE, retired_at = now(), retired_origin = 'import' WHERE wiki_key = 'gareth'`;
        const weg = await vorschau(editor.cookie, "ort", ID.gareth, [op2]);
        expect(weg.ergebnis).toBe("edit_conflict");
        expect(weg.konflikte.find((k) => k.art === "wert")?.abweichung?.was).toBe("wikibox_artikel");
    });

    it("🔴 Weg: Die Rücknahme gilt der ganzen Straße (alle Abschnitte, ein Eintrag je Abschnitt); hing der Artikel von vorher nur an einem Teil der Abschnitte, kommt genau dieser Stand zurück (OPS-000112); ein Eintrag ohne ihn bleibt ein Konflikt (wikibox_teilweise)", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const alt = [ID.altA1, ID.altA2, ID.altA3];
        const op = await zuweisen(editor.cookie, "weg", ID.altA2, "mittelpfad");
        const vor = await vorschau(editor.cookie, "weg", ID.altA1, [op]);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.folgen).toEqual({ gegenstaende: 3, gelaende: "keines" });
        const ok = await ruecknehmen(editor.cookie, "weg", ID.altA3, koerper([op]));
        expect(ok.statusCode, ok.body).toBe(200);
        expect((ok.json() as RuecknahmeReceipt).affected.map((a) => a.id).sort()).toEqual([...alt].sort());
        expect(
            await wert(
                `SELECT s.wiki_key, w.assignment_origin, w.source_system FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                   JOIN wiki_path_snapshot s ON s.id = w.snapshot_id WHERE p.public_id = ANY(ARRAY['${alt.join("','")}']::uuid[]) AND w.is_active AND w.role = 'main'`,
            ),
        ).toEqual(
            alt.map(() => ({
                wiki_key: "reichsstrasse-1",
                assignment_origin: "legacy_editor",
                source_system: "legacy",
            })),
        );
        expect(
            await wert(
                `SELECT count(*)::int AS n FROM wiki_key_assignment WHERE legacy_art = 'weg' AND is_active AND wiki_key = 'wiki:reichsstrasse-1' AND object_public_id = ANY(ARRAY['${alt.join("','")}']::uuid[])`,
            ),
        ).toEqual([{ n: 3 }]);

        // Mittelpfad-alt: nur Q1 hängt am Artikel. Ein anderer Artikel an die ganze Straße und zurück: Q1 trägt wieder den Mittelpfad mit der Herkunft von vorher, Q2 wieder keinen (OPS-000112).
        await spiegleX2();
        const mitteVorher = await wegZuordnung(MITTE);
        const teil = await zuweisen(editor.cookie, "weg", ID.mitteQ1, "reichsstrasse-1");
        expect((await vorschau(editor.cookie, "weg", ID.mitteQ2, [teil])).ergebnis).toBe("ok");
        const teilZurueck = await ruecknehmen(editor.cookie, "weg", ID.mitteQ2, koerper([teil]));
        expect(teilZurueck.statusCode, teilZurueck.body).toBe(200);
        expect(await wegZuordnung(MITTE)).toEqual(mitteVorher);

        // Ein Eintrag aus der Zeit vor OPS-000112 trägt den Stand je Abschnitt nicht: Dann bleibt es beim Konflikt, und nichts wird geschrieben.
        const ohneStand = await zuweisen(editor.cookie, "weg", ID.mitteQ1, "reichsstrasse-1");
        await admin()`UPDATE map_audit_event SET changes = changes - 'wikiOrigin' WHERE operation_id = ${ohneStand}::uuid`;
        const ohneStandVor = await vorschau(editor.cookie, "weg", ID.mitteQ2, [ohneStand]);
        expect(ohneStandVor.ergebnis).toBe("edit_conflict");
        expect(ohneStandVor.konflikte.find((k) => k.art === "wert")?.abweichung?.was).toBe("wikibox_teilweise");
        expect((await ruecknehmen(editor.cookie, "weg", ID.mitteQ1, koerper([ohneStand]))).statusCode).toBe(409);
    });

    it("🔴 Weg, „An alle Abschnitte“ (OPS-000112): Derselbe Artikel an die ganze Straße geht ganz zurück, auch die still gelegte weitere Zuordnung; die Rücknahme der Rücknahme gibt ihn wieder allen; Lösen an einem Teil geht genau dort zurück", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        // Q2 trägt den Mittelpfad als weiteren Straßennamen: Das Zuweisen legt diese Zeile still, die Rücknahme muss sie wieder beleben.
        await admin()`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, 'further', s.wiki_url, s.id, 'assigned', 'legacy_editor' FROM path p, wiki_path_snapshot s
             WHERE p.public_id = ${ID.mitteQ2} AND s.wiki_key = 'mittelpfad'
        `;
        await spiegleX2();
        const vorher = await wegZuordnung(MITTE);
        expect((await wegAnschluss.lies(admin(), ID.mitteQ1))?.anteil).toEqual({ mit: 1, von: 2 });

        const anAlle = await zuweisen(editor.cookie, "weg", ID.mitteQ1, "mittelpfad");
        expect((await wegAnschluss.lies(admin(), ID.mitteQ1))?.anteil).toBeUndefined();
        const nachAnAlle = await wegZuordnung(MITTE);
        expect((await vorschau(editor.cookie, "weg", ID.mitteQ2, [anAlle])).ergebnis).toBe("ok");
        const rueck = randomUUID();
        const zurueck = await ruecknehmen(editor.cookie, "weg", ID.mitteQ2, koerper([anAlle], { operationId: rueck }));
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await wegZuordnung(MITTE)).toEqual(vorher);
        expect((await wegAnschluss.lies(admin(), ID.mitteQ1))?.anteil).toEqual({ mit: 1, von: 2 });

        // Die Rücknahme der Rücknahme führt auf den Stand nach dem Schritt: der Artikel an beiden Abschnitten, die weitere Zeile an Q2 wieder still.
        const beleben = await ruecknehmen(editor.cookie, "weg", ID.mitteQ1, koerper([rueck]));
        expect(beleben.statusCode, beleben.body).toBe(200);
        expect(await wegZuordnung(MITTE)).toEqual(nachAnAlle);

        // Lösen an einer Straße, an der der Artikel nur an einem Teil hängt: Zurück kommt er genau dort.
        await neueWelt(legeWegeAn);
        await spiegleX2();
        const teilweise = await wegZuordnung(MITTE);
        const loesen = await entfernen(editor.cookie, "weg", ID.mitteQ2);
        expect((await wegAnschluss.lies(admin(), ID.mitteQ1))?.artikel).toBeNull();
        expect((await vorschau(editor.cookie, "weg", ID.mitteQ1, [loesen])).ergebnis).toBe("ok");
        const loesenZurueck = await ruecknehmen(editor.cookie, "weg", ID.mitteQ1, koerper([loesen]));
        expect(loesenZurueck.statusCode, loesenZurueck.body).toBe(200);
        // Das Lösen machte den Vermerk „wiki“ am Namen zu „manual“; das hält das Protokoll nicht fest (Grenze im Kopf von `ruecknahme-wikibox.ts`).
        expect(await wegZuordnung(MITTE)).toEqual(
            teilweise.map((zeile) => (zeile.name_origin === "wiki" ? { ...zeile, name_origin: "manual" } : zeile)),
        );
    });

    it("🔴 Weg, weitere Artikel (WI-0300): Lösen und Hinzufügen gehen zurück, genau an den Zeilen des Schritts und mit der Herkunft von vorher, auch an einem Teil der Abschnitte", async () => {
        await neueWelt(legeWegeAn);
        const editor = await welt.jemand("editor");
        const alt = [ID.altA1, ID.altA2, ID.altA3];
        const zeilen = async (ids: readonly string[], key: string) =>
            wert(
                `SELECT p.public_id::text AS id, w.assignment_origin, w.source_system FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                   JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                  WHERE p.public_id = ANY(ARRAY['${ids.join("','")}']::uuid[]) AND w.is_active AND w.role = 'further' AND s.wiki_key = '${key}' ORDER BY p.public_id`,
            );

        // Lösen zurücknehmen: Der weitere Artikel des Zweiten Wegs (aus dem Import) kommt mit seiner Herkunft zurück.
        const geloest = await weitere(editor.id, "entfernen", ID.zwei, "weiterer-weg");
        expect(await zeilen([ID.zwei], "weiterer-weg")).toEqual([]);
        const vor = await vorschau(editor.cookie, "weg", ID.zwei, [geloest]);
        expect(vor.ergebnis).toBe("ok");
        const zurueck = await ruecknehmen(editor.cookie, "weg", ID.zwei, koerper([geloest]));
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await zeilen([ID.zwei], "weiterer-weg")).toEqual([
            { id: ID.zwei, assignment_origin: "legacy_editor", source_system: "legacy" },
        ]);
        // Die Rücknahme steht selbst im Verlauf, mit dem weiteren Artikel.
        expect(
            await wert(
                `SELECT e.action, e.changes->'wikiWeitere' AS weiter FROM map_audit_event e JOIN map_operation o ON o.operation_id = e.operation_id
                  WHERE o.action = 'wikibox.restore_series' AND e.path_public_id = '${ID.zwei}'`,
            ),
        ).toEqual([{ action: "path.wiki_weitere_zugewiesen", weiter: { before: null, after: "weiterer-weg" } }]);

        // Hinzufügen zurücknehmen: an allen Abschnitten wieder gelöst, der Hauptartikel bleibt.
        const neu = await weitere(editor.id, "zuweisen", ID.altA2, "mittelpfad");
        expect(await zeilen(alt, "mittelpfad")).toHaveLength(3);
        const weg = await ruecknehmen(editor.cookie, "weg", ID.altA1, koerper([neu]));
        expect(weg.statusCode, weg.body).toBe(200);
        expect(await zeilen(alt, "mittelpfad")).toEqual([]);
        expect(
            await wert(
                `SELECT count(*)::int AS n FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                  WHERE p.public_id = ANY(ARRAY['${alt.join("','")}']::uuid[]) AND w.is_active AND w.role = 'main'`,
            ),
        ).toEqual([{ n: 3 }]);

        // Ein weiterer Artikel an einem Teil der Abschnitte (der Normalfall, Stage: Bärenpfad an 3 von 27 Abschnitten der Reichsstraße 1): Die Rücknahme trifft genau die Zeilen des Schritts.
        await wert(
            `INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
             SELECT p.id, 'further', 'https://de.wiki-aventurica.de/wiki/Neuer_Weg', (SELECT id FROM wiki_path_snapshot WHERE wiki_key = 'neuer-weg'), 'assigned', 'legacy_editor'
               FROM path p WHERE p.public_id = '${ID.altA1}'`,
        );
        // Ergänzen an den zwei übrigen Abschnitten und zurück: Nur diese zwei gehen, der eine aus dem Import bleibt.
        const ergaenzt = await weitere(editor.id, "zuweisen", ID.altA3, "neuer-weg");
        expect(await zeilen(alt, "neuer-weg")).toHaveLength(3);
        expect((await vorschau(editor.cookie, "weg", ID.altA2, [ergaenzt])).ergebnis).toBe("ok");
        const ergaenztZurueck = await ruecknehmen(editor.cookie, "weg", ID.altA2, koerper([ergaenzt]));
        expect(ergaenztZurueck.statusCode, ergaenztZurueck.body).toBe(200);
        expect(await zeilen(alt, "neuer-weg")).toEqual([
            { id: ID.altA1, assignment_origin: "legacy_editor", source_system: "legacy" },
        ]);
        // Lösen an dem einen Abschnitt und zurück: Er kommt genau dort wieder, mit seiner Herkunft.
        const teilGeloest = await weitere(editor.id, "entfernen", ID.altA2, "neuer-weg");
        expect(await zeilen(alt, "neuer-weg")).toEqual([]);
        const teilZurueck = await ruecknehmen(editor.cookie, "weg", ID.altA3, koerper([teilGeloest]));
        expect(teilZurueck.statusCode, teilZurueck.body).toBe(200);
        expect(await zeilen(alt, "neuer-weg")).toEqual([
            { id: ID.altA1, assignment_origin: "legacy_editor", source_system: "legacy" },
        ]);

        // Hängt der Artikel inzwischen wieder am Abschnitt, ist die Rücknahme des Lösens ein Konflikt; nichts wird geschrieben.
        const nochmal = await weitere(editor.id, "entfernen", ID.altA1, "neuer-weg");
        await weitere(editor.id, "zuweisen", ID.altA1, "neuer-weg");
        const konflikt = await vorschau(editor.cookie, "weg", ID.altA1, [nochmal]);
        expect(konflikt.ergebnis).not.toBe("ok");
        expect(await zeilen(alt, "neuer-weg")).toHaveLength(3);
    });

    it("🔴 Gebiet: Schlüssel und Adresse an der Zeile selbst (ohne Herkunft der Zuordnung); Zuweisen und Entfernen gehen zurück, das Entfernen auch als Rücknahme der Rücknahme", async () => {
        await neueWelt(legeGebieteAn);
        const editor = await welt.jemand("editor");
        const op = await zuweisen(editor.cookie, "gebiet", ID.weiden, "wiki:kosch");
        const schluessel = async () =>
            (
                await wert<{ wiki_key: string | null }>(
                    `SELECT wiki_key FROM territory WHERE public_id = '${ID.weiden}'`,
                )
            )[0]!.wiki_key;
        expect(await schluessel()).toBe("wiki:kosch");
        const rueck = randomUUID();
        expect(
            (await ruecknehmen(editor.cookie, "gebiet", ID.weiden, koerper([op], { operationId: rueck }))).statusCode,
        ).toBe(200);
        expect(await schluessel()).toBe("wiki:herzogtum-weiden");
        // Entfernen und zurück.
        const weg = await entfernen(editor.cookie, "gebiet", ID.weiden);
        expect(await schluessel()).toBeNull();
        expect((await ruecknehmen(editor.cookie, "gebiet", ID.weiden, koerper([weg]))).statusCode).toBe(200);
        expect(await schluessel()).toBe("wiki:herzogtum-weiden");
        // Das Entfernen und seine Rücknahme heben einander auf: Die Rücknahme der Rücknahme des Zuweisens ist möglich und führt auf den Artikel nach dem Schritt zurück.
        const dazwischen = await vorschau(editor.cookie, "gebiet", ID.weiden, [rueck]);
        expect(dazwischen.ergebnis).toBe("ok");
        expect((await ruecknehmen(editor.cookie, "gebiet", ID.weiden, koerper([rueck]))).statusCode).toBe(200);
        expect(await schluessel()).toBe("wiki:kosch");
    });
});
