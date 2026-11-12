import { Type, type Static } from "@sinclair/typebox";

const strict = { additionalProperties: false } as const;

/**
 * Die Vorkommen (Lore) als Lesevertrag (WI-0091, Vertrag `lore.yaml` -> `panelbezug`, D5): die vier Arten, die Nähe, in der ein
 * Eintrag zum Gegenstand steht, und die Zähler der Detailantwort. Hier stehen nur die Bausteine ohne `SubjectRef`; die Sektion
 * selbst steht bei den übrigen vier Sektionen in `subject.ts`.
 *
 * 🔴 Vorkommen sind in Legacy KEIN Abschnitt mit Kopf, sondern vier Zeilen der Datentabelle (WI-0063 27.14, 27.7: Beschreibung,
 * Oberhaupt, Einwohner, Verkehrswege, Handelszone, Bevölkerung, Tempel, Stätten, **Waren, Fauna, Flora, Spezies**, Klimazone).
 * Eine Art ohne Eintrag entfällt samt Zeile; es gibt kein „(0)“ (WI-0063 5.3).
 */

/** Die vier Arten eines Eintrags, wie Legacy sie führt (`lore_entry.kind`). */
export const LORE_KINDS = ["fauna", "flora", "spezies", "ware"] as const;
export type LoreKind = (typeof LORE_KINDS)[number];

/**
 * Die Reihenfolge der vier Zeilen in der Datentabelle (Legacys `AVESMAPS_LORE_ROWS`, `lore.yaml` -> `panelbezug.zeilen.reihenfolge`):
 * Waren, Fauna, Flora, Spezies. 🪤 Das ist NICHT die Reihenfolge von `LORE_KINDS` (die ist alphabetisch und dient der Prüfung von
 * Werten); wer die Zeilen baut, nimmt diese Liste.
 */
export const LORE_ROWS = ["ware", "fauna", "flora", "spezies"] as const;

const LoreKindLiteral = Type.Union(LORE_KINDS.map((kind) => Type.Literal(kind)));

/**
 * Die Nähe, nach der der aufgeklappte Inhalt gegliedert ist (`lore.yaml` -> `panelbezug.zeilen.inhalt`).
 *
 * 🔴 **Die Regel ist Enthaltensein, nicht Bindung** (Betreiber 2026-10-06, wörtlich: „etwas kommt in einer region vor -> es wird
 * da gelistet. altenmohn ist im herz des kontinents - also werden dort alle vorkommen in dieser fläche gelistet. dasselbe für
 * wege, routenetappen, landschaften, politische regionen usw.“). Ein Vorkommen gehört einer Fläche; jeder Gegenstand, der IN
 * dieser Fläche liegt, listet es.
 *
 * - `origin` „Von hier“: Relation `herkunft` (nur Waren). Ein Eintrag mit Herkunft steht NUR hier, nie zusätzlich unter `here`.
 * - `here` „Direkt von hier“: der Gegenstand selbst trägt den Schlüssel - am Ort zusätzlich das tiefste Gebiet an seinem Punkt.
 *   🪤 Das tiefste Gebiet ist streng genommen schon Enthaltensein; es bleibt hier, weil der Betreiber am 2026-10-06 sagte
 *   „‚Direkt hier‘ listet weiterhin wie bisher“ - also wörtlich der Umfang, der am 2026-10-06 gebaut war.
 *   🔴 **Der SCHLÜSSEL bleibt `here`, der angezeigte Wortlaut heißt seit dem 2026-10-07 „Direkt von hier“** (Betreiber auf
 *   Rückfrage: „‚Direkt von hier‘ passt gut.“, WI-0103). Geändert ist die Sprachtafel, nicht der Vertrag.
 * - `region` „Aus der Region“: jede WEITERE Fläche, die den Gegenstand enthält - Landschaften (`region_area`) und politische
 *   Gebiete (`territory_shape` beziehungsweise die Elternkette). Das ist die neue Regel. 🔴 Seit dem 2026-10-07 gilt sie auch für
 *   WEGE: ein Weg trägt nie Eigenes (`lore_place_target` hat keine `path_id`), aber alles, was seine Linie enthält (WI-0103).
 *
 * 🔴 **„Überall in Aventurien“ ist keine Gruppe mehr, sondern ein LINK** (Betreiber 2026-10-06, wörtlich: „‚Überall in
 * Aventurien‘ ist korrekt, aber unendlich viel (verbergen wär am besten … Also am besten wär eigentlich ein Link von ‚Überall
 * in Aventurien‘-> klick -> ganze aventurien wird gezeigt und alle vorkommen in aventurien gelistet“). Er führt auf die
 * Landschaft „Aventurien“, wo genau diese Einträge ihr eigenes „Direkt hier“ sind - nichts steht doppelt, nichts versteckt
 * sich, und die 445 Namen je Art reisen gar nicht erst mit (`LoreRowView.everywhere` in `subject.ts`).
 */
