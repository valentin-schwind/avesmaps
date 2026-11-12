<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { EDITORPANEL, SPRACHEDITOR, type SpracheEditorArtikelZeile } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import EntwurfFuss from "../fenster/entwurf-fuss.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterReiter from "../fenster/fenster-reiter.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { listenBreite } from "../fenster/listen-schalter";
import { formatNumber, t } from "../i18n/i18n";
import SpracheAnlegen from "./sprache-anlegen.vue";
import SpracheEigenschaften from "./sprache-eigenschaften.vue";
import { felderAus, type SpracheFelder } from "./sprache-felder";
import type { SprachKopierZiel } from "./sprachflaeche-kopieren";
import SpracheFlaechen from "./sprache-flaechen.vue";
import SpracheKollisionen from "./sprache-kollisionen.vue";
import { sprachVerlaufFeldName, sprachVerlaufWert } from "./sprache-verlauf";
import type { SpracheditorFuerSeite } from "./spracheditor-anbindung";
import {
    SPRACHEN_LEGENDE,
    SPRACHEN_OPTIONEN,
    SPRACHEN_SORTIERUNGEN,
    artikelSchluessel,
    artikelVon,
    facettenName,
    sortierungsName,
    wertName,
    zeilenVon,
} from "./sprachen-liste";

/**
 * Der Spracheditor (WI-0261 S5d2; Betreiber 2026-10-30: „intern sind es inhalten -> Auf der Karte -> Sprachen und benötigen auch einen
 * editor“; Bauvorlage: Probierseite `sprachen-probe.html`, Zustand 6, `fenster-sprachen.js`): ein Werkzeugfenster wie die übrigen Editoren
 * (rechts angedockt, « » klappt die Liste ein), links die Sprachen und freien Wiki-Artikel mit den vier Zuständen, rechts die Eigenschaften
 * der Sprache DIESES Fensters. Je Sprache ein Fenster (EDIT-0003 T44, D19).
 *
 * - **Liste:** eine Zeile je Sprache mit Kreis, Farbpunkt, Name und knappen Zahlen (Wiki-Stand, Teilflächen), dazu die freien Wiki-Artikel
 *   („◐ nur im Wiki“). Leiste aus dem gemeinsamen Bauteil: Suche, Trichter (Zustand, Stand), Sortierung, ✚ „Neue Sprache“. Ein Klick auf eine
 *   Sprache wählt sie, stellt die Karte auf Derographie › Sprachen und lässt sie leuchten; Doppelklick fliegt hin. Ein Klick auf einen freien
 *   Artikel bietet „Einer Sprache zuordnen“ und „Als neue Sprache anlegen“ (`sprache-anlegen.vue`).
 * - **Reiter** (`SPRACHEDITOR`): Eigenschaften (`sprache-eigenschaften.vue`), Flächen (`sprache-flaechen.vue`), Kollisionen
 *   (`sprache-kollisionen.vue`), Verlauf (gemeinsam, `entwurf-verlauf.vue`).
 * - **Bearbeiten** (`fenster/bearbeitung.ts`, Art `sprache-art.ts`): Name, Legende, Farbe und Wiki-Artikel sind Felder des EINEN Entwurfs; die
 *   erste Änderung beginnt (Sperre, Leiste mit „Fertig“ über der Karte), der Fuß zeigt „n ungespeichert“, Konflikt und „Sperre abgelaufen“
 *   stehen als Kasten über den Reitern. Die Teilflächen schreibt jede für sich (Modus über der Karte, gestartet im Kartenmenü).
 * - **Der Entwurf einer Teilfläche** (WI-0261 Stufe 2; „Teilfläche bearbeiten“ und die Werkzeuge aus „Form ändern ›“, `sprachflaeche-werkzeuge.ts`):
 *   Solange er an einer Teilfläche dieser Sprache offen ist, stehen sein Konfliktkasten und sein Fuß hier, dieselben Bauteile wie an der Landschaft
 *   (`fenster/entwurf-konflikt.vue`, `fenster/entwurf-fuss.vue`; EDIT-0003 §3b R1: anwenden · übernehmen · überschreiben, der Entwurf bleibt).
 * - **Teilflächen von der Karte** (WI-0261 Stufe 1): Ein Klick auf eine Teilfläche, ein Handgriff des Kartenmenüs und eine eben gezeichnete
 *   Teilfläche stellen den Reiter „Flächen“ und wählen sie dort (`flaecheWunsch` der Steuerung).
 * - **Stillgelegt:** Die Sprache steht lesend da, mit „↺ Zurückholen“.
 * - **Telefon:** Liste und Eigenschaften als Drill-down mit „‹ Liste“, wie die übrigen Editoren.
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    editor: SpracheditorFuerSeite;
    ablageZiel: () => DOMRect | undefined;
    /** Darf diese Sitzung Sprachen schreiben (`edit_languages`, `MAP_EDITING`)? */
    darf: boolean;
    /** Ist die Liste eingezogen? Der Schalter liegt in `app.vue` (`listenSchalter`). */
    listeZu?: boolean | undefined;
}>();
const emit = defineEmits<{
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    listeZu: [zu: boolean];
}>();

