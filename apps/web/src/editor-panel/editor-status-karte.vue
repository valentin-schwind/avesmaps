<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { BesuchEditor } from "@avesmaps3d/shared";
import { LEERER_FILTER, type ObjektZiel } from "../aenderungen/aenderung-modell";
import { createAenderungenDaten } from "../aenderungen/aenderungen-daten";
import { springeZuAenderungen } from "../aenderungen/sprung";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import { rollenName, sonderrollenZeilen } from "../auth/bezeichnung";
import { formatNumber, locale, t, tPlural } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import EditorStatusObjekt from "./editor-status-objekt.vue";
import { editorKreis, letzteZeilen, seitText, siegelVon, type LetzteZeile } from "./editor-status-modell";

/**
 * Eine Person in der Editorenliste als Visitenkarte (WI-0276; Betreiber 2026-11-02 zur Probierseite, Idee A: „A ist genau das was ich gemeint habe“).
 *
 * - **Kopf:** Siegel mit dem Kreis des Zustands, Name, Rolle und die eigene Beschreibung („Verantwortlich für“). Er klappt die Karte auf; zu kürzt die Beschreibung auf zwei Zeilen.
 *   Sonderrollen zählt er nur, die Namen stehen im Hinweis: Sonst wird eine Karte mit vielen davon lang (Betreiber 2026-11-05: „die ganzen sonderrollen vielleicht beim aufklappen“).
 * - **Band:** was die Person gerade tut. Es steht außerhalb des Kopfs, weil es einen Objektlink trägt (ein Knopf im Knopf gibt es nicht).
 * - **Aufgeklappt:** die Sonderrollen als Pillen und die letzten Änderungen, diese geholt erst beim Öffnen und neu, wenn ihre Zahl sich ändert: Die Liste fragt alle dreißig Sekunden, die Karte nicht.
 */
const props = defineProps<{
    person: BesuchEditor;
    offen: boolean;
    /** Wann die Liste zuletzt fragte: Daran misst sich „seit 12 Min.“. */
    jetzt: Date;
    /** Wie Ansichten heißen; die Liste kennt die Tafel. */
    ansichtName: string | null;
}>();
const emit = defineEmits<{ klappe: []; zeigen: [ziel: ObjektZiel, id: string] }>();

const LETZTE = 3;
/** Genug Operationen für drei Zeilen, auch wenn mehrere in Folge dasselbe Objekt treffen. */
const FRAGE_GROESSE = 30;
const daten = createAenderungenDaten({ limit: FRAGE_GROESSE });

const zeilen = ref<readonly LetzteZeile[] | undefined>(undefined);
const fehler = ref(false);
let abbruch: AbortController | undefined;

async function holeLetzte(): Promise<void> {
    abbruch?.abort();
    const lauf = new AbortController();
    abbruch = lauf;
    try {
        const seite = await daten.seite({ ...LEERER_FILTER, person: props.person.id }, undefined, lauf.signal);
        if (lauf.signal.aborted) return;
        zeilen.value = letzteZeilen(seite.entries, LETZTE);
        fehler.value = false;
    } catch {
        if (!lauf.signal.aborted) fehler.value = true;
    }
}
watch(
    () => (props.offen ? props.person.aenderungen : undefined),
    (zahl) => {
        if (zahl === undefined) return;
        void holeLetzte();
    },
    { immediate: true },
);
onBeforeUnmount(() => abbruch?.abort());

const rolle = computed(() => rollenName(props.person.rolle, props.person.bezeichnung));
const sonderrollen = computed(() => sonderrollenZeilen(props.person.sonderrollen, props.person.bezeichnung));
const sonderrollenHinweis = computed(() => sonderrollen.value.map((zeile) => zeile.text).join(", "));

const kreis = computed(() => editorKreis(props.person));
const KREIS_NAMEN = {
    voll: "editoren.kreis.bearbeitet",
    halb: "editoren.kreis.online",
    leer: "editoren.kreis.weg",
} as const;

