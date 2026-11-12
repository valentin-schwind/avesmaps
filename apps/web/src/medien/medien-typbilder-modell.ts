import {
    typeImageVariantAccepts,
    type HeaderGraphic,
    type HeaderGraphicObjects,
    type MamTypeImage,
    type MamTypeImageList,
    type MamTypeImageSlot,
    type MediaTypeImageVariant,
} from "@avesmaps3d/shared";

/**
 * Das Modell der Typbildliste (WI-0068, Betreiber 2026-10-11: „kannst du im MAM die neue kategorie „Typbilder“ machen … markiere diese
 * immer dann mit einem stern“; Oberfläche nach WI-0068 „Typbilder“, Blatt abgenommen 2026-10-12).
 *
 * Reine Funktionen, damit Vitest sie ohne Browser prüft; das Bauteil liest und schreibt nur über sie.
 *
 * 🪤 Die Kategorien sind eine FESTE Liste des Servers (`HEADER_GRAPHICS`), keine Seite: Suche, Trichter und Sortierung rechnet der
 * Browser. Deshalb gibt es hier kein `offset` und kein „Mehr laden“ — und deshalb bleibt eine Kategorie OHNE ★ sichtbar, statt aus der
 * Liste zu fallen (sie ist der eigentliche Arbeitsvorrat).
 *
 * **Zwei Varianten je Kategorie** (WI-0281, Betreiber 2026-11-05): KI und ohne KI, je mit eigenem ★ (`typbildSlot`). Der Paarstand (`paarStand`) sagt, was
 * vorhanden ist; der Trichter sucht unvollständige Paare.
 */

const LEER: MamTypeImageSlot = Object.freeze({ current: null, former: 0, formerItems: [] }) as MamTypeImageSlot;

/** Eine Variante einer Kategorie. 🪤 Die KI-Variante steht in den Feldern der Vorversion (`current`, `former`, `formerItems`); fehlt `ohneKi` (Vorversion), ist sie leer. */
export function typbildSlot(eintrag: MamTypeImage, variante: MediaTypeImageVariant): MamTypeImageSlot {
    if (variante === "ki")
        return { current: eintrag.current, former: eintrag.former, formerItems: eintrag.formerItems };
    return eintrag.ohneKi ?? LEER;
}

/** Was von einem Paar vorhanden ist (eine Variante zählt, sobald sie einen ★ hat, auch wenn Besucher ihn noch nicht sehen). */
export type PaarStand = "paar" | "nurKi" | "nurOhneKi" | "keines";

export function paarStand(eintrag: MamTypeImage): PaarStand {
    const ki = eintrag.current !== null;
    const ohne = typbildSlot(eintrag, "ohne_ki").current !== null;
    if (ki && ohne) return "paar";
    if (ki) return "nurKi";
    return ohne ? "nurOhneKi" : "keines";
}

/**
 * Passt die Entstehung des ★ zu seiner Variante (`typeImageVariantAccepts`)? Nein, wenn jemand die Entstehung nach der Wahl umgetragen hat; dann sagt es der
 * Inspector, und eine Ohne-KI-Variante sehen Besucher nicht mehr. Ohne ★ oder ohne Angabe (Vorversion) gibt es nichts zu sagen.
 */
export function entstehungPasst(slot: MamTypeImageSlot, variante: MediaTypeImageVariant): boolean {
    const method = slot.current?.creationMethod;
    return method === undefined || typeImageVariantAccepts(variante, method);
}

/**
 * Das ★-Asset einer Variante einer Kategorie; `undefined` ohne Kategorie, ohne Liste, ohne Eintrag und ohne ★. Der Einstieg aus dem Infopanel (⚙ am Typbild, WI-0272 S5) kennt nur die Kategorie
 * (und seit WI-0281 die Variante): Die öffentliche Quelle der Typbilder trägt keine Asset-Kennung, die geschützte Liste der Medienverwaltung schon.
 */