const kennung = computed(() => `spracheditor-${props.fenster.id}`);
const id = computed(() => props.fenster.gegenstand);
const bearbeitung = computed(() => props.editor.bearbeitungVon(id.value));
/** Der gelesene Stand der Bearbeitung (Felder) und der jüngste Stand (Teilflächen, Treffer; nach Flächenarbeit der Nebenstand). */
const detail = computed(() => bearbeitung.value?.detail.value);
const jetzt = computed(() => props.editor.detailVon(id.value));
const detailFehler = computed(() => {
    const art = bearbeitung.value?.zustand.value.art;
    if (art === "fehlt") return t("entwurf.fehlt");
    if (art === "lesefehler") return t("entwurf.lesefehler");
    return undefined;
});
const stand = computed(() => bearbeitung.value?.stand.value);
const felder = computed(
    (): SpracheFelder | undefined => stand.value?.felder ?? (detail.value ? felderAus(detail.value) : undefined),
);
const schreibt = computed(() => props.darf && detail.value?.aktiv === true && stand.value !== undefined);
const konflikt = computed(() => {
    const zustand = bearbeitung.value?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
/** Der Entwurf einer Teilfläche dieser Sprache (Stufe 2): Solange er offen ist, gehören ihm Konfliktkasten und Fuß. */
const formBearbeitung = computed(() => props.editor.formBearbeitungVon(id.value));
const formKonflikt = computed(() => {
    const zustand = formBearbeitung.value?.zustand.value;
    return zustand?.art === "konflikt" ? zustand : undefined;
});
const fussBearbeitung = computed(() => formBearbeitung.value ?? bearbeitung.value);
const formName = (): string => t("entwurf.form");
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliesse");
    },
});
const lage = computed(() =>
    phoneViewport.value && props.fenster.lage === "geloest" ? "angedockt" : props.fenster.lage,
);

// --- Die Liste ---
const facetten = (EDITORPANEL.eintraege.find((x) => x.id === "sprachen") as { facetten: readonly string[] }).facetten;
const optionen = { ...SPRACHEN_OPTIONEN, facetten };
const sortierungen = SPRACHEN_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
const legende = SPRACHEN_LEGENDE();
const zeilen = computed(() => zeilenVon(props.editor.liste.value));
/** Rechts statt einer Sprache: der freie Artikel, dessen Zeile gewählt ist, oder „✚ Neue Sprache“. */
const artikelWahl = ref<string | undefined>(undefined);
const neu = ref(false);
const telefonSeite = ref<"liste" | "eigenschaften">("liste");
const gewaehlt = computed({
    get: () => (artikelWahl.value !== undefined ? artikelSchluessel(artikelWahl.value) : id.value),
    set: (key: string | undefined) => {
        const artikel = artikelVon(key);
        neu.value = false;
        artikelWahl.value = artikel;
        if (artikel === undefined) props.editor.waehleInListe(key, props.fenster.id);
        if (key !== undefined && phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
});
const artikelZeile = computed(() =>
    props.editor.liste.value?.zeilen.find(
        (zeile): zeile is SpracheEditorArtikelZeile => zeile.art === "artikel" && zeile.id === artikelWahl.value,
    ),
);
const aktiveSprachen = computed(() =>
    (props.editor.liste.value?.zeilen ?? []).flatMap((zeile) =>
        zeile.art === "sprache" && zeile.aktiv ? [{ id: zeile.id, name: zeile.name }] : [],
    ),
);
// Wird der freie Artikel einer Sprache zugeordnet, verschwindet seine Zeile: Rechts steht dann wieder die Sprache.
watch(artikelZeile, (zeile) => {
    if (zeile === undefined && artikelWahl.value !== undefined && props.editor.liste.value !== undefined)
        artikelWahl.value = undefined;
});
function oeffneZeile(key: string): void {
    if (artikelVon(key) === undefined) props.editor.fliegeZu(key);
}
function neueSprache(): void {
    artikelWahl.value = undefined;
    neu.value = true;
    if (phoneViewport.value) telefonSeite.value = "eigenschaften";
}

// --- « » wie die übrigen Editoren ---
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));

