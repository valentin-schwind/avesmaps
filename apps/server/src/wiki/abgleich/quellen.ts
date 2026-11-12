import { createHash } from "node:crypto";
import type { InhalteTraegerArt, WikisyncEigentuemer, WikisyncStatus, WikisyncWirkung } from "@avesmaps3d/shared";
import type { Zitat } from "../infobox/publikationen.ts";
import { kuerze, phpTrim } from "../infobox/text.ts";
import { publikationsSchluessel } from "../schluessel.ts";

/**
 * Die Publikationen eines Artikels gegen die Verknüpfungen seines Trägers (WI-0253, Scheibe Quellen). REIN: keine Datenbank. Dieselben Funktionen rechnen die Vorschau
 * (`plan.ts`) und, unter der Sperre, die Übernahme (`uebernahme/verwendungen.ts`).
 *
 * Vorbild ist Legacys Publikationsabgleich (Mirror a7f2dac86, `api/_internal/wiki/publication-sync.php`):
 *
 * - **Die Identität der Publikation:** Linktitel → `avesmapsPublicationResolvePublicationKey` (Legacys Slug des Titels, über die Weiterleitungen des Dumps auf den Slug
 *   des Ziels) → nur eine Produktseite des Katalogs zählt → Schlüssel der Quelle: `url:<sha256>` der Shop-Adresse, sonst `wikipub:<Slug>`
 *   (`avesmapsPublicationSourceIdForPlan`). Nie der Titel der Quelle (er ist keine Identität).
 * - **Je Publikation EINE Zeile** des Artikels. Legacy nahm die erste (`$seen`); hier gilt die stärkste Nennung (ausführlich vor ergänzend vor erwähnt, bei gleicher Stärke die
 *   erste), und Art, Seiten und Notiz stammen aus ihr: die Abweichung, die Legacys eigenes Design wollte (WI-0253 §16). Null und leer sind dasselbe
 *   (`avesmapsPublicationReferenceFieldsDiffer`).
 * - **Wem eine Verknüpfung gehört** (`avesmapsPublicationDiffLinks`): nur `wiki_publication` folgt dem Wiki; jede andere Herkunft gewinnt und ist für den Abgleich
 *   unsichtbar; ein Tombstone (`suppressed`) lebt nie wieder auf.
 *
 * Abweichungen, mit Grund: Eine Verknüpfung OHNE belegte Herkunft (`legacy_origin` leer: Legacys Export E1+ fehlt, so stehen alle auf der Stage) ist unbelegt; weicht
 * sie ab, ist das ein Befund (wie bei Feldern und Ortslisten). Eine Verknüpfung der Redaktion (`source_system = 'editor'`) und eine direkte Quelle (`reference_kind`
 * leer) gehören der Redaktion.
 *
 * 🔴 **Anlegen und stilllegen** (Vali 2026-10-27, Knopfwahl „Anlegen und stilllegen“, WI-0253 §16/§21; vorher, §19, wurde nur verglichen):
 * - **Neu zitiert** (das Wiki nennt eine Publikation, der Träger hat keine Verknüpfung dazu): die Verknüpfung wird angelegt, fehlt die Katalogquelle (9 Fälle), mit ihr. Eine
 *   Verknüpfung, die die Redaktion gelöst hat (`retired_origin = 'editor'`), ein Tombstone (`suppressed`), eine, die der Legacy-Zug entfernte, und eine Quelle, die jemand anderes
 *   still gelegt hat, bleiben Befund: nichts lebt wieder auf. Nur was der WikiSync selbst still gelegt hat (`retired_origin = 'wikisync'`), lebt mit der nächsten Nennung wieder auf.
 * - **Nicht mehr zitiert**: nur eine Verknüpfung mit belegter Wiki-Herkunft (`legacy_origin = 'wiki_publication'`) wird still gelegt, nie gelöscht. Unbelegte bleiben Befund.
 */

/** Eine Produktseite des Dumps: ihr Seitentitel und Raum, der Titel, unter dem Legacy die Quelle führt, und ihre Shop-Adresse (`null`: URL-los). */
export interface Produkt {
    seite: string;
    ns: number;
    titel: string;
    adresse: string | null;
    /** Die Art der Quelle, mit der Legacy sie anlegt (acht Arten, `quellenartAusArt`); fehlt sie, gilt `sonstiges`. */
    quellenart?: string;
}

