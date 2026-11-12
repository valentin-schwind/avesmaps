<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, toRef, watch } from "vue";
import type { MapHistoryEntry, MapHistoryObject, RuecknahmeKonflikt, RuecknahmeReceipt } from "@avesmaps3d/shared";
import AenderungBuendel from "../aenderungen/aenderung-buendel.vue";
import AenderungEintrag from "../aenderungen/aenderung-eintrag.vue";
import AenderungKreis from "../aenderungen/aenderung-kreis.vue";
import AenderungSerie from "../aenderungen/aenderung-serie.vue";
import {
    elternVon,
    nurTeilsZurueck,
    punktSchluessel,
    serienSchluessel,
    tagesGruppen,
    TEILS,
} from "../aenderungen/aenderung-gruppen";
import {
    FILTER_ARTEN,
    LEERER_FILTER,
    STATUS_WERTE,
    ZEITRAEUME,
    gesetzteFilter,
    objektRef,
    objektZiel,
    sprungGegenstand,
    type AenderungenFilter,
    type Kreis,
    type ObjektZiel,
    type SerienZeile,
    type Tab,
} from "../aenderungen/aenderung-modell";
import {
    angebotEinzeln,
    angebotSerie,
    konfliktGegenstand,
    ruecknahmeZiel,
    type RuecknahmeAngebot,
} from "../aenderungen/aenderung-ruecknahme";
import { artName, kreisName, kreisTitel, statusName, tagesKopf } from "../aenderungen/aenderung-text";
import {
    besitzerEintrag,
    schliesseKarteMit,
    umfeldFuerEintrag,
    umfeldFuerSerie,
    zeigeKarteFuer,
} from "../aenderungen/aenderung-karte-zeigen";
import { createAenderungenDaten } from "../aenderungen/aenderungen-daten";
import { createAenderungenListe } from "../aenderungen/aenderungen-liste";
import { AENDERUNGEN_KONTEXT, type AenderungenKontext } from "../aenderungen/aenderungen-kontext";
import { nimmZuAenderungen, sprungZuAenderungen, springeZumObjektverlauf } from "../aenderungen/sprung";
import type { FilterAbschnitt } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { meldeWikiBox } from "../fenster/wiki-box-melde";
import { meldeInhalte } from "../inhalte/inhalte-melde";
import { meldeWikiSync } from "../wikisync/wikisync-melde";
import { meldeLandschaften } from "../landschaftseditor/landschaft-melde";
import { melde } from "../ortseditor/ort-entfernen";
import { meldeSprachen } from "../spracheditor/sprache-melde";
import { meldeWege } from "../wegeditor/weg-melde";
import { verlaufFelderMit } from "../ortseditor/ortseditor-texte";
import type { NavStand } from "./editor-panel-nav";

