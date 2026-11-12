import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    DISCORD_BERICHT_MAX,
    DISCORD_BERICHT_TEILE_MAX,
    DISCORD_PROMPT_VORGABE,
    DISCORD_SCHLUSS,
    type FreigabeDatei,
    type ReleaseVerlauf,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { zeileMitId } from "../src/discord/ablage.ts";
import { sammleVorgaenge } from "../src/discord/meldungen.ts";
import { MODELL_TEXT_MAX, type Ausfuehren } from "../src/discord/formulierer.ts";
import { discordKonfiguration, type DiscordKonfig } from "../src/discord/konfig.ts";
import type { DiscordNachricht, DiscordRest, SendeErgebnis, SucheErgebnis } from "../src/discord/rest.ts";
import { NACHRICHTEN_TRENNER } from "../src/discord/teilung.ts";
import { auftaktVon, ersteZeile } from "../src/discord/vorlage.ts";
import {
    PAUSE_ZWISCHEN_TEILEN_MS,
    beanspruchVonHand,
    entwirf,
    tagesbericht,
    wiederhole,
    wiederholbar,
    type ZustellDeps,
} from "../src/discord/zustellung.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { GILDE, SENDEN, gestellteGilde } from "./support/discord-gilde.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Zustellung des Discord-Tagesberichts gegen echtes PostgreSQL (WI-0255, Migration 0221), mit gestelltem Discord: kein Test sendet.
 *
 * Problemfälle: zweiter Lauf am selben Tag, zwei Läufe zugleich, unklarer Ausgang (gefunden, nicht gefunden, Nachsehen gescheitert),
 * liegengebliebenes `sendet`, Rate-Limit kurz und lang, Ablehnung, Stage, Routine aus, außerhalb des Fensters, rote Prüfung, Fehlschlag von
 * gestern (kein Rückstau). Soll: höchstens eine Nachricht je Tag und Kanal, nie blind wiederholt, jeder Ausgang mit Grund in der Tafel.
 * Dazu die Routen: Rechte, Passkey, kein Schlüssel in einer Antwort, Stage antwortet 409.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

// Eine erfundene Kennung im Format von Discord, nie ein echter Kanal.
const KANAL = "1000000000000000001";
const TOKEN = "test.SCHLUESSEL.discord-bericht";
const sha = (n: number): string => n.toString(16).padStart(7, "a").padEnd(40, "0");
const releaseVon = (n: number): string => `20261025T080000Z-${sha(n).slice(0, 7)}`;
const ZEHN_UHR = new Date("2026-10-25T09:00:00Z");

const VERLAUF: ReleaseVerlauf = {
    schema: 1,
    bis: sha(5),
    commits: [5, 4, 3].map((n) => ({
        sha: sha(n),
        art: "feat",
        titel: `feat: Betreff ${String(n)}`,
        neu: n === 4 ? [] : [`Neuerung ${String(n)} für alle.`],
        achtung: [],
        anwendung: true,
    })),
};

/** Die Statusdatei der Freigabe der Stage: Production steht auf dem Commit `n` (so weiß die Stage, was in Production läuft). */
const freigabeMit = (n: number): FreigabeDatei => ({
    schema: 1,
    standAt: "2026-10-25T08:00:00Z",
    production: { release: releaseVon(n), commit: sha(n), seit: null },
    stage: { release: releaseVon(5), commit: sha(5), seit: null },
    stageGruen: null,
    stagePruefung: null,
    technik: { migrationen: [], rechte: [], umgebungswerte: [] },
    themen: [],
});

function konfig(teil: Record<string, string> = {}): DiscordKonfig {
    return discordKonfiguration({
        AVESMAPS_ENV: "staging",
        RELEASE_ID: releaseVon(5),
        DISCORD_BERICHT: "senden",
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_BERICHT_KANAL: KANAL,
        ...teil,
    });
}

/** Ein gestelltes Discord: Antworten der Reihe nach, jede Anfrage gezählt. */
function gestellt(sende: SendeErgebnis[], suche: SucheErgebnis[] = [], verzoegerung = 0) {
    const gesendet: DiscordNachricht[] = [];
    const kanaele: string[] = [];
    let gesucht = 0;
    let id = 1_430_000_000_000_000_000n;
    const rest: DiscordRest = {
        async sende(kanal, nachricht) {
            gesendet.push(nachricht);
            kanaele.push(kanal);
            if (verzoegerung > 0) await new Promise((r) => setTimeout(r, verzoegerung));
            id += 1n;
            return sende.shift() ?? { art: "ok", messageId: id.toString() };
        },
        async suche() {
            gesucht += 1;
            return suche.shift() ?? { art: "nicht_gefunden" };
        },
    };
    return { rest, gesendet, kanaele, gesucht: () => gesucht };
}