/** Was der Dump über die Publikationen weiß: Produktseiten und Weiterleitungen, je mit Legacys Schlüssel. */
export interface PublikationsKatalog {
    /** Schlüssel der Produktseite (Slug ihres Titels) → die Seite. Bei zwei Seiten mit demselben Schlüssel gilt die letzte (Legacys Upsert). */
    produkte: ReadonlyMap<string, Produkt>;
    /** Slug einer Weiterleitung → Slug ihres Ziels (Legacys `wiki_redirect_alias`, die letzte gewinnt). */
    weiterleitungen: ReadonlyMap<string, string>;
}

/** Eine Quelle des Katalogs der Karte (`feature_source`), gefunden über ihren Schlüssel. */
export interface BestehendeQuelle {
    /** `feature_source.public_id`. */
    id: string;
    titel: string;
    /** Eine stillgelegte Quelle (`is_active` falsch) bekommt nur dann eine neue Verknüpfung, wenn der WikiSync sie still legte. */
    aktiv: boolean;
    /** Der WikiSync hat die Quelle still gelegt (`retired_origin = 'wikisync'`, die Rücknahme einer angelegten Quelle): Sie lebt mit der nächsten Nennung wieder auf. */
    vonWikisyncStill?: boolean;
}

/** Wem eine Verknüpfung gehört. */
export type QuellenHerkunft = "wiki" | "manual" | "unbekannt";

/** Eine Verknüpfung eines Trägers mit einer Quelle (`<träger>_source`). */
export interface QuellenVerknuepfung {
    traegerArt: InhalteTraegerArt;
    /** `<träger>.public_id`, klein. */
    traegerId: string;
    traegerName: string;
    /** Die Wiki-Adresse des Trägers heute; `null`, wenn er keine hat (die Übernahme prüft, ob der Artikel der Vorschau noch der seine ist). */
    traegerAdresse: string | null;
    /** `feature_source.source_key`. */
    quelle: string;
    /** `feature_source.public_id`. */
    quelleId: string;
    titel: string;
    art: string | null;
    seiten: string | null;
    notiz: string | null;
    zustand: "active" | "retired" | "suppressed";
    /** Die Redaktion hat die Verknüpfung gelöst (`retired_origin = 'editor'`): wie ein Tombstone, der Abgleich belebt sie nicht. */
    vonRedaktionGeloest: boolean;
    /** Der WikiSync hat die Verknüpfung still gelegt (`retired_origin = 'wikisync'`): Nennt das Wiki sie wieder, lebt sie wieder auf. */
    vonWikisyncGeloest?: boolean;
    /** Der Legacy-Zug hat die Verknüpfung entfernt (`retired_origin = 'import'`): Der Abgleich belebt sie nicht. */
    vonImportGeloest?: boolean;
    herkunft: QuellenHerkunft;
}

/** Was ein Objekt der Quellen-Vorschau zusätzlich trägt: ein Träger seine Verknüpfungen, eine Quelle ihre Verwendungen. */
export type QuellenSicht =
    | { art: "traeger"; traegerArt: InhalteTraegerArt; verknuepfungen: readonly QuellenVerknuepfung[] }
    /**
     * Ein Eintrag der Vorkommen (`lore_entry`, WI-0254 §12): Er trägt nur die Zitate seines Wiki-Artikels (`zitierteNennungen`), keine Verknüpfungen für den Vergleich. Seine Verknüpfungen
     * (`lore_entry_source`) gehören Legacy-Zug und Redaktion; der Lauf legt dort nichts an, legt nichts still und ändert nichts.
     */
    | { art: "vorkommen" }
    | {
          art: "quelle";
          /** `feature_source.source_key`. */
          schluessel: string;
          aktiv: boolean;
          /** Der WikiSync hat die Quelle still gelegt (`retired_origin = 'wikisync'`). */
          vonWikisyncStill?: boolean;
          /** Die Redaktion hat die Stammdaten der Quelle angelegt oder geändert (`source_system = 'editor'`): Der Titel gehört ihr. */
          redaktion: boolean;
          /** Alle Verknüpfungen der Quelle, aller Zustände. */
          verwendungen: readonly QuellenVerknuepfung[];
      };

export interface QuellenWert {
    art: string | null;
    seiten: string | null;
    notiz: string | null;
}

/** Was eine Katalogquelle braucht, die das Wiki nennt und die Karte nicht hat: Schlüssel, Titel, Art, „offiziell“ und, wo es eine gibt, die Shop-Adresse. */
export interface KatalogAngaben {
    /** `feature_source.source_key`: `url:<sha256>` der Shop-Adresse, sonst `wikipub:<Slug>`. */
    schluessel: string;
    titel: string;
    quellenart: string;
    offiziell: boolean;
    adresse: string | null;
}

