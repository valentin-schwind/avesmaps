<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { WETTER_SYMBOL_ARTEN, type WetterSymbolArt } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import EditorZeichen, { type EditorZeichenName } from "../controls/editor-zeichen.vue";
import { phoneViewport } from "../controls/phone-viewport";
import EditorListe from "../editor-liste/editor-liste.vue";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox } from "../fenster/fenster-lage";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { listenBreite } from "../fenster/listen-schalter";
import { formatNumber, t } from "../i18n/i18n";
import {
    WETTER_LISTE,
    WETTER_SORTIERUNGEN,
    ZEICHEN_DER_ART,
    artName,
    facettenName,
    istEntfernbar,
    papierkorbGrund as papierkorbGrundVon,
    presetName,
    sortierungsName,
    symbolName,
    wertName,
    wetterLegenden,
    wetterZeilen,
} from "./wetter-editor-modell";
import WetterIconEigenschaften from "./wetter-icon-eigenschaften.vue";
import WetterPresetEigenschaften from "./wetter-preset-eigenschaften.vue";
import type { Wettereditor } from "./wettereditor-steuerung";

/**
 * Das Fenster des Wetter-Editors (WI-0288 Stufe 3; Probierseite `review/wetter-editor/`, abgenommen mit Idee A und B): ein Werkzeugfenster
 * wie die übrigen Editoren (rechts angedockt in voller Höhe, gelöst nur so hoch wie sein Inhalt, « » zieht die Liste ein), links EINE Liste
 * mit den Gruppen „Presets“ und „Icons“, rechts die Eigenschaften des Gewählten.
 *
 * - **Leiste der Liste** (gemeinsames Bauteil `EditorListe`): Suche links, rechts Trichter (Art, Auf der Karte, Jahreszeit), Sortierung
 *   (Kalender und Anlage, Name, Art), ✚ „Anlegen“ (Preset, Wind, Wirbel, Meeresströmung, Mahlstrom) und der Papierkorb (Icons und angelegte Presets). Unter der Liste zwei Legenden,
 *   je eine für Presets und Icons, weil der Kreis in beiden etwas anderes zählt.
 * - **Kopf** wie die übrigen Editoren: „Wetter bearbeiten · Name des Gewählten“, ohne Schreibrecht „nur lesen“.
 * - **Fuß** in der Fassung von `EntwurfFuss`: links der Zustand („Speichert …“, „Gespeichert · vor 3 min“), rechts, wo die übrigen Editoren
 *   „n ungespeichert“ zeigen, dass sofort gespeichert wird. Einen Knopf „Speichern“ gibt es nicht (Betreiber 2026-11-07).
 */
const props = defineProps<{
    fenster: WerkzeugFenster;
    editor: Wettereditor;
    ablageZiel: () => DOMRect | undefined;
    listeZu?: boolean | undefined;
}>();
const emit = defineEmits<{
    lage: [lage: "angedockt" | "geloest" | "versenkt", box?: FensterBox];
    box: [box: FensterBox];
    vorn: [];
    schliesse: [];
    listeZu: [zu: boolean];
}>();

const kennung = computed(() => `wettereditor-${props.fenster.id}`);
const offen = computed({
    get: () => true,
    set: (auf: boolean) => {
        if (!auf) emit("schliesse");
    },
});
const lage = computed(() =>
    phoneViewport.value && props.fenster.lage === "geloest" ? "angedockt" : props.fenster.lage,
);
const zu = computed(() => props.listeZu === true && !phoneViewport.value);
const einzug = computed(() => (phoneViewport.value ? undefined : zu.value ? listenBreite() : 0));
const schalterText = computed(() => t(zu.value ? "ortseditor.liste.ausklappen" : "ortseditor.liste.einklappen"));

