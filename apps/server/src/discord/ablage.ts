import {
    DISCORD_ERROR_STATUS,
    DISCORD_ZEITPLAN,
    type DiscordFakten,
    type DiscordZustellStatus,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { DiscordNachricht } from "./rest.ts";

/**
 * Die Zustelltafel und der Schalter der Routine (WI-0255, Migration 0221). Hier steht nur SQL; was wann geschieht, entscheidet `zustellung.ts`.
 *
 * 🔴 **Beanspruchen ist atomar** (`beanspruche`): Ein Lauf darf eine Zeile nur senden, wenn ER sie in genau einem `UPDATE … RETURNING` auf
 * `sendet` gesetzt hat. Zwei Läufe zugleich (Timer und Knopf) senden so nie beide. Eine Zeile, die länger als `HAENGT_NACH_S` auf `sendet`
 * steht, gilt als liegengeblieben (der Lauf ist abgestürzt) und wird wie `unklar` behandelt: erst nachsehen, dann senden.
 */

export const ART = "tagesbericht";
/**
 * Nach so vielen Sekunden auf `sendet` ist ein Lauf sicher vorbei: 3 Versuche × 10 s plus Wartezeiten liegen weit darunter. Bei mehreren Nachrichten zählt
 * die Zeit seit der letzten zugestellten (`halteTeile`).
 */
export const HAENGT_NACH_S = 120;

/** Eine Nachricht des Berichts mit dem, was von ihr bekannt ist: `messageId` erst, wenn sie hinausging (oder im Kanal gefunden wurde). */
export interface BerichtsTeil {
    inhalt: DiscordNachricht;
    messageId: string | null;
}

export interface ZustellZeile {
    id: string;
    berichtstag: string;
    kanal: string;
    status: DiscordZustellStatus;
    /** Die `nonce` der ersten Nachricht; die der weiteren stehen in `teile`. */
    nonce: string;
    /** Die erste Nachricht. */
    inhalt: DiscordNachricht;
    /** Der Text der ersten Nachricht (höchstens 2000 Zeichen, so verlangt es die Tafel). */
    text: string;
    /** Alle Nachrichten mit ihrem Fortschritt (Migration 0298); `null`: ein Bericht in einer Nachricht (`teileVon`). */
    teile: BerichtsTeil[] | null;
    fakten: DiscordFakten;
    formulierung: "vorlage" | "modell";
    message_id: string | null;
    versuche: number;
    fehler: string | null;
    ausgeloest: "zeitplan" | "hand";
    erstellt_at: Date;
    versucht_at: Date | null;
    zugestellt_at: Date | null;
    haengt: boolean;
}

/** 42P01: Die Tafeln gibt es noch nicht (0221 nicht angewandt). */
export function uebersetzt(error: unknown): never {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01") {
        throw new ApiError(
            DISCORD_ERROR_STATUS.discord_bericht_fehlt,
            "discord_bericht_fehlt",
            "Den Discord-Bericht gibt es in dieser Umgebung noch nicht.",
        );
    }
    throw error;
}

const SPALTEN = (db: Queryable) => db`
    id, to_char(berichtstag, 'YYYY-MM-DD') AS berichtstag, kanal, status, nonce, inhalt, text, teile, fakten, formulierung,
    message_id, versuche, fehler, ausgeloest, erstellt_at, versucht_at, zugestellt_at,
    (status = 'sendet' AND versucht_at < now() - ${HAENGT_NACH_S}::int * interval '1 second') AS haengt
`;

export async function zeileFuer(db: Queryable, tag: string, kanal: string): Promise<ZustellZeile | undefined> {
    const [zeile] = await db<ZustellZeile[]>`
        SELECT ${SPALTEN(db)} FROM public.discord_zustellung WHERE art = ${ART} AND berichtstag = ${tag}::date AND kanal = ${kanal}
    `.catch(uebersetzt);
    return zeile;
}

export async function zeileMitId(db: Queryable, id: number): Promise<ZustellZeile | undefined> {
    const [zeile] = await db<
        ZustellZeile[]
    >`SELECT ${SPALTEN(db)} FROM public.discord_zustellung WHERE id = ${id}`.catch(uebersetzt);
    return zeile;
}

