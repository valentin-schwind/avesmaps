<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
    EDITORPANEL,
    PATH_EDIT_SUBTYPES,
    WEGEDITOR as WEGEDITOR_TAFEL,
    type EditorPathList,
    type EditorPathReisen,
    type EditorPathSaison,
    type EditorPathGeteilt,
    type EditorPathStreet,
    type EditorPathWeiterer,
    type PathMark,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import EntwurfFuss from "../fenster/entwurf-fuss.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import type { Verlauf } from "../fenster/entwurf-verlauf";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterReiter from "../fenster/fenster-reiter.vue";
import TraegerKarten from "../fenster/traeger-karten.vue";
import { useTraegerKarten } from "../fenster/traeger-karten";
import TraegerQuellen from "../fenster/traeger-quellen.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import WegTafel from "./weg-tafel.vue";
import StrassenAssistentFenster from "./strassen-assistent-fenster.vue";
import type { AssistentBild, Rahmen } from "./strassen-assistent";
import { mitFenster, mitMittel, reisenDes, uebernahme } from "./reisemittel";
import {
    flussnetzSchluessel,
    ladeFlussnetz,
    nummernBereiche,
    richtungsUebernahme,
    type FlussnetzLage,
} from "./weg-fliessrichtung";
import { herkunftIm, mitHerkunft, wikiLage } from "../fenster/wiki-feld";
import WikiBox from "../fenster/wiki-box.vue";
import type { WikiBoxFeld } from "../fenster/wiki-box";
import WikiFeld from "../fenster/wiki-feld.vue";
import { formatDecimal, formatNumber, t, tPlural } from "../i18n/i18n";
import { listenBreite } from "../fenster/listen-schalter";
import {
    WEGE_LEGENDE,
    WEGE_OPTIONEN,
    WEGE_SORTIERUNGEN,
    artName,
    facettenName,
    sortierungsName,
    untergrundText,
    wertName,
    zeileVon,
} from "./wege-liste";
import {
    felderAus,
    mitRichtung,
    mitRichtungen,
    mitRichtungUmgekehrt,
    mitWegartFuerAlle,
    mitWegartTeil,
    nurLandwege,
    subtypeDerWahl,
    WEGART_BACH,
    WEGART_GEMISCHT,
    wegartWaehlbarFuer,
} from "./weg-art";
import { wegAbweichende, wegAllesAufWiki, wegAufWiki, wegWikiLage, type WegWikiFeld } from "./weg-wiki";
import { mitWeiterem, ohneWeiteren, type WeitereJeAbschnitt } from "./weg-weitere";
import { weitereNamenText } from "./wegeditor-texte";
import type { WegSammel } from "./weg-sammel";
import WegSammelAnsicht from "./weg-sammel.vue";
import { entfernenZiel, type EntfernenZiel } from "./weg-entfernen";
import type { WegAuswahl } from "./weg-neuer-weg";
import WegNeuerWegFrage from "./weg-neuer-weg-frage.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import type { WegBearbeitung } from "./wegeditor-steuerung";

/**
 * Das Wege-Fenster (WI-0177 Stufe 2, W5a, W5b; Blatt „Wegeditor“, Probierblatt P5; Muster `landschaftseditor-fenster.vue`): ein
 * Werkzeugfenster wie Landschafts- und Kraftlinien-Editor (rechts angedockt, « » klappt die Liste ein), links die Wege (eine Zeile je
 * Straße), rechts die Eigenschaften der Straße dieses Fensters (je Straße ein Fenster, T44).
 *
 * - **Eigenschaften:** Name (nie der Griff, WI-0105), Wegtyp, „Name auf der Karte“ (an allen Abschnitten gleich oder „an n von m“),
 *   „Tunnel“ (Migration 0172; oben kein Haken, nur welche Abschnitte im Tunnel liegen, ihre Nummern wählen den Abschnitt; der Haken
 *   steht in der Tafel, sobald Abschnitte gewählt sind, Betreiber 2026-11-09), die Abschnitte der Straße mit „Zeigen“ (fliegt zum
 *   Abschnitt), der Wiki-Artikel. Neben dem Haken „Name auf der Karte“ steht immer „ja“, gemischt daneben als Satz (Stage-Fund
 *   2026-11-09). Dazu das Kennzeichen „Karawanenroute“ als Haken
 *   (Migration 0174, WI-0177 §30): ohne Reisewerte, der Wegtyp bleibt der Untergrund; liegt die Straße auf mehreren Wegtypen, steht
 *   der Wegtyp auf „gemischt“ und jeder Abschnitt nennt seinen.
 * - **Wiki-Felder** (Baustein `fenster/wiki-feld`, WI-0225, Design Guide §13.8): Name, Wegtyp und Kennzeichen gegen den Artikel der
 *   Straße (`weg-wiki.ts`), ↺ am Zeilenende als EIN Schritt, „↺ Alles auf Wiki-Werte (n)“ im Kopf der Eigenschaften; die übrigen Zeilen
 *   fluchten mit dem Zustand „ohne“.
 * - Ein Klick in der Liste wählt und stellt die Karte auf die Ansicht „Standard“, ohne Flug (F17); Doppelklick und Enter fliegen dazu
 *   zum Rahmen der Straße (T32). Beides macht `app.vue` über die gemeinsame Zuordnung (`ansichtFuerHinflug`).
 * - **Schreiben** (W5b, O3 `fenster/bearbeitung.ts`): Name, Wegart und „Name auf der Karte“ sind Felder des EINEN Entwurfs der Straße,
 *   die Kurve eines Abschnitts seine Form (`wegkurve.ts`); die erste Änderung beginnt die Bearbeitung (Sperre, Leiste mit „Fertig“),
 *   „Fertig“ schreibt beides als `path.update` für alle Abschnitte. Die
 *   Wegart wechselt nur zwischen Landwegen (ein Flussweg bleibt Flussweg); „Name auf der Karte“ steht gemischt „an n von m“, bis jemand
 *   den Haken setzt. Konflikt und „Sperre abgelaufen“ im gemeinsamen Kasten, der Fuß sagt „n ungespeichert“.
 * - „Zurück auf die Karte“ an jedem Abschnitt einer Straße unter „Nicht auf der Karte“ (Stufe 3b), EINE Operation je Abschnitt; `app.vue`
 *   reicht sie nur mit dem Recht der Lage herein.
 * - **Weitere Straßennamen** (WI-0302): das Feld in der Tafel der gewählten Abschnitte (`weg-weitere.vue`), ein Feld des Entwurfs wie der
 *   Wegtyp. Abschnitte ANDERER Straßen, die den Artikel dieser Straße als weiteren Namen tragen (`geteilt`), stehen nach den eigenen Nummern,
 *   gestrichelt und nur lesend, und zählen in „Abschnitte (n)“ mit (Vali 2026-11-10, „Ja, mitzählen“). Ein Klick öffnet jene Straße mit diesem
 *   Abschnitt; kennt die Liste sie nicht, sagt ein Satz, wo er bearbeitet wird.
 * - **Telefon:** Liste und Eigenschaften als Drill-down mit „‹ Liste“, wie die anderen Editoren.
 * - **Mehrfachauswahl** (WI-0252, wie die Kraftlinien WI-0238): Umschalter und Häkchen der Liste (`v-model:mehrfach`, `v-model:angehakt`,
 *   gehalten in der Steuerung); ab zwei angehakten Wegen stehen statt der Eigenschaften EINER Straße die aller (`weg-sammel.vue`). Bleibt
 *   genau einer angehakt, meldet die Liste ihn als Klick, und das Fenster zeigt ihn wie einzeln gewählt (`fenster-verwaltung.ts`).
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    liste: EditorPathList | undefined;
    ladeFehler: string | undefined;
    einstellung: ListenEinstellung;
    /** Die Bearbeitung der Straße dieses Fensters (`wegeditor-steuerung.ts`); ohne Straße keine. */
    bearbeitung: WegBearbeitung | undefined;
    /** Der Verlauf der Straße dieses Fensters (T54); ohne ihn kein Reiter „Verlauf“. */
    verlauf?: Verlauf<unknown> | undefined;
    /** Darf diese Sitzung Wege schreiben (Recht und `MAP_EDITING`)? */
    darf?: boolean | undefined;
    /** Hat diese Sitzung das Recht `manage_sources`? Die Quellen gelten der ganzen Straße, nie einzelnen Abschnitten (WI-0254 §12, Betreiber 2026-10-28). */
    quellenRecht?: boolean | undefined;
    ablageZiel: () => DOMRect | undefined;
    /** Ist die Liste eingezogen? Der Schalter liegt in `app.vue` (`listenSchalter`). */
    listeZu?: boolean | undefined;
    /** „Zurück auf die Karte“ für einen genommenen Abschnitt; fehlt ohne das Recht dazu. */
    zurueck?: ((abschnitt: { id: string; revision: number }, name: string) => void) | undefined;
    /** Die gewählten Abschnitte (`wegeditor-steuerung.ts`, `abschnittsWahl`); `null` oder ohne Angabe: (W), der ganze Weg. */
    abschnittsWahl?: ReadonlySet<string> | null | undefined;
    /** Die Mehrfachauswahl dieses Fensters (WI-0252): an oder aus, und welche Straßen angehakt sind. */
    mehrfach?: { readonly mehrfach: boolean; readonly angehakt: readonly string[] } | undefined;
    /** Ab zwei angehakten Wegen die Sammelansicht (`weg-sammel.ts`). */
    sammel?: WegSammel | undefined;
    /** Die Auswahl als Abschnitte (WI-0252, `weg-neuer-weg.ts`): mehrere Wege oder ein Teil der Abschnitte eines Wegs. */
    auswahlAbschnitte?: WegAuswahl | undefined;
    /** Steht die Rückfrage „Auswahl zu neuem Weg“ in diesem Fenster offen? */
    neuerWegOffen?: boolean | undefined;
    /** „Zu neuem Weg“ schreiben; fehlt ohne das Recht dazu. */
    schreibeNeuenWeg?:
        ((name: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly satz: string }>) | undefined;
}>();
const emit = defineEmits<{
    "update:auswahl": [id: string | undefined];
    /** „Quelle öffnen“ in den Quellen der Straße: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen (WI-0254 §12). */
    oeffneQuelle: [sourceId: string];
    /** Doppelklick und Enter, „Zeigen“ am Abschnitt: zu diesem Rahmen fliegen. */
    fliege: [bounds: [number, number, number, number]];
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    erneut: [];
    listeZu: [zu: boolean];
    /** Eine Nummer der Leiste: ihren Abschnitt in der Auswahl schalten. */
    nummer: [abschnitt: string];
    /** (W): wieder der ganze Weg. */
    ganzerWeg: [];
    /** Die Mehrfachauswahl der Liste an oder aus (WI-0252). */
    mehrfach: [an: boolean];
    angehakt: [ids: readonly string[]];
    /** Die Rückfrage „Auswahl zu neuem Weg“ öffnen oder schließen. */
    neuerWeg: [];
    neuerWegAbbrechen: [];
    /** „Weg entfernen …“ an der Mehrfachauswahl: das Blatt der Seite für alle gewählten Wege (WI-0252). */
    entfernen: [];
    /** „Weg entfernen …“ im Kasten „Abschnitte“ (OPS-000085): das Blatt für einen Abschnitt oder die ganze Straße. */
    entfernenWeg: [ziel: EntfernenZiel];
    /** Ein geteilter Abschnitt (WI-0302): seine eigene Straße (ihr Anker) in diesem Fenster öffnen, dort dieser Abschnitt gewählt. */
    strasse: [anker: string, abschnitt: string];
    /** Der Straßen-Assistent (WI-0310) zeigt Abschnitte: Diese leuchten mit ihren Nummern auf der Karte; ohne Bild leuchtet wieder das Wege-Fenster. */
    abschnitteZeigen: [bild: AssistentBild | undefined];
}>();

