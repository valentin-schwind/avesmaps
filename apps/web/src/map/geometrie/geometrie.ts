/**
 * Das gemeinsame Geometrie-Modul der Editoren: Anfasser, Einrasten, Hülle, Andockmarken und Kringel auf der Karte, für jede Art
 * von Objekt gleich (WI-0177; Zuteilung der Editor-Orchestrierung 2026-10-15; EDIT-0001 §4.7 G4). Der Wegeditor ist der erste
 * Nutzer („Wegkurve bearbeiten“); Fläche (WI-0178) und Ort (Verschieben, WI-0177 Stufe 4) docken als Art an, ohne Umbau; die
 * Kraftlinie (WI-0205) bringt die Zielart `label`, „Strg löst nicht“ und den Steuergriff je Teil mit.
 *
 * ## Die Schnittstelle
 *
 * **Eine Art** (`GeometrieArt`) sagt, wie ihre Objekte gebaut sind und sich verhalten. Alles andere ist für alle Arten gleich.
 *
 * | Feld | Bedeutung | Weg | Fläche | Ort | Kraftlinie |
 * |---|---|---|---|---|---|
 * | `teilart` | woraus ein Objekt besteht | `linie` | `ring` (auch mehrere, auch Löcher) | `punkt` | `linie`, je Abschnitt ein Teil aus zwei Enden |
 * | `rundung` | wie die Vorschau gezeichnet wird | Catmull-Rom (`LEGACY_CATMULL`) | Chaikin-Netz (aus shared, WI-0178) | keine | Legacys Parabel (`powerlineDrawnPath`) mit `Teil.wert` |
 * | `ziele` | welche Zielarten ein Punkt beim Ziehen annimmt | Enden: `ort`, `ecke`; innen: keine | `ecke`, `kante` | Wegenden (später) | `ort`, `label`, `ecke` (nur Nodices) |
 * | `zielErlaubt` | welches einzelne Ziel nicht in Frage kommt | das Ziel am anderen Ende (Anfang ≠ Ende) | die eigene Fläche | — | das andere Ende des Abschnitts |
 * | `mindestens` | Punkte je Teil | 2 | 3 | 1 | 2 |
 * | `loeschbar` | Doppelklick auf einen Anfasser löscht | nie die Enden | jede Ecke | nie | nie |
 * | `einfuegen` | Doppelklick auf die Kante setzt einen Punkt | ja | ja | nein | nein |
 * | `speichern` | wann gespeichert wird | `sofort` | `gebuendelt`, 800 ms | `sofort` | Entwurf, „Fertig“ schreibt |
 * | `mitziehen` | ziehen deckungsgleiche Punkte anderer Objekte mit | ja, nur am Knoten ohne Ort | ja (geteilte Ecken) | Wegenden am Ort | nein |
 * | `huelleInRuhe` | zeigt die Hülle schon ohne Ziehen | an den Enden | nein | ja (der Griffring) | nein |
 * | `loesen` | Strg (am Finger: langer Druck) löst | ja | ja | ja | **nein** (G4 gilt nicht) |
 * | `strgTeilt` | Strg über der Kante setzt vier Punkte (bei `einfuegen`) | ja | ja | – | – (Gebirgsnetz: **nein**) |
 * | `steuergriff` | ein Griff je Teil, der kein Punkt ist | – | – | – | der Scheitel des Bogens (`curve`, ±45 %) |
 * | `markieren` | Umschalt + Klick markiert Ecken, ein Zug bewegt alle markierten | – | ja (auch Gebiet und Sprache) | – | – |
 *
 * **Ein Teil** (`Teil`) ist ein Stück Geometrie eines Objekts in Karteneinheiten: die Linie eines Wegs, ein Ring einer Fläche, der
 * Punkt eines Orts. **Ein Anfasser** kennt ALLE Stellen, die genau auf ihm liegen (`knotenAn`, fünf Nachkommastellen): die des
 * bearbeiteten Objekts und die der Nachbarn. Ziehen nimmt die Nachbarn mit, wenn die Art es erlaubt und kein Ort dort steht.
 *
 * **Ein Ziel** (`Ziel`) ist, woran ein gezogener Punkt einrasten kann: `ort` (ein Ort), `label` (eine Beschriftung der Karte, etwa
 * ein Nodix ohne Ort), `ecke` (ein Stützpunkt oder eine Ecke eines anderen Objekts), `kante` (ein Punkt auf der Strecke dazwischen).
 * Eingerastet wird im Bildschirmmaß innerhalb des Fangradius (Karteneinstellung `fangradius`, eine Zahl für alle Editoren); eine
 * Ecke, ein Ort oder eine Beschriftung geht vor einer Kante, sonst die Nähe.
 *
 * **Eine Handbewegung** (`Aenderung`) meldet der Modus dem Aufrufer, wenn sie fertig ist: die neuen Teile, die mitgezogenen Punkte
 * der Nachbarn, das Einrastziel. Gespeichert wird beim Aufrufer (je Art sofort oder gebündelt); der Modus fragt während einer Geste
 * NIE den Server (AGENTS „Beim Ziehen wird nicht nachgeschlagen“).
 *
 * **Strg heißt lösen** (G4, Betreiber 2026-10-15 zum Wegeditor): Wird Strg während eines Zugs einmal gedrückt, rastet bis zum
 * Loslassen nichts ein und nichts zieht mit. Am Finger trennt ein langer Druck vor dem Ziehen. Eine Art mit `loesen: false`
 * (Kraftlinie: ihre Enden hängen immer an einem Nodix, T28) kennt das nicht; Strg und langer Druck ändern dort nichts.
 *
 * **Ein Steuergriff** (`Steuergriff`, Kraftlinie) ist ein Griff je Teil, der kein Punkt des Teils ist: Die Art sagt, wo er liegt und
 * welchen Wert eine Zeigerlage ergibt (`Teil.wert`). Der Modus zeichnet ihn, macht ihn treffbar und meldet beim Loslassen EINE
 * Handbewegung `steuern` mit dem neuen Wert; die Punkte bleiben, wie sie sind, und kein Wert fragt während des Zugs den Server.
 *
 * **Farben** (Betreiber 2026-10-15, `docs/regeln/oberflaeche.md`): was bearbeitet wird, Knallrot (`editEdge`); bestätigter Anschluss
 * `success`; offenes Ende `warningSoftBorder`. Keine eigene Farbe je Art.
 *
 * **Rückgängig (Strg+Z) ist offen** (Editor-Orchestrierung): Der Modus hält keinen eigenen Verlauf und schreibt nichts, was einem
 * späteren Rückgängig im Weg stünde; jede Handbewegung ist eine abgeschlossene Änderung mit Vorher und Nachher.
 *
 * **Anlegen** (ein neues Objekt Punkt für Punkt zeichnen) ist der zweite Modus desselben Moduls und desselben Besitzers; seine
 * Schnittstelle steht im Kopf von `anlegen.ts` (je Art eine `AnlegenArt`, Weg als erste).
 *
 * Dateien: `rechnung.ts` (reine Rechnung, ohne Karte), `arten.ts` (die Arten), `bild.ts` (was gezeichnet wird), `schicht.ts`
 * (Quelle, Ebenen und Ringe auf der Karte), `modus.ts` (der eine Besitzer „Geometrie bearbeiten“ im Koordinator), `besitzer.ts` (seine
 * Anmeldung für beide Modi), `anlegen.ts`, `anlegen-bild.ts`, `anlegen-modus.ts`, `anlegen-schild.vue` und `klicktoleranz.ts` (Anlegen).
 */

