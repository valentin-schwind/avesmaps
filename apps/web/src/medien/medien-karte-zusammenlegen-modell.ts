import { KARTE_VERSION_MAX, type MamKarteBild, type MamKarteDetail, type MamKarteZeile } from "@avesmaps3d/shared";
import { bildRolle } from "./medien-karten-modell";
import { versionenDerKarte } from "./medien-karte-neu-modell";

/**
 * Was „Bilder an anderen Eintrag geben“ (Dialog „Eintrag entfernen“) und „Weitere Version eines Eintrags“ (Annahme eines Kartenvorschlags) rechnen (WI-0287 Stufe 2, Entwurf
 * Fassung 5: `zielWahl`, `zeichneZielTreffer`, `vorschlagVersion`, `zeichneEntfernen`). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 */

/** So viele Einträge zeigt die Zielwahl höchstens. */
export const ZIEL_TREFFER = 6;

/**
 * Das erste Wort eines Titels, klein und ohne Satzzeichen am Ende: Daran erkennt die Zielwahl die Namensvettern („Re'Cha“ zu „Re'Cha Spielerversion“, „Gareth“ zu „Gareth,
 * Gesamtplan“).
 */
export const erstesWort = (titel: string): string =>
    (titel.trim().toLocaleLowerCase("de").split(/\s+/u)[0] ?? "").replace(/[,.;:!?]+$/u, "");

/**
 * Die Bezeichnung, mit der das Feld „Version“ vorbelegt ist: der Rest des Titels hinter dem Titel des Ziels („Re'Cha Spielerversion“ an „Re'Cha“ wird „Spielerversion“), sonst der
 * ganze Titel; nie länger, als eine Bezeichnung sein darf.
 */
export function vorschlagVersion(titel: string, zielTitel: string): string {
    const text = titel.trim();
    const ziel = zielTitel.trim();
    const rest =
        ziel !== "" && text.toLocaleLowerCase("de").startsWith(ziel.toLocaleLowerCase("de"))
            ? text.slice(ziel.length).trim()
            : "";
    return (rest === "" ? text : rest).slice(0, KARTE_VERSION_MAX);
}

/**
 * Die Treffer der Zielwahl aus der Antwort der Liste: nie der Eintrag selbst, nie ein stillgelegter; ohne Suchwort nur die Namensvettern (gleiches erstes Wort wie `wort`), mit
 * Suchwort alles, was der Server fand (er sucht auch über Zeichner, Verlag und Orte). Höchstens `ZIEL_TREFFER`.
 */
export function zielTreffer(
    zeilen: readonly MamKarteZeile[],
    ausser: string | undefined,
    suchwort: string,
    wort: string,
): MamKarteZeile[] {
    const gesucht = suchwort.trim() !== "";
    return zeilen
        .filter(
            (zeile) =>
                zeile.id !== ausser && zeile.active && (gesucht || (wort !== "" && erstesWort(zeile.title) === wort)),
        )
        .slice(0, ZIEL_TREFFER);
}

/** Was das Zusammenlegen am Ziel tut, vorher gesagt (Entwurf `zeichneEntfernen`, Zweig „uebernehmen“). */
export interface ZusammenlegenFolgen {
    /** Die Karten, die weitere Versionen des Ziels werden (ihr Titel), in ihrer Folge. */
    neu: string[];
    /** Die Karten, die dort schon hängen und nicht doppelt geführt werden. */
    doppelt: string[];
    /** Die Vorschau: Sie zieht mit, sie bleibt nur in der Liste (das Ziel hat eine), oder es gibt keine. */
    vorschau: "zieht" | "bleibt" | undefined;
}

const titelVon = (bild: MamKarteBild): string => bild.title ?? bildRolle(bild);

export function zusammenlegenFolgen(
    quelle: Pick<MamKarteDetail, "images">,
    ziel: Pick<MamKarteDetail, "images">,
): ZusammenlegenFolgen {
    const dort = new Set(versionenDerKarte(ziel).map((bild) => bild.assetId));
    const versionen = versionenDerKarte(quelle);
    const hatVorschau = (karte: Pick<MamKarteDetail, "images">): boolean =>
        karte.images.some((bild) => bild.role === "map_preview");
    return {
        neu: versionen.filter((bild) => !dort.has(bild.assetId)).map(titelVon),
        doppelt: versionen.filter((bild) => dort.has(bild.assetId)).map(titelVon),
        vorschau: !hatVorschau(quelle) ? undefined : hatVorschau(ziel) ? "bleibt" : "zieht",
    };
}
