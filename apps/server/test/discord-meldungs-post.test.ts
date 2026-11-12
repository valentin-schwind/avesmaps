import { describe, expect, it } from "vitest";
import { discordKonfiguration, meldungsKanal } from "../src/discord/konfig.ts";
import {
    POST_TEXT_MAX,
    POST_TITEL_MAX,
    postNachricht,
    postNonce,
    postText,
    postMeldung,
    type PostEingabe,
} from "../src/discord/meldungs-post.ts";
import { discordRest, type DiscordNachricht, type DiscordRest, type SendeErgebnis } from "../src/discord/rest.ts";

/**
 * Der kurze Post von `/bug` und `/idee` in den eigenen Kanal (WI-0255; Vali 2026-11-02): Vorgangsnummer, Titel, ein bis zwei Sätze, eine Dankzeile mit der meldenden
 * Person als einziger Erwähnung. Der Text kommt von Nutzern und geht öffentlich hinaus. Kein Test spricht mit Discord; die echten Kanalnummern stehen nirgends im Code.
 */

// Erfundene Kennungen im Format von Discord, nie ein echter Kanal oder eine echte Person.
const BUG_KANAL = "2000000000000000001";
const IDEE_KANAL = "2000000000000000002";
const BERICHT_KANAL = "2000000000000000003";
const PERSON = "3000000000000000001";
const TOKEN = "post.SCHLUESSEL.abcdefghijklmnop";

const konfig = (env: Record<string, string> = {}) =>
    discordKonfiguration({
        AVESMAPS_ENV: "staging",
        RELEASE_ID: "20261102T080000Z-abcdef1",
        DISCORD_BOT_TOKEN: TOKEN,
        DISCORD_BERICHT_KANAL: BERICHT_KANAL,
        DISCORD_BUG_KANAL: BUG_KANAL,
        DISCORD_IDEE_KANAL: IDEE_KANAL,
        ...env,
    });

const eingabe = (teil: Partial<PostEingabe> = {}): PostEingabe => ({
    befehl: "bug",
    nummer: 123,
    titel: "Weg nach Gareth fehlt",
    nachricht:
        "Der Weg von Havena nach Gareth ist nicht zu sehen. Er fehlt in der Karte. Und noch ein dritter Satz.\n\nWo: Gareth",
    melderKennung: PERSON,
    interaktionsId: "4000000000000000001",
    ...teil,
});

/** Ein gestelltes Discord: jede Anfrage gemerkt, die Antworten der Reihe nach. */
function gestellt(antworten: SendeErgebnis[] = []) {
    const gesendet: { kanal: string; nachricht: DiscordNachricht }[] = [];
    const rest: DiscordRest = {
        async sende(kanal, nachricht) {
            gesendet.push({ kanal, nachricht });
            return antworten.shift() ?? { art: "ok", messageId: "1430000000000000001" };
        },
        async suche() {
            return { art: "nicht_gefunden" };
        },
    };
    return { rest, gesendet };
}