const darf = computed(() => props.editor.darf());
const gesperrt = computed(() =>
    !darf.value ? t("wettereditor.nurLesen") : props.editor.laeuft.value ? t("wettereditor.laeuft") : undefined,
);
const bestand = computed(() => props.editor.bestand.value);
const zeilen = computed(() =>
    bestand.value === undefined ? [] : wetterZeilen(bestand.value, props.editor.reiseTag.value),
);
const legenden = computed(() => (bestand.value === undefined ? undefined : wetterLegenden(bestand.value)));
const sortierungen = WETTER_SORTIERUNGEN.map((wert) => ({ wert, text: sortierungsName(wert) }));
/** Am Telefon steht eine Seite zur Zeit, wie in den übrigen Editoren (`liste-schliessen.test.ts`): eine Wahl blättert zu den Eigenschaften. */
const telefonSeite = ref<"liste" | "eigenschaften">("liste");
const gewaehlt = computed({
    get: () => props.editor.gewaehlt.value,
    set: (key: string | undefined) => {
        // Der Kopf einer Gruppe wählt nichts (`gruppenAlsAbschnitte`); eine Wahl von dort käme hier nicht an.
        if (key === undefined || key.startsWith("gruppe:")) return;
        props.editor.waehle(key);
        if (phoneViewport.value) telefonSeite.value = "eigenschaften";
    },
});
const preset = computed(() => bestand.value?.presets.find((p) => p.id === props.editor.gewaehlt.value));
const symbol = computed(() => bestand.value?.symbole.find((s) => s.id === props.editor.gewaehlt.value));
/** „Wetter bearbeiten · 15. Praios“ wie „Derographie bearbeiten · Koschberge“: das Verb, dann der Name des Gewählten. */
const titel = computed(() => {
    const name = preset.value ? presetName(preset.value) : symbol.value ? symbolName(symbol.value) : undefined;
    return name === undefined ? t("wettereditor.titel") : `${t("wettereditor.titel")} · ${name}`;
});
const eigenschaftenTitel = computed(() =>
    preset.value
        ? t("wettereditor.eigenschaften.preset")
        : symbol.value
          ? t("wettereditor.eigenschaften.icon")
          : t("wettereditor.eigenschaften"),
);
/** Unter dem Titel der Liste: was auf der Karte gerade gilt (Probierseite `geltungSatz`). */
const geltungSatz = computed(() => {
    const jetzt = bestand.value;
    if (jetzt === undefined) return undefined;
    const reise = props.editor.reiseTag.value;
    if (reise === null) return t("wettereditor.geltung.ohneReise");
    const name = (id: string): string => {
        const p = jetzt.presets.find((x) => x.id === id);
        return p === undefined ? id : presetName(p);
    };
    const anteile = [...props.editor.geltung.value.keys()];
    const datum = presetName({ tag: reise });
    if (anteile.length === 1) return t("wettereditor.geltung.eins", { datum, name: name(anteile[0]!) });
    return t("wettereditor.geltung.zwei", { datum, a: name(anteile[0]!), b: name(anteile[1] ?? anteile[0]!) });
});

// ✚ „Anlegen“: das Menü des Hauses (`AvmMenueknopf`) als Handlung, nicht als Wahl. Das Preset steht zuerst, danach die vier Arten von Icons.
const NEU_PRESET = "preset";
const neuOptionen = [
    { wert: NEU_PRESET, text: t("wettereditor.neu.preset") },
    ...WETTER_SYMBOL_ARTEN.map((art) => ({ wert: art, text: artName(art) })),
];
function neuZeichen(wert: string): EditorZeichenName {
    if (wert === NEU_PRESET) return "zeitpunkt";
    return wert === "" ? "hinzufuegen" : ZEICHEN_DER_ART[wert as WetterSymbolArt];
}
function neu(art: string): void {
    if (art === NEU_PRESET) void props.editor.legePresetAn();
    else void props.editor.legeAn(art as WetterSymbolArt);
}
/** Der Papierkorb gilt für ein Icon und für ein angelegtes Preset; für die 14 festen und den Kartenstandard ist er gesperrt (mit Grund im Titel). */
const papierkorbGrund = computed(
    () =>
        papierkorbGrundVon({
            ...(preset.value === undefined ? {} : { preset: preset.value }),
            ...(symbol.value === undefined ? {} : { symbol: symbol.value }),
        }) ?? gesperrt.value,
);
function papierkorb(): void {
    if (symbol.value !== undefined) props.editor.frageEntfernen(symbol.value.id);
    else if (preset.value !== undefined && istEntfernbar(preset.value)) props.editor.frageEntfernen(preset.value.id);
}

function oeffneZeile(key: string): void {
    props.editor.zeige(key);
}

