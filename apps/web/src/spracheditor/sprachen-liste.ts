import type {
    SpracheEditorArtikelZeile,
    SpracheEditorListe,
    SpracheEditorSpracheZeile,
    SpracheEditorZahlen,
    SpracheEditorZustand,
} from "@avesmaps3d/shared";
import type { Zaehlung } from "../editor-panel/karteninhalte-kacheln";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import { ORTE_LEGENDE } from "../editor-liste/orte-liste";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";

/**
 * Die Sprachen als Liste (WI-0261 S5d2; Bauvorlage `fenster-sprachen.js` `zeilen`, `kreis`, `unterzeile`, `sortierungen`; Muster
 * `kraftlinieneditor/kraftlinien-liste.ts`): Der Adapter macht aus den Zeilen des Lesepfads (`GET /api/editor/sprachen`, S5d1) die Zeilen des
 * gemeinsamen Bauteils `editor-liste.vue`.
 *
 * - 🔴 **Die vier Zustände** wie in allen Editor-Listen (WI-0187, EDIT-0003 T26 (5)): ● platziert und dem Wiki zugewiesen · ◐ nur im Wiki,
 *   nicht platziert · ◑ platziert, ohne Wiki-Artikel · ○ nicht platziert, ohne Wiki-Artikel. Den Zustand rechnet der Server (`zustand`);
 *   hier wird er nur zum Kreis. Die Legende ist dieselbe wie unter der Ortsliste (`ORTE_LEGENDE`, `editorListe.kreis.*`).
 * - **Freie Wiki-Artikel** (O1: „nur im Wiki, nicht platziert“) stehen in derselben Liste, unter einem eigenen Schlüssel (`artikel:<id>`), damit
 *   ein Klick sie von einer Sprache unterscheidet.
 * - **Facetten:** der Zustand (die vier Kreise) und der Stand (aktiv, stillgelegt); stillgelegte Sprachen stehen nur unter „Stillgelegt“ und
 *   zählen in keiner Legende (wie Gelöschtes, EDIT-0003 T54).
 * - **Unterzeile** knapp (Betreiber 2026-10-16: „solche zahlen sind nur informativ“): der Wiki-Stand wie in der Vorlage („✓ Wiki: Garethi“,
 *   „✓ Wiki: 3 Artikel“, „⚠ kein Wiki-Artikel“) und die Zahl der Teilflächen. Davor der Farbpunkt der Sprache.
 */

export const ARTIKEL_PRAEFIX = "artikel:";
export const artikelSchluessel = (id: string): string => `${ARTIKEL_PRAEFIX}${id}`;
/** Die Kennung des Wiki-Artikels hinter einem Listenschlüssel; `undefined`: Der Schlüssel ist eine Sprache. */
export const artikelVon = (key: string | undefined): string | undefined =>
    key?.startsWith(ARTIKEL_PRAEFIX) === true ? key.slice(ARTIKEL_PRAEFIX.length) : undefined;

/** Der Kreis eines Zustands (dieselbe Zuordnung wie `kreisVon` der Orte: links Wiki, rechts Karte). */
export const KREIS_VON_ZUSTAND: Readonly<Record<SpracheEditorZustand, Kreis>> = {
    platziert_wiki: "voll",
    nur_wiki: "halb",
    platziert_ohne_wiki: "halb-rechts",
    leer: "leer",
};

const KREIS_RANG: Readonly<Record<Kreis, number>> = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 };

/** Die Wörter der Legende, dieselben wie unter jeder Editor-Liste mit vier Zuständen. */
export const SPRACHEN_LEGENDE = ORTE_LEGENDE;

export const SPRACHEN_SORTIERUNGEN = ["name", "flaeche", "kreis"] as const;

export const SPRACHEN_OPTIONEN: ListenOptionen = {
    form: "flach",
    facetten: ["zustand", "stand"],
    // Stillgelegtes steht nur unter „Stillgelegt“, wie Gelöschtes in den übrigen Listen (EDIT-0003 T54).
    vorbelegt: new Map([["stand", new Set<string>(["aktiv"])]]),
    sortierungen: { name: nachName, flaeche: nachRang("flaeche"), kreis: nachRang("kreis") },
};

export const sortierungsName = (wert: string): string =>
    wert === "flaeche"
        ? t("spracheditor.sortierung.flaeche")
        : wert === "kreis"
          ? t("editorListe.sortierung.kreis")
          : t("editorListe.sortierung.name");

