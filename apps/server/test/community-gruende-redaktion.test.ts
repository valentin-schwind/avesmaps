import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { GRUENDE_REDAKTION } from "../src/community/gruende-redaktion.ts";
import { grundZumSatz } from "../src/community/gruende.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Genaue Gründe in den Redaktionsfenstern der Community (WI-0291, Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“).
 *
 * - **Tafel ohne Datenbank:** Jedes Muster von `gruende-redaktion.ts` trifft genau EINEN Satz der Migrationen (je Funktion die letzte, die sie definiert), und jeder Satz, den eine Funktion der
 *   Redaktion sagen kann, hat einen Code (die Sätze der Besucher zählen mit). Ändert eine Migration einen Satz, wird dieser Test rot und nicht erst das Fenster stumm.
 * - **Routen gegen PostgreSQL:** Der Code steht in `details.reason` der Antwort (Satz der Datenbank, Satz der Route, fehlendes Recht), der deutsche Satz bleibt unverändert.
 */

const MIGRATIONEN = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Je Funktion von `avesmaps_community` die Sätze (`_fehler('KC…', 'community_…: Satz')`) ihrer LETZTEN Definition. */
function saetzeJeFunktion(): Map<string, string[]> {
    const letzte = new Map<string, string>();
    for (const datei of readdirSync(MIGRATIONEN)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        const sql = readFileSync(`${MIGRATIONEN}${datei}`, "utf8");
        const kopf = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+avesmaps_community\.([a-z_0-9]+)\s*\(/gu)];
        kopf.forEach((treffer, i) => {
            const ende = kopf[i + 1]?.index ?? sql.length;
            letzte.set(treffer[1] as string, sql.slice(treffer.index, ende));
        });
    }
    const ergebnis = new Map<string, string[]>();
    for (const [name, rumpf] of letzte) {
        const saetze = [...rumpf.matchAll(/_fehler\(\s*'KC\d+',\s*'community_[a-z_]+:\s*([^']*)'/gu)]
            .map((t) => t[1] as string)
            // „COM-%s“ (der Vorgang selbst fehlt): kein fester Satz, die Route sagt, welcher gemeint ist.
            .filter((satz) => !satz.includes("%"));
        ergebnis.set(name, saetze);
    }
    return ergebnis;
}

/** Die Funktionen, die ein Redaktionsfenster erreicht (die Legacy-Übernahme und die Discord-Wege nicht). */
const REDAKTIONS_FUNKTIONEN = [
    "_pruefe",
    "_nur_anfrage",
    "_bewertung_pruefe",
    "community_uebernehmen",
    "community_sichten",
    "community_rueckfrage",
    "community_abschliessen",
    "community_wiedereroeffnen",
    "community_archivieren",
    "community_papierkorb",
    "community_wiederherstellen",
    "community_anfrage_antworten",
    "community_anfrage_antworten_mail",
    "community_anfrage_archivieren",
    "community_anfrage_zurueckholen",
    "community_als_meldung",
    "community_mail_neu",
    "community_mail_erneut",
    "community_verknuepfen",
    "bewertung_sichten",
    "bewertung_freigeben",
    "bewertung_verbergen",
    "bewertung_einblenden",
    "bewertung_inhalt_loeschen",
];

