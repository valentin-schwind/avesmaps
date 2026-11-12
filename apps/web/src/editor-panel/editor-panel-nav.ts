import { shallowRef, type ShallowRef } from "vue";
import {
    CAPABILITY_NAMES,
    ausTiefemLink,
    merkschluessel,
    merkwerte,
    waehlbar,
    wiederherstellen,
    type NavTafel,
    type ViewerContext,
} from "@avesmaps3d/shared";
import type { AuthSnapshot } from "../auth/session-state";

/**
 * Wo im Editorpanel man steht (WI-0128 E3, EDIT-0001 §3.2 „Merken und Tiefe Links“): die Kaskade der Reiter und der Schiene aus
 * dem Navigationsregister. Reine Logik ohne Bauteil, damit Vitest sie ohne Browser prüft.
 *
 * - **Gemerkt** wird nur die Kaskade, je Knoten ein Schlüssel `avesmaps3d.nav.<tafel>.<knoten>` (Legacy `REVIEW_TAB_FAMILIES`,
 *   Owner 2026-07-17: „Merk dir immer wo ich als editor zuletzt war … nach einem refresh“). Ansichten, Suche, Filter und Auswahl
 *   nicht. Dazu, ob das Panel offen war (Legacy `avesmaps.edit.reviewPanelHidden`).
 * - 🔴 **Ohne Speicher geht alles weiter:** Jeder Zugriff steht in `try/catch`; dann gilt die Wahl bis zum Neuladen.
 * - **Tiefe Links** (`?tab=`, Legacys `reviewTab` und `wikiSyncTab`) werden nur gelesen, nie geschrieben (Legacy-Policy
 *   2026-07-06): Die Adresszeile bleibt, wie sie ist. Ein gültiger Link schlägt das Gemerkte und öffnet das Panel.
 */

/** Die Parameter eines Tiefen Links, in dieser Reihenfolge; `tab` ist unserer, die beiden anderen sind Legacys. */
export const TIEFER_LINK_PARAMETER = ["tab", "reviewTab", "wikiSyncTab"] as const;

/** Der Tiefe Link der Adresse, sonst `undefined`. */
export function tieferLinkAus(search: string): string | undefined {
    const parameter = new URLSearchParams(search);
    for (const name of TIEFER_LINK_PARAMETER) {
        const wert = parameter.get(name);
        if (wert) return wert;
    }
    return undefined;
}

