import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
    EDITOR_LANDSCAPES_URL,
    EDITOR_PEAKS_URL,
    EditorLandmarkenKandidat,
    EditorLandscapeList,
    editorLandmarkenKandidatUnterdrueckenUrl,
    editorPeakRestoreSeriesPreviewUrl,
    editorPeakRestoreSeriesUrl,
    editorWikiSyncEditRestoreSeriesPreviewUrl,
    editorWikiSyncEditRestoreSeriesUrl,
    wikiLinkKey,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { mapChange } from "../src/editor/history.ts";
import { listEditorLandscapes } from "../src/editor/landscapes.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { createPeak } from "../src/editor/peak-create.ts";
import { readEditorPeak } from "../src/editor/peak-update.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Landmarken-Kandidaten aus dem WikiSync (WI-0271 L7, §4.2): die ◐-Zeilen der Derographie-Liste (`wiki_landmarke_artikel`, Migration 0290), „Auf der Karte setzen“ (`peak.create` mit
 * `wikiKandidat`), „Nicht auf die Karte“ (Route, Quelle `wikisync`) und das ↺ in „Änderungen“. Wegwerf-Cluster mit allen Rollen, Fastify als App-Rolle, die Kandidaten legt die Migrationsrolle
 * an (den Wiki-Stand schreibt der WikiSync, nie die App). 🔴 Keine Zeile in einer gemeinsamen Datenbank.
 *
 * Problemfälle: Ein Artikel, dessen Adresse schon an einer Landmarke hängt (auch an einer stillgelegten, auch kodiert), bleibt Kandidat; die Liste zeigt stillgelegte oder artlose Artikel; eine Höhle
 * übernimmt die Höhe des Artikels und scheitert am CHECK; das Setzen legt einen Wiki-Stand an oder lässt die Adresse oder die Tafel X2 weg; ein zweites Setzen, ein unterdrückter oder stillgelegter
 * Kandidat wird nicht mit 409 abgelehnt oder hinterlässt halbe Zeilen; eine wiederholte Anfrage mit derselben Kennung bekommt 409 statt der ersten Quittung; Unterdrücken ohne Revisionsprüfung, ohne
 * Protokoll am Artikel oder mit Ableitungsaufträgen; das ↺ nimmt eine spätere Entscheidung weg, schreibt unter falscher Operation oder lässt sich zweimal ausführen; ohne Recht oder bei
 * ausgeschaltetem Schalter wird trotzdem geschrieben.
 */

const ENV = "lmkand";
const DOMAIN = "aventuria";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;

const WIKI = "https://de.wiki-aventurica.de/wiki";
const ID = {
    hoehle: "c8c8c8c8-0271-4007-8000-000000000001",
    vulkan: "c8c8c8c8-0271-4007-8000-000000000002",
    stillgelegt: "c8c8c8c8-0271-4007-8000-000000000003",
    aufKarte: "c8c8c8c8-0271-4007-8000-000000000004",
    aufAlterKarte: "c8c8c8c8-0271-4007-8000-000000000005",
    unterdrueckt: "c8c8c8c8-0271-4007-8000-000000000006",
    ohneArt: "c8c8c8c8-0271-4007-8000-000000000007",
    grotte: "c8c8c8c8-0271-4007-8000-000000000008",
    quelle: "c8c8c8c8-0271-4007-8000-00000000000a",
    geysir: "c8c8c8c8-0271-4007-8000-00000000000b",
    berg: "c8c8c8c8-0271-4007-8000-000000000009",
    unbekannt: "c8c8c8c8-0271-4007-8000-0000000000ff",
} as const;
const ZINNE = "c8c8c8c8-0271-4007-8000-000000000a01";
const ALTE_QUELLE = "c8c8c8c8-0271-4007-8000-000000000a02";

/** Die Felder, die der Rücknahme-Adapter des Gipfels an `peak.created` kennt (`ruecknahme-flaeche.ts`); ein weiteres machte das Setzen unrücknehmbar. */
const BEKANNTE_FELDER = new Set(["name", "subtype", "merkmale", "height", "position", "active"]);

