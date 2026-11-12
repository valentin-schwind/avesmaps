/**
 * Die Kenngrößen der Wegfindung (WI-0153): der Bestand der Zahlen, die über Routen entscheiden, mit ihrer Vorgabe,
 * ihrer Einheit, einem Satz in Alltagssprache und der Folge, die eine Änderung nach sich zieht.
 *
 * 🔴 **Diese Tafel ist die Quelle der Wahrheit** für den Reiter „Wegfindung“ in der Systemsteuerung, für den Leseweg
 * des Servers und für die Prüfung einer Eingabe. Die Konstanten im Routing bleiben die VORGABE; was hier steht, muss
 * mit ihnen übereinstimmen, und ein Test rechnet das nach (`wegfindung-vorgaben.test.ts`).
 *
 * **Der Bestand, kein Auszug** (Betreiber 2026-10-15: „grundsätzlich soll da alles stehen, was zentrale kenngrößen
 * sind (deine ganzen derzeitig einstellungen und konstanten wie z.B. limits)“). Draußen bleiben nur Datenformate und
 * Schlüsselzahlen (`PAIR_FLOATS`, `SAMPLE_HEADER`, `SAMPLE_POINT`, `STEP_FLOATS`, `SEA_GRAPH_FORMAT`, die
 * Markierungswerte `WATER`, `WALL`, `BLOCKED`, `KIND_*`): Wer sie verstellt, zerstört eine Datei, statt eine Route zu
 * ändern.
 *
 * Die Form des Reiters steht im Design Guide, Kapitel 8 „Seiten mit vielen Einstellungen“.
 */

/** Meilen je Karteneinheit (MCS-002); die Tafel rechnet ihre Meilenangaben damit. */
export const MEILEN_JE_EINHEIT = 3;

/**
 * Was eine Änderung dieses Werts nach sich zieht (Betreiber 2026-10-15: „nicht vergessen, schreib immer dazu, welche
 * werte eine neuberechnung erforderlich machen“):
 *
 * 🔴 **Jede Einordnung ist am Code geprüft** (2026-10-15, Zuordnung in WI-0153 §9): neun Zeilen standen vorher falsch
 * da. Die Einordnung bestimmt, was nach dem Speichern passiert — vor allem, ob der Knopf „Wegenetz neu berechnen“
 * überhaupt hilft. Lieber ehrlich still als falsch wach.
 *
 * - `netz`: Der Wert geht in den Aufbau des Wegenetzes (`buildRouteNetwork`, Revisionsteil `network`) und wirkt erst,
 *   wenn das Netz neu gebaut ist. Der Knopf oben tut genau das: gemessen 1 bis 2 Sekunden.
 * - `seegraph`: Der Wert geht in die Ableitung des Seegraphen (`sea-derive.ts`). Die ist teurer als ein Netzaufbau (zwei bis fünf
 *   Minuten) und kann Häfen ihre Anlegestelle nehmen. Der Knopf oben gibt ihn frei und reiht die Ableitung vor dem Neuladen ein
 *   (WI-0153 Schnitt 7c; Betreiber 2026-10-18: „Seewege“ über den einen Knopf).
 * - `sofort`: Der Wert wird je Anfrage gelesen (oder beim Zusammenstellen des nächsten Datenstands); es gibt nichts zu
 *   bauen, die nächste Routenanfrage rechnet damit.
 * - `zeichnung`: Nur die gezeichnete Linie ändert sich. Die Strecke, die gerechnet wird, bleibt dieselbe.
 */
export type WegfindungFolge = "netz" | "seegraph" | "sofort" | "zeichnung";

/** Der Satz, der an jeder Zeile sagt, was eine Änderung nach sich zieht. */
export const WEGFINDUNG_FOLGE_SATZ: Readonly<Record<WegfindungFolge, string>> = {
    netz: "Braucht ein Neuberechnen des Wegenetzes: der Knopf oben.",
    seegraph: "Braucht eine neue Ableitung des Seegraphen, zwei bis fünf Minuten: der Knopf oben.",
    sofort: "Gilt ohne Knopf, binnen fünf Sekunden.",
    zeichnung: "Ändert ohne Knopf nur das Bild, nicht die Strecke.",
};

/** Ein Wert, der aus dem Reisemodell stammt, trägt seine Herkunft; verstellen darf man ihn trotzdem. */
export interface WegfindungHerkunft {
    /** Das Feld in `config/travel-model/aventuria.json`. */
    feld: string;
    /** Was die Datei über die Zahl sagt, gekürzt. */
    satz: string;
}

export interface WegfindungWert {
    /** Die Kennung, unter der ein abweichender Wert gespeichert wird; aus dem Namen der Konstante. */
    id: string;
    name: string;
    folge: WegfindungFolge;
    /** Der Wert in Karteneinheiten; dann steht die Entsprechung in Meilen daneben. */
    einheiten?: number;
    /** Der Wert, wenn es keine Karteneinheiten sind, fertig geschrieben. */
    text?: string;
    /** Die Einheit hinter dem Feld, wo es keine Meilen sind (Stunden, Schritt, Stück). */
    einheit?: string;
    /** EIN Satz in Alltagssprache, höchstens zwei Zeilen lang. */
    satz: string;
    /** Die kleinste Zahl, die dieser Wert annehmen darf; die Vorgabe liegt immer darin. */
    min: number;
    /** Die größte Zahl, die dieser Wert annehmen darf. */
    max: number;
    /** Warum die Grenze dort liegt — je Wert aus seiner Bedeutung, nicht aus einer Formel. */
    grenze: string;
    /** Datei und Name im Code: die Stelle, an der die Vorgabe steht. */
    quelle: string;
    herkunft?: WegfindungHerkunft;
    /** Eine Zwischenüberschrift über die volle Breite, vor dieser Zeile. */
    abschnitt?: string;
}

export interface WegfindungPanel {
    titel: string;
    /** Die ruhige Zeile unter der Überschrift: wo die Werte dieses Panels wirken. */
    wirkung: string;
    werte: readonly WegfindungWert[];
}

