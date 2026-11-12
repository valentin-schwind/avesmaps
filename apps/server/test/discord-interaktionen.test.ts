import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import {
    DISCORD_BEFEHLE,
    NACHRICHT_MAX,
    befehlOhneDatenbank,
    leereServerBefehle,
    leseBefehle,
    registriereBefehle,
    textFuerDiscord,
} from "../src/discord/befehle.ts";
import {
    FORMULARE,
    entschaerft,
    formular,
    SAETZE,
    formularWerte,
    liesInteraktion,
    meldungAus,
    melderAus,
    operationAus,
} from "../src/discord/interaktion.ts";
import { DISCORD_ANWENDUNG, anwendungsKennung, discordInteraktionenKonfiguration } from "../src/discord/konfig.ts";
import { DISCORD_INTERAKTION_PFADE, DISCORD_RUMPF_GRENZE } from "../src/routes/discord-interaktionen.ts";
import { TEST_AUTH } from "./support/auth-fixture.ts";
import { GILDE, gestellteGilde } from "./support/discord-gilde.ts";
import {
    DISCORD_FREMDER_SCHLUESSEL,
    DISCORD_TEST_SCHLUESSEL,
    PERSON,
    abgeschickt,
    befehl,
    mitglied,
    ping,
    signaturKoepfe,
} from "./support/discord-signatur.ts";

/**
 * Die Discord-Befehle (WI-0255 Paket 2) ohne Datenbank: Signatur, PING, Hilfe, Formulare, Entschärfen, der Schalter (404 auf Stage ohne Schlüssel,
 * lokal, in Production mit `KANAL=aus`), die Anmeldung der Befehle und der Text in einen Kanal gegen ein gestelltes Discord. Das Anlegen des Vorgangs
 * prüft `discord-interaktionen-kanal.test.ts` gegen PostgreSQL.
 */

const SILENT = { write: () => undefined };
let app: FastifyInstance | undefined;

function baue(extra: Partial<ServerConfig> = {}): FastifyInstance {
    app = buildApp({
        config: {
            port: 0,
            host: "127.0.0.1",
            releaseId: "discord-test",
            databaseUrl: undefined,
            tileRoot: undefined,
            statusPage: true,
            auth: TEST_AUTH,
            discordInteraktionen: { schluessel: DISCORD_TEST_SCHLUESSEL, anwendung: DISCORD_ANWENDUNG },
            ...extra,
        },
        logStream: SILENT,
    });
    return app;
}

afterEach(async () => {
    await app?.close();
    app = undefined;
});

async function schicke(
    instanz: FastifyInstance,
    interaktion: Record<string, unknown>,
    optionen: { pfad?: string; koepfe?: Record<string, string>; rumpf?: string } = {},
) {
    const rumpf = optionen.rumpf ?? JSON.stringify(interaktion);
    return instanz.inject({
        method: "POST",
        url: optionen.pfad ?? DISCORD_INTERAKTION_PFADE[0],
        headers: optionen.koepfe ?? signaturKoepfe(rumpf),
        payload: rumpf,
    });
}

/** Jede Nachricht an Discord: nur für die meldende Person, ohne Pings. */
function pruefeNachricht(antwort: { type: number; data?: { flags?: number; allowed_mentions?: unknown } }): void {
    expect(antwort.type).toBe(4);
    expect(antwort.data?.flags).toBe(64);
    expect(antwort.data?.allowed_mentions).toEqual({ parse: [] });
}