/** Was die Vorschau über eine Publikation eines Trägers sagt (eine Zeile des Berichts, Feld `verwendung_<Art>_<Träger>`). */
export interface QuellenEntscheidung {
    /** Die Quelle des Katalogs (`feature_source.public_id`); `null`, wenn sie dort fehlt. */
    quelleId: string | null;
    /** Ihr Titel (der Quelle, sonst der Produktseite). */
    titel: string;
    /** Das Feld der Zeile: der Träger. */
    feld: string;
    alt: QuellenWert | null;
    neu: QuellenWert | null;
    eigentuemer: WikisyncEigentuemer;
    wirkung: WikisyncWirkung;
    status: WikisyncStatus;
    grund: string | null;
    /** Die Katalogquelle fehlt und wird mit der Verknüpfung angelegt: ihre Angaben (`quelleId` ist dann `null`). */
    katalog?: KatalogAngaben;
}

export interface QuellenZahlen {
    /** Publikationen, die der Artikel nennt und die eine Produktseite des Katalogs sind (jede einmal). */
    gelesen: number;
    gleich: number;
    neuZitiert: number;
    nichtMehrZitiert: number;
    /** Davon Verknüpfungen, die der WikiSync anlegen würde, und solche, die er still legen würde. */
    angelegt: number;
    stillgelegt: number;
    /** Linkziele, die keine Produktseite sind (Legacy legt daraus still nichts an). */
    ohneProduktseite: number;
}

/**
 * Die stärkste Nennung einer Quelle im Artikel EINES Trägers, so wie der Vergleich sie liest (Seiten auf 120, Notiz auf 200 Zeichen gekürzt): Das legt der Lauf je Quelle und Träger ab
 * (`wikisync_quelle_zitat`, Migration 0251), damit die Klappbox der Editoren „Im Wiki: …“ zeigen und mit der Verknüpfung vergleichen kann.
 */
export interface QuellenNennung {
    /**
     * `feature_source.source_key`: der Schlüssel der Quelle, die die Karte schon hat (auch ihre alte Kennung `wikipub:<Slug>`, wenn die Produktseite inzwischen eine Shop-Adresse hat), sonst der, unter dem
     * der Lauf sie anlegen würde.
     */
    quelle: string;
    art: string;
    seiten: string | null;
    notiz: string | null;
}

export interface QuellenErgebnis {
    entscheidungen: QuellenEntscheidung[];
    zahlen: QuellenZahlen;
    /** Je genannter Quelle die stärkste Nennung im Artikel (in der Reihenfolge, in der der Artikel die Quelle zuerst nennt), auch wo nichts abweicht. */
    nennungen: QuellenNennung[];
    /** Die Quellen, die der Artikel nennt (Schlüssel der Quelle), mit ihrer Produktseite: für den Vergleich der Titel. */
    zitiert: Map<string, Produkt>;
    /** Die Linkziele ohne Produktseite, in der Reihenfolge des Artikels, jedes einmal. */
    ohneProduktseite: string[];
}

export const GRUND_NEU_ZITIERT = "Neu zitiert; die Verknüpfung wird angelegt";
export const GRUND_NICHT_IM_KATALOG =
    "Neu zitiert, die Quelle fehlt im Katalog; sie und die Verknüpfung werden angelegt";
export const GRUND_QUELLE_WIEDER =
    "Neu zitiert; die Quelle hat der WikiSync still gelegt, sie lebt mit der Verknüpfung wieder auf";
export const GRUND_VERKNUEPFUNG_WIEDER =
    "Neu zitiert; die Verknüpfung hat der WikiSync still gelegt, sie lebt wieder auf";
/** Solange der Bereich dem Legacy-Zug gehört (nur Vorschau), wird nichts angelegt oder still gelegt. */
export const GRUND_NEU_VORSCHAU = "Neu zitiert; angelegt wird nichts, solange der Legacy-Zug den Bereich liefert";
export const GRUND_QUELLE_STILL = "Neu zitiert, die Quelle ist im Katalog stillgelegt; angelegt wird nichts";
export const GRUND_NEUE_ADRESSE =
    "Neu zitiert, die Produktseite hat eine Shop-Adresse; die Quelle im Katalog trägt die alte Kennung";
export const GRUND_NICHT_MEHR = "Nicht mehr zitiert; die Verknüpfung wird still gelegt";
export const GRUND_NICHT_MEHR_UNBELEGT =
    "Nicht mehr zitiert; ohne belegte Herkunft (Wiki-Publikation) bleibt die Verknüpfung";
