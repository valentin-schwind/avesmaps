import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_PATHS_URL,
    EDITOR_PLACES_SAMMEL_DELETE_URL,
    EDITOR_PLACES_SAMMEL_URL,
    EDITOR_PLACES_URL,
    editorPlaceDeleteUrl,
    editorPlaceMoveUrl,
    editorPlaceRestoreSeriesPreviewUrl,
    editorPlaceRestoreSeriesUrl,
    editorPlaceRestoreUrl,
    editorPlaceTakeOffMapUrl,
    editorPlaceUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { ruecknehmenOrt, vorschauOrt } from "../src/editor/ruecknahme-ort.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Orte zurücknehmen (WI-0265 B4; Fachvertrag C.2, C.3 „Mehrscope“, F.1; Testvertrag U4, U6, U7, U8, U9, Gate 2) und die Fremdsperre im Einzelweg des Orts (R2): `POST
 * /api/editor/places/:id/restore-series[/preview]` durch Fastify, als App-Rolle im Wegwerf-Cluster mit den Rollen des VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die
 * geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Ein verschobener Ort geht zurück, ein mitgezogenes Wegende bleibt an der neuen Lage (halbe Rücknahme) oder ein Ende an einem Einrastpunkt wird gar nicht gefunden;
 * eine Fremdänderung an einem der Wegenden bleibt unbemerkt; mehrere gelöschte Orte kommen einzeln und teilweise zurück statt zusammen oder gar nicht; die Felder einer Serie
 * (auch Unterirdisch und Ungefähre Lage) gehen nur teilweise zurück; eine fremde Person wird ohne Grund zurückgenommen; ein Einzelweg des Orts schreibt über die Sperre eines anderen
 * hinweg.
 */

const ENV = "ruecknahmeort";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b4";

const ID = (n: number): string => `b4b40265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ort = (n: number): string => ID(n);
const weg = (n: number): string => ID(n + 0x100);

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;
type Punkt = [number, number];