export function sternAsset(
    liste: MamTypeImageList | undefined,
    kategorie: HeaderGraphic | undefined,
    variante: MediaTypeImageVariant = "ki",
): string | undefined {
    if (liste === undefined || kategorie === undefined) return undefined;
    const eintrag = liste.items.find((zeile) => zeile.category === kategorie);
    return eintrag === undefined ? undefined : typbildSlot(eintrag, variante).current?.assetId;
}

/** Wonach die Liste sortiert: Name der Kategorie oder Zahl der Objekte, die sie zeigen. */
export const TYPBILD_SORTS = ["name", "objekte"] as const;
export type TypbildSort = (typeof TYPBILD_SORTS)[number];

/** Das Zeichen je Sortierung aus der Familie des Hauses (`controls/avm-sortierzeichen.vue`, Guide §13.45). */
export const TYPBILD_SORT_ZEICHEN: Readonly<Record<TypbildSort, "name" | "menge">> = {
    name: "name",
    objekte: "menge",
};

/** Was der Trichter am Paar sucht (WI-0281): vollständig, unvollständig (genau eine Variante), nur eine bestimmte, oder noch keines. */
export const TYPBILD_PAAR_FILTER = ["vollstaendig", "unvollstaendig", "nurKi", "nurOhneKi", "keines"] as const;
export type TypbildPaarFilter = (typeof TYPBILD_PAAR_FILTER)[number];

/** Der Trichter: welche Fachobjekte die Kategorie zeigt, und wie weit ihr Paar ist. */
export interface TypbildFilter {
    objekte?: HeaderGraphicObjects;
    /** Der Paarstand (WI-0281); `keines`: Kategorien, in denen noch die eingebaute Grafik gilt (vorher „ohne ★“). */
    paar?: TypbildPaarFilter;
}

/** Trifft der Paarstand den Filter? */
export function paarPasst(stand: PaarStand, filter: TypbildPaarFilter): boolean {
    switch (filter) {
        case "vollstaendig":
            return stand === "paar";
        case "unvollstaendig":
            return stand === "nurKi" || stand === "nurOhneKi";
        default:
            return stand === filter;
    }
}

export interface TypbildAnsicht {
    suche: string;
    filter: TypbildFilter;
    sort: TypbildSort;
    /** Ohne Angabe gilt die Vorgabe: Name aufsteigend, Zahl absteigend (das Größte zuerst, wie in der Trefferliste). */
    order: "asc" | "desc" | undefined;
}

export const TYPBILD_START: Readonly<TypbildAnsicht> = Object.freeze<TypbildAnsicht>({
    suche: "",
    filter: {},
    sort: "name",
    order: undefined,
});

/** Wie viele Teile des Trichters gesetzt sind (die Zahl am Zeichen). */
export function typbildFilterAnzahl(filter: TypbildFilter): number {
    return (filter.objekte === undefined ? 0 : 1) + (filter.paar === undefined ? 0 : 1);
}

/** Faltung für die Suche: ohne Akzente, klein, damit „Burg“ auch „burg“ findet (wie die Ortsliste). */
function falte(wert: string): string {
    return wert
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase();
}

/**
 * Die Kategorien, die die Ansicht zeigt: erst der Trichter, dann die Suche über Beschriftung, Kategorieschlüssel und die Titel der
 * ★-Assets beider Varianten, dann die Sortierung. Die Reihenfolge ist stabil: bei gleichem Wert entscheidet die Beschriftung, dann der Schlüssel.
 */
