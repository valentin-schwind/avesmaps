import { createHmac } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    COMMUNITY_DISCORD_MAX_ALTER_MS,
    COMMUNITY_DISCORD_MAX_VORAUS_MS,
    COMMUNITY_DISCORD_OFFEN_PFAD,
    COMMUNITY_DISCORD_SCHLUESSEL_MIN,
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_ZEILEN_MAX,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
    CommunityDiscordOffenAnfrage,
    CommunityDiscordOffenAntwort,
    CommunityDiscordZurueckziehenAnfrage,
    CommunityDiscordZurueckziehenAntwort,
    brueckeSchluesselTaugt,
    pruefeSignatur,
    signiere,
} from "../src/index.ts";

/** Der Vertrag der Brücke Stage → Production für Website-Meldungen in Discord (WI-0268 C8): Pfade, Kopfzeilen, Schemata und die Signatur. */

const SCHLUESSEL = "0123456789abcdef0123456789abcdef";
const ANDERER = "fedcba9876543210fedcba9876543210";
const JETZT = 1_761_900_000_000;
const RUMPF = '{"discordId":"1100000000000000001"}';

describe("Vertrag: Pfade und Kopfzeilen", () => {
    it("die Namen sind die des Betriebsvertrags", () => {
        expect(COMMUNITY_DISCORD_OFFEN_PFAD).toBe("/api/community/discord/offen");
        expect(COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD).toBe("/api/community/discord/zurueckziehen");
        expect(COMMUNITY_DISCORD_ZEIT_KOPF).toBe("X-Avesmaps-Zeit");
        expect(COMMUNITY_DISCORD_SIGNATUR_KOPF).toBe("X-Avesmaps-Signatur");
        expect(COMMUNITY_DISCORD_MAX_ALTER_MS).toBe(60_000);
    });
});

describe("Vertrag: Schemata", () => {
    it("die Anfragen: Discord-Kennung und Nummer in Form, nichts darüber hinaus", () => {
        expect(Value.Check(CommunityDiscordOffenAnfrage, { discordId: "1100000000000000001" })).toBe(true);
        expect(Value.Check(CommunityDiscordOffenAnfrage, { discordId: "123" })).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAnfrage, { discordId: "11000000000000000011" + "1" })).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAnfrage, { discordId: "1100000000000000001", name: "x" })).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAnfrage, {})).toBe(false);
        const gut = { discordId: "1100000000000000001", nummer: "COM-000123" };
        expect(Value.Check(CommunityDiscordZurueckziehenAnfrage, gut)).toBe(true);
        expect(Value.Check(CommunityDiscordZurueckziehenAnfrage, { ...gut, nummer: "COM-1234567" })).toBe(true);
        for (const nummer of ["123", "com-000123", "OPS-000123", "COM-123", "COM-000123 ", "COM-"])
            expect(Value.Check(CommunityDiscordZurueckziehenAnfrage, { ...gut, nummer }), nummer).toBe(false);
        expect(Value.Check(CommunityDiscordZurueckziehenAnfrage, { ...gut, extra: 1 })).toBe(false);
    });

    it("die Antwort auf „offen“: nur Nummer, Stand und Kurztitel; jedes weitere Feld, jeder fremde Stand und zu viele Zeilen sind ungültig", () => {
        const zeile = { nummer: "COM-000123", stand: "in_bearbeitung", kurztitel: "Fehler · Gareth" };
        expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [] })).toBe(true);
        expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [zeile] })).toBe(true);
        for (const stand of ["eingegangen", "in_bearbeitung", "rueckfrage"])
            expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [{ ...zeile, stand }] }), stand).toBe(true);
        // 🔴 Ein Meldetext, ein Name oder eine Kennung in der Zeile macht die ganze Antwort ungültig.
        for (const extra of [{ text: "Geheim" }, { name: "Rondrikan" }, { discordId: "1100000000000000001" }])
            expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [{ ...zeile, ...extra }] })).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [zeile], text: "x" })).toBe(false);
        for (const stand of ["abgenommen", "abgelehnt", "zu_sichten", ""])
            expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [{ ...zeile, stand }] }), stand).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [{ ...zeile, nummer: "OPS-000001" }] })).toBe(false);
        expect(Value.Check(CommunityDiscordOffenAntwort, { zeilen: [{ ...zeile, kurztitel: "x".repeat(201) }] })).toBe(
            false,
        );
        const viele = (n: number) => ({ zeilen: Array.from({ length: n }, () => zeile) });
        expect(Value.Check(CommunityDiscordOffenAntwort, viele(COMMUNITY_DISCORD_ZEILEN_MAX))).toBe(true);
        expect(Value.Check(CommunityDiscordOffenAntwort, viele(COMMUNITY_DISCORD_ZEILEN_MAX + 1))).toBe(false);
    });

    it("die Antwort auf „zurückziehen“: eines der drei Ergebnisse, sonst nichts", () => {
        for (const ergebnis of ["zurueckgezogen", "nicht_gefunden", "schon_abgeschlossen"])
            expect(Value.Check(CommunityDiscordZurueckziehenAntwort, { ergebnis }), ergebnis).toBe(true);
        expect(Value.Check(CommunityDiscordZurueckziehenAntwort, { ergebnis: "fremd" })).toBe(false);
        expect(Value.Check(CommunityDiscordZurueckziehenAntwort, { ergebnis: "nicht_gefunden", grund: "x" })).toBe(
            false,
        );
        expect(Value.Check(CommunityDiscordZurueckziehenAntwort, {})).toBe(false);
    });
});

