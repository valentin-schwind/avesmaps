import {
    EDITOR_LANDSCAPES_URL,
    WIKI_ART_WIND,
    formtGelaende,
    type EditorLandmarkenKandidat,
    type EditorWikiEintrag,
    type EditorLandscapeList,
    type EditorLandscapePeakRow,
    type EditorLandscapeRow,
    type LandscapeSelection,
} from "@avesmaps3d/shared";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import { ApiFailure, type Fetcher } from "../auth/api";
import { formatNumber, isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { gefahrenText } from "../gefahren/gefahr-texte";

/**
 * Die Landschaften als Liste (WI-0178 Paket A2; EDIT-0004 §2.2; Muster `editor-liste/orte-liste.ts`): Der Adapter macht aus den Zeilen
 * des Lesepfads (`GET /api/editor/landscapes`, A1) die Zeilen des gemeinsamen Bauteils `editor-liste.vue`; Regeln und Darstellung
 * bleiben dort.
 *
 * - **Kreis in vier Zuständen** (EDIT-0003 T26 (5)): vom Server (`editorLandscapeCircle`), dieselben Füllungen wie `avm-kreis.vue`;
 *   die Legende unter der Liste nennt sie mit den Wörtern der Ortsliste (`editorListe.kreis.*`), denn die Systematik gilt für alle.
 * - **Die Ebene wählt die Karte** (Betreiber 2026-10-16, T27 (1)): Die Liste hat keine eigenen Reiter und keinen Ebenen-Filter; die
 *   Ebene der Karte (`LandscapeSelection` der Ansicht „Landschaften“) ist die Maske (`ebenenMaske`), „Alle“ lässt alles durch.
 * - **Facetten wie Legacy** (EDIT-0004 §2.2): Wiki (mit Artikel, ohne, Name ≠ Artikel), Darstellung (Fläche und Beschriftung, nur Fläche,
 *   nur Beschriftung, keine). Statt „Art“ seit WI-0271 L4 (Entwurf `review/wi-0271/landmarken-entwurf.html`) **Flächenart** (nur an Flächen) und
 *   **Landmarkenart** (nur an Landmarken, Gipfel und Vulkan eingeschlossen); darüber die eine Wahl **Objekte: Alle · Flächen · Landmarken**
 *   (`LANDSCHAFTEN_MASKEN`, wie „Siedlungen · Bauwerke“ der Ortsliste).
 * - **Unterzeile:** ✓ Wiki-Titel oder ⚠ kein Artikel, die Beschriftungen, ohne Fläche „nicht auf der Karte“, ⊘ für Klicks gesperrt.
 * - **Stand** (D2, EDIT-0003 T54, gemeinsame Schlüssel `editorListe.stand.*`): auf der Karte, nicht auf der Karte (abgenommen oder ohne
 *   Fläche), gelöscht. „Gelöscht“ ist standardmäßig aus und zählt in keiner Legende (`zaehltNicht`).
 * - **Gipfel, Vulkane und alle Landmarken** (P3; Orchestrierung 2026-10-18: „Gipfel und Vulkane erscheinen als Zeilen der Ebene Topographie mit
 *   Art „Berggipfel“ bzw. „Vulkan“ … Keine eigene Ebene „Gipfel“.“; WI-0271 L4 für jede Landmarkenart): Zeilen mit dem Schlüssel
 *   `gipfel:<Kennung>`, der Unterzeile Merkmale · Wiki · Höhe (nur Berggipfel und Vulkan);
 *   ohne Darstellung (keine Fläche) und ohne Platz in der Reihenfolge (sie stehen dort zuletzt).
 */

const GIPFEL = "gipfel:";
/** Der Gegenstand eines Gipfels in Liste, Fenster und „Offene Bearbeitungen“: `gipfel:<Kennung>`, getrennt von den Flächen. */
export const gipfelGegenstand = (id: string): string => `${GIPFEL}${id}`;
/** Die Kennung des Gipfels, wenn der Gegenstand einer ist. */
export const gipfelVon = (gegenstand: string | undefined): string | undefined =>
    gegenstand?.startsWith(GIPFEL) === true ? gegenstand.slice(GIPFEL.length) : undefined;

const KANDIDAT = "kandidat:";
/** Der Gegenstand eines Landmarken-Kandidaten aus dem WikiSync (WI-0271 L7): `kandidat:<Kennung des Artikels>`. */
export const kandidatGegenstand = (id: string): string => `${KANDIDAT}${id}`;
/** Die Kennung des Kandidaten, wenn der Gegenstand einer ist. */
export const kandidatVon = (gegenstand: string | undefined): string | undefined =>
    gegenstand?.startsWith(KANDIDAT) === true ? gegenstand.slice(KANDIDAT.length) : undefined;
const WIKI_EINTRAG = "wiki:";
/** Der Gegenstand eines Wiki-Eintrags ohne Fläche (WI-0284): `wiki:<Kennung des Artikels>`. */
export const wikiEintragGegenstand = (id: string): string => `${WIKI_EINTRAG}${id}`;
/** Die Kennung des Wiki-Eintrags, wenn der Gegenstand einer ist. */
export const wikiEintragVon = (gegenstand: string | undefined): string | undefined =>
    gegenstand?.startsWith(WIKI_EINTRAG) === true ? gegenstand.slice(WIKI_EINTRAG.length) : undefined;
/**
 * Der Wert der Facette „Flächenart“ an einem Wind-Eintrag (WI-0288 Stufe 6; Betreiber 2026-11-08: „Leicht, Derographie“): Ein Wind ist keine Fläche und hat keine Flächenart, im Trichter
 * aber eine eigene Wahl „Wind“, damit die Winde sich aus der Liste heraussuchen lassen. Den Wert trägt nur die Zeile, nie der Eintrag: Zeichnet ein Editor eine Fläche daraus, ist sie ohne Art.
 */
export const WIND_FACETTE = "wiki-wind";
/** Ist die Zeile eine Landmarke, auf der Karte oder als Kandidat? */
const istLandmarke = (zeile: ListenZeile): boolean => zeile.key.startsWith(GIPFEL) || zeile.key.startsWith(KANDIDAT);

export const LANDSCHAFTEN_FACETTEN = [
    "wiki",
    "darstellung",
    "flaechenart",
    "landmarkenart",
    "stand",
    "sichtbarkeit",
    "gefahrenlage",
] as const;

/** „Objekte“ im Trichter (WI-0271 L4): eine Wahl, „Alle“ zuerst. Eine Landmarke ist jede Zeile `gipfel:<Kennung>` und jeder Kandidat `kandidat:<Kennung>` (L7). */
export const LANDSCHAFTEN_MASKEN = {
    alle: undefined,
    flaechen: (zeile: ListenZeile) => !istLandmarke(zeile),
    landmarken: istLandmarke,
} as const satisfies Record<string, ((zeile: ListenZeile) => boolean) | undefined>;
export type LandschaftenMaske = keyof typeof LANDSCHAFTEN_MASKEN;
export const maskenName = (wert: string): string =>
    wert === "flaechen"
        ? t("landschaftseditor.objekte.flaechen")
        : wert === "landmarken"
          ? t("landschaftseditor.objekte.landmarken")
          : t("landschaftseditor.objekte.alle");
export const LANDSCHAFTEN_SORTIERUNGEN = ["name", "reihenfolge", "kreis"] as const;

/** Sortiert nach „Zustand“ wie die Ortsliste: von ○ über ◐ und ◑ zu ●. */
const KREIS_RANG: Readonly<Record<Kreis, number>> = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 };

