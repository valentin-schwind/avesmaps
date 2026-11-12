<script setup lang="ts">
import { computed, useId } from "vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { LOCALES, t } from "../i18n/i18n";
import {
    FORMATE,
    INHALTE,
    ZUSAETZE,
    type Inhalt,
    type KartenWahl,
    type ReisePdfEinstellungen,
    type WahlSerie,
} from "./einstellungen";
import ReisePdfKartenwahl from "./reise-pdf-kartenwahl.vue";
import ReisePdfZeichen from "./reise-pdf-zeichen.vue";

/**
 * Die Einstellungen von „Reise als PDF“ (WI-0306, Entwurf Fassung 6), links im Fenster, im Ton des Formulars der Reisebilder
 * (`photobox/formular-stil.css`): Kartenbild, „Was soll hinein?“, Papier, „Titel, Sprache und Datei“. Jede Änderung schreibt in das EINE
 * Objekt der Einstellungen, das das Fenster hält; die Vorschau folgt von selbst.
 *
 * - **Kacheln mit Häkchen** zählen nur, was diese Reise trägt („6 von 8“); eine Kachel ohne Daten (keine Kosten, kein Schiff …) ist gesperrt.
 * - Unter „Etappen“ die Art („Kurz, je Abschnitt“ | „Jede Etappe“) und die Zusätze als kleine Schalter; unter „Reisetagebuch“ das Wetter.
 * - Die Sprache des PDFs ist jede Sprache der Seite, vorgewählt die gerade gezeigte; der Dateiname trägt die feste Endung „.pdf“.
 */
const props = defineProps<{
    einstellungen: ReisePdfEinstellungen;
    serien: readonly WahlSerie[];
    jetzt?: KartenWahl | undefined;
    verfuegbar: Readonly<Record<Inhalt, boolean>>;
    zaehler: { gewaehlt: number; von: number };
    kartenVorschau?: string | undefined;
    nimmtAuf: boolean;
    aufnahmeFehler: boolean;
    ohneKarte: boolean;
    politischBereit: boolean;
    telefon: boolean;
}>();
/** Die Einstellungen sind EIN reaktives Objekt, das das Fenster hält; die Felder hier schreiben hinein. */
const e = props.einstellungen;
const kennung = useId();

const etappenArten = computed(() => [
    { value: "kurz", label: t("reisePdf.etappen.kurz") },
    { value: "lang", label: t("reisePdf.etappen.lang") },
]);
const etappenArt = computed({
    get: () => e.etappenArt,
    set: (wert: string) => {
        if (wert === "kurz" || wert === "lang") e.etappenArt = wert;
    },
});
const lagen = computed(() => [
    { value: "hoch", label: t("reisePdf.lage.hoch") },
    { value: "quer", label: t("reisePdf.lage.quer") },
]);
const lage = computed({
    get: () => e.lage,
    set: (wert: string) => {
        if (wert === "hoch" || wert === "quer") e.lage = wert;
    },
});
const PAPIERE = ["pergament", "weiss"] as const;
</script>

