/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
// Landschaften -- die lokale Gebirgssimulation EINER Flaeche (V12, live 04.09.2026).
//
// Owner-Auftrag 04.09.2026: „das rasterisierte graustufenbild nach der erosion soll ab sofort fuer
// die wegfindung verwendet werden. die algorithmen, die das berechnen sollen den aktuellen
// produktivcode ersetzen / ergaenzen. ich will genau dieses ergebnis."
//
// Entstanden als Prototyp in `docs/gebirge-hydrologie-modul.js` samt Mockup
// `docs/gebirge-hydrologie-mockup.html`; jene Dateien bleiben als Werkbank stehen (dort haengen die
// Regler und die Invariantentabelle), diese hier ist die Produktion.
//
// 🔴 DER UNTERSCHIED ZU V8: DAS FELD IST EIN RASTER, KEINE FUNKTION MEHR. `sampleEcosystemHeightField`
// beantwortet jede Stelle zustandslos aus einer Buckelsumme -- das ist billig und in jeder Reihenfolge
// abfragbar, kann aber keine Erosion tragen: ein Tropfen traegt Material von A nach B, also muss B
// sich merken, dass dort jetzt etwas liegt. Hier wird deshalb EINMAL je Flaeche ein Raster gerechnet
// und gespeichert; Karte und Wegfindung lesen dasselbe.
// ⚠️ V8 bleibt daneben stehen und wird weiter gebraucht -- fuer Flaechen ohne gerechnetes Raster und
// als Vergleich im Mockup.
//
// 🔴 WAS ES ANDERS MACHT ALS ALLES BISHERIGE. Das heutige Hoehenfeld ist eine FUNKTION -- eine
// Summe kompakter Buckel, die man an jeder Stelle zustandslos abfragt. Hier wird auf einem RASTER
// gerechnet, und zwar in dieser Reihenfolge:
//
//     Polygon -> Raster -> Constraints (Gipfel/Kamm/Fluss/See) -> Randwertaufgabe
//              -> Rauschen -> [Senken fuellen -> D8 -> Akkumulation -> Stream Power -> Diffusion]*
//
// Der Unterschied ist nicht die Erosion, sondern was sie vorfindet:
//   - Buckelsumme: ein Berg ist ein PUNKTmaximum, zwei Buckel ADDIEREN sich. Gemessen am
//     Livebestand: 27 von 49 Gipfeln lesen ihre Zahl NICHT, bis +5.820 Schritt zu hoch (Hoher
//     Stumpen: eingetragen 2.300, gelesen 8.120). Das ist zugleich der "weisse Blob".
//   - Randwertaufgabe: die Gipfel werden FESTGEHALTEN, dazwischen wird interpoliert. Jeder Gipfel
//     liest exakt seine Zahl (gemessen: Abweichung 0,0000 Schritt), und zwischen zwei Gipfeln
//     entsteht ein GRAT statt zweier Kegel.
//
// 💣 UND DER TERM, AN DEM DER TROPFEN-VERSUCH GESCHEITERT IST, IST DIE HEBUNG. Ohne sie traegt
// Stream Power das Gebirge bis auf Basisniveau ab -- gemessen Ø 1.361 -> 27 Schritt. Das ist kein
// Parameterfehler, sondern Geomorphologie: ein Gebirge ohne Hebung wird eingeebnet. Deshalb stand
// in der Analyse vom 03.09.2026 "ES GIBT KEINE MILDE EROSIONSEINSTELLUNG" -- die gibt es sehr wohl,
// sobald der Hebungsterm dasteht.
//
// Alles in KARTENkoordinaten 0..1024; gerechnet wird intern in SCHRITT (1 Einheit = 3.000 Schritt),
// damit Hoehe und Laenge dieselbe Einheit haben (AGENTS.md §5).

const SCHRITT_JE_EINHEIT = 3000;

// 🔴 Ohne erfasste Hoehe gilt 5.000 Schritt (Owner-Entscheid 2026-07-28) -- dieselbe Zahl, mit der
// die Karte seit V8 rechnet (`ECOSYSTEM_HEIGHT_DEFAULT`), nicht eine neue.
const ECOSYSTEM_HYDRO_STANDARDHOEHE = 5000;
// Die Zellweite in KARTENeinheiten. 🔴 Sie ist AVESMAPS_TERRAIN_CELL_SIZE aus
// api/_internal/app/terrain-store.php -- dieselbe Zahl, auf die `ecosystemHeightmapGrid` die
// gespeicherten Raster legt. Feiner weist der Server ab; groeber waere Detailverlust.
// 💣 Wer sie hier aendert, muss sie DORT mitaendern -- sonst rechnet die Karte auf einem anderen
// Gitter als der Speicher, und das faellt erst beim Hochladen auf.
const ECOSYSTEM_HYDRO_ZELLWEITE = 0.25;
// Abtragskraft und Hangkriechen der Erosion. Im Mockup als Regler abgenommen; hier fest, weil sie die
// HANDSCHRIFT des Gelaendes beschreiben und nicht die einzelne Flaeche (AGENTS.md: „zwei Schalter,
// nicht die Werkstatt"). ⚠️ Hangkriechen klein halten -- ueber 0,1 buegelt es die Rinnen wieder
// glatt, im Mockup an vier Stufen gemessen.
// 🔴 DIE VORGABEN DER FUENF REGLER. Sie stehen HIER, weil hier gerechnet wird -- die Oberflaeche
// LIEST sie (`terrainDefaults`), sie schreibt sie nicht ab. Eine zweite Fassung waere genau die
// Divergenz, an der die Anzeige „(auto)" und die tatsaechliche Rechnung auseinanderlaufen.
// ⚠️ Es sind die im Mockup abgenommenen Werte (Owner 04.09.2026 am Bild von Roter Sichel und
// Finsterkamm), nicht geratene.
const ECOSYSTEM_HYDRO_BERGFORM = 2.5;
const ECOSYSTEM_HYDRO_RAUSCHEN = 0.35;
const ECOSYSTEM_HYDRO_SATTEL = 0.75;
const ECOSYSTEM_HYDRO_ABTRAG = 0.05;
const ECOSYSTEM_HYDRO_KRIECHEN = 0.03;
// Wie viele Erosionsschritte hinter dem Regler „Erosion" (0..5) stehen.
//
// 🔴 EINE STUFE IST KEINE ITERATION. Der vorhandene Regler laeuft 0..5 (er hiess in V8
// `terrain_levels`); 150 Schritte sind die im Mockup abgenommene Vorgabe und liegen bei Stufe 3.
// ⚠️ Die Kennlinie ist am unteren Ende bewusst flach -- zwischen „keine Erosion" und „ein bisschen"
// liegt der sichtbarste Unterschied.
const ECOSYSTEM_HYDRO_EROSIONSSTUFEN = [0, 40, 90, 150, 240, 360];
// 🔴 Die Vorgabestufe -- sie stand als Literal `3` im Uebersetzer und ein zweites Mal in der
// Oberflaeche, sobald die Erosion einen eigenen Regler bekam (04.09.2026). Eine abgeschriebene
// Vorgabe laesst „(auto)" eine andere Zahl anzeigen als die, mit der gerechnet wird.
const ECOSYSTEM_HYDRO_EROSION_VORGABE = 3;
// 🔴 DAS PLATEAU: wie weit vom FLAECHENRAND die Abbruchkante steht, als Anteil 0..1 des groessten
// Randabstands. 1 = die Mittelachse selbst, also der Kamm von heute (Vorgabe, nichts aendert sich);
// kleinere Werte schieben die Kante nach aussen, bis bei 0 die ganze Flaeche Plateau waere.
// ⭐ Die Familie ist die ABSTANDSKARTE zum Rand, und sie ist genau die richtige: ihre Isolinien sind
// geschrumpfte Kopien des Randes -- die Wand ist deshalb rundherum gleich breit --, und ihr Maximum
// IST die Mittelachse. Ein Kreisradius um die Kammlinie kann das nicht: er kennt die Form der
// Flaeche nicht und liess bei einem herzfoermigen Berg links schmale und rechts breite Waende stehen
// (Owner 04.09.2026, am Bild: „es sollte mit uebereinstimmung zum rand beginnen und immer mehr zum
// kamm wandern").
const ECOSYSTEM_HYDRO_PLATEAU_VORGABE = 1;
// 🔴 DIE HYPSOMETRIE -- das hypsometrische Integral (Strahler 1952), also
//   HI = (mittlere Hoehe - min) / (max - min).
// Bei uns ist das Minimum 0 (Fusshoehen-Invariante), das HI ist also schlicht Mittelhoehe geteilt
// durch Gipfelhoehe. Es beschreibt, wie die FLAECHE sich ueber die Hoehe verteilt: ueber 0,6
// jugendlich (massig, Hochflaechen erhalten), 0,35 bis 0,6 reif, darunter Altersstadium
// (Restberge ueber weitem Vorland). Die Alpen liegen um 0,4 bis 0,5.
// ⭐ 0 heisst „nicht gesetzt" -- dann bleibt die Verteilung, die sich aus Kamm, Rauschen und Erosion
// ergibt. Live gemessen (04.09.2026): Rote Sichel 0,276, Finsterkamm 0,233, beide im Altersstadium.
const ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE = 0;
// 💣 DIE KLEMME IST KEINE GESCHMACKSFRAGE, SIE SCHUETZT DIE NAHTSTELLEN. Die Felder zweier
// ueberlappender Flaechen werden ADDIERT; dass das keine Stufe gibt, haengt allein daran, dass jedes
// zum Rand hin auf 0 auslaeuft. Wie BREIT dieser Auslauf ist, bestimmt die Potenz: unter 0,2 wird
// aus dem Auslauf eine Wand, und die Naht ist als Kante sichtbar. Die Zahl stammt aus der frueheren
// Hoehenfunktion, wo sie mit derselben Begruendung steht.
const ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN = 0.2;
const ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX = 8;

/* ═════════════════════════════════════════════════════════════════════════════
   VORLAGEN -- benannte Gelaendeformen statt zwoelf einzelner Zahlen
   ═════════════════════════════════════════════════════════════════════════════ */