const PANELE = [
    {
        titel: "Allgemeine Wegfindungseinstellungen",
        wirkung: "Die Grundwerte: wie Wege zusammenhängen, wie gerechnet und wie angezeigt wird.",
        werte: [
            {
                name: "Fangradius am Wegende",
                folge: "netz",
                einheiten: 0.02,
                satz:
                    "So nah müssen zwei Straßenenden beieinander liegen, damit sie als verbunden gelten. " +
                    "Darüber ist es eine Lücke, und die Route geht außen herum.",
                id: "endSnap",
                min: 0.001,
                max: 0.05,
                grenze: "Unter 0,001 liegt der Radius unter der Rundung der gespeicherten Geometrie (fünf Nachkommastellen) und fängt nie; über 0,05 wächst er in die Größenordnung des Ortskastens (0,5) und verbindet Wege, die getrennt gezeichnet sind. Gemessen sind 0,001 bis 0,02 (WI-0147).",
                quelle: "routing/topology.ts END_SNAP",
            },
            {
                name: "Ortskasten",
                folge: "netz",
                einheiten: 0.5,
                satz: "So weit darf ein Straßenende neben einem Ort liegen und trotzdem an ihm hängen.",
                id: "endpointBox",
                min: 0.1,
                max: 1,
                grenze: "Unter 0,1 verlieren Orte ihre Wegenden; über 1 greift ein Ort über eine ganze Karteneinheit (3 Meilen) nach fremden Wegen.",
                quelle: "routing/topology.ts ENDPOINT_BOX",
            },
            {
                name: "Exakter Treffer",
                // 🔴 Sofort, nicht Netz (WI-0214, gemessen 2026-10-17): Im Netzaufbau gewinnt ohne Legacys Listenreihenfolge
                // (`legacyOrder`, nur der Paritätsvergleich) ohnehin der nächste Ort im Ortskasten, mit und ohne exakten
                // Treffer (`createEndpointAttacher`). Wirkung hat der Wert nur im Infopanel (`subjects/path-route.ts`).
                folge: "sofort",
                einheiten: 0.01,
                satz:
                    "So nah muss ein Ort an einem Wegende liegen, damit das Infopanel ihn als Anfang oder Ende des " +
                    "Wegs nennt. In der Wegfindung hängt ein Wegende ohnehin am nächsten Ort im Ortskasten.",
                id: "exactHit",
                min: 1e-5,
                max: 0.05,
                grenze: "Unter 0,00001 ist der Treffer feiner als die gespeicherte Geometrie und nennt nie einen Ort; über 0,05 nennt das Infopanel Orte, die sichtbar neben dem Wegende liegen.",
                quelle: "routing/topology.ts EXACT_HIT",
            },
            {
                name: "Linie bis an den Ort",
                folge: "zeichnung",
                einheiten: 0.0005,
                satz:
                    "Ab dieser Lücke wird die gezeichnete Linie an den Ort gezogen; darunter liegt sie schon " +
                    "dort. Betrifft nur das Bild, nicht die Suche.",
                id: "nodeGap",
                min: 1e-5,
                max: 0.01,
                grenze: "Nur das Bild: über 0,01 (0,03 Meilen) zieht die Linie sichtbar an Orte, die die Route nicht berührt.",
                quelle: "routing/route-result.ts NODE_GAP",
            },
            {
                name: "Meilen je Karteneinheit",
                folge: "netz",
                text: "3",
                einheit: "Meilen",
                satz:
                    "Eine Karteneinheit sind 3 Meilen. Damit rechnen Strecken und Reisezeiten der Routen; " +
                    "Maßstabsleiste, Entfernungsmessung und Entfernungen auf der Karte bleiben bei 3.",
                id: "meilenJeKarteneinheit",
                min: 1,
                max: 10,
                grenze: "Setzung MCS-002 (1 Einheit = 3 Meilen = 3000 Schritt). Ein anderer Maßstab ändert JEDE Meilen- und Stundenangabe; die Spanne lässt Ausprobieren zu, nicht eine andere Welt. 🔴 Muss zu „Schritt je Karteneinheit“ passen.",
                quelle: "config/travel-model/aventuria.json meilenJeKarteneinheit",
                herkunft: {
                    feld: "meilenJeKarteneinheit",
                    satz: "Setzung (MCS-002: 1 Einheit = 3 Meilen = 3000 Schritt)",
                },
            },
            {
                name: "Schritt je Karteneinheit",
                folge: "netz",
                text: "3.000",
                einheit: "Schritt",
                satz:
                    "Dieselbe Strecke in Schritt. Damit rechnen die Steigungen der Wegprofile. Die Freigabe rechnet die " +
                    "gespeicherten Wegprofile mit dem neuen Maßstab nach, bevor das Netz neu lädt.",
                id: "schrittPerUnit",
                min: 1000,
                max: 10000,
                grenze: "Dieselbe Setzung in Schritt, und dieselbe Spanne. Geht auch in die gespeicherten Wegprofile (`terrain/path-profiles.ts`, WI-0153 Schnitt 7d); die übrige Geländeableitung rechnet weiter mit 3000.",
                quelle: "routing/slope.ts SCHRITT_PER_UNIT",
            },
            {
                name: "Grenze der Wegpunkte",
                folge: "sofort",
                text: "100",
                einheit: "je Anfrage",
                satz:
                    "So viele Stationen darf eine Reise haben: Start, Ziel und bis zu 98 dazwischen. Jede " +
                    "weitere kostet eine eigene Suche.",
                id: "routeWaypointLimit",
                min: 2,
                max: 500,
                grenze: "Unter 2 ist keine Reise möglich (Start und Ziel); über 500 trägt eine Anfrage mehr Etappen, als der Runner in seinen 2 s rechnet.",
                quelle: "shared/route.ts ROUTE_WAYPOINT_LIMIT",
            },
            {
                name: "Grenze der Kartenpunkte",
                folge: "sofort",
                text: "10",
                einheit: "je Anfrage",
                satz:
                    "So viele frei angeklickte Punkte darf eine Reise haben. Jeder löst eine eigene Suche über " +
                    "freies Feld aus und kostet spürbar Zeit.",
                id: "routeMapPointLimit",
                min: 1,
                max: 50,
                grenze: "Jeder frei gesetzte Punkt löst eine eigene Querfeldein-Suche aus; über 50 wird eine Anfrage sehr teuer. 0 schaltete die Kartenpunkte ab — dafür ist diese Grenze nicht da.",
                quelle: "shared/route.ts ROUTE_MAP_POINT_LIMIT",
            },
            {
                name: "Vorschläge der Ortssuche",
                folge: "sofort",
                text: "20",
                einheit: "Treffer",
                satz: "So viele Orte schlägt das Suchfeld des Reiseplaners höchstens vor.",
                id: "waypointLookupLimit",
                min: 1,
                max: 100,
                grenze: "Unter 1 schlägt die Ortssuche nichts mehr vor; über 100 wird die Liste unlesbar und die Abfrage teuer.",
                quelle: "shared/route.ts WAYPOINT_LOOKUP_LIMIT",
            },
            {
                name: "Wegende gilt als lose",
                folge: "sofort",
                einheiten: 0.05,
                satz:
                    "Ab diesem Abstand nennt der Prüfbericht ein Wegende „lose“. Ändert nichts an der Route, " +
                    "nur daran, was gemeldet wird.",
                id: "looseDistance",
                min: 0.005,
                max: 0.5,
                grenze: "Betrifft nur den Prüfhaken „lose Wegenden“. Über 0,5 (dem Ortskasten) meldet er fast jedes Wegende.",
                quelle: "routing/loose-endpoints.ts LOOSE_DISTANCE",
            },
            {
                name: "Ort gehört zum Knoten",
                folge: "sofort",
                einheiten: 0.15,
                satz:
                    "So nah muss ein Ort an einer Kreuzung liegen, damit die Etappe nach ihm heißt. Weiter weg " +
                    "heißt sie „Kreuzung“.",
                id: "cityNodeRadius",
                min: 0.01,
                max: 0.5,
                grenze: "Über dem Ortskasten (0,5) zählte ein Ort zur Etappe, an dem die Route gar nicht vorbeikommt.",
                quelle: "shared/route-stages.ts CITY_NODE_RADIUS",
            },
            {
                name: "Kleinste genannte Landschaft",
                folge: "sofort",
                text: "5",
                einheit: "Prozent",
                satz:
                    "Unter diesem Anteil an der Strecke wird eine Landschaft in der Etappe nicht mehr genannt. " +
                    "Kleiner heißt mehr Namen in der Liste.",
                id: "landscapeMinShare",
                min: 0.5,
                max: 50,
                grenze: "Prozent der Strecke: unter 0,5 steht jede gestreifte Landschaft in der Liste, über 50 nur noch eine, die mehr als die Hälfte trägt.",
                quelle: "shared/route-landscapes.ts LANDSCAPE_MIN_SHARE",
            },
        ],
    },
    {
        titel: "Dijkstra-Einstellungen",
        wirkung: "Gilt bei jeder Routenanfrage auf dem Wegenetz.",
        werte: [
            {
                name: "Querfeldein-Aufschlag",
                folge: "netz",
                text: "25",
                einheit: "fach",
                satz:
                    "Eine Notverbindung über freies Feld zählt für die Wegwahl 25-fach, damit sie nie gegen " +
                    "eine gezeichnete Straße gewinnt. Die Reisezeit rechnet ohne ihn.",
                id: "querfeldeinAufschlag",
                min: 2,
                max: 100,
                grenze: "Setzung des Reisemodells. Unter 2 lohnt querfeldein fast immer und die gezeichneten Wege verlieren ihren Sinn; über 100 wird auch der kurze Gang zum nächsten Weg unmöglich.",
                quelle: "config/travel-model/aventuria.json querfeldeinAufschlag",
                herkunft: {
                    feld: "querfeldeinAufschlag",
                    satz: "Setzung (AVESMAPS_ROUTE_CLIENT_SYNTHETIC_DISTANCE_COST_FACTOR): ein Gewicht, keine Strecke",
                },
            },
            {
                name: "Grenze der Seereisen",
                folge: "sofort",
                text: "25",
                einheit: "je Route",
                satz: "Mehr als 25 Seereisen in einer Route brechen die Suche ab.",
                id: "routeFreeSeaLimit",
                min: 1,
                max: 100,
                grenze: "0 schaltete die freie Seefahrt ab; über 100 rechnet eine Anfrage länger, als der Runner wartet.",
                quelle: "shared/route.ts ROUTE_FREE_SEA_LIMIT",
            },
            {
                name: "Grenze der Flugsuchen",
                folge: "sofort",
                text: "20",
                einheit: "je Route",
                satz:
                    "So viele Etappen dürfen um ein Gebirge herum gesucht werden. Darüber fliegt der Rest " +
                    "geradeaus auf Höchstflughöhe.",
                id: "routeFlightSearchLimit",
                min: 1,
                max: 100,
                grenze: "0 schaltete den Flug ab; über 100 rechnet eine Anfrage länger, als der Runner wartet.",
                quelle: "shared/route.ts ROUTE_FLIGHT_SEARCH_LIMIT",
            },
            {
                name: "Anbindungen je Wegpunkt",
                folge: "sofort",
                text: "6",
                einheit: "Wege",
                satz:
                    "An so viele verschiedene Landwege wird ein Ort ohne eigenen Weg angehängt. Welcher " +
                    "gewinnt, entscheidet die Suche.",
                id: "anchorLimit",
                min: 1,
                max: 24,
                grenze: "Jede Anbindung ist eine eigene Kante im Anfragegraphen; über 24 wächst er spürbar, ohne bessere Routen zu finden.",
                quelle: "routing/request-graph.ts ANCHOR_LIMIT",
            },
            {
                name: "Stunden je Reisetag im Gewicht",
                folge: "sofort",
                text: "12",
                einheit: "Stunden",
                satz:
                    "Mit dieser Zahl rechnet „Schnellste“ Reisezeit in Kalenderzeit um. Sie verschiebt alle " +
                    "Gewichte gleich.",
                id: "weightNormalizerHours",
                min: 1,
                max: 24,
                grenze: "Stunden eines Reisetags im Gewicht: unter 1 und über 24 ist es kein Tag mehr.",
                quelle: "shared/travel-model.ts WEIGHT_NORMALIZER_HOURS",
            },
            {
                name: "Sperrgebiete je Seereise",
                folge: "seegraph",
                text: "8",
                einheit: "Gebiete",
                satz:
                    "Eine Seereise merkt sich für höchstens acht Gebiete, ob sie hindurchfährt. Ein neuntes " +
                    "Sperrgebiet bliebe unberücksichtigt.",
                id: "seaClosureLimit",
                min: 1,
                max: 8,
                grenze: "🔴 Die Obergrenze ist das Speicherformat, nicht der Geschmack: Der Seegraph hält je Hafenpaar EIN BYTE, ein Bit je Gebiet (`sea-graph-store.ts`). Mehr als 8 Gebiete passen nicht hinein; die Vorgabe IST die Obergrenze.",
                quelle: "routing/sea-closures.ts SEA_CLOSURE_LIMIT",
            },
            {
                name: "Wege mit Ausstieg",
                folge: "sofort",
                text: "6",
                einheit: "Wege",
                satz: "So viele nahe Landwege bieten einem angeklickten Punkt eine Stelle zum Einsteigen an.",
                id: "exitPathLimit",
                min: 1,
                max: 24,
                grenze: "Jeder Weg mit Ausstieg kostet eine eigene Prüfung; über 24 wird der Anfragegraph teuer, ohne mehr zu finden.",
                quelle: "routing/map-points.ts EXIT_PATH_LIMIT",
            },
            {
                name: "Ausstiege je Weg",
                folge: "sofort",
                text: "24",
                einheit: "Punkte",
                satz: "So viele Stellen EINES Weges kommen dafür in Frage.",
                id: "exitVertexLimit",
                min: 2,
                max: 100,
                grenze: "Unter 2 gibt es keinen Ausstieg zwischen den Enden; über 100 trägt ein einziger Weg mehr Kanten als das halbe Netz.",
                quelle: "routing/map-points.ts EXIT_VERTEX_LIMIT",
            },
            {
                name: "Orte mit Ausstieg",
                folge: "sofort",
                text: "12",
                einheit: "Orte",
                satz: "So viele nahe Orte und Kreuzungen kommen zusätzlich als Einstieg in Frage.",
                id: "exitNodeLimit",
                min: 1,
                max: 50,
                grenze: "Orte, an denen ein Kartenpunkt einsteigt; über 50 wird die Anbindung teurer als die Suche.",
                quelle: "routing/map-points.ts EXIT_NODE_LIMIT",
            },
            {
                name: "Erste Stufe der Suche",
                folge: "sofort",
                text: "6",
                einheit: "Versuche",
                satz:
                    "Zuerst werden nur die sechs nächsten Kandidaten geprüft. Erst wenn keiner trägt, kommen " +
                    "alle übrigen dran.",
                id: "exitNearestTries",
                min: 1,
                max: 50,
                grenze: "Versuche der ersten Stufe; über 50 lohnt die zweite Stufe nicht mehr.",
                quelle: "routing/map-points.ts EXIT_NEAREST_TRIES",
            },
            {
                name: "Gerade zwischen zwei Punkten",
                folge: "sofort",
                text: "15",
                einheit: "Meilen",
                satz:
                    "Zwei angeklickte Punkte, die so nah beieinander liegen, bekommen immer die Gerade " +
                    "angeboten, auch ohne Weg dazwischen.",
                id: "directEdgeMiles",
                min: 1,
                max: 100,
                grenze: "Unter 1 Meile gibt es fast nie eine Gerade zwischen zwei Punkten; über 100 entsteht sie quer über Länder.",
                quelle: "routing/map-points.ts DIRECT_EDGE_MILES",
            },
            {
                name: "Einstieg unterwegs",
                folge: "sofort",
                einheiten: 0.5,
                satz:
                    "Kommt ein Gang über freies Feld einem Weg so nah, steigt er dort ein, statt neben ihm " +
                    "her weiterzulaufen.",
                id: "roadReach",
                min: 0.05,
                max: 2,
                grenze: "Einstieg unterwegs: über 2 Einheiten (6 Meilen) steigt eine Reise an Wegen ein, die weit neben ihr liegen.",
                quelle: "routing/map-points.ts ROAD_REACH",
            },
        ],
    },
    {
        titel: "A* Einstellungen",
        wirkung:
            "Gilt bei jeder Suche querfeldein, auf See oder im Flug: dort wird auf einem Raster gesucht, " +
            "nicht auf Wegen.",
        werte: [
            {
                abschnitt: "Querfeldein",
                name: "Zellbreite",
                folge: "sofort",
                einheiten: 0.25,
                satz:
                    "So fein ist das Gitter, auf dem ein Gang über freies Feld gesucht wird. Feiner heißt " +
                    "genauer und langsamer.",
                id: "cellUnits",
                min: 0.05,
                max: 1,
                grenze: "Jede Halbierung vervierfacht die Zellen: unter 0,05 ist die Zellgrenze schon nach wenigen Quadratmeilen erreicht, über 1 findet die Suche keine Lücke mehr.",
                quelle: "routing/offroad-grid.ts CELL_UNITS",
            },
            {
                name: "Grenze der Zellen",
                folge: "sofort",
                text: "150.000",
                einheit: "Zellen",
                satz: "Braucht ein Gang mehr Zellen als diese, wird sein Gitter gröber, statt die Suche zu sprengen.",
                id: "cellLimit",
                min: 10000,
                max: 1500000,
                grenze: "Unter 10.000 findet eine Suche über wenige Meilen nichts mehr; über 1,5 Mio. überschreitet sie die 2 s des Runners.",
                quelle: "routing/offroad-grid.ts CELL_LIMIT",
            },
            {
                name: "Glättung der Strecke",
                folge: "sofort",
                einheiten: 0.1,
                satz:
                    "So weit darf die gerechnete Strecke beim Vereinfachen von der Treppe abweichen. Größer " +
                    "kürzt die Strecke, und Länge ist Reisezeit.",
                id: "simplifyEpsilon",
                min: 0.001,
                max: 0.5,
                grenze: "Glättet die GERECHNETE Strecke: über 0,5 verkürzt sie sich messbar, unter 0,001 bleibt jede Rasterstufe stehen.",
                quelle: "routing/offroad-search.ts SIMPLIFY_EPSILON",
            },
            {
                name: "Glättung der Zeichnung",
                folge: "zeichnung",
                einheiten: 0.5,
                satz:
                    "So weit darf die gezeichnete Linie von der gerechneten abweichen. Betrifft nur das Bild, " +
                    "nicht Länge und Zeit.",
                id: "displayEpsilon",
                min: 0.01,
                max: 2,
                grenze: "Nur die gezeichnete Linie; über 2 schneidet sie sichtbar Kurven ab.",
                quelle: "routing/offroad-search.ts DISPLAY_EPSILON",
            },
            {
                abschnitt: "Seefahrt",
                name: "Zellbreite auf See",
                folge: "seegraph",
                einheiten: 0.5,
                satz:
                    "So fein ist das Gitter des offenen Wassers. Eine schmalere Durchfahrt bleibt befahrbar, wenn sie " +
                    "zur selben gezeichneten Fläche gehört, etwa die Einfahrt eines Fjords.",
                id: "seaCellUnits",
                min: 0.1,
                max: 2,
                grenze: "Jede Halbierung vervierfacht den Seegraphen (heute 13 MB); über 2 verliert er Durchfahrten zwischen Inseln.",
                quelle: "routing/sea-grid.ts SEA_CELL_UNITS",
            },
            {
                name: "Reichweite der Anlegestelle",
                folge: "seegraph",
                einheiten: 3,
                satz:
                    "So weit darf befahrbares Wasser vom Hafen entfernt liegen. Liegt keines näher, bekommt " +
                    "der Hafen keine Anlegestelle und keine Seereise.",
                id: "landingReach",
                // Boden 2,5 nach der Gegenprobe der Anlegestellen (WI-0153 §11): darunter verlieren schnell Dutzende Häfen ihre
                // Seereise (bei 2 neun, bei 0,5 über zweihundert), bei 2,5 einer mehr als mit der Vorgabe.
                min: 2.5,
                max: 10,
                grenze: "Zu klein nimmt Häfen ihre Anlegestelle (Regel H1 der Ableitung), zu groß gibt sie Binnenorten. Beides ändert die Karte, nicht nur die Route.",
                quelle: "routing/sea-grid.ts LANDING_REACH",
            },
            {
                name: "Glättung der Seelinie",
                folge: "zeichnung",
                einheiten: 0.02,
                satz: "So weit darf die gezeichnete Seelinie von der gerundeten abweichen.",
                id: "freeSeaDisplayTolerance",
                min: 0.001,
                max: 0.2,
                grenze: "Nur die gezeichnete Seelinie; über 0,2 schneidet sie Buchten ab.",
                quelle: "routing/sea-free.ts FREE_SEA_DISPLAY_TOLERANCE",
            },
            {
                name: "Suche nach fernem Wasser",
                // 🔴 Seegraph, nicht sofort (WI-0214): gelesen nur in der Ableitung (`sea-landless.ts` aus `sea-derive.ts`),
                // für den Bericht über Häfen ohne Anlegestelle. Keine Route rechnet damit.
                folge: "seegraph",
                einheiten: 50,
                satz:
                    "So weit wird nach Wasser gesucht, um einem Hafen ohne Anlegestelle zu sagen, wie weit das " +
                    "nächste entfernt liegt.",
                id: "farSearch",
                min: 5,
                max: 200,
                grenze: "Suche nach fernem Wasser: unter 5 Einheiten findet ein Binnenhafen nichts, über 200 sucht sie über den halben Kontinent.",
                quelle: "routing/sea-landless.ts FAR_SEARCH",
            },
            {
                abschnitt: "Flug",
                name: "Zellbreite im Flug",
                folge: "sofort",
                einheiten: 0.5,
                satz: "So fein ist das Gitter, auf dem der Flug seinen Weg um die Gebirge sucht.",
                id: "airCellUnits",
                min: 0.1,
                max: 2,
                grenze: "Wie die Zellbreite querfeldein: jede Halbierung vervierfacht das Flugraster.",
                quelle: "routing/air-obstacles.ts AIR_CELL_UNITS",
            },
            {
                name: "Grenze der Zellen im Flug",
                folge: "sofort",
                text: "1.500.000",
                einheit: "Zellen",
                satz: "Braucht ein Flugfenster mehr Zellen, wird sein Gitter gröber.",
                id: "airCellLimit",
                min: 100000,
                max: 5000000,
                grenze: "Ein Byte je Zelle: 5 Mio. sind 5 MB je Fenster, und das Budget eines Workers sind 96 MB.",
                quelle: "routing/air-way.ts AIR_CELL_LIMIT",
            },
            {
                name: "Gewicht über fremdem Gebirge",
                folge: "sofort",
                text: "10.000",
                einheit: "fach",
                satz: "So teuer ist eine Einheit über fremdem Gebirge: praktisch unpassierbar.",
                id: "blockedWeight",
                min: 10,
                max: 100000,
                grenze: "Unter 10 fliegt die Bahn mitten durch fremdes Gebirge; über 100.000 ist es keine Wägung mehr, sondern eine Wand.",
                quelle: "routing/air-search.ts BLOCKED_WEIGHT",
            },
            {
                name: "Gewicht über eigenem Gebirge",
                folge: "sofort",
                text: "10",
                einheit: "fach",
                satz:
                    "Über dem Gebirge, in dem der Flug startet, darf er fliegen, wenn er dafür mehr als neun " +
                    "Einheiten Umweg spart.",
                id: "homeFactor",
                min: 1,
                max: 1000,
                grenze: "Unter 1 wäre das eigene Gebirge billiger als freie Luft.",
                quelle: "routing/air-search.ts HOME_FACTOR",
            },
            {
                name: "Größe einer Nische",
                folge: "sofort",
                text: "8.192",
                einheit: "Zellen",
                satz:
                    "Ein offener Bereich mit weniger Zellen, der nicht an den Rand reicht, gilt als Nische " +
                    "und wird nicht durchsucht.",
                id: "pocketCells",
                min: 64,
                max: 65536,
                grenze: "Größe einer Nische: unter 64 Zellen gilt jede Senke als Nische, über 65.536 keine mehr.",
                quelle: "routing/air-search.ts POCKET_CELLS",
            },
            {
                name: "Erlaubter Umweg",
                folge: "sofort",
                text: "50",
                einheit: "Prozent",
                satz: "Ein Flugweg darf höchstens so viel länger sein als die Luftlinie, sonst fällt er weg.",
                id: "weighDetour",
                min: 1,
                max: 500,
                grenze: "Prozent: unter 1 lohnt kein Umweg, über 500 wird jeder genommen.",
                quelle: "routing/air-weigh.ts WEIGH_DETOUR",
            },
            {
                name: "Umweg im engen Gitter",
                folge: "sofort",
                text: "25",
                einheit: "Prozent",
                satz: "Zuerst wird nur in diesem engeren Bereich gesucht; das ist deutlich billiger.",
                id: "weighDetourNear",
                min: 1,
                max: 500,
                grenze: "Dieselbe Spanne wie der erlaubte Umweg, im engen Gitter.",
                quelle: "routing/air-weigh.ts WEIGH_DETOUR_NEAR",
            },
            {
                name: "Weg gilt als am Rand",
                folge: "sofort",
                text: "80",
                einheit: "Prozent",
                satz:
                    "Liegt der gefundene Weg so nah am Rand des engen Bereichs, wird noch einmal im weiten " +
                    "gesucht.",
                id: "weighNearEdge",
                min: 1,
                max: 100,
                grenze: "Prozent eines Fensters: über 100 gibt es keinen Rand mehr.",
                quelle: "routing/air-weigh.ts WEIGH_NEAR_EDGE",
            },
            {
                name: "Zweite Wege im Feilen",
                folge: "sofort",
                text: "1,15",
                einheit: "fach",
                satz:
                    "Ein Weg, der höchstens so viel teurer ist als der beste, wird mitgefeilt: Das Feilen kann " +
                    "ihn noch nach vorn bringen.",
                id: "weighNearCost",
                min: 1,
                max: 5,
                grenze: "Ein Faktor unter 1 machte den zweiten Weg billiger als den ersten; über 5 wird er nie geprüft.",
                quelle: "routing/air-weigh.ts WEIGH_NEAR_COST",
            },
            {
                name: "Zellen je Abwägung",
                folge: "sofort",
                text: "200.000",
                einheit: "Zellen",
                satz: "So groß darf das Gitter einer Abwägung sein; darüber wird die Zelle doppelt so breit.",
                id: "weighCellLimit",
                min: 10000,
                max: 2000000,
                grenze: "Wie die Zellgrenze querfeldein, nur für die Abwägung: über 2 Mio. überschreitet eine Anfrage die 2 s des Runners.",
                quelle: "routing/air-weigh.ts WEIGH_CELL_LIMIT",
            },
            {
                name: "Arbeit je Anfrage",
                folge: "sofort",
                text: "1.500.000",
                einheit: "Einheiten",
                satz:
                    "So viel darf eine Anfrage insgesamt rechnen. Danach fliegen die restlichen Etappen " +
                    "geradeaus auf Höchstflughöhe.",
                id: "weighWorkBudget",
                min: 100000,
                max: 15000000,
                grenze: "Arbeit je Anfrage; über 15 Mio. Einheiten rechnet eine Etappe länger als der Runner wartet.",
                quelle: "routing/air-weigh.ts WEIGH_WORK_BUDGET",
            },
            {
                name: "Durchgänge beim Feilen",
                folge: "sofort",
                text: "2",
                einheit: "je Stufe",
                satz: "So oft wird jede Ecke eines Flugwegs je Schrittweite nachgezogen.",
                id: "weighPolishPasses",
                min: 1,
                max: 10,
                grenze: "0 schaltete das Feilen ab; über 10 Durchgänge ändert sich nichts mehr.",
                quelle: "routing/air-weigh.ts WEIGH_POLISH_PASSES",
            },
            {
                name: "Bewertungen beim Feilen",
                folge: "sofort",
                text: "150",
                einheit: "je Etappe",
                satz: "So oft darf eine Etappe beim Feilen bewertet werden.",
                id: "weighPolishEvaluations",
                min: 10,
                max: 1500,
                grenze: "Bewertungen je Etappe: unter 10 feilt es nicht, über 1500 kostet es mehr als die Suche.",
                quelle: "routing/air-weigh.ts WEIGH_POLISH_EVALUATIONS",
            },
            {
                name: "Kleinster Rest zum Feilen",
                folge: "sofort",
                text: "12",
                einheit: "Bewertungen",
                satz: "Bleibt weniger übrig, bleibt der Flugweg, wie er ist.",
                id: "weighPolishMin",
                min: 1,
                max: 120,
                grenze: "Kleinster Rest, der noch gefeilt wird; über 120 bleibt für die letzte Stufe nichts übrig.",
                quelle: "routing/air-weigh.ts WEIGH_POLISH_MIN",
            },
            {
                name: "Kleinster lohnender Umweg",
                folge: "sofort",
                text: "0,05",
                einheit: "Stunden",
                satz:
                    "Erst ab diesem Zuschlag lohnt überhaupt eine Suche um das Gebirge; darunter zeigt die " +
                    "Oberfläche ohnehin nichts an.",
                id: "weighMinHours",
                min: 0.001,
                max: 1,
                grenze: "Kleinster lohnender Umweg: über einer Stunde fällt jede Abwägung aus, die die Oberfläche noch anzeigt.",
                quelle: "routing/air-weigh.ts WEIGH_MIN_HOURS",
            },
            {
                abschnitt: "Wasser",
                name: "Kandidaten bei nassem Weg",
                folge: "sofort",
                text: "25",
                einheit: "Versuche",
                satz:
                    "Liegt der nächste Weg nur jenseits von Wasser, werden so viele weitere durchprobiert, bis " +
                    "einer trocken zu erreichen ist.",
                id: "drySearchLimit",
                min: 1,
                max: 100,
                grenze: "Kandidaten bei nassem Weg: 0 ließe jeden Ort hinter Wasser unerreichbar, über 100 prüft jede Anfrage den halben Kontinent.",
                quelle: "routing/water.ts DRY_SEARCH_LIMIT",
            },
            {
                name: "Küstenzeichnung am Ende",
                folge: "sofort",
                einheiten: 1,
                satz:
                    "So viel Wasser am Anfang oder Ende einer Verbindung gilt als Küstenzeichnung, nicht als " +
                    "Querung. Hafenorte liegen auf der Küste.",
                id: "coastTolerance",
                min: 0.1,
                max: 5,
                grenze: "Küstenzeichnung am Ende: über 5 Einheiten (15 Meilen) gilt eine echte Querung als Küstenfahrt.",
                quelle: "routing/water.ts COAST_TOLERANCE",
            },
            {
                name: "Ufer am Seeufer",
                folge: "sofort",
                einheiten: 0.25,
                satz: "Dasselbe am Ufer eines Binnensees, wo der See sonst eine Wand bleibt: eine Rasterzelle breit.",
                id: "shoreTolerance",
                min: 0.01,
                max: 2,
                grenze: "Eine Rasterzelle breit (0,25 = Zellbreite querfeldein); über 2 wird der halbe See zum Ufer.",
                quelle: "routing/water.ts SHORE_TOLERANCE",
            },
            {
                name: "Ein Seeweg gilt als Meer",
                folge: "sofort",
                text: "0,5",
                einheit: "Schritt",
                satz: "Bis zu dieser mittleren Höhe zählt ein Wasserweg als Meer; Meer liegt im Modell auf genau null.",
                id: "seaLevel",
                min: 0.01,
                max: 10,
                grenze: "Meer liegt im Modell auf genau null; über 10 Schritt zählte ein Bergsee als Meer.",
                quelle: "routing/water-profile.ts SEA_LEVEL",
            },
        ],
    },
] as const satisfies readonly WegfindungPanel[];