/** Der Name einer Facette für den Trichter: wie jede Facette des Registers (`nav.editorpanel.facette.*`). */
export function facettenName(id: string): string {
    const key = `nav.editorpanel.facette.${id}`;
    return isMessageKey(key) ? t(key) : id;
}

const ZUSTAND_NAMEN: Readonly<Record<SpracheEditorZustand, MessageKey>> = {
    platziert_wiki: "editorListe.kreis.voll",
    nur_wiki: "editorListe.kreis.halb",
    platziert_ohne_wiki: "editorListe.kreis.halbRechts",
    leer: "editorListe.kreis.leer",
};

/** Der Name eines Facettenwerts: die Zustände mit den Wörtern der Legende, der Stand mit seinen. */
export function wertName(facette: string, wert: string): string {
    if (facette === "zustand" && wert in ZUSTAND_NAMEN) return t(ZUSTAND_NAMEN[wert as SpracheEditorZustand]);
    if (facette === "stand")
        return wert === "stillgelegt" ? t("spracheditor.stand.stillgelegt") : t("spracheditor.stand.aktiv");
    return wert;
}

/** „✓ Wiki: Garethi“, „✓ Wiki: 3 Artikel“ oder „⚠ kein Wiki-Artikel“ (Vorlage `wikiStand`). */
export function wikiStand(zeile: Pick<SpracheEditorSpracheZeile, "wikiArtikel" | "ersterArtikel">): string {
    if (zeile.wikiArtikel === 0) return t("spracheditor.unter.ohneWiki");
    if (zeile.wikiArtikel === 1 && zeile.ersterArtikel !== null)
        return t("spracheditor.unter.wiki", { titel: zeile.ersterArtikel });
    return t("spracheditor.unter.wikiMehr", { n: formatNumber(zeile.wikiArtikel, 0) });
}

function spracheZeile(zeile: SpracheEditorSpracheZeile): ListenZeile {
    const teile = tPlural("spracheditor.unter.teilflaechen", zeile.teilflaechen, {
        n: formatNumber(zeile.teilflaechen, 0),
    });
    const unter: NonNullable<ListenZeile["unter"]> = !zeile.aktiv
        ? { text: t("spracheditor.stand.stillgelegt"), ton: "warnung" }
        : { text: `${wikiStand(zeile)} · ${teile}`, ton: zeile.wikiArtikel > 0 ? "gut" : "warnung" };
    const kreis = KREIS_VON_ZUSTAND[zeile.zustand];
    return {
        key: zeile.id,
        name: zeile.name,
        kreis,
        farbe: zeile.farbe,
        facetten: { zustand: zeile.zustand, stand: zeile.aktiv ? "aktiv" : "stillgelegt" },
        unter,
        rang: { flaeche: -zeile.flaeche, kreis: KREIS_RANG[kreis] },
        ...(zeile.aktiv ? {} : { zaehltNicht: true as const }),
    };
}

function artikelZeile(zeile: SpracheEditorArtikelZeile): ListenZeile {
    const unter = zeile.sprachfamilie ?? zeile.kurzbeschreibung;
    return {
        key: artikelSchluessel(zeile.id),
        name: zeile.titel,
        kreis: "halb",
        facetten: { zustand: "nur_wiki", stand: "aktiv" },
        rechts: t("spracheditor.liste.artikel"),
        unter: { text: unter ?? t("editorListe.kreis.halb"), ton: "leise" },
        rang: { flaeche: 0, kreis: KREIS_RANG.halb },
    };
}

/** Die Zeilen der Liste: Sprachen und freie Artikel in einer, wie der Server sie schickt (Legende, dann Titel). */
export function zeilenVon(liste: SpracheEditorListe | undefined): ListenZeile[] {
    return (liste?.zeilen ?? []).map((zeile) => (zeile.art === "sprache" ? spracheZeile(zeile) : artikelZeile(zeile)));
}

/** Die Zählung der Kachel „Sprachen“ im Editorpanel aus den Zahlen des Servers (aktive Sprachen und freie Artikel, je Zustand). */
export function zaehlungAusSprachen(zahlen: SpracheEditorZahlen): Zaehlung {
    const kreise = {
        voll: zahlen.platziertWiki,
        halb: zahlen.nurWiki,
        "halb-rechts": zahlen.platziertOhneWiki,
        leer: zahlen.leer,
    };
    return { gesamt: kreise.voll + kreise.halb + kreise["halb-rechts"] + kreise.leer, kreise };
}
