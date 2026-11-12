import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    BENACHRICHTIGUNG_TAKT_MS,
    BENACHRICHTIGUNG_URL,
    COMMUNITY_GLOCKEN_ARTEN,
    PHOTOBOX_GLOCKEN_ARTEN,
    BEWERTUNG_GLOCKEN_ARTEN,
    KARTENVORSCHLAG_GLOCKEN_ARTEN,
    SOCIAL_GLOCKEN_ARTEN,
    communityNeuAnzahl,
    photoboxEingangAnzahl,
    type Benachrichtigung,
    type BenachrichtigungAntwort,
    type BenachrichtigungListe,
    type OperationReceipt,
    leseRollenGlocke,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { ApiFailure, newOperationId, postJson, type Fetcher } from "./api";
import { requestConfirmation, withConfirmation } from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";

/**
 * Die Glocke in der Leiste (WI-0136 N2, NACHRICHT-0001 §3.3): was die Oberfläche rechnet; wie sie aussieht, in `app-glocke.vue` und
 * `benachrichtigung-eintrag.vue`.
 *
 * - **Zustellung:** alle 60 s, solange der Tab sichtbar ist, und beim Zurückkehren; mit ETag, sonst 304 (das Muster des Inhaltsstands).
 *   Kein Kanal zum Browser; der Kanal arbeitet im 30-Minuten-Takt.
 * - **Kreis** je Eintrag: ○ ungelesen, ◐ gelesen und wartet auf die eigene Antwort („Gelöst?“), ● erledigt.
 * - **Satz** aus `art`, Absender und OPS-ID, zweisprachig; die OPS-Nummer wird ein Link in den Kanal. Kein Meldungstext.
 * - **Community** (WI-0268 C5): Die vier Arten `community_*` tragen die COM-Nummer im `text` (nie einen Text des Melders, nie seinen Namen); sie wird
 *   ein Link in Editor › Community › Meldungen (`communityTeile`). `community_neu` ist gebündelt: Steht im `text` eine Zahl, lautet der Satz
 *   „3 neue Meldungen“ und führt in die Liste.
 * - **Reisebilder** (WI-0272 S3, Aufgabe 19): `photobox_eingang` trägt keine Nummer; ohne Text lautet der Satz „Neues Reisebild zur Prüfung“, steht im `text` eine Zahl, „3 neue Reisebilder zur
 *   Prüfung“. Der ganze Satz ist ein Verweis in die Medienverwaltung (Korb „PhotoBox-Uploads“, Offen), wenn die Person sie öffnen darf. Am jüngsten Eintrag stehen die Bilder, die jetzt offen sind, als Vorschau;
 *   ein Klick öffnet genau dieses Bild (`app-glocke.vue`).
 * - **Bewertungen** (Vali 2026-11-04): `bewertung_neu` trägt die Kennung der Bewertung oder, gebündelt, die Zahl. Der ganze Satz ist der Verweis: zu dieser Bewertung, gebündelt in Community › Bewertungen.
 */

export type Kreis = "leer" | "halb" | "voll";

/** Wartet dieser Eintrag noch auf die Antwort der Empfängerin? Nur „Fix ist live“ mit Frage, solange der Vorgang zur Abnahme steht. */
export function wartetAufAntwort(eintrag: Benachrichtigung): boolean {
    return eintrag.frageGeloest && eintrag.antwort === null && eintrag.vorgang?.status === "zur_abnahme";
}

