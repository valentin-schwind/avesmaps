import {
    MAM_BASKETS,
    MAM_EINREICHUNGEN,
    MAM_PAGE_LIMIT,
    MAM_SORTS,
    MEDIA_ASSET_TYPES,
    MEDIA_CLEARANCE_STATES,
    MEDIA_CREATION_METHODS,
    MEDIA_EDITOR_URL,
    MEDIA_ORIGINS,
    MEDIA_RIGHTS_BASES,
    MEDIA_ROLES,
    MEDIA_TECHNICAL_STATES,
    MEDIA_USAGE_ON_MAP,
    MEDIA_USAGE_SUBJECT_KINDS,
    HEADER_GRAPHICS,
    MEDIA_TYPE_IMAGE_VARIANTS,
    PHOTOBOX_GALERIE_OHNE_ORT,
    type HeaderGraphic,
    type MamBasket,
    type MamEinreichung,
    type MediaAssetType,
    type MamSearchQuery,
    type MamSort,
    type MediaClearanceState,
    type MediaCreationMethod,
    type MediaOrigin,
    type MediaRightsBasis,
    type MediaRole,
    type MediaTechnicalState,
    type MediaTypeImageVariant,
    type MediaUsageSubject,
    type MediaUsageSubjectKind,
} from "@avesmaps3d/shared";

/**
 * Das Zustands- und Adressmodell der Medienverwaltung (WI-0068 P3, §18 „URL-/State-Modell so, dass direkter Context Entry
 * reproduzierbar ist“). Reine Funktionen, damit Vitest sie ohne Browser prüft; das Fenster liest und schreibt nur über sie.
 *
 * - **Ein Zustand, eine Adresse:** Was die drei Spalten zeigen (Wahl in Spalte 1, Suche, Filter, „verwendet von“, Sortierung,
 *   Raster oder Liste, gewähltes Asset), steht als Query in der Adresse, solange das Fenster offen ist - nur Abweichungen von der
 *   Vorgabe. `?medien=<asset>` allein ist der tiefe Link auf genau dieses Asset; `?medien` ohne Wert öffnet das Fenster leer.
 * - **Nur bekannte Werte:** Jeder Wert wird gegen die Wertelisten des Vertrags (`media-editor.ts`) geprüft; ein unbekannter fällt
 *   weg, er öffnet nie still etwas anderes. Andere Parameter der Seite (`route`, `edit` …) bleiben unberührt.
 * - **Die Suche ist EINE Abbildung** auf `MamSearchQuery` (`suchanfrage`), dieselbe für Liste und Seiten.
 *
 * Legacy hat keine Medienverwaltung und damit keinen Parameter; die Namen sind neu und deutsch wie `?route=` (AGENTS „Links von
 * Legacy bleiben gültig“: erst geprüft, ob Legacy einen Namen hat).
 */

/**
 * Die Medienobjekte: eigene Gegenstände der Verwaltung, die keine Assetliste sind (WI-0068 §3.1). Typbilder (Betreiber
 * 2026-10-11, Migration 0113) und Galerien (P6, Betreiber 2026-10-12: „eine galerie ist ein medientyp, der bilder sammelt“);
 * die Kartensammlung (WI-0068 R5, zunächst nur lesend) als dritter; die PhotoBox-Galerien (WI-0272, nur lesend) als vierter; die Kartenvorschläge der Besucher (OPS-000093: annehmen und ablehnen
 * wie in Community › Meldungen) als fünfter, unter „Eingänge“.
 */
export const MEDIEN_OBJEKTE = ["typbilder", "galerien", "kartensammlung", "photobox", "kartenvorschlaege"] as const;
export type MedienObjekt = (typeof MEDIEN_OBJEKTE)[number];

/**
 * Was Spalte 1 gewählt hat: alle Assets, einen Asset-Typ (Wappen, Bild …, Betreiber 2026-10-10), ein Medienobjekt (Typbilder) oder einen
 * Prüfkorb - Facetten, genau eine aktiv (Guide §13.14). `typ: null` heißt „alle“.
 */
export type MedienAuswahl = { typ: MediaAssetType | null } | { korb: MamBasket } | { objekt: MedienObjekt };

