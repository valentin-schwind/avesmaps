import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZAEHLREGELN, mastodonRegel, zaehleKanal } from "@avesmaps3d/shared";
import {
    PRUEFFAELLE,
    baueProben,
    erwartet,
    runSocialPruefen,
    selbstpruefung,
} from "../src/community/social/pruefen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { stelleInstanz, type GestellteInstanz } from "./support/mastodon-instanz.ts";

/**
 * Das Werkzeug `social:pruefen` (WI-0268 C12a; Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §4 und §5): die Zählregel eines Kanals gegen ein TESTKONTO prüfen und den Kanal erst danach
 * freischalten. Gegen eine gestellte Instanz: es geht NIE ein Beitrag an eine echte Instanz.
 *
 * - Ohne `--anwenden` kein Netz und kein Schreibzugriff; mit `--anwenden` Pflicht: der Zuruf des Betreibers.
 * - Je Prüffall zwei Beiträge (genau an der Grenze: muss angenommen werden; eins darüber: muss abgelehnt werden), `private`, danach gelöscht.
 * - Übereinstimmung schaltet frei; eine Abweichung (zu großzügig oder zu streng) lässt den Kanal gesperrt und sagt in welche Richtung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const SCHLUESSEL = "tok-pruefung-1234567890-abcdef";
const ENV: NodeJS.ProcessEnv = {
    COMMUNITY_SOCIAL_MASTODON_URL: "https://test.mastodon.beispiel.test",
    COMMUNITY_SOCIAL_MASTODON_TOKEN: SCHLUESSEL,
    AVESMAPS_ENV: "test",
};

function lauf(args: string[], environment: NodeJS.ProcessEnv, deps: Parameters<typeof runSocialPruefen>[3] = {}) {
    const ausgabe: string[] = [];
    const fehler: string[] = [];
    return runSocialPruefen(
        args,
        environment,
        { out: (z) => ausgabe.push(z), err: (z) => fehler.push(z) },
        { systemUser: "probe", heute: () => "2026-11-01", ...deps },
    ).then((code) => ({
        code,
        text: [...ausgabe, ...fehler].join("\n"),
        ausgabe: ausgabe.join("\n"),
        fehler: fehler.join("\n"),
    }));
}

/** Eine Instanz, die jeden Aufruf meldet und scheitern lässt: Wer sie bekommt, hat ungewollt das Netz berührt. */
const verboten = (): GestellteInstanz =>
    stelleInstanz({
        fehler: () => {
            throw new Error("Netz berührt");
        },
    });

describe("social:pruefen: die Prüffälle der Recherche", () => {
    it("🔴 die Zählung des Hubs stimmt mit der Recherche §4 überein (Mastodon), auch mit der Länge einer Adresse, die die Instanz nennt", () => {
        for (const s of selbstpruefung(ZAEHLREGELN.mastodon)) expect(s.n, s.fall.name).toBe(s.fall.mastodon);
        expect(PRUEFFAELLE.map((f) => f.mastodon)).toEqual([5, 1, 1, 1, 3, 23, 17, 5, 5]);
        const regel = mastodonRegel({ zeichen: 600, adresse: 25 }, "2026-11-01");
        const adresse = PRUEFFAELLE.find((f) => f.id === "adresse")!;
        expect(erwartet(adresse, regel)).toBe(25);
        expect(selbstpruefung(regel).every((s) => s.ok)).toBe(true);
    });

    it("🔴 jede Probe liegt nach der Zählregel GENAU an der Grenze bzw. eins darüber; keine echte Erwähnung, keine fremde Adresse", () => {
        const regel = mastodonRegel({ zeichen: 500, adresse: 23 }, "2026-11-01");
        const n = (text: string) => zaehleKanal("mastodon", { text, hashtags: [] }, { mastodon: regel }).n;
        for (const probe of baueProben(regel)) {
            expect(n(probe.grenze), probe.fall.name).toBe(500);
            expect(n(probe.darueber), probe.fall.name).toBe(501);
            expect(probe.grenze.startsWith(`${probe.fall.text}\n`)).toBe(true);
        }
        const alle = PRUEFFAELLE.map((f) => f.text).join(" ");
        expect(alle).not.toContain("rollenspiel.social");
        expect(alle).not.toMatch(/https?:\/\/(?!example\.org)/u);
    });
});