/** Die Wörter der Legende, für alle Listen gleich (`editorListe.kreis.*`). */
export const LANDSCHAFTEN_LEGENDE = (): Record<Kreis, string> => ({
    voll: t("editorListe.kreis.voll"),
    halb: t("editorListe.kreis.halb"),
    "halb-rechts": t("editorListe.kreis.halbRechts"),
    leer: t("editorListe.kreis.leer"),
});

type Wiki = "mit" | "ohne" | "abweichend";
type Darstellung = "beides" | "flaeche" | "beschriftung" | "keine";

function wikiVon(row: Pick<EditorLandscapeRow, "name" | "wiki">): Wiki {
    if (!row.wiki) return "ohne";
    return row.wiki.title !== undefined && row.wiki.title !== row.name ? "abweichend" : "mit";
}

function darstellungVon(row: EditorLandscapeRow): Darstellung {
    if (row.areas && row.labels) return "beides";
    if (row.areas) return "flaeche";
    return row.labels ? "beschriftung" : "keine";
}

/** Der Name einer Landmarkenart (`peak.*`, WI-0271), sonst der rohe Wert. */
export function landmarkenartName(art: string): string {
    const key = `peak.${art}`;
    return isMessageKey(key) ? t(key) : art;
}

/** Der Name einer Art (`landscape.type.*`, für Gipfel `peak.*`), sonst der rohe Wert. */
export function artName(art: string | undefined): string {
    if (art === undefined) return t("landschaftseditor.art.ohne");
    const key = `landscape.type.${art}`;
    if (isMessageKey(key)) return t(key);
    const gipfel = `peak.${art}`;
    return isMessageKey(gipfel) ? t(gipfel) : art;
}