/**
 * „Neu“ und „Archiv“ (Betreiber 2026-10-13: „benachrichtungen sollen für nutzer nicht verschwinden, wenn sie was gelesen haben, soll es
 * ausgegraut oder in archiv“).
 *
 * 🔴 **Eine Regel ohne Zahlen:** Was beim Öffnen ungelesen war, steht unter „Neu“ — bis zum nächsten Öffnen. Alles andere steht im
 * eingeklappten Archiv. Kein Stichtag, keine Menge, nichts zu erklären. Der Schnitt ist die höchste Kennung, die beim vorigen Öffnen
 * schon dastand; ohne gemerkten Schnitt (erstes Öffnen, geleerter Speicher, privates Fenster) entscheidet der Server mit `gelesenAt`.
 *
 * Das Öffnen der Glocke markiert alles als gelesen — deshalb kann der Kreis diese Trennung nicht tragen, und deshalb merkt sie sich der
 * Browser, nicht der Server: Es ist eine Bequemlichkeit dieses einen Geräts, kein Zustand, den jemand nachlesen können muss.
 */
export interface GlockenTeile {
    neu: Benachrichtigung[];
    archiv: Benachrichtigung[];
}

export function neuUndArchiv(eintraege: readonly Benachrichtigung[], schnitt: number | null): GlockenTeile {
    const istNeu = (eintrag: Benachrichtigung): boolean =>
        schnitt === null ? eintrag.gelesenAt === null : eintrag.id > schnitt;
    return {
        neu: eintraege.filter((eintrag) => istNeu(eintrag)),
        archiv: eintraege.filter((eintrag) => !istNeu(eintrag)),
    };
}

/**
 * Der Schnitt, wenn dieses Gerät noch keinen gemerkt hat: die jüngste schon gelesene Kennung (0 ohne). 🔴 Beim Öffnen einfrieren: Das Öffnen
 * markiert alles als gelesen und lädt neu, und ohne festen Schnitt rutschte danach jeder Eintrag sofort ins Archiv (seit dem Archiv vom
 * 2026-10-13, gefunden vom ersten Sammellauf unter A über `glocke.spec.ts`). „Gelesen“ setzt der Server bis zu einer Kennung, das Gelesene
 * ist also immer ein Anfang der Liste.
 */
export function schnittAusGelesen(eintraege: readonly Benachrichtigung[]): number {
    return eintraege.reduce(
        (hoechste, eintrag) => (eintrag.gelesenAt === null ? hoechste : Math.max(hoechste, eintrag.id)),
        0,
    );
}

/** Der Schlüssel des gemerkten Schnitts. Je Gerät und Browser, nie je Person: Er verrät nichts, was nicht ohnehin dastünde. */
const SCHNITT_SCHLUESSEL = "avm.glocke.gesehen-bis";

/** Liest den gemerkten Schnitt; alles, was dabei schiefgehen kann, heißt „nicht gemerkt“ (privates Fenster, geleerter Speicher). */
export function gesehenBis(): number | null {
    try {
        const roh = window.localStorage.getItem(SCHNITT_SCHLUESSEL);
        if (roh === null) return null;
        const zahl = Number.parseInt(roh, 10);
        return Number.isSafeInteger(zahl) && zahl > 0 ? zahl : null;
    } catch {
        return null;
    }
}

/** Merkt den Schnitt. Schlägt es fehl, bleibt alles „Neu“ — unschön, nie kaputt. */
export function merkeGesehenBis(id: number | undefined): void {
    if (id === undefined) return;
    try {
        window.localStorage.setItem(SCHNITT_SCHLUESSEL, String(id));
    } catch {
        // Kein Speicher: Die Trennung fällt auf `gelesenAt` zurück.
    }
}

export function kreisVon(eintrag: Benachrichtigung): Kreis {
    if (eintrag.gelesenAt === null) return "leer";
    return wartetAufAntwort(eintrag) ? "halb" : "voll";
}

/** Der Name des Absenders; eine aufgelöste Person heißt wie ihr Platzhalter. */
export function absender(eintrag: Benachrichtigung): string {
    const von = eintrag.von;
    if (von.art === "claudio") return "Claudio";
    if (von.art === "claudia") return "Claudia";
    // Eine Sonderrolle beim Eingang (WI-0279) setzt Avesmaps selbst, nicht „das System“.
    if (von.art === "system") return eintrag.art === "community_rolle" ? t("notify.avesmaps") : t("notify.system");
    return von.name ?? t("notify.formerPerson");
}