/**
 * Was die Trefferspalte zum Hochladen anbietet (WI-0068 P4b, Schritt 7): Wappen bei den Wappen, Titelbilder bei den Bildern, beides bei
 * „Alle Medien“; in einem Prüfkorb und bei den anderen Typen nichts (für sie gibt es kein Formular).
 */
export function hochladbareRollen(auswahl: MedienAuswahl): ("coat" | "header")[] {
    // Die Medienobjekte haben keine Assetliste; bei den Typbildern lädt „⇄ anderes Typbild wählen …“ hoch, nicht die Spalte.
    if (!("typ" in auswahl)) return [];
    if (auswahl.typ === null) return ["coat", "header"];
    if (auswahl.typ === "coat") return ["coat"];
    if (auswahl.typ === "picture") return ["header"];
    return [];
}

/**
 * Ist der Korb „PhotoBox-Uploads“ gewählt (WI-0272 S3)? Nur dort gilt die Unterteilung `einreichung` (Offen, Rückfrage, Erledigt), und nur dort stehen die Reiter
 * über der Liste.
 */
export function istEinreichungsKorb(auswahl: MedienAuswahl): boolean {
    return "korb" in auswahl && auswahl.korb === "photobox_uploads";
}

export interface MedienFilter {
    role?: MediaRole;
    rightsBasis?: MediaRightsBasis;
    clearance?: MediaClearanceState;
    origin?: MediaOrigin;
    creation?: MediaCreationMethod;
    technical?: MediaTechnicalState;
}

export type MedienFilterName = keyof MedienFilter;
export type MedienAnsicht = "raster" | "liste";
/**
 * Wie ein Bild in der quadratischen Kachel des Rasters steht (Betreiber 2026-10-10: „bau als option aus "Kachel füllen/Bild ganz
 * anzeigen". kachel bleibt quadratisch“): `fuellen` beschneidet, `ganz` zeigt es mit Rand; beides ohne Verzerrung.
 */
export type MedienBild = "fuellen" | "ganz";

export interface MedienZustand {
    auswahl: MedienAuswahl;
    /** Die Suche im Kopf des Fensters (Guide §13.14: „Ein Suchfeld, das das ganze Fenster filtert, gehört in die Kopfleiste“). */
    q: string;
    filter: MedienFilter;
    /** „Verwendet von“: genau ein Fachobjekt (`place:<uuid>`); der Kontext-Einstieg aus dem Infopanel setzt es. */
    von: string | undefined;
    sort: MamSort;
    /** Ohne Angabe gilt die Vorgabe der Sortierung (Name aufsteigend, sonst das Neueste, Meiste, Offenste zuerst). */
    order: "asc" | "desc" | undefined;
    ansicht: MedienAnsicht;
    /** Nur im Raster: Kachel füllen oder Bild ganz anzeigen. */
    bild: MedienBild;
    /**
     * Der Teil des Korbs „PhotoBox-Uploads“ (WI-0272 S3): Offen ist die Vorgabe, denn dort wartet die Arbeit. Er gilt nur im Korb (`istEinreichungsKorb`); in jeder anderen
     * Facette bleibt er stehen, wie er war, und wirkt weder auf die Suche noch auf die Adresse.
     */
    einreichung: MamEinreichung;
    /** Das gewählte Asset (`public_id`): Spalte 3 zeigt es, auch wenn es in der Liste gerade nicht steht. */
    asset: string | undefined;
    /**
     * Die gewählte Typbildkategorie (`HEADER_GRAPHICS`), nur bei `auswahl.objekt === "typbilder"`. Sie steht neben `asset`, weil eine
     * Kategorie OHNE ★ keines hat: der Inspector zeigt dann die Kategorie samt „noch kein Typbild“ statt eines leeren Kastens.
     */
    kategorie: HeaderGraphic | undefined;
    /**
     * Die Variante der Typbildkategorie, die der Inspector zeigt (WI-0281: KI oder ohne KI), nur bei `auswahl.objekt === "typbilder"`. Sie bleibt beim Wechsel der
     * Kategorie stehen, damit man alle Ohne-KI-Varianten hintereinander pflegen kann; in der Adresse nur, wenn sie von der Vorgabe (KI) abweicht.
     */
    variante: MediaTypeImageVariant;
    /** Die gewählte Galerie (`public_id`), nur bei `auswahl.objekt === "galerien"`. */
    galerie: string | undefined;
    /** Die gewählte Karte der Kartensammlung (`citymap.public_id`), nur bei `auswahl.objekt === "kartensammlung"`. */
    karte: string | undefined;
    /** Die gewählte PhotoBox-Galerie (`place.public_id` oder `PHOTOBOX_GALERIE_OHNE_ORT`), nur bei `auswahl.objekt === "photobox"`. */
    photoboxGalerie: string | undefined;
    /** Der gewählte Kartenvorschlag (öffentliche Kennung der Redaktion, eine UUID), nur bei `auswahl.objekt === "kartenvorschlaege"`. */
    vorschlag: string | undefined;
}