export const GRUND_NICHT_MEHR_VORSCHAU =
    "Nicht mehr zitiert; still gelegt wird nichts, solange der Legacy-Zug den Bereich liefert";
export const GRUND_TOMBSTONE = "Die Redaktion hat diese Verknüpfung entfernt";
export const GRUND_GELOEST = "Die Redaktion hat diese Verknüpfung gelöst";
export const GRUND_IMPORT_GELOEST = "Der Legacy-Zug hat diese Verknüpfung entfernt; sie lebt nicht wieder auf";
export const GRUND_TITEL_MEHRDEUTIG =
    "Mehrere Produktseiten teilen die Shop-Adresse dieser Quelle; ihr Titel ist nicht eindeutig";
export const GRUND_KEINE_PRODUKTSEITE = "Das Linkziel ist keine Produktseite; Legacy legt daraus nichts an";

/** Der Schlüssel einer Quelle aus ihrer Shop-Adresse (`url:<sha256>`, Migration 0066: wie geliefert, ohne Normalisierung). */
export const adressSchluessel = (adresse: string): string =>
    `url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`;

/** Legacy `avesmapsPublicationResolvePublicationKey`: Slug des Titels, über eine Weiterleitung auf den Slug des Ziels. */
export function publikationsSchluesselAufgeloest(titel: string, katalog: PublikationsKatalog): string {
    const slug = publikationsSchluessel(titel);
    return slug === "" ? "" : (katalog.weiterleitungen.get(slug) ?? slug);
}

export interface QuellenZiel {
    /** Der Slug der Produktseite. */
    schluessel: string;
    /** Der Schlüssel der Quelle: `url:<sha256>` der Shop-Adresse, sonst `wikipub:<Slug>`. */
    quelle: string;
    produkt: Produkt;
}

/** Die Quelle zu einem Linktitel; `null`, wenn das Ziel keine Produktseite des Katalogs ist. */
export function quellenZiel(titel: string, katalog: PublikationsKatalog): QuellenZiel | null {
    const schluessel = publikationsSchluesselAufgeloest(titel, katalog);
    const produkt = schluessel === "" ? undefined : katalog.produkte.get(schluessel);
    if (produkt === undefined) return null;
    return {
        schluessel,
        quelle: produkt.adresse === null ? `wikipub:${schluessel}` : adressSchluessel(produkt.adresse),
        produkt,
    };
}

/**
 * Die Produktseiten des Dumps nach dem Schlüssel der Quelle, die aus ihnen folgt. Zwei Seiten können sich eine Shop-Adresse teilen (ein Heft und das Abenteuer darin): Dann gehört ihrer Quelle
 * EIN Titel nicht eindeutig, und Legacy schrieb den der zuletzt gelesenen Seite. Die Quellen verhalten sich bei solchen Schlüsseln nur lesend (Befund, kein Titel).
 */
export function produkteNachQuelle(katalog: PublikationsKatalog): Map<string, Produkt[]> {
    const gruppen = new Map<string, Produkt[]>();
    for (const [schluessel, produkt] of katalog.produkte) {
        const quelle = produkt.adresse === null ? `wikipub:${schluessel}` : adressSchluessel(produkt.adresse);
        gruppen.set(quelle, [...(gruppen.get(quelle) ?? []), produkt]);
    }
    return gruppen;
}

const normal = (wert: string | null): string | null => (wert === null || phpTrim(wert) === "" ? null : wert);
export const gleicheWerte = (a: QuellenWert, b: QuellenWert): boolean =>
    normal(a.art) === normal(b.art) && normal(a.seiten) === normal(b.seiten) && normal(a.notiz) === normal(b.notiz);

/** Der Wert einer Verknüpfung im Bericht: `Art | Seiten | Notiz` (leer, wo nichts steht); `leseQuellenWert` zerlegt ihn wieder. */
export const quellenWert = (wert: QuellenWert): string =>
    `${wert.art ?? ""} | ${wert.seiten ?? ""} | ${wert.notiz ?? ""}`;

export function leseQuellenWert(text: string | null): QuellenWert | null {
    if (text === null) return null;
    const erste = text.indexOf(" | ");
    const zweite = erste < 0 ? -1 : text.indexOf(" | ", erste + 3);
    if (zweite < 0) return null;
    const teil = (wert: string): string | null => (wert === "" ? null : wert);
    return {
        art: teil(text.slice(0, erste)),
        seiten: teil(text.slice(erste + 3, zweite)),
        notiz: teil(text.slice(zweite + 3)),
    };
}