/**
 * Der Reiter „Änderungen“ des Editorpanels (WI-0128 E17; WI-0126 §5.8; WI-0265 B5a nach der Probierseite `review/wi-0265/aenderungen.html`; neu gebaut mit WI-0265 B10 nach `review/wi-0265/aenderungen-neu.html`, vom Betreiber
 * am 2026-11-01 abgenommen und gewählt: „↺ in der Zeile -> B“, „Wiki- und Importläufe -> A“, „Tagesköpfe -> An“): was an der Karte geschah, über alle Gegenstände, neueste zuerst.
 *
 * - **Oben die Leiste jeder Liste** in EINER Zeile (`AvmListenleiste`, Design Guide §13.45): links die Freitextsuche (schmal als Lupe), rechts „Meine | Alle“, der Trichter mit Person, Zeitraum, Objektart, Zustand und dem einzelnen
 *   Objekt, und ↻ Neu laden, beide als Zeichen. **Alle Filter wirken auf dem Server** (die Einträge kommen seitenweise); „Weitere laden“ holt die nächste Seite über `before`. Eine Arbeitsserie am Rand der Seite wird vom Server
 *   ganz geliefert; die Liste kann länger sein als eine Seite.
 * - **Tagesköpfe** („Heute“, „Gestern“, „Mittwoch, 28. Oktober“) stehen klebend über den Zeilen ihres Tages; die Zeile trägt nur die Uhrzeit, die Zeitzone steht im Detail (`aenderungen/aenderung-gruppen.ts`).
 * - **Jede Zeile höchstens zwei Zeilen, alle gleich gebaut** (`aenderung-eintrag.vue`, `aenderung-serie.vue`, `aenderung-buendel.vue`; Rechnung `aenderung-zeile-modell.ts`): Kreis, Titel, Uhrzeit / Person, Quelle, Felder, „n Objekte“, ⊕, ▸.
 *   Der Zustand ist nur der Kreis, mit EINEM Wortschatz überall (● wirksam · ◐ teils zurückgenommen · ○ zurückgenommen · ⊘ nicht rücknehmbar); die Legende unten zählt und filtert auf Klick.
 * - **Arbeitsserien** (Fachvertrag B) sind dieselbe Zeile („Blutzinnen — 8 Änderungen“); aufgeklappt das flache Detail der ganzen Serie und darunter die Mitglieder an einer Schiene. **Wiki- und Importläufe** stehen je Tag als eine
 *   gedämpfte Zeile („Wiki-Abgleich · 2 Läufe · 610 Felder“), aufklappbar zu den Läufen.
 * - **Das Detail** (`aenderungen/aenderung-detail.vue`) ist dasselbe Bauteil wie im Objektverlauf, flach unter der Zeile: Griffleiste mit „↺ Zurücknehmen“ und den Zeichen ⊕ ⚙ ⌕, Vorher → Nachher in den zwei Tönen, unten Zeitpunkt, Vorgang,
 *   Kennung. Der Sprung „⚙ Im Objektverlauf zeigen“ führt mit derselben `operationId` dorthin und zurück (`aenderungen/sprung.ts`).
 * - **Auf der Karte (B5b, B9):** ⊕ in der Zeile und im Detail sind EIN Schalter: Trägt das Protokoll Geometrie, legt es Vorher und Nachher auf die Karte; sonst fliegt es dorthin, wo die Gegenstände HEUTE liegen (Route `/lage`). Esc, das Wählen
 *   einer anderen Zeile und der Wechsel des Reiters nehmen die Überlagerung weg. Genau EIN Ort: ⊕ wählt und zeigt den Ort, wie seit E17.
 * - **Zurücknehmen (B5c):** ↺ steht in der Griffleiste des Details („Zurücknehmen“, „Serie zurücknehmen (n)“), beim Überfahren auch am Zeilenende (am Telefon nie; es öffnet die Rückfrage, schreibt nie): Klick, Vorprüfung des Servers,
 *   Rückfrage mit den Mitgliedern und Folgen, bei einer fremden Person der Pflichtgrund, dann EINE Rücknahme (`restore-series`). Nach der Rücknahme liest die Liste neu, die Fenster der Orte ziehen nach (`melde`).
 * - **Am Telefon** ersetzt das Detail die Liste („‹ Zur Liste“); Leiste, Filter und Liste bleiben unberührt dahinter. ⊕ blendet das Panel weg, damit die Karte frei ist; „‹ Zur Liste“ auf der Karte bringt es zurück.
 */
const props = defineProps<{
    nav: NavStand;
    rechte: readonly string[];
    werkzeuge: ReadonlySet<string>;
    phone: boolean;
}>();
const emit = defineEmits<{
    oeffne: [werkzeug: string, modus: "bearbeiten" | "lesen"];
    /** ⊕ an einer Änderung mit genau einem Ort: den Ort wählen und zeigen (`oeffnen` öffnet ihn im Ortseditor). */
    ort: [publicId: string, oeffnen: boolean];
    /** „Im Objektverlauf zeigen“: das Objekt wählen und sein Werkzeug öffnen. */
    objekt: [ziel: ObjektZiel, id: string];
}>();

const daten = createAenderungenDaten();
const liste = createAenderungenListe(daten);
const filter = liste.filter;

// --- Suche, „Meine | Alle“ -------------------------------------------------------------------------------------------------

/** Der Freitext der Leiste; gefragt wird erst, wenn eine Weile nichts mehr getippt wurde. */
const suche = ref("");
const SUCHE_WARTET_MS = 250;
let sucheZeit: ReturnType<typeof setTimeout> | undefined;
watch(suche, (text) => {
    clearTimeout(sucheZeit);
    sucheZeit = setTimeout(() => {
        const q = text.trim();
        liste.setze({ q, qFelder: verlaufFelderMit(q) });
    }, SUCHE_WARTET_MS);
});

const tab = computed<Tab>({
    get: () => filter.value.tab,
    set: (wert) => liste.setze({ tab: wert }),
});
const wer = computed(() => [
    { value: "meine", label: t("aenderungen.reiter.meine") },
    { value: "alle", label: t("aenderungen.reiter.alle") },
]);
const meine = computed(() => filter.value.tab === "meine");

// --- Der Trichter --------------------------------------------------------------------------------------------------------

const ZEITRAUM_TEXT: Readonly<Record<(typeof ZEITRAEUME)[number], MessageKey>> = {
    heute: "aenderungen.filter.heute",
    tage7: "aenderungen.filter.tage7",
    tage30: "aenderungen.filter.tage30",
    jahr: "aenderungen.filter.jahr",
};

/**
 * ◐ „teils zurückgenommen“ gibt es nur für eine Serie; der Server kennt es nicht und filtert es darum nicht: Die Liste zeigt dann nur die geladenen Serien, von denen einige Mitglieder zurück sind. Es schließt die anderen Zustände
 * aus, wie sie sich gegenseitig ausschließen.
 */