/** Die Rolle neben dem Namen (Blatt WI-0136 (a)): bei Claudio „Betrieb“, bei Claudia „Entwicklung“, sonst nichts. */
export function absenderRolle(eintrag: Benachrichtigung): string | null {
    if (eintrag.art === "community_rolle" && eintrag.von.art === "system") return t("notify.role.eingang");
    const key = `notify.role.${eintrag.von.art}`;
    return isMessageKey(key) ? t(key) : null;
}

/** Der Schlüssel des Satzes: mit Zusatz (Kurztitel) die Fassung „…Titel“, wenn es sie gibt. */
function satzSchluessel(eintrag: Benachrichtigung): MessageKey {
    const mitTitel = `notify.text.${eintrag.art}Titel`;
    if (eintrag.text !== null && isMessageKey(mitTitel)) return mitTitel;
    const ohne = `notify.text.${eintrag.art}`;
    return isMessageKey(ohne) ? ohne : "notify.text.unbekannt";
}

const MARKE = "\u0000OPS\u0000";
const MARKE_COM = "\u0000COM\u0000";
/** Die COM-Nummer, wie der Server sie schreibt (`comNummer`: sechs Stellen). Streng, damit keine bloße Zahl und kein Text als Nummer durchgeht. */
const COM_NUMMER = /^COM-[0-9]{6,12}$/u;
/** Die SOC-Nummer eines Beitrags des Social Hubs (WI-0270 C11, `socNummer`), ebenso streng. */
const SOC_NUMMER = /^SOC-[0-9]{6,12}$/u;
/** Die Kennung einer Bewertung, ebenso streng. */
const BEWERTUNG_KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Der Satz in drei Teilen: davor, die OPS-Nummer (ein Link), danach; bei den Arten der Community statt der OPS-Nummer `com`. */
export interface SatzTeile {
    vor: string;
    ops: string | null;
    nach: string;
    /** Der Link der Community: `text` ist, was angeklickt wird, `nummer` der Vorgang (`null`: die Liste der Meldungen). */
    com?: { text: string; nummer: string | null };
    /** Der Link der Reisebilder: `text` ist, was angeklickt wird; er öffnet die Medienverwaltung im Korb „PhotoBox-Uploads“ (WI-0272 S3, Aufgabe 19). */
    medien?: { text: string };
}

/** Ist das eine Art der Community (`community_*`)? */
export const istCommunityArt = (art: string): boolean =>
    COMMUNITY_GLOCKEN_ARTEN.includes(art) || SOCIAL_GLOCKEN_ARTEN.includes(art);

/**
 * Der Satz einer Art der Community (WI-0268 C5), sonst `null`. Die Nummer im `text` ist der Link; eine gebündelte `community_neu` mit Zahl ist als
 * Ganzes einer („3 neue Meldungen“, ohne den Punkt am Ende) und führt in die Liste. 🔴 Nie ein anderer Text als Nummer oder Zahl: Was sonst im `text`
 * stünde, wird nicht gezeigt.
 */
function communityTeile(eintrag: Benachrichtigung): SatzTeile | null {
    if (!istCommunityArt(eintrag.art)) return null;
    if (eintrag.art === "community_rolle") return rollenTeile(eintrag);
    const anzahl = eintrag.art === "community_neu" ? communityNeuAnzahl(eintrag.text) : undefined;
    if (anzahl !== undefined) {
        const satz = tPlural("notify.text.community_neuViele", anzahl, { n: formatNumber(anzahl, 0) });
        const ende = /[.!?]$/u.test(satz) ? satz.length - 1 : satz.length;
        return { vor: "", ops: null, nach: satz.slice(ende), com: { text: satz.slice(0, ende), nummer: null } };
    }
    const schluessel = `notify.text.${eintrag.art}`;
    if (!isMessageKey(schluessel)) return null;
    // Die Nummer im `text`: COM-… führt in die Meldungen, SOC-… (Social Hub, WI-0270) in den Beitrag.
    const nummer =
        eintrag.text !== null && (COM_NUMMER.test(eintrag.text) || SOC_NUMMER.test(eintrag.text)) ? eintrag.text : null;
    const satz = t(schluessel, { wer: absender(eintrag), text: nummer === null ? "" : MARKE_COM });
    const [vor, ...rest] = satz.split(MARKE_COM);
    if (nummer === null || rest.length === 0) return { vor: satz.split(MARKE_COM).join(""), ops: null, nach: "" };
    return { vor: vor ?? "", ops: null, nach: rest.join(nummer), com: { text: nummer, nummer } };
}