/** Die drei Panele mit ihren Werten, in der Reihenfolge der Anzeige. */
export const WEGFINDUNG_PANELE: readonly WegfindungPanel[] = PANELE;

/**
 * Die Kennungen der 51 Werte als Vereinigung ihrer Zeichenketten. 🔴 Damit prüft der Übersetzer jede Verdrahtung im
 * Routing (`werte().cellUnits`): Ein Tippfehler hält den Bau an, statt stillschweigend `undefined` zu liefern.
 */
export type WegfindungId = (typeof PANELE)[number]["werte"][number]["id"];

/** Jeder Wert der Tafel, über alle Panele, in der Reihenfolge der Anzeige. */
export const WEGFINDUNG_WERTE: readonly WegfindungWert[] = WEGFINDUNG_PANELE.flatMap((panel) => panel.werte);

/** Der Wert zu einer Kennung; `undefined`, wenn die Kennung nicht zur Tafel gehört. */
export const wegfindungWert = (id: string): WegfindungWert | undefined =>
    WEGFINDUNG_WERTE.find((wert) => wert.id === id);

/**
 * Die Vorgabe eines Werts als Zahl. 🪤 `text` ist für die Anzeige geschrieben (Tausenderpunkt, Komma); gerechnet wird
 * mit `einheiten`, und wo die fehlt, mit der gelesenen Zahl aus `text`.
 */