const kennung = computed(() => `wegeditor-${props.fenster.id}`);
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliesse");
    },
});
/** Am Telefon gibt es kein gelöstes Fenster. */
const lage = computed(() =>
    phoneViewport.value && props.fenster.lage === "geloest" ? "angedockt" : props.fenster.lage,
);

// --- Die Liste: Facetten aus dem Register ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "wege") as { facetten: readonly string[] }).facetten;
const optionen = { ...WEGE_OPTIONEN, facetten };
const sortierungen = WEGE_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
const legende = WEGE_LEGENDE();
const zeilen = computed(() => (props.liste?.rows ?? []).map(zeileVon));
/** Die Straße dieses Fensters (je Straße ein Fenster, T44), unter ihrem Anker. */
const auswahl = computed(() => props.fenster.gegenstand);
/**
 * In der Mehrfachauswahl hakt ein Klick an und wählt nicht: Je Straße ein Fenster (T44, D19), ein gemeldeter Klick legte dieses Fenster
 * samt Sammelansicht ab. Den Anker für Umschalt-Klick hält die Liste dann hier (wie die Kraftlinien).
 */
const mehrfachAn = computed(() => props.mehrfach?.mehrfach === true);
/** Bleibt in der Mehrfachauswahl genau einer angehakt, meldet die Liste ihn als Klick: Das Fenster zeigt ihn wie einzeln gewählt. */
function einzelnAngehakt(id: string): void {
    if (mehrfachAn.value) emit("update:auswahl", id);
}
const mehrfachAnker = ref<string | undefined>(undefined);
watch(mehrfachAn, () => (mehrfachAnker.value = undefined));
const gewaehlt = computed({
    get: () => (mehrfachAn.value ? (mehrfachAnker.value ?? auswahl.value) : auswahl.value),
    set: (id: string | undefined) => {
        if (mehrfachAn.value) {
            mehrfachAnker.value = id;
            return;
        }
        emit("update:auswahl", id);
        if (id !== undefined && phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
});
const zeile = computed(() => props.liste?.rows.find((row) => row.id === auswahl.value));
const strasse = computed((): EditorPathStreet | undefined => props.bearbeitung?.detail.value);
const strassenFehler = computed(() => {
    const art = props.bearbeitung?.zustand.value.art;
    if (art === "fehlt") return t("entwurf.fehlt");
    if (art === "lesefehler") return t("entwurf.lesefehler");
    return undefined;
});
const stand = computed(() => props.bearbeitung?.stand.value);
const nummern = new WeakMap<object, number>();
let naechsteNummer = 0;
function nummerVon(objekt: object): number {
    let nummer = nummern.get(objekt);
    if (nummer === undefined) {
        naechsteNummer += 1;
        nummer = naechsteNummer;
        nummern.set(objekt, nummer);
    }
    return nummer;
}
/**
 * Der Verlauf liest erst, wenn er gezeigt wird (`entwurf-verlauf.vue` beim Einhängen). `neuLaden` ersetzt ihn samt Bearbeitung (nach
 * ↺ etwa): Ein neuer Schlüssel hängt ihn dann neu ein, damit er liest.
 */
const verlaufSchluessel = computed(() => (props.verlauf === undefined ? 0 : nummerVon(props.verlauf)));
/** Eine gelöschte Straße liest nur (T54): Das Band sagt es, der Verlauf holt sie zurück. */
const schreibt = computed(
    () =>
        props.darf === true &&
        props.bearbeitung !== undefined &&
        strasse.value !== undefined &&
        strasse.value.deleted !== true,
);
const konflikt = computed(() => {
    const zustand = props.bearbeitung?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
/** Die Namen der Teile im Konfliktkasten. */
function teilName(teil: string): string {
    if (teil === "name") return t("wegeditor.fenster.feld.name");
    if (teil === "wegart") return t("wegeditor.fenster.feld.wegtyp");
    if (teil === "form") return t("entwurf.form");
    if (teil === "tunnel") return t("wegeditor.fenster.feld.tunnel");
    if (teil === "kennzeichen") return t("wegeditor.fenster.feld.kennzeichen");
    if (teil === "richtung" || teil === "flowDirection") return t("wegeditor.tafel.richtung");
    if (teil === "reisen") return t("wegeditor.reisemittel.titel");
    if (teil === "weitere") return t("wegeditor.weitere.name");
    return t("wegeditor.fenster.feld.nameAufKarte");
}
/** Die Namen der Felder im Verlauf, wie das Protokoll sie führt. */
function verlaufFeldName(feld: string): string {
    if (feld === "name") return t("wegeditor.fenster.feld.name");
    if (feld === "subtype") return t("wegeditor.fenster.feld.wegtyp");
    if (feld === "labelVisible") return t("wegeditor.fenster.feld.nameAufKarte");
    if (feld === "tunnel") return t("wegeditor.fenster.feld.tunnel");
    if (feld === "reisen") return t("wegeditor.reisemittel.titel");
    if (feld === "weitere") return t("wegeditor.weitere.name");
    if (feld === "mark") return t("wegeditor.fenster.feld.kennzeichen");
    if (feld === "isBach") return t("wegeditor.art.bach");
    if (feld === "flowDirection") return t("wegeditor.tafel.richtung");
    if (feld === "active") return t("verlauf.aktiv");
    if (feld === "offMap") return t("kraftlinieneditor.verlauf.offMap");
    if (feld === "stand") return t("kraftlinieneditor.verlauf.stand");
    if (feld === "geometry") return t("entwurf.form");
    if (feld === "wiki") return t("kraftlinieneditor.abschnitt.wiki");
    if (feld === "wasserHoehen") return t("wegeditor.verlauf.wasserHoehen");
    return feld;
}
/** Ein Wert im Verlauf: die Wegart mit ihrem Namen, die Kurve als Zahl ihrer Stützpunkte. */
function verlaufWert(feld: string, wert: unknown): string | undefined {
    if (feld === "subtype" && typeof wert === "string") return artName(wert);
    if (feld === "mark") return typeof wert === "string" ? artName(wert) : t("editorListe.nein");
    if (feld === "isBach") return wert === true ? t("editorListe.ja") : t("editorListe.nein");
    if (feld === "flowDirection")
        return t(`wegeditor.tafel.richtung.${wert === "forward" || wert === "reverse" ? wert : "offen"}` as never);
    if (feld === "geometry" && Array.isArray(wert))
        return t("wegeditor.fenster.stuetzpunkte", { n: formatNumber(wert.length, 0) });
    // Die eigenen Höhen an Flussstützpunkten, die mit einer verschobenen Kurve umzogen (WI-0259): Höhe in Schritt und Lage, je Eintrag eine.
    if (feld === "wasserHoehen" && Array.isArray(wert))
        return wert
            .flatMap((z: unknown) => {
                const { h, x, y } = (z ?? {}) as { h?: unknown; x?: unknown; y?: unknown };
                return typeof h === "number" && typeof x === "number" && typeof y === "number"
                    ? [
                          t("wegeditor.verlauf.wasserHoehe", {
                              h: formatNumber(h, 0),
                              einheit: t("planner.slope.unit"),
                              ort: `${formatDecimal(x, 2)}/${formatDecimal(y, 2)}`,
                          }),
                      ]
                    : [];
            })
            .join(" · ");
    // Die Zuordnung, die „Auswahl zu neuem Weg“ aufhob (WI-0252): der Artikel beim Titel, sonst seine Adresse.
    if (feld === "wiki" && typeof wert === "object" && wert !== null) {
        const w = wert as { titel?: unknown; url?: unknown };
        return typeof w.titel === "string" ? w.titel : typeof w.url === "string" ? w.url : t("editorListe.ja");
    }
    // Die weiteren Straßennamen (WI-0302): die Namen mit Komma, leer „keine“.
    if (feld === "weitere" && Array.isArray(wert)) return weitereNamenText(wert);
    if (feld === "reisen" && typeof wert === "object" && wert !== null) {
        // Die Mittel mit Namen, dazu wie viele ein Zeitfenster haben; ohne Liste die Vorgabe des Wegtyps.
        const r = wert as { liste?: unknown; fenster?: unknown };
        const fenster = typeof r.fenster === "object" && r.fenster !== null ? Object.keys(r.fenster).length : 0;
        const liste = Array.isArray(r.liste)
            ? r.liste.length === 0
                ? t("wegeditor.reisemittel.keine")
                : r.liste.map((m) => t(`planner.transport.opt.${String(m)}` as never)).join(", ")
            : t("wegeditor.reisemittel.vorgabe");
        return fenster === 0
            ? liste
            : `${liste} · ${tPlural("wegeditor.reisemittel.fensterZahl", fenster, { n: formatNumber(fenster, 0) })}`;
    }
    return undefined;
}
function setzeName(wert: string): void {
    props.bearbeitung?.feld((felder) => mitHerkunft(felder, "name", wert, "manual"), "name");
}
function setzeWegart(wert: string): void {
    props.bearbeitung?.feld((felder) => mitWegartFuerAlle(mitHerkunft(felder, "subtype", wert, "manual"), wert));
}
/** Der Wegtyp der gewählten Abschnitte aus der Tafel (Vorschlag 3 Schritt 3). */
function setzeWegartTeil(wert: string): void {
    props.bearbeitung?.feld((felder) => mitWegartTeil(felder, gewaehlteIds.value, wert));
}
/** Die Fließrichtung der gewählten Flüsse aus der Tafel (Plan Fluss/Bach, Schritt 4). */
function setzeRichtung(wert: "forward" | "reverse" | null): void {
    props.bearbeitung?.feld((felder) => mitRichtung(felder, gewaehlteIds.value, wert));
}
function kehreRichtungUm(): void {
    props.bearbeitung?.feld((felder) => mitRichtungUmgekehrt(felder, gewaehlteIds.value));
}
function setzeNameAufKarte(an: boolean): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, labelVisible: an }));
}
/** Der Haken „Karawanenroute“: das Kennzeichen aller Abschnitte. */
function setzeKarawanenroute(an: boolean): void {
    const mark: PathMark | null = an ? "karawanenroute" : null;
    props.bearbeitung?.feld((felder) => mitHerkunft(felder, "mark", mark, "manual"));
}
/** Einen weiteren Straßennamen den gewählten Abschnitten geben bzw. von ihnen lösen (WI-0302), EIN Schritt wie der Wegtyp. */
function gibWeiteren(weiterer: EditorPathWeiterer): void {
    props.bearbeitung?.feld((felder) => ({
        ...felder,
        weitere: mitWeiterem(felder.weitere, gewaehlteIds.value, weiterer),
    }));
}
function loeseWeiteren(key: string): void {
    props.bearbeitung?.feld((felder) => ({
        ...felder,
        weitere: ohneWeiteren(felder.weitere, gewaehlteIds.value, key),
    }));
}
function setzeTunnel(id: string, an: boolean): void {
    props.bearbeitung?.feld((felder) => ({ ...felder, tunnel: { ...felder.tunnel, [id]: an } }));
}
/**
 * Eine Nummer unter „Tunnel“ oben wählt genau diesen Abschnitt, wie (W) und dann seine Nummer in der Leiste: Die Tafel zeigt dann
 * seinen Haken (Betreiber 2026-11-09). Der Klick in der Leiste schaltet um; hier gilt die Wahl danach nur ihm.
 */