/**
 * Eine Meldung für eine Sonderrolle (WI-0279): „Eine neue Meldung für Derograph, zugewiesen von Vali: COM-000072.“ und gebündelt „3 neue Meldungen für Derograph, zugewiesen von
 * Avesmaps: COM-…, COM-…“. Die Nummern sind der Link; eine führt in ihre Meldung, mehrere in die Liste (dort stehen sie unter „Meine“). 🔴 Nur Rolle und Nummern aus dem `text`.
 */
function rollenTeile(eintrag: Benachrichtigung): SatzTeile {
    const glocke = leseRollenGlocke(eintrag.text);
    // 🔴 Was kein Text dieser Art ist, wird nicht gezeigt: dann der Satz ohne Rolle und Nummer.
    if (glocke === undefined)
        return { vor: t("notify.text.community_rolleOhne", { wer: absender(eintrag) }), ops: null, nach: "" };
    const rolleKey = `auth.sonderrolle.${glocke.rolle}`;
    const werte = {
        wer: absender(eintrag),
        rolle: isMessageKey(rolleKey) ? t(rolleKey) : glocke.rolle,
        nummern: MARKE_COM,
    };
    const satz =
        glocke.anzahl === 1
            ? t("notify.text.community_rolle", werte)
            : tPlural("notify.text.community_rolleViele", glocke.anzahl, {
                  ...werte,
                  n: formatNumber(glocke.anzahl, 0),
              });
    const [vor, ...rest] = satz.split(MARKE_COM);
    const nummern = glocke.nummern.join(", ") + (glocke.anzahl > glocke.nummern.length ? " …" : "");
    return {
        vor: vor ?? "",
        ops: null,
        nach: rest.join(nummern),
        com: { text: nummern, nummer: glocke.nummern.length === 1 && glocke.anzahl === 1 ? glocke.nummern[0]! : null },
    };
}

/**
 * Der Satz einer Art der Reisebilder (WI-0272 S3, Aufgabe 19), sonst `null`. 🔴 Nie ein anderer Text als die Zahl: Was sonst im `text` stünde (und nie dort steht), wird nicht gezeigt.
 * Der Satz ist als Ganzes ein Verweis, ohne den Punkt am Ende.
 */
function photoboxTeile(eintrag: Benachrichtigung): SatzTeile | null {
    if (!PHOTOBOX_GLOCKEN_ARTEN.includes(eintrag.art)) return null;
    const anzahl = photoboxEingangAnzahl(eintrag.text);
    const satz =
        anzahl === undefined
            ? t("notify.text.photobox_eingang")
            : tPlural("notify.text.photobox_eingangViele", anzahl, { n: formatNumber(anzahl, 0) });
    const ende = /[.!?]$/u.test(satz) ? satz.length - 1 : satz.length;
    return { vor: "", ops: null, nach: satz.slice(ende), medien: { text: satz.slice(0, ende) } };
}