export const LORE_GROUPS = ["origin", "here", "region"] as const;
export type LoreGroup = (typeof LORE_GROUPS)[number];

/**
 * 🔴 **DIE EINE STELLE für die Lesarten der Vorkommen.** Jede Regel steht hier und nirgends sonst; eine Umstellung ist eine
 * Zeile. Server und Oberfläche lesen denselben Wert, damit Satz und Liste nie auseinanderlaufen.
 *
 * `countScope` - **was die Zahl im Zählsatz zählt** („11 Pflanzenarten gesehen“):
 * - `own` (gebaut): „Direkt von hier“ und „Aus der Region“, also **genau die beiden Gruppen, die als LISTE dastehen**.
 * - `all`: dazu die kontinentweiten Einträge, also auch die Zahl am Link.
 *
 * 🔴 **Betreiberentscheidung vom 2026-10-07 (WI-0104), wörtlich: „außerdem kannst du ‚überall in aventurien‘ von der zahl im
 * header von vorkommen abziehen?“** Dazu sein eigenes Soll, Zeichen für Zeichen: „4 Handelswaren gelistet · Direkt hier 2 … Aus
 * der Region 2 … Überall in Aventurien (302)“ — **4 = 2 + 2**, die 302 des Links zählen nicht mit. Der Satz zählt also, **was
 * als Liste dasteht**; der Link steht daneben und bringt seine Zahl selbst mit.
 *
 * 🪤 **Das ist die Rücknahme von WI-0103 §5 (`all`), nicht die Rücknahme der Entscheidung von WI-0103 §3.** Die Linkzeile steht
 * weiter an JEDEM Gegenstand („und ‚Überall in Aventurien‘ muss natürlich auch überall stehen, wenns in Aventurien ist :)“).
 * 🔴 **Darum hängt die Zeile seit WI-0104 NICHT mehr an der gezählten Menge**, sondern an {@link loreRowStands}: Sie steht, wo
 * sie etwas zu zeigen hat - eine Liste ODER den Link. Ohne diese Trennung nähme „leer ist unsichtbar“ (WI-0063 5.3) die
 * Entscheidung vom 2026-10-07 still zurück, weil die 0 im Satz die Zeile verschwinden ließe.
 *
 * 🪤 **Legacy stützt `own`**, mit seinem eigenen Kommentar in `js/map-features/map-features-lore.js`: „🔴 DIE ZAHL IM SATZ IST,
 * WAS AUFGEKLAPPT DASTEHT — nicht die Serverzahl `total`“. Aufgeklappt stehen bei uns die beiden Listen; die kontinentweiten
 * Namen reisen seit dem 2026-10-06 gar nicht mehr mit, sie sind ein Link.
 *
 * 🪤 **Der Link zählt nur, wo er auch steht.** Am Linkziel selbst (der Landschaft „Aventurien“) gibt es keinen Link, und dort
 * sind dieselben Einträge schon „Direkt von hier“ - sie würden sonst doppelt gezählt. Das bleibt unter `own` genauso richtig:
 * `linked` entscheidet dort auch darüber, ob die Zeile überhaupt steht.
 *
 * **Gemessen am 2026-10-06 über den ganzen Bestand** (WI-0091 Nachtrag 2): Über das Enthaltensein erbt ein Ort im Median **47**
 * Einträge (Ware 12, Fauna 11, Flora 8, Spezies 2; p90 145, höchstens 256) aus im Median **2** Herkunftsflächen. Kontinentweit
 * gelten dagegen an JEDEM Ort dieselben **1.174** (Flora 445, Fauna 383, Waren 302, Spezies 44). Diese Zahl steht mit `all`
 * überall fast gleich da; Legacys eigene Diagnose vom 2026-08-12 dazu: „formal richtig, praktisch wertlos: was überall gilt, sagt
 * über diesen Ort nichts.“ 🪤 Das bleibt wahr - der Betreiber hat die Zeile trotzdem gewollt, weil sie den WEG zu diesen Namen
 * zeigt, nicht die Namen.
 *
 * `regionReading` - **was „Aus der Region“ sammelt**. 🔴 Hier steckt ein WIDERSPRUCH, der nicht still aufgelöst wird:
 * - `contains` (gebaut, Betreiber 2026-10-06): die Flächen, die den Gegenstand ENTHALTEN. Information fällt herab.
 * - `contains-and-below`: dazu die Gebiete UNTER dem tiefsten Gebiet am Punkt - Legacys Regel „Information steigt auf, sie fällt
 *   nie herab“ (Owner 2026-07-21: „Taschendrachen gibt es in Almada“ macht Punin nicht zum Drachenort).
 *
 * Die beiden Sätze zeigen in entgegengesetzte Richtungen. Der jüngere gewinnt, aber der ältere ist nicht widerrufen worden; die
 * Entscheidung liegt dem Betreiber vor (WI-0091 §7).
 *
 * `continentReading` - **welche Einträge als kontinentweit gelten**, die zwei Lesarten seines Satzes vom 2026-10-06 („ganz
 * aventurien wird markiert, es sei denn weitere orte werden genannt - dann leuchten die“):
 * - `additive` (gebaut): jeder Eintrag mit einer Kontinentzeile gilt überall. Das ist Legacys Mechanik - sie hängt allein an
 *   `lore_place.key_class = 'continent'`.
 * - `replacing`: nur ein Eintrag, der AUSSCHLIESSLICH Kontinentbegriffe nennt, gilt überall; nennt er zusätzlich einzelne Orte,
 *   gilt er nur dort.
 *
 * Gemessen je Art (Flora 445 gegen 371, Fauna 383 gegen 240, Waren 302 gegen 163, Spezies **44 gegen 6**). Seit die
 * kontinentweiten Einträge ein Link sind, berührt die Lesart nur noch die Zahl an diesem Link.
 *
 * `ortszeileHinterRegel` - **wie Ortszeile und Regel eines Eintrags zusammenspielen** (WI-0257 S2, offene Frage F2, jetzt
 * entschieden). Beide gelten (Vereinigung); eine Ortszeile tritt nur zurück, wo eine Regel DERSELBEN Beziehung denselben Ort
 * genauer fasst („Steppe in Bornland“ statt „Bornland“):
 * - `true` (gebaut): Hat ein Eintrag eine aktive Regel derselben Beziehung mit einem (nicht abgezogenen) Glied, dessen
 *   Rahmenfläche ein Ziel einer seiner Ortszeilen ist, gilt diese Ortszeile nicht mehr; der Eintrag erscheint dort nur, wo die
 *   Regel trifft. Alle anderen Ortszeilen gelten weiter. Das gilt auch für den Kontinent (Rahmen „Aventurien“ zur
 *   Kontinentzeile): Der Eintrag fällt dann aus „Überall in Aventurien“ und aus dessen Zahl heraus.
 * - `false`: Ortszeilen gelten ungeschmälert neben den Regeln (reine Vereinigung).
 *
 * 🔴 **„Genauer fassen“ gilt für alles INNERHALB des Rahmens, nicht für den Rahmen selbst** (Entscheid der Leitung 2026-10-29): Ist der
 * Gegenstand die Rahmenlandschaft (oder ein Mitglied ihrer gleichnamigen Gruppe) oder ein Gebiet, das die Ortszeile selbst nennt, tritt
 * die Ortszeile NICHT zurück; der Eintrag bleibt dort unter „Direkt von hier“ (Bornland behält seine Einträge, die Landschaft Aventurien
 * ihre 445 Pflanzen). Für Orte, Kartenpunkte, Gipfel, kleinere Landschaften, Gebiete darin, Wege und Etappen gilt F2 wie beschrieben.
 * 🪤 Die Zahl am Link „Überall in Aventurien“ an anderen Gegenständen ist die bereinigte (z. B. 441 Pflanzen): Ein Eintrag mit der
 * Regel „… in Aventurien“ kommt nicht überall vor. Dass die Zielseite Aventurien dann etwas mehr nennt (445) als die Zahl am Link,
 * ist so gewollt.
 *
 * 🔴 **Entschieden von Vali per Antwortknopf am 2026-10-29** („wo eine Regel denselben Ort genauer fasst, gilt nur die Regel;
 * alle anderen Ortszeilen gelten weiter“, WI-0257 §2 F2). Der Schalter bleibt als EINE Stelle stehen, damit die Tests beide
 * Richtungen prüfen und eine spätere Umkehr eine Zeile ist.
 */