export function wegfindungVorgabe(wert: WegfindungWert): number {
    if (wert.einheiten !== undefined) return wert.einheiten;
    return Number(wert.text?.replace(/\./gu, "").replace(",", ".") ?? Number.NaN);
}

/**
 * 🔴 **Welche Kennungen am Knopf hängen: die mit Folge `netz` und `seegraph`.** EINE Regel aus dem Feld, das das Register
 * schon führt — keine zweite Liste. Server und Oberfläche lesen dieselbe (WI-0153 Schnitte 6 und 7c):
 *
 * - Der Server hält für genau diese Kennungen einen FREIGEGEBENEN Stand (`routing_setting_applied`), den allein der
 *   Knopf fortschreibt. Ein gespeicherter Wert ändert daran nichts.
 * - Die der Folge `netz` bilden den Revisionsteil `settings` (`WEGFINDUNG_NETZ`): Ihre Freigabe baut das Netz neu.
 * - Die der Folge `seegraph` gehen in den Fingerabdruck des Seegraphen (`sea-derive.ts`, 7a): Ihre Freigabe reiht die Ableitung
 *   ein, und erst der neue Graph wechselt die Revision (Teil `seaGraph`). Im Teil `settings` stünden sie für einen Netzaufbau,
 *   der nichts ändert.
 * - Alle anderen rechnet der Dienst aus dem GESPEICHERTEN Stand: Sie stehen im Revisionsteil `settingsLive`, und die
 *   Worker holen sie sich mit der nächsten Prüfung (höchstens fünf Sekunden) von selbst. Sie brauchen den Knopf
 *   nicht, also verlangt ihre Zeile ihn auch nicht.
 */
