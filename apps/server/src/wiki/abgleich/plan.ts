import {
    WIKISYNC_BEREICHE,
    wikiNamespaceZeile,
    type InhalteTraegerArt,
    type WikiNamespaceTafel,
    type WikisyncBefund,
    type WikisyncBereich,
    type WikisyncBereichZahlen,
    type WikisyncEigentuemer,
    type WikisyncStatus,
    type WikisyncWertZustand,
    type WikisyncWirkung,
} from "@avesmaps3d/shared";
import type { GelesenerDumpArtikel, SeitenErgebnis } from "../dump/seiten-sammler.ts";
import { BEREICH_FELDER, leseSeitenFelder } from "../infobox/lesen.ts";
import { lesePublikationen } from "../infobox/publikationen.ts";
import { analysiere, type Infoboxseite } from "../infobox/seite.ts";
import { LEER_FOLGE, phpTrim } from "../infobox/text.ts";
import { istAventurisch, sprachSchluessel } from "../infobox/sprache.ts";
import { landmarkenArtDerSeite, landmarkeSchluessel, leseLandmarke } from "../infobox/landmarke.ts";
import { gehoertZurFlaechenliste } from "../infobox/region-artikel.ts";
import { VORKOMMEN_EIGENE_FELDER, type VorkommenBeziehung, type VorkommenOrt } from "../infobox/vorkommen.ts";
import { titelAusWikiAdresse, titelKandidaten } from "../vorschau/adresse.ts";
import { LISTE_FELD, gesuchteListen, listeDes } from "./vorkommen-liste.ts";
import {
    ARTIKEL_FELD,
    GRUND_KEINE_INFOBOX,
    GRUND_NEU,
    GRUND_NICHT_AVENTURISCH,
    GRUND_NICHT_IM_DUMP,
    GRUND_WIEDER,
    SPRACHE_ARTIKEL_ART,
    SPRACHEN_PLANFELDER,
    grundWeiterleitung,
    neuerArtikelId,
} from "./sprachen.ts";
import {
    GRUND_LANDMARKE_AUF_DER_KARTE,
    GRUND_LANDMARKE_KEINE,
    GRUND_LANDMARKE_NEU,
    GRUND_LANDMARKE_NICHT_IM_DUMP,
    GRUND_LANDMARKE_WIEDER,
    LANDMARKE_ARTIKEL_ART,
    LANDMARKEN_PLANFELDER,
    neueLandmarkeId,
} from "./landmarken.ts";
import {
    GRUND_REGION_ARTIKEL_BELEGT,
    GRUND_REGION_ARTIKEL_KEINER,
    GRUND_REGION_ARTIKEL_NEU,
    GRUND_REGION_ARTIKEL_NICHT_IM_DUMP,
    GRUND_REGION_ARTIKEL_WIEDER,
    neueRegionArtikelId,
    REGION_ARTIKEL_ART,
    REGION_ARTIKEL_PLANFELDER,
} from "./region-artikel.ts";
import {
    GRUND_ORT_ARTIKEL_BEKANNT,
    GRUND_ORT_ARTIKEL_KEINER,
    GRUND_ORT_ARTIKEL_NEU,
    GRUND_ORT_ARTIKEL_NICHT_IM_DUMP,
    GRUND_ORT_ARTIKEL_WIEDER,
    gehoertZuDenOrtArtikeln,
    leseOrtArtikel,
    neueOrtArtikelId,
    ORT_ARTIKEL_ART,
    ORT_ARTIKEL_PLANFELDER,
    ortArtikelSchluessel,
} from "./ort-artikel.ts";
import { ortsFeld, ortsStelle, ortsWert, planeOrtsliste, wunschliste, type OrtsBestand } from "./ortsliste.ts";
import {
    aufgeloesterTitel,
    normTitel,
    rollenImFeld,
    zielKlasse,
    type FeldRolle,
    type ZielWissen,
} from "./ortsrolle.ts";
import { RegelSammler, baueRegelWissen, type RegelKontext } from "../regeln/vorschlag.ts";
import {
    baueWuensche,
    istOrtszeilenFeld,
    loreOrtWert,
    planeOrtszeilen,
    relationenDerArt,
    zaehleRollen,
    type LoreBestand,
} from "./vorkommen.ts";
import {
    leiteEigentuemerAb,
    leiteWirkungAb,
    leiteZuweisungsEigentuemerAb,
    type FeldWertZustand,
    type Vermerk,
    type Zuweisungszustand,
    type ZuweisungsHerkunft,
} from "./herkunft.ts";
import {
    GRUND_KEINE_PRODUKTSEITE,
    GRUND_TITEL_MEHRDEUTIG,
    KATALOG_FELD,
    istKatalogFeld,
    istVerwendungsFeld,
    katalogWert,
    planeQuellen,
    platzhalterId,
    produkteNachQuelle,
    quellenWert,
    zitierteNennungen,
    type KatalogAngaben,
    type BestehendeQuelle,
    type Produkt,
    type PublikationsKatalog,
    type QuellenSicht,
} from "./quellen.ts";

/**
 * Der Plan eines Abgleichs (WI-0253 C): aus den Objekten der Karte mit Wiki-Zuordnung und den Seiten des Dumps die Zeilen des Berichts. REIN: keine Datenbank,
 * kein Dateisystem, keine Uhr – derselbe Dump und dieselben Objekte ergeben dieselben Zeilen in derselben Reihenfolge (Idempotenz).
 *
 * Was verglichen wird (Vali 2026-10-25, Work Item §3 Punkt 1):
 * - Nur Zuordnungen MIT gespeicherter Wiki-Aventurica-Adresse. Eine Kennung ohne Wiki-Adresse (Legacys eigener Schlüssel, ein Titel allein, eine fremde
 *   Adresse) wird NIE abgeglichen und nur gezählt (`kennungOhneWikiAdresse`); sie zählt nie als „nicht im Dump“.
 * - Eine getrennte oder unterdrückte Zuordnung wird nicht abgeglichen; hat sie eine Adresse, ist sie ein Befund, der sagt, dass der Dump die Seite kennt, aber
 *   nichts wiederbelebt wird.
 * - Der Artikel wird über die Adresse gefunden, nie über den Namen. Eine Zuordnung ändert dieser Plan nie (§3a: „eine Änderung der Zuweisung nur als Befund“).
 *
 * Je Feld: der Istwert (was die Karte zeigt: der eigene Wert vor dem Wiki-Wert), der Wiki-Wert aus dem Dump, der Eigentümer und die Wirkung (`herkunft.ts`).
 * Eine Zeile gibt es nur, wo etwas zu sagen ist:
 * - Wiki-eigene Felder: sobald der Wiki-Wert vom Istwert abweicht.
 * - Alle anderen (eigener Wert, Legacy, unbekannt): nur, wenn das Wiki sich seit dem letzten Abgleich bewegt hat (der Wiki-Wert weicht vom Schnappschuss ab) oder der
 *   Schnappschuss nichts sagt. Ein eigener Wert, der seit jeher vom Wiki abweicht, ist keine Nachricht. Ausnahme: der Vermerk „Wiki“, der dem
 *   Schnappschuss widerspricht (`herkunft_widerspruch`), steht immer da.
 */

/**
 * Der Zustand der Analyse: wenn sich Lesart oder Regeln ändern, steigt die Nummer; sie steht im Lauf, und die Übernahme übernimmt nur aus einem Lauf, der für ihren Bereich eine Grundlage
 * ist (`laufIstGrundlage`, sonst `vorschau_veraltet`).
 * 2: Ein Objekt ohne Wiki-Stand ist in der Vorschau ein Befund statt einer Übernahme, ein Abschnitt einer Kraftlinie erbt den Stand seiner Linie (WI-0253, erster Lauf auf der Stage).
 * 3: Die Gipfel lesen die Felder ihrer Landschafts-Infobox (WI-0253, Scheibe Gipfel). Die übrigen Bereiche rechnen wie in 2.
 * 4: Die Literatur liest `{{Infobox Produkt}}` (WI-0253, Scheibe Literatur). Die übrigen Bereiche rechnen wie in 3.
 * 5: Die Literatur gleicht auch die Ortsliste ab (`ort_<Stelle>`, WI-0253 Scheibe Ortslisten). Die übrigen Bereiche rechnen wie in 4.
 * 6: Die Quellen vergleichen die Publikationen der Artikel mit den Verknüpfungen ihrer Träger und mit dem Titel der Katalogquelle (WI-0253, Scheibe Quellen). Die übrigen Bereiche rechnen wie in 5.
 * 7: Die Quellen legen neue Verknüpfungen (samt fehlender Katalogquelle) an und legen Verknüpfungen mit belegter Wiki-Herkunft still, die der Artikel nicht mehr nennt (WI-0253 §21). Die übrigen Bereiche rechnen wie in 6.
 * 8: Die Gipfel lesen die Höhe (`Höhe=`) und gleichen sie mit `terrain_peak.height_schritt` ab (WI-0253 §21). Die übrigen Bereiche rechnen wie in 7.
 * 9: Die Vorkommen (Waren, Fauna, Flora, Spezies) vergleichen die Felder des Eintrags und seine Ortszeilen mit ihrer Rolle (WI-0253 §23). Die übrigen Bereiche rechnen wie in 8.
 * 10: Die Sprachen lesen die aventurischen Sprachartikel des Dumps (`{{Infobox Sprache}}`), legen neue an und still, was verschwand (WI-0261 S3). Die übrigen Bereiche rechnen wie in 9.
 * 11: Die Landmarken lesen die Landmarken-Artikel ohne Landmarke auf der Karte (`{{Infobox Region}}` mit einer Art der Abbildung), legen sie als Kandidaten an und still (WI-0271 L7). Die
 *     übrigen Bereiche rechnen wie in 10.
 * 12: Die Landschaften führen die Artikel mit `{{Infobox Region}}` ohne Fläche als Wiki-Einträge, legen sie an und still (WI-0284). Die übrigen Bereiche rechnen wie in 11.
 * 13: Die Wiki-Einträge ohne Fläche folgen zusätzlich der Elternkette: Führt sie in eine andere Welt, gehört der Artikel nicht in die Liste (WI-0284, erster Lauf auf der Stage). Die übrigen Bereiche rechnen wie in 12.
 * 14: Die Wind-Artikel (`{{Infobox Wind}}` oder Kategorie `Wind`) kommen als Wiki-Einträge ohne Fläche mit der Art „Wind“ in die Liste (WI-0288 Stufe 6). Die übrigen Bereiche rechnen wie in 13.
 * 15: Die Orte führen die Orts- und Bauwerk-Artikel ohne Ort als Einträge der Registry (`ort_artikel`), legen sie an und still, und die Bauwerkart fällt ohne passende Kategorie auf `Art=` der Infobox
 *     Bauwerk zurück (WI-0295). Die übrigen Bereiche rechnen wie in 14.
 */
export const WIKISYNC_PARSER_VERSION = "wikisync-parser-15";

/**
 * Ab welchem Stand ein Lauf der Vorschau für einen Bereich eine Grundlage ist. Ein Stand, der die Lesart EINES Bereichs ändert, macht nur dessen Läufe veraltet: Sonst müsste
 * jede neue Scheibe alle Bereiche neu rechnen lassen, samt dem langsamen Wiki-Teil der Orte, Gebiete und Landschaften, dessen Ergebnis an genau ihrer Vorschau hängt.
 */
