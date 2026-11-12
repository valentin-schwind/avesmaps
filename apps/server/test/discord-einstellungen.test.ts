import { describe, expect, it } from "vitest";
import { DISCORD_PROMPT_MAX, DISCORD_PROMPT_VORGABE, istDiscordPrompt } from "@avesmaps3d/shared";
import { pruefeKanal, rechteImKanal, type Ueberschreibung } from "../src/discord/kanalpruefung.ts";
import { discordKonfiguration, kanalWert, sendeSperre, wirksam, zielKanal } from "../src/discord/konfig.ts";
import { ADMIN, ANSEHEN, BOT, GILDE, ROLLE, SENDEN, gestellteGilde, type Gilde } from "./support/discord-gilde.ts";

/**
 * Die Einstellungen des Discord-Berichts ohne Datenbank (WI-0255, Migration 0227): welcher Kanal gilt (Reiter vor Umgebung) und die Prüfung eines
 * Kanals beim Speichern gegen ein gestelltes Discord (erlaubt, verboten, unbekannt, nicht prüfbar). Kein Test spricht mit Discord.
 * Das Sendefenster zur Uhrzeit und der Prompt stehen in `discord-bericht.test.ts`, die Routen in `discord-zustellung.test.ts`.
 */

// Erfundene Kennungen im Format von Discord, nie echte.
const TOKEN = "geheim.SCHLUESSEL.einstellungen-0123456789";
const KANAL = "1000000000000000001";
const TEST = "1000000000000000002";

const discord = gestellteGilde;

describe("Discord-Einstellungen: welcher Kanal gilt", () => {
    const prod = {
        AVESMAPS_ENV: "staging",
        RELEASE_ID: "20261025T080000Z-abcdef1",
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_BERICHT: "senden",
    };

    it("🔴 ein Kanal aus dem Reiter gilt vor dem der Umgebung; fehlt er dort, gilt die Umgebung, und der Reiter sagt woher", () => {
        const konfig = discordKonfiguration({ ...prod, DISCORD_BERICHT_KANAL: KANAL });
        expect(kanalWert(null, konfig.berichtKanal)).toEqual({
            eigen: null,
            umgebung: KANAL,
            gilt: KANAL,
            quelle: "umgebung",
        });
        expect(kanalWert("1000000000000000099", konfig.berichtKanal)).toEqual({
            eigen: "1000000000000000099",
            umgebung: KANAL,
            gilt: "1000000000000000099",
            quelle: "reiter",
        });
        expect(kanalWert(null, undefined)).toEqual({ eigen: null, umgebung: null, gilt: null, quelle: "keine" });
        const effektiv = wirksam(konfig, { berichts_kanal: "1000000000000000099" });
        expect(zielKanal(effektiv)).toBe("1000000000000000099");
        // Der Reiter ändert weder Modus noch Schlüssel noch Umgebung.
        expect(effektiv).toMatchObject({ modus: "senden", botToken: TOKEN, umgebung: "staging" });
    });

    it("ohne Kanal in der Umgebung sendet nichts; ein Kanal aus dem Reiter hebt diese Sperre auf, nicht die von Production", () => {
        const ohne = discordKonfiguration(prod);
        expect(sendeSperre(ohne)).toBe("ohne_kanal");
        expect(sendeSperre(wirksam(ohne, { berichts_kanal: KANAL }))).toBeNull();
        const produktion = discordKonfiguration({ ...prod, AVESMAPS_ENV: "production" });
        expect(sendeSperre(wirksam(produktion, { berichts_kanal: KANAL }))).toBe("nicht_stage");
    });
});