// 🔴 ZWEI TABELLEN, WEIL ES ZWEI FRAGEN SIND: die MORPHOLOGIE sagt, welche FORM das Gelaende hat,
// die HOEHENSTUFE, wie hoch es liegt. Ein Kuppengebirge gibt es im Huegelland wie im Hochgebirge, und
// eine einzige Liste mit allen Kreuzungen haette 40 Eintraege.
// ⚠️ Sie sind DATEN, kein Code: eine neue Form ist ein Eintrag, kein `if`. Und sie setzen nur die
// Regler, die zu ihrer Frage gehoeren -- die Morphologie fasst die Kammhoehe nicht an, die
// Hoehenstufe keine Formregler.
//
// 💣 EINE VORLAGE IST EIN AUSGANGSPUNKT, KEIN ZUSTAND. Sie schreibt Werte in die Regler und ist
// danach vergessen; gespeichert werden die ZAHLEN, nicht der Name. Wer die Vorlage speicherte, muesste
// bei jeder Aenderung an dieser Tabelle entscheiden, ob bestehende Flaechen mitwandern -- und beides
// waere falsch: mitwandern aendert Gelaende hinter dem Ruecken, nicht mitwandern macht den
// gespeicherten Namen zur Luege.
// 🔴 DIE ZEHN FORMEN SIND DIE GEOMORPHOLOGISCHE SYSTEMATIK, KEINE ERFUNDENE LISTE (Owner
// 04.09.2026, mit der Typenliste aus der Wikipedia). Neun davon tragen ihren Fachnamen samt
// Musterbeispiel; die zehnte ist „Karst" -- der gewachsene Bestand der Roten Sichel, den der Owner
// am Tag davor als Vorlage festgehalten hat.
// ⚠️ Die Reihenfolge ist die des Auswahlfeldes UND der Handbuchgrafik: erst die fuenf Formen MIT
// Relief (drei linienfoermige, zwei aus gemeinsamem Fuss), dann die drei abgetragenen, dann der
// Einzelberg und der Sonderfall. Wer sie umsortiert, sortiert beides um.
//
// 💣 DIE ALTEN SCHLUESSEL BLEIBEN LESBAR -- `ECOSYSTEM_HYDRO_MORPH_ALTNAMEN` weiter unten
// uebersetzt sie. Eine Flaeche speichert NUR ihre Zahlen, der Vorlagenname ist Herkunftsangabe;
// ohne die Uebersetzung staende an einer gespeicherten Flaeche ploetzlich „Eigene Werte", obwohl
// sich an ihrem Gelaende nichts geaendert hat.
const ECOSYSTEM_HYDRO_MORPHOLOGIEN = [
	{
		key: "kammgebirge",
		name: "Kammgebirge",
		// Linienfoermig aneinandergereihte Bergzuege mit EINER Hauptkammlinie (Riesengebirge,
		// Bachergebirge). Der Kamm traegt das Bild: `sattel` fast ohne Durchhang, dazu eine GROBE
		// Koernung und wenige Stufen -- beides haelt die Flanken glatt, damit die eine Linie nicht in
		// Seitenrippen zerfaellt. Genau daran unterscheidet er sich vom Gratgebirge.
		// 🪟 `plateau` 0,9 statt 1: das Riesengebirge traegt Hochflaechen am Kamm; ein Hauch Tafel
		// verbreitert den Ruecken, ohne ihn zur Tafel zu machen.
		werte: { plateau: 0.9, hypsometrie: 0.45, erosion: 3, bergform: 2, rauschen: 0.25,
			sattel: 0.95, koernung: 14, stufen: 3, talbreite: 1.6, einschnitt: 550 },
	},
	{
		key: "gratgebirge",
		name: "Gratgebirge",
		// Linienfoermige Bergzuege mit ausgepraegten, VERAESTELTEN Kammlinien (Taunus, Salzburger
		// Schieferalpen). Die Veraestelung ist sein Merkmal und kommt aus dem Rinnennetz: feine
		// Koernung, viele Stufen, volle Erosion, enge Taeler.
		// 🪟 `sattel` 0,88 statt 0,9: der Kamm bleibt durchgehend, aber leicht eingesattelt -- eine
		// Linie ohne jede Einsattelung veraestelt nicht, sie bleibt ein Kamm.
		werte: { plateau: 1, hypsometrie: 0.4, erosion: 5, bergform: 2, rauschen: 0.45,
			sattel: 0.88, koernung: 5, stufen: 6, talbreite: 0.9, einschnitt: 800 },
	},
	{
		key: "kettengebirge",
		name: "Kettengebirge",
		// Linienfoermige Bergzuege mit MEHREREN, parallel gestaffelten Kaemmen (Alpen und die uebrigen
		// alpidischen Gebirge).
		// 🔴 DIE STAFFELUNG KOMMT AUS DEM RAUSCHEN, nicht aus einem eigenen Regler: kraeftiges
		// Rauschen bei MITTLERER Koernung und WENIGEN Stufen legt einige wenige grosse Ruecken neben
		// den Hauptkamm, statt ihn wie beim Gratgebirge in viele kleine Rippen zu zerlegen. Feiner
		// gekoernt entstuende Zerfaserung, groeber nur ein einziger Ruecken.
		// ⚠️ Der tiefste `einschnitt` aller Formen -- alpine Laengstaeler sind glazial uebertieft.
		// 🪟 `hypsometrie` 0,40 statt 0,50 (Owner 04.09.2026, gegen Copernicus-DEM-Graustufen
		// gemessen). Der Regler gilt dem GRUNDRELIEF -- Taeler und Erosion heben den Wert danach noch
		// an. 0,50 kommt im fertigen Modell bei rund 0,62 heraus und liest sich schon tafelartig; 0,40
		// landet bei rund 0,50, und das ist der Alpenwert.
		werte: { plateau: 1, hypsometrie: 0.4, erosion: 5, bergform: 2.5, rauschen: 0.5,
			sattel: 0.92, koernung: 9, stufen: 4, talbreite: 1.1, einschnitt: 1100 },
	},
	{
		key: "kuppengebirge",
		name: "Kuppengebirge",
		// Unregelmaessig aufragende Gipfel, die sich aus einem GEMEINSAMEN Gebirgsfuss erheben
		// (Frankenwald, die Randgebirge der Alpen). Der gemeinsame Fuss ist der Unterschied zum
		// Inselberg: `sattel` haengt deutlich durch, aber nicht so tief, dass die Kuppen den
		// Zusammenhang verlieren.
		werte: { plateau: 1, hypsometrie: 0.33, erosion: 4, bergform: 3.5, rauschen: 0.3,
			sattel: 0.55, koernung: 9, stufen: 4, talbreite: 1.6, einschnitt: 450 },
	},
	{
		key: "massengebirge",
		name: "Massengebirge",
		// Deutlich geschlossene Erhebung gegenueber dem Umland, ohne erkennbare Hauptrichtung
		// einzelner Gebirgszuege (Harz, franzoesisches Zentralmassiv).
		// 🪟 `plateau` von 0,55 auf 0,75: bei 0,55 war das Bild vom Plateaugebirge kaum zu
		// unterscheiden (43,9 % gegen 42,3 % Flaeche auf Gipfelhoehe). Ein Massengebirge hat einen
		// breiten KERN, keine Tafel -- den Unterschied muss man sehen koennen, sonst sind es zwei
		// Namen fuer eine Form.
		// 🪟 `hypsometrie` von 0,55 auf 0,47 in der dritten Runde: bei 0,55 saettigte sie an derselben
		// Grenze wie das Plateau (die Potenz steht dort an ihrer Klemme), und beide Vorlagen landeten
		// bei HI 0,66. Massig, aber keine Tafel.
		// 🔴 Hiess bis zum 04.09.2026 „Massiv" -- der Fachname ist „Massengebirge", die Werte sind
		// dieselben, die der Owner am Bild abgenommen hat.
		werte: { plateau: 0.75, hypsometrie: 0.47, erosion: 3, bergform: 4, rauschen: 0.35,
			sattel: 0.8, koernung: 10, stufen: 4, talbreite: 1.5, einschnitt: 500 },
	},
	{
		key: "plateaugebirge",
		name: "Plateaugebirge",
		// Gebirge, bei denen nur noch der Fuss erhalten ist: keine Kammlinie, wenig Gipfelbildung
		// (Schwaebische Alb). Die Deckschicht haelt, also wenig Erosion.
		// 🔴 DIE WERTE SIND UNVERAENDERT (Owner 04.09.2026: „die jetzigen einstellungen von pleateau
		// bleiben auch"). Nur der Schluessel heisst jetzt `plateaugebirge` statt `plateau`.
		werte: { plateau: 0.25, hypsometrie: 0.6, erosion: 1, bergform: 0.5, rauschen: 0.15,
			sattel: 0.95, koernung: 12, stufen: 3, talbreite: 1.5, einschnitt: 500 },
	},
	{
		key: "rumpfgebirge",
		name: "Rumpfgebirge",
		// Gebirge, von denen nur der Rumpf uebriggeblieben ist -- eine erhobene Huegellandschaft
		// (Boehmische Masse): breite, flache Ruecken, tiefes HI, maximale Erosion. Das ist, was die
		// Rote Sichel und der Finsterkamm heute SIND (HI 0,28 / 0,23).
		// 🪟 `plateau` von 0,7 auf 0,85: ein Rumpf ist ABGETRAGEN, er traegt keine Tafel. Bei 0,7 stand
		// im Bild noch ein Plateaurest in der Mitte.
		werte: { plateau: 0.85, hypsometrie: 0.3, erosion: 5, bergform: 2, rauschen: 0.3,
			sattel: 0.8, koernung: 16, stufen: 5, talbreite: 2, einschnitt: 400 },
	},
	{
		key: "schild",
		name: "Schild",
		// Ein alter Gebirgsrumpf als Tafelland, der als Gebirge nicht mehr erkennbar ist (Baltischer
		// Schild) -- die flachste Form der Liste.
		// 🔴 ER IST NICHT DASSELBE WIE DAS PLATEAUGEBIRGE, und der Unterschied ist das ALTER: das
		// Plateau traegt eine haltende Deckschicht (`erosion: 1`) mit einer Abbruchkante, der Schild
		// ist durcherodiert (`erosion: 5`) und laeuft in weiten Mulden aus (`talbreite` 3,
		// `einschnitt` 200 -- die flachsten Taeler). Sein hohes HI sagt genau das aus, was sein Name
		// meint: fast alles liegt auf einer Hoehe.
		// 💣 `hypsometrie` 0,70 IST DAS MAXIMUM DES REGLERS (`index.html`: `max="0.7"`), keine
		// gewaehlte Zahl. Hier stand 0,72 -- darueber. Eine Vorlage schreibt ihre Werte mit
		// `regler.value = ...` in den Schieber, und der KLEMMT beim Zuweisen: der Editor saehe 0,70,
		// waehrend `avesmapsHydroVorlage` weiter 0,72 als Vorgabe meldet -- das Dreieck stuende neben
		// dem Griff und das ↺ bliebe fuer immer sichtbar, ohne dass jemand etwas verstellt hat.
		werte: { plateau: 0.15, hypsometrie: 0.7, erosion: 5, bergform: 0.3, rauschen: 0.12,
			sattel: 0.95, koernung: 20, stufen: 2, talbreite: 3, einschnitt: 200 },
	},
	{
		key: "inselberg",
		name: "Inselberg",
		// Ein Berg, der sich UNVERMITTELT aus einer Ebene erhebt (Zuckerhut, Uluru, die
		// mittelschwedischen Inselberge) -- das Altersstadium in Reinform.
		// 🔴 Hier sind die zwei frueheren Vorlagen „Haertling" und „Kegelberge" zusammengefallen: ein
		// Haertling IST ein Inselberg (der Uluru ist das Musterbeispiel fuer beides), und die
		// Kegelberge unterschieden sich von ihm nur durch etwas weniger Erosion. Zwei Namen fuer eine
		// Form; die Werte sind die des Haertlings, geschaerft auf „unvermittelt".
		// 🪟 `bergform` 8 und `sattel` 0,3: bei tiefem HI drueckt die Potenz das Umland flach, und ein
		// schmaler Kegel verschwindet darin. Der Restberg MUSS herausragen und ISOLIERT stehen, sonst
		// ist es ein Kuppengebirge -- im ersten Rendern war das Bild eine ebene Flaeche mit zwei
		// Punkten darauf.
		// 💣 0,3 IST DAS MINIMUM DES REGLERS (`index.html`: `min="0.3"`), nicht eine gewaehlte Zahl.
		// Hier stand 0,2 -- darunter, und damit unerreichbar: der Schieber klemmt beim Zuweisen auf
		// 0,3, waehrend die Vorlage weiter 0,2 als Vorgabe meldet. Dieselbe Falle wie beim Schild am
		// oberen Ende. Der Owner nennt es die minimale zulaessige Sattelverbindung: der Inselberg
		// steht so isoliert, wie dieses Modell es ueberhaupt zulaesst.
		werte: { plateau: 1, hypsometrie: 0.15, erosion: 5, bergform: 8, rauschen: 0.2,
			sattel: 0.3, koernung: 14, stufen: 3, talbreite: 2.5, einschnitt: 550 },
	},
	{
		key: "karst",
		name: "Karst",
		// 🔴 DIE WERTE DER ROTEN SICHEL, wie sie live gespeichert sind (Owner 04.09.2026: „gib genau
		// diesen einstellungen ein neues preset: Karst" -- am Bild der Sichel). Sie sind KEIN
		// gerechnetes Ideal, sondern ein gewachsener Bestand: grobe Koernung (23,6), volle Erosion,
		// kein Plateau, keine Hypsometrie-Vorgabe -- und als einzige der zehn kein Fachbegriff der
		// Systematik, sondern ein Bestandswert.
		// ⚠️ `hypsometrie: 0` heisst „nicht gesetzt" -- das Feld landet dort, wo es von selbst
		// hinfaellt (an der Sichel HI 0,276). Eine Zahl daraus zu machen waere eine Behauptung, die
		// der Owner nicht getroffen hat.
		werte: { plateau: 1, hypsometrie: 0, erosion: 5, bergform: 2.5, rauschen: 0.35,
			sattel: 0.75, koernung: 23.6, stufen: 5, talbreite: 1.5, einschnitt: 400 },
	},
];

// 🔴 DIE UEBERSETZUNG DER ALTEN SCHLUESSEL -- sie steht hier, weil die Tabelle darueber sich
// aendern darf und gespeicherte Flaechen es nicht duerfen.
// ⚠️ Eine Flaeche speichert NUR ihre zehn Zahlen; der Vorlagenname ist Herkunftsangabe und der
// Bezugspunkt der Dreiecke und ↺-Knoepfe. An ihrem GELAENDE aendert eine Umbenennung also nichts --
// ohne diese Tabelle staende dort aber „Eigene Werte", und die ↺ haetten kein Ziel mehr.
// 💣 „kegelberge" und „karstrelief" haben KEINEN eigenen Nachfolger: die Kegelberge sind im
// Inselberg aufgegangen (dieselbe Form, etwas weniger Erosion), das Karstrelief im Karst. Ihre
// Werte bleiben trotzdem an jeder Flaeche stehen, die sie gespeichert hat -- nur die Dreiecke zeigen
// dann auf die Vorgaben des Nachfolgers, und das ↺ erscheint entsprechend.
const ECOSYSTEM_HYDRO_MORPH_ALTNAMEN = {
	plateau: "plateaugebirge",
	massiv: "massengebirge",
	haertling: "inselberg",
	kegelberge: "inselberg",
	karstrelief: "karst",
};

// Der heutige Schluessel zu einem gespeicherten. Unbekanntes kommt unveraendert zurueck -- der
// Aufrufer entscheidet, was „kenne ich nicht" bedeutet (in der Oberflaeche: „Eigene Werte").
function avesmapsHydroMorphSchluessel(key) {
	const roh = String(key || "");

	return Object.prototype.hasOwnProperty.call(ECOSYSTEM_HYDRO_MORPH_ALTNAMEN, roh)
		? ECOSYSTEM_HYDRO_MORPH_ALTNAMEN[roh]
		: roh;
}

// 🔴 DIE HOEHENSTUFE SETZT NUR DIE KAMMHOEHE -- den Sockel, unter den der Kamm nicht faellt.
// ⚠️ Und sie HEBT nur: ein Gebirge mit eingetragenen Gipfeln auf 5.000 Schritt wird durch
// „Huegelland" nicht niedriger. Die Gipfel sind Messungen und gewinnen; die Stufe wirkt dort, wo das
// Gelaende sonst aus der Kammlinie allein entstuende. Der Hinweistext des Feldes sagt das.
// ⚠️ Ein Schritt ist rund ein Meter, die Zahlen folgen also den ueblichen Hoehenstufen.
const ECOSYSTEM_HYDRO_HOEHENSTUFEN = [
	{ key: "tiefland", name: "Tiefland", werte: { maximalhoehe: 150 } },
	{ key: "huegelland", name: "Hügelland", werte: { maximalhoehe: 400 } },
	{ key: "vorgebirge", name: "Vorgebirge", werte: { maximalhoehe: 800 } },
	{ key: "mittelgebirge", name: "Mittelgebirge", werte: { maximalhoehe: 1500 } },
	{ key: "hochgebirge", name: "Hochgebirge", werte: { maximalhoehe: 3200 } },
];

// Die Werte EINER Vorlage, oder null. ⚠️ Eine Kopie: der Aufrufer schreibt in die Regler, und die
// Tabelle darf sich dabei nicht veraendern.
function avesmapsHydroVorlage(liste, key) {
	const treffer = (Array.isArray(liste) ? liste : []).find((v) => v && v.key === String(key || ""));

	return treffer ? Object.assign({}, treffer.werte) : null;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. RASTER UND MASKEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 🔴 DAS RASTER RECHNET AUF EINER ZELLWEITE, NICHT AUF EINER ZELLZAHL -- und das ist keine
// Geschmacksfrage, sondern die Bedingung dafuer, dass das Ergebnis ueberhaupt gespeichert werden darf.
//
// 💣 `avesmapsTerrainGuardRasterShape` (api/_internal/app/terrain-store.php) WEIST JEDES RASTER AB,
// dessen Zelle feiner als AVESMAPS_TERRAIN_CELL_SIZE = 0,25 Karteneinheiten ist. Der Grund steht
// dort: der Anstieg ist eine TOTALVARIATION und waechst mit der Abtastdichte -- zwei Flaechen in
// verschiedener Aufloesung haetten unvergleichbare `ascent_schritt`.
// Eine feste Zellzahl verletzt das bei jeder kleinen Flaeche: mit n = 256 waere die Zelle erst ab
// 63,75 Einheiten bbox-Kante grob genug. Am Livebestand gemessen (04.09.2026) traefe das
// **41 der 69 Gebirge** -- die Mehrheit haette ihr Raster nie speichern koennen, und zwar erst beim
// Speichern und nicht beim Rechnen.
//
// ⭐ Und es loest den Owner-Auftrag mit: „das was ich seh soll das sein mit dem gerechnet wird."
// Anzeige und Speicherung rechnen jetzt auf DEMSELBEN Gitter -- dasselbe, das
// `ecosystemHeightmapGrid(bounds, 0.25)` aufspannt.
// ⚠️ `deckel` begrenzt die Zellzahl fuer die ANZEIGE (dort zaehlt Tempo, nicht Vergleichbarkeit);
// der Speicherlauf laesst ihn weg und bekommt die volle Aufloesung.
// 🔴 ZWEI MASKEN, UND DAS IST DER GANZE UNTERSCHIED (Owner 04.09.2026: „wenn zwei gebirge
// aneinander angrenzen bzw. sich ueberlappen teilen sie sich keine gemeinsame ausgangslage fuer die
// hoehe"):
//   `drin`  = das RECHENgebiet -- die eigene Flaeche PLUS die angrenzenden Gebirge.
//   `eigen` = das SPEICHERgebiet -- nur die eigene Flaeche.
//
// 💣 WARUM DAS NOETIG IST: `sorDurchgang` liest eine Zelle ausserhalb von `drin` als 0
// (`drin[k+1] ? h[k+1] : 0`) -- eine Dirichlet-Null am Flaechenrand. Jede Flaeche fiel damit an
// IHRER Kante auf null, auch wenn dahinter das naechste Gebirge weitergeht. Gemessen an zwei
// benachbarten Zuegen mit 2.600er Kaemmen: an der Naht ein Einschnitt auf 1.114 Schritt, also ein
// Tal, das es auf der Karte nicht gibt.
// ⭐ Mit dem Verbund laeuft die Loesung ueber die Naht hinweg und faellt erst am AUSSENrand des
// Verbunds auf null. Die Fusshoehen-Invariante bleibt damit wortwoertlich stehen -- sie gilt jetzt
// dem Verbund statt der einzelnen Flaeche, und genau das war immer ihr Sinn.
// ⚠️ Ohne `istImVerbund` ist `eigen` dasselbe Array wie `drin` -- ein Aufrufer, der den Verbund
// nicht kennt, rechnet exakt wie vorher.
function baueRaster(bounds, cellSize, istDrin, deckel, istImVerbund) {
	const spanX = bounds.max_x - bounds.min_x;
	const spanY = bounds.max_y - bounds.min_y;
	let cell = Number(cellSize) > 0 ? Number(cellSize) : ECOSYSTEM_HYDRO_ZELLWEITE;
	if (cell < ECOSYSTEM_HYDRO_ZELLWEITE) {
		cell = ECOSYSTEM_HYDRO_ZELLWEITE;    // nie feiner als die Schranke des Speichers
	}
	if (Number(deckel) > 8) {
		// Nur groeber werden, nie feiner: eine sehr grosse Flaeche bekommt fuer die Anzeige ein
		// groberes Gitter, damit ein Bild nicht Sekunden kostet.
		const noetig = Math.max(spanX, spanY) / (Number(deckel) - 1);
		if (noetig > cell) { cell = noetig; }
	}
	const w = Math.round(spanX / cell) + 1;
	const hh = Math.round(spanY / cell) + 1;
	const drin = new Uint8Array(w * hh);
	const verbund = typeof istImVerbund === "function";
	const eigen = verbund ? new Uint8Array(w * hh) : drin;
	let drinN = 0;
	let eigenN = 0;
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			const x = bounds.min_x + (i * cell);
			const y = bounds.min_y + (j * cell);
			const k = (j * w) + i;
			const selbst = istDrin(x, y);
			if (selbst) {
				eigen[k] = 1;
				eigenN++;
			}
			// Das Rechengebiet ist die eigene Flaeche PLUS die Nachbarn.
			if (selbst || (verbund && istImVerbund(x, y))) {
				drin[k] = 1;
				drinN++;
			}
		}
	}

	return {
		w, hh, cell, drin, drinN, eigen, eigenN, bounds,
		cellS: cell * SCHRITT_JE_EINHEIT,
		x: (i) => bounds.min_x + i * cell,
		y: (j) => bounds.min_y + j * cell,
		i: (x) => Math.round((x - bounds.min_x) / cell),
		j: (y) => Math.round((y - bounds.min_y) / cell),
	};
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE CONSTRAINTS
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Gipfel als festgehaltene Zellen -- als KEGEL, nicht als Punkt.
//
// 💣 EIN PUNKT IST IN DER LAPLACE-LOESUNG EINE SINGULARITAET: ein Dorn, den die Diffusion sofort
// wieder abrundet. Ein Gipfel ist eine Kuppe, kein Nadelstich. Deshalb mindestens Radius 1 Zelle.
//
// 🔴 DER RADIUS IST DIE „BEDEUTUNG DES EINZELBERGS" (Owner 04.09.2026). Er entscheidet, wie weit ein
// Berg ausstrahlt, bevor das Grundrelief uebernimmt -- mit Radius 0 ist er ein Nadelstich im Kamm,
// mit grossem Radius ein eigenstaendiges Massiv.
//     h(d) = H · (1 − (d/rad)²)³        die Kuppe des heutigen Feldbaus, Zeichen fuer Zeichen
// 🔴 ABER ALS CONSTRAINT, NICHT ALS SUMMAND -- und das ist der ganze Unterschied zur Buckelsumme.
// Zwei ueberlappende Kegel ADDIEREN sich nicht, es gewinnt der hoehere. Genau daran scheitert das
// heutige Feld: 27 von 49 Gipfeln lesen ihre Zahl nicht, bis +5.820 Schritt zu hoch, weil sich bis
// zu fuenf Kuppen mit 27 Meilen Radius aufsummieren. Hier bleibt jeder Gipfel exakt bei seiner Zahl,
// egal wie viele Kegel sich ueberlagern.
//
// 🔴 Ohne erfasste Hoehe gilt ECOSYSTEM_HEIGHT_DEFAULT = 5.000 Schritt (Owner-Entscheid 2026-07-28) --
// dieselbe Zahl, mit der die Karte heute rechnet, nicht eine neue.
// ⚠️ `radius` in KARTENeinheiten. 0 (oder fehlend) heisst: nur die 3×3-Zellen wie bisher.
// 💣 ZWEI DURCHGAENGE, UND DIE REIHENFOLGE IST TRAGEND: erst alle KERNE, dann die Kegel.
// Ein Kegel mit 7,5 Meilen Radius ueberlappt seine Nachbarn, und "der Hoehere gewinnt" laesst dann
// einen 5.300er den Kern eines 3.000ers ueberschreiben -- gemessen 34,8 Schritt Abweichung, sobald
// die Bergform ueber null steht. Der KERN eines Gipfels ist unantastbar, der Kegelmantel nicht.
// ⚠️ `kern` reist heraus, weil auch die Seen ihn brauchen: ein Bergsee im Kegelmantel muss den
// Mantel ueberschreiben duerfen (sonst ist sein Spiegel nicht eben, gemessen 190 Schritt Spanne),
// einen Gipfelkern aber nie.
function stempleGipfel(r, h, fest, gipfel, vorgabe, kern) {
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	let gesetzt = 0;

	// Die Kerne (3×3), unantastbar. Die FORM des Berges kommt danach und ADDITIV
	// (addiereGipfelkegel) -- festgenagelt erzeugt sie einen Graben um jeden Gipfel.
	for (const p of gipfel) {
		const i = r.i(p.x);
		const j = r.j(p.y);
		if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
			continue;
		}
		const H = Number(p.h) > 0 ? Number(p.h) : standard;
		for (let dj = -1; dj <= 1; dj++) {
			for (let di = -1; di <= 1; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
					continue;
				}
				const k = jj * r.w + ii;
				if (!r.drin[k]) {
					continue;
				}
				if (H >= h[k]) { h[k] = H; fest[k] = 1; gesetzt++; if (kern) { kern[k] = 1; } }
			}
		}
	}

	return gesetzt;
}