/** Ein Punkt in Karteneinheiten des Gebiets (`AVENTURIA.coordinateSpace`): die Einheit, in der gespeichert wird. */
export interface Punkt {
    readonly x: number;
    readonly y: number;
}

/** Ein Punkt am Schirm, in Bildpunkten der Karte. */
export interface Pixel {
    readonly x: number;
    readonly y: number;
}

export type Teilart = "punkt" | "linie" | "ring";

/** Ein Stück Geometrie eines Objekts. Ein Objekt kann mehrere Teile haben (Teilflächen, Löcher); `nr` zählt sie. */
export interface Teil {
    readonly objekt: string;
    readonly name: string;
    readonly nr: number;
    readonly art: Teilart;
    readonly punkte: readonly Punkt[];
    /** Die Revision des Objekts, gegen die gespeichert wird. */
    readonly revision: number;
    /** Der Wert des Steuergriffs dieses Teils (Kraftlinie: der Bogen in Prozent der Sehne); nur bei einer Art mit Steuergriff. */
    readonly wert?: number | undefined;
    /**
     * Das Polygon, zu dem dieser Ring gehört, wenn ein Werkzeug die Ringe einer Fläche neu gelegt hat (Pinsel der Derographie: neue
     * Stücke, neue Löcher). Fehlt es, gilt der Aufbau des gelesenen Stands (`formoperation.ts`).
     */
    readonly stueck?: number | undefined;
    /**
     * Ein Teil nur zum Wählen (WI-0249, Flüsse und Seen im Kammeditor; Vali 2026-10-25: „ein fluss wird aber nicht im kammeditor erstellt, sondern
     * automatisch erkannt und ist einfach "da" wo er ist“): Seine Anfasser lassen sich nicht ziehen, ein Doppelklick setzt und löscht nichts,
     * nichts zieht mit ihm mit. Gezeichnet in der Farbe des Wassers (`profileRiver`).
     */
    readonly fest?: boolean | undefined;
    /**
     * Die Nachbarn eines Stücks im ganzen Verlauf, die nicht dazugehören (WI-0259, Flüsse im Kammeditor): Ein Fluss, der die Fläche verlässt,
     * hat dort einen Nachbarn außerhalb. Er wird nicht gezeichnet und nicht angefasst, aber die Rundung (Catmull-Rom wie auf der Karte)
     * nimmt ihn für die Tangente am Ende des Stücks.
     */
    readonly anschluss?: { readonly vor?: Punkt | undefined; readonly nach?: Punkt | undefined } | undefined;
}