function waehleNur(id: string): void {
    emit("ganzerWeg");
    emit("nummer", id);
}
/**
 * Die Leiste (W) (1) (2) … im Kasten „Abschnitte“ (P6 Variante C; Betreiber 2026-10-19 am echten Fenster: „das ist unsere grundlage“):
 * Sie wählt, wofür die Eigenschaften darunter gelten, auch über die Karte (zweiter Klick auf die Straße). (W) heißt der ganze Weg; dann
 * stehen alle Nummern gedrückt. Ein Abschnitt hat keinen eigenen Namen (Betreiber: „wegabschnitte können keinen anderen namen als den
 * namen des wegs haben“), er heißt nach seiner Nummer.
 */
const wahl = computed(() => props.abschnittsWahl ?? null);
/** Die gewählten Abschnitte in ihrer Folge; bei (W) alle. */
const gewaehlteIds = computed(() => {
    const segmente = props.bearbeitung?.detail.value?.segments ?? [];
    const w = wahl.value;
    return segmente.filter((a) => w === null || w.has(a.id)).map((a) => a.id);
});
/** Der Rahmen der gewählten Abschnitte (für „Zeigen“); ohne Rahmen keiner. */
const rahmenDerWahl = computed((): [number, number, number, number] | undefined => {
    let r: [number, number, number, number] | undefined;
    for (const a of props.bearbeitung?.detail.value?.segments ?? []) {
        if (!gewaehlteIds.value.includes(a.id) || a.bounds === undefined) continue;
        const [x0, y0, x1, y1] = a.bounds;
        r = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
    }
    return r;
});

/** Läuft der Abschnitt durch einen Tunnel? Im Entwurf, sonst wie gelesen. */
function tunnelVon(abschnitt: { id: string; tunnel?: true | undefined }): boolean {
    return stand.value?.felder.tunnel[abschnitt.id] ?? abschnitt.tunnel === true;
}
/** Die Straße mit den Reisemitteln des Entwurfs: Die Tafel zeigt, was „Fertig“ schreiben würde. */
const strasseImEntwurf = computed((): EditorPathStreet | undefined => {
    const d = strasse.value;
    const reisen = stand.value?.felder.reisen;
    const arten = stand.value?.felder.arten;
    const richtung = stand.value?.felder.richtung;
    const weitere = stand.value?.felder.weitere;
    if (d === undefined || reisen === undefined || arten === undefined || richtung === undefined) return d;
    return {
        ...d,
        segments: d.segments.map((a) => {
            const r = reisen[a.id] ?? a.reisen;
            const wahl = arten[a.id];
            const fliesst = richtung[a.id];
            const namen = weitere?.[a.id];
            // Die Wahl „Bach“ ist ein Flussweg mit Bach; die Richtung steht nur am Fluss.
            const ohneRichtung = Object.fromEntries(
                Object.entries(a).filter(([feld]) => feld !== "flowDirection"),
            ) as typeof a;
            return {
                ...ohneRichtung,
                ...(r === undefined ? {} : { reisen: r }),
                ...(wahl === undefined ? {} : { art: subtypeDerWahl(wahl), bach: wahl === WEGART_BACH }),
                ...(fliesst === undefined || fliesst === null ? {} : { flowDirection: fliesst }),
                ...(namen === undefined ? {} : { weitere: [...namen] }),
            };
        }),
    };
});
/** Die weiteren Straßennamen je Abschnitt, wie gelesen: Was der Entwurf dazu tut, ist ungespeichert (WI-0302). */
const weitereGelesen = computed((): WeitereJeAbschnitt =>
    Object.fromEntries((strasse.value?.segments ?? []).map((a) => [a.id, a.weitere ?? []])),
);
/**
 * Die geteilten Abschnitte (WI-0302): Abschnitte anderer Straßen, die den Artikel dieser Straße als weiteren Namen tragen. Sie zählen mit und
 * stehen lesend nach den eigenen; bearbeitet werden sie bei ihrer Straße.
 */
const geteilt = computed((): readonly EditorPathGeteilt[] => strasse.value?.geteilt ?? []);
const abschnittZahl = computed(() => (strasse.value?.segments.length ?? 0) + geteilt.value.length);
const geteiltStrecke = (g: EditorPathGeteilt): string => {
    const abzweig = t("wegeditor.abschnitte.abzweig");
    return `${g.von ?? abzweig} → ${g.bis ?? abzweig}`;
};
/** Kann das Fenster die Straße eines geteilten Abschnitts öffnen? Nur, wenn die Liste sie unter ihrem Anker kennt. */
const kannOeffnen = (g: EditorPathGeteilt): boolean =>
    props.liste?.rows.some((row) => row.id === g.strasseId && row.deleted !== true) === true;
/**
 * Eine Änderung der Reisemittel gilt allen gewählten Abschnitten (Vorschlag 3: „eine Änderung setzt alle gleich“), je mit seinem Wegtyp:
 * Was er nicht anbietet, bleibt dort, wie es ist. Vor der ersten Änderung wird ein Abschnitt ausgeschrieben (F16 „A“, `reisemittel.ts`).
 */
function aendereReisen(schritt: (reisen: EditorPathReisen, art: string) => EditorPathReisen): void {
    const d = strasse.value;
    if (d === undefined) return;
    props.bearbeitung?.feld((felder) => {
        const reisen = { ...felder.reisen };
        for (const a of d.segments) {
            if (!gewaehlteIds.value.includes(a.id)) continue;
            const { art, reisen: gelesen } = reisenDes(a, d);
            reisen[a.id] = schritt(reisen[a.id] ?? gelesen, art);
        }
        return { ...felder, reisen };
    });
}
const setzeMittel = (mittel: string, an: boolean): void =>
    aendereReisen((reisen, art) => mitMittel(reisen, art, mittel, an));
const setzeFenster = (mittel: string, fenster: EditorPathSaison | null): void =>
    aendereReisen((reisen, art) => mitFenster(reisen, art, mittel, fenster));

/**
 * „Auf alle Abschnitte übernehmen“ (OPS-000112, Entwurf Fassung 2): Die Reisemittel der gewählten Abschnitte gehen an alle, alle Zeilen oder
 * nur eine (`nur`), als EIN Schritt im Entwurf (↶ nimmt ihn zurück, „Fertig“ speichert). Die Nummern der Abschnitte, die sich ändern,
 * leuchten kurz auf, und der Fuß sagt, was geschah, bis zum nächsten Schritt. Dasselbe für „An alle Abschnitte“ in der Wiki-Box, das
 * sofort wirkt: Der Satz steht dann, bis der nächste Entwurf beginnt.
 */
const LEUCHTEN_MS = 1200;
const leuchtet = ref<ReadonlySet<string>>(new Set());
let leuchtUhr: ReturnType<typeof setTimeout> | undefined;
function leuchte(ids: readonly string[]): void {
    clearTimeout(leuchtUhr);
    leuchtet.value = new Set(ids);
    leuchtUhr = setTimeout(() => (leuchtet.value = new Set()), LEUCHTEN_MS);
}
onBeforeUnmount(() => clearTimeout(leuchtUhr));
/**
 * Der Satz im Fuß; `schritt`: der Stand des Entwurfs, zu dem er gehört, als Zahl der Schritte und Reisemittel (ohne: die Wiki-Box, kein
 * Entwurf). 🪤 Nicht über die Gleichheit der Objekte: Nach dem Nehmen der Sperre ersetzt der Entwurf alle Stände durch neue (`ersetzeAlle`).
 */
