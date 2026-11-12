import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { comNummer, leseCom } from "@avesmaps3d/shared";

/**
 * Die Befehle `/hilfe`, `/bug`, `/idee`, `/frage`, `/offen` und `/erledigt` (WI-0255 Paket 2; Vali 2026-10-26: „Nur in 3D bauen“, Vorgang im Betreiber-Kanal, „Erst
 * sichten“). Hier steht, was ohne Fastify und ohne Datenbank geht: die Signatur von Discord prüfen, eine Interaktion lesen, Texte entschärfen und
 * die Antworten bauen. Der Empfänger ist `routes/discord-interaktionen.ts`, die Liste der Befehle `befehle.ts`.
 *
 * Vorbild ist Legacy (`api/discord/interactions.php`, `api/_internal/discord/{signature,router,responses,endpoint}.php`): Ed25519 über
 * `Zeitstempel + Rumpf`, PING mit PONG, die drei Formulare mit Titel, Beschreibung und „Wo?“, die Antworten nur für die meldende Person. Nicht
 * übernommen: die eigene Fallverwaltung (`discord_cases`) und der Post in einen Kanal je Art. `/offen` und `/erledigt` lesen und schließen Vorgänge
 * im Kanal (`vorgaenge.ts`, Handover `2026-10-30-discord-offen-erledigt-an-claudia.md`).
 *
 * - 🔴 **Keine Pings:** jede Nachricht mit `allowed_mentions: { parse: [] }`; im gespeicherten Text werden `@everyone`, `@here` und die
 *   Erwähnungen von Personen, Rollen und Kanälen entschärft (`entschaerft`). Die Antwort an die meldende Person trägt nie ihren Text, ihren Namen
 *   oder eine Discord-Kennung, nur die Vorgangsnummer.
 * - 🔴 **Daten von Menschen:** Name und Text sind keine Anweisungen. Sie werden bereinigt (Steuer- und Richtungszeichen), begrenzt und landen
 *   `zu_sichten` im Kanal; erst ein Betreiber gibt sie der Routine frei.
 * - Die Texte richten sich an niemanden persönlich und befehlen nichts (Hausregel), soweit ein Formular das zulässt.
 */

export const INTERAKTION = { ping: 1, befehl: 2, komponente: 3, vorschlag: 4, formular: 5 } as const;
export const ANTWORT = { pong: 1, nachricht: 4, aufgeschoben: 5, formular: 9 } as const;
/** `EPHEMERAL`: nur für die Person sichtbar, die den Befehl gab. */
export const NUR_FUER_MELDENDE = 1 << 6;
export const KEINE_PINGS = { parse: [] as never[] };
export const KARTE = "https://avesmaps.de";

/** Die drei Befehle, die einen Vorgang anlegen, und ihre Kategorie im Kanal. */
export const MELDE_BEFEHLE = { bug: "bug", idee: "idee", frage: "nutzerfrage" } as const;
export type MeldeBefehl = keyof typeof MELDE_BEFEHLE;
export type MeldeKategorie = (typeof MELDE_BEFEHLE)[MeldeBefehl];
const FORMULAR_PRAEFIX = "avesmaps:";

// --- Signatur ------------------------------------------------------------------------------------------------------------------------

/** Der feste Kopf eines Ed25519-Schlüssels im SPKI-Format (RFC 8410); dahinter folgen die 32 Bytes, die Discord als Hex nennt. */
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

/** Der öffentliche Schlüssel der Anwendung aus `DISCORD_PUBLIC_KEY` (64 Hex-Zeichen); sonst `undefined`. */
export function oeffentlicherSchluessel(hex: string): KeyObject | undefined {
    if (!/^[0-9a-f]{64}$/iu.test(hex)) return undefined;
    try {
        return createPublicKey({
            key: Buffer.concat([SPKI_ED25519, Buffer.from(hex, "hex")]),
            format: "der",
            type: "spki",
        });
    } catch {
        return undefined;
    }
}

/**
 * Stammt die Anfrage von Discord? Ed25519 über `X-Signature-Timestamp` und den ROHEN Rumpf, genau wie Discord ihn sandte. Fehlt etwas oder hat
 * es die falsche Form, ist die Antwort `false`, nie ein Fehler.
 */