/** Ein Punkt eines Teils. */
export interface Stelle {
    readonly objekt: string;
    readonly nr: number;
    readonly index: number;
}

/**
 * `gipfel` (WI-0245, EDIT-0003 §6 „Gebirgsnetz“): ein Gipfel oder Nebengipfel, an dem ein Kamm einrastet; nur das Gebirgsnetz nennt
 * ihn (`GEBIRGSNETZ`, `KAMM_ANLEGEN`), bis ein anderer Editor ihn ausdrücklich will.
 */
export type Zielart = "ort" | "label" | "ecke" | "kante" | "gipfel";

/** Woran ein gezogener Punkt einrasten kann. Bei `kante` ist `at` der Anfang und `bis` das Ende der Strecke. */
export interface Ziel {
    readonly art: Zielart;
    readonly at: Punkt;
    readonly bis?: Punkt;
    readonly objekt: string;
    readonly name: string;
    /** Bei `ecke`/`kante`: der Punkt (bzw. Anfang der Strecke) im Teil des anderen Objekts. */
    readonly stelle?: Stelle;
}

/** Ein Einrasten: das Ziel und der Punkt, an dem der gezogene Punkt nun liegt (bei einer Kante der Fußpunkt). */
export interface Treffer {
    readonly ziel: Ziel;
    readonly at: Punkt;
    /** Abstand in Bildpunkten. */
    readonly abstand: number;
}

/** Wann eine Art speichert: jede Handbewegung sofort, oder gebündelt bis `ms` nach dem letzten Loslassen (Flächen, G4). */
export type Speicherweise = { readonly art: "sofort" } | { readonly art: "gebuendelt"; readonly ms: number };

/**
 * Ein Griff je Teil, der kein Punkt des Teils ist (Tafel oben, Kraftlinie: der Scheitel des Bogens). `lage` sagt, wo er liegt, `wert`
 * rechnet aus der Lage des Zeigers den neuen Wert, schon begrenzt und gerundet. Beides ist reine Rechnung ohne Server.
 */
export interface Steuergriff {
    lage(teil: Teil): Punkt | undefined;
    wert(teil: Teil, zeiger: Punkt): number;
}