describeWithCluster("Orte zurücknehmen (WI-0265 B4, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
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

    const sende = (
        person: { cookie: string },
        method: "POST" | "PATCH",
        url: string,
        payload: Record<string, unknown>,
    ): Promise<Antwort> => app.inject({ method, url, headers: kopf(person.cookie), payload });
    const revision = async (tabelle: "place" | "path", id: string): Promise<number> =>
        Number(
            (
                await cluster.admin<{ r: string }[]>`
                    SELECT revision::text AS r FROM ${cluster.admin(tabelle)} WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );
    const operationIdVon = (antwort: Antwort): string => (antwort.json() as { operationId: string }).operationId;

    /** „Fertig“ am Ort `n`: `place.update` gegen die heutige Revision. */
    const aendere = async (
        person: { cookie: string },
        n: number,
        changes: Record<string, unknown>,
    ): Promise<string> => {
        const antwort = await sende(person, "PATCH", editorPlaceUrl(ort(n)), {
            operationId: randomUUID(),
            baseRevision: await revision("place", ort(n)),
            changes,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const verschiebe = async (
        person: { cookie: string },
        n: number,
        to: { x: number; y: number },
        enden: { weg: number; end: "start" | "end"; to: { x: number; y: number } }[],
    ): Promise<string> => {
        const antwort = await sende(person, "POST", editorPlaceMoveUrl(ort(n)), {
            operationId: randomUUID(),
            baseRevision: await revision("place", ort(n)),
            to,
            pathEnds: await Promise.all(
                enden.map(async (ende) => ({
                    pathId: weg(ende.weg),
                    end: ende.end,
                    baseRevision: await revision("path", weg(ende.weg)),
                    to: ende.to,
                })),
            ),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const loesche = async (person: { cookie: string }, ns: number[]): Promise<string> => {
        const antwort = await sende(person, "POST", EDITOR_PLACES_SAMMEL_DELETE_URL, {
            operationId: randomUUID(),
            orte: await Promise.all(
                ns.map(async (n) => ({ id: ort(n), baseRevision: await revision("place", ort(n)) })),
            ),
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
        sende(person, "POST", editorPlaceRestoreSeriesPreviewUrl(ort(n)), {
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
        sende(person, "POST", editorPlaceRestoreSeriesUrl(ort(n)), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    /** Die Prüfsumme einer Liste von der Vorschau (die kennt sie für jede Liste). */
    const pruefsumme = async (person: { cookie: string }, n: number, members: string[]): Promise<string> =>
        ((await vorschau(person, n, members)).json() as RuecknahmePruefung).membersHash;
    const serie = async (person: { cookie: string }, n: number) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === ort(n));
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

    /** Was eine scheiternde Rücknahme nie verändern darf: Operationen, Protokoll, Verknüpfungen, Aufträge, Ereignisse, die Orte und Wege. */
    const stand = async (ns: number[], wege: number[] = []) => ({
        operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        auftraege: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job`),
        ereignisse: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
        ),
        orte: await cluster.admin`
            SELECT public_id::text, name, subtype, is_active, is_underground, is_approximate, revision::text, ST_AsText(geom) AS lage
              FROM place WHERE public_id = ANY(${ns.map(ort)}::uuid[]) ORDER BY public_id`,
        wege: await cluster.admin`
            SELECT public_id::text, revision::text, ST_AsText(geom) AS linie FROM path WHERE public_id = ANY(${wege.map(weg)}::uuid[]) ORDER BY public_id`,
    });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const lege = async (n: number, name: string, x: number, y: number) =>
            m`INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
              VALUES (${ort(n)}, ${DOMAIN}, ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), ${SOURCE}, TRUE)`;
        const linie = async (n: number, name: string, ...punkte: Punkt[]) =>
            m`INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
              VALUES (${weg(n)}, ${DOMAIN}, ${name}, 'Weg', TRUE, FALSE,
                      ST_SetSRID(ST_GeomFromText(${`LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`}), 0), ${SOURCE}, TRUE)`;
        // 1: Ort mit vier Wegenden (U7); 2: Ort mit zwei Wegenden für die Fremdänderung.
        await lege(1, "Rücknahmeort Eins", 300, 300);
        await linie(1, "R4 Weg 1", [300, 300], [310, 305], [320, 300]);
        await linie(2, "R4 Weg 2", [280, 320], [290, 310], [300, 300]);
        await linie(3, "R4 Weg 3", [300, 300], [305, 290], [310, 280]);
        await linie(4, "R4 Weg 4", [300, 300], [295, 290], [290, 280]);
        await lege(2, "Rücknahmeort Zwei", 400, 300);
        await linie(5, "R4 Weg 5", [400, 300], [410, 310]);
        await linie(6, "R4 Weg 6", [390, 290], [400, 300]);
        // 3: Felder einer Serie; 4: Sperren (R2); 5–7 und 8–10: „Ganz löschen“ für mehrere; 11: Felder und Löschen zusammen; 12: von der Karte genommen; 13: Sperre der Rücknahme.
        await lege(3, "Rücknahmeort Felder", 420, 420);
        await lege(4, "Rücknahmeort Sperre", 440, 440);
        for (const [n, x] of [
            [5, 500],
            [6, 510],
            [7, 520],
            [8, 530],
            [9, 540],
            [10, 550],
        ] as const)
            await lege(n, `Rücknahmeort Löschen ${String(n)}`, x, 500);
        await lege(11, "Rücknahmeort Mischung", 460, 460);
        await lege(12, "Rücknahmeort Abnehmen", 470, 470);
        await lege(13, "Rücknahmeort Rücknahmesperre", 480, 480);
        // 14: ein Ort mit Wiki-Artikel und eigenem Wert (die Herkunft entscheidet, ob ein Wert als Wiki-Wert zurückkommt).
        // 15: eine Verschiebung samt einem Wegende, für das Recht der Vorwärtsoperation.
        await lege(15, "Rücknahmeort Recht", 600, 300);
        await linie(7, "R4 Weg 7", [600, 300], [610, 310]);
        await lege(14, "Rücknahmeort Wiki", 490, 490);
        const [artikel] = await m<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, einwohner, synced_at)
            VALUES ('rn-b4-wiki', 'https://de.wiki-aventurica.de/wiki/Rn_B4', 'Rn B4', 'Rücknahmeort Wiki', '300', now()) RETURNING id::text`;
        await m`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/Rn_B4', ${artikel!.id}, 'assigned', 'unknown' FROM place WHERE public_id = ${ort(14)}::uuid`;
        await m`
            INSERT INTO place_detail (place_id, einwohner, einwohner_origin) SELECT id, '120', 'manual' FROM place WHERE public_id = ${ort(14)}::uuid`;
        // 31 und 32 (WI-0265 B8a): zwei Orte mit Wiki-Artikel und eigenem Wert für die Mehrfachbearbeitung (↺ auf Wiki-Werte).
        for (const n of [31, 32]) {
            await lege(n, `Rücknahmeort Sammel ${String(n)}`, 800 + n, 400);
            const adresse = `https://de.wiki-aventurica.de/wiki/Rn_B8a_Sammel_${String(n)}`;
            const [sammelArtikel] = await m<{ id: string }[]>`
                INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, einwohner, synced_at)
                VALUES (${`rn-b8a-sammel-${String(n)}`}, ${adresse}, ${`Rn B8a Sammel ${String(n)}`}, ${`Rücknahmeort Sammel ${String(n)}`}, '300', now()) RETURNING id::text`;
            await m`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, ${adresse}, ${sammelArtikel!.id}, 'assigned', 'unknown' FROM place WHERE public_id = ${ort(n)}::uuid`;
            await m`
                INSERT INTO place_detail (place_id, einwohner, einwohner_origin) SELECT id, '120', 'manual' FROM place WHERE public_id = ${ort(n)}::uuid`;
        }
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

    it("🔴 U7: Ort verschoben samt vier Wegenden (eines an einem Einrastpunkt) geht in EINER Operation zurück: der Ort und alle vier Enden an die Lage davor, ein `deriveAfter`", async () => {
        const bewegt = await verschiebe(anna, 1, { x: 305, y: 305 }, [
            { weg: 1, end: "start", to: { x: 305, y: 305 } },
            { weg: 2, end: "end", to: { x: 305, y: 305 } },
            { weg: 3, end: "start", to: { x: 305, y: 305 } },
            // Ein Einrastpunkt: das Ende liegt nach dem Verschieben NICHT am Ort.
            { weg: 4, end: "start", to: { x: 307, y: 303 } },
        ]);
        const nachBewegung = await stand([1], [1, 2, 3, 4]);
        expect(nachBewegung.orte[0]!["lage"]).toBe("POINT(305 305)");
        // Die Vorschau liest nur und nennt die fünf Gegenstände.
        const pruefsum = await pruefsumme(anna, 1, [bewegt]);
        const pruefung = (await vorschau(anna, 1, [bewegt], pruefsum)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [bewegt], reasonRequired: false, konflikte: [] });
        expect(pruefung.gegenstaende.map((g) => g.kind).sort()).toEqual(["path", "path", "path", "path", "place"]);
        expect(await stand([1], [1, 2, 3, 4])).toEqual(nachBewegung);

        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 1, [bewegt], pruefsum, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as {
            reverts: string[];
            derivedWork: { kind: string }[];
            affected: { kind: string }[];
        };
        expect(quittung.reverts).toEqual([bewegt]);
        expect(quittung.affected.map((a) => a.kind).sort()).toEqual(["path", "path", "path", "path", "place"]);
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual(expect.arrayContaining(["path_visual", "routing"]));
        const nachher = await stand([1], [1, 2, 3, 4]);
        expect(nachher.orte[0]!["lage"]).toBe("POINT(300 300)");
        expect(nachher.wege.map((w) => w["linie"])).toEqual([
            "LINESTRING(300 300,310 305,320 300)",
            "LINESTRING(280 320,290 310,300 300)",
            "LINESTRING(300 300,305 290,310 280)",
            "LINESTRING(300 300,295 290,290 280)",
        ]);
        // EINE Operation, EINE Verknüpfung, EIN Ereignis; die Wegeprofile höchstens einmal (nicht je Weg).
        expect(nachher.operationen).toBe(nachBewegung.operationen + 1);
        expect(nachher.verknuepfungen).toBe(nachBewegung.verknuepfungen + 1);
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
            ),
        ).toBe(1);
        expect(
            await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job WHERE kind = 'path_profile'`),
        ).toBeLessThanOrEqual(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "place.restore_series", reverts: [bewegt] });
        expect(rueck.objects.map((o) => o.action).sort()).toEqual([
            "path.endpoint_moved",
            "path.endpoint_moved",
            "path.endpoint_moved",
            "path.endpoint_moved",
            "place.moved",
        ]);
        expect((await eintrag(anna, bewegt)).status).toBe("bereits_zurueckgenommen");
        // U8: dieselbe Kennung gibt `replayed`, eine andere für dieselbe Liste `already_reverted`, nichts wird noch einmal geschrieben.
        const nochmal = await zuruecknehmen(anna, 1, [bewegt], pruefsum, { operationId });
        expect([nochmal.statusCode, nochmal.json().status, nochmal.json().operationId]).toEqual([
            200,
            "replayed",
            operationId,
        ]);
        const andere = await zuruecknehmen(anna, 1, [bewegt], pruefsum);
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        expect(andere.json().error.details.revertedBy).toEqual([{ operationId, at: expect.any(String) }]);
        expect(await stand([1], [1, 2, 3, 4])).toEqual(nachher);
    });

    it("🔴 U6, U7: steht EIN mitgezogenes Wegende nicht mehr am Endstand, geht nichts zurück: 409 mit der Liste der abweichenden Enden, 0 Mutationen, 0 Aufträge", async () => {
        const bewegt = await verschiebe(anna, 2, { x: 405, y: 305 }, [
            { weg: 5, end: "start", to: { x: 405, y: 305 } },
            { weg: 6, end: "end", to: { x: 405, y: 305 } },
        ]);
        // Jemand zieht das Ende von Weg 6 weg (am Rand der Schreibnaht, ohne Eintrag im Protokoll): Der Weg zählt seine Revision.
        await cluster.admin`UPDATE path SET geom = ST_SetPoint(geom, -1, ST_SetSRID(ST_MakePoint(412, 307), 0)) WHERE public_id = ${weg(6)}::uuid`;
        const vorher = await stand([2], [5, 6]);
        const pruefung = (await vorschau(anna, 2, [bewegt])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "path",
                id: weg(6),
                felder: ["end"],
                // Die Lage als Zahlen und der Schlüssel für den Satz; der deutsche Satz bleibt nur Hinweis (WI-0265 B5d).
                abweichung: { was: "weg_ende", heute: { x: 412, y: 307 }, erwartet: { x: 405, y: 305 } },
                detail: expect.stringContaining("(412 | 307)"),
            }),
        );
        // Das andere Ende und der Ort stehen noch dort: Sie stehen nicht in der Liste der abweichenden Enden.
        expect(pruefung.konflikte.filter((k) => k.art === "wert").map((k) => k.id)).toEqual([weg(6)]);
        const antwort = await zuruecknehmen(anna, 2, [bewegt], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({
                kind: "path",
                id: weg(6),
                art: "wert",
                abweichung: expect.objectContaining({ was: "weg_ende" }),
            }),
        );
        expect(await stand([2], [5, 6])).toEqual(vorher);
    });

    it("🔴 Felder: drei „Fertig“ am Ort (Unterirdisch und Ungefähre Lage wie jedes Merkmal) sind eine Serie; Bernd nimmt sie nur mit Grund zurück, alles geht auf den Stand davor", async () => {
        const a = await aendere(anna, 3, { name: "Rücknahmeort Felder Neu", underground: true });
        const b = await aendere(anna, 3, { approximate: true, subtype: "dorf", kind: "Handelsort" });
        const c = await aendere(anna, 3, {
            einwohner: { value: "3000" },
            description: { value: "Ein Ort." },
            ruined: true,
        });
        const s = await serie(anna, 3);
        expect(s).toMatchObject({ size: 3, members: [a, b, c] });
        const vorher = await stand([3]);
        const pruefung = (await vorschau(bernd, 3, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [a, b, c],
            reasonRequired: true,
            fremdePersonen: [{ name: "Anna" }],
        });
        const ohne = await zuruecknehmen(bernd, 3, s!.members, s!.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect(await stand([3])).toEqual(vorher);

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(bernd, 3, s!.members, s!.membersHash, {
            operationId,
            reason: "Falscher Ort",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { reverts: string[] }).reverts).toEqual([a, b, c]);
        const [row] = await cluster.admin<
            {
                name: string;
                subtype: string;
                place_kind: string | null;
                is_underground: boolean;
                is_approximate: boolean;
                is_ruined: boolean;
            }[]
        >`SELECT name, subtype, place_kind, is_underground, is_approximate, is_ruined FROM place WHERE public_id = ${ort(3)}::uuid`;
        expect(row).toEqual({
            name: "Rücknahmeort Felder",
            subtype: "stadt",
            place_kind: null,
            is_underground: false,
            is_approximate: false,
            is_ruined: false,
        });
        const [detail] = await cluster.admin<
            { einwohner: string | null; description: string | null; is_active: boolean }[]
        >`
            SELECT d.einwohner, d.description, d.is_active FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = ${ort(3)}::uuid`;
        expect(detail).toMatchObject({ einwohner: null, description: null });
        // EINE Operation, drei Verknüpfungen, der Grund sichtbar im Eintrag, ein `place.updated` für den Ort.
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "place.restore_series",
            reverts: [a, b, c],
            actor: { name: "Bernd" },
        });
        expect(rueck.objects).toHaveLength(1);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Falscher Ort" });
        expect(Object.keys(rueck.objects[0]!.changes).sort()).toEqual(
            expect.arrayContaining(["approximate", "name", "underground"]),
        );
        for (const id of [a, b, c])
            expect(await eintrag(anna, id)).toMatchObject({
                status: "bereits_zurueckgenommen",
                revertedBy: { operationId },
            });

        // Rücknahme einer Rücknahme MIT Grund (B6a2): Der Grund (`restoreReason`) steht an den Einträgen der Rücknahme, ist aber kein Feld des Orts. Anna nimmt Bernds Rücknahme zurück
        // (fremde Person: Pflichtgrund), und alle Felder stehen wieder, wie sie nach den drei „Fertig“ standen.
        const zweite = (await vorschau(anna, 3, [operationId])).json() as RuecknahmePruefung;
        expect(zweite).toMatchObject({ ergebnis: "ok", offen: [operationId], reasonRequired: true, konflikte: [] });
        const wieder = await zuruecknehmen(anna, 3, [operationId], zweite.membersHash, { reason: "Doch richtig so" });
        expect(wieder.statusCode, wieder.body).toBe(200);
        const [zurueck] = await cluster.admin<
            {
                name: string;
                subtype: string;
                place_kind: string | null;
                is_underground: boolean;
                is_approximate: boolean;
                is_ruined: boolean;
            }[]
        >`SELECT name, subtype, place_kind, is_underground, is_approximate, is_ruined FROM place WHERE public_id = ${ort(3)}::uuid`;
        expect(zurueck).toEqual({
            name: "Rücknahmeort Felder Neu",
            subtype: "dorf",
            place_kind: "Handelsort",
            is_underground: true,
            is_approximate: true,
            is_ruined: true,
        });
        expect((await eintrag(anna, wieder.json().operationId)).reason).toBe("Doch richtig so");
    });

    it("🔴 Wiki-geführte Texte: folgte der Wert vorher dem Wiki, kommt er als Wiki-Wert zurück, sonst als eigener Wert (C.3)", async () => {
        const einwohner = async () =>
            (
                await cluster.admin<{ einwohner: string | null; einwohner_origin: string | null }[]>`
                    SELECT d.einwohner, d.einwohner_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = ${ort(14)}::uuid`
            )[0];
        const eins = await aendere(anna, 14, { einwohner: { revert: "wiki" } });
        const zwei = await aendere(anna, 14, { einwohner: { value: "999" } });
        expect(await einwohner()).toEqual({ einwohner: "999", einwohner_origin: "manual" });
        const s = await serie(anna, 14);
        expect(s!.members).toEqual([eins, zwei]);
        // Das letzte Mitglied allein: Vorher folgte der Wert dem Wiki - er kommt als Wiki-Wert zurück.
        const letztes = await zuruecknehmen(anna, 14, [zwei], await pruefsumme(anna, 14, [zwei]));
        expect(letztes.statusCode, letztes.body).toBe(200);
        expect(await einwohner()).toEqual({ einwohner: "300", einwohner_origin: "wiki" });
        // Das erste: Vorher war es ein eigener Wert - er kommt als eigener Wert zurück.
        const erstes = await zuruecknehmen(anna, 14, s!.members, s!.membersHash);
        expect(erstes.statusCode, erstes.body).toBe(200);
        expect((erstes.json() as { reverts: string[] }).reverts).toEqual([eins]);
        expect(await einwohner()).toEqual({ einwohner: "120", einwohner_origin: "manual" });
    });

    it("🔴 U4: einzeln geht nur das LETZTE offene Mitglied; danach die offenen davor, ohne Grund bei der eigenen Serie", async () => {
        const a = await aendere(anna, 4, { hidden: true });
        const b = await aendere(anna, 4, { seaport: true });
        const c = await aendere(anna, 4, { nodix: true });
        const s = await serie(anna, 4);
        expect(s!.members).toEqual([a, b, c]);
        const vorher = await stand([4]);
        const mittleres = (await vorschau(anna, 4, [b])).json() as RuecknahmePruefung;
        expect(mittleres.ergebnis).toBe("edit_conflict");
        expect(mittleres.konflikte[0]).toMatchObject({
            art: "ueberholt",
            ueberholtDurch: { operationId: c, position: 3 },
        });
        expect((await zuruecknehmen(anna, 4, [b], mittleres.membersHash)).statusCode).toBe(409);
        expect(await stand([4])).toEqual(vorher);

        const letztes = await zuruecknehmen(anna, 4, [c], await pruefsumme(anna, 4, [c]));
        expect(letztes.statusCode, letztes.body).toBe(200);
        expect(
            (
                await cluster.admin`SELECT is_hidden, is_seaport, is_nodix FROM place WHERE public_id = ${ort(4)}::uuid`
            )[0],
        ).toEqual({
            is_hidden: true,
            is_seaport: true,
            is_nodix: false,
        });
        const rest = (await vorschau(anna, 4, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(rest).toMatchObject({ ergebnis: "ok", offen: [a, b], reasonRequired: false });
        const alle = await zuruecknehmen(anna, 4, s!.members, s!.membersHash);
        expect(alle.statusCode, alle.body).toBe(200);
        expect((alle.json() as { reverts: string[] }).reverts).toEqual([a, b]);
        expect(
            (
                await cluster.admin`SELECT is_hidden, is_seaport, is_nodix FROM place WHERE public_id = ${ort(4)}::uuid`
            )[0],
        ).toEqual({
            is_hidden: false,
            is_seaport: false,
            is_nodix: false,
        });
    });

    it("🔴 Mehrfachlöschen: drei Orte in EINER Operation gelöscht kommen in EINER Operation zurück, zusammen oder gar nicht", async () => {
        const geloescht = await loesche(anna, [5, 6, 7]);
        expect(
            (
                await cluster.admin`SELECT count(*)::int AS n FROM place WHERE public_id = ANY(${[5, 6, 7].map(ort)}::uuid[]) AND NOT is_active`
            )[0]!["n"],
        ).toBe(3);
        const pruefung = (await vorschau(anna, 6, [geloescht])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [geloescht],
            folgen: { gegenstaende: 3, gelaende: "keines" },
        });

        await cluster.admin`DELETE FROM job_event`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 6, [geloescht], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { affected: { kind: string; id: string }[]; reverts: string[] };
        expect(quittung.reverts).toEqual([geloescht]);
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([5, 6, 7].map(ort));
        expect(
            (
                await cluster.admin`SELECT count(*)::int AS n FROM place WHERE public_id = ANY(${[5, 6, 7].map(ort)}::uuid[]) AND is_active`
            )[0]!["n"],
        ).toBe(3);
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
            ),
        ).toBe(1);
        expect(
            await zahl(
                cluster.admin<
                    { n: string }[]
                >`SELECT count(*)::text AS n FROM map_operation_revert_link WHERE restore_operation_id = ${operationId}::uuid`,
            ),
        ).toBe(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck.objects.map((o) => o.action)).toEqual(["place.restored", "place.restored", "place.restored"]);

        // Alles oder nichts: Ist EINER der drei seit dem Löschen verändert, bleiben ALLE gelöscht.
        const zweite = await loesche(anna, [8, 9, 10]);
        await cluster.admin`UPDATE place SET name = 'Rücknahmeort Löschen 9 anders' WHERE public_id = ${ort(9)}::uuid`;
        const vorher = await stand([8, 9, 10]);
        const konflikt = (await vorschau(anna, 8, [zweite])).json() as RuecknahmePruefung;
        expect(konflikt.ergebnis).toBe("edit_conflict");
        expect(konflikt.konflikte.map((k) => k.id)).toContain(ort(9));
        const abgewiesen = await zuruecknehmen(anna, 8, [zweite], konflikt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(abgewiesen.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "place", id: ort(9) }),
        );
        expect(await stand([8, 9, 10])).toEqual(vorher);
        expect(
            (
                await cluster.admin`SELECT count(*)::int AS n FROM place WHERE public_id = ANY(${[8, 9, 10].map(ort)}::uuid[]) AND is_active`
            )[0]!["n"],
        ).toBe(0);
    });

    it("🔴 Art: ein Löschen oder Verschieben geht nur allein; Felder und Löschen zusammen sind `not_revertable`, erst das Löschen, dann die Felder", async () => {
        const a = await aendere(anna, 11, { name: "Rücknahmeort Mischung Neu" });
        const b = await aendere(anna, 11, { hidden: true });
        const geloescht = await loesche(anna, [11]);
        const s = await serie(anna, 11);
        expect(s!.members).toEqual([a, b, geloescht]);
        const vorher = await stand([11]);
        const antwort = await zuruecknehmen(anna, 11, s!.members, s!.membersHash);
        expect([antwort.statusCode, antwort.json().error.code, antwort.json().error.details.reason]).toEqual([
            400,
            "not_revertable",
            "art",
        ]);
        expect(antwort.json().error.details.members).toEqual([{ operationId: geloescht, reason: "art" }]);
        expect(await stand([11])).toEqual(vorher);
        // Das Löschen als letztes offenes Mitglied allein, danach die Felder der Serie.
        const loeschen = await zuruecknehmen(anna, 11, [geloescht], await pruefsumme(anna, 11, [geloescht]));
        expect(loeschen.statusCode, loeschen.body).toBe(200);
        const felder = await zuruecknehmen(anna, 11, s!.members, s!.membersHash);
        expect(felder.statusCode, felder.body).toBe(200);
        expect((felder.json() as { reverts: string[] }).reverts).toEqual([a, b]);
        expect(
            (await cluster.admin`SELECT name, is_hidden, is_active FROM place WHERE public_id = ${ort(11)}::uuid`)[0],
        ).toEqual({
            name: "Rücknahmeort Mischung",
            is_hidden: false,
            is_active: true,
        });
        // Von der Karte nehmen und das Setzen auf die Karte gehen seit WI-0265 B8a zurück (eigener Test unten).
    });

    it("🔴 U9: Recht, Sperre und Liste vor jeder Änderung: Reviewer 403, ohne Anmeldung 401, fremde Sperre 409 `object_locked`, fremder Ort in der Liste 400", async () => {
        const a = await aendere(anna, 13, { hidden: true });
        const b = await aendere(anna, 13, { ruined: true });
        const s = await serie(anna, 13);
        const vorher = await stand([13]);
        expect(((await vorschau(rita, 13, s!.members, s!.membersHash)).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
        const verboten = await zuruecknehmen(rita, 13, s!.members, s!.membersHash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorPlaceRestoreSeriesUrl(ort(13)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [a, b], membersHash: s!.membersHash },
        });
        expect(anonym.statusCode).toBe(401);
        // Eine Liste, die zu einem anderen Ort gehört, ist nicht von hier.
        const fremd = await zuruecknehmen(anna, 4, s!.members, s!.membersHash);
        expect([fremd.statusCode, fremd.json().error.code]).toEqual([400, "invalid_members"]);

        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('place', ${ort(13)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const pruefung = (await vorschau(anna, 13, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
            expect(pruefung.sperren[0]).toMatchObject({ kind: "place", id: ort(13), person: { name: "Bernd" } });
            const gesperrt = await zuruecknehmen(anna, 13, s!.members, s!.membersHash);
            expect([gesperrt.statusCode, gesperrt.json().error.code]).toEqual([409, "object_locked"]);
            expect(gesperrt.json().error.details.lock).toMatchObject({
                kind: "place",
                id: ort(13),
                person: { name: "Bernd" },
            });
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${ort(13)}::uuid`;
        }
        expect(await stand([13])).toEqual(vorher);
    });

    it("🔴 F.1: die Rücknahme einer Verschiebung verlangt das Geometrie-Recht, auch wenn die Verschiebung selbst eine Rücknahme war; Felder und Löschen nur das Sachrecht; 0 Mutationen", async () => {
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
        const bewegt = await verschiebe(anna, 15, { x: 603, y: 303 }, [
            { weg: 7, end: "start", to: { x: 603, y: 303 } },
        ]);
        const vorher = await stand([15], [7]);

        const vorschauNurSache = await vorschauOrt(cluster.app, ort(15), { members: [bewegt] }, nurSache);
        expect(vorschauNurSache).toMatchObject({ ergebnis: "forbidden", fehlendeRechte: ["edit_map_geometry"] });
        const abgewiesen = ruecknehmenOrt(cluster.app, aktor, nurSache, ort(15), {
            operationId: randomUUID(),
            members: [bewegt],
            membersHash: vorschauNurSache.membersHash,
            reason: "Falsch verschoben",
        });
        await expect(abgewiesen).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
        expect(await stand([15], [7])).toEqual(vorher);

        // Mit beiden Rechten geht die Rücknahme; ihre eigene Rücknahme (`place.restore_series`, Aktionen der Verschiebung) verlangt wieder das Geometrie-Recht.
        const hash = (await vorschauOrt(cluster.app, ort(15), { members: [bewegt] }, beide)).membersHash;
        const quittung = await ruecknehmenOrt(cluster.app, aktor, beide, ort(15), {
            operationId: randomUUID(),
            members: [bewegt],
            membersHash: hash,
            reason: "Falsch verschoben",
        });
        const rueck = quittung.operationId;
        const nachRuecknahme = await stand([15], [7]);
        expect(nachRuecknahme.orte[0]!["lage"]).toBe("POINT(600 300)");
        const vorschauRueck = await vorschauOrt(cluster.app, ort(15), { members: [rueck] }, nurSache);
        expect(vorschauRueck).toMatchObject({ ergebnis: "forbidden", fehlendeRechte: ["edit_map_geometry"] });
        await expect(
            ruecknehmenOrt(cluster.app, aktor, nurSache, ort(15), {
                operationId: randomUUID(),
                members: [rueck],
                membersHash: vorschauRueck.membersHash,
            }),
        ).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
        expect(await stand([15], [7])).toEqual(nachRuecknahme);
        expect((await vorschauOrt(cluster.app, ort(15), { members: [rueck] }, beide)).ergebnis).toBe("ok");

        // Die Felder eines Orts dagegen verlangen nur das Sachrecht.
        const a = await aendere(anna, 15, { hidden: true });
        const felder = await vorschauOrt(cluster.app, ort(15), { members: [a] }, nurSache);
        expect(felder.ergebnis).toBe("ok");
    });

    it("🔴 R2: jeder Einzelweg des Orts hält an der Sperre eines anderen an, vor jeder Änderung; die eigene Sperre und ein freier Ort gehen", async () => {
        // Ein gelöschter Ort für das ↺ des Einzelwegs (`place.restore`).
        const geloescht = operationIdVon(
            await sende(anna, "POST", `${editorPlaceUrl(ort(5))}/delete`, {
                operationId: randomUUID(),
                baseRevision: await revision("place", ort(5)),
            }),
        );
        const gespeichert = await stand([4, 5]);
        for (const n of [4, 5])
            await cluster.admin`
                INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
                VALUES ('place', ${ort(n)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const basis = await revision("place", ort(4));
            const versuche: [string, Antwort][] = [
                [
                    "place.update",
                    await sende(anna, "PATCH", editorPlaceUrl(ort(4)), {
                        operationId: randomUUID(),
                        baseRevision: basis,
                        changes: { hidden: true },
                    }),
                ],
                [
                    "place.move",
                    await sende(anna, "POST", editorPlaceMoveUrl(ort(4)), {
                        operationId: randomUUID(),
                        baseRevision: basis,
                        to: { x: 441, y: 441 },
                        pathEnds: [],
                    }),
                ],
                [
                    "place.take_off_map",
                    await sende(anna, "POST", editorPlaceTakeOffMapUrl(ort(4)), {
                        operationId: randomUUID(),
                        baseRevision: basis,
                    }),
                ],
                [
                    "place.delete",
                    await sende(anna, "POST", `${editorPlaceUrl(ort(4))}/delete`, {
                        operationId: randomUUID(),
                        baseRevision: basis,
                    }),
                ],
                [
                    "place.restore",
                    await sende(anna, "POST", `${editorPlaceUrl(ort(5))}/restore`, {
                        operationId: randomUUID(),
                        reverts: geloescht,
                    }),
                ],
            ];
            for (const [name, antwort] of versuche)
                expect([name, antwort.statusCode, antwort.json().error?.code], antwort.body).toEqual([
                    name,
                    409,
                    "object_locked",
                ]);
            expect(versuche[0]![1].json().error.details.lock).toMatchObject({
                kind: "place",
                id: ort(4),
                person: { name: "Bernd" },
            });
            expect(await stand([4, 5])).toEqual(gespeichert);
            // Bernd darf unter seiner eigenen Sperre schreiben.
            const eigen = await sende(bernd, "PATCH", editorPlaceUrl(ort(4)), {
                operationId: randomUUID(),
                baseRevision: basis,
                changes: { hidden: true },
            });
            expect(eigen.statusCode, eigen.body).toBe(200);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ANY(${[4, 5].map(ort)}::uuid[])`;
        }
        // Ohne Sperre geht dieselbe Änderung auch für Anna.
        const frei = await sende(anna, "PATCH", editorPlaceUrl(ort(4)), {
            operationId: randomUUID(),
            baseRevision: await revision("place", ort(4)),
            changes: { hidden: false },
        });
        expect(frei.statusCode, frei.body).toBe(200);
    });
    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // WI-0265 B8a: Anlegen, Wiederherstellen, Von der Karte nehmen und Setzen, Mehrfachbearbeitung. Die Orte legen die Tests selbst an (`neuerOrt`), damit jedes Anlegen ein echtes Protokoll hat.

    /** `place.create` durch die Route: die Kennung des neuen Orts und seine Operation. */
    const neuerOrt = async (
        person: { cookie: string },
        koerper: Record<string, unknown>,
    ): Promise<{ id: string; operationId: string }> => {
        const antwort = await sende(person, "POST", EDITOR_PLACES_URL, {
            operationId: randomUUID(),
            subtype: "dorf",
            ...koerper,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { operationId: string; affected: { kind: string; id: string }[] };
        return { id: quittung.affected.find((a) => a.kind === "place")!.id, operationId: quittung.operationId };
    };
    const aendereAn = async (person: { cookie: string }, id: string, changes: Record<string, unknown>) => {
        const antwort = await sende(person, "PATCH", editorPlaceUrl(id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", id),
            changes,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const vorschauAn = (person: { cookie: string }, id: string, members: string[], membersHash?: string) =>
        sende(person, "POST", editorPlaceRestoreSeriesPreviewUrl(id), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zuruecknehmenAn = (
        person: { cookie: string },
        id: string,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ) =>
        sende(person, "POST", editorPlaceRestoreSeriesUrl(id), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const pruefsummeAn = async (person: { cookie: string }, id: string, members: string[]): Promise<string> =>
        ((await vorschauAn(person, id, members)).json() as RuecknahmePruefung).membersHash;
    const serieAn = async (person: { cookie: string }, id: string) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === id);
    };
    /** Der Ort in beiden Tafeln: ob er auf der Karte steht, ob ein Ort ohne Lage aktiv ist, seine Lage und sein Name. */
    const ortStand = async (id: string) => {
        const [karte] = await cluster.admin<{ is_active: boolean; name: string; lage: string; revision: string }[]>`
            SELECT is_active, name, ST_AsText(geom) AS lage, revision::text FROM place WHERE public_id = ${id}::uuid`;
        const [ohne] = await cluster.admin<{ is_active: boolean }[]>`
            SELECT is_active FROM place_unplaced WHERE public_id = ${id}::uuid`;
        return {
            ...(karte === undefined ? {} : { karte: karte.is_active, name: karte.name, lage: karte.lage }),
            ohneLage: ohne?.is_active ?? null,
        };
    };
    const zaehleEreignisse = (): Promise<number> =>
        zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`);

    it("🔴 B8a Anlegen: ein neuer Ort mit zwei „Fertig“ danach ist EINE Serie und geht als Ganzes zurück (stillgelegt); Bernd nur mit Grund; `replayed`, `already_reverted`; die Rücknahme der Rücknahme belebt ihn wieder", async () => {
        const neu = await neuerOrt(anna, { name: "B8a Neustadt", position: { x: 700, y: 700 } });
        const a = await aendereAn(anna, neu.id, { hidden: true });
        const b = await aendereAn(anna, neu.id, { name: "B8a Neustadt Zwei" });
        const s = await serieAn(anna, neu.id);
        expect(s!.members).toEqual([neu.operationId, a, b]);
        // Das Anlegen steht in der Liste als rücknehmbar (nicht mehr Art), wie die Änderungen danach.
        const liste = (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${neu.operationId}`,
                headers: { cookie: anna.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];
        expect(liste.status).toBe("ruecknehmbar");

        const pruefung = (await vorschauAn(anna, neu.id, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: s!.members, reasonRequired: false });
        expect(pruefung.folgen).toMatchObject({ gegenstaende: 1, gelaende: "keines" });
        // Gate 2 und das Recht: Bernd braucht einen Grund, Rita hat das Recht nicht.
        const vorher = await stand([]);
        const ohneGrund = await zuruecknehmenAn(bernd, neu.id, s!.members, s!.membersHash);
        expect([ohneGrund.statusCode, ohneGrund.json().error.code]).toEqual([400, "reason_required"]);
        const verboten = await zuruecknehmenAn(rita, neu.id, s!.members, s!.membersHash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        expect(await stand([])).toEqual(vorher);

        await cluster.admin`DELETE FROM job_event`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmenAn(bernd, neu.id, s!.members, s!.membersHash, {
            operationId,
            reason: "Doppelt angelegt",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { status: string; reverts: string[]; derivedWork: { kind: string }[] };
        expect(quittung.reverts).toEqual(s!.members);
        expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
        expect(await ortStand(neu.id)).toMatchObject({ karte: false, name: "B8a Neustadt Zwei" });
        // Folgen wie beim Vorwärtsschreiben: EIN Ereignis für die Kacheln und die Wegfindung.
        expect(await zaehleEreignisse()).toBe(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "place.restore_series",
            reason: "Doppelt angelegt",
        });
        expect(rueck.objects.map((o) => o.action)).toEqual(["place.deleted"]);

        // Dieselbe Kennung noch einmal: die erste Quittung, nichts Neues. Eine andere Kennung: schon zurückgenommen.
        const nochmal = await zuruecknehmenAn(bernd, neu.id, s!.members, s!.membersHash, {
            operationId,
            reason: "Doppelt angelegt",
        });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const doppelt = await zuruecknehmenAn(anna, neu.id, s!.members, s!.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);
        expect(await zaehleEreignisse()).toBe(1);

        // Die Rücknahme der Rücknahme (Anna, Bernds Rücknahme: mit Grund) belebt den Ort wieder, mit dem Stand, den die Serie hinterließ.
        const hash = await pruefsummeAn(anna, neu.id, [operationId]);
        const belebt = await zuruecknehmenAn(anna, neu.id, [operationId], hash, { reason: "Wird doch gebraucht" });
        expect(belebt.statusCode, belebt.body).toBe(200);
        expect(await ortStand(neu.id)).toMatchObject({ karte: true, name: "B8a Neustadt Zwei" });
        expect((await eintrag(anna, belebt.json().operationId)).objects.map((o) => o.action)).toEqual([
            "place.restored",
        ]);
    });

    it("🔴 B8a Anlegen ohne Lage (E16): ein Ort unter „Nicht auf der Karte“ wird stillgelegt (`place.deleted_unplaced`, keine Wegfindung) und lässt sich wieder beleben", async () => {
        const neu = await neuerOrt(anna, { name: "B8a Ohne Lage" });
        expect(await ortStand(neu.id)).toEqual({ ohneLage: true });
        const hash = await pruefsummeAn(anna, neu.id, [neu.operationId]);
        const antwort = await zuruecknehmenAn(anna, neu.id, [neu.operationId], hash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((x) => x.kind)).not.toContain(
            "routing",
        );
        expect(await ortStand(neu.id)).toEqual({ ohneLage: false });
        const rueck = await eintrag(anna, antwort.json().operationId);
        expect(rueck.objects.map((o) => o.action)).toEqual(["place.deleted_unplaced"]);
        const belebt = await zuruecknehmenAn(
            anna,
            neu.id,
            [antwort.json().operationId],
            await pruefsummeAn(anna, neu.id, [antwort.json().operationId]),
        );
        expect(belebt.statusCode, belebt.body).toBe(200);
        expect(await ortStand(neu.id)).toEqual({ ohneLage: true });
    });

    it("🔴 B8a Anlegen streng: hat seither jemand den Ort geändert oder etwas an ihn gehängt (ein Weg, eine Wiki-Zuordnung), gibt es 409 mit `abweichung` und es wird nichts geschrieben", async () => {
        // (a) Eine fremde Änderung danach.
        const a = await neuerOrt(anna, { name: "B8a Fremd Geändert", position: { x: 710, y: 700 } });
        await aendereAn(bernd, a.id, { hidden: true });
        const vorherA = await stand([]);
        const pruefungA = (await vorschauAn(anna, a.id, [a.operationId])).json() as RuecknahmePruefung;
        expect(pruefungA.ergebnis).toBe("edit_conflict");
        expect(pruefungA.konflikte[0]).toMatchObject({ art: "spaeter", kind: "place", id: a.id, felder: ["hidden"] });
        const abgewiesenA = await zuruecknehmenAn(anna, a.id, [a.operationId], pruefungA.membersHash);
        expect([abgewiesenA.statusCode, abgewiesenA.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([])).toEqual(vorherA);
        expect((await ortStand(a.id)).karte).toBe(true);

        // (b) Ein Weg, der nach dem Anlegen am neuen Ort endet.
        const b = await neuerOrt(anna, { name: "B8a Weg Dran", position: { x: 720, y: 700 } });
        const weg = await sende(anna, "POST", EDITOR_PATHS_URL, {
            operationId: randomUUID(),
            points: [
                { x: 720, y: 700 },
                { x: 730, y: 710 },
            ],
        });
        expect(weg.statusCode, weg.body).toBe(200);
        const wegId = (weg.json() as { publicId: string }).publicId;
        const pruefungB = (await vorschauAn(anna, b.id, [b.operationId])).json() as RuecknahmePruefung;
        expect(pruefungB.ergebnis).toBe("edit_conflict");
        expect(pruefungB.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", kind: "path", id: wegId, abweichung: { was: "weg_am_ort" } }),
        );
        const vorherB = await stand([]);
        const abgewiesenB = await zuruecknehmenAn(anna, b.id, [b.operationId], pruefungB.membersHash);
        expect([abgewiesenB.statusCode, abgewiesenB.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(abgewiesenB.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "path", id: wegId, abweichung: { was: "weg_am_ort" } }),
        );
        expect(await stand([])).toEqual(vorherB);
        // Ein Weg, der schon VOR dem Anlegen am Ort endete und unberührt blieb, stört nicht (üblich: ein Ort auf einem Wegende anlegen).
        const c = await neuerOrt(anna, { name: "B8a Auf Wegende", position: { x: 740, y: 700 } });
        expect(
            ((await vorschauAn(anna, c.id, [c.operationId])).json() as RuecknahmePruefung).ergebnis,
            "ein Weg, der den Ort gar nicht berührt, stört nicht",
        ).toBe("ok");

        // (c) Eine Wiki-Zuordnung, die der Ort beim Anlegen nicht hatte.
        const d = await neuerOrt(anna, { name: "B8a Wiki Dran", position: { x: 750, y: 700 } });
        const [artikel] = await cluster.migrator<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, synced_at)
            VALUES ('rn-b8a-dran', 'https://de.wiki-aventurica.de/wiki/Rn_B8a_Dran', 'Rn B8a Dran', 'B8a Wiki Dran', now())
            RETURNING id::text`;
        await cluster.migrator`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/Rn_B8a_Dran', ${artikel!.id}, 'assigned', 'unknown' FROM place WHERE public_id = ${d.id}::uuid`;
        const pruefungD = (await vorschauAn(anna, d.id, [d.operationId])).json() as RuecknahmePruefung;
        expect(pruefungD.ergebnis).toBe("edit_conflict");
        expect(pruefungD.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", kind: "place", id: d.id, abweichung: { was: "zuordnung" } }),
        );
        expect((await ortStand(d.id)).karte).toBe(true);

        // (d) Eine Kraftlinie, die seither am neuen Ort endet: Er lässt sich nicht stilllegen (wie „Ganz löschen“).
        const e = await neuerOrt(anna, { name: "B8a Kraftlinie Dran", position: { x: 760, y: 740 } });
        const gegenueber = await neuerOrt(anna, { name: "B8a Kraftlinie Gegenüber", position: { x: 770, y: 740 } });
        await cluster.migrator`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${randomUUID()}::uuid, 'aventuria', 'B8a Probeader', ${e.id}::uuid, ${gegenueber.id}::uuid,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(760, 740), ST_MakePoint(770, 740)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(760, 740), ST_MakePoint(770, 740)), 0), 'test')`;
        const pruefungE = (await vorschauAn(anna, e.id, [e.operationId])).json() as RuecknahmePruefung;
        expect(pruefungE.ergebnis).toBe("edit_conflict");
        expect(pruefungE.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", kind: "place", id: e.id, abweichung: { was: "ort_kraftlinie" } }),
        );
        const vorherE = await stand([]);
        const abgewiesenE = await zuruecknehmenAn(anna, e.id, [e.operationId], pruefungE.membersHash);
        expect([abgewiesenE.statusCode, abgewiesenE.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([])).toEqual(vorherE);
        expect((await ortStand(e.id)).karte).toBe(true);
    });

    it("🔴 B8a Anlegen: das Recht der Vorwärtsoperation (ein Ort mit Lage verlangt auch die Lage), Sperre vor jeder Änderung", async () => {
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        const mitLage = await neuerOrt(anna, { name: "B8a Recht Mit Lage", position: { x: 760, y: 700 } });
        const ohneLage = await neuerOrt(anna, { name: "B8a Recht Ohne Lage" });
        expect(await vorschauOrt(cluster.app, mitLage.id, { members: [mitLage.operationId] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_map_geometry"],
        });
        // Ein Ort ohne Lage berührt keine Geometrie: das Sachrecht genügt.
        expect(
            (await vorschauOrt(cluster.app, ohneLage.id, { members: [ohneLage.operationId] }, nurSache)).ergebnis,
        ).toBe("ok");
        // Eine fremde Sperre hält die Rücknahme an, ohne dass etwas geschrieben wird.
        const vorher = await stand([]);
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('place', ${mitLage.id}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const gesperrt = await zuruecknehmenAn(
                anna,
                mitLage.id,
                [mitLage.operationId],
                await pruefsummeAn(anna, mitLage.id, [mitLage.operationId]),
            );
            expect([gesperrt.statusCode, gesperrt.json().error.code]).toEqual([409, "object_locked"]);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${mitLage.id}::uuid`;
        }
        expect(await stand([])).toEqual(vorher);
    });

    it("🔴 B8a Wiederherstellen: `place.restore` geht zurück (der Ort wieder gelöscht), die Rücknahme davon holt ihn zurück; ebenso die Rücknahme eines Löschens und deren Rücknahme", async () => {
        const neu = await neuerOrt(anna, { name: "B8a Löschen Hin Und Her", position: { x: 770, y: 700 } });
        const loeschen = await sende(anna, "POST", editorPlaceDeleteUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", neu.id),
        });
        expect(loeschen.statusCode, loeschen.body).toBe(200);
        const geloescht = operationIdVon(loeschen);
        // Der Weg des Menüs: `place.restore` mit `reverts` (das ↺ des Einzelwegs).
        const wieder = await sende(anna, "POST", editorPlaceRestoreUrl(neu.id), {
            operationId: randomUUID(),
            reverts: geloescht,
        });
        expect(wieder.statusCode, wieder.body).toBe(200);
        const wiederhergestellt = operationIdVon(wieder);
        expect((await ortStand(neu.id)).karte).toBe(true);

        const pruefung = (await vorschauAn(anna, neu.id, [wiederhergestellt])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [wiederhergestellt] });
        const zurueck = await zuruecknehmenAn(anna, neu.id, [wiederhergestellt], pruefung.membersHash);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect((await ortStand(neu.id)).karte).toBe(false);
        const rueck = await eintrag(anna, zurueck.json().operationId);
        expect(rueck).toMatchObject({ operation: "place.restore_series", reverts: [wiederhergestellt] });
        expect(rueck.objects.map((o) => o.action)).toEqual(["place.deleted"]);

        // Die Rücknahme der Rücknahme: der Ort ist wieder da.
        const rueckId: string = zurueck.json().operationId;
        const belebt = await zuruecknehmenAn(anna, neu.id, [rueckId], await pruefsummeAn(anna, neu.id, [rueckId]));
        expect(belebt.statusCode, belebt.body).toBe(200);
        expect((await ortStand(neu.id)).karte).toBe(true);

        // Ein Löschen zurück (`place.restore_series` mit `place.restored`), und dessen Rücknahme löscht wieder.
        const zweites = await sende(anna, "POST", editorPlaceDeleteUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", neu.id),
        });
        const zweitesGeloescht = operationIdVon(zweites);
        const holen = await zuruecknehmenAn(
            anna,
            neu.id,
            [zweitesGeloescht],
            await pruefsummeAn(anna, neu.id, [zweitesGeloescht]),
        );
        expect(holen.statusCode, holen.body).toBe(200);
        expect((await ortStand(neu.id)).karte).toBe(true);
        const holenId: string = holen.json().operationId;
        const nochmalLoeschen = await zuruecknehmenAn(
            anna,
            neu.id,
            [holenId],
            await pruefsummeAn(anna, neu.id, [holenId]),
        );
        expect(nochmalLoeschen.statusCode, nochmalLoeschen.body).toBe(200);
        expect((await ortStand(neu.id)).karte).toBe(false);
        // Hat seither jemand den gelöschten Ort angefasst, geht nichts zurück.
        await cluster.admin`UPDATE place SET name = 'B8a Löschen Hin Und Her Anders' WHERE public_id = ${neu.id}::uuid`;
        const konflikt = (
            await vorschauAn(anna, neu.id, [nochmalLoeschen.json().operationId])
        ).json() as RuecknahmePruefung;
        expect(konflikt.ergebnis).toBe("edit_conflict");
    });

    it("🔴 B8a Von der Karte nehmen und Setzen: jedes geht zurück (an die Lage davor), die Rücknahme davon wieder; hat jemand den Ort seither anders gesetzt, geht nichts zurück", async () => {
        const neu = await neuerOrt(anna, { name: "B8a Abnehmen", position: { x: 780, y: 700 } });
        const ab = await sende(anna, "POST", editorPlaceTakeOffMapUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", neu.id),
        });
        expect(ab.statusCode, ab.body).toBe(200);
        const abgenommen = operationIdVon(ab);
        expect(await ortStand(neu.id)).toMatchObject({ karte: false, ohneLage: true });

        await cluster.admin`DELETE FROM job_event`;
        const pruefung = (await vorschauAn(anna, neu.id, [abgenommen])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [abgenommen] });
        const auf = await zuruecknehmenAn(anna, neu.id, [abgenommen], pruefung.membersHash);
        expect(auf.statusCode, auf.body).toBe(200);
        // Auf der Karte, an der Lage davor; der Ort ohne Lage ist stillgelegt.
        expect(await ortStand(neu.id)).toMatchObject({ karte: true, lage: "POINT(780 700)", ohneLage: false });
        expect(await zaehleEreignisse()).toBe(1);
        const aufEintrag = await eintrag(anna, auf.json().operationId);
        expect(aufEintrag.objects.map((o) => o.action)).toEqual(["place.placed"]);
        // Ein zweites Mal: schon zurückgenommen.
        const doppelt = await zuruecknehmenAn(anna, neu.id, [abgenommen], pruefung.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);

        // Die Rücknahme der Rücknahme (Setzen zurück) nimmt ihn wieder von der Karte.
        const aufId: string = auf.json().operationId;
        const wiederAb = await zuruecknehmenAn(anna, neu.id, [aufId], await pruefsummeAn(anna, neu.id, [aufId]));
        expect(wiederAb.statusCode, wiederAb.body).toBe(200);
        expect(await ortStand(neu.id)).toMatchObject({ karte: false, ohneLage: true });
        expect((await eintrag(anna, wiederAb.json().operationId)).objects.map((o) => o.action)).toEqual([
            "place.taken_off_map",
        ]);

        // Das Gegenstück: Setzen auf die Karte (`place.move` am Ort ohne Lage) geht zurück, nämlich wieder von der Karte.
        const setzen = await sende(anna, "POST", editorPlaceMoveUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", neu.id),
            to: { x: 790, y: 710 },
            pathEnds: [],
        });
        expect(setzen.statusCode, setzen.body).toBe(200);
        const gesetzt = operationIdVon(setzen);
        expect(await ortStand(neu.id)).toMatchObject({ karte: true, lage: "POINT(790 710)" });
        const zurueckVonDerKarte = await zuruecknehmenAn(
            anna,
            neu.id,
            [gesetzt],
            await pruefsummeAn(anna, neu.id, [gesetzt]),
        );
        expect(zurueckVonDerKarte.statusCode, zurueckVonDerKarte.body).toBe(200);
        expect(await ortStand(neu.id)).toMatchObject({ karte: false, ohneLage: true });

        // Streng: Setzt jemand den Ort an anderer Stelle auf die Karte, kann das Abnehmen nicht mehr zurück.
        const neu2 = await neuerOrt(anna, { name: "B8a Abnehmen Zwei", position: { x: 800, y: 700 } });
        const ab2 = operationIdVon(
            await sende(anna, "POST", editorPlaceTakeOffMapUrl(neu2.id), {
                operationId: randomUUID(),
                baseRevision: await revision("place", neu2.id),
            }),
        );
        const elsewhere = await sende(bernd, "POST", editorPlaceMoveUrl(neu2.id), {
            operationId: randomUUID(),
            baseRevision: await revision("place", neu2.id),
            to: { x: 810, y: 720 },
            pathEnds: [],
        });
        expect(elsewhere.statusCode, elsewhere.body).toBe(200);
        const vorher = await stand([]);
        const konflikt = (await vorschauAn(anna, neu2.id, [ab2])).json() as RuecknahmePruefung;
        expect(konflikt.ergebnis).toBe("edit_conflict");
        const abgewiesen = await zuruecknehmenAn(anna, neu2.id, [ab2], konflikt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([])).toEqual(vorher);
        expect(await ortStand(neu2.id)).toMatchObject({ karte: true, lage: "POINT(810 720)" });
        // Das Recht: Abnehmen und Setzen sind Eingriffe in die Lage.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        expect(await vorschauOrt(cluster.app, neu.id, { members: [gesetzt] }, nurSache)).toMatchObject({
            fehlendeRechte: ["edit_map_geometry"],
        });
    });

    it("🔴 B8a Mehrfachbearbeitung: ↺ auf Wiki-Werte an zwei Orten (EINE Operation) geht für beide zusammen zurück; hat jemand einen der beiden seither geändert, geht keiner zurück", async () => {
        const einwohner = async (n: number): Promise<string | null> =>
            (
                await cluster.admin<{ einwohner: string | null }[]>`
                    SELECT d.einwohner FROM place p JOIN place_detail d ON d.place_id = p.id AND d.is_active
                     WHERE p.public_id = ${ort(n)}::uuid`
            )[0]?.einwohner ?? null;
        expect([await einwohner(31), await einwohner(32)]).toEqual(["120", "120"]);
        const antwort = await sende(anna, "POST", EDITOR_PLACES_SAMMEL_URL, {
            operationId: randomUUID(),
            orte: await Promise.all(
                [31, 32].map(async (n) => ({ id: ort(n), baseRevision: await revision("place", ort(n)) })),
            ),
            wiki: ["einwohner"],
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const sammel = operationIdVon(antwort);
        // Beide stehen jetzt auf dem Wiki-Wert (der eigene Wert ist weg).
        expect([await einwohner(31), await einwohner(32)]).not.toContain("120");

        const pruefung = (await vorschau(anna, 31, [sammel])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [sammel], folgen: { gegenstaende: 2 } });
        // Alles oder nichts: Bernd ändert Ort 32 seither, also bleibt auch Ort 31 auf dem Wiki-Wert.
        const bernds = await aendere(bernd, 32, { hidden: true });
        const vorher = await stand([31, 32]);
        const konflikt = (await vorschau(anna, 31, [sammel])).json() as RuecknahmePruefung;
        expect(konflikt.ergebnis).toBe("edit_conflict");
        expect(konflikt.konflikte.map((k) => k.id)).toContain(ort(32));
        expect(konflikt.konflikte.map((k) => k.id)).not.toContain(ort(31));
        const abgewiesen = await zuruecknehmen(anna, 31, [sammel], konflikt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([31, 32])).toEqual(vorher);
        expect([await einwohner(31), await einwohner(32)]).not.toContain("120");

        // Nimmt Bernd seine Änderung zurück, geht die Mehrfachbearbeitung für BEIDE Orte in EINER Operation zurück.
        const bernd32 = await zuruecknehmen(bernd, 32, [bernds], await pruefsumme(bernd, 32, [bernds]));
        expect(bernd32.statusCode, bernd32.body).toBe(200);
        await cluster.admin`DELETE FROM job_event`;
        const operationId = randomUUID();
        const ok = await zuruecknehmen(anna, 31, [sammel], await pruefsumme(anna, 31, [sammel]), { operationId });
        expect(ok.statusCode, ok.body).toBe(200);
        expect((ok.json() as { reverts: string[] }).reverts).toEqual([sammel]);
        expect([await einwohner(31), await einwohner(32)]).toEqual(["120", "120"]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck.objects.map((o) => `${o.kind}:${o.action}`)).toEqual([
            "place:place.updated",
            "place:place.updated",
        ]);

        // Die Rücknahme der Rücknahme bringt beide wieder auf den Wiki-Wert.
        const nochmal = await zuruecknehmen(anna, 32, [operationId], await pruefsumme(anna, 32, [operationId]));
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect([await einwohner(31), await einwohner(32)]).not.toContain("120");
    });
});