// Der Fuß: „Gespeichert · vor 3 min“ läuft mit der Uhr.
const jetzt = ref(Date.now());
const uhr = setInterval(() => (jetzt.value = Date.now()), 30_000);
onBeforeUnmount(() => clearInterval(uhr));
/** Der Zustand links im Fuß, wie `EntwurfFuss` ihn nennt (Satz ohne Zeichen); rechts, wo die übrigen Editoren „n ungespeichert“ zeigen, der Satz zum Speichern. */
const speicherStand = computed(() => {
    if (props.editor.speicher.stand.value !== "ruhe") return t("wettereditor.speichert");
    const zuletzt = props.editor.speicher.zuletzt.value;
    if (zuletzt === undefined) return t("wettereditor.gespeichert.alles");
    const minuten = Math.floor((Math.max(jetzt.value, Date.now()) - zuletzt) / 60_000);
    return minuten < 1
        ? t("wettereditor.gespeichert.eben")
        : t("wettereditor.gespeichert.vor", { n: formatNumber(minuten, 0) });
});
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
        :hoehe="lage === 'geloest' ? 'inhalt' : undefined"
        :testid="kennung"
        @update:lage="(neueLage, box) => emit('lage', neueLage, box)"
        @update:box="(box) => emit('box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'liste'"
            :id="`${kennung}-listenspalte`"
            :titel="t('wettereditor.liste')"
            :unterzeile="geltungSatz"
            breite="inspektor"
            :telefon="phoneViewport"
            :einziehbar="!phoneViewport"
            :inert="zu || undefined"
            :schliessen="t('fenster.liste.schliessen')"
            :testid="`${kennung}-liste`"
            @schliesse="phoneViewport ? (telefonSeite = 'eigenschaften') : emit('listeZu', true)"
        >
            <p v-if="editor.ladeFehler.value" class="wettereditor__leise">
                {{ editor.ladeFehler.value }}
                <button type="button" class="wettereditor__verweis" @click="editor.lade()">
                    {{ t("editorListe.erneut") }}
                </button>
            </p>
            <p v-else-if="!bestand" class="wettereditor__leise">{{ t("wettereditor.laedt") }}</p>
            <template v-else>
                <EditorListe
                    v-model:gewaehlt="gewaehlt"
                    :zeilen="zeilen"
                    :optionen="WETTER_LISTE"
                    :facetten-name="facettenName"
                    :wert-name="wertName"
                    :sortierungen="sortierungen"
                    :legende="{}"
                    :leer-text="t('wettereditor.leer')"
                    :kennung="`${kennung}-wetter`"
                    :beschriftung="t('wettereditor.liste')"
                    :einstellung="editor.listenEinstellung"
                    @oeffne="oeffneZeile"
                >
                    <template #zeichen>
                        <AvmMenueknopf
                            v-if="darf"
                            class="wettereditor__neu"
                            :model-value="''"
                            :optionen="neuOptionen"
                            :bezeichnung="t('wettereditor.neu')"
                            :menue-bezeichnung="t('wettereditor.neu')"
                            :testid="`${kennung}-neu`"
                            @update:model-value="neu"
                        >
                            <template #zeichen="{ wert }">
                                <EditorZeichen :name="neuZeichen(wert)" />
                            </template>
                        </AvmMenueknopf>
                        <button
                            v-if="darf"
                            type="button"
                            class="wettereditor__zeichen"
                            :aria-label="t('wettereditor.papierkorb')"
                            :title="papierkorbGrund ?? t('wettereditor.papierkorb')"
                            :disabled="papierkorbGrund !== undefined"
                            :data-testid="`${kennung}-papierkorb`"
                            @click="papierkorb"
                        >
                            <EditorZeichen name="loeschen" />
                        </button>
                    </template>
                    <template #legende>
                        <div v-if="legenden" class="wettereditor__legenden" :data-testid="`${kennung}-legenden`">
                            <span class="wettereditor__legende">
                                <span class="wettereditor__wer">{{ t("wettereditor.gruppe.presets") }}</span>
                                <AvmKreisLegende
                                    :namen="legenden.presets.namen"
                                    :zahlen="legenden.presets.zahlen"
                                    :beschriftung="t('wettereditor.gruppe.presets')"
                                />
                            </span>
                            <span class="wettereditor__legende">
                                <span class="wettereditor__wer">{{ t("wettereditor.gruppe.icons") }}</span>
                                <AvmKreisLegende
                                    :namen="legenden.icons.namen"
                                    :zahlen="legenden.icons.zahlen"
                                    :beschriftung="t('wettereditor.gruppe.icons')"
                                />
                            </span>
                        </div>
                    </template>
                </EditorListe>
            </template>
        </FensterSpalte>
        <FensterSpalte
            v-if="!phoneViewport || telefonSeite === 'eigenschaften'"
            :titel="eigenschaftenTitel"
            breite="fuellen"
            :telefon="phoneViewport"
            :testid="`${kennung}-eigenschaften-spalte`"
        >
            <template #zurueck>
                <button
                    v-if="phoneViewport"
                    type="button"
                    class="wettereditor__verweis"
                    :data-testid="`${kennung}-zur-liste`"
                    @click="telefonSeite = 'liste'"
                >
                    {{ t("ortseditor.zurListe") }}
                </button>
                <button
                    v-else
                    type="button"
                    class="wettereditor__listenschalter"
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
            <AvmHinweis
                v-if="editor.meldung.value"
                :ton="editor.meldung.value.ton"
                rolle="alert"
                :testid="`${kennung}-meldung`"
            >
                {{ editor.meldung.value.text }}
                <button
                    type="button"
                    class="wettereditor__verweis"
                    :data-testid="`${kennung}-meldung-zu`"
                    @click="editor.schliesseMeldung()"
                >
                    {{ t("wettereditor.meldung.zu") }}
                </button>
            </AvmHinweis>
            <WetterPresetEigenschaften
                v-if="preset && bestand"
                :preset="preset"
                :presets="bestand.presets"
                :anteil="editor.geltung.value.get(preset.id)"
                :tausch="editor.tausch.value"
                :hinweis="editor.hinweis.value"
                :problem="editor.zeitProblem.value"
                :mitte="editor.kartenMitte()"
                :gesperrt="gesperrt"
                :kennung="kennung"
                :entfernen-frage="editor.entfernenFrage.value === preset.id"
                :laeuft="editor.laeuft.value"
                @wert="(k, wert) => editor.setzeWert(preset!.id, k, wert)"
                @zeitpunkt="(ziel) => editor.setzeZeitpunkt(preset!.id, ziel)"
                @tausch-ja="editor.bestaetigeTausch()"
                @tausch-nein="editor.verwirfTausch()"
                @zuruecknehmen="editor.nimmZurueck()"
                @entfernen-fragen="editor.frageEntfernen(preset!.id)"
                @entfernen-nein="editor.frageEntfernen(undefined)"
                @entfernen-ja="editor.entfernePreset(preset!.id)"
            />
            <WetterIconEigenschaften
                v-else-if="symbol"
                :symbol="symbol"
                :entfernen-frage="editor.entfernenFrage.value === symbol.id"
                :laeuft="editor.laeuft.value"
                :gesperrt="gesperrt"
                :kennung="kennung"
                :wiki-artikel="editor.wikiArtikel.value"
                :wiki-fehler="editor.wikiFehler.value"
                @setze="(aenderungen) => editor.setzeSymbol(symbol!.id, aenderungen)"
                @wiki-brauche="editor.ladeWikiArtikel()"
                @entfernen-fragen="editor.frageEntfernen(symbol!.id)"
                @entfernen-nein="editor.frageEntfernen(undefined)"
                @entfernen-ja="editor.entferne(symbol!.id)"
            />
            <p v-else-if="bestand" class="wettereditor__leise">{{ t("wettereditor.keineWahl") }}</p>
        </FensterSpalte>
        <template #fuss-hinweis>
            <span :data-stand="editor.speicher.stand.value" :data-testid="`${kennung}-fuss`">{{ speicherStand }}</span>
        </template>
        <template #fuss-haupt>
            <span class="wettereditor__sofort" :data-testid="`${kennung}-sofort`">{{ t("wettereditor.fuss") }}</span>
        </template>
    </AvmFenster>
