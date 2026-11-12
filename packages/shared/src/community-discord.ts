import { Type, type Static } from "@sinclair/typebox";

/**
 * Die Brücke von der Stage nach Production für Website-Meldungen in Discord (WI-0268 C8; Fachkonzept
 * `project-control/planning/community-fachkonzept.md` §8.3a, Betriebsvertrag `project-control/handovers/2026-10-31-wi0268-c8-discord-bruecke-an-claudio.md`).
 *
 * Der Bot lebt auf der Stage, Website-Meldungen liegen in Production. Vali 2026-10-31: „Ja, über Production (A)“. Die Stage fragt Production mit einem
 * gemeinsamen Dienstschlüssel (Secret `COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL` in beiden Umgebungen, nie in der Datenbank) nach den offenen Meldungen
 * einer Discord-Kennung und darf eine eigene zurückziehen. Production antwortet nur mit Nummer, Stand in Alltagssprache und Kurztitel: **nie** mit
 * Meldetext, Namen, Adressen oder der Discord-Kennung. Dieser Vertrag gilt für beide Seiten; die Stage ruft (`apps/server/src/discord/community-bruecke.ts`),
 * Production prüft die Signatur und antwortet (folgt mit C8, Production-Seite).
 *
 * - **Signatur:** HMAC-SHA256 (hex) über `<zeit>\n<rumpf>`, `zeit` = Unix-Millisekunden, `rumpf` = die Bytes des Rumpfes, genau wie gesendet. Production
 *   muss den ROHEN Rumpf prüfen (nicht den neu serialisierten). Kopfzeilen `X-Avesmaps-Zeit` und `X-Avesmaps-Signatur`. Eine Signatur ist höchstens
 *   60 s alt (`COMMUNITY_DISCORD_MAX_ALTER_MS`); aus der Zukunft werden nur wenige Sekunden Uhrabweichung geduldet.
 * - 🪤 **WebCrypto statt `node:crypto`:** Dieses Paket wird auch ins Browserbündel gezogen (`index.ts`). Ein `import … from "node:crypto"` bräche dort den
 *   Entwicklungsserver und den Bau. `crypto.subtle` gibt es in Node ≥ 19 und im Browser gleich, darum sind `signiere` und `pruefeSignatur` asynchron.
 *   Der Vergleich ist `subtle.verify`: zeitkonstant, und eine Signatur falscher Länge ist einfach `false`, kein Fehler.
 * - Production antwortet auf jede abgelehnte Signatur gleich (401), ohne zu sagen, ob Schlüssel, Zeit oder Rumpf der Grund war.
 * - Fehlt der Schlüssel auf einer Seite oder ist er kürzer als 32 Zeichen, ist die Brücke aus; `/offen` zeigt dann nur die Discord-Fälle.
 */

export const COMMUNITY_DISCORD_OFFEN_PFAD = "/api/community/discord/offen";
export const COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD = "/api/community/discord/zurueckziehen";

/** Unix-Millisekunden, als Dezimalzahl im Text. */
export const COMMUNITY_DISCORD_ZEIT_KOPF = "X-Avesmaps-Zeit";
/** Hex-HMAC-SHA256 (64 Zeichen) über `<zeit>\n<rumpf>`. */
export const COMMUNITY_DISCORD_SIGNATUR_KOPF = "X-Avesmaps-Signatur";

/** Höchstes Alter einer Signatur. */
export const COMMUNITY_DISCORD_MAX_ALTER_MS = 60_000;
/** Wie weit die Zeit der Stage der von Production vorausgehen darf (Uhrabweichung zweier Rechner). */
export const COMMUNITY_DISCORD_MAX_VORAUS_MS = 5_000;
/** Ein Schlüssel unter dieser Länge (Zeichen) gilt nicht: Die Brücke bleibt aus. Empfohlen sind 32 Zufallsbytes als Hex (64 Zeichen). */
export const COMMUNITY_DISCORD_SCHLUESSEL_MIN = 32;
/** So viele Zeilen liefert Production höchstens je Anfrage. */
export const COMMUNITY_DISCORD_ZEILEN_MAX = 20;
/** Die Länge des Kurztitels, die Production höchstens liefert (Kategorie und Bezugsname). */
export const COMMUNITY_DISCORD_KURZTITEL_MAX = 200;
/** Der Rumpf einer Anfrage ist winzig; Production lehnt mehr ab. */
export const COMMUNITY_DISCORD_RUMPF_GRENZE = 2048;

