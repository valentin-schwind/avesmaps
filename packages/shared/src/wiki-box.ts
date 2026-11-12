import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId } from "./operation.ts";

/**
 * Die Wiki-Box im Objekteditor (WI-0253, Scheibe „Objekt-Sync am WikiFeld“; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`, abgenommen vom Betreiber 2026-10-25: „perfekt das wollen wir“).
 * EIN Kasten „Wiki“ in jedem Objektfenster, das Wiki-Felder trägt (Ort, Weg, Herrschaftsgebiet, Landschaft, Kraftlinie, Gipfel; der Gipfel ist jede Zeile von `terrain_peak`, also auch jede Landmarke, WI-0271 L4):
 * der Artikel und sein Schlüssel, drei Knöpfe (Zuweisen bzw. Ändern, Sync aktualisieren, Entfernen), der Stand des letzten Syncs mit Zeit, Ergebnis und Auslöser.
 *
 *     GET  /api/editor/wiki-box/:art/:id                 der Stand der Box                                           use_editor_menu (ab Reviewer)
 *     GET  /api/editor/wiki-box/:art/:id/suche?q=        die Artikel zum Zuweisen (höchstens 40)                     use_editor_menu
 *     POST /api/editor/wiki-box/:art/:id/zuweisen        { operationId, key }   den Artikel zuordnen, SOFORT        edit_map_objects (ab Editor)
 *     POST /api/editor/wiki-box/:art/:id/entfernen       { operationId }        die Zuordnung lösen, SOFORT          edit_map_objects
 *     POST /api/editor/wiki-box/:art/:id/sync            { operationId }        den Artikel neu holen und anwenden   edit_map_objects
 *
 * - 🔴 **Zuweisen und Entfernen wirken sofort**, ohne „Speichern“: Der Server schreibt (eine Operation an der Karte, im Verlauf), ein Entwurf des Fensters ginge beim Neulesen verloren. Darum sperrt
 *   die Oberfläche alle drei Knöpfe, solange das Formular ungespeicherte Änderungen hat.
 * - **Entfernen** nimmt die Zuordnung weg; die Felder behalten ihre Werte und gelten danach als eigene (Herkunft manuell); ein Feld, das nur dem Wiki folgte (leer, der Leser zeigte den Wiki-Wert), bekommt
 *   diesen Wert als eigenen.
 * - **Sync aktualisieren** reiht den Auftrag `wiki_artikel` mit dem Objekt ein: eine Wiki-Anfrage ohne Anmeldung im Takt von 20 Sekunden, danach die wiki-eigenen Felder DIESES Objekts (die Schreiber der
 *   Übernahme, `wiki/abgleich/uebernahme/`); Felder mit eigenem Wert bleiben. Der Klick wartet nicht auf die Antwort; die Box fragt den Stand nach.
 * - **Lokal ist der Abruf gesperrt** (`abruf_gesperrt`, 409): Die Box nennt den Grund; Zuweisen und Entfernen wirken trotzdem. Gehört der Bereich in dieser Umgebung noch dem Legacy-Zug
 *   (`gehoert_legacy`, 409), schreibt der Sync nicht in die Wiki-Felder dieser Art.
 * - **Weitere Artikel** (WI-0300, OPS-000108; Option „Anlegen und lösen“ von Vali gewählt am 2026-11-09): Nur ein Weg trägt neben seinem Hauptartikel weitere, etwa einen Pilgerweg über einer Reichsstraße
 *   (Legacy `wiki_path_weitere`, hier `path_wiki_assignment` mit der Rolle `further`). Sie ändern nie Name, Gruppe oder Art des Wegs. Die Box zeigt sie nur an:
 *   Seit WI-0302 sind sie die weiteren Straßennamen je Abschnitt im Wegeditor (`path.update`, `sections[].weitere`). „Entfernen“ (der Hauptartikel) und „Auswahl zu neuem Weg“ lassen sie stehen.
 */