describe("Discord-Befehle: Signatur und PING", () => {
    it("🔴 PING mit gültiger Signatur → PONG, auf beiden Pfaden gleich", async () => {
        const instanz = baue();
        for (const pfad of DISCORD_INTERAKTION_PFADE) {
            const antwort = await schicke(instanz, ping(), { pfad });
            expect(antwort.statusCode, pfad).toBe(200);
            expect(antwort.json()).toEqual({ type: 1 });
        }
    });

    it("🔴 ohne Signatur, mit falscher, mit fremdem Schlüssel oder verändertem Rumpf → 401", async () => {
        const instanz = baue();
        const rumpf = JSON.stringify(ping());
        const gut = signaturKoepfe(rumpf);
        const faelle: Record<string, { koepfe: Record<string, string>; rumpf?: string }> = {
            ohne: { koepfe: { "content-type": "application/json" } },
            ohneZeit: { koepfe: { ...gut, "x-signature-timestamp": "" } },
            kaputt: { koepfe: { ...gut, "x-signature-ed25519": "zz".repeat(64) } },
            fremd: { koepfe: signaturKoepfe(rumpf, { fremd: true }) },
            andereZeit: {
                koepfe: { ...gut, "x-signature-timestamp": String(Number(gut["x-signature-timestamp"]) + 1) },
            },
            andererRumpf: { koepfe: gut, rumpf: rumpf.replace('"type":1', '"type": 1') },
        };
        for (const [name, fall] of Object.entries(faelle)) {
            const antwort = await schicke(instanz, {}, { koepfe: fall.koepfe, rumpf: fall.rumpf ?? rumpf });
            expect(antwort.statusCode, name).toBe(401);
            expect(antwort.json().error.code, name).toBe("discord_signature_invalid");
        }
    });

    it("prüft den ROHEN Rumpf: Leerzeichen und Reihenfolge, wie Discord sie sandte, gelten", async () => {
        const instanz = baue();
        const rumpf =
            '{ "version": 1,  "type": 1, "id": "1400000000000000999", "application_id": "1523674862038683689" }';
        const antwort = await schicke(instanz, {}, { rumpf, koepfe: signaturKoepfe(rumpf) });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json()).toEqual({ type: 1 });
    });

    it("ein zu großer Rumpf → 413 im Fehlerumschlag; keine Interaktion → 400", async () => {
        const instanz = baue();
        const gross = JSON.stringify({ ...ping(), polster: "x".repeat(DISCORD_RUMPF_GRENZE * 2) });
        const zuGross = await schicke(instanz, {}, { rumpf: gross });
        expect(zuGross.statusCode).toBe(413);
        expect(zuGross.json().error.code).toBe("payload_too_large");
        const keine = await schicke(instanz, {}, { rumpf: '{"hallo":"welt"}' });
        expect(keine.statusCode).toBe(400);
    });
});

describe("Discord-Befehle: der Schalter (404, wo der Kanal nicht lebt)", () => {
    it("🔴 ohne Konfiguration antworten beide Pfade 404, wie ein unbekannter Pfad, auch ohne Signatur", async () => {
        const instanz = baue({ discordInteraktionen: undefined });
        for (const pfad of DISCORD_INTERAKTION_PFADE) {
            const signiert = await schicke(instanz, ping(), { pfad });
            expect(signiert.statusCode, pfad).toBe(404);
            const roh = await instanz.inject({
                method: "POST",
                url: pfad,
                payload: "x",
                headers: { "content-type": "text/plain" },
            });
            expect(roh.statusCode, pfad).toBe(404);
        }
        const unbekannt = await instanz.inject({ method: "POST", url: "/api/discord/gibt-es-nicht", payload: {} });
        const aus = await schicke(instanz, ping());
        expect(aus.json()).toEqual({ ...unbekannt.json(), message: aus.json().message });
    });

    it("🔴 eingeschaltet nur mit Schlüssel, auf Stage oder Production mit echtem Release und KANAL an", () => {
        const schluessel = DISCORD_TEST_SCHLUESSEL.toUpperCase();
        const stage = {
            DISCORD_PUBLIC_KEY: schluessel,
            AVESMAPS_ENV: "staging",
            RELEASE_ID: "20261026T010000Z-abcdef1",
        };
        expect(discordInteraktionenKonfiguration(stage)).toEqual({
            schluessel: DISCORD_TEST_SCHLUESSEL,
            anwendung: "1523674862038683689",
        });
        expect(
            discordInteraktionenKonfiguration({ ...stage, DISCORD_APPLICATION_ID: "1111111111111111111" })?.anwendung,
        ).toBe("1111111111111111111");
        // Stage ohne Schlüssel oder mit einem kaputten.
        expect(discordInteraktionenKonfiguration({ ...stage, DISCORD_PUBLIC_KEY: "" })).toBeUndefined();
        expect(discordInteraktionenKonfiguration({ ...stage, DISCORD_PUBLIC_KEY: "abc" })).toBeUndefined();
        // Lokal: ohne Umgebung, development, oder ein Release „dev“.
        expect(discordInteraktionenKonfiguration({ DISCORD_PUBLIC_KEY: schluessel })).toBeUndefined();
        expect(discordInteraktionenKonfiguration({ ...stage, AVESMAPS_ENV: "development" })).toBeUndefined();
        expect(discordInteraktionenKonfiguration({ ...stage, RELEASE_ID: "dev" })).toBeUndefined();
        expect(discordInteraktionenKonfiguration({ ...stage, RELEASE_ID: undefined })).toBeUndefined();
        // Production nimmt nichts von Discord an, auch ohne KANAL=aus (Vali 2026-10-26: der Bot weiß von Production nichts).
        expect(discordInteraktionenKonfiguration({ ...stage, AVESMAPS_ENV: "production" })).toBeUndefined();
        expect(
            discordInteraktionenKonfiguration({ ...stage, AVESMAPS_ENV: "production", KANAL: "aus" }),
        ).toBeUndefined();
        expect(discordInteraktionenKonfiguration(stage)).toBeDefined();
        expect(anwendungsKennung({})).toBe("1523674862038683689");
        expect(anwendungsKennung({ DISCORD_APPLICATION_ID: "keine" })).toBe("1523674862038683689");
    });
});