export const MEDIEN_START: Readonly<MedienZustand> = Object.freeze<MedienZustand>({
    auswahl: { typ: null },
    q: "",
    filter: {},
    von: undefined,
    sort: "name",
    order: undefined,
    ansicht: "raster",
    bild: "fuellen",
    einreichung: "offen",
    asset: undefined,
    kategorie: undefined,
    variante: "ki",
    galerie: undefined,
    karte: undefined,
    photoboxGalerie: undefined,
    vorschlag: undefined,
});

/** Die Filter in der Reihenfolge der Leiste und ihre Wertelisten (dieselben wie die CHECKs der Datenbank). */
export const MEDIEN_FILTER_WERTE: Readonly<{ [K in MedienFilterName]: readonly NonNullable<MedienFilter[K]>[] }> = {
    role: MEDIA_ROLES,
    rightsBasis: MEDIA_RIGHTS_BASES,
    clearance: MEDIA_CLEARANCE_STATES,
    origin: MEDIA_ORIGINS,
    creation: MEDIA_CREATION_METHODS,
    technical: MEDIA_TECHNICAL_STATES,
};
export const MEDIEN_FILTER_NAMEN = Object.keys(MEDIEN_FILTER_WERTE) as MedienFilterName[];

/** Die Namen in der Adresse: ein Präfix `medien`, damit nichts mit der Reise oder Legacys Parametern zusammenstößt. */
const ADRESSE = {
    asset: "medien",
    typ: "medien-typ",
    /** Bis 2026-10-10 hieß die Wahl in Spalte 1 `medien-art` (`image`, `model_3d`); gelesen wird es weiter. */
    art: "medien-art",
    korb: "medien-korb",
    einreichung: "medien-einreichung",
    objekt: "medien-objekt",
    kategorie: "medien-kategorie",
    variante: "medien-variante",
    galerie: "medien-galerie",
    karte: "medien-karte",
    photoboxGalerie: "medien-photobox-galerie",
    vorschlag: "medien-vorschlag",
    q: "medien-q",
    von: "medien-von",
    sort: "medien-sort",
    order: "medien-folge",
    ansicht: "medien-ansicht",
    bild: "medien-bild",
} as const;
const FILTER_ADRESSE: Readonly<Record<MedienFilterName, string>> = {
    role: "medien-rolle",
    rightsBasis: "medien-rechte",
    clearance: "medien-pruefung",
    origin: "medien-herkunft",
    creation: "medien-entstehung",
    technical: "medien-technik",
};
const ALLE_NAMEN: readonly string[] = [...Object.values(ADRESSE), ...Object.values(FILTER_ADRESSE)];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VON = new RegExp(
    `^(${MEDIA_USAGE_SUBJECT_KINDS.join("|")}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);
/** Die Suche nimmt höchstens so viel wie der Vertrag (`MamSearchQuery.q`, 200 Zeichen). */
const Q_MAX = 200;

function aus<T extends string>(liste: readonly T[], wert: string | null): T | undefined {
    return wert !== null && (liste as readonly string[]).includes(wert) ? (wert as T) : undefined;
}

export function istAssetKennung(wert: string): boolean {
    return UUID.test(wert);
}

/** Ein Fachobjekt für „verwendet von“ (`place:<uuid>`), oder `undefined`, wenn es keines ist. */
export function vonLesen(wert: string | null | undefined): { kind: MediaUsageSubjectKind; id: string } | undefined {
    const treffer = wert === null || wert === undefined ? null : VON.exec(wert);
    return treffer === null ? undefined : { kind: treffer[1] as MediaUsageSubjectKind, id: treffer[2]! };
}

export function vonSchreiben(kind: MediaUsageSubjectKind, id: string): string {
    return `${kind}:${id}`;
}

/** Hat das Fachobjekt eine Lage auf der Karte („Auf Karte zeigen“, WI-0068 §8)? Ort und Gebiet ja, Werk und Karte nicht. */
export function liegtAufKarte(kind: MediaUsageSubjectKind): boolean {
    return MEDIA_USAGE_ON_MAP[kind];
}

/**
 * Wohin „Auf Karte zeigen“ führt: ein verwendendes Fachobjekt mit Kartenlage oder eine Region am Eintrag der Kartensammlung (WI-0287 Stufe 3,
 * Betreiber 2026-11-07). Die Region öffnet als Fläche (`area`) mit derselben Kennung, wie ein Klick in die Derographie.
 */
export type MedienKartenziel = MediaUsageSubject | { kind: "region"; id: string; name: string; active: boolean };

function photoboxGalerieAusAdresse(objekt: MedienObjekt | undefined, wert: string | null): string | undefined {
    if (objekt !== "photobox" || wert === null) return undefined;
    return wert === PHOTOBOX_GALERIE_OHNE_ORT || istAssetKennung(wert) ? wert : undefined;
}

/** Der Zustand aus der Adresse; `undefined`, wenn sie das Fenster nicht nennt (kein `medien`). */
export function zustandAusAdresse(search: string): MedienZustand | undefined {
    const params = new URLSearchParams(search);
    const asset = params.get(ADRESSE.asset);
    if (asset === null) return undefined;
    const korb = aus(MAM_BASKETS, params.get(ADRESSE.korb));
    const objekt = aus(MEDIEN_OBJEKTE, params.get(ADRESSE.objekt));
    const typ =
        aus(MEDIA_ASSET_TYPES, params.get(ADRESSE.typ)) ?? (params.get(ADRESSE.art) === "model_3d" ? "model_3d" : null);
    const filter: MedienFilter = {};
    for (const name of MEDIEN_FILTER_NAMEN) {
        const wert = aus(MEDIEN_FILTER_WERTE[name] as readonly string[], params.get(FILTER_ADRESSE[name]));
        if (wert !== undefined) (filter as Record<string, string>)[name] = wert;
    }
    const von = params.get(ADRESSE.von);
    const q = (params.get(ADRESSE.q) ?? "").trim().slice(0, Q_MAX);
    return {
        auswahl: korb !== undefined ? { korb } : objekt !== undefined ? { objekt } : { typ },
        q,
        filter,
        von: vonLesen(von) === undefined ? undefined : (von ?? undefined),
        sort: aus(MAM_SORTS, params.get(ADRESSE.sort)) ?? MEDIEN_START.sort,
        order: aus(["asc", "desc"] as const, params.get(ADRESSE.order)),
        ansicht: aus(["raster", "liste"] as const, params.get(ADRESSE.ansicht)) ?? MEDIEN_START.ansicht,
        bild: aus(["fuellen", "ganz"] as const, params.get(ADRESSE.bild)) ?? MEDIEN_START.bild,
        einreichung: aus(MAM_EINREICHUNGEN, params.get(ADRESSE.einreichung)) ?? MEDIEN_START.einreichung,
        asset: istAssetKennung(asset) ? asset : undefined,
        kategorie: objekt === "typbilder" ? aus(HEADER_GRAPHICS, params.get(ADRESSE.kategorie)) : undefined,
        variante:
            (objekt === "typbilder" ? aus(MEDIA_TYPE_IMAGE_VARIANTS, params.get(ADRESSE.variante)) : undefined) ??
            MEDIEN_START.variante,
        galerie:
            objekt === "galerien" && istAssetKennung(params.get(ADRESSE.galerie) ?? "")
                ? (params.get(ADRESSE.galerie) ?? undefined)
                : undefined,
        photoboxGalerie: photoboxGalerieAusAdresse(objekt, params.get(ADRESSE.photoboxGalerie)),
        karte:
            objekt === "kartensammlung" && istAssetKennung(params.get(ADRESSE.karte) ?? "")
                ? (params.get(ADRESSE.karte) ?? undefined)
                : undefined,
        vorschlag:
            objekt === "kartenvorschlaege" && istAssetKennung(params.get(ADRESSE.vorschlag) ?? "")
                ? (params.get(ADRESSE.vorschlag) ?? undefined)
                : undefined,
    };
}

/** Der Name eines Query-Teils (`a%2Db=c` → `a-b`); ein kaputter Teil bleibt, wie er ist, und gilt als fremd. */
function schluesselVon(teil: string): string {
    const name = teil.split("=")[0] ?? "";
    try {
        return decodeURIComponent(name.replace(/\+/g, " "));
    } catch {
        return name;
    }
}

/**
 * Die Adresse (`location.search`) mit diesem Zustand: Alle Parameter des Fensters werden ersetzt, alle anderen bleiben in ihrer
 * Reihenfolge. `undefined` nimmt das Fenster aus der Adresse (geschlossen). Nur Abweichungen von der Vorgabe stehen darin.
 */
export function adresseMitZustand(search: string, zustand: MedienZustand | undefined): string {
    // 🔴 Fremde Parameter bleiben BYTEGLEICH: Ein Umweg über `URLSearchParams.toString()` schriebe `?route=Gareth~Perricum` als
    // `Gareth%7EPerricum` um - lesbar ist die Reise aber nur in Legacys Form (Betreiber 2026-09-23: „mach ?route=“).
    const fremde = search
        .replace(/^\?/, "")
        .split("&")
        .filter((teil) => teil !== "" && !ALLE_NAMEN.includes(schluesselVon(teil)));
    const eigene: string[] = [];
    const setze = (name: string, wert: string): void => {
        eigene.push(`${name}=${encodeURIComponent(wert)}`);
    };
    if (zustand !== undefined) {
        // `medien` ohne Asset steht ohne `=`: lesbarer und gleichbedeutend.
        eigene.push(zustand.asset === undefined ? ADRESSE.asset : `${ADRESSE.asset}=${zustand.asset}`);
        if ("korb" in zustand.auswahl) setze(ADRESSE.korb, zustand.auswahl.korb);
        else if ("objekt" in zustand.auswahl) setze(ADRESSE.objekt, zustand.auswahl.objekt);
        else if (zustand.auswahl.typ !== null) setze(ADRESSE.typ, zustand.auswahl.typ);
        if (zustand.kategorie !== undefined && "objekt" in zustand.auswahl) setze(ADRESSE.kategorie, zustand.kategorie);
        if (
            "objekt" in zustand.auswahl &&
            zustand.auswahl.objekt === "typbilder" &&
            zustand.variante !== MEDIEN_START.variante
        ) {
            setze(ADRESSE.variante, zustand.variante);
        }
        if (zustand.galerie !== undefined && "objekt" in zustand.auswahl) setze(ADRESSE.galerie, zustand.galerie);
        if (zustand.karte !== undefined && "objekt" in zustand.auswahl) setze(ADRESSE.karte, zustand.karte);
        if (zustand.photoboxGalerie !== undefined && "objekt" in zustand.auswahl) {
            setze(ADRESSE.photoboxGalerie, zustand.photoboxGalerie);
        }
        if (zustand.vorschlag !== undefined && "objekt" in zustand.auswahl) setze(ADRESSE.vorschlag, zustand.vorschlag);
        const q = zustand.q.trim();
        if (q !== "") setze(ADRESSE.q, q.slice(0, Q_MAX));
        if (zustand.von !== undefined) setze(ADRESSE.von, zustand.von);
        for (const name of MEDIEN_FILTER_NAMEN) {
            const wert = zustand.filter[name];
            if (wert !== undefined) setze(FILTER_ADRESSE[name], wert);
        }
        if (zustand.sort !== MEDIEN_START.sort) setze(ADRESSE.sort, zustand.sort);
        if (zustand.order !== undefined) setze(ADRESSE.order, zustand.order);
        if (zustand.ansicht !== MEDIEN_START.ansicht) setze(ADRESSE.ansicht, zustand.ansicht);
        if (zustand.bild !== MEDIEN_START.bild) setze(ADRESSE.bild, zustand.bild);
        // Die Unterteilung gehört zum Korb „PhotoBox-Uploads“: dort nur, wenn sie von der Vorgabe abweicht.
        if (istEinreichungsKorb(zustand.auswahl) && zustand.einreichung !== MEDIEN_START.einreichung) {
            setze(ADRESSE.einreichung, zustand.einreichung);
        }
    }
    const teile = [...fremde, ...eigene];
    return teile.length === 0 ? "" : `?${teile.join("&")}`;
}

/** Wie viele Filter der Leiste gesetzt sind („Weitere Filter (2)“); „verwendet von“ zählt mit, es ist ein Filter wie die anderen. */
export function filterAnzahl(zustand: Pick<MedienZustand, "filter" | "von">): number {
    return (
        MEDIEN_FILTER_NAMEN.filter((name) => zustand.filter[name] !== undefined).length +
        (zustand.von === undefined ? 0 : 1)
    );
}

/** Die Seitengröße der Liste: so viele Kacheln stehen nach einem Laden da, „Mehr laden“ holt die nächsten. */
export const MEDIEN_SEITE = 100;

/** EINE Abbildung des Zustands auf die Suche des Servers (`GET /api/editor/media`). */
export function suchanfrage(zustand: MedienZustand, offset = 0, limit = MEDIEN_SEITE): MamSearchQuery {
    const anfrage: MamSearchQuery = {
        sort: zustand.sort,
        limit: Math.min(limit, MAM_PAGE_LIMIT.max),
        offset,
    };
    if ("korb" in zustand.auswahl) anfrage.basket = zustand.auswahl.korb;
    else if (!("objekt" in zustand.auswahl) && zustand.auswahl.typ !== null) anfrage.type = zustand.auswahl.typ;
    if (istEinreichungsKorb(zustand.auswahl)) anfrage.einreichung = zustand.einreichung;
    const q = zustand.q.trim();
    if (q !== "") anfrage.q = q.slice(0, Q_MAX);
    if (zustand.von !== undefined) anfrage.subject = zustand.von;
    if (zustand.order !== undefined) anfrage.order = zustand.order;
    for (const name of MEDIEN_FILTER_NAMEN) {
        const wert = zustand.filter[name];
        if (wert !== undefined) (anfrage as Record<string, unknown>)[name] = wert;
    }
    return anfrage;
}

/** Die Adresse der Suche, mit festen Schlüsseln in fester Reihenfolge (eine Anfrage, ein Schlüssel). */
export function suchAdresse(anfrage: MamSearchQuery): string {
    const params = new URLSearchParams();
    for (const [name, wert] of Object.entries(anfrage).sort(([a], [b]) => a.localeCompare(b))) {
        if (wert !== undefined) params.set(name, String(wert));
    }
    return `${MEDIA_EDITOR_URL}?${params.toString()}`;
}

/** Was die Liste lädt, ohne Seite: Ändert sich das, beginnt sie von vorn. */
export function listenSchluessel(zustand: MedienZustand): string {
    return suchAdresse(suchanfrage(zustand, 0));
}

/**
 * Die Wahl in Spalte 1: Sie ersetzt die vorige Facette; Suche, Filter und „verwendet von“ bleiben (sie gelten in jeder Facette),
 * das gewählte Asset auch - der Inspector bleibt, bis jemand ein anderes wählt.
 */
export function waehle(zustand: MedienZustand, auswahl: MedienAuswahl): MedienZustand {
    // Kategorie und Galerie gehören zu ihrer Facette: eine andere hat sie nicht, sonst stünden sie veraltet in der Adresse.
    const bleibt = "objekt" in auswahl;
    return {
        ...zustand,
        auswahl,
        kategorie: bleibt ? zustand.kategorie : undefined,
        galerie: bleibt ? zustand.galerie : undefined,
        karte: bleibt ? zustand.karte : undefined,
        photoboxGalerie: bleibt ? zustand.photoboxGalerie : undefined,
        vorschlag: bleibt ? zustand.vorschlag : undefined,
    };
}

/** Zeigt die Trefferspalte ein Medienobjekt statt einer Assetliste? Dann fragt niemand die Assetsuche. */
export function istObjekt(auswahl: MedienAuswahl): auswahl is { objekt: MedienObjekt } {
    return "objekt" in auswahl;
}

export function gleicheAuswahl(a: MedienAuswahl, b: MedienAuswahl): boolean {
    if ("korb" in a) return "korb" in b && a.korb === b.korb;
    if ("objekt" in a) return "objekt" in b && a.objekt === b.objekt;
    return "typ" in b && a.typ === b.typ;
}

/** Die Kennung einer Wahl als Eintrag der Schiene „Medienarten“: `typ-alle`, `typ-coat`, `objekt-typbilder`, `korb-rights_open`. */
export function auswahlKennung(auswahl: MedienAuswahl): string {
    if ("korb" in auswahl) return `korb-${auswahl.korb}`;
    if ("objekt" in auswahl) return `objekt-${auswahl.objekt}`;
    return `typ-${auswahl.typ ?? "alle"}`;
}

/** Zurück aus der Kennung; `undefined` für alles, was keine wählbare Art und kein Korb ist. */
export function auswahlAusKennung(kennung: string): MedienAuswahl | undefined {
    if (kennung === "typ-alle") return { typ: null };
    const typ = MEDIA_ASSET_TYPES.find((type) => `typ-${type}` === kennung);
    if (typ !== undefined) return { typ };
    const objekt = MEDIEN_OBJEKTE.find((wert) => `objekt-${wert}` === kennung);
    if (objekt !== undefined) return { objekt };
    const korb = MAM_BASKETS.find((basket) => `korb-${basket}` === kennung);
    return korb === undefined ? undefined : { korb };
}

/** Ein Filter gesetzt oder (mit `undefined`) gelöst. */
export function mitFilter<K extends MedienFilterName>(
    zustand: MedienZustand,
    name: K,
    wert: MedienFilter[K] | undefined,
): MedienZustand {
    const filter = { ...zustand.filter };
    if (wert === undefined) delete filter[name];
    else filter[name] = wert;
    return { ...zustand, filter };
}

/** Alles, was die Liste einschränkt, gelöst: Facette, Sortierung, Ansicht und Auswahl bleiben. */
export function ohneFilter(zustand: MedienZustand): MedienZustand {
    return { ...zustand, q: "", filter: {}, von: undefined };
}

/**
 * Die Ebene am Telefon (WI-0068 §3.4: Typen → Treffer → Inspector, „keine gequetschten 80-px-Spalten“): Mit einem Asset beginnt
 * es im Inspector (der Kontext-Einstieg landet auf Ebene 3), mit einer Einschränkung in den Treffern, sonst bei den Arten.
 */
export type MedienEbene = 1 | 2 | 3;

export function startEbene(zustand: MedienZustand): MedienEbene {
    if (zustand.asset !== undefined) return 3;
    // Der tiefe Link auf einen Kartenvorschlag landet im Vorschlag, nicht in der Liste.
    if (
        "objekt" in zustand.auswahl &&
        zustand.auswahl.objekt === "kartenvorschlaege" &&
        zustand.vorschlag !== undefined
    ) {
        return 3;
    }
    if ("korb" in zustand.auswahl || "objekt" in zustand.auswahl) return 2;
    if (zustand.q.trim() !== "" || filterAnzahl(zustand) > 0) return 2;
    return 1;
}

/** Der nächste Eintrag einer Liste für die Pfeiltasten (an den Enden bleibt er stehen; ohne Auswahl der erste). */
export function naechsterEintrag(
    ids: readonly string[],
    aktuell: string | undefined,
    schritt: number,
): string | undefined {
    if (ids.length === 0) return undefined;
    const index = aktuell === undefined ? -1 : ids.indexOf(aktuell);
    if (index < 0) return ids[0];
    return ids[Math.max(0, Math.min(ids.length - 1, index + schritt))];
}
