import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_PATHS_NEUER_WEG_URL,
    EDITOR_PATHS_URL,
    EDITOR_PATHS_VERBINDEN_URL,
    editorPathHistoryUrl,
    editorPathRestoreSeriesPreviewUrl,
    editorPathRestoreSeriesUrl,
    editorPathSplitUrl,
    editorPathStreetDeleteUrl,
    editorPathTakeOffMapUrl,
    editorPathUpdateUrl,
    editorPathDeleteUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { ruecknehmenWeg, vorschauWeg } from "../src/editor/ruecknahme-weg.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { netzOptionen } from "../src/routing/einstellungen.ts";
import { deriveTopology } from "../src/routing/topology.ts";
import { wegfindungswerte } from "../src/system/wegfindungsstand.ts";
import { gebirgSchreiben } from "../src/terrain/gebirge-editor.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Wege zurücknehmen (WI-0265 B6a; Fachvertrag C.2, C.3 „Mehrscope“, F.1; Testvertrag U4 bis U9, Gate 2 und 3): `POST /api/editor/paths/:id/restore-series[/preview]` durch Fastify, als
 * App-Rolle im Wegwerf-Cluster mit den Rollen des VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Eine Straße mit drei Abschnitten geht nur teilweise zurück; eine Fremdänderung an EINEM Abschnitt bleibt unbemerkt; zwei zusammengelegte Straßen werden beim Zurücknehmen
 * einer Umbenennung beide umbenannt; eine Kurve geht zurück, ein mitgezogener Punkt des Nachbarwegs bleibt an der neuen Lage; die Höhe an einem Fluss bleibt an der alten Lage stehen,
 * wo kein Stützpunkt mehr liegt; ein gelöschter Weg kommt nur teilweise zurück; ein von der Karte genommener, dann gelöschter Weg kommt „zurück auf die Karte“; Teilen und
 * „Auswahl zu neuem Weg“ lassen sich über die neue Route zurücknehmen; eine fremde Person wird ohne Grund zurückgenommen; die Route schreibt über die Sperre eines anderen hinweg.
 */

const ENV = "ruecknahmeweg";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b6a";