describeWithCluster("Landmarken-Kandidaten (WI-0271 L7, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let ausgeschaltet: FastifyInstance;
    let anna = { id: "", cookie: "" };
    let bert = { id: "", cookie: "" };
    let lena = { id: "", cookie: "" };
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const akteur = (person: { id: string }): MapActor => ({
        kind: "person",
        personId: person.id,
        environment: "test",
    });
    const kopf = (person: { cookie: string }) => ({ cookie: person.cookie, origin: TEST_ORIGIN });
    const fehler = async (arbeit: Promise<unknown>): Promise<{ statusCode?: number; code?: string }> => {
        try {
            await arbeit;
            return {};
        } catch (error) {
            return error as { statusCode?: number; code?: string };
        }
    };
    const fehlercode = (antwort: { json(): unknown }): string | undefined =>
        (antwort.json() as { error?: { code?: string } }).error?.code;

    const stand = async (id: string) =>
        (
            await cluster.admin<{ unterdrueckt: boolean; revision: number; is_active: boolean }[]>`
                SELECT unterdrueckt, revision::int AS revision, is_active FROM wiki_landmarke_artikel WHERE public_id = ${id}::uuid`
        )[0]!;
    const zaehle = async (tafel: "terrain_peak" | "wiki_region_snapshot" | "job" | "map_operation"): Promise<number> =>
        (await cluster.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM ${cluster.admin(tafel)}`)[0]!.n;
    /** Das Fachprotokoll einer Operation: Aktion, Ziel, Revisionen und Felder. */
    const protokoll = (operationId: string) =>
        cluster.admin<
            {
                action: string;
                kandidat: string | null;
                vorher: number | null;
                nachher: number | null;
                changes: Record<string, { before?: unknown; after?: unknown }>;
            }[]
        >`
            SELECT action, landmarke_artikel_public_id::text AS kandidat, revision_before::int AS vorher, revision_after::int AS nachher, changes
              FROM map_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id`;
    const operation = async (operationId: string) =>
        (
            await cluster.admin<
                { action: string; source: string; summary: string; receipt: { affected: Record<string, unknown>[] } }[]
            >`SELECT action, source, summary, receipt FROM map_operation WHERE operation_id = ${operationId}::uuid`
        )[0];

    const unterdruecke = (
        person: { cookie: string },
        id: string,
        baseRevision: number,
        unterdrueckt: boolean,
        optionen: { operationId?: string; instanz?: FastifyInstance } = {},
    ) =>
        (optionen.instanz ?? app).inject({
            method: "POST",
            url: editorLandmarkenKandidatUnterdrueckenUrl(id),
            headers: kopf(person),
            payload: { operationId: optionen.operationId ?? randomUUID(), baseRevision, unterdrueckt },
        });
    /** Unterdrücken, das gelingen muss: die Kennung der Operation. */
    const mussUnterdruecken = async (person: { cookie: string }, id: string, unterdrueckt: boolean) => {
        const antwort = await unterdruecke(person, id, (await stand(id)).revision, unterdrueckt);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as { operationId: string }).operationId;
    };
    const vorschau = async (person: { cookie: string }, operationId: string) =>
        (
            await app.inject({
                method: "POST",
                url: editorWikiSyncEditRestoreSeriesPreviewUrl(operationId),
                headers: kopf(person),
                payload: { members: [operationId], membersHash: mitgliederHash([operationId]) },
            })
        ).json() as RuecknahmePruefung;
    const zuruecknehmen = (
        person: { cookie: string },
        operationId: string,
        extra: { operationId?: string; reason?: string } = {},
    ) =>
        app.inject({
            method: "POST",
            url: editorWikiSyncEditRestoreSeriesUrl(operationId),
            headers: kopf(person),
            payload: {
                operationId: randomUUID(),
                members: [operationId],
                membersHash: mitgliederHash([operationId]),
                ...extra,
            },
        });
    const eintrag = async (person: { id: string }, operationId: string) =>
        (await mapChange(cluster.app, operationId, { mapDomainId: DOMAIN, personId: person.id }))!;

    /** Die Kandidaten der Liste, wie die Schicht der Routen sie liest. */
    const liste = async () => (await listEditorLandscapes(cluster.app)).kandidaten ?? [];
    const namenDerListe = async (): Promise<string[]> => (await liste()).map((k) => k.name);

    const legeKandidatenAn = async (): Promise<void> => {
        const m = cluster.migrator;
        const kandidat = async (
            id: string,
            titel: string,
            o: {
                name?: string;
                art?: string | null;
                wikiArt?: string;
                region?: string;
                hoehe?: number;
                kurz?: string;
                unterdrueckt?: boolean;
                still?: boolean;
            },
        ): Promise<void> => {
            await m`
                INSERT INTO wiki_landmarke_artikel (public_id, schluessel, titel, name, art, wiki_art, region, hoehe_schritt, kurzbeschreibung,
                                                    unbekannt, unterdrueckt, is_active, retired_at, retired_origin)
                VALUES (${id}::uuid, ${titel.toLowerCase()}, ${titel}, ${o.name ?? null}, ${o.art === undefined ? null : o.art}, ${o.wikiArt ?? null},
                        ${o.region ?? null}, ${o.hoehe ?? null}, ${o.kurz ?? null}, '{}'::text[], ${o.unterdrueckt ?? false},
                        ${o.still !== true}, ${o.still === true ? new Date() : null}, ${o.still === true ? "wikisync" : null})
            `;
        };
        await kandidat(ID.hoehle, "Schlund der Gorgone", {
            art: "hoehle",
            wikiArt: "Höhle",
            region: "Garetien",
            kurz: "Eine dunkle Höhle unter dem Gorgonenwald.",
        });
        await kandidat(ID.vulkan, "Feuerzahn", {
            name: "Der Feuerzahn",
            art: "vulkan",
            wikiArt: "Vulkan",
            region: "Mhanadistan",
            hoehe: 4200,
        });
        await kandidat(ID.stillgelegt, "Alter Stollen", { art: "hoehle", wikiArt: "Höhle", still: true });
        await kandidat(ID.aufKarte, "Eisige Zinne", { art: "berggipfel", wikiArt: "Berg", hoehe: 3100 });
        await kandidat(ID.aufAlterKarte, "Märchenquelle", { art: "quelle", wikiArt: "Süßwasserquelle" });
        await kandidat(ID.unterdrueckt, "Verborgener Fels", { art: "fels", wikiArt: "Fels", unterdrueckt: true });
        await kandidat(ID.ohneArt, "Artlose Seite", {});
        await kandidat(ID.grotte, "Singende Grotte", { art: "hoehle", wikiArt: "Höhle", region: "Weiden" });
        await kandidat(ID.berg, "Zwiespältiger Berg", { art: "berggipfel", wikiArt: "Berg", hoehe: 1800 });
        await kandidat(ID.quelle, "Murmelnde Quelle", { art: "quelle", wikiArt: "Süßwasserquelle" });
        await kandidat(ID.geysir, "Zischender Geysir", { art: "geysir", wikiArt: "Geysir" });
        // Zwei Artikel hängen schon an einer Landmarke der Karte: die Adresse mit Unterstrich, die andere kodiert und an einer stillgelegten Landmarke (§4.2 Tombstones).
        await m`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt, is_active)
            VALUES (${ZINNE}::uuid, ${DOMAIN}, 'Eisige Zinne', 'berggipfel', ST_SetSRID(ST_MakePoint(540, 520), 0), 3100, TRUE),
                   (${ALTE_QUELLE}::uuid, ${DOMAIN}, 'Märchenquelle', 'quelle', ST_SetSRID(ST_MakePoint(545, 520), 0), NULL, FALSE)
        `;
        await m`
            INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin, is_active, retired_at, retired_origin)
            SELECT id, ${`${WIKI}/Eisige_Zinne`}, NULL::bigint, 'address_only', 'editor', TRUE, NULL, NULL FROM terrain_peak WHERE public_id = ${ZINNE}::uuid
            UNION ALL
            SELECT id, ${`${WIKI}/M%C3%A4rchenquelle`}, NULL::bigint, 'address_only', 'editor', FALSE, now(), 'editor' FROM terrain_peak WHERE public_id = ${ALTE_QUELLE}::uuid
        `;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const fixture = authFixture(cluster.admin);
        const person = async (rolle: "admin" | "reviewer", name: string) => {
            const p = await fixture.person(rolle, { name });
            return { id: p.id, cookie: (await fixture.session(p.id, { passkeyMinutesAgo: 1 })).cookie };
        };
        anna = await person("admin", "Anna");
        bert = await person("admin", "Bert");
        lena = await person("reviewer", "Lena");
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        ausgeschaltet = buildApp({
            config: { ...config, mapEditing: "off" },
            database: cluster.app,
            logStream: { write: () => undefined },
        });
        await Promise.all([app.ready(), ausgeschaltet.ready()]);
    }, 300_000);

    afterAll(async () => {
        await app?.close();
        await ausgeschaltet?.close();
        await cluster?.stop();
    }, 60_000);

    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Die Liste
    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────

    it("🔴 ohne Kandidaten fehlt `kandidaten` in der Liste ganz (die Tafel ist da, aber leer)", async () => {
        const antwort = await listEditorLandscapes(cluster.app);
        expect(antwort).not.toHaveProperty("kandidaten");
        expect(Value.Check(EditorLandscapeList, antwort)).toBe(true);
    });

    it("🔴 die Liste führt aktive Kandidaten ohne Landmarke: Art, Adresse, Höhe nur beim Vulkan; stillgelegte, artlose und solche mit Landmarke (auch stillgelegt, kodiert) fehlen; unterdrückte tragen die Marke", async () => {
        await legeKandidatenAn();
        const kandidaten = await liste();
        expect(kandidaten.map((k) => k.name)).toEqual([
            "Der Feuerzahn",
            "Murmelnde Quelle",
            "Schlund der Gorgone",
            "Singende Grotte",
            "Verborgener Fels",
            "Zischender Geysir",
            "Zwiespältiger Berg",
        ]);
        for (const k of kandidaten) expect(Value.Check(EditorLandmarkenKandidat, k)).toBe(true);
        const nach = (id: string) => kandidaten.find((k) => k.id === id)!;

        expect(nach(ID.vulkan)).toEqual({
            id: ID.vulkan,
            titel: "Feuerzahn",
            name: "Der Feuerzahn",
            art: "vulkan",
            wikiArt: "Vulkan",
            region: "Mhanadistan",
            height: 4200,
            wikiUrl: `${WIKI}/Feuerzahn`,
            revision: 1,
        });
        // Ohne Namen in der Infobox gilt der Titel; die Höhle trägt keine Höhe, der Leerraum im Titel wird zum Unterstrich.
        expect(nach(ID.hoehle)).toEqual({
            id: ID.hoehle,
            titel: "Schlund der Gorgone",
            name: "Schlund der Gorgone",
            art: "hoehle",
            wikiArt: "Höhle",
            region: "Garetien",
            kurzbeschreibung: "Eine dunkle Höhle unter dem Gorgonenwald.",
            wikiUrl: `${WIKI}/Schlund_der_Gorgone`,
            revision: 1,
        });
        expect(nach(ID.hoehle)).not.toHaveProperty("height");
        expect(nach(ID.hoehle)).not.toHaveProperty("unterdrueckt");
        // Der Berg trägt seine Höhe (Berg und Vulkan sind die Arten mit Gelände), der Umlaut im Titel steht in der Adresse kodiert.
        expect(nach(ID.berg)).toMatchObject({ art: "berggipfel", height: 1800 });
        expect(nach(ID.berg).wikiUrl).toBe(`${WIKI}/Zwiesp%C3%A4ltiger_Berg`);
        expect(nach(ID.unterdrueckt)).toMatchObject({ art: "fels", unterdrueckt: true, revision: 1 });

        // Dieselbe Liste kommt über die Route, im Vertrag der Antwort.
        const http = await app.inject({ method: "GET", url: EDITOR_LANDSCAPES_URL, headers: kopf(lena) });
        expect(http.statusCode, http.body).toBe(200);
        expect(http.json<{ kandidaten: unknown[] }>().kandidaten).toEqual(kandidaten);
        expect(Value.Check(EditorLandscapeList, http.json())).toBe(true);
    });

    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // „Auf der Karte setzen“
    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let vulkanGipfel = "";
    let vulkanOperation = "";
    let grotteGipfel = "";
    let grotteOperation = "";

    it("🔴 `peak.create` mit `wikiKandidat` (Vulkan): Name, Art und Höhe vom Artikel; Zuordnung „nur Adresse“ mit Adresse und Tafel X2, kein Wiki-Stand; der Kandidat verschwindet aus der Liste", async () => {
        const snapshotsVorher = await zaehle("wiki_region_snapshot");
        vulkanOperation = randomUUID();
        const quittung = await createPeak(cluster.app, akteur(anna), {
            operationId: vulkanOperation,
            position: [534, 512],
            wikiKandidat: ID.vulkan,
        });
        vulkanGipfel = quittung.publicId;
        expect(quittung.name).toBe("Der Feuerzahn");

        const [zeile] = await cluster.admin<
            { name: string; subtype: string; height: number | null; source: string; aktiv: boolean }[]
        >`
            SELECT name, subtype, height_schritt AS height, source_system AS source, is_active AS aktiv
              FROM terrain_peak WHERE public_id = ${vulkanGipfel}::uuid`;
        expect(zeile).toEqual({
            name: "Der Feuerzahn",
            subtype: "vulkan",
            height: 4200,
            source: "avesmaps3d",
            aktiv: true,
        });
        expect(await readEditorPeak(cluster.app, vulkanGipfel)).toMatchObject({
            name: "Der Feuerzahn",
            subtype: "vulkan",
            height: 4200,
        });

        // Die Zuordnung: nur die Adresse, vom Editor, ohne Wiki-Stand (den legt allein der WikiSync an).
        const zuordnung = await cluster.admin<
            {
                wiki_url: string;
                snapshot_id: number | null;
                state: string;
                origin: string;
                source: string;
                aktiv: boolean;
            }[]
        >`
            SELECT a.wiki_url, a.snapshot_id, a.assignment_state AS state, a.assignment_origin AS origin, a.source_system AS source, a.is_active AS aktiv
              FROM terrain_peak_wiki_assignment a JOIN terrain_peak p ON p.id = a.terrain_peak_id WHERE p.public_id = ${vulkanGipfel}::uuid`;
        expect(zuordnung).toEqual([
            {
                wiki_url: `${WIKI}/Feuerzahn`,
                snapshot_id: null,
                state: "address_only",
                origin: "editor",
                source: "avesmaps3d",
                aktiv: true,
            },
        ]);
        expect(await zaehle("wiki_region_snapshot")).toBe(snapshotsVorher);

        // Die Tafel X2 gegen den Legacy-Zug: Art `region`, Key wie `wikiLinkKey`, Titel des Artikels (nicht der Name der Infobox).
        const x2 = await cluster.admin<
            { wiki_key: string; wiki_url: string; wiki_title: string; source: string; aktiv: boolean }[]
        >`
            SELECT wiki_key, wiki_url, wiki_title, source_system AS source, is_active AS aktiv
              FROM wiki_key_assignment WHERE legacy_art = 'region' AND object_public_id = ${vulkanGipfel}::uuid`;
        expect(x2).toEqual([
            {
                wiki_key: `wiki:${wikiLinkKey(`${WIKI}/Feuerzahn`)}`,
                wiki_url: `${WIKI}/Feuerzahn`,
                wiki_title: "Feuerzahn",
                source: "avesmaps3d",
                aktiv: true,
            },
        ]);

        // Das Protokoll kennt nur Felder, die der Rücknahme-Adapter des Gipfels kennt; der Artikel steht in der Zusammenfassung.
        const eintraege = await protokoll(vulkanOperation);
        expect(eintraege).toHaveLength(1);
        expect(eintraege[0]!.action).toBe("peak.created");
        expect(Object.keys(eintraege[0]!.changes).sort()).toEqual(["active", "height", "name", "position", "subtype"]);
        for (const feld of Object.keys(eintraege[0]!.changes)) expect(BEKANNTE_FELDER.has(feld), feld).toBe(true);
        expect((await operation(vulkanOperation))!.summary).toBe(
            "Der Feuerzahn: neue Landmarke (vulkan) aus dem Wiki-Artikel „Feuerzahn“",
        );

        // Er ist kein Kandidat mehr, die übrigen bleiben.
        expect(await namenDerListe()).toEqual([
            "Murmelnde Quelle",
            "Schlund der Gorgone",
            "Singende Grotte",
            "Verborgener Fels",
            "Zischender Geysir",
            "Zwiespältiger Berg",
        ]);
    });

    it("🔴 dieselbe Kennung noch einmal gibt die erste Quittung, nicht 409; ein zweites Setzen desselben Artikels ist 409 `kandidat_gesetzt` und legt nichts an", async () => {
        const wiederholt = await createPeak(cluster.app, akteur(anna), {
            operationId: vulkanOperation,
            position: [534, 512],
            wikiKandidat: ID.vulkan,
        });
        expect(wiederholt.publicId).toBe(vulkanGipfel);
        expect(wiederholt.name).toBe("Der Feuerzahn");

        const gipfelVorher = await zaehle("terrain_peak");
        const operationenVorher = await zaehle("map_operation");
        expect(
            await fehler(
                createPeak(cluster.app, akteur(bert), {
                    operationId: randomUUID(),
                    position: [536, 512],
                    wikiKandidat: ID.vulkan,
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "kandidat_gesetzt" });
        expect(await zaehle("terrain_peak")).toBe(gipfelVorher);
        expect(await zaehle("map_operation")).toBe(operationenVorher);
    });

    it("🔴 unterdrückt, stillgelegt, unbekannt und „Adresse hängt schon an einer Landmarke“ (auch stillgelegt und kodiert) sind 409 ohne Zeile, die Adresse zählt statt des Namens", async () => {
        const gipfelVorher = await zaehle("terrain_peak");
        const setze = (wikiKandidat: string) =>
            fehler(
                createPeak(cluster.app, akteur(anna), {
                    operationId: randomUUID(),
                    position: [538, 512],
                    wikiKandidat,
                }),
            );
        expect(await setze(ID.unterdrueckt)).toMatchObject({ statusCode: 409, code: "kandidat_unterdrueckt" });
        expect(await setze(ID.stillgelegt)).toMatchObject({ statusCode: 409, code: "kandidat_weg" });
        expect(await setze(ID.unbekannt)).toMatchObject({ statusCode: 409, code: "kandidat_weg" });
        // Ohne bekannte Art ist er kein Kandidat (die Liste zeigt ihn nicht): Er würde sonst still ein Berggipfel.
        expect(await setze(ID.ohneArt)).toMatchObject({ statusCode: 409, code: "kandidat_weg" });
        // Der Lauf hat sie noch nicht still gelegt, die Liste zeigt sie schon nicht mehr: Das Setzen darf sie ebenso wenig doppeln.
        expect(await setze(ID.aufKarte)).toMatchObject({ statusCode: 409, code: "kandidat_gesetzt" });
        expect(await setze(ID.aufAlterKarte)).toMatchObject({ statusCode: 409, code: "kandidat_gesetzt" });
        expect(await zaehle("terrain_peak")).toBe(gipfelVorher);
    });

    it("🔴 die Person darf die Art wählen: Höhle → Grotte mit Merkmalen, ohne Höhe; ein Berg als Höhle verliert die Wiki-Höhe (CHECK), über die Route des Gipfels, mit gültiger Antwort", async () => {
        // Direkt: Der Artikel sagt Höhle, die Person wählt Grotte.
        grotteOperation = randomUUID();
        const grotte = await createPeak(cluster.app, akteur(anna), {
            operationId: grotteOperation,
            position: [550, 512],
            subtype: "grotte",
            merkmale: ["heilig", "verborgen"],
            wikiKandidat: ID.grotte,
        });
        grotteGipfel = grotte.publicId;
        expect(grotte.name).toBe("Singende Grotte");
        expect(await readEditorPeak(cluster.app, grotte.publicId)).toMatchObject({
            subtype: "grotte",
            merkmale: ["heilig", "verborgen"],
        });
        expect(await readEditorPeak(cluster.app, grotte.publicId)).not.toHaveProperty("height");
        const grotteFelder = Object.keys((await protokoll(grotteOperation))[0]!.changes).sort();
        expect(grotteFelder).toEqual(["active", "merkmale", "name", "position", "subtype"]);
        for (const feld of grotteFelder) expect(BEKANNTE_FELDER.has(feld), feld).toBe(true);

        // Über die Route: Der Artikel sagt Berg mit 1800 Schritt, die Person wählt Höhle. Die Höhe fällt weg, sonst scheitert der CHECK `terrain_peak_hoehe_nur_gelaende`.
        const antwort = await app.inject({
            method: "POST",
            url: EDITOR_PEAKS_URL,
            headers: kopf(anna),
            payload: { operationId: randomUUID(), position: [552, 512], subtype: "hoehle", wikiKandidat: ID.berg },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const berg = antwort.json<{ publicId: string; name: string }>();
        expect(berg.name).toBe("Zwiespältiger Berg");
        const detail = await readEditorPeak(cluster.app, berg.publicId);
        expect(detail).toMatchObject({ subtype: "hoehle" });
        expect(detail).not.toHaveProperty("height");
        const [zuordnung] = await cluster.admin<{ wiki_url: string; state: string }[]>`
            SELECT a.wiki_url, a.assignment_state AS state FROM terrain_peak_wiki_assignment a
              JOIN terrain_peak p ON p.id = a.terrain_peak_id WHERE p.public_id = ${berg.publicId}::uuid`;
        expect(zuordnung).toEqual({ wiki_url: `${WIKI}/Zwiesp%C3%A4ltiger_Berg`, state: "address_only" });

        // Beide sind keine Kandidaten mehr; der Rest der Liste.
        expect(await namenDerListe()).toEqual([
            "Murmelnde Quelle",
            "Schlund der Gorgone",
            "Verborgener Fels",
            "Zischender Geysir",
        ]);
    });

    it("🔴 das ↺ am Setzen aus einem Kandidaten nimmt die Landmarke zurück (der Vertrag des Gipfels); die Adresse bleibt an der stillgelegten Landmarke, der Artikel kommt nicht wieder als Kandidat (§4.2 Tombstones)", async () => {
        const vor = await app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesPreviewUrl(grotteGipfel),
            headers: kopf(anna),
            payload: { members: [grotteOperation], membersHash: mitgliederHash([grotteOperation]) },
        });
        expect(vor.json()).toMatchObject({ ergebnis: "ok", offen: [grotteOperation], folgen: { gelaende: "keines" } });
        const antwort = await app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesUrl(grotteGipfel),
            headers: kopf(anna),
            payload: {
                operationId: randomUUID(),
                members: [grotteOperation],
                membersHash: mitgliederHash([grotteOperation]),
            },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ reverts: [grotteOperation] });
        const [gipfel] = await cluster.admin<{ aktiv: boolean }[]>`
            SELECT is_active AS aktiv FROM terrain_peak WHERE public_id = ${grotteGipfel}::uuid`;
        expect(gipfel).toEqual({ aktiv: false });
        const zuordnung = await cluster.admin<{ aktiv: boolean; wiki_url: string }[]>`
            SELECT a.is_active AS aktiv, a.wiki_url FROM terrain_peak_wiki_assignment a
              JOIN terrain_peak p ON p.id = a.terrain_peak_id WHERE p.public_id = ${grotteGipfel}::uuid`;
        expect(zuordnung).toEqual([{ aktiv: true, wiki_url: `${WIKI}/Singende_Grotte` }]);
        // Kein Kandidat mehr, und ein neues Setzen ist ebenso abgelehnt wie bei jeder Landmarke mit dieser Adresse.
        expect(await namenDerListe()).not.toContain("Singende Grotte");
        expect(
            await fehler(
                createPeak(cluster.app, akteur(anna), {
                    operationId: randomUUID(),
                    position: [556, 512],
                    wikiKandidat: ID.grotte,
                }),
            ),
        ).toMatchObject({ statusCode: 409, code: "kandidat_gesetzt" });
    });

    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // „Nicht auf die Karte“
    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let unterdrueckenOperation = "";

    it("🔴 Unterdrücken über die Route: die Spalte wird wahr, die Revision steigt, Operation und Fachprotokoll am Artikel stimmen, es entsteht keine Ableitung", async () => {
        const jobsVorher = await zaehle("job");
        const antwort = await unterdruecke(anna, ID.hoehle, 1, true);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<{
            operationId: string;
            status: string;
            affected: Record<string, unknown>[];
            derivedWork: unknown[];
        }>();
        unterdrueckenOperation = quittung.operationId;
        expect(quittung).toMatchObject({
            status: "applied",
            affected: [{ kind: "landmarke_artikel", id: ID.hoehle, revision: 2 }],
            // Keine Ableitung (kein Auftrag in der Warteschlange); die Schreibnaht hängt immer das erledigte `tiles` an.
            derivedWork: [{ kind: "tiles", state: "done" }],
        });
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: true, revision: 2, is_active: true });
        expect(await zaehle("job")).toBe(jobsVorher);

        expect(await operation(unterdrueckenOperation)).toMatchObject({
            action: "wikisync.landmarke_unterdruecken",
            source: "wikisync",
            summary: "Schlund der Gorgone: nicht auf die Karte",
        });
        expect(await protokoll(unterdrueckenOperation)).toEqual([
            {
                action: "landmarke_artikel.unterdrueckt",
                kandidat: ID.hoehle,
                vorher: 1,
                nachher: 2,
                changes: { unterdrueckt: { before: false, after: true } },
            },
        ]);
        // Die Liste zeigt ihn weiter, jetzt mit Marke und neuer Revision (die Basis des nächsten Schreibens).
        expect((await liste()).find((k) => k.id === ID.hoehle)).toMatchObject({ unterdrueckt: true, revision: 2 });
    });

    it("🔴 Unterdrücken: wieder dasselbe ist 409 `schon_so`, eine falsche Basisrevision 409 `edit_conflict`, ein Unbekannter 404, ohne Recht 403/401; nichts davon schreibt", async () => {
        const operationenVorher = await zaehle("map_operation");
        const code = async (antwort: Promise<{ statusCode: number; json(): unknown }>) => {
            const a = await antwort;
            return [a.statusCode, fehlercode(a)];
        };
        expect(await code(unterdruecke(anna, ID.hoehle, 2, true))).toEqual([409, "schon_so"]);
        // Die Revision wird vor dem Zustand geprüft: Wer eine alte Liste sah, bekommt den Konflikt.
        expect(await code(unterdruecke(anna, ID.hoehle, 1, true))).toEqual([409, "edit_conflict"]);
        expect(await code(unterdruecke(anna, ID.hoehle, 1, false))).toEqual([409, "edit_conflict"]);
        expect(await code(unterdruecke(anna, ID.hoehle, 7, false))).toEqual([409, "edit_conflict"]);
        expect(await code(unterdruecke(anna, ID.unbekannt, 1, true))).toEqual([404, "not_found"]);
        expect(await code(unterdruecke(lena, ID.quelle, 1, true))).toEqual([403, "forbidden"]);
        expect(
            (
                await app.inject({
                    method: "POST",
                    url: editorLandmarkenKandidatUnterdrueckenUrl(ID.quelle),
                    headers: { origin: TEST_ORIGIN },
                    payload: { operationId: randomUUID(), baseRevision: 1, unterdrueckt: true },
                })
            ).statusCode,
        ).toBe(401);
        // Der Schalter MAP_EDITING aus: 423, bevor etwas gelesen wird.
        expect(await code(unterdruecke(anna, ID.quelle, 1, true, { instanz: ausgeschaltet }))).toEqual([
            423,
            "map_editing_off",
        ]);
        expect(await zaehle("map_operation")).toBe(operationenVorher);
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: true, revision: 2, is_active: true });
        expect(await stand(ID.quelle)).toMatchObject({ unterdrueckt: false, revision: 1 });
    });

    it("🔴 dieselbe Kennung zweimal unterdrückt nur einmal: die zweite Anfrage bekommt die erste Quittung, die Revision steigt nicht", async () => {
        const operationId = randomUUID();
        const erste = await unterdruecke(anna, ID.quelle, 1, true, { operationId });
        expect(erste.statusCode, erste.body).toBe(200);
        const zweite = await unterdruecke(anna, ID.quelle, 1, true, { operationId });
        expect(zweite.statusCode, zweite.body).toBe(200);
        expect(zweite.json()).toMatchObject({
            operationId,
            affected: [{ kind: "landmarke_artikel", id: ID.quelle, revision: 2 }],
        });
        expect(await stand(ID.quelle)).toMatchObject({ unterdrueckt: true, revision: 2 });
        expect(await protokoll(operationId)).toHaveLength(1);
        // Aufräumen für die späteren Fälle: Er wird wieder angeboten.
        await mussUnterdruecken(anna, ID.quelle, false);
    });

    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // ↺ in „Änderungen“
    // ────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let anbietenOperation = "";

    it("🔴 ↺ am Unterdrücken: die Vorschau sagt ok, das Ausführen schreibt `wikisync.landmarke_anbieten` mit dem umgekehrten Wert, `reverts` nennt das Original, die Liste zeigt es als zurückgenommen", async () => {
        // Das Unterdrücken von eben: in der Liste rücknehmbar, Quelle wikisync, von Anna.
        expect(await eintrag(anna, unterdrueckenOperation)).toMatchObject({
            operation: "wikisync.landmarke_unterdruecken",
            source: "wikisync",
            status: "ruecknehmbar",
        });
        const vor = await vorschau(anna, unterdrueckenOperation);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.offen).toEqual([unterdrueckenOperation]);
        expect(vor.folgen).toEqual({ gegenstaende: 1, gelaende: "keines" });
        expect(vor.reasonRequired).toBe(false);
        // Die Vorschau liest nur.
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: true, revision: 2, is_active: true });

        const jobsVorher = await zaehle("job");
        anbietenOperation = randomUUID();
        const antwort = await zuruecknehmen(anna, unterdrueckenOperation, { operationId: anbietenOperation });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({
            operationId: anbietenOperation,
            status: "applied",
            reverts: [unterdrueckenOperation],
            affected: [{ kind: "landmarke_artikel", id: ID.hoehle, revision: 3 }],
            derivedWork: [{ kind: "tiles", state: "done" }],
        });
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: false, revision: 3, is_active: true });
        expect(await zaehle("job")).toBe(jobsVorher);
        expect(await operation(anbietenOperation)).toMatchObject({
            action: "wikisync.landmarke_anbieten",
            source: "wikisync",
            summary: "Schlund der Gorgone: wieder angeboten",
        });
        expect(await protokoll(anbietenOperation)).toEqual([
            {
                action: "landmarke_artikel.angeboten",
                kandidat: ID.hoehle,
                vorher: 2,
                nachher: 3,
                changes: { unterdrueckt: { before: true, after: false } },
            },
        ]);

        // Die Liste der Änderungen: das Original gilt als zurückgenommen (von Anna, durch die neue Operation), die neue ist selbst rücknehmbar.
        expect(await eintrag(anna, unterdrueckenOperation)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: anbietenOperation, actor: { kind: "person", id: anna.id } },
        });
        expect(await eintrag(anna, anbietenOperation)).toMatchObject({
            operation: "wikisync.landmarke_anbieten",
            source: "wikisync",
            status: "ruecknehmbar",
            reverts: [unterdrueckenOperation],
        });
    });

    it("🔴 ein zweites ↺ auf dasselbe Unterdrücken ist abgelehnt (`already_reverted`), die Vorschau ebenso; geschrieben wird nichts", async () => {
        const operationenVorher = await zaehle("map_operation");
        expect((await vorschau(anna, unterdrueckenOperation)).ergebnis).toBe("already_reverted");
        const antwort = await zuruecknehmen(anna, unterdrueckenOperation);
        expect(antwort.statusCode, antwort.body).toBe(409);
        expect(fehlercode(antwort)).toBe("already_reverted");
        expect(await zaehle("map_operation")).toBe(operationenVorher);
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: false, revision: 3, is_active: true });
    });

    it("🔴 die Rücknahme der Rücknahme unterdrückt wieder; die Kette hält nur das jüngste Ereignis rücknehmbar (`reverts`/`revertedBy` Glied für Glied)", async () => {
        const wieder = randomUUID();
        const antwort = await zuruecknehmen(anna, anbietenOperation, { operationId: wieder });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ reverts: [anbietenOperation] });
        expect(await stand(ID.hoehle)).toEqual({ unterdrueckt: true, revision: 4, is_active: true });
        expect(await operation(wieder)).toMatchObject({
            action: "wikisync.landmarke_unterdruecken",
            source: "wikisync",
        });

        // Unterdrücken (Original) → Anbieten → Unterdrücken: Jedes gilt, bis das nächste Ereignis des Kandidaten kommt.
        expect(await eintrag(anna, unterdrueckenOperation)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: anbietenOperation },
        });
        expect(await eintrag(anna, anbietenOperation)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: wieder },
            reverts: [unterdrueckenOperation],
        });
        expect(await eintrag(anna, wieder)).toMatchObject({ status: "ruecknehmbar", reverts: [anbietenOperation] });
        expect((await vorschau(anna, unterdrueckenOperation)).ergebnis).toBe("already_reverted");
        expect((await vorschau(anna, anbietenOperation)).ergebnis).toBe("already_reverted");
        expect((await vorschau(anna, wieder)).ergebnis).toBe("ok");
        // Zurück in den Ausgangszustand für die weiteren Fälle.
        await mussUnterdruecken(anna, ID.hoehle, false);
    });

    it("🔴 wird nach dem Unterdrücken von Hand wieder angeboten, ist das ↺ am Unterdrücken `already_reverted`: die Entscheidung danach zählt als dessen Rücknahme, nichts wird weggenommen", async () => {
        const unterdruecken = await mussUnterdruecken(anna, ID.hoehle, true);
        const angeboten = await mussUnterdruecken(anna, ID.hoehle, false);
        expect(await eintrag(anna, unterdruecken)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: { operationId: angeboten },
        });
        expect(await eintrag(anna, angeboten)).toMatchObject({ status: "ruecknehmbar", reverts: [unterdruecken] });
        expect((await vorschau(anna, unterdruecken)).ergebnis).toBe("already_reverted");
        const antwort = await zuruecknehmen(anna, unterdruecken);
        expect(antwort.statusCode, antwort.body).toBe(409);
        expect(fehlercode(antwort)).toBe("already_reverted");
        expect(await stand(ID.hoehle)).toMatchObject({ unterdrueckt: false });
    });

    it("🔴 steht die Spalte ohne Protokoll anders da (von außen geändert) oder fehlt der Artikel, ist das ↺ `edit_conflict` ohne Schreiben", async () => {
        const operationId = await mussUnterdruecken(anna, ID.hoehle, true);
        const operationenVorher = await zaehle("map_operation");
        await cluster.admin`UPDATE wiki_landmarke_artikel SET unterdrueckt = FALSE WHERE public_id = ${ID.hoehle}::uuid`;
        const vor = await vorschau(anna, operationId);
        expect(vor.ergebnis).toBe("edit_conflict");
        expect(vor.konflikte[0]).toMatchObject({
            art: "wert",
            kind: "landmarke_artikel",
            id: ID.hoehle,
            name: "Schlund der Gorgone",
            felder: ["unterdrueckt"],
            abweichung: { was: "felder" },
        });
        const antwort = await zuruecknehmen(anna, operationId);
        expect(antwort.statusCode, antwort.body).toBe(409);
        expect(fehlercode(antwort)).toBe("edit_conflict");
        expect(await zaehle("map_operation")).toBe(operationenVorher);
        expect(await stand(ID.hoehle)).toMatchObject({ unterdrueckt: false });

        // Der Artikel selbst ist weg (gelöscht wird sonst nie): ein Konflikt „geloescht“, kein Absturz.
        await cluster.admin`DELETE FROM wiki_landmarke_artikel WHERE public_id = ${ID.hoehle}::uuid`;
        const weg = await vorschau(anna, operationId);
        expect(weg.ergebnis).toBe("edit_conflict");
        expect(weg.konflikte[0]).toMatchObject({ art: "geloescht", kind: "landmarke_artikel", id: ID.hoehle });
        const wegAntwort = await zuruecknehmen(anna, operationId);
        expect(wegAntwort.statusCode, wegAntwort.body).toBe(409);
        expect(await zaehle("map_operation")).toBe(operationenVorher);
    });

    it("🔴 das ↺ an der Entscheidung einer anderen Person verlangt einen Grund (400 `reason_required`); er steht als `restoreReason` am Eintrag und in der Liste; ein Leser darf nicht", async () => {
        const original = await mussUnterdruecken(anna, ID.geysir, true);
        // Fremde Person ohne Grund: abgelehnt, nichts geschrieben.
        const vorher = await stand(ID.geysir);
        const vor = await vorschau(bert, original);
        expect(vor.ergebnis).toBe("ok");
        expect(vor.reasonRequired).toBe(true);
        expect(vor.fremdePersonen).toMatchObject([{ kind: "person", id: anna.id, name: "Anna" }]);
        const ohne = await zuruecknehmen(bert, original);
        expect(ohne.statusCode, ohne.body).toBe(400);
        expect(fehlercode(ohne)).toBe("reason_required");
        expect(await stand(ID.geysir)).toEqual(vorher);

        const rueck = randomUUID();
        const mit = await zuruecknehmen(bert, original, {
            operationId: rueck,
            reason: "  Gehört doch auf die Karte.  ",
        });
        expect(mit.statusCode, mit.body).toBe(200);
        expect(mit.json()).toMatchObject({ reverts: [original] });
        expect(await stand(ID.geysir)).toMatchObject({ unterdrueckt: false });
        const [protokollEintrag] = await protokoll(rueck);
        expect(protokollEintrag).toMatchObject({
            action: "landmarke_artikel.angeboten",
            changes: {
                unterdrueckt: { before: true, after: false },
                restoreReason: { after: "Gehört doch auf die Karte." },
            },
        });
        expect(await eintrag(anna, original)).toMatchObject({
            status: "bereits_zurueckgenommen",
            revertedBy: {
                operationId: rueck,
                actor: { kind: "person", id: bert.id },
                reason: "Gehört doch auf die Karte.",
            },
        });
        expect(await eintrag(anna, rueck)).toMatchObject({ reason: "Gehört doch auf die Karte.", reverts: [original] });

        // Ein Leser (ohne `edit_map_objects`) bekommt `forbidden` und beim Ausführen 403; die eigene Operation bleibt unberührt.
        const andere = await mussUnterdruecken(anna, ID.geysir, true);
        expect((await vorschau(lena, andere)).ergebnis).toBe("forbidden");
        expect((await zuruecknehmen(lena, andere, { reason: "Nein" })).statusCode).toBe(403);
        expect(await stand(ID.geysir)).toMatchObject({ unterdrueckt: true });
        // Der Schalter MAP_EDITING aus hält auch das ↺ an.
        const aus = await ausgeschaltet.inject({
            method: "POST",
            url: editorWikiSyncEditRestoreSeriesUrl(andere),
            headers: kopf(anna),
            payload: { operationId: randomUUID(), members: [andere], membersHash: mitgliederHash([andere]) },
        });
        expect(aus.statusCode).toBe(423);
        expect(await stand(ID.geysir)).toMatchObject({ unterdrueckt: true });
    });
});