describeWithDatabase("Discord-Zustellung: einmal je Tag und Kanal (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;

    const deps = (rest: DiscordRest, teil: Partial<ZustellDeps> = {}): ZustellDeps => ({
        db: database,
        konfig: konfig(),
        rest,
        jetzt: () => ZEHN_UHR,
        warte: async () => undefined,
        verlauf: VERLAUF,
        freigabe: freigabeMit(5),
        ...teil,
    });
    const zeilen = () =>
        database<
            {
                id: string;
                status: string;
                message_id: string | null;
                versuche: number;
                fehler: string | null;
                nonce: string;
            }[]
        >`
            SELECT id, status, message_id, versuche, fehler, nonce FROM public.discord_zustellung ORDER BY berichtstag, id
        `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
    });

    beforeEach(async () => {
        await database`DELETE FROM public.discord_zustellung`;
        await database`UPDATE public.discord_routine SET aktiv = true, letzter_lauf = NULL, letzter_lauf_at = NULL`;
        await database.unsafe(
            "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
        );
    });

    afterAll(async () => {
        await database`DELETE FROM public.discord_zustellung`.catch(() => undefined);
        await database`UPDATE public.discord_routine SET aktiv = false`.catch(() => undefined);
        await database
            .unsafe(
                "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
            )
            .catch(() => undefined);
        await database?.end({ timeout: 5 });
    });

    it("🔴 sendet einmal; ein zweiter Lauf am selben Tag sendet nicht noch einmal", async () => {
        const discord = gestellt([]);
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("schon_zugestellt");
        expect(discord.gesendet).toHaveLength(1);
        expect(discord.gesendet[0]!.content.startsWith(ersteZeile("2026-10-25"))).toBe(true);
        expect(discord.gesendet[0]!.allowed_mentions).toEqual({ parse: [] });
        const [zeile] = await zeilen();
        expect(zeile).toMatchObject({ status: "zugestellt", versuche: 1 });
        expect(zeile!.message_id).toMatch(/^\d{19}$/u);
        expect(zeile!.nonce).toBe(discord.gesendet[0]!.nonce);
    });

    it("🔴 zwei Läufe zugleich: genau eine Nachricht", async () => {
        const discord = gestellt([], [], 50);
        const ergebnisse = await Promise.all([tagesbericht(deps(discord.rest)), tagesbericht(deps(discord.rest))]);
        expect(discord.gesendet).toHaveLength(1);
        const [a, b] = ergebnisse.map((e) => e.ergebnis).sort();
        // Der zweite sieht die Zeile laufen oder schon fertig, je nachdem, wann er nachsieht; senden darf er nie.
        expect([a, b]).toContain("zugestellt");
        expect(["laeuft_schon", "schon_zugestellt"]).toContain(a === "zugestellt" ? b : a);
    });

    it("🔴 Stage und Routine aus senden nicht, außerhalb des Fensters auch nicht; keiner legt eine Zeile an", async () => {
        const discord = gestellt([]);
        expect(
            (await tagesbericht(deps(discord.rest, { konfig: konfig({ AVESMAPS_ENV: "production" }) }))).ergebnis,
        ).toBe("nicht_stage");
        expect(
            (await tagesbericht(deps(discord.rest, { jetzt: () => new Date("2026-10-25T19:00:00Z") }))).ergebnis,
        ).toBe("ausserhalb_fenster");
        await database`UPDATE public.discord_routine SET aktiv = false`;
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("routine_aus");
        expect(discord.gesendet).toHaveLength(0);
        expect(await zeilen()).toHaveLength(0);
        const [routine] = await database<{ letzter_lauf: string }[]>`SELECT letzter_lauf FROM public.discord_routine`;
        expect(routine!.letzter_lauf).toBe("routine_aus");
    });

    it("🔴 unklarer Ausgang: erst nachsehen; gefunden heißt zugestellt, ohne zweite Anfrage", async () => {
        const discord = gestellt(
            [{ art: "unklar", grund: "Zeitüberschreitung" }],
            [{ art: "gefunden", messageId: "1430000000000009999" }],
        );
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
        expect(discord.gesendet).toHaveLength(1);
        expect((await zeilen())[0]).toMatchObject({ status: "zugestellt", message_id: "1430000000000009999" });
    });

    it("unklar und nicht im Kanal: noch einmal mit DERSELBEN nonce (Discord legt keine zweite an)", async () => {
        const discord = gestellt([{ art: "unklar", grund: "Netzfehler (TypeError)" }], [{ art: "nicht_gefunden" }]);
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
        expect(discord.gesendet).toHaveLength(2);
        expect(discord.gesendet[1]!.nonce).toBe(discord.gesendet[0]!.nonce);
    });

    it("🔴 scheitert das Nachsehen, bleibt es unklar; der nächste Lauf sieht zuerst nach und sendet nicht blind", async () => {
        const erst = gestellt(
            [{ art: "unklar", grund: "Zeitüberschreitung" }],
            [{ art: "fehler", grund: "Zeitüberschreitung" }],
        );
        expect((await tagesbericht(deps(erst.rest))).ergebnis).toBe("unklar");
        expect((await zeilen())[0]).toMatchObject({ status: "unklar" });
        const dann = gestellt([], [{ art: "gefunden", messageId: "1430000000000008888" }]);
        expect((await tagesbericht(deps(dann.rest))).ergebnis).toBe("zugestellt");
        expect(dann.gesendet).toHaveLength(0);
        expect(dann.gesucht()).toBe(1);
    });

    it("liegengebliebenes `sendet` (abgestürzter Lauf) gilt als unklar: nachsehen, dann erst senden", async () => {
        const discord = gestellt([]);
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
        await database`UPDATE public.discord_zustellung SET status = 'sendet', message_id = NULL, versucht_at = now() - interval '10 minutes'`;
        const danach = gestellt([], [{ art: "nicht_gefunden" }]);
        expect((await tagesbericht(deps(danach.rest))).ergebnis).toBe("zugestellt");
        expect(danach.gesucht()).toBe(1);
        expect(danach.gesendet).toHaveLength(1);
    });

    it("Rate-Limit: kurz wird gewartet, lang ist ein Fehlschlag mit Grund", async () => {
        const kurz = gestellt([{ art: "ratelimit", nachSekunden: 1.2, global: false }]);
        expect((await tagesbericht(deps(kurz.rest))).ergebnis).toBe("zugestellt");
        expect(kurz.gesendet).toHaveLength(2);
        await database`DELETE FROM public.discord_zustellung`;
        const lang = gestellt([{ art: "ratelimit", nachSekunden: 600, global: true }]);
        const ergebnis = await tagesbericht(deps(lang.rest));
        expect(ergebnis.ergebnis).toBe("fehlgeschlagen");
        expect((await zeilen())[0]!.fehler).toMatch(/Rate-Limit \(global\)/u);
    });

    it("🔴 Ablehnung (403) ohne Wiederholung; der nächste Lauf desselben Tages versucht es mit demselben Inhalt", async () => {
        const erst = gestellt([{ art: "abgelehnt", status: 403, meldung: "Missing Permissions (50013)" }]);
        expect((await tagesbericht(deps(erst.rest))).ergebnis).toBe("fehlgeschlagen");
        expect(erst.gesendet).toHaveLength(1);
        expect((await zeilen())[0]!.fehler).toBe("Discord lehnt ab: HTTP 403 Missing Permissions (50013)");
        const dann = gestellt([]);
        expect((await tagesbericht(deps(dann.rest))).ergebnis).toBe("zugestellt");
        expect(dann.gesendet[0]!.content).toBe(erst.gesendet[0]!.content);
    });

    it("🔴 kein Rückstau: ein Fehlschlag von gestern bleibt liegen und ist nicht wiederholbar", async () => {
        const gestern = gestellt([{ art: "abgelehnt", status: 403, meldung: "" }]);
        await tagesbericht(deps(gestern.rest, { jetzt: () => new Date("2026-10-24T08:00:00Z") }));
        const heute = gestellt([]);
        expect((await tagesbericht(deps(heute.rest))).ergebnis).toBe("zugestellt");
        expect(heute.gesendet).toHaveLength(1);
        const alle = await zeilen();
        expect(alle.map((z) => z.status)).toEqual(["fehlgeschlagen", "zugestellt"]);
        const alt = await zeileMitId(database, Number(alle[0]!.id));
        expect(wiederholbar(alt!, konfig(), "2026-10-25")).toBe(false);
    });

    it("🔴 rote Prüfung: nichts wird angelegt und nichts gesendet", async () => {
        const discord = gestellt([]);
        // Ein „Schlüssel“, der im Text steht, macht die Prüfung rot.
        const ergebnis = await tagesbericht(
            deps(discord.rest, { konfig: konfig({ DISCORD_BOT_TOKEN: "Tagesbericht" }) }),
        );
        expect(ergebnis.ergebnis).toBe("pruefung_rot");
        expect(discord.gesendet).toHaveLength(0);
        expect(await zeilen()).toHaveLength(0);
    });

    it("🔴 neu heißt neu seit dem letzten zugestellten Bericht", async () => {
        const verlaufAlt: ReleaseVerlauf = { ...VERLAUF, bis: sha(3), commits: VERLAUF.commits.slice(2) };
        const discord = gestellt([]);
        await tagesbericht(
            deps(discord.rest, {
                verlauf: verlaufAlt,
                freigabe: freigabeMit(3),
                jetzt: () => new Date("2026-10-24T08:00:00Z"),
            }),
        );
        await tagesbericht(deps(discord.rest));
        expect(discord.gesendet).toHaveLength(2);
        expect(discord.gesendet[1]!.content).toContain("• Neuerung 5 für alle.");
        expect(discord.gesendet[1]!.content).not.toContain("Neuerung 3");
    });

    it("🔴 das Sendefenster folgt der Uhrzeit aus der Tafel: davor, darin, schon zugestellt, danach, am nächsten Tag ein neuer Bericht", async () => {
        await database`UPDATE public.discord_routine SET uhrzeit = '11:30'`;
        const discord = gestellt([]);
        // Am 25.10.2026 gilt Winterzeit (UTC+1): 09:00 UTC ist 10:00, 10:30 UTC ist 11:30 in Berlin.
        const um = (zeit: string, tag = "2026-10-25") => ({ jetzt: () => new Date(`${tag}T${zeit}:00Z`) });
        // vor dem Fenster: nichts gesendet, nichts angelegt, und der stille Ausgang bleibt aus der Anzeige des letzten Laufs
        expect((await tagesbericht(deps(discord.rest, um("09:00")))).ergebnis).toBe("ausserhalb_fenster");
        expect(discord.gesendet).toHaveLength(0);
        expect(await zeilen()).toHaveLength(0);
        const lauf = () => database<{ letzter_lauf: string | null }[]>`SELECT letzter_lauf FROM public.discord_routine`;
        expect((await lauf())[0]!.letzter_lauf).toBeNull();
        // im Fenster (ab 11:30)
        expect((await tagesbericht(deps(discord.rest, um("10:30")))).ergebnis).toBe("zugestellt");
        // später im Fenster: einmal je Tag und Kanal
        expect((await tagesbericht(deps(discord.rest, um("12:15")))).ergebnis).toBe("schon_zugestellt");
        // nach dem Fenster (15:30 Berlin ist ausschließlich)
        expect((await tagesbericht(deps(discord.rest, um("14:30")))).ergebnis).toBe("ausserhalb_fenster");
        expect(discord.gesendet).toHaveLength(1);
        // Die stillen Läufe überschreiben nicht, was zur Sendezeit geschah.
        expect((await lauf())[0]!.letzter_lauf).toBe("zugestellt");
        // Tageswechsel: Der nächste Tag hat sein eigenes Fenster und seine eigene Zeile.
        expect((await tagesbericht(deps(discord.rest, um("10:30", "2026-10-26")))).ergebnis).toBe("zugestellt");
        expect(discord.gesendet).toHaveLength(2);
        expect((await zeilen()).map((z) => z.status)).toEqual(["zugestellt", "zugestellt"]);
    });

    it("🔴 der Berichtskanal aus der Tafel gilt vor der Umgebung, ohne ihn sendet nichts; ein alter Testkanal und der Modus testkanal führen nirgends hin", async () => {
        const berichtKanal = "1000000000000000077";
        const alterTestKanal = "1000000000000000078";
        const discord = gestellt([]);
        const ohneKanal = konfig({ DISCORD_BERICHT_KANAL: "" });
        expect((await tagesbericht(deps(discord.rest, { konfig: ohneKanal }))).ergebnis).toBe("ohne_kanal");
        await database`UPDATE public.discord_routine SET berichts_kanal = ${berichtKanal}`;
        expect((await tagesbericht(deps(discord.rest, { konfig: ohneKanal }))).ergebnis).toBe("zugestellt");
        expect(discord.kanaele).toEqual([berichtKanal]);
        expect((await zeilen()).length).toBe(1);
        // Ein Wert aus dem Reiter schlägt auch den der Umgebung.
        await database`DELETE FROM public.discord_zustellung`;
        expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
        expect(discord.kanaele.at(-1)).toBe(berichtKanal);
        // Der abgeschaffte Testkanal (Vali 2026-10-26): Die Umgebungsvariable und der alte Modus `testkanal` bewegen nichts (die Spalte `test_kanal` ist mit 0294 gefallen).
        await database`DELETE FROM public.discord_zustellung`;
        {
            const gesendet = discord.kanaele.length;
            const alt = konfig({ DISCORD_BERICHT: "testkanal", DISCORD_TESTKANAL: alterTestKanal });
            expect(alt.modus).toBe("aus");
            expect(alt.modusVeraltet).toBe(true);
            expect((await tagesbericht(deps(discord.rest, { konfig: alt }))).ergebnis).toBe("aus");
            expect(discord.kanaele).toHaveLength(gesendet);
            // Im Modus senden geht es nur in den Berichtskanal.
            expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
            expect(discord.kanaele.at(-1)).toBe(berichtKanal);
            expect(discord.kanaele).not.toContain(alterTestKanal);
            expect(
                (await database<{ kanal: string }[]>`SELECT kanal FROM public.discord_zustellung`).map((z) => z.kanal),
            ).toEqual([berichtKanal]);
        }
    });

    it("🔴 --fenster-ignorieren lässt nur das Sendefenster außer Acht: nur in den Berichtskanal, nur bei eingeschalteter Routine, einmal je Tag", async () => {
        const discord = gestellt([]);
        const frueh = { jetzt: () => new Date("2026-10-25T07:00:00Z") }; // 08:00 Berlin, vor dem Fenster ab 10:00
        expect((await tagesbericht(deps(discord.rest, frueh))).ergebnis).toBe("ausserhalb_fenster");
        expect((await tagesbericht(deps(discord.rest, frueh), { fensterIgnorieren: true })).ergebnis).toBe(
            "zugestellt",
        );
        expect(discord.kanaele).toEqual([KANAL]);
        expect((await tagesbericht(deps(discord.rest, frueh), { fensterIgnorieren: true })).ergebnis).toBe(
            "schon_zugestellt",
        );
        // Ohne eingeschaltete Routine hilft das Flag nicht.
        await database`DELETE FROM public.discord_zustellung`;
        await database`UPDATE public.discord_routine SET aktiv = false`;
        expect((await tagesbericht(deps(discord.rest, frueh), { fensterIgnorieren: true })).ergebnis).toBe(
            "routine_aus",
        );
        expect(discord.kanaele).toEqual([KANAL]);
    });

    it("🔴 der Formulierer schreibt den ganzen Bericht: Prompt aus der Tafel (sonst die Vorgabe), Tageszeit aus der Uhrzeit, geprüfter Text wird gesendet; ohne Formulierer bleibt der Prompt ohne Wirkung", async () => {
        type Eingabe = {
            aufgabe: string;
            prompt: string;
            regeln: string;
            tageszeit: string;
            titel: string;
            schluss: string;
            neuerungen: { id: string; teil: string; neu: string[] }[];
            leer: { neu: string | null; entwicklung: string | null };
        };
        const eingaben: Eingabe[] = [];
        // Ein Dienst, der `bericht` kennt: schreibt aus der Eingabe einen Text im Aufbau der früheren Tagesberichte.
        const formulierer: Ausfuehren = async (_programm, eingabe) => {
            const e = JSON.parse(eingabe) as Eingabe;
            eingaben.push(e);
            if (e.aufgabe !== "bericht") return "";
            const text = [
                e.titel,
                "Guten Morgen, ihr Reisenden.",
                "",
                "✨ **Was ist neu?**",
                ...e.neuerungen.filter((n) => n.teil === "neu").map((n) => `• ${n.neu[0] ?? ""}`),
                "",
                "🔨 **Was ist in Entwicklung?**",
                e.leer.entwicklung ?? "",
                "",
                e.schluss,
            ].join("\n");
            return JSON.stringify({ text, punkte: e.neuerungen.map((n) => n.id) });
        };
        const mitProgramm = konfig({ DISCORD_BERICHT_FORMULIERER: "/opt/formulierer" });
        const heute = async () =>
            (
                await database<{ formulierung: string; text: string }[]>`
                    SELECT formulierung, text FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'
                `
            )[0]!;
        // Gestern: der erste Bericht (ohne Formulierer), damit heute etwas „seit dem letzten Bericht“ neu ist.
        const verlaufAlt: ReleaseVerlauf = { ...VERLAUF, bis: sha(3), commits: VERLAUF.commits.slice(2) };
        await tagesbericht(
            deps(gestellt([]).rest, {
                verlauf: verlaufAlt,
                freigabe: freigabeMit(3),
                jetzt: () => new Date("2026-10-24T08:00:00Z"),
            }),
        );
        expect(eingaben).toHaveLength(0);

        // Heute: der Formulierer bekommt die Vorgabe, die Tageszeit der Uhrzeit (10:00, morgens) und die Punkte; sein Text geht hinaus.
        const discord = gestellt([]);
        await tagesbericht(deps(discord.rest, { konfig: mitProgramm, formulierer }));
        expect(eingaben).toHaveLength(1);
        expect(eingaben[0]).toMatchObject({
            aufgabe: "bericht",
            prompt: DISCORD_PROMPT_VORGABE,
            tageszeit: "morgens",
            titel: ersteZeile("2026-10-25"),
            // §3e: auch der Commit ohne `Neu:`-Zeile, mit seinem Betreff als Hintergrund; das Modell entscheidet, ob es ihn erzählt.
            neuerungen: [
                { id: "n1", teil: "neu", art: "feature", neu: [], betreff: "Betreff 4" },
                { id: "n2", teil: "neu", art: "feature", neu: ["Neuerung 5 für alle."], betreff: "Betreff 5" },
            ],
        });
        expect((await heute()).formulierung).toBe("modell");
        expect(discord.gesendet[0]!.content).toBe((await heute()).text);
        expect(discord.gesendet[0]!.content).toContain("• Neuerung 5 für alle.");
        expect(discord.gesendet[0]!.content.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);

        // Ein eigener Prompt und eine Uhrzeit am Abend: Der Prompt geht an das Programm, die Tageszeit wird „abends“.
        await database`DELETE FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'`;
        await database`UPDATE public.discord_routine SET prompt = 'Trocken und knapp.', uhrzeit = '17:30'`;
        const abends = { jetzt: () => new Date("2026-10-25T16:45:00Z") };
        await tagesbericht(deps(gestellt([]).rest, { konfig: mitProgramm, formulierer, ...abends }));
        const eingabe = eingaben[1]!;
        expect(eingabe.prompt).toBe("Trocken und knapp.");
        expect(eingabe.tageszeit).toBe("abends");
        // Die harten Regeln stehen daneben und gehen dem Prompt vor.
        expect(eingabe.regeln).toContain("Diese Regeln gehen dem Prompt immer vor");
        expect((await heute()).formulierung).toBe("modell");

        // Ohne Formulierer wird das Programm nicht gerufen: Der Bericht kommt aus der festen Vorlage, mit dem Gruß zur Tageszeit.
        await database`DELETE FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'`;
        await tagesbericht(deps(gestellt([]).rest, { formulierer, ...abends }));
        expect(eingaben).toHaveLength(2);
        expect((await heute()).formulierung).toBe("vorlage");
        expect((await heute()).text).toContain(auftaktVon("2026-10-25", "abends"));
    });

    it("🔴 ein Dienst, der `bericht` noch nicht kennt, und ein Text, der die Prüfung nicht besteht: der Bericht kommt trotzdem, aus der Vorlage", async () => {
        const verlaufAlt: ReleaseVerlauf = { ...VERLAUF, bis: sha(3), commits: VERLAUF.commits.slice(2) };
        const gestern = {
            verlauf: verlaufAlt,
            freigabe: freigabeMit(3),
            jetzt: () => new Date("2026-10-24T08:00:00Z"),
        };
        await tagesbericht(deps(gestellt([]).rest, gestern));
        const mitProgramm = konfig({ DISCORD_BERICHT_FORMULIERER: "/opt/formulierer" });
        const heute = async () =>
            (
                await database<{ formulierung: string; text: string }[]>`
                    SELECT formulierung, text FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'
                `
            )[0]!;

        // Der ältere Dienst schreibt auf `bericht` nichts und antwortet nur auf `auftakt`: Vorlage mit seinem Gruß.
        const aufgaben: string[] = [];
        const alt: Ausfuehren = async (_programm, eingabe) => {
            const aufgabe = (JSON.parse(eingabe) as { aufgabe: string }).aufgabe;
            aufgaben.push(aufgabe);
            return aufgabe === "auftakt" ? JSON.stringify({ auftakt: "Rondra zum Gruße aus der Kartenstube." }) : "";
        };
        await tagesbericht(deps(gestellt([]).rest, { konfig: mitProgramm, formulierer: alt }));
        expect(aufgaben).toEqual(["bericht", "auftakt"]);
        expect((await heute()).formulierung).toBe("modell");
        expect((await heute()).text).toContain("Rondra zum Gruße aus der Kartenstube.");
        expect((await heute()).text).toContain("Neuerung 5 für alle.");

        // Ein Text mit erfundener Zahl fällt durch; gesendet wird die Vorlage.
        await database`DELETE FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'`;
        const erfindet: Ausfuehren = async (_programm, eingabe) => {
            const e = JSON.parse(eingabe) as {
                titel: string;
                schluss: string;
                neuerungen: { id: string }[];
            };
            const text = [e.titel, "Hallo.", "", "• Über 4000 Neuerungen.", "", e.schluss].join("\n");
            return JSON.stringify({ text, punkte: e.neuerungen.map((n) => n.id) });
        };
        const discord = gestellt([]);
        expect((await tagesbericht(deps(discord.rest, { konfig: mitProgramm, formulierer: erfindet }))).ergebnis).toBe(
            "zugestellt",
        );
        expect((await heute()).formulierung).toBe("vorlage");
        expect(discord.gesendet[0]!.content).not.toContain("4000");
        expect(discord.gesendet[0]!.content).toContain("Neuerung 5 für alle.");
    });

    it("🔴 der Dank-Abschnitt kommt aus den Zählungen der Datenbank und steht in Vorlage wie Modelltext gleich; ohne Beiträge fehlt er", async () => {
        const verlaufAlt: ReleaseVerlauf = { ...VERLAUF, bis: sha(3), commits: VERLAUF.commits.slice(2) };
        const gestern = {
            verlauf: verlaufAlt,
            freigabe: freigabeMit(3),
            jetzt: () => new Date("2026-10-24T08:00:00Z"),
        };
        await tagesbericht(deps(gestellt([]).rest, gestern));
        const heute = async () =>
            (
                await database<{ formulierung: string; text: string }[]>`
                    SELECT formulierung, text FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'
                `
            )[0]!;
        const dank = "**Dank an unsere fleißigen Editoren und die Community:**";

        // Ohne Beiträge im Fenster: kein Abschnitt, der Gruß steht nach dem Link.
        await tagesbericht(deps(gestellt([]).rest));
        expect((await heute()).text).not.toContain("Dank an unsere");
        expect((await heute()).text.endsWith(`https://avesmaps.de\n\n${DISCORD_SCHLUSS}`)).toBe(true);

        // Drei Handgriffe von drei Personen in der Medienverwaltung seit dem gestrigen Bericht (außerhalb des Fensters zählt nichts).
        const marke = `dank.test_${randomUUID().slice(0, 8)}`;
        const eintrag = async (at: string) => {
            const id = randomUUID();
            await database`
                INSERT INTO public.media_operation
                    (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id, at)
                VALUES (${id}::uuid, ${Buffer.alloc(32)}, ${database.json({ operationId: id, status: "applied" })},
                        ${marke}, 'production', 'person', ${randomUUID()}::uuid, ${at}::timestamptz)
            `;
        };
        try {
            for (const at of ["2026-10-25T05:00:00Z", "2026-10-25T06:00:00Z", "2026-10-25T07:00:00Z"])
                await eintrag(at);
            await eintrag("2026-10-20T05:00:00Z");

            // Die Vorlage (kein Formulierer).
            await database`DELETE FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'`;
            await tagesbericht(deps(gestellt([]).rest));
            const vorlage = await heute();
            expect(vorlage.formulierung).toBe("vorlage");
            expect(
                vorlage.text.endsWith(
                    `${dank}\n• 3 Handgriffe in der Medienverwaltung\nDanke an alle, die mitmachen!\n${DISCORD_SCHLUSS}`,
                ),
            ).toBe(true);
            expect(vorlage.text.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);

            // Der Text des Formulierers: feste Obergrenze ohne Kürzungsdruck, der Abschnitt von der App eingesetzt, nichts doppelt.
            await database`DELETE FROM public.discord_zustellung WHERE berichtstag = '2026-10-25'`;
            let max = 0;
            const formulierer: Ausfuehren = async (_programm, eingabe) => {
                const e = JSON.parse(eingabe) as {
                    max: number;
                    titel: string;
                    schluss: string;
                    neuerungen: { id: string; neu: string[] }[];
                    leer: { entwicklung: string | null };
                };
                max = e.max;
                const text = [
                    e.titel,
                    "Guten Morgen, ihr Reisenden.",
                    "",
                    "✨ **Was ist neu?**",
                    ...e.neuerungen.map((n) => `• ${n.neu[0] ?? ""}`),
                    "",
                    "🔨 **Was ist in Entwicklung?**",
                    e.leer.entwicklung ?? "",
                    "",
                    e.schluss,
                ].join("\n");
                return JSON.stringify({ text, punkte: e.neuerungen.map((n) => n.id) });
            };
            const discord = gestellt([]);
            await tagesbericht(
                deps(discord.rest, {
                    konfig: konfig({ DISCORD_BERICHT_FORMULIERER: "/opt/formulierer" }),
                    formulierer,
                }),
            );
            expect(max).toBe(MODELL_TEXT_MAX);
            const modell = await heute();
            expect(modell.formulierung).toBe("modell");
            expect(
                modell.text.endsWith(
                    `${dank}\n• 3 Handgriffe in der Medienverwaltung\nDanke an alle, die mitmachen!\n${DISCORD_SCHLUSS}`,
                ),
            ).toBe(true);
            expect(modell.text.match(/Dank an unsere/gu)).toHaveLength(1);
            expect(modell.text.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);
            expect(discord.gesendet[0]!.content).toBe(modell.text);
        } finally {
            await database`DELETE FROM public.media_operation WHERE action = ${marke}`;
        }
    });

    it("🔴 die Vorgänge des Kanals für den Bericht: offene Bugs, Ideen und Karteninhalte; Ungesichtete gekürzt und ohne Kennung der Person, Fragen gar nicht", async () => {
        const melde = async (
            kategorie: string,
            titel: string,
            nachricht: string,
        ): Promise<{ op: string; nummer: number }> => {
            const op = randomUUID();
            const [zeile] = await database<{ id: string }[]>`
                SELECT avesmaps_kanal.kanal_discord_melden(${op}::uuid, 'staging', ${kategorie}, ${titel}, ${nachricht}, 'Anna',
                                                            '123456789012345678', '{}'::jsonb)::text AS id
            `;
            return { op, nummer: Number(zeile!.id) };
        };
        const bug = await melde("bug", "Suche zeigt alle Treffer", "Text mit https://beispiel.de und @everyone");
        const frage = await melde("nutzerfrage", "Wie geht das", "Eine Frage");
        try {
            const alle = await sammleVorgaenge(database);
            const meiner = alle.find((v) => v.nummer === bug.nummer);
            expect(meiner).toMatchObject({
                kategorie: "bug",
                status: "zu_sichten",
                gesichtet: false,
                titel: "Suche zeigt alle Treffer",
                befund: null,
            });
            expect(meiner!.text).toContain("Text mit");
            expect(meiner!.text).not.toContain("https://");
            // 🔴 Die Kennung der Person verlässt die Abfrage nie.
            expect(JSON.stringify(alle)).not.toContain("123456789012345678");
            // Fragen erzählt der Bericht nicht.
            expect(alle.some((v) => v.nummer === frage.nummer)).toBe(false);
        } finally {
            await database`DELETE FROM avesmaps_kanal.vorgang WHERE operation_id IN (${bug.op}::uuid, ${frage.op}::uuid)`;
        }
    });

    describe("mehrere Nachrichten (Migration 0298, Vali 2026-11-02)", () => {
        /** Ein Verlauf mit vielen Neuerungen auf der Stage, die noch nicht in Production sind: Der Bericht braucht mehrere Nachrichten. */
        const grosserVerlauf = (anzahl: number): ReleaseVerlauf => ({
            schema: 1,
            bis: sha(5),
            commits: [
                {
                    sha: sha(5),
                    art: "feat",
                    titel: "feat: Betreff 5",
                    neu: ["Neuerung 5 für alle."],
                    achtung: [],
                    anwendung: true,
                },
                ...Array.from({ length: anzahl }, (_, i) => ({
                    sha: sha(1000 + i),
                    art: "feat" as const,
                    titel: `feat: Betreff ${String(1000 + i)}`,
                    neu: [
                        `Neuerung ${String(1000 + i)} verbessert die Karte an einer Stelle, die man beim Reisen bemerkt.`,
                    ],
                    achtung: [],
                    anwendung: true,
                })),
                {
                    sha: sha(3),
                    art: "feat",
                    titel: "feat: Betreff 3",
                    neu: ["Neuerung 3 für alle."],
                    achtung: [],
                    anwendung: true,
                },
            ],
        });
        const GROSS = { verlauf: grosserVerlauf(80), freigabe: freigabeMit(3) };

        type Plan = Record<number, SendeErgebnis | { art: "unklar"; grund: string; angekommen: boolean }>;
        /**
         * Ein Kanal, der sich wie Discord verhält: Was gesendet wird, steht danach dort (`nachrichten`), die Suche findet es an seinem Anfang, und dieselbe `nonce`
         * gibt die vorhandene Nachricht zurück. `plan` lenkt die n-te Anfrage (ab 0): ein Fehlschlag, oder „unklar“ mit angekommener oder verlorener Nachricht.
         */
        function kanalAttrappe(plan: Plan = {}, suchFehler = 0) {
            const nachrichten: { id: string; content: string; nonce: string }[] = [];
            const gesendet: DiscordNachricht[] = [];
            let anfrage = 0;
            let suchen = 0;
            let fehlerOffen = suchFehler;
            let id = 1_430_000_000_000_000_000n;
            const lege = (nachricht: DiscordNachricht): string => {
                const da = nachrichten.find((n) => n.nonce === nachricht.nonce);
                if (da !== undefined) return da.id;
                id += 1n;
                nachrichten.push({ id: id.toString(), content: nachricht.content, nonce: nachricht.nonce });
                return id.toString();
            };
            const rest: DiscordRest = {
                async sende(_kanal, nachricht) {
                    gesendet.push(nachricht);
                    const skript = plan[anfrage];
                    anfrage += 1;
                    if (skript === undefined) return { art: "ok", messageId: lege(nachricht) };
                    if (skript.art === "unklar" && "angekommen" in skript) {
                        if (skript.angekommen) lege(nachricht);
                        return { art: "unklar", grund: skript.grund };
                    }
                    return skript as SendeErgebnis;
                },
                async suche(_kanal, _ab, anfang) {
                    suchen += 1;
                    if (fehlerOffen > 0) {
                        fehlerOffen -= 1;
                        return { art: "fehler", grund: "Zeitüberschreitung" };
                    }
                    const treffer = nachrichten.find((n) => n.content.startsWith(anfang));
                    return treffer === undefined
                        ? { art: "nicht_gefunden" }
                        : { art: "gefunden", messageId: treffer.id };
                },
            };
            return { rest, nachrichten, gesendet, gesucht: () => suchen };
        }
        const tafel = async () =>
            (
                await database<
                    {
                        id: string;
                        status: string;
                        message_id: string | null;
                        versuche: number;
                        fehler: string | null;
                        text: string;
                        nonce: string;
                        teile: { inhalt: DiscordNachricht; messageId: string | null }[] | null;
                    }[]
                >`SELECT id, status, message_id, versuche, fehler, text, nonce, teile FROM public.discord_zustellung`
            )[0]!;
        const gesamtText = (kanal: { nachrichten: { content: string }[] }): string =>
            kanal.nachrichten.map((n) => n.content).join("\n");

        it("🔴 alle Punkte in mehreren Nachrichten, der Reihe nach, jede mit eigener nonce und unter der Grenze; Pause dazwischen; die Zeile gilt erst mit der letzten", async () => {
            const pausen: number[] = [];
            const kanal = kanalAttrappe();
            const ergebnis = await tagesbericht(
                deps(kanal.rest, { ...GROSS, warte: async (ms) => void pausen.push(ms) }),
            );
            expect(ergebnis.ergebnis).toBe("zugestellt");
            const n = kanal.gesendet.length;
            expect(n).toBeGreaterThan(2);
            expect(n).toBeLessThanOrEqual(DISCORD_BERICHT_TEILE_MAX);
            for (const nachricht of kanal.gesendet) {
                expect(nachricht.content.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);
                expect(nachricht.nonce.length).toBeLessThanOrEqual(25);
                expect(nachricht.allowed_mentions).toEqual({ parse: [] });
                expect(nachricht.enforce_nonce).toBe(true);
            }
            expect(new Set(kanal.gesendet.map((g) => g.nonce)).size).toBe(n);
            // Kopf und Gruß vorn, Unterschrift hinten, jeder Punkt genau einmal.
            expect(kanal.gesendet[0]!.content.startsWith(ersteZeile("2026-10-25"))).toBe(true);
            expect(kanal.gesendet.at(-1)!.content.endsWith(DISCORD_SCHLUSS)).toBe(true);
            const alles = gesamtText(kanal);
            for (let i = 0; i < 80; i += 1) {
                expect(alles.match(new RegExp(`• Neuerung ${String(1000 + i)} `, "gu"))).toHaveLength(1);
            }
            expect(alles).not.toMatch(/… und \d+ weitere/u);
            // Eine Pause zwischen je zwei Nachrichten (Ratenlimit), nicht davor und nicht danach.
            expect(pausen.filter((ms) => ms === PAUSE_ZWISCHEN_TEILEN_MS)).toHaveLength(n - 1);
            const zeile = await tafel();
            expect(zeile).toMatchObject({ status: "zugestellt", versuche: n, fehler: null });
            expect(zeile.message_id).toBe(kanal.nachrichten[0]!.id);
            expect(zeile.text).toBe(kanal.gesendet[0]!.content);
            expect(zeile.nonce).toBe(kanal.gesendet[0]!.nonce);
            expect(zeile.teile).toHaveLength(n);
            expect(zeile.teile!.map((t) => t.messageId)).toEqual(kanal.nachrichten.map((m) => m.id));
            expect(zeile.teile!.map((t) => t.inhalt.content)).toEqual(kanal.gesendet.map((g) => g.content));
            // Ein zweiter Lauf am selben Tag sendet nichts mehr.
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("schon_zugestellt");
            expect(kanal.gesendet).toHaveLength(n);
        });

        it("ein Bericht in einer Nachricht bleibt, wie er war: `teile` ist leer (NULL), nonce, Text und ID in den alten Spalten", async () => {
            const discord = gestellt([]);
            expect((await tagesbericht(deps(discord.rest))).ergebnis).toBe("zugestellt");
            const zeile = await tafel();
            expect(zeile.teile).toBeNull();
            expect(zeile.message_id).toMatch(/^\d{19}$/u);
            expect(zeile.text).toBe(discord.gesendet[0]!.content);
        });

        it("🔴 Fehlschlag in der Mitte: die Zeile hält den Fortschritt; der nächste Lauf sendet nur die fehlenden und nie eine Nachricht doppelt", async () => {
            const kanal = kanalAttrappe({
                2: { art: "abgelehnt", status: 403, meldung: "Missing Permissions (50013)" },
            });
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("fehlgeschlagen");
            const halb = await tafel();
            expect(halb.status).toBe("fehlgeschlagen");
            expect(halb.message_id).toBeNull();
            expect(halb.fehler).toMatch(
                /^Nachricht 3 von \d+: Discord lehnt ab: HTTP 403 Missing Permissions \(50013\) \(2 von \d+ zugestellt\)$/u,
            );
            expect(halb.teile!.map((t) => t.messageId !== null).slice(0, 4)).toEqual([true, true, false, false]);
            expect(kanal.nachrichten).toHaveLength(2);
            const n = halb.teile!.length;

            // Der Timer des nächsten Laufs: setzt fort. Gesendet wird ab der dritten; die ersten beiden stehen schon im Kanal und in der Tafel.
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            expect(kanal.nachrichten).toHaveLength(n);
            expect(kanal.gesendet).toHaveLength(3 + (n - 2));
            expect(new Set(kanal.nachrichten.map((m) => m.content)).size).toBe(n);
            const fertig = await tafel();
            expect(fertig).toMatchObject({ status: "zugestellt", fehler: null });
            expect(fertig.message_id).toBe(kanal.nachrichten[0]!.id);
            expect(fertig.teile!.map((t) => t.messageId)).toEqual(kanal.nachrichten.map((m) => m.id));
            // Die Nachrichten sind die des ersten Laufs: Kopf nur vorn, Unterschrift nur hinten.
            expect(
                kanal.nachrichten
                    .slice(1)
                    .map((m) => m.content)
                    .join("\n"),
            ).not.toContain(ersteZeile("2026-10-25"));
            expect(
                kanal.nachrichten
                    .slice(0, -1)
                    .map((m) => m.content)
                    .join("\n"),
            ).not.toContain(DISCORD_SCHLUSS);
        });

        it("🔴 ein Rate-Limit in der Mitte, das zu lang dauert, hält ebenso fest und setzt fort, statt von vorn zu beginnen", async () => {
            const kanal = kanalAttrappe({ 3: { art: "ratelimit", nachSekunden: 600, global: false } });
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("fehlgeschlagen");
            const halb = await tafel();
            expect(halb.fehler).toMatch(
                /^Nachricht 4 von \d+: Rate-Limit: frühestens in 600 s wieder \(3 von \d+ zugestellt\)$/u,
            );
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            expect(new Set(kanal.nachrichten.map((m) => m.content)).size).toBe(kanal.nachrichten.length);
            expect(kanal.nachrichten).toHaveLength(halb.teile!.length);
        });

        it("🔴 unklarer Ausgang in der Mitte: kam die Nachricht an, findet das Nachsehen sie und sie wird nicht noch einmal gesendet", async () => {
            const kanal = kanalAttrappe({ 1: { art: "unklar", grund: "Zeitüberschreitung", angekommen: true } });
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            const zeile = await tafel();
            expect(kanal.gesendet).toHaveLength(zeile.teile!.length);
            expect(kanal.nachrichten).toHaveLength(zeile.teile!.length);
            expect(zeile.teile!.every((t) => t.messageId !== null)).toBe(true);
            expect(zeile.status).toBe("zugestellt");
            expect(kanal.gesucht()).toBeGreaterThan(0);
        });

        it("unklar und nicht angekommen: dieselbe Nachricht noch einmal mit DERSELBEN nonce, danach geht es weiter", async () => {
            const kanal = kanalAttrappe({ 1: { art: "unklar", grund: "Netzfehler (TypeError)", angekommen: false } });
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            expect(kanal.gesendet[2]!.nonce).toBe(kanal.gesendet[1]!.nonce);
            expect(kanal.gesendet[2]!.content).toBe(kanal.gesendet[1]!.content);
            const zeile = await tafel();
            expect(kanal.nachrichten).toHaveLength(zeile.teile!.length);
            expect(new Set(kanal.nachrichten.map((m) => m.content)).size).toBe(zeile.teile!.length);
        });

        it("🔴 der Lauf stirbt nach dem Senden, vor dem Eintragen: das liegengebliebene `sendet` sieht im Kanal nach und sendet nur, was dort fehlt", async () => {
            const kanal = kanalAttrappe();
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            const n = kanal.nachrichten.length;
            // Der Fortschritt ging verloren, und die letzten beiden Nachrichten sind nie angekommen.
            kanal.nachrichten.splice(-2);
            await database`
                UPDATE public.discord_zustellung
                   SET status = 'sendet', message_id = NULL, zugestellt_at = NULL, versucht_at = now() - interval '10 minutes',
                       teile = (SELECT jsonb_agg(jsonb_set(t.v, '{messageId}', 'null'::jsonb) ORDER BY t.o)
                                  FROM jsonb_array_elements(teile) WITH ORDINALITY AS t(v, o))
            `;
            const vorher = kanal.gesendet.length;
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("zugestellt");
            expect(kanal.gesendet.length - vorher).toBe(2);
            expect(kanal.nachrichten).toHaveLength(n);
            expect(new Set(kanal.nachrichten.map((m) => m.content)).size).toBe(n);
            const zeile = await tafel();
            expect(zeile.teile!.map((t) => t.messageId)).toEqual(kanal.nachrichten.map((m) => m.id));
            expect(zeile.message_id).toBe(kanal.nachrichten[0]!.id);
        });

        it("🔴 scheitert das Nachsehen, bleibt die Zeile unklar und es wird nichts gesendet; der Lauf danach setzt fort", async () => {
            const kanal = kanalAttrappe({ 2: { art: "abgelehnt", status: 403, meldung: "" } });
            expect((await tagesbericht(deps(kanal.rest, GROSS))).ergebnis).toBe("fehlgeschlagen");
            const gesendet = kanal.gesendet.length;
            const blind = kanalAttrappe({}, 1);
            // Derselbe Kanal-Zustand, aber die Suche scheitert: nichts darf blind wiederholt werden.
            blind.nachrichten.push(...kanal.nachrichten);
            const unklar = await tagesbericht(deps(blind.rest, GROSS));
            expect(unklar.ergebnis).toBe("unklar");
            expect(unklar.detail).toMatch(/Nachsehen gescheitert: Zeitüberschreitung/u);
            expect(blind.gesendet).toHaveLength(0);
            expect((await tafel()).status).toBe("unklar");
            expect(kanal.gesendet).toHaveLength(gesendet);
            expect((await tagesbericht(deps(blind.rest, GROSS))).ergebnis).toBe("zugestellt");
            expect(new Set(blind.nachrichten.map((m) => m.content)).size).toBe(blind.nachrichten.length);
        });

        it("🔴 der Knopf im Reiter (Wiederholen von Hand) setzt ebenso fort und sendet keine Nachricht doppelt", async () => {
            // Drei Störungen nacheinander erschöpfen die drei Runden des Timers an der dritten Nachricht.
            const halb = kanalAttrappe({
                2: { art: "stoerung", status: 502 },
                3: { art: "stoerung", status: 502 },
                4: { art: "stoerung", status: 502 },
            });
            expect((await tagesbericht(deps(halb.rest, GROSS))).ergebnis).toBe("fehlgeschlagen");
            const zeile = await tafel();
            expect(zeile.fehler).toMatch(/Discord gestört \(HTTP 502\) \(2 von \d+ zugestellt\)$/u);
            const anspruch = await beanspruchVonHand(database, Number(zeile.id), randomUUID());
            expect(anspruch).toBeDefined();
            const ergebnis = await wiederhole(deps(halb.rest, GROSS), anspruch!.zeile, anspruch!.vorher);
            expect(ergebnis.ergebnis).toBe("zugestellt");
            const fertig = await tafel();
            expect(fertig.status).toBe("zugestellt");
            expect(halb.nachrichten).toHaveLength(fertig.teile!.length);
            expect(new Set(halb.nachrichten.map((m) => m.content)).size).toBe(halb.nachrichten.length);
        });

        it("🔴 die Vorschau zeigt alle Nachrichten mit dem Trenner; ein Bericht über der Höchstzahl ist rot und wird nicht gesendet", async () => {
            const kanal = kanalAttrappe();
            const entwurf = await entwirf(deps(kanal.rest, GROSS), "2026-10-25", KANAL, false);
            expect(entwurf.teile.length).toBeGreaterThan(2);
            expect(entwurf.text).toBe(entwurf.teile.join(NACHRICHTEN_TRENNER));
            expect(entwurf.pruefung).toEqual({ ok: true, fehler: [] });
            expect(kanal.gesendet).toHaveLength(0);
            expect(await zeilen()).toHaveLength(0);
            // Mehr als `DISCORD_BERICHT_TEILE_MAX` Nachrichten: rot, nichts angelegt, nichts gesendet.
            const riesig = { verlauf: grosserVerlauf(500), freigabe: freigabeMit(3) };
            const rot = await tagesbericht(deps(kanal.rest, riesig));
            expect(rot.ergebnis).toBe("pruefung_rot");
            expect(rot.detail).toMatch(/zu viele Nachrichten: \d+ von 12/u);
            expect(kanal.gesendet).toHaveLength(0);
            expect(await zeilen()).toHaveLength(0);
        });
    });
});