describe("Discord-Einstellungen: Prüfung des Kanals gegen ein gestelltes Discord", () => {
    it("🔴 erlaubt: sehen und schreiben; nur Lesezugriffe, der Schlüssel steht nur im Kopf", async () => {
        const stub = discord();
        expect(await pruefeKanal(TOKEN, KANAL, stub.abruf)).toEqual({ art: "erlaubt" });
        expect(stub.anfragen.map((a) => `${a.method} ${a.url}`).sort()).toEqual(
            [
                `GET /channels/${KANAL}`,
                "GET /users/@me",
                `GET /guilds/${GILDE}/roles`,
                `GET /guilds/${GILDE}/members/${BOT}`,
            ].sort(),
        );
        expect(stub.anfragen.every((a) => a.authorization === `Bot ${TOKEN}`)).toBe(true);
        expect(stub.anfragen.some((a) => a.url.includes(TOKEN))).toBe(false);
    });

    it("🔴 verboten: Discord verweigert das Sehen (403), es ist kein Textkanal, oder das Schreiben fehlt", async () => {
        expect(await pruefeKanal(TOKEN, KANAL, discord({ status: { kanal: 403 } }).abruf)).toEqual({
            art: "verboten",
            grund: "sehen",
        });
        // Ein Sprachkanal (Typ 2) nimmt keinen Tagesbericht.
        expect(await pruefeKanal(TOKEN, KANAL, discord({ kanal: { type: 2 } }).abruf)).toEqual({
            art: "verboten",
            grund: "kein_textkanal",
        });
        // Die Rolle „alle“ darf nur ansehen, der Bot hat keine eigene Rolle mit Senden.
        expect(await pruefeKanal(TOKEN, KANAL, discord({ alle: ANSEHEN }).abruf)).toEqual({
            art: "verboten",
            grund: "schreiben",
        });
        // Der Kanal verbietet „alle“ das Senden, ohne dass der Bot es per Rolle zurückbekommt.
        expect(
            await pruefeKanal(
                TOKEN,
                KANAL,
                discord({ ueberschreibungen: [{ id: GILDE, type: 0, allow: 0n, deny: SENDEN }] }).abruf,
            ),
        ).toEqual({ art: "verboten", grund: "schreiben" });
        // Ein Verbot für den Bot selbst gewinnt über die Erlaubnis seiner Rolle.
        expect(
            await pruefeKanal(
                TOKEN,
                KANAL,
                discord({
                    botRolle: SENDEN,
                    ueberschreibungen: [{ id: BOT, type: 1, allow: 0n, deny: SENDEN }],
                }).abruf,
            ),
        ).toEqual({ art: "verboten", grund: "schreiben" });
        // Ohne „Kanal ansehen“ gilt der Kanal als unsichtbar, auch wenn Discord ihn lieferte.
        expect(await pruefeKanal(TOKEN, KANAL, discord({ alle: SENDEN }).abruf)).toEqual({
            art: "verboten",
            grund: "sehen",
        });
    });

    it("die Rolle des Bots darf im Kanal erlauben, was „alle“ verboten ist; ein Administrator braucht keine Erlaubnis", async () => {
        const erlaubtPerRolle = discord({
            ueberschreibungen: [
                { id: GILDE, type: 0, allow: 0n, deny: SENDEN },
                { id: ROLLE, type: 0, allow: SENDEN, deny: 0n },
            ],
        });
        expect(await pruefeKanal(TOKEN, KANAL, erlaubtPerRolle.abruf)).toEqual({ art: "erlaubt" });
        const admin = discord({
            alle: 0n,
            botRolle: ADMIN,
            ueberschreibungen: [{ id: GILDE, type: 0, allow: 0n, deny: ANSEHEN | SENDEN }],
        });
        expect(await pruefeKanal(TOKEN, KANAL, admin.abruf)).toEqual({ art: "erlaubt" });
    });

    it("🔴 unbekannt: Den Kanal gibt es nicht (404)", async () => {
        expect(await pruefeKanal(TOKEN, KANAL, discord({ status: { kanal: 404 } }).abruf)).toEqual({
            art: "unbekannt",
        });
    });

    it("🔴 nicht prüfbar: Störung, Netz, Zeit, abgelehnter Schlüssel, unlesbare Gilde; das Urteil nennt nie den Schlüssel", async () => {
        const faelle: [string, Gilde][] = [
            ["Discord gestört", { status: { kanal: 500 } }],
            ["Schlüssel abgelehnt", { status: { kanal: 401 } }],
            ["Rate-Limit", { status: { kanal: 429 } }],
            ["Netzfehler", { wirft: "netz" }],
            ["Zeitüberschreitung", { wirft: "zeit" }],
            ["Rollen nicht lesbar", { status: { rollen: 403 } }],
            ["Mitglied nicht lesbar", { status: { mitglied: 404 } }],
            ["Bot nicht lesbar", { status: { bot: 500 } }],
        ];
        for (const [name, gilde] of faelle) {
            const urteil = await pruefeKanal(TOKEN, KANAL, discord(gilde, {}, `kaputt ${TOKEN}`).abruf);
            expect(urteil.art, name).toBe("nicht_pruefbar");
            // Discords Fehlertext (er trägt hier den Schlüssel) und der Schlüssel selbst bleiben draußen.
            expect(JSON.stringify(urteil), name).not.toContain(TOKEN);
            expect(JSON.stringify(urteil), name).not.toContain("kaputt");
        }
        expect(await pruefeKanal(TOKEN, KANAL, discord({ wirft: "zeit" }).abruf)).toEqual({
            art: "nicht_pruefbar",
            grund: "Kanal: Zeitüberschreitung",
        });
    });

    it("eine Antwort für einen anderen Kanal ist kein Urteil", async () => {
        const urteil = await pruefeKanal(TOKEN, KANAL, discord({ kanal: { id: TEST } }).abruf);
        expect(urteil).toEqual({ art: "nicht_pruefbar", grund: "Kanal: unerwartete Antwort" });
    });

    it("die Rechte im Kanal folgen der Reihenfolge der Discord-Dokumentation", () => {
        const rollen = new Map<string, bigint>([
            [GILDE, ANSEHEN | SENDEN],
            [ROLLE, 0n],
        ]);
        const ow = (teil: Partial<Ueberschreibung> & { id: string; type: number }): Ueberschreibung => ({
            allow: 0n,
            deny: 0n,
            ...teil,
        });
        // alle verboten → Rolle erlaubt → Bot verboten: das Letzte gewinnt.
        expect(rechteImKanal(GILDE, BOT, rollen, [ROLLE], [ow({ id: GILDE, type: 0, deny: SENDEN })]) & SENDEN).toBe(
            0n,
        );
        expect(
            rechteImKanal(
                GILDE,
                BOT,
                rollen,
                [ROLLE],
                [ow({ id: GILDE, type: 0, deny: SENDEN }), ow({ id: ROLLE, type: 0, allow: SENDEN })],
            ) & SENDEN,
        ).toBe(SENDEN);
        expect(
            rechteImKanal(
                GILDE,
                BOT,
                rollen,
                [ROLLE],
                [ow({ id: ROLLE, type: 0, allow: SENDEN }), ow({ id: BOT, type: 1, deny: SENDEN })],
            ) & SENDEN,
        ).toBe(0n);
    });

    it("die Vorgabe des Prompts ist ein gültiger Prompt im Aufbau der früheren Tagesberichte: duzt, Icons, ohne Ziffern und Ausrufezeichen", () => {
        // Gespeichert wird sie nie (gleich der Vorgabe heißt „nichts gespeichert“); sie muss aber als Prompt durchgehen, wenn sie jemand einfügt.
        expect(istDiscordPrompt(DISCORD_PROMPT_VORGABE)).toBe(true);
        expect(DISCORD_PROMPT_VORGABE.length).toBeLessThanOrEqual(DISCORD_PROMPT_MAX);
        expect(DISCORD_PROMPT_VORGABE).not.toMatch(/\d/u);
        expect(DISCORD_PROMPT_VORGABE).not.toContain("!");
        expect(DISCORD_PROMPT_VORGABE).toContain("Duze die Leser");
        for (const icon of ["🗺️", "🛠️", "🐞"]) expect(DISCORD_PROMPT_VORGABE).toContain(icon);
        expect(DISCORD_PROMPT_VORGABE).not.toMatch(/keine Emojis/iu);
        expect(DISCORD_PROMPT_VORGABE).toBe(DISCORD_PROMPT_VORGABE.trim());
    });
});
