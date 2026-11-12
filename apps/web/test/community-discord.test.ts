import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/auth/api.ts";
import { readEntry } from "../src/auth/entry.ts";
import { ladeDiscord, ladeModulStand, loeseDiscord } from "../src/community/api.ts";
import {
    DISCORD_PARAMETER,
    MELDER_ERGEBNISSE,
    ergebnisSatz,
    istMelderErgebnis,
    merkeSchluessel,
    nimmSchluessel,
    verbindeMitDiscord,
} from "../src/community/discord-verbinden.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italienisch } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";

/**
 * „Mit Discord verbinden“ für Melder auf der Seite der Besucher (WI-0268 C8; Fachkonzept §8.3 und §8.4): der Sprung zu Discord (Schlüssel im Rumpf, nie in einer Adresse), der Schlüssel im Speicher dieses Tabs
 * für die Rückkehr, die Rückkehr selbst (`/meldung?discord=<Ergebnis>`), „Verbindung lösen“ und der Stand des Moduls. Die Bauteile (`discord-verbinden.vue`) prüfen der Typcheck und die Browserfälle.
 */

const SCHLUESSEL = "A".repeat(43);
const START = "https://discord.com/oauth2/authorize?client_id=1&state=abc";

/** Ein Speicher im Kleinen, wie `sessionStorage`. */
function speicher(): Storage & { inhalt: Map<string, string> } {
    const inhalt = new Map<string, string>();
    return {
        inhalt,
        get length() {
            return inhalt.size;
        },
        clear: () => inhalt.clear(),
        getItem: (key: string) => inhalt.get(key) ?? null,
        key: (index: number) => [...inhalt.keys()][index] ?? null,
        removeItem: (key: string) => void inhalt.delete(key),
        setItem: (key: string, value: string) => void inhalt.set(key, value),
    };
}

interface Aufruf {
    url: string;
    methode: string;
    body: unknown;
}