const GRUNDLAGE_AB: Readonly<Record<WikisyncBereich, number>> = {
    // Ein Lauf von vor 15 kennt die Orts-Artikel ohne Ort nicht und hat keine Bauwerkart aus `Art=`: Eine Übernahme daraus legte keinen Eintrag an.
    ort: 15,
    weg: 2,
    gebiet: 2,
    // Ein Lauf von vor 13 kennt die Wiki-Einträge ohne Fläche nicht oder nimmt Artikel anderer Welten mit: Eine Übernahme daraus legte keinen an oder füllte die Liste mit Myranor.
    // Einer von vor 14 kennt die Wind-Artikel nicht: Eine Übernahme daraus legte sie nicht an.
    region: 14,
    // Ein Lauf von vor 8 hat für die Gipfel keine Höhe: Eine Übernahme daraus ließe die Höhen stehen, obwohl sie dem Wiki folgen sollen.
    gipfel: 8,
    kraftlinie: 2,
    // Ein Lauf von vor 5 hat für die Literatur keine Zeilen der Ortsliste: Eine Übernahme daraus ließe die Orte stehen, während der Legacy-Zug sie nicht mehr fährt.
    literatur: 5,
    // Ein Lauf von vor 7 führt „neu zitiert“ und „nicht mehr zitiert“ der Quellen als Befund: Eine Übernahme daraus legte nichts an und sagte „0 Felder“.
    quelle: 7,
    // Die Vorkommen gibt es erst seit 9.
    vorkommen: 9,
    // Die Sprachen gibt es erst seit 10.
    sprachen: 10,
};

const standNummer = (version: string): number => {
    const treffer = /^wikisync-parser-(\d+)$/u.exec(version);
    return treffer === null ? Number.NaN : Number(treffer[1]);
};

/** Rechnete dieser Stand des Abgleichs den Bereich so, wie es der heutige tut? Ein unbekannter oder späterer Stand ist keine Grundlage. */
export function laufIstGrundlage(bereich: WikisyncBereich, parserVersion: string): boolean {
    const stand = standNummer(parserVersion);
    return stand >= GRUNDLAGE_AB[bereich] && stand <= standNummer(WIKISYNC_PARSER_VERSION);
}

/** Höchstens so viele neue Artikel je Bereich werden als Zeile geführt; die Zahl daneben ist ungekappt (§4 C). */
export const MAX_NEUE_ARTIKEL_ZEILEN = 1000;

/** Ein Feld mit eigenem Wert am Objekt: der Wert, sein Zustand und sein Vermerk. */
export interface LokalerWert {
    zustand: FeldWertZustand;
    wert: string | null;
    vermerk: Vermerk;
}

/** Ein Objekt der Karte mit einer Wiki-Zuordnung, so weit der Abgleich es braucht. */
export interface PlanObjekt {
    bereich: WikisyncBereich;
    /** Die Art: `place`, `path`, `region`, `territory`, `powerline`, `peak`; `work` für ein Werk der Literatur (kein Kartenobjekt). */
    objektArt: string;
    id: string;
    name: string;
    /** Die gespeicherte Wiki-Adresse, wörtlich (auch eine fremde); `null`, wenn keine gespeichert ist. */
    adresse: string | null;
    zustand: Zuweisungszustand;
    herkunft: ZuweisungsHerkunft | null;
    /** Wege: Nur die Hauptzuweisung bestimmt den Namen des Abschnitts. */
    hauptzuweisung: boolean;
    /** Die Felder, die das Objekt selbst führt (mit Wert und Vermerk). */
    lokal: ReadonlyMap<string, LokalerWert>;
    /** Der Wiki-Stand des letzten Abgleichs; `null`: es gibt keinen Schnappschuss. */
    schnappschuss: ReadonlyMap<string, string | null> | null;
    /** Felder, deren Wiki-Wert im Schnappschuss unbekannt ist (Legacy führte dort einen Override und lieferte den Wiki-Wert nie). */
    schnappschussUnbekannt: ReadonlySet<string>;
    /**
     * Der Wiki-Stand gehört einem anderen Abschnitt derselben Linie (`ladeKraftlinien`): Dieses Objekt hängt nur mit einer Adresse am Artikel, die Linie als Ganzes hat einen
     * Stand, und der Leser zeigt ihn für die ganze Linie. Das Objekt VERGLEICHT damit, schreibt ihn aber nie: Das tut der Abschnitt, dem er gehört.
     */
    schnappschussGeerbt?: boolean;
    /** Nur ein Werk der Literatur: seine Ortsliste (`adventure_place`) samt Tombstones und der Frage, ob das Werk der Redaktion gehört (`ortsliste.ts`). */
    ortsliste?: OrtsBestand;
    /** Nur im Bereich `quelle`: ein Träger mit seinen Verknüpfungen oder eine Katalogquelle mit ihren Verwendungen (`quellen.ts`). */
    quelle?: QuellenSicht;
    /** Nur im Bereich `vorkommen`: die Art des Eintrags und seine Ortszeilen samt Herkunft und Rolle (`vorkommen.ts`). */
    vorkommen?: LoreBestand;
    /** Nur im Bereich `sprachen`: der Schlüssel des Sprachartikels (Titel in Vergleichsform) und ob er aktiv ist (WI-0261 S3, `sprachen.ts`). */
    sprache?: { schluessel: string; aktiv: boolean };
    /** Nur im Bereich `landmarken`: der Schlüssel des Landmarken-Artikels (Titel in Vergleichsform) und ob er aktiv ist (WI-0271 L7, `landmarken.ts`). */
    landmarke?: { schluessel: string; aktiv: boolean };
    /** Nur im Bereich `region`, nur ein Wiki-Eintrag ohne Fläche: der Schlüssel (Titel in Vergleichsform) und ob er aktiv ist (WI-0284, `region-artikel.ts`). */
    regionArtikel?: { schluessel: string; aktiv: boolean };
    /** Nur im Bereich `ort`, nur ein Orts- oder Bauwerk-Artikel ohne Ort: der Schlüssel (Legacys Key der Registry) und ob er aktiv ist (WI-0295, `ort-artikel.ts`). */
    ortArtikel?: { schluessel: string; aktiv: boolean };
    /**
     * Felder des Bereichs (`LOKALE_FELDER`), die DIESES Objekt nicht selbst führt: Eine Landmarke ohne Gelände hat keine Höhe (WI-0271 L3, CHECK
     * `terrain_peak_hoehe_nur_gelaende`). Ihr Wiki-Wert steht dann nur im Wiki-Stand; die Übernahme schreibt ihn nie ans Objekt.
     */
    nichtGefuehrt?: ReadonlySet<string>;
}

/** Führt das Objekt das Feld selbst (`LOKALE_FELDER` oder ein eigenes Feld des Wiki-Teils), statt dass es nur im Wiki-Stand steht? */
export const fuehrtFeldSelbst = (bereich: WikisyncBereich, objekt: PlanObjekt, feld: string): boolean =>
    objekt.nichtGefuehrt?.has(feld) !== true && (LOKALE_FELDER[bereich].has(feld) || objekt.lokal.has(feld));

/**
 * Hat das Objekt einen Wiki-Stand, an dem die Übernahme etwas schreiben kann? DIE Regel, die Vorschau und Übernahme teilen (WI-0253, erster Lauf auf der Stage): Ein Objekt
 * mit nur einer Adresse hat keinen; die Übernahme legt keinen an (eine Zuordnung ändert dieser Abgleich nie). Die Vorschau darf an ihm also nichts „übernehmen“ nennen.
 */
export const hatWikiStand = (
    objekt: PlanObjekt,
): objekt is PlanObjekt & { schnappschuss: ReadonlyMap<string, string | null> } => objekt.schnappschuss !== null;

/** Was die Zeile eines Felds sagt, dessen Objekt keinen Wiki-Stand hat (`hatWikiStand`): ein Befund mit diesem Grund, nie eine Übernahme. */
export const GRUND_KEIN_WIKI_STAND = "Nur eine Adresse, kein Wiki-Stand: Die Übernahme legt keinen an";

export interface PlanZeile {
    bereich: WikisyncBereich;
    objektArt: string;
    objektId: string | null;
    objektName: string | null;
    objekte: number;
    /**
     * Die öffentlichen Kennungen ALLER Objekte, die die Zeile zusammenfasst (sortiert; `objektId` ist die erste). Die Übernahme (D-1) schreibt an genau diesen
     * Objekten: Ein Weg, eine Landschaft oder eine Kraftlinie besteht aus Abschnitten, die einen Artikel teilen, und die Zeile nennt nur ihre Zahl und einen Vertreter.
     * Bei einem neuen Artikel ohne Kartenobjekt leer.
     */
    objektIds: string[];
    artikel: string | null;
    namensraum: number | null;
    feld: string | null;
    alt: string | null;
    altZustand: WikisyncWertZustand;
    neu: string | null;
    neuZustand: WikisyncWertZustand;
    eigentuemer: WikisyncEigentuemer;
    wirkung: WikisyncWirkung;
    status: WikisyncStatus;
    befund: WikisyncBefund | null;
    grund: string | null;
}

/**
 * Was das Wiki zu einer Quelle im Artikel EINES Trägers zitiert (WI-0254 §12): die stärkste Nennung, gekürzt wie der Vergleich, auch wo nichts abweicht. Der Lauf legt sie ab
 * (`zitat-ablage.ts`, Tafel `wikisync_quelle_zitat`, Migration 0251), die Quellen-Klappbox der Editoren vergleicht damit.
 */
export interface PlanZitat {
    /** Die Art des Trägers; `lore` ist ein Eintrag der Vorkommen (`lore_entry`, `lore_entry_source` bleibt unberührt: der Lauf legt dort nichts an). */
    traegerArt: InhalteTraegerArt | "lore";
    /** `<träger>.public_id`, klein; bei einem Weg die des Abschnitts. */
    traegerId: string;
    /** `feature_source.source_key` (`QuellenNennung.quelle`). */
    quelle: string;
    art: string;
    seiten: string | null;
    notiz: string | null;
    /** Der Titel des Wiki-Artikels, aus dem die Nennung stammt. */
    artikel: string;
}

export interface Plan {
    zeilen: PlanZeile[];
    zahlen: Partial<Record<WikisyncBereich, WikisyncBereichZahlen>>;
    /** Nur der Bereich `quelle` liefert welche: die Zitate des Wikis je Träger und Quelle, in der Reihenfolge der Träger (nach Kennung), zuletzt die der Vorkommen (`lore`). */
    zitate: PlanZitat[];
    /** Nur mit `PlanEingabe.regeln`: die Regelvorschläge der Vorkommen, die Wörter und die Zahlen dieses Laufs (`regeln/vorschlag.ts`). */
    regeln?: RegelSammler;
}

export interface PlanEingabe {
    bereiche: readonly WikisyncBereich[];
    objekte: readonly PlanObjekt[];
    dump: Pick<
        SeitenErgebnis,
        "gefunden" | "kandidaten" | "ziele" | "sprachen" | "landmarken" | "regionArtikel" | "ortArtikel"
    >;
    tafel: WikiNamespaceTafel;
    /** Bereiche, die der Legacy-Zug noch liefert (D-1 schaltet sie um): ihre wiki-eigenen Felder gehören ihm. */
    legacyBereiche?: ReadonlySet<WikisyncBereich>;
    /** Alle Titel (`bekannterTitelSchluessel`), die die Karte oder die Registry schon kennt (Adressen aller Bereiche), für den Befund „neuer Artikel“. */
    bekannteTitel: ReadonlySet<string>;
    /** Nur für den Bereich `region` (WI-0284): die Schlüssel der Artikel, die an einer Fläche oder einem Gipfel der Karte hängen. Sie sind keine Wiki-Einträge ohne Fläche. */
    belegteRegionArtikel?: ReadonlySet<string>;
    /**
     * Nur für den Bereich `ort` (WI-0295): was die Orts-Artikel aus der Kategorien-Datei brauchen (die Kategorien je Titel des Dumps, die fertige Artenliste) und die Schlüssel (`ortArtikelSchluessel`) der
     * Artikel, die die Karte oder Legacys Registry schon kennt (`ladeBekannteOrtArtikel`). Fehlt es (keine Kategorien-Datei, der Vergleich EINES Artikels), rechnet der Zweig nichts: Er wüsste weder Klasse noch
     * Kontinent.
     */
    ortArtikel?: {
        kategorien: ReadonlyMap<string, readonly string[]>;
        arten: readonly string[];
        bekannt: ReadonlySet<string>;
    };
    /**
     * Nur für den Bereich `landmarken` (WI-0271 L7): die Schlüssel (`landmarkeSchluessel`) der Artikel, die an einer Landmarke der Karte hängen, auch an einer stillgelegten (§4.2 Tombstones).
     * Ihr Artikel ist kein Kandidat; ein vorhandener wird still gelegt. Fehlt die Menge, hängt keiner.
     */
    landmarkenAufDerKarte?: ReadonlySet<string>;
    /** Die Produktseiten und Weiterleitungen des Dumps. Nur die Quellen brauchen sie; ohne sie (der Vergleich EINES Artikels) rechnet der Bereich `quelle` nichts. */
    katalog?: PublikationsKatalog;
    /**
     * Die Landschaften der Karte mit Wiki-Adresse (kleingeschriebene Titel, `ladeFlaechenTitel`): Ein Link auf sie meint eine Fläche (`abgleich/ortsrolle.ts`). Nur die Vorkommen brauchen sie, und nur mit der
     * Auskunft über die Linkziele aus dem Dump (`dump.ziele`); ohne sie rechnen die Vorkommen ihre Ortszeilen nicht (der Vergleich EINES Artikels hat sie nicht).
     */
    flaechen?: ReadonlySet<string>;
    /**
     * Nur für den Bereich `vorkommen`: Flächen der Karte und Begriffstafel für die Regelvorschläge (`regeln/`). Der Plan leitet dann zu jedem verglichenen Eintrag die Regeln ab und sammelt
     * sie in `Plan.regeln`; die Ableitung schreibt nichts.
     */
    regeln?: RegelKontext;
    /**
     * Nur für den Bereich `vorkommen` (WI-0299): die Titel der Unterseiten `<Artikel>/Liste`, die der Dump führt (`vorkommen-liste.ts`, `listenImDump`). Daraus das Feld `liste` jedes Artikels. Fehlt die
     * Menge (der Vergleich EINES Artikels über die API), wird das Feld nicht verglichen.
     */
    listen?: ReadonlySet<string>;
}

