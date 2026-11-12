import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
    COMMUNITY_URL,
    KARTENSERIEN_PRODUCTION_URL,
    KARTENSERIEN_URL,
    KARTENVORSCHLAG_REDAKTION_URL,
    MEDIA_KARTEN_URL,
    MEDIA_PHOTOBOX_URL,
    BESUCH_EDITOREN_URL,
    MEDIA_UPLOAD_URL,
    SOCIAL_URL,
    type AuthSessionResponse,
    type BesuchEditoren,
    type VorgangDetail,
    WEGFINDUNG_URL,
    EDITOR_PEAKS_URL,
    EDITOR_TERRITORIES_URL,
    EDITOR_TERRITORY_DISPLAY_URL,
    EDITOR_TERRITORY_OBERGEBIET_URL,
    mediaRightsReviewUrl,
    mediaRightsUrl,
    editorLandscapesBatchUrl,
    editorLandscapeUrl,
    editorTerritoryUrl,
    WETTERMODELL_URL,
    wetterPresetZeitpunktUrl,
    EDITOR_LOCKS_URL,
    editorSpracheAendernUrl,
    inhalteQuelleAendernUrl,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { bearbeitende } from "../src/community/glocke.ts";
import type { Database } from "../src/database.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Durchsetzungstafel der Fachrechte (WI-0279, Paket 2): je Sonderrolle ein Tester, der genau seine Wege darf und die Nachbarn nicht, ohne
 * Rolle überall 403. „Darf“ heißt: Die Prüfung des Rechts lässt durch; was danach kommt (404 für einen Vorgang, den es nicht gibt), zählt nicht.
 */
const ENV = "durchsetzung";
const describeWithCluster = postgresBin ? describe : describe.skip;
const UNBEKANNT = randomUUID();

type Weg = { name: string; method: "GET" | "POST"; url: string; payload?: object };

const BEITRAG = `${SOCIAL_URL}/${UNBEKANNT}/freigeben`;
const WEGE: Record<string, Weg> = {
    wegfindungLesen: { name: "Wegfindung lesen", method: "GET", url: WEGFINDUNG_URL },
    wegfindungSetzen: {
        name: "Wegfindung setzen",
        method: "POST",
        url: WEGFINDUNG_URL,
        payload: { operationId: randomUUID(), key: "unbekannt", value: 1 },
    },
    hoehenmodell: { name: "Höhenmodell lesen", method: "GET", url: "/api/admin/system/hoehenmodell" },
    kartenserien: { name: "Kartenserien lesen", method: "GET", url: KARTENSERIEN_URL },
    uebernahme: {
        name: "Kartenserie nach Production",
        method: "POST",
        url: KARTENSERIEN_PRODUCTION_URL,
        payload: { operationId: randomUUID() },
    },
    kartenvorschlaege: { name: "Kartenvorschläge lesen", method: "GET", url: KARTENVORSCHLAG_REDAKTION_URL },
    reisebild: {
        name: "Reisebild freigeben",
        method: "POST",
        url: `${MEDIA_PHOTOBOX_URL}/${UNBEKANNT}/approve`,
        payload: { operationId: randomUUID(), baseRevision: 1 },
    },
    karte: {
        name: "Karte der Sammlung ändern",
        method: "POST",
        url: `${MEDIA_KARTEN_URL}/${UNBEKANNT}/update`,
        payload: { operationId: randomUUID(), baseRevision: 1 },
    },
    social: {
        name: "Beitrag freigeben",
        method: "POST",
        url: BEITRAG,
        payload: { operationId: randomUUID(), baseRevision: 1 },
    },
    mails: { name: "Anfragen lesen", method: "GET", url: `${COMMUNITY_URL}/vorgaenge?segment=eingang` },
    meldungen: { name: "Meldungen lesen", method: "GET", url: `${COMMUNITY_URL}/vorgaenge` },
    betrieb: { name: "Betrieb lesen", method: "GET", url: "/api/admin/system" },
    personen: { name: "Personen verwalten", method: "GET", url: "/api/admin/people" },
    rechtePruefen: {
        name: "Rechte prüfen und freigeben",
        method: "POST",
        url: mediaRightsReviewUrl(UNBEKANNT),
        payload: { operationId: randomUUID(), baseRevision: 1, decision: "cleared" },
    },
    rechteSetzen: {
        name: "Rechte eintragen",
        method: "POST",
        url: mediaRightsUrl(UNBEKANNT),
        payload: { operationId: randomUUID(), baseRevision: 1, rights: { basis: "public_domain" } },
    },
    hochladen: {
        name: "Bild hochladen",
        method: "POST",
        url: MEDIA_UPLOAD_URL,
        payload: { operationId: randomUUID() },
    },
    // Das Wetter (WI-0288): ein Preset verschieben (Editoren und Meteorologe) und das Wettermodell verstellen (nur Meteorologe).
    wetterPreset: {
        name: "Wetter-Preset verschieben",
        method: "POST",
        url: wetterPresetZeitpunktUrl("p-praios"),
        payload: { operationId: randomUUID(), baseRevision: 0, tag: 16 },
    },
    wettermodell: {
        name: "Wettermodell verstellen",
        method: "POST",
        url: WETTERMODELL_URL,
        payload: { operationId: randomUUID(), baseRevision: 1, id: "conf", value: 2 },
    },
    // Das Sprachmodul (Linguist, Betreiber 2026-11-08): eine Sprache ändern und sperren; dazu eine Quelle ändern, die der Linguist nicht schreibt.
    sprache: {
        name: "Sprache ändern",
        method: "POST",
        url: editorSpracheAendernUrl(UNBEKANNT),
        payload: { operationId: randomUUID(), baseRevision: 1, name: "Probe" },
    },
    spracheSperren: {
        name: "Sprache sperren",
        method: "POST",
        url: EDITOR_LOCKS_URL,
        payload: { kind: "sprache", id: UNBEKANNT, part: "form", run: randomUUID() },
    },
    quelle: {
        name: "Quelle ändern",
        method: "POST",
        url: inhalteQuelleAendernUrl(UNBEKANNT),
        payload: { operationId: randomUUID(), baseRevision: 1 },
    },
};