const nurTeils = ref(false);
const zustandsWerte = computed(() => [
    { wert: "ruecknehmbar", text: statusName("ruecknehmbar") },
    { wert: TEILS, text: kreisName("halb") },
    ...STATUS_WERTE.filter((wert) => wert !== "ruecknehmbar").map((wert) => ({ wert, text: statusName(wert) })),
]);
const zustandsText = (wert: string): string =>
    zustandsWerte.value.find((eintrag) => eintrag.wert === wert)?.text ?? wert;

const filterAbschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "person",
        titel: t("aenderungen.filter.person"),
        art: "eins",
        // Unter „Meine“ gilt nur man selbst; die Personen kennt der Trichter aus den geladenen Einträgen.
        werte:
            filter.value.tab === "meine"
                ? []
                : [
                      ...[...liste.personen.value].map(([wert, text]) => ({ wert, text })),
                      { wert: "geloescht", text: t("aenderungen.filter.person.geloescht") },
                  ],
    },
    {
        id: "zeitraum",
        titel: t("aenderungen.filter.zeitraum"),
        art: "eins",
        werte: ZEITRAEUME.map((wert) => ({ wert, text: t(ZEITRAUM_TEXT[wert]) })),
    },
    {
        id: "art",
        titel: t("aenderungen.filter.art"),
        art: "eins",
        werte: FILTER_ARTEN.map((wert) => ({ wert, text: artName(wert) })),
    },
    {
        id: "objekt",
        titel: t("aenderungen.filter.objekt"),
        art: "eins",
        werte:
            filter.value.objekt === undefined
                ? []
                : [{ wert: filter.value.objekt.ref, text: filter.value.objekt.name }],
    },
    {
        id: "status",
        titel: t("aenderungen.filter.status"),
        art: "eins",
        werte: zustandsWerte.value,
    },
]);
const gewaehlterZustand = computed(() => (nurTeils.value ? TEILS : filter.value.status));
const filterWahl = computed(() => {
    const f = filter.value;
    const eins = (wert: string | undefined): string[] => (wert === undefined ? [] : [wert]);
    return {
        person: eins(f.tab === "meine" ? undefined : f.person),
        zeitraum: eins(f.zeitraum),
        art: eins(f.art),
        objekt: eins(f.objekt?.ref),
        status: eins(gewaehlterZustand.value),
    };
});
function setzeFilter(abschnitt: string, werte: string[]): void {
    const wert = werte[0];
    if (abschnitt === "person") liste.setze({ person: wert });
    else if (abschnitt === "zeitraum") liste.setze({ zeitraum: wert as AenderungenFilter["zeitraum"] });
    else if (abschnitt === "art") liste.setze({ art: wert as AenderungenFilter["art"] });
    else if (abschnitt === "objekt") liste.setze({ objekt: undefined });
    else if (abschnitt === "status") {
        nurTeils.value = wert === TEILS;
        liste.setze({ status: wert === TEILS ? undefined : (wert as AenderungenFilter["status"]) });
    }
}
const loeseFilter = (): void => {
    nurTeils.value = false;
    liste.setze({ person: undefined, zeitraum: undefined, art: undefined, objekt: undefined, status: undefined });
};
const nFilter = computed(() => gesetzteFilter(filter.value) + (nurTeils.value ? 1 : 0));

/** Die gesetzten Filter als Etiketten mit ✕ (die Zahl im Trichter sagt nicht, welche). */
const gewaehlte = computed(() => {
    const f = filter.value;
    const raus: { id: string; text: string }[] = [];
    if (f.person !== undefined && f.tab === "alle")
        raus.push({
            id: "person",
            text: t("aenderungen.gewaehlt.person", {
                name:
                    f.person === "geloescht"
                        ? t("aenderungen.filter.person.geloescht")
                        : (liste.personen.value.get(f.person) ?? "–"),
            }),
        });
    if (f.zeitraum !== undefined)
        raus.push({ id: "zeitraum", text: t("aenderungen.gewaehlt.zeitraum", { name: t(ZEITRAUM_TEXT[f.zeitraum]) }) });
    if (f.art !== undefined) raus.push({ id: "art", text: t("aenderungen.gewaehlt.art", { name: artName(f.art) }) });
    if (f.objekt !== undefined)
        raus.push({ id: "objekt", text: t("aenderungen.gewaehlt.objekt", { name: f.objekt.name }) });
    if (gewaehlterZustand.value !== undefined)
        raus.push({
            id: "status",
            text: t("aenderungen.gewaehlt.status", { name: zustandsText(gewaehlterZustand.value) }),
        });
    return raus;
});

// --- Laden -----------------------------------------------------------------------------------------------------------------

onMounted(() => {
    if (!uebernimmSprung()) void liste.lade();
});
onBeforeUnmount(() => {
    clearTimeout(sucheZeit);
    liste.destroy();
    // Der Wechsel des Reiters nimmt auch weg, was eine Zeile ohne Detail auf die Karte legte (B9).
    kartenAbbruch.abort();
    schliesseKarteMit(`${KENNUNG}:`);
});