const WORAN = { form: "sperre.wort.form", felder: "sperre.wort.felder" } as const;

const zuletztText = (zeitpunkt: string): string =>
    relativeTime(new Date(zeitpunkt), props.jetzt, locale.value, "zeitpunkt");
const zuletztDa = computed(() =>
    props.person.zuletzt === null ? t("editoren.nie") : zuletztText(props.person.zuletzt),
);

const fakten = computed(() =>
    [
        props.ansichtName === null ? null : `${t("editoren.band.sitztAn")} ${props.ansichtName}`,
        props.person.geraet,
        props.person.sitzungen > 0
            ? tPlural("editoren.sitzungenZahl", props.person.sitzungen, {
                  n: formatNumber(props.person.sitzungen, 0),
              })
            : null,
        t("editoren.tageWert", { zahl: formatNumber(props.person.tageAktiv, 0) }),
    ]
        .filter((teil) => teil !== null)
        .join(" · "),
);

const zeigeAlle = (): void => springeZuAenderungen({ person: props.person.id });
</script>

<template>
    <article class="karte" :class="{ 'is-offen': offen }" data-testid="editor-karte">
        <button type="button" class="karte__kopf" :aria-expanded="offen" @click="emit('klappe')">
            <span class="karte__siegel" aria-hidden="true">{{ siegelVon(person.name, locale) }}</span>
            <AvmKreis class="karte__kreis" :fuellung="kreis" :name="t(KREIS_NAMEN[kreis])" />
            <span class="karte__text">
                <span class="karte__zeile">
                    <span class="karte__name einzeilig">{{ person.name }}</span>
                    <AvmPille>{{ rolle }}</AvmPille>
                    <AvmPille
                        v-if="!offen && sonderrollen.length > 0"
                        :title="sonderrollenHinweis"
                        data-testid="editor-karte-sonderrollen-zahl"
                        >+{{ formatNumber(sonderrollen.length, 0) }}</AvmPille
                    >
                    <span class="karte__spitze" aria-hidden="true">▸</span>
                </span>
                <span v-if="person.verantwortung" class="karte__beschreibung">{{ person.verantwortung }}</span>
            </span>
        </button>

        <div class="karte__band" :class="{ 'is-still': kreis === 'leer' }" data-testid="editor-band">
            <template v-if="person.bearbeitet">
                <span>{{ t("editoren.kreis.bearbeitet") }}</span>
                <EditorStatusObjekt
                    :id="person.bearbeitet.id"
                    :art="person.bearbeitet.art"
                    :name="person.bearbeitet.name"
                    @zeigen="(ziel: ObjektZiel, id: string) => emit('zeigen', ziel, id)"
                />
                <AvmPille>{{ t(WORAN[person.bearbeitet.woran]) }}</AvmPille>
                <span class="karte__zeit">{{ seitText(person.bearbeitet.seit, jetzt) }}</span>
            </template>
            <template v-else-if="person.online && ansichtName">
                <span>{{ t("editoren.band.sitztAn") }}</span>
                <span class="karte__stark">{{ ansichtName }}</span>
            </template>
            <template v-else-if="person.online">
                <span>{{ t("editoren.kreis.online") }}</span>
            </template>
            <template v-else>
                <template v-if="person.zuletztGeaendert">
                    <span>{{ t("editoren.band.zuletzt") }}</span>
                    <EditorStatusObjekt
                        :id="person.zuletztGeaendert.id"
                        :art="person.zuletztGeaendert.art"
                        :name="person.zuletztGeaendert.name"
                        @zeigen="(ziel: ObjektZiel, id: string) => emit('zeigen', ziel, id)"
                    />
                </template>
                <span v-else-if="person.aenderungen === 0">{{ t("editoren.band.keineAenderung") }}</span>
                <span class="karte__zeit karte__zeit--rechts">{{ zuletztDa }}</span>
            </template>
        </div>

        <div v-if="offen" class="karte__mehr" data-testid="editor-mehr">
            <div v-if="sonderrollen.length > 0" class="karte__sonderrollen">
                <AvmPille
                    v-for="zeile in sonderrollen"
                    :key="zeile.sonderrolle"
                    :title="zeile.text"
                    data-testid="editor-karte-sonderrolle"
                    >{{ zeile.name }}</AvmPille
                >
            </div>
            <p v-if="fehler" class="karte__leise">{{ t("statistik.fehler") }}</p>
            <p v-else-if="zeilen === undefined" class="karte__leise">{{ t("statistik.laedt") }}</p>
            <p v-else-if="zeilen.length === 0" class="karte__leise">{{ t("editoren.band.keineAenderung") }}</p>
            <ul v-else class="karte__letzte">
                <li v-for="zeile in zeilen" :key="zeile.schluessel" class="karte__letzteZeile">
                    <EditorStatusObjekt
                        v-if="zeile.art && zeile.id"
                        :id="zeile.id"
                        :art="zeile.art"
                        :name="zeile.name"
                        @zeigen="(ziel: ObjektZiel, id: string) => emit('zeigen', ziel, id)"
                    />
                    <span v-else class="karte__stark">{{ zeile.was }}</span>
                    <time class="karte__zeit" :datetime="zeile.am">{{ zuletztText(zeile.am) }}</time>
                    <span v-if="zeile.art && zeile.id" class="karte__was">{{ zeile.was }}</span>
                </li>
            </ul>
            <p class="karte__leise">{{ fakten }}</p>
            <button
                v-if="person.aenderungen > 0"
                type="button"
                class="karte__alle"
                data-testid="editor-alle-aenderungen"
                @click="zeigeAlle"
            >
                {{
                    tPlural("editoren.alleAenderungen", person.aenderungen, {
                        n: formatNumber(person.aenderungen, 0),
                        name: person.name,
                    })
                }}
            </button>
        </div>
    </article>