export const WEGFINDUNG_AM_KNOPF: readonly WegfindungId[] = WEGFINDUNG_WERTE.filter(
    (wert) => wert.folge === "netz" || wert.folge === "seegraph",
).map((wert) => wert.id as WegfindungId);

/** Die Kennungen am Knopf, die das Netz bauen: Revisionsteil `settings` (WI-0153 Schnitt 6). */
export const WEGFINDUNG_NETZ: readonly WegfindungId[] = WEGFINDUNG_WERTE.filter((wert) => wert.folge === "netz").map(
    (wert) => wert.id as WegfindungId,
);

/** Die Kennungen, die ohne Knopf gelten: Revisionsteil `settingsLive`, gelesen aus dem gespeicherten Stand. */
export const WEGFINDUNG_VON_SELBST: readonly WegfindungId[] = WEGFINDUNG_WERTE.filter(
    (wert) => wert.folge === "sofort" || wert.folge === "zeichnung",
).map((wert) => wert.id as WegfindungId);

/** Hängt diese Kennung am Knopf? Eine unbekannte tut es nicht (ein Wert aus einem späteren Release). */
export const wegfindungAmKnopf = (id: string): boolean => (WEGFINDUNG_AM_KNOPF as readonly string[]).includes(id);

/**
 * 🪤 **Vier Werte führt das Register in Prozent, der Code als Anteil.** Das Blatt zeigt „50 Prozent“, die Konstante
 * im Code steht auf 0,5. Wer sie verdrahtet, teilt durch hundert — `wegfindung-vorgaben.test.ts` rechnet beide
 * Richtungen nach, und `einstellungen.ts` liest sie nur über `anteil()`.
 */