// DIE EINZELBERGE -- ADDIERT, nicht festgenagelt (Owner 04.09.2026: „berge haben um sich herum
// keinen graben, sondern addieren sich aufs höhenfeld auf").
//
// 💣 DER GRABEN, UND WARUM ER ENTSTAND. Die erste Fassung stempelte den Kegel als CONSTRAINT. Am
// Kegelrand laeuft `H·(1−(d/rad)²)³` auf null aus -- festgenagelt heisst das: „hier ist die Hoehe
// null", und die Randwertaufgabe interpoliert von diesem 0-Ring nach aussen. Um jeden Gipfel lag
// ein dunkler Hof. Im Zahlenbild war nichts zu sehen (alle vier Invarianten blieben gruen), im
// gerenderten Feld sofort.
//
// 🔴 DIE FORM IST EINE UEBERHOEHUNG UEBER DEM ORTLICHEN NIVEAU, keine absolute Hoehe:
//     h(x) += (H − relief(Gipfelzelle)) · (1 − (d/rad)²)³
// Am Gipfel steht damit genau H, am Kegelrand exakt das Grundrelief -- kein Graben, keine Stufe.
//
// 🔴 UND DAS IST NICHT DIE BUCKELSUMME VON HEUTE. Dort ist die Amplitude die VOLLE Gipfelhoehe, und
// zwei Buckel addieren sich zu doppelter Hoehe (gemessen: 27 von 49 Gipfeln zu hoch, bis +5.820).
// Hier ist die Amplitude nur die UEBERHOEHUNG, und der Radius wird auf `0,72 × Abstand zum naechsten
// Gipfel` geklemmt -- die Hausregel aus `buildEcosystemHeightField`. Damit reicht kein Kegel bis zu
// einem anderen Gipfel, und jeder liest weiter genau seine Zahl.
// ⚠️ `fest`-Zellen (Gipfelkern, Kamm, spaeter Fluss/See) bleiben unberuehrt.
function addiereGipfelkegel(r, h, gipfel, radius, vorgabe, fest, mantel) {
	// ⚠️ `undefined` heisst „ableiten" und nimmt die Vorgabe; eine ausdrueckliche 0 heisst
	// „kein Kegel" und wird woertlich genommen -- dieselbe Regel wie bei den vier Reglern aus V8.
	const rad0 = radius === null || radius === undefined
		? ECOSYSTEM_HYDRO_BERGFORM
		: (Number(radius) > 0 ? Number(radius) : 0);
	if (!(rad0 > 0)) {
		return { zellen: 0, wirksam: [] };
	}
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	let gesetzt = 0;
	const wirksam = [];                        // die WIRKLICH benutzten Radien, je Gipfel

	for (const p of gipfel) {
		const i = r.i(p.x);
		const j = r.j(p.y);
		if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) {
			continue;
		}
		const H = Number(p.h) > 0 ? Number(p.h) : standard;
		// 🔴 Die Klemme aus dem heutigen Feldbau: 0,72 × Abstand zu SEINEM naechsten Nachbarn.
		// Ohne sie ueberlagern sich die Ueberhoehungen zweier Gipfel und beide lesen zu hoch.
		let naechster = Infinity;
		for (const q of gipfel) {
			if (q === p) { continue; }
			const d = Math.hypot(p.x - q.x, p.y - q.y);
			if (d < naechster) { naechster = d; }
		}
		const rad = Math.min(rad0, 0.72 * naechster);
		wirksam.push({ name: p.n || "", rad, geklemmt: 0.72 * naechster < rad0 });
		if (!(rad > 0)) { continue; }

		// 💣 DIE BASIS IST DAS NIVEAU AM KEGELRAND, NICHT AM GIPFEL. Am Gipfel steht seine
		// eingetragene Zahl -- er ist dort festgenagelt --, also waere `H − h[Gipfelzelle]` immer
		// exakt null und der Regler wirkungslos. Genau so gemessen: alle vier Bergform-Stufen
		// lieferten dasselbe Bild. Der Berg sitzt auf dem Niveau seines FUSSES auf.
		const reich = Math.ceil(rad / r.cell);
		let randSumme = 0;
		let randZahl = 0;
		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) { continue; }
				const k = jj * r.w + ii;
				if (!r.drin[k]) { continue; }
				const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
				if (d < 0.85 * rad || d > rad) { continue; }
				randSumme += h[k];
				randZahl++;
			}
		}
		const basis = randZahl > 0 ? randSumme / randZahl : 0;
		const ueber = H - basis;
		if (!(ueber > 0)) { continue; }        // das Relief traegt den Gipfel schon

		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = i + di;
				const jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) {
					continue;
				}
				const k = jj * r.w + ii;
				if (!r.drin[k] || (fest && fest[k])) {
					continue;
				}
				const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
				if (d >= rad) {
					continue;
				}
				const u = 1 - ((d / rad) * (d / rad));
				h[k] += ueber * u * u * u;
				if (mantel) { mantel[k] = 1; }
				gesetzt++;
			}
		}
	}

	return { zellen: gesetzt, wirksam };
}

// Minimaler Spannbaum (Prim) ueber die Gipfel -- er verbindet jeden mit seinem naechsten Nachbarn,
// ohne Kreise. Bei einem langgestreckten Gebirge ergibt das die Kammlinie.
function spannbaum(punkte) {
	const n = punkte.length;
	if (n < 2) {
		return [];
	}
	const drin = new Array(n).fill(false);
	const kanten = [];
	drin[0] = true;
	for (let s = 1; s < n; s++) {
		let bi = -1;
		let bj = -1;
		let bd = Infinity;
		for (let i = 0; i < n; i++) {
			if (!drin[i]) { continue; }
			for (let j = 0; j < n; j++) {
				if (drin[j]) { continue; }
				const d = Math.hypot(punkte[i].x - punkte[j].x, punkte[i].y - punkte[j].y);
				if (d < bd) { bd = d; bi = i; bj = j; }
			}
		}
		if (bj < 0) { break; }
		drin[bj] = true;
		kanten.push([bi, bj]);
	}

	return kanten;
}

// Der KAMM als Constraint.
//
// 🔴 DIE KAMMLINIE IST DIE BESCHRIFTUNGSKURVE DER FLAECHE, nicht eine eigene Rechnung.
// `properties.curve_label_line` reist in der Kartennutzlast mit (32 Punkte, Kartenkoordinaten) und
// entsteht in `api/_internal/app/curve-labels.php`: segmentieren -> vereinfachen -> Delaunay ->
// Innendreiecke -> Chordal Axis -> laengster Pfad -> Polynomglaettung. Das IST die Mittelachse --
// dieselbe Linie, auf der der Name der Landschaft laeuft.
// 🪤 Die erste Fassung dieses Prototyps baute statt dessen einen Spannbaum ueber die Gipfel. Der
// funktioniert, ist aber eine ZWEITE Antwort auf eine Frage, die das Haus laengst beantwortet --
// und man sieht es: seine geraden Segmente stehen als Knick im Kamm. Live haben 43 der 69
// Gebirgsflaechen eine Kurve.
// ⚠️ Der Spannbaum bleibt als RUECKFALL fuer die uebrigen 26 -- ein Gebirge ohne Kurve bekommt so
// trotzdem einen Kamm, sofern es mindestens zwei Gipfel hat.
//
// 🔴 DER UNTERSCHIED ZUM KAMM-ANWUCHS VOM 03.09.2026. Dort war der Kamm eine HUELLE, mit der die
// Buckelsumme multipliziert wurde -- eine Korrektur an einem Feld, dessen Struktur schon falsch war.
// Hier ist er eine RANDBEDINGUNG: die Loesung waechst von selbst zu ihm hin. Am Finsterkamm ist das
// der Unterschied zwischen neun isolierten Sternen und einem durchgehenden Grat (im Bild gemessen).
//
// 💣 EINE SCHON FESTE ZELLE IST EIN GIPFEL -- unantastbar. Der Riegel "nur anheben" reicht NICHT:
// eine Kammlinie laeuft ueber einen niedrigen Gipfel hinweg und hebt ihn an. Beim Bau genau so
// passiert -- der Hohe Stumpen las 2.394 statt seiner eingetragenen 2.300.
//
// Die HOEHE des Kamms an einer Stelle kommt von den Gipfeln: mit inversem Quadrat gewichtet, damit
// ein naher Gipfel den Ton angibt und ein ferner nur noch mittraegt. `sattel` senkt sie dort ab, wo
// kein Gipfel in der Naehe steht (0,75 = ein Sattel liegt bei drei Vierteln).
function kammHoeheAn(x, y, pts, sattel) {
	let summe = 0;
	let gewicht = 0;
	let naechster = Infinity;
	for (const p of pts) {
		const d2 = ((x - p.x) * (x - p.x)) + ((y - p.y) * (y - p.y));
		if (d2 < 1e-9) { return p.h; }
		const g = 1 / d2;
		summe += g * p.h;
		gewicht += g;
		if (d2 < naechster) { naechster = d2; }
	}
	if (!(gewicht > 0)) { return 0; }
	const mittel = summe / gewicht;
	// Durchhang: direkt an einem Gipfel voll, dazwischen auf `sattel` abgesenkt. Der Uebergang folgt
	// dem Abstand zum naechsten Gipfel, gemessen in Kammlaenge -- nicht in einer festen Zahl.
	const d = Math.sqrt(naechster);
	const nah = Math.exp(-d * d / (2 * 4 * 4));   // 4 Karteneinheiten = 12 Meilen Halbwertsbreite
	return mittel * (sattel + (1 - sattel) * nah);
}

// 💣 DER KAMM DARF NUR ANHEBEN, NIE ABSENKEN -- und dafuer muss er NACH einer ersten Loesung
// gestempelt werden. Die erste Fassung lief davor, als `h[k]` noch ueberall 0 war; der Riegel
// `H > h[k]` war damit wirkungslos, und die Kammhoehe wurde als feste Randbedingung eingefroren,
// auch wo die Gipfel ringsum das Gelaende hoeher ziehen. Ergebnis war eine RINNE statt eines Grats:
// gemessen am Finsterkamm lag die Kammzelle im Median **266 Schritt UNTER** ihrem hoechsten
// Nachbarn, und nur 26 % der Kammzellen standen erhaben. Im Bild sah das wie ein Spalt auf dem
// Bergkamm aus -- vom Owner gesehen, von keiner Kennzahl.
// ⭐ Deshalb ruft der Ablauf: Gipfel stempeln -> loesen -> Kamm stempeln (nur wo hoeher) -> loesen.
// 🔴 `grundhoehe` IST DER SOCKEL DES KAMMS -- die Hoehe, unter die er zwischen zwei Gipfeln nicht
// faellt. Sie kommt aus dem Regler „Maximalhoehe" (`terrain_avg_height`), und bis zum 04.09.2026 tat
// dieser Regler NICHTS, sobald ein Gipfel in der Flaeche stand: `kammPunkte` waehlte entweder die
// Gipfel ODER die Kurve auf Maximalhoehe, und mit Gipfeln gewannen immer die Gipfel. Gemessen an der
// Roten Sichel: 500 oder 12.000 eingestellt ergaben Zeichen fuer Zeichen dasselbe Feld.
// Owner 04.09.2026: „maximalhoehe wird durch gipfelhoehe uebertroffen aber die wirkung wirkt auf die
// ausgangsmap des gebirges oder" -- genau so.
// ⚠️ Der Sockel HEBT nur, er senkt nie: `Math.max`. Ein Gipfel, der niedriger ist als der Sockel,
// bleibt trotzdem auf seiner eingetragenen Zahl -- er ist `fest` und wird oben uebersprungen. Der
// Kamm um ihn herum steht dann hoeher als er; das ist die Aussage der Daten, nicht ein Fehler.
// Der Abstand jeder Zelle zum Flaechenrand, in Zellen (Chamfer 3-4, zwei Durchgaenge).
//
// ⚠️ Die 3-4-Metrik statt der echten euklidischen Distanz: sie kostet zwei lineare Durchgaenge statt
// einer Warteschlange und weicht um hoechstens 8 % ab -- fuer eine Isolinie, die eine Gelaendekante
// beschreibt, ist das unter der Zellweite und damit unsichtbar.
// 💣 AUSSERHALB IST 0, nicht „unendlich weit weg": die Karte misst den Abstand ZUM RAND, und der
// Rand ist die Grenze zwischen drin und draussen. Andersherum initialisiert misst sie den Abstand
// zum naechsten Innenpunkt und liefert ueberall 0.
function randAbstand(r) {
	const d = new Float64Array(r.w * r.hh);
	const GROSS = 1e9;
	for (let k = 0; k < d.length; k++) { d[k] = r.drin[k] ? GROSS : 0; }
	for (let j = 0; j < r.hh; j++) {
		for (let i = 0; i < r.w; i++) {
			const k = (j * r.w) + i;
			if (!r.drin[k]) { continue; }
			let v = d[k];
			if (i > 0) { v = Math.min(v, d[k - 1] + 3); }
			if (j > 0) { v = Math.min(v, d[k - r.w] + 3); }
			if (i > 0 && j > 0) { v = Math.min(v, d[k - r.w - 1] + 4); }
			if (i < r.w - 1 && j > 0) { v = Math.min(v, d[k - r.w + 1] + 4); }
			d[k] = v;
		}
	}
	for (let j = r.hh - 1; j >= 0; j--) {
		for (let i = r.w - 1; i >= 0; i--) {
			const k = (j * r.w) + i;
			if (!r.drin[k]) { continue; }
			let v = d[k];
			if (i < r.w - 1) { v = Math.min(v, d[k + 1] + 3); }
			if (j < r.hh - 1) { v = Math.min(v, d[k + r.w] + 3); }
			if (i < r.w - 1 && j < r.hh - 1) { v = Math.min(v, d[k + r.w + 1] + 4); }
			if (i > 0 && j < r.hh - 1) { v = Math.min(v, d[k + r.w - 1] + 4); }
			d[k] = v;
		}
	}

	return d;
}