const ID = (n: number): string => `b6a60265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const weg = (n: number): string => ID(n);
const REGION = ID(0x900);
const FLAECHE = ID(0x901);

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;
type Punkt = [number, number];
type Person = { id: string; cookie: string };

describeWithCluster("Wege zurücknehmen (WI-0265 B6a, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna: Person = { id: "", cookie: "" };
    let bernd: Person = { id: "", cookie: "" };
    let rita: Person = { id: "", cookie: "" };
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
    const revision = async (n: number): Promise<number> =>
        Number(
            (
                await cluster.admin<{ r: string }[]>`
                    SELECT revision::text AS r FROM path WHERE public_id = ${weg(n)}::uuid`
            )[0]!.r,
        );

    /** Die Abschnitte einer Straße mit ihren heutigen Revisionen; `extra` setzt Felder je Abschnitt (Tunnel, Bach …). */
    const abschnitte = (ns: number[], extra: Record<number, Record<string, unknown>> = {}) =>
        Promise.all(ns.map(async (n) => ({ publicId: weg(n), baseRevision: await revision(n), ...(extra[n] ?? {}) })));

    /** „Fertig“ an einer Straße: `path.update` mit den Abschnitten `ns` und dem Anker `anker`. */
    const aktualisiere = async (
        person: Person,
        anker: number,
        ns: number[],
        felder: Record<string, unknown>,
        jeAbschnitt: Record<number, Record<string, unknown>> = {},
    ): Promise<string> => {
        const antwort = await sende(person, editorPathUpdateUrl(weg(anker)), {
            operationId: randomUUID(),
            sections: await abschnitte(ns, jeAbschnitt),
            ...felder,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    /** „Fertig“ an der Wegkurve: das neue Kontrollpolygon des Abschnitts `n`, mit mitgezogenen Punkten anderer Wege. */
    const forme = async (
        person: Person,
        n: number,
        points: { x: number; y: number }[],
        carried: { n: number; index: number; from: { x: number; y: number }; to: { x: number; y: number } }[] = [],
    ): Promise<string> => {
        const antwort = await sende(person, editorPathUpdateUrl(weg(n)), {
            operationId: randomUUID(),
            sections: await abschnitte([n]),
            shape: {
                publicId: weg(n),
                points,
                carried: await Promise.all(
                    carried.map(async (c) => ({
                        pathId: weg(c.n),
                        index: c.index,
                        baseRevision: await revision(c.n),
                        from: c.from,
                        to: c.to,
                    })),
                ),
            },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };

    const vorschau = (person: Person, n: number, members: string[], membersHash?: string): Promise<Antwort> =>
        sende(person, editorPathRestoreSeriesPreviewUrl(weg(n)), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zuruecknehmen = (
        person: Person,
        n: number,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        sende(person, editorPathRestoreSeriesUrl(weg(n)), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    /** Die Prüfsumme einer Liste von der Vorschau (die kennt sie für jede Liste). */
    const pruefsumme = async (person: Person, n: number, members: string[]): Promise<string> =>
        ((await vorschau(person, n, members)).json() as RuecknahmePruefung).membersHash;
    const serie = async (person: Person, n: number) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === weg(n));
    };
    const eintrag = async (person: Person, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];
    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);

    /** Was eine scheiternde Rücknahme nie verändern darf: Operationen, Protokoll, Verknüpfungen, Aufträge, Ereignisse und die Wege. */
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
        wege: await cluster.admin`
            SELECT public_id::text, name, subtype, label_visible, is_tunnel, is_active, off_map, mark, revision::text,
                   ST_AsText(geom) AS linie
              FROM path WHERE public_id = ANY(${ns.map(weg)}::uuid[]) ORDER BY public_id`,
    });
    const hoehen = async () =>
        cluster.admin`
            SELECT w.art, w.ordinal, ST_AsText(w.geom) AS lage, w.height_schritt FROM terrain_water_height w
              JOIN region_area a ON a.id = w.area_id WHERE a.public_id = ${FLAECHE}::uuid ORDER BY w.art, w.ordinal`;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const linie = async (n: number, name: string, subtype: string, ...punkte: Punkt[]) =>
            m`INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
              VALUES (${weg(n)}, ${DOMAIN}, ${name}, ${subtype}, FALSE, FALSE,
                      ST_SetSRID(ST_GeomFromText(${`LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`}), 0), ${SOURCE}, TRUE)`;
        // 1: eine Straße aus EINEM Abschnitt (Felder einer Serie); 2–4: eine Straße aus drei Abschnitten; 5–7: dieselbe für die Fremdänderung; 10 und 11: zwei Straßen, die zusammenfallen.
        await linie(1, "R6 Weg Eins", "Weg", [200, 200], [210, 205], [220, 200]);
        for (const [n, x] of [
            [2, 250],
            [3, 260],
            [4, 270],
        ] as const)
            await linie(n, "R6 Straße Zwei", "Weg", [x, 220], [x + 5, 225], [x + 10, 220]);
        for (const [n, x] of [
            [5, 300],
            [6, 310],
            [7, 320],
        ] as const)
            await linie(n, "R6 Straße Drei", "Weg", [x, 240], [x + 5, 245], [x + 10, 240]);
        await linie(10, "R6 Merge Alt", "Weg", [350, 260], [355, 265], [360, 260]);
        await linie(11, "R6 Merge Neu", "Weg", [370, 260], [375, 265], [380, 260]);
        // 20 und 21: eine Kurve mit mitgezogenem Punkt am Nachbarweg; 22 und 23: dieselbe für die Fremdänderung.
        await linie(20, "R6 Kurve Eins", "Weg", [100, 100], [110, 105], [120, 100], [130, 105]);
        await linie(21, "R6 Kurve Eins Nachbar", "Weg", [120, 100], [125, 90], [130, 80]);
        await linie(22, "R6 Kurve Zwei", "Weg", [100, 140], [110, 145], [120, 140], [130, 145]);
        await linie(23, "R6 Kurve Zwei Nachbar", "Weg", [120, 140], [125, 130], [130, 120]);
        // 30: ein Fluss mit einer eigenen Höhe am mittleren Stützpunkt (WI-0259).
        await m`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${REGION}, ${DOMAIN}, 'R6 Probegebirge', 'topographie', 'gebirge', 10, TRUE, ${SOURCE})`;
        await m`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE}::uuid, id, ${DOMAIN}, ST_GeomFromText('POLYGON((380 380, 460 380, 460 430, 380 430, 380 380))', 0), ${SOURCE}
              FROM region WHERE public_id = ${REGION}`;
        await m.begin((tx) => gebirgSchreiben(tx, FLAECHE, { kammhoehe: 3000 }));
        await linie(30, "R6 Fluss", "Flussweg", [400, 400], [410, 405], [420, 400]);
        // 120–122: ein Fluss aus drei Abschnitten, wie der Dergel in Production (OPS-000098).
        for (const [n, x] of [
            [120, 600],
            [121, 610],
            [122, 620],
        ] as const)
            await linie(n, "R6 Dergel", "Flussweg", [x, 600], [x + 5, 605], [x + 10, 600]);
        await m`
            INSERT INTO terrain_water_height (area_id, map_domain_id, art, ordinal, geom, height_schritt)
            SELECT a.id, ${DOMAIN}, 'fluss', 0, ST_SetSRID(ST_MakePoint(410, 405), 0), 1500
              FROM region_area a WHERE a.public_id = ${FLAECHE}::uuid`;
        // 40 und 41: eine Straße zum Löschen; 42: Abnehmen; 43: abgenommen, dann gelöscht; 50: Teilen; 51 und 52: „Auswahl zu neuem Weg“; 60: Sperre; 61: Recht.
        await linie(40, "R6 Stand Eins", "Weg", [150, 300], [155, 305], [160, 300]);
        await linie(41, "R6 Stand Eins", "Weg", [170, 300], [175, 305], [180, 300]);
        await linie(42, "R6 Stand Zwei", "Weg", [150, 320], [155, 325], [160, 320]);
        await linie(43, "R6 Stand Drei", "Weg", [150, 340], [155, 345], [160, 340]);
        await linie(50, "R6 Teilen", "Weg", [150, 360], [155, 365], [160, 360], [165, 365]);
        await linie(51, "R6 Gruppe Alt A", "Weg", [150, 380], [155, 385], [160, 380]);
        await linie(52, "R6 Gruppe Alt B", "Weg", [170, 380], [175, 385], [180, 380]);
        // Beide Abschnitte der Gruppe hängen an einem Wiki-Artikel (Zuordnung und X2-Zeile): „Auswahl zu neuem Weg“ legt sie still, ↺ holt sie zurück.
        for (const n of [51, 52]) {
            const [artikel] = await m<{ id: string }[]>`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
                VALUES (${`r6-gruppe-${String(n)}`}, ${`https://de.wiki-aventurica.de/wiki/R6_Gruppe_${String(n)}`}, ${`R6 Gruppe ${String(n)}`}, 'strasse', 'Weg')
                RETURNING id::text AS id`;
            await m`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, 'main', ${`https://de.wiki-aventurica.de/wiki/R6_Gruppe_${String(n)}`}, ${artikel!.id}::bigint, 'assigned', 'legacy_editor'
                  FROM path WHERE public_id = ${weg(n)}::uuid`;
            await m`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url)
                VALUES ('weg', ${weg(n)}::uuid, ${`wiki:r6-gruppe-${String(n)}`}, ${`https://de.wiki-aventurica.de/wiki/R6_Gruppe_${String(n)}`})`;
        }
        // 90 und 91: eine Kette Ende an Ende („Wege verbinden“).
        await linie(90, "R6 Kette", "Weg", [500, 300], [505, 305], [510, 300]);
        await linie(91, "R6 Kette", "Weg", [510, 300], [515, 305], [520, 300]);
        await linie(70, "R6 Eigenschaften", "Weg", [450, 300], [455, 305], [460, 300]);
        await linie(71, "R6 Eigenschaften", "Weg", [470, 300], [475, 305], [480, 300]);
        await linie(72, "R6 Wasser", "Flussweg", [450, 320], [455, 325], [460, 320]);
        // 80: ein Weg mit Wiki-Artikel, dessen Name vorher dem Wiki folgte.
        await linie(80, "R6 Wiki Alt", "Weg", [450, 340], [455, 345], [460, 340]);
        const [artikel] = await m<{ id: string }[]>`
            INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
            VALUES ('r6-wiki-weg', 'https://de.wiki-aventurica.de/wiki/R6_Wiki_Weg', 'R6 Wiki Weg', 'strasse', 'Weg')
            RETURNING id::text AS id`;
        await m`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/R6_Wiki_Weg', ${artikel!.id}::bigint, 'assigned'
              FROM path WHERE public_id = ${weg(80)}::uuid`;
        await m`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('path', ${weg(80)}::uuid, 'name', 'wiki')`;
        // 130 und 131 (WI-0302): eine Straße mit einem weiteren Straßennamen aus dem Import an 130.
        await linie(130, "R6 Weitere", "Weg", [450, 360], [455, 365], [460, 360]);
        await linie(131, "R6 Weitere", "Weg", [460, 360], [465, 365], [470, 360]);
        for (const buchstabe of ["a", "b"])
            await m`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                VALUES (${`r6-weiter-${buchstabe}`}, ${`https://de.wiki-aventurica.de/wiki/R6_Weiter_${buchstabe}`}, ${`R6 Weiter ${buchstabe.toUpperCase()}`}, 'strasse')`;
        await m`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT p.id, 'further', s.wiki_url, s.id, 'assigned', 'legacy_editor'
              FROM path p, wiki_path_snapshot s WHERE p.public_id = ${weg(130)}::uuid AND s.wiki_key = 'r6-weiter-a'`;
        // 100 bis 102 (WI-0265 B8a): Teilen; 112 bis 115: Felder und Kurve in einem Schritt, mit einem mitgezogenen Nachbarweg.
        await linie(100, "R8a Teilen", "Weg", [100, 500], [110, 505], [120, 500], [130, 505], [140, 500]);
        await linie(101, "R8a Teilen Konflikt", "Weg", [100, 520], [110, 525], [120, 520], [130, 525], [140, 520]);
        await linie(102, "R8a Teilen Abgenommen", "Weg", [100, 540], [110, 545], [120, 540], [130, 545], [140, 540]);
        await linie(112, "R8a Felder Kurve", "Weg", [800, 100], [810, 105], [820, 100], [830, 105]);
        await linie(113, "R8a Felder Kurve Nachbar", "Weg", [820, 100], [825, 90], [830, 80]);
        await linie(114, "R8a Felder Kurve Zwei", "Weg", [800, 140], [810, 145], [820, 140], [830, 145]);
        await linie(115, "R8a Felder Kurve Zwei Nachbar", "Weg", [820, 140], [825, 130], [830, 120]);
        await linie(60, "R6 Sperre", "Weg", [150, 400], [155, 405], [160, 400]);
        await linie(61, "R6 Recht", "Weg", [150, 420], [155, 425], [160, 420]);
        const fixture = authFixture(cluster.admin);
        const person = async (name: string, role: "editor" | "reviewer"): Promise<Person> => {
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

    it("🔴 Felder einer Serie (U4, U5, U8, Gate 2): drei „Fertig“ an einer Straße sind EINE Serie; ein früheres Mitglied einzeln ist überholt, Bernd nimmt sie nur mit Grund zurück, alles geht auf den Stand davor", async () => {
        const a = await aktualisiere(anna, 1, [1], { name: "R6 Weg Eins Neu", labelVisible: true });
        const b = await aktualisiere(anna, 1, [1], {}, { 1: { tunnel: true } });
        const c = await aktualisiere(anna, 1, [1], { subtype: "Pfad" });
        const s = await serie(anna, 1);
        expect(s).toMatchObject({ size: 3, members: [a, b, c], scope: { kind: "path", id: weg(1) } });
        const vorherZustand = await stand([1]);
        expect(vorherZustand.wege[0]).toMatchObject({
            name: "R6 Weg Eins Neu",
            subtype: "Pfad",
            label_visible: true,
            is_tunnel: true,
        });

        // U5: ein früheres Mitglied einzeln ist überholt („überholt durch Schritt …“), nichts wird geschrieben.
        const einzel = (await vorschau(anna, 1, [a])).json() as RuecknahmePruefung;
        expect(einzel.ergebnis).toBe("edit_conflict");
        expect(einzel.konflikte).toContainEqual(expect.objectContaining({ art: "ueberholt" }));

        // Bernd ist eine andere Person: ohne Grund keine Rücknahme (Gate 2), 0 Mutationen.
        const pruefung = (await vorschau(bernd, 1, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [a, b, c], reasonRequired: true, konflikte: [] });
        expect(pruefung.folgen).toMatchObject({ gelaende: "keines" });
        const ohneGrund = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash);
        expect([ohneGrund.statusCode, ohneGrund.json().error.code]).toEqual([400, "reason_required"]);
        expect(await stand([1])).toEqual(vorherZustand);

        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
        const operationId = randomUUID();
        const grund = "Falsch benannt und falsche Wegart";
        const antwort = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, { operationId, reason: grund });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; derivedWork: { kind: string }[] };
        expect(quittung.reverts).toEqual([a, b, c]);
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("routing");
        const nachher = await stand([1]);
        expect(nachher.wege[0]).toMatchObject({
            name: "R6 Weg Eins",
            subtype: "Weg",
            label_visible: false,
            is_tunnel: false,
        });
        // EINE Operation, drei Verknüpfungen, EIN Ereignis.
        expect(nachher.operationen).toBe(vorherZustand.operationen + 1);
        expect(nachher.verknuepfungen).toBe(vorherZustand.verknuepfungen + 3);
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
            ),
        ).toBe(1);
        const rueck = await eintrag(bernd, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "path.restore_series",
            reverts: [a, b, c],
            reason: grund,
        });
        const original = await eintrag(anna, a);
        expect(original).toMatchObject({ status: "bereits_zurueckgenommen" });
        expect(original.revertedBy).toMatchObject({ operationId, reason: grund });
        // Im Verlauf der Straße steht derselbe Zustand (eine Quelle, zwei Sichten, U12).
        const verlauf = (
            await app.inject({
                method: "GET",
                url: editorPathHistoryUrl(weg(1)),
                headers: { cookie: anna.cookie },
            })
        ).json() as MapHistoryPage;
        expect(verlauf.entries.find((e) => e.operationId === a)).toMatchObject({ status: "bereits_zurueckgenommen" });
        expect(verlauf.entries.find((e) => e.operationId === operationId)).toMatchObject({ source: "restore" });

        // U8: dieselbe Kennung gibt `replayed`, eine andere für dieselbe Liste `already_reverted`, nichts wird noch einmal geschrieben.
        const nochmal = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, { operationId, reason: grund });
        expect([nochmal.statusCode, nochmal.json().status, nochmal.json().operationId]).toEqual([
            200,
            "replayed",
            operationId,
        ]);
        const andere = await zuruecknehmen(anna, 1, s!.members, s!.membersHash);
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        expect(await stand([1])).toEqual(nachher);

        // Rücknahme einer Rücknahme: Auch eine Rücknahme MIT Grund ist ein Mitglied; ihr Grund (`restoreReason`) ist kein Feld des Wegs. Anna nimmt Bernds Rücknahme zurück (fremde Person: Grund).
        const zweitePruefung = (await vorschau(anna, 1, [operationId])).json() as RuecknahmePruefung;
        expect(zweitePruefung).toMatchObject({ ergebnis: "ok", offen: [operationId], reasonRequired: true });
        const wieder = await zuruecknehmen(anna, 1, [operationId], zweitePruefung.membersHash, {
            reason: "Doch richtig so",
        });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([1])).wege[0]).toMatchObject({
            name: "R6 Weg Eins Neu",
            subtype: "Pfad",
            label_visible: true,
            is_tunnel: true,
        });
    });

    it("🔴 Felder je Abschnitt und der Straße: Kennzeichen, Reisemittel, Tunnel (Landweg) und Bach samt Fließrichtung (Fluss) gehen auf den Stand davor; Unberührtes bleibt, wie es ist", async () => {
        const reisen = { liste: ["groupFoot", "horseCarriage"], fenster: {} };
        const op = await aktualisiere(
            anna,
            70,
            [70, 71],
            { mark: "karawanenroute" },
            { 70: { tunnel: true, reisen }, 71: { tunnel: false } },
        );
        const wasser = await aktualisiere(anna, 72, [72], {}, { 72: { bach: true, flowDirection: "reverse" } });
        const zeilen = (): Promise<Record<string, unknown>[]> =>
            cluster.admin`
                SELECT public_id::text, mark, is_tunnel, is_bach, flow_direction, allowed_transports, transports_written
                  FROM path WHERE public_id = ANY(${[70, 71, 72].map(weg)}::uuid[]) ORDER BY public_id`;
        expect((await zeilen()).map((z) => [z["mark"], z["is_tunnel"], z["is_bach"], z["flow_direction"]])).toEqual([
            ["karawanenroute", true, false, null],
            ["karawanenroute", false, false, null],
            [null, false, true, "reverse"],
        ]);
        const hash = await pruefsumme(anna, 70, [op]);
        expect(((await vorschau(anna, 70, [op], hash)).json() as RuecknahmePruefung).ergebnis).toBe("ok");
        const antwort = await zuruecknehmen(anna, 70, [op], hash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const nachFeldern = await zeilen();
        expect(nachFeldern.map((z) => [z["mark"], z["is_tunnel"], z["transports_written"]])).toEqual([
            [null, false, false],
            [null, false, false],
            [null, false, false],
        ]);
        // Die Reisemittel stehen wieder auf der Vorgabe (ungeschrieben, ohne Liste); der Fluss blieb, wie er war.
        expect(nachFeldern[0]!["allowed_transports"]).toBeNull();
        expect([nachFeldern[2]!["is_bach"], nachFeldern[2]!["flow_direction"]]).toEqual([true, "reverse"]);
        const hashWasser = await pruefsumme(anna, 72, [wasser]);
        const wasserAntwort = await zuruecknehmen(anna, 72, [wasser], hashWasser);
        expect(wasserAntwort.statusCode, wasserAntwort.body).toBe(200);
        expect((await zeilen())[2]).toMatchObject({ is_bach: false, flow_direction: null });
    });

    it("🔴 Weitere Straßennamen (WI-0302): ↺ holt die Liste von vorher zurück, an denselben Zeilen mit ihrer Herkunft, ohne Aufträge; die Rücknahme davon bringt die Liste danach wieder", async () => {
        const zeilen = async () =>
            cluster.admin<{ key: string; origin: string; aktiv: boolean; still: string | null; zeile: string }[]>`
                SELECT s.wiki_key AS key, w.assignment_origin AS origin, w.is_active AS aktiv, w.retired_origin AS still, w.id::text AS zeile
                  FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                 WHERE p.public_id = ${weg(130)}::uuid AND w.role = 'further' ORDER BY s.wiki_key, w.id`;
        const [ausImport] = await zeilen();
        const op = await aktualisiere(anna, 131, [130, 131], {}, { 130: { weitere: ["r6-weiter-b"] } });
        const nachSchritt = await zeilen();
        expect(nachSchritt.map((z) => [z.key, z.origin, z.aktiv, z.still])).toEqual([
            ["r6-weiter-a", "legacy_editor", false, "editor"],
            ["r6-weiter-b", "editor", true, null],
        ]);
        const hash = await pruefsumme(anna, 130, [op]);
        expect(((await vorschau(anna, 130, [op], hash)).json() as RuecknahmePruefung).ergebnis).toBe("ok");
        const rueck = await zuruecknehmen(anna, 130, [op], hash);
        expect(rueck.statusCode, rueck.body).toBe(200);
        // Nur weitere Straßennamen: kein Auftrag für Wegprofil, Schriftläufe oder Wegfindung.
        expect((rueck.json() as { derivedWork: { kind: string }[] }).derivedWork.map((arbeit) => arbeit.kind)).toEqual([
            "tiles",
        ]);
        expect((await zeilen()).map((z) => [z.key, z.origin, z.aktiv, z.zeile])).toEqual([
            ["r6-weiter-a", "legacy_editor", true, ausImport!.zeile],
            ["r6-weiter-b", "editor", false, nachSchritt[1]!.zeile],
        ]);
        const rueckId = operationIdVon(rueck);
        expect(
            await cluster.admin`
                SELECT path_public_id::text AS id, changes->'weitere' AS weitere FROM map_audit_event WHERE operation_id = ${rueckId}::uuid`,
        ).toEqual([
            {
                id: weg(130),
                weitere: {
                    before: [{ key: "r6-weiter-b", name: "R6 Weiter B" }],
                    after: [{ key: "r6-weiter-a", name: "R6 Weiter A" }],
                },
            },
        ]);
        // Die Rücknahme der Rücknahme: die Liste nach dem Schritt, wieder an denselben Zeilen.
        const wieder = await zuruecknehmen(anna, 130, [rueckId], await pruefsumme(anna, 130, [rueckId]));
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await zeilen()).map((z) => [z.key, z.aktiv, z.zeile])).toEqual([
            ["r6-weiter-a", false, ausImport!.zeile],
            ["r6-weiter-b", true, nachSchritt[1]!.zeile],
        ]);
    });

    it("🔴 Wiki-Herkunft (WI-0225 §7): folgte der Name vorher dem Wiki, kommt er als Wiki-Wert zurück (nicht als der eigene Wert von vorher) und die Herkunft mit ihm", async () => {
        const op = await aktualisiere(anna, 80, [80], { name: "R6 Wiki Eigen" });
        const herkunft = async (): Promise<unknown[]> =>
            (
                await cluster.admin<{ origin: string }[]>`
                    SELECT origin FROM field_origin WHERE object_kind = 'path' AND object_id = ${weg(80)}::uuid AND field = 'name'`
            ).map((zeile) => zeile.origin);
        expect(await herkunft()).toEqual(["manual"]);
        const hash = await pruefsumme(anna, 80, [op]);
        const antwort = await zuruecknehmen(anna, 80, [op], hash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Der Name des Wiki-Artikels, nicht der Name „R6 Wiki Alt“ von vorher: die Herkunft wiki sagt, dass der Wert dem Wiki folgt.
        expect((await stand([80])).wege[0]).toMatchObject({ name: "R6 Wiki Weg" });
        expect(await herkunft()).toEqual(["wiki"]);
    });

    it("🔴 Mehrscope: EINE Operation über drei Abschnitte (Umbenennen, „Name auf der Karte“, Tunnel an einem Abschnitt) geht in EINER Operation zurück, auch unter einem mittleren Abschnitt; ein Abschnitt, den die Operation nie berührte, ist nicht von hier", async () => {
        const op = await aktualisiere(
            anna,
            2,
            [2, 3, 4],
            { name: "R6 Straße Zwei Neu", labelVisible: true },
            { 4: { tunnel: true } },
        );
        const nachOperation = await stand([2, 3, 4]);
        expect(nachOperation.wege.map((w) => [w["name"], w["label_visible"], w["is_tunnel"]])).toEqual([
            ["R6 Straße Zwei Neu", true, false],
            ["R6 Straße Zwei Neu", true, false],
            ["R6 Straße Zwei Neu", true, true],
        ]);
        // Die Route hängt an einem Abschnitt, den die Operation berührte: hier der mittlere.
        const pruefung = (await vorschau(anna, 3, [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op], reasonRequired: false, konflikte: [] });
        expect(pruefung.gegenstaende.map((g) => g.kind)).toEqual(["path", "path", "path"]);
        // Ein Abschnitt einer anderen Straße (die Operation berührte ihn nie): die Liste ist nicht von hier.
        const fremd = await zuruecknehmen(anna, 1, [op], pruefung.membersHash);
        expect([fremd.statusCode, fremd.json().error.code]).toEqual([400, "invalid_members"]);
        expect(await stand([2, 3, 4])).toEqual(nachOperation);

        const antwort = await zuruecknehmen(anna, 3, [op], pruefung.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; affected: { kind: string; id: string }[] };
        expect(quittung.reverts).toEqual([op]);
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([2, 3, 4].map(weg).sort());
        const nachher = await stand([2, 3, 4]);
        expect(nachher.wege.map((w) => [w["name"], w["label_visible"], w["is_tunnel"]])).toEqual([
            ["R6 Straße Zwei", false, false],
            ["R6 Straße Zwei", false, false],
            ["R6 Straße Zwei", false, false],
        ]);
        expect(nachher.operationen).toBe(nachOperation.operationen + 1);
        expect(nachher.verknuepfungen).toBe(nachOperation.verknuepfungen + 1);
    });

    it("🔴 U6 Mehrscope: hat jemand NUR EINEN der drei Abschnitte seither geändert, geht nichts zurück: 409 mit dem Abschnitt, der Person und der Zeit, 0 Mutationen, 0 Aufträge", async () => {
        const op = await aktualisiere(anna, 5, [5, 6, 7], { name: "R6 Straße Drei Neu" });
        // Bernd ändert nur den Tunnel des mittleren Abschnitts: eine zweite Operation, die nur Abschnitt 6 berührt.
        const fremd = await aktualisiere(bernd, 5, [5, 6, 7], {}, { 6: { tunnel: true } });
        const vorher = await stand([5, 6, 7]);
        const pruefung = (await vorschau(anna, 5, [op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "path",
                id: weg(6),
                operationId: fremd,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        // Die beiden anderen Abschnitte sind unverändert und stehen nicht in der Liste.
        expect(pruefung.konflikte.map((k) => k.id)).toEqual([weg(6)]);
        const antwort = await zuruecknehmen(anna, 5, [op], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "path", id: weg(6), art: "spaeter" }),
        );
        expect(await stand([5, 6, 7])).toEqual(vorher);
    });

    it("🔴 Felder der ganzen Straße: heißt die Straße seit der Umbenennung wie eine andere, geht der Name nicht zurück (`weg_strasse`), denn er schriebe auch die Abschnitte der anderen Straße um", async () => {
        const op = await aktualisiere(anna, 10, [10], { name: "R6 Merge Neu" });
        const vorher = await stand([10, 11]);
        const pruefung = (await vorschau(anna, 10, [op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "path",
                id: weg(11),
                felder: ["name"],
                abweichung: { was: "weg_strasse" },
            }),
        );
        const antwort = await zuruecknehmen(anna, 10, [op], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "path", id: weg(11), abweichung: { was: "weg_strasse" } }),
        );
        expect(await stand([10, 11])).toEqual(vorher);
    });

    it("🔴 OPS-000098: Ist der Name geleert, ist jeder Abschnitt seine eigene Straße; Name und danach Wegtyp gehen trotzdem an allen drei zurück", async () => {
        // Wie beim Dergel: Reisemittel je Abschnitt verschieden, dann Wegtyp, dann Name; zurück von oben nach unten.
        await aktualisiere(
            anna,
            120,
            [120, 121, 122],
            {},
            {
                120: { reisen: { liste: ["riverBarge"], fenster: {} } },
                121: { reisen: { liste: ["riverSailer", "riverBarge"], fenster: {} } },
                122: { reisen: { liste: ["riverBarge", "rowboat"], fenster: {} } },
            },
        );
        const reisen = async () =>
            (
                await cluster.admin<{ id: string; liste: string[] | null }[]>`
                    SELECT public_id::text AS id, allowed_transports AS liste FROM path
                     WHERE public_id = ANY(${[120, 121, 122].map(weg)}::uuid[]) ORDER BY public_id`
            ).map((z) => z.liste);
        const reisenVorher = await reisen();
        expect(reisenVorher).toEqual([["riverBarge"], ["riverSailer", "riverBarge"], ["riverBarge", "rowboat"]]);
        const typ = await aktualisiere(anna, 120, [120, 121, 122], { subtype: "Weg" });
        const name = await aktualisiere(anna, 120, [120, 121, 122], { name: "" });
        const nachher = await stand([120, 121, 122]);
        expect(nachher.wege.map((w) => [w["name"], w["subtype"]])).toEqual([
            ["", "Weg"],
            ["", "Weg"],
            ["", "Weg"],
        ]);
        // Zuerst der Name, an einem Abschnitt, der heute nur noch seine eigene Straße ist.
        const pruefung = (await vorschau(anna, 121, [name])).json() as RuecknahmePruefung;
        expect(pruefung.konflikte).toEqual([]);
        expect(pruefung.ergebnis).toBe("ok");
        const zurueck = await zuruecknehmen(anna, 121, [name], pruefung.membersHash);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect((await stand([120, 121, 122])).wege.map((w) => [w["name"], w["subtype"]])).toEqual([
            ["R6 Dergel", "Weg"],
            ["R6 Dergel", "Weg"],
            ["R6 Dergel", "Weg"],
        ]);
        expect((await stand([120, 121, 122])).operationen).toBe(nachher.operationen + 1);
        // Dann der Wegtyp: Die Straße ist wieder eine.
        const zweite = (await vorschau(anna, 120, [typ])).json() as RuecknahmePruefung;
        expect(zweite.konflikte).toEqual([]);
        const typZurueck = await zuruecknehmen(anna, 120, [typ], zweite.membersHash);
        expect(typZurueck.statusCode, typZurueck.body).toBe(200);
        expect((await stand([120, 121, 122])).wege.map((w) => [w["name"], w["subtype"]])).toEqual([
            ["R6 Dergel", "Flussweg"],
            ["R6 Dergel", "Flussweg"],
            ["R6 Dergel", "Flussweg"],
        ]);
        // Je Abschnitt seine Reisemittel von vorher, nicht ein gemeinsamer Wert.
        expect(await reisen()).toEqual(reisenVorher);
    });

    it("🔴 Kurve: die Linie, der mitgezogene Punkt des Nachbarwegs und beide Revisionen gehen in EINER Operation zurück; hat jemand den Nachbarweg seither geändert, geht nichts zurück (U6, U8)", async () => {
        const op = await forme(
            anna,
            20,
            [
                { x: 100, y: 100 },
                { x: 110, y: 105 },
                { x: 122, y: 98 },
                { x: 130, y: 105 },
            ],
            [{ n: 21, index: 0, from: { x: 120, y: 100 }, to: { x: 122, y: 98 } }],
        );
        const nach = await stand([20, 21]);
        expect(nach.wege.map((w) => w["linie"])).toEqual([
            "LINESTRING(100 100,110 105,122 98,130 105)",
            "LINESTRING(122 98,125 90,130 80)",
        ]);
        const pruefung = (await vorschau(anna, 20, [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op], konflikte: [], folgen: { gelaende: "keines" } });
        expect(pruefung.gegenstaende.map((g) => g.id).sort()).toEqual([weg(20), weg(21)].sort());

        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 20, [op], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; derivedWork: { kind: string }[] };
        expect(quittung.reverts).toEqual([op]);
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual(expect.arrayContaining(["path_visual", "routing"]));
        const nachher = await stand([20, 21]);
        expect(nachher.wege.map((w) => w["linie"])).toEqual([
            "LINESTRING(100 100,110 105,120 100,130 105)",
            "LINESTRING(120 100,125 90,130 80)",
        ]);
        expect(nachher.operationen).toBe(nach.operationen + 1);
        expect(nachher.verknuepfungen).toBe(nach.verknuepfungen + 1);
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
            ),
        ).toBe(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [op] });
        expect(rueck.objects.map((o) => o.action).sort()).toEqual(["path.carried", "path.reshaped"]);
        // Die Rücknahme selbst lässt sich zurücknehmen (Rücknahme einer Rücknahme): die Kurve steht wieder, wo sie war.
        const nochmal = await zuruecknehmen(anna, 20, [op], pruefung.membersHash, { operationId });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const zweitePruefung = (await vorschau(anna, 20, [operationId])).json() as RuecknahmePruefung;
        expect(zweitePruefung.ergebnis).toBe("ok");
        const wieder = await zuruecknehmen(anna, 20, [operationId], zweitePruefung.membersHash);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([20, 21])).wege.map((w) => w["linie"])).toEqual(nach.wege.map((w) => w["linie"]));

        // Fremdänderung am Nachbarweg: ein zweiter Fall derselben Form.
        const zwei = await forme(
            anna,
            22,
            [
                { x: 100, y: 140 },
                { x: 110, y: 145 },
                { x: 122, y: 138 },
                { x: 130, y: 145 },
            ],
            [{ n: 23, index: 0, from: { x: 120, y: 140 }, to: { x: 122, y: 138 } }],
        );
        const fremd = await forme(bernd, 23, [
            { x: 122, y: 138 },
            { x: 125, y: 128 },
            { x: 135, y: 118 },
        ]);
        const vorher = await stand([22, 23]);
        const gepruft = (await vorschau(anna, 22, [zwei])).json() as RuecknahmePruefung;
        expect(gepruft.ergebnis).toBe("edit_conflict");
        expect(gepruft.konflikte).toContainEqual(
            expect.objectContaining({ art: "spaeter", id: weg(23), operationId: fremd }),
        );
        const abgewiesen = await zuruecknehmen(anna, 22, [zwei], gepruft.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([22, 23])).toEqual(vorher);
    });

    it("🔴 Kurve am Fluss (WI-0259): die Höhe wandert mit der Kurve und mit ihrer Rücknahme zurück an den alten Stützpunkt; `wasserHoehen` steht im Protokoll, das Gelände wird als Folge genannt", async () => {
        expect(await hoehen()).toMatchObject([{ art: "fluss", lage: "POINT(410 405)", height_schritt: 1500 }]);
        const op = await forme(anna, 30, [
            { x: 400, y: 400 },
            { x: 412, y: 407 },
            { x: 420, y: 400 },
        ]);
        expect(await hoehen()).toMatchObject([{ lage: "POINT(412 407)" }]);
        const pruefung = (await vorschau(anna, 30, [op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("ok");
        // Die Kurve umzog eine Höhe: Das Blatt nennt das Gelände als Folge (nie „keines“).
        expect(pruefung.folgen.gelaende).not.toBe("keines");
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 30, [op], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { affected: { kind: string }[] }).affected.map((a) => a.kind)).toEqual(
            expect.arrayContaining(["path", "terrain_control"]),
        );
        expect(await hoehen()).toMatchObject([{ lage: "POINT(410 405)", height_schritt: 1500 }]);
        expect((await stand([30])).wege[0]!["linie"]).toBe("LINESTRING(400 400,410 405,420 400)");
        const rueck = await eintrag(anna, operationId);
        const wegEintrag = rueck.objects.find((o) => o.kind === "path");
        expect(wegEintrag?.changes["wasserHoehen"]).toBeDefined();
    });

    it("🔴 Stand: „Ganz löschen“ einer Straße aus zwei Abschnitten kommt in EINER Operation zurück (unter jedem Abschnitt), die Rücknahme selbst lässt sich zurücknehmen; Von der Karte nehmen kommt zurück auf die Karte", async () => {
        const antwort = await sende(anna, editorPathStreetDeleteUrl(weg(40)), {
            operationId: randomUUID(),
            sections: await abschnitte([40, 41]),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const geloescht = operationIdVon(antwort);
        expect((await stand([40, 41])).wege.map((w) => w["is_active"])).toEqual([false, false]);
        const pruefung = (await vorschau(anna, 41, [geloescht])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [geloescht], konflikte: [] });
        const operationId = randomUUID();
        const zurueck = await zuruecknehmen(anna, 41, [geloescht], pruefung.membersHash, { operationId });
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect((await stand([40, 41])).wege.map((w) => [w["is_active"], w["off_map"]])).toEqual([
            [true, false],
            [true, false],
        ]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [geloescht] });
        expect(rueck.objects.map((o) => o.action)).toEqual(["path.restored", "path.restored"]);
        // Wieder löschen heißt die Rücknahme der Rücknahme (ein Mitglied, das selbst eine Rücknahme ist).
        const nochmal = (await vorschau(anna, 40, [operationId])).json() as RuecknahmePruefung;
        expect(nochmal.ergebnis).toBe("ok");
        const wieder = await zuruecknehmen(anna, 40, [operationId], nochmal.membersHash);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([40, 41])).wege.map((w) => [w["is_active"], w["off_map"]])).toEqual([
            [false, false],
            [false, false],
        ]);

        // Von der Karte nehmen und zurück.
        const ab = await sende(anna, editorPathTakeOffMapUrl(weg(42)), {
            operationId: randomUUID(),
            baseRevision: await revision(42),
        });
        expect(ab.statusCode, ab.body).toBe(200);
        const abgenommen = operationIdVon(ab);
        expect((await stand([42])).wege[0]).toMatchObject({ is_active: false, off_map: true });
        const abPruefung = (await vorschau(anna, 42, [abgenommen])).json() as RuecknahmePruefung;
        expect(abPruefung.ergebnis).toBe("ok");
        const auf = await zuruecknehmen(anna, 42, [abgenommen], abPruefung.membersHash);
        expect(auf.statusCode, auf.body).toBe(200);
        expect((await stand([42])).wege[0]).toMatchObject({ is_active: true, off_map: false });
        // Ein zweites Mal derselbe Wechsel mit anderer Kennung: schon zurückgenommen (U8).
        const doppelt = await zuruecknehmen(anna, 42, [abgenommen], abPruefung.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);
    });

    it("🔴 Stand: ein Weg, der vor „Ganz löschen“ von der Karte genommen war, kommt über keinen Wechsel dorthin zurück (`weg_wert`): 409, nichts geschrieben", async () => {
        const ab = await sende(anna, editorPathTakeOffMapUrl(weg(43)), {
            operationId: randomUUID(),
            baseRevision: await revision(43),
        });
        expect(ab.statusCode, ab.body).toBe(200);
        const loesch = await sende(anna, editorPathDeleteUrl(weg(43)), {
            operationId: randomUUID(),
            baseRevision: await revision(43),
        });
        expect(loesch.statusCode, loesch.body).toBe(200);
        const geloescht = operationIdVon(loesch);
        const vorher = await stand([43]);
        const pruefung = (await vorschau(anna, 43, [geloescht])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", id: weg(43), abweichung: { was: "weg_wert" } }),
        );
        const antwort = await zuruecknehmen(anna, 43, [geloescht], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([43])).toEqual(vorher);
    });

    it("🔴 Umgruppieren („Auswahl zu neuem Weg“, B6a2): Namen, Herkunft und die stillgelegten Wiki-Zuordnungen beider Abschnitte kommen in EINER Operation zurück; die Rücknahme selbst lässt sich zurücknehmen (B8a2) und deren Rücknahme wieder; ein seither geänderter Abschnitt hält sie an", async () => {
        const aktiv = async (): Promise<number> =>
            zahl(
                cluster.admin<{ n: string }[]>`
                    SELECT count(*)::text AS n FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                     WHERE p.public_id = ANY(${[51, 52].map(weg)}::uuid[]) AND w.is_active`,
            );
        const x2 = async (): Promise<number> =>
            zahl(
                cluster.admin<{ n: string }[]>`
                    SELECT count(*)::text AS n FROM wiki_key_assignment WHERE object_public_id = ANY(${[51, 52].map(weg)}::uuid[]) AND is_active`,
            );
        expect([await aktiv(), await x2()]).toEqual([2, 2]);
        const gruppe = await sende(anna, EDITOR_PATHS_NEUER_WEG_URL, {
            operationId: randomUUID(),
            name: "R6 Gruppe Neu",
            sections: await abschnitte([51, 52]),
        });
        expect(gruppe.statusCode, gruppe.body).toBe(200);
        const gruppiert = operationIdVon(gruppe);
        expect([await aktiv(), await x2()]).toEqual([0, 0]);
        expect((await stand([51, 52])).wege.map((w) => w["name"])).toEqual(["R6 Gruppe Neu", "R6 Gruppe Neu"]);

        // Bernd ändert den Tunnel an EINEM Abschnitt der neuen Straße: Die Gruppe geht nicht zurück (alles oder nichts), 0 Änderungen.
        const fremd = await aktualisiere(bernd, 51, [51, 52], {}, { 51: { tunnel: true } });
        const vorher = await stand([51, 52]);
        const gesperrt = (await vorschau(anna, 51, [gruppiert])).json() as RuecknahmePruefung;
        expect(gesperrt.ergebnis).toBe("edit_conflict");
        expect(gesperrt.konflikte).toContainEqual(
            expect.objectContaining({ art: "spaeter", id: weg(51), operationId: fremd }),
        );
        expect((await zuruecknehmen(anna, 51, [gruppiert], gesperrt.membersHash)).statusCode).toBe(409);
        expect(await stand([51, 52])).toEqual(vorher);
        // Bernds Änderung zurück (von hinten), dann geht die Gruppe.
        const bernds = (await vorschau(bernd, 51, [fremd])).json() as RuecknahmePruefung;
        expect((await zuruecknehmen(bernd, 51, [fremd], bernds.membersHash)).statusCode).toBe(200);
        expect((await stand([51, 52])).wege.map((w) => w["name"])).toEqual(["R6 Gruppe Neu", "R6 Gruppe Neu"]);

        const pruefung = (await vorschau(anna, 52, [gruppiert])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [gruppiert], konflikte: [], reasonRequired: false });
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 52, [gruppiert], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((await stand([51, 52])).wege.map((w) => w["name"])).toEqual(["R6 Gruppe Alt A", "R6 Gruppe Alt B"]);
        expect([await aktiv(), await x2()]).toEqual([2, 2]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [gruppiert] });
        expect(rueck.objects.map((o) => o.action)).toEqual(["path.regrouped", "path.regrouped"]);
        // Replay und doppelte Rücknahme (U8).
        const nochmal = await zuruecknehmen(anna, 52, [gruppiert], pruefung.membersHash, { operationId });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const doppelt = await zuruecknehmen(anna, 52, [gruppiert], pruefung.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);

        // B8a2, streng: Hat jemand einen Abschnitt seit der Rücknahme umbenannt, gruppiert sie nicht wieder (ganz oder gar nicht).
        const umbenannt = await aktualisiere(bernd, 52, [52], { name: "R6 Gruppe Zufall" });
        const vorherAlt = await stand([51, 52]);
        const gesperrtWieder = (await vorschau(anna, 51, [operationId])).json() as RuecknahmePruefung;
        expect(gesperrtWieder.ergebnis).toBe("edit_conflict");
        expect(gesperrtWieder.konflikte).toContainEqual(
            expect.objectContaining({ art: "spaeter", id: weg(52), operationId: umbenannt }),
        );
        const abgewiesen = await zuruecknehmen(anna, 51, [operationId], gesperrtWieder.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([51, 52])).toEqual(vorherAlt);
        expect((await zuruecknehmen(bernd, 52, [umbenannt], await pruefsumme(bernd, 52, [umbenannt]))).statusCode).toBe(
            200,
        );

        // B8a2: Die Rücknahme selbst lässt sich zurücknehmen: die Auswahl ist wieder EIN Weg, mit denselben Namen wie nach der Operation, die Zuordnungen wieder still gelegt.
        const umkehr = (await vorschau(anna, 51, [operationId])).json() as RuecknahmePruefung;
        expect(umkehr).toMatchObject({ ergebnis: "ok", offen: [operationId], konflikte: [], reasonRequired: false });
        const wiederId = randomUUID();
        const wieder = await zuruecknehmen(anna, 51, [operationId], umkehr.membersHash, { operationId: wiederId });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([51, 52])).wege.map((w) => w["name"])).toEqual(["R6 Gruppe Neu", "R6 Gruppe Neu"]);
        expect([await aktiv(), await x2()]).toEqual([0, 0]);
        const wiederEintrag = await eintrag(anna, wiederId);
        expect(wiederEintrag).toMatchObject({
            source: "restore",
            operation: "path.restore_series",
            reverts: [operationId],
        });
        expect(wiederEintrag.objects.map((o) => o.action)).toEqual(["path.regrouped_again", "path.regrouped_again"]);
        // Replay und doppelt (U8).
        const replay = await zuruecknehmen(anna, 51, [operationId], umkehr.membersHash, { operationId: wiederId });
        expect([replay.statusCode, replay.json().status]).toEqual([200, "replayed"]);
        const nochDoppelt = await zuruecknehmen(anna, 51, [operationId], umkehr.membersHash);
        expect([nochDoppelt.statusCode, nochDoppelt.json().error.code]).toEqual([409, "already_reverted"]);

        // Und deren Rücknahme (dieselbe Rücknahme wie für das Original) bringt die Namen und Zuordnungen wieder zurück.
        const dritte = await zuruecknehmen(anna, 51, [wiederId], await pruefsumme(anna, 51, [wiederId]));
        expect(dritte.statusCode, dritte.body).toBe(200);
        expect((await stand([51, 52])).wege.map((w) => w["name"])).toEqual(["R6 Gruppe Alt A", "R6 Gruppe Alt B"]);
        expect([await aktiv(), await x2()]).toEqual([2, 2]);
        expect((await eintrag(anna, dritte.json().operationId)).objects.map((o) => o.action)).toEqual([
            "path.regrouped",
            "path.regrouped",
        ]);
        // Hat jemand eine Zuordnung seit der Rücknahme anderweitig stillgelegt (die Revision des Abschnitts ändert das nicht), gruppiert die Gegenrichtung nicht wieder: ein Konflikt, geschrieben wird nichts.
        const vorDritter = await stand([51, 52]);
        await cluster.admin`
            UPDATE path_wiki_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE path_id = (SELECT id FROM path WHERE public_id = ${weg(51)}::uuid) AND is_active`;
        const zuordnungWeg = (await vorschau(anna, 51, [dritte.json().operationId])).json() as RuecknahmePruefung;
        expect(zuordnungWeg.ergebnis).not.toBe("ok");
        expect(await stand([51, 52])).toEqual(vorDritter);
    });

    it("🔴 Verbinden („Wege verbinden“, B6a2): die Vorlage bekommt ihre Linie, der zweite Abschnitt kommt zurück auf die Karte, in EINER Operation; die Rücknahme verlangt das Geometrie-Recht und lässt sich selbst zurücknehmen (B8a2): die Abschnitte sind wieder EIN Weg, deren Rücknahme trennt wieder", async () => {
        const verbinden = await sende(anna, EDITOR_PATHS_VERBINDEN_URL, {
            operationId: randomUUID(),
            vorlage: weg(90),
            sections: await abschnitte([90, 91]),
        });
        expect(verbinden.statusCode, verbinden.body).toBe(200);
        const verbunden = operationIdVon(verbinden);
        const nach = await stand([90, 91]);
        expect(nach.wege.map((w) => [w["linie"], w["is_active"]])).toEqual([
            ["LINESTRING(500 300,505 305,510 300,515 305,520 300)", true],
            ["LINESTRING(510 300,515 305,520 300)", false],
        ]);
        // Das Recht der Lage: ohne `edit_map_geometry` verbietet die Vorprüfung (F.1), mit beiden Rechten geht es.
        const nurSache: RuecknahmeLeser = {
            personId: anna.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        expect(await vorschauWeg(cluster.app, weg(91), { members: [verbunden] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_map_geometry"],
        });
        const pruefung = (await vorschau(anna, 91, [verbunden])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [verbunden],
            konflikte: [],
            folgen: { gegenstaende: 2 },
        });
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 91, [verbunden], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const vorher = await stand([90, 91]);
        expect(vorher.wege.map((w) => [w["linie"], w["is_active"]])).toEqual([
            ["LINESTRING(500 300,505 305,510 300)", true],
            ["LINESTRING(510 300,515 305,520 300)", true],
        ]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [verbunden] });
        expect((await eintrag(anna, verbunden)).status).toBe("bereits_zurueckgenommen");

        // B8a2, streng: Hat jemand die Straße seit der Rücknahme umbenannt (beide Abschnitte), verbindet sie nicht wieder (ganz oder gar nicht).
        const umbenannt = await aktualisiere(bernd, 90, [90, 91], { name: "R6 Kette Zufall" });
        const vorherGetrennt = await stand([90, 91]);
        const gesperrt = (await vorschau(anna, 90, [operationId])).json() as RuecknahmePruefung;
        expect(gesperrt.ergebnis).toBe("edit_conflict");
        expect(gesperrt.konflikte.map((k) => k.id).sort()).toEqual([weg(90), weg(91)].sort());
        const abgewiesen = await zuruecknehmen(anna, 90, [operationId], gesperrt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([90, 91])).toEqual(vorherGetrennt);
        expect((await zuruecknehmen(bernd, 90, [umbenannt], await pruefsumme(bernd, 90, [umbenannt]))).statusCode).toBe(
            200,
        );

        // B8a2: Die Rücknahme selbst lässt sich zurücknehmen: die Abschnitte sind wieder EIN Weg (Linie der Vorlage wie nach dem Original, der zweite still gelegt, nicht abgenommen), in EINER Operation.
        const umkehr = (await vorschau(anna, 90, [operationId])).json() as RuecknahmePruefung;
        expect(umkehr).toMatchObject({
            ergebnis: "ok",
            offen: [operationId],
            konflikte: [],
            folgen: { gegenstaende: 2 },
        });
        await cluster.admin`DELETE FROM job_event`;
        const wiederId = randomUUID();
        const wieder = await zuruecknehmen(anna, 90, [operationId], umkehr.membersHash, { operationId: wiederId });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([90, 91])).wege.map((w) => [w["linie"], w["is_active"], w["off_map"]])).toEqual([
            ["LINESTRING(500 300,505 305,510 300,515 305,520 300)", true, false],
            ["LINESTRING(510 300,515 305,520 300)", false, false],
        ]);
        expect(await ereignisse()).toBe(1);
        expect((await topologie([weg(90), weg(91)])).plans.map((p) => p.publicId)).toEqual([weg(90)]);
        const wiederEintrag = await eintrag(anna, wiederId);
        expect(wiederEintrag).toMatchObject({
            source: "restore",
            operation: "path.restore_series",
            reverts: [operationId],
        });
        expect(wiederEintrag.objects.map((o) => o.action)).toEqual(["path.merged", "path.merged"]);
        const replay = await zuruecknehmen(anna, 90, [operationId], umkehr.membersHash, { operationId: wiederId });
        expect([replay.statusCode, replay.json().status]).toEqual([200, "replayed"]);
        const doppelt = await zuruecknehmen(anna, 90, [operationId], umkehr.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);

        // Deren Rücknahme trennt wieder (die Abschnitte kommen zurück auf die Karte), und auch die geht zurück: wieder verbunden.
        const trennen = await zuruecknehmen(anna, 90, [wiederId], await pruefsumme(anna, 90, [wiederId]));
        expect(trennen.statusCode, trennen.body).toBe(200);
        expect((await stand([90, 91])).wege.map((w) => [w["linie"], w["is_active"]])).toEqual(
            vorher.wege.map((w) => [w["linie"], w["is_active"]]),
        );
        expect((await topologie([weg(90), weg(91)])).plans).toHaveLength(2);
        const trennenId: string = trennen.json().operationId;
        expect((await eintrag(anna, trennenId)).objects.map((o) => o.action)).toEqual(["path.split", "path.created"]);
        const nochmal = await zuruecknehmen(anna, 90, [trennenId], await pruefsumme(anna, 90, [trennenId]));
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect((await stand([90, 91])).wege.map((w) => [w["linie"], w["is_active"]])).toEqual(
            nach.wege.map((w) => [w["linie"], w["is_active"]]),
        );
        // Das Recht: Die Rücknahme der Rücknahme legt die Abschnitte wieder zusammen (Sach- und Lagerecht, wie das Verbinden).
        expect(await vorschauWeg(cluster.app, weg(91), { members: [wiederId] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_map_geometry"],
        });
    });

    it("🔴 U9: Recht, Sperre und Liste vor jeder Änderung: Reviewer 403, ohne Anmeldung 401, fremde Sperre 409 `object_locked`; das Recht der Kurve ist `edit_map_geometry`, das der Felder `edit_map_objects`", async () => {
        const a = await aktualisiere(anna, 60, [60], { labelVisible: true });
        const vorher = await stand([60]);
        const hash = await pruefsumme(anna, 60, [a]);
        expect(((await vorschau(rita, 60, [a], hash)).json() as RuecknahmePruefung).ergebnis).toBe("forbidden");
        const verboten = await zuruecknehmen(rita, 60, [a], hash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorPathRestoreSeriesUrl(weg(60)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [a], membersHash: hash },
        });
        expect(anonym.statusCode).toBe(401);

        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('path', ${weg(60)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const pruefung = (await vorschau(anna, 60, [a], hash)).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
            expect(pruefung.sperren[0]).toMatchObject({ kind: "path", id: weg(60), person: { name: "Bernd" } });
            const gesperrt = await zuruecknehmen(anna, 60, [a], hash);
            expect([gesperrt.statusCode, gesperrt.json().error.code]).toEqual([409, "object_locked"]);
            expect(gesperrt.json().error.details.lock).toMatchObject({
                kind: "path",
                id: weg(60),
                person: { name: "Bernd" },
            });
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${weg(60)}::uuid`;
        }
        expect(await stand([60])).toEqual(vorher);

        // F.1: Rollen ohne `edit_map_geometry` bei `edit_map_objects` gibt es nicht; das Recht wird wie von der Route aus der Sitzung abgeleitet, nur frei gewählt.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        const aktor = { kind: "person" as const, personId: bernd.id, environment: "test" as const };
        const kurve = await forme(anna, 61, [
            { x: 150, y: 420 },
            { x: 155, y: 430 },
            { x: 160, y: 420 },
        ]);
        const kurvePruefung = await vorschauWeg(cluster.app, weg(61), { members: [kurve] }, nurSache);
        expect(kurvePruefung).toMatchObject({ ergebnis: "forbidden", fehlendeRechte: ["edit_map_geometry"] });
        await expect(
            ruecknehmenWeg(cluster.app, aktor, nurSache, weg(61), {
                operationId: randomUUID(),
                members: [kurve],
                membersHash: kurvePruefung.membersHash,
                reason: "Falsch gezogen",
            }),
        ).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
        const felderOp = await aktualisiere(anna, 61, [61], { labelVisible: true });
        expect((await vorschauWeg(cluster.app, weg(61), { members: [felderOp] }, nurSache)).ergebnis).toBe("ok");
        expect((await stand([61])).wege[0]!["linie"]).toBe("LINESTRING(150 420,155 430,160 420)");
        // Der Wechsel auf die Karte verlangt die Lage.
        const ab = await sende(anna, editorPathTakeOffMapUrl(weg(61)), {
            operationId: randomUUID(),
            baseRevision: await revision(61),
        });
        expect(ab.statusCode, ab.body).toBe(200);
        expect(await vorschauWeg(cluster.app, weg(61), { members: [operationIdVon(ab)] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_map_geometry"],
        });
    });
    // ---------------------------------------------------------------------------------------------------------------------------------------------
    // WI-0265 B8a: Anlegen, Teilen, Felder und Kurve in einem Schritt. Neue Wege legen die Tests über die Route an; die Teilungen und Kurven laufen an den Wegen 100 bis 115.

    const idRevision = async (id: string): Promise<number> =>
        Number(
            (
                await cluster.admin<{ r: string }[]>`
                    SELECT revision::text AS r FROM path WHERE public_id = ${id}::uuid`
            )[0]!.r,
        );
    const abschnitteAn = (ids: string[]) =>
        Promise.all(ids.map(async (id) => ({ publicId: id, baseRevision: await idRevision(id) })));
    const neuerWeg = async (person: Person, punkte: Punkt[]): Promise<{ id: string; operationId: string }> => {
        const antwort = await sende(person, EDITOR_PATHS_URL, {
            operationId: randomUUID(),
            points: punkte.map(([x, y]) => ({ x, y })),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return { id: (antwort.json() as { publicId: string }).publicId, operationId: operationIdVon(antwort) };
    };
    const vorschauAn = (person: Person, id: string, members: string[], membersHash?: string): Promise<Antwort> =>
        sende(person, editorPathRestoreSeriesPreviewUrl(id), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zuruecknehmenAn = (
        person: Person,
        id: string,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        sende(person, editorPathRestoreSeriesUrl(id), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const pruefsummeAn = async (person: Person, id: string, members: string[]): Promise<string> =>
        ((await vorschauAn(person, id, members)).json() as RuecknahmePruefung).membersHash;
    const serieAn = async (person: Person, id: string) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === id);
    };
    const wegZeilen = (ids: string[]) =>
        cluster.admin`
            SELECT public_id::text, name, is_active, off_map, revision::text, ST_AsText(geom) AS linie
              FROM path WHERE public_id = ANY(${ids}::uuid[]) ORDER BY public_id`;
    /** Was die Wegfindung aus den aktiven Wegen macht: je Weg Anfang, Ende und die Knoten, an denen er geteilt ist (rein, auf den Zeilen der Datenbank). */
    const topologie = async (ids: string[]) => {
        const zeilen = await cluster.admin<{ id: string; geojson: string }[]>`
            SELECT public_id::text AS id, ST_AsGeoJSON(geom, 15) AS geojson FROM path
             WHERE public_id = ANY(${ids}::uuid[]) AND is_active ORDER BY public_id`;
        const { endSnap, endpointBox, exactHit } = netzOptionen(await wegfindungswerte(cluster.app));
        return deriveTopology(
            [],
            zeilen.map((z) => ({
                publicId: z.id,
                coordinates: (JSON.parse(z.geojson) as { coordinates: [number, number][] }).coordinates,
            })),
            { endSnap, endpointBox, exactHit },
        );
    };
    const ereignisse = (): Promise<number> =>
        zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`);

    it("🔴 B8a Anlegen: ein neuer Weg mit einem „Fertig“ danach ist EINE Serie und geht als Ganzes zurück (stillgelegt); Bernd nur mit Grund; `replayed`, `already_reverted`; die Rücknahme der Rücknahme holt den Weg zurück", async () => {
        const neu = await neuerWeg(anna, [
            [600, 600],
            [610, 605],
            [620, 600],
        ]);
        const umbenannt = await sende(anna, editorPathUpdateUrl(neu.id), {
            operationId: randomUUID(),
            sections: await abschnitteAn([neu.id]),
            name: "B8a Mühlenweg",
        });
        expect(umbenannt.statusCode, umbenannt.body).toBe(200);
        const s = await serieAn(anna, neu.id);
        expect(s!.members).toEqual([neu.operationId, operationIdVon(umbenannt)]);
        const pruefung = (await vorschauAn(anna, neu.id, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: s!.members, reasonRequired: false });

        // Gate 2 und das Recht: Bernd braucht einen Grund, Rita hat das Recht nicht; nichts wird geschrieben.
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
            reason: "Doppelt gezeichnet",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; derivedWork: { kind: string; state: string }[] };
        expect(quittung.reverts).toEqual(s!.members);
        expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
        expect((await wegZeilen([neu.id]))[0]).toMatchObject({
            name: "B8a Mühlenweg",
            is_active: false,
            off_map: false,
        });
        expect(await ereignisse()).toBe(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "path.restore_series",
            reason: "Doppelt gezeichnet",
        });
        expect(rueck.objects.map((o) => o.action)).toEqual(["path.deleted"]);

        const nochmal = await zuruecknehmenAn(bernd, neu.id, s!.members, s!.membersHash, {
            operationId,
            reason: "Doppelt gezeichnet",
        });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const doppelt = await zuruecknehmenAn(anna, neu.id, s!.members, s!.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);
        expect(await ereignisse()).toBe(1);

        // Die Rücknahme der Rücknahme holt den Weg zurück (Wechsel des Stands), Anna als andere Person mit Grund.
        const hash = await pruefsummeAn(anna, neu.id, [operationId]);
        const belebt = await zuruecknehmenAn(anna, neu.id, [operationId], hash, { reason: "Wird doch gebraucht" });
        expect(belebt.statusCode, belebt.body).toBe(200);
        expect((await wegZeilen([neu.id]))[0]).toMatchObject({ is_active: true, off_map: false });
        expect((belebt.json() as { derivedWork: unknown[] }).derivedWork).toContainEqual({
            kind: "routing",
            state: "pending",
        });
    });

    it("🔴 B8a Anlegen streng: hat seither jemand den Weg geändert oder eine Wiki-Zuordnung angehängt, gibt es 409 und es wird nichts geschrieben", async () => {
        // (a) Eine fremde Änderung danach: Bernd benennt den Weg um.
        const a = await neuerWeg(anna, [
            [610, 620],
            [620, 625],
        ]);
        const fremd = await sende(bernd, editorPathUpdateUrl(a.id), {
            operationId: randomUUID(),
            sections: await abschnitteAn([a.id]),
            name: "B8a Fremd Umbenannt",
        });
        expect(fremd.statusCode, fremd.body).toBe(200);
        const vorherA = await stand([]);
        const pruefungA = (await vorschauAn(anna, a.id, [a.operationId])).json() as RuecknahmePruefung;
        expect(pruefungA.ergebnis).toBe("edit_conflict");
        expect(pruefungA.konflikte[0]).toMatchObject({ art: "spaeter", kind: "path", id: a.id });
        const abgewiesenA = await zuruecknehmenAn(anna, a.id, [a.operationId], pruefungA.membersHash);
        expect([abgewiesenA.statusCode, abgewiesenA.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([])).toEqual(vorherA);
        expect((await wegZeilen([a.id]))[0]).toMatchObject({ is_active: true });

        // (b) Eine Wiki-Zuordnung am neuen Weg (ohne Operation am Weg).
        const b = await neuerWeg(anna, [
            [630, 620],
            [640, 625],
        ]);
        const [artikel] = await cluster.migrator<{ id: string }[]>`
            INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
            VALUES ('r8a-dran', 'https://de.wiki-aventurica.de/wiki/R8a_Dran', 'R8a Dran', 'strasse', 'Weg')
            RETURNING id::text AS id`;
        await cluster.migrator`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/R8a_Dran', ${artikel!.id}::bigint, 'assigned'
              FROM path WHERE public_id = ${b.id}::uuid`;
        const pruefungB = (await vorschauAn(anna, b.id, [b.operationId])).json() as RuecknahmePruefung;
        expect(pruefungB.ergebnis).toBe("edit_conflict");
        expect(pruefungB.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", kind: "path", id: b.id, abweichung: { was: "zuordnung" } }),
        );
        const abgewiesenB = await zuruecknehmenAn(anna, b.id, [b.operationId], pruefungB.membersHash);
        expect([abgewiesenB.statusCode, abgewiesenB.json().error.code]).toEqual([409, "edit_conflict"]);
        expect((await wegZeilen([b.id]))[0]).toMatchObject({ is_active: true });
    });

    it("🔴 B8a Teilen: die Teile werden wieder EIN Weg (Kennung und Linie von vorher, der hintere Teil still gelegt), in EINER Operation mit Folgen für die Wegfindung; die Rücknahme davon teilt wieder und lässt sich weiter zurücknehmen", async () => {
        const original = (await wegZeilen([weg(100)]))[0]!["linie"];
        const teilen = await sende(anna, editorPathSplitUrl(weg(100)), {
            operationId: randomUUID(),
            baseRevision: await revision(100),
            index: 2,
            at: { x: 120, y: 500 },
        });
        expect(teilen.statusCode, teilen.body).toBe(200);
        const geteilt = operationIdVon(teilen);
        const hinten = (teilen.json() as { publicId: string }).publicId;
        const geteiltStand = await wegZeilen([weg(100)]);
        expect(geteiltStand[0]!["linie"]).toBe("LINESTRING(100 500,110 505,120 500)");
        // Die Wegfindung kennt zwei Wege, die an einem Knoten zusammenstoßen.
        expect((await topologie([weg(100), hinten])).plans).toHaveLength(2);

        const pruefung = (await vorschauAn(anna, weg(100), [geteilt])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [geteilt],
            konflikte: [],
            folgen: { gegenstaende: 2 },
        });
        expect(pruefung.gegenstaende.map((g) => g.id).sort()).toEqual([weg(100), hinten].sort());
        // Dieselbe Vorprüfung vom hinteren Teil aus: Beide Teile gehören zur Operation.
        expect(((await vorschauAn(anna, hinten, [geteilt])).json() as RuecknahmePruefung).ergebnis).toBe("ok");

        await cluster.admin`DELETE FROM job_event`;
        const vorherOperationen = (await stand([])).operationen;
        const operationId = randomUUID();
        const antwort = await zuruecknehmenAn(anna, weg(100), [geteilt], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; derivedWork: { kind: string }[] };
        expect(quittung.reverts).toEqual([geteilt]);
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual(expect.arrayContaining(["path_visual", "routing"]));
        // Der vordere Teil hat Kennung und Linie von vorher, der hintere ist still gelegt (nicht abgenommen); EINE Operation, EIN Ereignis.
        const zusammen = await wegZeilen([weg(100), hinten]);
        expect(zusammen.find((w) => w["public_id"] === weg(100))).toMatchObject({ linie: original, is_active: true });
        expect(zusammen.find((w) => w["public_id"] === hinten)).toMatchObject({ is_active: false, off_map: false });
        expect((await stand([])).operationen).toBe(vorherOperationen + 1);
        expect(await ereignisse()).toBe(1);
        // Folgen: Die Wegfindung kennt wieder EINEN Weg über die ganze Linie.
        const nachher = await topologie([weg(100), hinten]);
        expect(nachher.plans.map((p) => p.publicId)).toEqual([weg(100)]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [geteilt] });
        expect(rueck.objects.map((o) => o.action)).toEqual(["path.merged", "path.merged"]);

        // `replayed` und `already_reverted`.
        const nochmal = await zuruecknehmenAn(anna, weg(100), [geteilt], pruefung.membersHash, { operationId });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const doppelt = await zuruecknehmenAn(anna, weg(100), [geteilt], pruefung.membersHash);
        expect([doppelt.statusCode, doppelt.json().error.code]).toEqual([409, "already_reverted"]);

        // Die Rücknahme der Rücknahme teilt wieder: der vordere Teil kürzer, der hintere auf der Karte.
        const zweitePruefung = (await vorschauAn(anna, weg(100), [operationId])).json() as RuecknahmePruefung;
        expect(zweitePruefung.ergebnis).toBe("ok");
        const wiederGeteilt = await zuruecknehmenAn(anna, weg(100), [operationId], zweitePruefung.membersHash);
        expect(wiederGeteilt.statusCode, wiederGeteilt.body).toBe(200);
        const wieder = await wegZeilen([weg(100), hinten]);
        expect(wieder.find((w) => w["public_id"] === weg(100))!["linie"]).toBe("LINESTRING(100 500,110 505,120 500)");
        expect(wieder.find((w) => w["public_id"] === hinten)).toMatchObject({ is_active: true });
        expect((await topologie([weg(100), hinten])).plans).toHaveLength(2);
        const wiederId: string = wiederGeteilt.json().operationId;
        expect((await eintrag(anna, wiederId)).objects.map((o) => o.action)).toEqual(["path.split", "path.created"]);

        // Und auch diese Rücknahme geht zurück: wieder EIN Weg.
        const nochEinmal = await zuruecknehmenAn(
            anna,
            weg(100),
            [wiederId],
            await pruefsummeAn(anna, weg(100), [wiederId]),
        );
        expect(nochEinmal.statusCode, nochEinmal.body).toBe(200);
        expect((await wegZeilen([weg(100)]))[0]!["linie"]).toBe(original);
        expect((await topologie([weg(100), hinten])).plans).toHaveLength(1);
    });

    it("🔴 B8a Teilen streng: hat jemand eines der Teile seither geändert, geht nichts zurück: 409 mit beiden Teilen, 0 Mutationen; das Recht ist das des Teilens (beide Rechte)", async () => {
        const teilen = await sende(anna, editorPathSplitUrl(weg(101)), {
            operationId: randomUUID(),
            baseRevision: await revision(101),
            index: 2,
            at: { x: 120, y: 520 },
        });
        expect(teilen.statusCode, teilen.body).toBe(200);
        const geteilt = operationIdVon(teilen);
        const hinten = (teilen.json() as { publicId: string }).publicId;
        // Das Recht der Vorwärtsoperation: Teilen legt einen Weg an UND ändert die Linie.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_map_objects"]),
        };
        expect(await vorschauWeg(cluster.app, weg(101), { members: [geteilt] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_map_geometry"],
        });
        // Bernd benennt die Straße (beide Teile heißen gleich) um: beide Teile haben eine neue Revision.
        const fremd = await sende(bernd, editorPathUpdateUrl(weg(101)), {
            operationId: randomUUID(),
            sections: await abschnitteAn([weg(101), hinten]),
            name: "R8a Teilen Konflikt Neu",
        });
        expect(fremd.statusCode, fremd.body).toBe(200);
        const vorher = await stand([101]);
        const zeilenVorher = await wegZeilen([weg(101), hinten]);
        const pruefung = (await vorschauAn(anna, weg(101), [geteilt])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte.map((k) => k.id).sort()).toEqual([weg(101), hinten].sort());
        expect(pruefung.konflikte.every((k) => k.art === "spaeter")).toBe(true);
        const abgewiesen = await zuruecknehmenAn(anna, weg(101), [geteilt], pruefung.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(
            abgewiesen
                .json()
                .error.details.objects.map((o: { id: string }) => o.id)
                .sort(),
        ).toEqual([weg(101), hinten].sort());
        expect(await stand([101])).toEqual(vorher);
        expect(await wegZeilen([weg(101), hinten])).toEqual(zeilenVorher);

        // Ein Teil, den jemand abgenommen hat, hält es ebenso an (der Konflikt nennt den Teil).
        const zwei = await sende(anna, editorPathSplitUrl(weg(102)), {
            operationId: randomUUID(),
            baseRevision: await revision(102),
            index: 2,
            at: { x: 120, y: 540 },
        });
        expect(zwei.statusCode, zwei.body).toBe(200);
        const hinten2 = (zwei.json() as { publicId: string }).publicId;
        const ab = await sende(bernd, editorPathTakeOffMapUrl(hinten2), {
            operationId: randomUUID(),
            baseRevision: await idRevision(hinten2),
        });
        expect(ab.statusCode, ab.body).toBe(200);
        const konflikt = (await vorschauAn(anna, weg(102), [operationIdVon(zwei)])).json() as RuecknahmePruefung;
        expect(konflikt.ergebnis).toBe("edit_conflict");
        expect(konflikt.konflikte.map((k) => k.id)).toContain(hinten2);
        expect(
            (
                (await zuruecknehmenAn(anna, weg(102), [operationIdVon(zwei)], konflikt.membersHash)).json() as {
                    error: { code: string };
                }
            ).error.code,
        ).toBe("edit_conflict");
    });

    it("🔴 B8a Felder und Kurve in einem Schritt: Name, Linie und der mitgezogene Punkt des Nachbarwegs gehen in EINER Operation zurück; die Rücknahme davon bringt alles wieder; hat jemand den Nachbarweg seither geändert, geht nichts zurück", async () => {
        const punkte = [
            { x: 800, y: 100 },
            { x: 810, y: 105 },
            { x: 822, y: 98 },
            { x: 830, y: 105 },
        ];
        const aenderung = async (n: number, nachbar: number, y: number, name: string): Promise<string> => {
            const antwort = await sende(anna, editorPathUpdateUrl(weg(n)), {
                operationId: randomUUID(),
                sections: await abschnitte([n]),
                name,
                shape: {
                    publicId: weg(n),
                    points: punkte.map((p) => ({ x: p.x, y: p.y + (y - 100) })),
                    carried: [
                        {
                            pathId: weg(nachbar),
                            index: 0,
                            baseRevision: await revision(nachbar),
                            from: { x: 820, y: y },
                            to: { x: 822, y: y - 2 },
                        },
                    ],
                },
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            return operationIdVon(antwort);
        };
        const vorher = await stand([112, 113]);
        const op = await aenderung(112, 113, 100, "R8a Felder Kurve Neu");
        const nach = await stand([112, 113]);
        expect(nach.wege.map((w) => w["name"])).toEqual(["R8a Felder Kurve Neu", "R8a Felder Kurve Nachbar"]);
        expect(nach.wege.map((w) => w["linie"])).toEqual([
            "LINESTRING(800 100,810 105,822 98,830 105)",
            "LINESTRING(822 98,825 90,830 80)",
        ]);
        const aktionen = (await eintrag(anna, op)).objects.map((o) => o.action).sort();
        expect(aktionen).toEqual(["path.carried", "path.reshaped", "path.updated"]);

        const pruefung = (await vorschauAn(anna, weg(112), [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op], konflikte: [] });
        expect(pruefung.gegenstaende.map((g) => g.id).sort()).toEqual([weg(112), weg(113)].sort());
        await cluster.admin`DELETE FROM job_event`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmenAn(anna, weg(112), [op], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { reverts: string[]; derivedWork: { kind: string }[] };
        expect(quittung.reverts).toEqual([op]);
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual(expect.arrayContaining(["path_visual", "routing"]));
        // Name UND Linie UND der mitgezogene Punkt: alles auf dem Stand von vorher.
        const zurueck = await stand([112, 113]);
        expect(zurueck.wege.map((w) => [w["name"], w["linie"]])).toEqual(
            vorher.wege.map((w) => [w["name"], w["linie"]]),
        );
        expect(zurueck.operationen).toBe(nach.operationen + 1);
        expect(await ereignisse()).toBe(1);
        const rueck = await eintrag(anna, operationId);
        expect(rueck.objects.map((o) => o.action).sort()).toEqual(["path.carried", "path.reshaped", "path.updated"]);

        // Die Rücknahme der Rücknahme: der Name und die Kurve stehen wieder, wie das Original sie schrieb.
        const zweite = (await vorschauAn(anna, weg(112), [operationId])).json() as RuecknahmePruefung;
        expect(zweite.ergebnis).toBe("ok");
        const wieder = await zuruecknehmenAn(anna, weg(112), [operationId], zweite.membersHash);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await stand([112, 113])).wege.map((w) => [w["name"], w["linie"]])).toEqual(
            nach.wege.map((w) => [w["name"], w["linie"]]),
        );

        // Fremdänderung am Nachbarweg: nichts geht zurück.
        const zwei = await aenderung(114, 115, 140, "R8a Felder Kurve Zwei Neu");
        const fremd = await forme(bernd, 115, [
            { x: 822, y: 138 },
            { x: 825, y: 128 },
            { x: 835, y: 118 },
        ]);
        const vorherZwei = await stand([114, 115]);
        const gepruft = (await vorschauAn(anna, weg(114), [zwei])).json() as RuecknahmePruefung;
        expect(gepruft.ergebnis).toBe("edit_conflict");
        expect(gepruft.konflikte).toContainEqual(
            expect.objectContaining({ art: "spaeter", id: weg(115), operationId: fremd }),
        );
        const abgewiesen = await zuruecknehmenAn(anna, weg(114), [zwei], gepruft.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([114, 115])).toEqual(vorherZwei);
    });
});