export function signaturGueltig(
    schluessel: KeyObject,
    signatur: unknown,
    zeitstempel: unknown,
    rumpf: Buffer,
): boolean {
    if (typeof signatur !== "string" || !/^[0-9a-f]{128}$/iu.test(signatur)) return false;
    if (typeof zeitstempel !== "string" || !/^\d{1,20}$/u.test(zeitstempel)) return false;
    try {
        return verify(
            null,
            Buffer.concat([Buffer.from(zeitstempel, "utf8"), rumpf]),
            schluessel,
            Buffer.from(signatur, "hex"),
        );
    } catch {
        return false;
    }
}

// --- Lesen ----------------------------------------------------------------------------------------------------------------------------

type Objekt = Record<string, unknown>;
const objekt = (wert: unknown): Objekt | undefined =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert) ? (wert as Objekt) : undefined;
const text = (wert: unknown): string | undefined => (typeof wert === "string" && wert.trim() !== "" ? wert : undefined);
const SNOWFLAKE = /^\d{17,20}$/u;

/** Eine Discord-Kennung (Snowflake) oder `undefined`. */
export const kennung = (wert: unknown): string | undefined =>
    typeof wert === "string" && SNOWFLAKE.test(wert) ? wert : undefined;

/** Eine Interaktion, so weit die App sie braucht. Alles andere aus dem Rumpf wird nicht gelesen. */
export interface Interaktion {
    id: string | undefined;
    typ: number;
    /** Der Befehl (`data.name`) oder das Formular (`data.custom_id`). */
    name: string | undefined;
    formular: string | undefined;
    anwendung: string | undefined;
    token: string | undefined;
    roh: Objekt;
}

export function liesInteraktion(roh: unknown): Interaktion | undefined {
    const o = objekt(roh);
    if (o === undefined || typeof o["type"] !== "number") return undefined;
    const daten = objekt(o["data"]);
    const token =
        typeof o["token"] === "string" && /^[A-Za-z0-9._-]{1,500}$/u.test(o["token"]) ? o["token"] : undefined;
    return {
        id: kennung(o["id"]),
        typ: o["type"],
        name: text(daten?.["name"]),
        formular: text(daten?.["custom_id"]),
        anwendung: kennung(o["application_id"]),
        token,
        roh: o,
    };
}

/** Wer meldet: der Anzeigename, wie Discord ihn zeigt, und die Kennung der Person (nur intern). */
export interface Melder {
    name: string;
    kennung: string | null;
}

/**
 * Der Anzeigename (Vali 2026-10-26): im Server der Spitzname (`member.nick`), sonst der globale Name, sonst der Benutzername; in Direktnachrichten
 * `user.*`. Bereinigt und höchstens 80 Zeichen; ohne Namen „unbekannt“.
 */
export function melderAus(interaktion: Interaktion): Melder {
    const mitglied = objekt(interaktion.roh["member"]);
    const person = objekt(mitglied?.["user"]) ?? objekt(interaktion.roh["user"]);
    const roh = text(mitglied?.["nick"]) ?? text(person?.["global_name"]) ?? text(person?.["username"]) ?? "";
    const name = kuerze(einzeilig(entschaerft(roh)), 80);
    return { name: name === "" ? "unbekannt" : name, kennung: kennung(person?.["id"]) ?? null };
}

/**
 * Die Werte eines abgeschickten Formulars: `custom_id` → Text. Gelesen werden die klassischen Zeilen (`components[].components[]`) und die
 * neuere Form mit Beschriftung (`components[].component`), ohne sich auf eine Tiefe festzulegen.
 */
export function formularWerte(interaktion: Interaktion): Record<string, string> {
    const werte: Record<string, string> = {};
    const besuche = (knoten: unknown, tiefe: number): void => {
        if (tiefe > 4) return;
        if (Array.isArray(knoten)) {
            for (const kind of knoten) besuche(kind, tiefe + 1);
            return;
        }
        const o = objekt(knoten);
        if (o === undefined) return;
        if (typeof o["custom_id"] === "string" && typeof o["value"] === "string") werte[o["custom_id"]] = o["value"];
        besuche(o["components"], tiefe + 1);
        besuche(o["component"], tiefe + 1);
    };
    besuche(objekt(interaktion.roh["data"])?.["components"], 0);
    return werte;
}

