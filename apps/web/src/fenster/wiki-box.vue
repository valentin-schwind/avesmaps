<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { WikiBoxArt, WikiBoxLetzter, WikiBoxStand, WikiBoxWeiterer, WikiTreffer } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import { formatList, formatNumber, locale, t, tPlural, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import FensterFeldzeilen from "./fenster-feldzeilen.vue";
import { createWikiBoxDaten } from "./wiki-box-daten";
import { hoereWikiSyncMeldung } from "../wikisync/wikisync-melde";
import { betrifftWikiBox, wikiBoxMeldung } from "./wiki-box-melde";
import { trefferZeile } from "./wiki-treffer";
import {
    NACHFRAGE_HOECHSTENS_MS,
    NACHFRAGE_MS,
    eigene,
    feldNamenZu,
    schluesselText,
    standZeile,
    veraltete,
    wikiBoxLage,
    type SchreibErgebnis,
    type WikiBoxDaten,
    type WikiBoxFeld,
    type WikiBoxSperrGrund,
} from "./wiki-box";

/**
 * Die Wiki-Box (WI-0253, Scheibe „Objekt-Sync am WikiFeld“; Entwurf `review/wi-0253/wikifeld-sync-mockup.html`, abgenommen vom Betreiber 2026-10-25: „perfekt das wollen wir“): EIN Kasten „Wiki“ in
 * jedem Objektfenster mit Wiki-Feldern (Ort, Weg, Herrschaftsgebiet, Landschaft, Kraftlinie, Gipfel). Kein Editor baut seine eigene Wiki-Zeile oder Artikelzuordnung (Prüftest `wiki-box-einzig.test.ts`);
 * die Wiki-FELDER bleiben `WikiFeld` (WI-0225), die Box ist die Zuordnung dazu.
 *
 * - **Inhalt:** Artikel (als Verweis ins Wiki), Schlüssel, der Stand des Syncs (Kreis · Satz, darunter Zeit, Ergebnis und wer: eine Person oder „automatisch“), die drei Knöpfe rechts neben dem Titel:
 *   Zuweisen bzw. Ändern · Sync aktualisieren · Entfernen. Ein Satz sagt, dass Zuweisen und Entfernen sofort wirken, ohne „Speichern“.
 * - **Zuweisen und Entfernen wirken auf dem Server, nicht im Entwurf.** Darum sperren alle drei Knöpfe, solange das Formular ungespeicherte Änderungen hat (EIN Satz nennt den Grund für die Gruppe, `grundBei`).
 *   „Entfernen“ fragt nach; die Felder behalten ihre Werte als eigene. „Zuweisen“ öffnet die Artikelsuche; ein Treffer weist zu, danach folgt der Sync als Auftrag.
 * - **Der Sync ist ein Auftrag** (eine Wiki-Anfrage im 20-Sekunden-Takt): Der Klick wartet nicht; die Box fragt alle drei Sekunden nach, bis er fertig ist, und meldet dann `geaendert`, damit das Fenster
 *   das Objekt neu liest. Bei einer Drosselung (429) heißt der Knopf „Später erneut“ und ist bis zur genannten Zeit gesperrt. Lokal gibt es keinen Abruf (409): Die Box nennt den Grund; Zuweisen und Entfernen wirken trotzdem.
 * - **Ohne Schreibrecht** (`recht`) stehen nur Artikel und Schlüssel und ein Satz, keine Knöpfe.
 * - **Zeilen des Fensters** (Slot `zeilen`, dt/dd): was zum Artikel gehört und im Fenster sonst keinen Platz hat, etwa der Wiki-Typ eines Herrschaftsgebiets; sie stehen unter dem Schlüssel.
 * - **Weitere Artikel (WI-0300, OPS-000108; seit WI-0302 nur Anzeige):** Ein Weg trägt neben dem Hauptartikel weitere Wiki-Artikel (etwa ein Pilgerweg über einer Reichsstraße). Die Zeile „Weitere Artikel“ listet
 *   sie mit Link ins Wiki und Anteil („an 3 von 27 Abschnitten“); geändert werden sie je Abschnitt im Wegeditor, im Feld „Weitere Straßennamen“ (`wegeditor/weg-weitere.vue`, mit „Fertig“), das sagt ein leiser Satz.
 * - **An alle Abschnitte** (OPS-000112, Entwurf Fassung 2, Vali 2026-11-11 „ja bauen“): Hängt der Hauptartikel eines Wegs nur an einem Teil der Abschnitte
 *   („Artikel an 8 von 10 Abschnitten“), hängt ihn dieser Knopf an alle. Er weist denselben Artikel noch einmal zu (der Server gibt ihn allen Abschnitten der
 *   Straße), wirkt sofort wie „Zuweisen“ und sperrt aus denselben Gründen. Das Fenster erfährt es (`anAlle`) und zeigt, welche Abschnitte dazukamen.
 * - Die Rechnung (Sperren, Stand, Änderungen) steht in `wiki-box.ts`, die Daten kommen über den Port `WikiBoxDaten` (`wiki-box-daten.ts`).
 */
defineOptions({ name: "WikiBox" });

const props = defineProps<{
    art: WikiBoxArt;
    /** Die Kennung des Objekts, wie das Fenster sie kennt (Weg: ein Abschnitt der Straße, Kraftlinie: ein Abschnitt der Linie). */
    id: string;
    /** `schreiben`: Schreibrecht und Bearbeiten an · `lesen`: nur lesend (die Rolle reicht nicht, oder Bearbeiten ist ausgeschaltet): Artikel und Schlüssel, keine Knöpfe. */
    recht: "schreiben" | "lesen";
    /** Das Formular hat ungespeicherte Änderungen: Alle drei Knöpfe sperren. */
    ungespeichert: boolean;
    /** Die Felder des Objekts mit Wiki-Wert, für den Stand und die Zeile „Mit dem Sync ändern sich …“. */
    felder: readonly WikiBoxFeld[];
    /** Ändert sich, wenn das Fenster das Objekt neu gelesen hat (etwa die Revision): Dann liest die Box ihren Stand neu. */
    lesestand?: string | number | undefined;
    kennung: string;
    daten?: WikiBoxDaten | undefined;
    /** Jetzt in Unix-Millisekunden; nur Tests geben sie vor. */
    jetzt?: (() => number) | undefined;
}>();
const emit = defineEmits<{
    /** Zuweisen, Entfernen oder ein Sync hat die Karte geändert; das Fenster liest das Objekt neu (die Kachelrevision, wo bekannt). */
    geaendert: [mapRevision: number | undefined];
    /** „An alle Abschnitte“ hängte den Artikel an alle Abschnitte des Wegs (vor `geaendert`); mit dem Titel des Artikels. */
    anAlle: [name: string];
    /** „Straßen-Assistent“ (WI-0310): das Fenster des Wegeditors öffnen. Die Box ändert dabei nichts. */
    assistent: [];
}>();

const daten = props.daten ?? createWikiBoxDaten();
const uhr = (): number => props.jetzt?.() ?? Date.now();

const stand = shallowRef<WikiBoxStand | undefined>(undefined);
const ladefehler = ref(false);
const beschaeftigt = ref(false);
const meldung = ref<string | undefined>(undefined);
const frage = ref(false);
const sucheOffen = ref(false);
const suche = ref("");
const treffer = shallowRef<readonly WikiTreffer[]>([]);
const sucheLaedt = ref(false);
const sucheFehler = ref(false);
/** Der Artikel wurde in dieser Sitzung zugewiesen („gerade verknüpft“). */
const neu = ref(false);
/** Ein Sync ist vor den Augen dieses Fensters fertig geworden („Gerade gesynct“). */
const gerade = ref(false);

const grundId = `${props.kennung}-wiki-grund`;
const standId = `${props.kennung}-wiki-stand`;
const fehlerId = `${props.kennung}-wiki-fehler`;
const syncGrundId = `${props.kennung}-wiki-sync-grund`;

const lage = computed(() =>
    wikiBoxLage({
        darf: props.recht === "schreiben",
        ungespeichert: props.ungespeichert,
        beschaeftigt: beschaeftigt.value,
        stand: stand.value,
        jetzt: uhr(),
    }),
);
const hatArtikel = computed(() => stand.value?.artikel != null);

// ── Lesen und Nachfragen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

let abfrage: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let nachgefragtSeit: number | undefined;

function planeNachfrage(): void {
    clearTimeout(timer);
    if (stand.value?.sync.laeuft !== true) {
        nachgefragtSeit = undefined;
        return;
    }
    nachgefragtSeit ??= uhr();
    if (uhr() - nachgefragtSeit > NACHFRAGE_HOECHSTENS_MS) return;
    timer = setTimeout(() => void lade(), NACHFRAGE_MS);
}

async function lade(): Promise<void> {
    abfrage?.abort();
    const steuer = new AbortController();
    abfrage = steuer;
    const vorher = stand.value;
    try {
        const neuerStand = await daten.stand(props.art, props.id, steuer.signal);
        if (abfrage !== steuer) return;
        stand.value = neuerStand ?? undefined;
        ladefehler.value = neuerStand === null;
        // Ein Sync, der eben noch lief und jetzt fertig ist: Das Fenster liest das Objekt neu, wenn er etwas geschrieben hat.
        if (vorher?.sync.laeuft === true && neuerStand?.sync.laeuft === false) {
            gerade.value = true;
            const ergebnis = neuerStand.sync.letzter?.ergebnis;
            if (ergebnis === "uebernommen" || ergebnis === "stand") emit("geaendert", undefined);
        }
    } catch {
        if (abfrage === steuer && !steuer.signal.aborted) ladefehler.value = true;
    }
    if (abfrage === steuer) planeNachfrage();
}

watch(
    () => [props.art, props.id] as const,
    () => {
        frage.value = false;
        sucheOffen.value = false;
        suche.value = "";
        meldung.value = undefined;
        neu.value = false;
        gerade.value = false;
        stand.value = undefined;
        void lade();
    },
    { immediate: true },
);
watch(
    () => props.lesestand,
    () => void lade(),
);
// Der Reiter „Änderungen“ nahm das Zuweisen oder Entfernen zurück (WI-0265 B8d): Stand neu lesen; das Fenster liest das Objekt neu, außer es hat einen Entwurf (dann ist das nächste Speichern ein Konflikt).
watch(wikiBoxMeldung, (gemeldet) => {
    if (gemeldet === undefined || !betrifftWikiBox(gemeldet, props.art, props.id)) return;
    neu.value = false;
    void lade();
    if (!props.ungespeichert) emit("geaendert", undefined);
});
// „Änderungen“ nahm den Sync eines Objekts zurück (WI-0265 B8e): Das ist ein Auftrag und schreibt erst, wenn er läuft. Die Box liest danach noch zweimal nach (das Objekt auch, außer es hat einen Entwurf);
// die Rücknahmen anderer WikiSync-Läufe schreiben nicht an diesem Objekt, kosten aber höchstens zwei Lesevorgänge.
const NACH_RUECKNAHME_MS: readonly number[] = [3000, 12000];
let nachRuecknahme: ReturnType<typeof setTimeout>[] = [];
const abmeldenWikiSync = hoereWikiSyncMeldung(() => {
    for (const eines of nachRuecknahme) clearTimeout(eines);
    nachRuecknahme = NACH_RUECKNAHME_MS.map((ms) =>
        setTimeout(() => {
            void lade();
            if (!props.ungespeichert) emit("geaendert", undefined);
        }, ms),
    );
});
onBeforeUnmount(() => {
    abfrage?.abort();
    clearTimeout(timer);
    sucheAbbruch?.abort();
    clearTimeout(sucheTimer);
    abmeldenWikiSync();
    for (const eines of nachRuecknahme) clearTimeout(eines);
});

// ── Sätze ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const zeitText = (wert: Date): string => relativeTime(wert, new Date(uhr()), locale.value, "zeitpunkt");

function grundText(grund: WikiBoxSperrGrund): string {
    switch (grund.art) {
        case "ungespeichert":
            return t("wikiBox.grund.ungespeichert");
        case "beschaeftigt":
            return t("wikiBox.grund.beschaeftigt");
        case "laeuft":
            return t("wikiBox.grund.laeuft");
        case "drossel":
            return t("wikiBox.grund.drossel", { zeit: zeitText(grund.bis) });
        case "sync":
            return t(`wikiBox.grund.${grund.grund}` as MessageKey);
    }
}

/** Der Satz für die ganze Gruppe der Knöpfe (ungespeichert, wird gesendet). */
const gruppenGrund = computed(() => {
    const grund = lage.value.zuweisen;
    return grund !== undefined && (grund.art === "ungespeichert" || grund.art === "beschaeftigt")
        ? grundText(grund)
        : undefined;
});

/** Ein Sync-Grund, der nur den Sync-Knopf betrifft (kein Abruf, Legacy-Zug, Drosselung); mit einer Fehlermeldung darüber steht er schon dort. */
const syncGrundSatz = computed(() => {
    const grund = lage.value.sync;
    if (grund === undefined || grund.art === "ungespeichert" || grund.art === "beschaeftigt") return undefined;
    return grundText(grund);
});

function ergebnisText(letzter: WikiBoxLetzter): string {
    switch (letzter.ergebnis) {
        case "keine_aenderung":
            return t("wikiBox.ergebnis.keine");
        case "stand":
            return t("wikiBox.ergebnis.stand");
        case "uebernommen":
            return tPlural("wikiBox.ergebnis.uebernommen", letzter.anzahl, { n: letzter.anzahl });
        case "fehlgeschlagen":
            return t("wikiBox.antwort.allgemein");
    }
}

const letzterZeile = computed(() => {
    const letzter = stand.value?.sync.letzter;
    if (letzter === null || letzter === undefined) return undefined;
    const wer =
        letzter.automatisch || letzter.wer === null
            ? t("wikiBox.letzter.automatisch")
            : t("wikiBox.letzter.von", { name: letzter.wer });
    return [
        gerade.value ? t("wikiBox.letzter.gerade") : t("wikiBox.letzter.zuletzt"),
        zeitText(new Date(letzter.am)),
        ergebnisText(letzter),
        wer,
    ].join(" · ");
});

/** Die Namen der Felder, die der letzte Sync übernommen hat (als Zettel an der Zeile). */
const letzterZettel = computed(() => {
    const letzter = stand.value?.sync.letzter;
    if (letzter?.ergebnis !== "uebernommen") return undefined;
    const namen = feldNamenZu(letzter.felder, props.felder);
    return namen.length === 0 ? undefined : t("wikiBox.letzter.felder", { felder: formatList(namen) });
});

const zeile = computed(() => standZeile(props.felder));
const artikelName = computed(() => stand.value?.artikel?.name ?? stand.value?.name ?? "");

/** Der Hinweis zum letzten Fehlschlag (der Grund steht nach dem Code; bei einer Drosselung mit Ende der Pause). */
const fehlerText = computed(() => {
    const fehler = stand.value?.sync.fehler;
    if (fehler === null || fehler === undefined || stand.value?.sync.laeuft === true) return undefined;
    const name = artikelName.value;
    switch (fehler.code) {
        case "http_429":
        case "http_403":
        case "pausiert":
            return fehler.freiAb === null
                ? t("wikiBox.fehler.antwort", { name })
                : t("wikiBox.fehler.drossel", { name, zeit: zeitText(new Date(fehler.freiAb)) });
        case "nicht_im_wiki":
        case "titel_ungueltig":
            return t("wikiBox.fehler.nicht_im_wiki", { name });
        case "gehoert_legacy":
            return t("wikiBox.fehler.gehoert_legacy", { name });
        case "kein_objekt":
            return t("wikiBox.fehler.kein_objekt");
        case "verbindung":
        case "http_fehler":
        case "antwort_ungueltig":
        case "api_fehler":
        case "belegt":
        case "takt_sperre":
            return t("wikiBox.fehler.antwort", { name });
        default:
            return t("wikiBox.fehler.allgemein", { name });
    }
});

/** Die Änderungen, die ein Sync brächte, je Feld „vorher → nachher“ (oder „Text geändert“). */
const aenderungen = computed(() =>
    veraltete(props.felder).map((feld) => ({
        id: feld.id,
        name: feld.name,
        mehrzeilig: feld.mehrzeilig === true,
        alt: (feld.eigen ?? "") === "" ? t("wikiFeld.leer") : (feld.eigen as string),
        neu: feld.lage.wikiText === null || feld.lage.wikiText === undefined ? t("wikiFeld.leer") : feld.lage.wikiText,
    })),
);
const eigeneFelder = computed(() => eigene(props.felder));
const eigeneText = computed(() => {
    const felder = eigeneFelder.value;
    if (felder.length === 0) return undefined;
    return tPlural("wikiBox.eigene", felder.length, { felder: formatList(felder.map((feld) => feld.name)) });
});

const satz = computed(() => (props.recht === "schreiben" ? t("wikiBox.sofort") : t("wikiBox.rolle")));

/** Der Satz zu einer Absage des Servers: bekannte Codes in der Sprache der Seite, sonst der Satz des Servers. */
function absage(ergebnis: Extract<SchreibErgebnis, { ok: false }>): string {
    const { code, message, details } = ergebnis.fehler;
    switch (code) {
        case "network_error":
            return t("wikiBox.antwort.keineVerbindung");
        case "abruf_gesperrt":
        case "gehoert_legacy":
        case "kein_stand":
        case "kein_artikel":
            return t(`wikiBox.grund.${code}` as MessageKey);
        case "sync_laeuft":
            return t("wikiBox.antwort.sync_laeuft");
        case "pausiert": {
            const frei = typeof details?.["freiAb"] === "string" ? new Date(details["freiAb"]) : undefined;
            return frei === undefined
                ? t("wikiBox.antwort.allgemein")
                : t("wikiBox.grund.drossel", { zeit: zeitText(frei) });
        }
        default:
            return message === "" ? t("wikiBox.antwort.allgemein") : message;
    }
}

// ── Handeln ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function senden(aktion: () => Promise<SchreibErgebnis>): Promise<SchreibErgebnis> {
    beschaeftigt.value = true;
    meldung.value = undefined;
    try {
        return await aktion();
    } finally {
        beschaeftigt.value = false;
    }
}

