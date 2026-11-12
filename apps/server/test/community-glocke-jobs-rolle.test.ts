import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import { communityFristen } from "../src/community/aufbewahrung.ts";
import { bearbeitende, mailFehler } from "../src/community/glocke.ts";
import type { PostfachQuelle } from "../src/community/mail/postfach.ts";
import { runCommunityMailAbrufJob } from "../src/jobs/community-mail-abruf-job.ts";
import type { JobContext } from "../src/jobs/handlers.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Glocke der Aufträge, gelesen und gemeldet als Jobs-Rolle (WI-0268), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen und ALLEN Vorlagen unter
 * `apps/server/src/db/*.psql`. Die Jobs-Rolle hat an keiner Tafel von `avesmaps_auth` ein Recht (`auth-grants.psql`).
 *
 * 🔴 **Anlass (2026-11-03, Befund aus WI-0278):** `bearbeitende()` las `avesmaps_auth.person` und `person_access` direkt. In der Jobs-Rolle warf das 42501,
 * der leere `catch` im Abrufjob verschluckte es: Die Mail lag im Eingang, die Glocke blieb still. Dasselbe traf die Fristen ohne Zuständigkeit und die
 * nicht zugestellte Mail ohne bekannte Person. Lokal und in den übrigen Tests fiel es nicht auf, weil dort als Eigentümer gelesen wird.
 */