// --- Reiter ---
type Reiter = (typeof SPRACHEDITOR)["eintraege"][number]["id"];
const reiter = ref<Reiter>("eigenschaften");

// --- Die gewählte Teilfläche (WI-0261 Stufe 1) ---
/** Die gewählte Teilfläche im Reiter „Flächen“ und die, deren Bestätigung „entfernen“ offen ist; eine andere Sprache beginnt ohne beide. */
const teilWahl = ref<string | undefined>(undefined);
const teilFrage = ref<string | undefined>(undefined);
/** Die Teilfläche, deren Blatt „Fläche kopieren“ offen ist (WI-0261 Stufe 3), und der Satz des Servers, wenn es nicht ging. */
const teilKopie = ref<string | undefined>(undefined);
const kopierSatz = ref<string | undefined>(undefined);
// Ein Klick auf eine Teilfläche der Karte, ein Handgriff des Kartenmenüs oder eine eben gezeichnete Teilfläche: Reiter „Flächen“, die Teilfläche
// gewählt. Auch beim Öffnen (das Fenster entsteht mit dem Wunsch); gesehen meldet es zurück, damit er beim nächsten Öffnen nicht wiederkommt.
watch(
    [() => props.editor.flaecheWunsch.value?.mal, id],
    ([, sprache], vorher) => {
        if (vorher !== undefined && vorher[1] !== sprache) {
            teilWahl.value = undefined;
            teilFrage.value = undefined;
            teilKopie.value = undefined;
        }
        const wunsch = props.editor.flaecheWunsch.value;
        if (wunsch === undefined || wunsch.sprache !== sprache) return;
        artikelWahl.value = undefined;
        neu.value = false;
        reiter.value = "flaechen";
        teilWahl.value = wunsch.flaeche;
        teilFrage.value = wunsch.frage ? wunsch.flaeche : undefined;
        teilKopie.value = wunsch.kopieren === true ? wunsch.flaeche : undefined;
        kopierSatz.value = undefined;
        if (phoneViewport.value) telefonSeite.value = "eigenschaften";
        props.editor.flaecheGesehen();
    },
    { immediate: true },
);
// „Unterfläche löschen …“ (WI-0261 Stufe 3; Betreiber 2026-10-31: „Ja, nachfragen“): Die Frage steht im Reiter „Flächen“ dieser Sprache. Wechselt das Fenster
// die Sprache oder den Reiter oder geht es zu, kann es sie nicht mehr zeigen: Dann heißt die Antwort nein, damit der Modus nicht auf sie wartet.
const unterFrage = computed(() => {
    const frage = props.editor.unterFrage.value;
    return frage !== undefined && frage.sprache === id.value ? frage : undefined;
});
const unterNein = (sprache: string | undefined): void => {
    if (sprache !== undefined && props.editor.unterFrage.value?.sprache === sprache)
        props.editor.antworteUnterflaeche(false);
};
watch(id, (_jetzt, vorher) => unterNein(vorher));
watch(reiter, (jetzt, vorher) => {
    if (vorher === "flaechen" && jetzt !== "flaechen") unterNein(id.value);
});
watch(
    () => unterFrage.value !== undefined && (!props.darf || jetzt.value?.aktiv === false),
    (ohne) => {
        if (ohne) unterNein(id.value);
    },
);
onBeforeUnmount(() => unterNein(id.value));
const reiterListe = computed(() =>
    SPRACHEDITOR.eintraege.map((eintrag) => ({
        id: eintrag.id,
        name:
            eintrag.id === "flaechen"
                ? t("spracheditor.reiter.flaechen", { n: formatNumber(jetzt.value?.teilflaechen.length ?? 0, 0) })
                : t(`spracheditor.reiter.${eintrag.id}`),
    })),
);
const titel = computed(() => {
    const name = jetzt.value?.name ?? props.editor.liste.value?.zeilen.find((z) => z.id === id.value)?.name;
    return name === undefined ? t("spracheditor.titel") : `${t("spracheditor.titel")} · ${name}`;
});
const unterzeile = computed(() => {
    const d = jetzt.value;
    if (d === undefined) return "";
    const herkunft =
        d.herkunft === "sprachenkarte"
            ? t("spracheditor.herkunft.sprachenkarte")
            : t("spracheditor.herkunft.redaktion");
    return d.aktiv ? herkunft : `${herkunft} · ${t("spracheditor.stand.stillgelegt")}`;
});