/** Die Bereiche, in denen die Abschnitte oder Teile eines Objekts einen Artikel teilen: Eine Zeile fasst sie zusammen. */
const GRUPPIERT: ReadonlySet<WikisyncBereich> = new Set(["weg", "region", "kraftlinie"]);

/** Die Felder je Bereich, die das Objekt selbst führt (alle anderen stehen nur im Schnappschuss und gelten wiki-eigen). */
export const LOKALE_FELDER: Readonly<Record<WikisyncBereich, ReadonlySet<string>>> = {
    ort: new Set(["name", "einwohner", "lage", "oberhaupt"]),
    weg: new Set(["name"]),
    gebiet: new Set(BEREICH_FELDER.gebiet),
    region: new Set(["name"]),
    // Name und Art des Gipfels gehören dem Editor und dem Gelände (`terrain_peak`), nie dem Wiki: Sie stehen nur im Wiki-Stand. Die Höhe führt der Gipfel selbst und folgt dem Wiki, solange keine
    // Hand sie gesetzt hat (WI-0253 §21; sie speist das Gelände, die Übernahme stößt es an).
    gipfel: new Set(["height"]),
    kraftlinie: new Set(["name", "description"]),
    // Ein Werk führt jedes Feld selbst (`adventure`, Vermerk in `adventure_field_origin`); einen Wiki-Stand dahinter gibt es nicht (`ladeLiteratur`).
    literatur: new Set(BEREICH_FELDER.literatur),
    // Der Titel gehört der Katalogquelle selbst (`feature_source.title`); eine Quelle der Redaktion (`source_system = editor`) trägt den Vermerk `manual`, jede andere `wiki` (Legacy überschrieb ihn bei jedem Lauf).
    quelle: new Set(BEREICH_FELDER.quelle),
    // Ein Eintrag führt die sechs Felder selbst (`lore_entry`, Vermerk in `lore_entry_field_origin`); die vier Rohtexte der Infobox stehen nur im Wiki-Stand (`wiki_lore_snapshot`).
    vorkommen: new Set(VORKOMMEN_EIGENE_FELDER),
    // Ein Sprachartikel IST sein Wiki-Stand (`wiki_sprache_artikel`): Jedes Feld ist eine Spalte des Objekts und folgt dem Wiki (Vermerk `wiki`), dazu der Lebenslauf `artikel` (`sprachen.ts`).
    sprachen: new Set(SPRACHEN_PLANFELDER),
};

/** Der Schlüssel, unter dem ein Titel als bekannt gilt: klein, denn MediaWiki stellt den ersten Buchstaben frei. */
export const bekannterTitelSchluessel = (titel: string): string => titel.toLowerCase();

/** Reihenfolge nach Codepunkten: überall gleich, unabhängig von ICU und Sprache des Rechners. */
const vergleicheText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Wie `gleich` es vergleicht: null und leer sind dasselbe, Leerraum zählt als eines. */
function normal(wert: string | null | undefined): string {
    return phpTrim((wert ?? "").replace(LEER_FOLGE, " "));
}
export const gleich = (a: string | null | undefined, b: string | null | undefined): boolean => normal(a) === normal(b);

function zustandVon(wert: string | null | undefined): WikisyncWertZustand {
    return normal(wert) === "" ? "kein" : "text";
}

/** Die Titel, unter denen der Dump den Artikel einer Adresse führen kann: wörtlich und mit großem Anfangsbuchstaben. */
export function kandidatenTitel(adresse: string | null): string[] {
    const titel = titelAusWikiAdresse(adresse);
    return titel === null ? [] : titelKandidaten(titel);
}

export function gesuchteTitelAus(objekte: readonly PlanObjekt[]): Set<string> {
    const gesucht = new Set<string>();
    for (const objekt of objekte) {
        const titel = kandidatenTitel(objekt.adresse);
        for (const kandidat of titel) gesucht.add(kandidat);
        // Ein Vorkommen: auch seine Unterseite „Liste“ (WI-0299), im selben Durchgang.
        if (objekt.bereich === "vorkommen") for (const liste of gesuchteListen(titel)) gesucht.add(liste);
    }
    return gesucht;
}

type Aufloesung =
    | { art: "gefunden"; seite: GelesenerDumpArtikel }
    | { art: "umgeleitet"; seite: GelesenerDumpArtikel }
    | { art: "nicht_im_dump" }
    | { art: "mehrdeutig"; anzahl: number };

function loeseAuf(adresse: string | null, gefunden: ReadonlyMap<string, readonly GelesenerDumpArtikel[]>): Aufloesung {
    const seiten: GelesenerDumpArtikel[] = [];
    for (const titel of kandidatenTitel(adresse)) seiten.push(...(gefunden.get(titel) ?? []));
    if (seiten.length === 0) return { art: "nicht_im_dump" };
    if (seiten.length > 1) return { art: "mehrdeutig", anzahl: seiten.length };
    const seite = seiten[0] as GelesenerDumpArtikel;
    return seite.weiterleitung === null ? { art: "gefunden", seite } : { art: "umgeleitet", seite };
}

function leereZahlen(): WikisyncBereichZahlen {
    return {
        objekte: 0,
        mitAdresse: 0,
        kennungOhneWikiAdresse: 0,
        gefunden: 0,
        umgeleitet: 0,
        nichtImDump: 0,
        mehrdeutig: 0,
        gesperrt: 0,
        felderGelesen: 0,
        unveraendert: 0,
        uebernommen: 0,
        eigen: 0,
        befunde: 0,
        neueArtikel: 0,
        neueArtikelNurZahl: 0,
    };
}

function artikelBefund(
    objekt: PlanObjekt,
    anzahl: number,
    artikel: string | null,
    ns: number | null,
    befund: WikisyncBefund,
    status: WikisyncStatus,
    grund: string | null,
    eigentuemer: WikisyncEigentuemer,
    ids: readonly string[] = [objekt.id],
): PlanZeile {
    return {
        bereich: objekt.bereich,
        objektArt: objekt.objektArt,
        objektId: objekt.id,
        objektName: objekt.name,
        objekte: anzahl,
        objektIds: [...ids],
        artikel,
        namensraum: ns,
        feld: null,
        alt: null,
        altZustand: "kein",
        neu: null,
        neuZustand: "kein",
        eigentuemer,
        // Eine Zuordnung ändert dieser Plan nie, gleich wem sie gehört: Ein Befund bleibt ein Befund.
        wirkung: "befund",
        status,
        befund,
        grund,
    };
}

/** Der Schnappschuss-Wert eines Felds: `kein` (das Wiki kannte nichts), `text`, oder unbekannt (`null`, kein Schnappschuss oder ein Override verdeckte ihn). */
function schnappschussWert(objekt: PlanObjekt, feld: string): string | null | undefined {
    if (objekt.schnappschuss === null || objekt.schnappschussUnbekannt.has(feld)) return undefined;
    return normal(objekt.schnappschuss.get(feld)) === "" ? null : (objekt.schnappschuss.get(feld) ?? null);
}

export type FeldEntscheidung = Pick<
    PlanZeile,
    "alt" | "altZustand" | "neu" | "neuZustand" | "eigentuemer" | "wirkung" | "status" | "befund" | "grund"
>;

/**
 * Entscheidet ein Feld: keine Zeile (`null`) oder was die Zeile sagt. `lokal` ist der Wert am Objekt (oder `null`: das Feld steht nur im Schnappschuss).
 */
export function entscheideFeld(
    objekt: PlanObjekt,
    feld: string,
    wikiWert: string | undefined,
    lokal: LokalerWert | null,
    bereichBeiLegacy: boolean,
): FeldEntscheidung | null {
    const schnappschuss = schnappschussWert(objekt, feld);
    const neu = wikiWert ?? null;
    // Was die Karte zeigt: der eigene Wert, sonst der Wiki-Stand des letzten Abgleichs.
    const eigenerWert = lokal !== null && lokal.zustand !== "kein";
    const alt: string | null = eigenerWert ? (lokal?.wert ?? null) : (schnappschuss ?? null);
    const altZustand: WikisyncWertZustand = eigenerWert ? (lokal?.zustand ?? "kein") : zustandVon(alt);
    if (gleich(alt, neu)) return null;

    const vermerk: Vermerk = lokal === null ? "ungefuehrt" : eigenerWert ? lokal.vermerk : "kein";
    let eigentuemer = leiteEigentuemerAb({
        zuweisung: objekt.zustand,
        wert: altZustand,
        vermerk,
        bereichBeiLegacy,
    });
    let befund: WikisyncBefund | null = null;
    // Der Vermerk „Wiki“ muss zum Schnappschuss passen; sonst hat jemand den Wert außerhalb der Kanäle verändert (Legacy-Zug), und die Herkunft gilt als unbekannt.
    if (
        lokal !== null &&
        eigenerWert &&
        lokal.vermerk === "wiki" &&
        eigentuemer === "wiki" &&
        schnappschuss !== undefined &&
        !gleich(alt, schnappschuss)
    ) {
        eigentuemer = "unbekannt";
        befund = "herkunft_widerspruch";
    }
    const abgeleitet = leiteWirkungAb(eigentuemer);
    // Wo der Eigentümer nicht das Wiki ist, ist nur eine Bewegung des Wikis eine Nachricht – außer dem Widerspruch zwischen Vermerk und Schnappschuss:
    // Er blockiert die Übernahme und bleibt sichtbar, bis jemand ihn auflöst.
    if (abgeleitet !== "uebernommen" && befund === null && schnappschuss !== undefined && gleich(neu, schnappschuss)) {
        return null;
    }
    // Ohne Wiki-Stand gibt es nichts, woran die Übernahme schreiben könnte: Die Zeile bleibt, aber als Befund (derselbe Satz wie in `entscheiden.ts`). Der Eigentümer bleibt
    // das Wiki (so gilt das Feld, sobald das Objekt einen Stand hat); nur die Wirkung ist keine Übernahme.
    const ohneStand = abgeleitet === "uebernommen" && !hatWikiStand(objekt);
    const wirkung = ohneStand ? "befund" : abgeleitet;

    const neuZustand = zustandVon(neu);
    return {
        alt,
        altZustand,
        neu,
        neuZustand,
        eigentuemer,
        wirkung,
        status: altZustand === "kein" && neuZustand === "text" ? "neu" : "geaendert",
        befund,
        grund: ohneStand ? GRUND_KEIN_WIKI_STAND : null,
    };
}