/**
 * Das Feld der Zeile, die eine fehlende Katalogquelle anlegt (eine je Quelle): Ihr Wert nennt Schlüssel, Art, „offiziell“ und Adresse (`katalogWert`), ihr Objektname den Titel.
 * Die Verwendungen dieser Quelle tragen dieselbe Platzhalter-Kennung (`platzhalterId`) als Objekt, an ihr findet die Übernahme die Quelle wieder.
 */
export const KATALOG_FELD = "katalog_neu";
export const istKatalogFeld = (feld: string | null): boolean => feld === KATALOG_FELD;

/** Der Wert der Zeile `katalog_neu`: `Schlüssel | Art | ja/nein | Adresse` (die Adresse zuletzt, leer: keine). */
export const katalogWert = (angaben: KatalogAngaben): string =>
    `${angaben.schluessel} | ${angaben.quellenart} | ${angaben.offiziell ? "ja" : "nein"} | ${angaben.adresse ?? ""}`;

/** Zerlegt `katalogWert`; der Titel steht nicht darin, die Zeile trägt ihn als Objektname. */
export function leseKatalogWert(text: string | null, titel: string): KatalogAngaben | null {
    if (text === null) return null;
    const teile: string[] = [];
    let ab = 0;
    for (let i = 0; i < 3; i += 1) {
        const stelle = text.indexOf(" | ", ab);
        if (stelle < 0) return null;
        teile.push(text.slice(ab, stelle));
        ab = stelle + 3;
    }
    const [schluessel, quellenart, offiziell] = teile as [string, string, string];
    const adresse = text.slice(ab);
    if (schluessel === "" || quellenart === "" || (offiziell !== "ja" && offiziell !== "nein")) return null;
    return { schluessel, titel, quellenart, offiziell: offiziell === "ja", adresse: adresse === "" ? null : adresse };
}

/**
 * Die Kennung, unter der die Zeilen einer Quelle stehen, die es noch nicht gibt: deterministisch aus ihrem Schlüssel (kein Zufall: zwei Vorschauen derselben Lage rechnen dieselben Zeilen). Sie
 * ist keine Kennung einer Quelle des Katalogs; die Übernahme legt die Quelle an und schreibt ihre Verwendungen unter der neuen Kennung.
 */
export function platzhalterId(schluessel: string): string {
    const hash = createHash("sha256").update(`wikisync|quelle-neu|${schluessel}`, "utf8").digest("hex");
    const hex = hash.slice(0, 32).split("");
    hex[12] = "5";
    hex[16] = "8";
    const roh = hex.join("");
    return `${roh.slice(0, 8)}-${roh.slice(8, 12)}-${roh.slice(12, 16)}-${roh.slice(16, 20)}-${roh.slice(20, 32)}`;
}

/** Das Feld einer Verwendung im Bericht: `verwendung_<Art des Trägers>_<Kennung ohne Striche>` (höchstens 64 Zeichen, klein: die Tafel des Laufs verlangt es). */
export const verwendungsFeld = (art: InhalteTraegerArt, traegerId: string): string =>
    `verwendung_${art}_${traegerId.replaceAll("-", "").toLowerCase()}`;

const VERWENDUNG = /^verwendung_(place|territory|area|peak|path)_([0-9a-f]{32})$/u;

/** Der Träger hinter dem Feld einer Verwendung; `null` bei jedem anderen Feld. */
export function verwendungAusFeld(feld: string | null): { art: InhalteTraegerArt; id: string } | null {
    const treffer = feld === null ? null : VERWENDUNG.exec(feld);
    if (treffer === null) return null;
    const h = treffer[2] as string;
    return {
        art: treffer[1] as InhalteTraegerArt,
        id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
    };
}

export const istVerwendungsFeld = (feld: string | null): boolean => verwendungAusFeld(feld) !== null;

const STAERKE: Readonly<Record<string, number>> = { ausfuehrlich: 3, ergaenzend: 2, erwaehnung: 1 };

/** Wem der Wert einer bestehenden Verknüpfung gehört: Eine direkte Quelle (ohne Art) ist immer die der Redaktion. */
function eigentuemerVon(verknuepfung: QuellenVerknuepfung, bereichBeiLegacy: boolean): WikisyncEigentuemer {
    if (verknuepfung.art === null || verknuepfung.herkunft === "manual") return "manual";
    if (verknuepfung.herkunft === "unbekannt") return "unbekannt";
    return bereichBeiLegacy ? "legacy" : "wiki";
}