/**
 * Der Stand einer Meldung des Melders: die drei offenen und, seit WI-0297 (Vali wählte am 2026-11-09 Option B, die letzte Antwort der Redaktion in `/offen`), `abgeschlossen` für eine
 * Meldung, die in den letzten `COMMUNITY_DISCORD_ANTWORT_TAGE` Tagen mit einer Antwort an den Melder endete. Sonst läse er die Antwort auf eine Anfrage, die die Redaktion gleich ins
 * Archiv legt, nirgends.
 */
export const COMMUNITY_DISCORD_STAENDE = ["eingegangen", "in_bearbeitung", "rueckfrage", "abgeschlossen"] as const;
export type CommunityDiscordStand = (typeof COMMUNITY_DISCORD_STAENDE)[number];

/** Was Production auf „zurückziehen“ antwortet. Eine fremde und eine unbekannte Nummer sind beide `nicht_gefunden`. */
export const COMMUNITY_DISCORD_ERGEBNISSE = ["zurueckgezogen", "nicht_gefunden", "schon_abgeschlossen"] as const;
export type CommunityDiscordErgebnis = (typeof COMMUNITY_DISCORD_ERGEBNISSE)[number];

const strict = { additionalProperties: false } as const;
const literals = <const T extends string>(werte: readonly T[]) => Type.Union(werte.map((wert) => Type.Literal(wert)));

/** Eine Discord-Kennung (Snowflake): 17 bis 20 Ziffern. */
export const COMMUNITY_DISCORD_KENNUNG_MUSTER = "^\\d{17,20}$";
/** Die Nummer einer Website-Meldung: `COM-` und mindestens sechs Stellen (`COM-000123`). */
export const COMMUNITY_DISCORD_NUMMER_MUSTER = "^COM-\\d{6,12}$";

const Kennung = Type.String({ pattern: COMMUNITY_DISCORD_KENNUNG_MUSTER });
const Nummer = Type.String({ pattern: COMMUNITY_DISCORD_NUMMER_MUSTER });

export const CommunityDiscordOffenAnfrage = Type.Object({ discordId: Kennung }, strict);
export type CommunityDiscordOffenAnfrage = Static<typeof CommunityDiscordOffenAnfrage>;

export const CommunityDiscordZurueckziehenAnfrage = Type.Object({ discordId: Kennung, nummer: Nummer }, strict);
export type CommunityDiscordZurueckziehenAnfrage = Static<typeof CommunityDiscordZurueckziehenAnfrage>;

/** So lange zeigt `/offen` eine abgeschlossene Meldung mit ihrer Antwort (Tage nach dem Abschluss). */
export const COMMUNITY_DISCORD_ANTWORT_TAGE = 30;
/** So lang ist die Antwort der Redaktion höchstens, die Production liefert (Zeichen); länger endet sie mit „…“. Die Stage kürzt für die Nachricht weiter. */
export const COMMUNITY_DISCORD_ANTWORT_MAX = 1500;

/**
 * Eine Meldung des Melders. Nie ein Meldetext, nie ein Name: Nummer, Stand und Kurztitel, dazu seit WI-0297 die letzte Nachricht der Redaktion an IHN (Antwort oder Rückfrage),
 * wenn es eine gibt. 🔴 Production liefert sie nur zur eigenen Kennung, und `/offen` zeigt sie nur ihm (`NUR_FUER_MELDENDE`). Dieselben Nachrichten sieht er auch auf der Statusseite.
 */
export const CommunityDiscordZeile = Type.Object(
    {
        nummer: Nummer,
        stand: literals(COMMUNITY_DISCORD_STAENDE),
        kurztitel: Type.String({ maxLength: COMMUNITY_DISCORD_KURZTITEL_MAX }),
        antwort: Type.Optional(
            Type.Object(
                { text: Type.String({ minLength: 1, maxLength: COMMUNITY_DISCORD_ANTWORT_MAX }), at: Type.String() },
                strict,
            ),
        ),
    },
    strict,
);
export type CommunityDiscordZeile = Static<typeof CommunityDiscordZeile>;

export const CommunityDiscordOffenAntwort = Type.Object(
    { zeilen: Type.Array(CommunityDiscordZeile, { maxItems: COMMUNITY_DISCORD_ZEILEN_MAX }) },
    strict,
);
export type CommunityDiscordOffenAntwort = Static<typeof CommunityDiscordOffenAntwort>;

export const CommunityDiscordZurueckziehenAntwort = Type.Object(
    { ergebnis: literals(COMMUNITY_DISCORD_ERGEBNISSE) },
    strict,
);
export type CommunityDiscordZurueckziehenAntwort = Static<typeof CommunityDiscordZurueckziehenAntwort>;

// --- An die Community weiterleiten (WI-0297) ------------------------------------------------------------------------------------------

