import { generateKeyPairSync, sign } from "node:crypto";

/**
 * Ein eigenes Ed25519-Schlüsselpaar für die Befehle (WI-0255 Paket 2): Der Test spielt Discord, signiert wie Discord (`Zeitstempel + Rumpf`) und
 * gibt der App nur den öffentlichen Schlüssel, als Hex wie im Portal. Jeder Testlauf erzeugt ein neues Paar; kein Schlüssel steht im Repository.
 */

const paar = generateKeyPairSync("ed25519");
/** Ein zweites Paar: Eine Anfrage, die damit signiert ist, stammt nicht von „unserem“ Discord. */
const fremd = generateKeyPairSync("ed25519");

/** Die 32 Bytes hinter dem festen SPKI-Kopf (12 Bytes), als Hex: so nennt Discord den Public Key. */
const hex = (schluessel: typeof paar.publicKey): string =>
    schluessel.export({ format: "der", type: "spki" }).subarray(12).toString("hex");

export const DISCORD_TEST_SCHLUESSEL = hex(paar.publicKey);
export const DISCORD_FREMDER_SCHLUESSEL = hex(fremd.publicKey);
export const DISCORD_TEST_ANWENDUNG = "1523674862038683689";

export function signaturKoepfe(
    rumpf: string,
    optionen: { zeit?: string; fremd?: boolean } = {},
): Record<string, string> {
    const zeit = optionen.zeit ?? String(Math.floor(Date.now() / 1000));
    const signatur = sign(null, Buffer.from(zeit + rumpf, "utf8"), (optionen.fremd === true ? fremd : paar).privateKey);
    return {
        "content-type": "application/json",
        "x-signature-ed25519": signatur.toString("hex"),
        "x-signature-timestamp": zeit,
        "user-agent": "Discord-Interactions/1.0 (+https://discord.com)",
    };
}

let laufend = 0n;
/** Eine neue Kennung im Format von Discord (19 Ziffern), je Aufruf eine andere. */
export const snowflake = (): string => String(1_400_000_000_000_000_000n + (laufend += 1n));

export const PERSON = {
    id: "1100000000000000001",
    username: "rondrikan",
    global_name: "Rondrikan",
    discriminator: "0",
};

/** Was Discord in einem Server mitschickt: das Mitglied mit Spitznamen und die Person darin. */
export const mitglied = (
    nick: string | null = "Rondrikan vom Rhodenstein",
    person: Record<string, unknown> = PERSON,
): Record<string, unknown> => ({
    member: { nick, roles: [], user: person },
    guild_id: "2000000000000000001",
    channel_id: "2000000000000000002",
});

export function ping(): Record<string, unknown> {
    return { id: snowflake(), type: 1, application_id: DISCORD_TEST_ANWENDUNG, token: "ping-token", version: 1 };
}

export function befehl(name: string, wer: Record<string, unknown> = mitglied()): Record<string, unknown> {
    return {
        id: snowflake(),
        type: 2,
        application_id: DISCORD_TEST_ANWENDUNG,
        token: `token-${snowflake()}`,
        version: 1,
        data: { id: snowflake(), name, type: 1 },
        ...wer,
    };
}

/** Ein abgeschicktes Formular in der klassischen Form (Zeilen mit je einem Textfeld). */
export function abgeschickt(
    name: string,
    werte: Record<string, string>,
    optionen: { wer?: Record<string, unknown>; id?: string; neueForm?: boolean } = {},
): Record<string, unknown> {
    const felder = Object.entries(werte).map(([custom_id, value]) =>
        optionen.neueForm === true
            ? { type: 18, id: 1, component: { type: 4, id: 2, custom_id, value } }
            : { type: 1, components: [{ type: 4, custom_id, value }] },
    );
    return {
        id: optionen.id ?? snowflake(),
        type: 5,
        application_id: DISCORD_TEST_ANWENDUNG,
        token: `token-${snowflake()}`,
        version: 1,
        data: { custom_id: `avesmaps:${name}`, components: felder },
        ...(optionen.wer ?? mitglied()),
    };
}