export const WEGFINDUNG_ALS_ANTEIL: readonly WegfindungId[] = [
    "landscapeMinShare",
    "weighDetour",
    "weighDetourNear",
    "weighNearEdge",
];

/**
 * 🔴 **Die Werte, die der Browser selbst anwendet** (WI-0214): Der Planer begrenzt die Wegpunkte und Kartenpunkte, bevor
 * er fragt, und filtert die Landschaften einer Etappe selbst. Ohne den eingestellten Wert rechnete er mit der Vorgabe,
 * während der Reiter den eingestellten als geltend zeigte. Der öffentliche Leseweg `GET /api/map-settings` liefert genau
 * diese, als wirksame Zahlen (`wegfindung`); alle anderen rechnet nur der Server.
 */
export const WEGFINDUNG_IM_BROWSER = [
    "routeWaypointLimit",
    "routeMapPointLimit",
    "landscapeMinShare",
] as const satisfies readonly WegfindungId[];

/** Die wirksamen Zahlen aller 51 Werte, nach Kennung: die Form, in der das Routing sie liest. */
export type Wegfindungswerte = Readonly<Record<WegfindungId, number>>;

/** Die Werte von `WEGFINDUNG_IM_BROWSER`, nach Kennung. */
export type WegfindungswerteImBrowser = Readonly<Record<(typeof WEGFINDUNG_IM_BROWSER)[number], number>>;