describe("social:pruefen: Aufruf", () => {
    it("🔴 der Probelauf rechnet nur: kein Netz, kein Schreibzugriff, keine Datenbank nötig", async () => {
        const instanz = verboten();
        const ergebnis = await lauf(["--kanal", "mastodon"], ENV, { fetch: instanz.fetch });
        expect(ergebnis.code).toBe(0);
        expect(ergebnis.ausgabe).toContain("PROBELAUF");
        expect(ergebnis.ausgabe).toContain("Die Zählung des Hubs stimmt mit der Recherche überein.");
        expect(ergebnis.ausgabe).toContain("Emoji mit Hautton");
        expect(instanz.aufrufe).toEqual([]);
        // Ein Zitat allein macht keinen Lauf daraus.
        const mitZitat = await lauf(["--kanal", "mastodon", "--operator-said", "ja"], ENV, { fetch: instanz.fetch });
        expect(mitZitat.code).toBe(0);
        expect(mitZitat.ausgabe).toContain("gilt nur mit --anwenden");
        expect(instanz.aufrufe).toEqual([]);
    });

    it("🔴 --anwenden ohne Zitat bricht ab, bevor es irgendetwas anfasst", async () => {
        const instanz = verboten();
        for (const args of [
            ["--kanal", "mastodon", "--anwenden"],
            ["--kanal", "mastodon", "--anwenden", "--operator-said", "   "],
        ]) {
            const ergebnis = await lauf(args, ENV, { fetch: instanz.fetch });
            expect(ergebnis.code).toBe(2);
            expect(ergebnis.fehler).toContain("--operator-said");
        }
        expect(instanz.aufrufe).toEqual([]);
    });

    it("ein falscher Aufruf: ohne oder mit anderem Kanal, unbekannte Option", async () => {
        expect((await lauf([], ENV)).code).toBe(2);
        expect((await lauf(["--kanal", "bluesky"], ENV)).code).toBe(2);
        expect((await lauf(["--kanal", "mastodon", "--mehr"], ENV)).code).toBe(2);
    });

    it("ohne Konfiguration des Kanals geht nichts hinaus", async () => {
        const instanz = verboten();
        const ergebnis = await lauf(
            ["--kanal", "mastodon", "--anwenden", "--operator-said", "ja"],
            { AVESMAPS_ENV: "test", DATABASE_URL: "postgres://x" },
            {
                fetch: instanz.fetch,
                database: {} as Database,
            },
        );
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.fehler).toContain("gibt es den Kanal nicht");
        expect(instanz.aufrufe).toEqual([]);
    });
});

