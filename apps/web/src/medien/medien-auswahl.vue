<script setup lang="ts">
import { useId } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import type { AuswahlEintrag } from "./medien-auswahl-modell";
import type { BindbareRolle } from "./medien-formular-modell";

/**
 * Die Auswahl eines Wappens oder Titelbilds aus der Medienverwaltung (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 7): nur der Rumpf,
 * das Fenster drumherum (`medien-auswahl-fenster.vue`) lädt, bindet und wechselt zum Hochladen.
 *
 * - **Wappen als Liste** (Betreiber 2026-10-10: „mach die wappen als liste“): je Zeile das Wappen links, Name mit „gebunden“ und
 *   „hochgeladen von … · Datum“, rechts Rechte, Verwendungen und gegebenenfalls „wartet auf Rechteprüfung“.
 * - **Titelbilder als Kachelraster**, weil dort das Bild selbst entscheidet: dieselben Angaben unter dem Bild.
 * - Die erste Zeile bzw. Kachel ist „↥ Neues … hochladen“ (gestrichelt), nur mit dem Recht zum Hochladen (Vali 2026-11-05: „den Upload nach oben
 *   sortieren, weil der sonst immer weiter runterrutscht“; vorher die letzte).
 * - Eine Wahl ist ein Radioknopf in der Zeile (Tastatur: Pfeile wandern, Leertaste wählt); die Suche fragt den Server.
 */
defineProps<{
    rolle: BindbareRolle;
    eintraege: readonly AuswahlEintrag[];
    darfHochladen: boolean;
    laedt: boolean;
    /** Gibt es mehr Treffer, als geladen sind? */
    mehr: boolean;
    gesamt: number;
}>();
const gewaehlt = defineModel<string | undefined>("gewaehlt", { required: true });
const suche = defineModel<string>("suche", { required: true });
const emit = defineEmits<{ hochladen: []; mehrLaden: [] }>();

const gruppe = useId();
</script>

<template>
    <div class="medien-auswahl" data-testid="medien-auswahl">
        <AvmEingabe
            v-model="suche"
            art="suche"
            class="medien-auswahl__suche"
            :aria-label="t(rolle === 'coat' ? 'medien.auswahl.sucheWappen' : 'medien.auswahl.sucheBilder')"
            :placeholder="t(rolle === 'coat' ? 'medien.auswahl.sucheWappen' : 'medien.auswahl.sucheBilder')"
            testid="medien-auswahl-suche"
        />
        <div
            class="medien-auswahl__folge"
            :class="rolle === 'coat' ? 'medien-auswahl__folge--liste' : 'medien-auswahl__folge--raster'"
            role="radiogroup"
            :aria-label="t(rolle === 'coat' ? 'medien.auswahl.titelWappen' : 'medien.auswahl.titelBild', { ort: '' })"
            data-testid="medien-auswahl-folge"
        >
            <!-- Vorn, nicht am Ende (Vali 2026-11-05): Sonst rutscht das Hochladen mit jedem Bild weiter nach unten. -->
            <button
                v-if="darfHochladen"
                type="button"
                class="medien-auswahl__eintrag medien-auswahl__neu"
                data-testid="medien-auswahl-hochladen"
                @click="emit('hochladen')"
            >
                <span class="medien-auswahl__bild" :class="`medien-auswahl__bild--${rolle}`">
                    <span class="medien-auswahl__plus" aria-hidden="true">↥</span>
                </span>
                <span class="medien-auswahl__text">
                    <span class="medien-auswahl__name">{{
                        t(rolle === "coat" ? "medien.auswahl.neuWappen" : "medien.auswahl.neuBild")
                    }}</span>
                    <span class="medien-auswahl__klein">{{ t("medien.auswahl.neuFelder") }}</span>
                </span>
            </button>
            <label
                v-for="eintrag in eintraege"
                :key="eintrag.id"
                class="medien-auswahl__eintrag"
                :class="{ 'is-gewaehlt': gewaehlt === eintrag.id, 'is-gebunden': eintrag.gebunden }"
                :data-asset="eintrag.id"
                data-testid="medien-auswahl-eintrag"
            >
                <input
                    v-model="gewaehlt"
                    class="medien-auswahl__radio"
                    type="radio"
                    :name="gruppe"
                    :value="eintrag.id"
                />
                <span class="medien-auswahl__bild" :class="`medien-auswahl__bild--${rolle}`">
                    <img v-if="eintrag.vorschau" :src="eintrag.vorschau.url" alt="" loading="lazy" decoding="async" />
                </span>
                <span class="medien-auswahl__text">
                    <span class="medien-auswahl__name">
                        <span class="medien-auswahl__namentext einzeilig">{{ eintrag.name }}</span>
                        <span
                            v-if="eintrag.gebunden"
                            class="medien-auswahl__marke"
                            data-testid="medien-auswahl-gebunden"
                            >{{ t("medien.auswahl.gebunden") }}</span
                        >
                    </span>
                    <span class="medien-auswahl__klein" data-testid="medien-auswahl-hochgeladen">{{
                        eintrag.hochgeladen
                    }}</span>
                    <span v-if="rolle !== 'coat'" class="medien-auswahl__klein"
                        >{{ eintrag.rechte }} · {{ eintrag.verwendungen }}</span
                    >
                    <span v-if="rolle !== 'coat' && eintrag.wartet" class="medien-auswahl__wartet">{{
                        t("medien.auswahl.wartet")
                    }}</span>
                    <!-- 🔴 Dieselben Bytes, mehrere Werke: Die Zeile steht stellvertretend für die ganze Gruppe. -->
                    <span
                        v-if="eintrag.geteilt > 0"
                        class="medien-auswahl__geteilt"
                        data-testid="medien-auswahl-geteilt"
                        >{{
                            eintrag.geteilt === 1
                                ? t("medien.auswahl.geteiltEins")
                                : t("medien.auswahl.geteilt", { n: eintrag.geteilt })
                        }}</span
                    >
                </span>
                <span v-if="rolle === 'coat'" class="medien-auswahl__rechts">
                    <span class="medien-auswahl__klein">{{ eintrag.rechte }}</span>
                    <span class="medien-auswahl__klein">{{ eintrag.verwendungen }}</span>
                    <span v-if="eintrag.wartet" class="medien-auswahl__wartet">{{ t("medien.auswahl.wartet") }}</span>
                </span>
            </label>
        </div>
        <p v-if="!laedt && eintraege.length === 0" class="medien-auswahl__satz" data-testid="medien-auswahl-leer">
            {{ t("medien.auswahl.leer") }}
        </p>
        <p v-if="laedt" class="medien-auswahl__satz">{{ t("medien.auswahl.laedt") }}</p>
        <AvmKnopf v-else-if="mehr" groesse="zeile" testid="medien-auswahl-mehr" @click="emit('mehrLaden')">{{
            t("medien.auswahl.mehr", { n: eintraege.length, von: gesamt })
        }}</AvmKnopf>
    </div>