/** Aus den wirksamen Werten genau die, die der Browser selbst anwendet (der Server füllt damit `GET /api/map-settings`). */
export function wegfindungImBrowser(werte: Wegfindungswerte): WegfindungswerteImBrowser {
    return Object.fromEntries(WEGFINDUNG_IM_BROWSER.map((id) => [id, werte[id]])) as WegfindungswerteImBrowser;
}

/**
 * Liest die Werte des Browsers tolerant (WI-0214): je Kennung die gelieferte Zahl, wenn sie in ihren Grenzen liegt, sonst
 * die Vorgabe. Fehlt das Feld ganz (ein älterer Server, keine Antwort), gelten die Vorgaben — so wie vor WI-0214.
 */
export function wegfindungImBrowserAus(body: unknown): WegfindungswerteImBrowser {
    const vorgaben = wegfindungImBrowser(wegfindungVorgaben());
    if (typeof body !== "object" || body === null) return vorgaben;
    const geliefert = body as Record<string, unknown>;
    return Object.fromEntries(
        WEGFINDUNG_IM_BROWSER.map((id) => {
            const zahl = geliefert[id];
            const wert = wegfindungWert(id);
            const passt = typeof zahl === "number" && wert !== undefined && wegfindungImRahmen(wert, zahl);
            return [id, passt ? zahl : vorgaben[id]];
        }),
    ) as WegfindungswerteImBrowser;
}