describeWithDatabase("social:pruefen: mit Datenbank und gestellter Instanz", { timeout: 120_000 }, () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 3 });
        await migrate(database);
    });

    beforeEach(async () => {
        await database`DELETE FROM avesmaps_community.kanal_stand`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'`;
    });

    afterAll(async () => {
        await database`DELETE FROM avesmaps_community.kanal_stand`.catch(() => undefined);
        await database?.end({ timeout: 5 });
    });

    const stand = async () => {
        const [zeile] = await database<
            {
                freigeschaltet_at: Date | null;
                geprueft_durch: string | null;
                grenzen: { zeichen: number } | null;
                pruefung: unknown;
            }[]
        >`
            SELECT freigeschaltet_at, geprueft_durch, grenzen, pruefung FROM avesmaps_community.kanal_stand WHERE kanal = 'mastodon'
        `;
        return zeile;
    };
    const ANWENDEN = [
        "--kanal",
        "mastodon",
        "--anwenden",
        "--operator-said",
        "Vali 2026-11-01: Prüflauf mit dem Testkonto.",
    ];

    it("🔴 Übereinstimmung: 18 Beiträge (private), die 9 angenommenen werden gelöscht, der Kanal ist freigeschaltet, die Grenzen stehen, das Protokoll hat Zahlen und keinen Text", async () => {
        const instanz = stelleInstanz({ max: 500, adresse: 23 });
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code, ergebnis.text).toBe(0);
        const posts = instanz.aufrufe.filter((a) => a.methode === "POST" && a.pfad === "/api/v1/statuses");
        expect(posts).toHaveLength(18);
        for (const post of posts) expect(JSON.parse(String(post.body))).toMatchObject({ visibility: "private" });
        expect(instanz.aufrufe.filter((a) => a.methode === "DELETE")).toHaveLength(9);
        expect(instanz.beitraege.size).toBe(0);
        expect(ergebnis.ausgabe).toContain("Freigabe (Betreiberzitat): „Vali 2026-11-01: Prüflauf mit dem Testkonto.“");
        expect(ergebnis.ausgabe).toContain("Text zum Einfügen in die Tafel der Recherche");
        expect(ergebnis.ausgabe).toContain("**Prüfung Mastodon 2026-11-01**");
        expect(ergebnis.ausgabe).toContain("| Emoji mit Hautton | 1 | ja | ja | ja |");
        expect(ergebnis.ausgabe).toContain("ist freigeschaltet");
        const s = (await stand())!;
        expect(s.freigeschaltet_at).not.toBeNull();
        expect(s.geprueft_durch).toBe("cli:probe");
        expect(s.grenzen).toMatchObject({ zeichen: 500, adresse: 23 });
        expect(s.pruefung).toEqual({ datum: "2026-11-01", faelle: 9, uebereinstimmend: 9 });
        const [ereignis] = await database<{ details: Record<string, unknown>; actor_label: string }[]>`
            SELECT details, actor_label FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'
        `;
        expect(ereignis!.details).toEqual({
            kanal: "mastodon",
            faelle: 9,
            uebereinstimmend: 9,
            freigeschaltet: true,
            zitat: true,
        });
        expect(ereignis!.actor_label).toBe("cli:probe");
        expect(ergebnis.text).not.toContain(SCHLUESSEL);
        expect(JSON.stringify(ereignis)).not.toContain("Prüflauf");
    });

    it("🔴 Instanz mit anderen Grenzen: Geprüft wird die Regel der Instanz (Grenze 800, Adresse zählt 25)", async () => {
        const instanz = stelleInstanz({ max: 800, adresse: 25 });
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code, ergebnis.text).toBe(0);
        expect(ergebnis.ausgabe).toContain("800 Zeichen, Adresse zählt 25");
        expect((await stand())!.grenzen).toMatchObject({ zeichen: 800, adresse: 25 });
    });

    it("🔴 Abweichung: Zählt die Instanz anders (UTF-16 statt Graphemen), bleibt der Kanal GESPERRT, die Beiträge sind trotzdem gelöscht, und die Ausgabe nennt die Richtung", async () => {
        // Eine Instanz, die nach UTF-16-Einheiten zählt: Emoji zählen mehr, als der Hub meint - der Beitrag „an der Grenze“ wird abgelehnt (der Hub wäre zu großzügig).
        const instanz = stelleInstanz({ zaehle: (text) => text.length });
        // Vorher war der Kanal freigeschaltet: Die neue Prüfung sperrt ihn wieder.
        await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json({ zeichen: 500, adresse: 23, bilder: 4, beschreibung: 1500, bildBytes: 1, bildTypen: [] } as never)}::jsonb)`;
        await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen('mastodon', 'cli:alt', true, '{}'::jsonb)`;
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.ausgabe).toContain("ZU GROSSZÜGIG");
        expect(ergebnis.ausgabe).toContain("NICHT freigeschaltet");
        expect(ergebnis.ausgabe).toContain("bleibt GESPERRT");
        expect(instanz.beitraege.size).toBe(0);
        const s = (await stand())!;
        expect(s.freigeschaltet_at).toBeNull();
        expect(s.geprueft_durch).toBeNull();
        const [ereignis] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'
        `;
        expect(ereignis!.details).toMatchObject({ freigeschaltet: false });
        expect((ereignis!.details["uebereinstimmend"] as number) < 9).toBe(true);
    });

    it("zu streng: Nimmt die Instanz einen Beitrag mit einem Zeichen mehr an, ist der Hub zu streng; auch das schaltet nicht frei", async () => {
        const instanz = stelleInstanz({ zaehle: (text) => Math.max(0, Array.from(text).length - 1) });
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.ausgabe).toContain("zu streng");
        expect((await stand())!.freigeschaltet_at).toBeNull();
        expect(instanz.beitraege.size).toBe(0);
    });

    it("🔴 Fehler mitten in den Proben: aufgeräumt, nichts freigeschaltet, nie der Schlüssel in der Ausgabe", async () => {
        // Ab dem sechsten Aufruf antwortet die Instanz mit 401.
        const instanz = stelleInstanz({
            fehler: (_a, nr) =>
                nr > 6
                    ? new Response(JSON.stringify({ error: `abgelehnt ${SCHLUESSEL}` }), { status: 401 })
                    : undefined,
        });
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.fehler).toContain("Abbruch");
        expect(ergebnis.text).not.toContain(SCHLUESSEL);
        expect(ergebnis.text).not.toContain("beispiel.test");
        expect((await stand())?.freigeschaltet_at ?? null).toBeNull();
        const [n] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.social_kanal_geprueft'`;
        expect(n!.n).toBe(0);
    });

    it("die Instanz antwortet nicht: nichts geschickt, nichts geschrieben", async () => {
        const instanz = stelleInstanz({ fehler: () => "netz" });
        const ergebnis = await lauf(ANWENDEN, ENV, { fetch: instanz.fetch, database });
        expect(ergebnis.code).toBe(1);
        expect(ergebnis.fehler).toContain("Die Grenzen der Instanz sind nicht lesbar");
        expect(instanz.aufrufe).toHaveLength(1);
        expect(await stand()).toBeUndefined();
    });
});