describe("Discord: der Post von /bug und /idee", () => {
    it("🔴 der Text: Vorgangsnummer, Titel, ein bis zwei Sätze, Dankzeile mit der Person als Erwähnung", () => {
        expect(postText(eingabe())).toBe(
            [
                "🐞 **Neuer Bug** #123: Weg nach Gareth fehlt",
                "Der Weg von Havena nach Gareth ist nicht zu sehen. Er fehlt in der Karte.",
                `Danke, <@${PERSON}>, wir schauen es uns an.`,
            ].join("\n"),
        );
        expect(
            postText(eingabe({ befehl: "idee", nummer: 7, titel: "Flussnamen anzeigen", nachricht: "Wäre schön." })),
        ).toBe(
            [
                "💡 **Neue Idee** #7: Flussnamen anzeigen",
                "Wäre schön.",
                `Danke, <@${PERSON}>, wir schauen uns die Idee an.`,
            ].join("\n"),
        );
        // Ohne Kennung der Person keine Erwähnung; das „Wo:“ des Formulars gehört nicht in die Kurzfassung.
        const ohne = postText(eingabe({ melderKennung: null }));
        expect(ohne).not.toContain("<@");
        expect(ohne).toContain("Danke, wir schauen es uns an.");
        expect(ohne).not.toContain("Wo:");
    });

    it("🔴 allowed_mentions erlaubt nur die meldende Person: keine Rolle, kein @everyone, kein @here, auch nicht aus dem Text der Person", () => {
        const heikel = eingabe({
            titel: "@everyone @here <@&987654321098765432> schaut her",
            nachricht:
                "Ping <@999999999999999999> und <#111111111111111111> und @everyone und @here. Zweiter Satz mit **fett** und `code`.",
        });
        const nachricht = postNachricht(heikel);
        expect(nachricht.allowed_mentions).toEqual({ parse: [], users: [PERSON] });
        expect(nachricht.enforce_nonce).toBe(true);
        // Im Text selbst steht nur die Erwähnung der meldenden Person.
        const erwaehnungen = nachricht.content.match(/<[@#][^>]*>|@everyone|@here/giu) ?? [];
        expect(erwaehnungen).toEqual([`<@${PERSON}>`]);
        expect(nachricht.content).not.toMatch(/999999999999999999|987654321098765432|111111111111111111/u);
        // Der Fettdruck gehört allein dem Kopf der App („**Neuer Bug**“), nie dem Text der Person.
        expect(nachricht.content.replace("**Neuer Bug**", "")).not.toMatch(/[*`_~|]/u);
        // Ohne Kennung: keine Person erlaubt.
        expect(postNachricht(eingabe({ melderKennung: null })).allowed_mentions).toEqual({ parse: [], users: [] });
        // Eine Kennung, die keine ist, wird nie in den Text oder die Erlaubnis übernommen.
        const falsch = postNachricht(eingabe({ melderKennung: "1> @everyone <@1" }));
        expect(falsch.allowed_mentions).toEqual({ parse: [], users: [] });
        expect(falsch.content).not.toContain("@everyone");
    });

    it("🔴 Verweise, Markdown und Steuerzeichen aus dem Text der Person fallen weg; Länge gekappt; ein Fettdruck-Trick am Zeilenanfang wirkt nicht", () => {
        const text = postText(
            eingabe({
                titel: `# ${"T".repeat(300)}`,
                nachricht:
                    "[hier](https://boese.example) discord.gg/abc www.beispiel.de ||Spoiler|| ‮umgedreht‬ ~~weg~~ " +
                    `${"Wort ".repeat(200)}`,
            }),
        );
        expect(text).not.toMatch(/https?:|discord\.gg|beispiel|boese|\|\||~~|‮/u);
        expect(text.split("\n")).toHaveLength(3);
        const titelZeile = text.split("\n")[0]!;
        expect(titelZeile.length).toBeLessThanOrEqual("🐞 **Neuer Bug** #123: ".length + POST_TITEL_MAX);
        expect(text.split("\n")[1]!.length).toBeLessThanOrEqual(POST_TEXT_MAX);
        expect(text.length).toBeLessThan(1000);
        // Die Zeile mit dem Text beginnt mit dem Text, nicht mit einem Zeichen, das Discord als Überschrift oder Liste liest.
        expect(postText(eingabe({ nachricht: "# Große Überschrift im Text" })).split("\n")[1]).toBe(
            "Große Überschrift im Text",
        );
    });

    it("die Nonce folgt aus der Interaktion: dieselbe ergibt dieselbe (höchstens 25 Zeichen), eine andere eine andere", () => {
        expect(postNonce("4000000000000000001")).toBe(postNonce("4000000000000000001"));
        expect(postNonce("4000000000000000001")).not.toBe(postNonce("4000000000000000002"));
        expect(postNonce("4000000000000000001").length).toBeLessThanOrEqual(25);
        expect(postNachricht(eingabe()).nonce).toBe(postNonce(eingabe().interaktionsId));
    });

    it("🔴 die Kanäle sind eigene Werte, geprüft wie der Berichtskanal; fehlt einer, ist es still", () => {
        expect(konfig().bugKanal).toBe(BUG_KANAL);
        expect(konfig().ideeKanal).toBe(IDEE_KANAL);
        expect(konfig({ DISCORD_BUG_KANAL: "kaputt" }).bugKanal).toBeUndefined();
        expect(konfig({ DISCORD_IDEE_KANAL: "123" }).ideeKanal).toBeUndefined();
        expect(discordKonfiguration({}).bugKanal).toBeUndefined();
        expect(meldungsKanal(konfig(), "bug")).toBe(BUG_KANAL);
        expect(meldungsKanal(konfig(), "idee")).toBe(IDEE_KANAL);
        // `/frage` postet nie; Production und lokal nie; ohne Schlüssel nie; nie in den Berichtskanal.
        expect(meldungsKanal(konfig(), "frage")).toBeNull();
        expect(meldungsKanal(konfig({ AVESMAPS_ENV: "production" }), "bug")).toBeNull();
        expect(meldungsKanal(konfig({ RELEASE_ID: "dev" }), "bug")).toBeNull();
        expect(meldungsKanal(konfig({ DISCORD_BOT_TOKEN: "" }), "bug")).toBeNull();
        expect(meldungsKanal(konfig({ DISCORD_BUG_KANAL: "" }), "bug")).toBeNull();
        expect([BUG_KANAL, IDEE_KANAL]).not.toContain(BERICHT_KANAL);
    });

    it("🔴 postet in den Kanal seines Befehls und sonst nirgends: /bug in den Bug-Kanal, /idee in den Ideenkanal", async () => {
        const bug = gestellt();
        expect(await postMeldung(konfig(), eingabe(), () => undefined, bug.rest)).toBe("gepostet");
        expect(bug.gesendet.map((g) => g.kanal)).toEqual([BUG_KANAL]);
        const idee = gestellt();
        expect(await postMeldung(konfig(), eingabe({ befehl: "idee" }), () => undefined, idee.rest)).toBe("gepostet");
        expect(idee.gesendet.map((g) => g.kanal)).toEqual([IDEE_KANAL]);
        expect(idee.gesendet[0]!.nachricht.content.startsWith("💡 **Neue Idee** #123")).toBe(true);
    });

    it("🔴 ohne Wert, auf Production, lokal oder ohne Schlüssel wird nichts gepostet", async () => {
        for (const env of [
            { DISCORD_BUG_KANAL: "" },
            { AVESMAPS_ENV: "production" },
            { AVESMAPS_ENV: "development" },
            { RELEASE_ID: "dev" },
            { DISCORD_BOT_TOKEN: "" },
        ]) {
            const stumm = gestellt();
            expect(await postMeldung(konfig(env), eingabe(), () => undefined, stumm.rest)).toBe("kein_kanal");
            expect(stumm.gesendet).toEqual([]);
        }
    });

    it("🔴 schlägt der Post fehl, wirft nichts: die Art des Fehlers kommt ins Protokoll, nie der Text, der Schlüssel oder die Kennung", async () => {
        const gemeldet: string[] = [];
        const melde = (art: string): void => void gemeldet.push(art);
        for (const antwort of [
            { art: "abgelehnt", status: 403, meldung: "Missing Access" },
            { art: "ratelimit", nachSekunden: 2, global: false },
            { art: "stoerung", status: 502 },
            { art: "unklar", grund: "Zeitüberschreitung" },
        ] as const) {
            expect(await postMeldung(konfig(), eingabe(), melde, gestellt([antwort]).rest)).toBe("fehlgeschlagen");
        }
        const wirft: DiscordRest = {
            async sende() {
                throw new TypeError("kaputt mit " + TOKEN);
            },
            async suche() {
                return { art: "nicht_gefunden" };
            },
        };
        expect(await postMeldung(konfig(), eingabe(), melde, wirft)).toBe("fehlgeschlagen");
        expect(gemeldet).toEqual(["abgelehnt (HTTP 403)", "ratelimit", "stoerung", "unklar", "TypeError"]);
        expect(JSON.stringify(gemeldet)).not.toMatch(/Gareth|SCHLUESSEL|Missing Access|\d{17}/u);
    });

    it("🔴 über das echte REST mit gestelltem fetch: Kanal in der Adresse, Schlüssel nur im Kopf, allowed_mentions nur mit der Person, nonce und enforce_nonce", async () => {
        const gesehen: { url: string; init: RequestInit }[] = [];
        const k = {
            ...konfig(),
            abruf: async (url: string, init: RequestInit) => {
                gesehen.push({ url, init });
                return new Response(JSON.stringify({ id: "1430000000000000009" }), { status: 200 });
            },
        };
        expect(await postMeldung(k, eingabe(), () => undefined)).toBe("gepostet");
        expect(gesehen).toHaveLength(1);
        expect(gesehen[0]!.url).toBe(`https://discord.com/api/v10/channels/${BUG_KANAL}/messages`);
        const kopf = gesehen[0]!.init.headers as Record<string, string>;
        expect(kopf["authorization"]).toBe(`Bot ${TOKEN}`);
        const rumpf = JSON.parse(String(gesehen[0]!.init.body)) as DiscordNachricht;
        expect(rumpf.allowed_mentions).toEqual({ parse: [], users: [PERSON] });
        expect(rumpf.nonce).toBe(postNonce(eingabe().interaktionsId));
        expect(rumpf.enforce_nonce).toBe(true);
        expect(rumpf.flags).toBe(4);
        expect(JSON.stringify(rumpf)).not.toContain(TOKEN);
        // Das echte REST und der Bericht benutzen dieselbe Funktion: Der Bericht sendet weiter ohne jede Erlaubnis.
        expect(discordRest).toBeTypeOf("function");
    });
});