/** Die Vorgaben aller Werte, nach Kennung. */
export const wegfindungVorgaben = (): Wegfindungswerte =>
    Object.fromEntries(WEGFINDUNG_WERTE.map((wert) => [wert.id, wegfindungVorgabe(wert)])) as Wegfindungswerte;

export interface WegfindungGrenzen {
    min: number;
    max: number;
}

/**
 * Die Grenzen einer Eingabe: je Wert eine eigene, aus seiner Bedeutung (Betreiber 2026-10-15: „mit Grenzen je Wert“).
 *
 * 🪤 **Vorher stand hier EINE Regel** — ein Zehntel bis das Zehnfache der Vorgabe. Sie war billig zu pflegen und für
 * das verrutschte Komma richtig, aber sie weiß nichts von der Sache: Beim Fangradius wäre 0,2 erlaubt gewesen, obwohl
 * er dann in die Größenordnung des Ortskastens wächst, und bei den Sperrgebieten 80, obwohl der Seegraph je Hafenpaar
 * genau ein Byte hält und bei 9 Gebieten bricht. Darum trägt jeder Wert jetzt `min`, `max` und `grenze` — den Satz,
 * warum die Grenze dort liegt. Wo ich unsicher war, steht die engere Grenze und der Zweifel im Satz: Eine zu enge
 * Grenze ärgert, eine zu weite zerstört das Netz.
 *
 * 🪤 **Keine Ganzzahlpflicht.** Die Tafel nennt `12 Stunden`, `15 Meilen` und `5 Prozent` als ganze Zahlen, obwohl sie
 * stufenlos sind; eine Regel „ganze Vorgabe, ganze Eingabe“ verbaute 12,5 Stunden. Wo eine Zahl wirklich eine Anzahl
 * ist (`150.000 Zellen`, `6 Versuche`), zählt die Stelle, die sie liest, ohnehin in ganzen Schritten.
 */
export const wegfindungGrenzen = (wert: WegfindungWert): WegfindungGrenzen => ({ min: wert.min, max: wert.max });

/** Liegt die Eingabe in den Grenzen ihres Werts? Nicht endlich: nein. */
export function wegfindungImRahmen(wert: WegfindungWert, eingabe: number): boolean {
    if (!Number.isFinite(eingabe)) return false;
    const grenzen = wegfindungGrenzen(wert);
    return eingabe >= grenzen.min && eingabe <= grenzen.max;
}

/**
 * Die wirksamen Werte: die Vorgaben der Tafel, überschrieben von den gespeicherten Abweichungen. 🔴 Gespeichert wird
 * nur, was verstellt ist; alles andere ist die Zahl aus dem Code. Eine Kennung, die die Tafel nicht kennt, wird
 * übergangen (sie stammt aus einem späteren oder einem zurückgenommenen Release).
 */
export function wegfindungWirksam(abweichungen: Readonly<Record<string, number>>): Wegfindungswerte {
    const werte: Record<string, number> = { ...wegfindungVorgaben() };
    for (const [id, wert] of Object.entries(abweichungen)) if (werte[id] !== undefined) werte[id] = wert;
    return Object.freeze(werte) as Wegfindungswerte;
}