async function starteSync(): Promise<void> {
    const ergebnis = await senden(() => daten.sync(props.art, props.id));
    if (!ergebnis.ok) meldung.value = absage(ergebnis);
    gerade.value = false;
    await lade();
}

async function weiseZu(key: string, danach: () => void): Promise<void> {
    if (lage.value.zuweisen !== undefined) return;
    const ergebnis = await senden(() => daten.weise(props.art, props.id, key));
    if (!ergebnis.ok) {
        meldung.value = absage(ergebnis);
        return;
    }
    danach();
    emit("geaendert", ergebnis.quittung.mapRevision);
    await lade();
    // Nach dem Wählen folgt der Sync als Auftrag (Entwurf, Zustand 3), soweit die Umgebung es zulässt.
    if (stand.value?.sync.moeglich === true) await starteSync();
}

const weise = (tr: WikiTreffer): Promise<void> =>
    weiseZu(tr.key, () => {
        sucheOffen.value = false;
        suche.value = "";
        neu.value = true;
    });

/** „An alle Abschnitte“: nur am Weg, mit Artikel, der nicht an allen Abschnitten hängt. */
const anAlleKnopf = computed(
    () => props.art === "weg" && stand.value?.artikel != null && stand.value.anteil !== undefined,
);
/** „Straßen-Assistent“ (WI-0310): nur am Weg, auch ohne Artikel; gesperrt aus denselben Gründen wie „An alle Abschnitte“. */
const assistentKnopf = computed(() => props.art === "weg");
function weiseAnAlle(): void {
    const artikel = stand.value?.artikel;
    if (artikel == null) return;
    void weiseZu(artikel.key, () => emit("anAlle", artikel.name));
}

