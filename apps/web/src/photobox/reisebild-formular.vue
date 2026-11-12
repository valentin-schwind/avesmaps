<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useTemplateRef, watch } from "vue";
import {
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_USAGE_GRANTS,
    type PhotoboxCreationKind,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import type { ReisebildHinweisZiel } from "../legal/hinweise-ziel";
import type { BildWahl } from "./bild-wahl";
import { BILD_TYPEN } from "./bild";
import { BEZUG_RUHE_MS, letztesWort, sucheBezuege, type BezugWahl } from "./bezug-suche";
import {
    nutzungGesperrt,
    richtungAusWert,
    richtungWert,
    waehleEntstehung,
    zeichen,
    type PflichtFeld,
    type ReisebildEntwurf,
} from "./formular-modell";
import { ENTSTEHUNG_ZEICHEN, NUTZUNG_ZEICHEN, REISEBILD_SYMBOLE } from "./reisebild-zeichen";
import ReisebildZeichen from "./reisebild-zeichen.vue";
import { BLICK_RICHTUNGEN } from "./stelle-text";

/**
 * Der Rumpf des Formulars „Eigenes Bild hinzufügen“ (WI-0272 S2b Aufgabe 13; Gestaltung: Probierseite Entwurf 8, vom Betreiber abgenommen am 2026-11-01: „perfekt, jetzt hast du verstanden
 * was ich will.“). Die Hülle, der Zustand (Entwurf, Absenden, Höhe) und der Fuß mit „Bild hochladen“ stehen in `reisebild-fenster.vue`, was gerechnet wird in `formular-modell.ts`.
 *
 * - **Reihenfolge wie WI §5.1:** Stelle (gemalte Nadel, „Stelle ändern“), Bild, Bildbeschreibung mit Bezugsvorschlägen, Entstanden als, Blickrichtung und Name nebeneinander, Nutzung samt
 *   Erklärung, Erklärung als Häkchen. Pflicht sind das Bild, die Beschreibung, „Entstanden als“ und das Häkchen; das fehlende Feld markiert und fokussiert der Aufrufer (`fehlt`, `fokussiere`),
 *   sobald jemand auf den gesperrten Knopf drückt.
 * - **Das Bild:** Die ganze Ablagefläche ist der Knopf (auch zum Ablegen mit der Maus); nach der Wahl füllt die Vorschau denselben Platz (eingepasst, nie abgedunkelt, Guide §30.2), darunter
 *   der Dateiname mit „Anderes Bild“ und „Entfernen“. Die Fläche ist immer gleich hoch, damit das Fenster nicht wächst. Gelesen wird im Browser (`bild-wahl.ts`, `bild.ts`).
 * - **Bezug aus der Suche** läuft beim Tippen mit (ab drei Zeichen, nach 250 ms Ruhe, höchstens fünf Treffer); ein Klick macht den Treffer zum Bezug.
 * - **Blickrichtung** ist eine Auswahlliste (ohne, Norden, Nordosten …), kein Kompassgitter mehr.
 * - **Nutzung:** Vorgabe „Nur für Avesmaps“, wählbar „CC BY 4.0“; bei einer Avesmaps-Aufnahme ist CC BY gesperrt, mit dem Satz dazu (WI §12 Frage 2b). Die Erklärung der Wahl steht immer da: Sie sagt,
 *   welche Rechte mit ihr eingeräumt werden.
 * - **Honigtopf** (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht (aus der Tab-Folge, `aria-hidden`, `inert`, nicht `display: none`); der Aufrufer schickt es mit.
 * - Alle Maße kommen aus dem Kanon (`--space-*`, `--icon-*`); Zustände nach Guide §30.5: Ruhe, Hover, Aktiv, Fokus, Gesperrt, 120 bis 180 ms, nie Deckkraft als Hover.
 */
const props = defineProps<{
    entwurf: ReisebildEntwurf;
    /** Die Stelle in Worten („nordöstlich von Gareth“). */
    stelleWorte: string;
    bildWahl: BildWahl;
    /** Das Pflichtfeld, das nach einem Druck auf den gesperrten Knopf fehlt: Es trägt den Warnrand. */
    fehlt?: PflichtFeld | undefined;
}>();
/** Der Entwurf ist EIN reaktives Objekt, das die Hülle anlegt und hält; die Felder hier schreiben hinein (der Alias macht das für die Prüfung der Vorlage sichtbar). */
const entwurf = props.entwurf;
const emit = defineEmits<{
    "stelle-aendern": [];
    /** „Bedingungen“ im Häkchen der Erklärung: der Weg zu „Hinweise › Reisebilder“. */
    hinweise: [ziel: ReisebildHinweisZiel];
}>();

const kennungId = useId();
const dateiFeld = useTemplateRef<HTMLInputElement>("dateiFeld");
const ablageKnopf = useTemplateRef<HTMLButtonElement>("ablageKnopf");
const bildAbschnitt = useTemplateRef<HTMLElement>("bildAbschnitt");
const textAbschnitt = useTemplateRef<HTMLElement>("textAbschnitt");
const textFeld = useTemplateRef<HTMLTextAreaElement>("textFeld");
const entstehungGruppe = useTemplateRef<HTMLElement>("entstehungGruppe");
const hakenZeile = useTemplateRef<HTMLElement>("hakenZeile");
const hakenFeld = useTemplateRef<HTMLInputElement>("hakenFeld");
const ueberDerAblage = ref(false);

/**
 * Esc in einem Feld mit Geschriebenem schließt das Fenster nicht: Eine Beschreibung wäre mit einem Tastendruck weg (✕ bleibt der ausdrückliche Weg). Ohne Geschriebenes geht Esc wie bei jedem
 * Werkzeugfenster an die Hülle.
 */
function escImFormular(event: KeyboardEvent): void {
    if (entwurf.text.trim() !== "" || entwurf.name.trim() !== "" || entwurf.bild !== undefined) event.stopPropagation();
}

// --- Das Bild ------------------------------------------------------------------------------------------------------------------

function dateiGewaehlt(event: Event): void {
    const feld = event.target as HTMLInputElement;
    void props.bildWahl.waehle(feld.files?.[0]);
    // Dieselbe Datei noch einmal wählen soll wieder ein Ereignis geben.
    feld.value = "";
}
function beimAblegen(event: DragEvent): void {
    ueberDerAblage.value = false;
    void props.bildWahl.waehle(event.dataTransfer?.files?.[0]);
}
const bildLiest = computed(() => props.bildWahl.laedt.value);

// --- Der Bezug aus der Suche -----------------------------------------------------------------------------------------------

const vorschlaege = ref<BezugWahl[]>([]);
let suchUhr: ReturnType<typeof setTimeout> | undefined;
let suchAbbruch: AbortController | undefined;

/** Das letzte Wort der Beschreibung sucht nach 250 ms Ruhe; ist ein Bezug gewählt, ruht die Suche. */
function planeSuche(): void {
    clearTimeout(suchUhr);
    suchAbbruch?.abort();
    const wort = letztesWort(entwurf.text);
    if (wort === undefined || entwurf.bezug !== undefined) {
        vorschlaege.value = [];
        return;
    }
    suchUhr = setTimeout(() => {
        const abbruch = new AbortController();
        suchAbbruch = abbruch;
        void sucheBezuege(wort, abbruch.signal)
            .then((treffer) => {
                if (!abbruch.signal.aborted) vorschlaege.value = treffer;
            })
            .catch(() => {
                if (!abbruch.signal.aborted) vorschlaege.value = [];
            });
    }, BEZUG_RUHE_MS);
}
watch([() => entwurf.text, () => entwurf.bezug], planeSuche);
onBeforeUnmount(() => {
    clearTimeout(suchUhr);
    suchAbbruch?.abort();
});

function waehleBezug(wahl: BezugWahl): void {
    entwurf.bezug = wahl;
    vorschlaege.value = [];
}

// --- Entstanden als, Blickrichtung, Nutzung --------------------------------------------------------------------------------

const arten = PHOTOBOX_CREATION_KINDS.map((wert) => ({
    wert,
    text: `photobox.entstehung.${wert}` as MessageKey,
    zeichen: ENTSTEHUNG_ZEICHEN[wert],
}));
const nutzungen = PHOTOBOX_USAGE_GRANTS.map((wert) => ({
    wert,
    text: `photobox.nutzung.${wert}` as MessageKey,
    zeichen: NUTZUNG_ZEICHEN[wert],
    sperre: computed(() => nutzungGesperrt(entwurf, wert)),
}));
/** Der Satz, warum CC BY gerade gesperrt ist: einmal unter der Wahl, nicht an jedem gesperrten Chip. */
const nutzungGrund = computed(() => {
    const grund = nutzungen.map((nutzung) => nutzung.sperre.value).find((satz) => satz !== undefined);
    return grund === undefined ? undefined : t(grund);
});
const nutzungsErklaerung = computed(() => t(`photobox.nutzung.erklaerung.${entwurf.nutzung}` as MessageKey));

function waehleArt(art: PhotoboxCreationKind): void {
    waehleEntstehung(entwurf, art);
}

/** Die Auswahl der Blickrichtung: „ohne“, dann die acht Himmelsrichtungen von Norden im Uhrzeigersinn (die Zahl ist der Wert 0 bis 7 des Entwurfs). */
const richtungen = BLICK_RICHTUNGEN.map((kurz, nr) => ({
    wert: String(nr),
    text: `photobox.blick.wahl.${kurz}` as MessageKey,
}));
function waehleRichtung(event: Event): void {
    entwurf.richtung = richtungAusWert((event.target as HTMLSelectElement).value);
}

// --- Das fehlende Feld in Sicht und im Fokus -------------------------------------------------------------------------------

/**
 * Das fehlende Pflichtfeld in Sicht rollen (der Rumpf rollt, der Fuß mit dem Knopf bleibt) und den Fokus hineinsetzen. Bei „Entstanden als“ steht er auf der ersten Wahl. Ohne
 * Rollbewegung bei „weniger Bewegung“.
 */
function fokussiere(feld: PflichtFeld): void {
    const ziel: Record<PflichtFeld, { rahmen: HTMLElement | null; fokus: HTMLElement | null }> = {
        bild: { rahmen: bildAbschnitt.value, fokus: ablageKnopf.value },
        text: { rahmen: textAbschnitt.value, fokus: textFeld.value },
        entstehung: { rahmen: entstehungGruppe.value, fokus: entstehungGruppe.value?.querySelector("input") ?? null },
        haken: { rahmen: hakenZeile.value, fokus: hakenFeld.value },
    };
    const { rahmen, fokus } = ziel[feld];
    const reduziert = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    rahmen?.scrollIntoView?.({ block: "nearest", behavior: reduziert ? "auto" : "smooth" });
    fokus?.focus({ preventScroll: true });
}
defineExpose({ fokussiere });
</script>

<template>
    <form
        class="rb"
        :class="{ 'rb--telefon': phoneViewport }"
        data-testid="reisebild-formular"
        novalidate
        @keydown.esc="escImFormular"
        @submit.prevent
    >
        <!-- Stelle: gemalte Nadel, der Ort in Worten, „Stelle ändern“ -->
        <p class="rb__stelle" data-testid="reisebild-stelle">
            <img class="rb__nadel" :src="REISEBILD_SYMBOLE.pin" alt="" aria-hidden="true" decoding="async" />
            <span class="rb__nur-vorleser">{{ t("photobox.stelle.label") }}</span>
            <span class="rb__ort" data-testid="reisebild-stelle-text">{{ props.stelleWorte }}</span>
            <AvmKnopf groesse="zeile" testid="reisebild-stelle-aendern" @click="emit('stelle-aendern')">{{
                t("photobox.stelle.aendern")
            }}</AvmKnopf>
        </p>

        <!-- Bild: die ganze Fläche ist der Knopf; nach der Wahl füllt die Vorschau denselben Platz -->
        <div
            ref="bildAbschnitt"
            class="rb__abschnitt"
            :class="{ 'is-fehlt': props.fehlt === 'bild' }"
            role="group"
            :aria-label="t('photobox.bild.label')"
            data-testid="reisebild-bild"
        >
            <div
                class="rb__platz"
                :class="{ 'is-drueber': ueberDerAblage }"
                data-testid="reisebild-ablage"
                @dragenter.prevent="ueberDerAblage = true"
                @dragover.prevent="ueberDerAblage = true"
                @dragleave="ueberDerAblage = false"
                @drop.prevent="beimAblegen"
            >
                <figure v-if="entwurf.bild !== undefined" class="rb__bild">
                    <div class="rb__rahmen">
                        <img
                            v-if="props.bildWahl.vorschauUrl.value !== undefined"
                            :src="props.bildWahl.vorschauUrl.value"
                            :alt="t('photobox.bild.alt')"
                            data-testid="reisebild-vorschau"
                        />
                    </div>
                    <figcaption>
                        <span class="rb__dateiname einzeilig" :title="entwurf.bild.anzeigeName">{{
                            entwurf.bild.anzeigeName
                        }}</span>
                        <button
                            type="button"
                            class="rb__leise"
                            data-testid="reisebild-bild-anderes"
                            @click="dateiFeld?.click()"
                        >
                            {{ t("photobox.bild.anderes") }}
                        </button>
                        <button
                            type="button"
                            class="rb__leise"
                            data-testid="reisebild-bild-entfernen"
                            @click="props.bildWahl.entferne()"
                        >
                            {{ t("photobox.bild.entfernen") }}
                        </button>
                    </figcaption>
                </figure>
                <button
                    v-else
                    ref="ablageKnopf"
                    type="button"
                    class="rb__ablage"
                    :disabled="bildLiest"
                    data-testid="reisebild-bild-waehlen"
                    @click="dateiFeld?.click()"
                >
                    <span class="rb__ablage-symbol">
                        <img
                            class="rb__ablage-bild"
                            :src="REISEBILD_SYMBOLE.bildmachen"
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                        />
                        <span class="rb__plus"><ReisebildZeichen name="plus" /></span>
                    </span>
                    <span class="rb__ablage-titel">{{
                        bildLiest ? t("photobox.bild.liest") : t("photobox.bild.waehlen")
                    }}</span>
                    <span class="rb__ablage-ziehen">{{ t("photobox.bild.ablage") }}</span>
                    <span class="rb__ablage-formate">{{ t("photobox.bild.formate") }}</span>
                </button>
            </div>
            <input
                ref="dateiFeld"
                class="rb__datei"
                type="file"
                :accept="BILD_TYPEN.join(',')"
                tabindex="-1"
                aria-hidden="true"
                data-testid="reisebild-datei"
                @change="dateiGewaehlt"
            />
            <AvmHinweis
                v-if="props.bildWahl.fehler.value !== undefined"
                ton="gefahr"
                rolle="alert"
                testid="reisebild-bild-fehler"
            >
                {{ t(props.bildWahl.fehler.value) }}
            </AvmHinweis>
        </div>

        <!-- Bildbeschreibung und Bezug -->
        <div ref="textAbschnitt" class="rb__abschnitt">
            <div class="rb__titel">
                <label :for="`${kennungId}-text`">
                    <img
                        class="rb__sym"
                        :src="REISEBILD_SYMBOLE.papierundfeder"
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                    />
                    {{ t("photobox.text.label") }}
                </label>
                <span class="rb__hinweis">{{ t("photobox.text.hinweis") }}</span>
                <span class="rb__zaehler" data-testid="reisebild-text-zaehler">{{
                    t("photobox.text.zaehler", {
                        n: zeichen(entwurf.text),
                        max: PHOTOBOX_LIMITS.descriptionMax,
                    })
                }}</span>
            </div>
            <textarea
                :id="`${kennungId}-text`"
                ref="textFeld"
                v-model="entwurf.text"
                class="rb__eingabe"
                :class="{ 'is-fehlt': props.fehlt === 'text' }"
                rows="3"
                :maxlength="PHOTOBOX_LIMITS.descriptionMax"
                :placeholder="t('photobox.text.platzhalter')"
                data-testid="reisebild-text"
            ></textarea>
            <div
                v-if="entwurf.bezug !== undefined || vorschlaege.length > 0"
                class="rb__vorschlaege"
                data-testid="reisebild-vorschlaege"
            >
                <template v-if="entwurf.bezug !== undefined">
                    <span class="rb__leisetext">{{ t("photobox.bezug.zeigt") }}</span>
                    <span class="rb__bezug" data-testid="reisebild-bezug">
                        {{ entwurf.bezug.name }} <span>· {{ entwurf.bezug.typ }}</span>
                        <button
                            type="button"
                            :aria-label="t('photobox.bezug.entfernen')"
                            :title="t('photobox.bezug.entfernen')"
                            data-testid="reisebild-bezug-weg"
                            @click="entwurf.bezug = undefined"
                        >
                            ✕
                        </button>
                    </span>
                </template>
                <template v-else>
                    <span class="rb__leisetext">{{ t("photobox.bezug.vorschlaege") }}</span>
                    <button
                        v-for="wahl in vorschlaege"
                        :key="`${wahl.art}-${wahl.id}`"
                        type="button"
                        class="rb__vorschlag"
                        data-testid="reisebild-vorschlag"
                        @click="waehleBezug(wahl)"
                    >
                        {{ wahl.name }} <span>· {{ wahl.typ }}</span>
                    </button>
                </template>
            </div>
        </div>

        <!-- Entstanden als -->
        <div ref="entstehungGruppe" class="rb__abschnitt" data-testid="reisebild-entstehung">
            <span :id="`${kennungId}-art`" class="rb__titel">{{ t("photobox.entstehung.label") }}</span>
            <div
                class="rb__chips"
                :class="{ 'is-fehlt': props.fehlt === 'entstehung' }"
                role="radiogroup"
                :aria-labelledby="`${kennungId}-art`"
            >
                <label
                    v-for="art in arten"
                    :key="art.wert"
                    class="rb__chip"
                    :data-testid="`reisebild-entstehung-${art.wert}`"
                >
                    <input
                        class="rb__chipwahl"
                        type="radio"
                        name="reisebild-entstehung"
                        :value="art.wert"
                        :checked="entwurf.entstehung === art.wert"
                        @change="waehleArt(art.wert)"
                    />
                    <ReisebildZeichen :name="art.zeichen" />
                    <span>{{ t(art.text) }}</span>
                </label>
            </div>
        </div>

        <!-- Blickrichtung und Name nebeneinander -->
        <div class="rb__zeile">
            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-blick`">
                    <img class="rb__sym" :src="REISEBILD_SYMBOLE.kompass" alt="" aria-hidden="true" decoding="async" />
                    {{ t("photobox.blick.titel") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <div class="rb__wahl">
                    <select
                        :id="`${kennungId}-blick`"
                        class="rb__eingabe rb__eingabe--wahl"
                        :value="richtungWert(entwurf.richtung)"
                        data-testid="reisebild-blick"
                        @change="waehleRichtung"
                    >
                        <option value="">{{ t("photobox.blick.ohne") }}</option>
                        <option v-for="richtung in richtungen" :key="richtung.wert" :value="richtung.wert">
                            {{ t(richtung.text) }}
                        </option>
                    </select>
                    <ReisebildZeichen name="pfeil" class="rb__pfeil" />
                </div>
            </div>
            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-name`">
                    <img class="rb__sym" :src="REISEBILD_SYMBOLE.feder" alt="" aria-hidden="true" decoding="async" />
                    {{ t("photobox.name.label") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <input
                    :id="`${kennungId}-name`"
                    v-model="entwurf.name"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="PHOTOBOX_LIMITS.attributionMax"
                    :placeholder="t('photobox.name.platzhalter')"
                    autocomplete="nickname"
                    data-testid="reisebild-name"
                />
            </div>
        </div>

        <!-- Nutzung -->
        <div class="rb__abschnitt" data-testid="reisebild-nutzung">
            <span :id="`${kennungId}-nutzung`" class="rb__titel">{{ t("photobox.nutzung.label") }}</span>
            <div class="rb__chips" role="radiogroup" :aria-labelledby="`${kennungId}-nutzung`">
                <label
                    v-for="nutzung in nutzungen"
                    :key="nutzung.wert"
                    class="rb__chip"
                    :title="nutzung.sperre.value === undefined ? undefined : t(nutzung.sperre.value)"
                    :data-testid="`reisebild-nutzung-${nutzung.wert}`"
                >
                    <input
                        class="rb__chipwahl"
                        type="radio"
                        name="reisebild-nutzung"
                        :value="nutzung.wert"
                        :checked="entwurf.nutzung === nutzung.wert"
                        :disabled="nutzung.sperre.value !== undefined"
                        :aria-describedby="
                            nutzung.sperre.value === undefined ? undefined : `${kennungId}-nutzung-grund`
                        "
                        @change="entwurf.nutzung = nutzung.wert"
                    />
                    <ReisebildZeichen :name="nutzung.zeichen" />
                    <span>{{ t(nutzung.text) }}</span>
                </label>
            </div>
            <p
                v-if="nutzungGrund !== undefined"
                :id="`${kennungId}-nutzung-grund`"
                class="rb__satz"
                data-testid="reisebild-nutzung-grund"
            >
                {{ nutzungGrund }}
            </p>
            <p class="rb__satz" data-testid="reisebild-nutzung-erklaerung">{{ nutzungsErklaerung }}</p>
        </div>

        <!-- Erklärung -->
        <label
            ref="hakenZeile"
            class="rb__haken"
            :class="{ 'is-fehlt': props.fehlt === 'haken' }"
            data-testid="reisebild-haken"
        >
            <input
                ref="hakenFeld"
                class="rb__haken-feld"
                type="checkbox"
                :checked="entwurf.haken"
                @change="entwurf.haken = ($event.target as HTMLInputElement).checked"
            />
            <span class="rb__haken-kasten" aria-hidden="true"><ReisebildZeichen name="haken" /></span>
            <span class="rb__haken-text"
                >{{ t("photobox.haken.vor")
                }}<button
                    type="button"
                    class="rb__verweis"
                    data-testid="reisebild-bedingungen"
                    @click="emit('hinweise', 'reisebilder')"
                >
                    {{ t("photobox.haken.link") }}</button
                >{{ t("photobox.haken.nach") }}</span
            >
        </label>

        <!-- Der Honigtopf: für Menschen nicht erreichbar (aus der Tab-Folge, versteckt vor Vorlesern, träge), aber im Dokument; nicht `display: none`. -->
        <div class="rb__honig" aria-hidden="true" inert data-testid="reisebild-honig">
            <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
        </div>
    </form>
</template>

<style scoped src="./formular-stil.css"></style>
