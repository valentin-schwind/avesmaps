import { ref, shallowRef, watch, type WatchStopHandle } from "vue";
import {
    assetTypeForRole,
    type HeaderGraphic,
    type MediaTypeImageVariant,
    type MamBasket,
    type MamEinreichung,
    type MediaRole,
    type MediaUsageSubjectKind,
} from "@avesmaps3d/shared";
import { adresseMitZustand, MEDIEN_START, vonSchreiben, zustandAusAdresse, type MedienZustand } from "./medien-zustand";

/**
 * Ob die Medienverwaltung offen ist und was sie zeigt (WI-0068 P3): EINE Stelle, wie `auth-windows.ts` für die Fenster der
 * Anmeldung. Das Hauptmenü („Medien …“), der Knopf am Wappen und am Kopfbild im Infopanel und ein tiefer Link öffnen über
 * `oeffneMedien`; `app.vue` hängt das eine Fenster ein und hält die Adresse nach (`installiereMedienAdresse`).
 */
export const medienOffen = ref(false);
export const medienZustand = shallowRef<MedienZustand>({ ...MEDIEN_START });
/**
 * Die Namen der Fachobjekte, die ein Einstieg schon kennt (`place:<uuid>` → „Gareth“): Die Adresse trägt nur Kennungen, das
 * Infopanel weiß, wie der Ort heißt. Ohne Eintrag nennt die Oberfläche die Art („ein Ort“) bis eine Antwort den Namen bringt.
 */
export const medienNamen = shallowRef<Readonly<Record<string, string>>>({});

export interface MedienZiel {
    /** Genau dieses Asset (`public_id`) im Inspector. */
    asset?: string;
    /** „Verwendet von“: das Fachobjekt, aus dem der Einstieg kam. */
    von?: { kind: MediaUsageSubjectKind; id: string; name?: string };
    /**
     * Nur der Typ dieser Rolle (Wappen, Bild): der Einstieg aus dem Ortseditor (WI-0128 E6, „Medienverwaltung › Wappen“). Seit dem
     * Asset-Typ (Betreiber 2026-10-10) wählt er die Facette des Typs in Spalte 1 (`MamSearchQuery.type`), keine neue Route.
     */
    rolle?: MediaRole;
    /** Ein Prüfkorb statt der Facette des Typs (Glocke und Stapel der Reisebilder, WI-0272 S3: `photobox_uploads`); gewinnt gegen `rolle`. */
    korb?: MamBasket;
    /** Der Teil des Korbs „PhotoBox-Uploads“; ohne Angabe die Vorgabe (Offen). */
    einreichung?: MamEinreichung;
    /**
     * Das Medienobjekt „Typbilder“ an dieser Kategorie (das ⚙ am Typbild im Kopf des Infopanels, WI-0272 S5): Die Liste steht an der Kategorie, das ★-Asset der Kategorie wird das gewählte Asset, sobald die
     * Liste da ist (`sternAsset`, `medien-fenster.vue`); eine Kategorie ohne ★ zeigt den Kasten „noch kein Typbild“. Gewinnt gegen `asset`, `korb` und `rolle`; ein „verwendet von“ gibt es dort nicht.
     */
    typbild?: HeaderGraphic;
    /** Die Variante der Typbildkategorie (WI-0281): das ⚙ im Modus „Ohne KI“ öffnet die Ohne-KI-Variante; ohne Angabe die KI-Variante. */
    typbildVariante?: MediaTypeImageVariant;
    /** Der Eintrag der Kartensammlung (`citymap.public_id`), aus dem Reiter „Karten“ eines Eigenschaftseditors. Gewinnt gegen alles außer `typbild`. */
    karte?: string;
    /** Dazu die Suche der Liste (der Titel der Karte): Die Liste zeigt 100 von über 500 Karten, die gewählte stünde sonst oft nicht darin. */
    kartenSuche?: string;
}

/**
 * Öffnet die Medienverwaltung. Ohne Ziel (Hauptmenü) mit dem Stand, den sie zuletzt hatte; mit Ziel (Kontext-Einstieg, WI-0068 §13)
 * genau dort: das Asset im Inspector, die Treffer auf das Fachobjekt beschränkt, sonst die Vorgabe.
 */