// Das hypsometrische Integral eines Feldes: (Mittel - Min) / (Max - Min), gemessen INNERHALB.
function hypsometrischesIntegral(h, drin) {
	let summe = 0;
	let n = 0;
	let max = -Infinity;
	let min = Infinity;
	for (let k = 0; k < h.length; k++) {
		if (!drin[k]) { continue; }
		summe += h[k];
		n++;
		if (h[k] > max) { max = h[k]; }
		if (h[k] < min) { min = h[k]; }
	}
	if (!n || !(max > min)) { return 0; }

	return ((summe / n) - min) / (max - min);
}

// Das Feld auf ein Ziel-HI ziehen: `h' = max * (h/max)^p`, die Potenz per Bisektion gesucht.
//
// 🔴 MULTIPLIKATIV, KEIN SOCKEL. Bei h = 0 ist der Ausdruck exakt 0 -- die Fusshoehen-Invariante
// bleibt woertlich stehen, und mit ihr die Verschmelzung zweier ueberlappender Flaechen. Ein
// additiver Sockel („ueberall mindestens X") braeche beides, und zwar unsichtbar bis auf die Naht.
// 🔴 MONOTON: die Potenz erhaelt die Ordnung, also bleiben Taeler Taeler und Ruecken Ruecken. Sie
// verzieht nur die Verteilung, nicht die Struktur -- deshalb darf sie NACH der Erosion laufen, ohne
// deren Rinnennetz zu zerstoeren.
// ⚠️ Die GIPFEL werden ausgespart und danach zurueckgeschrieben: sie sind Messungen. Damit ist das
// erreichte HI leicht ungenau, sobald viel Flaeche festgehalten ist -- die Bisektion misst aber ueber
// ALLE Zellen und konvergiert trotzdem auf das, was mit den freien erreichbar ist.
function zieheAufHypsometrie(h, drin, fest, ziel) {
	let max = 0;
	for (let k = 0; k < h.length; k++) { if (drin[k] && h[k] > max) { max = h[k]; } }
	if (!(max > 0)) { return { potenz: 1, erreicht: 0 }; }
	const roh = Float64Array.from(h);
	const versuch = (potenz) => {
		for (let k = 0; k < h.length; k++) {
			if (!drin[k] || roh[k] <= 0) { continue; }
			h[k] = fest[k] ? roh[k] : max * Math.pow(roh[k] / max, potenz);
		}

		return hypsometrischesIntegral(h, drin);
	};
	// Ein groesseres HI braucht eine KLEINERE Potenz -- die Suche laeuft also absteigend.
	let lo = ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN;
	let hi = ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX;
	let potenz = 1;
	let erreicht = versuch(1);
	for (let it = 0; it < 24; it++) {
		potenz = (lo + hi) / 2;
		erreicht = versuch(potenz);
		if (erreicht > ziel) { lo = potenz; } else { hi = potenz; }
	}

	return { potenz, erreicht };
}

function stempleKamm(r, h, fest, gipfel, sattel, vorgabe, kurve, marke, grundhoehe, plateau) {
	const standard = Number(vorgabe) > 0 ? Number(vorgabe) : 5000;
	const pts = gipfel.map((p) => ({
		x: p.x, y: p.y, h: Number(p.h) > 0 ? Number(p.h) : standard,
	}));
	if (!pts.length) {
		return { quelle: "keine", kanten: 0, zellen: 0 };
	}

	// 0 heisst „kein Sockel" -- dieselbe Lesart wie ueberall sonst: ein nicht gesetzter Regler
	// (NULL in der Datenbank) darf nichts anheben.
	const sockel = Number(grundhoehe) > 0 ? Number(grundhoehe) : 0;

	// Die Linien, entlang derer gestempelt wird: die echte Kurve, sonst der Spannbaum.
	let linien = [];
	let quelle = "kurve";
	if (Array.isArray(kurve) && kurve.length >= 2) {
		linien = [kurve];
	} else {
		quelle = "spannbaum";
		linien = spannbaum(pts).map(([a, c]) => [[pts[a].x, pts[a].y], [pts[c].x, pts[c].y]]);
	}

	let zellen = 0;
	let stuecke = 0;
	for (const linie of linien) {
		for (let s = 1; s < linie.length; s++) {
			stuecke++;
			const [ax, ay] = linie[s - 1];
			const [bx, by] = linie[s];
			const len = Math.hypot(bx - ax, by - ay);
			const schritte = Math.max(2, Math.ceil((len / r.cell) * 2));
			for (let t = 0; t <= schritte; t++) {
				const u = t / schritte;
				const x = ax + (bx - ax) * u;
				const y = ay + (by - ay) * u;
				const i = r.i(x);
				const j = r.j(y);
				if (i < 0 || j < 0 || i >= r.w || j >= r.hh) {
					continue;
				}
				const k = j * r.w + i;
				if (!r.drin[k] || fest[k]) {
					continue;                      // fest = Gipfel, siehe oben
				}
				const H = Math.max(kammHoeheAn(x, y, pts, sattel), sockel);
				if (H > h[k]) { h[k] = H; fest[k] = 1; zellen++; if (marke) { marke[k] = 1; } }
			}
		}
	}

	// 🔴 AUS DER LINIE WIRD EINE FLAECHE -- die Abbruchkante als Isolinie des Randabstands.
	// Sie laeuft NACH der Linie, damit die Kammhoehen schon stehen; gestempelt wird mit derselben
	// Funktion (`kammHoeheAn`), also folgt das Plateau dem Kamm statt eben zu sein. Bei einer Flaeche
	// ohne Gipfel ist der Kamm konstant und das Plateau damit von selbst waagerecht -- ein Tafelberg;
	// mit Gipfeln neigt es sich mit ihnen.
	// 💣 `fest[k]` wird uebersprungen: ein GIPFEL behaelt seine eingetragene Zahl, auch wenn das
	// Plateau ueber ihn hinwegzoege. Er ragt dann heraus, oder er steht in einer Mulde -- beides ist
	// die Aussage der Daten, und die Messung gewinnt gegen die gerechnete Form (dieselbe Regel wie
	// beim Sockel darueber).
	const anteil = Number.isFinite(Number(plateau)) ? Number(plateau) : ECOSYSTEM_HYDRO_PLATEAU_VORGABE;
	if (anteil < 1 && anteil >= 0 && pts.length) {
		const dist = randAbstand(r);
		let dmax = 0;
		for (let k = 0; k < dist.length; k++) { if (r.drin[k] && dist[k] > dmax) { dmax = dist[k]; } }
		const schwelle = anteil * dmax;
		for (let j = 0; j < r.hh; j++) {
			for (let i = 0; i < r.w; i++) {
				const k = (j * r.w) + i;
				if (!r.drin[k] || fest[k] || dist[k] < schwelle) { continue; }
				const H = Math.max(kammHoeheAn(r.x(i), r.y(j), pts, sattel), sockel);
				if (H > h[k]) { h[k] = H; fest[k] = 1; zellen++; if (marke) { marke[k] = 1; } }
			}
		}
	}

	return { quelle, kanten: stuecke, zellen };
}