async function entferne(): Promise<void> {
    frage.value = false;
    const ergebnis = await senden(() => daten.entferne(props.art, props.id));
    if (!ergebnis.ok) {
        meldung.value = absage(ergebnis);
        await lade();
        return;
    }
    neu.value = false;
    gerade.value = false;
    emit("geaendert", ergebnis.quittung.mapRevision);
    await lade();
}

function zuweisenKlick(): void {
    if (lage.value.zuweisen !== undefined) return;
    frage.value = false;
    sucheOffen.value = !sucheOffen.value;
}

/** Der Anteil eines weiteren Artikels: an allen Abschnitten oder an n von m (WI-0302). */
const weitererAnteil = (w: WikiBoxWeiterer): string =>
    w.anteil === undefined
        ? t("wikiBox.weitere.alle")
        : t("wikiBox.weitere.anteil", { n: formatNumber(w.anteil.mit, 0), m: formatNumber(w.anteil.von, 0) });

function entfernenKlick(): void {
    if (lage.value.entfernen !== undefined) return;
    sucheOffen.value = false;
    frage.value = true;
}

// ── Die Artikelsuche ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

let sucheAbbruch: AbortController | undefined;
let sucheTimer: ReturnType<typeof setTimeout> | undefined;

async function frageNach(): Promise<void> {
    sucheAbbruch?.abort();
    const steuer = new AbortController();
    sucheAbbruch = steuer;
    sucheLaedt.value = true;
    sucheFehler.value = false;
    try {
        const gefunden = await daten.suche(props.art, props.id, suche.value, steuer.signal);
        if (sucheAbbruch === steuer) treffer.value = gefunden;
    } catch {
        if (sucheAbbruch === steuer && !steuer.signal.aborted) sucheFehler.value = true;
    } finally {
        if (sucheAbbruch === steuer) sucheLaedt.value = false;
    }
}