/**
 * Der dritte Weg der Brücke (WI-0297; Vali 2026-11-09 zu OPS-000097: „ist eigentlich eine communitymeldung“): Ein Betreiber leitet bei der Sichtung im Kanal der
 * Stage eine Meldung aus Discord an die Redaktion weiter. Production legt daraus eine Anfrage mit Eingang `discord` an und nennt die COM-Nummer; erst dann endet der
 * Kanalvorgang. Dieselbe `operationId` ergibt denselben Vorgang (die Stage leitet sie aus Umgebung und OPS-Nummer ab).
 *
 * - Die Discord-Kennung geht hier mit, weil sie der Rückweg zum Melder ist (`/offen`, `/erledigt meldung:` lesen sie in Production, Fachkonzept §8.3a). Sie steht in
 *   keiner Antwort und keinem Protokoll.
 * - Bilder sind die fertigen Fassungen `ansicht` des Kanals (WebP, ohne Metadaten), Base64. Production prüft sie wie jedes Bild und legt sie in die Ablage.
 */
export const COMMUNITY_DISCORD_UEBERNEHMEN_PFAD = "/api/community/discord/uebernehmen";
/** So viele Bilder gehen höchstens mit. */
export const COMMUNITY_DISCORD_BILDER_MAX = 4;
/** So groß ist ein Bild höchstens (Bytes, vor Base64). */
export const COMMUNITY_DISCORD_BILD_MAX_BYTES = 3 * 1024 * 1024;
/** Alle Bilder zusammen höchstens (Bytes, vor Base64); Base64 macht daraus ein Drittel mehr, die Grenze des Rumpfes liegt darüber. */
export const COMMUNITY_DISCORD_BILDER_MAX_BYTES = 6 * 1024 * 1024;
/** Die Grenze des Rumpfes dieses Wegs (Bytes): Bilder in Base64 und Text. */
export const COMMUNITY_DISCORD_UEBERNAHME_GRENZE = 9 * 1024 * 1024;
/** Die Arten einer Meldung aus Discord (`/bug`, `/idee`, `/frage`), wie der Kanal sie führt. */
export const COMMUNITY_DISCORD_ARTEN = ["bug", "idee", "nutzerfrage"] as const;
export type CommunityDiscordArt = (typeof COMMUNITY_DISCORD_ARTEN)[number];
/** Die Nachricht in der Redaktion: Titel, Leerzeile, Text; höchstens so viele Zeichen (die Tafel `nachricht`). */
export const COMMUNITY_DISCORD_NACHRICHT_MAX = 4000;

export const CommunityDiscordUebernehmenAnfrage = Type.Object(
    {
        operationId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        ops: Type.String({ pattern: "^OPS-\\d{6,12}$" }),
        discordId: Type.Union([Kennung, Type.Null()]),
        name: Type.String({ minLength: 1, maxLength: 80 }),
        art: literals(COMMUNITY_DISCORD_ARTEN),
        titel: Type.String({ minLength: 1, maxLength: 200 }),
        text: Type.String({ minLength: 1, maxLength: 8000 }),
        bilder: Type.Array(
            Type.Object(
                {
                    daten: Type.String({
                        minLength: 4,
                        maxLength: Math.ceil(COMMUNITY_DISCORD_BILD_MAX_BYTES / 3) * 4,
                        pattern: "^[A-Za-z0-9+/]+={0,2}$",
                    }),
                },
                strict,
            ),
            { maxItems: COMMUNITY_DISCORD_BILDER_MAX },
        ),
    },
    strict,
);
export type CommunityDiscordUebernehmenAnfrage = Static<typeof CommunityDiscordUebernehmenAnfrage>;

export const CommunityDiscordUebernehmenAntwort = Type.Object({ nummer: Nummer }, strict);
export type CommunityDiscordUebernehmenAntwort = Static<typeof CommunityDiscordUebernehmenAntwort>;

/** „Titel“, Leerzeile, Text; auf die Länge der Tafel gekürzt, am Ende mit „…“. Wiederholt der Text nur den Titel, steht er allein. */
export function communityNachrichtAusDiscord(titel: string, text: string): string {
    const kopf = titel.trim();
    const rumpf = text.trim();
    const ganz = rumpf === "" || rumpf === kopf ? kopf : kopf === "" ? rumpf : `${kopf}\n\n${rumpf}`;
    const zeichen = [...ganz];
    return zeichen.length <= COMMUNITY_DISCORD_NACHRICHT_MAX
        ? ganz
        : `${zeichen
              .slice(0, COMMUNITY_DISCORD_NACHRICHT_MAX - 1)
              .join("")
              .trimEnd()}…`;
}

// --- Signatur -------------------------------------------------------------------------------------------------------------------------

