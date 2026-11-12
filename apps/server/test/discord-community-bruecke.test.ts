import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    COMMUNITY_DISCORD_OFFEN_PFAD,
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
    pruefeSignatur,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { DISCORD_BEFEHLE, NACHRICHT_MAX } from "../src/discord/befehle.ts";
import {
    BRUECKE_URL_VORGABE,
    BRUECKE_ZEIT_MS,
    brueckenKonfiguration,
    communityBruecke,
    type BrueckeKonfig,
} from "../src/discord/community-bruecke.ts";
import { HILFE, SAETZE, hatOption, liesInteraktion, nummerAus, websiteNummerAus } from "../src/discord/interaktion.ts";
import { DISCORD_ANWENDUNG, discordInteraktionenKonfiguration } from "../src/discord/konfig.ts";
import {
    WEBSITE_MAX,
    beschreibung,
    offenAntwort,
    offenSatz,
    offenMitWebsite,
    websiteZurueckziehenSatz,
} from "../src/discord/vorgaenge.ts";
import type { Queryable } from "../src/database.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";
import { DISCORD_TEST_SCHLUESSEL, PERSON, mitglied, signaturKoepfe, snowflake } from "./support/discord-signatur.ts";

/**
 * Die Discord-Seite der Brücke Stage → Production (WI-0268 C8) ohne Datenbank und ohne Netz: der Client mit gestelltem `fetch` (Signatur, Zeitgrenze, Schema,
 * Ausfälle, Brücke aus), die Konfiguration aus der Umgebung, `/offen` mit und ohne Zeilen von der Website und bei Ausfall (an einer gestellten Datenbank),
 * `/erledigt meldung:` durch den Empfänger. `/offen` durch den Empfänger gegen PostgreSQL steht in `discord-interaktionen-kanal.test.ts`.
 */

const SCHLUESSEL = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const URL_PRODUCTION = "https://production.test";

interface Anfrage {
    url: string;
    init: RequestInit;
    kopf: Record<string, string>;
    rumpf: string;
}

/** Ein gestelltes Production: zeichnet jede Anfrage auf und antwortet, wie der Test es will. */
function stelleProduction(antwort: (anfrage: Anfrage) => Response | Promise<Response>) {
    const anfragen: Anfrage[] = [];
    const abruf = async (url: string, init: RequestInit): Promise<Response> => {
        const anfrage: Anfrage = {
            url,
            init,
            kopf: init.headers as Record<string, string>,
            rumpf: String(init.body),
        };
        anfragen.push(anfrage);
        return antwort(anfrage);
    };
    return { abruf, anfragen };
}

const json = (wert: unknown, status = 200): Response => new Response(JSON.stringify(wert), { status });
const ZEILE = { nummer: "COM-000123", stand: "in_bearbeitung", kurztitel: "Fehler · Gareth" } as const;

const konfig = (extra: Partial<BrueckeKonfig> = {}): BrueckeKonfig => ({
    url: URL_PRODUCTION,
    schluessel: SCHLUESSEL,
    ...extra,
});

/** Hängt, bis die Zeitgrenze zuschlägt (wie ein Production, das nicht antwortet). */
const haengt = (_url: string, init: RequestInit): Promise<Response> =>
    new Promise((_, ablehnen) => {
        init.signal?.addEventListener("abort", () => ablehnen(init.signal?.reason));
    });

