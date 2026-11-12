import { Type, type Static, type TLiteral, type TSchema, type TUnion } from "@sinclair/typebox";
import { OperationId } from "../operation.ts";

/**
 * Der Abgleich der Karte mit dem Wiki-Dump (WikiSync, WI-0253 C): die Wörter, die Server, Bericht und spätere Oberfläche teilen, und die Antwort des
 * Berichts `GET /api/admin/wikisync/bericht`. EINE Stelle; die Oberfläche bekommt ihre Texte aus den Sprachtafeln, nicht von hier.
 *
 * 🔴 Dies ist eine VORSCHAU. Ein Lauf schreibt in keine Fachtafel (Orte, Wege, Gebiete …), nur in seine eigenen Tafeln `wikisync_lauf` und
 * `wikisync_lauf_zeile`; was „würde übernommen“ heißt, wendet erst die spätere Übernahme (D) an, mit Passkey und je Bereich.
 */

export const WIKISYNC_BERICHT_URL = "/api/admin/wikisync/bericht";

/**
 * Die Bereiche eines Abgleichs (die Arten der Karte, die das Wiki beschreibt). `region` ist die Landschaft (Derographie), `gipfel` die Gipfel und
 * Vulkane: Sie tragen den Wiki-Stand ihrer Landschafts-Infobox; am Gipfel selbst folgt nur die Höhe dem Wiki, solange keine Hand sie gesetzt hat (Name und Art gehören Editor und Gelände).
 * `literatur` sind die Werke der Spielliteratur (`adventure`, `{{Infobox Produkt}}`): kein Kartenobjekt, aber dieselbe Vorschau, Übernahme und Rücknahme.
 * `quelle` sind die Publikationen der Artikel (Abschnitt „Publikationen“, WI-0253 Scheibe Quellen): Das Objekt ist die Katalogquelle (`feature_source`), ihre Zeilen sind Titel und Verwendungen
 * (Art, Seiten, Notiz an der Verknüpfung eines Trägers); seit Vali 2026-10-27 werden neu zitierte Verknüpfungen angelegt und nicht mehr genannte still gelegt.
 * `vorkommen` sind Waren, Fauna, Flora und Spezies (`lore_entry`, Infoboxen `Gegenstandsgruppe`, `Tierart`, `Pflanzenart`, `Spezies`, WI-0253 §17/§23): kein Kartenobjekt, aber dieselbe Vorschau,
 * Übernahme und Rücknahme; die Felder des Eintrags folgen dem Wiki nach Vermerk, die Ortszeilen (`lore_place`) bekommen eine Rolle (`WIKISYNC_ORTSROLLEN`), und nur die Rolle `ort` trifft.
 * `sprachen` sind die aventurischen Sprachartikel (`{{Infobox Sprache}}` mit `{{Aventurien}}` oder `{{Nav Sprachen}}`, WI-0261 S3): ARTIKELZENTRIERT. Das Objekt ist der Wiki-Stand des Artikels
 * (`wiki_sprache_artikel`); der WikiSync legt einen neuen Artikel selbst an und legt einen verschwundenen still. Fläche, Farbe und die Zuordnung zu einer Sprache schreibt er nie (O6).
 * `gipfel` sind die Landmarken (WI-0271; der Schlüssel steht so in den Daten, die Oberfläche sagt „Landmarken“): die platzierten jeder Art (`terrain_peak`) und, ARTIKELZENTRIERT wie die Sprachen, die
 * Landmarken-Artikel ohne Landmarke auf der Karte (`{{Infobox Region}}` mit einer Art der festen Abbildung). Dort ist das Objekt der Wiki-Stand des Artikels (`wiki_landmarke_artikel`), ein Kandidat ◐; der
 * WikiSync legt ihn an und still, legt aber NIE eine Landmarke auf die Karte (das tut ein Mensch).
 */
export const WIKISYNC_BEREICHE = [
    "ort",
    "weg",
    "gebiet",
    "region",
    "gipfel",
    "kraftlinie",
    "literatur",
    "quelle",
    "vorkommen",
    "sprachen",
] as const;
export type WikisyncBereich = (typeof WIKISYNC_BEREICHE)[number];

/**
 * Die Rolle einer Ortszeile eines Vorkommens (WI-0253 §23; Vali 2026-10-27, Knopfwahl „Ja, mit Rolle“): Jeder Wikilink aus den Ortsfeldern bleibt als Ortszeile (`lore_place`) gespeichert, bekommt
 * aber eine Rolle. **Nur `ort` trifft** (`lore_place_target`, das Infofenster „Direkt von hier“ und „Aus der Region“); eine Zeile ohne Rolle (Bestand aus Legacys Zug) gilt als `ort`, bis ein
 * Abgleich sie bestimmt.
 *   ort            ein Fundort: trifft.
 *   bezugspunkt    der Bezugspunkt einer Richtung („nördlich der Khôm“) oder der Endpunkt einer Linie („zwischen Riva und Mengbilla“): der Ort selbst ist nicht gemeint.
 *   ausgenommen    ausdrücklich ausgeschlossen („außer Wüste“, „nicht Maraskan“).
 *   teil           nur ein Teil der Fläche ist gemeint („nördliches Bornland“): eine Rückfrage, solange die Redaktion keine Hilfsfläche zeichnet.
 *   landschaftsart eine Landschaftsart statt eines Orts („Wald“, „Küste“).
 *   volk           ein Volk oder eine Kultur statt eines Orts („Elfen“).
 *   frueher        ein früheres Vorkommen („ehemals“).
 *   andere_welt    ein Ort einer anderen Welt (Myranor, Globule): trifft auf der Karte Aventuriens nichts.
 */