// --- Auswahl: welche Zeilen offen sind -----------------------------------------------------------------------------------------

/** Die offenen Zeilen: Kennungen von Operationen, `serie:<Kennung>` und `bundle:<Tag>:<Quelle>`. Mehrere können offen sein, eine Serie samt einem ihrer Mitglieder. */
const offen = ref<ReadonlySet<string>>(new Set());
/** Die zuletzt geöffnete Zeile der Liste selbst: Am Telefon ersetzt ihr Detail die Liste. */
const fokus = ref<string | undefined>(undefined);
const sprungFehlt = ref(false);

function oeffne(schluessel: string, hauptliste: boolean): void {
    offen.value = new Set(offen.value).add(schluessel);
    if (hauptliste) fokus.value = schluessel;
}
function schalte(schluessel: string, hauptliste: boolean): void {
    if (offen.value.has(schluessel)) {
        const neu = new Set(offen.value);
        neu.delete(schluessel);
        offen.value = neu;
        if (fokus.value === schluessel) fokus.value = undefined;
        if (anstoss.value?.schluessel === schluessel) anstoss.value = undefined;
    } else oeffne(schluessel, hauptliste);
}
function schliesseAlles(): void {
    offen.value = new Set();
    fokus.value = undefined;
    anstoss.value = undefined;
}

/** Das ↺ am Zeilenende: Es öffnet die Zeile und bittet die Rückfrage darin um den Anfang. */
const anstoss = ref<{ readonly schluessel: string; readonly n: number } | undefined>(undefined);
let anstossZaehler = 0;
function stosseAn(schluessel: string): void {
    oeffne(schluessel, true);
    anstossZaehler += 1;
    anstoss.value = { schluessel, n: anstossZaehler };
}
const anstossFuer = (schluessel: string): number | undefined =>
    anstoss.value?.schluessel === schluessel ? anstoss.value.n : undefined;

// Eine neue Frage macht die alte Auswahl hinfällig; die Liste beginnt von vorn.
watch(
    () => [
        filter.value.tab,
        filter.value.person,
        filter.value.zeitraum,
        filter.value.art,
        filter.value.objekt?.ref,
        filter.value.status,
        filter.value.q,
        nurTeils.value,
    ],
    () => {
        schliesseAlles();
        sprungFehlt.value = false;
    },
);

const eintragVon = (operationId: string): MapHistoryEntry | undefined =>
    liste.eintraege.value.find((eintrag) => eintrag.operationId === operationId);
const serieVon = (id: string): SerienZeile | undefined =>
    liste.zeilen.value.find((zeile): zeile is SerienZeile => zeile.art === "serie" && zeile.id === id);
const kenntOperation = (operationId: string): boolean => eintragVon(operationId) !== undefined;