describeWithDatabase("Discord-Reiter: Routen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let betreiber: { id: string; cookie: string; frisch: string };
    let editor: { cookie: string };
    const apps: FastifyInstance[] = [];
    const anfragen: string[] = [];
    // Alles, was die App protokolliert: Der Schlüssel darf darin nie stehen.
    const protokoll: string[] = [];

    const appMit = async (discord: DiscordKonfig): Promise<FastifyInstance> => {
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: releaseVon(5),
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
            discord,
        };
        const app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: {
                write: (zeile: string) => {
                    protokoll.push(zeile);
                },
            },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        apps.push(app);
        return app;
    };
    // Gestelltes Discord für die Routen: jede Anfrage notiert, nie eine echte.
    const abruf = async (url: string): Promise<Response> => {
        anfragen.push(url);
        if (url.endsWith("/users/@me")) return new Response(JSON.stringify({ id: "42" }), { status: 200 });
        if (url.includes("/messages?")) return new Response("[]", { status: 200 });
        return new Response(JSON.stringify({ id: "1430000000000000777" }), { status: 200 });
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        const op = await fixture.person("operator", { name: "Rondrikan" });
        const alt = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 60 });
        const frisch = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 0 });
        betreiber = { id: op.id, cookie: alt.cookie, frisch: frisch.cookie };
        const ed = await fixture.person("editor", { name: "Editha" });
        editor = { cookie: (await fixture.session(ed.id, { assurance: "strong", passkeyMinutesAgo: 0 })).cookie };
    });

    beforeEach(async () => {
        anfragen.length = 0;
        protokoll.length = 0;
        await database`DELETE FROM public.discord_zustellung`;
        await database`UPDATE public.discord_routine SET aktiv = false, geaendert_von = NULL`;
        await database.unsafe(
            "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
        );
    });

    afterAll(async () => {
        for (const app of apps) await app.close();
        await database`DELETE FROM public.discord_zustellung`.catch(() => undefined);
        await database
            .unsafe(
                "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
            )
            .catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const legeFehlschlagAn = async (tag: string): Promise<number> => {
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO public.discord_zustellung (berichtstag, kanal, kanal_art, status, nonce, inhalt, text, fakten, ausgeloest, versuche, fehler)
            VALUES (${tag}::date, ${KANAL}, 'bericht', 'fehlgeschlagen', 'n1', ${database.json({ content: "x", nonce: "n1" })},
                    ${`${ersteZeile(tag)}\nx`}, '{}'::jsonb, 'zeitplan', 1, 'Discord gestört (HTTP 502)')
            RETURNING id
        `;
        return Number(zeile!.id);
    };

    it("🔴 der Stand braucht den Betrieb, sagt nur OB ein Schlüssel da ist und nennt nie seinen Wert", async () => {
        const app = await appMit({ ...konfig(), abruf });
        const ohne = await app.inject({ method: "GET", url: "/api/admin/system/discord" });
        expect(ohne.statusCode).toBe(401);
        expect(
            (await app.inject({ method: "GET", url: "/api/admin/system/discord", headers: { cookie: editor.cookie } }))
                .statusCode,
        ).toBe(403);
        const antwort = await app.inject({
            method: "GET",
            url: "/api/admin/system/discord",
            headers: { cookie: betreiber.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.body).not.toContain(TOKEN);
        expect(antwort.json()).toMatchObject({
            umgebung: "staging",
            modus: "senden",
            sperre: null,
            schluessel: true,
            modusVeraltet: false,
            kanal: KANAL,
            zeitplan: { uhrzeit: "10:00", zone: "Europe/Berlin" },
            routine: { aktiv: false },
        });
    });

    it("🔴 die Vorschau sendet nichts und speichert nichts", async () => {
        const app = await appMit({ ...konfig(), abruf });
        const antwort = await app.inject({
            method: "GET",
            url: "/api/admin/system/discord/vorschau",
            headers: { cookie: betreiber.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as { text: string; pruefung: { ok: boolean } };
        expect(body.pruefung.ok).toBe(true);
        expect(body.text).toContain("Eure Claudia und Claudio");
        expect(anfragen).toEqual([]);
        expect(await database`SELECT 1 FROM public.discord_zustellung`).toHaveLength(0);
    });

    it("🔴 die Routine schaltet nur mit frischem Passkey und schreibt ein Protokoll", async () => {
        const app = await appMit({ ...konfig(), abruf });
        const schalte = (cookie: string) =>
            app.inject({
                method: "POST",
                url: "/api/admin/system/discord/routine",
                payload: { operationId: randomUUID(), aktiv: true },
                headers: { cookie, origin: TEST_ORIGIN },
            });
        const alt = await schalte(betreiber.cookie);
        expect(alt.statusCode).toBe(403);
        expect((alt.json() as { error: { code: string } }).error.code).toBe("reauth_required");
        expect((await schalte(editor.cookie)).statusCode).toBe(403);
        expect((await schalte(betreiber.frisch)).statusCode).toBe(200);
        const [routine] = await database<
            { aktiv: boolean; geaendert_von: string }[]
        >`SELECT aktiv, geaendert_von FROM public.discord_routine`;
        expect(routine).toMatchObject({ aktiv: true, geaendert_von: betreiber.id });
        const [ereignis] = await database<{ details: Record<string, string> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.discord_routine_changed' ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis!.details).toEqual({ von: "aus", nach: "an" });
    });

    it("🔴 Wiederholen: in Production 409, auf der Stage nur heute und genau einmal je Anfrage", async () => {
        const tag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
        const id = await legeFehlschlagAn(tag);
        const stage = await appMit({ ...konfig({ AVESMAPS_ENV: "production" }), abruf });
        const wiederhole = (app: FastifyInstance, zeile: number, operationId = randomUUID()) =>
            app.inject({
                method: "POST",
                url: `/api/admin/system/discord/zustellungen/${String(zeile)}/wiederholen`,
                payload: { operationId },
                headers: { cookie: betreiber.frisch, origin: TEST_ORIGIN },
            });
        const abgewiesen = await wiederhole(stage, id);
        expect(abgewiesen.statusCode).toBe(409);
        expect((abgewiesen.json() as { error: { code: string } }).error.code).toBe("discord_sendet_nicht");
        expect(anfragen).toEqual([]);

        const prod = await appMit({ ...konfig(), abruf });
        const kennung = randomUUID();
        expect((await wiederhole(prod, id, kennung)).statusCode).toBe(200);
        const [zeile] = await database<{ status: string; message_id: string }[]>`
            SELECT status, message_id FROM public.discord_zustellung WHERE id = ${id}
        `;
        expect(zeile).toEqual({ status: "zugestellt", message_id: "1430000000000000777" });
        const gesendet = anfragen.filter((url) => url.endsWith("/messages")).length;
        // Dieselbe Anfrage noch einmal: Quittung, kein zweiter Versand.
        expect((await wiederhole(prod, id, kennung)).statusCode).toBe(200);
        expect(anfragen.filter((url) => url.endsWith("/messages")).length).toBe(gesendet);
        // Eine zugestellte Zeile und eine von gestern sind nicht wiederholbar.
        expect((await wiederhole(prod, id)).statusCode).toBe(409);
        const gestern = await legeFehlschlagAn("2026-10-01");
        expect((await wiederhole(prod, gestern)).statusCode).toBe(409);
    });

    it("🔴 Wiederholen sieht den Kanal aus dem Reiter, auch wenn die Umgebung keinen trägt", async () => {
        const reiterKanal = "1000000000000000077";
        await database`UPDATE public.discord_routine SET berichts_kanal = ${reiterKanal}`;
        const tag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO public.discord_zustellung (berichtstag, kanal, kanal_art, status, nonce, inhalt, text, fakten, ausgeloest, versuche, fehler)
            VALUES (${tag}::date, ${reiterKanal}, 'bericht', 'fehlgeschlagen', 'n2', ${database.json({ content: "x", nonce: "n2" })},
                    ${`${ersteZeile(tag)}\nx`}, '{}'::jsonb, 'zeitplan', 1, 'Discord gestört (HTTP 502)')
            RETURNING id
        `;
        const prod = await appMit({ ...konfig({ DISCORD_BERICHT_KANAL: "" }), abruf });
        const antwort = await prod.inject({
            method: "POST",
            url: `/api/admin/system/discord/zustellungen/${zeile!.id}/wiederholen`,
            payload: { operationId: randomUUID() },
            headers: { cookie: betreiber.frisch, origin: TEST_ORIGIN },
        });
        expect(antwort.statusCode).toBe(200);
        expect(anfragen.some((url) => url.includes(`/channels/${reiterKanal}/messages`))).toBe(true);
    });
});