export const WIKISYNC_ORTSROLLEN = [
    "ort",
    "bezugspunkt",
    "ausgenommen",
    "teil",
    "landschaftsart",
    "volk",
    "frueher",
    "andere_welt",
] as const;
export type WikisyncOrtsrolle = (typeof WIKISYNC_ORTSROLLEN)[number];

/**
 * Wem ein Feld gehört (§3 Punkt 3 des Work Items). `wiki` folgt dem Wiki; `manual` ist eine eigene Entscheidung der Redaktion und gewinnt immer; `legacy`
 * gehört dem Legacy-Zug, solange der Bereich noch bei ihm liegt; `unterdrueckt` und `getrennt` sind bewusste Entscheidungen über die Zuordnung (Tombstone);
 * `unbekannt` heißt: Der Wert ist da, seine Herkunft nicht belegt – weder leer noch NULL.
 */
export const WIKISYNC_EIGENTUEMER = ["wiki", "manual", "legacy", "unterdrueckt", "getrennt", "unbekannt"] as const;
export type WikisyncEigentuemer = (typeof WIKISYNC_EIGENTUEMER)[number];

/**
 * Was eine Übernahme mit dem Feld täte: `uebernommen` (der Wiki-Wert würde gesetzt), `eigen` (der eigene Wert bleibt, das Wiki ist nur zur Kenntnis),
 * `befund` (nichts geschieht, ein Mensch entscheidet).
 */
export const WIKISYNC_WIRKUNG = ["uebernommen", "eigen", "befund"] as const;
export type WikisyncWirkung = (typeof WIKISYNC_WIRKUNG)[number];

/** Was sich geändert hat: ein Wert neu, geändert oder zu entfernen (Artikel weg), unterdrückt, mehrdeutig, fehlerhaft (Quelle nicht lesbar). */
export const WIKISYNC_STATUS = [
    "neu",
    "geaendert",
    "zu_entfernen",
    "unterdrueckt",
    "mehrdeutig",
    "fehlerhaft",
] as const;
export type WikisyncStatus = (typeof WIKISYNC_STATUS)[number];

/**
 * Die Befunde zu einem Artikel oder einer Zuordnung (kein Feld). Die Zeile eines Felds trägt keinen Befund, außer `herkunft_widerspruch`: Dort
 * widerspricht der Vermerk „Wiki“ dem Schnappschuss, und der Wert gilt als unbekannt.
 */
export const WIKISYNC_BEFUNDE = [
    "umleitung",
    "mehrdeutig",
    "infobox_kaputt",
    "artikel_nicht_im_dump",
    "namensraum_unbekannt",
    "neuer_artikel",
    "zuordnung_gesperrt",
    "herkunft_widerspruch",
] as const;
export type WikisyncBefund = (typeof WIKISYNC_BEFUNDE)[number];

/** Der Zustand eines Wertes: `kein` (NULL, das Wiki kennt nichts), `leer` (bewusst leer, eine eigene Entscheidung), `text`. */
export const WIKISYNC_WERT_ZUSTAND = ["kein", "leer", "text"] as const;
export type WikisyncWertZustand = (typeof WIKISYNC_WERT_ZUSTAND)[number];

export const WIKISYNC_LAUF_STATUS = ["laeuft", "fertig", "fehlgeschlagen"] as const;
export type WikisyncLaufStatus = (typeof WIKISYNC_LAUF_STATUS)[number];

/** Eine Vereinigung fester Wörter; `Static` ergibt die Wörter selbst (nicht `string`), damit Bodies und Antworten ihren Katalog tragen. */
const union = <T extends readonly string[]>(werte: T) =>
    Type.Union(werte.map((wert) => Type.Literal(wert))) as unknown as TUnion<{
        -readonly [K in keyof T]: TLiteral<T[K] & string>;
    }>;
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const WikisyncBereichName = union(WIKISYNC_BEREICHE);