/**
 * Dieselbe Entscheidung wie im Plan, aber für ein Objekt und den Wiki-Wert, den eine Zeile des Plans trug – gegen den Stand von JETZT (WI-0253 D-1: Die Übernahme
 * rechnet jedes Feld unter der Sperre noch einmal, statt der Vorschau zu glauben). `null`: Der Istwert gleicht dem Wiki-Wert schon, es gibt nichts zu sagen.
 * Welches Feld das Objekt selbst führt und welches nur im Schnappschuss steht, bestimmt `LOKALE_FELDER` wie im Plan.
 */
export function entscheideFeldJetzt(
    bereich: WikisyncBereich,
    objekt: PlanObjekt,
    feld: string,
    wikiWert: string | undefined,
    bereichBeiLegacy: boolean,
): FeldEntscheidung | null {
    // Ein Feld führt das Objekt selbst, wenn die Tafel es nennt (`LOKALE_FELDER`) oder der Wiki-Teil es als eigenes Feld des Objekts kennt (Ortsgröße, Kontinent des Gebiets: `objekt.lokal`).
    const lokal = fuehrtFeldSelbst(bereich, objekt, feld)
        ? (objekt.lokal.get(feld) ?? { zustand: "kein" as const, wert: null, vermerk: "kein" as const })
        : null;
    return entscheideFeld(objekt, feld, wikiWert, lokal, bereichBeiLegacy);
}

interface Einheit {
    objekte: PlanObjekt[];
}

/** Das Wissen über Linkziele für die Rollen der Ortszeilen; `undefined`, wo der Dump keines gesammelt hat. */
function zielWissen(eingabe: PlanEingabe): ZielWissen | undefined {
    const ziele = eingabe.dump.ziele;
    if (ziele === undefined) return undefined;
    return {
        info: (titel) => ziele.get(titel),
        istFlaeche: (titel) => eingabe.flaechen?.has(titel.toLowerCase()) === true,
    };
}

/**
 * Die Ortszeilen eines Vorkommens (WI-0253 §23): die Wikilinks der Ortsfelder mit ihrer Rolle gegen die Ortszeilen des Eintrags (`vorkommen.ts`). Je Ort, an dem etwas zu sagen ist, eine Zeile mit dem Feld
 * `ortszeile_<Beziehung>_<Kennung>`; ihr Wert ist `Titel · Rolle · Schlüssel`. Die Zahlen des Bereichs nennen die Rollen, die Rückfragen (Rolle `teil`) und die Weiterleitungen, die der Abgleich auflöst.
 */
function planeLoreOrte(
    objekt: PlanObjekt,
    wiki: { art: string; orte: readonly VorkommenOrt[] },
    felder: Readonly<Record<string, string>>,
    seite: GelesenerDumpArtikel,
    bereichBeiLegacy: boolean,
    zahlen: WikisyncBereichZahlen,
    wissen: ZielWissen,
): PlanZeile[] {
    if (objekt.vorkommen === undefined) return [];
    const relationen = relationenDerArt(wiki.art);
    const rollen = new Map<VorkommenBeziehung, ReadonlyMap<string, FeldRolle>>();
    for (const beziehung of relationen) rollen.set(beziehung, rollenImFeld(felder[`roh_${beziehung}`] ?? "", wissen));
    const { wuensche, weiterleitungen } = baueWuensche(wiki.orte, rollen, wissen);
    const ergebnis = planeOrtszeilen(wuensche, objekt.vorkommen, relationen, bereichBeiLegacy);
    zahlen.felderGelesen += wuensche.length;
    zahlen.unveraendert += ergebnis.zahlen.gleich;
    zahlen.angelegt = (zahlen.angelegt ?? 0) + ergebnis.zahlen.angelegt;
    zahlen.stillgelegt = (zahlen.stillgelegt ?? 0) + ergebnis.zahlen.stillgelegt;
    zahlen.weiterleitungen = (zahlen.weiterleitungen ?? 0) + weiterleitungen;
    zahlen.rueckfragen = (zahlen.rueckfragen ?? 0) + wuensche.filter((wunsch) => wunsch.rolle === "teil").length;
    const rollenZahl = { ...zahlen.rollen };
    for (const [rolle, anzahl] of Object.entries(zaehleRollen(wuensche)))
        rollenZahl[rolle] = (rollenZahl[rolle] ?? 0) + anzahl;
    zahlen.rollen = rollenZahl;
    return ergebnis.entscheidungen.map((entscheidung) => ({
        bereich: objekt.bereich,
        objektArt: objekt.objektArt,
        objektId: objekt.id,
        objektName: objekt.name,
        objekte: 1,
        objektIds: [objekt.id],
        artikel: seite.titel,
        namensraum: seite.ns,
        feld: entscheidung.feld,
        alt: entscheidung.alt === null ? null : loreOrtWert(entscheidung.alt),
        altZustand: entscheidung.alt === null ? "kein" : "text",
        neu: entscheidung.neu === null ? null : loreOrtWert(entscheidung.neu),
        neuZustand: entscheidung.neu === null ? "kein" : "text",
        eigentuemer: entscheidung.eigentuemer,
        wirkung: entscheidung.wirkung,
        status: entscheidung.status,
        befund: null,
        grund: entscheidung.grund === null ? null : entscheidung.grund.slice(0, 200),
    }));
}

function namensraumText(ns: number): string {
    return `ns ${String(ns)}`;
}

/** Die Zeilen eines Bereichs, ohne die neuen Artikel. */
function planeBereich(
    bereich: WikisyncBereich,
    objekte: readonly PlanObjekt[],
    eingabe: PlanEingabe,
    zahlen: WikisyncBereichZahlen,
    regeln?: RegelSammler,
): PlanZeile[] {
    const zeilen: PlanZeile[] = [];
    const bereichBeiLegacy = eingabe.legacyBereiche?.has(bereich) === true;
    const felder = BEREICH_FELDER[bereich];
    const lokaleFelder = LOKALE_FELDER[bereich];
    zahlen.objekte = objekte.length;

    // 1. Wer wird verglichen? Getrennte und unterdrückte Zuordnungen und Kennungen ohne Wiki-Adresse nicht.
    const mitAdresse: { objekt: PlanObjekt; titel: string }[] = [];
    for (const objekt of objekte) {
        const titel = titelAusWikiAdresse(objekt.adresse);
        if (objekt.zustand === "getrennt" || objekt.zustand === "unterdrueckt") {
            zahlen.gesperrt += 1;
            if (titel !== null) {
                zeilen.push(
                    artikelBefund(
                        objekt,
                        1,
                        titel,
                        null,
                        "zuordnung_gesperrt",
                        "unterdrueckt",
                        objekt.zustand === "getrennt" ? "getrennt" : "unterdrückt",
                        leiteZuweisungsEigentuemerAb(objekt.zustand, objekt.herkunft),
                    ),
                );
            }
            continue;
        }
        if (titel === null) {
            zahlen.kennungOhneWikiAdresse += 1;
            continue;
        }
        zahlen.mitAdresse += 1;
        mitAdresse.push({ objekt, titel });
    }

    // 2. Die Einheiten: ein Objekt, bei gruppierten Bereichen alle Objekte eines Artikels.
    const artikel = new Map<string, PlanObjekt[]>();
    const einheiten = new Map<string, Einheit>();
    for (const { objekt, titel } of mitAdresse) {
        const schluessel = titel.toLowerCase();
        const alleDesArtikels = artikel.get(schluessel) ?? [];
        alleDesArtikels.push(objekt);
        artikel.set(schluessel, alleDesArtikels);
        const einheitSchluessel = GRUPPIERT.has(bereich) ? `a:${schluessel}` : `o:${objekt.id}`;
        const einheit = einheiten.get(einheitSchluessel) ?? { objekte: [] };
        einheit.objekte.push(objekt);
        einheiten.set(einheitSchluessel, einheit);
    }

    // 3. Der Artikel je Einheit, die Befunde und die Felder.
    const artikelBereit = new Set<string>();
    for (const einheit of einheiten.values()) {
        const erstes = einheit.objekte[0] as PlanObjekt;
        const titel = titelAusWikiAdresse(erstes.adresse) as string;
        const eigentuemer = leiteZuweisungsEigentuemerAb(erstes.zustand, erstes.herkunft);
        const aufloesung = loeseAuf(erstes.adresse, eingabe.dump.gefunden);
        const anzahl = einheit.objekte.length;
        const alle = artikel.get(titel.toLowerCase()) ?? einheit.objekte;
        const einheitIds = einheit.objekte.map((objekt) => objekt.id);

        if (aufloesung.art === "nicht_im_dump") {
            zahlen.nichtImDump += anzahl;
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    titel,
                    null,
                    "artikel_nicht_im_dump",
                    "zu_entfernen",
                    null,
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }
        if (aufloesung.art === "mehrdeutig") {
            zahlen.mehrdeutig += anzahl;
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    titel,
                    null,
                    "mehrdeutig",
                    "mehrdeutig",
                    `${String(aufloesung.anzahl)} Seiten`,
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }
        const seite = aufloesung.seite;
        if (aufloesung.art === "umgeleitet") {
            zahlen.umgeleitet += anzahl;
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    seite.titel,
                    seite.ns,
                    "umleitung",
                    "geaendert",
                    seite.weiterleitung,
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }
        zahlen.gefunden += anzahl;
        if (wikiNamespaceZeile(eingabe.tafel, seite.ns) === undefined) {
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    seite.titel,
                    seite.ns,
                    "namensraum_unbekannt",
                    "fehlerhaft",
                    namensraumText(seite.ns),
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }
        const gelesen = leseSeitenFelder(bereich, analysiere(seite.titel, seite.text));
        if (!gelesen.ok) {
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    seite.titel,
                    seite.ns,
                    "infobox_kaputt",
                    "fehlerhaft",
                    gelesen.grund,
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }

        // Ein Vorkommen ändert seine Art nie: Wechselt die Infobox (aus einer Tierart wird eine Pflanzenart), ist das ein Befund, kein Raten.
        if (
            gelesen.vorkommen !== undefined &&
            erstes.vorkommen !== undefined &&
            erstes.vorkommen.art !== gelesen.vorkommen.art
        ) {
            zeilen.push(
                artikelBefund(
                    erstes,
                    anzahl,
                    seite.titel,
                    seite.ns,
                    "infobox_kaputt",
                    "fehlerhaft",
                    `andere_art:${gelesen.vorkommen.art}`,
                    eigentuemer,
                    einheitIds,
                ),
            );
            continue;
        }

        const wikiFelder = gelesen.felder;
        // Die Unterseite „Liste“ eines Vorkommens (WI-0299) steht nicht im Artikel, sondern im Dump; ohne seine Auskunft wird sie nicht verglichen (`vorkommen-liste.ts`).
        const liste = bereich === "vorkommen" ? eingabe.listen : undefined;
        for (const feld of felder) {
            if (bereich === "vorkommen" && feld === LISTE_FELD && liste === undefined) continue;
            const wikiWert =
                liste !== undefined && feld === LISTE_FELD ? listeDes(seite.titel, liste) : wikiFelder[feld];
            // Nennt das Wiki keine Höhe, bleibt die Höhe des Gipfels, wie sie ist: Das Wiki ist die Stimme nur, wo es einen Wert hat (WI-0253 §21).
            if (bereich === "gipfel" && feld === "height" && wikiWert === undefined) continue;
            // Eine Landmarke ohne Gelände führt keine Höhe (`nichtGefuehrt`): Ihr Wiki-Wert geht nur in den Wiki-Stand.
            if (lokaleFelder.has(feld) && !einheit.objekte.some((objekt) => objekt.nichtGefuehrt?.has(feld) === true)) {
                // Je Objekt; bei einer Gruppe ergeben gleiche Zustände EINE Zeile.
                const gruppen = new Map<
                    string,
                    { vertreter: PlanObjekt; ids: string[]; entscheidung: FeldEntscheidung | null }
                >();
                for (const objekt of einheit.objekte) {
                    if (feld === "name" && bereich === "weg" && !objekt.hauptzuweisung) continue;
                    zahlen.felderGelesen += 1;
                    const lokal = objekt.lokal.get(feld) ?? null;
                    const entscheidung = entscheideFeld(
                        objekt,
                        feld,
                        wikiWert,
                        lokal ?? { zustand: "kein", wert: null, vermerk: "kein" },
                        bereichBeiLegacy,
                    );
                    if (entscheidung === null) {
                        zahlen.unveraendert += 1;
                        continue;
                    }
                    const schluessel = JSON.stringify(entscheidung);
                    const gruppe = gruppen.get(schluessel);
                    if (gruppe === undefined)
                        gruppen.set(schluessel, { vertreter: objekt, ids: [objekt.id], entscheidung });
                    else gruppe.ids.push(objekt.id);
                }
                for (const gruppe of gruppen.values()) {
                    zeilen.push({
                        bereich,
                        objektArt: gruppe.vertreter.objektArt,
                        objektId: gruppe.vertreter.id,
                        objektName: gruppe.vertreter.name,
                        objekte: gruppe.ids.length,
                        objektIds: gruppe.ids,
                        artikel: seite.titel,
                        namensraum: seite.ns,
                        feld,
                        ...(gruppe.entscheidung as FeldEntscheidung),
                    });
                }
            } else if (!artikelBereit.has(`${titel.toLowerCase()}|${feld}`)) {
                // Ein Eintrag der Redaktion hat keinen Wiki-Stand: Der WikiSync fasst ihn nicht an (WI-0254 Importschutz auf Eintragsebene), auch nicht die Rohtexte hinter ↺.
                if (bereich === "vorkommen" && einheit.objekte.some((objekt) => objekt.vorkommen?.redaktion === true))
                    continue;
                // Ein Feld nur im Schnappschuss: einmal je Artikel.
                artikelBereit.add(`${titel.toLowerCase()}|${feld}`);
                zahlen.felderGelesen += 1;
                const vertreter = alle.find((objekt) => objekt.schnappschuss !== null) ?? (alle[0] as PlanObjekt);
                const entscheidung = entscheideFeld(vertreter, feld, wikiWert, null, bereichBeiLegacy);
                if (entscheidung === null) {
                    zahlen.unveraendert += 1;
                    continue;
                }
                zeilen.push({
                    bereich,
                    objektArt: vertreter.objektArt,
                    objektId: vertreter.id,
                    objektName: vertreter.name,
                    objekte: alle.length,
                    objektIds: alle.map((objekt) => objekt.id),
                    artikel: seite.titel,
                    namensraum: seite.ns,
                    feld,
                    ...entscheidung,
                });
            }
        }
        if (gelesen.vorkommen !== undefined) {
            const wissen = zielWissen(eingabe);
            if (wissen !== undefined) {
                for (const objekt of einheit.objekte) {
                    zeilen.push(
                        ...planeLoreOrte(
                            objekt,
                            gelesen.vorkommen,
                            wikiFelder,
                            seite,
                            bereichBeiLegacy,
                            zahlen,
                            wissen,
                        ),
                    );
                    // Die Regelvorschläge (WI-0253 §24): aus den Rohtexten desselben Artikels, rein lesend. Ein Eintrag ohne Schlüssel (der Vergleich EINES Artikels) wird nicht abgeleitet.
                    if (
                        regeln !== undefined &&
                        eingabe.regeln !== undefined &&
                        objekt.vorkommen?.wikiKey !== undefined
                    ) {
                        regeln.fuegeHinzu(
                            { art: gelesen.vorkommen.art, felder: wikiFelder },
                            baueRegelWissen(
                                wissen,
                                (titel) => aufgeloesterTitel(normTitel(titel), wissen),
                                eingabe.regeln,
                            ),
                            {
                                id: objekt.id,
                                name: objekt.name,
                                art: gelesen.vorkommen.art,
                                redaktion: objekt.vorkommen.redaktion,
                                bestand: { wikiKey: objekt.vorkommen.wikiKey, regeln: objekt.vorkommen.regeln ?? [] },
                            },
                            seite.titel,
                        );
                    }
                }
            }
        }
        if (gelesen.orte !== undefined) {
            for (const objekt of einheit.objekte) {
                zeilen.push(
                    ...planeOrte(
                        objekt,
                        gelesen.orte,
                        wikiFelder["product_type"] ?? "",
                        seite,
                        bereichBeiLegacy,
                        zahlen,
                    ),
                );
            }
        }
    }
    return zeilen;
}