/** Die Art eines Objekts: wie es gebaut ist, gerundet, eingerastet und gespeichert wird (Tafel oben). */
export interface GeometrieArt {
    readonly id: string;
    readonly teilart: Teilart;
    /** Die Vorschau der Punkte; `teil` trägt den Wert des Steuergriffs für Arten, deren Rundung von ihm abhängt. */
    rundung(punkte: readonly Punkt[], teil?: Teil): Punkt[];
    ziele(stelle: Stelle, teil: Teil): readonly Zielart[];
    zielErlaubt(ziel: Ziel, stelle: Stelle, teil: Teil): boolean;
    readonly mindestens: number;
    loeschbar(stelle: Stelle, teil: Teil): boolean;
    /**
     * Doppelklick auf eine Ecke eines Teils, der nur noch die Mindestzahl hat, löscht den ganzen Teil, solange das Objekt weitere hat (`ohneTeil`; nur das Gebiet, OPS-000078: Ein Splitter
     * aus drei Ecken ließ sich im Modus sonst nicht loswerden). Die Fläche und die Sprache haben dafür „Unterfläche löschen“.
     */
    readonly teilLoeschbar?: boolean;
    readonly einfuegen: boolean;
    readonly speichern: Speicherweise;
    readonly mitziehen: boolean;
    huelleInRuhe(stelle: Stelle, teil: Teil): boolean;
    /**
     * Zeigt neben der gerundeten Vorschau den eckigen Umriss dünn (Fläche, EDIT-0003 T27 (6): „beim Ziehen die fertige Rundung live,
     * die Ecken dünn dazu“). Ohne Angabe nur die Vorschau.
     */
    readonly eckenZeigen?: boolean;
    /** `false`: Strg und der lange Druck am Finger lösen nichts (Kraftlinie). Ohne Angabe lösen sie (G4). */
    readonly loesen?: false;
    /**
     * `false`: Strg über einer Kante zeigt keine vier Punkte, und Strg + Klick setzt sie nicht (Gebirgsnetz, WI-0249, Betreiber
     * 2026-10-25: „strg soll im kamm editor NICHT die teilung von kämmen bewirken“). Ohne Angabe teilt Strg bei einer Art mit `einfuegen`.
     */
    readonly strgTeilt?: false;
    /** Ein Griff je Teil, der kein Punkt ist (Kraftlinie: der Scheitel des Bogens). */
    readonly steuergriff?: Steuergriff;
    /** Umschalt + Klick markiert Ecken, ein Zug an einer markierten bewegt alle (Kopf von `modus.ts`, „Mehrere Ecken markieren“; alle Flächen, OPS-000081). */
    readonly markieren?: true;
}

/** Ein mitgezogener Punkt eines anderen Objekts. */
export interface Mitgezogen {
    readonly stelle: Stelle;
    readonly revision: number;
    readonly von: Punkt;
    readonly nach: Punkt;
}

/**
 * Ein Punkt, der beim Einfügen auf einer gemeinsamen Kante auch in einen Nachbarn kam (Thomas 2026-10-19, 5.2: „Wird auf einer
 * gemeinsamen Grenze zweier Herrschaftsgebiete ein neuer Punkt hinzugefügt, soll dieser automatisch auch beim angrenzenden Gebiet als
 * verknüpfter Grenzpunkt eingefügt werden“). `stelle.index` ist die Stelle NACH dem Einfügen.
 */
export interface Eingefuegt {
    readonly stelle: Stelle;
    readonly revision: number;
    readonly at: Punkt;
}

/** Eine fertige Handbewegung. */
export interface Aenderung {
    readonly art: "ziehen" | "einfuegen" | "loeschen" | "steuern";
    /**
     * Die bewegte, neue oder gelöschte Stelle (bei `loeschen` der Index vor dem Löschen); bei `steuern` der Teil mit `index` -1, sein
     * neuer Wert steht in `teile` (`Teil.wert`).
     */
    readonly stelle: Stelle;
    /** Beim Ziehen mehrerer markierter Ecken: die übrigen neben `stelle`. */
    readonly auch?: readonly Stelle[];
    /** Die Teile des bearbeiteten Objekts nach der Handbewegung. */
    readonly teile: readonly Teil[];
    readonly mitgezogen: readonly Mitgezogen[];
    /** Beim Einfügen auf einer gemeinsamen Kante: derselbe Punkt in den Nachbarn (nur Ringe). */
    readonly eingefuegt?: readonly Eingefuegt[];
    /** Beim Löschen: die Punkte der Nachbarn auf derselben Ecke (nur Ringe); was davon geht, entscheidet der Entwurf (`ausDemEntwurf`). */
    readonly entfernt?: readonly { readonly stelle: Stelle }[];
    readonly treffer: Treffer | undefined;
    /** Mit Strg (oder langem Druck am Finger) gelöst. */
    readonly getrennt: boolean;
}

/**
 * Eine Marke an einem Punkt, die der Aufrufer setzt: ein bestätigter Anschluss (grün), ein offenes Ende (Bernstein) oder die Stelle, an der
 * der Server eine Form abgelehnt hat (rot, `form-ungueltig.ts`).
 */
export interface Marke {
    readonly at: Punkt;
    readonly art: "bestaetigt" | "frei" | "fehler";
    readonly text?: string;
}