watch(sucheOffen, (offen) => {
    if (offen) void frageNach();
});
watch(suche, () => {
    if (!sucheOffen.value) return;
    clearTimeout(sucheTimer);
    sucheTimer = setTimeout(() => void frageNach(), 200);
});

const gleicherArtikel = (tr: WikiTreffer): boolean => stand.value?.artikel?.key === tr.key;

function escape(event: KeyboardEvent): void {
    if (!sucheOffen.value) return;
    event.stopPropagation();
    sucheOffen.value = false;
}
</script>

<template>
    <div class="wiki-box" :data-testid="`${kennung}-wiki-box`" :data-art="art">
        <div class="wiki-box__kopf">
            <h4 class="wiki-box__titel">{{ t("wikiBox.titel") }}</h4>
            <div v-if="lage.knoepfe && stand" class="wiki-box__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="lage.zuweisen === undefined ? undefined : grundText(lage.zuweisen)"
                    :grund-bei="gruppenGrund !== undefined ? grundId : standId"
                    :title="t('wikiBox.zuweisen.zettel')"
                    :aria-expanded="sucheOffen"
                    :testid="`${kennung}-wiki-zuweisen`"
                    @click="zuweisenKlick"
                >
                    <template #zeichen>{{ hatArtikel ? "⚙" : "✚" }}</template>
                    {{ hatArtikel ? t("wikiBox.aendern") : t("wikiBox.zuweisen") }}
                </AvmKnopf>
                <AvmKnopf
                    v-if="hatArtikel && lage.syncKnopf"
                    groesse="zeile"
                    :gesperrt="lage.sync === undefined ? undefined : grundText(lage.sync)"
                    :grund-bei="
                        gruppenGrund !== undefined ? grundId : fehlerText !== undefined ? fehlerId : syncGrundId
                    "
                    :title="t('wikiBox.sync.zettel')"
                    :testid="`${kennung}-wiki-sync`"
                    @click="starteSync"
                >
                    <template #zeichen>⇄</template>
                    {{ lage.spaeter ? t("wikiBox.spaeter") : t("wikiBox.sync") }}
                </AvmKnopf>
                <AvmKnopf
                    v-if="hatArtikel"
                    art="gefahr"
                    groesse="zeile"
                    :gesperrt="lage.entfernen === undefined ? undefined : grundText(lage.entfernen)"
                    :grund-bei="gruppenGrund !== undefined ? grundId : standId"
                    :title="t('wikiBox.entfernen.zettel')"
                    :testid="`${kennung}-wiki-entfernen`"
                    @click="entfernenKlick"
                >
                    <template #zeichen>✕</template>
                    {{ t("wikiBox.entfernen") }}
                </AvmKnopf>
            </div>
        </div>
        <AvmSperrgrund v-if="gruppenGrund" :id="grundId" :text="gruppenGrund" />

        <p v-if="ladefehler && !stand" class="wiki-box__leise" role="status">{{ t("wikiBox.antwort.allgemein") }}</p>
        <FensterFeldzeilen v-else-if="stand" class="wiki-box__zeilen">
            <dt>{{ t("wikiBox.zeile.artikel") }}</dt>
            <dd v-if="stand.artikel" :data-testid="`${kennung}-wiki-artikel`" class="wiki-box__artikel">
                <span class="wiki-box__link">
                    <a :href="stand.artikel.url" target="_blank" rel="noopener" :title="t('wikiBox.artikel.oeffnet')">{{
                        stand.artikel.name
                    }}</a>
                    <span v-if="neu" class="wiki-box__zusatz">{{ t("wikiBox.neuVerknuepft") }}</span>
                    <span v-if="stand.anteil" class="wiki-box__zusatz">{{
                        t("wikiFeld.anteil", { n: stand.anteil.mit, m: stand.anteil.von })
                    }}</span>
                </span>
                <span v-if="lage.knoepfe && (anAlleKnopf || assistentKnopf)" class="wiki-box__knoepfe">
                    <AvmKnopf
                        v-if="anAlleKnopf"
                        groesse="zeile"
                        :gesperrt="lage.zuweisen === undefined ? undefined : grundText(lage.zuweisen)"
                        :grund-bei="gruppenGrund !== undefined ? grundId : standId"
                        :title="t('wikiBox.anAlle.zettel')"
                        :testid="`${kennung}-wiki-an-alle`"
                        @click="weiseAnAlle"
                    >
                        <template #zeichen>⇉</template>
                        {{ t("wikiBox.anAlle") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="assistentKnopf"
                        groesse="zeile"
                        :gesperrt="lage.zuweisen === undefined ? undefined : grundText(lage.zuweisen)"
                        :grund-bei="gruppenGrund !== undefined ? grundId : standId"
                        :title="t('wikiBox.assistent.zettel')"
                        :testid="`${kennung}-wiki-assistent`"
                        @click="emit('assistent')"
                    >
                        <template #zeichen>⇢</template>
                        {{ t("wikiBox.assistent") }}
                    </AvmKnopf>
                </span>
            </dd>
            <dd v-else class="wiki-box__artikel wiki-box__leise" :data-testid="`${kennung}-wiki-ohne-artikel`">
                <span>{{ t("wikiZuordnung.keiner") }}</span>
                <AvmKnopf
                    v-if="lage.knoepfe && assistentKnopf"
                    groesse="zeile"
                    :gesperrt="lage.zuweisen === undefined ? undefined : grundText(lage.zuweisen)"
                    :grund-bei="gruppenGrund !== undefined ? grundId : standId"
                    :title="t('wikiBox.assistent.zettel')"
                    :testid="`${kennung}-wiki-assistent`"
                    @click="emit('assistent')"
                >
                    <template #zeichen>⇢</template>
                    {{ t("wikiBox.assistent") }}
                </AvmKnopf>
            </dd>

            <template v-if="stand.artikel">
                <dt>{{ t("wikiBox.zeile.schluessel") }}</dt>
                <dd class="wiki-box__schluessel" :title="t('wikiBox.schluessel.zettel')">
                    {{ schluesselText(stand.artikel.key) }}
                </dd>
            </template>
            <!-- Weitere Artikel des Wegs (WI-0300; seit WI-0302 nur Anzeige): Link und Anteil; geändert wird bei den Abschnitten. -->
            <template v-if="stand.weitere !== undefined">
                <dt>{{ t("wikiBox.zeile.weitere") }}</dt>
                <dd :data-testid="`${kennung}-wiki-weitere`">
                    <ul v-if="stand.weitere.length > 0" class="wiki-box__weitere">
                        <li
                            v-for="w in stand.weitere"
                            :key="w.key"
                            :data-testid="`${kennung}-wiki-weiterer`"
                            :data-key="w.key"
                        >
                            <span class="wiki-box__link">
                                <a :href="w.url" target="_blank" rel="noopener" :title="t('wikiBox.artikel.oeffnet')">{{
                                    w.name
                                }}</a>
                                <span class="wiki-box__zusatz">{{ weitererAnteil(w) }}</span>
                            </span>
                        </li>
                    </ul>
                    <span v-else class="wiki-box__leise">{{ t("wikiBox.weitere.keine") }}</span>
                    <p class="wiki-box__satz" :data-testid="`${kennung}-wiki-weitere-satz`">
                        {{ t("wikiBox.weitere.satz") }}
                    </p>
                </dd>
            </template>
            <!-- Weitere Zeilen zum Artikel (dt/dd), die das Fenster mitbringt: am Gebiet der Wiki-Typ. -->
            <slot name="zeilen" />

            <template v-if="stand.artikel && recht === 'schreiben'">
                <dt>{{ t("wikiBox.zeile.sync") }}</dt>
                <dd>
                    <div v-if="stand.sync.laeuft" class="wiki-box__takt" :data-testid="`${kennung}-wiki-sync-laeuft`">
                        <p :id="standId" class="wiki-box__stand">
                            <AvmKreis fuellung="halb" :name="t('wikiBox.stand.laeuft')" />
                            <span>{{ t("wikiBox.stand.laeuft") }}</span>
                        </p>
                        <div
                            class="wiki-box__balken"
                            role="progressbar"
                            :aria-label="t('wikiBox.fortschritt')"
                            aria-valuemin="0"
                            aria-valuemax="100"
                        >
                            <span class="wiki-box__balken-fuellung"></span>
                        </div>
                        <p class="wiki-box__satz">{{ t("wikiBox.laeuft.wartet") }}</p>
                    </div>
                    <p v-else-if="fehlerText !== undefined" :id="standId" class="wiki-box__stand">
                        <AvmKreis fuellung="leer" :name="t('wikiBox.stand.fehler')" />
                        <strong>{{ t("wikiBox.stand.fehler") }}</strong>
                    </p>
                    <p v-else :id="standId" class="wiki-box__stand" :data-testid="`${kennung}-wiki-stand`">
                        <AvmKreis
                            :fuellung="zeile.fuellung"
                            :name="
                                zeile.art === 'aktuell'
                                    ? t('wikiBox.stand.aktuell')
                                    : zeile.art === 'neuer'
                                      ? t('wikiBox.stand.neuer')
                                      : t('wikiBox.stand.teil', { n: zeile.folgen ?? 0, m: zeile.von ?? 0 })
                            "
                        />
                        <strong v-if="zeile.art === 'aktuell'">{{ t("wikiBox.stand.aktuell") }}</strong>
                        <strong v-else-if="zeile.art === 'neuer'">{{ t("wikiBox.stand.neuer") }}</strong>
                        <strong v-else>{{
                            t("wikiBox.stand.teil", { n: zeile.folgen ?? 0, m: zeile.von ?? 0 })
                        }}</strong>
                    </p>
                    <p
                        v-if="letzterZeile !== undefined"
                        class="wiki-box__letzter"
                        :title="letzterZettel"
                        :data-testid="`${kennung}-wiki-sync-ergebnis`"
                    >
                        {{ letzterZeile }}
                    </p>
                    <p
                        v-if="syncGrundSatz !== undefined && fehlerText === undefined"
                        :id="syncGrundId"
                        class="wiki-box__satz"
                    >
                        {{ syncGrundSatz }}
                    </p>
                </dd>
            </template>
        </FensterFeldzeilen>

        <template v-if="stand && stand.artikel && recht === 'schreiben'">
            <AvmHinweis v-if="fehlerText !== undefined" :id="fehlerId" :testid="`${kennung}-wiki-fehler`">
                <p>{{ fehlerText }}</p>
            </AvmHinweis>
            <AvmHinweis
                v-else-if="!stand.sync.laeuft && aenderungen.length > 0"
                :testid="`${kennung}-wiki-aenderungen`"
            >
                <p>{{ tPlural("wikiBox.aender.kopf", aenderungen.length, { n: aenderungen.length }) }}</p>
                <dl class="wiki-box__aender">
                    <template v-for="a in aenderungen" :key="a.id">
                        <dt>{{ a.name }}</dt>
                        <dd v-if="a.mehrzeilig">
                            <span class="wiki-box__neu">{{ t("wikiBox.aender.text") }}</span>
                        </dd>
                        <dd v-else>
                            <span class="wiki-box__alt">{{ a.alt }}</span
                            ><span class="wiki-box__pfeil" :aria-label="t('wikiBox.aender.wird')">→</span
                            ><span class="wiki-box__neu">{{ a.neu }}</span>
                        </dd>
                    </template>
                </dl>
            </AvmHinweis>
            <AvmHinweis v-if="fehlerText === undefined && eigeneText !== undefined" :testid="`${kennung}-wiki-eigene`">
                <p>{{ eigeneText }}</p>
            </AvmHinweis>
        </template>

        <AvmHinweis v-if="meldung !== undefined" ton="gefahr" rolle="alert" :testid="`${kennung}-wiki-meldung`">
            <p>{{ meldung }}</p>
        </AvmHinweis>

        <AvmBestaetigung
            v-if="frage && stand?.artikel"
            :frage="t('wikiBox.entfernen.frage', { name: stand.artikel.name })"
            :folge="t('wikiBox.entfernen.folge')"
            :bestaetigen="t('wikiBox.entfernen')"
            :testid="`${kennung}-wiki-entfernen-frage`"
            @bestaetigen="entferne"
            @abbrechen="frage = false"
        />

        <div
            v-if="sucheOffen"
            class="wiki-box__suche"
            :data-testid="`${kennung}-wiki-suche-kasten`"
            @keydown.esc="escape"
        >
            <label class="wiki-box__suche-feld">
                <span>{{ t("wikiZuordnung.suchen") }}</span>
                <AvmEingabe
                    v-model="suche"
                    :testid="`${kennung}-wiki-suche`"
                    :placeholder="t('wikiZuordnung.suchen')"
                    autocomplete="off"
                    spellcheck="false"
                />
            </label>
            <p v-if="sucheFehler" class="wiki-box__leise">{{ t("wikiZuordnung.fehler") }}</p>
            <p v-else-if="sucheLaedt && treffer.length === 0" class="wiki-box__leise">{{ t("wikiZuordnung.laedt") }}</p>
            <p v-else-if="treffer.length === 0" class="wiki-box__leise">{{ t("wikiZuordnung.keine") }}</p>
            <ul v-else class="wiki-box__treffer">
                <li v-for="tr in treffer" :key="tr.key">
                    <button
                        type="button"
                        class="wiki-box__treffer-knopf"
                        :data-testid="`${kennung}-wiki-treffer`"
                        :aria-pressed="gleicherArtikel(tr)"
                        :disabled="gleicherArtikel(tr) || lage.zuweisen !== undefined"
                        @click="weise(tr)"
                    >
                        <strong>{{ tr.name || tr.key }}</strong>
                        <small v-if="trefferZeile(art, tr) !== ''">{{ trefferZeile(art, tr) }}</small>
                        <small v-if="tr.belegt && tr.belegt !== stand?.name">{{
                            t("wikiZuordnung.belegt", { name: tr.belegt })
                        }}</small>
                    </button>
                </li>
            </ul>
        </div>

        <p class="wiki-box__satz" :data-testid="`${kennung}-wiki-satz`">{{ satz }}</p>
    </div>
</template>

<style scoped>
.wiki-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.wiki-box__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

/* Der Titel eines Abschnitts im Editor (dieselbe Schrift wie `…__titel` in den Fenstern der Arten). */
.wiki-box__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wiki-box__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
    min-width: 0;
}

.wiki-box__zeilen {
    align-items: start;
    row-gap: var(--space-4);
}

.wiki-box__zeilen > dt {
    padding-top: var(--space-2);
}

.wiki-box__zeilen > dd {
    display: grid;
    gap: var(--space-4);
    justify-items: start;
}

/* Die Zeile „Artikel“: Link und Anteil links, „An alle Abschnitte“ rechts (OPS-000112). */
.wiki-box__artikel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-6);
}