/** Der Satz einer neuen Bewertung oder eines neuen Kartenvorschlags, sonst `null`. 🔴 Nie ein anderer Text als Kennung oder Zahl. Als Ganzes ein Verweis, ohne den Punkt am Ende; `nummer` ist die Kennung oder `null`: die Liste. */
function bewertungTeile(eintrag: Benachrichtigung): SatzTeile | null {
    const karte = KARTENVORSCHLAG_GLOCKEN_ARTEN.includes(eintrag.art);
    if (!karte && !BEWERTUNG_GLOCKEN_ARTEN.includes(eintrag.art)) return null;
    const anzahl = communityNeuAnzahl(eintrag.text);
    const satz =
        anzahl === undefined
            ? t(karte ? "notify.text.kartenvorschlag_neu" : "notify.text.bewertung_neu")
            : tPlural(karte ? "notify.text.kartenvorschlag_neuViele" : "notify.text.bewertung_neuViele", anzahl, {
                  n: formatNumber(anzahl, 0),
              });
    const ende = /[.!?]$/u.test(satz) ? satz.length - 1 : satz.length;
    const kennung = eintrag.text !== null && BEWERTUNG_KENNUNG.test(eintrag.text) ? eintrag.text : null;
    return { vor: "", ops: null, nach: satz.slice(ende), com: { text: satz.slice(0, ende), nummer: kennung } };
}

export function satzTeile(eintrag: Benachrichtigung): SatzTeile {
    const community = communityTeile(eintrag);
    if (community !== null) return community;
    const bewertung = bewertungTeile(eintrag);
    if (bewertung !== null) return bewertung;
    const photobox = photoboxTeile(eintrag);
    if (photobox !== null) return photobox;
    const satz = t(satzSchluessel(eintrag), { wer: absender(eintrag), ops: MARKE, text: eintrag.text ?? "" });
    const [vor, ...rest] = satz.split(MARKE);
    if (rest.length === 0 || eintrag.ops === null)
        return { vor: satz.split(MARKE).join(eintrag.ops ?? ""), ops: null, nach: "" };
    return { vor: vor ?? "", ops: eintrag.ops, nach: rest.join(eintrag.ops) };
}

/** Der Satz nach einer Antwort oder einer Abnahme im Kanal (Blatt WI-0136 (b)); `null`: es gibt Knöpfe oder nichts zu sagen. */
export function standSatz(eintrag: Benachrichtigung, zeit: (iso: string) => string): string | null {
    if (eintrag.antwort !== null) return t(`notify.state.${eintrag.antwort}`);
    const vorgang = eintrag.vorgang;
    if (vorgang === null || (eintrag.art !== "kanal_fix_live" && eintrag.art !== "kanal_zur_abnahme")) return null;
    if (vorgang.status === "abgenommen") {
        return vorgang.abgenommenVon === null || vorgang.abgenommenAt === null
            ? t("notify.state.abgenommenOhne")
            : t("notify.state.abgenommen", { name: vorgang.abgenommenVon, time: zeit(vorgang.abgenommenAt) });
    }
    if (vorgang.status !== "zur_abnahme") return t("notify.state.wieder");
    return null;
}

const ANTWORT_FEHLER: Record<string, MessageKey> = {
    kanal_conflict: "notify.error.conflict",
    kanal_transition: "notify.error.conflict",
    benachrichtigung_beantwortet: "notify.error.answered",
    benachrichtigung_ohne_frage: "notify.error.answered",
};

export interface BenachrichtigungenDeps {
    fetcher?: Fetcher;
    sichtbar?: () => boolean;
    taktMs?: number;
}

export interface Benachrichtigungen {
    liste: ShallowRef<BenachrichtigungListe | null>;
    ungelesen: ComputedRef<number>;
    /** Die letzte Abfrage scheiterte (Blatt (d)); die alte Liste bleibt stehen. */
    fehler: Ref<boolean>;
    /** Die Kennung des Eintrags, dessen Antwort gerade hinausgeht. */
    busy: Ref<number | null>;
    /** Was eine Antwort verhinderte, je Eintrag. */
    antwortFehler: Ref<{ id: number; problems: Phrase[] } | null>;
    lies(): Promise<void>;
    start(): void;
    stop(): void;
    /** Alle bis zur jüngsten als gelesen (beim Öffnen der Klappe). */
    gelesen(): Promise<void>;
    antworten(id: number, antwort: BenachrichtigungAntwort, kommentar?: string): Promise<boolean>;
}