/** Taugt der Schlüssel? Mindestens 32 Zeichen; kürzere gelten auf beiden Seiten als „nicht gesetzt“. */
export const brueckeSchluesselTaugt = (schluessel: unknown): schluessel is string =>
    typeof schluessel === "string" && schluessel.length >= COMMUNITY_DISCORD_SCHLUESSEL_MIN;

const kodierer = new TextEncoder();
const HEX_SIGNATUR = /^[0-9a-f]{64}$/iu;
const ZEIT = /^\d{1,16}$/u;

/** `<zeit>\n<rumpf>` als Bytes. */
function nachrichtAus(zeit: string, rumpf: string | Uint8Array): Uint8Array<ArrayBuffer> {
    const kopf = kodierer.encode(`${zeit}\n`);
    const koerper = typeof rumpf === "string" ? kodierer.encode(rumpf) : rumpf;
    const aus = new Uint8Array(kopf.length + koerper.length);
    aus.set(kopf, 0);
    aus.set(koerper, kopf.length);
    return aus;
}

const hmacSchluessel = (schluessel: string, zweck: "sign" | "verify"): Promise<CryptoKey> =>
    crypto.subtle.importKey("raw", kodierer.encode(schluessel), { name: "HMAC", hash: "SHA-256" }, false, [zweck]);

const hex = (bytes: ArrayBuffer): string =>
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function ausHex(text: string): Uint8Array<ArrayBuffer> {
    const aus = new Uint8Array(text.length / 2);
    for (let i = 0; i < aus.length; i += 1) aus[i] = Number.parseInt(text.slice(2 * i, 2 * i + 2), 16);
    return aus;
}

/**
 * Die Signatur einer Anfrage: kleingeschriebenes Hex von HMAC-SHA256 über `<zeit>\n<rumpf>`. `zeit` ist Unix-Millisekunden; `rumpf` genau das, was
 * gesendet wird (Text oder Bytes). Wirft bei einem Schlüssel unter 32 Zeichen oder einer Zeit, die keine Zahl ist: Das ist ein Fehler des Aufrufers.
 */
export async function signiere(schluessel: string, zeit: number | string, rumpf: string | Uint8Array): Promise<string> {
    if (!brueckeSchluesselTaugt(schluessel)) throw new RangeError("Der Schlüssel der Brücke ist zu kurz.");
    const zeitText = String(zeit);
    if (!ZEIT.test(zeitText)) throw new RangeError("Die Zeit der Brücke ist keine Zahl.");
    const signatur = await crypto.subtle.sign(
        "HMAC",
        await hmacSchluessel(schluessel, "sign"),
        nachrichtAus(zeitText, rumpf),
    );
    return hex(signatur);
}

export type SignaturUrteil = "gueltig" | "ungueltig" | "zu_alt" | "aus_der_zukunft";

/**
 * Stimmt die Signatur einer Anfrage? Die Kopfzeilen kommen so, wie Fastify sie liefert (`unknown`): Was fehlt oder die falsche Form hat, ist
 * `ungueltig`, nie ein Fehler. Erst die Form, dann das Alter (höchstens 60 s alt, höchstens 5 s aus der Zukunft), dann der zeitkonstante
 * Vergleich. 🔴 Wer antwortet, antwortet auf alle vier Urteile außer `gueltig` gleich (401); die Unterscheidung dient nur dem Test und dem Protokoll
 * (ohne Schlüssel, Rumpf und Signatur).
 */
export async function pruefeSignatur(eingabe: {
    schluessel: string;
    zeit: unknown;
    signatur: unknown;
    rumpf: string | Uint8Array;
    /** Unix-Millisekunden; Vorgabe die Uhr. Nur Tests setzen es. */
    jetzt?: number;
}): Promise<SignaturUrteil> {
    const { schluessel, zeit, signatur, rumpf } = eingabe;
    if (!brueckeSchluesselTaugt(schluessel)) return "ungueltig";
    if (typeof zeit !== "string" || !ZEIT.test(zeit)) return "ungueltig";
    if (typeof signatur !== "string" || !HEX_SIGNATUR.test(signatur)) return "ungueltig";
    const abstand = (eingabe.jetzt ?? Date.now()) - Number(zeit);
    if (abstand > COMMUNITY_DISCORD_MAX_ALTER_MS) return "zu_alt";
    if (-abstand > COMMUNITY_DISCORD_MAX_VORAUS_MS) return "aus_der_zukunft";
    const gleich = await crypto.subtle.verify(
        "HMAC",
        await hmacSchluessel(schluessel, "verify"),
        ausHex(signatur),
        nachrichtAus(zeit, rumpf),
    );
    return gleich ? "gueltig" : "ungueltig";
}