const meldung = ref<{ satz: string; schritt?: { n: number; inhalt: string } } | undefined>(undefined);
const schritte = computed(() => props.bearbeitung?.lage.value.ungespeichert ?? 0);
const inhaltText = (): string =>
    JSON.stringify([stand.value?.felder.reisen ?? null, stand.value?.felder.richtung ?? null]);
/** Speichern, eine Sperre, ein Konflikt oder eine Ablehnung gehen vor: Dann steht ihr Satz. */
const VORRANG = new Set(["speichert", "gesperrt", "sperrfehler", "konflikt", "abgelehnt", "fehlt", "lesefehler"]);
const meldungSatz = computed(() => {
    const m = meldung.value;
    if (m === undefined || VORRANG.has(props.bearbeitung?.zustand.value.art ?? "")) return undefined;
    if (m.schritt === undefined) return schritte.value === 0 ? m.satz : undefined;
    return schritte.value === m.schritt.n && inhaltText() === m.schritt.inhalt ? m.satz : undefined;
});
watch(schritte, (n) => {
    if (n > 0 && meldung.value !== undefined && meldung.value.schritt === undefined) meldung.value = undefined;
});
watch(
    () => strasse.value?.id,
    () => (meldung.value = undefined),
);
/** Die Nummern einiger Abschnitte als Text: „Abschnitt 3“, „Abschnitt 1 und 2“, „Abschnitt 1, 2 und 5“. */
function nummernText(ids: readonly string[]): string {
    const alle = strasse.value?.segments ?? [];
    return nummernAus(ids.map((id) => formatNumber(alle.findIndex((a) => a.id === id) + 1, 0)));
}
/** Wie `nummernText`, drei und mehr aufeinanderfolgende als Bereich: „Abschnitt 4 bis 7 und 9“ (OPS-000112). */
function bereicheText(ids: readonly string[]): string {
    return nummernAus(
        nummernBereiche(strasse.value?.segments ?? [], ids).map((b) =>
            b.length === 2
                ? t("wegeditor.tafel.richtung.alle.bereich", { von: formatNumber(b[0], 0), bis: formatNumber(b[1], 0) })
                : formatNumber(b[0], 0),
        ),
    );
}
function nummernAus(nr: readonly string[]): string {
    const letzte = nr.at(-1) ?? "";
    return nr.length <= 1
        ? t("wegeditor.reisemittel.alle.nummer", { nr: letzte })
        : t("wegeditor.reisemittel.alle.nummern", { nr: nr.slice(0, -1).join(", "), letzte });
}
function uebernimm(nur: string | undefined): void {
    const d = strasseImEntwurf.value;
    const b = props.bearbeitung;
    if (d === undefined || b === undefined) return;
    const e = uebernahme(d.segments, gewaehlteIds.value, d, nur);
    if (e.art !== "geht") return;
    const vorher = inhaltText();
    b.feld((felder) => ({ ...felder, reisen: { ...felder.reisen, ...e.reisen } }));
    const nachher = inhaltText();
    if (nachher === vorher) return;
    const werte = {
        mittel: nur === undefined ? "" : t(`planner.transport.opt.${nur}` as never),
        von: nummernText(gewaehlteIds.value),
        n: formatNumber(d.segments.length, 0),
    };
    meldung.value = {
        satz: t(
            nur === undefined ? "wegeditor.reisemittel.alle.gegeben" : "wegeditor.reisemittel.alle.zeileGegeben",
            werte,
        ),
        schritt: { n: schritte.value, inhalt: nachher },
    };
    leuchte(e.geaendert);
}

/**
 * Das Flussnetz der offenen Straße (OPS-000112, `weg-fliessrichtung.ts`): geladen, sobald sie als gespeichert einen Fluss hat, und neu, wenn
 * sich ihre Abschnitte oder deren Revisionen ändern (eine neue Linie hebt die Revision).
 */
const flussnetz = ref<{ schluessel: string; lage: FlussnetzLage }>({ schluessel: "", lage: { art: "keins" } });
watch(
    () => {
        const d = strasse.value;
        if (d === undefined || d.deleted === true || !d.segments.some((a) => reisenDes(a, d).art === "Flussweg"))
            return "";
        return `${d.id}|${flussnetzSchluessel(d.segments)}`;
    },
    (schluessel) => {
        const d = strasse.value;
        if (schluessel === "" || d === undefined) {
            flussnetz.value = { schluessel: "", lage: { art: "keins" } };
            return;
        }
        if (flussnetz.value.schluessel === schluessel) return;
        flussnetz.value = { schluessel, lage: { art: "laedt" } };
        const gilt = (lage: FlussnetzLage): void => {
            if (flussnetz.value.schluessel === schluessel) flussnetz.value = { schluessel, lage };
        };
        ladeFlussnetz(fetch, d.id).then(
            (netz) => gilt({ art: "da", netz }),
            () => gilt({ art: "fehler" }),
        );
    },
    { immediate: true },
);
/**
 * „Auf alle Abschnitte übernehmen“ der Fließrichtung (OPS-000112; Vali 2026-11-11 „A: in alle Arme“): Die Richtung des gewählten Abschnitts
 * läuft dem Fluss nach, EIN Schritt im Entwurf. Die geänderten Nummern leuchten, der Fuß nennt, was gedreht wurde und was nicht erreicht.
 */
function uebernimmRichtung(): void {
    const d = strasseImEntwurf.value;
    const b = props.bearbeitung;
    if (d === undefined || b === undefined) return;
    const richtung = Object.fromEntries(d.segments.map((a) => [a.id, a.flowDirection ?? null] as const));
    const e = richtungsUebernahme(flussnetz.value.lage, gewaehlteIds.value, richtung, stand.value?.form !== undefined);
    if (e.art !== "geht" || flussnetz.value.lage.art !== "da") return;
    const vorher = inhaltText();
    b.feld((felder) => mitRichtungen(felder, e.richtung));
    const nachher = inhaltText();
    if (nachher === vorher) return;
    const teile = [
        t("wegeditor.tafel.richtung.alle.gegeben", {
            von: nummernText(gewaehlteIds.value),
            n: formatNumber(e.erreicht, 0),
            m: formatNumber(flussnetz.value.lage.netz.abschnitte.length - 1, 0),
        }),
        ...(e.gedreht.length > 0
            ? [t("wegeditor.tafel.richtung.alle.gedreht", { nummern: bereicheText(e.gedreht) })]
            : []),
        ...(e.neuGesetzt.length > 0
            ? [t("wegeditor.tafel.richtung.alle.neuGesetzt", { nummern: bereicheText(e.neuGesetzt) })]
            : []),
        ...(e.unterbrochen.length > 0
            ? [t("wegeditor.tafel.richtung.alle.unterbrochen", { nummern: bereicheText(e.unterbrochen) })]
            : []),
        ...(e.gabelung.length > 0
            ? [t("wegeditor.tafel.richtung.alle.gabelung", { nummern: bereicheText(e.gabelung) })]
            : []),
    ];
    meldung.value = { satz: teile.join(" "), schritt: { n: schritte.value, inhalt: nachher } };
    leuchte(e.geaendert);
}
/** Die Wiki-Box hängte den Artikel an alle Abschnitte: Die ohne ihn leuchten, der Fuß nennt sie (vor dem Neulesen gezählt). */
function wikiAnAlle(name: string): void {
    const d = strasse.value;
    if (d === undefined) return;
    const fehlten = d.segments.filter((a) => !a.wiki).map((a) => a.id);
    if (fehlten.length === 0) return;
    meldung.value = {
        satz: t("wegeditor.wiki.anAlle", { name, nummern: nummernText(fehlten) }),
    };
    leuchte(fehlten);
}
/**
 * Die Landwege zur Wahl (ein Flussweg bleibt Flussweg, Seewege gibt es im Editor nicht); liegt die Straße auf mehreren Wegtypen, im
 * Entwurf (die Tafel wählt je Abschnitt) oder wie gelesen, steht „gemischt“ davor, bis jemand einen für alle wählt.
 */
const wegarten = computed(() => {
    const imEntwurf = stand.value === undefined ? undefined : [...new Set(Object.values(stand.value.felder.arten))];
    const gemischt =
        imEntwurf ?? (strasse.value === undefined ? [] : (strasse.value.subtypes ?? [strasse.value.subtype]));
    return [
        ...(gemischt.length > 1
            ? [
                  {
                      wert: WEGART_GEMISCHT,
                      text: t("wegeditor.fenster.gemischt", { arten: gemischt.map(artName).join(", ") }),
                  },
              ]
            : []),
        ...[...PATH_EDIT_SUBTYPES, WEGART_BACH].map((wert) => ({ wert, text: artName(wert) })),
    ];
});
function fliege(id: string): void {
    const bounds = props.liste?.rows.find((row) => row.id === id)?.bounds;
    if (bounds !== undefined) emit("fliege", bounds);
}