</template>

<style scoped>
.wettereditor__leise {
    margin: 0;
    padding: var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wettereditor__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.wettereditor__verweis:hover {
    color: var(--color-link-hover);
}

.wettereditor__verweis:focus-visible,
.wettereditor__zeichen:focus-visible,
.wettereditor__listenschalter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wettereditor__neu {
    margin-left: var(--space-4);
}

/* Der Papierkorb in der Leiste, in der Fassung von Trichter und Sortierung (wie im Ortseditor). */
.wettereditor__zeichen {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    margin: 0 0 0 var(--space-4);
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.wettereditor__zeichen:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.wettereditor__zeichen:active:not(:disabled) {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.wettereditor__zeichen:disabled {
    border-color: var(--color-disabled-border);
    background-color: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: default;
}

.wettereditor__listenschalter {
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
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.wettereditor__listenschalter:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.wettereditor__listenschalter:active {
    background: var(--color-active-wash);
}

/* Die zwei Legenden unter der Liste: je der Name der Gruppe, dann ihre Zustände. */
.wettereditor__legenden {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.wettereditor__legende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
}

.wettereditor__wer {
    color: var(--color-text);
    font-size: var(--font-size-caption);
}

/* Rechts im Fuß, in der Fassung von „n ungespeichert“ der übrigen Editoren (`entwurf-fuss.vue`). */
.wettereditor__sofort {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
    .wettereditor__verweis,
    .wettereditor__zeichen,
    .wettereditor__listenschalter {
        transition: none;
    }
}
</style>