const wirkungVon = (eigentuemer: WikisyncEigentuemer): WikisyncWirkung =>
    eigentuemer === "wiki" ? "uebernommen" : eigentuemer === "manual" ? "eigen" : "befund";

/** Je Quelle die stärkste Nennung im Artikel: ihr Ziel (die Produktseite) und die Zeile, die gewinnt. */
type Staerkste = Map<string, { ziel: QuellenZiel; zitat: Zitat }>;

/**
 * Je Quelle die stärkste Nennung, in der Reihenfolge, in der der Artikel die Quelle zuerst nennt, dazu die Linkziele ohne Produktseite (jedes einmal, in der Reihenfolge des Artikels). EINE Rechnung
 * für den Vergleich (`planeQuellen`) und für die Zitate allein (`zitierteNennungen`).
 */
function staerksteNennungen(
    zitate: readonly Zitat[],
    katalog: PublikationsKatalog,
): { nennungen: Staerkste; ohneProduktseite: string[] } {
    const nennungen: Staerkste = new Map();
    const ohneProduktseite: string[] = [];
    const bekannteLinkziele = new Set<string>();
    for (const zitat of zitate) {
        const ziel = quellenZiel(zitat.titel, katalog);
        if (ziel === null) {
            if (!bekannteLinkziele.has(zitat.titel)) {
                bekannteLinkziele.add(zitat.titel);
                ohneProduktseite.push(zitat.titel);
            }
            continue;
        }
        const bisher = nennungen.get(ziel.quelle);
        if (bisher === undefined || (STAERKE[zitat.art] ?? 0) > (STAERKE[bisher.zitat.art] ?? 0)) {
            nennungen.set(ziel.quelle, { ziel, zitat });
        }
    }
    return { nennungen, ohneProduktseite };
}

/** Die Nennung, wie der Vergleich sie liest: Legacys Spalten sind schmal (`feature_sources.pages` VARCHAR(120), `note` VARCHAR(200)); längere Werte stehen dort gekürzt. */
const gekuerztWie = (zitat: Zitat): QuellenWert => ({
    art: zitat.art,
    seiten: zitat.seiten === null ? null : kuerze(zitat.seiten, 120),
    notiz: zitat.notiz === null ? null : kuerze(zitat.notiz, 200),
});

/**
 * Die Quelle der Karte zu einer Nennung: über den Schlüssel; hat die Produktseite inzwischen eine Shop-Adresse, trägt die Quelle noch die URL-lose Kennung. `gleiche` ist die unter dem Schlüssel
 * selbst, `quelle` die, die gilt.
 */
function findeBestehende(
    schluessel: string,
    ziel: QuellenZiel,
    bestehend: ReadonlyMap<string, BestehendeQuelle>,
): { gleiche: BestehendeQuelle | undefined; quelle: BestehendeQuelle | null } {
    const gleiche = bestehend.get(schluessel);
    return { gleiche, quelle: gleiche ?? bestehend.get(`wikipub:${ziel.schluessel}`) ?? null };
}

/** Die Nennung, wie der Lauf sie ablegt: unter dem Schlüssel der Quelle, die die Karte hat (die Klappbox verbindet über ihn), sonst unter dem, den die neue Quelle bekäme. */
function alsAblage(
    schluessel: string,
    ziel: QuellenZiel,
    zitat: Zitat,
    bestehend: ReadonlyMap<string, BestehendeQuelle>,
): QuellenNennung {
    const { gleiche, quelle } = findeBestehende(schluessel, ziel, bestehend);
    const neu = gekuerztWie(zitat);
    return {
        quelle: quelle !== null && gleiche === undefined ? `wikipub:${ziel.schluessel}` : schluessel,
        art: zitat.art,
        seiten: normal(neu.seiten),
        notiz: normal(neu.notiz),
    };
}

/**
 * NUR die Zitate eines Artikels, ohne Vergleich mit Verknüpfungen: je Quelle die stärkste Nennung, gekürzt und unter dem Schlüssel der Quelle, die die Karte hat (`QuellenNennung`). Für die
 * Vorkommen (WI-0254 §12): Ihre Verknüpfungen (`lore_entry_source`) gehören Legacy-Zug und Redaktion, der Lauf legt dort nichts an, still und ändert nichts. Er legt nur das Zitat ab, damit die
 * Klappbox den Kreis nach dem Wiki rechnen kann. Dieselbe Rechnung wie die Nennungen von `planeQuellen`.
 */