<template>
    <div class="rb rp" :class="{ 'rb--telefon': telefon }" data-testid="reise-pdf-einstellungen">
        <ReisePdfKartenwahl
            :einstellungen="e"
            :serien="serien"
            :jetzt="jetzt"
            :vorschau="kartenVorschau"
            :nimmt-auf="nimmtAuf"
            :fehler="aufnahmeFehler"
            :ohne-karte="ohneKarte"
            :politisch-bereit="politischBereit"
        />

        <fieldset class="rb__abschnitt" data-testid="reise-pdf-inhalt">
            <legend class="rb__titel">
                <img class="rb__sym" src="/icons/route/Wegweiser.webp" alt="" />{{ t("reisePdf.inhalt.titel") }}
                <span class="rb__zaehler" data-testid="reise-pdf-zaehler">{{
                    t("reisePdf.inhalt.zaehler", { n: zaehler.gewaehlt, m: zaehler.von })
                }}</span>
            </legend>
            <div class="rb__chips">
                <label
                    v-for="name in INHALTE"
                    :key="name"
                    class="rb__chip rp-chip"
                    :title="verfuegbar[name] ? undefined : t('reisePdf.inhalt.fehlt')"
                    :data-testid="`reise-pdf-inhalt-${name}`"
                >
                    <input
                        v-model="e.inhalt[name]"
                        class="rb__chipwahl"
                        type="checkbox"
                        :disabled="!verfuegbar[name]"
                    />
                    <ReisePdfZeichen :name="name" />
                    <span class="rp-chip__wort">{{ t(`reisePdf.inhalt.${name}`) }}</span>
                    <span class="rp-chip__haken" aria-hidden="true"></span>
                </label>
            </div>
            <div v-if="e.inhalt.etappen && verfuegbar.etappen" class="rp-unter" data-testid="reise-pdf-etappen">
                <span class="rp-unter__zeile">
                    <span :id="`${kennung}-etappen`">{{ t("reisePdf.etappen.label") }}</span>
                    <AvmSegmente
                        v-model="etappenArt"
                        :options="etappenArten"
                        :label="t('reisePdf.etappen.label')"
                        testid="reise-pdf-etappenart"
                        eng
                    />
                </span>
                <span class="rp-unter__zeile">
                    <span>{{ t("reisePdf.dazu.label") }}</span>
                    <button
                        v-for="zusatz in ZUSAETZE"
                        :key="zusatz"
                        type="button"
                        class="rp-mini"
                        :aria-pressed="e.zusaetze[zusatz]"
                        :data-testid="`reise-pdf-dazu-${zusatz}`"
                        @click="e.zusaetze[zusatz] = !e.zusaetze[zusatz]"
                    >
                        {{ t(`reisePdf.dazu.${zusatz}`) }}
                    </button>
                </span>
            </div>
            <div v-if="e.inhalt.tagebuch && verfuegbar.tagebuch" class="rp-unter" data-testid="reise-pdf-tagebuch">
                <span class="rp-unter__zeile">
                    <span>{{ t("reisePdf.inhalt.tagebuch") }}</span>
                    <button
                        type="button"
                        class="rp-mini"
                        :aria-pressed="e.wetter"
                        data-testid="reise-pdf-wetter"
                        @click="e.wetter = !e.wetter"
                    >
                        {{ t("reisePdf.tagebuch.wetter") }}
                    </button>
                </span>
            </div>
        </fieldset>

        <fieldset class="rb__abschnitt" data-testid="reise-pdf-papier">
            <legend class="rb__titel">
                <ReisePdfZeichen class="rb__sym rp-sym" name="papier" />{{ t("reisePdf.papier.titel") }}
            </legend>
            <div class="rb__zeile">
                <label class="rp-feld" :for="`${kennung}-format`">
                    <span class="rp-feld__name">{{ t("reisePdf.papier.format") }}</span>
                    <span class="rb__wahl">
                        <select
                            :id="`${kennung}-format`"
                            v-model="e.format"
                            class="rb__eingabe"
                            data-testid="reise-pdf-format"
                        >
                            <option v-for="format in FORMATE" :key="format" :value="format">
                                {{ t(`reisePdf.format.${format}`) }}
                            </option>
                        </select>
                    </span>
                </label>
                <div class="rp-feld">
                    <span class="rp-feld__name">{{ t("reisePdf.papier.lage") }}</span>
                    <AvmSegmente
                        v-model="lage"
                        :options="lagen"
                        :label="t('reisePdf.papier.lage')"
                        testid="reise-pdf-lage"
                    />
                </div>
            </div>
            <div class="rb__chips" role="radiogroup" :aria-label="t('reisePdf.papier.ton')">
                <label
                    v-for="papier in PAPIERE"
                    :key="papier"
                    class="rb__chip"
                    :data-testid="`reise-pdf-papier-${papier}`"
                >
                    <input
                        v-model="e.papier"
                        class="rb__chipwahl"
                        type="radio"
                        :name="`${kennung}-papier`"
                        :value="papier"
                    />
                    <ReisePdfZeichen :name="papier" />{{ t(`reisePdf.papier.${papier}`) }}
                </label>
            </div>
        </fieldset>

        <fieldset class="rb__abschnitt" data-testid="reise-pdf-datei">
            <legend class="rb__titel">
                <img class="rb__sym" src="/icons/menu/linkteilen.webp" alt="" />{{ t("reisePdf.datei.titel") }}
            </legend>
            <label class="rp-feld" :for="`${kennung}-titel`">
                <span class="rp-feld__name">{{ t("reisePdf.feld.titel") }}</span>
                <input
                    :id="`${kennung}-titel`"
                    v-model="e.titel"
                    class="rb__eingabe"
                    type="text"
                    data-testid="reise-pdf-titel"
                />
            </label>
            <label class="rp-feld" :for="`${kennung}-notiz`">
                <span class="rp-feld__name"
                    >{{ t("reisePdf.feld.notiz") }} <span class="rb__frei">{{ t("reisePdf.feld.frei") }}</span></span
                >
                <input
                    :id="`${kennung}-notiz`"
                    v-model="e.notiz"
                    class="rb__eingabe"
                    type="text"
                    maxlength="240"
                    :placeholder="t('reisePdf.feld.notizPlatz')"
                    data-testid="reise-pdf-notiz"
                />
            </label>
            <div class="rb__zeile">
                <label class="rp-feld" :for="`${kennung}-sprache`">
                    <span class="rp-feld__name">{{ t("reisePdf.feld.sprache") }}</span>
                    <span class="rb__wahl">
                        <select
                            :id="`${kennung}-sprache`"
                            v-model="e.sprache"
                            class="rb__eingabe"
                            data-testid="reise-pdf-sprache"
                        >
                            <option v-for="sprache in LOCALES" :key="sprache" :value="sprache">
                                {{ t(`lang.name.${sprache}`) }}
                            </option>
                        </select>
                    </span>
                </label>
                <label class="rp-feld" :for="`${kennung}-datei`">
                    <span class="rp-feld__name">{{ t("reisePdf.feld.datei") }}</span>
                    <span class="rp-datei">
                        <input
                            :id="`${kennung}-datei`"
                            v-model="e.datei"
                            class="rb__eingabe"
                            type="text"
                            maxlength="120"
                            data-testid="reise-pdf-dateiname"
                        />
                        <span class="rp-datei__endung" aria-hidden="true">{{ t("reisePdf.feld.endung") }}</span>
                    </span>
                </label>
            </div>
        </fieldset>
    </div>
