import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_POWERLINES_SAMMEL_STAND_URL,
    EDITOR_POWERLINES_SAMMEL_WIKI_URL,
    EDITOR_NODICES_URL,
    EDITOR_POWERLINES_URL,
    editorNodixMoveUrl,
    editorNodixRestoreSeriesPreviewUrl,
    editorNodixRestoreSeriesUrl,
    editorNodixRetireUrl,
    editorPowerlineRestoreSeriesPreviewUrl,
    editorPowerlineRestoreSeriesUrl,
    editorPowerlineRestoreUrl,
    editorPowerlineRetireUrl,
    editorPowerlineTakeOffMapUrl,
    editorPowerlineUpdateUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { ruecknehmenKraftlinie, vorschauKraftlinie } from "../src/editor/ruecknahme-kraftlinie.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Kraftlinien zurücknehmen (WI-0265 B6b, Anlegen und Kraftlinienpunkt B8b; Fachvertrag C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4, U6, U8, U9): `POST /api/editor/powerlines/:id/restore-series[/preview]` durch Fastify,
 * als App-Rolle im Wegwerf-Cluster mit den Rollen des VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Die Felder einer Serie (Name, Beschriftung, Beschreibung, Bogen, Ende) gehen nur teilweise zurück; ein angefügter Abschnitt bleibt stehen, ein herausgenommener kommt nicht
 * zurück; Abnehmen und Entfernen kehren sich nicht um; eine Operation über zwei Linien kommt für die eine zurück und lässt die andere stehen (stille Teilrücknahme); eine Fremdänderung an der
 * zweiten Linie bleibt unbemerkt; ein Name, der dem Wiki folgte, kommt als eigener Wert zurück; eine fremde Person wird ohne Grund zurückgenommen; eine fremde Sperre, ein fehlendes Recht oder
 * eine Linie, die gar nicht zur Route gehört, hält die Rücknahme nicht auf.
 */

const ENV = "ruecknahmelinie";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b6b";