export const LORE_READING: {
    countScope: "own" | "all";
    regionReading: "contains" | "contains-and-below";
    continentReading: "additive" | "replacing";
    ortszeileHinterRegel: boolean;
} = {
    countScope: "own",
    regionReading: "contains",
    continentReading: "additive",
    ortszeileHinterRegel: true,
};

/**
 * Zählt der Satz die kontinentweiten Einträge mit? Abgeleitet aus `LORE_READING`, damit die Regel an EINER Stelle steht.
 *
 * 🪤 Seit „Überall in Aventurien“ ein Link ist, gibt es keine ungezählte GRUPPE mehr - jede Gruppe steht als Liste da und zählt.
 * Darum ist das die einzige Frage AN DER ZAHL, und `LORE_OWN_GROUPS`/`loreCountedGroups` sind mit dem alten Modell entfallen.
 * 🔴 Ob die ZEILE dasteht, ist eine andere Frage und steht in {@link loreRowStands} (WI-0104).
 */
export const loreCountsContinent = (): boolean => LORE_READING.countScope === "all";

/**
 * 🔴 **DIE EINE STELLE, ob eine Vorkommenszeile überhaupt dasteht** - und sie ist **nicht** `count > 0`.
 *
 * Eine Zeile steht, wo sie etwas zu zeigen hat: eigene oder regionale Einträge (`own`), **oder** die Linkzeile „Überall in
 * Aventurien“ (`linked` und `everywhere > 0`). 💣 **Das ist unabhängig von {@link LORE_READING}.`countScope`, und genau darum
 * geht es:** Unter `own` ist die Zahl im Satz an einem Gegenstand ohne Eigenes **0**, und die Zeile muss trotzdem stehen -
 * sonst nähme „leer ist unsichtbar“ (WI-0063 5.3) die Betreiberentscheidung vom 2026-10-07 still zurück („und ‚Überall in
 * Aventurien‘ muss natürlich auch überall stehen, wenns in Aventurien ist :)“).
 *
 * 🪤 **Unter `all` ist die Bedingung gleichbedeutend mit `count > 0`** - dort fällt sie mit der alten Regel zusammen und ändert
 * nichts. Sie ist also keine Ausnahme neben `countScope`, sondern die Trennung der zwei Fragen, die bis WI-0103 an derselben
 * Zahl hingen: *was zählt der Satz* und *steht die Zeile*.
 *
 * 🔴 **Eine Art, die es auch kontinentweit nicht gibt, bekommt weiter KEINE Zeile** - nie ein „(0)“ ohne Inhalt.
 */