export function zitierteNennungen(
    zitate: readonly Zitat[],
    katalog: PublikationsKatalog,
    bestehend: ReadonlyMap<string, BestehendeQuelle>,
): QuellenNennung[] {
    const { nennungen } = staerksteNennungen(zitate, katalog);
    return [...nennungen].map(([schluessel, { ziel, zitat }]) => alsAblage(schluessel, ziel, zitat, bestehend));
}

/** Die Optionen von `planeQuellen`, die nicht aus den Verknüpfungen und dem Katalog folgen. */
export interface QuellenOptionen {
    /** Ist ein Produkt aus diesem Namensraum offiziell? (Legacy `avesmapsPublicationCatalogIsOfficial`; die Tafel der Namensräume entscheidet.) Ohne Angabe: ja. */
    offiziell?: (ns: number) => boolean;
}

/**
 * Die Publikationen eines Artikels gegen die Verknüpfungen EINES Trägers: je Publikation, zu der etwas zu sagen ist, eine Entscheidung (in der Reihenfolge des
 * Artikels, die nicht mehr zitierten danach), dazu die Zahlen. Übernommen würden Art, Seiten und Notiz an einer bestehenden Verknüpfung des Wikis, eine neue Verknüpfung (mit der
 * Katalogquelle, wo sie fehlt) und das Stilllegen einer Verknüpfung mit belegter Wiki-Herkunft, die der Artikel nicht mehr nennt.
 *
 * `bestehend` führt die Quellen des Katalogs nach ihrem Schlüssel (`feature_source.source_key`).
 */