describe("Brücke: die Konfiguration aus der Umgebung", () => {
    it("ohne Schlüssel oder mit einem zu kurzen ist sie aus; mit Schlüssel gilt die Vorgabe https://avesmaps.de", () => {
        expect(brueckenKonfiguration({})).toBeUndefined();
        expect(brueckenKonfiguration({ COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: "" })).toBeUndefined();
        expect(brueckenKonfiguration({ COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: "   " })).toBeUndefined();
        expect(brueckenKonfiguration({ COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: "kurz" })).toBeUndefined();
        expect(brueckenKonfiguration({ COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: "x".repeat(31) })).toBeUndefined();
        expect(brueckenKonfiguration({ COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: ` ${SCHLUESSEL}\n` })).toEqual({
            url: BRUECKE_URL_VORGABE,
            schluessel: SCHLUESSEL,
        });
        expect(BRUECKE_URL_VORGABE).toBe("https://avesmaps.de");
    });

    it("die Adresse: nur https (lokal auch http), ohne Zugangsdaten, Abfrage und Anker; ein Pfad bleibt, der Schrägstrich am Ende nicht", () => {
        const mit = (adresse: string) =>
            brueckenKonfiguration({
                COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: SCHLUESSEL,
                COMMUNITY_DISCORD_BRUECKE_URL: adresse,
            })?.url;
        expect(mit("https://avesmaps.de/")).toBe("https://avesmaps.de");
        expect(mit("https://avesmaps.de///")).toBe("https://avesmaps.de");
        expect(mit("https://production.test:8443/vor")).toBe("https://production.test:8443/vor");
        expect(mit("http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
        expect(mit("http://localhost:3001/")).toBe("http://localhost:3001");
        for (const schlecht of [
            "http://avesmaps.de",
            "ftp://avesmaps.de",
            "https://nutzer:geheim@avesmaps.de",
            "https://avesmaps.de/?x=1",
            "https://avesmaps.de/#x",
            "avesmaps.de",
            "kein url",
        ])
            expect(mit(schlecht), schlecht).toBeUndefined();
    });

    it("🔴 am Empfänger der Befehle hängt sie nur, wenn der Schlüssel stimmt; ohne bleibt die Konfiguration, wie sie war", () => {
        const stage = {
            DISCORD_PUBLIC_KEY: DISCORD_TEST_SCHLUESSEL,
            AVESMAPS_ENV: "staging",
            RELEASE_ID: "20261031T010000Z-abcdef1",
        };
        expect(discordInteraktionenKonfiguration(stage)).toEqual({
            schluessel: DISCORD_TEST_SCHLUESSEL,
            anwendung: DISCORD_ANWENDUNG,
        });
        expect(Object.keys(discordInteraktionenKonfiguration(stage) ?? {})).not.toContain("bruecke");
        expect(
            discordInteraktionenKonfiguration({ ...stage, COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: SCHLUESSEL })?.bruecke,
        ).toEqual({ url: "https://avesmaps.de", schluessel: SCHLUESSEL });
        // Production nimmt nichts von Discord an, also auch keine Brücke.
        expect(
            discordInteraktionenKonfiguration({
                ...stage,
                AVESMAPS_ENV: "production",
                COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL: SCHLUESSEL,
            }),
        ).toBeUndefined();
    });
});

describe("Brücke: der Client (gestelltes Production)", () => {
    it("🔴 „offen“: POST an den Pfad des Vertrags, signiert über Zeit und Rumpf, ohne Weiterleitung; die Zeilen kommen zurück", async () => {
        const production = stelleProduction(() => json({ zeilen: [ZEILE] }));
        const jetzt = 1_761_900_000_000;
        const bruecke = communityBruecke(konfig({ abruf: production.abruf, jetzt: () => jetzt }));
        expect(bruecke.eingeschaltet).toBe(true);
        const ergebnis = await bruecke.offeneWebsiteMeldungen(PERSON.id);
        expect(ergebnis).toEqual({ art: "ok", zeilen: [ZEILE] });
        const [anfrage] = production.anfragen;
        expect(production.anfragen).toHaveLength(1);
        expect(anfrage!.url).toBe(`${URL_PRODUCTION}${COMMUNITY_DISCORD_OFFEN_PFAD}`);
        expect(anfrage!.init.method).toBe("POST");
        expect(anfrage!.init.redirect).toBe("error");
        expect(anfrage!.rumpf).toBe(JSON.stringify({ discordId: PERSON.id }));
        expect(anfrage!.kopf["content-type"]).toBe("application/json");
        expect(anfrage!.kopf[COMMUNITY_DISCORD_ZEIT_KOPF]).toBe(String(jetzt));
        // Production prüft mit derselben Funktion: Schlüssel, Zeit und der Rumpf, wie er gesendet wurde.
        const urteil = (schluessel: string, rumpf = anfrage!.rumpf) =>
            pruefeSignatur({
                schluessel,
                zeit: anfrage!.kopf[COMMUNITY_DISCORD_ZEIT_KOPF],
                signatur: anfrage!.kopf[COMMUNITY_DISCORD_SIGNATUR_KOPF],
                rumpf,
                jetzt,
            });
        expect(await urteil(SCHLUESSEL)).toBe("gueltig");
        expect(await urteil("f".repeat(64))).toBe("ungueltig");
        expect(await urteil(SCHLUESSEL, anfrage!.rumpf.replace(PERSON.id, "1100000000000000002"))).toBe("ungueltig");
        // 🔴 Der Schlüssel selbst geht nie über die Leitung.
        expect(JSON.stringify(anfrage!.kopf)).not.toContain(SCHLUESSEL);
        expect(anfrage!.rumpf).not.toContain(SCHLUESSEL);
    });

    it("„zurückziehen“: Pfad, Rumpf mit Kennung und Nummer, alle drei Ergebnisse", async () => {
        for (const ergebnis of ["zurueckgezogen", "nicht_gefunden", "schon_abgeschlossen"] as const) {
            const production = stelleProduction(() => json({ ergebnis }));
            const bruecke = communityBruecke(konfig({ abruf: production.abruf }));
            expect(await bruecke.websiteMeldungZurueckziehen(PERSON.id, "COM-000123")).toEqual({ art: "ok", ergebnis });
            expect(production.anfragen[0]!.url).toBe(`${URL_PRODUCTION}${COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD}`);
            expect(production.anfragen[0]!.rumpf).toBe(JSON.stringify({ discordId: PERSON.id, nummer: "COM-000123" }));
            expect(
                await pruefeSignatur({
                    schluessel: SCHLUESSEL,
                    zeit: production.anfragen[0]!.kopf[COMMUNITY_DISCORD_ZEIT_KOPF],
                    signatur: production.anfragen[0]!.kopf[COMMUNITY_DISCORD_SIGNATUR_KOPF],
                    rumpf: production.anfragen[0]!.rumpf,
                }),
            ).toBe("gueltig");
        }
    });

    it("🔴 die Zeitgrenze ist 1,5 s und gilt für Verbindung und Antwort; wer nicht antwortet, ist ein Ausfall, keine Ausnahme", async () => {
        expect(BRUECKE_ZEIT_MS).toBe(1500);
        const zeit = vi.spyOn(AbortSignal, "timeout");
        try {
            const vorgabe = communityBruecke(konfig({ abruf: stelleProduction(() => json({ zeilen: [] })).abruf }));
            await vorgabe.offeneWebsiteMeldungen(PERSON.id);
            expect(zeit).toHaveBeenCalledWith(1500);
        } finally {
            zeit.mockRestore();
        }
        const bruecke = communityBruecke(konfig({ abruf: haengt, zeitMs: 40 }));
        const start = Date.now();
        expect(await bruecke.offeneWebsiteMeldungen(PERSON.id)).toEqual({ art: "ausfall", grund: "zeit" });
        expect(await bruecke.websiteMeldungZurueckziehen(PERSON.id, "COM-000123")).toEqual({
            art: "ausfall",
            grund: "zeit",
        });
        expect(Date.now() - start).toBeLessThan(1000);
        // Auch die Antwort selbst hat die Grenze: Kopf da, Rumpf bleibt aus.
        const langsamerRumpf = communityBruecke(
            konfig({
                zeitMs: 40,
                abruf: async (_url, init) =>
                    new Response(
                        new ReadableStream({
                            start(strom) {
                                init.signal?.addEventListener("abort", () => strom.error(init.signal?.reason));
                            },
                        }),
                        { status: 200 },
                    ),
            }),
        );
        expect(await langsamerRumpf.offeneWebsiteMeldungen(PERSON.id)).toEqual({ art: "ausfall", grund: "zeit" });
    });

    it("🔴 jede Abweichung vom Vertrag ist ein Ausfall: Status außer 200, kaputtes JSON, fremde Form, zusätzliche Felder, Netzfehler", async () => {
        const faelle: Record<string, [Response | (() => never), string]> = {
            "500": [json({ zeilen: [] }, 500), "status"],
            "503": [new Response("Wartung", { status: 503 }), "status"],
            "404": [json({ zeilen: [] }, 404), "status"],
            "401": [json({ zeilen: [] }, 401), "status"],
            "204": [new Response(null, { status: 204 }), "status"],
            "302": [new Response(null, { status: 302, headers: { location: "https://boese.test" } }), "status"],
            keinJson: [new Response("<html>", { status: 200 }), "antwort"],
            leer: [new Response("", { status: 200 }), "antwort"],
            falscheForm: [json({ treffer: [] }), "antwort"],
            keinFeld: [json({}), "antwort"],
            fremderStand: [json({ zeilen: [{ ...ZEILE, stand: "abgenommen" }] }), "antwort"],
            // 🔴 Ein Feld mehr (etwa der Meldetext) macht die ganze Antwort ungültig; nichts davon erreicht Discord.
            mitMeldetext: [json({ zeilen: [{ ...ZEILE, text: "Geheimer Meldetext" }] }), "antwort"],
            mitName: [json({ zeilen: [ZEILE], melder: "Rondrikan" }), "antwort"],
            fremdeNummer: [json({ zeilen: [{ ...ZEILE, nummer: "OPS-000001" }] }), "antwort"],
            zuViele: [json({ zeilen: Array.from({ length: 21 }, () => ZEILE) }), "antwort"],
            zuGross: [new Response(`{"zeilen":[],"x":"${"x".repeat(70_000)}"}`, { status: 200 }), "antwort"],
            netz: [
                () => {
                    throw new TypeError(`fetch failed ${SCHLUESSEL} ${PERSON.id}`);
                },
                "netz",
            ],
        };
        for (const [name, [antwort, grund]] of Object.entries(faelle)) {
            const bruecke = communityBruecke(
                konfig({ abruf: async () => (typeof antwort === "function" ? antwort() : antwort.clone()) }),
            );
            const ergebnis = await bruecke.offeneWebsiteMeldungen(PERSON.id);
            expect(ergebnis, name).toEqual({ art: "ausfall", grund });
            // 🔴 Der Ausfall trägt weder Schlüssel noch Kennung noch Antwort.
            expect(JSON.stringify(ergebnis), name).not.toMatch(new RegExp(`${SCHLUESSEL}|${PERSON.id}|Geheim`, "u"));
        }
        // Auch „zurückziehen“ prüft streng.
        const strengZurueck = communityBruecke(konfig({ abruf: async () => json({ ergebnis: "erledigt" }) }));
        expect(await strengZurueck.websiteMeldungZurueckziehen(PERSON.id, "COM-000123")).toEqual({
            art: "ausfall",
            grund: "antwort",
        });
        const mitGrund = communityBruecke(
            konfig({ abruf: async () => json({ ergebnis: "nicht_gefunden", grund: "x" }) }),
        );
        expect(await mitGrund.websiteMeldungZurueckziehen(PERSON.id, "COM-000123")).toEqual({
            art: "ausfall",
            grund: "antwort",
        });
    });

    it("eine unzulässige Anfrage (Kennung oder Nummer nicht in Form) geht nie hinaus", async () => {
        const production = stelleProduction(() => json({ zeilen: [] }));
        const bruecke = communityBruecke(konfig({ abruf: production.abruf }));
        expect(await bruecke.offeneWebsiteMeldungen("12")).toEqual({ art: "ausfall", grund: "anfrage" });
        expect(await bruecke.offeneWebsiteMeldungen('1100000000000000001"}')).toEqual({
            art: "ausfall",
            grund: "anfrage",
        });
        expect(await bruecke.websiteMeldungZurueckziehen(PERSON.id, "OPS-000123")).toEqual({
            art: "ausfall",
            grund: "anfrage",
        });
        expect(await bruecke.websiteMeldungZurueckziehen(PERSON.id, "123")).toEqual({
            art: "ausfall",
            grund: "anfrage",
        });
        expect(production.anfragen).toHaveLength(0);
    });

    it("ohne Konfiguration oder mit zu kurzem Schlüssel ist die Brücke aus: Wert „aus“, kein Aufruf", async () => {
        const production = stelleProduction(() => json({ zeilen: [ZEILE] }));
        for (const aus of [
            communityBruecke(undefined),
            communityBruecke(konfig({ schluessel: "kurz", abruf: production.abruf })),
        ]) {
            expect(aus.eingeschaltet).toBe(false);
            expect(await aus.offeneWebsiteMeldungen(PERSON.id)).toEqual({ art: "aus" });
            expect(await aus.websiteMeldungZurueckziehen(PERSON.id, "COM-000123")).toEqual({ art: "aus" });
        }
        expect(production.anfragen).toHaveLength(0);
    });
});

describe("Brücke: /offen und /erledigt als Sätze", () => {
    /** Eine gestellte Datenbank: gleich, was gefragt wird, kommen diese Zeilen. */
    const datenbank = (zeilen: unknown[]): Queryable => (() => Promise.resolve(zeilen)) as unknown as Queryable;
    const FALL = { id: "12", kategorie: "bug", status: "neu", titel: "Weg fehlt", kurztitel: null };
    const DISCORD_SATZ =
        "**Offene Meldungen aus Discord**\nFehler · Weg fehlt (`12`)\n`/erledigt nummer:123` schließt eine eigene Meldung.";

    it("🔴 /offen ohne Zeilen von der Website oder bei ausgeschalteter Brücke bleibt, wie es vor C8 war", () => {
        expect(offenMitWebsite(DISCORD_SATZ, { art: "aus" })).toBe(DISCORD_SATZ);
        expect(offenMitWebsite(DISCORD_SATZ, { art: "ok", zeilen: [] })).toBe(DISCORD_SATZ);
        expect(offenMitWebsite(SAETZE.offenLeer, { art: "ok", zeilen: [] })).toBe(SAETZE.offenLeer);
    });

    it("/offen mit Zeilen: darunter „Deine Meldungen bei der Redaktion:“ (Website und weitergeleitet, WI-0297) mit Nummer, Stand in Alltagssprache und Kurztitel, am Ende der Hinweis", () => {
        const satz = offenMitWebsite(DISCORD_SATZ, {
            art: "ok",
            zeilen: [
                { nummer: "COM-000123", stand: "eingegangen", kurztitel: "Fehler · Gareth" },
                { nummer: "COM-000124", stand: "in_bearbeitung", kurztitel: "Idee · Flüsse" },
                { nummer: "COM-000125", stand: "rueckfrage", kurztitel: "" },
            ],
        });
        expect(satz).toBe(
            [
                DISCORD_SATZ,
                "",
                "**Deine Meldungen bei der Redaktion:**",
                "Eingegangen · Fehler · Gareth (`COM-000123`)",
                "In Bearbeitung · Idee · Flüsse (`COM-000124`)",
                "Rückfrage der Redaktion (`COM-000125`)",
                "`/erledigt meldung:<Nummer>` zieht eine davon zurück.",
            ].join("\n"),
        );
        // Auch ohne Fälle aus Discord steht der Satz „keine offen“ oben und die Website darunter.
        expect(offenMitWebsite(SAETZE.offenLeer, { art: "ok", zeilen: [ZEILE] })).toContain(
            `${SAETZE.offenLeer}\n\n${SAETZE.websiteKopf}\nIn Bearbeitung · Fehler · Gareth (\`COM-000123\`)`,
        );
    });

    it("🔴 der Kurztitel kommt von Menschen: Markdown, Verweise und Erwähnungen werden entschärft oder fallen weg", () => {
        const mit = (kurztitel: string) =>
            offenMitWebsite(DISCORD_SATZ, { art: "ok", zeilen: [{ ...ZEILE, kurztitel }] });
        expect(mit("Fehler **Gareth** `x` ||y||")).toContain("In Bearbeitung · Fehler Gareth x y (`COM-000123`)\n");
        // Ein Verweis mit Schema wird herausgenommen, ein Verweis ohne Schema nimmt den ganzen Titel mit.
        expect(mit("Fehler https://boese.example/x")).toContain("In Bearbeitung · Fehler (`COM-000123`)\n");
        expect(mit("Fehler · www.boese.de")).toContain("In Bearbeitung (`COM-000123`)\n");
        for (const boese of ["Fehler https://boese.example/x", "Fehler · www.boese.de", "Hallo @everyone und @here"])
            expect(mit(boese), boese).not.toMatch(/boese|@everyone|@here/u);
        // Erwähnungen von Personen, Rollen und Kanälen werden zu Wörtern; ihre Kennungen bleiben draußen.
        const erwaehnung = mit("Ping <@123456789012345678> <@&22222222222222222> <#33333333333333333>");
        expect(erwaehnung).not.toMatch(/<@!?\d+>|<@&\d+>|<#\d+>|\d{17}/u);
        expect([...mit("x".repeat(500))].length).toBeLessThan(NACHRICHT_MAX);
        expect(mit("x".repeat(500))).toContain(`${"x".repeat(69)}…`);
    });

    it("🔴 mit Antwort der Redaktion (WI-0297, Option B): als Zitat unter der Zeile, Zeilen bleiben, Erwähnungen entschärft; abgeschlossen heißt „Abgeschlossen“", () => {
        const satz = offenMitWebsite(DISCORD_SATZ, {
            art: "ok",
            zeilen: [
                {
                    nummer: "COM-000126",
                    stand: "abgeschlossen",
                    kurztitel: "Frage",
                    antwort: {
                        text: "Danke! Das kommt bald.\nGruß an @everyone und <@123456789012345678>",
                        at: "2026-11-09T18:00:00.000Z",
                    },
                },
            ],
        });
        expect(satz).toContain(
            [
                "Abgeschlossen · Frage (`COM-000126`)",
                "> **Redaktion:** Danke! Das kommt bald.",
                "> Gruß an @​everyone und @Person",
            ].join("\n"),
        );
        expect(satz).not.toMatch(/<@\d+>|@everyone/u);
    });

    it("🔴 lange Antworten: erst werden sie kürzer, dann fallen Zeilen weg; die Nachricht bleibt unter 2000 Zeichen", () => {
        const lang = (n: number) => ({
            nummer: `COM-${String(200 + n).padStart(6, "0")}`,
            stand: "rueckfrage" as const,
            kurztitel: "Frage",
            antwort: { text: `Antwort ${String(n)} ${"wort ".repeat(300)}`, at: "2026-11-09T18:00:00.000Z" },
        });
        const eine = offenMitWebsite(DISCORD_SATZ, { art: "ok", zeilen: [lang(1)] });
        expect(eine.length).toBeLessThanOrEqual(NACHRICHT_MAX);
        expect(eine).toContain("> **Redaktion:** Antwort 1 wort");
        expect(eine).toContain("…");
        const viele = offenMitWebsite(DISCORD_SATZ, { art: "ok", zeilen: [1, 2, 3, 4, 5, 6, 7, 8].map(lang) });
        expect(viele.length).toBeLessThanOrEqual(NACHRICHT_MAX);
        expect(viele).toContain("`COM-000201`");
    });

    it("🔴 fällt die Brücke aus, steht ein Satz unter den Fällen aus Discord", () => {
        expect(offenMitWebsite(DISCORD_SATZ, { art: "ausfall", grund: "zeit" })).toBe(
            `${DISCORD_SATZ}\n\nDie Meldungen bei der Redaktion sind gerade nicht erreichbar.`,
        );
        expect(SAETZE.websiteNichtErreichbar).toBe("Die Meldungen bei der Redaktion sind gerade nicht erreichbar.");
    });

    it("🔴 die Nachricht bleibt unter 2000 Zeichen: erst weniger Zeilen, dann „… und N weitere“", () => {
        const viele = Array.from({ length: 20 }, (_, i) => ({
            nummer: `COM-${String(1000 + i).padStart(6, "0")}`,
            stand: "eingegangen" as const,
            kurztitel: `Idee · ${"Ort ".repeat(40)}`,
        }));
        const satz = offenMitWebsite(DISCORD_SATZ, { art: "ok", zeilen: viele });
        expect(satz.length).toBeLessThanOrEqual(NACHRICHT_MAX);
        expect(satz.match(/`COM-/gu)).toHaveLength(WEBSITE_MAX);
        expect(satz).toContain(`… und ${String(20 - WEBSITE_MAX)} weitere`);
        // Ein langer Satz aus Discord lässt weniger Platz: Es fallen Zeilen weg, nicht der Hinweis.
        const lang = `${DISCORD_SATZ}\n${"y".repeat(NACHRICHT_MAX - DISCORD_SATZ.length - 600)}`;
        const knapp = offenMitWebsite(lang, { art: "ok", zeilen: viele });
        expect(knapp.length).toBeLessThanOrEqual(NACHRICHT_MAX);
        expect(knapp).toContain(SAETZE.websiteHinweis);
        expect(knapp).toContain("weitere");
        expect(knapp.match(/`COM-/gu)?.length ?? 0).toBeLessThan(WEBSITE_MAX);
    });

    it("offenAntwort: die Discord-Fälle aus der Datenbank, die Zeilen von der Brücke; ohne Kennung kein Aufruf", async () => {
        const production = stelleProduction(() => json({ zeilen: [ZEILE] }));
        const bruecke = communityBruecke(konfig({ abruf: production.abruf }));
        const satz = await offenAntwort(datenbank([FALL]), "staging", PERSON.id, bruecke);
        expect(satz).toContain("Fehler · Weg fehlt (`12`)");
        expect(satz).toContain("In Bearbeitung · Fehler · Gareth (`COM-000123`)");
        expect(production.anfragen).toHaveLength(1);
        expect(JSON.parse(production.anfragen[0]!.rumpf)).toEqual({ discordId: PERSON.id });
        // Die Kennung steht in keiner Antwort.
        expect(satz).not.toContain(PERSON.id);

        const keineKennung = await offenAntwort(datenbank([]), "staging", null, bruecke);
        expect(keineKennung).toBe(SAETZE.offenLeer);
        expect(production.anfragen).toHaveLength(1);
    });

    it("offenAntwort bei Ausfall: Satz dazu, die Klasse des Grundes geht an `melde`, sonst nichts", async () => {
        const gemeldet: string[] = [];
        const bruecke = communityBruecke(konfig({ abruf: async () => json({}, 503) }));
        const satz = await offenAntwort(datenbank([]), "staging", PERSON.id, bruecke, (grund) => gemeldet.push(grund));
        expect(satz).toBe(`${SAETZE.offenLeer}\n\n${SAETZE.websiteNichtErreichbar}`);
        expect(gemeldet).toEqual(["status"]);
        // Ausgeschaltet: kein Satz und keine Meldung.
        const aus = await offenAntwort(datenbank([]), "staging", PERSON.id, communityBruecke(undefined), (g) =>
            gemeldet.push(g),
        );
        expect(aus).toBe(SAETZE.offenLeer);
        expect(gemeldet).toEqual(["status"]);
    });

    it("websiteZurueckziehenSatz: ein Satz je Ergebnis; fremd und unbekannt sind derselbe Satz", async () => {
        const mit = async (antwort: Response | undefined, kennung: string | null = PERSON.id) => {
            const production = stelleProduction(() => antwort ?? json({}));
            const bruecke = communityBruecke(antwort === undefined ? undefined : konfig({ abruf: production.abruf }));
            return { satz: await websiteZurueckziehenSatz(bruecke, kennung, "COM-000123"), production };
        };
        expect((await mit(json({ ergebnis: "zurueckgezogen" }))).satz).toBe("COM-000123 ist zurückgezogen.");
        expect((await mit(json({ ergebnis: "schon_abgeschlossen" }))).satz).toBe("COM-000123 ist schon abgeschlossen.");
        const fremd = (await mit(json({ ergebnis: "nicht_gefunden" }))).satz;
        expect(fremd).toBe(SAETZE.websiteNichtGefunden("COM-000123"));
        expect(fremd).toContain("lässt sich hier nicht zurückziehen");
        expect((await mit(json({}, 500))).satz).toBe(SAETZE.websiteZurueckNichtErreichbar);
        expect((await mit(undefined)).satz).toBe(SAETZE.websiteAus);
        // Ohne Discord-Kennung weiß nur Production, dass es keine Meldung gibt: derselbe Satz, kein Aufruf.
        const ohne = await mit(json({ ergebnis: "zurueckgezogen" }), null);
        expect(ohne.satz).toBe(fremd);
        expect(ohne.production.anfragen).toHaveLength(0);
    });
});

describe("Brücke: /erledigt meldung: durch den Empfänger", { timeout: 60_000 }, () => {
    const apps: FastifyInstance[] = [];
    afterAll(async () => {
        await Promise.all(apps.map((instanz) => instanz.close()));
    });

    function baue(bruecke: BrueckeKonfig | undefined, zeilen: string[] = []): FastifyInstance {
        const config: ServerConfig = {
            port: 0,
            host: "127.0.0.1",
            releaseId: "discord-bruecke-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
            discordInteraktionen: {
                schluessel: DISCORD_TEST_SCHLUESSEL,
                anwendung: DISCORD_ANWENDUNG,
                ...(bruecke === undefined ? {} : { bruecke }),
            },
        };
        const instanz = buildApp({ config, logStream: { write: (zeile: string) => zeilen.push(zeile) } });
        apps.push(instanz);
        return instanz;
    }

    // Eine Instanz für die meisten Fälle: Was Production antwortet, stellt jeder Fall selbst ein.
    let antwortet: (anfrage: Anfrage) => Response | Promise<Response> = () => json({});
    const anfragen: Anfrage[] = [];
    const gemeinsam = baue(
        konfig({
            zeitMs: 300,
            abruf: async (url, init) => {
                const anfrage: Anfrage = {
                    url,
                    init,
                    kopf: init.headers as Record<string, string>,
                    rumpf: String(init.body),
                };
                anfragen.push(anfrage);
                return antwortet(anfrage);
            },
        }),
    );
    beforeEach(() => {
        anfragen.length = 0;
        antwortet = () => json({});
    });

    /** `/erledigt` mit den Optionen, wie Discord sie schickt. */
    const erledigtMit = (optionen: Record<string, unknown>, wer: Record<string, unknown> = mitglied()) => ({
        id: snowflake(),
        type: 2,
        application_id: DISCORD_ANWENDUNG,
        token: `token-${snowflake()}`,
        version: 1,
        data: {
            id: snowflake(),
            name: "erledigt",
            type: 1,
            options: Object.entries(optionen).map(([name, value]) => ({
                name,
                type: typeof value === "number" ? 4 : 3,
                value,
            })),
        },
        ...wer,
    });

    async function frage(instanz: FastifyInstance, interaktion: Record<string, unknown>): Promise<string> {
        const rumpf = JSON.stringify(interaktion);
        const antwort = await instanz.inject({
            method: "POST",
            url: "/api/discord/interactions",
            headers: signaturKoepfe(rumpf),
            payload: rumpf,
        });
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json() as {
            type: number;
            data: { content: string; flags: number; allowed_mentions: unknown };
        };
        expect(body.type).toBe(4);
        expect(body.data.flags).toBe(64);
        expect(body.data.allowed_mentions).toEqual({ parse: [] });
        return body.data.content;
    }

    it("🔴 meldung:COM-… zieht über die Brücke zurück, ohne Datenbank der Stage; die Antwort nennt die Nummer, nie die Kennung", async () => {
        antwortet = () => json({ ergebnis: "zurueckgezogen" });
        const satz = await frage(gemeinsam, erledigtMit({ meldung: "COM-000123" }));
        expect(satz).toBe(SAETZE.websiteZurueckgezogen("COM-000123"));
        expect(anfragen).toHaveLength(1);
        const [anfrage] = anfragen;
        expect(anfrage!.url).toBe(`${URL_PRODUCTION}${COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD}`);
        expect(JSON.parse(anfrage!.rumpf)).toEqual({ discordId: PERSON.id, nummer: "COM-000123" });
        expect(
            await pruefeSignatur({
                schluessel: SCHLUESSEL,
                zeit: anfrage!.kopf[COMMUNITY_DISCORD_ZEIT_KOPF],
                signatur: anfrage!.kopf[COMMUNITY_DISCORD_SIGNATUR_KOPF],
                rumpf: anfrage!.rumpf,
            }),
        ).toBe("gueltig");
        expect(satz).not.toContain(PERSON.id);
    });

    it("die Nummer wird großzügig gelesen und in die Form des Vertrags gebracht (com-123, 123, COM-000123)", async () => {
        antwortet = () => json({ ergebnis: "nicht_gefunden" });
        for (const eingabe of ["com-123", "123", "COM-000123", " COM-000123 ", "000123"])
            await frage(gemeinsam, erledigtMit({ meldung: eingabe }));
        expect(anfragen.map((a) => (JSON.parse(a.rumpf) as { nummer: string }).nummer)).toEqual(
            Array.from({ length: 5 }, () => "COM-000123"),
        );
    });

    it("🔴 ein Satz je Ergebnis; „nicht gefunden“ verrät nicht, ob es die Nummer gibt; jeder Ausfall ist derselbe Satz", async () => {
        const mit = async (antwort: (anfrage: Anfrage) => Response | Promise<Response>) => {
            antwortet = antwort;
            return frage(gemeinsam, erledigtMit({ meldung: "COM-000123" }));
        };
        expect(await mit(() => json({ ergebnis: "schon_abgeschlossen" }))).toBe("COM-000123 ist schon abgeschlossen.");
        const nichtGefunden = await mit(() => json({ ergebnis: "nicht_gefunden" }));
        expect(nichtGefunden).toBe(SAETZE.websiteNichtGefunden("COM-000123"));
        // Unbekannt, fremd und längst gelöscht klingen gleich: Production sagt nur „nicht_gefunden“.
        expect(nichtGefunden).not.toMatch(/gibt es nicht|existiert|fremd|gehört/u);
        const ausfall = SAETZE.websiteZurueckNichtErreichbar;
        expect(await mit(() => json({}, 502))).toBe(ausfall);
        expect(await mit(() => new Response("kein json", { status: 200 }))).toBe(ausfall);
        expect(await mit(() => json({ ergebnis: "erledigt" }))).toBe(ausfall);
        expect(
            await mit(() => {
                throw new Error("Netz weg");
            }),
        ).toBe(ausfall);
    });

    it("🔴 antwortet Production nicht, kommt nach der Zeitgrenze der Satz, nicht der Hänger", async () => {
        const haengend = baue(konfig({ abruf: haengt, zeitMs: 40 }));
        await haengend.ready();
        const start = Date.now();
        expect(await frage(haengend, erledigtMit({ meldung: "COM-000123" }))).toBe(
            SAETZE.websiteZurueckNichtErreichbar,
        );
        expect(Date.now() - start).toBeLessThan(1000);
    });

    it("ohne Brücke (kein Schlüssel) sagt der Bot es in einem Satz und ruft nichts auf", async () => {
        expect(await frage(baue(undefined), erledigtMit({ meldung: "COM-000123" }))).toBe(SAETZE.websiteAus);
    });

    it("🔴 genau eine Angabe: beide ergeben einen klaren Satz, eine Nummer ohne Form ebenso; die Brücke wird nicht gefragt", async () => {
        antwortet = () => json({ ergebnis: "zurueckgezogen" });
        expect(await frage(gemeinsam, erledigtMit({ nummer: 5, meldung: "COM-000123" }))).toBe(SAETZE.nurEine);
        for (const schlecht of ["abc", "COM-", "OPS-000123", "0", "COM-0000000000000"])
            expect(await frage(gemeinsam, erledigtMit({ meldung: schlecht })), schlecht).toBe(
                SAETZE.websiteNummerUngueltig,
            );
        expect(anfragen).toHaveLength(0);
        expect(SAETZE.nurEine).toContain("nummer");
        expect(SAETZE.nurEine).toContain("meldung");
    });

    it("mit `nummer` bleibt alles wie bisher (Datenbank der Stage); ohne Datenbank der Satz „gestört“, die Brücke bleibt unberührt", async () => {
        antwortet = () => json({ ergebnis: "zurueckgezogen" });
        expect(await frage(gemeinsam, erledigtMit({ nummer: 123 }))).toBe(SAETZE.gestoert);
        expect(anfragen).toHaveLength(0);
    });

    it("🔴 im Protokoll stehen weder Schlüssel noch Kennung noch Antwort, nur die Klasse eines Ausfalls", async () => {
        const protokoll: string[] = [];
        const production = stelleProduction(() =>
            json({ ergebnis: "geheim-nicht-im-schema", kennung: PERSON.id }, 200),
        );
        const instanz = baue(konfig({ abruf: production.abruf }), protokoll);
        await frage(instanz, erledigtMit({ meldung: "COM-000123" }));
        const text = protokoll.join("");
        expect(text).toContain("Brücke zu Production nicht erreichbar");
        expect(text).toContain('"grund":"antwort"');
        for (const geheim of [SCHLUESSEL, PERSON.id, "geheim-nicht-im-schema", URL_PRODUCTION])
            expect(text, geheim).not.toContain(geheim);
        // Beim Start steht nur, ob die Brücke an ist.
        expect(text).toContain('"bruecke":true');
    });

    it("die Option wird gelesen: hatOption trennt „nicht gegeben“ von „ohne Form“", () => {
        const lies = (optionen: Record<string, unknown>) => liesInteraktion(erledigtMit(optionen))!;
        expect(hatOption(lies({ meldung: "COM-000123" }), "meldung")).toBe(true);
        expect(hatOption(lies({ meldung: "COM-000123" }), "nummer")).toBe(false);
        expect(hatOption(lies({}), "meldung")).toBe(false);
        expect(websiteNummerAus(lies({ meldung: "com-7" }))).toBe("COM-000007");
        expect(websiteNummerAus(lies({ meldung: "abc" }))).toBeUndefined();
        expect(websiteNummerAus(lies({ nummer: 5 }))).toBeUndefined();
        // Eine Zahl als Wert der Zeichenkette-Option gilt nicht (Discord schickt dort Text).
        expect(websiteNummerAus(lies({ meldung: 5 }))).toBeUndefined();
    });
});

describe("Brücke: die Befehle bei Discord", () => {
    it("🔴 es bleiben genau sechs Befehle; /erledigt hat `nummer` (Zahl) und `meldung` (Text), beide wahlfrei, Beschreibungen höchstens 100 Zeichen", () => {
        expect(DISCORD_BEFEHLE.map((b) => b.name)).toEqual(["hilfe", "bug", "idee", "frage", "offen", "erledigt"]);
        const erledigt = DISCORD_BEFEHLE.at(-1);
        expect(erledigt).toMatchObject({
            name: "erledigt",
            options: [
                { type: 4, name: "nummer", required: false, min_value: 1 },
                { type: 3, name: "meldung", required: false },
            ],
        });
        const optionen = (
            erledigt as unknown as { options: { name: string; description: string; max_length?: number }[] }
        ).options;
        expect(optionen.find((o) => o.name === "meldung")?.description).toBe(
            "Eine eigene Website-Meldung, etwa COM-000123",
        );
        expect(optionen.find((o) => o.name === "meldung")?.max_length).toBeLessThanOrEqual(6000);
        for (const befehl of DISCORD_BEFEHLE) {
            expect(befehl.description.length, befehl.name).toBeLessThanOrEqual(100);
        }
        for (const o of optionen) {
            expect(o.description.length, o.name).toBeLessThanOrEqual(100);
            expect(o.name).toMatch(/^[a-z]{1,32}$/u);
        }
    });

    it("/hilfe nennt die neue Option", () => {
        expect(HILFE).toContain("meldung:COM-000123");
        expect(HILFE).toContain("nummer:123");
        expect(HILFE.length).toBeLessThan(NACHRICHT_MAX);
    });
});

describe("Discord: /erledigt nummer: und die Beschreibung in /offen", () => {
    const mit = (wert: unknown) =>
        liesInteraktion({
            id: snowflake(),
            type: 2,
            application_id: DISCORD_ANWENDUNG,
            token: "t",
            version: 1,
            data: { id: snowflake(), name: "erledigt", type: 1, options: [{ name: "nummer", type: 4, value: wert }] },
        })!;

    it("🔴 nummerAus liest nur eine positive ganze Zahl", () => {
        for (const gut of [68]) expect(nummerAus(mit(gut)), String(gut)).toBe(68);
        for (const schlecht of ["68", "OPS-000068", "abc", 0, -3, 1.5, 1e300, null])
            expect(nummerAus(mit(schlecht)), String(schlecht)).toBeUndefined();
    });

    it("beschreibung: höchstens zwei ganze Sätze, am Satzende geschnitten; ohne Satzende gekürzt mit …; Verweise und Kennungen fallen weg", () => {
        expect(beschreibung("Erster Satz. Zweiter Satz! Dritter Satz.", "x")).toBe("Erster Satz. Zweiter Satz!");
        expect(beschreibung("Ein Satz. Und ein halber ohne Ende", "x")).toBe("Ein Satz.");
        const lang = `${"Wort ".repeat(80)}`.trim();
        const gekuerzt = beschreibung(lang, "x");
        expect(gekuerzt.length).toBeLessThanOrEqual(200);
        expect(gekuerzt.endsWith("…")).toBe(true);
        expect(beschreibung("Siehe auf boese.example/x nach. Zweiter Satz.", "x")).toBe("Zweiter Satz.");
        expect(beschreibung("Das ist OPS-000001 intern. Gut so.", "x")).toBe("Gut so.");
        expect(beschreibung("Titel", "Titel")).toBe("");
        expect(beschreibung("**fett** @everyone", "x")).not.toContain("*");
    });

    it("🔴 beschreibung: der Ort (Anhang „Wo: …“) fehlt, und hinter Abkürzungen endet kein Satz", () => {
        expect(beschreibung("Verborgene Orte sollten markiert werden (die verborgen sind).\n\nWo: Gareth", "x")).toBe(
            "Verborgene Orte sollten markiert werden (die verborgen sind).",
        );
        expect(beschreibung("Es gibt Orte, die gesucht werden könnten, z.b. Ruinen. Mehr dazu später.", "x")).toBe(
            "Es gibt Orte, die gesucht werden könnten, z.b. Ruinen. Mehr dazu später.",
        );
        for (const abk of [
            "z.B.",
            "z. B.",
            "d.h.",
            "d. h.",
            "u.a.",
            "o.ä.",
            "bzw.",
            "ca.",
            "evtl.",
            "ggf.",
            "etc.",
            "usw.",
            "Nr.",
            "S.",
            "vgl.",
        ]) {
            expect(beschreibung(`Erster Satz ${abk} geht weiter. Zweiter Satz.`, "x"), abk).toBe(
                `Erster Satz ${abk} geht weiter. Zweiter Satz.`,
            );
        }
        // Endet der Text in einer Abkürzung, ist das kein ganzer Satz: ohne Abkürzung gekürzt.
        const ende = beschreibung("Es gibt Orte, die gesucht werden könnten z.b.", "x");
        expect(ende).toBe("Es gibt Orte, die gesucht werden könnten…");
    });

    it("🔴 /offen: Nummer in Klammern hinter dem Eintrag, Beschreibung darunter, und die Antwort bleibt unter 2000 Zeichen mit „… und N weitere“", async () => {
        const fall = (id: number, status: string) => ({
            id: String(id),
            kategorie: "idee",
            status,
            titel: "Verborgene Orte erst ab Stufe 8",
            kurztitel: null,
            nachricht:
                "Das ist ein langer erster Satz, der einiges erklärt und noch mehr erklärt. Und ein zweiter Satz dazu. Dritter.",
        });
        const einzeln = await offenSatz(
            (() => Promise.resolve([fall(68, "neu"), fall(69, "zu_sichten")])) as unknown as Queryable,
            "staging",
            "k",
        );
        expect(einzeln).toContain(
            "Idee · Verborgene Orte erst ab Stufe 8 (`68`)\n> Das ist ein langer erster Satz, der einiges erklärt und noch mehr erklärt. Und ein zweiter Satz dazu.",
        );
        expect(einzeln).toContain("Idee · eigene, noch nicht gesichtet (`69`)");
        const viele = Array.from({ length: 16 }, (_, i) => fall(100 + i, "neu"));
        let aufrufe = 0;
        const db = (() => Promise.resolve(aufrufe++ === 0 ? viele : [{ anzahl: 40 }])) as unknown as Queryable;
        const lang = await offenSatz(db, "staging", "k");
        expect(lang.length).toBeLessThanOrEqual(1400);
        expect(lang).toMatch(/… und \d+ weitere/u);
        const mitSeite = offenMitWebsite(lang, {
            art: "ok",
            zeilen: Array.from({ length: 8 }, (_, i) => ({
                nummer: `COM-00${String(1000 + i)}`,
                stand: "eingegangen" as const,
                kurztitel: "Lage falsch · Wehrheim",
            })),
        });
        expect(mitSeite.length).toBeLessThanOrEqual(NACHRICHT_MAX);
    });
});
