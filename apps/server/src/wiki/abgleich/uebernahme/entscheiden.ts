import type { WikisyncBereich } from "@avesmaps3d/shared";
import { VORSCHAU_TEXT_MAX } from "../ablage.ts";
import { entscheideFeldJetzt, fuehrtFeldSelbst, gleich, hatWikiStand, type PlanObjekt } from "../plan.ts";
import { titelAusWikiAdresse } from "../../vorschau/adresse.ts";
import type { VorschauZeile } from "./protokoll.ts";
import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Was die Übernahme mit einer Zeile der Vorschau tut (WI-0253 D-1, Work Item §3 Punkt 3 und 4): REIN, ohne Datenbank. Aus der Zeile (Feld, Istwert `alt`, Wiki-Wert `neu`,
 * Eigentümer) und dem Stand der Objekte von JETZT folgt je Objekt entweder eine Änderung oder ein Befund oder nichts, weil der Wert schon stimmt.
 *
 * - **Die wirksame Spalte** schreibt die Übernahme nur bei Herkunft wiki: Die Zeile trug den Eigentümer `wiki`, er ist es jetzt noch, das Objekt führt einen EIGENEN Wert mit dem
 *   Vermerk „wiki“ (er folgt dem Wiki), und der Istwert ist noch `alt`. Hat sich der Wert seit der Vorschau bewegt (ein Editor, ein Zug), schreibt sie ihn NICHT und sagt
 *   `seit_vorschau_geaendert`: Sie überschreibt keinen Wert, den sie nicht gesehen hat. Ein leeres Feld hat nichts zu pflegen: Der Leser zeigt dann den Wiki-Wert, es genügt der
 *   Schnappschuss. Den Vermerk liest die Übernahme nur. Ausnahme: Ein Bereich ohne Wiki-Stand (`fuelltLeereFelder`, die Literatur) füllt ein leeres Feld des Wikis in der
 *   Spalte selbst; den Vermerk setzt dann der Schreiber.
 * - **Der Schnappschuss** (Wiki-Wert hinter ↺) wird IMMER geschrieben, auch wo der eigene Wert bleibt (`manual`) oder unbekannt ist: Er ist der Stand des Wikis, keine
 *   Entscheidung über das Objekt. Danach zeigt ↺ den Wert von heute, und die nächste Vorschau meldet das Feld nicht mehr.
 * - **Keine Zuordnung wird geändert:** Ein Objekt ohne Schnappschuss (nur eine Adresse, `hatWikiStand` in `plan.ts`) bekommt keinen. Dieselbe Regel steht schon in der Vorschau: Eine Zeile an einem
 *   solchen Objekt ist dort ein Befund und nie eine Übernahme, die Übernahme überspringt sie still. `kein_schnappschuss` sagt sie nur, wo die Zeile eine Übernahme war und das Objekt seitdem
 *   keinen Stand mehr hat. Ein Abschnitt, der den Stand seiner Linie erbt (`schnappschussGeerbt`), vergleicht und folgt dem Wiki wie die anderen, schreibt den Stand aber nie selbst.
 * - **Idempotent:** Stimmt Istwert und Schnappschuss schon mit dem Wiki-Wert überein, ist das kein Schritt und kein Befund.
 * - **Der Artikel der Zeile muss der des Objekts sein** (D-2): Hängt das Objekt inzwischen an einem anderen Artikel (die Zuordnung wechselte seit der Vorschau), oder ist
 *   die Zeile die eines Artikels, den ein Weg nur als weitere Zuweisung trägt, schreibt die Übernahme nichts: Sie würde den Wiki-Stand des falschen Artikels überschreiben.
 * - **Marke „Wiki-Wert unbekannt“:** Ein Wiki-Wert, den der Schnappschuss als unbekannt führte, ist nach dem Schreiben bekannt (`schnappschuss.unbekannt`).
 */

export interface Entscheidung {
    schritte: FeldSchritt[];
    befunde: BefundSchritt[];
    /** In wie vielen (Objekt, Feld) stimmte schon alles. */
    schonGleich: number;
}

type SchreiberStellen = Pick<
    Schreiber,
    "wirksameSpalten" | "schnappschussSpalten" | "objektArt" | "unbekanntFelder" | "fuelltLeereFelder"