/**
 * Die Ortsliste eines Werks (WI-0253, Scheibe Ortslisten): je Stelle, an der das Wiki etwas anderes nennt als das Werk, eine Zeile mit dem Feld `ort_<Stelle>` (`ortsliste.ts`).
 * Die Werte sind „Name (Rolle)“; die Übernahme liest sie zurück (`leseOrtsWert`) und schreibt nur, wo die Zeile, die die Vorschau sah, noch so dasteht.
 */
function planeOrte(
    objekt: PlanObjekt,
    orte: readonly string[],
    productType: string,
    seite: GelesenerDumpArtikel,
    bereichBeiLegacy: boolean,
    zahlen: WikisyncBereichZahlen,
): PlanZeile[] {
    if (objekt.ortsliste === undefined) return [];
    const wunsch = wunschliste(orte, productType);
    const entscheidungen = planeOrtsliste(wunsch, objekt.ortsliste, bereichBeiLegacy);
    zahlen.felderGelesen += wunsch.length;
    zahlen.unveraendert += Math.max(0, wunsch.length - entscheidungen.filter((e) => e.neu !== null).length);
    return entscheidungen.map((entscheidung) => ({
        bereich: objekt.bereich,
        objektArt: objekt.objektArt,
        objektId: objekt.id,
        objektName: objekt.name,
        objekte: 1,
        objektIds: [objekt.id],
        artikel: seite.titel,
        namensraum: seite.ns,
        feld: ortsFeld(entscheidung.stelle),
        alt: entscheidung.alt === null ? null : ortsWert(entscheidung.alt),
        altZustand: entscheidung.alt === null ? "kein" : "text",
        neu: entscheidung.neu === null ? null : ortsWert(entscheidung.neu),
        neuZustand: entscheidung.neu === null ? "kein" : "text",
        eigentuemer: entscheidung.eigentuemer,
        wirkung: entscheidung.wirkung,
        status: entscheidung.status,
        befund: null,
        grund: entscheidung.grund,
    }));
}

/**
 * Die Zitate des Wikis an den Einträgen der Vorkommen (WI-0254 §12): je Eintrag mit lesbarem Artikel die stärkste Nennung jeder Quelle, gekürzt und unter dem Schlüssel der Quelle der Karte
 * (`zitierteNennungen`). 🔴 NUR Zitate: Die Verknüpfungen eines Eintrags (`lore_entry_source`) gehören Legacy-Zug und Redaktion; hier entsteht weder eine Zeile des Plans noch eine Verknüpfung noch
 * eine Zahl der anderen Träger. Ein gesperrter Eintrag (unterdrückt), ein Artikel, der fehlt, umgeleitet oder mehrdeutig ist, und ein unbekannter Namensraum haben keine (wie bei den Trägern der Karte).
 */
function zitateDerVorkommen(
    vorkommen: readonly PlanObjekt[],
    eingabe: PlanEingabe,
    katalog: PublikationsKatalog,
    bestehend: ReadonlyMap<string, BestehendeQuelle>,
): PlanZitat[] {
    const zitate: PlanZitat[] = [];
    for (const objekt of vorkommen) {
        if (objekt.zustand === "getrennt" || objekt.zustand === "unterdrueckt") continue;
        if (titelAusWikiAdresse(objekt.adresse) === null) continue;
        const aufloesung = loeseAuf(objekt.adresse, eingabe.dump.gefunden);
        if (aufloesung.art !== "gefunden") continue;
        const seite = aufloesung.seite;
        if (wikiNamespaceZeile(eingabe.tafel, seite.ns) === undefined) continue;
        for (const nennung of zitierteNennungen(lesePublikationen(seite.text), katalog, bestehend))
            zitate.push({
                traegerArt: "lore",
                traegerId: objekt.id,
                quelle: nennung.quelle,
                art: nennung.art,
                seiten: nennung.seiten,
                notiz: nennung.notiz,
                artikel: seite.titel,
            });
    }
    return zitate;
}

/**
 * Der Bereich `quelle` (WI-0253, Scheibe Quellen): Die Objekte sind Träger (mit ihren Verknüpfungen) und Katalogquellen (mit ihren Verwendungen). Je Träger mit lesbarem Artikel werden die
 * Publikationen des Artikels gegen seine Verknüpfungen gehalten (`quellen.ts`); die Zeile gehört der QUELLE, ihr Feld ist der Träger (`verwendung_<Art>_<Kennung>`), ihr Artikel der des Trägers.
 * Dazu der Titel jeder genannten Quelle gegen den ihrer Produktseite (Feld `title`, die Zahl der Träger steht an der Zeile), und die Linkziele ohne Produktseite einmal je Ziel.
 *
 * Artikel, die fehlen, umgeleitet oder mehrdeutig sind, und gesperrte Zuordnungen zählt der Bereich nur: Ihren Befund sagt schon der Bereich des Trägers (Orte, Wege …).
 */