const WIKI_NAMEN: Readonly<Record<Wiki, MessageKey>> = {
    mit: "landschaftseditor.wiki.mit",
    ohne: "landschaftseditor.wiki.ohne",
    abweichend: "landschaftseditor.wiki.abweichend",
};
const DARSTELLUNG_NAMEN: Readonly<Record<Darstellung, MessageKey>> = {
    beides: "landschaftseditor.darstellung.beides",
    flaeche: "landschaftseditor.darstellung.flaeche",
    beschriftung: "landschaftseditor.darstellung.beschriftung",
    keine: "landschaftseditor.darstellung.keine",
};

/** Der Name einer Facette für den Trichter: wie jede Facette des Registers (`nav.editorpanel.facette.*`). */
export function facettenName(id: string): string {
    const key = `nav.editorpanel.facette.${id}`;
    return isMessageKey(key) ? t(key) : id;
}

/** Der Name eines Facettenwerts für die Anzeige. */
export function wertName(facette: string, wert: string): string {
    if (facette === "wiki") return t(WIKI_NAMEN[wert as Wiki] ?? "landschaftseditor.wiki.ohne");
    if (facette === "darstellung")
        return t(DARSTELLUNG_NAMEN[wert as Darstellung] ?? "landschaftseditor.darstellung.keine");
    if (facette === "gefahrenlage")
        return wert === "gefaehrlich" ? t("landschaftseditor.gefahr.facette.gefaehrlich") : t("gefahr.ungefaehrlich");
    if (facette === "sichtbarkeit")
        return wert === "verborgen"
            ? t("landschaftseditor.sichtbarkeit.verborgen")
            : t("landschaftseditor.sichtbarkeit.sichtbar");
    if (facette === "stand") {
        const key = `editorListe.stand.${wert}`;
        return isMessageKey(key) ? t(key) : wert;
    }
    if (facette === "landmarkenart") return landmarkenartName(wert);
    if (facette === "flaechenart" && wert === WIND_FACETTE) return t("landschaftseditor.art.wind");
    return artName(wert === "" ? undefined : wert);
}

function unterzeile(row: EditorLandscapeRow): NonNullable<ListenZeile["unter"]> {
    if (row.state === "retired") return { text: t("editorListe.stand.geloescht"), ton: "warnung" };
    const teile = [
        row.wiki
            ? t("editorListe.unter.wiki", { titel: row.wiki.title ?? row.name })
            : t("editorListe.unter.keinArtikel"),
    ];
    teile.push(
        row.labels
            ? tPlural("landschaftseditor.unter.beschriftungen", row.labels, { n: row.labels })
            : t("landschaftseditor.unter.ohneBeschriftung"),
    );
    if (row.state === "off_map") teile.push(t("editorListe.stand.nichtAufDerKarte"));
    else if (!row.areas) teile.push(t("landschaftseditor.unter.ohneFlaeche"));
    if (row.clickLocked) teile.push(t("landschaftseditor.unter.klickGesperrt"));
    if (row.hidden) teile.push(t("editorListe.unter.verborgen"));
    return { text: teile.join(" · "), ton: row.wiki ? "gut" : "warnung" };
}

/**
 * Was die Ebenenleiste zählt (T41 (2), (5)): die für Klicks gesperrten und die für Besucher verborgenen Landschaften der gewählten Ebene,
 * „Alle“ über alle Ebenen. Nur, was auf der Karte steht: Abgenommene und gelöschte (D2) zählen nicht.
 */
export function ebenenZaehlung(
    zeilen: readonly EditorLandscapeRow[],
    auswahl: LandscapeSelection,
): { gesperrt: number; verborgen: number } {
    const inEbene = zeilen.filter(
        (zeile) => zeile.state === undefined && (auswahl === "alle" || zeile.layer === auswahl),
    );
    return {
        gesperrt: inEbene.filter((zeile) => zeile.clickLocked === true).length,
        verborgen: inEbene.filter((zeile) => zeile.hidden === true).length,
    };
}

/**
 * ☰ „Reihenfolge und Sperren“, in der Ebenenleiste (T41 (2)) und in der Leiste der Liste rechts neben der Sortierung (T47; Betreiber
 * 2026-10-18: „elegant gelöst mit dem layereditor -> auf jeden fall in der landschaftsliste platzieren“): die Liste nach Reihenfolge,
 * wie Legacys Fenster „Reihenfolge und Sperren“. Steht sie bei offenem Fenster schon so, nimmt ein zweiter Druck es zurück (nach Namen,
 * die Vorgabe der Liste); beide ☰ sind gedrückt, solange sie so steht. `true`, wenn sie danach nach Reihenfolge steht.
 */