</template>

<style scoped>
.karte {
    position: relative;
    overflow: hidden;
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
}

.karte__kopf {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-8);
    width: 100%;
    padding: var(--space-6) var(--space-8);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.karte__kopf:hover {
    background: var(--color-hover-wash);
}

.karte__kopf:active {
    background: var(--color-active-wash);
}

.karte__kopf:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Das Siegel: so groß wie ein Bedienelement, der Kreis sitzt auf seinem Rand und trägt einen Ring in der Farbe der Karte. */
.karte__siegel {
    display: grid;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    border: 1px solid var(--color-pill-border);
    border-radius: 50%;
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-subhead);
    line-height: 1;
}

.karte__kreis {
    position: absolute;
    top: calc(var(--space-6) + var(--avm-control-h) - var(--avm-kreis) + var(--space-2) / 2);
    left: calc(var(--space-8) + var(--avm-control-h) - var(--avm-kreis) + var(--space-2) / 2);
    box-shadow: 0 0 0 var(--space-2) var(--color-panel-soft);
}

.karte__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    min-width: 0;
}

.karte__name {
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    line-height: var(--leading-tight);
}

.karte__spitze {
    flex: none;
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    transition: transform 120ms ease;
}

.karte.is-offen .karte__spitze {
    transform: rotate(90deg);
}

.karte__beschreibung {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    hyphens: auto;
}

.karte.is-offen .karte__beschreibung {
    display: block;
}

.karte__band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-4) var(--space-8);
    border-top: 1px solid var(--color-divider);
    background: var(--color-disclosure-bg);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.karte__band.is-still {
    background: none;
    color: var(--color-text-muted);
}

.karte__stark {
    color: var(--color-text-strong);
}

.karte__zeit {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.karte__zeit--rechts {
    margin-left: auto;
}

.karte__mehr {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8) var(--space-8);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.karte__sonderrollen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-6);
}

.karte__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte__letzte {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karte__letzteZeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-8);
    align-items: baseline;
}

.karte__was {
    grid-column: 1 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte__alle {
    align-self: flex-start;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: color 120ms ease;
}

.karte__alle:hover,
.karte__alle:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.karte__alle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .karte__spitze {
        transition: none;
    }
}
</style>