function planeQuellenBereich(
    objekte: readonly PlanObjekt[],
    eingabe: PlanEingabe,
    zahlen: WikisyncBereichZahlen,
    zitate: PlanZitat[],
): PlanZeile[] {
    const traeger = objekte.filter((objekt) => objekt.quelle?.art === "traeger");
    zahlen.objekte = traeger.length;
    // Die Einträge der Vorkommen zählen hier nicht mit: Sie tragen nur Zitate (unten), keine Verknüpfungen zum Vergleichen.
    const vorkommen = objekte.filter((objekt) => objekt.quelle?.art === "vorkommen");
    const katalog = eingabe.katalog;
    // Ohne die Produktseiten des Dumps lässt sich keine Publikation einer Quelle zuordnen (der Vergleich EINES Artikels hat sie nicht).
    if (katalog === undefined) return [];
    const bereichBeiLegacy = eingabe.legacyBereiche?.has("quelle") === true;
    // Offiziell ist, was aus einem Namensraum kommt, den die Tafel offiziell führt (Legacy `avesmapsPublicationCatalogIsOfficial`; ein unbekannter Raum zählt als offiziell).
    const offiziell = (ns: number): boolean => wikiNamespaceZeile(eingabe.tafel, ns)?.kanon !== "inoffiziell";
    const quellen = new Map<string, PlanObjekt>();
    const bestehend = new Map<string, BestehendeQuelle>();
    for (const objekt of objekte) {
        if (objekt.quelle?.art !== "quelle") continue;
        quellen.set(objekt.quelle.schluessel, objekt);
        bestehend.set(objekt.quelle.schluessel, {
            id: objekt.id,
            titel: objekt.name,
            aktiv: objekt.quelle.aktiv,
            ...(objekt.quelle.vonWikisyncStill === true ? { vonWikisyncStill: true } : {}),
        });
    }

    const zeilen: PlanZeile[] = [];
    // Die Quellen, die der Katalog nicht hat und die dieser Lauf anlegen würde: eine Zeile je Quelle, mit den Verwendungen, die an ihr hängen.
    const neueQuellen = new Map<string, { angaben: KatalogAngaben; seite: string; ns: number; verwendungen: number }>();
    let stillgelegt = 0;
    const zitiert = new Map<string, Produkt>();
    const ohneProduktseite = new Map<string, number>();
    for (const objekt of traeger) {
        const sicht = objekt.quelle;
        if (sicht?.art !== "traeger") continue;
        if (objekt.zustand === "getrennt" || objekt.zustand === "unterdrueckt") {
            zahlen.gesperrt += 1;
            continue;
        }
        if (titelAusWikiAdresse(objekt.adresse) === null) {
            zahlen.kennungOhneWikiAdresse += 1;
            continue;
        }
        zahlen.mitAdresse += 1;
        const aufloesung = loeseAuf(objekt.adresse, eingabe.dump.gefunden);
        if (aufloesung.art === "nicht_im_dump") zahlen.nichtImDump += 1;
        else if (aufloesung.art === "mehrdeutig") zahlen.mehrdeutig += 1;
        else if (aufloesung.art === "umgeleitet") zahlen.umgeleitet += 1;
        if (aufloesung.art !== "gefunden") continue;
        zahlen.gefunden += 1;
        const seite = aufloesung.seite;
        if (wikiNamespaceZeile(eingabe.tafel, seite.ns) === undefined) continue;

        const ergebnis = planeQuellen(
            lesePublikationen(seite.text),
            { art: sicht.traegerArt, id: objekt.id },
            sicht.verknuepfungen,
            katalog,
            bestehend,
            bereichBeiLegacy,
            { offiziell },
        );
        for (const nennung of ergebnis.nennungen)
            zitate.push({
                traegerArt: sicht.traegerArt,
                traegerId: objekt.id,
                quelle: nennung.quelle,
                art: nennung.art,
                seiten: nennung.seiten,
                notiz: nennung.notiz,
                artikel: seite.titel,
            });
        zahlen.felderGelesen += ergebnis.zahlen.gelesen;
        zahlen.angelegt = (zahlen.angelegt ?? 0) + ergebnis.zahlen.angelegt;
        stillgelegt += ergebnis.zahlen.stillgelegt;
        zahlen.unveraendert += ergebnis.zahlen.gleich;
        for (const [schluessel, produkt] of ergebnis.zitiert)
            if (!zitiert.has(schluessel)) zitiert.set(schluessel, produkt);
        for (const linkziel of ergebnis.ohneProduktseite)
            ohneProduktseite.set(linkziel, (ohneProduktseite.get(linkziel) ?? 0) + 1);
        for (const entscheidung of ergebnis.entscheidungen) {
            // Eine Quelle, die es noch nicht gibt, hat eine Platzhalter-Kennung aus ihrem Schlüssel: An ihr hängen die Zeile, die sie anlegt, und die Verwendungen.
            const katalogZeile = entscheidung.katalog;
            const objektId =
                entscheidung.quelleId ?? (katalogZeile === undefined ? null : platzhalterId(katalogZeile.schluessel));
            if (katalogZeile !== undefined) {
                const bisher = neueQuellen.get(katalogZeile.schluessel);
                neueQuellen.set(katalogZeile.schluessel, {
                    angaben: katalogZeile,
                    seite: bisher?.seite ?? ergebnis.zitiert.get(katalogZeile.schluessel)?.seite ?? katalogZeile.titel,
                    ns: bisher?.ns ?? ergebnis.zitiert.get(katalogZeile.schluessel)?.ns ?? 0,
                    verwendungen: (bisher?.verwendungen ?? 0) + 1,
                });
            }
            zeilen.push({
                bereich: "quelle",
                objektArt: "source",
                objektId,
                objektName: entscheidung.titel,
                objekte: 1,
                objektIds: objektId === null ? [] : [objektId],
                artikel: seite.titel,
                namensraum: seite.ns,
                feld: entscheidung.feld,
                alt: entscheidung.alt === null ? null : quellenWert(entscheidung.alt),
                altZustand: entscheidung.alt === null ? "kein" : "text",
                neu: entscheidung.neu === null ? null : quellenWert(entscheidung.neu),
                neuZustand: entscheidung.neu === null ? "kein" : "text",
                eigentuemer: entscheidung.eigentuemer,
                wirkung: entscheidung.wirkung,
                status: entscheidung.status,
                befund: null,
                grund: entscheidung.grund,
            });
        }
    }

    // Der Titel jeder genannten Quelle gegen den ihrer Produktseite; er wirkt auf alle Träger der Quelle.
    const gruppen = produkteNachQuelle(katalog);
    for (const [schluessel, produkt] of [...zitiert].sort(([a], [b]) => vergleicheText(a, b))) {
        const quelle = quellen.get(schluessel);
        if (quelle?.quelle?.art !== "quelle" || !quelle.quelle.aktiv || produkt.titel === "") continue;
        zahlen.felderGelesen += 1;
        const traegerZahl = Math.max(
            1,
            quelle.quelle.verwendungen.filter((verwendung) => verwendung.zustand === "active").length,
        );
        // Teilen sich mehrere Produktseiten mit verschiedenen Titeln die Shop-Adresse, gibt es keinen Titel des Wikis: ein Befund.
        const teilen = (gruppen.get(schluessel) ?? [produkt]).filter(
            (kandidat, index, alle) => alle.findIndex((andere) => andere.titel === kandidat.titel) === index,
        );
        if (teilen.length > 1) {
            zeilen.push({
                bereich: "quelle",
                objektArt: "source",
                objektId: quelle.id,
                objektName: quelle.name,
                objekte: traegerZahl,
                objektIds: [quelle.id],
                artikel: produkt.seite,
                namensraum: produkt.ns,
                feld: "title",
                alt: quelle.name,
                altZustand: "text",
                neu: null,
                neuZustand: "kein",
                eigentuemer: "unbekannt",
                wirkung: "befund",
                status: "mehrdeutig",
                befund: null,
                grund: `${GRUND_TITEL_MEHRDEUTIG}: ${teilen.map((kandidat) => kandidat.titel).join(" · ")}`,
            });
            continue;
        }
        const entscheidung = entscheideFeld(
            quelle,
            "title",
            produkt.titel,
            quelle.lokal.get("title") ?? null,
            bereichBeiLegacy,
        );
        if (entscheidung === null) {
            zahlen.unveraendert += 1;
            continue;
        }
        zeilen.push({
            bereich: "quelle",
            objektArt: "source",
            objektId: quelle.id,
            objektName: quelle.name,
            objekte: traegerZahl,
            objektIds: [quelle.id],
            artikel: produkt.seite,
            namensraum: produkt.ns,
            feld: "title",
            ...entscheidung,
        });
    }

    // Die Quellen, die fehlen: eine Zeile je Quelle, vor ihren Verwendungen im Bericht (gleicher Name, Feld `katalog_neu`).
    for (const [schluessel, eintrag] of [...neueQuellen].sort(([a], [b]) => vergleicheText(a, b))) {
        const platzhalter = platzhalterId(schluessel);
        zeilen.push({
            bereich: "quelle",
            objektArt: "source",
            objektId: platzhalter,
            objektName: eintrag.angaben.titel,
            objekte: eintrag.verwendungen,
            objektIds: [platzhalter],
            artikel: eintrag.seite,
            namensraum: eintrag.ns,
            feld: KATALOG_FELD,
            alt: null,
            altZustand: "kein",
            neu: katalogWert(eintrag.angaben),
            neuZustand: "text",
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "neu",
            befund: null,
            grund: "Die Quelle fehlt im Katalog und wird angelegt",
        });
    }
    zahlen.stillgelegt = stillgelegt;
    zahlen.quellenAngelegt = neueQuellen.size;
    zitate.push(...zitateDerVorkommen(vorkommen, eingabe, katalog, bestehend));

    // Linkziele ohne Produktseite: einmal je Ziel, mit der Zahl der Träger, die es nennen.
    for (const [linkziel, anzahl] of [...ohneProduktseite].sort(([a], [b]) => vergleicheText(a, b))) {
        zeilen.push({
            bereich: "quelle",
            objektArt: "source",
            objektId: null,
            objektName: linkziel,
            objekte: anzahl,
            objektIds: [],
            artikel: null,
            namensraum: null,
            feld: "ohne_produktseite",
            alt: null,
            altZustand: "kein",
            neu: null,
            neuZustand: "kein",
            eigentuemer: "unbekannt",
            wirkung: "befund",
            status: "neu",
            befund: null,
            grund: GRUND_KEINE_PRODUKTSEITE,
        });
    }
    return zeilen;
}

/**
 * Artikelzentriert gerechnet: die Sprachen (WI-0261 S3) und die Kandidaten der Landmarken (WI-0271 L7). Was sie unterscheidet, steht in ihrer Beschreibung (`ArtikelBereich`); Anlegen, Beleben und
 * Stilllegen regelt dieser eine Zweig.
 */
interface ArtikelBereich {
    bereich: "sprachen" | "gipfel" | "region" | "ort";
    objektArt: string;
    planfelder: readonly string[];
    /** Die Seiten des Dumps, die der Bereich gesammelt hat; ohne sie (der Vergleich EINES Artikels) rechnet er nichts. */
    seiten: (eingabe: PlanEingabe) => readonly GelesenerDumpArtikel[] | undefined;
    schluessel: (titel: string) => string;
    info: (objekt: PlanObjekt) => { schluessel: string; aktiv: boolean } | undefined;
    /** Gehört die Seite in die Menge des Bereichs (aventurisch, eine Landmarke)? */
    gehoert: (seite: GelesenerDumpArtikel, eingabe: PlanEingabe) => boolean;
    /** Liest die Felder der Seite; eine Seite, die sich nicht lesen lässt, ist ein Befund. `dump` ist die Seite, wie der Sammler sie hielt (Titel und Namensraum). */
    lese: (
        seite: Infoboxseite,
        eingabe: PlanEingabe,
        dump: GelesenerDumpArtikel,
    ) => { ok: true; felder: Readonly<Record<string, string>> } | { ok: false; grund: string };
    neueId: (schluessel: string) => string;
    /** Hängt der Artikel schon an einem Objekt der Karte? Dann ist er kein Artikel des Bereichs (nur die Landmarken). */
    ausgeschlossen?: (schluessel: string, eingabe: PlanEingabe) => boolean;
    gruende: {
        neu: string;
        wieder: string;
        nichtImDump: string;
        /** Die Seite steht im Dump, gehört aber nicht mehr zur Menge. */
        nichtMehr: string;
        keineInfobox: string;
        ausgeschlossen?: string;
    };
}

const SPRACHEN_ARTIKEL: ArtikelBereich = {
    bereich: "sprachen",
    objektArt: SPRACHE_ARTIKEL_ART,
    planfelder: SPRACHEN_PLANFELDER,
    seiten: (eingabe) => eingabe.dump.sprachen,
    schluessel: sprachSchluessel,
    info: (objekt) => objekt.sprache,
    gehoert: (seite) => istAventurisch(seite.text),
    lese: (seite) => leseSeitenFelder("sprachen", seite),
    neueId: neuerArtikelId,
    gruende: {
        neu: GRUND_NEU,
        wieder: GRUND_WIEDER,
        nichtImDump: GRUND_NICHT_IM_DUMP,
        nichtMehr: GRUND_NICHT_AVENTURISCH,
        keineInfobox: GRUND_KEINE_INFOBOX,
    },
};

/**
 * Die Kandidaten der Landmarken (WI-0271 L7, Bereich `gipfel`): die Landmarken-Artikel des Dumps (`dump.landmarken`, Regel in `infobox/landmarke.ts`), die an keiner Landmarke der Karte hängen
 * (`landmarkenAufDerKarte`). 🔴 Ein Kandidat ist nur ein Wiki-Stand: Auf die Karte kommt er allein durch einen Menschen („Auf der Karte setzen“).
 */
const LANDMARKEN_ARTIKEL: ArtikelBereich = {
    bereich: "gipfel",
    objektArt: LANDMARKE_ARTIKEL_ART,
    planfelder: LANDMARKEN_PLANFELDER,
    seiten: (eingabe) => eingabe.dump.landmarken,
    schluessel: landmarkeSchluessel,
    info: (objekt) => objekt.landmarke,
    gehoert: (seite) => landmarkenArtDerSeite(analysiere(seite.titel, seite.text)) !== null,
    lese: leseLandmarke,
    neueId: neueLandmarkeId,
    ausgeschlossen: (schluessel, eingabe) => eingabe.landmarkenAufDerKarte?.has(schluessel) === true,
    gruende: {
        neu: GRUND_LANDMARKE_NEU,
        wieder: GRUND_LANDMARKE_WIEDER,
        nichtImDump: GRUND_LANDMARKE_NICHT_IM_DUMP,
        nichtMehr: GRUND_LANDMARKE_KEINE,
        keineInfobox: GRUND_LANDMARKE_KEINE,
        ausgeschlossen: GRUND_LANDMARKE_AUF_DER_KARTE,
    },
};