/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2b. DIE TAELER -- ABGEZOGEN, nicht festgenagelt
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 🔴 EIN TAL WIRD SUBTRAHIERT (Owner 04.09.2026: „wir wollen, dass die seen und flüsse täler bilden,
// die dem initialen höhenfeld abgezogen werden"). Das ist die Spiegelung der Bergform: ein Berg wird
// ADDIERT, ein Tal ABGEZOGEN -- beides misst sich am selben Grundrelief.
//
//     tal(x,y) = max ueber alle Segmente s in Reichweite:  k(d_s / w_s) · max(0, h − bed_s)
//     h'(x,y)  = h(x,y) − tal(x,y)
//     k(u)     = 1 − u²(3 − 2u)        Smoothstep: 1 auf der Achse, 0 am Talrand
//
// Am Fluss steht damit `min(h, bed)`, am Talrand das unveraenderte Gelaende, dazwischen eine glatte
// Flanke. `max` ueber die Segmente heisst: wo sich zwei Taeler ueberlagern, gilt der TIEFERE Schnitt.
//
// 💣 DIE ERSTE FASSUNG NAGELTE DIE FLUSSACHSE ALS RANDBEDINGUNG FEST und ueberliess das Tal der
// Randwertaufgabe. Das ist rechnerisch elegant und im Bild WIRKUNGSLOS: die Diffusion zieht eine
// ein Zelle breite Kerbe sofort wieder glatt. Der Owner am fertigen Mockup: „Konditioniertes Feld …
// da is nix zu sehen". Ein Tal braucht eine BREITE, und die muss man einstellen koennen.
// ⚠️ Damit faellt auch der Satz „es gibt keinen Talbreiten-Regler" -- er war ein Vorzug, den das
// Verfahren nur deshalb hatte, weil es keine Taeler machte.
//
// 🔴 NIE ANHEBEN: `max(0, h − bed)`. Wo das Gelaende schon unter dem Talboden liegt, passiert nichts.
// Am Flaechenrand ist h = 0, dort bleibt es 0 -- die Fusshoehe-0-Invariante gilt woertlich, und mit
// ihr die Verschmelzung zweier ueberlappender Flaechen.

// Grundbreite eines Flusstals (halbe Breite: Achse bis Talrand) in KARTENeinheiten.
// ⭐ 1,5 Einheiten = 4,5 Meilen, der Vorschlag aus dem Entwurf zu Fall #109.
const ECOSYSTEM_HYDRO_TALBREITE = 1.5;
// Ein Bach traegt ein schmaleres Tal. Er ist ein Fluss, kein Sonderfall -- ihn auszunehmen waere die
// Ausnahme, ihn schmaler zu machen die Beschreibung.
const ECOSYSTEM_HYDRO_BACH_ANTEIL = 0.5;
// Wie weit ein See ueber sein Ufer hinaus ein Becken bildet, als Vielfaches der Talbreite.
const ECOSYSTEM_HYDRO_SEEBECKEN = 1.6;
// Wie tief sich ein Lauf unter sein oertliches Gelaende eingraebt, in SCHRITT.
// 🔴 OHNE DIESE ZAHL GIBT ES FAST KEIN TAL. Der kumulative Tiefstwert allein schneidet nur dort,
// wo der Fluss durch eine Erhebung laeuft -- auf einem fallenden Hang ist er schon der tiefste
// Punkt seiner Strecke, und `max(0, h − bed)` ist null. Gemessen: die Achse des Weisswassers lag
// EINEN Schritt unter ihrem Nachbarn, im Bild war nichts zu sehen.
const ECOSYSTEM_HYDRO_EINSCHNITT = 400;
// Ab welchem Kernwert eine Zelle als SOHLE gilt (und nach der Erosion exakt auf den Talboden gesetzt
// wird) statt als Flanke. 0,85 entspricht rund einem Fuenftel der Talbreite um die Achse.
const ECOSYSTEM_HYDRO_SOHLE_KERN = 0.85;

function ecosystemTalKern(u) {
	if (u >= 1) {
		return 0;
	}
	const t = u < 0 ? 0 : u;

	return 1 - (t * t * (3 - (2 * t)));
}

// Abstand eines Punktes zu einer Strecke, plus der Parameter des Fusspunkts (fuer die Interpolation
// von Talboden und Breite entlang des Segments).
function ecosystemTalStrecke(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = (dx * dx) + (dy * dy);
	let t = 0;
	if (len2 > 0) {
		t = (((px - ax) * dx) + ((py - ay) * dy)) / len2;
		t = t < 0 ? 0 : (t > 1 ? 1 : t);
	}
	const fx = ax + (t * dx);
	const fy = ay + (t * dy);

	return { d: Math.hypot(px - fx, py - fy), t };
}

// Die Talsegmente aus Fluessen und Seen bauen -- mit dem Talboden je Punkt.
//
// 🔴 DER TALBODEN FLIESST NIE BERGAUF (Fall #109 woertlich). Entlang des Laufs wird der kumulative
// Tiefstwert genommen: was einmal gefallen ist, steigt nicht wieder.
// 💣 AUSSERHALB DER FLAECHE SAGT DAS FELD NICHTS, NICHT NULL. Ohne diese Regel zieht jeder von
// aussen kommende Fluss einen Canyon auf Fusshoehe 0 durch das ganze Massiv.
// 🔴 SEEN VOR FLUESSEN: ein Fluss, der durch einen See laeuft, uebernimmt dessen Spiegel und traegt
// ihn flussabwaerts weiter.
function baueEcosystemTaeler(r, hoehe, fluesse, seen, istImSee, optionen) {
	const opt = optionen || {};
	const breite = Number(opt.talbreite) > 0 ? Number(opt.talbreite) : ECOSYSTEM_HYDRO_TALBREITE;
	const bachAnteil = Number.isFinite(Number(opt.bachAnteil)) ? Number(opt.bachAnteil) : ECOSYSTEM_HYDRO_BACH_ANTEIL;
	const tiefe = Number.isFinite(Number(opt.tiefe)) ? Math.max(0, Math.min(1, Number(opt.tiefe))) : 1;
	// Wie tief sich ein Lauf unter sein oertliches Gelaende eingraebt, in SCHRITT.
	const einschnitt = Number.isFinite(Number(opt.einschnitt))
		? Math.max(0, Number(opt.einschnitt))
		: ECOSYSTEM_HYDRO_EINSCHNITT;
	const segmente = [];
	const spuren = [];
	const spiegel = [];
	const imSee = new Uint8Array(r.w * r.hh);
	// Die Zellen, durch die eine Flussachse oder eine Seeflaeche laeuft, mit ihrem Talboden.
	const achse = new Uint8Array(r.w * r.hh);
	const achseBoden = new Float64Array(r.w * r.hh);

	const lies = (x, y) => {
		const i = r.i(x);
		const j = r.j(y);

		return (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i])
			? null
			: hoehe[j * r.w + i];
	};

	// ---- 1. Die Seen: ein Becken je Wasserflaeche, Spiegel = Tiefstwert des Reliefs darueber -----
	const seenListe = Array.isArray(seen) ? seen : [];
	for (let sIndex = 0; sIndex < seenListe.length; sIndex++) {
		if (typeof istImSee !== "function") {
			break;
		}
		let tiefster = Infinity;
		let summe = 0;
		const zellen = [];
		for (let j = 0; j < r.hh; j++) {
			for (let i = 0; i < r.w; i++) {
				const k = (j * r.w) + i;
				if (!r.drin[k] || !istImSee(sIndex, r.x(i), r.y(j))) {
					continue;
				}
				zellen.push(k);
				imSee[k] = 1;
				summe += hoehe[k];
				if (hoehe[k] < tiefster) { tiefster = hoehe[k]; }
			}
		}
		if (!zellen.length || !isFinite(tiefster)) {
			continue;
		}
		const mittel = summe / zellen.length;
		// 🔴 EIN SEE IST EIN KNOTEN MIT EINER HOEHE, keine Strecke: seine Wasserflaeche ist EBEN.
		// Der Spiegel kann nicht ueber dem tiefsten Punkt seines Randes liegen -- sonst liefe er ueber.
		// 🪤 HIER STAND `tiefster * (1 - tiefe) + tiefe * tiefster` -- das ist algebraisch `tiefster`,
		// egal was `tiefe` sagt. Eine tote Rechnung, die aussieht wie eine Interpolation: alle vier
		// Regler-Stufen lieferten denselben Spiegel. Gefunden von einem Pruefagenten, nicht von einem
		// Test -- ein Regler, der nichts tut, faellt niemandem auf, der ihn nicht misst.
		// 🔴 Der See interpoliert zwischen seinem Tiefstwert und dem MITTLEREN Gelaende darueber:
		// `tiefe = 1` legt ihn auf den tiefsten Punkt (die reine Regel), kleinere Werte lassen ihn
		// hoeher stehen -- ein flacher Teich statt eines ausgeraeumten Beckens.
		const niveau = Math.max(0, (tiefe * tiefster) + ((1 - tiefe) * mittel));
		spiegel.push({ i: sIndex, hoehe: niveau, zellen: zellen.length });
		// Das Becken: jede Seezelle ist ein Talsegment der Laenge 0 mit dem Spiegel als Boden.
		for (const k of zellen) {
			const i = k % r.w;
			const j = (k - i) / r.w;
			if (!achse[k] || niveau < achseBoden[k]) { achse[k] = 1; achseBoden[k] = niveau; }
			segmente.push({
				ax: r.x(i), ay: r.y(j), bx: r.x(i), by: r.y(j),
				bedA: niveau, bedB: niveau,
				wA: breite * ECOSYSTEM_HYDRO_SEEBECKEN, wB: breite * ECOSYSTEM_HYDRO_SEEBECKEN,
				see: true,
			});
		}
	}

	// ---- 2. Die Fluesse ------------------------------------------------------------------------
	const fluesseListe = Array.isArray(fluesse) ? fluesse : [];
	let geraten = 0;
	for (const f of fluesseListe) {
		// Dicht abtasten: die gespeicherten Stuetzpunkte liegen teils weit auseinander, und der
		// Talboden folgte dann einer Sehne statt dem Gelaende.
		const dicht = [];
		for (let n = 1; n < f.p.length; n++) {
			const [ax, ay] = f.p[n - 1];
			const [bx, by] = f.p[n];
			const stueck = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r.cell * 0.5)));
			for (let t = 0; t < stueck; t++) {
				dicht.push([ax + ((bx - ax) * (t / stueck)), ay + ((by - ay) * (t / stueck))]);
			}
		}
		dicht.push(f.p[f.p.length - 1]);
		const innen = dicht.filter(([x, y]) => lies(x, y) !== null);
		if (innen.length < 2) {
			continue;
		}
		let lauf = innen;
		if (f.dir === "reverse") {
			lauf = innen.slice().reverse();
		} else if (!f.dir) {
			geraten++;
			const hA = lies(lauf[0][0], lauf[0][1]) || 0;
			const hB = lies(lauf[lauf.length - 1][0], lauf[lauf.length - 1][1]) || 0;
			if (hB > hA) { lauf = lauf.slice().reverse(); }
		}
		const w = breite * (f.bach ? bachAnteil : 1);
		let boden = Infinity;
		const spur = [];
		const boeden = [];
		for (const [x, y] of lauf) {
			const gelaende = lies(x, y);
			if (gelaende === null) {
				continue;
			}
			const i = r.i(x);
			const j = r.j(y);
			const k = (j * r.w) + i;
			// Ein Fluss im See IST der See: er uebernimmt den Spiegel und traegt ihn weiter.
			if (imSee[k]) {
				boden = Math.min(boden, hoehe[k]);
			} else {
				boden = Math.min(boden, gelaende);
			}
			// 💣 UND EIN GIPFELKERN HAELT DEN TALBODEN NICHT AUF. Der Kern ist beim Abzug
			// unantastbar (er traegt seine eingetragene Zahl), aber der BODEN muss trotzdem
			// weiterfallen -- sonst steigt der Lauf ueber den Gipfel und die Monotonie bricht.
			// Gemessen: der Sinop steigt ueber das Wallspitzhorn, der Gernbach ueber den
			// Horndrachenfels; beim Finsterkamm war das 100 % des Anstiegs.
			// ⚠️ Das ist ein DATENFEHLER, keine Modellfrage -- ein gezeichneter Fluss laeuft nicht
			// ueber einen Gipfel. Das Modell traegt ihn hier, statt ihn zu widerlegen.
			// 💣 IM SEE WIRD NICHT EINGESCHNITTEN. Ein Lauf, der eine Wasserflaeche durchquert, IST
			// dort der See -- er uebernimmt den Spiegel und graebt sich nicht darunter. Ohne diese
			// Ausnahme lag die Achse exakt `einschnitt` unter dem Spiegel, und die Seeflaeche war um
			// genau diesen Betrag nicht mehr eben (gemessen: Dunkelwasser 407..807 bei Einschnitt 400).
			// ⚠️ Der kumulative Tiefstwert bleibt: was der Lauf VOR dem See erreicht hat, traegt er
			// weiter -- ein See hebt einen Fluss nicht an.
			if (imSee[k]) {
				spur.push([x, y]);
				boeden.push(boden);
				continue;
			}
			// 💣 DER EINSCHNITT IST DIE ZUTAT, DIE GEFEHLT HAT. Der kumulative Tiefstwert allein
			// erzeugt fast nirgends ein Tal: auf einem fallenden Lauf IST der Fluss schon der
			// tiefste Punkt seiner bisherigen Strecke, also ist `h − bed` null und es wird nichts
			// geschnitten. Gemessen am Weisswasser: die Achse lag 1 Schritt unter ihrem Nachbarn.
			// Ein gezeichneter Fluss hat sich aber in SEIN Gelaende eingegraben -- also schneidet er
			// mindestens `einschnitt` tief unter das oertliche Niveau.
			// ⭐ Die Monotonie ueberlebt das: `min` zweier fallender Folgen faellt.
			const eingegraben = gelaende - einschnitt;
			boden = Math.min(boden, eingegraben);
			// Der Regler „Tiefe": 1 = bis auf den Talboden (die reine Regel aus #109), darunter bleibt
			// ein Anteil der oertlichen Hoehe stehen.
			const ziel = tiefe >= 1 ? boden : Math.max(boden, (1 - tiefe) * gelaende);
			spur.push([x, y]);
			boeden.push(ziel);
		}
		if (spur.length < 2) {
			continue;
		}
		for (let n = 1; n < spur.length; n++) {
			segmente.push({
				ax: spur[n - 1][0], ay: spur[n - 1][1], bx: spur[n][0], by: spur[n][1],
				bedA: boeden[n - 1], bedB: boeden[n],
				wA: w, wB: w, see: false,
			});
		}
		// 🔴 DIE ACHSE ALS MASKE, mit ihrem Talboden. Sie wird nach der Erosion EXAKT gesetzt --
		// ueber den Kernwert allein ging das schief: zwischen zwei Sohlenzellen liegen Rasterpunkte,
		// deren Kern knapp unter der Schwelle bleibt, und dort hebt die Erosion den Lauf wieder an.
		// Gemessen: 8.310 Schritt Anstieg entlang der Laeufe, obwohl die Sohle „gesetzt" wurde.
		for (let n = 0; n < spur.length; n++) {
			const i = r.i(spur[n][0]);
			const j = r.j(spur[n][1]);
			if (i < 0 || j < 0 || i >= r.w || j >= r.hh) { continue; }
			const k = (j * r.w) + i;
			if (!r.drin[k]) { continue; }
			// 💣 IM SEE GILT DER SPIEGEL, nicht der Talboden des Laufs. Ein Fluss traegt seinen
			// kumulativen Tiefstwert von weiter oben mit; stempelt er den in eine Wasserflaeche,
			// ist sie nicht mehr eben. Gemessen: vier der sieben Seen der Roten Sichel, bis 293
			// Schritt Spanne -- das Dunkelwasser stand bei Spiegel 807 und 541 auf der Achse.
			// ⚠️ Die Seen werden VOR den Fluessen gestempelt, ihr Spiegel steht also schon in `achse`.
			if (imSee[k]) { continue; }
			// Der TIEFSTE Anspruch gewinnt -- zwei Laeufe koennen dieselbe Zelle berueheren.
			if (!achse[k] || boeden[n] < achseBoden[k]) {
				achse[k] = 1;
				achseBoden[k] = boeden[n];
			}
		}
		spuren.push({ n: f.n, bach: !!f.bach, geraten: !f.dir, p: spur });
	}

	return { segmente, spuren, spiegel, geraten, imSee, achse, achseBoden, breite };
}

// Zellindex ueber die Talsegmente. 💣 Ohne ihn kostet der Abzug je Rasterpunkt einen Durchgang ueber
// ALLE Segmente -- an der Roten Sichel sind das rund 1.600, mal 65.000 Punkte.
function baueEcosystemTalIndex(tal, bounds) {
	const segmente = tal.segmente;
	let maxW = 0;
	for (const seg of segmente) {
		if (seg.wA > maxW) { maxW = seg.wA; }
		if (seg.wB > maxW) { maxW = seg.wB; }
	}
	const zelle = Math.max(0.5, maxW);
	const originX = bounds.min_x - zelle;
	const originY = bounds.min_y - zelle;
	const w = Math.ceil((bounds.max_x - originX) / zelle) + 2;
	const h = Math.ceil((bounds.max_y - originY) / zelle) + 2;
	const gitter = new Array(w * h);
	for (const seg of segmente) {
		const reich = Math.max(seg.wA, seg.wB);
		const i0 = Math.max(0, Math.floor((Math.min(seg.ax, seg.bx) - reich - originX) / zelle));
		const i1 = Math.min(w - 1, Math.floor((Math.max(seg.ax, seg.bx) + reich - originX) / zelle));
		const j0 = Math.max(0, Math.floor((Math.min(seg.ay, seg.by) - reich - originY) / zelle));
		const j1 = Math.min(h - 1, Math.floor((Math.max(seg.ay, seg.by) + reich - originY) / zelle));
		for (let j = j0; j <= j1; j++) {
			for (let i = i0; i <= i1; i++) {
				const key = (j * w) + i;
				(gitter[key] || (gitter[key] = [])).push(seg);
			}
		}
	}

	return { gitter, zelle, originX, originY, w, h };
}

// Der Talboden an einer Stelle -- der TIEFSTE, den ein Segment dort fordert, plus wie nah die
// Achse liegt (1 = auf der Achse, 0 = am Talrand).
//
// 🔴 SIE WIRD NACH DER EROSION GEBRAUCHT, und der Abzug allein reicht dort nicht: `max(0, h − bed)`
// kann eine Sohle nur SENKEN. Hat die Erosion tiefer gegraben als der Talboden, ist der Abzug null
// und die Sohle bleibt zu tief -- die Monotonie des Laufs bricht, gemessen 66.431 Schritt Anstieg.
function ecosystemTalSohle(index, x, y) {
	if (!index) {
		return null;
	}
	const i = Math.floor((x - index.originX) / index.zelle);
	const j = Math.floor((y - index.originY) / index.zelle);
	if (i < 0 || j < 0 || i >= index.w || j >= index.h) {
		return null;
	}
	let besterKern = 0;
	let boden = 0;
	for (let dj = -1; dj <= 1; dj++) {
		for (let di = -1; di <= 1; di++) {
			const ii = i + di;
			const jj = j + dj;
			if (ii < 0 || jj < 0 || ii >= index.w || jj >= index.h) { continue; }
			const eimer = index.gitter[(jj * index.w) + ii];
			if (!eimer) { continue; }
			for (let n = 0; n < eimer.length; n++) {
				const seg = eimer[n];
				const treffer = ecosystemTalStrecke(x, y, seg.ax, seg.ay, seg.bx, seg.by);
				const w = seg.wA + ((seg.wB - seg.wA) * treffer.t);
				if (!(w > 0) || treffer.d >= w) { continue; }
				const k = ecosystemTalKern(treffer.d / w);
				if (k > besterKern) {
					besterKern = k;
					boden = seg.bedA + ((seg.bedB - seg.bedA) * treffer.t);
				}
			}
		}
	}

	return besterKern > 0 ? { bed: boden, kern: besterKern } : null;
}