/** Die Filter des Berichts (Bereich, Wirkung, Eigentümer, Status, Befund, Freitext) und die Seite. */
export const WikisyncBerichtAbfrage = Type.Object(
    {
        bereich: Type.Optional(WikisyncBereichName),
        wirkung: Type.Optional(union(WIKISYNC_WIRKUNG)),
        eigentuemer: Type.Optional(union(WIKISYNC_EIGENTUEMER)),
        status: Type.Optional(union(WIKISYNC_STATUS)),
        befund: Type.Optional(union(WIKISYNC_BEFUNDE)),
        /** Freitext in Objektname, Artikel und Feld. */
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
    },
    { additionalProperties: false },
);
export type WikisyncBerichtAbfrage = Static<typeof WikisyncBerichtAbfrage>;

/** Die Zahlen eines Bereichs im Lauf. Ein Bereich, der nicht im Lauf war, fehlt. */
export const WikisyncBereichZahlen = Type.Object(
    {
        /** Objekte mit einer Zuordnung zum Wiki (auch ohne Adresse). */
        objekte: Type.Integer(),
        /** Davon mit gespeicherter Wiki-Aventurica-Adresse: nur die werden mit dem Dump verglichen. */
        mitAdresse: Type.Integer(),
        /** Kennungen ohne Wiki-Adresse: Eigenkennungen, nie abgeglichen, nur gezählt (Vali 2026-10-25). */
        kennungOhneWikiAdresse: Type.Integer(),
        gefunden: Type.Integer(),
        umgeleitet: Type.Integer(),
        nichtImDump: Type.Integer(),
        /** Adressen, zu denen der Dump mehr als eine Seite führt (doppelter Titel). */
        mehrdeutig: Type.Integer(),
        /** Zuordnungen, die die Redaktion getrennt oder unterdrückt hat. */
        gesperrt: Type.Integer(),
        /** Gelesene Felder aller gefundenen Artikel. */
        felderGelesen: Type.Integer(),
        unveraendert: Type.Integer(),
        /** Felder, die eine Übernahme setzen würde. */
        uebernommen: Type.Integer(),
        /** Felder, deren eigener Wert bleibt, obwohl das Wiki sich geändert hat. */
        eigen: Type.Integer(),
        /** Zeilen mit Wirkung „Befund“ (Felder und Artikel). */
        befunde: Type.Integer(),
        /** Neue Artikel mit Ortes- oder Gebiets-Infobox in einem Einsammel-Raum (die Zeilen sind auf eine Höchstzahl gekappt). */
        neueArtikel: Type.Integer(),
        /** Neue Artikel mit einer anderen Infobox: nur die Zahl, kein Befund. */
        neueArtikelNurZahl: Type.Integer(),
        /**
         * Nur bei den Quellen (WI-0253 §21): Verknüpfungen, die eine Übernahme anlegen würde, Verknüpfungen, die sie still legen würde (belegte Wiki-Herkunft, vom Artikel
         * nicht mehr genannt), und Katalogquellen, die sie dazu anlegen würde (das Wiki nennt sie, der Katalog hat sie nicht). Bei den Vorkommen die Ortszeilen, bei den Sprachen
         * (WI-0261 S3) die Sprachartikel: neu im Dump (angelegt) und verschwunden oder nicht mehr aventurisch (still gelegt).
         */
        angelegt: Type.Optional(Type.Integer()),
        stillgelegt: Type.Optional(Type.Integer()),
        quellenAngelegt: Type.Optional(Type.Integer()),
        /**
         * Nur bei den Vorkommen (WI-0253 §23): wie viele Ortszeilen das Wiki je Rolle nennt (jeder Wikilink der Ortsfelder, auch die, die nicht treffen), davon `rueckfragen` mit der Rolle `teil`
         * (nur ein Teil der Fläche ist gemeint) und `weiterleitungen`: Ortsziele, die der Abgleich über eine Weiterleitung des Wikis auflöst (Legacy löst sie nicht auf).
         */
        rollen: Type.Optional(Type.Record(Type.String(), Type.Integer())),
        rueckfragen: Type.Optional(Type.Integer()),
        weiterleitungen: Type.Optional(Type.Integer()),
    },
    { additionalProperties: false },
);
export type WikisyncBereichZahlen = Static<typeof WikisyncBereichZahlen>;