/** Der Faktenbestand des letzten zugestellten Berichts in diesem Kanal, für den Vergleich („neu seit dem letzten Bericht“). */
export async function letzteFakten(db: Queryable, kanal: string, vorTag: string): Promise<DiscordFakten | null> {
    const [zeile] = await db<{ fakten: DiscordFakten }[]>`
        SELECT fakten FROM public.discord_zustellung
         WHERE art = ${ART} AND kanal = ${kanal} AND status = 'zugestellt' AND berichtstag < ${vorTag}::date
         ORDER BY berichtstag DESC LIMIT 1
    `.catch(uebersetzt);
    return zeile?.fakten ?? null;
}

/** Alle Nachrichten einer Zeile mit ihrem Fortschritt, in der Reihenfolge des Versands; eine Zeile ohne `teile` ist ein Bericht in einer Nachricht. */
export function teileVon(zeile: Pick<ZustellZeile, "teile" | "inhalt" | "message_id">): BerichtsTeil[] {
    return zeile.teile ?? [{ inhalt: zeile.inhalt, messageId: zeile.message_id }];
}

export interface NeueZeile {
    tag: string;
    kanal: string;
    /** Die Nachrichten des Berichts mit je eigener `nonce` (mindestens eine); die erste steht auch in `inhalt`, `text` und `nonce`. */
    nachrichten: readonly DiscordNachricht[];
    fakten: DiscordFakten;
    formulierung: "vorlage" | "modell";
    ausgeloest: "zeitplan" | "hand";
    person: string | null;
}

/**
 * Legt die Zeile des Tages an, gleich beansprucht (`sendet`). Gibt es sie schon (ein anderer Lauf war schneller), `undefined`.
 * `kanal_art` (NOT NULL, Migration 0221) ist immer `bericht`; die Schwesterspalte `test_kanal` ist mit Migration 0294 gefallen, diese bleibt.
 * Eine Nachricht steht wie bisher in `inhalt`, `text` und `nonce` (`teile` bleibt `NULL`); bei mehreren stehen alle in `teile` (Migration 0298), die erste zusätzlich dort.
 */
export async function legeAn(db: Queryable, neu: NeueZeile): Promise<ZustellZeile | undefined> {
    const erste = neu.nachrichten[0]!;
    const teile: BerichtsTeil[] | null =
        neu.nachrichten.length > 1 ? neu.nachrichten.map((inhalt) => ({ inhalt, messageId: null })) : null;
    const [angelegt] = await db<{ id: string }[]>`
        INSERT INTO public.discord_zustellung
            (art, berichtstag, kanal, kanal_art, status, nonce, inhalt, text, teile, fakten, formulierung, versuche, ausgeloest, ausgeloest_von,
             versucht_at)
        VALUES (${ART}, ${neu.tag}::date, ${neu.kanal}, 'bericht', 'sendet', ${erste.nonce}, ${db.json(erste as never)},
                ${erste.content}, ${teile === null ? null : db.json(teile as never)}, ${db.json(neu.fakten as never)}, ${neu.formulierung}, 0,
                ${neu.ausgeloest}, ${neu.person}::uuid, now())
        ON CONFLICT (art, berichtstag, kanal) DO NOTHING
        RETURNING id
    `.catch(uebersetzt);
    return angelegt === undefined ? undefined : await zeileMitId(db, Number(angelegt.id));
}

/**
 * Hält den Fortschritt einer beanspruchten Zeile mit mehreren Nachrichten fest (welche schon hinausging); ohne `teile` in der Zeile geschieht nichts. Jede
 * zugestellte Nachricht erneuert `versucht_at`: Ein Lauf mit vielen Nachrichten dauert länger als `HAENGT_NACH_S`, solange er aber vorankommt, gilt er nicht als
 * liegengeblieben (sonst nähme ihm ein zweiter Lauf die Zeile weg).
 */
export async function halteTeile(db: Queryable, id: number, teile: readonly BerichtsTeil[]): Promise<void> {
    await db`
        UPDATE public.discord_zustellung
           SET teile = ${db.json(teile as never)}, geaendert_at = now(), versucht_at = now()
         WHERE id = ${id} AND teile IS NOT NULL AND status = 'sendet'
    `.catch(uebersetzt);
}