/**
 * Die Wiki-Einträge ohne Fläche (WI-0284, Bereich `region`): die Artikel mit `{{Infobox Region}}` und die Wind-Artikel (`infobox/region-artikel.ts`, `infobox/wind.ts`), an denen keine Fläche und kein Gipfel hängt. Ein Artikel, der an einer Fläche hängt,
 * gehört dem gewöhnlichen Abgleich der Landschaften; der Lader (`ladeRegionArtikel`) nimmt seine Zeile deshalb gar nicht erst, und sie wird hier nie still gelegt.
 */
const REGION_ARTIKEL: ArtikelBereich = {
    bereich: "region",
    objektArt: REGION_ARTIKEL_ART,
    planfelder: REGION_ARTIKEL_PLANFELDER,
    seiten: (eingabe) => eingabe.dump.regionArtikel,
    schluessel: landmarkeSchluessel,
    info: (objekt) => objekt.regionArtikel,
    gehoert: (seite, eingabe) => {
        if (!gehoertZurFlaechenliste(analysiere(seite.titel, seite.text))) return false;
        // Die Elternkette entscheidet über die Vorlage hinaus: Viele Artikel aus Myranor und Uthuria nennen ihre Welt nur in `Region=` (Delaran, Dragestan); dieselbe Regel wie für die Rolle eines Links.
        const wissen = zielWissen(eingabe);
        return wissen === undefined || zielKlasse(seite.titel, wissen) !== "fremd";
    },
    lese: (seite) => leseSeitenFelder("region", seite),
    neueId: neueRegionArtikelId,
    ausgeschlossen: (schluessel, eingabe) => eingabe.belegteRegionArtikel?.has(schluessel) === true,
    gruende: {
        neu: GRUND_REGION_ARTIKEL_NEU,
        wieder: GRUND_REGION_ARTIKEL_WIEDER,
        nichtImDump: GRUND_REGION_ARTIKEL_NICHT_IM_DUMP,
        nichtMehr: GRUND_REGION_ARTIKEL_KEINER,
        keineInfobox: GRUND_REGION_ARTIKEL_KEINER,
        ausgeschlossen: GRUND_REGION_ARTIKEL_BELEGT,
    },
};

/**
 * Die Orts- und Bauwerk-Artikel ohne Ort (WI-0295, Bereich `ort`): die Seiten mit einer Infobox der Bauwerke oder Siedlungen (`dump.ortArtikel`), aventurisch, ohne lineare Anlage, die weder die Karte noch
 * Legacys Registry kennt (`ortArtikel.bekannt`). Ein Artikel, der an einem Ort hängt, gehört dem gewöhnlichen Abgleich der Orte; der Lader (`ladeOrtArtikel`) nimmt seine Zeile gar nicht erst. Ohne die
 * Kategorien-Datei (`eingabe.ortArtikel`) rechnet der Zweig nichts, auch kein Stilllegen.
 */
const ORT_ARTIKEL: ArtikelBereich = {
    bereich: "ort",
    objektArt: ORT_ARTIKEL_ART,
    planfelder: ORT_ARTIKEL_PLANFELDER,
    seiten: (eingabe) => (eingabe.ortArtikel === undefined ? undefined : eingabe.dump.ortArtikel),
    schluessel: ortArtikelSchluessel,
    info: (objekt) => objekt.ortArtikel,
    gehoert: (seite, eingabe) =>
        gehoertZuDenOrtArtikeln(
            analysiere(seite.titel, seite.text),
            eingabe.ortArtikel?.kategorien.get(seite.titel) ?? [],
            zielWissen(eingabe),
        ),
    lese: (seite, eingabe, dump) =>
        leseOrtArtikel(
            seite,
            dump.ns,
            eingabe.ortArtikel?.kategorien.get(dump.titel) ?? [],
            eingabe.ortArtikel?.arten ?? [],
            zielWissen(eingabe),
        ),
    neueId: neueOrtArtikelId,
    ausgeschlossen: (schluessel, eingabe) => eingabe.ortArtikel?.bekannt.has(schluessel) === true,
    gruende: {
        neu: GRUND_ORT_ARTIKEL_NEU,
        wieder: GRUND_ORT_ARTIKEL_WIEDER,
        nichtImDump: GRUND_ORT_ARTIKEL_NICHT_IM_DUMP,
        nichtMehr: GRUND_ORT_ARTIKEL_KEINER,
        keineInfobox: GRUND_ORT_ARTIKEL_KEINER,
        ausgeschlossen: GRUND_ORT_ARTIKEL_BEKANNT,
    },
};

/**
 * Der Bereich `sprachen` (WI-0261 S3): ARTIKELZENTRIERT. Die Menge sind die aventurischen Sprachartikel des Dumps (`dump.sprachen`, Regel in `infobox/sprache.ts`), nicht die Adressen des Bestands.
 * Je Schlüssel (Titel in Vergleichsform):
 *
 * - **Neu** (der Bestand kennt den Schlüssel nicht): die Zeile `artikel` (anlegen) und je Feld mit Wert eine Zeile, alle an der Platzhalter-Kennung des Artikels (`neuerArtikelId`).
 * - **Im Bestand:** je Feld wie in jedem Bereich (`entscheideFeld`, das Objekt führt jedes Feld selbst mit dem Vermerk `wiki`); ist die Zeile still gelegt, belebt sie die Zeile `artikel`.
 * - **Aus dem Bestand verschwunden** (nicht mehr im Dump, Weiterleitung, keine Infobox Sprache, nicht mehr aventurisch): nur die Zeile `artikel` (still legen), nie ein Feld.
 * - Zwei Seiten mit demselben Schlüssel (`mehrdeutig`) und eine kaputte Infobox sind Befunde; ein solcher Artikel wird weder angelegt noch still gelegt.
 *
 * 🔴 Abweichung von den übrigen Bereichen: Der WikiSync legt hier Objekte an und still (O1: „synce alle wiki daten“); Fläche, Farbe und die Zuordnung zu einer Sprache (`sprache_wiki`)
 * berührt er nie (O6). Ohne die Sprachartikel des Dumps (der Vergleich EINES Artikels) rechnet der Bereich nichts: Er wüsste nicht, was neu ist und was verschwand.
 */
function planeArtikelBereich(
    objekte: readonly PlanObjekt[],
    eingabe: PlanEingabe,
    zahlen: WikisyncBereichZahlen,
    art: ArtikelBereich,
): PlanZeile[] {
    const aktive = objekte.filter((objekt) => art.info(objekt)?.aktiv === true);
    zahlen.objekte = aktive.length;
    zahlen.mitAdresse = aktive.length;
    const seiten = art.seiten(eingabe);
    if (seiten === undefined) return [];
    const bereichBeiLegacy = eingabe.legacyBereiche?.has(art.bereich) === true;
    const eigentuemer: WikisyncEigentuemer = bereichBeiLegacy ? "legacy" : "wiki";
    const wirkung: WikisyncWirkung = bereichBeiLegacy ? "befund" : "uebernommen";
    const zeilen: PlanZeile[] = [];
    let angelegt = 0;
    let stillgelegt = 0;

    const bestand = new Map<string, PlanObjekt>();
    for (const objekt of objekte) {
        const info = art.info(objekt);
        if (info !== undefined) bestand.set(info.schluessel, objekt);
    }
    // Alle Sprachartikel des Dumps je Schlüssel, aventurisch oder nicht (für den Grund des Stilllegens).
    const jeSchluessel = new Map<string, GelesenerDumpArtikel[]>();
    for (const seite of seiten) {
        const schluessel = art.schluessel(seite.titel);
        jeSchluessel.set(schluessel, [...(jeSchluessel.get(schluessel) ?? []), seite]);
    }
    // Die Schlüssel, deren Artikel aventurisch im Dump steht (auch als Befund): Sie werden nie still gelegt.
    const imDump = new Set<string>();
    const befundOhneObjekt = (
        seite: GelesenerDumpArtikel,
        befund: WikisyncBefund,
        status: WikisyncStatus,
        grund: string,
    ): PlanZeile => ({
        bereich: art.bereich,
        objektArt: "article",
        objektId: null,
        objektName: seite.titel,
        objekte: 1,
        objektIds: [],
        artikel: seite.titel,
        namensraum: seite.ns,
        feld: null,
        alt: null,
        altZustand: "kein",
        neu: null,
        neuZustand: "kein",
        eigentuemer,
        wirkung: "befund",
        status,
        befund,
        grund,
    });

    for (const [schluessel, liste] of [...jeSchluessel].sort(([a], [b]) => vergleicheText(a, b))) {
        // Hängt der Artikel schon an einem Objekt der Karte (nur die Landmarken kennen das), ist er kein Artikel des Bereichs: Ein vorhandener wird unten still gelegt.
        if (art.ausgeschlossen?.(schluessel, eingabe) === true) continue;
        const aventurische = liste.filter((seite) => art.gehoert(seite, eingabe));
        if (aventurische.length === 0) continue;
        imDump.add(schluessel);
        const objekt = bestand.get(schluessel);
        const erste = aventurische[0] as GelesenerDumpArtikel;
        if (aventurische.length > 1) {
            zahlen.mehrdeutig += 1;
            const grund = `${String(aventurische.length)} Seiten`;
            zeilen.push(
                objekt === undefined
                    ? befundOhneObjekt(erste, "mehrdeutig", "mehrdeutig", grund)
                    : artikelBefund(objekt, 1, erste.titel, erste.ns, "mehrdeutig", "mehrdeutig", grund, eigentuemer),
            );
            continue;
        }
        const gelesen = art.lese(analysiere(erste.titel, erste.text), eingabe, erste);
        if (!gelesen.ok) {
            zeilen.push(
                objekt === undefined
                    ? befundOhneObjekt(erste, "infobox_kaputt", "fehlerhaft", gelesen.grund)
                    : artikelBefund(
                          objekt,
                          1,
                          erste.titel,
                          erste.ns,
                          "infobox_kaputt",
                          "fehlerhaft",
                          gelesen.grund,
                          eigentuemer,
                      ),
            );
            continue;
        }
        const wiki = (feld: string): string | undefined => (feld === ARTIKEL_FELD ? erste.titel : gelesen.felder[feld]);

        if (objekt === undefined) {
            // Neu: angelegt wird mit allen Feldern, die das Wiki nennt; die Kennung entsteht erst beim Anlegen.
            angelegt += 1;
            const id = art.neueId(schluessel);
            for (const feld of art.planfelder) {
                const wert = wiki(feld);
                if (wert === undefined) continue;
                zahlen.felderGelesen += 1;
                zeilen.push({
                    bereich: art.bereich,
                    objektArt: art.objektArt,
                    objektId: id,
                    objektName: erste.titel,
                    objekte: 1,
                    objektIds: [id],
                    artikel: erste.titel,
                    namensraum: erste.ns,
                    feld,
                    alt: null,
                    altZustand: "kein",
                    neu: wert,
                    neuZustand: "text",
                    eigentuemer,
                    wirkung,
                    status: "neu",
                    befund: null,
                    grund: feld === ARTIKEL_FELD ? art.gruende.neu : null,
                });
            }
            continue;
        }

        if (art.info(objekt)?.aktiv === true) zahlen.gefunden += 1;
        for (const feld of art.planfelder) {
            zahlen.felderGelesen += 1;
            const lokal = objekt.lokal.get(feld) ?? { zustand: "kein" as const, wert: null, vermerk: "kein" as const };
            const entscheidung = entscheideFeld(objekt, feld, wiki(feld), lokal, bereichBeiLegacy);
            if (entscheidung === null) {
                zahlen.unveraendert += 1;
                continue;
            }
            const belebt = feld === ARTIKEL_FELD && entscheidung.alt === null;
            if (belebt) angelegt += 1;
            zeilen.push({
                bereich: art.bereich,
                objektArt: art.objektArt,
                objektId: objekt.id,
                objektName: objekt.name,
                objekte: 1,
                objektIds: [objekt.id],
                artikel: erste.titel,
                namensraum: erste.ns,
                feld,
                ...entscheidung,
                grund: belebt ? art.gruende.wieder : entscheidung.grund,
            });
        }
    }

    // Der Bestand, dessen Artikel nicht mehr aventurisch im Dump steht: still legen (nur die Zeile `artikel`, nie ein Feld).
    for (const objekt of objekte) {
        const info = art.info(objekt);
        if (info === undefined || !info.aktiv || imDump.has(info.schluessel)) continue;
        zahlen.nichtImDump += 1;
        const lokal = objekt.lokal.get(ARTIKEL_FELD) ?? null;
        const entscheidung = entscheideFeld(objekt, ARTIKEL_FELD, undefined, lokal, bereichBeiLegacy);
        if (entscheidung === null) continue;
        stillgelegt += 1;
        const aufloesung = loeseAuf(objekt.adresse, eingabe.dump.gefunden);
        const grund =
            art.ausgeschlossen?.(info.schluessel, eingabe) === true
                ? (art.gruende.ausgeschlossen ?? art.gruende.nichtMehr)
                : aufloesung.art === "umgeleitet"
                  ? grundWeiterleitung(aufloesung.seite.weiterleitung)
                  : jeSchluessel.has(info.schluessel)
                    ? art.gruende.nichtMehr
                    : aufloesung.art === "gefunden"
                      ? art.gruende.keineInfobox
                      : art.gruende.nichtImDump;
        zeilen.push({
            bereich: art.bereich,
            objektArt: art.objektArt,
            objektId: objekt.id,
            objektName: objekt.name,
            objekte: 1,
            objektIds: [objekt.id],
            artikel: objekt.name,
            namensraum: aufloesung.art === "gefunden" || aufloesung.art === "umgeleitet" ? aufloesung.seite.ns : null,
            feld: ARTIKEL_FELD,
            ...entscheidung,
            status: "zu_entfernen",
            grund,
        });
    }
    zahlen.angelegt = angelegt;
    zahlen.stillgelegt = stillgelegt;
    return zeilen;
}

