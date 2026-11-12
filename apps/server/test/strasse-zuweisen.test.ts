import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_STRASSEN_ASSISTENT_STRECKE_URL,
    EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL,
    editorPathRestoreSeriesPreviewUrl,
    editorPathRestoreSeriesUrl,
    editorPathUpdateUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
    type StrasseStreckeAntwort,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Straßen-Assistent (WI-0310): `POST /api/editor/paths/strassen-assistent/strecke` und `…/zuweisen` (`path.assign_street`) samt ↺ über die Rücknahme der Wege, durch Fastify, als App-Rolle im
 * Wegwerf-Cluster mit den Rollen des VPS (Muster `ruecknahme-weg.test.ts`). 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Ein Abschnitt der Lücke bekommt den Namen, aber nicht den Artikel, die Tafel X2 oder die Quellen; die weitere Zuweisung desselben Artikels bleibt aktiv (die Tafel hielte ihn doppelt);
 * ein Abschnitt, der schon fertig ist, zählt trotzdem eine Revision; ein Abschnitt, an dem sich nur der Artikel ändert, zählt keine (ein offener Entwurf merkte es nicht); es entstehen mehrere
 * Operationen; ↺ lässt eine angelegte Zeile aktiv, gibt der Hauptzeile die Herkunft der Redaktion statt die des Imports oder belebt die stillgelegte Quelle nicht zurück in ihren Stand; ↺ schreibt über
 * eine spätere Umbenennung oder eine inzwischen geänderte Zuordnung hinweg; die Rücknahme der Rücknahme weist anders zu als das Original; ein Griff wird zum Namen; die Route schreibt über die Sperre
 * eines anderen oder eine bewegte Revision hinweg.
 */

const ENV = "strassenassistent";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0310";

/** Je Welt (SA, SB, SC) vier Orte und vier Abschnitte, an eigener Stelle der Karte. */
const WELTEN = { SA: 0, SB: 1, SC: 2 } as const;
type Welt = keyof typeof WELTEN;
const ID = (welt: Welt, n: number): string =>
    `03100310-0000-4000-9000-${(WELTEN[welt] * 0x100 + n).toString(16).padStart(12, "0")}`;
/** Die Abschnitte: 1 fertig (A→B), 2 die Lücke mit Griff (B→C), 3 Name ohne den Artikel (C→D), 4 abseits mit Name und Artikel. */
const S = (welt: Welt, n: 1 | 2 | 3 | 4): string => ID(welt, n);
const ORT = (welt: Welt, n: 1 | 2 | 3 | 4): string => ID(welt, 0x10 + n);
const name = (welt: Welt): string => `${welt} Reichsstraße`;
const key = (welt: Welt): string => `${welt.toLowerCase()}-reichs`;

/** Eine Kopie ohne das Feld. */
function ohne<Z extends object, K extends keyof Z>(z: Z, feld: K): Omit<Z, K> {
    const kopie: Partial<Z> = { ...z };
    delete kopie[feld];
    return kopie as Omit<Z, K>;
}

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;
type Person = { id: string; cookie: string };

