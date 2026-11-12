import { leereVorkommenSpeicher as leereTreffer } from "./karte.ts";
import { leereLeuchtenSpeicher } from "./leuchten.ts";
import { leereVorkommenKatalog } from "./punkte.ts";

/**
 * Die Auswertung der Vorkommensregeln (WI-0257, S1): ein reiner Serverbaustein, keine Route, keine Oberfläche, keine Migration, kein Schreiben in die Datenbank.
 *
 *     trefferDesEintrags(db, eintragId, { rahmen?, nachkommastellen? })   Richtung A: Eintrag → Landschaften und Siedlungen (Suche, Leuchten)
 *     eintraegeAmPunkt(db, punkt)                                         Richtung B: Kartenpunkt → Einträge
 *     eintraegeAnPunkten(db, punkte)                                      dasselbe als Bündel (Etappen)
 *     eintraegeAnPunktgruppen(db, gruppen)                                dasselbe für viele Punktgruppen (die Etappen einer Route), je Eintrag die Landschaften seines ersten Treffers
 *     eintraegeAnFlaechen(db, regionIds)                                  eine Fläche als Gegenstand, über ihren Punkt
 *     eintraegeAmFlaechenpunkt(db, punkt, eigene)                         dasselbe, wo der Aufrufer den Punkt der Fläche schon hat (Infopanel)
 *     ortszeilenErsatz(db)                                                die Rahmen, hinter denen eine Ortszeile zurücktritt (F2)
 *     leuchte(db, anfrage, { ausgeblendet? })                             was für einen Suchtreffer auf der Karte leuchtet: Regeln UND Ortszeilen, auf einen Rahmen zugeschnitten (S3a)
 *     zaehle(db, eintragIds, { ausgeblendet? })                           die Zahl der leuchtenden Gegenden für bis zu acht Einträge
 *
 * Eine Funktion, zwei Richtungen: Ein Punkt liegt in der leuchtenden Geometrie aus A genau dann, wenn B an diesem Punkt die Regel nennt. Das Modell steht im Kopf von `regel-sql.ts`.
 */
export { leereVorkommenSpeicher as leereTrefferSpeicher, rechneRegel, trefferDesEintrags } from "./karte.ts";
export {
    eintraegeAmFlaechenpunkt,
    eintraegeAmPunkt,
    eintraegeAnFlaechen,
    eintraegeAnPunkten,
    eintraegeAnPunktgruppen,
    KEIN_ERSATZ,
    ortszeileErsetzt,
    ortszeilenErsatz,
    vereinigeEintraege,
    type GruppenTreffer,
    type OrtszeilenErsatz,
} from "./punkte.ts";
export { ermittleKartenstand, ladeRegeln, type Glied, type Regel } from "./regeln.ts";
export { halbebeneVon, liegtInHalbebene, type Halbebene } from "./halbebene.ts";
export {
    anfrageGueltig,
    anfrageHash,
    genannteZiele,
    LANDSCHAFTSARTEN,
    landschaftsartVon,
    leereLeuchtenSpeicher,
    leuchte,
    SCHALTER_ARTEN,
    zaehle,
    type Landschaftsart,
    type LeuchtOptionen,
} from "./leuchten.ts";

/** Leert die Zwischenspeicher: die Treffer je Eintrag (Richtung A), das Leuchten der Suchtreffer und die Regeln im Prozess (Richtung B). */
export function leereVorkommenSpeicher(): void {
    leereTreffer();
    leereLeuchtenSpeicher();
    leereVorkommenKatalog();
}