</template>

<style scoped src="../photobox/formular-stil.css"></style>
<style scoped>
.rp {
    padding: var(--space-10) var(--space-12) var(--space-12);
}

.rp-sym {
    color: var(--color-accent-strong);
}

.rp-feld {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.rp-feld__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Kachel mit Häkchen rechts (Entwurf `.haken`): Kästchen in Kanonfarbe, gefüllt, wenn gewählt. */
.rp-chip {
    font-size: var(--font-size-body);
    hyphens: manual;
}

.rp-chip__wort {
    min-width: 0;
}

.rp-chip__haken {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-left: auto;
    box-sizing: border-box;
    border: 2px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.rp-chip__haken::after {
    content: "";
    width: var(--space-4);
    height: calc(var(--space-2) * 0.75);
    border-bottom: 2px solid var(--color-page-bg-deep);
    border-left: 2px solid var(--color-page-bg-deep);
    transform: rotate(-45deg) translate(calc(var(--space-2) / 4), calc(var(--space-2) / -4));
    visibility: hidden;
}

.rp-chip:has(input:checked) .rp-chip__haken {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.rp-chip:has(input:checked) .rp-chip__haken::after {
    visibility: visible;
}

.rp-chip:has(input:disabled) .rp-chip__haken {
    border-color: var(--color-disabled-border);
}

/* Die Unterzeilen unter „Etappen“ und „Reisetagebuch“: leise, auf der weichen Fläche. */
.rp-unter {
    display: grid;
    gap: var(--space-4);
    margin-top: calc(-1 * var(--space-2));
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rp-unter__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-4);
}

/* Die kleinen Schalter („Dazu“, Wetter): eine Pille mit Kästchen, gedrückt goldbraun. */
.rp-mini {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--avm-control-h);
    background: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease;
}

.rp-mini::before {
    content: "";
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
    box-sizing: border-box;
    border: 2px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
}

.rp-mini:hover {
    border-color: var(--color-accent);
}

.rp-mini:active {
    background: var(--color-active-wash);
}

.rp-mini[aria-pressed="true"] {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel));
    color: var(--color-text-strong);
}

.rp-mini[aria-pressed="true"]::before {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.rp-mini:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Der Dateiname mit der festen Endung „.pdf“ rechts im selben Feld. */
.rp-datei {
    display: flex;
    min-width: 0;
}

.rp-datei .rb__eingabe {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}

.rp-datei__endung {
    display: grid;
    flex: none;
    place-items: center;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-left: 0;
    border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    background: var(--color-panel-muted);
    color: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
    .rp-chip__haken,
    .rp-mini {
        transition: none;
    }
}
</style>
