import { createHash } from "node:crypto";
import { meldungsKanal, type DiscordKonfig } from "./konfig.ts";
import { ersteSaetze, kuerze, nutzerText } from "./muster.ts";
import { discordRest, nachrichtAnPersonen, type DiscordNachricht, type DiscordRest } from "./rest.ts";

/**
 * Der kurze Post einer Meldung in den eigenen Kanal (WI-0255; Vali 2026-11-02: „bug reports sind still … schön wärs wenn der bot sich bedankt und den fehler
 * kurz in /bugs postet“, dasselbe für `/idee`). Der Dank an die meldende Person bleibt, wie er war (`interaktion.ts`, nur für sie sichtbar); zusätzlich
 * steht die Meldung öffentlich im Kanal: Vorgangsnummer, Titel, ein bis zwei Sätze, und eine Dankzeile mit der meldenden Person als Erwähnung.
 *
 * - **Eigene Kanäle** `DISCORD_BUG_KANAL` und `DISCORD_IDEE_KANAL` (`konfig.ts`, geprüft wie der Berichtskanal über `DISCORD_KANAL_MUSTER`). Fehlt der Wert, auf
 *   Production und lokal, ohne Schlüssel: nichts wird gepostet. `/frage` postet nie.
 * - 🔴 **Der Text kommt von Nutzern und geht öffentlich hinaus:** `allowed_mentions` erlaubt genau die meldende Person (`nachrichtAnPersonen`), keine Rolle,
 *   kein `@everyone`, kein `@here`; im Text selbst fällt jede Erwähnung weg (`nutzerText`: auch Markdown, Verweise und Steuerzeichen), Titel auf 100, die Sätze
 *   auf 280 Zeichen gekürzt. Die Person erscheint nur über ihre Kennung, nie mit einem Namen aus dem Formular.
 * - 🔴 **Ein Fehler hier ändert nichts:** Der Vorgang ist schon gespeichert, der Dank geht trotzdem; ein misslungener Post landet ohne Text und ohne Schlüssel
 *   im Protokoll (`postMeldung` wirft nie).
 * - Gepostet wird höchstens einmal je Interaktion: Die `nonce` folgt aus der Kennung der Interaktion, und Discord gibt bei derselben `nonce` die vorhandene
 *   Nachricht zurück.
 */

export type PostBefehl = "bug" | "idee";

export interface PostEingabe {
    befehl: PostBefehl;
    /** Die Nummer des Vorgangs im Kanal der Betreiber. */
    nummer: number;
    titel: string;
    /** Der Text der Meldung samt einem angehängten „Wo:“ (`interaktion.ts` `meldungAus`). */
    nachricht: string;
    /** Die Kennung der meldenden Person bei Discord (nur für die Erwähnung), `null`, wo sie fehlt. */
    melderKennung: string | null;
    /** Die Kennung der Interaktion: Aus ihr folgt die `nonce`. */
    interaktionsId: string;
}

const KOPF: Record<PostBefehl, string> = { bug: "🐞 **Neuer Bug**", idee: "💡 **Neue Idee**" };
const DANK: Record<PostBefehl, string> = {
    bug: "wir schauen es uns an.",
    idee: "wir schauen uns die Idee an.",
};
export const POST_TITEL_MAX = 100;
export const POST_TEXT_MAX = 280;

/** Die Kennung der Person, wenn sie die Form einer Discord-Kennung hat (17 bis 20 Ziffern); nur dann wird sie erwähnt. */
const personVon = (kennung: string | null): string | null =>
    kennung !== null && /^\d{17,20}$/u.test(kennung) ? kennung : null;

/** Der Text des Posts. Ohne Kennung der Person (nie der Fall bei Discord, aber wer weiß) steht die Dankzeile ohne Erwähnung da. */
export function postText(eingabe: PostEingabe): string {
    const person = personVon(eingabe.melderKennung);
    const titel = nutzerText(eingabe.titel, POST_TITEL_MAX);
    // Das „Wo:“ am Ende gehört zum Formular, nicht zur Kurzfassung.
    const text = ersteSaetze(nutzerText(eingabe.nachricht.split(/\n\nWo: /u)[0] ?? "", 1000), 2, POST_TEXT_MAX);
    const dank = person === null ? `Danke, ${DANK[eingabe.befehl]}` : `Danke, <@${person}>, ${DANK[eingabe.befehl]}`;
    const zeilen = [
        `${KOPF[eingabe.befehl]} #${String(eingabe.nummer)}: ${titel === "" ? "ohne Titel" : titel}`,
        ...(text === "" || text === titel ? [] : [text]),
        dank,
    ];
    return kuerze(zeilen.join("\n"), 1900);
}

/** Die `nonce` des Posts: aus der Kennung der Interaktion, höchstens 25 Zeichen; dieselbe Interaktion ergibt immer dieselbe. */
export const postNonce = (interaktionsId: string): string =>
    createHash("sha256").update(`avesmaps-discord-post:${interaktionsId}`).digest("hex").slice(0, 25);

export function postNachricht(eingabe: PostEingabe): DiscordNachricht {
    const person = personVon(eingabe.melderKennung);
    return nachrichtAnPersonen(postText(eingabe), postNonce(eingabe.interaktionsId), person === null ? [] : [person]);
}

export type PostAusgang = "gepostet" | "kein_kanal" | "fehlgeschlagen";

/**
 * Postet die Meldung kurz in den Kanal ihres Befehls, wenn es einen gibt. Wirft nie: Ein Fehlschlag (Rechte, Kanal, Rate-Limit, Netz) ist `fehlgeschlagen` und
 * wird mit seiner Art, aber ohne Text und ohne Schlüssel, an `melde` gegeben. `rest` ist für Tests; sonst spricht `discordRest` mit Discord.
 */
export async function postMeldung(
    konfig: DiscordKonfig,
    eingabe: PostEingabe,
    melde: (art: string) => void,
    rest?: DiscordRest,
): Promise<PostAusgang> {
    const kanal = meldungsKanal(konfig, eingabe.befehl);
    if (kanal === null || konfig.botToken === undefined) return "kein_kanal";
    try {
        const ergebnis = await (rest ?? discordRest(konfig.botToken, konfig.abruf)).sende(
            kanal,
            postNachricht(eingabe),
        );
        if (ergebnis.art === "ok") return "gepostet";
        melde(ergebnis.art === "abgelehnt" ? `abgelehnt (HTTP ${String(ergebnis.status)})` : ergebnis.art);
        return "fehlgeschlagen";
    } catch (fehler) {
        melde(fehler instanceof Error ? fehler.name : "Fehler");
        return "fehlgeschlagen";
    }
}