describeWithDatabase("Discord-Reiter: Einstellungen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let betreiber: { id: string; cookie: string; frisch: string };
    let editor: { cookie: string };
    const apps: FastifyInstance[] = [];
    const protokoll: string[] = [];
    const antworten: string[] = [];
    const URL_EINSTELLUNGEN = "/api/admin/system/discord/einstellungen";
    const SCHLUESSEL = TOKEN;
    const K1 = "1000000000000000011";
    const K2 = "1000000000000000012";
    const K3 = "1000000000000000013";
    const K4 = "1000000000000000014";

    const appMit = async (
        discord: DiscordKonfig,
        stub: ReturnType<typeof gestellteGilde> | undefined = undefined,
    ): Promise<FastifyInstance> => {
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: releaseVon(5),
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
            discord: stub === undefined ? discord : { ...discord, abruf: stub.abruf },
        };
        const app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: {
                write: (zeile: string) => {
                    protokoll.push(zeile);
                },
            },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        apps.push(app);
        return app;
    };

    const speichere = async (
        app: FastifyInstance,
        cookie: string,
        teil: Record<string, unknown> = {},
        operationId = randomUUID(),
    ) => {
        const antwort = await app.inject({
            method: "POST",
            url: URL_EINSTELLUNGEN,
            payload: { operationId, prompt: null, uhrzeit: "10:00", berichtsKanal: null, ...teil },
            headers: { cookie, origin: TEST_ORIGIN },
        });
        antworten.push(antwort.body);
        return antwort;
    };
    const stand = async (app: FastifyInstance) => {
        const antwort = await app.inject({
            method: "GET",
            url: "/api/admin/system/discord",
            headers: { cookie: betreiber.cookie },
        });
        antworten.push(antwort.body);
        return antwort.json() as {
            formulierer: boolean;
            schluessel: boolean;
            sperre: string | null;
            kanal: string | null;
            modusVeraltet: boolean;
            zeitplan: { uhrzeit: string; fensterVon: string; fensterBis: string };
            einstellungen: {
                prompt: string;
                promptEigen: boolean;
                uhrzeit: string;
                kanalBericht: { eigen: string | null; umgebung: string | null; gilt: string | null; quelle: string };
                geaendertAt: string | null;
                geaendertVon: string | null;
            };
        };
    };
    const zeile = async () =>
        (
            await database<
                { uhrzeit: string; prompt: string | null; berichts_kanal: string | null }[]
            >`SELECT uhrzeit, prompt, berichts_kanal FROM public.discord_routine`
        )[0]!;
    const ereignis = async () =>
        (
            await database<{ details: Record<string, string> }[]>`
                SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.discord_einstellungen_geaendert' ORDER BY id DESC LIMIT 1
            `
        )[0]?.details;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        const op = await fixture.person("operator", { name: "Rondrikan" });
        const alt = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 60 });
        const frisch = await fixture.session(op.id, { assurance: "strong", passkeyMinutesAgo: 0 });
        betreiber = { id: op.id, cookie: alt.cookie, frisch: frisch.cookie };
        const ed = await fixture.person("editor", { name: "Editha" });
        editor = { cookie: (await fixture.session(ed.id, { assurance: "strong", passkeyMinutesAgo: 0 })).cookie };
    });

    beforeEach(async () => {
        protokoll.length = 0;
        antworten.length = 0;
        await database.unsafe(
            "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
        );
    });

    // 🪤 Jede App hält einen Pool mit bis zu zwei Verbindungen; erst am Ende der Datei zu schließen, ließ die letzten Fälle an `max_connections` (50) der gemeinsamen
    // Testdatenbank scheitern (503 `database_unavailable`), sobald andere Läufe daneben Verbindungen hielten.
    afterEach(async () => {
        for (const app of apps.splice(0)) await app.close();
    });

    afterAll(async () => {
        for (const app of apps) await app.close();
        await database
            .unsafe(
                "UPDATE public.discord_routine SET uhrzeit = '10:00', prompt = NULL, berichts_kanal = NULL, einstellungen_at = NULL, einstellungen_von = NULL",
            )
            .catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    /** Kein Schlüssel in einer Antwort und keiner Protokollzeile, auch nicht in Discords Fehlertext. */
    const keinSchluessel = (): void => {
        expect(antworten.filter((text) => text.includes(SCHLUESSEL))).toEqual([]);
        expect(protokoll.filter((text) => text.includes(SCHLUESSEL))).toEqual([]);
    };

    it("🔴 der Stand nennt Vorgaben und Herkunft; ohne gespeicherte Werte gelten Vorgabe-Prompt, 10:00 und der Kanal der Umgebung", async () => {
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }));
        const s = await stand(app);
        expect(s.modusVeraltet).toBe(false);
        expect(s.zeitplan).toMatchObject({ uhrzeit: "10:00", fensterVon: "10:00", fensterBis: "14:00" });
        expect(s.einstellungen).toMatchObject({
            prompt: DISCORD_PROMPT_VORGABE,
            promptEigen: false,
            uhrzeit: "10:00",
            kanalBericht: { eigen: null, umgebung: K1, gilt: K1, quelle: "umgebung" },
            geaendertAt: null,
            geaendertVon: null,
        });
        // „Ohne Formulierer“ sagt der Reiter aus diesem Feld; mit Programm steht es auf wahr.
        expect(s.formulierer).toBe(false);
        expect(
            (await stand(await appMit(konfig({ DISCORD_BERICHT_FORMULIERER: "/opt/formulierer" })))).formulierer,
        ).toBe(true);
        keinSchluessel();
    });

    it("🔴 Speichern braucht manage_news und einen frischen Passkey, schreibt ein Protokoll ohne den Prompt und wirkt im Stand", async () => {
        const stub = gestellteGilde();
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), stub);
        const teil = { prompt: "Knapp und trocken, ohne Witz.", uhrzeit: "11:30", berichtsKanal: K2 };
        const ohne = await app.inject({
            method: "POST",
            url: URL_EINSTELLUNGEN,
            payload: {
                operationId: randomUUID(),
                prompt: null,
                uhrzeit: "10:00",
                berichtsKanal: null,
            },
            headers: { origin: TEST_ORIGIN },
        });
        expect(ohne.statusCode).toBe(401);
        expect((await speichere(app, editor.cookie, teil)).statusCode).toBe(403);
        const alt = await speichere(app, betreiber.cookie, teil);
        expect(alt.statusCode).toBe(403);
        expect((alt.json() as { error: { code: string } }).error.code).toBe("reauth_required");
        expect(await zeile()).toMatchObject({ uhrzeit: "10:00", prompt: null, berichts_kanal: null });

        const operationId = randomUUID();
        const gut = await speichere(app, betreiber.frisch, teil, operationId);
        expect(gut.statusCode).toBe(200);
        expect(await zeile()).toEqual({
            uhrzeit: "11:30",
            prompt: "Knapp und trocken, ohne Witz.",
            berichts_kanal: K2,
        });
        expect(await ereignis()).toEqual({
            felder: "prompt,uhrzeit,berichtskanal",
            uhrzeit: "11:30",
            berichtskanal: K2,
        });
        const s = await stand(app);
        expect(s.zeitplan).toMatchObject({ uhrzeit: "11:30", fensterVon: "11:30", fensterBis: "15:30" });
        expect(s.einstellungen).toMatchObject({
            prompt: "Knapp und trocken, ohne Witz.",
            promptEigen: true,
            kanalBericht: { eigen: K2, umgebung: K1, gilt: K2, quelle: "reiter" },
            geaendertVon: "Rondrikan",
        });
        expect(s.kanal).toBe(K2);
        // Dieselbe Anfrage noch einmal ist eine Wiederholung, keine zweite Handlung.
        const nochmal = await speichere(app, betreiber.frisch, teil, operationId);
        expect((nochmal.json() as { status: string }).status).toBe("replayed");
        // Es wurde gelesen, nie gesendet.
        expect(stub.anfragen.every((a) => a.method === "GET")).toBe(true);
        keinSchluessel();
    });

    it("🔴 null heißt Vorgabe: Prompt, Kanal und die Vorgabe selbst werden zu „nichts gespeichert“, ohne dass ajv daraus einen leeren Text macht", async () => {
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), gestellteGilde());
        await speichere(app, betreiber.frisch, { prompt: "Eigener Ton.", berichtsKanal: K2 });
        expect(await zeile()).toMatchObject({ prompt: "Eigener Ton.", berichts_kanal: K2 });
        const zurueck = await speichere(app, betreiber.frisch, {});
        expect(zurueck.statusCode).toBe(200);
        expect(await zeile()).toEqual({ uhrzeit: "10:00", prompt: null, berichts_kanal: null });
        expect(await ereignis()).toEqual({
            felder: "prompt,berichtskanal",
            berichtskanal: "umgebung",
        });
        // Der Text der Vorgabe oder ein leerer Text wird nicht als eigener Prompt gespeichert.
        await speichere(app, betreiber.frisch, { prompt: `  ${DISCORD_PROMPT_VORGABE}\r\n` });
        expect((await zeile()).prompt).toBeNull();
        await speichere(app, betreiber.frisch, { prompt: "   " });
        expect((await zeile()).prompt).toBeNull();
        keinSchluessel();
    });

    it("🔴 die Anfrage wird geprüft: Uhrzeit, Länge, Steuerzeichen, Kanalkennung, ein eingefügter Schlüssel", async () => {
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), gestellteGilde());
        for (const [name, teil] of [
            ["Uhrzeit 25:00", { uhrzeit: "25:00" }],
            ["Uhrzeit ohne Null", { uhrzeit: "9:30" }],
            ["Uhrzeit mit Sekunden", { uhrzeit: "09:30:00" }],
            ["Prompt zu lang", { prompt: "x".repeat(1501) }],
            ["Steuerzeichen im Prompt", { prompt: "Ton\u0007Klingel" }],
            ["Kanal zu kurz", { berichtsKanal: "123" }],
            ["Kanal mit Buchstaben", { berichtsKanal: "10000000000000000a1" }],
            ["leere Kanalkennung", { berichtsKanal: "" }],
        ] as const) {
            const antwort = await speichere(app, betreiber.frisch, teil);
            expect(antwort.statusCode, name).toBe(400);
        }
        // Der Schlüssel im Prompt würde in die Tafel, in den Reiter und zum Formulierer gelangen.
        const mitSchluessel = await speichere(app, betreiber.frisch, { prompt: `Nimm ${SCHLUESSEL} als Ton` });
        expect(mitSchluessel.statusCode).toBe(400);
        expect((mitSchluessel.json() as { error: { code: string } }).error.code).toBe("discord_prompt_ungueltig");
        // Zeilenumbrüche im Prompt sind erlaubt.
        expect((await speichere(app, betreiber.frisch, { prompt: "Zeile eins.\nZeile zwei." })).statusCode).toBe(200);
        expect((await zeile()).prompt).toBe("Zeile eins.\nZeile zwei.");
        expect((await zeile()).uhrzeit).toBe("10:00");
        keinSchluessel();
    });

    it("🔴 Kanalprüfung beim Speichern: unbekannt, verboten und nicht prüfbar speichern nichts, erlaubt speichert", async () => {
        const fehlertext = `kaputt ${SCHLUESSEL}`;
        const stub = gestellteGilde(
            {},
            {
                [K2]: { status: { kanal: 404 } },
                [K3]: { ueberschreibungen: [{ id: GILDE, type: 0, allow: 0n, deny: SENDEN }] },
            },
            fehlertext,
        );
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), stub);
        const fehler = async (teil: Record<string, unknown>) => {
            const antwort = await speichere(app, betreiber.frisch, {
                uhrzeit: "12:00",
                prompt: "Nur wenn es klappt.",
                ...teil,
            });
            return {
                status: antwort.statusCode,
                fehler: (antwort.json() as { error: { code: string; details?: unknown } }).error,
            };
        };
        const unbekannt = await fehler({ berichtsKanal: K2 });
        expect(unbekannt.status).toBe(409);
        expect(unbekannt.fehler).toMatchObject({
            code: "discord_kanal_unbrauchbar",
            details: { kanal: "bericht", grund: "unbekannt" },
        });
        const verboten = await fehler({ berichtsKanal: K3 });
        expect(verboten.status).toBe(409);
        expect(verboten.fehler).toMatchObject({
            code: "discord_kanal_unbrauchbar",
            details: { kanal: "bericht", grund: "schreiben" },
        });
        // Nichts davon wurde gespeichert, auch Uhrzeit und Prompt nicht: Es zählt der ganze Satz.
        expect(await zeile()).toEqual({ uhrzeit: "10:00", prompt: null, berichts_kanal: null });

        // Discord ist nicht erreichbar oder lehnt den Schlüssel ab: nicht prüfbar, 503, nichts gespeichert.
        const gestoert = await appMit(
            konfig({ DISCORD_BERICHT_KANAL: K1 }),
            gestellteGilde({ status: { kanal: 500 } }, {}, fehlertext),
        );
        const antwort = await speichere(gestoert, betreiber.frisch, { berichtsKanal: K2 });
        expect(antwort.statusCode).toBe(503);
        expect((antwort.json() as { error: { code: string } }).error.code).toBe("discord_kanal_nicht_pruefbar");
        expect(await zeile()).toMatchObject({ berichts_kanal: null });

        // Erlaubt: Der Kanal wird gespeichert.
        const erlaubt = await speichere(app, betreiber.frisch, { berichtsKanal: K4 });
        expect(erlaubt.statusCode).toBe(200);
        expect(await zeile()).toMatchObject({ berichts_kanal: K4 });
        keinSchluessel();
    });

    it("geprüft wird, was sich ändert: Ein Discord-Ausfall hält Prompt und Uhrzeit nicht auf, ein gleicher Kanal wird nicht erneut gefragt", async () => {
        const ausfall = gestellteGilde({ wirft: "netz" });
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), ausfall);
        const ohneKanal = await speichere(app, betreiber.frisch, { prompt: "Ton ändern.", uhrzeit: "09:00" });
        expect(ohneKanal.statusCode).toBe(200);
        expect(ausfall.anfragen).toEqual([]);

        const stub = gestellteGilde();
        const app2 = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1 }), stub);
        expect((await speichere(app2, betreiber.frisch, { berichtsKanal: K2 })).statusCode).toBe(200);
        const nachErstem = stub.anfragen.length;
        expect(nachErstem).toBeGreaterThan(0);
        expect((await speichere(app2, betreiber.frisch, { berichtsKanal: K2, uhrzeit: "13:00" })).statusCode).toBe(200);
        expect(stub.anfragen.length).toBe(nachErstem);
        keinSchluessel();
    });

    it("🔴 der Testkanal ist abgeschafft: Ein mitgeschicktes testKanal (alter Stand der Seite) wird abgestreift, es entsteht keine Spalte dafür, der Stand kennt kein Testkanal-Feld", async () => {
        const app = await appMit(konfig({ DISCORD_BERICHT_KANAL: K1, DISCORD_TESTKANAL: K3 }), gestellteGilde());
        {
            const antwort = await speichere(app, betreiber.frisch, { berichtsKanal: K2, testKanal: K4 });
            expect(antwort.statusCode).toBe(200);
            const [roh] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'discord_routine' AND column_name = 'test_kanal'`;
            expect(roh!.n).toBe(0);
            expect(await zeile()).toMatchObject({ berichts_kanal: K2 });
            expect(await ereignis()).toEqual({ felder: "berichtskanal", berichtskanal: K2 });
            const s = (await stand(app)) as unknown as { einstellungen: Record<string, unknown>; kanal: string | null };
            expect(Object.keys(s.einstellungen)).not.toContain("kanalTest");
            expect(s.kanal).toBe(K2); // Modus senden: der Berichtskanal, nie der alte Testkanal
        }
        keinSchluessel();
    });

    it("🔴 ein noch gesetzter Modus testkanal wirkt wie aus und der Stand sagt es", async () => {
        const app = await appMit(
            konfig({ DISCORD_BERICHT: "testkanal", DISCORD_TESTKANAL: K3, DISCORD_BERICHT_KANAL: K1 }),
            gestellteGilde(),
        );
        const s = await stand(app);
        expect(s.modusVeraltet).toBe(true);
        expect(s.sperre).toBe("aus");
        expect(s.kanal).toBeNull();
        keinSchluessel();
    });

    it("ohne Bot-Schlüssel (Production, lokal) entfällt die Prüfung; gespeichert wird trotzdem, und gesendet wird nie", async () => {
        const stub = gestellteGilde({ status: { kanal: 404 } });
        const stage = discordKonfiguration({ AVESMAPS_ENV: "production", DISCORD_BERICHT_KANAL: K1 });
        expect(stage.botToken).toBeUndefined();
        const app = await appMit(stage, stub);
        const antwort = await speichere(app, betreiber.frisch, { berichtsKanal: K2, uhrzeit: "08:00" });
        expect(antwort.statusCode).toBe(200);
        expect(stub.anfragen).toEqual([]);
        const s = await stand(app);
        expect(s.schluessel).toBe(false);
        expect(s.sperre).toBe("nicht_stage");
        expect(s.einstellungen.kanalBericht.gilt).toBe(K2);
        keinSchluessel();
    });
});