// --- Handlungen ---
const laeuft = ref(false);
async function mitLauf<T>(arbeit: () => Promise<T>): Promise<T | undefined> {
    if (laeuft.value) return undefined;
    laeuft.value = true;
    try {
        return await arbeit();
    } finally {
        laeuft.value = false;
    }
}
const stillGrund = computed(() =>
    laeuft.value
        ? t("spracheditor.anlegen.laeuft")
        : bearbeitung.value?.lage.value.aktiv === true
          ? t("verlauf.gesperrtBearbeitung")
          : undefined,
);
/** Warum gerade kein Modus der Fläche beginnt. */
const modusGrund = computed(() => {
    if (laeuft.value) return t("spracheditor.anlegen.laeuft");
    if (props.editor.modusLaeuft.value) return t("spracheditor.flaeche.laeuftSchon");
    return undefined;
});
function stilllegen(): void {
    const spracheId = id.value;
    if (spracheId === undefined) return;
    void mitLauf(async () =>
        props.editor.meldeErgebnis(
            await props.editor.stand(spracheId, "stilllegen"),
            t("spracheditor.stilllegen.fertig", { name: jetzt.value?.name ?? "" }),
        ),
    );
}
function zurueckholen(): void {
    const spracheId = id.value;
    if (spracheId === undefined) return;
    void mitLauf(async () =>
        props.editor.meldeErgebnis(
            await props.editor.stand(spracheId, "zurueckholen"),
            t("spracheditor.zurueckholen.fertig", { name: jetzt.value?.name ?? "" }),
        ),
    );
}
function anlegen(name: string, farbe: string, wiki: readonly string[]): void {
    void mitLauf(async () => {
        const ergebnis = await props.editor.legeAn(name, farbe, wiki);
        props.editor.meldeErgebnis(ergebnis, t("spracheditor.anlegen.fertig", { name }));
        if (ergebnis.ok) {
            neu.value = false;
            artikelWahl.value = undefined;
        }
    });
}
function zuordnen(sprache: string, artikel: string): void {
    artikelWahl.value = undefined;
    props.editor.ordneZu(sprache, artikel);
    reiter.value = "eigenschaften";
}
const rechnet = ref(false);
function neuRechnen(): void {
    const spracheId = id.value;
    if (spracheId === undefined || rechnet.value) return;
    rechnet.value = true;
    void props.editor
        .neuRechnen(spracheId)
        .then((ergebnis) => props.editor.meldeErgebnis(ergebnis, t("spracheditor.treffer.eingereiht")))
        .finally(() => (rechnet.value = false));
}
function teilStilllegen(teil: { id: string; revision: number; flaeche: number }): void {
    const spracheId = id.value;
    if (spracheId === undefined) return;
    void mitLauf(async () =>
        props.editor.meldeErgebnis(
            await props.editor.teilflaeche(spracheId, teil, "stilllegen"),
            t("spracheditor.flaeche.stillgelegt"),
        ),
    );
}
/** „Kopieren“ im Blatt (Stufe 3): EINE Operation; danach steht das Fenster an der Zielsprache mit der Kopie gewählt, das Blatt ist zu. */
function teilKopieren(teil: { id: string; revision: number }, ziel: SprachKopierZiel): void {
    const spracheId = id.value;
    if (spracheId === undefined) return;
    const zielName =
        "neueSprache" in ziel
            ? ziel.neueSprache.name
            : (props.editor.liste.value?.zeilen.find((z) => z.id === ziel.targetId)?.name ?? "");
    kopierSatz.value = undefined;
    void mitLauf(async () => {
        const ergebnis = await props.editor.kopiere(spracheId, teil, ziel);
        if (!ergebnis.ok) {
            kopierSatz.value = ergebnis.satz;
            return;
        }
        teilKopie.value = undefined;
        props.editor.meldeErgebnis(
            ergebnis,
            t(ziel.deleteSource ? "spracheditor.kopieren.umgezogen" : "spracheditor.kopieren.kopiert", {
                name: zielName,
            }),
        );
    });
}
function teilZurueck(teil: { id: string; revision: number; flaeche: number }): void {
    const spracheId = id.value;
    if (spracheId === undefined) return;
    void mitLauf(async () =>
        props.editor.meldeErgebnis(
            await props.editor.teilflaeche(spracheId, teil, "zurueckholen"),
            t("spracheditor.flaeche.zurueckgeholt"),
        ),
    );
}
function setzeFeld(neuerStand: (f: SpracheFelder) => SpracheFelder, verschmelze?: string): void {
    bearbeitung.value?.feld(neuerStand, verschmelze);
}
const suche = (q: string, signal: AbortSignal) => props.editor.daten.artikel(q, signal);
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        rumpf="spalten"
        :lage="lage"
        :box="fenster.box"
        :ablage-ziel="ablageZiel"
        :einzug="einzug"
        :titel="titel"
        :zusatz="darf ? undefined : t('editorPanel.verb.lesen')"
        :testid="kennung"
        @update:lage="(neueLage, box) => emit('lage', neueLage, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('spracheditor.liste')"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="editor.ladeFehler.value" class="spracheditor__leise">
                {{ editor.ladeFehler.value }}
                <button type="button" class="spracheditor__verweis" @click="editor.ladeListe()">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!editor.liste.value" class="spracheditor__leise">{{ t("spracheditor.laedt") }}</p>
            <EditorListe
                v-else
                v-model:gewaehlt="gewaehlt"
                :zeilen="zeilen"
                :optionen="optionen"
                :facetten-name="facettenName"
                :wert-name="wertName"
                :sortierungen="sortierungen"
                :legende="legende"
                :leer-text="t('spracheditor.leer')"
                :kennung="`${kennung}-sprachen`"
                :beschriftung="t('spracheditor.liste')"
                :einstellung="editor.listenEinstellung"
                @oeffne="oeffneZeile"
            >
                <template v-if="darf" #zeichen>
                    <button
                        type="button"
                        class="spracheditor__zeichen"
                        :aria-label="t('spracheditor.neu')"
                        :title="t('spracheditor.neu')"
                        :aria-pressed="neu"
                        :data-testid="`${kennung}-neu`"
                        @click="neueSprache"
                    >
                        <EditorZeichen name="hinzufuegen" />
                    </button>
                </template>
            </EditorListe>
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="t('spracheditor.eigenschaften')"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button
                    v-if="phoneViewport"
                    type="button"
                    class="spracheditor__verweis"
                    @click="telefonSeite = 'liste'"
                >
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="spracheditor__listenschalter"
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
            <SpracheAnlegen
                v-if="neu || artikelZeile"
                :art="neu ? 'neu' : 'artikel'"
                :artikel="artikelZeile"
                :sprachen="aktiveSprachen"
                :lesend="!darf"
                :laeuft="laeuft"
                :kennung="kennung"
                @anlegen="anlegen"
                @zuordnen="zuordnen"
                @abbrechen="neu = false"
            />
            <p v-else-if="!id" class="spracheditor__leise">{{ t("spracheditor.keineWahl") }}</p>
            <template v-else>
                <div class="spracheditor__name">
                    <span
                        v-if="felder"
                        class="spracheditor__farbe"
                        :style="{ '--farbe': felder.farbe }"
                        aria-hidden="true"
                    ></span>
                    <strong>{{ felder?.name || jetzt?.name || "…" }}</strong>
                    <small>{{ unterzeile }}</small>
                </div>
                <div v-if="jetzt && !jetzt.aktiv" class="spracheditor__stand" :data-testid="`${kennung}-stand`">
                    <span>{{ t("spracheditor.stand.stillgelegtSatz") }}</span>
                    <AvmKnopf
                        v-if="darf"
                        groesse="zeile"
                        :gesperrt="stillGrund"
                        :testid="`${kennung}-zurueckholen`"
                        @click="zurueckholen"
                    >
                        {{ t("spracheditor.zurueckholen.knopf") }}
                    </AvmKnopf>
                </div>
                <EntwurfKonflikt
                    v-if="formKonflikt && formBearbeitung"
                    :bearbeitung="formBearbeitung"
                    :konflikt="formKonflikt"
                    :feld-name="formName"
                    :kennung="`${kennung}-form`"
                />
                <EntwurfKonflikt
                    v-if="konflikt && bearbeitung"
                    :bearbeitung="bearbeitung"
                    :konflikt="konflikt"
                    :feld-name="sprachVerlaufFeldName"
                    :kennung="kennung"
                />
                <FensterReiter
                    v-model="reiter"
                    :reiter="reiterListe"
                    :beschriftung="t('spracheditor.reiter')"
                    :kennung="kennung"
                />
                <div
                    :id="`${kennung}-inhalt-${reiter}`"
                    class="spracheditor__rumpf"
                    role="tabpanel"
                    :data-testid="`${kennung}-eigenschaften`"
                >
                    <p v-if="detailFehler" class="spracheditor__leise">{{ detailFehler }}</p>
                    <p v-else-if="!detail || !jetzt || !felder" class="spracheditor__leise">
                        {{ t("spracheditor.detailLaedt") }}
                    </p>
                    <SpracheEigenschaften
                        v-else-if="reiter === 'eigenschaften'"
                        :detail="detail"
                        :felder="felder"
                        :lesend="!schreibt"
                        :kennung="kennung"
                        :suche="suche"
                        :still-grund="stillGrund"
                        @feld="setzeFeld"
                        @verlassen="bearbeitung?.feldVerlassen()"
                        @stilllegen="stilllegen"
                    />
                    <SpracheFlaechen
                        v-else-if="reiter === 'flaechen'"
                        v-model:gewaehlt="teilWahl"
                        v-model:fragt="teilFrage"
                        v-model:kopiert="teilKopie"
                        :detail="jetzt"
                        :stillgelegte="editor.stillgelegteVon(id)"
                        :lesend="!darf || !jetzt.aktiv"
                        :modus-grund="modusGrund"
                        :kennung="kennung"
                        :zeilen="editor.liste.value?.zeilen"
                        :kopier-fehler="kopierSatz"
                        :unter-frage="unterFrage"
                        @unter-antwort="(ja: boolean) => editor.antworteUnterflaeche(ja)"
                        @fliege="editor.fliegeZuTeil"
                        @stilllegen="teilStilllegen"
                        @kopieren="teilKopieren"
                        @zurueckholen="teilZurueck"
                    />
                    <SpracheKollisionen
                        v-else-if="reiter === 'kollisionen'"
                        :detail="jetzt"
                        :lesend="!darf"
                        :rechnet="rechnet"
                        :kennung="kennung"
                        @neu-rechnen="neuRechnen"
                        @sprache="(andere: string) => editor.waehleInListe(andere, fenster.id)"
                    />
                    <EntwurfVerlauf
                        v-else-if="editor.verlaufVon(id)"
                        :verlauf="editor.verlaufVon(id)!"
                        :kennung="kennung"
                        :feld-name="sprachVerlaufFeldName"
                        :wert="sprachVerlaufWert"
                    />
                </div>
            </template>
        </FensterSpalte>
        <template v-if="fussBearbeitung" #fuss-hinweis>
            <EntwurfFuss :bearbeitung="fussBearbeitung" teil="hinweis" :testid="kennung" />
        </template>
        <template v-if="fussBearbeitung" #fuss-haupt>
            <EntwurfFuss :bearbeitung="fussBearbeitung" teil="haupt" :testid="kennung" />
        </template>
    </AvmFenster>
</template>

<style scoped>
.spracheditor__name {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2) var(--space-6);
}

.spracheditor__name strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.spracheditor__name small {
    grid-column: 2;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.spracheditor__farbe {
    width: var(--space-10);
    height: var(--space-10);
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--farbe);
}

.spracheditor__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.spracheditor__stand {
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

.spracheditor__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.spracheditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.spracheditor__verweis:hover {
    color: var(--color-link-hover);
}

.spracheditor__verweis:focus-visible,
.spracheditor__zeichen:focus-visible,
.spracheditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* ✚ „Neue Sprache“ in der Leiste, in der Form des Trichters (wie ✚ im Ortseditor). */
.spracheditor__zeichen {
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
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.spracheditor__zeichen:hover,
.spracheditor__zeichen[aria-pressed="true"] {
    background-color: var(--color-hover-wash);
    color: var(--color-text-strong);
}

/* « » wie in den übrigen Editoren (`.kraftlinieneditor__listenschalter`). */
.spracheditor__listenschalter {
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

.spracheditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.spracheditor__listenschalter:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

@media (prefers-reduced-motion: reduce) {
    .spracheditor__zeichen,
    .spracheditor__listenschalter {
        transition: none;
    }
}
</style>