function holer(antworten: Response[]): { fetcher: typeof fetch; aufrufe: Aufruf[] } {
    const aufrufe: Aufruf[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        aufrufe.push({
            url: String(url),
            methode: init?.method ?? "GET",
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        const naechste = antworten.shift();
        if (naechste === undefined) throw new Error("keine Antwort vorbereitet");
        return naechste;
    }) as typeof fetch;
    return { fetcher, aufrufe };
}
const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("🔴 der Sprung zu Discord", () => {
    it("der Server legt den Umweg an: Zweck `melder`, der Schlüssel im Rumpf und in keiner Adresse; dann erst wird gemerkt und gesprungen", async () => {
        const { fetcher, aufrufe } = holer([json(200, { authorizeUrl: START })]);
        const ort = speicher();
        const ziele: string[] = [];
        await verbindeMitDiscord(SCHLUESSEL, {
            fetcher,
            gehe: (adresse) => ziele.push(adresse),
            speicher: ort,
            jetzt: () => 1000,
        });
        expect(aufrufe).toHaveLength(1);
        expect(aufrufe[0]).toMatchObject({
            url: "/api/auth/discord/start",
            methode: "POST",
            body: { purpose: "melder", schluessel: SCHLUESSEL },
        });
        expect(aufrufe[0]!.url).not.toContain(SCHLUESSEL);
        expect(ziele).toEqual([START]);
        expect(ziele[0]).not.toContain(SCHLUESSEL);
        // Der Schlüssel liegt für die Rückkehr im Speicher dieses Tabs.
        expect(ort.inhalt.size).toBe(1);
        expect(nimmSchluessel(2000, ort)).toBe(SCHLUESSEL);
    });

    it("scheitert der Start (404, Netz), bleibt die Seite stehen und nichts ist gemerkt", async () => {
        const ort = speicher();
        const ziele: string[] = [];
        const { fetcher } = holer([json(404, { error: { code: "community_not_found", message: "x" } })]);
        await expect(
            verbindeMitDiscord(SCHLUESSEL, { fetcher, gehe: (a) => ziele.push(a), speicher: ort }),
        ).rejects.toBeInstanceOf(ApiFailure);
        expect(ziele).toEqual([]);
        expect(ort.inhalt.size).toBe(0);
    });
});

describe("🔴 der Schlüssel für die Rückkehr", () => {
    it("einmal lesbar: danach ist er gelöscht", () => {
        const ort = speicher();
        merkeSchluessel(SCHLUESSEL, 1000, ort);
        expect(nimmSchluessel(1500, ort)).toBe(SCHLUESSEL);
        expect(nimmSchluessel(1500, ort)).toBeNull();
        expect(ort.inhalt.size).toBe(0);
    });

    it("länger als 15 Minuten oder aus der Zukunft gilt nicht; verstümmelt auch nicht; und gelöscht ist er trotzdem", () => {
        const ort = speicher();
        merkeSchluessel(SCHLUESSEL, 1000, ort);
        expect(nimmSchluessel(1000 + 15 * 60_000 + 1, ort)).toBeNull();
        expect(ort.inhalt.size).toBe(0);
        merkeSchluessel(SCHLUESSEL, 5000, ort);
        expect(nimmSchluessel(4000, ort)).toBeNull();
        ort.setItem("avesmaps3d.community-schluessel", "kein json");
        expect(nimmSchluessel(1000, ort)).toBeNull();
        merkeSchluessel("zu-kurz", 1000, ort);
        expect(nimmSchluessel(1000, ort)).toBeNull();
    });

    it("ohne Speicher (gesperrt) ist es kein Fehler: kein Schlüssel", () => {
        const kaputt = {
            getItem: () => {
                throw new Error("gesperrt");
            },
            setItem: () => {
                throw new Error("gesperrt");
            },
            removeItem: () => undefined,
        } as unknown as Storage;
        expect(() => merkeSchluessel(SCHLUESSEL, 1000, kaputt)).not.toThrow();
        expect(nimmSchluessel(1000, kaputt)).toBeNull();
    });
});

describe("🔴 die Rückkehr von Discord: `/meldung?discord=<Ergebnis>`", () => {
    it("trägt nur das Ergebnis, keinen Schlüssel: Die Adresse danach ist die der Karte ohne den Parameter", () => {
        const entry = readEntry({ pathname: "/meldung", search: `?${DISCORD_PARAMETER}=verbunden`, hash: "" });
        expect(entry).toEqual({ link: null, outcome: null, url: "/", status: null, discord: "verbunden" });
        // Die Sprache bleibt in der Adresse, der Parameter nicht.
        expect(readEntry({ pathname: "/meldung", search: "?lang=en&discord=abgebrochen", hash: "" }).url).toBe(
            "/?lang=en",
        );
    });

    it("jedes Ergebnis des Servers ist bekannt; ein fremdes Wort zählt nicht und steht nicht in der Entry", () => {
        for (const ergebnis of MELDER_ERGEBNISSE)
            expect(readEntry({ pathname: "/meldung", search: `?discord=${ergebnis}`, hash: "" }).discord).toBe(
                ergebnis,
            );
        for (const fremd of ["ok", "<script>", "", "VERBUNDEN"]) {
            expect(istMelderErgebnis(fremd)).toBe(false);
            expect(
                readEntry({ pathname: "/meldung", search: `?discord=${encodeURIComponent(fremd)}`, hash: "" }),
            ).not.toHaveProperty("discord");
        }
        // Auf jeder anderen Adresse gibt es den Parameter nicht (nur `/meldung` kennt ihn).
        expect(readEntry({ pathname: "/", search: "?discord=verbunden", hash: "" })).not.toHaveProperty("discord");
    });

    it("ein Link mit Schlüssel im Fragment ohne den Parameter bleibt, wie er war", () => {
        const entry = readEntry({ pathname: "/meldung", search: "", hash: `#${SCHLUESSEL}` });
        expect(entry).toEqual({ link: null, outcome: null, url: "/", status: SCHLUESSEL });
    });

    it("jedes Ergebnis hat einen Satz in allen neun Tafeln; Gutes ist `success`, der Rest `warning`", () => {
        const tafeln = { de, en, es, fr, it: italienisch, nl, pl, sv, da };
        for (const ergebnis of MELDER_ERGEBNISSE) {
            const { key, ton } = ergebnisSatz(ergebnis);
            expect(ton).toBe(ergebnis === "verbunden" ? "success" : "warning");
            for (const [sprache, tafel] of Object.entries(tafeln))
                expect((tafel as Record<string, string>)[key], `${sprache} ${key}`).toBeTruthy();
        }
    });
});

describe("Texte in allen neun Tafeln", () => {
    it("Name der Verbindung und Discord-Zeile der Redaktion tragen {name}; die Erklärung nennt /offen und /erledigt", () => {
        const tafeln = { de, en, es, fr, it: italienisch, nl, pl, sv, da } as Record<string, Record<string, string>>;
        for (const [sprache, tafel] of Object.entries(tafeln)) {
            expect(tafel["community.discord.verbunden"], sprache).toContain("{name}");
            expect(tafel["community.redaktion.melder.discord"], sprache).toContain("{name}");
            for (const key of ["community.discord.erklaerung", "community.discord.verbundenErklaerung"]) {
                expect(tafel[key], `${sprache} ${key}`).toContain("/offen");
                expect(tafel[key], `${sprache} ${key}`).toContain("/erledigt");
            }
            expect(tafel["community.discord.loesenErklaerung"], sprache).toContain("/offen");
        }
        // Der Satz aus Fachkonzept §8.3: Alltagssprache, was gespeichert wird, ohne Anrede.
        expect(de["community.discord.erklaerung"]).toContain("Gespeichert werden nur Discord-Kennung und Anzeigename");
        expect(de["community.discord.loesenErklaerung"]).toContain("für alle Meldungen dieser Verbindung");
    });
});

describe("Lösen und der Stand des Moduls", () => {
    it("„Verbindung lösen“ geht an den Weg der Statusseite und trägt den Schlüssel im Rumpf", async () => {
        const { fetcher, aufrufe } = holer([json(200, { geloest: 2 })]);
        expect(await loeseDiscord(SCHLUESSEL, fetcher)).toEqual({ geloest: 2 });
        expect(aufrufe[0]).toMatchObject({
            url: "/api/community/status/discord-loesen",
            methode: "POST",
            body: { schluessel: SCHLUESSEL },
        });
        expect(aufrufe[0]!.url).not.toContain(SCHLUESSEL);
    });

    it("der Stand: `discord` nur bei einem klaren Ja; eine fehlende oder kaputte Antwort ist ein Nein", async () => {
        expect(
            await ladeModulStand(holer([json(200, { meldungen: true, mailweg: false, discord: true })]).fetcher),
        ).toEqual({
            meldungen: true,
            mailweg: false,
            discord: true,
        });
        expect(await ladeDiscord(holer([json(200, { meldungen: true, mailweg: true, discord: false })]).fetcher)).toBe(
            false,
        );
        // Ein älterer Server kennt das Feld nicht.
        expect(await ladeDiscord(holer([json(200, { meldungen: true, mailweg: true })]).fetcher)).toBe(false);
        expect(
            await ladeDiscord(holer([json(503, { error: { code: "community_unavailable", message: "x" } })]).fetcher),
        ).toBe(false);
    });
});
