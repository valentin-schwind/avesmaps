import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_TERRITORY_DISPLAY_URL,
    EDITOR_TERRITORY_OBERGEBIET_URL,
    EDITOR_TERRITORIES_URL,
    EDITOR_TERRITORY_SAMMEL_URL,
    editorTerritoryAreasUrl,
    editorTerritoryRestoreSeriesPreviewUrl,
    editorTerritoryRestoreSeriesUrl,
    editorTerritoryRestoreUrl,
    editorTerritoryRetireUrl,
    editorTerritoryUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { ruecknehmenGebiet, vorschauGebiet } from "../src/editor/ruecknahme-gebiet.ts";
import type { RuecknahmeLeser } from "../src/editor/ruecknahme.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Herrschaftsgebiete zurücknehmen (WI-0265 B6b, Form, Anlegen und Zurückholen B8b; Fachvertrag C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4, U6, U8, U9): `POST /api/editor/territories/:id/restore-series[/preview]`
 * durch Fastify, als App-Rolle im Wegwerf-Cluster mit den Rollen des VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Die Felder einer Serie (Name, Art, Status, Obergebiet, Detailfelder) gehen nur teilweise zurück; eine Operation über mehrere Gebiete kommt für das eine zurück und lässt das
 * andere stehen (stille Teilrücknahme); eine Fremdänderung an dem Gebiet, das die Operation mit berührte, bleibt unbemerkt; Entfernen und „Unter neues Obergebiet“ hängen die Untergebiete
 * nicht zurück; ein Wert, der dem Wiki folgte, kommt als eigener Wert zurück (und umgekehrt); die Form ist rücknehmbar, obwohl der Verlauf sie nie zurückspielte; eine fremde Person wird ohne
 * Grund zurückgenommen; eine fremde Sperre, ein fehlendes Recht oder ein fremdes Gebiet in der Liste hält die Rücknahme nicht auf.
 */

const ENV = "ruecknahmegebiet";
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