// Der Abzug an einer Stelle -- `max` ueber die Segmente in Reichweite.
function ecosystemTalAbzug(index, x, y, hoehe) {
	if (!index || !(hoehe > 0)) {
		return 0;
	}
	const i = Math.floor((x - index.originX) / index.zelle);
	const j = Math.floor((y - index.originY) / index.zelle);
	if (i < 0 || j < 0 || i >= index.w || j >= index.h) {
		return 0;
	}
	let groesster = 0;
	// 3x3 Zellen: ein Segment reicht hoechstens eine Zellweite weit (die Zelle IST die groesste Breite).
	for (let dj = -1; dj <= 1; dj++) {
		for (let di = -1; di <= 1; di++) {
			const ii = i + di;
			const jj = j + dj;
			if (ii < 0 || jj < 0 || ii >= index.w || jj >= index.h) {
				continue;
			}
			const eimer = index.gitter[(jj * index.w) + ii];
			if (!eimer) {
				continue;
			}
			for (let n = 0; n < eimer.length; n++) {
				const seg = eimer[n];
				const treffer = ecosystemTalStrecke(x, y, seg.ax, seg.ay, seg.bx, seg.by);
				const w = seg.wA + ((seg.wB - seg.wA) * treffer.t);
				if (!(w > 0) || treffer.d >= w) {
					continue;
				}
				const bed = seg.bedA + ((seg.bedB - seg.bedA) * treffer.t);
				// 🔴 NIE ANHEBEN -- wo das Gelaende schon unter dem Talboden liegt, passiert nichts.
				const schnitt = ecosystemTalKern(treffer.d / w) * Math.max(0, hoehe - bed);
				if (schnitt > groesster) { groesster = schnitt; }
			}
		}
	}

	return groesster;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DAS GRUNDRELIEF -- die Randwertaufgabe
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// ∇²h = 0 mit den Constraints als Dirichlet-Randwerten, geloest per SOR in Rot-Schwarz-Ordnung.
//
// ⚠️ Nachbarn AUSSERHALB der Flaeche zaehlen als Hoehe 0. Das ist die Fusshoehe-0-Invariante, an der
// die Verschmelzung zweier ueberlappender Flaechen haengt (map-features-ecosystem-height-combine.js) --
// sie gilt hier woertlich und nicht naeherungsweise.
function sorDurchgang(h, w, hh, drin, fest, omega, farbe) {
	for (let j = 1; j < hh - 1; j++) {
		for (let i = 1 + ((j + farbe) & 1); i < w - 1; i += 2) {
			const k = j * w + i;
			if (!drin[k] || fest[k]) { continue; }
			const s = (drin[k + 1] ? h[k + 1] : 0) + (drin[k - 1] ? h[k - 1] : 0)
				+ (drin[k + w] ? h[k + w] : 0) + (drin[k - w] ? h[k - w] : 0);
			const neu = h[k] + omega * (s / 4 - h[k]);
			h[k] = neu < 0 ? 0 : neu;
		}
	}
}

function vergroebern(h, drin, fest, w, hh) {
	const w2 = w >> 1;
	const h2 = hh >> 1;
	const H = new Float64Array(w2 * h2);
	const D = new Uint8Array(w2 * h2);
	const F = new Uint8Array(w2 * h2);
	for (let j = 0; j < h2; j++) {
		for (let i = 0; i < w2; i++) {
			let s = 0;
			let n = 0;
			let f = 0;
			let d = 0;
			for (let dj = 0; dj < 2; dj++) {
				for (let di = 0; di < 2; di++) {
					if (2 * j + dj >= hh || 2 * i + di >= w) { continue; }
					const k = (2 * j + dj) * w + (2 * i + di);
					if (drin[k]) { d = 1; s += h[k]; n++; if (fest[k]) { f = 1; } }
				}
			}
			const K = j * w2 + i;
			D[K] = d; F[K] = f; H[K] = n ? s / n : 0;
		}
	}

	return { h: H, drin: D, fest: F, w: w2, hh: h2 };
}

// 🔴 WARUM MEHRGITTER. SOR traegt Information je Durchgang nur EINE Zelle weit -- auf 256² braeuchte
// ein Gipfel hunderte Durchgaenge, bis er den Rand ueberhaupt „sieht". Grob vorloesen kostet ein
// Sechzehntel und bringt die grosse Form in wenigen Durchgaengen. Gemessen: 34 ms fuer die Rote Sichel.
function loeseRelief(h, w, hh, drin, fest, stufen, iterGrob, iterFein, omega) {
	if (stufen > 0 && w > 32 && hh > 32) {
		const g = vergroebern(h, drin, fest, w, hh);
		loeseRelief(g.h, g.w, g.hh, g.drin, g.fest, stufen - 1, iterGrob, iterGrob, omega);
		for (let j = 0; j < hh; j++) {
			for (let i = 0; i < w; i++) {
				const k = j * w + i;
				if (!drin[k] || fest[k]) { continue; }
				h[k] = g.h[Math.min(g.hh - 1, j >> 1) * g.w + Math.min(g.w - 1, i >> 1)];
			}
		}
	}
	for (let n = 0; n < iterFein; n++) {
		sorDurchgang(h, w, hh, drin, fest, omega, 0);
		sorDurchgang(h, w, hh, drin, fest, omega, 1);
	}

	return h;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   4. RAUSCHEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 💣 OHNE STOERUNG WIRD DAS NETZ RADIAL. Eine glatte Loesung hat keine Vorzugsrichtung; die Erosion
// findet dann in jeder Richtung dasselbe Gefaelle und zeichnet einen Stern statt eines Flussnetzes.
// Das Rauschen ist keine Verzierung, es ist der Keim der Verzweigung.
//
// 🔴 MULTIPLIKATIV, damit der Rand exakt 0 bleibt und ein Gipfel seine Zahl behaelt -- dieselbe
// Bauform wie `Faktor · Rohwert^Potenz` im heutigen Feldmodul, und aus demselben Grund.
// 🔴 KEIN Math.random(): die Saat kommt aus der Identitaet der Flaeche. Echter Zufall lieferte bei
// jedem Neuberechnen andere Reisezeiten und verschoebe Routen lautlos (oekosystem-instruction §4.2).
function hash2(seed, ix, iy) {
	let n = (seed ^ Math.imul(ix, 0x85EBCA6B) ^ Math.imul(iy, 0xC2B2AE35)) | 0;
	n = Math.imul(n ^ (n >>> 15), 0x2C1B3C6D); n ^= n >>> 12;
	n = Math.imul(n ^ (n >>> 15), 0x297A2D39); n ^= n >>> 15;

	return (n >>> 0) / 4294967296;
}

function wertRauschen(seed, x, y, cell) {
	const gx = Math.floor(x / cell);
	const gy = Math.floor(y / cell);
	const fx = x / cell - gx;
	const fy = y / cell - gy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash2(seed, gx, gy);
	const b = hash2(seed, gx + 1, gy);
	const c = hash2(seed, gx, gy + 1);
	const d = hash2(seed, gx + 1, gy + 1);
	const t = a + (b - a) * sx;
	const u = c + (d - c) * sx;

	return (t + (u - t) * sy) * 2 - 1;
}

function fbm(seed, x, y, cell, oktaven, gain) {
	let s = 0;
	let amp = 1;
	let tot = 0;
	let c = cell;
	for (let o = 0; o < oktaven; o++) {
		s += amp * wertRauschen(seed + o * 7919, x, y, c);
		tot += amp;
		amp *= gain;
		c /= 2;
	}

	return tot > 0 ? s / tot : 0;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   5. HYDROLOGIE
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

function Heap() { this.a = []; }
Heap.prototype.push = function (k, v) {
	const a = this.a;
	a.push([k, v]);
	let i = a.length - 1;
	while (i > 0) {
		const p = (i - 1) >> 1;
		if (a[p][0] <= a[i][0]) { break; }
		const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
	}
};
Heap.prototype.pop = function () {
	const a = this.a;
	const top = a[0];
	const last = a.pop();
	if (a.length) {
		a[0] = last;
		let i = 0;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let s = i;
			if (l < a.length && a[l][0] < a[s][0]) { s = l; }
			if (r < a.length && a[r][0] < a[s][0]) { s = r; }
			if (s === i) { break; }
			const t = a[s]; a[s] = a[i]; a[i] = t; i = s;
		}
	}

	return top;
};
Heap.prototype.size = function () { return this.a.length; };

// Senken fuellen (Priority-Flood + epsilon).
//
// 🔴 WARUM UEBERHAUPT. Ein D8-Netz braucht von JEDER Zelle einen Weg nach draussen. Eine Senke ist
// eine Sackgasse: dort bricht die Akkumulation ab -- genau da, wo ein Tal entstehen sollte. Das
// epsilon gibt jeder gefuellten Zelle ein winziges Gefaelle, damit die Fliessrichtung eindeutig bleibt.
// ⚠️ `senke` nimmt die echten SEEN aus -- die SIND Senken und sollen es bleiben.
function fuelleSenken(h, w, hh, drin, eps, senke) {
	const out = new Float64Array(h.length);
	const fertig = new Uint8Array(h.length);
	const q = new Heap();
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			const k = j * w + i;
			if (!drin[k]) { fertig[k] = 1; continue; }
			let rand = i === 0 || j === 0 || i === w - 1 || j === hh - 1;
			if (!rand) {
				for (let dj = -1; dj <= 1 && !rand; dj++) {
					for (let di = -1; di <= 1; di++) {
						if (!drin[(j + dj) * w + i + di]) { rand = true; break; }
					}
				}
			}
			if (rand) { out[k] = h[k]; fertig[k] = 1; q.push(h[k], k); } else { out[k] = Infinity; }
		}
	}
	while (q.size()) {
		const [, k] = q.pop();
		const i = k % w;
		const j = (k - i) / w;
		for (let dj = -1; dj <= 1; dj++) {
			for (let di = -1; di <= 1; di++) {
				if (!di && !dj) { continue; }
				const ni = i + di;
				const nj = j + dj;
				if (ni < 0 || nj < 0 || ni >= w || nj >= hh) { continue; }
				const nk = nj * w + ni;
				if (fertig[nk] || !drin[nk]) { continue; }
				out[nk] = (senke && senke[nk]) ? h[nk] : Math.max(h[nk], out[k] + eps);
				fertig[nk] = 1;
				q.push(out[nk], nk);
			}
		}
	}
	for (let k = 0; k < out.length; k++) {
		if (!drin[k] || !isFinite(out[k])) { out[k] = h[k]; }
	}

	return out;
}

// D8: jede Zelle bekommt EINEN Empfaenger -- den steilsten Abstieg unter acht Nachbarn.
// 💣 Gefaelle je LAENGE, nicht je Zelle: diagonal ist 1,414 mal weiter, und ohne das bevorzugt D8
// die Diagonalen sichtbar.
// ⚠️ Ein Nachbar ausserhalb der Flaeche zaehlt als Hoehe 0 -- das ist der Abfluss aus dem Gebirge.
function flussrichtung(h, w, hh, drin, cellS) {
	const rec = new Int32Array(h.length).fill(-1);
	const dist = new Float64Array(h.length);
	const diag = cellS * Math.SQRT2;
	for (let j = 0; j < hh; j++) {
		for (let i = 0; i < w; i++) {
			const k = j * w + i;
			if (!drin[k]) { continue; }
			let best = 0;
			let bk = -1;
			let bd = cellS;
			for (let dj = -1; dj <= 1; dj++) {
				for (let di = -1; di <= 1; di++) {
					if (!di && !dj) { continue; }
					const ni = i + di;
					const nj = j + dj;
					if (ni < 0 || nj < 0 || ni >= w || nj >= hh) { continue; }
					const nk = nj * w + ni;
					const d = (di && dj) ? diag : cellS;
					const s = (h[k] - (drin[nk] ? h[nk] : 0)) / d;
					if (s > best) { best = s; bk = drin[nk] ? nk : -2; bd = d; }
				}
			}
			rec[k] = bk;
			dist[k] = bd;
		}
	}
	// Topologische Reihenfolge: Empfaenger vor Gebern, per Zaehlsortierung ueber die Zuflusszahl.
	const nrec = new Int32Array(h.length);
	for (let k = 0; k < h.length; k++) { if (drin[k] && rec[k] >= 0) { nrec[rec[k]]++; } }
	const stapel = new Int32Array(h.length);
	let sp = 0;
	const ordnung = new Int32Array(h.length);
	let op = 0;
	for (let k = 0; k < h.length; k++) { if (drin[k] && nrec[k] === 0) { stapel[sp++] = k; } }
	while (sp) {
		const k = stapel[--sp];
		ordnung[op++] = k;
		if (rec[k] >= 0 && --nrec[rec[k]] === 0) { stapel[sp++] = rec[k]; }
	}

	return { rec, dist, ordnung, n: op };
}

// Flow Accumulation: in topologischer Reihenfolge reicht jede Zelle ihre Flaeche weiter.
//
// 🔴 HIER ENTSTEHT DAS NETZ. Nicht durch Zufallstreffer wie beim Tropfen-Verfahren, sondern
// deterministisch aus dem Relief. `vorgabe` prägt den GEZEICHNETEN Fluesen ihre Akkumulation auf --
// das ist „bekannte Hauptfluesse + simulierte Nebenentwaesserung" in einer Zeile.
function akkumuliere(fd, drin, zellFlaeche, vorgabe) {
	const acc = new Float64Array(drin.length);
	for (let k = 0; k < drin.length; k++) {
		if (drin[k]) { acc[k] = zellFlaeche + (vorgabe ? vorgabe[k] : 0); }
	}
	for (let n = 0; n < fd.n; n++) {
		const k = fd.ordnung[n];
		if (fd.rec[k] >= 0) { acc[fd.rec[k]] += acc[k]; }
	}

	return acc;
}

// Stream Power, IMPLIZIT geloest (Braun & Willett 2013, „FastScape").
//
//     dh/dt = -K · A^m · S^n     mit n = 1 analytisch:
//     h_i = (h_i + K·dt·A^m · h_rec / L) / (1 + K·dt·A^m / L)
//
// 🔴 DESHALB GEHEN GROSSE ZEITSCHRITTE: die Form ist unbedingt stabil, und die Hoehe kann per
// Konstruktion nie unter die ihres Empfaengers fallen. Ein Tropfen ist faktisch ein EXPLIZITES
// Verfahren und braucht winzige Schritte -- das ist der Grund, warum dort „keine milde Einstellung"
// existierte.
// ⚠️ In UMGEKEHRTER topologischer Reihenfolge: der Empfaenger muss schon neu stehen.
function streamPower(h, fd, acc, K, m, dt, fest) {
	for (let n = fd.n - 1; n >= 0; n--) {
		const k = fd.ordnung[n];
		if (fest && fest[k]) { continue; }
		const r = fd.rec[k];
		const hr = r >= 0 ? h[r] : 0;              // -2 = fliesst aus der Flaeche, Basis 0
		if (h[k] <= hr) { continue; }
		const f = K * dt * Math.pow(acc[k], m) / fd.dist[k];
		h[k] = (h[k] + f * hr) / (1 + f);
	}
}