</template>

<style scoped>
.medien-auswahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.medien-auswahl__suche {
    width: 100%;
}

/* Der Hinweis auf die Dateigruppe: ein ruhiger Ton, kein Alarm - es ist eine Auskunft, kein Mangel dieser Zeile. */
.medien-auswahl__geteilt {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-auswahl__folge {
    min-width: 0;
}

.medien-auswahl__folge--liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.medien-auswahl__folge--raster {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--avm-fenster-kachel) * 1.6), 1fr));
    gap: var(--space-6);
}

/* Eine Zeile bzw. Kachel; die Wahl trägt den Akzent als Kante und Fläche (Gesamtmockup 7, wie eine Wahl in einer Liste). */
.medien-auswahl__eintrag {
    position: relative;
    display: grid;
    align-items: center;
    gap: var(--space-4) var(--space-10);
    box-sizing: border-box;
    min-width: 0;
    padding: var(--space-4) var(--space-8);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-auswahl__folge--liste .medien-auswahl__eintrag {
    grid-template-columns: auto minmax(0, 1fr) auto;
}

.medien-auswahl__folge--raster .medien-auswahl__eintrag {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    padding: var(--space-6);
    border-color: var(--color-border);
    background: var(--color-panel-soft);
}

.medien-auswahl__eintrag:hover {
    background: var(--color-hover-wash);
}

.medien-auswahl__eintrag:active {
    background: var(--color-active-wash);
}

.medien-auswahl__eintrag.is-gewaehlt,
.medien-auswahl__eintrag.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-panel-active);
}

.medien-auswahl__eintrag:has(:focus-visible),
.medien-auswahl__neu:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-auswahl__radio {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.medien-auswahl__bild {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-sm);
}

.medien-auswahl__bild--coat {
    width: var(--avm-fenster-daumen);
    height: var(--avm-fenster-daumen);
}

.medien-auswahl__bild--header {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--color-divider);
}

.medien-auswahl__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.medien-auswahl__bild--header img {
    object-fit: cover;
}

.medien-auswahl__text,
.medien-auswahl__rechts {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
}

.medien-auswahl__rechts {
    align-items: flex-end;
    text-align: right;
}

.medien-auswahl__name {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

/* Gekürzt wird über die Hausklasse `.einzeilig` (app.vue), hier nur, dass der Name schrumpfen darf. */
.medien-auswahl__namentext {
    min-width: 0;
}

.medien-auswahl__marke {
    flex: none;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
}

.medien-auswahl__klein,
.medien-auswahl__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.medien-auswahl__wartet {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
}

/* „↥ Neues … hochladen“: gestrichelt, in der Farbe der Aufschriften (Gesamtmockup 7). */
.medien-auswahl__neu {
    border: 1px dashed var(--color-border-strong);
    color: var(--color-accent-strong);
}

.medien-auswahl__neu .medien-auswahl__name {
    color: var(--color-accent-strong);
}

.medien-auswahl__plus {
    font-size: var(--font-size-title);
}

@media (prefers-reduced-motion: reduce) {
    .medien-auswahl__eintrag {
        transition: none;
    }
}
</style>