export const loreRowStands = (own: number, everywhere: number, linked: boolean): boolean =>
    own > 0 || (linked && everywhere > 0);

/**
 * Die Zähler der vier Zeilen in der Detailantwort (`lore.yaml` -> `panelbezug.detailvertrag`: „counts.lore je Art (nur Zahlen) im
 * Detail, die Liste lazy beim Aufklappen“).
 *
 * 🔴 **Eine Art ohne Zeile FEHLT; eine Art mit Zeile steht da, auch wenn ihre Zahl 0 ist.** Was da steht, entscheidet
 * {@link loreRowStands} - nicht die Zahl. Fehlt das ganze Objekt, trägt der Gegenstand keine Vorkommen und bekommt keine Zeile.
 *
 * 🪤 **Die Untergrenze ist seit WI-0104 `0`, und das ist kein gelockerter Vertrag, sondern der ganze Punkt:** Unter
 * `countScope: "own"` zählt der Satz nur die beiden Listen, am Gegenstand ohne Eigenes also 0 - und die Zeile steht trotzdem,
 * weil sie den Link trägt. Bis WI-0103 war „kein Eintrag“ gleichbedeutend mit „keine Zeile“ und die 1 damit richtig; seit die
 * Linkzeile überall steht, ist sie es nicht mehr.
 *
 * 🔴 Hier stehen NUR Zahlen: Bei im Median 47 und bis zu 256 geerbten Einträgen je Ort wäre eine eifrige Liste in der
 * Detailantwort an jedem Ort dreistellig.
 */
export const LoreCounts = Type.Object(
    {
        ware: Type.Optional(Type.Integer({ minimum: 0 })),
        fauna: Type.Optional(Type.Integer({ minimum: 0 })),
        flora: Type.Optional(Type.Integer({ minimum: 0 })),
        spezies: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type LoreCounts = Static<typeof LoreCounts>;

/** So viele Einträge liefert die Sektion je Art höchstens - eine Schranke gegen Wachstum, kein Schnitt (gemessen höchstens 476). */
export const LORE_ROW_LIMIT = 600;

export { LoreKindLiteral };