export function typbildZeilen(liste: MamTypeImageList | undefined, ansicht: TypbildAnsicht): MamTypeImage[] {
    if (liste === undefined) return [];
    const gesucht = falte(ansicht.suche.trim());
    const gefiltert = liste.items.filter((eintrag) => {
        if (ansicht.filter.objekte !== undefined && eintrag.objects !== ansicht.filter.objekte) return false;
        if (ansicht.filter.paar !== undefined && !paarPasst(paarStand(eintrag), ansicht.filter.paar)) return false;
        if (gesucht === "") return true;
        const felder = [
            eintrag.label,
            eintrag.category,
            eintrag.current?.title ?? "",
            typbildSlot(eintrag, "ohne_ki").current?.title ?? "",
        ];
        return felder.some((feld) => falte(feld).includes(gesucht));
    });
    const richtung = ansicht.order ?? (ansicht.sort === "name" ? "asc" : "desc");
    const faktor = richtung === "asc" ? 1 : -1;
    return [...gefiltert].sort((a, b) => {
        if (ansicht.sort === "objekte") {
            // 🔴 Eine fehlende Zählung (`count: null`, etwa Gipfel und Etappen) ist KEINE kleine Zahl: Sie steht hinten, in beiden
            // Richtungen. Deshalb vor dem Faktor, nicht als Wert -1 — sonst stünde sie aufsteigend vorn.
            const ohneA = a.count === null;
            const ohneB = b.count === null;
            if (ohneA !== ohneB) return ohneA ? 1 : -1;
            if (!ohneA && !ohneB && a.count !== b.count) return (a.count! - b.count!) * faktor;
        } else {
            const primaer = a.label.localeCompare(b.label);
            if (primaer !== 0) return primaer * faktor;
        }
        return a.label.localeCompare(b.label) || a.category.localeCompare(b.category);
    });
}

/** Die gewählte Kategorie in der gefilterten Liste, oder `undefined`, wenn sie der Trichter gerade ausschließt. */
export function typbildZeile(
    zeilen: readonly MamTypeImage[],
    kategorie: HeaderGraphic | undefined,
): MamTypeImage | undefined {
    return kategorie === undefined ? undefined : zeilen.find((eintrag) => eintrag.category === kategorie);
}

/**
 * Was in der Unterzeile der Liste steht: wie viele Kategorien die Ansicht zeigt, wie viele davon noch gar kein Typbild haben und wie viele ein
 * unvollständiges Paar (der Arbeitsvorrat). `uebernehmbar` ist die Zahl des Servers über ALLE Kategorien, nicht die der Ansicht.
 */
export function typbildStand(
    zeilen: readonly MamTypeImage[],
    liste: MamTypeImageList | undefined,
): { gezeigt: number; ohneStern: number; unvollstaendig: number; uebernehmbar: number } {
    const staende = zeilen.map(paarStand);
    return {
        gezeigt: zeilen.length,
        ohneStern: staende.filter((stand) => stand === "keines").length,
        unvollstaendig: staende.filter((stand) => stand === "nurKi" || stand === "nurOhneKi").length,
        uebernehmbar: liste?.adoptable ?? 0,
    };
}

/**
 * Der Zustand des ★-Bilds einer Zeile für die Anzeige: die veröffentlichte Datei, sonst die private Vorschau, sonst die eingebaute
 * Grafik. 🔴 `public: false` heißt „die Policy erlaubt es nicht“: Dann sieht ein Besucher weiter die eingebaute Grafik, und die Liste
 * sagt das — eine private Vorschau ist kein öffentliches Bild (A4).
 *
 * Ohne Angabe der Variante zeigt die Zeile, was der Normalmodus zeigt (WI-0281): die KI-Variante, fehlt ihr ★, die Ohne-KI-Variante.
 */
export type TypbildBild =
    | { art: "oeffentlich"; url: string; width: number; height: number }
    | { art: "intern"; url: string; width: number; height: number }
    | { art: "eingebaut" };

export function typbildBild(
    eintrag: MamTypeImage,
    eingebaut: (kategorie: HeaderGraphic) => string,
    variante?: MediaTypeImageVariant,
): TypbildBild {
    const aktuell =
        variante === undefined
            ? (eintrag.current ?? typbildSlot(eintrag, "ohne_ki").current)
            : typbildSlot(eintrag, variante).current;
    if (aktuell !== null) {
        if (aktuell.public && aktuell.preview !== null) {
            return { art: "oeffentlich", ...aktuell.preview };
        }
        const intern = aktuell.privatePreview;
        if (intern !== null && intern !== undefined) return { art: "intern", ...intern };
    }
    // Die Adresse der eingebauten Datei kommt vom Aufrufer (`header-graphic.ts`), damit dieses Modell nichts über Vite weiß.
    void eingebaut;
    return { art: "eingebaut" };
}