const SORT_BEFUND = [
    "zuordnung_gesperrt",
    "artikel_nicht_im_dump",
    "mehrdeutig",
    "umleitung",
    "namensraum_unbekannt",
    "infobox_kaputt",
];

function sortiere(zeilen: PlanZeile[], felder: readonly string[]): PlanZeile[] {
    // Die Stellen der Ortsliste stehen hinter den Feldern des Werks, in ihrer Reihenfolge.
    const feldIndex = (feld: string | null): number => {
        if (feld === null) return -1;
        if (istVerwendungsFeld(feld) || istKatalogFeld(feld) || feld === "ohne_produktseite" || istOrtszeilenFeld(feld))
            return 1000;
        const stelle = ortsStelle(feld);
        return stelle === null ? felder.indexOf(feld) : 1000 + stelle;
    };
    const befundIndex = (befund: WikisyncBefund | null): number => (befund === null ? 99 : SORT_BEFUND.indexOf(befund));
    return zeilen
        .map((zeile, index) => ({ zeile, index }))
        .sort((a, b) => {
            const x = a.zeile;
            const y = b.zeile;
            return (
                vergleicheText(x.objektName ?? "", y.objektName ?? "") ||
                vergleicheText(x.objektId ?? "", y.objektId ?? "") ||
                befundIndex(x.befund) - befundIndex(y.befund) ||
                feldIndex(x.feld) - feldIndex(y.feld) ||
                a.index - b.index
            );
        })
        .map((eintrag) => eintrag.zeile);
}

/**
 * Die neuen Artikel: Seiten in Einsammel-Räumen mit einer Infobox der Karte, die weder die Karte noch die Registry kennt. `ausser`: die Titel (`bekannterTitelSchluessel`), die der Bereich schon als eigene
 * Zeile führt (die Orts-Artikel, WI-0295); gezählt wird nur, was keine Zeile wird.
 */
function planeNeueArtikel(
    bereich: WikisyncBereich,
    eingabe: PlanEingabe,
    zahlen: WikisyncBereichZahlen,
    ausser: ReadonlySet<string> = new Set(),
): PlanZeile[] {
    const zeilen: PlanZeile[] = [];
    // Welche Infobox-Art gehört zu welchem Bereich? Orte, Gebiete und Werke werden Befund-Zeilen, die übrigen Arten nur eine Zahl.
    const artDesBereichs: Readonly<Record<WikisyncBereich, readonly string[]>> = {
        ort: ["ort", "bauwerk"],
        gebiet: ["gebiet"],
        weg: ["weg"],
        region: ["region"],
        gipfel: [],
        kraftlinie: ["kraftlinie"],
        // Ein Produkt-Artikel, den Legacy als Werk in den Katalog genommen hätte (Spielliteratur mit Ortsliste): „Artikel ohne Werk“, angelegt wird nichts.
        literatur: ["literatur"],
        quelle: [],
        // Ein Artikel mit einer der vier Infoboxen (`Gegenstandsgruppe`, `Tierart`, `Pflanzenart`, `Spezies`), den kein Eintrag kennt: angelegt wird nichts, der Artikel ist ein Befund.
        vorkommen: ["vorkommen"],
        // Die Sprachen legen einen neuen Artikel selbst an (`planeArtikelBereich`): Hierher kommen sie nie.
        sprachen: [],
    };
    const mitZeile = bereich === "ort" || bereich === "gebiet" || bereich === "literatur" || bereich === "vorkommen";
    const neue = eingabe.dump.kandidaten
        .filter((kandidat) => artDesBereichs[bereich].includes(kandidat.art))
        .filter((kandidat) => !eingabe.bekannteTitel.has(bekannterTitelSchluessel(kandidat.titel)))
        .filter((kandidat) => !ausser.has(bekannterTitelSchluessel(kandidat.titel)))
        .sort((a, b) => vergleicheText(a.titel, b.titel) || a.ns - b.ns);
    if (!mitZeile) {
        zahlen.neueArtikelNurZahl = neue.length;
        return zeilen;
    }
    zahlen.neueArtikel = neue.length;
    for (const kandidat of neue.slice(0, MAX_NEUE_ARTIKEL_ZEILEN)) {
        zeilen.push({
            bereich,
            objektArt: "article",
            objektId: null,
            objektName: kandidat.titel,
            objekte: 1,
            objektIds: [],
            artikel: kandidat.titel,
            namensraum: kandidat.ns,
            feld: null,
            alt: null,
            altZustand: "kein",
            neu: null,
            neuZustand: "kein",
            // Ein Artikel ohne Kartenobjekt hat keinen Eigentümer; angelegt wird nichts, die Kennung entsteht erst beim Neuanlegen im Editor.
            eigentuemer: "unbekannt",
            wirkung: "befund",
            status: "neu",
            befund: "neuer_artikel",
            grund: `Infobox ${kandidat.infobox}`,
        });
    }
    return zeilen;
}

/**
 * Ein Bereich mit Objekten auf der Karte und Artikeln ohne Objekt: `gipfel` (die Landmarken, WI-0271), `region` (die Flächen, WI-0284) und `ort` (die Orts- und Bauwerk-Artikel, WI-0295). Die Objekte auf der Karte rechnen wie jede Zuordnung, die Artikel ohne Objekt
 * artikelzentriert. Ein Bereich, ein Lauf, eine Zeile in der Verwaltung; die Zeilen unterscheidet ihre `objektArt`, und die Zahlen sind die Summe aus beiden.
 */
function planeMitArtikeln(
    objekte: readonly PlanObjekt[],
    eingabe: PlanEingabe,
    zahlen: WikisyncBereichZahlen,
    art: ArtikelBereich,
): PlanZeile[] {
    const kandidaten = leereZahlen();
    const zeilen = [
        ...sortiere(
            planeBereich(
                art.bereich,
                objekte.filter((objekt) => art.info(objekt) === undefined),
                eingabe,
                zahlen,
            ),
            BEREICH_FELDER[art.bereich],
        ),
        ...sortiere(
            planeArtikelBereich(
                objekte.filter((objekt) => art.info(objekt) !== undefined),
                eingabe,
                kandidaten,
                art,
            ),
            art.planfelder,
        ),
    ];
    // Alles außer `rollen` (das nur die Vorkommen führen) ist eine Zahl.
    const summe = zahlen as unknown as Record<string, number | undefined>;
    for (const [feld, wert] of Object.entries(kandidaten)) {
        if (typeof wert === "number") summe[feld] = (summe[feld] ?? 0) + wert;
    }
    return zeilen;
}

export function berechnePlan(eingabe: PlanEingabe): Plan {
    const zeilen: PlanZeile[] = [];
    const zahlen: Partial<Record<WikisyncBereich, WikisyncBereichZahlen>> = {};
    const zitate: PlanZitat[] = [];
    const regeln = eingabe.regeln === undefined ? undefined : new RegelSammler();
    for (const bereich of WIKISYNC_BEREICHE) {
        if (!eingabe.bereiche.includes(bereich)) continue;
        const zaehler = leereZahlen();
        const objekte = eingabe.objekte
            .filter((objekt) => objekt.bereich === bereich)
            .sort((a, b) => vergleicheText(a.id, b.id));
        const bereichZeilen =
            bereich === "gipfel"
                ? planeMitArtikeln(objekte, eingabe, zaehler, LANDMARKEN_ARTIKEL)
                : bereich === "region"
                  ? planeMitArtikeln(objekte, eingabe, zaehler, REGION_ARTIKEL)
                  : bereich === "ort"
                    ? planeMitArtikeln(objekte, eingabe, zaehler, ORT_ARTIKEL)
                    : sortiere(
                          bereich === "quelle"
                              ? planeQuellenBereich(objekte, eingabe, zaehler, zitate)
                              : bereich === "sprachen"
                                ? planeArtikelBereich(objekte, eingabe, zaehler, SPRACHEN_ARTIKEL)
                                : planeBereich(
                                      bereich,
                                      objekte,
                                      eingabe,
                                      zaehler,
                                      bereich === "vorkommen" ? regeln : undefined,
                                  ),
                          BEREICH_FELDER[bereich],
                      );
        // Die Quellen kennen keine neuen Artikel: Was das Wiki neu nennt, sind neu zitierte Publikationen (Zeilen der Quelle). Die Sprachen legen ihre neuen Artikel an (Zeilen des Bereichs).
        // Die Orts-Artikel (WI-0295), die eine Zeile des Bereichs sind, auch als Befund, zählen nicht noch einmal als neuer Artikel.
        const eigene = new Set(
            bereichZeilen
                .filter(
                    (zeile) =>
                        zeile.objektArt === ORT_ARTIKEL_ART || (bereich === "ort" && zeile.objektArt === "article"),
                )
                .flatMap((zeile) => (zeile.artikel === null ? [] : [bekannterTitelSchluessel(zeile.artikel)])),
        );
        const neue =
            bereich === "quelle" || bereich === "sprachen" ? [] : planeNeueArtikel(bereich, eingabe, zaehler, eigene);
        // Die neuen Artikel haben ihre eigene Zahl (`neueArtikel`) und zählen nicht zu den Befunden der Zuordnungen und Felder.
        for (const zeile of bereichZeilen) {
            if (zeile.wirkung === "uebernommen") zaehler.uebernommen += 1;
            else if (zeile.wirkung === "eigen") zaehler.eigen += 1;
            else zaehler.befunde += 1;
        }
        zeilen.push(...bereichZeilen, ...neue);
        zahlen[bereich] = zaehler;
    }
    return { zeilen, zahlen, zitate, ...(regeln === undefined ? {} : { regeln }) };
}