export function oeffneMedien(ziel?: MedienZiel): void {
    if (ziel?.typbild !== undefined) {
        medienZustand.value = {
            ...MEDIEN_START,
            auswahl: { objekt: "typbilder" },
            kategorie: ziel.typbild,
            variante: ziel.typbildVariante ?? MEDIEN_START.variante,
        };
    } else if (ziel?.karte !== undefined) {
        medienZustand.value = {
            ...MEDIEN_START,
            auswahl: { objekt: "kartensammlung" },
            karte: ziel.karte,
            q: ziel.kartenSuche?.slice(0, 200) ?? MEDIEN_START.q,
        };
    } else if (ziel !== undefined) {
        const von = ziel.von === undefined ? undefined : vonSchreiben(ziel.von.kind, ziel.von.id);
        if (von !== undefined && ziel.von?.name !== undefined && ziel.von.name !== "") {
            medienNamen.value = { ...medienNamen.value, [von]: ziel.von.name };
        }
        medienZustand.value = {
            ...MEDIEN_START,
            von,
            asset: ziel.asset,
            auswahl:
                ziel.korb !== undefined
                    ? { korb: ziel.korb }
                    : { typ: ziel.rolle === undefined ? null : assetTypeForRole(ziel.rolle) },
            einreichung: ziel.einreichung ?? MEDIEN_START.einreichung,
        };
    }
    medienOffen.value = true;
}

/**
 * Der Verweis aus der Glocke und aus dem Stapel in Community › Meldungen (WI-0272 S3, Aufgabe 19): die Medienverwaltung im Korb „PhotoBox-Uploads“, Unterteilung „offen“. Der Stand von vorhin
 * (Suche, Filter, Auswahl) gilt nicht: Wer neue Reisebilder sehen will, soll sie auch sehen. Mit `asset` steht genau dieses Bild im Inspector (die Vorschau in der Glocke); ein gemeldetes Bild ist schon freigegeben und liegt unter „erledigt“.
 */
export function oeffneReisebilder(asset?: string, einreichung: MamEinreichung = "offen"): void {
    oeffneMedien({ korb: "photobox_uploads", einreichung, ...(asset === undefined ? {} : { asset }) });
}

/**
 * Zählt jede Operation der Redaktion an einer Reisebild-Einreichung (Freigeben, Rückfrage, Ablehnen, Korrigieren, Offline nehmen; WI-0272 S3, Review I3). Ein schmales Signal: Der Stapel in
 * Community › Meldungen (`photobox-stapel.vue`) lädt daraufhin neu und zeigt nicht länger Bilder, die schon erledigt sind. Das Schließen der Medienverwaltung löst dasselbe aus (`medienOffen`).
 */
export const reisebilderStand = ref(0);

export function meldeReisebilderGeaendert(): void {
    reisebilderStand.value += 1;
}

export function schliesseMedien(): void {
    medienOffen.value = false;
}

/** Ein neuer Stand der Spalten (Wahl, Filter, Asset). */
export function setzeMedien(zustand: MedienZustand): void {
    medienZustand.value = zustand;
}

/** Merkt sich den Namen eines Fachobjekts, sobald eine Antwort ihn nennt. */
export function merkeNamen(von: string, name: string): void {
    if (name !== "" && medienNamen.value[von] !== name) medienNamen.value = { ...medienNamen.value, [von]: name };
}

/**
 * Hält die Adresse nach (WI-0068 P3, „direkter Einstieg reproduzierbar“): Beim Laden öffnet `?medien…` das Fenster - nur mit dem
 * Recht, sonst bleibt die Adresse, wie sie ist, und nichts geht auf. Danach steht der Stand des offenen Fensters in der Query
 * (`history.replaceState`, kein neuer Eintrag im Verlauf); beim Schließen verschwindet er. Andere Parameter bleiben.
 */
export function installiereMedienAdresse(
    erlaubt: boolean,
    ort: Pick<Location, "search" | "pathname" | "hash"> = globalThis.location,
    verlauf: Pick<History, "replaceState"> = globalThis.history,
): WatchStopHandle {
    if (erlaubt) {
        const aus = zustandAusAdresse(ort.search);
        if (aus !== undefined) {
            medienZustand.value = aus;
            medienOffen.value = true;
        }
    }
    return watch([medienOffen, medienZustand], ([offen, zustand]) => {
        const search = adresseMitZustand(ort.search, offen ? zustand : undefined);
        if (search !== ort.search) verlauf.replaceState(null, "", `${ort.pathname}${search}${ort.hash}`);
    });
}
