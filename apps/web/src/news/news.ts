import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { NEWS_URL, istNewsRubrik, type NewsEintrag, type NewsListe } from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";

/**
 * Die Neuigkeiten (WI-0139 N5, N7): was Besucher lesen, wenn sie unten in der Ecke „Neuigkeiten“ öffnen. Wie es aussieht, steht in
 * `neuigkeiten-fenster.vue`.
 *
 * - **Geladen wird erst beim Öffnen.** Wer das Fenster nie aufmacht, holt nichts; der Knopf steht auch ohne Daten da.
 * - 🔴 **Gelesenes verschwindet nicht** (Betreiber 2026-10-13: „benachrichtungen sollen für nutzer nicht verschwinden, wenn sie was
 *   gelesen haben, soll es ausgegraut oder in archiv“). Dieselbe Regel wie in der Glocke: Was beim Öffnen neu war, steht als neu da —
 *   bis zum nächsten Öffnen. Alles Frühere bleibt, nur leiser.
 * - **Der Lesestand liegt allein im Browser** (`localStorage`, in `try/catch`), ohne Server und ohne Kennung. Er ist eine Bequemlichkeit
 *   dieses Geräts; geht er verloren, ist alles einmal wieder neu. Das ist der harmloseste denkbare Fehler.
 */

/** Der Schlüssel des Lesestands: die höchste Kennung, die beim letzten Öffnen dastand. */
const STAND_SCHLUESSEL = "avm.neuigkeiten.gesehen-bis";

export function gesehenBis(): number | null {
    try {
        const roh = window.localStorage.getItem(STAND_SCHLUESSEL);
        if (roh === null) return null;
        const zahl = Number.parseInt(roh, 10);
        return Number.isSafeInteger(zahl) && zahl > 0 ? zahl : null;
    } catch {
        return null;
    }
}

export function merkeGesehenBis(id: number | undefined): void {
    if (id === undefined) return;
    try {
        window.localStorage.setItem(STAND_SCHLUESSEL, String(id));
    } catch {
        // Kein Speicher: Dann ist beim nächsten Mal wieder alles neu. Nichts geht verloren.
    }
}

/** Ist dieser Eintrag seit dem letzten Öffnen dazugekommen? Ohne Lesestand ist nichts „neu“ — sonst leuchtete beim ersten Mal alles. */
export function istNeu(eintrag: NewsEintrag, stand: number | null): boolean {
    return stand !== null && eintrag.id > stand;
}

/** Der Name der Rubrik für die Marke; eine unbekannte Rubrik steht als sie selbst da, ohne Marke (der Server darf neue Namen liefern). */
export function rubrikName(rubrik: string): string | null {
    if (!istNewsRubrik(rubrik)) return null;
    const key = `news.rubrik.${rubrik}` as MessageKey;
    return t(key);
}

/**
 * Ein Monat mit seinen Einträgen; die Liste kommt schon sortiert, hier wird nur gruppiert. Gruppiert wird nach **Monat**, nicht nach Tag
 * (Legacy `js/app/changelog-dialog.js`, Betreiber 2026-10-14 „zum Design von Legacy passen“): das Monatsband trägt die Überschrift, der
 * Tag steht in der Datumsspalte des Eintrags.
 */
export interface NewsMonat {
    /** `2026-10`, die ersten sieben Zeichen des Datums. */
    monat: string;
    eintraege: NewsEintrag[];
}

export function nachMonaten(eintraege: readonly NewsEintrag[]): NewsMonat[] {
    const monate: NewsMonat[] = [];
    for (const eintrag of eintraege) {
        const monat = eintrag.datum.slice(0, 7);
        const letzter = monate.at(-1);
        if (letzter?.monat === monat) letzter.eintraege.push(eintrag);
        else monate.push({ monat, eintraege: [eintrag] });
    }
    return monate;
}

/** Ein Stück Eintragstext: gewöhnlicher Text oder eine Adresse, die ein Verweis wird. */
export type NewsStueck = { art: "text"; wert: string } | { art: "verweis"; wert: string };

const NACHLAUF = ".,;:!?…\"'»«“„’‚";

function zaehle(text: string, zeichen: string): number {
    let anzahl = 0;
    for (const stelle of text) if (stelle === zeichen) anzahl += 1;
    return anzahl;
}