/** Was vom Speicher gebraucht wird; `localStorage` erfüllt es, ein Test legt eine Tafel hin. */
export type Speicher = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Der Speicher des Browsers, falls es ihn gibt; schon der Zugriff kann werfen (gesperrte Website-Daten). */
export function browserSpeicher(): Speicher | undefined {
    try {
        return globalThis.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}

function lies(speicher: Speicher | undefined, schluessel: string): string | null {
    try {
        return speicher?.getItem(schluessel) ?? null;
    } catch {
        return null;
    }
}

function schreib(speicher: Speicher | undefined, schluessel: string, wert: string | null): void {
    try {
        if (wert === null) speicher?.removeItem(schluessel);
        else speicher?.setItem(schluessel, wert);
    } catch {
        // Ohne Speicher gilt die Wahl bis zum Neuladen.
    }
}

/** Alle gemerkten Werte einer Tafel: je Knoten mit Kindern (und die oberste Ebene) ein Schlüssel. */
export function gemerktAus(tafel: NavTafel, speicher: Speicher | undefined): Map<string, string> {
    const knoten: (string | null)[] = [null, ...tafel.eintraege.filter((x) => x.kinder !== undefined).map((x) => x.id)];
    const gemerkt = new Map<string, string>();
    for (const id of knoten) {
        const schluessel = merkschluessel(tafel, id);
        const wert = lies(speicher, schluessel);
        if (wert !== null) gemerkt.set(schluessel, wert);
    }
    return gemerkt;
}

/** Der Schlüssel, unter dem steht, ob das Panel offen war. */
export const offenSchluessel = (tafel: NavTafel): string => `avesmaps3d.panel.${tafel.id}`;

const offenGemerkt = (wert: string | null): boolean | undefined =>
    wert === "offen" ? true : wert === "zu" ? false : undefined;

/**
 * Geht das Panel beim Laden auf? Am Rechner ja — wer im Editor-Modus angemeldet ist, will den Editor sehen.
 *
 * 🔴 **Nur ein eigenes Zuklappen hält es zu.** Vorher galt die Umkehrung (ohne Gemerktes zu), damit die Karte frei
 * bleibt; das war ein Implementierungsdetail von mir, und es war falsch: Wer sich zum ersten Mal anmeldet, sieht dann
 * eine Karte mit einer schmalen Lasche und hält den Editor für nicht ausgerollt. Betreiber 2026-10-14: „im editor-modus
 * [soll] das editor-panel auftauchen. IMMER, wenn ein editor eingeloggt ist“ — und für eine Abnahme des Ortseditors ist
 * es ohnehin die einzig sinnvolle Vorgabe. Legacy machte es genauso.
 *
 * 🔴 Am Telefon startet es weiter eingeklappt (EDIT-0001 §7.1 E3): Dort nimmt es den ganzen Bildschirm.
 */
export function oeffnetBeimLaden(stand: Pick<NavStand, "ausLink" | "gemerktOffen">, telefon: boolean): boolean {
    if (telefon) return false;
    return stand.ausLink || stand.gemerktOffen !== false;
}

/**
 * Die Rechte, nach denen das Register filtert. Mit eingerichteter Anmeldung die der Sitzung, auf einer Instanz ohne sie (lokal,
 * Basic Auth) der ganze Katalog, wie die Editor-Ansicht dort (`bootstrap-viewer.ts`). Ohne Editor-Modus und in der Besuchervorschau keine.
 * Was jemand darf, prüft der Server; das hier steuert nur die Ansicht.
 */
export function navRechte(viewer: ViewerContext, session: AuthSnapshot): readonly string[] {
    if (!viewer.can("use_editor_menu")) return [];
    return session.known && session.authEnabled ? session.capabilities : CAPABILITY_NAMES;
}

export interface NavStand {
    /** Die gewählte Kette von der obersten Ebene abwärts (Reiter, Subjekt, Ansicht; ein Werkzeug nur aus einem Tiefen Link). */
    readonly pfad: Readonly<ShallowRef<readonly string[]>>;
    /** Die Wahl unter einem Knoten (`null`: oberste Ebene). */
    gewaehlt(unter: string | null): string | undefined;
    /** Wählt einen Eintrag; die Kaskade darunter kommt aus dem Gemerkten. Nicht Wählbares (später, ohne Recht) bleibt ohne Wirkung. */
    waehle(id: string): void;
    /** Stand ein gültiger Tiefer Link in der Adresse? Dann geht das Panel beim Laden auf. */
    readonly ausLink: boolean;
    /** War das Panel beim letzten Mal offen? `undefined`: nichts gemerkt (erster Besuch, kein Speicher). */
    readonly gemerktOffen: boolean | undefined;
    /** Merkt, ob das Panel offen ist. */
    merkeOffen(offen: boolean): void;
}

export interface NavStandOptionen {
    tafel: NavTafel;
    rechte: readonly string[];
    /** Die Query der Adresse beim Laden. */
    search: string;
    speicher: Speicher | undefined;
}

export function createNavStand({ tafel, rechte, search, speicher }: NavStandOptionen): NavStand {
    const gemerkt = gemerktAus(tafel, speicher);
    const link = tieferLinkAus(search);
    const start = wiederherstellen(tafel, gemerkt, rechte, link);
    for (const schluessel of start.verwerfen) {
        gemerkt.delete(schluessel);
        schreib(speicher, schluessel, null);
    }
    // Dieselbe Bedingung wie in `wiederherstellen`: Der Link gilt, wenn jeder Schritt seines Pfads wählbar ist.
    const linkPfad = link === undefined ? undefined : ausTiefemLink(tafel, link);
    const ausLink = linkPfad !== undefined && linkPfad.every((id) => waehlbar(tafel, id, rechte));

    const pfad = shallowRef<readonly string[]>(start.pfad);

    function merke(kette: readonly string[]): void {
        for (const [schluessel, wert] of merkwerte(tafel, kette)) {
            gemerkt.set(schluessel, wert);
            schreib(speicher, schluessel, wert);
        }
    }

    return {
        pfad,
        gewaehlt(unter) {
            const kette = pfad.value;
            if (unter === null) return kette[0];
            const index = kette.indexOf(unter);
            return index < 0 ? undefined : kette[index + 1];
        },
        waehle(id) {
            if (!waehlbar(tafel, id, rechte)) return;
            const kette = wiederherstellen(tafel, gemerkt, rechte, id).pfad;
            pfad.value = kette;
            merke(kette);
        },
        ausLink,
        gemerktOffen: offenGemerkt(lies(speicher, offenSchluessel(tafel))),
        merkeOffen(offen) {
            schreib(speicher, offenSchluessel(tafel), offen ? "offen" : "zu");
        },
    };
}