describe("Signatur: signiere", () => {
    it("ist HMAC-SHA256 als kleines Hex über „<zeit>\\n<rumpf>“, gleich dem von node:crypto", async () => {
        const erwartet = createHmac("sha256", SCHLUESSEL)
            .update(`${String(JETZT)}\n${RUMPF}`)
            .digest("hex");
        const signatur = await signiere(SCHLUESSEL, JETZT, RUMPF);
        expect(signatur).toBe(erwartet);
        // Pinnt die Form: Ändert sich Trenner, Kodierung oder Hash, ist dieser Wert nicht mehr der von Production.
        expect(signatur).toBe("ee294698e13ab9bddea1aec623a61df27994bcd3b7373e5902ae510c2e30a2dc");
        expect(signatur).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("Zeit als Zahl oder Text und Rumpf als Text oder Bytes ergeben dieselbe Signatur", async () => {
        const text = await signiere(SCHLUESSEL, JETZT, RUMPF);
        expect(await signiere(SCHLUESSEL, String(JETZT), RUMPF)).toBe(text);
        expect(await signiere(SCHLUESSEL, JETZT, Buffer.from(RUMPF, "utf8"))).toBe(text);
        // Umlaute sind UTF-8, nicht Latin-1.
        const umlaut = '{"x":"Gräfin"}';
        expect(await signiere(SCHLUESSEL, JETZT, umlaut)).toBe(
            createHmac("sha256", SCHLUESSEL)
                .update(`${String(JETZT)}\n${umlaut}`)
                .digest("hex"),
        );
    });

    it("ein Schlüssel unter 32 Zeichen und eine Zeit, die keine Zahl ist, sind Fehler des Aufrufers", async () => {
        await expect(signiere("zu kurz", JETZT, RUMPF)).rejects.toThrow(RangeError);
        await expect(signiere(SCHLUESSEL, "gestern", RUMPF)).rejects.toThrow(RangeError);
        await expect(signiere(SCHLUESSEL, -1, RUMPF)).rejects.toThrow(RangeError);
        expect(brueckeSchluesselTaugt(SCHLUESSEL)).toBe(true);
        expect(brueckeSchluesselTaugt("x".repeat(COMMUNITY_DISCORD_SCHLUESSEL_MIN - 1))).toBe(false);
        expect(brueckeSchluesselTaugt(undefined)).toBe(false);
        expect(brueckeSchluesselTaugt("")).toBe(false);
    });
});

describe("Signatur: pruefeSignatur", () => {
    const pruefe = async (aenderung: Partial<Parameters<typeof pruefeSignatur>[0]> = {}) =>
        pruefeSignatur({
            schluessel: SCHLUESSEL,
            zeit: String(JETZT),
            signatur: await signiere(SCHLUESSEL, JETZT, RUMPF),
            rumpf: RUMPF,
            jetzt: JETZT,
            ...aenderung,
        });

    it("eine frische, richtige Signatur gilt, auch mit dem Rumpf als Bytes und mit großgeschriebenem Hex", async () => {
        expect(await pruefe()).toBe("gueltig");
        expect(await pruefe({ rumpf: Buffer.from(RUMPF, "utf8") })).toBe("gueltig");
        expect(await pruefe({ signatur: (await signiere(SCHLUESSEL, JETZT, RUMPF)).toUpperCase() })).toBe("gueltig");
    });

    it("🔴 ein falscher Schlüssel, ein veränderter Rumpf oder eine veränderte Zeit gelten nicht", async () => {
        expect(await pruefe({ schluessel: ANDERER })).toBe("ungueltig");
        expect(await pruefe({ rumpf: RUMPF.replace("1100", "1101") })).toBe("ungueltig");
        expect(await pruefe({ rumpf: `${RUMPF} ` })).toBe("ungueltig");
        // Dieselbe Signatur mit einer anderen (noch frischen) Zeit: Die Zeit gehört zur Signatur.
        expect(await pruefe({ zeit: String(JETZT + 1) })).toBe("ungueltig");
        // Der Rumpf ohne den Trenner der Zeit: „<zeit>\n<rumpf>“ ist nicht „<zeit><rumpf>“.
        const ohneTrenner = createHmac("sha256", SCHLUESSEL)
            .update(`${String(JETZT)}${RUMPF}`)
            .digest("hex");
        expect(await pruefe({ signatur: ohneTrenner })).toBe("ungueltig");
    });

    it("🔴 Alter: bis 60 s gilt, darüber ist sie zu alt; aus der Zukunft gelten nur wenige Sekunden Uhrabweichung", async () => {
        const mit = async (abstandMs: number) => {
            const zeit = JETZT - abstandMs;
            return pruefeSignatur({
                schluessel: SCHLUESSEL,
                zeit: String(zeit),
                signatur: await signiere(SCHLUESSEL, zeit, RUMPF),
                rumpf: RUMPF,
                jetzt: JETZT,
            });
        };
        expect(await mit(0)).toBe("gueltig");
        expect(await mit(COMMUNITY_DISCORD_MAX_ALTER_MS)).toBe("gueltig");
        expect(await mit(COMMUNITY_DISCORD_MAX_ALTER_MS + 1)).toBe("zu_alt");
        expect(await mit(10 * 60_000)).toBe("zu_alt");
        expect(await mit(-COMMUNITY_DISCORD_MAX_VORAUS_MS)).toBe("gueltig");
        expect(await mit(-COMMUNITY_DISCORD_MAX_VORAUS_MS - 1)).toBe("aus_der_zukunft");
        expect(await mit(-3_600_000)).toBe("aus_der_zukunft");
    });

    it("🔴 Signaturen falscher Länge oder Form sind ungültig, nie ein Fehler (der Vergleich ist zeitkonstant und kennt keine Längenausnahme)", async () => {
        const richtig = await signiere(SCHLUESSEL, JETZT, RUMPF);
        for (const signatur of [
            richtig.slice(0, 63),
            `${richtig}0`,
            richtig.slice(0, 32),
            "",
            "zz".repeat(32),
            `${richtig.slice(0, 62)}g0`,
            ` ${richtig.slice(1)}`,
        ])
            expect(await pruefe({ signatur }), signatur).toBe("ungueltig");
        // Fehlende oder falsch getypte Kopfzeilen (Fastify liefert string | string[] | undefined).
        for (const signatur of [undefined, null, 5, [richtig], { hex: richtig }])
            expect(await pruefe({ signatur }), String(signatur)).toBe("ungueltig");
        for (const zeit of [
            undefined,
            null,
            "",
            "gestern",
            "1.5",
            "-1",
            " 1761900000000",
            [String(JETZT)],
            "9".repeat(17),
        ])
            expect(await pruefe({ zeit }), String(zeit)).toBe("ungueltig");
    });

    it("ein zu kurzer Schlüssel gilt nie, auch nicht, wenn die Signatur dazu passt", async () => {
        const kurz = "kurz";
        const passend = createHmac("sha256", kurz)
            .update(`${String(JETZT)}\n${RUMPF}`)
            .digest("hex");
        expect(await pruefe({ schluessel: kurz, signatur: passend })).toBe("ungueltig");
        expect(await pruefe({ schluessel: "" })).toBe("ungueltig");
    });

    it("ohne `jetzt` gilt die Uhr", async () => {
        const zeit = Date.now();
        const signatur = await signiere(SCHLUESSEL, zeit, RUMPF);
        expect(await pruefeSignatur({ schluessel: SCHLUESSEL, zeit: String(zeit), signatur, rumpf: RUMPF })).toBe(
            "gueltig",
        );
        const alt = Date.now() - 2 * COMMUNITY_DISCORD_MAX_ALTER_MS;
        expect(
            await pruefeSignatur({
                schluessel: SCHLUESSEL,
                zeit: String(alt),
                signatur: await signiere(SCHLUESSEL, alt, RUMPF),
                rumpf: RUMPF,
            }),
        ).toBe("zu_alt");
    });
});