export function stapelUmschalten(einstellung: Pick<ListenEinstellung, "sortierung">, offen: boolean): boolean {
    const zurueck = offen && einstellung.sortierung.value === "reihenfolge";
    einstellung.sortierung.value = zurueck ? "name" : "reihenfolge";
    return !zurueck;
}

/** Was ☰ sagt: mit gesperrten Flächen ihre Zahl, sonst „Reihenfolge und Sperren“. */
export function stapelText(gesperrt: number): string {
    return gesperrt > 0
        ? tPlural("landschaftseditor.ebenenleiste.gesperrt", gesperrt, { n: gesperrt })
        : t("landschaftseditor.griff.abschnitt.reihenfolge");
}

export function zeileVon(row: EditorLandscapeRow): ListenZeile {
    return {
        key: row.id,
        name: row.name,
        kreis: row.circle,
        facetten: {
            ebene: row.layer,
            wiki: wikiVon(row),
            darstellung: darstellungVon(row),
            flaechenart: row.type ?? "",
            stand:
                row.state === "retired"
                    ? "geloescht"
                    : row.state === "off_map" || !row.areas
                      ? "nichtAufDerKarte"
                      : "aufDerKarte",
            sichtbarkeit: row.hidden ? "verborgen" : "sichtbar",
            gefahrenlage: (row.hazards ?? []).length > 0 ? "gefaehrlich" : "ungefaehrlich",
        },
        rechts: artName(row.type),
        unter: unterzeile(row),
        // Die Gefahrenlage (WI-0308): wirksam nur in Derographie, Vegetation und Topographie; der Editor führt keine andere Ebene.
        ...(row.hazards !== undefined && row.hazards.length > 0
            ? { gefahr: { text: t("landschaftseditor.unter.gefahr", { arten: gefahrenText(row.hazards) }) } }
            : {}),
        // Das durchgestrichene Auge hinter dem Namen (T41, Blatt E).
        ...(row.hidden
            ? { zeichen: { name: "verbergen" as const, titel: t("landschaftseditor.unter.verborgen") } }
            : {}),
        rang: { reihenfolge: row.order, kreis: KREIS_RANG[row.circle] },
        ...(row.state === "retired" ? { zaehltNicht: true as const } : {}),
    };
}

/**
 * Eine Landmarke als Zeile (P3, WI-0271 L4): in der Ebene Topographie, auf der Karte, mit Merkmalen („verborgen“ und „nur Gelände“ darunter), Wiki und Höhe (nur Berggipfel und Vulkan)
 * in der Unterzeile; gelöscht („… entfernen …“) unter „Gelöscht“ wie eine gelöschte Fläche.
 */
export function gipfelZeileVon(row: EditorLandscapePeakRow): ListenZeile {
    const geloescht = row.state === "retired";
    const teile = [
        ...((row.merkmale ?? []).length > 0
            ? [(row.merkmale ?? []).map((merkmal) => t(`peak.merkmal.${merkmal}`)).join(", ")]
            : []),
        row.wiki
            ? t("editorListe.unter.wiki", { titel: row.wiki.title ?? row.name })
            : t("editorListe.unter.keinArtikel"),
        ...(formtGelaende(row.subtype)
            ? [
                  row.height === undefined
                      ? t("landschaftseditor.gipfel.ohneHoehe")
                      : t("scale.schritt", { n: formatNumber(row.height, 0) }),
              ]
            : []),
    ];
    return {
        key: gipfelGegenstand(row.id),
        name: row.name,
        kreis: row.circle,
        facetten: {
            ebene: "topographie",
            wiki: wikiVon(row),
            landmarkenart: row.subtype,
            stand: geloescht ? "geloescht" : "aufDerKarte",
            sichtbarkeit: row.hidden ? "verborgen" : "sichtbar",
        },
        rechts: landmarkenartName(row.subtype),
        unter: geloescht
            ? { text: t("editorListe.stand.geloescht"), ton: "warnung" }
            : { text: teile.join(" · "), ton: row.wiki ? "gut" : "warnung" },
        ...(row.hidden
            ? { zeichen: { name: "verbergen" as const, titel: t("landschaftseditor.unter.verborgen") } }
            : {}),
        rang: { kreis: KREIS_RANG[row.circle] },
        ...(geloescht ? { zaehltNicht: true as const } : {}),
    };
}