/**
 * Beansprucht eine Zeile für einen neuen Versuch: nur aus `fehlgeschlagen` oder `unklar`, oder aus einem liegengebliebenen `sendet`. Gibt die
 * Zeile mit ihrem Stand VOR dem Beanspruchen zurück (`vorher`), damit der Lauf weiß, ob er erst nachsehen muss; sonst `undefined`.
 */
export async function beanspruche(
    db: Queryable,
    id: number,
    ausgeloest: "zeitplan" | "hand",
    person: string | null,
): Promise<{ zeile: ZustellZeile; vorher: DiscordZustellStatus } | undefined> {
    const [treffer] = await db<{ vorher: DiscordZustellStatus }[]>`
        UPDATE public.discord_zustellung z
           SET status = 'sendet', versucht_at = now(), geaendert_at = now(), ausgeloest = ${ausgeloest},
               ausgeloest_von = COALESCE(${person}::uuid, z.ausgeloest_von)
          FROM (SELECT id, status AS vorher FROM public.discord_zustellung WHERE id = ${id} FOR UPDATE) alt
         WHERE z.id = alt.id
           AND (z.status IN ('fehlgeschlagen', 'unklar')
                OR (z.status = 'sendet' AND z.versucht_at < now() - ${HAENGT_NACH_S}::int * interval '1 second'))
        RETURNING alt.vorher
    `.catch(uebersetzt);
    if (treffer === undefined) return undefined;
    const zeile = await zeileMitId(db, id);
    return zeile === undefined ? undefined : { zeile, vorher: treffer.vorher };
}

export type Ausgang =
    | { status: "zugestellt"; messageId: string }
    | { status: "fehlgeschlagen" | "unklar"; fehler: string }
    | { status: "sendet" };

/** Hält einen Versuch fest; `versuche` zählt jede Anfrage an Discord, die hinausging. */
export async function halteFest(db: Queryable, id: number, ausgang: Ausgang, versuche: number): Promise<void> {
    const messageId = ausgang.status === "zugestellt" ? ausgang.messageId : null;
    const fehler =
        ausgang.status === "fehlgeschlagen" || ausgang.status === "unklar" ? ausgang.fehler.slice(0, 500) : null;
    await db`
        UPDATE public.discord_zustellung
           SET status = ${ausgang.status}, message_id = ${messageId}, fehler = ${fehler},
               versuche = versuche + ${versuche}, geaendert_at = now(),
               zugestellt_at = CASE WHEN ${ausgang.status} = 'zugestellt' THEN now() ELSE zugestellt_at END
         WHERE id = ${id}
    `.catch(uebersetzt);
}

export interface RoutineZeile {
    aktiv: boolean;
    geaendert_at: Date | null;
    geaendert_von: string | null;
    letzter_lauf_at: Date | null;
    letzter_lauf: string | null;
    /** Die Einstellungen aus dem Reiter (Migration 0227): Beginn des Sendefensters, `HH:MM` Berlin. */
    uhrzeit: string;
    /** `null`: Es gilt die Vorgabe der App (`DISCORD_PROMPT_VORGABE`). */
    prompt: string | null;
    /** `null`: Es gilt die Umgebungsvariable (`DISCORD_BERICHT_KANAL`). */
    berichts_kanal: string | null;
    einstellungen_at: Date | null;
    einstellungen_von: string | null;
}

/** Die Zeile, wenn die Migration sie nicht angelegt hat: Routine aus, Vorgaben überall. */
const OHNE_ROUTINE: RoutineZeile = {
    aktiv: false,
    geaendert_at: null,
    geaendert_von: null,
    letzter_lauf_at: null,
    letzter_lauf: null,
    uhrzeit: DISCORD_ZEITPLAN.uhrzeit,
    prompt: null,
    berichts_kanal: null,
    einstellungen_at: null,
    einstellungen_von: null,
};

export async function leseRoutine(db: Queryable): Promise<RoutineZeile> {
    const [zeile] = await db<RoutineZeile[]>`
        SELECT aktiv, geaendert_at, geaendert_von, letzter_lauf_at, letzter_lauf,
               uhrzeit, prompt, berichts_kanal, einstellungen_at, einstellungen_von
          FROM public.discord_routine WHERE art = ${ART}
    `.catch(uebersetzt);
    // Die Migration legt die Zeile an; fehlt sie trotzdem, ist die Routine aus.
    return zeile ?? OHNE_ROUTINE;
}