.wiki-box__link {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    min-width: 0;
    margin: 0;
}

.wiki-box__link a {
    color: var(--color-link);
}

.wiki-box__link a:hover {
    color: var(--color-link-hover);
}

.wiki-box__zusatz {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die weiteren Artikel (WI-0300, WI-0302): je Eintrag Link und Anteil im Stil des Hauptartikels. */
.wiki-box__weitere {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wiki-box__weitere > li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    min-width: 0;
}

.wiki-box__schluessel {
    color: var(--color-text);
}

.wiki-box__leise {
    margin: 0;
    color: var(--color-text-muted);
}

.wiki-box__stand {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wiki-box__stand strong {
    color: var(--color-text-strong);
    font-weight: normal;
}

.wiki-box__letzter {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.wiki-box__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wiki-box__takt {
    display: grid;
    gap: var(--space-4);
    justify-items: stretch;
    width: 100%;
}

/* Der Fortschritt hat keine Zahl (der Auftrag wartet auf den Takt des Wikis): ein ruhig wandernder Streifen. */
.wiki-box__balken {
    height: var(--space-2);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.wiki-box__balken-fuellung {
    display: block;
    width: 35%;
    height: 100%;
    background: var(--color-accent);
    animation: wiki-box-wandern 1600ms ease-in-out infinite alternate;
}

@keyframes wiki-box-wandern {
    from {
        transform: translateX(0);
    }
    to {
        transform: translateX(186%);
    }
}

@media (prefers-reduced-motion: reduce) {
    .wiki-box__balken-fuellung {
        width: 50%;
        animation: none;
    }
}

.wiki-box__aender {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-10);
    margin: var(--space-2) 0;
    font-size: var(--font-size-body);
}

.wiki-box__aender dt {
    color: var(--color-text-muted);
}

.wiki-box__aender dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.wiki-box__alt {
    color: var(--color-text-muted);
}

.wiki-box__pfeil {
    padding: 0 var(--space-2);
    color: var(--color-text-muted);
}

.wiki-box__neu {
    color: var(--color-text-strong);
}

/* Die Artikelsuche (aus dem früheren Kasten „Wiki-Artikel“ der Kraftlinie übernommen). */
.wiki-box__suche {
    display: grid;
    gap: var(--space-4);
}

.wiki-box__suche-feld {
    display: grid;
    gap: var(--space-2);
}

.wiki-box__treffer {
    display: grid;
    gap: var(--space-2);
    max-height: 14rem;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
}

.wiki-box__treffer-knopf {
    display: grid;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.wiki-box__treffer-knopf:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.wiki-box__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wiki-box__treffer-knopf:disabled {
    cursor: default;
    opacity: 0.6;
}

.wiki-box__treffer-knopf small {
    color: var(--color-text-muted);
}
</style>