describeWithCluster("Straßen-Assistent (WI-0310, Wegwerf-Cluster als App-Rolle)", { timeout: 300_000 }, () => {
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
    const sende = (person: { cookie: string }, url: string, payload: Record<string, unknown>): Promise<Antwort> =>
        app.inject({ method: "POST", url, headers: { cookie: person.cookie, origin: TEST_ORIGIN }, payload });
    const zuweisen = (person: Person, welt: Welt, extra: Record<string, unknown> = {}): Promise<Antwort> =>
        sende(person, EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL, {
            operationId: randomUUID(),
            name: name(welt),
            key: key(welt),
            quellen: true,
            sections: [1, 2, 3].map((n) => ({ publicId: S(welt, n as 1 | 2 | 3), baseRevision: 1 })),
            entfernen: [{ publicId: S(welt, 4), baseRevision: 1 }],
            ...extra,
        });
    const vorschau = async (person: Person, abschnitt: string, members: string[]): Promise<RuecknahmePruefung> =>
        (await sende(person, editorPathRestoreSeriesPreviewUrl(abschnitt), { members })).json() as RuecknahmePruefung;
    const zuruecknehmen = async (
        person: Person,
        abschnitt: string,
        members: string[],
        operationId: string = randomUUID(),
    ): Promise<Antwort> =>
        sende(person, editorPathRestoreSeriesUrl(abschnitt), {
            operationId,
            members,
            membersHash: (await vorschau(person, abschnitt, members)).membersHash,
        });
    const eintrag = async (person: Person, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];

    /** Alles, was der Assistent an den vier Abschnitten einer Welt schreiben kann, ohne Zeitstempel und Kennungen. */
    async function zustand(welt: Welt) {
        const a = cluster.admin;
        const ids = ([1, 2, 3, 4] as const).map((n) => S(welt, n));
        const wege = await a<{ id: string; name: string; revision: number }[]>`
            SELECT public_id::text AS id, name, revision::int AS revision FROM path WHERE public_id = ANY(${ids}::uuid[]) ORDER BY public_id`;
        const zuordnungen = await a<
            {
                id: string;
                role: string;
                aktiv: boolean;
                key: string | null;
                herkunft: string;
                system: string;
                still: string | null;
            }[]
        >`
            SELECT p.public_id::text AS id, w.role, w.is_active AS aktiv, s.wiki_key AS key, w.assignment_origin AS herkunft, w.source_system AS system,
                   w.retired_origin AS still
              FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
             WHERE p.public_id = ANY(${ids}::uuid[]) ORDER BY p.public_id, w.role, s.wiki_key`;
        const x2 = await a<{ id: string; aktiv: boolean; key: string; system: string }[]>`
            SELECT object_public_id::text AS id, is_active AS aktiv, wiki_key AS key, source_system AS system FROM wiki_key_assignment
             WHERE object_public_id = ANY(${ids}::uuid[]) ORDER BY object_public_id`;
        const quellen = await a<
            {
                id: string;
                titel: string;
                zustand: string;
                art: string | null;
                seiten: string | null;
                system: string;
                still: string | null;
            }[]
        >`
            SELECT p.public_id::text AS id, f.title AS titel, v.state AS zustand, v.reference_kind AS art, v.pages AS seiten, v.source_system AS system,
                   v.retired_origin AS still
              FROM path_source v JOIN path p ON p.id = v.path_id JOIN feature_source f ON f.id = v.source_id
             WHERE p.public_id = ANY(${ids}::uuid[]) ORDER BY p.public_id, f.title`;
        const herkunft = await a<{ id: string; origin: string }[]>`
            SELECT object_id::text AS id, origin FROM field_origin WHERE object_kind = 'path' AND field = 'name' AND object_id = ANY(${ids}::uuid[])
             ORDER BY object_id`;
        const je = <Z extends { id: string }>(zeilen: readonly Z[], id: string) =>
            zeilen.filter((z) => z.id === id).map((z) => ohne(z, "id"));
        return Object.fromEntries(
            ([1, 2, 3, 4] as const).map((n) => {
                const id = S(welt, n);
                const weg = wege.find((w) => w.id === id)!;
                return [
                    `s${String(n)}`,
                    {
                        name: weg.name,
                        revision: weg.revision,
                        zuordnungen: je(zuordnungen, id),
                        x2: je(x2, id),
                        quellen: je(quellen, id),
                        herkunft: herkunft.find((h) => h.id === id)?.origin ?? null,
                    },
                ];
            }),
        );
    }
    const ohneRevision = (stand: Awaited<ReturnType<typeof zustand>>) =>
        Object.fromEntries(Object.entries(stand).map(([k, abschnitt]) => [k, ohne(abschnitt, "revision")]));

    async function legeWelt(welt: Welt): Promise<void> {
        const m = cluster.migrator;
        const ox = 100 + WELTEN[welt] * 300;
        const orte = ["Agilsburg", "Beilunk", "Calbrozim", "Dunkelstein"] as const;
        for (const [i, ortName] of orte.entries())
            await m`INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                    VALUES (${ORT(welt, (i + 1) as 1 | 2 | 3 | 4)}, ${DOMAIN}, ${`${welt} ${ortName}`}, 'dorf',
                            ST_SetSRID(ST_MakePoint(${ox + 10 * i}, 100), 0), ${SOURCE}, TRUE)`;
        const linie = (n: 1 | 2 | 3 | 4, wegName: string, punkte: [number, number][]) =>
            m`INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
              VALUES (${S(welt, n)}, ${DOMAIN}, ${wegName}, 'Strasse', TRUE, FALSE,
                      ST_SetSRID(ST_GeomFromText(${`LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`}), 0), ${SOURCE}, TRUE)`;
        await linie(1, name(welt), [
            [ox, 100],
            [ox + 5, 102],
            [ox + 10, 100],
        ]);
        await linie(2, "Strasse-11192", [
            [ox + 10, 100],
            [ox + 15, 102],
            [ox + 20, 100],
        ]);
        await linie(3, name(welt), [
            [ox + 20, 100],
            [ox + 25, 102],
            [ox + 30, 100],
        ]);
        await linie(4, name(welt), [
            [ox + 100, 200],
            [ox + 110, 200],
        ]);
        const stand = async (k: string, titel: string, verlauf: string | null) =>
            (
                await m<{ id: string }[]>`
                    INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art, verlauf)
                    VALUES (${k}, ${`https://de.wiki-aventurica.de/wiki/${k}`}, ${titel}, 'strasse', 'Reichsstraße', ${verlauf})
                    RETURNING id::text AS id`
            )[0]!.id;
        const reichs = await stand(
            key(welt),
            name(welt),
            `${welt} Agilsburg → ${welt} Beilunk → ${welt} Unbekannt → ${welt} Calbrozim`,
        );
        const alt = await stand(`${welt.toLowerCase()}-alt`, `${welt} Alte Straße`, null);
        const zuweise = (n: 1 | 3 | 4, snapshot: string, role: "main" | "further", k: string) =>
            m`INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin)
              SELECT id, ${role}, ${`https://de.wiki-aventurica.de/wiki/${k}`}, ${snapshot}::bigint, 'assigned', 'legacy_editor'
                FROM path WHERE public_id = ${S(welt, n)}::uuid`;
        await zuweise(1, reichs, "main", key(welt));
        await zuweise(3, alt, "main", `${welt.toLowerCase()}-alt`);
        await zuweise(3, reichs, "further", key(welt));
        await zuweise(4, reichs, "main", key(welt));
        for (const [n, k] of [
            [1, key(welt)],
            [3, `${welt.toLowerCase()}-alt`],
            [4, key(welt)],
        ] as const)
            await m`INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url)
                    VALUES ('weg', ${S(welt, n)}::uuid, ${`wiki:${k}`}, ${`https://de.wiki-aventurica.de/wiki/${k}`})`;
        await m`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('path', ${S(welt, 3)}::uuid, 'name', 'wiki')`;
        const quelle = async (n: number, titel: string, offiziell: boolean) =>
            (
                await m<{ id: string }[]>`
                    INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official)
                    VALUES (${`legacy-id:${String(3100 + WELTEN[welt] * 10 + n)}`}, 'provisional', ${3100 + WELTEN[welt] * 10 + n}, ${titel}, 'regelbuch', ${offiziell})
                    RETURNING id::text AS id`
            )[0]!.id;
        const q1 = await quelle(1, `${welt} Quelle Eins`, true);
        const q2 = await quelle(2, `${welt} Quelle Zwei`, false);
        await m`INSERT INTO path_source (path_id, source_id, reference_kind, pages, position, source_system)
                SELECT id, ${q1}::bigint, 'erwaehnung', '12', 0, 'legacy' FROM path WHERE public_id = ${S(welt, 1)}::uuid`;
        await m`INSERT INTO path_source (path_id, source_id, position, source_system)
                SELECT id, ${q2}::bigint, 1, 'legacy' FROM path WHERE public_id = ${S(welt, 1)}::uuid`;
        // Am dritten Abschnitt hat die Redaktion die erste Quelle gelöst: Zuweisen belebt sie, ↺ legt sie wieder still.
        await m`INSERT INTO path_source (path_id, source_id, position, state, is_active, retired_at, retired_origin, source_system)
                SELECT id, ${q1}::bigint, 0, 'retired', FALSE, now(), 'editor', 'legacy' FROM path WHERE public_id = ${S(welt, 3)}::uuid`;
    }

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        for (const welt of Object.keys(WELTEN) as Welt[]) await legeWelt(welt);
        const fixture = authFixture(cluster.admin);
        const person = async (personName: string, role: "editor" | "reviewer"): Promise<Person> => {
            const p = await fixture.person(role, { name: personName });
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

    it("🔴 die Strecke liest: Orte aus dem Verlauf (ein unbekannter Name daneben), die Lücke mit Griff, Zustände, abseits mit Vorschlag, die Quellen der Straße; mit eigener Ortsliste bis zum vierten Ort", async () => {
        const vorher = await zustand("SA");
        // Ein Griff allein ist seine eigene Straße, ohne Artikel und Namen: keine Orte, keine Strecke.
        const griff = await sende(anna, EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, { anker: S("SA", 2) });
        expect(griff.statusCode, griff.body).toBe(200);
        expect(griff.json<StrasseStreckeAntwort>()).toMatchObject({ artikel: null, name: "", orte: [], teile: [] });
        // Mit dem Artikel (so ruft die Wiki-Box) ist es die Straße des Artikels, gleich von welchem Abschnitt aus.
        const strecke = await sende(anna, EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, { anker: S("SA", 2), key: key("SA") });
        expect(strecke.statusCode, strecke.body).toBe(200);
        const s = strecke.json<StrasseStreckeAntwort>();
        expect(s.artikel).toMatchObject({ key: key("SA"), name: name("SA") });
        expect(s.name).toBe(name("SA"));
        expect(s.orte.map((o) => o.id)).toEqual([ORT("SA", 1), ORT("SA", 2), ORT("SA", 3)]);
        expect(s.unbekannt).toEqual(["SA Unbekannt"]);
        expect(s.teile.map((t) => [t.von, t.nach, t.abschnitte])).toEqual([
            [ORT("SA", 1), ORT("SA", 2), [S("SA", 1)]],
            [ORT("SA", 2), ORT("SA", 3), [S("SA", 2)]],
        ]);
        expect(s.teile[0]!.laenge).toBeGreaterThan(0);
        expect(s.abschnitte[S("SA", 1)]).toMatchObject({ zustand: "fertig", quellen: 2, wiki: { key: key("SA") } });
        expect(s.abschnitte[S("SA", 2)]).toMatchObject({
            zustand: "name",
            name: "Strasse-11192",
            quellen: 0,
            wiki: null,
        });
        expect(s.abseits).toEqual([S("SA", 3), S("SA", 4)]);
        expect(s.abschnitte[S("SA", 3)]).toMatchObject({ zustand: "artikel", quellen: 0 });
        expect(s.vorschlaege.map((o) => o.id)).toEqual([ORT("SA", 4)]);
        expect(s.quellen.map((q) => q.titel)).toEqual(["SA Quelle Eins", "SA Quelle Zwei"]);
        const mitListe = await sende(anna, EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, {
            anker: S("SA", 1),
            orte: [1, 2, 3, 4].map((n) => ORT("SA", n as 1 | 2 | 3 | 4)),
        });
        expect(mitListe.json<StrasseStreckeAntwort>().teile.map((t) => t.abschnitte)).toEqual([
            [S("SA", 1)],
            [S("SA", 2)],
            [S("SA", 3)],
        ]);
        expect(mitListe.json<StrasseStreckeAntwort>().abseits).toEqual([S("SA", 4)]);
        // Nur lesend: nichts geändert; der Reviewer darf lesen.
        expect((await sende(rita, EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, { anker: S("SA", 1) })).statusCode).toBe(200);
        expect(await zustand("SA")).toEqual(vorher);
    });

    it("🔴 Zuweisen in EINER Operation: Name, Artikel samt X2, die weitere Zuweisung still, Quellen angelegt und belebt, Etikett; der fertige Abschnitt bleibt; abseits verliert Name und Artikel. ↺ ganz, ↺ der Rücknahme, und wieder zurück", async () => {
        const anfang = await zustand("SA");
        const id = randomUUID();
        const antwort = await zuweisen(anna, "SA", { operationId: id });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<{ anker: string; affected: { id: string; revision: number }[] }>();
        expect(quittung.anker).toBe(S("SA", 1));
        expect(quittung.affected.map((a) => [a.id, a.revision])).toEqual([
            [S("SA", 2), 2],
            [S("SA", 3), 2],
            [S("SA", 4), 2],
        ]);
        const nach = await zustand("SA");
        const k = key("SA");
        expect(nach).toEqual({
            // Fertig: nicht angefasst, keine Revision.
            s1: anfang["s1"],
            s2: {
                name: name("SA"),
                revision: 2,
                zuordnungen: [
                    { role: "main", aktiv: true, key: k, herkunft: "editor", system: "avesmaps3d", still: null },
                ],
                x2: [{ aktiv: true, key: `wiki:${k}`, system: "avesmaps3d" }],
                // Die Angaben des ersten Abschnitts, der die Quelle trägt.
                quellen: [
                    {
                        titel: "SA Quelle Eins",
                        zustand: "active",
                        art: "erwaehnung",
                        seiten: "12",
                        system: "editor",
                        still: null,
                    },
                    {
                        titel: "SA Quelle Zwei",
                        zustand: "active",
                        art: null,
                        seiten: null,
                        system: "editor",
                        still: null,
                    },
                ],
                herkunft: "manual",
            },
            s3: {
                // Der Name bleibt, und mit ihm seine Herkunft; die Revision zählt trotzdem.
                name: name("SA"),
                revision: 2,
                zuordnungen: [
                    {
                        role: "further",
                        aktiv: false,
                        key: k,
                        herkunft: "legacy_editor",
                        system: "legacy",
                        still: "editor",
                    },
                    { role: "main", aktiv: true, key: k, herkunft: "editor", system: "avesmaps3d", still: null },
                ],
                x2: [{ aktiv: true, key: `wiki:${k}`, system: "avesmaps3d" }],
                quellen: [
                    {
                        titel: "SA Quelle Eins",
                        zustand: "active",
                        art: "erwaehnung",
                        seiten: "12",
                        system: "editor",
                        still: null,
                    },
                    {
                        titel: "SA Quelle Zwei",
                        zustand: "active",
                        art: null,
                        seiten: null,
                        system: "editor",
                        still: null,
                    },
                ],
                herkunft: "wiki",
            },
            s4: {
                name: "",
                revision: 2,
                zuordnungen: [
                    { role: "main", aktiv: false, key: k, herkunft: "editor", system: "legacy", still: "editor" },
                ],
                x2: [{ aktiv: false, key: `wiki:${k}`, system: "legacy" }],
                quellen: [],
                herkunft: "manual",
            },
        });
        // Das Etikett der Lücke ist neu gerechnet (eine offizielle Quelle, oder der Namensraum des Artikels).
        const [etikett] = await cluster.admin<{ canon: string }[]>`
            SELECT c.canon FROM path_canon c JOIN path p ON p.id = c.path_id WHERE p.public_id = ${S("SA", 2)}::uuid`;
        expect(etikett?.canon).toBe("official");
        // EINE Operation, je geschriebenem Abschnitt ein Eintrag.
        const vorwaerts = await eintrag(anna, id);
        expect(vorwaerts).toMatchObject({ operation: "path.assign_street", source: "editor" });
        expect(vorwaerts.objects.map((o) => [o.id, o.action])).toEqual([
            [S("SA", 2), "path.street_assigned"],
            [S("SA", 3), "path.street_assigned"],
            [S("SA", 4), "path.street_assigned"],
        ]);
        const zwei = vorwaerts.objects[0]!.changes;
        expect(zwei["name"]).toEqual({ before: "Strasse-11192", after: name("SA") });
        expect(zwei["nameOrigin"]).toEqual({ before: null, after: "manual" });
        expect(zwei["wiki"]).toEqual({
            before: null,
            after: { titel: name("SA"), url: `https://de.wiki-aventurica.de/wiki/${k}` },
        });
        expect(zwei["quellen"]?.after).toEqual([
            { sourceId: expect.any(String), title: "SA Quelle Eins" },
            { sourceId: expect.any(String), title: "SA Quelle Zwei" },
        ]);
        expect(vorwaerts.objects[1]!.changes["name"]).toBeUndefined();

        // ↺ ganz: alles zurück, die angelegten Zeilen still gelegt, die Hauptzeile mit der Herkunft des Imports.
        const pruefung = await vorschau(anna, S("SA", 3), [id]);
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [id], konflikte: [] });
        const rueckId = randomUUID();
        const rueck = await zuruecknehmen(anna, S("SA", 3), [id], rueckId);
        expect(rueck.statusCode, rueck.body).toBe(200);
        const zurueck = await zustand("SA");
        expect(ohneRevision(zurueck)).toEqual(
            ohneRevision({
                ...anfang,
                s2: {
                    ...anfang["s2"]!,
                    zuordnungen: [
                        {
                            role: "main",
                            aktiv: false,
                            key: k,
                            herkunft: "editor",
                            system: "avesmaps3d",
                            still: "editor",
                        },
                    ],
                    x2: [{ aktiv: false, key: `wiki:${k}`, system: "avesmaps3d" }],
                    quellen: [
                        {
                            titel: "SA Quelle Eins",
                            zustand: "retired",
                            art: "erwaehnung",
                            seiten: "12",
                            system: "editor",
                            still: "editor",
                        },
                        {
                            titel: "SA Quelle Zwei",
                            zustand: "retired",
                            art: null,
                            seiten: null,
                            system: "editor",
                            still: "editor",
                        },
                    ],
                    // Einen Vermerk, den es vorher nicht gab, löscht ↺ nicht.
                    herkunft: "manual",
                },
                s3: {
                    ...anfang["s3"]!,
                    quellen: [
                        ...anfang["s3"]!.quellen,
                        {
                            titel: "SA Quelle Zwei",
                            zustand: "retired",
                            art: null,
                            seiten: null,
                            system: "editor",
                            still: "editor",
                        },
                    ],
                },
                s4: { ...anfang["s4"]!, herkunft: "manual" },
            }),
        );
        const rueckEintrag = await eintrag(anna, rueckId);
        expect(rueckEintrag).toMatchObject({ source: "restore", operation: "path.restore_series", reverts: [id] });
        expect(rueckEintrag.objects.map((o) => o.action)).toEqual(Array(3).fill("path.street_assigned"));
        // Doppelt geht nicht.
        expect((await zuruecknehmen(anna, S("SA", 2), [id])).statusCode).toBe(409);

        // ↺ der Rücknahme: wieder zugewiesen, genau wie die Operation es tat.
        const wiederId = randomUUID();
        const wieder = await zuruecknehmen(anna, S("SA", 2), [rueckId], wiederId);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(ohneRevision(await zustand("SA"))).toEqual(ohneRevision(nach));
        expect((await eintrag(anna, wiederId)).objects.map((o) => o.action)).toEqual(
            Array(3).fill("path.street_assigned_again"),
        );
        // Und deren Rücknahme ist wieder die des Originals.
        const dritte = await zuruecknehmen(anna, S("SA", 4), [wiederId]);
        expect(dritte.statusCode, dritte.body).toBe(200);
        expect(ohneRevision(await zustand("SA"))).toEqual(ohneRevision(zurueck));
    });

    it("🔴 ↺ verweigert: eine inzwischen anders gelegte Zuordnung (ohne Revision) und eine spätere Umbenennung; geschrieben wird nichts", async () => {
        const id = randomUUID();
        expect((await zuweisen(anna, "SB", { operationId: id })).statusCode).toBe(200);
        // Jemand legt die neue Hauptzeile der Lücke an der Revision vorbei still: Die Rücknahme setzte sonst eine fremde Zeile um.
        await cluster.admin`
            UPDATE path_wiki_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'import'
             WHERE role = 'main' AND path_id = (SELECT id FROM path WHERE public_id = ${S("SB", 2)}::uuid)`;
        const vorher = await zustand("SB");
        const geaendert = await vorschau(anna, S("SB", 2), [id]);
        expect(geaendert.ergebnis).not.toBe("ok");
        expect(geaendert.konflikte).toContainEqual(
            expect.objectContaining({ art: "wert", id: S("SB", 2), felder: ["wiki"] }),
        );
        const abgewiesen = await sende(anna, editorPathRestoreSeriesUrl(S("SB", 2)), {
            operationId: randomUUID(),
            members: [id],
            membersHash: geaendert.membersHash,
        });
        expect(abgewiesen.statusCode).toBe(409);
        expect(await zustand("SB")).toEqual(vorher);
        await cluster.admin`
            UPDATE path_wiki_assignment SET is_active = TRUE, retired_at = NULL, retired_origin = NULL
             WHERE role = 'main' AND path_id = (SELECT id FROM path WHERE public_id = ${S("SB", 2)}::uuid)`;
        expect((await vorschau(anna, S("SB", 2), [id])).ergebnis).toBe("ok");

        // Bernd benennt die Straße danach um: ↺ legte sonst seinen Namen um.
        const umbenannt = await sende(bernd, editorPathUpdateUrl(S("SB", 1)), {
            operationId: randomUUID(),
            sections: [
                { publicId: S("SB", 1), baseRevision: 1 },
                { publicId: S("SB", 2), baseRevision: 2 },
                { publicId: S("SB", 3), baseRevision: 2 },
            ],
            name: "SB Zufall",
        });
        expect(umbenannt.statusCode, umbenannt.body).toBe(200);
        const nachUmbenennung = await zustand("SB");
        const spaeter = await vorschau(anna, S("SB", 2), [id]);
        expect(spaeter.ergebnis).toBe("edit_conflict");
        expect(spaeter.konflikte).toContainEqual(expect.objectContaining({ art: "spaeter", id: S("SB", 2) }));
        const nein = await sende(anna, editorPathRestoreSeriesUrl(S("SB", 2)), {
            operationId: randomUUID(),
            members: [id],
            membersHash: spaeter.membersHash,
        });
        expect([nein.statusCode, nein.json<{ error: { code: string } }>().error.code]).toEqual([409, "edit_conflict"]);
        expect(await zustand("SB")).toEqual(nachUmbenennung);
    });

    it("🔴 abgewiesen, ohne zu schreiben: Griff und leerer Name (400), doppelt oder in beiden Listen (400), unbekannter Artikel (400), bewegte Revision (409), fremde Sperre (409), Reviewer (403)", async () => {
        const vorher = await zustand("SC");
        const fehler = async (antwort: Antwort) => [
            antwort.statusCode,
            antwort.json<{ error: { code: string } }>().error.code,
        ];
        expect(await fehler(await zuweisen(anna, "SC", { name: "Strasse-11192" }))).toEqual([400, "validation_failed"]);
        expect(await fehler(await zuweisen(anna, "SC", { name: "   " }))).toEqual([400, "validation_failed"]);
        expect(await fehler(await zuweisen(anna, "SC", { sections: [], entfernen: [] }))).toEqual([
            400,
            "validation_failed",
        ]);
        expect(
            await fehler(
                await zuweisen(anna, "SC", {
                    sections: [
                        { publicId: S("SC", 2), baseRevision: 1 },
                        { publicId: S("SC", 2), baseRevision: 1 },
                    ],
                }),
            ),
        ).toEqual([400, "validation_failed"]);
        expect(
            await fehler(
                await zuweisen(anna, "SC", {
                    sections: [{ publicId: S("SC", 2), baseRevision: 1 }],
                    entfernen: [{ publicId: S("SC", 2), baseRevision: 1 }],
                }),
            ),
        ).toEqual([400, "validation_failed"]);
        expect(await fehler(await zuweisen(anna, "SC", { key: "gibt-es-nicht" }))).toEqual([400, "validation_failed"]);
        expect(
            await fehler(
                await zuweisen(anna, "SC", { sections: [{ publicId: S("SC", 2), baseRevision: 7 }], entfernen: [] }),
            ),
        ).toEqual([409, "edit_conflict"]);
        expect((await zuweisen(rita, "SC")).statusCode).toBe(403);
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${S("SC", 3)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', gen_random_uuid())`;
        expect(await fehler(await zuweisen(anna, "SC"))).toEqual([409, "object_locked"]);
        await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${S("SC", 3)}::uuid`;
        expect((await sende(anna, EDITOR_STRASSEN_ASSISTENT_STRECKE_URL, { anker: ID("SC", 9) })).statusCode).toBe(404);
        expect(await zustand("SC")).toEqual(vorher);
        const [{ n } = { n: 0 }] = await cluster.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE action = 'path.assign_street'
               AND operation_id IN (SELECT operation_id FROM map_audit_event WHERE path_public_id::text LIKE '03100310-0000-4000-9000-0000000002%')`;
        expect(n).toBe(0);
        // Und die eigene Sperre hält nicht auf: Zuweisen geht.
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${S("SC", 3)}::uuid, 'felder', ${anna.id}::uuid, 'Anna', gen_random_uuid())`;
        expect((await zuweisen(anna, "SC")).statusCode).toBe(200);
        await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${S("SC", 3)}::uuid`;
    });
});