/** Die Nummer aus `/erledigt nummer:<n>` (Option Typ 4); `undefined`, wo sie fehlt oder keine positive ganze Zahl ist. */
export function nummerAus(interaktion: Interaktion): number | undefined {
    const optionen = objekt(interaktion.roh["data"])?.["options"];
    if (!Array.isArray(optionen)) return undefined;
    for (const option of optionen) {
        const o = objekt(option);
        if (o?.["name"] !== "nummer") continue;
        const wert = o["value"];
        return typeof wert === "number" && Number.isSafeInteger(wert) && wert > 0 ? wert : undefined;
    }
    return undefined;
}

/** Hat der Befehl die Option `name` bekommen, gleich mit welchem Wert? Discord schickt nur Optionen mit Wert. */
export function hatOption(interaktion: Interaktion, name: string): boolean {
    const optionen = objekt(interaktion.roh["data"])?.["options"];
    return Array.isArray(optionen) && optionen.some((option) => objekt(option)?.["name"] === name);
}

/**
 * Die Nummer aus `/erledigt meldung:COM-000123` (Option Typ 3), in der Form der Brücke (`COM-000123`). Gelesen wird großzügig (`com-123` und `123` gehen auch,
 * wie in der Statusseite); `undefined`, wo die Option fehlt oder keine Nummer einer Website-Meldung ist (dann hilft `hatOption`, beides zu trennen).
 */
export function websiteNummerAus(interaktion: Interaktion): string | undefined {
    const optionen = objekt(interaktion.roh["data"])?.["options"];
    if (!Array.isArray(optionen)) return undefined;
    for (const option of optionen) {
        const o = objekt(option);
        if (o?.["name"] !== "meldung") continue;
        const wert = o["value"];
        const nummer = typeof wert === "string" ? leseCom(wert) : undefined;
        return nummer === undefined ? undefined : comNummer(nummer);
    }
    return undefined;
}

/** Der Befehl hinter einem Formular (`avesmaps:bug`) oder `undefined`. */
export function befehlDesFormulars(formular: string | undefined): MeldeBefehl | undefined {
    if (formular === undefined || !formular.startsWith(FORMULAR_PRAEFIX)) return undefined;
    const befehl = formular.slice(FORMULAR_PRAEFIX.length);
    return Object.hasOwn(MELDE_BEFEHLE, befehl) ? (befehl as MeldeBefehl) : undefined;
}

/**
 * Eine stabile Operation aus der Kennung der Interaktion: Kommt dieselbe Interaktion zweimal an, entsteht derselbe Vorgang einmal
 * (`kanal_discord_melden` gibt dann den vorhandenen zurück). Form einer UUID, gebildet aus SHA-256.
 */