/**
 * Ein Landmarken-Kandidat als Zeile (WI-0271 L7, §4.2): ◐ „nur im Wiki, nicht platziert“ in der Ebene Topographie, mit der Art aus der Abbildung der Wiki-Art rechts und der Region in der Unterzeile.
 * Unterdrückt („nicht auf die Karte“) steht er unter dem Stand „Unterdrückt“, der zu Beginn aus ist (wie „Gelöscht“).
 */
export function kandidatZeileVon(kandidat: EditorLandmarkenKandidat): ListenZeile {
    const unterdrueckt = kandidat.unterdrueckt === true;
    const teile = [t("editorListe.unter.nurWiki"), ...(kandidat.region === undefined ? [] : [kandidat.region])];
    return {
        key: kandidatGegenstand(kandidat.id),
        name: kandidat.name,
        kreis: "halb",
        facetten: {
            ebene: "topographie",
            wiki: kandidat.titel === kandidat.name ? "mit" : "abweichend",
            landmarkenart: kandidat.art,
            stand: unterdrueckt ? "unterdrueckt" : "nichtAufDerKarte",
            sichtbarkeit: "sichtbar",
        },
        rechts: landmarkenartName(kandidat.art),
        unter: unterdrueckt
            ? { text: t("editorListe.stand.unterdrueckt"), ton: "warnung" }
            : { text: teile.join(" · "), ton: "warnung" },
        rang: { kreis: KREIS_RANG.halb },
        ...(unterdrueckt ? { zaehltNicht: true as const } : {}),
    };
}

/**
 * Ein Wiki-Eintrag ohne Fläche als Zeile (WI-0284): ◐ „nur Wiki“ in der Ebene aus der Art des Artikels, die Art rechts und die Region in der Unterzeile. Er zählt zu den Flächen. Ein Wind (WI-0288 Stufe 6) steht
 * unter „Regionen“ und trägt in der Facette „Flächenart“ die Wahl „Wind“ (`WIND_FACETTE`).
 */
export function wikiEintragZeileVon(eintrag: EditorWikiEintrag): ListenZeile {
    const teile = [t("editorListe.unter.nurWiki"), ...(eintrag.region === undefined ? [] : [eintrag.region])];
    return {
        key: wikiEintragGegenstand(eintrag.id),
        name: eintrag.name,
        kreis: "halb",
        facetten: {
            ebene: eintrag.layer,
            wiki: eintrag.titel === eintrag.name ? "mit" : "abweichend",
            flaechenart: eintrag.type ?? (eintrag.art === WIKI_ART_WIND ? WIND_FACETTE : ""),
            stand: "nichtAufDerKarte",
            sichtbarkeit: "sichtbar",
        },
        rechts: eintrag.art ?? "",
        unter: { text: teile.join(" · "), ton: "warnung" },
        rang: { kreis: KREIS_RANG.halb },
    };
}

export const LANDSCHAFTEN_OPTIONEN: ListenOptionen = {
    form: "flach",
    facetten: LANDSCHAFTEN_FACETTEN,
    sortierungen: { name: nachName, reihenfolge: nachRang("reihenfolge"), kreis: nachRang("kreis") },
    // „Gelöscht“ ist zu Beginn aus (T54).
    vorbelegt: new Map([["stand", new Set<string>(["aufDerKarte", "nichtAufDerKarte"])]]),
};

export const sortierungsName = (wert: string): string =>
    wert === "reihenfolge"
        ? t("landschaftseditor.sortierung.reihenfolge")
        : wert === "kreis"
          ? t("editorListe.sortierung.kreis")
          : t("editorListe.sortierung.name");

/** Die Maske der Ebene der Karte (T27 (1)): in einer Ebene nur ihre Landschaften, in „Alle“ (oder außerhalb der Ansicht) alle. */
export function ebenenMaske(ebene: LandscapeSelection | undefined): ((zeile: ListenZeile) => boolean) | undefined {
    if (ebene === undefined || ebene === "alle") return undefined;
    return (zeile) => zeile.facetten["ebene"] === ebene;
}

/**
 * Die Liste vom Server, mit `no-cache` statt `no-store` wie `ladeOrte`: Der Browser fragt mit `If-None-Match` nach und nimmt einen
 * unveränderten Stand als 304 aus seinem Cache (rund 5.400 Zeilen, 1 MB ungepackt).
 */
export async function ladeLandschaften(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<EditorLandscapeList> {
    let antwort: Response;
    try {
        antwort = await fetcher(EDITOR_LANDSCAPES_URL, {
            method: "GET",
            headers: { accept: "application/json" },
            credentials: "same-origin",
            cache: "no-cache",
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    const body = (await antwort.json().catch(() => undefined)) as unknown;
    if (antwort.ok) return body as EditorLandscapeList;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}