describe("Gründe der Redaktion: Tafel gegen die Sätze der Migrationen (WI-0291)", () => {
    const jeFunktion = saetzeJeFunktion();
    const alle = new Set([...jeFunktion.values()].flat());

    it("jedes Muster trifft genau einen Satz der Migrationen", () => {
        for (const grund of GRUENDE_REDAKTION) {
            const treffer = [...alle].filter((satz) => grund.muster.test(satz));
            expect(treffer, `${grund.reason}: ${String(grund.muster)}`).toHaveLength(1);
        }
    });

    it("kein Satz trifft zwei Muster der Tafel", () => {
        for (const satz of alle) {
            const treffer = GRUENDE_REDAKTION.filter((grund) => grund.muster.test(satz));
            expect(treffer.length, satz).toBeLessThanOrEqual(1);
        }
    });

    it("jeder Satz einer Funktion der Redaktion hat einen Code (eigene Tafel oder die der Besucher)", () => {
        const ohne: string[] = [];
        for (const name of REDAKTIONS_FUNKTIONEN) {
            const saetze = jeFunktion.get(name);
            expect(saetze, `Funktion ${name} fehlt in den Migrationen`).toBeDefined();
            for (const satz of saetze ?? []) {
                if (grundZumSatz(satz) === undefined) ohne.push(`${name}: ${satz}`);
            }
        }
        expect(ohne).toEqual([]);
    });

    it("ein Code meint nur einen Satz (außer den zwei Sätzen zur Anfrage im Papierkorb)", () => {
        const jeCode = new Map<string, Set<string>>();
        for (const grund of GRUENDE_REDAKTION) {
            const satz = [...alle].find((s) => grund.muster.test(s));
            if (satz !== undefined) jeCode.set(grund.reason, (jeCode.get(grund.reason) ?? new Set()).add(satz));
        }
        for (const [code, saetze] of jeCode) {
            expect(saetze.size, code).toBe(code === "anfrage_im_papierkorb" ? 2 : 1);
        }
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MELDER_TEXT = "Wehrheim liegt zu weit im Westen, laut Regionalband näher an der Reichsstraße.";

describeWithDatabase("Gründe der Redaktion: Routen gegen PostgreSQL (WI-0291)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let olaf: { id: string; cookie: string };
    let lena: { id: string; cookie: string };
    let adresse = 10;
    const neueAdresse = (): string => `10.42.0.${String(adresse++)}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "community-gruende-redaktion-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
        };
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        olaf = await person("operator", "Olaf");
        lena = await person("reviewer", "Lena");
    });

    beforeEach(async () => {
        await database`DELETE FROM avesmaps_community.vorgang`;
    });

    afterAll(async () => {
        await database`DELETE FROM avesmaps_community.vorgang`.catch(() => undefined);
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const gesamt = (antwort: { statusCode: number; json(): unknown }) => ({
        status: antwort.statusCode,
        ...(antwort.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error,
    });

    async function melde(): Promise<string> {
        const antwort = await app.inject({
            method: "POST",
            url: "/api/community/meldungen",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: {
                operationId: randomUUID(),
                schluessel: randomBytes(32).toString("base64url"),
                kategorie: "lage",
                text: MELDER_TEXT,
                bezug: { art: "stelle", lage: { x: 611, y: 612 } },
                falle: { feld: "", dauerMs: 8000 },
            },
        });
        expect(antwort.statusCode).toBe(201);
        return (antwort.json() as { nummer: string }).nummer;
    }
    const revision = async (nummer: string): Promise<number> => {
        const antwort = await app.inject({
            method: "GET",
            url: `/api/community/vorgaenge/${nummer}`,
            headers: { cookie: olaf.cookie },
        });
        return (antwort.json() as { zeile: { revision: number } }).zeile.revision;
    };
    const abschluss = (nummer: string, baseRevision: number, patch: Record<string, unknown>) =>
        post(
            `/api/community/vorgaenge/${nummer}/abschliessen`,
            { operationId: randomUUID(), baseRevision, ergebnis: "abgelehnt", begruendung: "Passt nicht.", ...patch },
            olaf.cookie,
        );

    it("Abschließen: die Begründung nur aus Leerzeichen sagt `begruendung_fehlt`, der deutsche Satz bleibt", async () => {
        const nummer = await melde();
        const antwort = gesamt(await abschluss(nummer, await revision(nummer), { begruendung: "   " }));
        expect(antwort).toMatchObject({
            status: 422,
            code: "community_invalid",
            message: "die Begründung ist Pflicht",
            details: { reason: "begruendung_fehlt" },
        });
    });

    it("Abschließen als Dublette: eine Nummer, die es nicht gibt, ist der ANDERE Vorgang; die eigene Nummer sagt es auch", async () => {
        const nummer = await melde();
        const rev = await revision(nummer);
        const unbekannt = gesamt(await abschluss(nummer, rev, { ergebnis: "dublette", dubletteVon: "COM-987654" }));
        expect(unbekannt).toMatchObject({
            status: 404,
            code: "community_not_found",
            details: { reason: "dublette_unbekannt", nummer: "COM-987654" },
        });
        const selbst = gesamt(await abschluss(nummer, rev, { ergebnis: "dublette", dubletteVon: nummer }));
        expect(selbst).toMatchObject({ status: 404, details: { reason: "dublette_selbst" } });
        // Ohne Nummer bei „Doppelt“ meldet die Datenbank ihren Satz.
        const ohne = gesamt(await abschluss(nummer, rev, { ergebnis: "dublette" }));
        expect(ohne).toMatchObject({ status: 422, details: { reason: "dublette_angabe" } });
    });

    it("Abschließen mit einer Nummer, die nicht zu lesen ist: `dublette_nummer_ungueltig`", async () => {
        const nummer = await melde();
        const antwort = gesamt(
            await abschluss(nummer, await revision(nummer), { ergebnis: "dublette", dubletteVon: "COM-0" }),
        );
        expect(antwort).toMatchObject({
            status: 422,
            message: "Die Nummer des anderen Vorgangs passt nicht.",
            details: { reason: "dublette_nummer_ungueltig" },
        });
    });

    it("Wiedereröffnen eines offenen Vorgangs: `nicht_abgeschlossen`; ein alter Stand: `vorgang_geaendert`", async () => {
        const nummer = await melde();
        const rev = await revision(nummer);
        const offen = gesamt(
            await post(
                `/api/community/vorgaenge/${nummer}/wiedereroeffnen`,
                { operationId: randomUUID(), baseRevision: rev, grund: "Doch noch einmal ansehen." },
                olaf.cookie,
            ),
        );
        expect(offen).toMatchObject({
            status: 409,
            code: "community_transition",
            details: { reason: "nicht_abgeschlossen" },
        });
        const alt = gesamt(await abschluss(nummer, rev + 5, {}));
        expect(alt).toMatchObject({
            status: 409,
            code: "community_conflict",
            details: { reason: "vorgang_geaendert" },
        });
    });

    it("Zuständig: eine Person, die es nicht gibt, sagt `zustaendig_unmoeglich` und ob es eine Anfrage ist", async () => {
        const nummer = await melde();
        const antwort = gesamt(
            await post(
                `/api/community/vorgaenge/${nummer}/zustaendig`,
                { operationId: randomUUID(), baseRevision: await revision(nummer), person: randomUUID() },
                olaf.cookie,
            ),
        );
        expect(antwort).toMatchObject({
            status: 422,
            message: "Diese Person kann nicht zuständig sein.",
            details: { reason: "zustaendig_unmoeglich", anfrage: false },
        });
    });

    it("Antworten per Mail ohne Mailweg: 409 mit `mailweg_aus`", async () => {
        const anfrage = await app.inject({
            method: "POST",
            url: "/api/community/anfragen",
            remoteAddress: neueAdresse(),
            headers: { origin: TEST_ORIGIN },
            payload: {
                operationId: randomUUID(),
                schluessel: randomBytes(32).toString("base64url"),
                kategorie: "frage",
                text: "Darf die Karte für ein Spielleiterhandbuch verwendet werden? Wir würden gern einen Ausschnitt drucken.",
                mail: "alrike@example.org",
                falle: { feld: "", dauerMs: 8000 },
            },
        });
        expect(anfrage.statusCode).toBe(201);
        const nummer = (anfrage.json() as { nummer: string }).nummer;
        const antwort = gesamt(
            await post(
                `/api/community/vorgaenge/${nummer}/antworten`,
                {
                    operationId: randomUUID(),
                    baseRevision: await revision(nummer),
                    text: "Ja, gern.",
                    archivieren: false,
                    weg: "mail",
                },
                olaf.cookie,
            ),
        );
        expect(antwort).toMatchObject({
            status: 409,
            code: "community_transition",
            message: "Der Mailweg ist noch nicht eingerichtet.",
            details: { reason: "mailweg_aus" },
        });
    });

    it("Fehlendes Recht (eine andere Person zuständig machen): 403 mit `recht_fehlt` und dem Recht", async () => {
        const nummer = await melde();
        const antwort = gesamt(
            await post(
                `/api/community/vorgaenge/${nummer}/zustaendig`,
                { operationId: randomUUID(), baseRevision: await revision(nummer), person: olaf.id },
                lena.cookie,
            ),
        );
        expect(antwort).toMatchObject({ status: 403, code: "community_forbidden" });
        expect(antwort.details).toMatchObject({ reason: "recht_fehlt", recht: "moderate_community" });
    });
});