>;

/** Ein Titel zum Vergleichen: Unterstriche wie Leerzeichen, Anfangsbuchstabe frei (MediaWiki stellt ihn frei). */
const titelSchluessel = (titel: string): string => titel.replaceAll("_", " ").trim().toLowerCase();

/**
 * Gehört die Zeile (ihr Artikel) zu dem Artikel, an dem das Objekt heute hängt? Eine Zeile ohne Artikel gilt für jedes Objekt. Eine Katalogquelle (Bereich `quelle`) hat keinen Artikel:
 * Der Artikel ihrer Zeile ist der Träger der Verwendung oder die Produktseite; ob der Träger noch an ihm hängt, prüft der Listen-Schreiber der Verwendungen.
 */
export function artikelPasst(zeile: Pick<VorschauZeile, "artikel">, objekt: PlanObjekt): boolean {
    if (zeile.artikel === null || objekt.bereich === "quelle") return true;
    return adresseTrifftArtikel(objekt.adresse, zeile.artikel);
}

/** Zeigt die gespeicherte Wiki-Adresse auf diesen Artikel (Unterstriche wie Leerzeichen, Anfangsbuchstabe frei)? */
export function adresseTrifftArtikel(adresse: string | null, artikel: string): boolean {
    const titel = titelAusWikiAdresse(adresse);
    return titel !== null && titelSchluessel(titel) === titelSchluessel(artikel);
}

const leerZuNull = (wert: string | null | undefined): string | null =>
    wert === null || wert === undefined || wert.trim() === "" ? null : wert;

/** Ist der Wert in der Länge, die die Vorschau abschneidet (also vielleicht gekürzt)? */
const gekuerzt = (wert: string | null): boolean => wert !== null && Array.from(wert).length >= VORSCHAU_TEXT_MAX;