// --- « » wie die anderen Editoren ---
// Der Schalter liegt in `app.vue` (`listenSchalter`), wie beim Ortseditor: Nur so rücken die Laschen „Info“/„Editor“ mit (`slotBreite`).
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));
const telefonSeite = ref<"liste" | "eigenschaften">("liste");
// Am Telefon steht die Rückfrage „Auswahl zu neuem Weg“ in den Eigenschaften: Geht sie auf (etwa vom Kartenmenü), kommen sie nach vorn.
watch(
    () => props.neuerWegOffen === true,
    (offen) => {
        if (offen && phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
);

// --- Die Eigenschaften ---
type Reiter = (typeof WEGEDITOR_TAFEL)["eintraege"][number]["id"];
const reiter = ref<Reiter>("eigenschaften");
/** Die Karten der Kartensammlung, die diese Straße abbilden: Der Reiter steht nur, wenn es welche gibt. */
const karten = useTraegerKarten(
    () => (strasse.value === undefined ? undefined : { kind: "path", anchor: strasse.value.id }),
    () => {
        if (reiter.value === "karten") reiter.value = "eigenschaften";
    },
);
/** Die Zahl der aktiven Quellen der Straße, sobald der Reiter sie gelesen hat (`fenster/traeger-quellen.vue`); eine andere Straße beginnt ohne. */
const quellenZahl = ref<number | undefined>(undefined);
watch(auswahl, () => (quellenZahl.value = undefined));
const REITER_NAMEN = {
    eigenschaften: () => t("wegeditor.fenster.reiter.eigenschaften"),
    quellen: () =>
        quellenZahl.value === undefined
            ? t("fenster.traegerQuellen.reiterOhne")
            : t("fenster.traegerQuellen.reiter", { n: formatNumber(quellenZahl.value, 0) }),
    karten: () => t("fenster.traegerKarten.reiter", { n: formatNumber(karten.value.length, 0) }),
    verlauf: () => t("wegeditor.fenster.reiter.verlauf"),
} as const satisfies Record<Reiter, () => string>;
const reiterListe = computed(() =>
    WEGEDITOR_TAFEL.eintraege
        .filter((eintrag) => eintrag.id !== "verlauf" || props.verlauf !== undefined)
        .filter((eintrag) => eintrag.id !== "karten" || karten.value.length > 0)
        .map((eintrag) => ({ id: eintrag.id, name: REITER_NAMEN[eintrag.id]() })),
);
/** Steht im Entwurf der Straße Ungeschriebenes? Dann erst „Fertig“ oder verwerfen (wie „Entfernen …“ an der Kraftlinie). */
const ungespeichert = computed(() => (props.bearbeitung?.lage.value.ungespeichert ?? 0) > 0);
/** Warum „Auswahl zu neuem Weg“ gerade nicht geht. */
const neuerWegSperre = computed(() => {
    if (props.schreibeNeuenWeg === undefined) return t("editorPanel.verb.lesen");
    if (props.auswahlAbschnitte === undefined) return t("wegeditor.mehrfach.laedt");
    return undefined;
});
/** Was „Weg entfernen …“ öffnet: der gewählte Abschnitt, der einzige oder (W) die ganze Straße; ein Teil mehrerer geht nicht. */
const entfernenZielJetzt = computed(() =>
    strasse.value === undefined ? undefined : entfernenZiel(strasse.value.segments, wahl.value),
);
/** Warum „Weg entfernen …“ gerade nicht geht. */
const entfernenSperre = computed(() => {
    if (!schreibt.value) return t("editorPanel.verb.lesen");
    if (wikiBoxUngespeichert.value) return t("verlauf.gesperrtBearbeitung");
    if (entfernenZielJetzt.value?.art === "mehrere") return t("wegeditor.griff.entfernen.einzeln");
    return entfernenZielJetzt.value === undefined ? t("wegeditor.mehrfach.laedt") : undefined;
});
function entferneWeg(): void {
    const ziel = entfernenZielJetzt.value;
    if (ziel !== undefined && ziel.art !== "mehrere") emit("entfernenWeg", ziel);
}
const titel = computed(() => {
    const n = props.sammel?.ids.length;
    if (n !== undefined)
        return `${t("wegeditor.fenster.titel")} · ${tPlural("wegeditor.mehrfach.gewaehlt", n, { n: formatNumber(n, 0) })}`;
    return zeile.value
        ? `${t("wegeditor.fenster.titel")} · ${zeileVon(zeile.value).name}`
        : t("wegeditor.fenster.titel");
});
const art = computed(() => {
    if (zeile.value === undefined) return "";
    if (zeile.value.mark !== undefined)
        return `${artName(zeile.value.mark)} · ${t("wegeditor.liste.auf", { arten: untergrundText(zeile.value) })}`;
    return artName(zeile.value.isBach ? "Bach" : zeile.value.subtype);
});
/** Trägt die Straße das Kennzeichen „Karawanenroute“? Im Entwurf, sonst wie gelesen. */
const karawanenroute = computed(() =>
    stand.value !== undefined ? stand.value.felder.mark === "karawanenroute" : strasse.value?.mark === "karawanenroute",
);
/**
 * Trägt nur ein Teil der Abschnitte das Kennzeichen (ein Weg ist sein Name, WI-0177 Schritt 2), heißt es „gemischt: an n von m
 * Abschnitten“, bis jemand den Haken setzt oder nimmt (Vorgabe des Betreibers 2026-10-19).
 */
const kennzeichenTeils = computed((): string | undefined => {
    const teile = strasse.value?.segments ?? [];
    const an = teile.filter((a) => a.mark === "karawanenroute").length;
    if (an === 0 || an === teile.length) return undefined;
    if (stand.value !== undefined && stand.value.felder.mark !== (strasse.value?.mark ?? null)) return undefined;
    return t("wegeditor.fenster.gemischt", {
        arten: t("kraftlinieneditor.beschriftung.teil", { n: an, von: teile.length }),
    });
});
const nameAufKarte = computed(() => {
    const teile = strasse.value?.segments ?? [];
    const an = teile.filter((a) => a.labelVisible).length;
    if (an === 0) return t("editorListe.nein");
    return an === teile.length
        ? t("editorListe.ja")
        : t("kraftlinieneditor.beschriftung.teil", { n: an, von: teile.length });
});
/** Wie viele Abschnitte durch einen Tunnel laufen. */
const tunnelAn = computed(() => (strasse.value?.segments ?? []).filter(tunnelVon).length);
/**
 * Die Abschnitte im Tunnel, mit ihrer Nummer in der Leiste (Betreiber 2026-11-09: oben „nicht anklickbar … sondern gelistet …
 * welche abschnitte getunnelt sind“). Im Entwurf, sonst wie gelesen.
 */
const tunnelNummern = computed(() =>
    (strasse.value?.segments ?? []).flatMap((a, i) => (tunnelVon(a) ? [{ id: a.id, n: i + 1 }] : [])),
);
const mitArtikel = computed(() => (strasse.value?.segments ?? []).filter((a) => a.wiki).length);

// --- Die Wiki-Felder (WI-0225, `weg-wiki.ts`) ---
/** Eine Zeile ohne Wiki-Gegenstück: Sie fluchtet mit den Wiki-Feldern (§13.8). */
const OHNE_WIKI = wikiLage({ eigen: null, wiki: undefined, mitWiki: false });
/** Die Felder, gegen die verglichen wird: im Entwurf, sonst wie gelesen. */
const felderJetzt = computed(() =>
    stand.value !== undefined ? stand.value.felder : strasse.value === undefined ? undefined : felderAus(strasse.value),
);
function lageVon(feld: WegWikiFeld) {
    const d = strasse.value;
    const f = felderJetzt.value;
    return d === undefined || f === undefined ? OHNE_WIKI : wegWikiLage(d, f, feld, !schreibt.value);
}
/** An wie vielen Abschnitten der Artikel hängt, nur wenn nicht an allen. */
const anteil = computed(() => {
    const von = strasse.value?.segments.length ?? 0;
    return strasse.value?.artikel !== undefined && mitArtikel.value < von ? { mit: mitArtikel.value, von } : undefined;
});
/** Die Zettel einer Wiki-Art ohne Zuordnung (Mischform): beim Wegtyp die des Bausteins, beim Kennzeichen eigene. */
function ohneZuordnung(feld: "subtype" | "mark"): { still: string; wiki: string } | undefined {
    const text = strasse.value?.artikel?.werte[feld];
    if (typeof text !== "string") return undefined;
    const an =
        anteil.value === undefined ? "" : ` · ${t("wikiFeld.anteil", { n: anteil.value.mit, m: anteil.value.von })}`;
    return feld === "subtype"
        ? { still: t("wikiFeld.wegtyp.still", { text }), wiki: `${t("wikiFeld.wegtyp.wiki", { text })}${an}` }
        : {
              still: t("wegeditor.wiki.kennzeichenStill", { text }),
              wiki: `${t("wegeditor.wiki.kennzeichenWiki", { text })}${an}`,
          };
}
/** ↺ am Zeilenende: das Feld im Entwurf auf seinen Wiki-Wert, EIN Schritt. */
function aufWiki(feld: WegWikiFeld): void {
    const d = strasse.value;
    if (d !== undefined) props.bearbeitung?.feld((felder) => wegAufWiki(d, felder, feld));
}
/** „↺ Alles auf Wiki-Werte (n)“ im Kopf der Eigenschaften (WI-0183), nur mit Artikel und Schreibrecht. */
const wikiKnopf = computed(() => schreibt.value && strasse.value?.artikel !== undefined);
const wikiZahl = computed(() => {
    const d = strasse.value;
    const f = felderJetzt.value;
    return d === undefined || f === undefined ? 0 : wegAbweichende(d, f, !schreibt.value);
});
function allesAufWiki(): void {
    const d = strasse.value;
    if (d !== undefined && wikiZahl.value > 0)
        props.bearbeitung?.feld((felder) => wegAllesAufWiki(d, felder, !schreibt.value));
}

// --- Die Wiki-Box (WI-0253): der Artikel der Straße (an allen Abschnitten), Zuweisen · Sync · Entfernen. Sie wirkt auf dem Server, nicht im Entwurf;
// darum sperrt sie bei ungespeicherten Änderungen, und nach einer Änderung liest das Fenster die Straße neu. Ein Sync ändert nur den Namen:
// Wegtyp und Kennzeichen holt allein ↺ am Zeilenende. ---
const wikiBoxUngespeichert = computed(() => {
    const lage = props.bearbeitung?.lage.value;
    return lage !== undefined && (lage.ungespeichert > 0 || lage.form);
});
const wikiBoxLesestand = computed(() => strasse.value?.segments.map((a) => a.revision).join(",") ?? "");
const wikiBoxFelder = computed((): WikiBoxFeld[] => {
    const f = felderJetzt.value;
    if (f === undefined) return [];
    return [
        {
            id: "name",
            plan: ["name"],
            name: t("wegeditor.fenster.feld.name"),
            lage: lageVon("name"),
            folgt: herkunftIm(f, "name") === "wiki",
            eigen: f.name,
        },
    ];
});
function wikiGeaendert(): void {
    void props.bearbeitung?.neuLesen();
    emit("erneut");
}

// --- Straßen-Assistent (WI-0310) ---
const assistentOffen = ref(false);
// Eine andere Straße im Fenster: Der Assistent gehörte der alten.
watch(
    () => strasse.value?.id,
    () => {
        assistentOffen.value = false;
    },
);
function assistentZeige(bild: AssistentBild | undefined, rahmen?: Rahmen): void {
    emit("abschnitteZeigen", bild);
    if (rahmen !== undefined) emit("fliege", rahmen);
}
/** Zugewiesen: Die Straße wird neu gelesen; ändert sich ihr Anker (die kleinste Kennung ihrer Abschnitte), folgt das Fenster ihr. */
function assistentGeaendert(anker: string): void {
    wikiGeaendert();
    if (anker !== strasse.value?.id) emit("update:auswahl", anker);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="wege"
        rumpf="spalten"
        :lage="lage"
        :box="fenster.box"
        :ablage-ziel="ablageZiel"
        :einzug="einzug"
        :titel="titel"
        :zusatz="schreibt ? undefined : t('editorPanel.verb.lesen')"
        :testid="kennung"
        @update:lage="(neu, box) => emit('lage', neu, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('wegeditor.fenster.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="ladeFehler" class="wegeditor__leise">
                {{ ladeFehler }}
                <button type="button" class="wegeditor__verweis" @click="emit('erneut')">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!liste" class="wegeditor__leise">{{ t("wegeditor.fenster.laedt") }}</p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                :mehrfach="mehrfachAn"
                :angehakt="mehrfach?.angehakt ?? []"
                :zeilen="zeilen"
                :optionen="optionen"
                :facetten-name="facettenName"
                :wert-name="wertName"
                :sortierungen="sortierungen"
                :legende="legende"
                :leer-text="t('wegeditor.fenster.leer')"
                :kennung="`${kennung}-wege`"
                :beschriftung="t('wegeditor.fenster.liste')"
                :einstellung="einstellung"
                @oeffne="fliege"
                @klick="(id: string) => einzelnAngehakt(id)"
                @update:mehrfach="(an: boolean | undefined) => emit('mehrfach', an === true)"
                @update:angehakt="(ids: readonly string[]) => emit('angehakt', ids)"
            />
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="t('wegeditor.fenster.eigenschaften')"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button v-if="phoneViewport" type="button" class="wegeditor__verweis" @click="telefonSeite = 'liste'">
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="wegeditor__listenschalter"
                    :aria-expanded="!zu"
                    :aria-controls="`${kennung}-listenspalte`"
                    :aria-label="schalterText"
                    :title="schalterText"
                    :data-testid="`${kennung}-listenschalter`"
                    @click="emit('listeZu', !zu)"
                >
                    <span class="avm-versalmitte" aria-hidden="true">{{ zu ? "»" : "«" }}</span>
                </button>
            </template>
            <!-- „↺ Alles auf Wiki-Werte (n)“ rechts im Kopf (WI-0183), wie am Ort; gesperrt nennt der Zettel den Grund. -->
            <template v-if="wikiKnopf && !sammel" #kopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="wikiZahl === 0 ? '' : undefined"
                    :title="wikiZahl === 0 ? t('wikiFeld.keineEigenen') : undefined"
                    :testid="`${kennung}-alle-wiki`"
                    @click="allesAufWiki"
                >
                    {{ t("wikiFeld.alle", { n: formatNumber(wikiZahl, 0) }) }}
                </AvmKnopf>
            </template>
            <WegSammelAnsicht
                v-if="sammel"
                :kennung="kennung"
                :sammel="sammel"
                :darf-entfernen="darf === true"
                @entfernen="emit('entfernen')"
            >
                <template #formKnopf>
                    <AvmKnopf
                        v-if="!neuerWegOffen"
                        :gesperrt="neuerWegSperre"
                        :title="t('wegeditor.neuerWeg.tooltip')"
                        :testid="`${kennung}-neuer-weg-knopf`"
                        @click="emit('neuerWeg')"
                    >
                        <template #zeichen><EditorZeichen name="neuer-weg" /></template>
                        {{ t("wegeditor.griff.neuerWeg") }}
                    </AvmKnopf>
                </template>
                <template #formFrage>
                    <WegNeuerWegFrage
                        v-if="neuerWegOffen && schreibeNeuenWeg"
                        :kennung="kennung"
                        :auswahl="auswahlAbschnitte"
                        :schreibe="schreibeNeuenWeg"
                        @abbrechen="emit('neuerWegAbbrechen')"
                    />
                </template>
            </WegSammelAnsicht>
            <p v-else-if="!zeile" class="wegeditor__leise">{{ t("wegeditor.fenster.keineWahl") }}</p>
            <template v-else>
                <div class="wegeditor__name">
                    <strong>{{ zeileVon(zeile).name }}</strong>
                    <small>{{
                        `${art} · ${tPlural("kraftlinieneditor.unter.abschnitte", zeile.segments + geteilt.length, {
                            n: zeile.segments + geteilt.length,
                        })}`
                    }}</small>
                </div>
                <!-- Gelöscht (T54): lesend; zurück holt ihn der Verlauf. -->
                <div v-if="strasse?.deleted" class="wegeditor__stand" :data-testid="`${kennung}-stand`">
                    <span>{{ t("wegeditor.stand.band") }}</span>
                    <AvmKnopf
                        v-if="verlauf && reiter !== 'verlauf'"
                        groesse="zeile"
                        :testid="`${kennung}-stand-verlauf`"
                        @click="reiter = 'verlauf'"
                    >
                        {{ t("wegeditor.fenster.reiter.verlauf") }}
                    </AvmKnopf>
                </div>
                <EntwurfKonflikt
                    v-if="konflikt && bearbeitung"
                    :bearbeitung="bearbeitung"
                    :konflikt="konflikt"
                    :feld-name="teilName"
                    :kennung="kennung"
                />
                <!-- „Auswahl zu neuem Weg“ für die mit der Leiste gewählten Abschnitte (aus dem Kartenmenü, WI-0252). -->
                <WegNeuerWegFrage
                    v-if="neuerWegOffen && schreibeNeuenWeg"
                    :kennung="kennung"
                    :auswahl="auswahlAbschnitte"
                    :gesperrt="ungespeichert ? t('verlauf.gesperrtBearbeitung') : undefined"
                    :schreibe="schreibeNeuenWeg"
                    @abbrechen="emit('neuerWegAbbrechen')"
                />
                <FensterReiter
                    v-model="reiter"
                    :reiter="reiterListe"
                    :beschriftung="t('wegeditor.fenster.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-${reiter}`"
                    class="wegeditor__rumpf"
                    role="tabpanel"
                    :data-testid="`${kennung}-eigenschaften`"
                >
                    <p v-if="strassenFehler" class="wegeditor__leise">{{ strassenFehler }}</p>
                    <p v-else-if="!strasse" class="wegeditor__leise">{{ t("wegeditor.fenster.strasseLaedt") }}</p>
                    <TraegerKarten v-else-if="reiter === 'karten'" :karten="karten" :kennung="kennung" />
                    <TraegerQuellen
                        v-else-if="reiter === 'quellen'"
                        :id="strasse.id"
                        kind="path"
                        :recht="quellenRecht === true"
                        :schreibt="schreibt"
                        :kennung="kennung"
                        @zahl="(n: number) => (quellenZahl = n)"
                        @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                    />
                    <EntwurfVerlauf
                        v-else-if="reiter === 'verlauf' && verlauf"
                        :key="verlaufSchluessel"
                        :verlauf="verlauf"
                        :kennung="kennung"
                        :feld-name="verlaufFeldName"
                        :wert="verlaufWert"
                        :quellen="{
                            ziel: { kind: 'path', id: strasse.id, ids: strasse.segments.map((a) => a.id) },
                            recht: quellenRecht === true,
                            schreibt,
                        }"
                    />
                    <template v-else>
                        <section class="wegeditor__abschnitt">
                            <h4 class="wegeditor__titel">{{ t("kraftlinieneditor.abschnitt.identitaet") }}</h4>
                            <div class="wegeditor__felder">
                                <WikiFeld
                                    :name="t('wegeditor.fenster.feld.name')"
                                    :lage="lageVon('name')"
                                    :anteil="anteil"
                                    :testid="`${kennung}-zeile-name`"
                                    @zurueck="aufWiki('name')"
                                >
                                    <AvmEingabe
                                        v-if="schreibt && stand"
                                        :model-value="stand.felder.name"
                                        :aria-label="t('wegeditor.fenster.feld.name')"
                                        :testid="`${kennung}-feld-name`"
                                        @update:model-value="setzeName"
                                        @blur="bearbeitung?.feldVerlassen()"
                                    />
                                    <span v-else class="wegeditor__wertzeile">{{ zeileVon(zeile).name }}</span>
                                </WikiFeld>
                                <WikiFeld
                                    :name="t('wegeditor.fenster.feld.wegtyp')"
                                    :lage="lageVon('subtype')"
                                    :ohne-zuordnung="ohneZuordnung('subtype')"
                                    :testid="`${kennung}-zeile-wegtyp`"
                                    @zurueck="aufWiki('subtype')"
                                >
                                    <AvmAuswahl
                                        v-if="schreibt && stand && wegartWaehlbarFuer(strasse)"
                                        :model-value="stand.felder.subtype"
                                        :optionen="wegarten"
                                        :aria-label="t('wegeditor.fenster.feld.wegtyp')"
                                        :testid="`${kennung}-feld-wegart`"
                                        @update:model-value="setzeWegart"
                                    />
                                    <span v-else class="wegeditor__wertzeile">{{ art }}</span>
                                </WikiFeld>
                                <WikiFeld
                                    :name="t('wegeditor.fenster.feld.kennzeichen')"
                                    :lage="lageVon('mark')"
                                    :ohne-zuordnung="ohneZuordnung('mark')"
                                    :testid="`${kennung}-zeile-kennzeichen`"
                                    @zurueck="aufWiki('mark')"
                                >
                                    <span class="wegeditor__wertzeile" :data-testid="`${kennung}-feld-kennzeichen`">
                                        <AvmKaestchen
                                            v-if="schreibt && stand && nurLandwege(strasse)"
                                            art="checkbox"
                                            :checked="karawanenroute"
                                            :testid="`${kennung}-feld-karawanenroute`"
                                            @change="setzeKarawanenroute"
                                        >
                                            {{ t("wegeditor.art.karawanenroute") }}
                                        </AvmKaestchen>
                                        <template v-else>{{
                                            karawanenroute ? t("wegeditor.art.karawanenroute") : t("editorListe.nein")
                                        }}</template>
                                        <span
                                            v-if="kennzeichenTeils"
                                            class="wegeditor__satz"
                                            :data-testid="`${kennung}-kennzeichen-teils`"
                                            >{{ kennzeichenTeils }}</span
                                        >
                                        <span v-if="karawanenroute" class="wegeditor__satz">{{
                                            t("wegeditor.fenster.karawanenrouteSatz")
                                        }}</span>
                                    </span>
                                </WikiFeld>
                                <!-- Stage-Fund des Betreibers 2026-11-09 (Tunnel: „da sollte eigentlich "ja" stehen“): Neben einem
                                     Ja-Nein-Haken steht immer „ja“. Angehakt heißt ja, leer heißt nein; „☐ nein“ las sich, als hake man
                                     „nein“ an. Gemischt steht daneben als Satz. Ohne Schreibrecht bleibt der Wert als Text. -->
                                <WikiFeld :name="t('wegeditor.fenster.feld.nameAufKarte')" :lage="OHNE_WIKI">
                                    <span
                                        v-if="schreibt && stand"
                                        class="wegeditor__wertzeile"
                                        :data-testid="`${kennung}-feld-name-auf-karte-zeile`"
                                    >
                                        <AvmKaestchen
                                            art="checkbox"
                                            :checked="stand.felder.labelVisible === true"
                                            :testid="`${kennung}-feld-name-auf-karte`"
                                            @change="setzeNameAufKarte"
                                        >
                                            {{ t("editorListe.ja") }}
                                        </AvmKaestchen>
                                        <span v-if="stand.felder.labelVisible === null" class="wegeditor__satz">{{
                                            t("wegeditor.fenster.gemischt", { arten: nameAufKarte })
                                        }}</span>
                                    </span>
                                    <span v-else class="wegeditor__wertzeile">{{ nameAufKarte }}</span>
                                </WikiFeld>
                                <WikiFeld :name="t('wegeditor.fenster.feld.tunnel')" :lage="OHNE_WIKI">
                                    <!-- Betreiber 2026-11-09 (wählte „unten nur bei Auswahl“, dazu wörtlich: „aber ich will dann, dass er
                                         oben nicht anklickbar ist sondern gelistet wird welche abschnitte getunnelt sind“): oben kein Haken,
                                         nur die Abschnitte im Tunnel. Ihre Nummern sind Verweise (Design Guide P8) und wählen genau diesen
                                         Abschnitt; gesetzt wird der Tunnel in der Tafel darunter. Ein Weg aus einem Abschnitt sagt ja oder nein. -->
                                    <span class="wegeditor__wertzeile" :data-testid="`${kennung}-feld-tunnel`">
                                        <template v-if="strasse.segments.length <= 1">{{
                                            tunnelAn > 0 ? t("editorListe.ja") : t("editorListe.nein")
                                        }}</template>
                                        <template v-else-if="tunnelAn === 0">{{
                                            t("wegeditor.fenster.tunnelKeiner")
                                        }}</template>
                                        <template v-else-if="tunnelAn === strasse.segments.length">{{
                                            t("wegeditor.fenster.tunnelAlle")
                                        }}</template>
                                        <template v-else>
                                            {{
                                                tunnelAn === 1
                                                    ? t("wegeditor.fenster.tunnelAbschnitt")
                                                    : t("wegeditor.fenster.tunnelAbschnitte")
                                            }}
                                            <template v-for="(nr, i) in tunnelNummern" :key="nr.id"
                                                >{{ i > 0 ? ", " : ""
                                                }}<button
                                                    v-if="!strasse.offMap && !strasse.deleted"
                                                    type="button"
                                                    class="wegeditor__verweis wegeditor__verweis--wert"
                                                    :title="
                                                        t('wegeditor.fenster.tunnelNummer', {
                                                            n: formatNumber(nr.n, 0),
                                                        })
                                                    "
                                                    :data-testid="`${kennung}-feld-tunnel-${nr.n}`"
                                                    @click="waehleNur(nr.id)"
                                                >
                                                    {{ formatNumber(nr.n, 0) }}</button
                                                ><template v-else>{{ formatNumber(nr.n, 0) }}</template></template
                                            >
                                        </template>
                                        <span v-if="tunnelAn > 0" class="wegeditor__satz">{{
                                            t("wegeditor.fenster.tunnelSatz")
                                        }}</span>
                                        <span
                                            v-if="
                                                schreibt &&
                                                stand &&
                                                wahl === null &&
                                                strasse.segments.length > 1 &&
                                                !strasse.offMap &&
                                                !strasse.deleted
                                            "
                                            class="wegeditor__satz"
                                            :data-testid="`${kennung}-feld-tunnel-wo`"
                                            >{{ t("wegeditor.fenster.tunnelWo") }}</span
                                        >
                                    </span>
                                </WikiFeld>
                            </div>
                        </section>
                        <section class="wegeditor__abschnitt" :data-testid="`${kennung}-abschnitte`">
                            <div class="wegeditor__kastenkopf">
                                <h4 class="wegeditor__titel">
                                    {{
                                        t("wegeditor.fenster.abschnitte", {
                                            n: formatNumber(abschnittZahl, 0),
                                        })
                                    }}
                                </h4>
                                <button
                                    v-if="!strasse.offMap && !strasse.deleted && rahmenDerWahl !== undefined"
                                    type="button"
                                    class="wegeditor__zeigen"
                                    :data-testid="`${kennung}-zeigen`"
                                    @click="emit('fliege', rahmenDerWahl)"
                                >
                                    {{ t("kraftlinieneditor.nodices.zeigen") }}
                                </button>
                            </div>
                            <p v-if="strasse.offMap" class="wegeditor__leise">
                                {{ t("wegeditor.fenster.nichtAufKarte") }}
                            </p>
                            <template v-if="strasse.segments.length > 1 && !strasse.offMap && !strasse.deleted">
                                <div
                                    class="wegeditor__wahl"
                                    role="group"
                                    :aria-label="t('wegeditor.fenster.wahl.gruppe')"
                                    :data-testid="`${kennung}-wahl`"
                                >
                                    <button
                                        type="button"
                                        class="wegeditor__nummer wegeditor__nummer--ganz"
                                        :aria-pressed="wahl === null"
                                        :title="
                                            t('wegeditor.fenster.wahl.ganz', {
                                                n: formatNumber(strasse.segments.length, 0),
                                            })
                                        "
                                        :data-testid="`${kennung}-wahl-ganz`"
                                        @click="emit('ganzerWeg')"
                                    >
                                        {{ t("wegeditor.fenster.wahl.kurz") }}
                                    </button>
                                    <button
                                        v-for="(abschnitt, i) in strasse.segments"
                                        :key="abschnitt.id"
                                        type="button"
                                        class="wegeditor__nummer"
                                        :class="{ 'wegeditor__nummer--leuchtet': leuchtet.has(abschnitt.id) }"
                                        :aria-pressed="wahl === null || wahl.has(abschnitt.id)"
                                        :data-abschnitt="abschnitt.id"
                                        :title="t('wegeditor.fenster.wahl.nummer', { n: formatNumber(i + 1, 0) })"
                                        :data-testid="`${kennung}-wahl-${i + 1}`"
                                        @click="emit('nummer', abschnitt.id)"
                                    >
                                        {{ formatNumber(i + 1, 0) }}
                                    </button>
                                </div>
                                <!-- Ein Teil der Abschnitte gewählt: „Auswahl zu neuem Weg …“ (WI-0252), wie in der Sammelansicht. -->
                                <div
                                    v-if="auswahlAbschnitte && !neuerWegOffen && schreibt"
                                    class="wegeditor__auswahlknoepfe"
                                >
                                    <AvmKnopf
                                        groesse="zeile"
                                        :gesperrt="neuerWegSperre"
                                        :title="t('wegeditor.neuerWeg.tooltip')"
                                        :testid="`${kennung}-neuer-weg-knopf`"
                                        @click="emit('neuerWeg')"
                                    >
                                        <template #zeichen><EditorZeichen name="neuer-weg" /></template>
                                        {{ t("wegeditor.griff.neuerWeg") }}
                                    </AvmKnopf>
                                </div>
                            </template>
                            <!-- Die geteilten Abschnitte anderer Straßen (WI-0302): gestrichelt, nur lesend, mit ihrer Herkunft; ein Klick öffnet ihre Straße. -->
                            <div
                                v-if="geteilt.length > 0 && !strasse.offMap && !strasse.deleted"
                                class="wegeditor__geteilt"
                                :data-testid="`${kennung}-geteilt`"
                            >
                                <p class="wegeditor__geteilt-kopf">{{ t("wegeditor.geteilt.kopf") }}</p>
                                <span
                                    v-for="g in geteilt"
                                    :key="g.id"
                                    class="wegeditor__geteilt-eintrag"
                                    :data-abschnitt="g.id"
                                    :data-testid="`${kennung}-geteilt-eintrag`"
                                >
                                    <button
                                        v-if="kannOeffnen(g)"
                                        type="button"
                                        class="wegeditor__geteilt-pille"
                                        :title="t('wegeditor.geteilt.oeffnen', { strasse: g.strasse })"
                                        :data-testid="`${kennung}-geteilt-oeffnen`"
                                        @click="emit('strasse', g.strasseId, g.id)"
                                    >
                                        {{ geteiltStrecke(g) }}
                                    </button>
                                    <span v-else class="wegeditor__geteilt-pille wegeditor__geteilt-pille--still">{{
                                        geteiltStrecke(g)
                                    }}</span>
                                    <span class="wegeditor__geteilt-satz"
                                        >{{
                                            t("wegeditor.geteilt.satz", {
                                                strasse: g.strasse,
                                                n: formatNumber(g.nummer, 0),
                                            })
                                        }}<template v-if="!kannOeffnen(g)">
                                            · {{ t("wegeditor.geteilt.dort", { strasse: g.strasse }) }}</template
                                        ></span
                                    >
                                </span>
                            </div>
                            <!-- „Weg entfernen …“ (OPS-000085): auch bei einem einzigen Abschnitt, wo keine Leiste steht; dasselbe Blatt wie Karte und Menü. -->
                            <div v-if="!strasse.offMap && !strasse.deleted" class="wegeditor__auswahlknoepfe">
                                <AvmKnopf
                                    groesse="zeile"
                                    art="gefahr"
                                    :gesperrt="entfernenSperre"
                                    :testid="`${kennung}-weg-entfernen`"
                                    @click="entferneWeg"
                                >
                                    <template #zeichen><EditorZeichen name="loeschen" /></template>
                                    {{ t("wegeditor.griff.entfernen") }}
                                </AvmKnopf>
                            </div>
                            <WegTafel
                                v-if="!strasse.offMap && !strasse.deleted"
                                :strasse="strasseImEntwurf ?? strasse"
                                :gewaehlt="gewaehlteIds"
                                :alle="wahl === null && strasse.segments.length > 1"
                                :schreibt="schreibt && stand !== undefined"
                                :tunnel-von="tunnelVon"
                                :art-name="artName"
                                :weitere-gelesen="weitereGelesen"
                                :flussnetz="flussnetz.lage"
                                :kurve-im-entwurf="stand?.form !== undefined"
                                :nummern-text="bereicheText"
                                :kennung="kennung"
                                @tunnel="(an: boolean) => gewaehlteIds.forEach((id) => setzeTunnel(id, an))"
                                @mittel="setzeMittel"
                                @fenster="setzeFenster"
                                @wegtyp="setzeWegartTeil"
                                @richtung="setzeRichtung"
                                @umkehren="kehreRichtungUm"
                                @richtung-alle="uebernimmRichtung"
                                @weiterer-dazu="gibWeiteren"
                                @weiterer-weg="loeseWeiteren"
                                @alle="uebernimm"
                            />
                            <!-- Abseits der Karte (genommen, gelöscht) stehen die Abschnitte als Zeilen, mit „Zurück auf die Karte“. -->
                            <ol v-else class="wegeditor__kette">
                                <li
                                    v-for="(abschnitt, i) in strasse.segments"
                                    :key="abschnitt.id"
                                    class="wegeditor__kante"
                                    :data-abschnitt="abschnitt.id"
                                >
                                    <span>{{ t("wegeditor.fenster.abschnitt", { n: formatNumber(i + 1, 0) }) }}</span>
                                    <span class="wegeditor__wert">{{
                                        abschnitt.subtype === undefined
                                            ? t("wegeditor.fenster.stuetzpunkte", {
                                                  n: formatNumber(abschnitt.points, 0),
                                              })
                                            : `${artName(abschnitt.subtype)} · ${t("wegeditor.fenster.stuetzpunkte", {
                                                  n: formatNumber(abschnitt.points, 0),
                                              })}`
                                    }}</span>
                                    <span class="wegeditor__wert">{{ abschnitt.wiki ? "✓ Wiki" : "" }}</span>
                                    <AvmKaestchen
                                        v-if="schreibt && stand"
                                        art="checkbox"
                                        :checked="tunnelVon(abschnitt)"
                                        :hinweis="t('wegeditor.fenster.tunnelHinweis', { n: formatNumber(i + 1, 0) })"
                                        :testid="`${kennung}-tunnel-${i}`"
                                        @change="(an) => setzeTunnel(abschnitt.id, an)"
                                    >
                                        {{ t("wegeditor.fenster.feld.tunnel") }}
                                    </AvmKaestchen>
                                    <span v-else class="wegeditor__wert">{{
                                        abschnitt.tunnel ? t("wegeditor.fenster.feld.tunnel") : ""
                                    }}</span>
                                    <button
                                        v-if="strasse.offMap && zurueck"
                                        type="button"
                                        class="wegeditor__zeigen"
                                        :aria-label="t('wegeditor.fenster.zurueckAria', { n: formatNumber(i + 1, 0) })"
                                        :data-testid="`${kennung}-zurueck-${i}`"
                                        @click="
                                            zurueck(
                                                { id: abschnitt.id, revision: abschnitt.revision },
                                                zeileVon(zeile).name,
                                            )
                                        "
                                    >
                                        {{ t("wegeditor.fenster.zurueck") }}
                                    </button>
                                </li>
                            </ol>
                        </section>
                        <section class="wegeditor__abschnitt">
                            <WikiBox
                                :id="strasse.id"
                                art="weg"
                                :recht="schreibt ? 'schreiben' : 'lesen'"
                                :ungespeichert="wikiBoxUngespeichert"
                                :felder="wikiBoxFelder"
                                :lesestand="wikiBoxLesestand"
                                :kennung="kennung"
                                @geaendert="wikiGeaendert"
                                @an-alle="wikiAnAlle"
                                @assistent="assistentOffen = true"
                            />
                        </section>
                    </template>
                </div>
            </template>
        </FensterSpalte>
        <template v-if="bearbeitung" #fuss-hinweis>
            <span v-if="meldungSatz" role="status" :data-testid="`${kennung}-meldung`">{{ meldungSatz }}</span>
            <EntwurfFuss v-else :bearbeitung="bearbeitung" teil="hinweis" :testid="kennung" />
        </template>
        <template v-if="bearbeitung" #fuss-haupt>
            <EntwurfFuss :bearbeitung="bearbeitung" teil="haupt" :testid="kennung" />
        </template>
    </AvmFenster>
    <StrassenAssistentFenster
        v-if="assistentOffen && strasse && schreibt"
        :anker="strasse.id"
        :kennung="kennung"
        :schreibt="schreibt"
        @schliessen="assistentOffen = false"
        @zeige="assistentZeige"
        @geaendert="assistentGeaendert"
    />
</template>

<style scoped>
.wegeditor__name {
    display: grid;
    gap: var(--space-2);
}

.wegeditor__name strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.wegeditor__name small,
.wegeditor__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegeditor__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

/* Das Band „Gelöscht“ (T54), wie der Stand im Kraftlinienfenster. */
.wegeditor__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

/* Wie die Abschnitte des Landschaftseditors (`landschaftseditor-fenster.vue`), bis O3 sie in einen Baustein zieht. */
.wegeditor__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wegeditor__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wegeditor__felder {
    display: grid;
    gap: var(--space-6);
}

/* Was mit den gewählten Abschnitten geht (WI-0252): unter der Leiste, rechtsbündig wie „Zeigen“. */
.wegeditor__auswahlknoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

.wegeditor__wertzeile {
    display: block;
    min-width: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

/* Titel des Kastens links, „Zeigen“ für die Wahl rechts. */
.wegeditor__kastenkopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
}

.wegeditor__kette {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Abseits der Karte ein Abschnitt je Zeile: Nummer, Stützpunkte, Wiki, Tunnel, Zurück (Spalten bündig über alle Zeilen). */
.wegeditor__kante {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto auto;
    align-items: baseline;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegeditor__wert {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* Die Leiste (W) (1) (2) …: runde Nummern wie die Kreise auf der Karte; gedrückt mit dem Saum der Akzentfarbe (P6 Variante C). */
.wegeditor__wahl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.wegeditor__nummer {
    box-sizing: border-box;
    min-width: var(--space-24);
    height: var(--space-24);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-strong);
    border-radius: calc(var(--space-24) / 2);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}

.wegeditor__nummer--ganz {
    font-weight: 600;
}

.wegeditor__nummer[aria-pressed="true"] {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
}

.wegeditor__nummer:hover {
    background: var(--color-hover-wash);
}

.wegeditor__nummer:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Kurz aufleuchtend (OPS-000112): Diese Abschnitte hat „auf alle übernehmen“ geändert. Ohne Bewegung steht der Ring und geht dann weg. */
.wegeditor__nummer--leuchtet {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 var(--focus-ring-width) var(--color-accent);
    animation: wegeditor-leuchten 1.2s ease-out forwards;
}

@keyframes wegeditor-leuchten {
    0%,
    55% {
        box-shadow: 0 0 0 var(--focus-ring-width) var(--color-accent);
    }
    100% {
        box-shadow: 0 0 0 var(--focus-ring-width) transparent;
    }
}

@media (prefers-reduced-motion: reduce) {
    .wegeditor__nummer--leuchtet {
        animation: none;
    }
}

/* Die geteilten Abschnitte (WI-0302): nach den eigenen Nummern, gestrichelt und gedämpft wie ein fremder Abschnitt, mit ihrer Herkunft. */
.wegeditor__geteilt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    min-width: 0;
}

.wegeditor__geteilt-kopf,
.wegeditor__geteilt-satz {
    margin: 0;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegeditor__geteilt-eintrag {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    min-width: 0;
}

.wegeditor__geteilt-pille {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    height: var(--space-24);
    padding: 0 var(--space-8);
    border: 1px dashed var(--color-border-strong);
    border-radius: calc(var(--space-24) / 2);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
}

button.wegeditor__geteilt-pille {
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

button.wegeditor__geteilt-pille:hover {
    border-color: var(--color-accent);
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

button.wegeditor__geteilt-pille:active {
    background: var(--color-active-wash);
}

button.wegeditor__geteilt-pille:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    button.wegeditor__geteilt-pille {
        transition: none;
    }
}

/* „kein Zugang querfeldein“ unter „an n von m“. */
.wegeditor__satz {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegeditor__abschnitt a {
    color: var(--color-link);
}

.wegeditor__zeigen,
.wegeditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

/* Eine Abschnittsnummer im Wert (Tunnel): so groß wie der Wert, nicht wie „Zeigen“. */
.wegeditor__verweis--wert {
    font-size: inherit;
}

.wegeditor__zeigen:hover,
.wegeditor__verweis:hover {
    color: var(--color-link-hover);
}

.wegeditor__zeigen:focus-visible,
.wegeditor__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* « » wie im Landschaftseditor (`.landschaftseditor__listenschalter`), bis O3 ihn in einen Baustein zieht. */
.wegeditor__listenschalter {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-subhead);
    line-height: 1;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.wegeditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.wegeditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.wegeditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