export function createBenachrichtigungen(deps: BenachrichtigungenDeps = {}): Benachrichtigungen {
    const fetcher: Fetcher = deps.fetcher ?? ((...args) => globalThis.fetch(...args));
    const sichtbar = deps.sichtbar ?? (() => document.visibilityState === "visible");
    const liste = shallowRef<BenachrichtigungListe | null>(null);
    const fehler = ref(false);
    const busy = ref<number | null>(null);
    const antwortFehler = ref<{ id: number; problems: Phrase[] } | null>(null);
    let etag: string | undefined;
    let takt: ReturnType<typeof setInterval> | undefined;
    let laeuft = false;

    async function lies(): Promise<void> {
        try {
            const response = await fetcher(BENACHRICHTIGUNG_URL, {
                headers: etag === undefined ? {} : { "if-none-match": etag },
                cache: "no-cache",
                credentials: "same-origin",
            });
            if (response.status === 304) {
                fehler.value = false;
                return;
            }
            if (!response.ok) {
                fehler.value = true;
                return;
            }
            etag = response.headers.get("etag") ?? undefined;
            liste.value = (await response.json()) as BenachrichtigungListe;
            fehler.value = false;
        } catch {
            fehler.value = true;
        }
    }

    function sichtbarGeworden(): void {
        if (sichtbar()) void lies();
    }

    return {
        liste,
        ungelesen: computed(() => liste.value?.ungelesen ?? 0),
        fehler,
        busy,
        antwortFehler,
        lies,
        start() {
            if (laeuft) return;
            laeuft = true;
            void lies();
            takt = setInterval(() => {
                if (sichtbar()) void lies();
            }, deps.taktMs ?? BENACHRICHTIGUNG_TAKT_MS);
            document.addEventListener("visibilitychange", sichtbarGeworden);
        },
        stop() {
            laeuft = false;
            if (takt !== undefined) clearInterval(takt);
            takt = undefined;
            document.removeEventListener("visibilitychange", sichtbarGeworden);
        },
        async gelesen() {
            const bis = liste.value?.eintraege[0]?.id;
            if (bis === undefined || (liste.value?.ungelesen ?? 0) === 0) return;
            try {
                await postJson(`${BENACHRICHTIGUNG_URL}/gelesen`, { bis }, fetcher);
            } catch {
                // „gelesen“ ist eine Zugabe; die nächste Abfrage zeigt den Stand.
            }
            await lies();
        },
        async antworten(id, antwort, kommentar) {
            if (busy.value !== null) return false;
            busy.value = id;
            antwortFehler.value = null;
            let ok = false;
            try {
                await withConfirmation(
                    () =>
                        postJson<OperationReceipt>(
                            `${BENACHRICHTIGUNG_URL}/${String(id)}/antwort`,
                            {
                                operationId: newOperationId(),
                                antwort,
                                ...(kommentar === undefined ? {} : { kommentar: kommentar.trim() }),
                            },
                            fetcher,
                        ),
                    requestConfirmation,
                );
                ok = true;
            } catch (error) {
                const code = error instanceof ApiFailure ? error.code : undefined;
                antwortFehler.value = {
                    id,
                    problems:
                        code !== undefined && code in ANTWORT_FEHLER
                            ? [{ key: ANTWORT_FEHLER[code]! }]
                            : formProblems(error),
                };
            } finally {
                busy.value = null;
            }
            await lies();
            return ok;
        },
    };
}

let geteilt: Benachrichtigungen | undefined;

/** Die eine Glocke der Seite. */
export function useBenachrichtigungen(): Benachrichtigungen {
    geteilt ??= createBenachrichtigungen();
    return geteilt;
}