export function entscheideZeile(
    bereich: WikisyncBereich,
    zeile: VorschauZeile,
    objekte: ReadonlyMap<string, PlanObjekt>,
    schreiber: SchreiberStellen,
): Entscheidung {
    const ergebnis: Entscheidung = { schritte: [], befunde: [], schonGleich: 0 };
    const feld = zeile.feld;
    const befund = (objektId: string, name: string | null, art: BefundSchritt["befund"], grund: string): void => {
        ergebnis.befunde.push({ objektId, objektArt: schreiber.objektArt, objektName: name, feld, befund: art, grund });
    };
    const kennungen = zeile.objektIds;

    // Ein Wert in der Länge des Schnitts ist vielleicht gekürzt: Er wird nie geschrieben und nie verglichen.
    if (gekuerzt(zeile.alt) || gekuerzt(zeile.neu)) {
        for (const id of kennungen) {
            befund(id, objekte.get(id)?.name ?? zeile.objektName, "wert_gekuerzt", "Die Vorschau hat den Wert gekürzt");
        }
        return ergebnis;
    }

    const nachher = zeile.neuZustand === "kein" ? null : leerZuNull(zeile.neu);
    const wikiWert = nachher === null ? undefined : nachher;
    const folgtDemWiki = zeile.eigentuemer === "wiki" && zeile.wirkung === "uebernommen";
    const wirksameSpalte = schreiber.wirksameSpalten[feld];
    const schnappschussSpalte = schreiber.schnappschussSpalten[feld];

    for (const id of kennungen) {
        const objekt = objekte.get(id);
        if (objekt === undefined) {
            befund(id, zeile.objektName, "seit_vorschau_geaendert", "Das Objekt ist nicht mehr auf der Karte");
            continue;
        }
        if (!artikelPasst(zeile, objekt)) {
            if (objekt.bereich === "weg") {
                befund(id, objekt.name, "weitere_zuweisung", "Der Artikel hängt hier nur als weitere Zuweisung");
            } else {
                befund(
                    id,
                    objekt.name,
                    "seit_vorschau_geaendert",
                    "Das Objekt hängt inzwischen an einem anderen Artikel",
                );
            }
            continue;
        }
        if (!hatWikiStand(objekt)) {
            // Nur wo die Zeile etwas übernehmen wollte, ist das ein Befund; einen eigenen Wert hätte sie ohnehin stehen lassen.
            if (folgtDemWiki)
                befund(id, objekt.name, "kein_schnappschuss", "Das Objekt hat nur eine Adresse und keinen Wiki-Stand");
            continue;
        }
        const schritt: FeldSchritt = { objekt, feld };
        const istSchnappschuss = leerZuNull(objekt.schnappschuss.get(feld));

        if (folgtDemWiki) {
            const heute = entscheideFeldJetzt(bereich, objekt, feld, wikiWert, false);
            if (heute !== null) {
                if (!gleich(heute.alt, zeile.alt)) {
                    befund(id, objekt.name, "seit_vorschau_geaendert", "Der Wert hat sich seit der Vorschau geändert");
                    continue;
                }
                if (heute.eigentuemer !== "wiki") {
                    befund(id, objekt.name, "seit_vorschau_geaendert", "Der Wert gehört nicht mehr dem Wiki");
                    continue;
                }
                const lokal = objekt.lokal.get(feld);
                // Ein Feld, das das Objekt nicht führt (die Höhe einer Landmarke ohne Gelände, WI-0271 L3), geht nur in den Wiki-Stand.
                const wirksam = wirksameSpalte !== undefined && fuehrtFeldSelbst(bereich, objekt, feld);
                if (wirksam && lokal?.zustand === "text" && lokal.vermerk === "wiki") {
                    schritt.wirksam = { vorher: lokal.wert, nachher };
                } else if (
                    wirksam &&
                    schreiber.fuelltLeereFelder === true &&
                    (lokal === undefined || lokal.zustand === "kein")
                ) {
                    // Ohne Wiki-Stand gibt es keinen Rückfall auf den Wiki-Wert: Das leere Feld wird in der Spalte gefüllt (der Schreiber setzt den Vermerk).
                    schritt.wirksam = { vorher: null, nachher };
                }
            }
        }
        // Ein unbekannter Wiki-Wert wird mit dem Schreiben bekannt – auch wo das Wiki nichts kennt (dann ist er bekannt leer).
        const warUnbekannt = schreiber.unbekanntFelder?.has(feld) === true && objekt.schnappschussUnbekannt.has(feld);
        // Einen geerbten Stand schreibt der Abschnitt, dem er gehört (Fall der Kraftlinie): dieses Objekt hat keine eigene Zeile dafür.
        if (
            schnappschussSpalte !== undefined &&
            objekt.schnappschussGeerbt !== true &&
            (warUnbekannt || !gleich(istSchnappschuss, nachher))
        ) {
            schritt.schnappschuss = {
                vorher: istSchnappschuss,
                nachher,
                ...(warUnbekannt ? { unbekannt: true } : {}),
            };
        }
        if (schritt.wirksam !== undefined || schritt.schnappschuss !== undefined) {
            ergebnis.schritte.push(schritt);
        } else {
            ergebnis.schonGleich += 1;
        }
    }
    return ergebnis;
}

/** Die Entscheidungen aller Zeilen eines Bereichs, zusammengefasst. */
export function entscheideZeilen(
    bereich: WikisyncBereich,
    zeilen: readonly VorschauZeile[],
    objekte: ReadonlyMap<string, PlanObjekt>,
    schreiber: SchreiberStellen,
): Entscheidung & { beruehrt: string[] } {
    const gesamt: Entscheidung = { schritte: [], befunde: [], schonGleich: 0 };
    const beruehrt = new Set<string>();
    for (const zeile of zeilen) {
        const einzeln = entscheideZeile(bereich, zeile, objekte, schreiber);
        gesamt.schritte.push(...einzeln.schritte);
        gesamt.befunde.push(...einzeln.befunde);
        gesamt.schonGleich += einzeln.schonGleich;
        // Hat die Zeile an irgendeinem Objekt etwas zu schreiben, berühren wir ALLE Objekte, die sie zusammenfasst: Ein offener Entwurf an der Linie
        // soll 409 bekommen, auch wo ihr Abschnitt selbst keine Spalte ändert.
        if (einzeln.schritte.length > 0) for (const id of zeile.objektIds) if (objekte.has(id)) beruehrt.add(id);
    }
    return { ...gesamt, beruehrt: [...beruehrt].sort() };
}