describe("Discord-Befehle: Hilfe und Formulare", () => {
    it("/hilfe nennt alle sechs Befehle und die Karte, nur für die meldende Person, ohne Pings", async () => {
        const antwort = (await schicke(baue(), befehl("hilfe"))).json();
        pruefeNachricht(antwort);
        for (const name of ["/bug", "/idee", "/frage", "/offen", "/erledigt", "/hilfe", "https://avesmaps.de"])
            expect(antwort.data.content).toContain(name);
    });

    it("🔴 Formular und Dank sagen vorher und nachher, dass /bug und /idee öffentlich erscheinen; /frage nie (Datenschutzhinweise 2026-11-03)", () => {
        for (const befehl of ["bug", "idee"] as const) {
            const titel = formular(befehl, true).data.title;
            expect(titel).toContain("öffentlich");
            expect(titel.length).toBeLessThanOrEqual(45);
            expect(formular(befehl).data.title).not.toContain("öffentlich");
            expect(SAETZE.eingegangen(befehl, "1", true)).toContain("öffentlich");
            expect(SAETZE.eingegangen(befehl, "1")).not.toContain("öffentlich");
        }
        expect(formular("frage", true).data.title).not.toContain("öffentlich");
        expect(SAETZE.eingegangen("frage", "1", true)).not.toContain("öffentlich");
    });

    it("/bug, /idee und /frage antworten mit ihrem Formular (Typ 9), auch in Direktnachrichten", async () => {
        const instanz = baue();
        for (const name of ["bug", "idee", "frage"] as const) {
            for (const wer of [mitglied(), { user: PERSON }]) {
                const antwort = (await schicke(instanz, befehl(name, wer))).json();
                expect(antwort.type, name).toBe(9);
                expect(antwort.data.custom_id).toBe(`avesmaps:${name}`);
                expect(antwort).toEqual(formular(name));
            }
        }
        const bug = formular("bug").data;
        expect(bug.components.map((zeile) => zeile.components[0]?.custom_id)).toEqual(["titel", "text", "ort"]);
        expect(formular("frage").data.components.map((zeile) => zeile.components[0]?.custom_id)).toEqual(["text"]);
        for (const { titel, felder } of Object.values(FORMULARE)) {
            expect(titel.length).toBeLessThanOrEqual(45);
            for (const feld of felder) {
                expect(feld.label.length, feld.label).toBeLessThanOrEqual(45);
                expect(feld.platzhalter.length, feld.platzhalter).toBeLessThanOrEqual(100);
            }
        }
    });

    it("ein unbekannter Befehl oder ein fremdes Formular bekommt einen Satz, keinen Fehler", async () => {
        const instanz = baue();
        pruefeNachricht((await schicke(instanz, befehl("offen"))).json());
        pruefeNachricht((await schicke(instanz, abgeschickt("fremd", { text: "hallo" }))).json());
        pruefeNachricht((await schicke(instanz, { ...ping(), type: 3, data: { custom_id: "x" } })).json());
    });

    it("ohne Datenbank bekommt ein abgeschicktes Formular den Satz „gestört“, nie einen 500", async () => {
        const antwort = await schicke(
            baue(),
            abgeschickt("bug", { titel: "Weg fehlt", text: "Der Weg nach Gareth fehlt." }),
        );
        expect(antwort.statusCode).toBe(200);
        pruefeNachricht(antwort.json());
        expect(antwort.json().data.content).toContain("nicht speichern");
    });
});