export const WikisyncLauf = Type.Object(
    {
        id: Type.Integer(),
        bereiche: Type.Array(WikisyncBereichName),
        status: union(WIKISYNC_LAUF_STATUS),
        dump: Type.Object(
            {
                datei: nullable(Type.String()),
                sha256: nullable(Type.String()),
                /** Der Stand des Dumps (ISO-Datum oder -Zeit); `null`: unbekannt. */
                stand: nullable(Type.String()),
                seiten: nullable(Type.Integer()),
            },
            { additionalProperties: false },
        ),
        /**
         * Die Kategorien-Datei (`dump_categorylinks.sql.gz`, WI-0294), aus der die Vorschau Ortsgröße, Bauwerkart und Kontinent gerechnet hat, mit Prüfsumme und Stand aus ihrer Endzeile (ISO, UTC);
         * `null`: Die Vorschau hatte keine (die Bereiche mit Kategorien stehen dann aus) oder lief vor WI-0294.
         */
        kategorien: nullable(
            Type.Object(
                {
                    datei: Type.String(),
                    sha256: Type.String(),
                    stand: Type.String(),
                    zeilen: Type.Integer(),
                },
                { additionalProperties: false },
            ),
        ),
        /** Revision der Namensraum-Tafel, nach der gerechnet wurde; `null`: Vorgabe, keine Zeile in der Datenbank. */
        tafelRevision: nullable(Type.Integer()),
        parserVersion: Type.String(),
        gestartetAm: Type.String(),
        beendetAm: nullable(Type.String()),
        /** Wer den Lauf ausgelöst hat (Name oder „automatisch“); `null`: nicht belegt. */
        ausgeloestVon: nullable(Type.String()),
        fehler: nullable(Type.String()),
        zahlen: Type.Record(Type.String(), WikisyncBereichZahlen),
    },
    { additionalProperties: false },
);
export type WikisyncLauf = Static<typeof WikisyncLauf>;

