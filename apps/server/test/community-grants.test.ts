import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import {
    communityAufbewahrung,
    communityBeitragAufbewahrung,
    communityFristen,
    communitySocialFreigabe,
} from "../src/community/aufbewahrung.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { runSocialPruefen } from "../src/community/social/pruefen.ts";
import { runCommunityLegacy } from "../src/migration/community-legacy-lauf.ts";
import { stelleInstanz } from "./support/mastodon-instanz.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte am Community-Modul aus Migration 0265 (WI-0268), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen des VPS,
 * `grants_sql_tmpl`, dann `apps/server/src/db/community-grants.psql`.
 *
 * - 🔴 Die App liest die Tafeln und schreibt nur über die Funktionen; die Aufbewahrung darf sie nicht ausführen.
 * - 🔴 Die Jobs-Rolle führt die Aufbewahrung aus und hat an keiner Tafel ein Tafelrecht; die Fristen der Rückfragen (C5) liest sie über genau fünf
 *   Spalten von `vorgang` (nie Quelle, Kategorie, Melder oder Text) und meldet über `benachrichtige()`. Die Kachelrolle nichts.
 */

const ENV = "communitytest";
const TAFELN = [
    "vorgang",
    "melder",
    "bezug",
    "nachricht",
    "notiz",
    "verknuepfung",
    "ereignis",
    "bewertung_ereignis",
    "beitrag",
    "beitrag_ziel",
    "beitrag_ereignis",
    "legacy_meldung",
    "mail_ausgang",
    "mail_eingang",
    "mail_anhang",
    "kanal_stand",
    "sendung",
    "vorgang_rolle",
    "vorgang_region",
] as const;
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
const grants = fileURLToPath(new URL("../src/db/community-grants.psql", import.meta.url));
const systemGrants = fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url));
const newsGrants = fileURLToPath(new URL("../src/db/news-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Community: Rechte wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let person: string;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [grants, systemGrants, newsGrants]);
        const [row] = await cluster.admin<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, status, created_via) VALUES ('Lena', 'active', 'system') RETURNING id
        `;
        person = row!.id;
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    async function rechte(rolle: string, tafel: string): Promise<string[]> {
        const rows = await cluster!.admin.unsafe<{ privilege: string; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
            [rolle, `avesmaps_community.${tafel}`, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    const melden = () => cluster!.app<{ id: string }[]>`
        SELECT avesmaps_community.community_melden(
            ${randomUUID()}::uuid, 'lage', 'Wehrheim liegt zu weit im Westen.', NULL, NULL, NULL, ${randomBytes(32)},
            '{"art": "stelle", "lage": {"x": 10, "y": 20}}'::jsonb
        )::text AS id
    `;

    it("🔴 an den Tafeln: die App liest nur; Jobs und Kacheln nichts", async () => {
        for (const tafel of TAFELN) {
            expect(await rechte(cluster!.roles.app, tafel), tafel).toEqual(["SELECT"]);
            for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles])
                expect(await rechte(rolle, tafel), `${rolle} ${tafel}`).toEqual([]);
        }
    });

    it("🔴 die App meldet und bearbeitet über die Funktionen, schreibt nie direkt und räumt nicht auf", async () => {
        const [row] = await melden();
        const id = Number(row!.id);
        expect(id).toBeGreaterThan(0);
        const [v] = await cluster!.app<
            { revision: number }[]
        >`SELECT revision FROM avesmaps_community.vorgang WHERE id = ${id}`;
        const [r] = await cluster!.app<{ revision: number }[]>`
            SELECT avesmaps_community.community_sichten(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${v!.revision}::int) AS revision
        `;
        expect(r!.revision).toBe(v!.revision + 1);
        await expect(
            cluster!
                .app`INSERT INTO avesmaps_community.notiz (vorgang_id, text, operation_id) VALUES (${id}, 'direkt', ${randomUUID()}::uuid)`,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
            cluster!.app`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen'`,
        ).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.app`SELECT avesmaps_community.community_purge_expired()`).rejects.toMatchObject({
            code: "42501",
        });
        // Die internen Hilfen ruft niemand.
        await expect(cluster!.app`SELECT avesmaps_community._sperre(${id}::bigint)`).rejects.toMatchObject({
            code: "42501",
        });
    });

    it("🔴 Mails (Migration 0271): die App ruft das Kontaktformular und die Handgriffe der Anfragen über die Funktionen, die Hilfen darunter ruft niemand", async () => {
        const [row] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_anfragen(
                ${randomUUID()}::uuid, 'frage', 'Eine Frage zur Karte, bitte um Antwort.', 'Alrike', 'alrike@example.org', ${randomBytes(32)}
            )::text AS id
        `;
        const id = Number(row!.id);
        expect(id).toBeGreaterThan(0);
        const revision = async (): Promise<number> =>
            (
                await cluster!.app<
                    { revision: number }[]
                >`SELECT revision FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`
            )[0]!.revision;
        const [antwort] = await cluster!.app<{ revision: number }[]>`
            SELECT avesmaps_community.community_anfrage_antworten(
                ${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::int, 'Antwort.', false
            ) AS revision
        `;
        expect(antwort!.revision).toBeGreaterThan(1);
        await cluster!
            .app`SELECT avesmaps_community.community_anfrage_archivieren(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::int)`;
        await cluster!
            .app`SELECT avesmaps_community.community_anfrage_zurueckholen(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::int)`;
        const [meldung] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_als_meldung(
                ${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::int, 'sonstiges', 'Aus der Anfrage entstanden, bitte prüfen.',
                NULL, NULL, '{"art": "stelle", "lage": {"x": 10, "y": 20}}'::jsonb, NULL
            )::text AS id
        `;
        expect(Number(meldung!.id)).toBeGreaterThan(id);
        // Die Hilfen darunter ruft niemand; direkt schreiben kann die App nicht.
        await expect(
            cluster!.app`SELECT avesmaps_community._anfrage_beenden(${id}::bigint, ${person}::uuid, NULL, NULL, NULL)`,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(cluster!.app`SELECT avesmaps_community._nur_anfrage('anfrage')`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(
            cluster!.app`UPDATE avesmaps_community.melder SET mail = 'x@example.org' WHERE vorgang_id = ${id}::bigint`,
        ).rejects.toMatchObject({ code: "42501" });
        // Die Jobs-Rolle und die Kachelrolle rufen nichts davon.
        for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_anfragen(uuid,text,text,text,text,bytea)', 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, rolle).toBe(false);
        }
    });

    it("🔴 Mailweg (Migration 0279): die App ruft Antwort per Mail, neue Mail und Erneut senden und reiht den Versand ein; den Versandjob bedient die Jobs-Rolle NUR über `holen` und `zustellung`, an der Tafel hat sie nichts", async () => {
        const mailAn = "alrike@example.org";
        const [row] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_anfragen(
                ${randomUUID()}::uuid, 'frage', 'Eine Frage zur Karte, bitte um Antwort.', 'Alrike', ${mailAn}, ${randomBytes(32)}
            )::text AS id
        `;
        const id = Number(row!.id);
        const [v] = await cluster!.app<
            { revision: number }[]
        >`SELECT revision FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`;
        const [antwort] = await cluster!.app<{ ergebnis: { revision: number; ausgang: number; neu: boolean } }[]>`
            SELECT avesmaps_community.community_anfrage_antworten_mail(
                ${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${v!.revision}::int, 'Antwort per Mail.', false, 'avesmaps.de'
            ) AS ergebnis
        `;
        expect(antwort!.ergebnis).toMatchObject({ neu: true, ausgang: expect.any(Number) });
        const ausgang = Number(antwort!.ergebnis.ausgang);
        const [neu] = await cluster!.app<{ ergebnis: { id: number; ausgang: number; neu: boolean } }[]>`
            SELECT avesmaps_community.community_mail_neu(
                ${randomUUID()}::uuid, ${person}::uuid, 'fremd@example.net', 'Zusammenarbeit', 'Guten Tag.', 'avesmaps.de', 20
            ) AS ergebnis
        `;
        expect(neu!.ergebnis.neu).toBe(true);
        // Die App reiht den Versand ein (SECURITY DEFINER: kein Schreibrecht an `job`).
        await seedMapDomains(cluster!.admin);
        const [auftrag] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text FROM job_enqueue('community_mail_versand', 1::smallint, ${AVENTURIA.mapDomain}, 'community', ${cluster!.app.json({ ausgang })}::jsonb,
                                                    50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        expect(auftrag!.public_id).toMatch(/^[0-9a-f-]{36}$/u);
        // Gelesen wird die Tafel, geschrieben nie; die Hilfen darunter ruft niemand.
        const [gelesen] = await cluster!.app<
            { an: string; zustand: string }[]
        >`SELECT an, zustand FROM avesmaps_community.mail_ausgang WHERE id = ${ausgang}::bigint`;
        expect(gelesen).toEqual({ an: mailAn, zustand: "wartet" });
        for (const lauf of [
            () =>
                cluster!
                    .app`UPDATE avesmaps_community.mail_ausgang SET an = 'x@example.org' WHERE id = ${ausgang}::bigint`,
            () =>
                cluster!
                    .app`UPDATE avesmaps_community.mail_ausgang SET zustand = 'gesendet' WHERE id = ${ausgang}::bigint`,
            () => cluster!.app`DELETE FROM avesmaps_community.mail_ausgang WHERE id = ${ausgang}::bigint`,
            () => cluster!.app`SELECT avesmaps_community._mail_adresse('a@b.de')`,
            () => cluster!.app`SELECT avesmaps_community._mail_message_id(${id}::bigint, 'avesmaps.de')`,
            // Den Versandjob bedient die App nicht.
            () => cluster!.app`SELECT avesmaps_community.community_mail_holen(${ausgang}::bigint)`,
            () =>
                cluster!.app`SELECT avesmaps_community.community_mail_zustellung(${ausgang}::bigint, 'gesendet', NULL)`,
        ])
            await expect(lauf()).rejects.toMatchObject({ code: "42501" });
        // Die Jobs-Rolle: genau die zwei Funktionen des Versandjobs, an der Tafel nichts; die Handgriffe der Redaktion ruft sie nicht.
        expect(await rechte(cluster!.roles.jobs, "mail_ausgang")).toEqual([]);
        expect(await rechte(cluster!.roles.tiles, "mail_ausgang")).toEqual([]);
        await expect(cluster!.jobs`SELECT an FROM avesmaps_community.mail_ausgang`).rejects.toMatchObject({
            code: "42501",
        });
        for (const aufruf of [
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.community_mail_neu(${randomUUID()}::uuid, ${person}::uuid, 'x@example.org', 'A', 'B', 'avesmaps.de', 20)`,
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.community_anfrage_antworten_mail(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, 1, 'x', false, 'avesmaps.de')`,
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.community_mail_erneut(${randomUUID()}::uuid, ${id}::bigint, 1, ${person}::uuid)`,
        ])
            await expect(aufruf()).rejects.toMatchObject({ code: "42501" });
        const [geholt] = await cluster!.jobs<{ mail: { an: string; text: string; messageId: string } | null }[]>`
            SELECT avesmaps_community.community_mail_holen(${ausgang}::bigint) AS mail
        `;
        expect(geholt!.mail).toMatchObject({ an: mailAn, text: "Antwort per Mail." });
        const [zugestellt] = await cluster!.jobs<{ stand: { zustand: string } | null }[]>`
            SELECT avesmaps_community.community_mail_zustellung(${ausgang}::bigint, 'gesendet', NULL) AS stand
        `;
        expect(zugestellt!.stand?.zustand).toBe("gesendet");
        // Kacheln rufen nichts davon.
        for (const funktion of [
            "community_mail_holen(bigint)",
            "community_mail_zustellung(bigint,text,text)",
            "community_mail_neu(uuid,uuid,text,text,text,text,integer)",
        ]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${cluster!.roles.tiles}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, funktion).toBe(false);
        }
    });

    it("🔴 Mailabruf (Migration 0281): die App liest Eingänge und Anhänge, schreibt nie und ruft den Abruf nicht; den Abrufjob bedient die Jobs-Rolle NUR über vier Funktionen, an den Tafeln hat sie nichts, die Kachelrolle nichts", async () => {
        const roh = (messageId: string, extra: Record<string, unknown> = {}) => ({
            messageId,
            inReplyTo: null,
            verweise: [],
            vonAdresse: "max@example.org",
            vonName: "Max",
            betreff: "Frage",
            text: "Hallo",
            html: "<p>Hallo</p>",
            externBilder: 0,
            hinweis: null,
            rohDatei: null,
            groesse: 5,
            uid: 1,
            uidvalidity: 1,
            ...extra,
        });
        const datei = "a".repeat(64);
        // Die Jobs-Rolle nimmt eine Mail auf (Vorgang, Nachricht, Eingang, Anhang) und liest den Stand.
        const [aufnahme] = await cluster!.jobs<{ ergebnis: { id: number; nummer: string; ergebnis: string } }[]>`
            SELECT avesmaps_community.community_mail_eingang(
                ${cluster!.jobs.json(roh("<abruf-1@x.example>", { rohDatei: datei }) as never)}::jsonb,
                ${cluster!.jobs.json([{ dateiname: "Beleg.pdf", mime: "application/pdf", groesse: 7, datei, cid: null, grund: null }] as never)}::jsonb
            ) AS ergebnis
        `;
        expect(aufnahme!.ergebnis).toMatchObject({ ergebnis: "neu", nummer: expect.stringMatching(/^COM-[0-9]{6}$/u) });
        const id = Number(aufnahme!.ergebnis.id);
        const [doppelt] = await cluster!.jobs<{ ergebnis: { ergebnis: string } }[]>`
            SELECT avesmaps_community.community_mail_eingang(${cluster!.jobs.json(roh("<abruf-1@x.example>") as never)}::jsonb, '[]'::jsonb) AS ergebnis
        `;
        expect(doppelt!.ergebnis.ergebnis).toBe("doppelt");
        await cluster!.jobs`SELECT avesmaps_community.community_mail_abruf_setzen('INBOX', 1, 5)`;
        const [stand] = await cluster!.jobs<
            { stand: { uidValidity: number; letzteUid: number } | null }[]
        >`SELECT avesmaps_community.community_mail_abruf_stand('INBOX') AS stand`;
        expect(stand!.stand).toEqual({ uidValidity: 1, letzteUid: 5 });
        const [behalten] = await cluster!.jobs<{ namen: string[] }[]>`
            SELECT avesmaps_community.community_mail_dateien_behalten(${[datei, "b".repeat(64)]}::text[]) AS namen
        `;
        expect(behalten!.namen).toEqual([datei]);
        // An den Tafeln hat die Jobs-Rolle nichts, die Kachelrolle nichts; die App liest zwei Tafeln und sieht den Stand nicht.
        for (const tafel of ["mail_eingang", "mail_anhang", "mail_abruf_stand"]) {
            expect(await rechte(cluster!.roles.jobs, tafel), tafel).toEqual([]);
            expect(await rechte(cluster!.roles.tiles, tafel), tafel).toEqual([]);
        }
        expect(await rechte(cluster!.roles.app, "mail_abruf_stand")).toEqual([]);
        await expect(cluster!.jobs`SELECT von_adresse FROM avesmaps_community.mail_eingang`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`SELECT datei FROM avesmaps_community.mail_anhang`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.app`SELECT letzte_uid FROM avesmaps_community.mail_abruf_stand`).rejects.toMatchObject({
            code: "42501",
        });
        const [gelesen] = await cluster!.app<{ von_adresse: string; roh_datei: string | null }[]>`
            SELECT e.von_adresse, e.roh_datei FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id WHERE n.vorgang_id = ${id}::bigint
        `;
        expect(gelesen).toEqual({ von_adresse: "max@example.org", roh_datei: datei });
        const [anhang] = await cluster!.app<{ datei: string }[]>`
            SELECT x.datei FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id WHERE n.vorgang_id = ${id}::bigint
        `;
        expect(anhang!.datei).toBe(datei);
        // Die App schreibt nie direkt und ruft den Abruf nicht.
        for (const lauf of [
            () => cluster!.app`UPDATE avesmaps_community.mail_eingang SET von_adresse = NULL`,
            () => cluster!.app`DELETE FROM avesmaps_community.mail_anhang`,
            () => cluster!.app`INSERT INTO avesmaps_community.mail_abruf_stand (ordner, uidvalidity) VALUES ('X', 1)`,
            () =>
                cluster!
                    .app`SELECT avesmaps_community.community_mail_eingang(${cluster!.app.json(roh("<app@x.example>") as never)}::jsonb, '[]'::jsonb)`,
            () => cluster!.app`SELECT avesmaps_community.community_mail_abruf_setzen('INBOX', 1, 9)`,
            () => cluster!.app`SELECT avesmaps_community.community_mail_abruf_stand('INBOX')`,
            () => cluster!.app`SELECT avesmaps_community.community_mail_dateien_behalten('{}'::text[])`,
        ])
            await expect(lauf()).rejects.toMatchObject({ code: "42501" });
        // Die Kachelrolle ruft nichts davon; die Jobs-Rolle nicht die Handgriffe der Redaktion.
        for (const funktion of [
            "community_mail_eingang(jsonb,jsonb)",
            "community_mail_abruf_stand(text)",
            "community_mail_abruf_setzen(text,bigint,bigint)",
            "community_mail_dateien_behalten(text[])",
        ]) {
            const rows = await cluster!.admin<{ ok: boolean; jobs: boolean; app: boolean }[]>`
                SELECT has_function_privilege(${cluster!.roles.tiles}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS ok,
                       has_function_privilege(${cluster!.roles.jobs}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS jobs,
                       has_function_privilege(${cluster!.roles.app}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS app
            `;
            expect(rows[0], funktion).toEqual({ ok: false, jobs: true, app: false });
        }
        // Die Aufbewahrung nimmt Absender und Rohmail mit (Jobs-Rolle ruft sie bereits).
        await cluster!
            .admin`UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'erledigt', abgeschlossen_at = now() - interval '91 days' WHERE id = ${id}::bigint`;
        await cluster!.jobs`SELECT avesmaps_community.community_purge_expired()`;
        const [danach] = await cluster!.app<{ von_adresse: string | null; roh_datei: string | null }[]>`
            SELECT e.von_adresse, e.roh_datei FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id WHERE n.vorgang_id = ${id}::bigint
        `;
        expect(danach).toEqual({ von_adresse: null, roh_datei: null });
        // Anhänge bleiben mit der Kontaktfrist im Archiv (Fachkonzept §10.2).
        const [bleibt] = await cluster!.app<{ datei: string | null }[]>`
            SELECT x.datei FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id WHERE n.vorgang_id = ${id}::bigint
        `;
        expect(bleibt!.datei).toBe(datei);
    });

    it("🔴 Panel Mailpostfach (Migration 0289): die App legt die Schalter um und liest die Übersicht, die Jobs-Rolle liest die Schalter und trägt Läufe ein; an der Tafel hat niemand ein Recht, die Kachelrolle nichts", async () => {
        for (const rolle of [cluster!.roles.app, cluster!.roles.jobs, cluster!.roles.tiles])
            expect(await rechte(rolle, "mail_routine"), rolle).toEqual([]);
        await expect(cluster!.app`SELECT aktiv FROM avesmaps_community.mail_routine`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`SELECT aktiv FROM avesmaps_community.mail_routine`).rejects.toMatchObject({
            code: "42501",
        });
        // Beide Schalter entstehen AN: Production läuft schon, das Release darf nichts abschalten.
        const [vorab] = await cluster!.jobs<{ s: { abruf: boolean; versand: boolean } }[]>`
            SELECT avesmaps_community.community_mail_routinen() AS s
        `;
        expect(vorab!.s).toEqual({ abruf: true, versand: true });
        // Die App legt den Schalter um und liest die Übersicht samt Name der Person; die Liste der Wartenden gibt nur Kennungen.
        const [gesetzt] = await cluster!.app<{ r: { geaendert: boolean; vorher: boolean } }[]>`
            SELECT avesmaps_community.community_mail_routine_setzen('versand', false, ${person}::uuid) AS r
        `;
        expect(gesetzt!.r).toMatchObject({ geaendert: true, vorher: true });
        const [uebersicht] = await cluster!.app<
            { u: { routinen: Record<string, { aktiv: boolean; geaendertVon: string | null }>; startpunkt: unknown } }[]
        >`SELECT avesmaps_community.community_mail_uebersicht('INBOX') AS u`;
        expect(uebersicht!.u.routinen["versand"]).toMatchObject({ aktiv: false, geaendertVon: "Lena" });
        expect(uebersicht!.u.routinen["abruf"]).toMatchObject({ aktiv: true, geaendertVon: null });
        const [wartende] = await cluster!.app<{ ids: number[] }[]>`
            SELECT avesmaps_community.community_mail_wartende() AS ids
        `;
        expect(Array.isArray(wartende!.ids)).toBe(true);
        // Die Jobs-Rolle sieht den Schalter und trägt Läufe ein, nur Wörter der festen Liste.
        const [schalter] = await cluster!.jobs<{ s: { abruf: boolean; versand: boolean } }[]>`
            SELECT avesmaps_community.community_mail_routinen() AS s
        `;
        expect(schalter!.s).toEqual({ abruf: true, versand: false });
        await cluster!
            .jobs`SELECT avesmaps_community.community_mail_lauf('abruf', 'gelesen', '{"neu": 1}'::jsonb, true)`;
        await expect(
            cluster!
                .jobs`SELECT avesmaps_community.community_mail_lauf('abruf', 'Server sagt nein', '{}'::jsonb, false)`,
        ).rejects.toMatchObject({ code: "KC422" });
        // Jede Rolle nur ihre Seite.
        for (const lauf of [
            () => cluster!.app`SELECT avesmaps_community.community_mail_routinen()`,
            () => cluster!.app`SELECT avesmaps_community.community_mail_lauf('abruf', 'gelesen', '{}'::jsonb, true)`,
            () =>
                cluster!.jobs`SELECT avesmaps_community.community_mail_routine_setzen('abruf', false, ${person}::uuid)`,
            () => cluster!.jobs`SELECT avesmaps_community.community_mail_uebersicht('INBOX')`,
            () => cluster!.jobs`SELECT avesmaps_community.community_mail_wartende()`,
        ])
            await expect(lauf()).rejects.toMatchObject({ code: "42501" });
        for (const funktion of [
            "community_mail_routinen()",
            "community_mail_lauf(text,text,jsonb,boolean)",
            "community_mail_routine_setzen(text,boolean,uuid)",
            "community_mail_uebersicht(text)",
            "community_mail_wartende(integer)",
        ]) {
            const rows = await cluster!.admin<{ tiles: boolean }[]>`
                SELECT has_function_privilege(${cluster!.roles.tiles}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS tiles
            `;
            expect(rows[0]!.tiles, funktion).toBe(false);
        }
    });

    it("🔴 Verknüpfungen (Migration 0273): die App ruft `community_verknuepfen`, die Jobs-Rolle und die Kachelrolle nicht; die Verknüpfung entsteht einmal", async () => {
        const [row] = await melden();
        const id = Number(row!.id);
        const verknuepfen = (art: string, ziel: string) => cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_verknuepfen(${id}::bigint, ${person}::uuid, ${art}, ${ziel})::text AS id
        `;
        const [erste] = await verknuepfen("ops", "OPS-000012");
        const [zweite] = await verknuepfen("ops", "OPS-000012");
        expect(zweite!.id).toBe(erste!.id);
        const zeilen = await cluster!.app<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_community.verknuepfung WHERE vorgang_id = ${id}::bigint AND art = 'ops'
        `;
        expect(zeilen[0]!.n).toBe(1);
        // Die Datenbank prüft Art und Form; eine unbekannte Operation gibt es nicht.
        await expect(verknuepfen("ops", "OPS-12")).rejects.toMatchObject({ code: "KC422" });
        await expect(verknuepfen("korrektur", randomUUID())).rejects.toMatchObject({ code: "KC404" });
        for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_verknuepfen(bigint,uuid,text,text)', 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, rolle).toBe(false);
        }
    });

    it("🔴 Discord-Verbindung (Migration 0283): die App ruft die vier Funktionen, liest `melder` und schreibt `discord_name` nie direkt; Jobs und Kacheln nichts; die Aufbewahrung der Jobs-Rolle nimmt den Anzeigenamen mit", async () => {
        const kennung = "123456789012345678";
        const hash = randomBytes(32);
        const [angelegt] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_melden(
                ${randomUUID()}::uuid, 'lage', 'Wehrheim liegt zu weit im Westen.', NULL, NULL, 'Alrike', ${hash},
                '{"art": "stelle", "lage": {"x": 10, "y": 20}, "naechsterOrt": "Gareth"}'::jsonb
            )::text AS id
        `;
        const id = Number(angelegt!.id);
        const [verbunden] = await cluster!.app<{ nummer: string }[]>`
            SELECT avesmaps_community.community_discord_verbinden(${hash}, ${kennung}, 'Praiodan') AS nummer
        `;
        expect(verbunden!.nummer).toBe(`COM-${String(id).padStart(6, "0")}`);
        // Die Kennung kommt aus keiner Funktion zurück: `offen` nennt Nummer, Zustand, Kategorie und Bezugsname, sonst nichts.
        const zeilen = await cluster!.app<
            Record<string, unknown>[]
        >`SELECT * FROM avesmaps_community.community_discord_offen(${kennung})`;
        expect(zeilen).toHaveLength(1);
        expect(Object.keys(zeilen[0]!).sort()).toEqual(["bezug_name", "kategorie", "nummer", "zustand"]);
        expect(zeilen[0]).toMatchObject({ zustand: "neu", kategorie: "lage", bezug_name: "Gareth" });
        expect(JSON.stringify(zeilen)).not.toContain(kennung);
        // Lesen darf die App, direkt schreiben nicht.
        const [gelesen] = await cluster!.app<
            { discord_name: string | null }[]
        >`SELECT discord_name FROM avesmaps_community.melder WHERE vorgang_id = ${id}::bigint`;
        expect(gelesen!.discord_name).toBe("Praiodan");
        await expect(
            cluster!.app`UPDATE avesmaps_community.melder SET discord_name = 'Direkt' WHERE vorgang_id = ${id}::bigint`,
        ).rejects.toMatchObject({ code: "42501" });
        const [zurueck] = await cluster!.app<{ ergebnis: string }[]>`
            SELECT avesmaps_community.community_discord_zurueckziehen(${randomUUID()}::uuid, ${kennung}, ${id}::bigint) AS ergebnis
        `;
        expect(zurueck!.ergebnis).toBe("zurueckgezogen");
        const [geloest] = await cluster!.app<
            { n: number }[]
        >`SELECT avesmaps_community.community_discord_loesen(${hash}) AS n`;
        expect(geloest!.n).toBe(1);
        // Jobs und Kacheln rufen keine der vier.
        for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles]) {
            for (const signatur of [
                "community_discord_verbinden(bytea,text,text)",
                "community_discord_loesen(bytea)",
                "community_discord_offen(text)",
                "community_discord_zurueckziehen(uuid,text,bigint)",
            ]) {
                const rows = await cluster!.admin<{ ok: boolean }[]>`
                    SELECT has_function_privilege(${rolle}, ${`avesmaps_community.${signatur}`}, 'EXECUTE') AS ok
                `;
                expect(rows[0]!.ok, `${rolle} ${signatur}`).toBe(false);
            }
        }
        // Die Aufbewahrung (Jobs-Rolle) nimmt den Anzeigenamen mit den Kontaktdaten mit.
        const [alt] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_melden(
                ${randomUUID()}::uuid, 'lage', 'Eine alte Meldung zu Gareth.', NULL, NULL, NULL, ${randomBytes(32)},
                '{"art": "stelle", "lage": {"x": 1, "y": 2}}'::jsonb
            )::text AS id
        `;
        const altId = Number(alt!.id);
        await cluster!
            .admin`UPDATE avesmaps_community.melder SET discord_id = ${kennung}, discord_name = 'Alt' WHERE vorgang_id = ${altId}::bigint`;
        await cluster!.admin`
            UPDATE avesmaps_community.vorgang SET zustand = 'abgeschlossen', ergebnis = 'umgesetzt', abgeschlossen_at = now() - interval '91 days'
             WHERE id = ${altId}::bigint
        `;
        expect((await communityAufbewahrung(cluster!.jobs)).kontakt).toBeGreaterThanOrEqual(1);
        const [weg] = await cluster!.admin<{ discord_id: string | null; discord_name: string | null }[]>`
            SELECT discord_id, discord_name FROM avesmaps_community.melder WHERE vorgang_id = ${altId}::bigint
        `;
        expect(weg).toEqual({ discord_id: null, discord_name: null });
    });

    it("🔴 Aus dem Kanal (WI-0297, Migration 0332): die App legt die Anfrage über `community_aus_discord` an, samt Bild; Jobs und Kacheln nicht", async () => {
        const operation = randomUUID();
        const anlegen = (db: VpsCluster["app"]) => db<{ id: string }[]>`
            SELECT avesmaps_community.community_aus_discord(
                ${operation}::uuid, 'hinweis', ${"Tempel fehlt\n\nAm Markt von Gareth fehlt der Tempel."}, 'Praiodan', '123456789012345297', 'OPS-000297',
                ${cluster!.app.json([{ datei: "b".repeat(64), name: "bild-1.webp", mime: "image/webp", groesse: 1234 }] as never)}::jsonb
            )::text AS id
        `;
        for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_aus_discord(uuid,text,text,text,text,text,jsonb)', 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, rolle).toBe(false);
        }
        const [angelegt] = await anlegen(cluster!.app);
        const id = Number(angelegt!.id);
        expect((await anlegen(cluster!.app))[0]!.id).toBe(angelegt!.id);
        const [vorgang] = await cluster!.app<{ art: string; eingang: string; kategorie: string }[]>`
            SELECT art, eingang, kategorie FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
        `;
        expect(vorgang).toEqual({ art: "anfrage", eingang: "discord", kategorie: "hinweis" });
        const [melder] = await cluster!.app<{ discord_name: string | null; name: string | null }[]>`
            SELECT discord_name, name FROM avesmaps_community.melder WHERE vorgang_id = ${id}::bigint
        `;
        expect(melder).toEqual({ discord_name: "Praiodan", name: null });
        const anhaenge = await cluster!.app<{ mime: string }[]>`
            SELECT x.mime FROM avesmaps_community.mail_anhang x JOIN avesmaps_community.nachricht n ON n.id = x.nachricht_id
             WHERE n.vorgang_id = ${id}::bigint
        `;
        expect(anhaenge).toEqual([{ mime: "image/webp" }]);
    });

    it("🔴 Aus dem Kanal als Meldung (WI-0297, Migration 0336): die App legt sie mit Stelle an und fragt den Melder nur über Discord zurück; Jobs, Kacheln, Claudio und Claudia nicht", async () => {
        const kennung = "123456789012345336";
        const [angelegt] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_aus_discord_meldung(
                ${randomUUID()}::uuid, ${"Tempel fehlt\n\nAm Markt fehlt er.\n\nWo: https://avesmaps.de/#x=10&y=20"}, 'Praiodan', ${kennung}, 'OPS-000336',
                '[]'::jsonb, '{"art": "stelle", "lage": {"x": 10, "y": 20}}'::jsonb
            )::text AS id
        `;
        const id = Number(angelegt!.id);
        const [vorgang] = await cluster!.app<{ art: string; kategorie: string; eingang: string }[]>`
            SELECT art, kategorie, eingang FROM avesmaps_community.vorgang WHERE id = ${id}::bigint
        `;
        expect(vorgang).toEqual({ art: "meldung", kategorie: "sonstiges", eingang: "discord" });
        expect(
            await cluster!
                .app`SELECT art, lage_x, lage_y FROM avesmaps_community.bezug WHERE vorgang_id = ${id}::bigint`,
        ).toEqual([{ art: "stelle", lage_x: 10, lage_y: 20 }]);
        // Die Rückfrage geht an einen Melder nur mit Discord-Kennung, mit dem Weg `discord` (er liest sie mit /offen).
        const [stand] = await cluster!.admin<
            { r: number }[]
        >`SELECT revision AS r FROM avesmaps_community.vorgang WHERE id = ${id}::bigint`;
        await cluster!.app`
            SELECT avesmaps_community.community_rueckfrage(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${stand!.r}::int, 'Welcher Tempel genau?')
        `;
        expect(
            await cluster!
                .app`SELECT weg, text FROM avesmaps_community.nachricht WHERE vorgang_id = ${id}::bigint AND richtung = 'aus'`,
        ).toEqual([{ weg: "discord", text: "Welcher Tempel genau?" }]);
        expect(
            await cluster!.app<{ antwort: string | null }[]>`
                SELECT antwort FROM avesmaps_community.community_discord_offen_antworten(${kennung})
            `,
        ).toEqual([{ antwort: "Welcher Tempel genau?" }]);
        for (const rolle of [
            cluster!.roles.jobs,
            cluster!.roles.tiles,
            cluster!.roles.claudio,
            cluster!.roles.claudia,
        ]) {
            const [recht] = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_aus_discord_meldung(uuid,text,text,text,text,jsonb,jsonb)', 'EXECUTE') AS ok
            `;
            expect(recht!.ok, rolle).toBe(false);
        }
    });

    it("🔴 Antworten in /offen (WI-0297, Migration 0333): die App liest die letzte Antwort nur zur eigenen Kennung; Jobs, Kacheln, Claudio und Claudia kommen nicht heran", async () => {
        const ich = "123456789012345333";
        const fremd = "123456789012345334";
        const [angelegt] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_aus_discord(
                ${randomUUID()}::uuid, 'frage', 'Fehlt Zyklopäisch?', 'Praiodan', ${ich}, 'OPS-000333', '[]'::jsonb
            )::text AS id
        `;
        const id = Number(angelegt!.id);
        await cluster!.admin`
            INSERT INTO avesmaps_community.nachricht (vorgang_id, richtung, weg, text, operation_id)
            VALUES (${id}::bigint, 'aus', 'statusseite', 'Antwort nur für Praiodan', gen_random_uuid())
        `;
        const lies = (kennung: string) =>
            cluster!.app<{ nummer: string; antwort: string | null }[]>`
                SELECT nummer, antwort FROM avesmaps_community.community_discord_offen_antworten(${kennung})
            `;
        expect(await lies(ich)).toEqual([
            { nummer: `COM-${String(id).padStart(6, "0")}`, antwort: "Antwort nur für Praiodan" },
        ]);
        expect(await lies(fremd)).toEqual([]);
        for (const rolle of [
            cluster!.roles.jobs,
            cluster!.roles.tiles,
            cluster!.roles.claudio,
            cluster!.roles.claudia,
        ]) {
            const [recht] = await cluster!.admin<{ funktion: boolean; schema: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_discord_offen_antworten(text)', 'EXECUTE') AS funktion,
                       has_schema_privilege(${rolle}, 'avesmaps_community', 'USAGE') AS schema
            `;
            expect(recht!.funktion, rolle).toBe(false);
            if (rolle === cluster!.roles.claudio || rolle === cluster!.roles.claudia)
                expect(recht!.schema, rolle).toBe(false);
        }
    });

    it("🔴 Fremde Kanäle (Migration 0285): die App liest `kanal_stand` und `sendung` und schreibt nur über Funktionen; den Auftrag bedient die Jobs-Rolle NUR über `holen` und `ergebnis` (und liest die Grenzen); das Werkzeug `social:pruefen` läuft mit den Rechten der App", async () => {
        // Die App: Notschalter, Grenzen, Zurücknehmen über die Funktionen (ein unbekannter Beitrag heißt KC404, nicht 42501).
        const grenzen = {
            zeichen: 500,
            adresse: 23,
            bilder: 4,
            beschreibung: 1500,
            bildBytes: 1024,
            bildTypen: ["image/webp"],
        };
        await cluster!
            .app`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${cluster!.app.json(grenzen)}::jsonb)`;
        await cluster!.app`SELECT avesmaps_community.social_kanal_notschalter('mastodon', true)`;
        await cluster!.app`SELECT avesmaps_community.social_kanal_notschalter('mastodon', false)`;
        await expect(
            cluster!
                .app`SELECT avesmaps_community.beitrag_kanal_zuruecknehmen(${randomUUID()}::uuid, 9999999::bigint, ${person}::uuid, 1, 'mastodon')`,
        ).rejects.toMatchObject({ code: "KC404" });
        const [gelesen] = await cluster!.app<
            { grenzen: { zeichen: number } }[]
        >`SELECT grenzen FROM avesmaps_community.kanal_stand WHERE kanal = 'mastodon'`;
        expect(gelesen!.grenzen.zeichen).toBe(500);
        // Geschrieben wird nie direkt; die Hilfen darunter und den Auftrag ruft die App nicht.
        for (const lauf of [
            () =>
                cluster!.app`UPDATE avesmaps_community.kanal_stand SET freigeschaltet_at = now(), geprueft_durch = 'x'`,
            () => cluster!.app`UPDATE avesmaps_community.kanal_stand SET notschalter = false`,
            () => cluster!.app`DELETE FROM avesmaps_community.kanal_stand`,
            () => cluster!.app`INSERT INTO avesmaps_community.sendung (beitrag_id, kanal) VALUES (1, 'mastodon')`,
            () => cluster!.app`UPDATE avesmaps_community.sendung SET aufgabe = 'senden'`,
            () => cluster!.app`SELECT avesmaps_community._kanal_bereit('mastodon')`,
            () => cluster!.app`SELECT avesmaps_community._sendung_vormerken(1::bigint, 'mastodon', false)`,
            () => cluster!.app`SELECT avesmaps_community._beitrag_ereignis_still(1::bigint, 'gesendet', 'Mastodon')`,
            () => cluster!.app`SELECT avesmaps_community.social_senden_holen(1::bigint, 'mastodon')`,
            () =>
                cluster!
                    .app`SELECT avesmaps_community.social_senden_ergebnis(1::bigint, 'mastodon', 'fehler', NULL, NULL, 'x')`,
        ])
            await expect(lauf()).rejects.toMatchObject({ code: "42501" });
        // Die App reiht den Auftrag ein (SECURITY DEFINER).
        await seedMapDomains(cluster!.admin);
        const [auftrag] = await cluster!.app<{ public_id: string }[]>`
            SELECT public_id::text FROM job_enqueue('social_senden', 1::smallint, ${AVENTURIA.mapDomain}, 'community', ${cluster!.app.json({ beitrag: 1, kanal: "mastodon" })}::jsonb,
                                                    50::smallint, NULL, 'tiles', '{}'::smallint[])
        `;
        expect(auftrag!.public_id).toMatch(/^[0-9a-f-]{36}$/u);

        // Die Jobs-Rolle: keine Tafel, genau drei Funktionen; Notschalter, Prüfung, Zurücknehmen und die Handlungen der Redaktion ruft sie nicht.
        for (const tafel of ["kanal_stand", "sendung"] as const) {
            expect(await rechte(cluster!.roles.jobs, tafel), tafel).toEqual([]);
            expect(await rechte(cluster!.roles.tiles, tafel), tafel).toEqual([]);
        }
        await expect(cluster!.jobs`SELECT notschalter FROM avesmaps_community.kanal_stand`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`SELECT aufgabe FROM avesmaps_community.sendung`).rejects.toMatchObject({
            code: "42501",
        });
        for (const aufruf of [
            () => cluster!.jobs`SELECT avesmaps_community.social_kanal_notschalter('mastodon', true)`,
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.social_kanal_pruefung_eintragen('mastodon', 'cli:x', true, '{}'::jsonb)`,
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.beitrag_kanal_zuruecknehmen(${randomUUID()}::uuid, 1::bigint, ${person}::uuid, 1, 'mastodon')`,
            () =>
                cluster!
                    .jobs`SELECT avesmaps_community.beitrag_freigeben(${randomUUID()}::uuid, 1::bigint, ${person}::uuid, 1)`,
            () => cluster!.jobs`SELECT avesmaps_community._kanal_bereit('mastodon')`,
        ])
            await expect(aufruf()).rejects.toMatchObject({ code: "42501" });
        const [nichts] = await cluster!.jobs<
            { geholt: unknown }[]
        >`SELECT avesmaps_community.social_senden_holen(1::bigint, 'mastodon') AS geholt`;
        expect(nichts!.geholt).toBeNull();
        const [keiner] = await cluster!.jobs<{ stand: unknown }[]>`
            SELECT avesmaps_community.social_senden_ergebnis(1::bigint, 'mastodon', 'fehler', NULL, NULL, 'x') AS stand
        `;
        expect(keiner!.stand).toBeNull();
        const [neu] = await cluster!.jobs<{ g: { zeichen: number } }[]>`
            SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${cluster!.jobs.json({ ...grenzen, zeichen: 700 })}::jsonb) AS g
        `;
        expect(neu!.g.zeichen).toBe(700);
        // Kacheln rufen nichts davon.
        for (const funktion of [
            "social_senden_holen(bigint,text)",
            "social_senden_ergebnis(bigint,text,text,text,text,text)",
            "social_kanal_grenzen_setzen(text,jsonb)",
            "social_kanal_notschalter(text,boolean)",
            "beitrag_kanal_zuruecknehmen(uuid,bigint,uuid,integer,text)",
        ]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${cluster!.roles.tiles}, ${`avesmaps_community.${funktion}`}, 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, funktion).toBe(false);
        }
    });

    it("🔴 das Werkzeug `social:pruefen` läuft mit den Rechten der App-Rolle durch: Grenzen, Proben, Eintrag der Prüfung und Protokoll; ohne Zuruf nichts", async () => {
        const instanz = stelleInstanz();
        const umgebung = {
            AVESMAPS_ENV: "test",
            COMMUNITY_SOCIAL_MASTODON_URL: "https://test.mastodon.beispiel.test",
            COMMUNITY_SOCIAL_MASTODON_TOKEN: "tok-grants-1234567890-abcdef",
        } as NodeJS.ProcessEnv;
        const lauf = async (args: string[]) => {
            const ausgabe: string[] = [];
            const code = await runSocialPruefen(
                args,
                umgebung,
                { out: (z) => ausgabe.push(z), err: (z) => ausgabe.push(z) },
                { database: cluster!.app, systemUser: "probe", fetch: instanz.fetch, heute: () => "2026-11-01" },
            );
            return { code, text: ausgabe.join(" | ") };
        };
        const ohneZitat = await lauf(["--kanal", "mastodon", "--anwenden"]);
        expect(ohneZitat.code).toBe(2);
        expect(instanz.aufrufe).toEqual([]);
        await cluster!.admin`DELETE FROM avesmaps_community.kanal_stand`;
        const echt = await lauf([
            "--kanal",
            "mastodon",
            "--anwenden",
            "--operator-said",
            "Probe mit den Rechten der App.",
        ]);
        expect(echt.code, echt.text).toBe(0);
        const [stand] = await cluster!.admin<{ freigeschaltet_at: Date | null; geprueft_durch: string | null }[]>`
            SELECT freigeschaltet_at, geprueft_durch FROM avesmaps_community.kanal_stand WHERE kanal = 'mastodon'
        `;
        expect(stand!.freigeschaltet_at).not.toBeNull();
        expect(stand!.geprueft_durch).toBe("cli:probe");
        const [ereignis] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'
        `;
        expect(ereignis!.n).toBe(1);
        expect(instanz.beitraege.size).toBe(0);
    });

    it("🔴 Legacy-Meldungen (Migration 0277): die App ruft `community_legacy_uebernehmen` und liest `legacy_meldung`, schreibt sie nie direkt; Jobs und Kacheln nichts; dieselbe Nummer legt nur einen Vorgang an", async () => {
        const legacyId = 9_277_001;
        const uebernehmen = () => cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_legacy_uebernehmen(
                ${legacyId}::int, 'sonstiges', 'Eine alte Meldung aus der früheren Karte.', NULL, NULL, 'Alrike',
                '{"art": "stelle", "lage": {"x": 10, "y": 20}}'::jsonb, '2026-08-05T12:03:00Z'::timestamptz, 'Aus Legacy übernommen.'
            )::text AS id
        `;
        const [erste] = await uebernehmen();
        const [zweite] = await uebernehmen();
        expect(Number(erste!.id)).toBeGreaterThan(0);
        expect(zweite!.id).toBe(erste!.id);
        const zeilen = await cluster!.app<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM avesmaps_community.legacy_meldung WHERE legacy_id = ${legacyId}`;
        expect(zeilen[0]!.n).toBe(1);
        await expect(
            cluster!
                .app`INSERT INTO avesmaps_community.legacy_meldung (legacy_id, vorgang_id) VALUES (9277002, ${erste!.id}::bigint)`,
        ).rejects.toMatchObject({ code: "42501" });
        for (const rolle of [cluster!.roles.jobs, cluster!.roles.tiles]) {
            const rows = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, 'avesmaps_community.community_legacy_uebernehmen(integer,text,text,text,text,text,jsonb,timestamptz,text)', 'EXECUTE') AS ok
            `;
            expect(rows[0]!.ok, rolle).toBe(false);
        }
    });

    it("🔴 das Werkzeug `community:legacy` läuft mit den Rechten der App-Rolle durch: Probelauf, Übernahme, Prüfung und Protokoll", async () => {
        const ordner = mkdtempSync(join(tmpdir(), "community-legacy-grants-"));
        try {
            const datei = join(ordner, "map-reports-offen.json");
            const reports = [
                {
                    id: 9_277_101,
                    type: "label",
                    subtype: "see",
                    name: "Grantssee",
                    reporter: "Alrike",
                    lat: 100,
                    lng: 200,
                    source: "",
                    wiki_url: "",
                    comment: "Der See fehlt westlich der Stadt.",
                    review_note: "",
                    created_at: "2026-08-05 14:03:00",
                },
            ];
            writeFileSync(datei, JSON.stringify({ ok: true, count: 1, reports }), "utf8");
            const umgebung = { AVESMAPS_ENV: "test" } as NodeJS.ProcessEnv;
            const lauf = async (args: string[]) => {
                const ausgabe: string[] = [];
                const code = await runCommunityLegacy(
                    args,
                    umgebung,
                    { out: (z) => ausgabe.push(z), err: (z) => ausgabe.push(z) },
                    { database: cluster!.app, systemUser: "probe" },
                );
                return { code, text: ausgabe.join(" | ") };
            };
            const probe = await lauf(["--datei", datei]);
            expect(probe.code, probe.text).toBe(0);
            expect(probe.text).toContain("zu übernehmen");
            const echt = await lauf([
                "--datei",
                datei,
                "--anwenden",
                "--operator-said",
                "Probe mit den Rechten der App.",
            ]);
            expect(echt.code, echt.text).toBe(0);
            expect(echt.text).toContain("1 neu angelegt, 0 waren schon da");
            const [v] = await cluster!.app<{ kategorie: string; fehlt_art: string }[]>`
                SELECT v.kategorie, v.fehlt_art FROM avesmaps_community.legacy_meldung l
                  JOIN avesmaps_community.vorgang v ON v.id = l.vorgang_id WHERE l.legacy_id = 9277101
            `;
            expect(v).toEqual({ kategorie: "fehlt", fehlt_art: "gewaesser" });
            const [ereignis] = await cluster!.admin<{ n: number }[]>`
                SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.community_legacy_uebernommen'
            `;
            expect(ereignis!.n).toBe(1);
        } finally {
            rmSync(ordner, { recursive: true, force: true });
        }
    });

    it("🔴 Bewertungen (Migration 0266): die App liest `place_review` und schreibt nur über die Funktionen; Import und Jobs wie zuvor", async () => {
        const ort = randomUUID();
        await seedMapDomains(cluster!.admin);
        await cluster!.admin`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ort}, 'aventuria', 'Grants-Ort', 'stadt', ST_SetSRID(ST_MakePoint(500, 400), 0), 'test', TRUE)
        `;
        // Die App schreibt eine Bewertung über die Funktion und liest sie wieder.
        const [neu] = await cluster!.app<{ antwort: { id: string; zustand: string } }[]>`
            SELECT avesmaps_community.bewertung_schreiben(
                ${randomUUID()}::uuid, ${ort}::uuid, 4, 'Gutes Bier', 'Alrik', '7. Rahja 1049 BF', 'neu', NULL, NULL
            ) AS antwort
        `;
        expect(neu!.antwort.zustand).toBe("neu");
        const [gelesen] = await cluster!.app<{ stars: number; zustand: string }[]>`
            SELECT stars, zustand FROM place_review WHERE public_id = ${neu!.antwort.id}::uuid
        `;
        expect(gelesen).toEqual({ stars: 4, zustand: "neu" });
        const [zahl] = await cluster!.app<
            { zahl: number }[]
        >`SELECT avesmaps_community.bewertung_gefaellt(${neu!.antwort.id}::uuid, 1) AS zahl`;
        expect(zahl!.zahl).toBe(1);
        const [sichten] = await cluster!.app<{ revision: number }[]>`
            SELECT avesmaps_community.bewertung_sichten(${randomUUID()}::uuid, ${neu!.antwort.id}::uuid, ${person}::uuid, 1) AS revision
        `;
        expect(sichten!.revision).toBe(2);
        // Direkt schreiben, ändern, löschen und eine Nummer ziehen kann sie nicht: Zustand, Moderation und Zähler laufen nur über die Funktionen.
        const direkt = [
            () =>
                cluster!.app`UPDATE place_review SET zustand = 'verborgen' WHERE public_id = ${neu!.antwort.id}::uuid`,
            () => cluster!.app`UPDATE place_review SET gefaellt = 999 WHERE public_id = ${neu!.antwort.id}::uuid`,
            () => cluster!.app`DELETE FROM place_review WHERE public_id = ${neu!.antwort.id}::uuid`,
            () =>
                cluster!
                    .app`INSERT INTO place_review (place_id, stars, source_system, legacy_review_id, legacy_created_at)
                    SELECT id, 5, 'legacy', 1, now() FROM place WHERE public_id = ${ort}::uuid`,
            () => cluster!.app`SELECT nextval('place_review_id_seq')`,
        ];
        for (const lauf of direkt) await expect(lauf()).rejects.toMatchObject({ code: "42501" });
        await expect(
            cluster!
                .app`INSERT INTO avesmaps_community.bewertung_ereignis (bewertung_id, seq, art) VALUES (${randomUUID()}::uuid, 1, 'gesichtet')`,
        ).rejects.toMatchObject({ code: "42501" });
        // Die internen Hilfen ruft niemand.
        await expect(
            cluster!.app`SELECT avesmaps_community._bewertung_sperre(${neu!.antwort.id}::uuid)`,
        ).rejects.toMatchObject({ code: "42501" });
        // Jobs und Kacheln führen die Funktionen nicht aus und lesen die Tafel der Ereignisse nicht.
        await expect(
            cluster!.jobs`SELECT avesmaps_community.bewertung_gefaellt(${neu!.antwort.id}::uuid, 1)`,
        ).rejects.toMatchObject({ code: "42501" });
        expect(await rechte(cluster!.roles.jobs, "bewertung_ereignis")).toEqual([]);
        expect(await rechte(cluster!.roles.tiles, "bewertung_ereignis")).toEqual([]);
        // Der Import läuft als Migrationsrolle und darf weiter schreiben (er legt die Zeile an, ändert sie und löscht sie).
        await cluster!.admin`UPDATE place_review SET stars = 5 WHERE public_id = ${neu!.antwort.id}::uuid`;
        await cluster!.admin`DELETE FROM place_review WHERE public_id = ${neu!.antwort.id}::uuid`;
        await cluster!.admin`DELETE FROM place WHERE public_id = ${ort}::uuid`;
    });

    it("🔴 die Jobs-Rolle räumt auf, meldet aber nicht", async () => {
        const [row] = await cluster!.jobs<{ ergebnis: Record<string, number> }[]>`
            SELECT avesmaps_community.community_purge_expired() AS ergebnis
        `;
        expect(row!.ergebnis).toEqual({ archiviert: 0, kontakt: 0, geloescht: 0 });
        await expect(
            cluster!.jobs`
                SELECT avesmaps_community.community_melden(${randomUUID()}::uuid, 'lage', 'Ein Text mit genug Zeichen.', NULL, NULL, NULL,
                    ${randomBytes(32)}, '{"art": "stelle", "lage": {"x": 1, "y": 2}}'::jsonb)
            `,
        ).rejects.toMatchObject({ code: "42501" });
    });

    it("🔴 die Jobs-Rolle liest für die Fristen genau fünf Spalten von vorgang, nie einen Text, und meldet über benachrichtige()", async () => {
        const spalten = await cluster!.admin<{ column_name: string; ok: boolean }[]>`
            SELECT c.column_name, has_column_privilege(${cluster!.roles.jobs}, 'avesmaps_community.vorgang', c.column_name, 'SELECT') AS ok
              FROM information_schema.columns c
             WHERE c.table_schema = 'avesmaps_community' AND c.table_name = 'vorgang'
        `;
        expect(
            spalten
                .filter((spalte) => spalte.ok)
                .map((spalte) => spalte.column_name)
                .sort(),
        ).toEqual(["id", "papierkorb_at", "rueckfrage_at", "zustaendig", "zustand"]);
        await expect(cluster!.jobs`SELECT quelle FROM avesmaps_community.vorgang`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`SELECT * FROM avesmaps_community.nachricht`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`UPDATE avesmaps_community.vorgang SET zustand = 'neu'`).rejects.toMatchObject({
            code: "42501",
        });

        // Ein Vorgang seit 31 Tagen in der Rückfrage: Die Jobs-Rolle erinnert die zuständige Person, einmal.
        const [row] = await melden();
        const id = Number(row!.id);
        await cluster!.admin`
            UPDATE avesmaps_community.vorgang
               SET zustand = 'rueckfrage', zustaendig = ${person}::uuid, rueckfrage_at = now() - interval '31 days'
             WHERE id = ${id}::bigint
        `;
        expect(await communityFristen(cluster!.jobs, "test")).toEqual({ faellig: 1, gemeldet: 1 });
        expect(await communityFristen(cluster!.jobs, "test")).toEqual({ faellig: 1, gemeldet: 0 });
        const zeilen = await cluster!.admin<{ art: string; text: string; an_person: string }[]>`
            SELECT art, text, an_person::text FROM public.benachrichtigung WHERE art = 'community_frist'
        `;
        expect(zeilen).toEqual([
            { art: "community_frist", text: `COM-${String(id).padStart(6, "0")}`, an_person: person },
        ]);
        // Die Aufbewahrung läuft mit denselben Rechten weiter.
        expect(await communityAufbewahrung(cluster!.jobs)).toEqual({ archiviert: 0, kontakt: 0, geloescht: 0 });

        // Fehlt das Spaltenrecht, scheitert die Frist sichtbar (Der Lauf steht als gescheitert da), statt still nichts zu melden.
        await cluster!.admin.unsafe(
            `REVOKE SELECT (rueckfrage_at) ON avesmaps_community.vorgang FROM ${cluster!.roles.jobs}`,
        );
        await expect(communityFristen(cluster!.jobs, "test")).rejects.toMatchObject({ code: "42501" });
    });

    it("🔴 Social Hub (Migration 0269): die App liest die Tafeln und schreibt nur über die Funktionen; Jobs und Kacheln nur das Nötigste", async () => {
        const [neu] = await cluster!.app<{ antwort: { id: number; revision: number; zustand: string } }[]>`
            SELECT avesmaps_community.beitrag_anlegen(
                ${randomUUID()}::uuid, ${person}::uuid, NULL::bigint, 'Grants-Beitrag', 'Ein Text.', ARRAY['#Aventurien']::text[], 'karte', NULL::uuid, NULL,
                false, ARRAY['neuigkeiten']::text[]
            ) AS antwort
        `;
        expect(neu!.antwort.zustand).toBe("entwurf");
        const id = neu!.antwort.id;
        const [gelesen] = await cluster!.app<
            { titel: string }[]
        >`SELECT titel FROM avesmaps_community.beitrag WHERE id = ${id}`;
        expect(gelesen).toEqual({ titel: "Grants-Beitrag" });
        // Direkt schreiben, ändern, löschen kann die App nicht; die internen Hilfen und die Aufbewahrung ruft sie nicht. An `news_entry` behält sie ihre
        // Rechte (die Systemsteuerung der Neuigkeiten schreibt dort), auch an der neuen Spalte.
        const direkt = [
            () =>
                cluster!
                    .app`UPDATE avesmaps_community.beitrag SET zustand = 'vorgelegt', vorgelegt_at = now() WHERE id = ${id}`,
            () => cluster!.app`DELETE FROM avesmaps_community.beitrag WHERE id = ${id}`,
            () =>
                cluster!
                    .app`INSERT INTO avesmaps_community.beitrag_ziel (beitrag_id, kanal) VALUES (${id}, 'mastodon')`,
            () =>
                cluster!
                    .app`INSERT INTO avesmaps_community.beitrag_ereignis (beitrag_id, seq, art) VALUES (${id}, 99, 'freigegeben')`,
            () => cluster!.app`UPDATE public.news_entry SET beitrag_id = ${id} WHERE false`,
            () => cluster!.app`SELECT avesmaps_community._routine_beitrag(1, 'a', 'b', 'karte')`,
            () => cluster!.app`SELECT avesmaps_community.beitrag_purge_expired()`,
        ];
        const codes: string[] = [];
        for (const lauf of direkt) {
            try {
                await lauf();
                codes.push("ok");
            } catch (error) {
                codes.push((error as { code?: string }).code ?? "fehler");
            }
        }
        expect(codes).toEqual(["42501", "42501", "42501", "42501", "ok", "42501", "42501"]);
        // Jobs: keine Tafel außer vier Spalten von beitrag, kein Schreiben, keine Handgriffe; die Frischeprüfung ja.
        for (const tafel of ["beitrag_ziel", "beitrag_ereignis"])
            expect(await rechte(cluster!.roles.jobs, tafel), tafel).toEqual([]);
        const spalten = await cluster!.admin<{ column_name: string; ok: boolean }[]>`
            SELECT c.column_name, has_column_privilege(${cluster!.roles.jobs}, 'avesmaps_community.beitrag', c.column_name, 'SELECT') AS ok
              FROM information_schema.columns c WHERE c.table_schema = 'avesmaps_community' AND c.table_name = 'beitrag'
        `;
        expect(
            spalten
                .filter((spalte) => spalte.ok)
                .map((spalte) => spalte.column_name)
                .sort(),
        ).toEqual(["herkunft", "id", "papierkorb_at", "zustand"]);
        await expect(cluster!.jobs`SELECT text FROM avesmaps_community.beitrag`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`UPDATE avesmaps_community.beitrag SET ki = true`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(
            cluster!
                .jobs`SELECT avesmaps_community.beitrag_vorlegen(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, 1)`,
        ).rejects.toMatchObject({ code: "42501" });
        expect(await communityBeitragAufbewahrung(cluster!.jobs)).toEqual({
            beitraegeVerfallen: 0,
            beitraegeGeloescht: 0,
        });
        // Kacheln: nichts.
        for (const tafel of ["beitrag", "beitrag_ziel", "beitrag_ereignis"])
            expect(await rechte(cluster!.roles.tiles, tafel), tafel).toEqual([]);
        await cluster!.admin`DELETE FROM avesmaps_community.beitrag`;
    });

    it("🔴 die Routine-Rolle ruft weiter nur news_add (kein Lesen); der Aufruf legt zugleich den Vorschlag im Hub an, und die Jobs-Rolle meldet ihn", async () => {
        await cluster!.admin`DELETE FROM avesmaps_community.beitrag`;
        await cluster!.admin`DELETE FROM public.news_entry`;
        // Der Test spricht als Routine-Rolle über SET ROLE (auf dem Cluster hat sie keine Anmeldung); alles wird zurückgerollt.
        await expect(
            cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.news}`);
                const [angelegt] = await tx<{ id: string }[]>`
                    SELECT public.news_add('2026-10-30'::date, 'Vorschlag aus der Routine', 'Ein Satz für normale Leser.', 'karte', 'test:grants')::text AS id
                `;
                expect(angelegt!.id).toMatch(/^\d+$/u);
                await tx.unsafe("SAVEPOINT a");
                await expect(tx`SELECT * FROM public.news_entry`).rejects.toMatchObject({ code: "42501" });
                await tx.unsafe("ROLLBACK TO SAVEPOINT a");
                await tx.unsafe("SAVEPOINT b");
                await expect(tx`SELECT * FROM avesmaps_community.beitrag`).rejects.toMatchObject({ code: "42501" });
                await tx.unsafe("ROLLBACK TO SAVEPOINT b");
                throw new Error("__weiter__");
            }),
        ).rejects.toThrow("__weiter__");
        // Dieselbe Rolle noch einmal, diesmal bis zum Ende: Der Vorschlag steht.
        await cluster!.admin.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.news}`);
            await tx`SELECT public.news_add('2026-10-30'::date, 'Vorschlag aus der Routine', 'Ein Satz für normale Leser.', 'karte', 'test:grants')`;
        });
        const [b] = await cluster!.admin<{ zustand: string; herkunft: string; ki: boolean }[]>`
            SELECT zustand, herkunft, ki FROM avesmaps_community.beitrag
        `;
        expect(b).toEqual({ zustand: "vorgelegt", herkunft: "routine", ki: true });
        // Die Jobs-Rolle sieht den Vorschlag (vier Spalten) und meldet ihn; in dieser Umgebung gibt es keinen Betreiber, also keine Zeile.
        expect(await communitySocialFreigabe(cluster!.jobs, "test")).toEqual({
            vorschlaege: 1,
            vorschlaegeGemeldet: 0,
        });
        await cluster!.admin`DELETE FROM avesmaps_community.beitrag`;
        await cluster!.admin`DELETE FROM public.news_entry`;
    });
});