/**
 * Schneidet ab, was dem Satz gehört und nicht der Adresse.
 *
 * 💣 **Das nachlaufende Satzzeichen gehört dem Satz** (Legacy `avesmapsChangelogTextSegmente`): Ein Eintrag endet auf
 * „…watch?v=gBJn-d_B3w4.“ — wer den Punkt mitnimmt, baut einen Link auf eine Kennung, die es nicht gibt, und es fällt niemandem auf.
 * ⚠️ Bei der Klammer wird **gezählt**, nicht abgeschnitten: Wikipedia-Adressen tragen Klammern im Pfad (`…/Aventurien_(Welt)`).
 */
function schneide(adresse: string): string {
    let rest = adresse;
    while (rest.length > 0) {
        const letztes = rest.slice(-1);
        if (NACHLAUF.includes(letztes)) rest = rest.slice(0, -1);
        else if (letztes === ")" && zaehle(rest, "(") < zaehle(rest, ")")) rest = rest.slice(0, -1);
        else if (letztes === "]" && zaehle(rest, "[") < zaehle(rest, "]")) rest = rest.slice(0, -1);
        else break;
    }
    return rest;
}

/**
 * Zerlegt einen Eintragstext in Text- und Verweisstücke; das Fenster hängt daraus Text und `FensterVerweis` ans DOM, nie HTML.
 *
 * 🔴 Erkannt wird **ausschließlich** `http://` und `https://` — das ist zugleich der Riegel gegen `javascript:` und der Grund, warum ein
 * nacktes „www.example.de“ Text bleibt: ob eine Zeichenkette mit Punkt eine Adresse ist, kann man nur raten, und ein geratener Link im
 * Fließtext ist schlimmer als gar keiner. Dieselbe Regel wie in Legacy; `[Text](…)` wie in `fenster-text.ts` kennen die Einträge nicht,
 * sie tragen nackte Adressen (103 übernommene Einträge, drei davon mit Adresse).
 */
export function textStuecke(roh: string): NewsStueck[] {
    const stuecke: NewsStueck[] = [];
    const schiebeText = (wert: string): void => {
        if (wert === "") return;
        const letztes = stuecke.at(-1);
        // Zwei Textstücke hintereinander werden eines - sonst stünden zwei Knoten da, wo einer gemeint war.
        if (letztes?.art === "text") letztes.wert += wert;
        else stuecke.push({ art: "text", wert });
    };

    let gelesen = 0;
    for (const treffer of roh.matchAll(/https?:\/\/\S+/gi)) {
        const adresse = schneide(treffer[0]);
        // Nach dem Schnitt muss hinter dem Schema noch etwas stehen - „https://.“ ist keine Adresse.
        if (!/^https?:\/\/[^/\s]\S*$/i.test(adresse)) continue;
        schiebeText(roh.slice(gelesen, treffer.index));
        stuecke.push({ art: "verweis", wert: adresse });
        gelesen = treffer.index + adresse.length;
    }
    schiebeText(roh.slice(gelesen));
    return stuecke;
}

export interface Neuigkeiten {
    liste: ShallowRef<NewsListe | null>;
    fehler: Ref<boolean>;
    laedt: Ref<boolean>;
    /** Der Lesestand des letzten Öffnens; er steht fest, solange das Fenster offen ist. */
    stand: Ref<number | null>;
    oeffnen: () => Promise<void>;
}

export function createNeuigkeiten(fetcher: typeof fetch = fetch): Neuigkeiten {
    const liste = shallowRef<NewsListe | null>(null);
    const fehler = ref(false);
    const laedt = ref(false);
    const stand = ref<number | null>(null);
    let etag: string | undefined;

    return {
        liste,
        fehler,
        laedt,
        stand,
        async oeffnen() {
            // Der Lesestand des vorigen Öffnens gilt für diese ganze Sitzung des Fensters; der neue wird gleich gemerkt.
            stand.value = gesehenBis();
            laedt.value = true;
            try {
                const response = await fetcher(NEWS_URL, {
                    headers: etag === undefined ? {} : { "if-none-match": etag },
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
                liste.value = (await response.json()) as NewsListe;
                fehler.value = false;
                merkeGesehenBis(liste.value.eintraege[0]?.id);
            } catch {
                fehler.value = true;
            } finally {
                laedt.value = false;
            }
        },
    };
}

let geteilt: Neuigkeiten | undefined;

/** Die eine Liste der Seite. */
export function useNeuigkeiten(): Neuigkeiten {
    geteilt ??= createNeuigkeiten();
    return geteilt;
}