export const WikisyncZeile = Type.Object(
    {
        id: Type.Integer(),
        laufId: Type.Integer(),
        bereich: WikisyncBereichName,
        /** Die Art des Objekts (`place`, `path`, `region`, `territory`, `powerline`, `peak`, `work` für ein Werk der Literatur); `article` bei einem neuen Artikel. */
        objektArt: Type.String(),
        objektId: nullable(Type.String()),
        objektName: nullable(Type.String()),
        /** Wie viele Objekte diese Zeile zusammenfasst (die Abschnitte eines Wegs teilen einen Artikel). */
        objekte: Type.Integer(),
        artikel: nullable(Type.String()),
        namensraum: nullable(Type.Integer()),
        /** Der Name des Felds; `null` bei einem Befund zum Artikel. */
        feld: nullable(Type.String()),
        alt: nullable(Type.String()),
        altZustand: union(WIKISYNC_WERT_ZUSTAND),
        neu: nullable(Type.String()),
        neuZustand: union(WIKISYNC_WERT_ZUSTAND),
        eigentuemer: union(WIKISYNC_EIGENTUEMER),
        wirkung: union(WIKISYNC_WIRKUNG),
        status: union(WIKISYNC_STATUS),
        befund: nullable(union(WIKISYNC_BEFUNDE)),
        /** Eine kurze Angabe zum Befund (bei einer Umleitung der Zieltitel, bei einer kaputten Infobox der Grund); nie Wikitext. */
        grund: nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type WikisyncZeile = Static<typeof WikisyncZeile>;

/** Zähler je Wert, für die Zahl am Wert im Filter (nach Bereich eingeschränkt, nicht nach den anderen Filtern). */
export const WikisyncFacetten = Type.Object(
    {
        wirkung: Type.Record(Type.String(), Type.Integer()),
        eigentuemer: Type.Record(Type.String(), Type.Integer()),
        status: Type.Record(Type.String(), Type.Integer()),
        befund: Type.Record(Type.String(), Type.Integer()),
    },
    { additionalProperties: false },
);
export type WikisyncFacetten = Static<typeof WikisyncFacetten>;

export const WikisyncBericht = Type.Object(
    {
        jetzt: Type.String(),
        /** Je Bereich der jüngste fertige Lauf (mehrere Bereiche können aus demselben Lauf stammen, dann steht er einmal da). */
        laeufe: Type.Array(WikisyncLauf),
        /** Zeilen, die die Filter treffen, ohne Seite. */
        gesamt: Type.Integer(),
        offset: Type.Integer(),
        limit: Type.Integer(),
        facetten: WikisyncFacetten,
        zeilen: Type.Array(WikisyncZeile),
    },
    { additionalProperties: false },
);
export type WikisyncBericht = Static<typeof WikisyncBericht>;

// ── D-1: Bereiche, Übernahme und Rücknahme ────────────────────────────────────────────────────────────────────────────────

/**
 * Die Routen der Steuerung (WI-0253 D-1). Ein Stand, drei Aufträge (einen Bereichsschalter gibt es seit dem Cutoff 2026-11-02 nicht mehr):
 *
 *     GET  /api/admin/wikisync/bereiche       die Bereiche mit der jüngsten Übernahme je Bereich                view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/vorschau       die Vorschau anstoßen                                             view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/uebernehmen    die Zeilen eines Vorschau-Laufs übernehmen                        run_wikisync_areas (`editor`) / run_wikisync_all (`admin`) + Passkey
 *     POST /api/admin/wikisync/zuruecknehmen  eine Übernahme je Bereich und Lauf zurücknehmen                   undo_wikisync_run (`admin`) + Passkey
 */
export const WIKISYNC_BEREICHE_URL = "/api/admin/wikisync/bereiche";
export const WIKISYNC_VORSCHAU_URL = "/api/admin/wikisync/vorschau";
export const WIKISYNC_UEBERNEHMEN_URL = "/api/admin/wikisync/uebernehmen";
export const WIKISYNC_ZURUECKNEHMEN_URL = "/api/admin/wikisync/zuruecknehmen";

/**
 * Die Bereiche, an denen die Übernahme angeschlossen ist: Für sie gibt es einen Schreiber (`apps/server/src/wiki/abgleich/uebernahme/`), und sie gehören in jeder
 * Umgebung fest dem WikiSync (Betreiber 2026-11-02: „die spalte fällt weg, es gibt keinen schalter mehr - macht keinen sinn wenn legacy aus ist“); der Legacy-Zug
 * lässt sie aus. Ein Bereich ohne Schreiber bliebe in der Mitte stehen; mit jedem Bereich, den eine spätere Scheibe anschließt, kommt er hierher.
 */
export const WIKISYNC_ANGESCHLOSSEN = [
    "ort",
    "weg",
    "gebiet",
    "region",
    "gipfel",
    "kraftlinie",
    "literatur",
    "quelle",
    "vorkommen",
    "sprachen",
] as const satisfies readonly WikisyncBereich[];
export const wikisyncAngeschlossen = (bereich: WikisyncBereich): boolean =>
    (WIKISYNC_ANGESCHLOSSEN as readonly string[]).includes(bereich);

/**
 * Die Bereiche mit Kategorien aus der Datei `dump_categorylinks.sql.gz` (WI-0294): Was erst eine Vorlage im Wiki setzt (Ortsgröße, Bauwerkart, Kontinent), steht nicht im Text des Dumps,
 * sondern in der Tabelle der Kategorien, die das Wiki als zweite Datei neben dem Dump anbietet. Die Vorschau liest sie mit. Ein solcher Bereich wird erst übernommen, wenn die Vorschau
 * eine Kategorien-Datei gelesen hat (Vali 2026-10-25: „Dump aktualisiert, Sync steht aus“): ein Abbruch lässt nichts halb geschrieben. Kraftlinien, Wege und Gipfel haben keine.
 */
export const WIKISYNC_MIT_KATEGORIEN = ["ort", "gebiet", "region"] as const satisfies readonly WikisyncBereich[];
export const wikisyncHatKategorien = (bereich: WikisyncBereich): boolean =>
    (WIKISYNC_MIT_KATEGORIEN as readonly string[]).includes(bereich);

/**
 * In welcher Kategorie der Legacy-Zug einen Bereich liefert (`config/legacy-zug-kategorien.json`); `null`: Der Bereich hat keine. Wo der Zug Kategorien
 * kennt, fährt er die Kategorie eines Bereichs, der dem WikiSync gehört (seit dem Cutoff 2026-11-02 jeder angeschlossene), nicht mehr; Kraftlinien (kein Zug fasst sie je Kategorie an) lässt der GANZE Zug aus
 * (Schritt I8 und der Kraftlinien-Teil von I17). Die Landschaften tragen die Gipfel mit (Betreiber 2026-10-13: „gipfel kommen mit“). Die Literatur fährt in keiner
 * Kategorie (nur der ganze Zug auf Zuruf, Schritt I20); gehört sie dem WikiSync, lässt I20 sie aus (`migration/literature-import.ts`). Die Quellen fahren in keiner Kategorie
 * (Schritt I18 im ganzen Zug); gehören sie dem WikiSync, lässt I18 sie aus (`migration/sources-import.ts`). Die Vorkommen fahren in keiner Kategorie (Schritt I25 im ganzen Zug);
 * gehören sie dem WikiSync, lässt I25 sie aus (`migration/lore-import.ts`). Die Sprachen (WI-0261 S3) kennt der Legacy-Zug gar nicht: Er fährt sie in
 * keiner Kategorie und in keinem Schritt.
 */
export const WIKISYNC_ZUG_KATEGORIE = {
    ort: "orte",
    weg: "wege",
    gebiet: null,
    region: "landschaften",
    gipfel: "landschaften",
    kraftlinie: null,
    literatur: null,
    quelle: null,
    vorkommen: null,
    sprachen: null,
} as const satisfies Record<WikisyncBereich, "landschaften" | "wege" | "orte" | null>;

/** Die Bereiche, die in dieser Kategorie des Legacy-Zugs fahren. */
export function wikisyncBereicheDerKategorie(kategorie: string): WikisyncBereich[] {
    return WIKISYNC_BEREICHE.filter((bereich) => WIKISYNC_ZUG_KATEGORIE[bereich] === kategorie);
}

/** Der Status einer Übernahme oder Rücknahme (`wikisync_uebernahme`). `abgelehnt`: Sie ist gar nicht erst angelaufen, der Grund steht dabei. */
export const WIKISYNC_UEBERNAHME_STATUS = ["laeuft", "fertig", "fehlgeschlagen", "abgebrochen", "abgelehnt"] as const;
export type WikisyncUebernahmeStatus = (typeof WIKISYNC_UEBERNAHME_STATUS)[number];

export const WIKISYNC_UEBERNAHME_ART = ["uebernahme", "zuruecknahme"] as const;
export type WikisyncUebernahmeArt = (typeof WIKISYNC_UEBERNAHME_ART)[number];

/**
 * Warum eine Übernahme nicht anläuft (`abgelehnt`, oder 409 an der Route). Die Reihenfolge ist die der Prüfung: erst wem der Bereich gehört, dann ob die Vorschau seine
 * Kategorien gelesen hat, dann ob es einen Schreiber gibt, dann ob es einen passenden Lauf gibt. `wiki_teil_fehlt` ist der Grund aus der Zeit des Wiki-Teils (bis WI-0294): Er steht
 * nur noch in alten Protokollzeilen.
 */
export const WIKISYNC_ABLEHNUNGEN = [
    "gehoert_legacy",
    "kategorien_fehlen",
    "wiki_teil_fehlt",
    "nicht_angeschlossen",
    "kein_lauf",
    "vorschau_veraltet",
] as const;
export type WikisyncAblehnung = (typeof WIKISYNC_ABLEHNUNGEN)[number];

/**
 * Was eine Übernahme oder Rücknahme an einem Feld NICHT tut, und warum (ein Befund; die Zeile steht in `wikisync_uebernahme_befund`):
 * - `seit_vorschau_geaendert`: Der Istwert (oder der Eigentümer) ist nicht mehr der, den die Vorschau sah. Die Übernahme überschreibt keinen Wert, den sie nicht gesehen hat.
 * - `kein_schnappschuss`: Das Objekt hat nur eine Adresse und keinen Wiki-Stand; eine Zuordnung ändert dieser Abgleich nie. Das sagt schon die Vorschau (die Zeile eines solchen Objekts ist ein
 *   Befund mit diesem Grund, nie eine Übernahme); die Übernahme meldet es nur, wo die Zeile eine Übernahme war und das Objekt seitdem keinen Stand mehr hat.
 * - `name_leer`, `name_vergeben`, `linie_unvollstaendig`: Der Name bindet die Abschnitte einer Kraftlinie; er wird nie geleert, nie auf den Namen einer
 *   anderen Linie gesetzt (das verschmölze beide) und nie nur an einem Teil der Abschnitte geändert.
 * - `wert_gekuerzt`: Die Vorschau hat den Wert auf 4.000 Zeichen gekürzt; ein gekürzter Wert wird nie geschrieben.
 * - `seit_uebernahme_geaendert` (Rücknahme): Der Istwert ist nicht mehr der, den die Übernahme hinterließ; ein Wert, den seitdem jemand geändert hat, bleibt.
 * - D-2 (Orte, Wege, Gebiete, Landschaften):
 *   - `weitere_zuweisung`: Der Artikel hängt am Weg nur als weitere Zuweisung (nicht als Hauptzuweisung); seinen Wiki-Stand pflegt diese Übernahme nicht.
 *   - `schnappschuss_schlank`: Der Wiki-Stand des Wegartikels ist schlank (nur Schlüssel, Name, Art und Wegart); die Übernahme legt dort keine Texte an.
 *   - `wert_unzulaessig`: Der Wiki-Wert passt nicht in das Feld (eine Ortsgröße, die es nicht gibt, ein Wegart-Wort, das weder Straße noch Fluss ist).
 *   - `name_gesperrt`: Der Name bleibt, weil er nicht ohne Weiteres wechselt (der Kontinent, der das Gelände rahmt).
 */
export const WIKISYNC_UEBERNAHME_BEFUNDE = [
    "seit_vorschau_geaendert",
    "kein_schnappschuss",
    "name_leer",
    "name_vergeben",
    "linie_unvollstaendig",
    "wert_gekuerzt",
    "seit_uebernahme_geaendert",
    "weitere_zuweisung",
    "schnappschuss_schlank",
    "wert_unzulaessig",
    "name_gesperrt",
] as const;
export type WikisyncUebernahmeBefund = (typeof WIKISYNC_UEBERNAHME_BEFUNDE)[number];

/** Die letzte Übernahme oder Rücknahme eines Bereichs, kurz. */
export const WikisyncUebernahmeKurz = Type.Object(
    {
        id: Type.Integer(),
        art: union(WIKISYNC_UEBERNAHME_ART),
        /** Der Lauf der Vorschau, aus dem übernommen wurde. */
        lauf: Type.Integer(),
        status: union(WIKISYNC_UEBERNAHME_STATUS),
        gestartetAm: Type.String(),
        beendetAm: nullable(Type.String()),
        /** Wer es ausgelöst hat (Name oder „automatisch“); `null`: nicht belegt. */
        ausgeloestVon: nullable(Type.String()),
        grund: nullable(Type.String()),
        /** Felder, die geschrieben wurden (wirksam, Herkunft oder Wiki-Wert); 0: Es gab nichts zu tun. */
        felder: Type.Integer(),
        befunde: Type.Integer(),
        /** Felder, die schon dem Wiki glichen („unverändert“); fehlt, wo das Protokoll die Zahl nicht führt (eine Rücknahme, ein älterer Lauf). */
        gleich: Type.Optional(Type.Integer()),
        /** Nur bei den Quellen (WI-0253 §21): angelegte und still gelegte Verknüpfungen und angelegte Katalogquellen; bei den Sprachen (WI-0261 S3) angelegte Sprachartikel; fehlen, wo die Übernahme keine führt. */
        angelegt: Type.Optional(Type.Integer()),
        stillgelegt: Type.Optional(Type.Integer()),
        quellenAngelegt: Type.Optional(Type.Integer()),
        /** Ob eine Rücknahme diese Übernahme zurückgenommen hat. */
        zurueckgenommen: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type WikisyncUebernahmeKurz = Static<typeof WikisyncUebernahmeKurz>;

export const WikisyncBereichStand = Type.Object(
    {
        bereich: WikisyncBereichName,
        /** Hat die Übernahme für diesen Bereich einen Schreiber? Nur dann gehört er dem WikiSync und lässt sich übernehmen. */
        angeschlossen: Type.Boolean(),
        /** Hat der Bereich Kategorien aus der Datei, die die Vorschau vor der Übernahme gelesen haben muss? */
        kategorien: Type.Boolean(),
        letzteUebernahme: nullable(WikisyncUebernahmeKurz),
    },
    { additionalProperties: false },
);
export type WikisyncBereichStand = Static<typeof WikisyncBereichStand>;

export const WikisyncBereiche = Type.Object(
    {
        jetzt: Type.String(),
        bereiche: Type.Array(WikisyncBereichStand),
    },
    { additionalProperties: false },
);
export type WikisyncBereiche = Static<typeof WikisyncBereiche>;

const strict = { additionalProperties: false } as const;

export const WikisyncVorschauBody = Type.Object(
    {
        operationId: OperationId,
        /** Ohne Angabe alle Bereiche. */
        bereiche: Type.Optional(
            Type.Array(WikisyncBereichName, { minItems: 1, maxItems: WIKISYNC_BEREICHE.length, uniqueItems: true }),
        ),
    },
    strict,
);
export type WikisyncVorschauBody = Static<typeof WikisyncVorschauBody>;

/**
 * Wie weit ein Start von „WikiSync starten“ zurückgeht (Variante A des Ablaufs, WI-0253 §20; Vali 2026-10-26: „ich finde den workflow etwas kompliziert“):
 *
 * - **ohne Angabe:** aus der jüngsten Vorschau übernehmen, wie bisher (API und Werkzeuge; die Oberfläche nutzt es nicht mehr).
 * - **`ganz`:** ein verkettender Lauf. Der Auftrag der Vorschau liest den Dump und die Kategorien-Datei und reiht danach selbst die Übernahme ein. Ein Bereich mit Kategorien wird erst übernommen,
 *   wenn die Vorschau eine Kategorien-Datei gelesen hat (WI-0294), ein Abbruch lässt nichts halb geschrieben. `lauf` gibt es hier nicht: Die Vorschau entsteht im Lauf.
 *
 * (`fortsetzen`, das Fortsetzen eines angehaltenen Wiki-Teils, gibt es seit WI-0294 nicht mehr: Es gibt keinen Wiki-Teil, den man fortsetzen könnte.)
 */
export const WIKISYNC_ABLAEUFE = ["ganz"] as const;
export type WikisyncAblauf = (typeof WIKISYNC_ABLAEUFE)[number];

/**
 * Entweder `bereiche` (ein oder mehrere, Recht ab `editor`) oder `alle: true` (alle Bereiche, die dem WikiSync gehören, Recht ab `admin`). `lauf`: der Lauf der
 * Vorschau; ohne Angabe gilt je Bereich der jüngste fertige. `ablauf`: ein verkettender Lauf statt der Übernahme aus einer vorhandenen Vorschau (siehe `WIKISYNC_ABLAEUFE`).
 */
export const WikisyncUebernehmenBody = Type.Object(
    {
        operationId: OperationId,
        bereiche: Type.Optional(
            Type.Array(WikisyncBereichName, { minItems: 1, maxItems: WIKISYNC_BEREICHE.length, uniqueItems: true }),
        ),
        alle: Type.Optional(Type.Literal(true)),
        lauf: Type.Optional(Type.Integer({ minimum: 1 })),
        ablauf: Type.Optional(union(WIKISYNC_ABLAEUFE)),
    },
    strict,
);
export type WikisyncUebernehmenBody = Static<typeof WikisyncUebernehmenBody>;

export const WikisyncZuruecknehmenBody = Type.Object(
    {
        operationId: OperationId,
        /** Der Lauf der Vorschau, aus dem übernommen wurde, und der Bereich: eine Rücknahme gilt je Bereich; ohne `bereich` der ganze Lauf (alle Bereiche, die er übernahm). */
        lauf: Type.Integer({ minimum: 1 }),
        bereich: Type.Optional(WikisyncBereichName),
    },
    strict,
);
export type WikisyncZuruecknehmenBody = Static<typeof WikisyncZuruecknehmenBody>;

// ── Der Abruf beim Wiki ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Warum ein Abruf beim Wiki in dieser Umgebung nicht entsteht (`wikiAbrufErlaubt`). */
export const WIKISYNC_ABRUF_GRUENDE = ["umgebung", "release", "takt"] as const;
export type WikisyncAbrufGrund = (typeof WIKISYNC_ABRUF_GRUENDE)[number];

/** Entsteht in dieser Umgebung überhaupt ein Abruf beim Wiki (der Vergleich eines einzelnen Artikels)? Lokal nie (die harte Sperre). */
export const WikisyncAbruf = Type.Object(
    {
        erlaubt: Type.Boolean(),
        grund: nullable(union(WIKISYNC_ABRUF_GRUENDE)),
        text: nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type WikisyncAbruf = Static<typeof WikisyncAbruf>;

// ── D-2: Einen ganzen Lauf zurücknehmen, einen Artikel vergleichen ───────────────────────────────────────────

/**
 * Was die Steuerung (UI-3) zusätzlich anstößt:
 *
 *  *     POST /api/admin/wikisync/zuruecknehmen { operationId, lauf, bereich? }          ohne `bereich`: den ganzen Lauf            undo_wikisync_run (`admin`) + Passkey
 *     POST /api/admin/wikisync/artikel      { operationId, titel }                    EINEN Artikel über die API vergleichen   compare_wiki_article (`editor`, ohne Passkey)
 *     GET  /api/admin/wikisync/artikel                                                die jüngsten Vergleiche mit ihren Zeilen    view_wikisync (ab `tester`)
 *
 * 🔴 Alles, was das Wiki anfragt (der Einzelartikel), sagt zuerst, ob die Umgebung es darf (`wikiAbrufErlaubt`: lokal nie), und reiht dann einen Auftrag ein; keine Route fragt das Wiki
 * selbst, und im Browser fragt niemand das Wiki.
 */
export const WIKISYNC_ARTIKEL_URL = "/api/admin/wikisync/artikel";

/** Die Länge eines Artikeltitels, den die Steuerung annimmt (MediaWiki erlaubt 255 Bytes). */
export const WIKISYNC_ARTIKEL_TITEL_MAX = 200;

/** Zeichen, die in keinem MediaWiki-Titel stehen dürfen (und mit `|` eine zweite Seite in die Anfrage schmuggelten); dazu kommen die Steuerzeichen (`artikelTitelOk`). */
export const WIKISYNC_ARTIKEL_TITEL_VERBOTEN = /[#<>[\]|{}]/u;

export const WikisyncArtikelBody = Type.Object(
    {
        operationId: OperationId,
        titel: Type.String({ minLength: 1, maxLength: WIKISYNC_ARTIKEL_TITEL_MAX }),
    },
    strict,
);
export type WikisyncArtikelBody = Static<typeof WikisyncArtikelBody>;

/** Der Vergleich eines Artikels: die Planzeilen der Objekte, die an ihm hängen (ein Vergleich, nie eine Übernahme). */
export const WikisyncArtikelVergleich = Type.Object(
    {
        id: Type.Integer(),
        /** Der Titel, den die Person nannte, und der, unter dem das Wiki den Artikel führt (nach einer Weiterleitung). */
        titel: Type.String(),
        wikiTitel: nullable(Type.String()),
        wikiNamensraum: nullable(Type.Integer()),
        /** Die Fassung des Artikels, die verglichen wurde. */
        wikiRevision: nullable(Type.Integer()),
        wikiStand: nullable(Type.String()),
        status: union(WIKISYNC_LAUF_STATUS),
        gestartetAm: Type.String(),
        beendetAm: nullable(Type.String()),
        ausgeloestVon: nullable(Type.String()),
        fehlerCode: nullable(Type.String()),
        fehler: nullable(Type.String()),
        zahlen: Type.Record(Type.String(), WikisyncBereichZahlen),
        /** Dieselbe Form wie die Zeilen des Berichts; `laufId` ist die Nummer des Vergleichs. */
        zeilen: Type.Array(WikisyncZeile),
    },
    strict,
);
export type WikisyncArtikelVergleich = Static<typeof WikisyncArtikelVergleich>;

export const WikisyncArtikelListe = Type.Object(
    {
        jetzt: Type.String(),
        /** Darf diese Umgebung einen Artikel beim Wiki abrufen? Lokal nie; die Oberfläche sagt es vor dem Klick. */
        abruf: WikisyncAbruf,
        vergleiche: Type.Array(WikisyncArtikelVergleich),
    },
    strict,
);
export type WikisyncArtikelListe = Static<typeof WikisyncArtikelListe>;