export function planeQuellen(
    zitate: readonly Zitat[],
    traeger: { art: InhalteTraegerArt; id: string },
    verknuepfungen: readonly QuellenVerknuepfung[],
    katalog: PublikationsKatalog,
    bestehend: ReadonlyMap<string, BestehendeQuelle>,
    bereichBeiLegacy: boolean,
    optionen: QuellenOptionen = {},
): QuellenErgebnis {
    const zahlen: QuellenZahlen = {
        gelesen: 0,
        gleich: 0,
        neuZitiert: 0,
        nichtMehrZitiert: 0,
        angelegt: 0,
        stillgelegt: 0,
        ohneProduktseite: 0,
    };
    const entscheidungen: QuellenEntscheidung[] = [];
    const abgelegt: QuellenNennung[] = [];
    const zitiert = new Map<string, Produkt>();
    const feld = verwendungsFeld(traeger.art, traeger.id);
    const vomWiki: WikisyncEigentuemer = bereichBeiLegacy ? "legacy" : "wiki";
    const offiziell = optionen.offiziell ?? ((): boolean => true);

    // Je Quelle die stärkste Nennung, in der Reihenfolge, in der der Artikel die Quelle zuerst nennt.
    const { nennungen, ohneProduktseite } = staerksteNennungen(zitate, katalog);
    zahlen.ohneProduktseite = ohneProduktseite.length;

    for (const [schluessel, { ziel, zitat }] of nennungen) {
        zahlen.gelesen += 1;
        zitiert.set(schluessel, ziel.produkt);
        const neu = gekuerztWie(zitat);
        // Die Quelle im Katalog: über den Schlüssel; hat die Produktseite inzwischen eine Shop-Adresse, trägt die Quelle noch die URL-lose Kennung.
        const { gleiche, quelle } = findeBestehende(schluessel, ziel, bestehend);
        abgelegt.push(alsAblage(schluessel, ziel, zitat, bestehend));
        const dieser = verknuepfungen.filter((verknuepfung) => verknuepfung.quelle === schluessel);
        const aktiv = dieser.find((verknuepfung) => verknuepfung.zustand === "active");
        if (aktiv !== undefined) {
            if (gleicheWerte(aktiv, neu)) {
                zahlen.gleich += 1;
                continue;
            }
            const eigentuemer = eigentuemerVon(aktiv, bereichBeiLegacy);
            entscheidungen.push({
                quelleId: aktiv.quelleId,
                titel: aktiv.titel,
                feld,
                alt: { art: aktiv.art, seiten: aktiv.seiten, notiz: aktiv.notiz },
                neu,
                eigentuemer,
                wirkung: wirkungVon(eigentuemer),
                status: "geaendert",
                grund: null,
            });
            continue;
        }
        const befund = (
            eigentuemer: WikisyncEigentuemer,
            status: QuellenEntscheidung["status"],
            grund: string,
        ): QuellenEntscheidung => ({
            quelleId: quelle?.id ?? null,
            titel: quelle?.titel ?? ziel.produkt.titel,
            feld,
            alt: null,
            neu,
            eigentuemer,
            wirkung: "befund",
            status,
            grund,
        });
        if (dieser.some((verknuepfung) => verknuepfung.zustand === "suppressed")) {
            entscheidungen.push(befund("unterdrueckt", "unterdrueckt", GRUND_TOMBSTONE));
            continue;
        }
        if (dieser.some((verknuepfung) => verknuepfung.vonRedaktionGeloest)) {
            entscheidungen.push(befund("unterdrueckt", "unterdrueckt", GRUND_GELOEST));
            continue;
        }
        zahlen.neuZitiert += 1;
        if (dieser.some((verknuepfung) => verknuepfung.vonImportGeloest === true)) {
            entscheidungen.push(befund("unbekannt", "neu", GRUND_IMPORT_GELOEST));
            continue;
        }
        // Eine Quelle, die der WikiSync selbst still legte, lebt mit der nächsten Nennung wieder auf; jede andere stillgelegte bleibt.
        const quelleLebt = quelle !== null && (quelle.aktiv || quelle.vonWikisyncStill === true);
        const wiederbelebt = dieser.some((verknuepfung) => verknuepfung.vonWikisyncGeloest === true);
        if (quelle !== null && gleiche === undefined) {
            entscheidungen.push(befund(vomWiki, "neu", GRUND_NEUE_ADRESSE));
            continue;
        }
        if (quelle !== null && !quelleLebt) {
            entscheidungen.push(befund(vomWiki, "neu", GRUND_QUELLE_STILL));
            continue;
        }
        // Gehört der Bereich noch dem Legacy-Zug, ist das alles nur Vorschau.
        if (bereichBeiLegacy) {
            entscheidungen.push(befund("legacy", "neu", GRUND_NEU_VORSCHAU));
            continue;
        }
        zahlen.angelegt += 1;
        const angaben: KatalogAngaben | undefined =
            quelle === null
                ? {
                      schluessel: ziel.quelle,
                      titel: ziel.produkt.titel,
                      quellenart: ziel.produkt.quellenart ?? "sonstiges",
                      offiziell: offiziell(ziel.produkt.ns),
                      adresse: ziel.produkt.adresse,
                  }
                : undefined;
        entscheidungen.push({
            quelleId: quelle?.id ?? null,
            titel: quelle?.titel ?? ziel.produkt.titel,
            feld,
            alt: null,
            neu,
            eigentuemer: "wiki",
            wirkung: "uebernommen",
            status: "neu",
            grund:
                quelle === null
                    ? GRUND_NICHT_IM_KATALOG
                    : !quelle.aktiv
                      ? GRUND_QUELLE_WIEDER
                      : wiederbelebt
                        ? GRUND_VERKNUEPFUNG_WIEDER
                        : GRUND_NEU_ZITIERT,
            ...(angaben === undefined ? {} : { katalog: angaben }),
        });
    }

    const genannt = new Set(nennungen.keys());
    for (const verknuepfung of verknuepfungen) {
        if (verknuepfung.zustand !== "active" || verknuepfung.art === null || genannt.has(verknuepfung.quelle))
            continue;
        // Eine Verknüpfung der Redaktion sieht der Abgleich nicht (Legacy: „a manual row wins outright“).
        if (verknuepfung.herkunft === "manual") continue;
        zahlen.nichtMehrZitiert += 1;
        const eigentuemer = eigentuemerVon(verknuepfung, bereichBeiLegacy);
        // Still gelegt wird nur eine Verknüpfung mit belegter Wiki-Herkunft; wem sie sonst gehört, der Legacy-Zug oder ein unbelegter Stand, der sagt es nur.
        const stilllegen = eigentuemer === "wiki";
        if (stilllegen) zahlen.stillgelegt += 1;
        entscheidungen.push({
            quelleId: verknuepfung.quelleId,
            titel: verknuepfung.titel,
            feld,
            alt: { art: verknuepfung.art, seiten: verknuepfung.seiten, notiz: verknuepfung.notiz },
            neu: null,
            eigentuemer,
            wirkung: wirkungVon(eigentuemer),
            status: "zu_entfernen",
            grund: stilllegen
                ? GRUND_NICHT_MEHR
                : eigentuemer === "legacy"
                  ? GRUND_NICHT_MEHR_VORSCHAU
                  : GRUND_NICHT_MEHR_UNBELEGT,
        });
    }
    return { entscheidungen, zahlen, nennungen: abgelegt, zitiert, ohneProduktseite };
}