/** Was die Rolle darf; alles andere aus `WEGE` muss 403 antworten. Das Hochladen prüft erst der Inhalt, es steht im eigenen Fall. */
const TAFEL: Record<string, readonly (keyof typeof WEGE)[]> = {
    odologe: ["wegfindungLesen", "wegfindungSetzen"],
    topograph: ["hoehenmodell"],
    kartograph: [
        "kartenserien",
        "uebernahme",
        "kartenvorschlaege",
        "karte",
        "hochladen",
        "rechtePruefen",
        "rechteSetzen",
    ],
    kurator: ["reisebild", "kartenvorschlaege", "karte", "hochladen", "rechtePruefen", "rechteSetzen"],
    social_media_manager: ["social", "hochladen"],
    diplomat: ["mails"],
    derograph: [],
    politologe: [],
    ortskundiger: [],
    meteorologe: ["wetterPreset", "wettermodell"],
    linguist: ["sprache", "spracheSperren"],
};

describeWithCluster(
    "Durchsetzung der Sonderrollen (Wegwerf-Cluster mit den Rollen des VPS)",
    { timeout: 180_000 },
    () => {
        let cluster: VpsCluster;
        let database: Database;
        let fixture: ReturnType<typeof authFixture>;
        let app: FastifyInstance;
        /** Eine Person, die die Zuteilung einträgt; die Tafel prüft nur die Wirkung, die Vergabe `admin-sonderrollen.test.ts`. */
        let von: string;

        const rufe = (weg: Weg, cookie: string) =>
            app.inject({
                method: weg.method,
                url: weg.url,
                headers: { origin: TEST_ORIGIN, cookie },
                ...(weg.payload === undefined ? {} : { payload: { ...weg.payload } }),
            });

        async function testerMit(sonderrolle: string | null): Promise<{ id: string; cookie: string }> {
            const person = await fixture.person("tester");
            if (sonderrolle !== null) {
                await database`
                INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, region_public_id, granted_by, reason)
                VALUES (${person.id}, 'test', ${sonderrolle}, ${sonderrolle === "ortskundiger" ? randomUUID() : null}::uuid, ${von}, 'Probe')
            `;
            }
            const { cookie } = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { id: person.id, cookie };
        }

        beforeAll(async () => {
            cluster = await startVpsCluster(
                ENV,
                [
                    "auth-grants.psql",
                    "community-grants.psql",
                    "kanal-grants.psql",
                    "map-grants.psql",
                    "media-grants.psql",
                    "news-grants.psql",
                    "system-grants.psql",
                    "hoehenmodell-grants.psql",
                ].map((datei) => fileURLToPath(new URL(`../src/db/${datei}`, import.meta.url))),
                { mapDomains: true },
            );
            database = cluster.admin;
            fixture = authFixture(database);
            von = (await fixture.person("operator")).id;
            app = buildApp({
                config: {
                    port: 0,
                    host: "127.0.0.1",
                    releaseId: "test",
                    databaseUrl: undefined,
                    tileRoot: undefined,
                    auth: TEST_AUTH,
                    // Sonst endet jeder Schreibweg der Karte schon am Schalter, bevor die Route das Fachrecht prüft.
                    mapEditing: "testwelt",
                },
                database: cluster.app,
                logStream: { write: () => undefined },
            });
            await app.ready();
        }, 180_000);

        afterEach(async () => {
            await database`DELETE FROM avesmaps_auth.sonderrolle_zuteilung`;
        });

        afterAll(async () => {
            await app?.close();
            await cluster?.stop();
        }, 60_000);

        it("🔴 ohne Sonderrolle kommt ein Tester an keinen dieser Wege", async () => {
            const { cookie } = await testerMit(null);
            for (const weg of Object.values(WEGE)) {
                expect((await rufe(weg, cookie)).statusCode, weg.name).toBe(403);
            }
        });

        for (const [rolle, darf] of Object.entries(TAFEL)) {
            it(`🔴 ${rolle}: genau die eigenen Wege`, async () => {
                const { cookie } = await testerMit(rolle);
                for (const [schluessel, weg] of Object.entries(WEGE)) {
                    const antwort = await rufe(weg, cookie);
                    if (darf.includes(schluessel))
                        expect(antwort.statusCode, `${weg.name}: ${antwort.body}`).not.toBe(403);
                    else expect(antwort.statusCode, weg.name).toBe(403);
                }
            });
        }

        it("🔴 E17a: ein normaler Editor ändert und sperrt keine Sprache, ein Admin schon", async () => {
            for (const [rolle, abgewiesen] of [
                ["editor", true],
                ["admin", false],
            ] as const) {
                const person = await fixture.person(rolle);
                const { cookie } = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 });
                for (const weg of [WEGE["sprache"]!, WEGE["spracheSperren"]!]) {
                    const status = (await rufe(weg, cookie)).statusCode;
                    if (abgewiesen) expect(status, `${rolle}: ${weg.name}`).toBe(403);
                    else expect(status, `${rolle}: ${weg.name}`).not.toBe(403);
                }
            }
        });

        describe("Kartenrechte (Paket 3)", () => {
            const operation = { operationId: randomUUID() };
            // „Durch“ heißt: Weder das Recht noch der Inhalt hat abgewiesen; ein 400 zählte sonst als Erfolg, und die Prüfung im Handler liefe nie.
            const durch = (status: number): void => expect([400, 401, 403]).not.toContain(status);
            const karte = (name: string, method: "POST", url: string, payload: object): Weg => ({
                name,
                method,
                url,
                payload: { ...operation, ...payload },
            });
            const patch = async (url: string, cookie: string, payload: object) =>
                app.inject({
                    method: "PATCH",
                    url,
                    headers: { origin: TEST_ORIGIN, cookie },
                    payload: { operationId: randomUUID(), baseRevision: 1, ...payload },
                });
            const GEBIET = editorTerritoryUrl(UNBEKANNT);
            const FLAECHE = editorLandscapeUrl(UNBEKANNT);
            const gebietAnlegen = karte("Neues Gebiet", "POST", EDITOR_TERRITORIES_URL, {
                color: "#112233",
                ring: [
                    [0, 0],
                    [10, 0],
                    [10, 10],
                    [0, 0],
                ],
            });
            const obergebiet = karte("Unter neues Obergebiet", "POST", EDITOR_TERRITORY_OBERGEBIET_URL, {});
            const zoom = karte("Zoombänder", "POST", EDITOR_TERRITORY_DISPLAY_URL, {
                territories: [{ id: UNBEKANNT, baseRevision: 1, zoom: { minZoom: 1, maxZoom: 3 } }],
            });
            const farbe = karte("Farbe", "POST", EDITOR_TERRITORY_DISPLAY_URL, {
                territories: [{ id: UNBEKANNT, baseRevision: 1, color: "#112233" }],
            });
            const punkt = (subtype: string) => karte(subtype, "POST", EDITOR_PEAKS_URL, { position: [1, 1], subtype });
            // Keine Art im Bestand: Die Mehrfachauswahl eines unbekannten Punkts zählt wie eine Landmarke.
            const sammelPunkte = karte("Landmarken in der Auswahl", "POST", editorLandscapesBatchUrl, {
                ids: [],
                peaks: [UNBEKANNT],
                changes: { hidden: true },
            });

            it("🔴 Politologe: Gebiete samt Form, keine Flächen", async () => {
                const { cookie } = await testerMit("politologe");
                durch((await patch(GEBIET, cookie, { changes: { name: "Probe" } })).statusCode);
                durch((await patch(GEBIET, cookie, { changes: { parent: "" } })).statusCode);
                // Der Ring liegt außerhalb der Karte: Die Fachprüfung im Schreibweg weist ihn nach der Rechteprüfung ab.
                expect((await rufe(gebietAnlegen, cookie)).statusCode).not.toBe(403);
                durch((await rufe(zoom, cookie)).statusCode);
                expect((await patch(FLAECHE, cookie, { changes: { name: "Probe" } })).statusCode).toBe(403);
                expect((await rufe(punkt("hoehle"), cookie)).statusCode).toBe(403);
            });

            it("🔴 Derograph: Flächen und Landmarken, kein Gebirge und keine Gebiete", async () => {
                const { cookie } = await testerMit("derograph");
                durch((await patch(FLAECHE, cookie, { changes: { name: "Probe" } })).statusCode);
                durch((await rufe(punkt("hoehle"), cookie)).statusCode);
                expect((await rufe(punkt("berggipfel"), cookie)).statusCode).toBe(403);
                expect((await rufe(punkt("vulkan"), cookie)).statusCode).toBe(403);
                expect((await patch(FLAECHE, cookie, { changes: { type: "gebirge" } })).statusCode).toBe(403);
                expect((await patch(GEBIET, cookie, { changes: { name: "Probe" } })).statusCode).toBe(403);
                expect((await rufe(obergebiet, cookie)).statusCode).toBe(403);
            });

            it("🔴 Topograph: dazu Gipfel und Gebirge", async () => {
                const { cookie } = await testerMit("topograph");
                durch((await rufe(punkt("berggipfel"), cookie)).statusCode);
                durch((await patch(FLAECHE, cookie, { changes: { type: "gebirge" } })).statusCode);
                expect((await patch(GEBIET, cookie, { changes: { name: "Probe" } })).statusCode).toBe(403);
            });

            it("🔴 Paket 6, ein Editor ohne Sonderrolle: Eigenschaften und Landmarken ja, Form, Hierarchie, Zoombänder und Gebirge nein", async () => {
                const editor = await fixture.person("editor");
                const { cookie } = await fixture.session(editor.id);
                durch((await patch(GEBIET, cookie, { changes: { name: "Probe" } })).statusCode);
                durch((await patch(FLAECHE, cookie, { changes: { name: "Probe" } })).statusCode);
                durch((await rufe(farbe, cookie)).statusCode);
                durch((await rufe(punkt("hoehle"), cookie)).statusCode);
                durch((await rufe(sammelPunkte, cookie)).statusCode);

                expect((await rufe(gebietAnlegen, cookie)).statusCode).toBe(403);
                expect((await patch(GEBIET, cookie, { changes: { parent: "" } })).statusCode).toBe(403);
                expect((await rufe(obergebiet, cookie)).statusCode).toBe(403);
                expect((await rufe(zoom, cookie)).statusCode).toBe(403);
                expect((await patch(FLAECHE, cookie, { changes: { type: "gebirge" } })).statusCode).toBe(403);
                expect((await rufe(punkt("berggipfel"), cookie)).statusCode).toBe(403);
                expect((await rufe(punkt("vulkan"), cookie)).statusCode).toBe(403);
            });

            // Betreiber 2026-11-04: „wichtig ist: betreiber dürfen alles“. Admins behalten nach E2 alles aus der Vorlage.
            for (const rolle of ["admin", "operator"] as const) {
                it(`🔴 Paket 6, ${rolle} ohne Sonderrolle: Form, Hierarchie, Zoombänder und Gebirge gehen weiter`, async () => {
                    const person = await fixture.person(rolle);
                    const { cookie } = await fixture.session(person.id);
                    expect((await rufe(gebietAnlegen, cookie)).statusCode).not.toBe(403);
                    durch((await patch(GEBIET, cookie, { changes: { parent: "" } })).statusCode);
                    durch((await rufe(zoom, cookie)).statusCode);
                    durch((await patch(FLAECHE, cookie, { changes: { type: "gebirge" } })).statusCode);
                    durch((await rufe(punkt("berggipfel"), cookie)).statusCode);
                    durch((await rufe(punkt("vulkan"), cookie)).statusCode);
                });
            }

            it("🔴 ein Reviewer ohne Sonderrolle schreibt weiter nichts an der Karte", async () => {
                const reviewer = await fixture.person("reviewer");
                const { cookie } = await fixture.session(reviewer.id);
                expect((await patch(GEBIET, cookie, { changes: { name: "Probe" } })).statusCode).toBe(403);
                expect((await rufe(punkt("hoehle"), cookie)).statusCode).toBe(403);
            });
        });

        it("🔴 Hochladen: Die Fachrechte gelten nur für ihre Rolle", async () => {
            const hochladen = (cookie: string, role: string) =>
                app.inject({
                    method: "POST",
                    url: MEDIA_UPLOAD_URL,
                    headers: { origin: TEST_ORIGIN, cookie },
                    payload: {
                        operationId: randomUUID(),
                        file: { name: "probe.png", dataBase64: "AAAA" },
                        form: {
                            title: "Probe",
                            role,
                            creationMethod: "unknown",
                            rights: { basis: "own_work", creator: "Probe" },
                        },
                    },
                });
            const social = await testerMit("social_media_manager");
            const karte = await testerMit("kartograph");
            expect((await hochladen(social.cookie, "social_post")).statusCode).not.toBe(403);
            expect((await hochladen(social.cookie, "header")).statusCode).toBe(403);
            // Betreiber 2026-11-06 (WI-0282): Der Kartograph lädt hoch und gibt frei wie ein Editor.
            expect((await hochladen(karte.cookie, "map_full")).statusCode).not.toBe(403);
            expect((await hochladen(karte.cookie, "header")).statusCode).not.toBe(403);
        });

        it("🔴 Diplomat: Anfragen ja, die Liste der Meldungen und die Liste der Redaktion nein, die der Mails ja", async () => {
            const { id, cookie } = await testerMit("diplomat");
            const personen = (url: string) => rufe({ name: url, method: "GET", url }, cookie);
            expect((await personen(`${COMMUNITY_URL}/personen`)).statusCode).toBe(403);
            const mails = await personen(`${COMMUNITY_URL}/personen?mails=true`);
            expect(mails.statusCode, mails.body).toBe(200);
            expect(mails.json<{ id: string }[]>().map((zeile) => zeile.id)).toContain(id);
            const korb = await personen(`${COMMUNITY_URL}/vorgaenge?segment=papierkorb&art=anfrage`);
            expect(korb.statusCode, korb.body).toBe(200);
            expect((await personen(`${COMMUNITY_URL}/vorgaenge?segment=papierkorb&art=meldung`)).statusCode).toBe(403);
        });

        it("🔴 trash_mail gilt nur für Anfragen: auch ein Reviewer mit Diplomat-Rolle legt keine Meldung in den Papierkorb", async () => {
            const reviewer = await fixture.person("reviewer");
            await database`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
            VALUES (${reviewer.id}, 'test', 'diplomat', ${von}, 'Probe')
        `;
            const { cookie } = await fixture.session(reviewer.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            const vorgang = async (art: string): Promise<string> => {
                const [zeile] = await database<{ id: string }[]>`
                INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, operation_id)
                VALUES (${art}, 'sonstiges', 'website', gen_random_uuid())
                RETURNING id::text
            `;
                return `COM-${zeile!.id.padStart(6, "0")}`;
            };
            const korb = (nummer: string, schritt: string) =>
                rufe(
                    {
                        name: schritt,
                        method: "POST",
                        url: `${COMMUNITY_URL}/vorgaenge/${nummer}/${schritt}`,
                        payload: { operationId: randomUUID(), baseRevision: 1 },
                    },
                    cookie,
                );
            const meldung = await vorgang("meldung");
            expect((await korb(meldung, "papierkorb")).statusCode).toBe(403);
            expect((await korb(meldung, "wiederherstellen")).statusCode).toBe(403);
            const anfrage = await vorgang("anfrage");
            const weg = await korb(anfrage, "papierkorb");
            expect(weg.statusCode, weg.body).not.toBe(403);
            // Personenbezug löschen bleibt bei der Moderation.
            const personenbezug = await korb(anfrage, "personenbezug-loeschen");
            expect(personenbezug.statusCode).toBe(403);
        });

        it("🔴 Glocke und „Zuständig“ rechnen nach dem Recht: Sonderrollen zählen, ohne Leserecht nur die Rollen", async () => {
            const diplomat = await testerMit("diplomat");
            const kurator = await testerMit("kurator");
            const betreiber = await fixture.person("operator");
            const mails = await bearbeitende(cluster.app, "test", "read_mailbox");
            expect(mails).toEqual(expect.arrayContaining([diplomat.id, betreiber.id]));
            expect(mails).not.toContain(kurator.id);
            expect(await bearbeitende(cluster.app, "test", "moderate_photobox")).toContain(kurator.id);
            expect(await bearbeitende(cluster.app, "test", "moderate_submissions")).not.toContain(kurator.id);

            const rolle = cluster.roles.app;
            const funktion = "avesmaps_community.community_bearbeitende(text, text[], text[])";
            await database.unsafe(`REVOKE SELECT ON avesmaps_auth.sonderrolle_zuteilung FROM ${rolle}`);
            await database.unsafe(`REVOKE EXECUTE ON FUNCTION ${funktion} FROM ${rolle}`);
            try {
                const ohne = await bearbeitende(cluster.app, "test", "read_mailbox");
                expect(ohne).toContain(betreiber.id);
                expect(ohne).not.toContain(diplomat.id);
            } finally {
                await database.unsafe(`GRANT SELECT ON avesmaps_auth.sonderrolle_zuteilung TO ${rolle}`);
                await database.unsafe(`GRANT EXECUTE ON FUNCTION ${funktion} TO ${rolle}`);
            }
        });

        describe("Bezeichnung und Sichtbarkeit (Paket 5)", () => {
            const lies = async <T>(url: string, cookie: string): Promise<T> => {
                const antwort = await app.inject({ method: "GET", url, headers: { cookie } });
                expect(antwort.statusCode, antwort.body).toBe(200);
                return antwort.json<T>();
            };
            const waehle = (cookie: string, bezeichnung: string) =>
                app.inject({
                    method: "POST",
                    url: "/api/account/bezeichnung",
                    headers: { origin: TEST_ORIGIN, cookie },
                    payload: { operationId: randomUUID(), bezeichnung },
                });
            async function region(name: string): Promise<string> {
                const [zeile] = await database<{ id: number; public_id: string }[]>`
                    INSERT INTO region (public_id, map_domain_id, name, region_layer, source_system)
                    VALUES (gen_random_uuid(), 'aventuria', ${name}, 'derographisch', 'avesmaps3d')
                    RETURNING id::int, public_id::text
                `;
                await database`
                    INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                    VALUES (gen_random_uuid(), 'aventuria', ${zeile!.id},
                            ST_GeomFromText('POLYGON((10 10, 20 10, 20 20, 10 20, 10 10))'), true)
                `;
                return zeile!.public_id;
            }
            const zuteilen = (person: string, sonderrolle: string, regionId: string | null) => database`
                INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, region_public_id, granted_by, reason)
                VALUES (${person}, 'test', ${sonderrolle}, ${regionId}::uuid, ${von}, 'Probe')
            `;
            async function vorgangMitBezug(bezug: {
                art: "stelle" | "objekt";
                x?: number;
                y?: number;
                objektArt?: string;
                objektId?: string;
            }): Promise<string> {
                const [zeile] = await database<{ id: string }[]>`
                    INSERT INTO avesmaps_community.vorgang (art, kategorie, eingang, operation_id)
                    VALUES ('meldung', 'sonstiges', 'website', gen_random_uuid())
                    RETURNING id::text
                `;
                await database`
                    INSERT INTO avesmaps_community.bezug (vorgang_id, art, objekt_art, objekt_id, name, lage_x, lage_y)
                    VALUES (${zeile!.id}::bigint, ${bezug.art}, ${bezug.objektArt ?? null}, ${bezug.objektId ?? null}::uuid,
                            ${bezug.art === "objekt" ? "Probe" : null}, ${bezug.x ?? null}, ${bezug.y ?? null})
                `;
                return `COM-${zeile!.id.padStart(6, "0")}`;
            }

            it("🔴 die Person wählt ihre Bezeichnung selbst; das Protokoll nennt die Form nicht", async () => {
                const tester = await fixture.person("tester");
                const { cookie } = await fixture.session(tester.id);
                const ohne = await lies<AuthSessionResponse>("/api/auth/session", cookie);
                expect(ohne.person?.bezeichnung).toBeNull();
                expect(ohne.person?.sonderrollen).toEqual([]);

                expect((await waehle(cookie, "feminin")).statusCode).toBe(200);
                const mit = await lies<AuthSessionResponse>("/api/auth/session", cookie);
                expect(mit.person?.bezeichnung).toBe("feminin");

                const doppelt = await waehle(cookie, "feminin");
                expect(doppelt.statusCode).toBe(409);
                expect(doppelt.json<{ error: { code: string } }>().error.code).toBe("no_change");
                expect((await waehle(cookie, "herr")).statusCode).toBe(400);

                const eintraege = await database<{ details: object }[]>`
                    SELECT details FROM avesmaps_auth.security_event
                     WHERE action = 'person.bezeichnung_geaendert' AND target_person_id = ${tester.id}
                `;
                expect(eintraege.map((zeile) => zeile.details)).toEqual([{}]);
            });

            it("🔴 ohne Anmeldung gibt es keine Bezeichnung zu wählen", async () => {
                const antwort = await app.inject({
                    method: "POST",
                    url: "/api/account/bezeichnung",
                    headers: { origin: TEST_ORIGIN },
                    payload: { operationId: randomUUID(), bezeichnung: "feminin" },
                });
                expect(antwort.statusCode).toBe(401);
            });

            it("🔴 eine neue Bezeichnung meldet niemandem einen Konflikt am Namen", async () => {
                const tester = await fixture.person("tester");
                const { cookie } = await fixture.session(tester.id);
                const vorher = await lies<{ person: { revision: number } }>("/api/account", cookie);
                expect((await waehle(cookie, "maskulin")).statusCode).toBe(200);
                const nachher = await lies<{ person: { revision: number; bezeichnung: string } }>(
                    "/api/account",
                    cookie,
                );
                expect(nachher.person.revision).toBe(vorher.person.revision);
                expect(nachher.person.bezeichnung).toBe("maskulin");
            });

            it("🔴 Konto, Sitzung und Status › Editoren nennen die Sonderrollen samt Region", async () => {
                const weiden = await region("Weiden Anzeige");
                const greifenfurt = await region("Greifenfurt Anzeige");
                const person = await fixture.person("reviewer");
                await database`UPDATE avesmaps_auth.person SET bezeichnung = 'feminin' WHERE id = ${person.id}`;
                await zuteilen(person.id, "ortskundiger", weiden);
                await zuteilen(person.id, "ortskundiger", greifenfurt);
                await zuteilen(person.id, "kurator", null);
                const { cookie } = await fixture.session(person.id);
                const erwartet = [
                    { sonderrolle: "kurator", region: null },
                    { sonderrolle: "ortskundiger", region: "Greifenfurt Anzeige" },
                    { sonderrolle: "ortskundiger", region: "Weiden Anzeige" },
                ];

                const sitzung = await lies<AuthSessionResponse>("/api/auth/session", cookie);
                expect(sitzung.person?.sonderrollen).toEqual(erwartet);
                const konto = await lies<{ person: { sonderrollen: unknown } }>("/api/account", cookie);
                expect(konto.person.sonderrollen).toEqual(erwartet);
                const liste = await lies<BesuchEditoren>(BESUCH_EDITOREN_URL, cookie);
                const zeile = liste.editoren.find((editor) => editor.id === person.id);
                expect(zeile?.sonderrollen).toEqual(erwartet);
                expect(zeile?.bezeichnung).toBe("feminin");
            });

            it("🔴 eine entzogene Sonderrolle und eine fremde Umgebung zeigen sich nicht", async () => {
                const person = await fixture.person("reviewer");
                await zuteilen(person.id, "kurator", null);
                await database`
                    UPDATE avesmaps_auth.sonderrolle_zuteilung SET revoked_at = now(), revoke_reason = 'Probe' WHERE person_id = ${person.id}
                `;
                await database`
                    INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
                    VALUES (${person.id}, 'staging', 'diplomat', ${von}, 'Probe')
                `;
                const { cookie } = await fixture.session(person.id);
                const sitzung = await lies<AuthSessionResponse>("/api/auth/session", cookie);
                expect(sitzung.person?.sonderrollen).toEqual([]);
                const liste = await lies<BesuchEditoren>(BESUCH_EDITOREN_URL, cookie);
                expect(liste.editoren.find((editor) => editor.id === person.id)?.sonderrollen).toEqual([]);
            });

            it("🔴 die Meldung nennt die Personen ihrer Region, der Regionalkanzler zuerst", async () => {
                const regionId = await region("Weiden Meldung");
                const kanzler = await fixture.person("tester", { name: "Zora Kanzlerin" });
                const kundig = await fixture.person("editor", { name: "Alrik Kundig" });
                await database`UPDATE avesmaps_auth.person SET bezeichnung = 'feminin' WHERE id = ${kanzler.id}`;
                await zuteilen(kanzler.id, "regionalkanzler", regionId);
                await zuteilen(kundig.id, "ortskundiger", regionId);
                const reviewer = await fixture.person("reviewer");
                const { cookie } = await fixture.session(reviewer.id);

                const drinnen = await vorgangMitBezug({ art: "stelle", x: 15, y: 15 });
                const detail = await lies<VorgangDetail>(`${COMMUNITY_URL}/vorgaenge/${drinnen}`, cookie);
                // Die anderen Fälle legen Regionen an derselben Stelle an; die stehen ohne Personen mit in der Antwort.
                const inWeiden = (antwort: VorgangDetail) =>
                    antwort.regionen?.find((zeile) => zeile.name === "Weiden Meldung");
                expect(inWeiden(detail)).toEqual({
                    name: "Weiden Meldung",
                    personen: [
                        {
                            person: { id: kanzler.id, name: "Zora Kanzlerin" },
                            sonderrolle: "regionalkanzler",
                            bezeichnung: "feminin",
                        },
                        {
                            person: { id: kundig.id, name: "Alrik Kundig" },
                            sonderrolle: "ortskundiger",
                            bezeichnung: null,
                        },
                    ],
                });

                // Ohne eigene Lage zählt das Objekt: Hier die Fläche selbst.
                const objekt = await vorgangMitBezug({ art: "objekt", objektArt: "area", objektId: regionId });
                const amObjekt = await lies<VorgangDetail>(`${COMMUNITY_URL}/vorgaenge/${objekt}`, cookie);
                expect(inWeiden(amObjekt)?.personen).toHaveLength(2);

                // Außerhalb jeder Region: kein Eintrag, aber bekannt.
                const draussen = await vorgangMitBezug({ art: "stelle", x: 900, y: 900 });
                const fern = await lies<VorgangDetail>(`${COMMUNITY_URL}/vorgaenge/${draussen}`, cookie);
                expect(fern.regionen).toEqual([]);
            });

            it("🔴 ohne Leserecht an der Tafel fehlt der Hinweis, statt „niemand zugeteilt“ zu behaupten", async () => {
                const reviewer = await fixture.person("reviewer");
                const { cookie } = await fixture.session(reviewer.id);
                const nummer = await vorgangMitBezug({ art: "stelle", x: 15, y: 15 });
                const rolle = cluster.roles.app;
                await database.unsafe(`REVOKE SELECT ON avesmaps_auth.invitation_sonderrolle FROM ${rolle}`);
                try {
                    const detail = await lies<VorgangDetail>(`${COMMUNITY_URL}/vorgaenge/${nummer}`, cookie);
                    expect(detail.regionen).toBeUndefined();
                } finally {
                    await database.unsafe(`GRANT SELECT ON avesmaps_auth.invitation_sonderrolle TO ${rolle}`);
                }
            });
        });
    },
);