export const WIKI_BOX_ARTEN = ["ort", "weg", "gebiet", "region", "kraftlinie", "gipfel"] as const;
export type WikiBoxArt = (typeof WIKI_BOX_ARTEN)[number];

export const isWikiBoxArt = (wert: string): wert is WikiBoxArt => (WIKI_BOX_ARTEN as readonly string[]).includes(wert);

export const EDITOR_WIKI_BOX_URL = "/api/editor/wiki-box";
export const wikiBoxUrl = (art: WikiBoxArt, id: string): string => `${EDITOR_WIKI_BOX_URL}/${art}/${id}`;
export const wikiBoxSucheUrl = (art: WikiBoxArt, id: string): string => `${wikiBoxUrl(art, id)}/suche`;
export const wikiBoxZuweisenUrl = (art: WikiBoxArt, id: string): string => `${wikiBoxUrl(art, id)}/zuweisen`;
export const wikiBoxEntfernenUrl = (art: WikiBoxArt, id: string): string => `${wikiBoxUrl(art, id)}/entfernen`;
export const wikiBoxSyncUrl = (art: WikiBoxArt, id: string): string => `${wikiBoxUrl(art, id)}/sync`;

/** Die Arten, die neben dem Hauptartikel weitere Artikel tragen (WI-0300): nur der Weg. */
export const WIKI_BOX_MIT_WEITEREN: readonly WikiBoxArt[] = ["weg"];
export const hatWeitereArtikel = (art: WikiBoxArt): boolean => WIKI_BOX_MIT_WEITEREN.includes(art);

/** So viele Artikel nennt die Suche höchstens (Legacys Picker: 40). */
export const WIKI_BOX_TREFFER_MAX = 40;

const strict = { additionalProperties: false } as const;
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** Das Ergebnis des letzten Syncs. `stand`: der Wiki-Stand ist aktuell, kein Feld änderte sich (alle Felder mit eigenem Wert). */
export const WIKI_BOX_ERGEBNISSE = ["uebernommen", "stand", "keine_aenderung", "fehlgeschlagen"] as const;
export type WikiBoxErgebnis = (typeof WIKI_BOX_ERGEBNISSE)[number];

/**
 * Warum der Sync-Knopf nichts tut (neben ungespeicherten Änderungen und einem laufenden Sync, die die Oberfläche kennt): kein Artikel zugeordnet · der Artikel hat noch keinen Wiki-Stand (eine Zuordnung nur
 * mit Adresse, oder eine fremde Adresse) · lokal gibt es keinen Abruf · der Bereich gehört in dieser Umgebung noch dem Legacy-Zug.
 */
export const WIKI_BOX_SYNC_GRUENDE = ["abruf_gesperrt", "gehoert_legacy", "kein_artikel", "kein_stand"] as const;
export type WikiBoxSyncGrund = (typeof WIKI_BOX_SYNC_GRUENDE)[number];

/** Der letzte Sync: Zeit, Ergebnis und wer ihn ausgelöst hat (ein Name, oder `null`: der automatische WikiSync-Lauf). */
export const WikiBoxLetzter = Type.Object(
    {
        am: Type.String(),
        ergebnis: Type.Union(WIKI_BOX_ERGEBNISSE.map((wert) => Type.Literal(wert))),
        /** Die Felder, die sich änderten (Schlüssel der Felder des Objekts, etwa `einwohner`); nur bei `uebernommen`. */
        felder: Type.Array(Type.String()),
        anzahl: Type.Integer({ minimum: 0 }),
        wer: nullable(Type.String()),
        automatisch: Type.Boolean(),
    },
    strict,
);
export type WikiBoxLetzter = Static<typeof WikiBoxLetzter>;

/** Der letzte Sync, der scheiterte (und seit dem letzten Erfolg nicht überholt ist): der Grund und, bei einer Drosselung, bis wann das Wiki Ruhe will. */
export const WikiBoxFehler = Type.Object(
    {
        am: Type.String(),
        code: Type.String(),
        /** Ende der Pause (ISO-Zeit); nur bei einer Drosselung (429) oder einer anderen Pause. */
        freiAb: nullable(Type.String()),
    },
    strict,
);
export type WikiBoxFehler = Static<typeof WikiBoxFehler>;