export function operationAus(interaktionsId: string): string {
    const h = createHash("sha256").update(`avesmaps-discord-interaktion:${interaktionsId}`).digest("hex");
    const variante = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// --- Entschärfen ------------------------------------------------------------------------------------------------------------------------

/**
 * Erwähnungen ohne Wirkung: `@everyone` und `@here` mit einem unsichtbaren Trenner, Personen, Rollen und Kanäle als Wort (ihre Kennungen
 * gehören Dritten und bleiben draußen). Danach pingt der Text nirgends, auch nicht, wenn ihn später jemand nach Discord kopiert.
 */
export function entschaerft(eingabe: string): string {
    return eingabe
        .replace(/<@&\d+>/gu, "@Rolle")
        .replace(/<@!?\d+>/gu, "@Person")
        .replace(/<#\d+>/gu, "#Kanal")
        .replace(/@(everyone|here)/giu, "@\u200B$1");
}

/** Ohne Steuerzeichen und Richtungsumkehr; Zeilenumbrüche bleiben nur, wo sie dürfen, und höchstens zwei hintereinander. */
function bereinigt(eingabe: string, mehrzeilig: boolean): string {
    let aus = "";
    for (const zeichen of eingabe.replace(/\r\n?/gu, "\n")) {
        const code = zeichen.codePointAt(0)!;
        if (zeichen === "\n") aus += mehrzeilig ? "\n" : " ";
        else if (zeichen === "\t") aus += " ";
        else if (code < 32 || code === 127 || (code >= 0x80 && code < 0xa0)) continue;
        else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
        else aus += zeichen;
    }
    return aus
        .replace(/[ \u00A0]+/gu, " ")
        .replace(/ *\n */gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

const einzeilig = (eingabe: string): string => bereinigt(eingabe, false);
const mehrzeilig = (eingabe: string): string => bereinigt(eingabe, true);

function kuerze(eingabe: string, max: number): string {
    const zeichen = [...eingabe];
    return zeichen.length <= max
        ? eingabe
        : `${zeichen
              .slice(0, max - 1)
              .join("")
              .trimEnd()}…`;
}

/** Was aus einem Formular in den Kanal geht: Titel (höchstens 100), Text samt „Wo:“ (höchstens 6000); ohne Text nichts. */
export interface Meldung {
    titel: string;
    nachricht: string;
}

export function meldungAus(befehl: MeldeBefehl, werte: Record<string, string>): Meldung | undefined {
    const inhalt = kuerze(mehrzeilig(entschaerft(werte["text"] ?? "")), 4000);
    if (inhalt === "") return undefined;
    const ort = kuerze(einzeilig(entschaerft(werte["ort"] ?? "")), 300);
    const titelRoh = befehl === "frage" ? "" : kuerze(einzeilig(entschaerft(werte["titel"] ?? "")), 100);
    const titel = titelRoh !== "" ? titelRoh : kuerze(einzeilig(inhalt.split("\n")[0] ?? ""), 100);
    return { titel, nachricht: ort === "" ? inhalt : `${inhalt}\n\nWo: ${ort}` };
}

// --- Antworten ----------------------------------------------------------------------------------------------------------------------------

export const PONG = { type: ANTWORT.pong } as const;

/** Eine Antwort mit Nachricht (Typ 4). */
export interface NachrichtAntwort {
    readonly type: typeof ANTWORT.nachricht;
    readonly data: { readonly content: string; readonly flags: number; readonly allowed_mentions: typeof KEINE_PINGS };
}

/** Eine Nachricht nur für die meldende Person, ohne Pings. */
export function nachricht(inhalt: string): NachrichtAntwort {
    return {
        type: ANTWORT.nachricht,
        data: { content: inhalt, flags: NUR_FUER_MELDENDE, allowed_mentions: KEINE_PINGS },
    } as const;
}

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Die Antwort nach einem `AUFGESCHOBEN` (Legacy-Spec 2026-08-25, „Modal sofort, Speichern aufgeschoben“): `PATCH` auf die erste Antwort über
 * den Webhook der Interaktion. Kein Bot-Schlüssel; der Token der Interaktion gilt 15 Minuten und steht nur in der Adresse, nie in einem
 * Protokoll. Gibt den HTTP-Status zurück, `0` bei Netzfehler oder Zeitüberschreitung.
 */
export async function folgeantwort(abruf: Abruf, anwendung: string, token: string, inhalt: string): Promise<number> {
    try {
        const antwort = await abruf(
            `https://discord.com/api/v10/webhooks/${anwendung}/${encodeURIComponent(token)}/messages/@original`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json", "user-agent": "DiscordBot (https://avesmaps.de, 1.0)" },
                body: JSON.stringify({ content: inhalt, allowed_mentions: KEINE_PINGS }),
                signal: AbortSignal.timeout(10_000),
            },
        );
        return antwort.status;
    } catch {
        return 0;
    }
}

/** „Avesmaps denkt nach …“, nur für die meldende Person; die Antwort folgt über den Webhook der Interaktion (`folgeantwort`). */
export const AUFGESCHOBEN = {
    type: ANTWORT.aufgeschoben,
    data: { flags: NUR_FUER_MELDENDE, allowed_mentions: KEINE_PINGS },
} as const;

export const HILFE = [
    "**Avesmaps auf Discord**",
    "`/bug` – einen Fehler melden",
    "`/idee` – eine Idee oder einen Wunsch einreichen",
    "`/frage` – eine Frage an die Betreiber",
    "`/offen` – die offenen Meldungen aus Discord und die eigenen von der Website",
    "`/erledigt` – eine eigene Meldung schließen: `nummer:123` für eine aus Discord, `meldung:COM-000123` für eine von der Website",
    "`/hilfe` – diese Übersicht",
    "Jede Meldung bekommt eine Vorgangsnummer und wird von den Betreibern gesichtet. `/bug` und `/idee` erscheinen danach öffentlich im Kanal, mit Erwähnung; mehr dazu unter Hinweise › Datenschutz auf der Karte.",
    `Die Karte: ${KARTE}`,
].join("\n");

const WAS: Record<MeldeBefehl, string> = { bug: "Die Fehlermeldung", idee: "Die Idee", frage: "Die Frage" };
/** Wo eine Meldung öffentlich erscheint (Datenschutzhinweise, von Vali abgenommen 2026-11-03): Das sagen das Formular vorher und der Dank danach. `/frage` postet nie. */
const OEFFENTLICH: Partial<Record<MeldeBefehl, { kanal: string; titel: string }>> = {
    bug: { kanal: "in #bugs", titel: "Fehler melden (öffentlich in #bugs)" },
    idee: { kanal: "im Ideenkanal", titel: "Idee einreichen (öffentlich im Ideenkanal)" },
};

export const SAETZE = {
    eingegangen: (befehl: MeldeBefehl, nummer: string, oeffentlich = false): string => {
        const kanal = oeffentlich ? OEFFENTLICH[befehl]?.kanal : undefined;
        return `Danke. ${WAS[befehl]} ist eingegangen (\`${nummer}\`) und wird von den Betreibern gesichtet.${
            kanal === undefined ? "" : ` Sie steht gleich öffentlich ${kanal}, mit Erwähnung.`
        }`;
    },
    leer: "Die Meldung war leer und wurde nicht gespeichert.",
    grenze: "Für diese Stunde sind schon genug Meldungen eingegangen. Später geht es wieder.",
    gestoert: "Die Meldung ließ sich gerade nicht speichern. Ein späterer Versuch hilft meist.",
    unbekannt: "Diesen Befehl kennt Avesmaps nicht. `/hilfe` zeigt alle Befehle.",
    nichtUnterstuetzt: "Das unterstützt Avesmaps hier nicht. `/hilfe` zeigt alle Befehle.",
    offenLeer: "Gerade ist keine Meldung aus Discord offen.",
    erledigt: (nummer: string): string => `Meldung ${nummer} ist als erledigt geschlossen.`,
    schonGeschlossen: (nummer: string): string => `Meldung ${nummer} ist schon abgeschlossen.`,
    // Für eine fremde und eine unbekannte Nummer derselbe Satz: Er verrät nicht, ob es den Vorgang gibt.
    fremd: (nummer: string): string =>
        `Meldung ${nummer} lässt sich hier nicht schließen. Schließen kann eine Meldung, wer sie geschickt hat, und ein Betreiber.`,
    nummerFehlt:
        "Die Nummer fehlt: `/erledigt nummer:123` für eine Meldung aus Discord, `/erledigt meldung:COM-000123` für eine von der Website.",
    nurEine:
        "Bitte nur eine Angabe machen: entweder `nummer` (Meldung aus Discord) oder `meldung` (Meldung von der Website).",
    websiteNummerUngueltig: "Das ist keine Nummer einer Website-Meldung. Sie sieht so aus: `COM-000123`.",
    websiteKopf: "**Deine Meldungen bei der Redaktion:**",
    // Vor der letzten Nachricht der Redaktion an den Melder (WI-0297), nur in seiner eigenen Antwort auf `/offen`.
    antwortKopf: "Redaktion:",
    websiteHinweis: "`/erledigt meldung:<Nummer>` zieht eine davon zurück.",
    websiteNichtErreichbar: "Die Meldungen bei der Redaktion sind gerade nicht erreichbar.",
    websiteAus: "Meldungen von der Website lassen sich in Discord noch nicht zurückziehen.",
    websiteZurueckNichtErreichbar:
        "Die Meldung ließ sich gerade nicht zurückziehen, die Website ist nicht erreichbar. Ein späterer Versuch hilft meist.",
    websiteZurueckgezogen: (nummer: string): string => `${nummer} ist zurückgezogen.`,
    websiteSchonAbgeschlossen: (nummer: string): string => `${nummer} ist schon abgeschlossen.`,
    // Für eine fremde und eine unbekannte Nummer derselbe Satz: Er verrät nicht, ob es die Meldung gibt oder wem sie gehört.
    websiteNichtGefunden: (nummer: string): string =>
        `${nummer} lässt sich hier nicht zurückziehen. Zurückziehen kann eine Meldung, wer sie geschickt und dabei sein Discord-Konto verbunden hat.`,
} as const;

interface Feld {
    id: "titel" | "text" | "ort";
    label: string;
    stil: 1 | 2;
    pflicht: boolean;
    min?: number;
    max: number;
    platzhalter: string;
}

const ORT: Feld = {
    id: "ort",
    label: "Wo? (Adresse oder Ort, freiwillig)",
    stil: 1,
    pflicht: false,
    max: 300,
    platzhalter: "https://avesmaps.de/#… oder ein Ortsname",
};

/** Die drei Formulare (Legacy: Titel, Beschreibung, „Wo?“; die Frage braucht nur ihren Text). Beschriftungen höchstens 45 Zeichen. */
export const FORMULARE: Record<MeldeBefehl, { titel: string; felder: readonly Feld[] }> = {
    bug: {
        titel: "Fehler melden",
        felder: [
            {
                id: "titel",
                label: "Worum geht es?",
                stil: 1,
                pflicht: true,
                min: 3,
                max: 100,
                platzhalter: "Kurz, etwa: Weg nach Gareth fehlt",
            },
            {
                id: "text",
                label: "Was ist passiert?",
                stil: 2,
                pflicht: true,
                min: 10,
                max: 3000,
                platzhalter: "Was war zu sehen, und was wäre richtig?",
            },
            ORT,
        ],
    },
    idee: {
        titel: "Idee einreichen",
        felder: [
            {
                id: "titel",
                label: "Worum geht es?",
                stil: 1,
                pflicht: true,
                min: 3,
                max: 100,
                platzhalter: "Kurz, etwa: Flussnamen anzeigen",
            },
            {
                id: "text",
                label: "Die Idee",
                stil: 2,
                pflicht: true,
                min: 10,
                max: 3000,
                platzhalter: "Was soll Avesmaps können?",
            },
            ORT,
        ],
    },
    frage: {
        titel: "Frage an die Betreiber",
        felder: [
            {
                id: "text",
                label: "Die Frage",
                stil: 2,
                pflicht: true,
                min: 5,
                max: 2000,
                platzhalter: "Was ist unklar?",
            },
        ],
    },
};

/** Ein Formular (Typ 9): Zeilen mit je einem Textfeld. */
export interface FormularAntwort {
    readonly type: typeof ANTWORT.formular;
    readonly data: {
        readonly custom_id: string;
        readonly title: string;
        readonly components: readonly {
            readonly type: 1;
            readonly components: readonly {
                readonly type: 4;
                readonly custom_id: string;
                readonly label: string;
                readonly style: 1 | 2;
                readonly required: boolean;
                readonly min_length?: number;
                readonly max_length: number;
                readonly placeholder: string;
            }[];
        }[];
    };
}

/** Das Formular eines Befehls (Antworttyp 9). Ein Formular ist keine Nachricht und trägt deshalb kein `allowed_mentions`. */
export function formular(befehl: MeldeBefehl, oeffentlich = false): FormularAntwort {
    const { felder } = FORMULARE[befehl];
    const titel = (oeffentlich ? OEFFENTLICH[befehl]?.titel : undefined) ?? FORMULARE[befehl].titel;
    return {
        type: ANTWORT.formular,
        data: {
            custom_id: `${FORMULAR_PRAEFIX}${befehl}`,
            title: titel,
            components: felder.map((feld) => ({
                type: 1,
                components: [
                    {
                        type: 4,
                        custom_id: feld.id,
                        label: feld.label,
                        style: feld.stil,
                        required: feld.pflicht,
                        ...(feld.min === undefined ? {} : { min_length: feld.min }),
                        max_length: feld.max,
                        placeholder: feld.platzhalter,
                    },
                ],
            })),
        },
    } as const;
}