const ID = (n: number): string => `b6b60265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const gebiet = (n: number): string => ID(n);
const flaeche = (n: number): string => ID(n + 0x100);

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Gebiete zurücknehmen (WI-0265 B6b, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
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
    const revision = async (n: number): Promise<number> =>
        Number(
            (
                await cluster.admin<
                    { r: string }[]
                >`SELECT revision::text AS r FROM territory WHERE public_id = ${gebiet(n)}::uuid`
            )[0]!.r,
        );
    const operationIdVon = (antwort: Antwort): string => (antwort.json() as { operationId: string }).operationId;

    /** „Fertig“ am Gebiet `n`: `territory.update` gegen die heutige Revision. */
    const aendere = async (
        person: { cookie: string },
        n: number,
        changes: Record<string, unknown>,
    ): Promise<string> => {
        const antwort = await sende(person, "PATCH", editorTerritoryUrl(gebiet(n)), {
            operationId: randomUUID(),
            baseRevision: await revision(n),
            changes,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return operationIdVon(antwort);
    };
    const gemeinsam = async (
        person: { cookie: string },
        ns: number[],
        koerper: Record<string, unknown>,
    ): Promise<string> => {
        const antwort = await sende(person, "POST", EDITOR_TERRITORY_SAMMEL_URL, {
            operationId: randomUUID(),
            territories: await Promise.all(ns.map(async (n) => ({ id: gebiet(n), baseRevision: await revision(n) }))),
            ...koerper,
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
        sende(person, "POST", editorTerritoryRestoreSeriesPreviewUrl(gebiet(n)), {
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
        sende(person, "POST", editorTerritoryRestoreSeriesUrl(gebiet(n)), {
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
        return (antwort.json() as MapHistoryPage).series?.find((s) => s.scope.id === gebiet(n));
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

    /** Was eine scheiternde Rücknahme nie verändern darf: Operationen, Protokoll, Verknüpfungen, Aufträge, Ereignisse und die Gebiete samt Flächen. */
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
        gebiete: await cluster.admin`
            SELECT t.public_id::text, t.name, t.short_name, t.territory_type, t.status_text, t.color, t.min_zoom, t.max_zoom, t.is_active,
                   t.revision::text, p.public_id::text AS parent
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ANY(${ns.map(gebiet)}::uuid[]) ORDER BY t.public_id`,
        flaechen: await cluster.admin`
            SELECT a.public_id::text, a.is_active, a.revision::text, ST_AsText(a.geom) AS form
              FROM territory_area a JOIN territory t ON t.id = a.territory_id
             WHERE t.public_id = ANY(${ns.map(gebiet)}::uuid[]) ORDER BY a.public_id`,
    });
    const zeile = async (n: number) =>
        (
            await cluster.admin<
                {
                    name: string;
                    short_name: string | null;
                    territory_type: string | null;
                    status_text: string | null;
                    color: string;
                    min_zoom: number | null;
                    max_zoom: number | null;
                    is_active: boolean;
                    parent: string | null;
                    parent_origin: string | null;
                }[]
            >`
                SELECT t.name, t.short_name, t.territory_type, t.status_text, t.color, t.min_zoom, t.max_zoom, t.is_active,
                       p.public_id::text AS parent, t.parent_origin
                  FROM territory t LEFT JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${gebiet(n)}::uuid`
        )[0]!;
    const detail = async (n: number) =>
        (
            await cluster.admin<{ ruler: string | null; blazon: string | null; herkunft: unknown }[]>`
                SELECT d.ruler, d.blazon,
                       (SELECT json_object_agg(o.field, o.origin) FROM territory_detail_field_origin o WHERE o.territory_detail_id = d.id) AS herkunft
                  FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = ${gebiet(n)}::uuid`
        )[0];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const lege = async (
            n: number,
            name: string,
            eltern: number | null,
            extra: { zoom?: [number, number]; typ?: string; status?: string; kurz?: string; wiki?: string } = {},
        ) =>
            m`INSERT INTO territory (public_id, map_domain_id, name, short_name, territory_type, status_text, color, opacity, min_zoom, max_zoom,
                                     parent_id, wiki_key, source_system, is_active)
              VALUES (${gebiet(n)}::uuid, ${DOMAIN}, ${name}, ${extra.kurz ?? null}, ${extra.typ ?? "Baronie"}, ${extra.status ?? null}, '#b2b065', 0.7,
                      ${extra.zoom?.[0] ?? null}, ${extra.zoom?.[1] ?? null},
                      ${eltern === null ? null : (await m<{ id: string }[]>`SELECT id::text FROM territory WHERE public_id = ${gebiet(eltern)}::uuid`)[0]!.id}::bigint,
                      ${extra.wiki ?? null}, ${SOURCE}, TRUE)`;
        const flaecheZu = async (n: number, x: number, y: number) =>
            m`INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system, is_active)
              SELECT ${flaeche(n)}::uuid, t.id, ${DOMAIN},
                     ST_Multi(ST_SetSRID(ST_GeomFromText(${`POLYGON((${String(x)} ${String(y)}, ${String(x + 30)} ${String(y)}, ${String(x + 30)} ${String(y + 30)}, ${String(x)} ${String(y + 30)}, ${String(x)} ${String(y)}))`}), 0)),
                     ${SOURCE}, TRUE
                FROM territory t WHERE t.public_id = ${gebiet(n)}::uuid`;
        // Zwei Obergebiete; 1: die Felder einer Serie; 2–3: eine Operation über zwei Gebiete; 4–5: Fremdänderung am Mitberührten; 6–7: Entfernen mit einem Untergebiet;
        // 8: Wiki-Herkunft; 9: Recht, Sperre, Liste; 10: Form; 13–14: „Unter neues Obergebiet“; 15: nur Farbe; 16: Zeitspanne.
        await lege(11, "Rücknahmeland A", null);
        await lege(12, "Rücknahmeland B", null);
        await lege(1, "Rücknahmegebiet Eins", 11, { kurz: "RE", status: "abhängig" });
        await lege(2, "Rücknahmegebiet Zwei", 11, { zoom: [3, 6] });
        await lege(3, "Rücknahmegebiet Drei", 11);
        await lege(4, "Rücknahmegebiet Vier", 11);
        await lege(5, "Rücknahmegebiet Fünf", 11);
        await lege(6, "Rücknahmegebiet Sechs", 11);
        await lege(7, "Rücknahmegebiet Sieben", 6);
        await flaecheZu(6, 300, 300);
        await flaecheZu(7, 300, 340);
        await lege(8, "Rücknahmegebiet Wiki", 11, { wiki: "wiki:RN B6b" });
        await lege(9, "Rücknahmegebiet Recht", 11);
        await lege(10, "Rücknahmegebiet Form", 11);
        await flaecheZu(10, 420, 300);
        await lege(13, "Rücknahmegebiet Dreizehn", 11);
        await lege(14, "Rücknahmegebiet Vierzehn", 11);
        await lege(15, "Rücknahmegebiet Farbe", 11);
        await lege(16, "Rücknahmegebiet Karte", 11);
        await flaecheZu(16, 480, 300);
        // B8b: 17: die Nachbarfläche von 10 (teilt die Kante x = 450); 18: ein Gebiet ohne Fläche („Grenze zeichnen“); 19: Entfernen und Zurückholen über die Route;
        // 20: die Form eines Gebiets ohne Vorher-Form im Protokoll (Altbestand).
        await lege(17, "Rücknahmegebiet Nachbar", 11);
        await flaecheZu(17, 450, 300);
        await lege(18, "Rücknahmegebiet Ohne Fläche", 11);
        await lege(19, "Rücknahmegebiet Zurückholen", 11);
        await flaecheZu(19, 540, 300);
        await lege(20, "Rücknahmegebiet Altbestand", 11);
        await flaecheZu(20, 600, 300);
        // B8b2: 21: Felder und „Grenze zeichnen“ in einer Serie (ohne Fläche); 22: Felder und Entfernen in einer Serie.
        await lege(21, "Rücknahmegebiet Felder und Grenze", 11);
        await lege(22, "Rücknahmegebiet Felder und Entfernen", 11);
        await flaecheZu(22, 640, 300);
        // Gebiet 8: der Herrscher folgt dem Wiki, das Wappen ist ein eigener Wert.
        await m`INSERT INTO wiki_territory_snapshot (wiki_key, ruler, blazon, currency) VALUES ('wiki:RN B6b', 'Graf A', 'Wiki-Wappen', 'Dukaten')`;
        await m`INSERT INTO territory_detail (territory_id, ruler, blazon, currency, source_system)
                SELECT id, 'Graf A', 'Eigenes Wappen', 'Dukaten', 'avesmaps3d' FROM territory WHERE public_id = ${gebiet(8)}::uuid`;
        await m`INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
                SELECT d.id, f.feld, f.herkunft FROM territory_detail d JOIN territory t ON t.id = d.territory_id
                  CROSS JOIN (VALUES ('ruler', 'wiki'), ('blazon', 'override'), ('currency', 'override')) AS f(feld, herkunft)
                 WHERE t.public_id = ${gebiet(8)}::uuid`;
        const fixture = authFixture(cluster.admin);
        const person = async (name: string, role: "admin" | "reviewer") => {
            const p = await fixture.person(role, { name });
            return { id: p.id, cookie: (await fixture.session(p.id, { passkeyMinutesAgo: 1 })).cookie };
        };
        anna = await person("Anna", "admin");
        bernd = await person("Bernd", "admin");
        rita = await person("Rita", "reviewer");
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 300_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 Felder: drei „Fertig“ am Gebiet (Name, Art, Status, Kurzname, Obergebiet, Detailfeld) sind eine Serie; Bernd nimmt sie nur mit Grund zurück, alles geht auf den Stand davor in EINER Operation", async () => {
        const a = await aendere(anna, 1, { name: "Rücknahmegebiet Eins Neu", type: "Grafschaft" });
        const b = await aendere(anna, 1, { status: "freie Stadt", shortName: "RN" });
        const c = await aendere(anna, 1, { parent: gebiet(12), details: { ruler: { value: "Graf Neu" } } });
        const s = await serie(anna, 1);
        expect(s).toMatchObject({ size: 3, members: [a, b, c] });
        expect(await zeile(1)).toMatchObject({
            name: "Rücknahmegebiet Eins Neu",
            parent: gebiet(12),
            parent_origin: "override",
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
            reason: "Falsches Gebiet",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { reverts: string[] }).reverts).toEqual([a, b, c]);
        expect(await zeile(1)).toMatchObject({
            name: "Rücknahmegebiet Eins",
            short_name: "RE",
            territory_type: "Baronie",
            status_text: "abhängig",
            parent: gebiet(11),
        });
        // Das Detailfeld ist wieder ohne Wert und ohne Vermerk.
        expect(await detail(1)).toMatchObject({ ruler: null, herkunft: null });
        // EINE Operation, drei Verknüpfungen, der Grund sichtbar im Eintrag, ein `territory.updated` für das Gebiet.
        const nachher = await stand([1]);
        expect(nachher.operationen).toBe(vorher.operationen + 1);
        expect(nachher.verknuepfungen).toBe(vorher.verknuepfungen + 3);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({
            source: "restore",
            operation: "territory.restore_series",
            reverts: [a, b, c],
            actor: { name: "Bernd" },
        });
        expect(rueck.objects).toHaveLength(1);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Falsches Gebiet" });
        expect(Object.keys(rueck.objects[0]!.changes)).toEqual(
            expect.arrayContaining(["name", "type", "status", "shortName", "parent", "ruler"]),
        );
        for (const id of [a, b, c])
            expect(await eintrag(anna, id)).toMatchObject({
                status: "bereits_zurueckgenommen",
                revertedBy: { operationId, reason: "Falsches Gebiet" },
            });
        // U8: dieselbe Kennung gibt `replayed`, eine andere für dieselbe Liste `already_reverted`, nichts wird noch einmal geschrieben.
        const nochmal = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, {
            operationId,
            reason: "Falsches Gebiet",
        });
        expect([nochmal.statusCode, nochmal.json().status, nochmal.json().operationId]).toEqual([
            200,
            "replayed",
            operationId,
        ]);
        const andere = await zuruecknehmen(bernd, 1, s!.members, s!.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        expect(andere.json().error.details.revertedBy).toEqual([{ operationId, at: expect.any(String) }]);
        expect(await stand([1])).toEqual(nachher);
    });

    it("🔴 Eine Operation über zwei Gebiete (Mehrfachauswahl, Farbe, Zoomspanne) kommt für beide zurück oder für keines: das ↺ am einen Gebiet nimmt das andere mit", async () => {
        const vorher2 = await zeile(2);
        const vorher3 = await zeile(3);
        const op = await gemeinsam(anna, [2, 3], {
            changes: { type: "Provinz", status: "frei" },
            color: "#112233",
            zoom: { minZoom: 2, maxZoom: 5 },
        });
        expect(await zeile(2)).toMatchObject({ territory_type: "Provinz", color: "#112233", min_zoom: 2, max_zoom: 5 });
        const pruefsum = await pruefsumme(anna, 2, [op]);
        const pruefung = (await vorschau(anna, 2, [op], pruefsum)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op], reasonRequired: false });
        expect(
            pruefung.gegenstaende
                .filter((g) => g.kind === "territory")
                .map((g) => g.id)
                .sort(),
        ).toEqual([gebiet(2), gebiet(3)]);

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 2, [op], pruefsum, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Beide stehen wieder, wie sie waren: Art, Status, Farbe und die ganze Spanne davor (Gebiet 2 hatte 3 bis 6, Gebiet 3 keine).
        expect(await zeile(2)).toEqual(vorher2);
        expect(await zeile(3)).toEqual(vorher3);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "territory.restore_series", reverts: [op] });
        expect([...new Set(rueck.objects.filter((o) => o.kind === "territory").map((o) => o.id))].sort()).toEqual([
            gebiet(2),
            gebiet(3),
        ]);
        expect((await eintrag(anna, op)).status).toBe("bereits_zurueckgenommen");
    });

    it("🔴 U6: Eine Fremdänderung am Gebiet, das die Operation mit berührte, hält die Rücknahme an: 409 mit Gebiet, Person und Zeit, 0 Mutationen, 0 Aufträge", async () => {
        const op = await gemeinsam(anna, [4, 5], { changes: { type: "Provinz" } });
        await aendere(bernd, 5, { name: "Rücknahmegebiet Fünf von Bernd" });
        const vorher = await stand([4, 5]);
        const pruefung = (await vorschau(anna, 4, [op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "territory",
                id: gebiet(5),
                changedBy: expect.objectContaining({ name: "Bernd" }),
                felder: expect.arrayContaining(["name"]),
            }),
        );
        const antwort = await zuruecknehmen(anna, 4, [op], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "territory", id: gebiet(5), art: "spaeter" }),
        );
        expect(await stand([4, 5])).toEqual(vorher);
    });

    it("🔴 Entfernen und Zurückholen: „Ganz löschen“ mit Untergebiet eine Ebene hoch geht in EINER Rücknahme zurück, das Untergebiet hängt wieder wie vorher", async () => {
        const entfernt = await sende(anna, "POST", editorTerritoryRetireUrl(gebiet(6)), {
            operationId: randomUUID(),
            baseRevision: await revision(6),
            stage: "retire",
            children: "up",
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const op = operationIdVon(entfernt);
        expect(await zeile(6)).toMatchObject({ is_active: false });
        expect(await zeile(7)).toMatchObject({ parent: gebiet(11), parent_origin: "override" });
        const pruefsum = await pruefsumme(anna, 6, [op]);
        const pruefung = (await vorschau(anna, 6, [op], pruefsum)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op] });
        // Das Blatt kennt die Gegenstände: das Gebiet und das Untergebiet, das umgehängt wurde.
        expect(pruefung.mitglieder[0]!.gegenstaende.map((g) => `${g.kind}:${g.action}`).sort()).toEqual(
            expect.arrayContaining(["territory:territory.retired", "territory:territory.updated"]),
        );

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 6, [op], pruefsum, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: true, parent: gebiet(11) });
        expect(await zeile(7)).toMatchObject({ parent: gebiet(6), parent_origin: null });
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "territory.restore_series", reverts: [op] });
        expect(rueck.objects.map((o) => o.action).sort()).toEqual(["territory.restored", "territory.updated"]);
        expect((await eintrag(anna, op)).status).toBe("bereits_zurueckgenommen");
        // B8b: Das Zurückholen lässt sich zurücknehmen; es macht das Entfernen noch einmal (das Untergebiet hängt wieder dort, wohin das Entfernen es hängte).
        const vorschauRueck = (await vorschau(anna, 6, [operationId])).json() as RuecknahmePruefung;
        expect(vorschauRueck.ergebnis).toBe("ok");
        const nochmal = await zuruecknehmen(anna, 6, [operationId], vorschauRueck.membersHash);
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: false });
        expect(await zeile(7)).toMatchObject({ parent: gebiet(11), parent_origin: "override" });
        // Und das Entfernen wieder zurück: der Stand von vorher, damit die folgenden Fälle ihn finden.
        const nochmalZurueck = await zuruecknehmen(
            anna,
            6,
            [nochmal.json().operationId],
            await pruefsumme(anna, 6, [nochmal.json().operationId]),
        );
        expect(nochmalZurueck.statusCode, nochmalZurueck.body).toBe(200);
        expect(await zeile(6)).toMatchObject({ is_active: true });
        expect(await zeile(7)).toMatchObject({ parent: gebiet(6) });
    });

    it("🔴 „Von der Karte nehmen“ schreibt nur die Fläche ins Protokoll: Sie nennt ihr Gebiet als Adresse, und ↺ bringt die Fläche zurück", async () => {
        const abgenommen = await sende(anna, "POST", editorTerritoryRetireUrl(gebiet(16)), {
            operationId: randomUUID(),
            baseRevision: await revision(16),
            stage: "off_map",
        });
        expect(abgenommen.statusCode, abgenommen.body).toBe(200);
        const op = operationIdVon(abgenommen);
        const [flaecheVorher] = await cluster.admin<
            { is_active: boolean }[]
        >`SELECT is_active FROM territory_area WHERE public_id = ${flaeche(16)}::uuid`;
        expect(flaecheVorher!.is_active).toBe(false);
        const e = await eintrag(anna, op);
        expect(e.objects).toHaveLength(1);
        expect(e.objects[0]).toMatchObject({
            kind: "territory_area",
            id: flaeche(16),
            action: "territory_area.retired",
            territory: { id: gebiet(16), name: "Rücknahmegebiet Karte" },
        });
        const antwort = await zuruecknehmen(anna, 16, [op], await pruefsumme(anna, 16, [op]), {
            reason: "Doch auf der Karte",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const [flaecheNachher] = await cluster.admin<
            { is_active: boolean }[]
        >`SELECT is_active FROM territory_area WHERE public_id = ${flaeche(16)}::uuid`;
        expect(flaecheNachher!.is_active).toBe(true);
        // Der Grund steht auch dann im Eintrag, wenn die Rücknahme nur eine Fläche berührt.
        const rueck = await eintrag(anna, antwort.json().operationId);
        expect(rueck.objects.map((o) => [o.kind, o.action])).toEqual([["territory_area", "territory_area.restored"]]);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Doch auf der Karte" });
    });

    it("🔴 „Unter neues Obergebiet …“: Die gewählten hängen zurück, das neue Gebiet geht still", async () => {
        const antwort = await sende(anna, "POST", EDITOR_TERRITORY_OBERGEBIET_URL, {
            operationId: randomUUID(),
            territories: [
                { id: gebiet(13), baseRevision: await revision(13) },
                { id: gebiet(14), baseRevision: await revision(14) },
            ],
            name: "Neues Obergebiet RN",
            color: "#445566",
            zoom: { minZoom: 1, maxZoom: 3 },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const op = operationIdVon(antwort);
        const neu = (antwort.json() as { publicId: string }).publicId;
        expect(await zeile(13)).toMatchObject({ parent: neu });
        const pruefsum = await pruefsumme(anna, 13, [op]);
        const rueck = await zuruecknehmen(anna, 13, [op], pruefsum);
        expect(rueck.statusCode, rueck.body).toBe(200);
        expect(await zeile(13)).toMatchObject({ parent: gebiet(11) });
        expect(await zeile(14)).toMatchObject({ parent: gebiet(11) });
        const [neues] = await cluster.admin<
            { is_active: boolean }[]
        >`SELECT is_active FROM territory WHERE public_id = ${neu}::uuid`;
        expect(neues!.is_active).toBe(false);
    });

    it("🔴 C.3 Wiki-geführte Detailfelder: folgte der Wert vorher dem Wiki, kommt er als Wiki-Wert zurück; ein eigener Wert kommt als eigener Wert zurück", async () => {
        const op = await aendere(anna, 8, {
            details: { ruler: { value: "Graf B" }, blazon: { value: "Neues Wappen" } },
        });
        expect(await detail(8)).toMatchObject({
            ruler: "Graf B",
            blazon: "Neues Wappen",
            herkunft: { ruler: "override", blazon: "override" },
        });
        const antwort = await zuruecknehmen(anna, 8, [op], await pruefsumme(anna, 8, [op]));
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Der Herrscher folgt wieder dem Wiki („Graf A“, Vermerk wiki), das Wappen steht als eigener Wert da.
        expect(await detail(8)).toMatchObject({
            ruler: "Graf A",
            blazon: "Eigenes Wappen",
            herkunft: { ruler: "wiki", blazon: "override" },
        });
    });

    it("🔴 Nur die Herkunft geändert (↺ auf den gleichen Wiki-Wert): Die Rücknahme macht den Wert wieder zum eigenen", async () => {
        const op = await aendere(anna, 8, { details: { currency: { revert: "wiki" } } });
        expect(await detail(8)).toMatchObject({ herkunft: expect.objectContaining({ currency: "wiki" }) });
        const antwort = await zuruecknehmen(anna, 8, [op], await pruefsumme(anna, 8, [op]));
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await detail(8)).toMatchObject({ herkunft: expect.objectContaining({ currency: "override" }) });
    });

    it("🔴 Nur Farbe: Die Rücknahme stellt die Farbe wieder her und leitet nichts ab; die Spanne eines Gebiets ohne Spanne bleibt offen", async () => {
        const antwortAnzeige = await sende(anna, "POST", EDITOR_TERRITORY_DISPLAY_URL, {
            operationId: randomUUID(),
            territories: [{ id: gebiet(15), baseRevision: await revision(15), color: "#778899" }],
        });
        expect(antwortAnzeige.statusCode, antwortAnzeige.body).toBe(200);
        const op = operationIdVon(antwortAnzeige);
        const antwort = await zuruecknehmen(anna, 15, [op], await pruefsumme(anna, 15, [op]));
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await zeile(15)).toMatchObject({ color: "#b2b065", min_zoom: null, max_zoom: null });
        expect((antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((w) => w.kind)).not.toContain(
            "territory_derive",
        );
    });

    // --- B8b: Form, Anlegen und Zurückholen ---------------------------------------------------------------------------------------

    /** Dieselben Wege für Gebiete, die der Test erst anlegt (die Kennung vergibt der Server). */
    const vorschauG = (person: { cookie: string }, id: string, members: string[], membersHash?: string) =>
        sende(person, "POST", editorTerritoryRestoreSeriesPreviewUrl(id), {
            members,
            ...(membersHash === undefined ? {} : { membersHash }),
        });
    const zurueckG = (
        person: { cookie: string },
        id: string,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ) =>
        sende(person, "POST", editorTerritoryRestoreSeriesUrl(id), {
            operationId: extra.operationId ?? randomUUID(),
            members,
            membersHash,
            ...(extra.reason === undefined ? {} : { reason: extra.reason }),
        });
    const hashG = async (person: { cookie: string }, id: string, members: string[]) =>
        ((await vorschauG(person, id, members)).json() as RuecknahmePruefung).membersHash;
    const serieG = async (person: { cookie: string }, id: string) =>
        (
            (
                await app.inject({
                    method: "GET",
                    url: `${EDITOR_CHANGES_URL}?limit=200`,
                    headers: { cookie: person.cookie },
                })
            ).json() as MapHistoryPage
        ).series?.find((s) => s.scope.id === id);
    const gebietHeute = async (id: string) =>
        (
            await cluster.admin<
                { name: string; is_active: boolean; parent: string | null; revision: number }[]
            >`SELECT t.name, t.is_active, p.public_id::text AS parent, t.revision::int AS revision
                FROM territory t LEFT JOIN territory p ON p.id = t.parent_id WHERE t.public_id = ${id}::uuid`
        )[0]!;
    const flaechenHeute = async (gebietId: string) =>
        cluster.admin<{ id: string; is_active: boolean; form: string }[]>`
            SELECT a.public_id::text AS id, a.is_active, ST_AsText(a.geom) AS form
              FROM territory_area a JOIN territory t ON t.id = a.territory_id
             WHERE t.public_id = ${gebietId}::uuid ORDER BY a.public_id`;
    const formVon = async (n: number): Promise<string> =>
        (
            await cluster.admin<
                { form: string }[]
            >`SELECT ST_AsText(geom) AS form FROM territory_area WHERE public_id = ${flaeche(n)}::uuid`
        )[0]!.form;
    const lageRevision = async (n: number): Promise<number> =>
        Number(
            (
                await cluster.admin<
                    { r: string }[]
                >`SELECT revision::text AS r FROM territory_area WHERE public_id = ${flaeche(n)}::uuid`
            )[0]!.r,
        );
    const neuesGebiet = async (
        person: { cookie: string },
        ring: number[][],
        eltern?: string,
    ): Promise<{ op: string; id: string; flaeche: string }> => {
        const antwort = await sende(person, "POST", EDITOR_TERRITORIES_URL, {
            operationId: randomUUID(),
            color: "#aabbcc",
            ring,
            ...(eltern === undefined ? { parent: gebiet(11) } : { parent: eltern }),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as { operationId: string; publicId: string; areaId: string };
        return { op: quittung.operationId, id: quittung.publicId, flaeche: quittung.areaId };
    };
    const quadrat = (x: number, y: number, kante = 20): number[][] => [
        [x, y],
        [x + kante, y],
        [x + kante, y + kante],
        [x, y + kante],
    ];

    it("🔴 B8b Form: Eine Formänderung mit einer mitgezogenen Nachbarfläche geht in EINER Rücknahme zurück (eigene Fläche mit allen Ringen, Nachbar über die Ecken); ohne Geometrie-Recht 403; die Rücknahme der Rücknahme formt neu", async () => {
        const ring = (x: number, y: number, ecke: [number, number]): number[][] => [
            [x, y],
            [x + 30, y],
            ecke,
            [x, y + 30],
        ];
        // Gebiet 10: 420–450 × 300–330; Nachbar 17: 450–480 × 300–330. Die gemeinsame Ecke (450, 330) zieht auf (452, 334), die Nachbarin zieht mit.
        const vorher10 = await formVon(10);
        const vorher17 = await formVon(17);
        const form = await sende(anna, "PATCH", editorTerritoryUrl(gebiet(10)), {
            operationId: randomUUID(),
            areas: [
                { id: flaeche(10), baseRevision: await lageRevision(10), polygons: [[ring(420, 300, [452, 334])]] },
                {
                    id: flaeche(17),
                    baseRevision: await lageRevision(17),
                    polygons: [
                        [
                            [
                                [450, 300],
                                [480, 300],
                                [480, 330],
                                [452, 334],
                            ],
                        ],
                    ],
                },
            ],
        });
        expect(form.statusCode, form.body).toBe(200);
        const op = operationIdVon(form);
        expect(await formVon(10)).not.toBe(vorher10);
        expect(await formVon(17)).not.toBe(vorher17);
        const e = await eintrag(anna, op);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["territory_area.carried", "territory_area.reshaped"]);

        // Recht: Die Form verlangt auch `edit_territory_form`.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_territories"]),
        };
        expect(await vorschauGebiet(cluster.app, gebiet(10), { members: [op] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
            fehlendeRechte: ["edit_territory_form"],
        });
        const vor = await stand([10, 17]);
        const pruefung = (await vorschau(anna, 10, [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op] });
        expect(await stand([10, 17])).toEqual(vor);

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, 10, [op], pruefung.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Beide Flächen stehen wieder genau, wie sie waren (die Ecke der Nachbarin an ihrem Platz).
        expect(await formVon(10)).toBe(vorher10);
        expect(await formVon(17)).toBe(vorher17);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "territory.restore_series", reverts: [op] });
        expect(rueck.objects.map((o) => o.action).sort()).toEqual([
            "territory_area.carried",
            "territory_area.reshaped",
        ]);
        // Ableitung und Kacheln: die Schreibnaht rechnet nach (territory_derive).
        expect((antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((w) => w.kind).join()).toContain(
            "territory_derive",
        );

        // Die Rücknahme der Rücknahme formt die Flächen wieder um (die Form nach der Änderung).
        const wieder = await zuruecknehmen(anna, 10, [operationId], await pruefsumme(anna, 10, [operationId]));
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await formVon(10)).not.toBe(vorher10);
        expect(await formVon(17)).not.toBe(vorher17);
        // Und zurück auf den Stand vor der Änderung, damit der Fall in sich abgeschlossen bleibt.
        const ganz = await zuruecknehmen(
            anna,
            10,
            [wieder.json().operationId],
            await pruefsumme(anna, 10, [wieder.json().operationId]),
        );
        expect(ganz.statusCode, ganz.body).toBe(200);
        expect(await formVon(10)).toBe(vorher10);
    });

    it("🔴 Ein neuer Punkt auf der gemeinsamen Grenze (OPS-000079): Beide Flächen stehen mit ihrer ganzen Form im Protokoll, und ↺ nimmt ihn auch der Nachbarin wieder", async () => {
        // Gebiet 10: 420–450 × 300–330; Nachbar 17: 450–480 × 300–330. Der neue Punkt (450, 315) liegt auf ihrer gemeinsamen Kante.
        const vorher10 = await formVon(10);
        const vorher17 = await formVon(17);
        const form = await sende(anna, "PATCH", editorTerritoryUrl(gebiet(10)), {
            operationId: randomUUID(),
            areas: [
                {
                    id: flaeche(10),
                    baseRevision: await lageRevision(10),
                    polygons: [
                        [
                            [
                                [420, 300],
                                [450, 300],
                                [450, 315],
                                [450, 330],
                                [420, 330],
                            ],
                        ],
                    ],
                },
                {
                    id: flaeche(17),
                    baseRevision: await lageRevision(17),
                    polygons: [
                        [
                            [
                                [450, 300],
                                [480, 300],
                                [480, 330],
                                [450, 330],
                                [450, 315],
                            ],
                        ],
                    ],
                },
            ],
        });
        expect(form.statusCode, form.body).toBe(200);
        const op = operationIdVon(form);
        expect(await formVon(17)).not.toBe(vorher17);
        const e = await eintrag(anna, op);
        expect(e.objects.map((o) => o.action)).toEqual(["territory_area.reshaped", "territory_area.reshaped"]);

        const pruefung = (await vorschau(anna, 10, [op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [op] });
        const antwort = await zuruecknehmen(anna, 10, [op], pruefung.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await formVon(10)).toBe(vorher10);
        expect(await formVon(17)).toBe(vorher17);
    });

    it("🔴 B8b Form: Eine Serie aus Feldern und Form geht als Ganzes zurück; sitzt eine mitgezogene Ecke nicht mehr genau an ihrer Stelle, bleibt alles stehen (409 `flaeche_nachbar`); fehlt dem Altbestand die Vorher-Form, nennt der Konflikt es", async () => {
        const vorher10 = await formVon(10);
        const a = await aendere(anna, 10, { status: "frei" });
        const b = await sende(anna, "PATCH", editorTerritoryUrl(gebiet(10)), {
            operationId: randomUUID(),
            areas: [
                {
                    id: flaeche(10),
                    baseRevision: await lageRevision(10),
                    polygons: [
                        [
                            [
                                [420, 300],
                                [450, 300],
                                [450, 330],
                                [422, 332],
                            ],
                        ],
                    ],
                },
            ],
        });
        expect(b.statusCode, b.body).toBe(200);
        const s = await serie(anna, 10);
        expect(s).toMatchObject({ size: 2, members: [a, operationIdVon(b)] });
        const antwort = await zuruecknehmen(anna, 10, s!.members, s!.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await formVon(10)).toBe(vorher10);
        expect(await zeile(10)).toMatchObject({ status_text: null });

        // Altbestand: Fehlt dem Eintrag der Form die Ringe davor, kann die Rücknahme sie nicht setzen: 409 mit Gegenstand und Feld, nichts wird geschrieben.
        const alt = await sende(anna, "PATCH", editorTerritoryUrl(gebiet(20)), {
            operationId: randomUUID(),
            areas: [
                {
                    id: flaeche(20),
                    baseRevision: await lageRevision(20),
                    polygons: [
                        [
                            [
                                [600, 300],
                                [630, 300],
                                [630, 330],
                                [602, 332],
                            ],
                        ],
                    ],
                },
            ],
        });
        expect(alt.statusCode, alt.body).toBe(200);
        const altOp = operationIdVon(alt);
        await cluster.admin`
            UPDATE map_audit_event SET changes = changes #- '{geometry,before}' WHERE operation_id = ${altOp}::uuid`;
        const vorAlt = await stand([20]);
        const pruefAlt = (await vorschau(anna, 20, [altOp])).json() as RuecknahmePruefung;
        expect(pruefAlt.ergebnis).toBe("edit_conflict");
        expect(pruefAlt.konflikte).toContainEqual(
            expect.objectContaining({ kind: "territory_area", id: flaeche(20), felder: ["geometry"] }),
        );
        const abgewiesen = await zuruecknehmen(anna, 20, [altOp], pruefAlt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([20])).toEqual(vorAlt);
    });

    it("🔴 B8b Anlegen: Zurücknehmen legt Gebiet samt Fläche still (fremde Person nur mit Grund); die Rücknahme der Rücknahme belebt wieder; replayed und already_reverted", async () => {
        const neu = await neuesGebiet(anna, quadrat(700, 300));
        expect(await gebietHeute(neu.id)).toMatchObject({ is_active: true, parent: gebiet(11) });
        const vorher = await stand([]);
        const pruefung = (await vorschauG(bernd, neu.id, [neu.op])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: [neu.op],
            reasonRequired: true,
            fremdePersonen: [{ name: "Anna" }],
            folgen: { gegenstaende: 1, gelaende: "keines" },
        });
        expect(await stand([])).toEqual(vorher);
        const ohne = await zurueckG(bernd, neu.id, [neu.op], pruefung.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect((await gebietHeute(neu.id)).is_active).toBe(true);

        const operationId = randomUUID();
        const antwort = await zurueckG(bernd, neu.id, [neu.op], pruefung.membersHash, {
            operationId,
            reason: "Doppelt gezeichnet",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((await gebietHeute(neu.id)).is_active).toBe(false);
        expect(await flaechenHeute(neu.id)).toMatchObject([{ id: neu.flaeche, is_active: false }]);
        const rueck = await eintrag(anna, operationId);
        expect(rueck).toMatchObject({ source: "restore", operation: "territory.restore_series", reverts: [neu.op] });
        expect(rueck.objects.map((o) => o.action).sort()).toEqual(["territory.retired", "territory_area.retired"]);
        expect(rueck.objects[0]!.changes["restoreReason"]).toEqual({ after: "Doppelt gezeichnet" });
        expect((antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((w) => w.kind).join()).toContain(
            "territory_derive",
        );
        // U8.
        const nochmal = await zurueckG(bernd, neu.id, [neu.op], pruefung.membersHash, {
            operationId,
            reason: "Doppelt gezeichnet",
        });
        expect([nochmal.statusCode, nochmal.json().status]).toEqual([200, "replayed"]);
        const andere = await zurueckG(bernd, neu.id, [neu.op], pruefung.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);

        // Die Rücknahme der Rücknahme belebt Gebiet und Fläche wieder.
        const wieder = await zurueckG(anna, neu.id, [operationId], await hashG(anna, neu.id, [operationId]), {
            reason: "Doch richtig",
        });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await gebietHeute(neu.id)).is_active).toBe(true);
        expect(await flaechenHeute(neu.id)).toMatchObject([{ id: neu.flaeche, is_active: true }]);
    });

    it("🔴 B8b Anlegen: Hängt seither ein aktives Untergebiet am neuen Gebiet, bleibt alles stehen (409 mit dem Untergebiet als Gegenstand), 0 Mutationen", async () => {
        const neu = await neuesGebiet(anna, quadrat(740, 300));
        const kind = await neuesGebiet(bernd, quadrat(745, 305, 10), neu.id);
        const vor = { ...(await stand([])), gebiet: await gebietHeute(neu.id) };
        const pruefung = (await vorschauG(anna, neu.id, [neu.op])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "territory",
                id: kind.id,
                felder: ["parent"],
                abweichung: { was: "felder" },
            }),
        );
        const abgewiesen = await zurueckG(anna, neu.id, [neu.op], pruefung.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(abgewiesen.json().error.details.objects).toContainEqual(
            expect.objectContaining({ kind: "territory", id: kind.id, art: "wert" }),
        );
        expect({ ...(await stand([])), gebiet: await gebietHeute(neu.id) }).toEqual(vor);
        // Nimmt Bernd sein Untergebiet zuerst zurück, geht das Obergebiet.
        const kindZurueck = await zurueckG(bernd, kind.id, [kind.op], await hashG(bernd, kind.id, [kind.op]));
        expect(kindZurueck.statusCode, kindZurueck.body).toBe(200);
        const jetzt = await zurueckG(anna, neu.id, [neu.op], await hashG(anna, neu.id, [neu.op]));
        expect(jetzt.statusCode, jetzt.body).toBe(200);
        expect((await gebietHeute(neu.id)).is_active).toBe(false);
    });

    it("🔴 B8b Anlegen in einer Serie: Anlegen und zwei Änderungen derselben Person gehen als Ganzes zurück (Gebiet still), die Rücknahme der Rücknahme belebt es mit dem Namen nach der Serie", async () => {
        const neu = await neuesGebiet(anna, quadrat(780, 300));
        const a = await sende(anna, "PATCH", editorTerritoryUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: (await gebietHeute(neu.id)).revision,
            changes: { name: "Rücknahmegebiet Neu Benannt" },
        });
        expect(a.statusCode, a.body).toBe(200);
        const b = await sende(anna, "PATCH", editorTerritoryUrl(neu.id), {
            operationId: randomUUID(),
            baseRevision: (await gebietHeute(neu.id)).revision,
            changes: { status: "frei" },
        });
        expect(b.statusCode, b.body).toBe(200);
        const s = await serieG(anna, neu.id);
        expect(s).toMatchObject({ size: 3, members: [neu.op, operationIdVon(a), operationIdVon(b)] });
        const pruefung = (await vorschauG(anna, neu.id, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: s!.members });
        const operationId = randomUUID();
        const antwort = await zurueckG(anna, neu.id, s!.members, s!.membersHash, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as { reverts: string[] }).reverts).toEqual(s!.members);
        expect((await gebietHeute(neu.id)).is_active).toBe(false);
        const wieder = await zurueckG(anna, neu.id, [operationId], await hashG(anna, neu.id, [operationId]));
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await gebietHeute(neu.id)).toMatchObject({ is_active: true, name: "Rücknahmegebiet Neu Benannt" });
    });

    it("🔴 B8b Grenze zeichnen: Zurück legt die Fläche still, das Gebiet bleibt; eine Serie aus Feldern und Grenze geht zurück, ihre Rücknahme seit B8b2 ebenfalls", async () => {
        const antwort = await sende(anna, "POST", editorTerritoryAreasUrl(gebiet(18)), {
            operationId: randomUUID(),
            baseRevision: await revision(18),
            ring: quadrat(820, 300),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const op = operationIdVon(antwort);
        const flaecheId = (antwort.json() as { areaId: string }).areaId;
        const rueck = await zuruecknehmen(anna, 18, [op], await pruefsumme(anna, 18, [op]));
        expect(rueck.statusCode, rueck.body).toBe(200);
        expect(await flaechenHeute(gebiet(18))).toMatchObject([{ id: flaecheId, is_active: false }]);
        expect(await zeile(18)).toMatchObject({ is_active: true });
        // Wieder: die Fläche ist zurück.
        const wieder = await zuruecknehmen(
            anna,
            18,
            [rueck.json().operationId],
            await pruefsumme(anna, 18, [rueck.json().operationId]),
        );
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await flaechenHeute(gebiet(18))).toMatchObject([{ id: flaecheId, is_active: true }]);

        // Felder und Grenze in einer Serie: Zurück geht; die Rücknahme enthält Felder UND ein Stilllegen und lässt sich seit B8b2 selbst zurücknehmen (ausführlich im Fall unten).
        await cluster.admin`UPDATE territory_area SET is_active = FALSE WHERE public_id = ${flaecheId}::uuid`;
        const f = await aendere(anna, 18, { type: "Provinz" });
        const g = await sende(anna, "POST", editorTerritoryAreasUrl(gebiet(18)), {
            operationId: randomUUID(),
            baseRevision: await revision(18),
            ring: quadrat(860, 300),
        });
        expect(g.statusCode, g.body).toBe(200);
        const s = await serie(anna, 18);
        expect(s!.members).toEqual([f, operationIdVon(g)]);
        const serieRueck = await zuruecknehmen(anna, 18, s!.members, s!.membersHash);
        expect(serieRueck.statusCode, serieRueck.body).toBe(200);
        expect(await zeile(18)).toMatchObject({ territory_type: "Baronie" });
        const nochmal = (await vorschau(anna, 18, [serieRueck.json().operationId])).json() as RuecknahmePruefung;
        expect(nochmal.ergebnis).toBe("ok");
    });

    it("🔴 B8b Zurückholen über die Route (`territory.restore`): Seine Rücknahme macht das Entfernen noch einmal; Recht: das Geometrie-Recht", async () => {
        const entfernt = await sende(anna, "POST", editorTerritoryRetireUrl(gebiet(19)), {
            operationId: randomUUID(),
            baseRevision: await revision(19),
            stage: "retire",
            children: "up",
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const entfernenOp = operationIdVon(entfernt);
        const zurueck = await sende(anna, "POST", editorTerritoryRestoreUrl(gebiet(19)), {
            operationId: randomUUID(),
            reverts: entfernenOp,
        });
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        const holenOp = operationIdVon(zurueck);
        expect(await zeile(19)).toMatchObject({ is_active: true });
        const pruefung = (await vorschau(anna, 19, [holenOp])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [holenOp] });
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_territories"]),
        };
        expect(await vorschauGebiet(cluster.app, gebiet(19), { members: [holenOp] }, nurSache)).toMatchObject({
            ergebnis: "forbidden",
        });
        const antwort = await zuruecknehmen(anna, 19, [holenOp], pruefung.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await zeile(19)).toMatchObject({ is_active: false });
        // „Ganz löschen“ legt nur das Gebiet still; seine Fläche liest die Ableitung ohnehin nicht (wie vor dem Zurückholen).
        const flaechen = await flaechenHeute(gebiet(19));
        expect(flaechen.map((f) => f.is_active)).toEqual([true]);
    });

    it("🔴 B8b2 Felder UND „Grenze zeichnen“: Die Rücknahme der Serie lässt sich selbst zurücknehmen und landet wieder beim Stand danach (Felder, Fläche), und noch einmal zurück", async () => {
        const f = await aendere(anna, 21, { name: "Rücknahmegebiet Einundzwanzig Neu", status: "frei" });
        const g = await sende(anna, "POST", editorTerritoryAreasUrl(gebiet(21)), {
            operationId: randomUUID(),
            baseRevision: await revision(21),
            ring: quadrat(900, 300),
        });
        expect(g.statusCode, g.body).toBe(200);
        const flaecheId = (g.json() as { areaId: string }).areaId;
        const s = await serie(anna, 21);
        expect(s!.members).toEqual([f, operationIdVon(g)]);
        const nachSerie = await zeile(21);
        expect(nachSerie).toMatchObject({ name: "Rücknahmegebiet Einundzwanzig Neu", status_text: "frei" });

        // 1. Die Serie zurück: Felder davor, Fläche still.
        const r1 = await zuruecknehmen(anna, 21, s!.members, s!.membersHash);
        expect(r1.statusCode, r1.body).toBe(200);
        expect(await zeile(21)).toMatchObject({ name: "Rücknahmegebiet Felder und Grenze", status_text: null });
        expect(await flaechenHeute(gebiet(21))).toMatchObject([{ id: flaecheId, is_active: false }]);
        const rueck1 = r1.json().operationId as string;
        expect((await eintrag(anna, rueck1)).objects.map((o) => o.action).sort()).toEqual([
            "territory.updated",
            "territory_area.retired",
        ]);

        // 2. Die Rücknahme selbst zurück: der Stand nach der Serie (Felder, Fläche wieder aktiv).
        const vorschau2 = (await vorschau(anna, 21, [rueck1])).json() as RuecknahmePruefung;
        expect(vorschau2).toMatchObject({ ergebnis: "ok", offen: [rueck1] });
        const r2 = await zuruecknehmen(anna, 21, [rueck1], vorschau2.membersHash);
        expect(r2.statusCode, r2.body).toBe(200);
        expect(await zeile(21)).toEqual(nachSerie);
        expect(await flaechenHeute(gebiet(21))).toMatchObject([{ id: flaecheId, is_active: true }]);

        // 3. Und diese wieder zurück: noch einmal der Stand davor.
        const rueck2 = r2.json().operationId as string;
        const r3 = await zuruecknehmen(anna, 21, [rueck2], await pruefsumme(anna, 21, [rueck2]));
        expect(r3.statusCode, r3.body).toBe(200);
        expect(await zeile(21)).toMatchObject({ name: "Rücknahmegebiet Felder und Grenze", status_text: null });
        expect(await flaechenHeute(gebiet(21))).toMatchObject([{ id: flaecheId, is_active: false }]);

        // Streng: Ändert jemand das Gebiet nach der Rücknahme, bleibt ihre Rücknahme aus (409, 0 Mutationen).
        await aendere(bernd, 21, { shortName: "Eins" });
        const vor = await stand([21]);
        const rueck3 = r3.json().operationId as string;
        const gesperrt = (await vorschau(anna, 21, [rueck3])).json() as RuecknahmePruefung;
        expect(gesperrt.ergebnis).toBe("edit_conflict");
        const abgewiesen = await zuruecknehmen(anna, 21, [rueck3], gesperrt.membersHash);
        expect([abgewiesen.statusCode, abgewiesen.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(await stand([21])).toEqual(vor);
    });

    it("🔴 B8b2 Felder UND Entfernen: Die Serie geht als Ganzes zurück (Gebiet wieder da, Felder davor), die Rücknahme lässt sich selbst zurücknehmen und landet wieder beim Stand danach", async () => {
        const f = await aendere(anna, 22, { type: "Provinz", shortName: "FE" });
        const entfernt = await sende(anna, "POST", editorTerritoryRetireUrl(gebiet(22)), {
            operationId: randomUUID(),
            baseRevision: await revision(22),
            stage: "retire",
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const s = await serie(anna, 22);
        expect(s!.members).toEqual([f, operationIdVon(entfernt)]);
        const nachSerie = await zeile(22);
        expect(nachSerie).toMatchObject({ territory_type: "Provinz", short_name: "FE", is_active: false });

        const pruefung = (await vorschau(anna, 22, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: s!.members });
        const r1 = await zuruecknehmen(anna, 22, s!.members, s!.membersHash);
        expect(r1.statusCode, r1.body).toBe(200);
        expect(await zeile(22)).toMatchObject({ territory_type: "Baronie", short_name: null, is_active: true });
        const rueck1 = r1.json().operationId as string;
        expect((await eintrag(anna, rueck1)).objects.map((o) => o.action).sort()).toEqual([
            "territory.restored",
            "territory.updated",
        ]);

        // Die Rücknahme der Rücknahme: das Gebiet wieder still, die Felder wie nach der Serie, in EINER Operation.
        const vor = await stand([22]);
        const vorschau2 = (await vorschau(anna, 22, [rueck1])).json() as RuecknahmePruefung;
        expect(vorschau2).toMatchObject({ ergebnis: "ok", offen: [rueck1] });
        expect(await stand([22])).toEqual(vor);
        const r2 = await zuruecknehmen(anna, 22, [rueck1], vorschau2.membersHash);
        expect(r2.statusCode, r2.body).toBe(200);
        expect(await zeile(22)).toEqual(nachSerie);
        // Noch einmal zurück: wieder beim Stand davor.
        const rueck2 = r2.json().operationId as string;
        const r3 = await zuruecknehmen(anna, 22, [rueck2], await pruefsumme(anna, 22, [rueck2]));
        expect(r3.statusCode, r3.body).toBe(200);
        expect(await zeile(22)).toMatchObject({ territory_type: "Baronie", short_name: null, is_active: true });
    });

    it("🔴 U9: Recht, Sperre und Liste vor jeder Änderung: Reviewer 403, ohne Anmeldung 401, fremde Sperre 409 `object_locked`, fremdes Gebiet in der Liste 400", async () => {
        const a = await aendere(anna, 9, { type: "Grafschaft" });
        const b = await aendere(anna, 9, { status: "frei" });
        const s = await serie(anna, 9);
        const vorher = await stand([9]);
        expect(((await vorschau(rita, 9, s!.members, s!.membersHash)).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
        const verboten = await zuruecknehmen(rita, 9, s!.members, s!.membersHash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorTerritoryRestoreSeriesUrl(gebiet(9)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [a, b], membersHash: s!.membersHash },
        });
        expect(anonym.statusCode).toBe(401);
        // Eine Liste, die zu einem anderen Gebiet gehört, ist nicht von hier.
        const fremd = await zuruecknehmen(anna, 3, s!.members, s!.membersHash);
        expect([fremd.statusCode, fremd.json().error.code]).toEqual([400, "invalid_members"]);

        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('territory', ${gebiet(9)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const pruefung = (await vorschau(anna, 9, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
            expect(pruefung.sperren[0]).toMatchObject({ kind: "territory", id: gebiet(9), person: { name: "Bernd" } });
            const gesperrt = await zuruecknehmen(anna, 9, s!.members, s!.membersHash);
            expect([gesperrt.statusCode, gesperrt.json().error.code]).toEqual([409, "object_locked"]);
            expect(gesperrt.json().error.details.lock).toMatchObject({
                kind: "territory",
                id: gebiet(9),
                person: { name: "Bernd" },
            });
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${gebiet(9)}::uuid`;
        }
        expect(await stand([9])).toEqual(vorher);
    });

    it("🔴 F.1: Felder und Darstellung verlangen das Sachrecht, Entfernen, „Unter neues Obergebiet“ und Vereinigen zusätzlich das Geometrie-Recht; 0 Mutationen", async () => {
        // Rollen ohne `edit_territory_form` bei `edit_territories` gibt es nicht (beide ab Editor): Das Recht wird hier wie von der Route aus der Sitzung abgeleitet, nur frei gewählt.
        const nurSache: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_territories"]),
        };
        const beide: RuecknahmeLeser = {
            personId: bernd.id,
            rechte: new Set(["use_editor_menu", "edit_territories", "edit_territory_form"]),
        };
        const aktor = { kind: "person" as const, personId: bernd.id, environment: "test" as const };
        // Gebiet 14 hängt noch unter dem Land A; Gebiet 6 ist (nach dem Zurückholen oben) wieder da und kann noch einmal entfernt werden.
        const entfernt = await sende(anna, "POST", editorTerritoryRetireUrl(gebiet(14)), {
            operationId: randomUUID(),
            baseRevision: await revision(14),
            stage: "retire",
            children: "up",
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const op = operationIdVon(entfernt);
        const vorher = await stand([14]);
        const vorschauNurSache = await vorschauGebiet(cluster.app, gebiet(14), { members: [op] }, nurSache);
        expect(vorschauNurSache).toMatchObject({ ergebnis: "forbidden", fehlendeRechte: ["edit_territory_form"] });
        await expect(
            ruecknehmenGebiet(cluster.app, aktor, nurSache, gebiet(14), {
                operationId: randomUUID(),
                members: [op],
                membersHash: vorschauNurSache.membersHash,
                reason: "Falsch entfernt",
            }),
        ).rejects.toMatchObject({ statusCode: 403, code: "forbidden" });
        expect(await stand([14])).toEqual(vorher);
        expect((await vorschauGebiet(cluster.app, gebiet(14), { members: [op] }, beide)).ergebnis).toBe("ok");
        // Die Felder eines Gebiets dagegen verlangen nur das Sachrecht.
        const felder = await aendere(anna, 3, { shortName: "Drei" });
        expect((await vorschauGebiet(cluster.app, gebiet(3), { members: [felder] }, nurSache)).ergebnis).toBe("ok");
    });
});