/** Wählt, was zu einer Kennung gehört: die Serie dieser Kennung oder die Operation (klappt dann ihre Serie oder ihr Bündel auf). */
async function zeigeKennung(operationId: string): Promise<boolean> {
    if (!(await liste.ladeBis(operationId)) && serieVon(operationId) === undefined) return false;
    const serie = serieVon(operationId);
    if (serie !== undefined) {
        oeffne(serienSchluessel(serie.id), true);
    } else {
        const eintrag = eintragVon(operationId);
        if (eintrag === undefined) return false;
        const eltern = elternVon(eintrag, true);
        for (const schluessel of eltern) oeffne(schluessel, true);
        oeffne(operationId, eltern.length === 0);
    }
    await nextTick();
    document
        .querySelector(`[data-aenderung-id="${CSS.escape(operationId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "auto" });
    return true;
}

// --- Sprung aus dem Objektverlauf -----------------------------------------------------------------------------------------

/** Nimmt einen wartenden Sprung „In Änderungen zeigen“ auf: Filter auf das Objekt oder die Person, dann die Operation wählen (wenn er eine nennt). */
function uebernimmSprung(): boolean {
    const sprung = nimmZuAenderungen();
    if (sprung === undefined) return false;
    suche.value = "";
    sprungFehlt.value = false;
    nurTeils.value = false;
    liste.setze({
        ...LEERER_FILTER,
        person: sprung.person,
        objekt:
            sprung.objekt === undefined
                ? undefined
                : {
                      ref: `${sprung.objekt.kind}:${sprung.objekt.id}`,
                      name: sprung.objekt.name ?? artName(sprung.objekt.kind),
                  },
    });
    if (sprung.operationId !== undefined) void zeigeNachLaden(sprung.operationId);
    return true;
}
async function zeigeNachLaden(operationId: string): Promise<void> {
    // `setze` hat die Frage schon gestellt; ihre Antwort abwarten, ohne sie ein zweites Mal zu stellen.
    while (liste.laedt.value) await new Promise((fertig) => setTimeout(fertig, 30));
    sprungFehlt.value = !(await zeigeKennung(operationId));
}
watch(sprungZuAenderungen, (sprung) => {
    if (sprung !== undefined) uebernimmSprung();
});

function springeZumObjekt(eintrag: MapHistoryEntry, kennung: string): void {
    const gegenstand = sprungGegenstand(eintrag);
    if (gegenstand === undefined) return;
    const ziel = objektZiel(gegenstand.kind);
    if (ziel === undefined) return;
    springeZumObjektverlauf(
        { operationId: kennung, objekt: { kind: gegenstand.kind, id: gegenstand.id, name: gegenstand.name } },
        ziel.werkzeug,
    );
    emit("objekt", ziel, gegenstand.id);
}
function nurObjekt(gegenstand: MapHistoryObject): void {
    liste.setze({ objekt: { ref: objektRef(gegenstand), name: gegenstand.name ?? artName(gegenstand.kind) } });
}

// --- Auf der Karte zeigen (B9) -----------------------------------------------------------------------------------------------

/** Wem die Überlagerung einer Zeile gehört: dasselbe Schema wie im Detail (`kennung`), damit ⊕ in der Zeile und im Detail EINEN Schalter bilden. */
const KENNUNG = "editorpanel-aenderung";
const kartenAbbruch = new AbortController();
/** Der Rückweg am Telefon führt in die Liste: Die Zeile hat kein offenes Detail. */
function zeigeEintragAufKarte(eintrag: MapHistoryEntry): void {
    void zeigeKarteFuer(
        besitzerEintrag(KENNUNG, eintrag.operationId),
        umfeldFuerEintrag(daten, eintrag, kartenAbbruch.signal),
        "liste",
    );
}
function zeigeSerieAufKarte(besitzer: string, mitglieder: readonly MapHistoryEntry[]): void {
    void zeigeKarteFuer(besitzer, umfeldFuerSerie(daten, mitglieder, kartenAbbruch.signal), "liste");
}

// --- Zurücknehmen (B5c) ------------------------------------------------------------------------------------------------------

/** Die Mitglieder der Serie, zu der ein Eintrag gehört, soweit die Liste sie hat (für „überholt durch Schritt n“). */
const serieDesEintrags = (eintrag: MapHistoryEntry): SerienZeile | undefined =>
    eintrag.series === undefined ? undefined : serieVon(eintrag.series.id);
/** Das ↺ an einem Eintrag: nur das letzte offene Mitglied einer Serie; die Adresse nennt der Eintrag oder seine Serie. */
function angebotFuer(eintrag: MapHistoryEntry): RuecknahmeAngebot | undefined {
    const serie = serieDesEintrags(eintrag);
    return angebotEinzeln(eintrag, ruecknahmeZiel(eintrag, serie?.meta), serie?.mitglieder ?? []);
}
/** Das ↺ an einer Serie: alle Mitglieder in einer Rücknahme. */
const angebotFuerSerie = (zeile: SerienZeile): RuecknahmeAngebot | undefined =>
    angebotSerie(zeile, ruecknahmeZiel(zeile.mitglieder[0]!, zeile.meta));

/**
 * Die Rücknahme ist geschrieben: Die Liste liest neu (die Originale stehen dann „zurückgenommen durch …“), und die Fenster der Orte lesen den Ort neu, wie nach dem
 * Wiederherstellen (`melde`), die Wege-Fenster ihre Straße (`meldeWege`), die Derographie- und Gipfelfenster ihre Fläche und ihren Gipfel (`meldeLandschaften`), die Sprachfenster ihre Sprache (`meldeSprachen`). Das Gelände rechnet der
 * Server; das Band dazu zeigt das ↺ selbst.
 */
function zurueckgenommen(quittung: RuecknahmeReceipt): void {
    for (const betroffen of quittung.affected)
        if (betroffen.kind === "place") melde(betroffen.id, "wiederhergestellt", quittung.mapRevision);
    // Dasselbe für Wege (WI-0265 B6a2): Ein offenes Wege-Fenster liest Liste und Straße neu, die Kacheln ziehen nach.
    const wege = quittung.affected.filter((betroffen) => betroffen.kind === "path");
    if (wege.length > 0)
        meldeWege(
            wege.map((betroffen) => betroffen.id),
            quittung.mapRevision,
        );
    // Und für Flächen der Derographie und Gipfel (WI-0265 B6c2): Fenster mit veralteter Revision gibt es danach nicht mehr; die Meldung nennt nur, was zu ihnen gehört.
    meldeLandschaften(quittung.affected, quittung.mapRevision);
    // Und für Sprachen und ihre Teilflächen (WI-0265 B6e): offene Sprachfenster lesen die Sprache samt Verlauf neu.
    meldeSprachen(quittung.affected, quittung.mapRevision);
    // Und für Quellen, Werke und Korpora (WI-0265 B6g1): ein offenes Fenster „Inhalte bearbeiten“ liest Liste und gewähltes Dokument neu (ein Entwurf bleibt).
    meldeInhalte(quittung.affected);
    // Und für die Wiki-Box (WI-0265 B8d): eine offene Box liest ihren Stand neu, das Fenster das Objekt.
    meldeWikiBox(quittung.affected);
    // Und für den WikiSync (WI-0265 B8d): die Rücknahme eines Laufs ist ein Auftrag, die der Regelvorschläge schreibt gleich; die Ansicht des WikiSync und das Fenster der Regeln lesen neu.
    if (
        quittung.derivedWork.some((arbeit) => arbeit.kind === "wiki_zuruecknehmen") ||
        quittung.affected.some((betroffen) => betroffen.kind === "wikisync_regel_uebernahme")
    )
        meldeWikiSync();
    void liste.lade();
}
/** „Konflikt prüfen“: der betroffene Gegenstand, mit dem Verlauf an der Stelle der späteren Änderung; beim Gebirge die Landschaft der Rücknahme. */
function pruefeKonflikt(konflikt: RuecknahmeKonflikt, ziel: RuecknahmeAngebot["ziel"]): void {
    const gegenstand = konfliktGegenstand(konflikt, ziel);
    const objekt = objektZiel(gegenstand.kind);
    if (objekt === undefined) {
        // Quelle, Werk und Korpus haben keinen Objektverlauf (das Fenster „Inhalte bearbeiten“ zeigt keinen): „Konflikt prüfen“ zeigt hier ihre Änderungen, die Liste auf dieses Objekt gefiltert.
        liste.setze({ objekt: { ref: objektRef(gegenstand), name: gegenstand.name ?? artName(gegenstand.kind) } });
        return;
    }
    if (konflikt.operationId !== undefined)
        springeZumObjektverlauf({ operationId: konflikt.operationId, objekt: gegenstand }, objekt.werkzeug);
    emit("objekt", objekt, gegenstand.id);
}

// --- Was die Zeilen vom Reiter brauchen ---------------------------------------------------------------------------------------

const kontext: AenderungenKontext = {
    kennung: KENNUNG,
    daten,
    phone: toRef(props, "phone"),
    meine,
    rechte: toRef(props, "rechte"),
    ist: (schluessel) => offen.value.has(schluessel),
    schalte,
    angebotFuer,
    angebotFuerSerie,
    stosseAn,
    anstossFuer,
    angestossen: () => {
        anstoss.value = undefined;
    },
    zurueckgenommen,
    neuLesen: () => void liste.lade(),
    konfliktPruefen: pruefeKonflikt,
    kenntOperation,
    zeige: zeigeKennung,
    springeZumObjekt,
    nurObjekt,
    ortZeigen: (publicId) => emit("ort", publicId, false),
    zeigeEintragAufKarte,
    zeigeSerieAufKarte,
};
provide(AENDERUNGEN_KONTEXT, kontext);

// --- Darstellung --------------------------------------------------------------------------------------------------------------

const zeilen = computed(() => (nurTeils.value ? nurTeilsZurueck(liste.zeilen.value) : liste.zeilen.value));
const tage = computed(() => tagesGruppen(zeilen.value, true).map((tag) => ({ ...tag, kopf: tagesKopf(tag.at) })));
const nZeilen = computed(() => zeilen.value.length);
const leer = computed(() => !liste.laedt.value && !liste.fehler.value && nZeilen.value === 0);
const fokusPunkt = computed(() => {
    if (fokus.value === undefined) return undefined;
    for (const tag of tage.value)
        for (const punkt of tag.punkte) if (punktSchluessel(punkt) === fokus.value) return punkt;
    return undefined;
});
const zeigtDetailAmTelefon = computed(() => props.phone && fokusPunkt.value !== undefined);

/** Die Legende: je Zustand der Kreis, sein Wort und die Zahl; jeder Eintrag filtert. */
const legende = computed(() => {
    const z = liste.zaehlung.value;
    const eintraege: { wert: string; kreis: Kreis; zahl: number }[] = [
        { wert: "ruecknehmbar", kreis: "voll", zahl: z.wirksam },
        { wert: TEILS, kreis: "halb", zahl: z.teils },
        { wert: "bereits_zurueckgenommen", kreis: "leer", zahl: z.zurueck },
        { wert: "nicht_ruecknehmbar", kreis: "gesperrt", zahl: z.gesperrt },
    ];
    return eintraege.map((eintrag) => ({
        ...eintrag,
        wort: kreisName(eintrag.kreis),
        titel: t("aenderungen.legende.nurDiese", { zustand: kreisTitel(eintrag.kreis) }),
        gedrueckt: gewaehlterZustand.value === eintrag.wert,
    }));
});
function waehleZustand(wert: string): void {
    setzeFilter("status", gewaehlterZustand.value === wert ? [] : [wert]);
}
</script>

<template>
    <div class="aenderungen" data-testid="editorpanel-aenderungen">
        <!-- Telefon: das Detail ersetzt die Liste, „Zur Liste“ bringt sie unverändert zurück. -->
        <div
            v-if="zeigtDetailAmTelefon && fokusPunkt"
            class="aenderungen__telefon"
            data-testid="editorpanel-aenderungen-telefon-detail"
        >
            <AvmKnopf groesse="zeile" testid="editorpanel-aenderungen-zur-liste" @click="schliesseAlles()">
                {{ t("aenderungen.detail.zurListe") }}
            </AvmKnopf>
            <AenderungEintrag v-if="fokusPunkt.art === 'eintrag'" :eintrag="fokusPunkt.eintrag" nur-detail />
            <AenderungSerie v-else-if="fokusPunkt.art === 'serie'" :zeile="fokusPunkt" nur-detail />
            <AenderungBuendel v-else :buendel="fokusPunkt" nur-detail />
        </div>

        <div v-show="!zeigtDetailAmTelefon" class="aenderungen__inhalt">
            <div class="aenderungen__kopf">
                <AvmListenleiste
                    v-model="suche"
                    :platzhalter="t('editorPanel.aenderungen.suche.platzhalter')"
                    :beschriftung="t('editorPanel.aenderungen.suche')"
                    testid="editorpanel-aenderungen-leiste"
                >
                    <AvmSegmente
                        v-model="tab"
                        :options="wer"
                        :label="t('aenderungen.reiter.beschriftung')"
                        testid="aenderungen-wer-reiter"
                    />
                    <AvmFilterknopf
                        :abschnitte="filterAbschnitte"
                        :wahl="filterWahl"
                        testid="editorpanel-aenderungen-filter"
                        @setze="setzeFilter"
                        @loesen="loeseFilter"
                    />
                    <button
                        type="button"
                        class="aenderungen__neu"
                        :class="{ 'is-laedt': liste.laedt.value }"
                        :title="t('editorPanel.aenderungen.neuLaden')"
                        :aria-label="t('editorPanel.aenderungen.neuLaden')"
                        data-testid="editorpanel-aenderungen-neu"
                        @click="liste.lade()"
                    >
                        <span aria-hidden="true">↻</span>
                    </button>
                </AvmListenleiste>
            </div>

            <ul
                v-if="gewaehlte.length > 0"
                class="aenderungen__gewaehlt"
                :aria-label="t('aenderungen.gewaehlt.beschriftung')"
            >
                <li
                    v-for="eintrag in gewaehlte"
                    :key="eintrag.id"
                    class="aenderungen__etikett"
                    :data-testid="`editorpanel-aenderungen-gewaehlt-${eintrag.id}`"
                >
                    <span>{{ eintrag.text }}</span>
                    <button
                        type="button"
                        :aria-label="t('aenderungen.gewaehlt.entfernen', { name: eintrag.text })"
                        :title="t('aenderungen.gewaehlt.entfernen', { name: eintrag.text })"
                        @click="setzeFilter(eintrag.id, [])"
                    >
                        ✕
                    </button>
                </li>
            </ul>

            <div class="aenderungen__liste-huelle">
                <p v-if="liste.fehler.value" class="aenderungen__leise" role="alert">
                    {{ t("ortseditor.verlauf.fehler") }}
                </p>
                <p v-else-if="leer" class="aenderungen__leise" data-testid="editorpanel-aenderungen-leer">
                    {{
                        suche.trim() !== ""
                            ? t("editorPanel.aenderungen.keinTreffer")
                            : nFilter > 0 || filter.tab === "meine"
                              ? t("aenderungen.keinTrefferFilter")
                              : t("editorPanel.aenderungen.leer")
                    }}
                </p>
                <p v-if="sprungFehlt" class="aenderungen__leise" data-testid="editorpanel-aenderungen-sprung-fehlt">
                    {{ t("aenderungen.sprung.fehlt") }}
                </p>

                <section v-for="tag in tage" :key="tag.schluessel" class="aenderungen__tag">
                    <h3 class="aenderungen__tagkopf" data-testid="editorpanel-aenderungen-tag">{{ tag.kopf }}</h3>
                    <ol class="aenderungen__liste">
                        <template v-for="punkt in tag.punkte" :key="punktSchluessel(punkt)">
                            <AenderungEintrag v-if="punkt.art === 'eintrag'" :eintrag="punkt.eintrag" />
                            <AenderungSerie v-else-if="punkt.art === 'serie'" :zeile="punkt" />
                            <AenderungBuendel v-else :buendel="punkt" />
                        </template>
                    </ol>
                </section>

                <AvmKnopf
                    v-if="liste.mehrDa.value"
                    class="aenderungen__mehr"
                    groesse="zeile"
                    :gesperrt="liste.laedt.value ? t('ortseditor.verlauf.laedt') : undefined"
                    testid="editorpanel-aenderungen-mehr"
                    @click="liste.lade(true)"
                >
                    {{ t("aenderungen.mehr") }}
                </AvmKnopf>
                <p v-if="nZeilen > 0 && !liste.laedt.value" class="aenderungen__leise aenderungen__ende">
                    {{ liste.mehrDa.value ? "" : `${t("aenderungen.ende")} · `
                    }}{{ t("aenderungen.legende.geladen", { n: formatNumber(liste.zaehlung.value.geladen, 0) }) }}
                </p>
            </div>

            <div
                v-if="liste.eintraege.value.length > 0"
                class="aenderungen__legende"
                role="group"
                :aria-label="t('aenderungen.legende.beschriftung')"
                data-testid="editorpanel-aenderungen-legende"
            >
                <button
                    v-for="eintrag in legende"
                    :key="eintrag.wert"
                    type="button"
                    class="aenderungen__leg"
                    :aria-pressed="eintrag.gedrueckt"
                    :title="eintrag.titel"
                    :data-testid="`editorpanel-aenderungen-legende-${eintrag.wert}`"
                    @click="waehleZustand(eintrag.wert)"
                >
                    <AenderungKreis :kreis="eintrag.kreis" :name="kreisTitel(eintrag.kreis)" />
                    <span class="aenderungen__leg-wort einzeilig">{{ eintrag.wort }}</span>
                    <span class="aenderungen__leg-zahl">{{ formatNumber(eintrag.zahl, 0) }}</span>
                </button>
            </div>

            <slot name="bearbeitungen" />
        </div>
    </div>
</template>

<style scoped>
.aenderungen {
    display: grid;
    min-width: 0;
    /* Keine Silbentrennung in der Liste (Vorlage): Zeilen kürzt die Auslassung, Sätze brechen an Wortgrenzen. */
    hyphens: manual;
}

.aenderungen__inhalt {
    display: grid;
    /* Eine Spalte, die nie breiter wird als das Panel: Ohne sie gab ein breites Kind („Offene Bearbeitungen“ mit langem Titel)
       seine Breite an die Spalte weiter, und Leiste, Liste und Legende ragten mit über den Rand (Vali 2026-11-09). */
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
}

.aenderungen__telefon {
    display: grid;
    gap: var(--space-8);
    min-width: 0;
    padding: var(--space-8) 0;
}

.aenderungen__telefon > :first-child {
    justify-self: start;
    margin-inline: var(--space-10);
}

/* Die Leiste in EINER Zeile (Suche links, rechts die Zeichen): dasselbe Polster wie die Zeilen darunter. */
.aenderungen__kopf {
    padding: var(--space-8) var(--space-10) var(--space-4);
}

/* ↻ Neu laden: ein Zeichen in der Fassung des Trichters, quadratisch in Bedienhöhe; es dreht sich, solange gelesen wird. */
.aenderungen__neu {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--avm-control-h);
    min-height: var(--avm-control-h);
    margin: 0;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 15px;
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.aenderungen__neu:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.aenderungen__neu:active {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.aenderungen__neu:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.aenderungen__neu.is-laedt span {
    animation: aenderungen-dreht 900ms linear infinite;
}

@keyframes aenderungen-dreht {
    to {
        transform: rotate(360deg);
    }
}

.aenderungen__liste-huelle {
    min-width: 0;
    border-top: 1px solid var(--color-border);
}

/* Der Kopf eines Tages klebt oben, bis der nächste ihn ablöst. */
.aenderungen__tagkopf {
    position: sticky;
    top: 0;
    z-index: 3;
    margin: 0;
    padding: var(--space-2) var(--space-10);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-panel-muted);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: 0.04em;
}

.aenderungen__liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

.aenderungen__leise {
    margin: 0;
    padding: var(--space-6) var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.aenderungen__gewaehlt {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-10) var(--space-4);
    list-style: none;
}

.aenderungen__etikett {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-4) 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-small);
    line-height: var(--space-20);
}

.aenderungen__etikett button {
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.aenderungen__etikett button:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: 0 0 0 3px var(--color-focus);
}

.aenderungen__mehr {
    justify-self: start;
    margin: var(--space-8) var(--space-10);
}

/* Legende und Zählung: zwei mal zwei, je Zustand Kreis, Wort und Zahl; jeder Eintrag filtert (WI-0187; B10). */
.aenderungen__legende {
    position: sticky;
    bottom: 0;
    z-index: 3;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-6);
    padding: var(--space-4) var(--space-10);
    border-top: 1px solid var(--color-border);
    background: var(--color-panel);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.aenderungen__leg {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: 3px var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.aenderungen__leg:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.aenderungen__leg[aria-pressed="true"] {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.aenderungen__leg:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.aenderungen__leg-wort {
    flex: 1 1 auto;
    min-width: 0;
}

.aenderungen__leg-zahl {
    flex: none;
}

@media (prefers-reduced-motion: reduce) {
    .aenderungen__neu {
        transition: none;
    }

    .aenderungen__neu.is-laedt span {
        animation: none;
    }
}
</style>
