import { randomBytes } from "node:crypto";
import {
    DISCORD_PROMPT_VORGABE,
    type DiscordFakten,
    type DiscordLaufErgebnis,
    type FreigabeDatei,
    type ReleaseVerlauf,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import {
    beanspruche,
    halteFest,
    halteTeile,
    legeAn,
    letzteFakten,
    leseRoutine,
    merkeLauf,
    teileVon,
    zeileFuer,
    type BerichtsTeil,
    type ZustellZeile,
} from "./ablage.ts";
import { sammleFakten } from "./fakten.ts";
import { schreibeBericht, type Ausfuehren } from "./formulierer.ts";
import { sendeSperre, wirksam, zielKanal, type DiscordKonfig } from "./konfig.ts";
import { pruefeTeile, type Pruefergebnis } from "./pruefung.ts";
import { sammleMeldungen, sammleVorgaenge, type VorgaengeFuerBericht } from "./meldungen.ts";
import { nachrichtAus, type DiscordRest } from "./rest.ts";
import { NACHRICHTEN_TRENNER } from "./teilung.ts";
import { berichtstag, imSendefenster, tageszeitVon, tagesbeginn } from "./zeit.ts";

/**
 * Die Zustellung des Tagesberichts (WI-0255): einmal je Berichtstag und Kanal, mit sicherer Wiederaufnahme.
 *
 * Ein Lauf (`tagesbericht`, Claudios Timer um 10:00 Europe/Berlin):
 *
 * 1. **Sperren:** Nur die Stage mit Schlüssel und Kanal sendet (Production nie, Vali 2026-10-26) (`sendeSperre`; der Kanal aus dem Reiter gilt vor dem der Umgebung, `wirksam`); in
 *    den Berichtskanal nur, wenn der Betreiber die Routine eingeschaltet hat; nur im Sendefenster, das der Uhrzeit aus dem Reiter folgt (`zeit.ts`).
 *    Der Timer fragt alle 15 Minuten, die App entscheidet. Sonst endet der Lauf ohne Senden und merkt sich, warum (die stillen Ausgänge nicht,
 *    `ablage.ts` `merkeLauf`).
 * 2. **Gibt es die Zeile des Tages schon?** `zugestellt`: fertig (`schon_zugestellt`). Ein anderer Lauf sendet gerade: fertig. Sonst wird sie
 *    beansprucht und fortgesetzt — 🔴 aus `unklar` und aus einem liegengebliebenen `sendet` ERST nachsehen, ob die Nachricht schon im Kanal
 *    steht, nie blind wiederholen.
 * 3. **Neu:** Fakten sammeln, Text bauen (Formulierer oder feste Vorlage, `entwirf`), in Nachrichten teilen (`teilung.ts`), prüfen (rot: nicht senden),
 *    die Zeile anlegen (eindeutiger Schlüssel; der zweite Lauf verliert), senden.
 * 4. **Senden:** je Nachricht höchstens `runden` Anfragen. Rate-Limit mit kurzer Wartezeit: warten und noch einmal; länger: fehlgeschlagen, mit dem Grund.
 *    5xx: kurz warten, noch einmal (die `nonce` verhindert eine zweite Nachricht). 4xx: fehlgeschlagen, ohne Wiederholung (Rechte, Kanal,
 *    Schlüssel). Netzfehler: `unklar`, nachsehen, nur wenn sie nicht dasteht noch einmal.
 *
 * 🔴 **Mehrere Nachrichten, keine doppelte** (Vali 2026-11-02): Der Bericht ist EINE Zeile des Tages mit allen Nachrichten in `teile` (Migration 0298, eine
 * wahlfreie Spalte; ohne sie bleibt alles beim Alten). Die Absicherung der einen Nachricht gilt für jede:
 *
 * - **Eigene `nonce` je Nachricht** (`teilNonce`): Wiederholt ein Lauf binnen Minuten eine Anfrage, gibt Discord die vorhandene Nachricht zurück.
 * - **Fortschritt in der Zeile:** Nach jeder zugestellten Nachricht steht ihre Message-ID in `teile` (`halteTeile`). Ein Fehlschlag in der Mitte
 *   (Rate-Limit, Störung, Ablehnung) lässt die Zeile `fehlgeschlagen` mit dem Grund und der Zahl der zugestellten Nachrichten; der nächste Lauf, der Timer oder
 *   der Knopf, sendet nur die fehlenden und beginnt nie bei der ersten.
 * - **Nachsehen im Kanal vor dem Wiederholen:** `unklar`, ein liegengebliebenes `sendet` (der Lauf starb zwischen Senden und Eintragen) und jede Wiederholung
 *   einer Zeile mit mehreren Nachrichten suchen erst im Kanal, welche schon dastehen (`rest.suche` mit dem Anfang des Inhalts), und tragen sie ein. Gesendet
 *   wird nur, was dort fehlt. Scheitert das Nachsehen, bleibt die Zeile `unklar`; nichts wird blind wiederholt.
 * - **Pause zwischen den Nachrichten** (`PAUSE_ZWISCHEN_TEILEN_MS`) wegen des Ratenlimits von Discord; eine Antwort 429 wartet wie bei einer einzelnen.
 * - Zugestellt ist die Zeile erst, wenn alle Nachrichten hinaus sind; ihre `message_id` ist die der ERSTEN Nachricht (der Anfang des Berichts).
 *
 * 🔴 **Kein Rückstau:** Es gibt nur die Zeile von HEUTE. Ein Lauf nach einem Ausfall holt keinen vergangenen Tag nach, und auch der Knopf im
 * Reiter wiederholt nur heutige Zustellungen.
 */

export interface ZustellDeps {
    db: Database;
    konfig: DiscordKonfig;
    /** `undefined` ohne Schlüssel; dann sendet nichts (die Sperre sagt es vorher). */
    rest: DiscordRest | undefined;
    jetzt: () => Date;
    warte: (ms: number) => Promise<void>;
    /** Tests: der Verlauf dieses Release, die Statusdatei der Freigabe, die Vorgänge des Kanals und das Programm des Formulierers. */
    verlauf?: ReleaseVerlauf | null;
    freigabe?: FreigabeDatei | null;
    vorgaenge?: VorgaengeFuerBericht;
    formulierer?: Ausfuehren;
}

/** Wie lange ein Lauf an Discord hängen darf: der Timer großzügig, der Knopf im Reiter knapp (Nginx gibt nach 60 s auf). */
export interface Grenzen {
    runden: number;
    warteMaxS: number;
}
export const GRENZEN_ZEITPLAN: Grenzen = { runden: 3, warteMaxS: 30 };
export const GRENZEN_HAND: Grenzen = { runden: 2, warteMaxS: 5 };

export interface Entwurf {
    tag: string;
    fakten: DiscordFakten;
    /** Der Bericht zum Anzeigen: die Nachrichten mit `NACHRICHTEN_TRENNER` dazwischen (bei einer Nachricht genau diese). */
    text: string;
    /** Die Nachrichten, wie sie hinausgingen: jede höchstens `DISCORD_BERICHT_MAX` Zeichen. */
    teile: string[];
    /** `modell`: den Text hat der Formulierer geschrieben (oder, bei der älteren Schnittstelle, den Gruß). `hinweis`: warum die Vorlage gilt. */
    formulierung: "vorlage" | "modell";
    hinweis: string | null;
    pruefung: Pruefergebnis;
}

/** Fakten, Text und Prüfung für einen Tag, ohne zu senden und ohne zu speichern (auch die Vorschau im Reiter). */
export async function entwirf(
    deps: ZustellDeps,
    tag: string,
    kanal: string | null,
    mitFormulierer: boolean,
): Promise<Entwurf> {
    const vorher = kanal === null ? null : await letzteFakten(deps.db, kanal, tag);
    const fakten = await sammleFakten({
        db: deps.db,
        konfig: deps.konfig,
        jetzt: deps.jetzt(),
        tag,
        vorher,
        ...(deps.verlauf === undefined ? {} : { verlauf: deps.verlauf }),
        ...(deps.freigabe === undefined ? {} : { freigabe: deps.freigabe }),
    });
    // „Aus der Community“: die offenen Vorgänge des Kanals, der auf der Stage lebt (`meldungen.ts`); ohne Kanal ist die Liste leer.
    const vorgaenge = await (deps.vorgaenge ?? (() => sammleVorgaenge(deps.db)))();
    const meldungen = vorgaenge.length === 0 ? null : sammleMeldungen(vorgaenge);
    // Die Uhrzeit aus dem Reiter bestimmt die Tageszeit des Grußes (auch in der Vorschau); der Prompt geht nur an den Formulierer.
    const routine = await leseRoutine(deps.db);
    const geschrieben = await schreibeBericht({
        programm: mitFormulierer ? deps.konfig.formulierer : undefined,
        fakten,
        meldungen,
        tageszeit: tageszeitVon(routine.uhrzeit),
        prompt: routine.prompt ?? DISCORD_PROMPT_VORGABE,
        ...(deps.konfig.botToken === undefined ? {} : { geheimnis: deps.konfig.botToken }),
        ...(deps.formulierer === undefined ? {} : { ausfuehren: deps.formulierer }),
    });
    return {
        tag,
        fakten,
        text: geschrieben.teile.join(NACHRICHTEN_TRENNER),
        teile: geschrieben.teile,
        formulierung: geschrieben.formulierung,
        hinweis: geschrieben.hinweis,
        pruefung: pruefeTeile(geschrieben.teile, tag, deps.konfig.botToken),
    };
}

/** Eine `nonce` für Discord: der Tag und Zufall, höchstens 25 Zeichen. */
export function neueNonce(tag: string): string {
    return `${tag.replace(/-/gu, "")}${randomBytes(6).toString("hex")}`;
}

/** Die `nonce` der Nachricht `index` (ab 0): die erste trägt die Grundnonce, jede weitere hängt ihre Nummer an (höchstens 22 Zeichen bei zwölf Nachrichten). */
export const teilNonce = (nonce: string, index: number): string =>
    index === 0 ? nonce : `${nonce}${String(index + 1)}`;

/** Wartezeit zwischen zwei Nachrichten des Berichts: Discord erlaubt etwa fünf Nachrichten in fünf Sekunden je Kanal. */
export const PAUSE_ZWISCHEN_TEILEN_MS = 1200;
/**
 * So viele Zeichen vom Anfang einer Nachricht genügen, um sie im Kanal wiederzuerkennen (`rest.suche`): Zwei Nachrichten desselben Berichts beginnen mit denselben
 * Überschriften, aber schon der erste Punkt darunter unterscheidet sie. Nicht der ganze Inhalt, falls Discord ihn am Ende ändert (etwa Leerraum).
 */
const ERKENNUNGS_ANFANG = 400;

export interface LaufAusgang {
    ergebnis: DiscordLaufErgebnis;
    detail: string | null;
}

const ausgang = (ergebnis: DiscordLaufErgebnis, detail: string | null = null): LaufAusgang => ({ ergebnis, detail });

/**
 * Sendet eine beanspruchte Zeile (Status `sendet`), Nachricht für Nachricht; zugestellt ist sie erst, wenn alle hinaus sind (siehe oben, „Mehrere
 * Nachrichten, keine doppelte“). `nachsehen` zuerst, wenn der vorige Versuch unklar endete oder liegenblieb, und bei einer Zeile mit mehreren Nachrichten
 * nach jedem früheren Versuch. Eine Zeile mit einer Nachricht verhält sich wie vor Migration 0298.
 */
export async function sendeZeile(
    deps: ZustellDeps,
    zeile: ZustellZeile,
    beginn: "frisch" | "nachsehen",
    grenzen: Grenzen,
): Promise<LaufAusgang> {
    const rest = deps.rest;
    const id = Number(zeile.id);
    if (rest === undefined) {
        await halteFest(deps.db, id, { status: "fehlgeschlagen", fehler: "kein Schlüssel" }, 0);
        return ausgang("fehlgeschlagen", "kein Schlüssel");
    }
    const ab = tagesbeginn(zeile.berichtstag);
    const teile: BerichtsTeil[] = teileVon(zeile).map((teil) => ({ ...teil }));
    const mehrere = zeile.teile !== null;
    /** „Nachricht 3 von 5: “ vor dem Grund, nur bei mehreren; mit der Zahl der schon zugestellten. */
    const wo = (index: number): string =>
        mehrere ? `Nachricht ${String(index + 1)} von ${String(teile.length)}: ` : "";
    const zugestellt = (): number => teile.filter((teil) => teil.messageId !== null).length;
    const stand = (): string => (mehrere ? ` (${String(zugestellt())} von ${String(teile.length)} zugestellt)` : "");
    const sichere = async (): Promise<void> => {
        if (mehrere) await halteTeile(deps.db, id, teile);
    };
    const fertig = async (versuche: number, detail: string | null): Promise<LaufAusgang> => {
        // Die Message-ID der Zeile ist die der ersten Nachricht: der Anfang des Berichts.
        await halteFest(deps.db, id, { status: "zugestellt", messageId: teile[0]!.messageId! }, versuche);
        return ausgang("zugestellt", detail);
    };
    const scheitere = async (
        status: "fehlgeschlagen" | "unklar",
        fehler: string,
        versuche: number,
    ): Promise<LaufAusgang> => {
        await sichere();
        await halteFest(deps.db, id, { status, fehler }, versuche);
        return ausgang(status, fehler);
    };

    /**
     * Sucht im Kanal nach den Nachrichten, die noch keine Message-ID haben, und trägt die gefundenen ein. Ist danach alles da, ist die Zeile zugestellt
     * („im Kanal gefunden“); scheitert die Suche, bleibt sie `unklar`. `null`: Es fehlt noch etwas, der Lauf sendet es.
     */
    const nachsehen = async (versuche: number, vorher: string): Promise<LaufAusgang | null> => {
        for (const [index, teil] of teile.entries()) {
            if (teil.messageId !== null) continue;
            const gesucht = await rest.suche(zeile.kanal, ab, teil.inhalt.content.slice(0, ERKENNUNGS_ANFANG));
            if (gesucht.art === "gefunden") teil.messageId = gesucht.messageId;
            else if (gesucht.art === "fehler") {
                return await scheitere(
                    "unklar",
                    `${vorher}; ${wo(index)}Nachsehen gescheitert: ${gesucht.grund}${stand()}`,
                    versuche,
                );
            }
        }
        await sichere();
        return zugestellt() === teile.length ? await fertig(versuche, "im Kanal gefunden") : null;
    };

    // Eine Zeile mit mehreren Nachrichten sieht nach jedem früheren Versuch erst nach: Auch ein Fehlschlag kann eine Nachricht hinterlassen haben.
    const erstSehen = beginn === "nachsehen" || (mehrere && zeile.versuche > 0);
    if (erstSehen) {
        const gesehen = await nachsehen(0, "vorher unklar");
        if (gesehen !== null) return gesehen;
    }
    let versuche = 0;
    let gesendet = false;
    for (const [index, teil] of teile.entries()) {
        if (teil.messageId !== null) continue;
        if (gesendet) await deps.warte(PAUSE_ZWISCHEN_TEILEN_MS);
        gesendet = true;
        let hinaus = false;
        for (let runde = 1; runde <= grenzen.runden && !hinaus; runde += 1) {
            const antwort = await rest.sende(zeile.kanal, teil.inhalt);
            versuche += 1;
            const letzte = runde === grenzen.runden;
            switch (antwort.art) {
                case "ok":
                    teil.messageId = antwort.messageId;
                    await sichere();
                    hinaus = true;
                    break;
                case "ratelimit": {
                    if (!letzte && antwort.nachSekunden <= grenzen.warteMaxS) {
                        await deps.warte(Math.ceil(antwort.nachSekunden * 1000) + 250);
                        break;
                    }
                    const fehler = `${wo(index)}Rate-Limit${antwort.global ? " (global)" : ""}: frühestens in ${String(Math.ceil(antwort.nachSekunden))} s wieder${stand()}`;
                    return await scheitere("fehlgeschlagen", fehler, versuche);
                }
                case "stoerung": {
                    if (!letzte) {
                        await deps.warte(2000 * runde);
                        break;
                    }
                    const fehler = `${wo(index)}Discord gestört (HTTP ${String(antwort.status)})${stand()}`;
                    return await scheitere("fehlgeschlagen", fehler, versuche);
                }
                case "abgelehnt": {
                    const fehler = `${wo(index)}Discord lehnt ab: HTTP ${String(antwort.status)}${antwort.meldung === "" ? "" : ` ${antwort.meldung}`}${stand()}`;
                    return await scheitere("fehlgeschlagen", fehler, versuche);
                }
                case "unklar": {
                    await deps.warte(2000);
                    const gesehen = await nachsehen(versuche, `${wo(index)}${antwort.grund}`);
                    if (gesehen !== null) return gesehen;
                    if (teil.messageId !== null) {
                        hinaus = true;
                        break;
                    }
                    if (letzte) {
                        return await scheitere(
                            "unklar",
                            `${wo(index)}${antwort.grund}; im Kanal nicht gefunden${stand()}`,
                            versuche,
                        );
                    }
                    break;
                }
            }
        }
        if (!hinaus) {
            // Unerreichbar: jede letzte Runde endet oben. Sicher ist sicher.
            return await scheitere("unklar", "Lauf ohne Ergebnis beendet", versuche);
        }
    }
    return await fertig(versuche, null);
}

/** Setzt eine vorhandene Zeile des Tages fort (Timer) oder lässt sie stehen, wenn sie fertig ist oder gerade läuft. */
async function setzeFort(
    deps: ZustellDeps,
    zeile: ZustellZeile,
    ausgeloest: "zeitplan" | "hand",
    person: string | null,
    grenzen: Grenzen,
): Promise<LaufAusgang> {
    if (zeile.status === "zugestellt") return ausgang("schon_zugestellt");
    if (zeile.status === "sendet" && !zeile.haengt) return ausgang("laeuft_schon");
    const anspruch = await beanspruche(deps.db, Number(zeile.id), ausgeloest, person);
    if (anspruch === undefined) return ausgang("laeuft_schon");
    return await sendeZeile(
        deps,
        anspruch.zeile,
        anspruch.vorher === "fehlgeschlagen" ? "frisch" : "nachsehen",
        grenzen,
    );
}

/**
 * Der Lauf des Timers. 🔴 Gesendet wird nur in den Berichtskanal, auch bei `fensterIgnorieren`. Das Flag lässt nur das Sendefenster außer Acht (Claudios Probe
 * mit Valis ausdrücklichem Wort, `--probe` in `discord-einrichten.sh`): Sperren, die eingeschaltete Routine und das einmal je Tag und Kanal gelten weiter.
 */
export async function tagesbericht(
    deps: ZustellDeps,
    optionen: { fensterIgnorieren?: boolean } = {},
): Promise<LaufAusgang> {
    const ergebnis = await lauf(deps, optionen);
    await merkeLauf(deps.db, ergebnis.detail === null ? ergebnis.ergebnis : `${ergebnis.ergebnis}: ${ergebnis.detail}`);
    return ergebnis;
}

async function lauf(basis: ZustellDeps, optionen: { fensterIgnorieren?: boolean }): Promise<LaufAusgang> {
    // Die Einstellungen aus dem Reiter zuerst: Kanäle und Uhrzeit stehen in der Tafel, nicht in der Umgebung (die gilt nur, wo dort nichts steht).
    const routine = await leseRoutine(basis.db);
    const deps: ZustellDeps = { ...basis, konfig: wirksam(basis.konfig, routine) };
    const sperre = sendeSperre(deps.konfig);
    const ziel = zielKanal(deps.konfig);
    if (sperre !== null || ziel === null) return ausgang(sperre ?? "ohne_kanal");
    if (!routine.aktiv) return ausgang("routine_aus");
    const jetzt = deps.jetzt();
    if (!imSendefenster(jetzt, routine.uhrzeit) && optionen.fensterIgnorieren !== true) {
        return ausgang("ausserhalb_fenster");
    }
    const tag = berichtstag(jetzt);
    let zeile = await zeileFuer(deps.db, tag, ziel);
    if (zeile === undefined) {
        const entwurf = await entwirf(deps, tag, ziel, true);
        if (!entwurf.pruefung.ok) return ausgang("pruefung_rot", entwurf.pruefung.fehler.join(", "));
        const nonce = neueNonce(tag);
        const angelegt = await legeAn(deps.db, {
            tag,
            kanal: ziel,
            nachrichten: entwurf.teile.map((teil, index) => nachrichtAus(teil, teilNonce(nonce, index))),
            fakten: entwurf.fakten,
            formulierung: entwurf.formulierung,
            ausgeloest: "zeitplan",
            person: null,
        });
        if (angelegt !== undefined) return await sendeZeile(deps, angelegt, "frisch", GRENZEN_ZEITPLAN);
        // Ein anderer Lauf war schneller: dessen Zeile fortsetzen.
        zeile = await zeileFuer(deps.db, tag, ziel);
        if (zeile === undefined) return ausgang("laeuft_schon");
    }
    return await setzeFort(deps, zeile, "zeitplan", null, GRENZEN_ZEITPLAN);
}

/** Darf diese Zeile jetzt von Hand wiederholt werden? Nur heute, nur im aktuellen Kanal, nur nach einem Fehlschlag oder Unklarheit. */
export function wiederholbar(zeile: ZustellZeile, konfig: DiscordKonfig, heute: string): boolean {
    const ziel = zielKanal(konfig);
    return (
        sendeSperre(konfig) === null &&
        ziel !== null &&
        zeile.kanal === ziel &&
        zeile.berichtstag === heute &&
        (zeile.status === "fehlgeschlagen" || zeile.status === "unklar" || (zeile.status === "sendet" && zeile.haengt))
    );
}

/** Die Wiederholung von Hand, nachdem die Route die Zeile beansprucht hat (in der Transaktion mit dem Protokoll). */
export async function wiederhole(
    deps: ZustellDeps,
    zeile: ZustellZeile,
    vorher: "fehlgeschlagen" | "unklar" | "sendet" | "zugestellt",
): Promise<LaufAusgang> {
    const ergebnis = await sendeZeile(deps, zeile, vorher === "fehlgeschlagen" ? "frisch" : "nachsehen", GRENZEN_HAND);
    await merkeLauf(deps.db, ergebnis.detail === null ? ergebnis.ergebnis : `${ergebnis.ergebnis}: ${ergebnis.detail}`);
    return ergebnis;
}

/** Für die Route: beanspruchen in der Transaktion des Protokolls. */
export async function beanspruchVonHand(
    tx: Queryable,
    id: number,
    person: string,
): Promise<{ zeile: ZustellZeile; vorher: ZustellZeile["status"] } | undefined> {
    return await beanspruche(tx, id, "hand", person);
}