const ENV = "glockejobs";
const UMGEBUNG = "test";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const FUNKTION = "avesmaps_community.community_bearbeitende(text, text[], text[])";
const ABSENDER = "alrike.fischer@example.org";
const BETREFF = "Frage zur Karte von Wehrheim";
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Glocke der Community als Jobs-Rolle ohne Anmeldeschema (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let ablage = "";
    let uid = 0;
    /** Liest Mails: `betreiberin` und `diplomat`. Bearbeitet Meldungen: `betreiberin` und `prueferin`. */
    let betreiberin = "";
    let diplomat = "";
    let prueferin = "";

    const person = async (
        name: string,
        rolle: string,
        zugang: { umgebung?: string; status?: string; konto?: string } = {},
    ): Promise<string> => {
        const [row] = await cluster!.admin<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, status, created_via)
            VALUES (${name}, ${zugang.konto ?? "active"}, 'system') RETURNING id::text
        `;
        await cluster!.admin`
            INSERT INTO avesmaps_auth.person_access (person_id, environment, role, status)
            VALUES (${row!.id}::uuid, ${zugang.umgebung ?? UMGEBUNG}, ${rolle}, ${zugang.status ?? "active"})
        `;
        return row!.id;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN);
        ablage = mkdtempSync(join(tmpdir(), "avesmaps-glocke-jobs-"));
        betreiberin = await person("Betreiberin", "operator");
        prueferin = await person("Prüferin", "reviewer");
        // Grundrolle ohne `read_mailbox`; das Recht kommt allein aus der Sonderrolle.
        diplomat = await person("Diplomat", "tester");
        await cluster.admin`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, reason)
            VALUES (${diplomat}::uuid, ${UMGEBUNG}, 'diplomat', 'Test')
        `;
        // Sie alle bekommen nichts: gesperrt, Zugang entzogen, nur in einer anderen Umgebung, Sonderrolle beendet.
        await person("Gesperrt", "operator", { konto: "locked" });
        await person("Entzogen", "operator", { status: "revoked" });
        await person("Anderswo", "operator", { umgebung: "production" });
        const beendet = await person("Beendet", "tester");
        await cluster.admin`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, reason, revoked_at, revoke_reason)
            VALUES (${beendet}::uuid, ${UMGEBUNG}, 'diplomat', 'Test', now(), 'Test')
        `;
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
        if (ablage !== "") rmSync(ablage, { recursive: true, force: true });
    }, 60_000);

    const kontext = (): JobContext => ({
        input: {},
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    });

    const roh = (messageId: string, antwortAuf?: string): Buffer =>
        Buffer.from(
            [
                `Message-ID: ${messageId}`,
                `From: Alrike Fischer <${ABSENDER}>`,
                "To: Avesmaps-Redaktion <info@avesmaps.de>",
                `Subject: ${BETREFF}`,
                ...(antwortAuf === undefined ? [] : [`In-Reply-To: ${antwortAuf}`]),
                "MIME-Version: 1.0",
                "Content-Type: text/plain; charset=utf-8",
                "",
                "Wehrheim liegt zu weit im Westen.",
            ].join("\r\n"),
            "utf8",
        );

    /** Ein Lauf des Abrufjobs mit der Verbindung der Jobs-Rolle und gestellter Quelle; nie ein echtes Postfach. */
    const abruf = async (mail: Buffer): Promise<{ ergebnis: Record<string, unknown>; warnungen: string[] }> => {
        uid += 1;
        const nachricht = { uid, roh: mail };
        const quelle: PostfachQuelle = {
            lies: () => Promise.resolve({ uidValidity: 1, nachrichten: [nachricht] }),
        };
        const warnungen: string[] = [];
        const ergebnis = await runCommunityMailAbrufJob(kontext(), {
            database: cluster!.jobs,
            environment: {
                COMMUNITY_MAIL_IMAP_HOST: "imap.example.invalid",
                COMMUNITY_MAIL_USER: "redaktion-konto@example.org",
                COMMUNITY_MAIL_PASSWORD: "geheim-kennwort-4711",
                COMMUNITY_MAIL_ABLAGE: ablage,
                AVESMAPS_ENV: UMGEBUNG,
            },
            quelle: () => quelle,
            warnung: (text) => warnungen.push(text),
        });
        return { ergebnis, warnungen };
    };

    /** Wer zu dieser Quelle eine Meldung bekam, sortiert. Gelesen als Superuser: Die Zeilen sind der Beleg. */
    const empfaenger = async (quelle: string): Promise<string[]> => {
        const rows = await cluster!.admin<{ an: string }[]>`
            SELECT an_person::text AS an FROM public.benachrichtigung WHERE quelle = ${quelle} ORDER BY an_person
        `;
        return rows.map((row) => row.an);
    };
    const sortiert = (...ids: string[]): string[] => [...ids].sort();
    const neueMessageId = (): string => `<glocke-${randomUUID()}@mail.example.org>`;

    /** Vorgang und Nachricht, in denen diese Mail steht. */
    const fundstelle = async (messageId: string): Promise<{ nummer: string; nachricht: string }> => {
        const [row] = await cluster!.admin<{ vorgang: string; nachricht: string }[]>`
            SELECT n.vorgang_id::text AS vorgang, n.id::text AS nachricht
              FROM avesmaps_community.mail_eingang e JOIN avesmaps_community.nachricht n ON n.id = e.nachricht_id
             WHERE e.message_id = ${messageId}
        `;
        return { nummer: `COM-${row!.vorgang.padStart(6, "0")}`, nachricht: row!.nachricht };
    };

    it("🔴 die Voraussetzung: die Jobs-Rolle liest das Anmeldeschema nicht", async () => {
        // Ohne diese Zeile prüfte der Test unten nichts mehr, sobald die Jobs-Rolle das Recht bekäme.
        await expect(cluster!.jobs`SELECT id FROM avesmaps_auth.person LIMIT 1`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.jobs`SELECT person_id FROM avesmaps_auth.person_access LIMIT 1`).rejects.toMatchObject({
            code: "42501",
        });
    });

    it("🔴 die Jobs-Rolle findet dieselben Personen wie die App: aktiv, in dieser Umgebung, aus Rolle oder Sonderrolle", async () => {
        const alsApp = await bearbeitende(cluster!.app, UMGEBUNG, "read_mailbox");
        expect(alsApp).toEqual(sortiert(betreiberin, diplomat));
        expect(await bearbeitende(cluster!.jobs, UMGEBUNG, "read_mailbox")).toEqual(alsApp);
        expect(await bearbeitende(cluster!.jobs, UMGEBUNG)).toEqual(sortiert(betreiberin, prueferin));
    });

    it("🔴 eine neue Mail läutet aus dem Abrufjob: eine `community_nachricht` je Person mit `read_mailbox`, ohne Warnung", async () => {
        const messageId = neueMessageId();
        const { ergebnis, warnungen } = await abruf(roh(messageId));
        expect(ergebnis).toMatchObject({ gelesen: 1, neu: 1 });
        expect(warnungen).toEqual([]);
        const { nummer } = await fundstelle(messageId);
        expect(await empfaenger(`community_nachricht:${nummer}`)).toEqual(sortiert(betreiberin, diplomat));
    });

    it("🔴 eine Mail im Faden ohne Zuständigkeit läutet als `community_antwort` bei allen mit `read_mailbox`", async () => {
        const erste = neueMessageId();
        await abruf(roh(erste));
        const zweite = neueMessageId();
        const { ergebnis, warnungen } = await abruf(roh(zweite, erste));
        expect(ergebnis).toMatchObject({ gelesen: 1, angehaengt: 1 });
        expect(warnungen).toEqual([]);
        const { nummer, nachricht } = await fundstelle(zweite);
        expect(await empfaenger(`community_antwort:${nummer}:mail-${nachricht}`)).toEqual(
            sortiert(betreiberin, diplomat),
        );
    });

    it("🔴 die Frist einer Rückfrage ohne Zuständigkeit meldet sich aus der Aufbewahrung bei den Bearbeitenden", async () => {
        const [row] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_community.community_melden(
                ${randomUUID()}::uuid, 'lage', 'Wehrheim liegt zu weit im Westen.', NULL, NULL, NULL, ${randomBytes(32)},
                '{"art": "stelle", "lage": {"x": 10, "y": 20}}'::jsonb
            )::text AS id
        `;
        await cluster!.admin`
            UPDATE avesmaps_community.vorgang
               SET zustand = 'rueckfrage', zustaendig = NULL, rueckfrage_at = now() - interval '31 days'
             WHERE id = ${row!.id}::bigint
        `;
        expect(await communityFristen(cluster!.jobs, UMGEBUNG)).toEqual({ faellig: 1, gemeldet: 2 });
        const nummer = `COM-${row!.id.padStart(6, "0")}`;
        const [tag] = await cluster!.admin<{ tag: string }[]>`
            SELECT to_char(rueckfrage_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS tag FROM avesmaps_community.vorgang WHERE id = ${row!.id}::bigint
        `;
        expect(await empfaenger(`community_frist:${nummer}:${tag!.tag}`)).toEqual(sortiert(betreiberin, prueferin));
    });

    it("🔴 eine nicht zugestellte Mail ohne bekannte Person meldet sich aus dem Versandjob bei allen mit `read_mailbox`", async () => {
        const fehler = { nummer: "COM-999999", ausgang: 41, serie: 1, person: null };
        expect(await mailFehler(cluster!.jobs, UMGEBUNG, fehler)).toBe(2);
        expect(await empfaenger("community_mail_fehler:COM-999999:41:1")).toEqual(sortiert(betreiberin, diplomat));
    });

    it("🔴 die Funktion: App und Jobs dürfen sie rufen, sonst niemand, und sie gibt nur Kennungen heraus", async () => {
        const roles = cluster!.roles;
        for (const [rolle, darf] of [
            [roles.app, true],
            [roles.jobs, true],
            [roles.tiles, false],
            [roles.news, false],
            [roles.claudia, false],
            [roles.claudio, false],
            [roles.queue_read, false],
        ] as const) {
            const [row] = await cluster!.admin<{ ok: boolean }[]>`
                SELECT has_function_privilege(${rolle}, ${FUNKTION}, 'EXECUTE') AS ok
            `;
            expect(row!.ok, rolle).toBe(darf);
        }
        const [form] = await cluster!.admin<{ ergebnis: string; definer: boolean; besitzer: string }[]>`
            SELECT pg_get_function_result(p.oid) AS ergebnis, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS besitzer
              FROM pg_proc p WHERE p.oid = to_regprocedure(${FUNKTION})
        `;
        expect(form).toEqual({ ergebnis: "SETOF uuid", definer: true, besitzer: roles.migrate });
    });

    it("🔴 scheitert die Glocke, bleibt die Mail im Eingang, und eine Zeile im Protokoll nennt den SQLSTATE, ohne Inhalt und ohne Personendaten", async () => {
        const entziehen = (mach: "GRANT" | "REVOKE") =>
            cluster!.admin.unsafe(
                `${mach} EXECUTE ON FUNCTION public.benachrichtige(TEXT, JSONB, TEXT, UUID, TEXT, BIGINT, TEXT, TEXT, BOOLEAN) ${mach === "GRANT" ? "TO" : "FROM"} ${cluster!.roles.jobs}`,
            );
        await entziehen("REVOKE");
        const messageId = neueMessageId();
        const letzteUid = uid + 1;
        try {
            const { ergebnis, warnungen } = await abruf(roh(messageId));
            expect(ergebnis, "Der Lauf gilt trotzdem").toMatchObject({ ergebnis: "gelesen", gelesen: 1, neu: 1 });
            const { nummer } = await fundstelle(messageId);
            expect(await empfaenger(`community_nachricht:${nummer}`)).toEqual([]);
            expect(warnungen).toHaveLength(1);
            expect(warnungen[0]).toContain("SQLSTATE 42501");
            expect(warnungen[0]).toContain(nummer);
            for (const geheim of [ABSENDER, "Alrike", BETREFF, "Wehrheim", betreiberin, diplomat, messageId])
                expect(warnungen[0]).not.toContain(geheim);
        } finally {
            await entziehen("GRANT");
        }
        const [stand] = await cluster!.admin<{ u: number }[]>`
            SELECT letzte_uid::int AS u FROM avesmaps_community.mail_abruf_stand
        `;
        expect(stand!.u, "Der Stand rückt trotzdem vor").toBe(letzteUid);
    });

    it("🔴 die Überlappung: Bis die Vorlage die Funktion freigibt, liest die App wie bisher direkt, und die Jobs-Rolle scheitert sichtbar statt leer", async () => {
        const entziehen = (rolle: string, mach: "GRANT" | "REVOKE") =>
            cluster!.admin.unsafe(
                `${mach} EXECUTE ON FUNCTION ${FUNKTION} ${mach === "GRANT" ? "TO" : "FROM"} ${rolle}`,
            );
        await entziehen(cluster!.roles.app, "REVOKE");
        await entziehen(cluster!.roles.jobs, "REVOKE");
        try {
            expect(await bearbeitende(cluster!.app, UMGEBUNG, "read_mailbox")).toEqual(sortiert(betreiberin, diplomat));
            await expect(bearbeitende(cluster!.jobs, UMGEBUNG, "read_mailbox")).rejects.toMatchObject({
                code: "42501",
            });
        } finally {
            await entziehen(cluster!.roles.app, "GRANT");
            await entziehen(cluster!.roles.jobs, "GRANT");
        }
    });
});