export const WikiBoxSync = Type.Object(
    {
        /** Darf der Sync jetzt angestoßen werden (Umgebung, Bereich, Artikel)? Das Recht prüft die Oberfläche am Fenster, der Server am Klick. */
        moeglich: Type.Boolean(),
        grund: Type.Optional(Type.Union(WIKI_BOX_SYNC_GRUENDE.map((wert) => Type.Literal(wert)))),
        /** Wartet ein Auftrag oder läuft er? Dann fragt die Box nach, bis er fertig ist. */
        laeuft: Type.Boolean(),
        letzter: nullable(WikiBoxLetzter),
        fehler: nullable(WikiBoxFehler),
    },
    strict,
);
export type WikiBoxSync = Static<typeof WikiBoxSync>;

export const WikiBoxArtikel = Type.Object(
    {
        /** Die Identität des Artikels (Wiki-Key); die Adresse kann sich mit einer Umbenennung ändern. */
        key: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        name: Type.String(),
    },
    strict,
);
export type WikiBoxArtikel = Static<typeof WikiBoxArtikel>;

/** Ein weiterer Artikel eines Wegs (WI-0300): wie der Hauptartikel, dazu an wie vielen Abschnitten der Straße er hängt („3/7“); fehlt, wenn an allen. */
export const WikiBoxWeiterer = Type.Object(
    {
        key: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        name: Type.String(),
        anteil: Type.Optional(
            Type.Object({ mit: Type.Integer({ minimum: 0 }), von: Type.Integer({ minimum: 1 }) }, strict),
        ),
    },
    strict,
);
export type WikiBoxWeiterer = Static<typeof WikiBoxWeiterer>;

export const WikiBoxStand = Type.Object(
    {
        art: Type.Union(WIKI_BOX_ARTEN.map((wert) => Type.Literal(wert))),
        id: Type.String(),
        name: Type.String(),
        artikel: nullable(WikiBoxArtikel),
        /** Straße, Linie und Landschaft bestehen aus Abschnitten: an wie vielen hängt der Artikel („5/7“)? Fehlt, wenn an allen. */
        anteil: Type.Optional(
            Type.Object({ mit: Type.Integer({ minimum: 0 }), von: Type.Integer({ minimum: 1 }) }, strict),
        ),
        sync: WikiBoxSync,
        /** Nur der Weg (WI-0300): die weiteren Artikel, nach Namen geordnet; leer, wenn er keine hat. Fehlt bei den übrigen Arten. */
        weitere: Type.Optional(Type.Array(WikiBoxWeiterer)),
    },
    strict,
);
export type WikiBoxStand = Static<typeof WikiBoxStand>;

export const WikiBoxZuweisenBody = Type.Object(
    { operationId: OperationId, key: Type.String({ minLength: 1, maxLength: 300 }) },
    strict,
);
export type WikiBoxZuweisenBody = Static<typeof WikiBoxZuweisenBody>;

export const WikiBoxOperationBody = Type.Object({ operationId: OperationId }, strict);
export type WikiBoxOperationBody = Static<typeof WikiBoxOperationBody>;

export const WikiBoxSuchAbfrage = Type.Object({ q: Type.Optional(Type.String({ maxLength: 200 })) }, strict);
export type WikiBoxSuchAbfrage = Static<typeof WikiBoxSuchAbfrage>;

/** Die Ergebnisse der Fehlercodes, die der Server nennt, in einem Wort für die Oberfläche (die Sätze stehen in den Sprachtafeln). */
export const WIKI_BOX_FEHLERCODES = [
    "abruf_gesperrt",
    "gehoert_legacy",
    "kein_artikel",
    "kein_objekt",
    "nicht_im_wiki",
    "pausiert",
    "http_429",
    "http_403",
    "verbindung",
    "http_fehler",
    "antwort_ungueltig",
    "abgebrochen",
    "fehler",
] as const;