// Hangdiffusion: was die Rinnen einschneiden, rundet das Kriechen wieder ab. Ohne sie wird das Bild
// nadelig; mit ihr entstehen die glatten Flanken zwischen den Rinnen.
//
// 💣 STABILITAETSGRENZE. Explizite Diffusion in 2D ist nur fuer D·dt/cell² ≤ 0,25 stabil. Beim Bau
// mit 0,78 gefahren -- die Durchschnittshoehe explodierte auf 4,2e29. Deshalb in Teilschritte
// zerlegt, statt den Wert stillschweigend zu klemmen: eingestellt wird eine STAERKE, keine
// Schrittweite.
function diffundiere(h, w, hh, drin, D, dt, cellS, fest) {
	const gesamt = D * dt / (cellS * cellS);
	const schritte = Math.max(1, Math.ceil(gesamt / 0.2));
	const f = gesamt / schritte;
	let cur = h;
	for (let s = 0; s < schritte; s++) {
		const out = Float64Array.from(cur);
		for (let j = 1; j < hh - 1; j++) {
			for (let i = 1; i < w - 1; i++) {
				const k = j * w + i;
				if (!drin[k] || (fest && fest[k])) { continue; }
				const e = drin[k + 1] ? cur[k + 1] : 0;
				const we = drin[k - 1] ? cur[k - 1] : 0;
				const su = drin[k + w] ? cur[k + w] : 0;
				const no = drin[k - w] ? cur[k - w] : 0;
				out[k] = cur[k] + f * (e + we + su + no - 4 * cur[k]);
				if (out[k] < 0) { out[k] = 0; }
			}
		}
		cur = out;
	}

	return cur;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6. DER LAUF
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// Ein Erosionsschritt samt HEBUNG.
//
// 💣 DIE HEBUNG WIRD NICHT EINGESTELLT, SONDERN GEMESSEN: nach jedem Schritt wird genau so viel
// gehoben, wie abgetragen wurde -- verteilt nach dem Startrelief (wo das Gebirge hoch ist, hebt es
// sich). Damit bleibt die Durchschnittshoehe von selbst stehen, und es gibt keine Zahl zu raten.
// ⚠️ Das ist die Antwort auf „es gibt keine milde Erosionseinstellung" (03.09.2026): mild oder stark
// aendert jetzt die FORM, nicht mehr die HOEHE. Gemessen ueber 150 Schritte: Ø 1.361 -> 1.392.
//
// 🔴 ZWEI MASKEN, UND DIE GRENZE HEISST: GEMESSENE GROESSE GEGEN MODELLIERTE FORM.
// Eine festgehaltene Zelle nimmt an der Hebung NICHT teil und wird auch nicht erodiert oder
// verrauscht. Fuer eine EINGETRAGENE Zahl ist das richtig, fuer eine erfundene Form ist es falsch:
//   `fest`     -- die Randwertaufgabe: Gipfelkern + Kegelmantel + Kamm + Fluss + See
//   `festEro`  -- die Erosion: nur Gipfelkern + Fluss + See (was wirklich gemessen ist)
//
// 💣 DAS IST ZWEIMAL SICHTBAR DANEBENGEGANGEN, beide Male vom Owner gesehen und von keiner Kennzahl:
//  - **Der Spalt auf dem Bergkamm.** Der Kamm liegt nur wenig ueber seiner Umgebung; die waechst mit
//    jeder Hebung an ihm vorbei. Gemessen am Finsterkamm: VOR der Erosion Median 1 Schritt unter dem
//    hoechsten Nachbarn, DANACH 360 -- nur 11 % der Kammzellen noch erhaben. Mit der Trennung: 21
//    Schritt, 49 % erhaben.
//  - **Die Bergform wurde zur glatten Kugel.** Ein festgehaltener Kegelmantel bekommt weder Rauschen
//    noch Rinnen und steht als polierte Halbkugel im Gelaende -- derselbe „weisse Blob", nur an
//    anderer Stelle erzeugt.
// ⚠️ Fehlt `festEro`, gilt `fest` -- der alte Stand, damit ein Aufrufer ohne die zweite Maske nicht
// stillschweigend seine Gipfel verliert.
function erosionsSchritt(zustand, opt) {
	const { r, senke, relief } = zustand;
	const fest = zustand.festEro || zustand.fest;
	let h = zustand.h;
	let vorher = 0;
	for (let k = 0; k < r.drin.length; k++) { if (r.drin[k]) { vorher += h[k]; } }

	const gefuellt = fuelleSenken(h, r.w, r.hh, r.drin, 1e-4, senke);
	const fd = flussrichtung(gefuellt, r.w, r.hh, r.drin, r.cellS);
	const acc = akkumuliere(fd, r.drin, r.cellS * r.cellS, zustand.accVorgabe);
	streamPower(h, fd, acc, opt.K, opt.m || 0.5, 1, fest);
	h = diffundiere(h, r.w, r.hh, r.drin, opt.D * r.cellS * r.cellS, 1, r.cellS, fest);

	let nachher = 0;
	for (let k = 0; k < r.drin.length; k++) { if (r.drin[k]) { nachher += h[k]; } }
	const verlust = vorher - nachher;
	// 🔴 GLEICHMAESSIG, NICHT HOEHENPROPORTIONAL (Owner 04.09.2026, am Bild entschieden). Hier stand
	// `h[k] += rate * relief[k]` -- die Hebung verteilte den Abtrag nach dem STARTRELIEF, hob also
	// dort am meisten, wo es schon hoch war. Das ist eine Rueckkopplung: hohe Stellen werden hoeher,
	// und da die Gipfel `festEro` sind und NICHT teilnehmen, waechst der Kamm um sie herum ueber sie
	// hinweg.
	//
	// 💣 GEMESSEN, nicht vermutet: der hoechste Punkt der Roten Sichel lag bei **10.995 Schritt**,
	// 65 % ueber dem hoechsten eingetragenen Gipfel (6.650) und fuenf Zellen neben der Adlerspitze;
	// beim Finsterkamm +62 %. Aufgeschluesselt kam der groesste Teil von hier: ohne Rauschen und ohne
	// Gipfelkegel, aber MIT dieser Hebung, standen immer noch +45 %. Das ist erfundene Geographie
	// neben eingetragener -- genau das, was dieses Modell nicht tun soll.
	//
	// ⭐ Vier Varianten gemessen (Rote Sichel): proportional 10.995 (+65 %, Mittel 1837) · Deckel je
	// Zelle 7.448 (+12 %, Mittel 1170 -- ein Drittel der Masse weg) · Deckel auf den hoechsten Gipfel
	// 6.650 (Mittel 1643) · **gleichmaessig 6.650 (0 %, Mittel 1837)**. Nur diese eine haelt den
	// Massenausgleich exakt UND den Gipfel als hoechsten Punkt.
	// ⚠️ Und sie ist auch die physikalisch richtige: tektonische Hebung ist ueber ein Gebirge
	// naeherungsweise gleichmaessig, nicht proportional zur aktuellen Hoehe.
	if (verlust > 0 && zustand.hebungZellen > 0) {
		const je = verlust / zustand.hebungZellen;
		for (let k = 0; k < r.drin.length; k++) {
			if (r.drin[k] && !fest[k]) { h[k] += je; }
		}
	}

	zustand.h = h;
	zustand.fd = fd;
	zustand.acc = acc;

	return zustand;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   7. DER TRICHTER -- die EINE Stelle, an der ein Gebirgsraster entsteht
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

function avesmapsHydroErosionsSchritte(stufe) {
	const s = Number(stufe);
	if (!Number.isFinite(s)) {
		return ECOSYSTEM_HYDRO_EROSIONSSTUFEN[ECOSYSTEM_HYDRO_EROSION_VORGABE];
	}
	const i = Math.max(0, Math.min(ECOSYSTEM_HYDRO_EROSIONSSTUFEN.length - 1, Math.round(s)));

	return ECOSYSTEM_HYDRO_EROSIONSSTUFEN[i];
}

// 🔴 ES GIBT GENAU EINEN ERZEUGER, und das ist der ganze Zweck dieser Funktion. Die Karte zeichnet
// das Raster, der Rasterlauf speichert es, die Wegfindung liest das Gespeicherte -- wer davon eine
// eigene Kette baut, zeigt ein anderes Gelaende als das, mit dem gerechnet wird. Genau diese Falle
// hat das Projekt bei den Quellen, den Listenzeilen und der Wiki-Zuweisung je einmal bezahlt.
//
// Die Reihenfolge ist NICHT frei -- jeder Schritt ist gemessen (siehe die Marken an den Bauteilen):
//   Gipfelkerne -> loesen -> Kamm -> loesen -> Bergform ADDIEREN -> Rauschen
//   -> TAELER ABZIEHEN (Fluesse + Seen) -> Erosion
// 💣 Kamm NACH dem ersten Loesen (sonst Rinne statt Grat) · Bergform ADDITIV (sonst Graben um jeden
// Gipfel) · Seen VOR Fluessen (ein Fluss im See IST der See) · die TAELER zuletzt und ABGEZOGEN, vom
// fertigen Grundrelief (als Randbedingung waren sie im Bild unsichtbar -- siehe baueEcosystemTaeler).
//
// @param eingabe {
//   bounds, istDrin(x,y),
//   peaks: [{x, y, h}], kurve: [[x,y]]|null,
//   fluesse: [{p:[[x,y]], dir, bach}], seen: [], istImSee(index, x, y),
//   zellweite: Kartenkoordinaten je Zelle (Vorgabe 0,25 = die Schranke des Speichers),
//   deckel: hoechstens so viele Zellen auf der laengeren Seite -- NUR fuer die Anzeige,
//   regler: { koernung, stufen, bergform, rauschen, sattel, erosion, maximalhoehe,
//             talbreite, bachAnteil, tiefe, einschnitt },
//   saat, onFortschritt(anteil)
// }
function avesmapsGebirgsRasterBauen(eingabe) {
	const e = eingabe || {};
	const reg = e.regler || {};
	const r = baueRaster(
		e.bounds,
		Number(e.zellweite) > 0 ? Number(e.zellweite) : ECOSYSTEM_HYDRO_ZELLWEITE,
		e.istDrin || (() => true),
		// ⚠️ `n` bleibt als Deckel gueltig: ein Aufrufer aus der Zeit vor der Zellweite meinte damit
		// „hoechstens so viele Zellen", und genau das tut `deckel`. Er kann nur GROEBER machen.
		Number(e.deckel) > 8 ? e.deckel : e.n,
		// ⚠️ Optional: ohne diese Funktion ist `eigen === drin`, und alles rechnet wie vorher.
		typeof e.istImVerbund === "function" ? e.istImVerbund : null
	);
	const zellen = r.w * r.hh;
	let h = new Float64Array(zellen);
	const fest = new Uint8Array(zellen);
	const festEro = new Uint8Array(zellen);
	const senke = new Uint8Array(zellen);
	const kern = new Uint8Array(zellen);
	const mantel = new Uint8Array(zellen);
	const kammMaske = new Uint8Array(zellen);
	const peaks = Array.isArray(e.peaks) ? e.peaks : [];
	const melde = typeof e.onFortschritt === "function" ? e.onFortschritt : null;

	// 🔴 Ohne Gipfel UND ohne Maximalhoehe bleibt die Flaeche flach -- dieselbe Regel wie in V8
	// (`buildEcosystemHeightField`): ein Gebirge ganz ohne Stuetzpunkt zu erfinden waere das
	// „erfundene Gelaendedetail", vor dem oekosystem-instruction.md §4.1 warnt.
	const maximalhoehe = Number(reg.maximalhoehe) > 0 ? Number(reg.maximalhoehe) : 0;
	if (!peaks.length && !(maximalhoehe > 0)) {
		return { r, h, fest, festEro, senke, kern, mantel, kammMaske, leer: true, schritte: 0 };
	}

	stempleGipfel(r, h, fest, peaks, ECOSYSTEM_HYDRO_STANDARDHOEHE, kern);
	// Eine Flaeche OHNE Gipfel bekommt ihr Niveau aus der Maximalhoehe -- als Kamm entlang der
	// Beschriftungskurve, damit sie eine Form hat statt einer gleichmaessigen Kuppel.
	const kammPunkte = peaks.length
		? peaks
		: (Array.isArray(e.kurve) && e.kurve.length
			? e.kurve.map((p) => ({ x: p[0], y: p[1], h: maximalhoehe }))
			: []);
	loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 60, 120, 1.85);
	if (melde) { melde(0.15); }

	const sattel = Number.isFinite(Number(reg.sattel)) ? Number(reg.sattel) : ECOSYSTEM_HYDRO_SATTEL;
	const plateau = Number.isFinite(Number(reg.plateau))
		? Math.max(0, Math.min(1, Number(reg.plateau)))
		: ECOSYSTEM_HYDRO_PLATEAU_VORGABE;
	let kamm = kammPunkte.length >= 2
		? stempleKamm(r, h, fest, kammPunkte, sattel, ECOSYSTEM_HYDRO_STANDARDHOEHE, e.kurve, kammMaske,
			maximalhoehe, plateau)
		: { quelle: "keine", kanten: 0, zellen: 0 };

	// 🔴 DIE MITTELACHSE ALS LETZTER RUECKFALL -- ohne sie bleibt das Feld exakt 0.
	//
	// 💣 LIVE GEMELDET AM 04.09.2026: „ich seh halt nix". Die Flaeche („Gorische Wueste") hatte KEINEN
	// Gipfel, und ihr Label keine gerechnete Beschriftungskurve -- die entsteht erst durch „Kurven
	// rechnen" im Landschaften-Editor. Damit war `kammPunkte` leer, `stempleKamm` lief gar nicht, und
	// die Randwertaufgabe loeste ein Feld ohne einen einzigen Zwang: ueberall 0. Der Editor stellte
	// zwoelf Regler ein und sah eine einfarbige Flaeche.
	// ⚠️ Und es sah nicht nach einem Fehler aus, sondern nach einer kaputten Anzeige -- die Regler
	// reagierten, der Dialog meldete nichts, nur das Bild blieb leer.
	//
	// ⭐ Die Achse ist schon da: das MAXIMUM der Abstandskarte zum Rand ist per Definition die
	// Mittelachse der Flaeche. Dieselbe Rechnung, die das Plateau formt, traegt hier den Kamm.
	// 🔴 Nur wenn eine Kammhoehe gesetzt ist. Ohne Gipfel UND ohne Kammhoehe bleibt die Flaeche flach
	// -- das ist die alte Regel und bleibt sie: ein Gebirge ganz ohne Stuetzpunkt zu erfinden waere
	// das „erfundene Gelaendedetail", vor dem oekosystem-instruction.md §4.1 warnt. Hier IST ein
	// Stuetzpunkt da, er heisst nur Kammhoehe statt Gipfel.
	if (!kamm.zellen && maximalhoehe > 0) {
		const dist = randAbstand(r);
		let dmax = 0;
		for (let k = 0; k < dist.length; k++) { if (r.drin[k] && dist[k] > dmax) { dmax = dist[k]; } }
		// Die Breite folgt dem Plateau-Regler -- bei 1 (Vorgabe) ein schmales Band um die Achse, bei
		// kleineren Werten eine Flaeche. ⚠️ 0,9 statt 1,0, weil die Abstandskarte diskret ist: genau
		// den Hoechstwert traegt oft nur eine einzige Zelle, und ein Kamm aus einem Punkt ist keiner.
		const anteil = plateau >= 1 ? 0.9 : plateau;
		const schwelle = anteil * dmax;
		let gesetzt = 0;
		for (let k = 0; k < dist.length; k++) {
			if (!r.drin[k] || fest[k] || dist[k] < schwelle) { continue; }
			h[k] = maximalhoehe;
			fest[k] = 1;
			kammMaske[k] = 1;
			gesetzt++;
		}
		kamm = { quelle: "mittelachse", kanten: 0, zellen: gesetzt };
		if (gesetzt) { loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 40, 100, 1.85); }
	}
	if (kamm.zellen) { loeseRelief(h, r.w, r.hh, r.drin, fest, 4, 40, 100, 1.85); }
	if (melde) { melde(0.3); }

	// Die Einzelberge -- ADDITIV (siehe addiereGipfelkegel: festgenagelt zoegen sie einen Graben).
	const kegel = addiereGipfelkegel(r, h, peaks, reg.bergform, ECOSYSTEM_HYDRO_STANDARDHOEHE, fest, mantel);

	// Das Grundrauschen mit den Parametern DER FLAECHE (`terrain_grain`, `terrain_levels`).
	const spanMax = Math.max(e.bounds.max_x - e.bounds.min_x, e.bounds.max_y - e.bounds.min_y);
	const koernung = Number(reg.koernung) > 0 ? Number(reg.koernung) : 3.2;
	const stufen = Number(reg.stufen) > 0 ? Math.min(8, Math.round(Number(reg.stufen))) : 3;
	const rauschen = Number.isFinite(Number(reg.rauschen)) ? Number(reg.rauschen) : ECOSYSTEM_HYDRO_RAUSCHEN;
	const saat = Number.isFinite(Number(e.saat)) ? Number(e.saat) : 12345;
	// 🔴 DER HOECHSTE FESTGEHALTENE WERT -- Gipfel oder Kammhoehe. Hier gerechnet, weil danach nichts
	// mehr `fest` setzt, und EINMAL statt je Zelle.
	// ⚠️ Gemessen wird `h`, nicht die Eingabeliste der Gipfel: ein Gipfel ohne eingetragene Hoehe
	// steht mit der Standardhoehe da, und die Kammhoehe (der Sockel) ist ueberhaupt kein Gipfel.
	let hoechsterFest = 0;
	for (let k = 0; k < zellen; k++) {
		if (r.drin[k] && fest[k] && h[k] > hoechsterFest) { hoechsterFest = h[k]; }
	}
	if (rauschen > 0) {
		const grobeZelle = spanMax / koernung;
		for (let j = 0; j < r.hh; j++) {
			for (let i = 0; i < r.w; i++) {
				const k = j * r.w + i;
				// Kegelmantel und Kamm bekommen ihr Rauschen -- sie sind FORM, keine Messung.
				if (!r.drin[k] || (fest[k] && !mantel[k] && !kammMaske[k])) { continue; }
				h[k] = Math.max(0, h[k] * (1 + rauschen * fbm(saat, r.x(i), r.y(j), grobeZelle, stufen, 0.5)));
			}
		}
	}
	if (melde) { melde(0.35); }

	// 🔴 DAS INITIALE HOEHENFELD STEHT -- Gipfel, Kamm, Bergform UND Rauschen. Erst JETZT kommt
	// das Wasser, und
	// es wird ABGEZOGEN (Owner 04.09.2026). Die Reihenfolge ist tragend, und zwar zweifach:
	//  - der Talboden misst sich am FERTIGEN Grundrelief, sonst schneidet er in etwas, das es
	//    noch nicht gibt;
	//  - und das Rauschen liegt DAVOR, sonst schuettet es die Taeler teilweise wieder zu.
	// 🔴 DIE HYPSOMETRIE STEHT HIER -- nach dem Grundrelief, VOR dem Talabzug und der Erosion.
	//
	// 🪤 SIE STAND ZUERST GANZ AM ENDE, mit der plausiblen Begruendung, dass die eingestellte Zahl
	// dann auch die ist, die am Schluss dasteht. Das ist gemessen falsch: die Potenz spart die
	// FESTGEHALTENEN Zellen aus (Gipfel und Kamm sind Messungen), und wenn das Gelaende ringsum
	// steigt, entsteht an jedem Uebergang fest/frei ein Sprung. Entlang der Fluesse, die solche
	// Uebergaenge queren, brach damit die Monotonie: der gemessene Anstieg sprang von 3.069 auf
	// **18.238 Schritt** an der Roten Sichel. Monoton ist die Potenz nur, solange sie auf ALLES wirkt.
	// ⭐ Hier vorne gibt es das Problem nicht: die Taeler werden erst DANACH eingeschnitten, also auf
	// dem bereits gezogenen Gelaende, und ihre Monotonie entsteht ohnehin aus dem kumulativen
	// Talboden.
	// ⚠️ Der Preis ist benannt: Erosion und Talabzug verschieben das HI danach noch, die eingestellte
	// Zahl ist also ein Ziel fuer das GRUNDRELIEF, nicht fuer das fertige Feld. Der erreichte Wert
	// reist als `hypso.erreicht` mit heraus, damit man beides vergleichen kann.
	const hypsoZiel = Number.isFinite(Number(reg.hypsometrie))
		? Math.max(0, Math.min(1, Number(reg.hypsometrie)))
		: ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE;
	// 💣 AUSGESPART WERDEN NUR DIE GIPFELKERNE, nicht alles Festgehaltene. Eine Potenz ist nur dann
	// monoton, wenn sie auf ALLES wirkt; jede ausgesparte Zelle ist ein Sprung gegen ihre Nachbarn.
	// Mit `fest` (Gipfel UND Kamm) gemessen: der Flussanstieg der Roten Sichel stieg von 3.069 auf
	// 5.166 Schritt bei HI 0,35 und auf 13.480 bei 0,65 -- die Laeufe queren den Kamm, und dort brach
	// die Ordnung. Der Kamm wird deshalb MITgezogen; er ist eine gerechnete Form, kein Messwert.
	// 🔴 Die Gipfelkerne bleiben: sie tragen eine eingetragene Zahl. Dass das gutgeht, ist gemessen --
	// von 22 Gipfeln liegt keiner naeher als eine halbe Zellweite an einem Lauf.
	const hypso = hypsoZiel > 0 ? zieheAufHypsometrie(h, r.drin, kern, hypsoZiel) : null;

	const initial = Float64Array.from(h);
	if (melde) { melde(0.4); }

	const seen = Array.isArray(e.seen) ? e.seen : [];
	const fluesse = Array.isArray(e.fluesse) ? e.fluesse : [];
	let tal = null;
	let talIndex = null;
	if (seen.length || fluesse.length) {
		tal = baueEcosystemTaeler(r, h, fluesse, seen, e.istImSee, {
			talbreite: reg.talbreite, bachAnteil: reg.bachAnteil, tiefe: reg.tiefe,
			einschnitt: reg.einschnitt,
		});
		if (tal.segmente.length) {
			talIndex = baueEcosystemTalIndex(tal, e.bounds);
			// 💣 DER ABZUG LIEST DAS INITIALE FELD, schreibt aber in `h`. Ohne die Kopie schnitte
			// jedes Segment in ein Gelaende, das ein frueheres schon abgesenkt hat -- die Taeler
			// fraessen sich gegenseitig tiefer, je nach Reihenfolge, und das Ergebnis haenge daran,
			// in welcher Folge die Fluesse geladen wurden.
			for (let j = 0; j < r.hh; j++) {
				for (let i = 0; i < r.w; i++) {
					const k = (j * r.w) + i;
					// 🔴 EIN FLUSS SCHNEIDET AUCH DURCH EINEN GIPFELKERN (Owner 04.09.2026, auf die
					// Frage, ob er das duerfen soll: „ja"). Hier stand ein `|| kern[k]` -- der Kern war
					// unantastbar, und ein Lauf, der ihn streifte, sprang ueber ihn hinweg und STIEG
					// dabei an. Am Livebestand war das der groesste Einzelposten des gemessenen
					// Flussanstiegs: beim Finsterkamm 100 % davon.
					//
					// ⚠️ WAS DAS KOSTET, IST GEMESSEN UND NICHT GESCHAETZT: von 22 Gipfeln in Gebirgen
					// mit Fluessen liegt **kein einziger** naeher als eine halbe Zellweite an einem Lauf;
					// die zwei naechsten sind 1,34 Zellen (Wallspitzhorn <- Sinop) und 1,47 Zellen
					// (Finsterkopp <- Kaltwasser) entfernt. Die Gipfel behalten ihre eingetragene Zahl
					// also weiterhin ALLE -- eingeschnitten wird nur der Kegelmantel um sie herum, und
					// genau dort soll ein Tal ja liegen.
					// 💣 Liefe ein Lauf je wirklich ueber einen Gipfelpunkt, gewaenne ab jetzt der Lauf.
					// Das ist ein DATENwiderspruch (ein Fluss laeuft nicht ueber einen Berg), und die
					// Entscheidung, welche der beiden Angaben dann falsch ist, gehoert nicht dem Modell.
					if (!r.drin[k]) {
						continue;
					}
					// 🔴 UND DIE ERLAUBNIS GILT DER ACHSE, NICHT DER FLANKE -- die Unterscheidung ist
					// die ganze Regel. Auf der Achse LIEGT der Fluss: das ist eine gezeichnete Angabe
					// wie die Gipfelhoehe, und bei zwei widerspruechlichen Angaben gewinnt der Lauf
					// (Owner-Entscheid). Der Abzug daneben ist dagegen modellierte FORM -- eine
					// gerechnete Talflanke, und gegen eine Messung verliert sie.
					// 🪤 GEMESSEN, NACHDEM DIE ERSTE FASSUNG BEIDES FREIGAB: die Talbreite ist 1,5
					// EINHEITEN, also **6 Zellen**, nicht 1,5 Zellen. Die Flanke griff damit weit ueber
					// den Kern hinaus und trug das Wallspitzhorn um 1.517 Schritt ab -- ein Gipfel, an
					// dem der naechste Lauf 1,34 Zellen vorbeifliesst. Wer diese zwei Zahlen
					// verwechselt (Zellweite gegen Einheit), gibt eine Reichweite von 6 frei und meint 1.
					if (tal.achse[k]) {
						h[k] = Math.max(0, Math.min(initial[k], tal.achseBoden[k]));
						senke[k] = 1;
						continue;
					}
					if (kern[k]) {
						continue;              // ein Gipfelkern behaelt seine Zahl gegen die FLANKE
					}
					const abzug = ecosystemTalAbzug(talIndex, r.x(i), r.y(j), initial[k]);
					if (abzug > 0) {
						h[k] = Math.max(0, initial[k] - abzug);
						// Die Talsohle nimmt an der Erosion NICHT teil -- sie ist eine Messung
						// (der Lauf ist gezeichnet), keine Form. Nur die Achse selbst, nicht die Flanke.
						if (abzug > 0.98 * Math.max(0, initial[k] - 0)) { senke[k] = 1; }
					}
				}
			}
		}
	}
	const see = { zellen: tal ? tal.spiegel.reduce((n, sp) => n + sp.zellen, 0) : 0,
		spiegel: tal ? tal.spiegel : [] };
	const fluss = { zellen: tal ? tal.spuren.reduce((n, sp) => n + sp.p.length, 0) : 0,
		geraten: tal ? tal.geraten : 0, spuren: tal ? tal.spuren : [] };
	// 💣 DER DECKEL STEHT AM AUSGANG, NICHT AN DEN ERZEUGERN -- weil es MEHRERE sind und beim Bau
	// genau das zweimal danebenging. Erst hob das RAUSCHEN ueber die Gipfel (multiplikativ, also am
	// staerksten dort, wo es schon hoch ist: an der Roten Sichel 7.924 gegen 6.650 eingetragen); ein
	// Riegel dort schien zu genuegen. Dann hob die HEBUNG der Erosion darueber -- sie gibt jeder
	// freien Zelle denselben Betrag, und eine Zelle knapp unter einem Gipfel wandert damit darueber
	// (an einer Testfixture mit hohem Kamm gemessen: 5.217 gegen 5.000). Der naechste Erzeuger haette
	// den dritten Riegel gebraucht.
	// 🔴 EIN Deckel am Ausgang faengt alle: kein Punkt des Feldes liegt ueber dem hoechsten
	// festgehaltenen Wert -- das ist die Owner-Regel „die vorhandene Geographie formt das Gelaende"
	// als eine Zeile.
	// ⚠️ Er SENKT nur, kann also die Fusshoehe-0 am Rand nicht brechen, und er laesst die Gipfel
	// selbst unberuehrt (sie SIND der hoechste feste Wert). Ohne festen Wert (kein Gipfel, keine
	// Kammhoehe) greift er gar nicht -- dann ist das Feld ohnehin flach.
	const relief = Float64Array.from(h);
	if (melde) { melde(0.45); }


	// Die Erosionsmaske: alles Feste AUSSER Kamm und Kegelmantel (gemessene Groesse gegen Form).
	festEro.set(fest);
	for (let k = 0; k < zellen; k++) {
		// 💣 EIN PLATEAU BRAUCHT EINE HARTE DECKSCHICHT, sonst zerfrisst es sich selbst. Auf einer
		// FLACHEN Flaeche hat die Erosion keine Vorzugsrichtung: die Senkenfuellung gibt jeder Zelle
		// ein winziges Kunstgefaelle, und der Abtrag folgt ihm -- die Simulation erfindet dann ihre
		// eigene Entwaesserung. Im Versuch am 04.09.2026 kam ein Kraterfeld heraus, kein Tafelberg.
		// ⭐ Das ist auch der geologische Grund, warum es Tafelberge gibt: eine erosionsresistente
		// Deckschicht.
		// 🔴 Nur bei einem WIRKLICHEN Plateau (`plateau < 1`). Ohne es bleibt die Kammlinie weich wie
		// bisher -- ein Grat, der nicht erodiert, waere eine sichtbare Aenderung an jedem Gebirge.
		if (mantel[k] || (kammMaske[k] && plateau >= 1)) { festEro[k] = 0; }
		// 🔴 DIE FLUSSACHSE UND DIE SEEFLAECHE SIND MESSUNGEN, keine Form -- sie sind GEZEICHNET.
		// Also erodieren sie nicht, genau wie ein eingetragener Gipfel. Nur ihre FLANKE ist frei und
		// bekommt die Rippen der Nebenentwaesserung.
		// 💣 Der Vorgaenger dieser Zeile war eine harte NACHdurchsetzung: erodieren lassen und die
		// Achse danach auf ihren Talboden zurueckbiegen. Das erzeugte scharfe Rillen im fertigen
		// Gelaende -- der Owner am Bild: „das sieht jetzt aber komisch aus". Ein Wurmnetz statt eines
		// Massivs. ⭐ Nicht erodieren ist billiger UND ruhiger als hinterher zurechtbiegen.
		if (tal && tal.achse[k]) { festEro[k] = 1; }
		// 💣 EINE ZELLE MIT AUSGANGSHOEHE 0 WIRD NICHT ANGEFASST. Sie liegt am Flaechenrand, und die
		// Fusshoehe-0-Invariante haengt daran -- an ihr haengt die Verschmelzung der 22 ueberlappenden
		// Gebirgspaare. Die Diffusion schiebt sonst Material dorthin: gemessen 169,7 Schritt am Rand.
		// 🪤 Meine eigene Node-Probe sah das NICHT, weil sie Zellen AUSSERHALB der Flaeche zaehlte;
		// das Mockup misst die Zellen INNERHALB mit Relief 0 -- die strengere und richtige Frage.
		// ⭐ Der Riegel stand im Erosions-Prototyp vom 03.09.2026 woertlich („hier war nichts, hier
		// bleibt nichts") und ist mir beim Umbau verlorengegangen.
		if (r.drin[k] && !(relief[k] > 0)) { festEro[k] = 1; }
	}
	// ⭐ EINMAL gezaehlt, nicht je Erosionsschritt: `festEro` steht waehrend der ganzen Erosion fest,
	// und der Zaehler laeuft sonst 360-mal ueber das Raster. Hier stand die SUMME der Startreliefs
	// (`hebungSumme`) -- der Nenner der hoehenproportionalen Verteilung; seit die Hebung gleichmaessig
	// ist, ist der Nenner die ZAHL der freien Zellen.
	let hebungZellen = 0;
	for (let k = 0; k < zellen; k++) {
		if (r.drin[k] && !festEro[k]) { hebungZellen++; }
	}

	const schritte = avesmapsHydroErosionsSchritte(reg.erosion);
	const zustand = { r, h, fest, festEro, senke, relief, hebungZellen, accVorgabe: null };
	for (let it = 0; it < schritte; it++) {
		erosionsSchritt(zustand, { K: ECOSYSTEM_HYDRO_ABTRAG, D: ECOSYSTEM_HYDRO_KRIECHEN });
		if (melde && (it % 20) === 0) {
			melde(0.55 + (0.45 * (it / Math.max(1, schritte))));
		}
	}

	// ⚠️ HIER STAND EINE NACHDURCHSETZUNG, und sie ist ersatzlos gefallen. Sie liess die Taeler
	// erodieren und bog die Achse danach auf ihren Talboden zurueck -- das Ergebnis waren scharfe
	// Rillen in einem fertig geformten Gelaende, im Bild ein Wurmnetz statt eines Massivs.
	// Seit die Achse in `festEro` steht, gibt es nichts zurechtzubiegen: sie wird nie angetastet.

	// 💣 DER DECKEL STEHT GANZ AM ENDE, NICHT AN DEN ERZEUGERN -- weil es MEHRERE sind und beim Bau
	// genau das dreimal danebenging. (1) Erst hob das RAUSCHEN ueber die Gipfel: multiplikativ, also
	// am staerksten dort, wo es schon hoch ist -- an der Roten Sichel 7.924 gegen 6.650 eingetragen.
	// (2) Ein Riegel im Rauschzweig schien zu genuegen; dann hob die HEBUNG der Erosion darueber, die
	// jeder freien Zelle denselben Betrag gibt: eine Zelle knapp unter einem Gipfel wandert damit
	// darueber (gemessen 5.217 gegen 5.000). (3) Ein Deckel VOR der Erosion half auch nicht -- sie
	// laeuft ja danach. Der naechste Erzeuger haette den vierten Riegel gebraucht.
	// 🔴 EIN Deckel am Ende faengt alle: kein Punkt des Feldes liegt ueber dem hoechsten
	// festgehaltenen Wert. Das ist die Owner-Regel „die vorhandene Geographie soll das Gelaende
	// formen" als eine Zeile, und sie gilt unabhaengig davon, wer kuenftig noch etwas anhebt.
	// ⚠️ Er SENKT nur -- er kann die Fusshoehe-0 am Rand also nicht brechen -- und laesst die Gipfel
	// unberuehrt, denn sie SIND der hoechste feste Wert. Ohne festen Wert (kein Gipfel, keine
	// Kammhoehe) greift er gar nicht; dann ist das Feld ohnehin flach.
	if (hoechsterFest > 0) {
		const fertig = zustand.h;
		for (let k = 0; k < zellen; k++) {
			if (r.drin[k] && fertig[k] > hoechsterFest) { fertig[k] = hoechsterFest; }
		}
	}
	if (melde) { melde(1); }

	return {
		hypso,
		r, h: zustand.h, relief, initial, fest, festEro, senke, kern, mantel, kammMaske,
		fd: zustand.fd, acc: zustand.acc,
		kamm, kegel, see, fluss, tal, talIndex, schritte, leer: false,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SCHRITT_JE_EINHEIT, baueRaster,
		stempleGipfel, addiereGipfelkegel, spannbaum, stempleKamm, kammHoeheAn,
		baueEcosystemTaeler, baueEcosystemTalIndex, ecosystemTalAbzug, ecosystemTalKern,
		ecosystemTalSohle,
		ECOSYSTEM_HYDRO_TALBREITE, ECOSYSTEM_HYDRO_BACH_ANTEIL, ECOSYSTEM_HYDRO_EINSCHNITT,
		ECOSYSTEM_HYDRO_BERGFORM, ECOSYSTEM_HYDRO_RAUSCHEN, ECOSYSTEM_HYDRO_SATTEL,
		loeseRelief, fbm,
		fuelleSenken, flussrichtung, akkumuliere, streamPower, diffundiere, erosionsSchritt,
		avesmapsGebirgsRasterBauen, avesmapsHydroErosionsSchritte, ECOSYSTEM_HYDRO_ZELLWEITE,
		ECOSYSTEM_HYDRO_EROSIONSSTUFEN, ECOSYSTEM_HYDRO_EROSION_VORGABE,
		ECOSYSTEM_HYDRO_PLATEAU_VORGABE, randAbstand,
		ECOSYSTEM_HYDRO_MORPHOLOGIEN, ECOSYSTEM_HYDRO_HOEHENSTUFEN, avesmapsHydroVorlage,
		ECOSYSTEM_HYDRO_MORPH_ALTNAMEN, avesmapsHydroMorphSchluessel,
		ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE, ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN,
		ECOSYSTEM_HYDRO_HYPSO_POTENZ_MAX, hypsometrischesIntegral, zieheAufHypsometrie, ECOSYSTEM_HYDRO_STANDARDHOEHE,
	};
}