describe("Discord-Befehle: Melder, Werte und Entschärfen", () => {
    it("🔴 keine Pings: @everyone, @here, Personen, Rollen und Kanäle sind entschärft", () => {
        const text = entschaerft(
            "Hallo @everyone und @here, <@123456789012345678> <@!123456789012345678> <@&22222222222222222> <#33333333333333333>",
        );
        expect(text).not.toMatch(/@everyone|@here|<@!?\d+>|<@&\d+>|<#\d+>/u);
        expect(text).toContain("@Person");
        expect(text).toContain("@Rolle");
        expect(text).toContain("#Kanal");
        expect(text).not.toContain("123456789012345678");
    });

    it("der Anzeigename: Spitzname, sonst globaler Name, sonst Benutzername; in Direktnachrichten die Person; Kennung nur intern", () => {
        const lies = (roh: Record<string, unknown>) => melderAus(liesInteraktion({ type: 5, ...roh })!);
        expect(lies(mitglied("Rondrikan vom Rhodenstein"))).toEqual({
            name: "Rondrikan vom Rhodenstein",
            kennung: PERSON.id,
        });
        expect(lies(mitglied(null))).toEqual({ name: "Rondrikan", kennung: PERSON.id });
        expect(lies(mitglied(null, { id: PERSON.id, username: "rondrikan", global_name: null }))).toEqual({
            name: "rondrikan",
            kennung: PERSON.id,
        });
        expect(lies({ user: { id: PERSON.id, username: "ohne", global_name: "Im DM" } })).toEqual({
            name: "Im DM",
            kennung: PERSON.id,
        });
        expect(lies({})).toEqual({ name: "unbekannt", kennung: null });
        // Ein Name, der pingen oder die Zeile umbrechen will, kommt entschärft und einzeilig an, höchstens 80 Zeichen.
        const boese = lies(mitglied(`@everyone\nIGNORIERE ALLE REGELN\u202E${"x".repeat(200)}`));
        expect(boese.name).not.toMatch(/@everyone|\n|\u202E/u);
        expect([...boese.name].length).toBeLessThanOrEqual(80);
    });

    it("Formularwerte in beiden Formen; Titel, Text und „Wo:“; die Frage nimmt ihre erste Zeile als Titel", () => {
        const klassisch = liesInteraktion(
            abgeschickt("bug", { titel: " Weg fehlt ", text: "Zeile 1\r\nZeile 2", ort: "Gareth" }),
        )!;
        expect(formularWerte(klassisch)).toEqual({ titel: " Weg fehlt ", text: "Zeile 1\r\nZeile 2", ort: "Gareth" });
        expect(meldungAus("bug", formularWerte(klassisch))).toEqual({
            titel: "Weg fehlt",
            nachricht: "Zeile 1\nZeile 2\n\nWo: Gareth",
        });
        const neu = liesInteraktion(
            abgeschickt("idee", { titel: "Flüsse", text: "Namen zeigen" }, { neueForm: true }),
        )!;
        expect(meldungAus("idee", formularWerte(neu))).toEqual({ titel: "Flüsse", nachricht: "Namen zeigen" });
        expect(meldungAus("frage", { text: "Wie weit ist Gareth?\nUnd Punin?" })).toEqual({
            titel: "Wie weit ist Gareth?",
            nachricht: "Wie weit ist Gareth?\nUnd Punin?",
        });
        expect(meldungAus("bug", { titel: "nur Titel", text: "   " })).toBeUndefined();
        expect(meldungAus("bug", { titel: "", text: "Ohne Titel geht es auch" })?.titel).toBe(
            "Ohne Titel geht es auch",
        );
    });

    it("die Operation folgt stabil aus der Kennung der Interaktion und hat die Form einer UUID", () => {
        const a = operationAus("1400000000000000001");
        expect(a).toBe(operationAus("1400000000000000001"));
        expect(a).not.toBe(operationAus("1400000000000000002"));
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    });
});

describe("Discord-Befehle: anmelden und einen Text senden (gestelltes Discord)", () => {
    const SCHLUESSEL = "Bot.Geheim.Nie-In-Einer-Ausgabe";

    function aufzeichnen(antwort: (url: string, init: RequestInit) => Response) {
        const anfragen: { url: string; init: RequestInit }[] = [];
        const abruf = async (url: string, init: RequestInit): Promise<Response> => {
            anfragen.push({ url, init });
            return antwort(url, init);
        };
        return { abruf, anfragen };
    }

    it("🔴 befehle-registrieren schickt genau die sechs Befehle in Legacys Reihenfolge per PUT, global oder für einen Server", async () => {
        const discord = aufzeichnen((_url, init) => new Response(String(init.body), { status: 200 }));
        const global = await registriereBefehle(SCHLUESSEL, DISCORD_ANWENDUNG, { abruf: discord.abruf });
        expect(global).toMatchObject({
            art: "ok",
            status: 200,
            namen: ["hilfe", "bug", "idee", "frage", "offen", "erledigt"],
        });
        const [anfrage] = discord.anfragen;
        expect(anfrage!.url).toBe("https://discord.com/api/v10/applications/1523674862038683689/commands");
        expect(anfrage!.init.method).toBe("PUT");
        expect(new Headers(anfrage!.init.headers).get("authorization")).toBe(`Bot ${SCHLUESSEL}`);
        const liste = JSON.parse(String(anfrage!.init.body)) as { name: string; description: string; type: number }[];
        expect(liste).toEqual(DISCORD_BEFEHLE);
        expect(liste.map((b) => b.name)).toEqual(["hilfe", "bug", "idee", "frage", "offen", "erledigt"]);
        // `/erledigt` nimmt die Nummer einer Meldung aus Discord als ganze Zahl oder die einer Website-Meldung als Text (WI-0268 C8); beide wahlfrei,
        // genau eine verlangt der Empfänger (`discord-community-bruecke.test.ts`).
        expect(liste.at(-1)).toMatchObject({
            options: [
                { type: 4, name: "nummer", required: false },
                { type: 3, name: "meldung", required: false },
            ],
        });
        for (const b of liste) {
            expect(b.type).toBe(1);
            expect(b.description.length).toBeLessThanOrEqual(100);
            expect(b.name).toMatch(/^[a-z]{1,32}$/u);
        }
        await registriereBefehle(SCHLUESSEL, DISCORD_ANWENDUNG, { abruf: discord.abruf, server: GILDE });
        expect(discord.anfragen[1]!.url).toBe(
            `https://discord.com/api/v10/applications/1523674862038683689/guilds/${GILDE}/commands`,
        );
    });

    it("🔴 OPS-000076: Lesen fragt nur, die Liste des Servers lässt sich leeren, die globale nie über diesen Weg", async () => {
        const alt = [{ name: "offen", description: "Alle offenen Fälle" }];
        const discord = aufzeichnen((_url, init) =>
            init.method === "GET"
                ? new Response(JSON.stringify(alt), { status: 200 })
                : new Response(String(init.body), { status: 200 }),
        );
        expect(await leseBefehle(SCHLUESSEL, DISCORD_ANWENDUNG, { abruf: discord.abruf, server: GILDE })).toEqual({
            art: "ok",
            status: 200,
            namen: ["offen"],
            beschreibungen: ["Alle offenen Fälle"],
        });
        expect(discord.anfragen[0]!.init.method).toBe("GET");
        expect(discord.anfragen[0]!.init.body).toBeUndefined();
        await leseBefehle(SCHLUESSEL, DISCORD_ANWENDUNG, { abruf: discord.abruf });
        expect(discord.anfragen[1]!.url).toBe("https://discord.com/api/v10/applications/1523674862038683689/commands");

        expect(await leereServerBefehle(SCHLUESSEL, DISCORD_ANWENDUNG, GILDE, { abruf: discord.abruf })).toMatchObject({
            art: "ok",
            namen: [],
        });
        const leeren = discord.anfragen[2]!;
        expect(leeren.url).toBe(
            `https://discord.com/api/v10/applications/1523674862038683689/guilds/${GILDE}/commands`,
        );
        expect(leeren.init.method).toBe("PUT");
        expect(leeren.init.body).toBe("[]");

        const zeilen: string[] = [];
        const deps = {
            out: (z: string) => zeilen.push(z),
            err: (z: string) => zeilen.push(z),
            lies: () => "",
            abruf: discord.abruf,
        };
        const env = { DISCORD_BOT_TOKEN: SCHLUESSEL };
        const vorher = discord.anfragen.length;
        // Ohne Server schreibt nichts: Der Befehl gilt nie der globalen Liste.
        expect(await befehlOhneDatenbank("befehle-server-leeren", [], env, DISCORD_ANWENDUNG, deps)).toBe(2);
        expect(
            await befehlOhneDatenbank("befehle-server-leeren", ["--server", "x"], env, DISCORD_ANWENDUNG, deps),
        ).toBe(2);
        expect(discord.anfragen.length).toBe(vorher);
        expect(await befehlOhneDatenbank("befehle-lesen", ["--server", GILDE], env, DISCORD_ANWENDUNG, deps)).toBe(0);
        expect(zeilen.at(-1)).toContain("/offen: Alle offenen Fälle");
        for (const zeile of zeilen) expect(zeile).not.toContain(SCHLUESSEL);
    });

    it("🔴 die Kommandozeile nennt den Bot-Schlüssel nie, auch nicht, wenn Discord ihn im Fehlertext zurückgibt", async () => {
        const zeilen: string[] = [];
        const deps = (abruf: (url: string, init: RequestInit) => Promise<Response>) => ({
            out: (z: string) => zeilen.push(z),
            err: (z: string) => zeilen.push(z),
            lies: () => "",
            abruf,
        });
        const env = { DISCORD_BOT_TOKEN: SCHLUESSEL };
        const gut = aufzeichnen((_url, init) => new Response(String(init.body), { status: 200 }));
        expect(await befehlOhneDatenbank("befehle-registrieren", [], env, DISCORD_ANWENDUNG, deps(gut.abruf))).toBe(0);
        expect(
            await befehlOhneDatenbank(
                "befehle-registrieren",
                ["--server", GILDE],
                env,
                DISCORD_ANWENDUNG,
                deps(gut.abruf),
            ),
        ).toBe(0);
        const schlecht = aufzeichnen(
            () =>
                new Response(JSON.stringify({ message: `401: Unauthorized ${SCHLUESSEL}`, code: 0 }), { status: 401 }),
        );
        expect(
            await befehlOhneDatenbank("befehle-registrieren", [], env, DISCORD_ANWENDUNG, deps(schlecht.abruf)),
        ).toBe(1);
        expect(
            await befehlOhneDatenbank(
                "befehle-registrieren",
                ["--server", "x"],
                env,
                DISCORD_ANWENDUNG,
                deps(gut.abruf),
            ),
        ).toBe(2);
        expect(await befehlOhneDatenbank("befehle-registrieren", [], {}, DISCORD_ANWENDUNG, deps(gut.abruf))).toBe(2);
        expect(zeilen.length).toBeGreaterThanOrEqual(5);
        for (const zeile of zeilen) expect(zeile).not.toContain(SCHLUESSEL);
        expect(zeilen[0]).toContain("hilfe, bug, idee, frage");
        expect(zeilen[1]).toContain(GILDE);
    });

    it("🔴 discord-nachricht sendet nur in den Berichtskanal: prüft ihn, sendet ohne Pings und höchstens 2000 Zeichen; ein anderer Kanal geht nie hinaus; nie mit dem Schlüssel in der Ausgabe", async () => {
        const KANAL = "1000000000000000011"; // der Berichtskanal (erfunden)
        const ANDERER = "1000000000000000022";
        const gilde = gestellteGilde();
        const gesendet: { kanal: string; body: unknown }[] = [];
        const abruf = async (url: string, init: RequestInit): Promise<Response> => {
            const treffer = /\/channels\/(\d+)\/messages$/u.exec(url);
            if (init.method === "POST" && treffer !== null) {
                gesendet.push({ kanal: treffer[1]!, body: JSON.parse(String(init.body)) });
                return new Response(JSON.stringify({ id: "5000000000000000001" }), { status: 200 });
            }
            return gilde.abruf(url, init);
        };
        const zeilen: string[] = [];
        const text = "Avesmaps hat wieder Ohren in Discord: @everyone /bug";
        const deps = {
            out: (z: string) => zeilen.push(z),
            err: (z: string) => zeilen.push(z),
            lies: () => `\uFEFF${text}\n`,
            abruf,
        };
        const env = { DISCORD_BOT_TOKEN: SCHLUESSEL, DISCORD_BERICHT_KANAL: KANAL };
        // Ohne --kanal: der Berichtskanal der Umgebung.
        expect(
            await befehlOhneDatenbank("discord-nachricht", ["--datei", "gruss.txt"], env, DISCORD_ANWENDUNG, deps),
        ).toBe(0);
        expect(gesendet).toHaveLength(1);
        expect(gesendet[0]!.kanal).toBe(KANAL);
        expect(gesendet[0]!.body).toMatchObject({
            content: text,
            allowed_mentions: { parse: [] },
            enforce_nonce: true,
        });
        expect(gilde.anfragen.map((a) => a.url)).toContain(`/channels/${KANAL}`);
        // Mit --kanal geht es, wenn es derselbe ist (Claudios Aufruf in discord-einrichten.sh).
        expect(
            await befehlOhneDatenbank(
                "discord-nachricht",
                ["--kanal", KANAL, "--datei", "gruss.txt"],
                env,
                DISCORD_ANWENDUNG,
                deps,
            ),
        ).toBe(0);
        expect(gesendet.map((g) => g.kanal)).toEqual([KANAL, KANAL]);
        // 🔴 Ein anderer Kanal wird abgelehnt, ohne dass Discord überhaupt gefragt wird.
        const fragen = gilde.anfragen.length;
        const fremd = await befehlOhneDatenbank(
            "discord-nachricht",
            ["--kanal", ANDERER, "--datei", "g"],
            env,
            DISCORD_ANWENDUNG,
            deps,
        );
        expect(fremd).toBe(2);
        expect(gesendet).toHaveLength(2);
        expect(gilde.anfragen).toHaveLength(fragen);
        expect(zeilen.at(-1)).toContain("nicht der Berichtskanal");
        // Ohne Berichtskanal in der Umgebung geht nichts hinaus.
        expect(
            await befehlOhneDatenbank(
                "discord-nachricht",
                ["--datei", "g"],
                { DISCORD_BOT_TOKEN: SCHLUESSEL },
                DISCORD_ANWENDUNG,
                deps,
            ),
        ).toBe(2);
        // Der Berichtskanal aus dem Reiter (die Kommandozeile fragt die Tafel) gilt vor der Umgebung; dann ist der aus der Umgebung ein fremder.
        const ausReiter = { ...deps, berichtsKanal: async () => ANDERER };
        expect(
            await befehlOhneDatenbank("discord-nachricht", ["--datei", "g"], env, DISCORD_ANWENDUNG, ausReiter),
        ).toBe(0);
        expect(gesendet.at(-1)!.kanal).toBe(ANDERER);
        expect(
            await befehlOhneDatenbank(
                "discord-nachricht",
                ["--kanal", KANAL, "--datei", "g"],
                env,
                DISCORD_ANWENDUNG,
                ausReiter,
            ),
        ).toBe(2);
        expect(gesendet).toHaveLength(3);
        // Lässt sich der Berichtskanal nicht ermitteln (Tafel nicht lesbar), geht nichts hinaus, und der Fehler bleibt unter Verschluss.
        const kaputt = {
            ...deps,
            berichtsKanal: async (): Promise<string | undefined> => Promise.reject(new Error(`db ${SCHLUESSEL}`)),
        };
        expect(await befehlOhneDatenbank("discord-nachricht", ["--datei", "g"], env, DISCORD_ANWENDUNG, kaputt)).toBe(
            1,
        );
        expect(gesendet).toHaveLength(3);
        // Darf der Bot dort nicht schreiben, wird nichts gesendet.
        const verboten = gestellteGilde({ alle: 1n << 10n });
        const nein = await befehlOhneDatenbank("discord-nachricht", ["--datei", "g"], env, DISCORD_ANWENDUNG, {
            ...deps,
            abruf: verboten.abruf,
        });
        expect(nein).toBe(1);
        expect(verboten.anfragen.some((a) => a.method === "POST")).toBe(false);
        // Falscher Aufruf: eine Kennung ohne Ziffern, --kanal ohne Wert, keine Datei.
        expect(
            await befehlOhneDatenbank(
                "discord-nachricht",
                ["--kanal", "x", "--datei", "g"],
                env,
                DISCORD_ANWENDUNG,
                deps,
            ),
        ).toBe(2);
        expect(
            await befehlOhneDatenbank("discord-nachricht", ["--datei", "g", "--kanal"], env, DISCORD_ANWENDUNG, deps),
        ).toBe(2);
        expect(await befehlOhneDatenbank("discord-nachricht", ["--kanal", KANAL], env, DISCORD_ANWENDUNG, deps)).toBe(
            2,
        );
        expect(gesendet).toHaveLength(3);
        expect(textFuerDiscord("x".repeat(NACHRICHT_MAX)).ok).toBe(true);
        expect(textFuerDiscord("x".repeat(NACHRICHT_MAX + 1)).ok).toBe(false);
        expect(textFuerDiscord("  \n ").ok).toBe(false);
        for (const zeile of zeilen) expect(zeile).not.toContain(SCHLUESSEL);
    });

    it("🔴 kanal-pruefen ist nur lesend: jedes Urteil in einer Zeile, Exitcode 0 nur bei „erlaubt“, kein Schlüssel in der Ausgabe, falscher Aufruf fragt Discord gar nicht", async () => {
        const KANAL = "1000000000000000033";
        const env = { DISCORD_BOT_TOKEN: SCHLUESSEL };
        const lauf = async (
            gilde: ReturnType<typeof gestellteGilde>,
            argumente: readonly string[],
            umgebung: NodeJS.ProcessEnv = env,
        ) => {
            const aus: string[] = [];
            const fehler: string[] = [];
            const code = await befehlOhneDatenbank("kanal-pruefen", argumente, umgebung, DISCORD_ANWENDUNG, {
                out: (z) => aus.push(z),
                err: (z) => fehler.push(z),
                lies: () => "",
                abruf: gilde.abruf,
            });
            return { code, aus, fehler };
        };

        // Darf der Bot sehen und senden: Exitcode 0, die Zeile auf der Standardausgabe.
        const gut = gestellteGilde();
        const erlaubt = await lauf(gut, ["--kanal", KANAL]);
        expect(erlaubt).toEqual({
            code: 0,
            aus: [`discord kanal-pruefen: Kanal ${KANAL}: erlaubt, der Bot darf dort sehen und schreiben`],
            fehler: [],
        });
        expect(gut.anfragen.length).toBeGreaterThan(0);
        // 🔴 Nur lesend: jede Anfrage ist ein GET, und keine geht an die Nachrichten eines Kanals.
        for (const anfrage of gut.anfragen) {
            expect(anfrage.method).toBe("GET");
            expect(anfrage.url).not.toContain("/messages");
            expect(anfrage.authorization).toBe(`Bot ${SCHLUESSEL}`);
        }

        // Jedes andere Urteil: Exitcode 1, die Zeile auf der Fehlerausgabe, und sie sagt, was fehlt.
        const faelle: [string, Parameters<typeof gestellteGilde>[0], string][] = [
            ["Nachrichten senden fehlt", { alle: 1n << 10n }, "nicht schreiben"],
            ["Kanal ansehen fehlt", { alle: 0n }, "nicht sehen"],
            ["Sprachkanal", { kanal: { type: 2 } }, "kein Textkanal"],
            ["unbekannter Kanal", { status: { kanal: 404 } }, "unbekannt"],
            ["Discord nicht erreichbar", { wirft: "netz" }, "nicht prüfbar (Kanal: Netzfehler)"],
            ["Schlüssel abgelehnt", { status: { bot: 401 } }, "nicht prüfbar (Bot: HTTP 401)"],
        ];
        for (const [name, gilde, satz] of faelle) {
            const stand = gestellteGilde(gilde, {}, `kaputt ${SCHLUESSEL}`);
            const ergebnis = await lauf(stand, ["--kanal", KANAL]);
            expect(ergebnis.code, name).toBe(1);
            expect(ergebnis.aus, name).toEqual([]);
            expect(ergebnis.fehler, name).toHaveLength(1);
            expect(ergebnis.fehler[0], name).toContain(satz);
            expect(ergebnis.fehler[0], name).toContain(KANAL);
            expect(
                stand.anfragen.every((a) => a.method === "GET"),
                name,
            ).toBe(true);
            // 🔴 Auch Discords Fehlertext, in dem der Schlüssel stünde, kommt nicht durch.
            expect(ergebnis.fehler.join("\n"), name).not.toContain(SCHLUESSEL);
        }

        // Falscher Aufruf: ohne Kanal, mit einer Kennung ohne Ziffern, mit --kanal ohne Wert, ohne Schlüssel. Discord wird nicht gefragt.
        const still = gestellteGilde();
        expect((await lauf(still, [])).code).toBe(2);
        expect((await lauf(still, ["--kanal", "x"])).code).toBe(2);
        expect((await lauf(still, ["--kanal"])).code).toBe(2);
        const ohneSchluessel = await lauf(still, ["--kanal", KANAL], {});
        expect(ohneSchluessel.code).toBe(2);
        expect(ohneSchluessel.fehler[0]).toContain("DISCORD_BOT_TOKEN fehlt");
        expect(still.anfragen).toHaveLength(0);
    });

    it("die Begrüßung im Repository taugt für Discord (Valis Wortlaut, unter 2000 Zeichen)", async () => {
        const { readFileSync } = await import("node:fs");
        const roh = readFileSync(new URL("../../../ops/discord/begruessung.txt", import.meta.url), "utf8");
        const text = textFuerDiscord(roh);
        expect(text.ok).toBe(true);
        expect(roh).toContain("Avesmaps hat wieder Ohren in Discord");
        expect(roh).toContain("https://avesmaps.de");
    });
});

describe("Discord-Befehle: Schlüssel im Test", () => {
    it("der fremde Schlüssel ist ein anderer", () => {
        expect(DISCORD_FREMDER_SCHLUESSEL).not.toBe(DISCORD_TEST_SCHLUESSEL);
        expect(DISCORD_TEST_SCHLUESSEL).toMatch(/^[0-9a-f]{64}$/u);
    });
});