const ID = (n: number): string => `b6b70265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Ein Abschnitt (`n`) und ein Kraftlinienpunkt (`n`). */
const abschnitt = (n: number): string => ID(n);
const punkt = (n: number): string => ID(n + 0x100);

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Kraftlinien zurücknehmen (WI-0265 B6b, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna = { id: "", cookie: "" };
    let bernd = { id: "", cookie: "" };
    let rita = { id: "", cookie: "" };
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const kopf = (cookie: string) => ({ cookie, origin: TEST_ORIGIN });

    const sende = (person: { cookie: string }, url: string, payload: Record<string, unknown>): Promise<Antwort> =>
        app.inject({ method: "POST", url, headers: kopf(person.cookie), payload });
    const operationIdVon = (antwort: Antwort): string => (antwort.json() as { operationId: string }).operationId;
    /** Die Abschnitte mit ihrer heutigen Revision: der Stand, den ein Entwurf gesehen hätte. */
    const segmente = async (ns: number[]) =>
        (
            await cluster.admin<{ id: string; revision: number }[]>`
                SELECT public_id::text AS id, revision::int AS revision FROM powerline
                 WHERE public_id = ANY(${ns.map(abschnitt)}::uuid[]) ORDER BY public_id`
        ).map((z) => ({ id: z.id, baseRevision: z.revision }));

    /** „Fertig“ an der Linie, die den Abschnitt `anker` enthält und aus `ns` besteht. */
    const aendere = async (
        person: { cookie: string },
        anker: number,
        ns: number[],
        koerper: Record<string, unknown> = {},
        formen: Record<string, Record<string, unknown>> = {},
    ): Promise<string> => {
        const antwort = await sende(person, editorPowerlineUpdateUrl(abschnitt(anker)), {
            operationId: randomUUID(),
            segments: (await segmente(ns)).map((s) => ({ ...s, ...(formen[s.id] ?? {}) })),
            ...koerper,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const wechsle = async (
        person: { cookie: string },
        url: (anker: string) => string,
        anker: number,
        ns: number[],
    ): Promise<string> => {
        const antwort = await sende(person, url(abschnitt(anker)), {
            operationId: randomUUID(),
            segments: await segmente(ns),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const vorschau = (
        person: { cookie: string },
        n: number,
        members: string[],
        membersHash?: string,
    ): Promise<Antwort> =>
        sende(person, editorPowerlineRestoreSeriesPreviewUrl(abschnitt(n)), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zuruecknehmen = (
        person: { cookie: string },
        n: number,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        sende(person, editorPowerlineRestoreSeriesUrl(abschnitt(n)), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const pruefsumme = async (person: { cookie: string }, n: number, members: string[]): Promise<string> =>
        ((await vorschau(person, n, members)).json() as RuecknahmePruefung).membersHash;
    const serie = async (person: { cookie: string }, n: number) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === abschnitt(n));
    };
    const eintrag = async (person: { cookie: string }, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];
    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);

    /** Was eine scheiternde Rücknahme nie verändern darf: Operationen, Protokoll, Verknüpfungen, Aufträge, Ereignisse und die Abschnitte. */
    const stand = async (ns: number[]) => ({
        operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        auftraege: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job`),
        ereignisse: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
        ),
        abschnitte: await cluster.admin`
            SELECT public_id::text, name, label_visible, description, curve, from_public_id::text AS von, to_public_id::text AS nach,
                   is_active, off_map, revision::text
              FROM powerline WHERE public_id = ANY(${ns.map(abschnitt)}::uuid[]) ORDER BY public_id`,
    });
    const zeile = async (n: number) =>
        (
            await cluster.admin<
                {
                    name: string;
                    label_visible: boolean;
                    description: string | null;
                    curve: number | null;
                    von: string;
                    nach: string;
                    is_active: boolean;
                    off_map: boolean;
                }[]
            >`
                SELECT name, label_visible, description, curve, from_public_id::text AS von, to_public_id::text AS nach, is_active, off_map
                  FROM powerline WHERE public_id = ${abschnitt(n)}::uuid`
        )[0]!;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        // Fünf Kraftlinienpunkte auf einer Linie, jeder 100 weiter.
        for (let i = 1; i <= 5; i++)
            await m`INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system, is_active)
                    VALUES (${punkt(i)}::uuid, ${DOMAIN}, 'junction', ST_SetSRID(ST_MakePoint(${100 * i}, 500), 0), ${SOURCE}, TRUE)`;
        const lege = async (n: number, name: string, von: number, nach: number, label = true) =>
            m`INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
              VALUES (${abschnitt(n)}::uuid, ${DOMAIN}, ${name}, ${label}, ${punkt(von)}::uuid, ${punkt(nach)}::uuid,
                      ST_GeomFromText(${`LINESTRING(${String(100 * von)} 500, ${String(100 * nach)} 500)`}, 0),
                      ST_GeomFromText(${`LINESTRING(${String(100 * von)} 500, ${String(100 * nach)} 500)`}, 0), ${SOURCE})`;
        // 1: ein Abschnitt, die Felder einer Serie; 2–3: eine Linie aus zwei Abschnitten; 4–5: Abschnitte anfügen und herausnehmen; 6–7: Abnehmen und Entfernen;
        // 8–9 und 10–11: zwei Linien in einer Operation; 12: Wiki; 13: Recht, Sperre, Liste; 14: Anlegen (nicht rücknehmbar); 15: Rechte.
        await lege(1, "Rücknahmelinie Eins", 1, 2);
        await lege(2, "Rücknahmelinie Zwei", 1, 2);
        await lege(3, "Rücknahmelinie Zwei", 2, 3);
        await lege(4, "Rücknahmelinie Drei", 1, 2);
        await lege(5, "Rücknahmelinie Drei", 2, 3);
        await lege(6, "Rücknahmelinie Vier", 1, 2);
        await lege(7, "Rücknahmelinie Vier", 2, 3);
        await lege(8, "Rücknahmelinie Fünf", 1, 2);
        await lege(9, "Rücknahmelinie Sechs", 2, 3);
        await lege(10, "Rücknahmelinie Sieben", 1, 2);
        await lege(11, "Rücknahmelinie Acht", 2, 3);
        await lege(12, "Rücknahmelinie Wiki", 1, 2);
        await lege(13, "Rücknahmelinie Recht", 1, 2);
        await lege(15, "Rücknahmelinie Rechte", 1, 2);
        await lege(16, "Rücknahmelinie Sperre", 1, 2);
        await lege(17, "Rücknahmelinie Artikel", 1, 2);
        await lege(18, "Rücknahmelinie Artikel", 2, 3);
        // B8b: 19–20: eine Linie, an die ein Abschnitt angelegt wird; 21: ein Kraftlinienpunkt mit einer Linie daran (Verschieben).
        await lege(19, "Rücknahmelinie Anfügen", 1, 2);
        await lege(20, "Rücknahmelinie Anfügen", 2, 3);
        await m`INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system, is_active)
                VALUES (${punkt(21)}::uuid, ${DOMAIN}, 'junction', ST_SetSRID(ST_MakePoint(150, 600), 0), ${SOURCE}, TRUE)`;
        await m`INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
                VALUES (${abschnitt(21)}::uuid, ${DOMAIN}, 'Rücknahmelinie Knoten', TRUE, ${punkt(21)}::uuid, ${punkt(1)}::uuid,
                        ST_GeomFromText('LINESTRING(150 600, 100 500)', 0), ST_GeomFromText('LINESTRING(150 600, 100 500)', 0), ${SOURCE})`;
        const [artikel] = await m<{ id: string }[]>`
            INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, description, staerke, affinitaet, laenge, regionen)
            VALUES ('rn-b6b-linie', 'https://de.wiki-aventurica.de/wiki/Rn_B6b_Linie', 'Rücknahmelinie Wiki Offiziell', 'Aus dem Wiki.', 'mittel', NULL, '30 Meilen', 'Kosch')
            RETURNING id::text`;
        await m`INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, 'https://de.wiki-aventurica.de/wiki/Rn_B6b_Linie', ${artikel!.id}::bigint, 'assigned', 'unknown'
                  FROM powerline WHERE public_id = ${abschnitt(12)}::uuid`;
        const fixture = authFixture(cluster.admin);
        const person = async (name: string, role: "editor" | "reviewer") => {
            const p = await fixture.person(role, { name });
            return { id: p.id, cookie: (await fixture.session(p.id, { passkeyMinutesAgo: 1 })).cookie };
        };
        anna = await person("Anna", "editor");
        bernd = await person("Bernd", "editor");
        rita = await person("Rita", "reviewer");
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 300_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 Felder und Form: drei „Fertig“ an einem Abschnitt (Name, Beschriftung, Beschreibung, Bogen, Ende) sind eine Serie; Bernd nimmt sie nur mit Grund zurück, alles geht auf den Stand davor in EINER Operation", async () => {
        const a = await aendere(anna, 1, [1], { name: "Rücknahmelinie Eins Neu", labelVisible: false });
        const b = await aendere(anna, 1, [1], { description: "Eine Ader." });
        const c = await aendere(anna, 1, [1], {}, { [abschnitt(1)]: { curve: 12, to: punkt(3) } });
        const s = await serie(anna, 1);
        expect(s).toMatchObject({ size: 3, members: [a, b, c] });
        expect(await zeile(1)).toMatchObject({
            name: "Rücknahmelinie Eins Neu",
            label_visible: false,
            description: "Eine Ader.",
            curve: 12,
            nach: punkt(3),
        });
        const vorher = await stand([1]);

        const pruefung = (await vorschau(bernd, 1, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [a, b, c],
            reasonRequired: true,
            fremdePersonen: [{ name: "Anna" }],
            folgen: { gegenstaende: 1, gelaende: "keines" },
        });
        // Die Vorschau liest nur.
        expect(await stand([1])).toEqual(vorher);
        const ohne = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect(await stand([1])).toEqual(vorher);

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, {
            operationId,
            reason: "Falsche Ader",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { reverts: string[] }).reverts).toEqual([a, b, c]);
        expect(await zeile(1)).toMatchObject({
            name: "Rücknahmelinie Eins",
            label_visible: true,
            description: null,
            curve: null,
            von: punkt(1),
            nach: punkt(2),
            is_active: true,
        });
        // EINE Operation, drei Verknüpfungen, der Grund sichtbar im Eintrag, ein `powerline.updated` für den Abschnitt.
        const nachher = await stand([1]);
        expect(nachher.operationen).toBe(vorher.operationen + 1);
        expect(nachher.verknuepfungen).toBe(vorher.verknuepfungen + 3);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "powerline.restore_series",
            reverts: [a, b, c],
            actor: { name: "Bernd" },
        });
        expect(rueck.objects).toHaveLength(1);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Falsche Ader" });
        expect(Object.keys(rueck.objects[0]!.changes)).toEqual(
            expect.arrayContaining(["name", "labelVisible", "description", "curve", "to"]),
        );
        for (const id of [a, b, c])
            expect(await eintrag(anna, id)).toMatchObject({
                status: "bereits_zurueckgenommen",
                revertedBy: { operationId, reason: "Falsche Ader" },
            });
        // U8: dieselbe Kennung gibt `replayed`, eine andere für dieselbe Liste `already_reverted`, nichts wird noch einmal geschrieben.
        const nochmal = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, {
            operationId,
            reason: "Falsche Ader",
        });
        expect([nochmal.statusCode, nochmal.json().status, nochmal.json().operationId]).toEqual([
            200,
            "replayed",
            operationId,
        ]);
        const andere = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        expect(await stand([1])).toEqual(nachher);
    });

    it("🔴 Eine Linie aus zwei Abschnitten: Name und Beschriftung gehen an ALLEN Abschnitten zurück, einzeln nur die letzte offene Änderung (U4)", async () => {
        const a = await aendere(anna, 2, [2, 3], { name: "Rücknahmelinie Zwei Neu" });
        const b = await aendere(anna, 2, [2, 3], { labelVisible: false });
        expect(await zeile(3)).toMatchObject({ name: "Rücknahmelinie Zwei Neu", label_visible: false });
        // Zwei Abschnitte je Operation sind kein Fall für eine Serie (Mehrscope): beide stehen allein.
        const erste = (await vorschau(anna, 2, [a])).json() as RuecknahmePruefung;
        expect(erste.ergebnis).toBe("edit_conflict");
        expect(erste.konflikte[0]).toMatchObject({ art: "spaeter" });
        const letzte = await zuruecknehmen(anna, 2, [b], await pruefsumme(anna, 2, [b]));
        expect(letzte.statusCode, letzte.body).toBe(200);
        expect(await zeile(2)).toMatchObject({ name: "Rücknahmelinie Zwei Neu", label_visible: true });
        expect(await zeile(3)).toMatchObject({ name: "Rücknahmelinie Zwei Neu", label_visible: true });
        // Danach die davor: Die Rücknahme der letzten hebt ihre Operation auf, die erste ist wieder die letzte offene.
        const erstes = await zuruecknehmen(anna, 2, [a], await pruefsumme(anna, 2, [a]));
        expect(erstes.statusCode, erstes.body).toBe(200);
        expect(await zeile(2)).toMatchObject({ name: "Rücknahmelinie Zwei" });
        expect(await zeile(3)).toMatchObject({ name: "Rücknahmelinie Zwei", label_visible: true });
    });

    it("🔴 Abschnitte: ein angefügter Abschnitt entfällt wieder, ein herausgenommener kommt zurück (mit den Feldern der Linie von heute)", async () => {
        const anfuegen = await sende(anna, editorPowerlineUpdateUrl(abschnitt(4)), {
            operationId: randomUUID(),
            segments: await segmente([4, 5]),
            add: [{ from: punkt(3), to: punkt(4) }],
        });
        expect(anfuegen.statusCode, anfuegen.body).toBe(200);
        const angefuegt = operationIdVon(anfuegen);
        const [neuer] = await cluster.admin<{ id: string }[]>`
            SELECT public_id::text AS id FROM powerline WHERE from_public_id = ${punkt(3)}::uuid AND to_public_id = ${punkt(4)}::uuid`;
        const weg = await zuruecknehmen(anna, 4, [angefuegt], await pruefsumme(anna, 4, [angefuegt]));
        expect(weg.statusCode, weg.body).toBe(200);
        const [entfallen] = await cluster.admin<
            { is_active: boolean }[]
        >`SELECT is_active FROM powerline WHERE public_id = ${neuer!.id}::uuid`;
        expect(entfallen!.is_active).toBe(false);
        expect(await zeile(4)).toMatchObject({ is_active: true });

        // Herausnehmen: Abschnitt 5 entfällt, ↺ holt ihn zurück.
        const herausgenommen = await sende(anna, editorPowerlineUpdateUrl(abschnitt(4)), {
            operationId: randomUUID(),
            segments: (await segmente([4, 5])).map((s) => (s.id === abschnitt(5) ? { ...s, remove: true } : s)),
        });
        expect(herausgenommen.statusCode, herausgenommen.body).toBe(200);
        const op = operationIdVon(herausgenommen);
        expect(await zeile(5)).toMatchObject({ is_active: false });
        const zurueck = await zuruecknehmen(anna, 4, [op], await pruefsumme(anna, 4, [op]));
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await zeile(5)).toMatchObject({ is_active: true, name: "Rücknahmelinie Drei" });
    });

    it("🔴 Stand: Abnehmen und Entfernen kehren sich um (ganz oder gar nicht für die Linie), Zurückholen auf die Karte rechnet die Bahn neu", async () => {
        const abgenommen = await wechsle(anna, editorPowerlineTakeOffMapUrl, 6, [6, 7]);
        expect(await zeile(7)).toMatchObject({ is_active: false, off_map: true });
        const rueck = await zuruecknehmen(anna, 6, [abgenommen], await pruefsumme(anna, 6, [abgenommen]));
        expect(rueck.statusCode, rueck.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: true, off_map: false });
        expect(await zeile(7)).toMatchObject({ is_active: true, off_map: false });
        expect((await eintrag(anna, abgenommen)).status).toBe("bereits_zurueckgenommen");

        const entfernt = await wechsle(anna, editorPowerlineRetireUrl, 6, [6, 7]);
        expect(await zeile(6)).toMatchObject({ is_active: false, off_map: false });
        const zurueckgeholt = await zuruecknehmen(anna, 7, [entfernt], await pruefsumme(anna, 7, [entfernt]));
        expect(zurueckgeholt.statusCode, zurueckgeholt.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: true });
        expect(await zeile(7)).toMatchObject({ is_active: true });
        const protokoll = await eintrag(anna, zurueckgeholt.json().operationId);
        expect(protokoll).toMatchObject({
            source: "restore",
            operation: "powerline.restore_series",
            reverts: [entfernt],
        });
        expect(protokoll.objects.map((o) => o.action)).toEqual(["powerline.restored", "powerline.restored"]);
        // Das Zurückholen selbst lässt sich wieder zurücknehmen (der Gegenwechsel: entfernen).
        const nochEinmal = await zuruecknehmen(
            anna,
            6,
            [zurueckgeholt.json().operationId],
            await pruefsumme(anna, 6, [zurueckgeholt.json().operationId]),
        );
        expect(nochEinmal.statusCode, nochEinmal.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: false, off_map: false });
    });

    it("🔴 Eine Operation über zwei Linien (Mehrfachauswahl) kommt für beide zurück oder für keine; U6: Eine Fremdänderung an der zweiten hält die Rücknahme an, 0 Mutationen", async () => {
        const sammel = async (ns: [number, number]): Promise<string> => {
            const antwort = await sende(anna, EDITOR_POWERLINES_SAMMEL_STAND_URL, {
                operationId: randomUUID(),
                wechsel: "powerline.retire",
                lines: await Promise.all(ns.map(async (n) => ({ anker: abschnitt(n), segments: await segmente([n]) }))),
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            return operationIdVon(antwort);
        };
        const op = await sammel([8, 9]);
        expect(await zeile(8)).toMatchObject({ is_active: false });
        expect(await zeile(9)).toMatchObject({ is_active: false });
        const rueck = await zuruecknehmen(anna, 8, [op], await pruefsumme(anna, 8, [op]));
        expect(rueck.statusCode, rueck.body).toBe(200);
        expect(await zeile(8)).toMatchObject({ is_active: true });
        expect(await zeile(9)).toMatchObject({ is_active: true });

        const zweite = await sammel([10, 11]);
        // Bernd holt die zweite Linie auf direktem Weg zurück (kein ↺): Die Operation steht für sie nicht mehr am Endstand.
        const holen = await sende(bernd, editorPowerlineRestoreUrl(abschnitt(11)), {
            operationId: randomUUID(),
            segments: await segmente([11]),
        });
        expect(holen.statusCode, holen.body).toBe(200);
        const vorher = await stand([10, 11]);
        const pruefung = (await vorschau(anna, 10, [zweite])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "powerline",
                id: abschnitt(11),
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        const antwort = await zuruecknehmen(anna, 10, [zweite], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "powerline", id: abschnitt(11), art: "spaeter" }),
        );
        expect(await stand([10, 11])).toEqual(vorher);
    });

    it("🔴 C.3 Wiki-geführter Name: folgte der Name vorher dem Wiki, kommt er als Wiki-Name zurück", async () => {
        await aendere(anna, 12, [12], { name: { revert: "wiki" } });
        expect(await zeile(12)).toMatchObject({ name: "Rücknahmelinie Wiki Offiziell" });
        const eigen = await aendere(anna, 12, [12], { name: "Eigener Name der Linie" });
        expect(await zeile(12)).toMatchObject({ name: "Eigener Name der Linie" });
        const antwort = await zuruecknehmen(anna, 12, [eigen], await pruefsumme(anna, 12, [eigen]));
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await zeile(12)).toMatchObject({ name: "Rücknahmelinie Wiki Offiziell" });
        // Die Herkunft kommt mit zurück: Das Protokoll sagt, dass der Name wieder dem Wiki folgt.
        const rueck = await eintrag(anna, antwort.json().operationId);
        expect(rueck.objects[0]!.changes["nameOrigin"]).toMatchObject({ before: "manual", after: "wiki" });
    });

    it("🔴 Der Wiki-Artikel der Linie: ↺ löst den zugewiesenen Artikel wieder (an allen Abschnitten) und ordnet einen gelösten wieder zu", async () => {
        const zugeordnet = async () =>
            cluster.admin<{ id: string; aktiv: boolean }[]>`
                SELECT p.public_id::text AS id, w.is_active AS aktiv
                  FROM powerline p JOIN powerline_wiki_assignment w ON w.powerline_id = p.id
                 WHERE p.public_id = ANY(${[abschnitt(17), abschnitt(18)]}::uuid[]) ORDER BY p.public_id`;
        expect(await zugeordnet()).toEqual([]);
        const zuweisen = await aendere(anna, 17, [17, 18], { wiki: { key: "rn-b6b-linie" } });
        expect(await zugeordnet()).toEqual([
            { id: abschnitt(17), aktiv: true },
            { id: abschnitt(18), aktiv: true },
        ]);
        const weg = await zuruecknehmen(anna, 17, [zuweisen], await pruefsumme(anna, 17, [zuweisen]));
        expect(weg.statusCode, weg.body).toBe(200);
        expect((await zugeordnet()).map((z) => z.aktiv)).toEqual([false, false]);
        // Gelöst und wieder zugeordnet: ↺ am Lösen ordnet den Artikel von vorher wieder zu.
        const loesen = await aendere(anna, 17, [17, 18], { wiki: null });
        const zurueck = await zuruecknehmen(anna, 17, [loesen], await pruefsumme(anna, 17, [loesen]));
        expect(zurueck.statusCode, zurueck.body).toBe(200);
    });

    /** Dieselben Wege für einen Abschnitt oder Kraftlinienpunkt, den der Test erst anlegt (die Kennung vergibt der Server). */
    const vorschauId = (person: { cookie: string }, id: string, members: string[], membersHash?: string) =>
        sende(person, editorPowerlineRestoreSeriesPreviewUrl(id), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zuruecknehmenId = (
        person: { cookie: string },
        id: string,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ) =>
        sende(person, editorPowerlineRestoreSeriesUrl(id), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const pruefsummeId = async (person: { cookie: string }, id: string, members: string[]): Promise<string> =>
        ((await vorschauId(person, id, members)).json() as RuecknahmePruefung).membersHash;
    const serieId = async (person: { cookie: string }, id: string) =>
        (
            (
                await app.inject({
                    method: "GET",
                    url: `${EDITOR_CHANGES_URL}?limit=200`,
                    headers: { cookie: person.cookie },
                })
            ).json() as MapHistoryPage
        ).series?.find((s) => s.scope.id === id);
    const abschnittHeute = async (id: string) =>
        (
            await cluster.admin<
                { is_active: boolean; off_map: boolean; name: string; label_visible: boolean; revision: number }[]
            >`
                SELECT is_active, off_map, name, label_visible, revision::int AS revision FROM powerline WHERE public_id = ${id}::uuid`
        )[0]!;
    const legeAn = async (
        person: { cookie: string },
        von: number,
        nach: number,
        name: string,
    ): Promise<{ op: string; id: string }> => {
        const antwort = await sende(person, EDITOR_POWERLINES_URL, {
            operationId: randomUUID(),
            from: punkt(von),
            to: punkt(nach),
            name,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return { op: operationIdVon(antwort), id: (antwort.json() as { publicId: string }).publicId };
    };

    it("🔴 B8b: Anlegen einer Linie (ein Abschnitt für sich) zurücknehmen heißt stilllegen wie „Kraftlinie entfernen“; fremde Person nur mit Grund; replayed, already_reverted; die Rücknahme der Rücknahme holt sie wieder", async () => {
        const { op, id } = await legeAn(anna, 4, 5, "Rücknahmelinie Angelegt");
        expect(await abschnittHeute(id)).toMatchObject({ is_active: true, off_map: false });
        const vorher = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const pruefung = (await vorschauId(bernd, id, [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [op],
            reasonRequired: true,
            fremdePersonen: [{ name: "Anna" }],
        });
        // Die Vorschau liest nur; ohne Grund lehnt die Rücknahme einer fremden Person ab.
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(vorher);
        const ohne = await zuruecknehmenId(bernd, id, [op], pruefung.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect(await abschnittHeute(id)).toMatchObject({ is_active: true });

        const operationId = randomUUID();
        const antwort = await zuruecknehmenId(bernd, id, [op], pruefung.membersHash, {
            operationId,
            reason: "Doppelt angelegt",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await abschnittHeute(id)).toMatchObject({ is_active: false, off_map: false });
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "powerline.restore_series", reverts: [op] });
        expect(rueck.objects.map((o) => [o.kind, o.id, o.action])).toEqual([["powerline", id, "powerline.retired"]]);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Doppelt angelegt" });
        expect(await eintrag(anna, op)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId, reason: "Doppelt angelegt" },
        });
        // U8: dieselbe Kennung gibt `replayed`, eine andere `already_reverted`.
        const nochmal = await zuruecknehmenId(bernd, id, [op], pruefung.membersHash, {
            operationId,
            reason: "Doppelt angelegt",
        });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const andere = await zuruecknehmenId(bernd, id, [op], pruefung.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);

        // Die Rücknahme der Rücknahme holt die Linie wieder (Wechsel des Stands zurück).
        const hash = await pruefsummeId(anna, id, [operationId]);
        const wieder = await zuruecknehmenId(anna, id, [operationId], hash, { reason: "Doch gebraucht" });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await abschnittHeute(id)).toMatchObject({
            is_active: true,
            off_map: false,
            name: "Rücknahmelinie Angelegt",
        });
    });

    it("🔴 B8b: Ein Abschnitt, der an eine Linie mit anderen anschloss, fällt wieder heraus; die übrigen bleiben. Eine Fremdänderung an der Linie hält die Rücknahme an (409), 0 Mutationen", async () => {
        const { op, id } = await legeAn(anna, 3, 4, "Rücknahmelinie Anfügen");
        expect(await abschnittHeute(id)).toMatchObject({ is_active: true, name: "Rücknahmelinie Anfügen" });
        const antwort = await zuruecknehmenId(anna, id, [op], await pruefsummeId(anna, id, [op]));
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await abschnittHeute(id)).toMatchObject({ is_active: false });
        // Die Linie besteht weiter (Abschnitte 19 und 20 blieben stehen).
        expect(await zeile(19)).toMatchObject({ is_active: true, name: "Rücknahmelinie Anfügen" });
        expect(await zeile(20)).toMatchObject({ is_active: true, name: "Rücknahmelinie Anfügen" });
        const rueck = await eintrag(anna, antwort.json().operationId);
        expect(rueck.objects.map((o) => o.action).sort()).toEqual([
            "powerline.removed",
            "powerline.updated",
            "powerline.updated",
        ]);

        // Konflikt: Bernd benennt die Linie um, nachdem Anna einen Abschnitt angelegt hat.
        const zweiter = await legeAn(anna, 1, 3, "Rücknahmelinie Anfügen");
        const umbenannt = await sende(bernd, editorPowerlineUpdateUrl(abschnitt(19)), {
            operationId: randomUUID(),
            segments: [
                ...(await segmente([19, 20])),
                ...(await cluster.admin<{ id: string; revision: number }[]>`
                        SELECT public_id::text AS id, revision::int AS revision FROM powerline WHERE public_id = ${zweiter.id}::uuid`.then(
                    (z) => z.map((x) => ({ id: x.id, baseRevision: x.revision })),
                )),
            ],
            labelVisible: false,
        });
        expect(umbenannt.statusCode, umbenannt.body).toBe(200);
        const vor = await stand([19, 20]);
        const preflight = (await vorschauId(anna, zweiter.id, [zweiter.op])).json() as RuecknahmePruefung;
        expect(preflight.ergebnis).toBe("edit_conflict");
        expect(preflight.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "powerline",
                id: zweiter.id,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        const abgewiesen = await zuruecknehmenId(anna, zweiter.id, [zweiter.op], preflight.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([19, 20])).toEqual(vor);
        expect(await abschnittHeute(zweiter.id)).toMatchObject({ is_active: true });
    });

    it("🔴 B8b: Eine Serie aus Anlegen und einer Änderung derselben Person geht als Ganzes zurück: Die Linie geht still, die Rücknahme der Rücknahme holt sie mit dem Stand nach der Serie", async () => {
        const { op, id } = await legeAn(anna, 2, 4, "Rücknahmelinie Serie");
        const aenderung = await sende(anna, editorPowerlineUpdateUrl(id), {
            operationId: randomUUID(),
            segments: await cluster.admin<{ id: string; revision: number }[]>`
                    SELECT public_id::text AS id, revision::int AS revision FROM powerline WHERE public_id = ${id}::uuid`.then(
                (z) => z.map((x) => ({ id: x.id, baseRevision: x.revision })),
            ),
            labelVisible: false,
            description: "Eine neue Ader.",
        });
        expect(aenderung.statusCode, aenderung.body).toBe(200);
        const zweite = operationIdVon(aenderung);
        const s = await serieId(anna, id);
        expect(s).toMatchObject({ size: 2, members: [op, zweite] });
        const hash = s!.membersHash;
        const pruefung = (await vorschauId(anna, id, s!.members, hash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op, zweite], reasonRequired: false });
        const operationId = randomUUID();
        const antwort = await zuruecknehmenId(anna, id, s!.members, hash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { reverts: string[] }).reverts).toEqual([op, zweite]);
        expect(await abschnittHeute(id)).toMatchObject({ is_active: false, off_map: false });
        // Wieder: der Stand nach der Serie (ohne Beschriftung), nicht der beim Anlegen.
        const hashRueck = await pruefsummeId(anna, id, [operationId]);
        const wieder = await zuruecknehmenId(anna, id, [operationId], hashRueck);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await abschnittHeute(id)).toMatchObject({ is_active: true, label_visible: false });
        const [beschreibung] = await cluster.admin<
            { description: string | null }[]
        >`SELECT description FROM powerline WHERE public_id = ${id}::uuid`;
        expect(beschreibung!.description).toBe("Eine neue Ader.");
    });

    // --- Der Kraftlinienpunkt (B8b) -------------------------------------------------------------------------------------------

    const nodixVorschau = (person: { cookie: string }, id: string, members: string[], membersHash?: string) =>
        sende(person, editorNodixRestoreSeriesPreviewUrl(id), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const nodixZurueck = (
        person: { cookie: string },
        id: string,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ) =>
        sende(person, editorNodixRestoreSeriesUrl(id), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const nodixHash = async (person: { cookie: string }, id: string, members: string[]) =>
        ((await nodixVorschau(person, id, members)).json() as RuecknahmePruefung).membersHash;
    const nodixHeute = async (id: string) =>
        (
            await cluster.admin<{ is_active: boolean; x: number; y: number; revision: number }[]>`
                SELECT is_active, ST_X(geom) AS x, ST_Y(geom) AS y, revision::int AS revision FROM nodix WHERE public_id = ${id}::uuid`
        )[0]!;
    const nodixAn = async (person: { cookie: string }, x: number, y: number): Promise<{ op: string; id: string }> => {
        const antwort = await sende(person, EDITOR_NODICES_URL, { operationId: randomUUID(), x, y });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return { op: operationIdVon(antwort), id: (antwort.json() as { publicId: string }).publicId };
    };
    const nodixVerschieben = async (person: { cookie: string }, id: string, x: number, y: number): Promise<string> => {
        const antwort = await sende(person, editorNodixMoveUrl(id), {
            operationId: randomUUID(),
            baseRevision: (await nodixHeute(id)).revision,
            x,
            y,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const bahn = async (n: number): Promise<string> =>
        (
            await cluster.admin<
                { form: string }[]
            >`SELECT ST_AsText(drawn_geom) AS form FROM powerline WHERE public_id = ${abschnitt(n)}::uuid`
        )[0]!.form;

    it("🔴 B8b Kraftlinienpunkt anlegen: Zurück heißt stilllegen (fremde Person nur mit Grund), die Rücknahme der Rücknahme holt ihn wieder; replayed und already_reverted", async () => {
        const { op, id } = await nodixAn(anna, 150, 700);
        const vorschau1 = (await nodixVorschau(bernd, id, [op])).json() as RuecknahmePruefung;
        expect(vorschau1).toMatchObject({
            ergebnis: "ok",
            offen: [op],
            reasonRequired: true,
            folgen: { gegenstaende: 1, gelaende: "keines" },
        });
        const ohne = await nodixZurueck(bernd, id, [op], vorschau1.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect(await nodixHeute(id)).toMatchObject({ is_active: true });
        const operationId = randomUUID();
        const antwort = await nodixZurueck(bernd, id, [op], vorschau1.membersHash, {
            operationId,
            reason: "Falscher Punkt",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await nodixHeute(id)).toMatchObject({ is_active: false });
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "nodix.restore_series", reverts: [op] });
        expect(rueck.objects.map((o) => [o.kind, o.action])).toEqual([["nodix", "nodix.retired"]]);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Falscher Punkt" });
        const nochmal = await nodixZurueck(bernd, id, [op], vorschau1.membersHash, {
            operationId,
            reason: "Falscher Punkt",
        });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const andere = await nodixZurueck(bernd, id, [op], vorschau1.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        // Wieder: ein Eintrag `nodix.restored`.
        const wieder = await nodixZurueck(anna, id, [operationId], await nodixHash(anna, id, [operationId]), {
            reason: "Doch gebraucht",
        });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await nodixHeute(id)).toMatchObject({ is_active: true, x: 150, y: 700 });
        expect((await eintrag(anna, wieder.json().operationId)).objects.map((o) => o.action)).toEqual([
            "nodix.restored",
        ]);
    });

    it("🔴 B8b Kraftlinienpunkt anlegen: Endet seither eine Linie an ihm, bleibt er stehen (409, der Abschnitt als Gegenstand), 0 Mutationen", async () => {
        const { op, id } = await nodixAn(anna, 250, 700);
        const angelegt = await sende(bernd, EDITOR_POWERLINES_URL, {
            operationId: randomUUID(),
            from: id,
            to: punkt(1),
            name: "Rücknahmelinie Am Punkt",
        });
        expect(angelegt.statusCode, angelegt.body).toBe(200);
        const abschnittNeu = (angelegt.json() as { publicId: string }).publicId;
        const vor = {
            punkt: await nodixHeute(id),
            operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        };
        const pruefung = (await nodixVorschau(anna, id, [op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "powerline",
                id: abschnittNeu,
                felder: ["from"],
                abweichung: { was: "felder" },
            }),
        );
        const abgewiesen = await nodixZurueck(anna, id, [op], pruefung.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await nodixHeute(id)).toEqual(vor.punkt);
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            vor.operationen,
        );
    });

    it("🔴 B8b Kraftlinienpunkt verschieben: eine Serie von Verschiebungen geht auf die Stelle vor der ersten zurück, die Bahn der Linie an ihm folgt; ein Abschnitt, der seither angelegt wurde, hält sie an", async () => {
        const stelle = await nodixHeute(punkt(21));
        const bahnVorher = await bahn(21);
        const a = await nodixVerschieben(anna, punkt(21), 160, 610);
        const b = await nodixVerschieben(anna, punkt(21), 170, 620);
        expect(await bahn(21)).not.toBe(bahnVorher);
        const s = await serieId(anna, punkt(21));
        expect(s).toMatchObject({ size: 2, members: [a, b], scope: { kind: "nodix" } });

        // Ein neuer Abschnitt am Punkt (Bernd): Das Zurückschieben zöge ihn mit, die Rücknahme bleibt aus.
        const dazu = await sende(bernd, EDITOR_POWERLINES_URL, {
            operationId: randomUUID(),
            from: punkt(21),
            to: punkt(5),
            name: "Rücknahmelinie Dazu",
        });
        expect(dazu.statusCode, dazu.body).toBe(200);
        const gesperrt = (
            await nodixVorschau(anna, punkt(21), s!.members, s!.membersHash)
        ).json() as RuecknahmePruefung;
        expect(gesperrt.ergebnis).toBe("edit_conflict");
        expect(gesperrt.konflikte).toContainEqual(
            expect.objectContaining({ kind: "powerline", id: (dazu.json() as { publicId: string }).publicId }),
        );
        const abgewiesen = await nodixZurueck(anna, punkt(21), s!.members, s!.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await nodixHeute(punkt(21))).toMatchObject({ x: 170, y: 620 });
        // Der Abschnitt wieder weg (Bernd entfernt die Linie), dann geht die Serie.
        const neuerAbschnitt = (dazu.json() as { publicId: string }).publicId;
        const weg = await sende(bernd, editorPowerlineRetireUrl(neuerAbschnitt), {
            operationId: randomUUID(),
            segments: [{ id: neuerAbschnitt, baseRevision: (await abschnittHeute(neuerAbschnitt)).revision }],
        });
        expect(weg.statusCode, weg.body).toBe(200);
        // Der Abschnitt ist still, aber die Serie bleibt wegen der Fremdoperation am Punkt nicht gleich: erst jetzt neu lesen.
        const jetzt = await serieId(anna, punkt(21));
        const pruefung = (
            await nodixVorschau(anna, punkt(21), jetzt!.members, jetzt!.membersHash)
        ).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis, JSON.stringify(pruefung.konflikte)).toBe("ok");
        const antwort = await nodixZurueck(anna, punkt(21), jetzt!.members, jetzt!.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await nodixHeute(punkt(21))).toMatchObject({ x: stelle.x, y: stelle.y });
        expect(await bahn(21)).toBe(bahnVorher);
        expect((antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((w) => w.kind)).toContain(
            "powerline_path",
        );
        // Und noch einmal zurück: Die Rücknahme der Rücknahme schiebt ihn wieder an die Stelle nach der Serie.
        const rueck = antwort.json().operationId as string;
        const wieder = await nodixZurueck(anna, punkt(21), [rueck], await nodixHash(anna, punkt(21), [rueck]));
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await nodixHeute(punkt(21))).toMatchObject({ x: 170, y: 620 });
    });

    it("🔴 B8b Kraftlinienpunkt entfernen: Zurück holt ihn; Recht und Liste: Reviewer 403, ohne Anmeldung 401", async () => {
        const { id } = await nodixAn(anna, 350, 700);
        const entfernt = await sende(anna, editorNodixRetireUrl(id), {
            operationId: randomUUID(),
            baseRevision: (await nodixHeute(id)).revision,
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const op = operationIdVon(entfernt);
        expect(await nodixHeute(id)).toMatchObject({ is_active: false });
        const hash = await nodixHash(anna, id, [op]);
        const verboten = await nodixZurueck(rita, id, [op], hash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorNodixRestoreSeriesUrl(id),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [op], membersHash: hash },
        });
        expect(anonym.statusCode).toBe(401);
        const antwort = await nodixZurueck(anna, id, [op], hash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await nodixHeute(id)).toMatchObject({ is_active: true });
        // Ein unbekannter Punkt ist 404.
        const unbekannt = await nodixVorschau(anna, randomUUID(), [op]);
        expect(unbekannt.statusCode).toBe(404);
    });

    it("🔴 U9: Recht, Sperre und Liste vor jeder Änderung: Reviewer 403, ohne Anmeldung 401, fremde Sperre 409 `object_locked`, fremde Linie in der Liste 400", async () => {
        const a = await aendere(anna, 13, [13], { labelVisible: false });
        const b = await aendere(anna, 13, [13], { description: "Gesperrt." });
        const s = await serie(anna, 13);
        const vorher = await stand([13]);
        expect(((await vorschau(rita, 13, s!.members, s!.membersHash)).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
        const verboten = await zuruecknehmen(rita, 13, s!.members, s!.membersHash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorPowerlineRestoreSeriesUrl(abschnitt(13)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [a, b], membersHash: s!.membersHash },
        });
        expect(anonym.statusCode).toBe(401);
        // Eine Liste, die zu einer anderen Linie gehört, ist nicht von hier.
        const fremd = await zuruecknehmen(anna, 15, s!.members, s!.membersHash);
        expect([fremd.statusCode, fremd.json().error.code]).toEqual([400, "invalid_members"]);

        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('powerline', ${abschnitt(13)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const pruefung = (await vorschau(anna, 13, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
            expect(pruefung.sperren[0]).toMatchObject({
                kind: "powerline",
                id: abschnitt(13),
                person: { name: "Bernd" },
            });
            const gesperrt = await zuruecknehmen(anna, 13, s!.members, s!.membersHash);
            expect([gesperrt.statusCode, gesperrt.json().error.code]).toEqual([409, "object_locked"]);
            expect(gesperrt.json().error.details.lock).toMatchObject({
                kind: "powerline",
                id: abschnitt(13),
                person: { name: "Bernd" },
            });
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${abschnitt(13)}::uuid`;
        }
        expect(await stand([13])).toEqual(vorher);
    });

    it("🔴 R2: jeder Weg, der eine Linie ändert, hält an der Sperre eines anderen an, vor jeder Änderung; die eigene Sperre und eine freie Linie gehen", async () => {
        const vorher = await stand([16]);
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('powerline', ${abschnitt(16)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const basis = await segmente([16]);
            const kennung = (): string => randomUUID();
            const versuche: [string, Antwort][] = [
                [
                    "update",
                    await sende(anna, editorPowerlineUpdateUrl(abschnitt(16)), {
                        operationId: kennung(),
                        segments: basis,
                        labelVisible: false,
                    }),
                ],
                [
                    "take-off-map",
                    await sende(anna, editorPowerlineTakeOffMapUrl(abschnitt(16)), {
                        operationId: kennung(),
                        segments: basis,
                    }),
                ],
                [
                    "retire",
                    await sende(anna, editorPowerlineRetireUrl(abschnitt(16)), {
                        operationId: kennung(),
                        segments: basis,
                    }),
                ],
                [
                    "sammel/stand",
                    await sende(anna, EDITOR_POWERLINES_SAMMEL_STAND_URL, {
                        operationId: kennung(),
                        wechsel: "powerline.retire",
                        lines: [{ anker: abschnitt(16), segments: basis }],
                    }),
                ],
                [
                    "sammel/wiki",
                    await sende(anna, EDITOR_POWERLINES_SAMMEL_WIKI_URL, {
                        operationId: kennung(),
                        felder: ["name"],
                        lines: [{ anker: abschnitt(16), segments: basis }],
                    }),
                ],
            ];
            for (const [name, antwort] of versuche)
                expect([name, antwort.statusCode, antwort.json().error.code], antwort.body).toEqual([
                    name,
                    409,
                    "object_locked",
                ]);
            expect(await stand([16])).toEqual(vorher);
            // Bernd darf unter seiner eigenen Sperre schreiben.
            const eigen = await sende(bernd, editorPowerlineUpdateUrl(abschnitt(16)), {
                operationId: kennung(),
                segments: basis,
                labelVisible: false,
            });
            expect(eigen.statusCode, eigen.body).toBe(200);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${abschnitt(16)}::uuid`;
        }
        // Ohne Sperre geht dieselbe Änderung auch für Anna.
        const frei = await sende(anna, editorPowerlineUpdateUrl(abschnitt(16)), {
            operationId: randomUUID(),
            segments: await segmente([16]),
            labelVisible: true,
        });
        expect(frei.statusCode, frei.body).toBe(200);
    });

    it("🔴 F.1: Felder und Entfernen verlangen das Sachrecht, Bogen, Enden und Abnehmen zusätzlich das Geometrie-Recht; 0 Mutationen", async () => {
        // Rollen ohne `edit_map_geometry` bei `edit_map_objects` gibt es nicht (beide ab Editor): Das Recht wird hier wie von der Route aus der Sitzung abgeleitet, nur frei gewählt.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        const beide: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects", "edit_map_geometry"]),
        };
        const aktor = { kind: "person" as const, personId: bernd.id, environment: "test" as const };
        const felder = await aendere(anna, 15, [15], { labelVisible: false });
        expect((await vorschauKraftlinie(cluster.app, abschnitt(15), { members: [felder] }, nurSache)).ergebnis).toBe(
            "ok",
        );
        const form = await aendere(anna, 15, [15], {}, { [abschnitt(15)]: { curve: 7 } });
        const vorher = await stand([15]);
        const vorschauNurSache = await vorschauKraftlinie(cluster.app, abschnitt(15), { members: [form] }, nurSache);
        expect(vorschauNurSache).toMatchObject({ ergebnis: "forbidden", fehlendeRechte: ["edit_map_geometry"] });
        await expect(
            ruecknehmenKraftlinie(cluster.app, aktor, nurSache, abschnitt(15), {
                operationId: randomUUID(),
                members: [form],
                membersHash: vorschauNurSache.membersHash,
                reason: "Falscher Bogen",
            }),
        ).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
        expect(await stand([15])).toEqual(vorher);
        expect((await vorschauKraftlinie(cluster.app, abschnitt(15), { members: [form] }, beide)).ergebnis).toBe("ok");
        // Abnehmen ist Geometrie, Entfernen nicht.
        const abgenommen = await wechsle(anna, editorPowerlineTakeOffMapUrl, 15, [15]);
        expect(
            (await vorschauKraftlinie(cluster.app, abschnitt(15), { members: [abgenommen] }, nurSache)).ergebnis,
        ).toBe("forbidden");
    });
});