/**
 * Merkt, was ein Lauf ergab. 🔴 Der Timer fragt alle 15 Minuten; die stillen Ausgänge (`ausserhalb_fenster`, `schon_zugestellt`, `laeuft_schon`) merkt sich
 * der Reiter nicht, sonst stünde dort den halben Tag „außerhalb des Sendefensters“ statt dessen, was der Lauf zur Sendezeit ergab. Alles andere (zugestellt,
 * Fehlschlag, Routine aus, Sperre) bleibt stehen und zeigt zugleich, dass der Timer lebt.
 */
export const STILLE_LAEUFE: readonly string[] = ["ausserhalb_fenster", "schon_zugestellt", "laeuft_schon"];

export async function merkeLauf(db: Queryable, ergebnis: string): Promise<void> {
    if (STILLE_LAEUFE.includes(ergebnis.split(":")[0]!.trim())) return;
    await db`
        UPDATE public.discord_routine SET letzter_lauf_at = now(), letzter_lauf = ${ergebnis.slice(0, 300)} WHERE art = ${ART}
    `.catch(uebersetzt);
}

/** Schaltet die Routine; gibt den Stand davor zurück. */
export async function setzeRoutine(db: Queryable, aktiv: boolean, person: string): Promise<boolean> {
    const [vorher] = await db<{ aktiv: boolean }[]>`
        SELECT aktiv FROM public.discord_routine WHERE art = ${ART} FOR UPDATE
    `.catch(uebersetzt);
    await db`
        INSERT INTO public.discord_routine (art, aktiv, geaendert_at, geaendert_von) VALUES (${ART}, ${aktiv}, now(), ${person}::uuid)
        ON CONFLICT (art) DO UPDATE SET aktiv = EXCLUDED.aktiv, geaendert_at = now(), geaendert_von = EXCLUDED.geaendert_von
    `.catch(uebersetzt);
    return vorher?.aktiv ?? false;
}

/** Was die Betreiber im Reiter einstellen (Migration 0227): ganz oder gar nicht. `null` heißt Vorgabe. */
export interface EinstellungenNeu {
    uhrzeit: string;
    prompt: string | null;
    berichtsKanal: string | null;
}

/** Speichert die Einstellungen; gibt den Stand davor zurück (für das Protokoll: was hat sich geändert?). */
export async function setzeEinstellungen(
    db: Queryable,
    neu: EinstellungenNeu,
    person: string,
): Promise<Pick<RoutineZeile, "uhrzeit" | "prompt" | "berichts_kanal">> {
    const [vorher] = await db<Pick<RoutineZeile, "uhrzeit" | "prompt" | "berichts_kanal">[]>`
        SELECT uhrzeit, prompt, berichts_kanal FROM public.discord_routine WHERE art = ${ART} FOR UPDATE
    `.catch(uebersetzt);
    await db`
        INSERT INTO public.discord_routine (art, uhrzeit, prompt, berichts_kanal, einstellungen_at, einstellungen_von)
        VALUES (${ART}, ${neu.uhrzeit}, ${neu.prompt}, ${neu.berichtsKanal}, now(), ${person}::uuid)
        ON CONFLICT (art) DO UPDATE
           SET uhrzeit = EXCLUDED.uhrzeit, prompt = EXCLUDED.prompt, berichts_kanal = EXCLUDED.berichts_kanal,
               einstellungen_at = now(), einstellungen_von = EXCLUDED.einstellungen_von
    `.catch(uebersetzt);
    return vorher ?? { uhrzeit: OHNE_ROUTINE.uhrzeit, prompt: null, berichts_kanal: null };
}

/** Das Sendearchiv, jüngste zuerst. */
export async function archiv(db: Queryable, grenze = 30): Promise<ZustellZeile[]> {
    return await db<ZustellZeile[]>`
        SELECT ${SPALTEN(db)} FROM public.discord_zustellung WHERE art = ${ART} ORDER BY berichtstag DESC, id DESC LIMIT ${grenze}
    `.catch(uebersetzt);
}
