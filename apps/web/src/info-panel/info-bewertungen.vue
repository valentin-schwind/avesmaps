<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { t } from "../i18n/i18n";
import { sendeGefaellt } from "../community/bewertung-api";
import { besucherSatz, GEFAELLT_ABLEHNUNG } from "../community/besucher-ablehnung";
import { bewertungenAnsichtOf, bewertungsAdresse, type BewertungsZeile } from "./bewertungen-modell";
import { gemocht } from "./bewertungen-gemocht";
import type { OrtBewertungen } from "./bewertungen-quelle";
import InfoStars from "./info-stars.vue";
import type { ActionRun } from "./panel-types";

/**
 * Der Reiter „Bewertungen“ im Infopanel eines Orts (WI-0269 C10; Bedienkonzept §6.3, Probierseite `review/wi-0263/quelle.html`, Variante „Reiter“): oben der Wert (16 px) mit Sternen und
 * Zählung, darunter die Verteilung der Sterne, dann die Bewertungen, neueste zuerst. An jeder Bewertung links die Kopfzeile „⟨Autor⟩ schreibt (⟨Datum⟩):“ und rechts ⚑ „Bewertung melden“,
 * darunter die Sterne und der Text, ganz unten leise „♡ Gefällt mir (N)“ und „Teilen“.
 *
 * - **Schrift wie im Produkt** (Bedienkonzept §6.3, gemessen auf der Stage): Wert 16 px, Zählung, Autorzeile und Bewertungstext 11 px, Sterne 14 px (im Wert) und 12 px (in der Liste).
 *   „Gefällt mir“ und „Teilen“ stehen leise in der Größe von Autor und Datum; am Finger 44 px Trefferfläche, ohne die Zeile zu erhöhen.
 * - **Gefällt mir:** anonym, einmal je Browser (`bewertungen-gemocht.ts`), ein zweiter Klick nimmt es zurück; die Zahl erst ab 1. Der Klick zählt sofort (der Server bestätigt oder der Stand fällt zurück).
 * - **Teilen** kopiert einen Link auf die Bewertung (`?place=…&bewertung=…`, öffnet dieses Panel auf diesem Reiter mit der Bewertung hervorgehoben); am Telefon öffnet es das Teilen-Menü des Geräts.
 *   Beides führt `panel-actions.ts` aus. **Melden** öffnet das Fenster „Bewertung melden“ der Besucher.
 * - **Hervorgehoben** (`hervorheben`): die Bewertung des Links rollt in die Mitte und trägt kurz eine Lasur. Steht sie jenseits der ersten zwölf, klappt die Liste auf.
 * - Keine „(0)“: Ein Ort ohne Bewertung sagt „Noch keine Bewertung“.
 */
const props = defineProps<{
    bewertungen: OrtBewertungen;
    ortId: string;
    ortName: string;
    /** Die Seite ohne Suche und Fragment, für den Link auf eine Bewertung. */
    seite: string;
    hervorheben?: string | undefined;
}>();
const emit = defineEmits<{ run: [run: ActionRun] }>();

const alle = ref(false);
const ansicht = computed(() => bewertungenAnsichtOf(props.bewertungen.section.value, alle.value));
const bereit = computed(() => props.bewertungen.status.value === "ready");
const problem = ref<string | undefined>(undefined);
const beschaeftigt = ref<ReadonlySet<string>>(new Set());
const wurzel = ref<HTMLElement | null>(null);
const blitz = ref<string | undefined>(undefined);
/** Das Ziel, zu dem schon gerollt wurde: einmal je Ziel. */
let gerollt: string | undefined;

// Ein anderer Ort beginnt wieder bei den ersten zwölf.
watch(
    () => props.ortId,
    () => {
        alle.value = false;
        problem.value = undefined;
        gerollt = undefined;
    },
);

/** Die hervorgehobene Bewertung in die Mitte rollen, sobald die Liste da ist; jenseits der ersten zwölf klappt sie auf. */
async function zeigeZiel(): Promise<void> {
    const ziel = props.hervorheben;
    // Einmal je Ziel: Ein „Gefällt mir“ an einer anderen Bewertung lädt die Liste neu und soll die Ansicht nicht zurückholen.
    if (ziel === gerollt) return;
    const liste = props.bewertungen.section.value?.reviews ?? [];
    if (ziel === undefined || !bereit.value || !liste.some((eintrag) => eintrag.id === ziel)) return;
    if (!ansicht.value.zeilen.some((zeile) => zeile.id === ziel)) alle.value = true;
    await nextTick();
    const element = wurzel.value?.querySelector<HTMLElement>(`[data-bewertung="${CSS.escape(ziel)}"]`);
    if (element === null || element === undefined) return;
    gerollt = ziel;
    blitz.value = ziel;
    element.scrollIntoView({ block: "center", behavior: "auto" });
    setTimeout(() => {
        if (blitz.value === ziel) blitz.value = undefined;
    }, 2400);
}
onMounted(() => void zeigeZiel());
watch(() => [props.hervorheben, props.bewertungen.status.value, props.bewertungen.section.value], zeigeZiel);

function teilen(zeile: BewertungsZeile): void {
    if (zeile.id === undefined) return;
    emit("run", {
        type: "share",
        url: bewertungsAdresse(props.seite, props.ortId, zeile.id),
        what: "review",
    });
}

function melden(zeile: BewertungsZeile): void {
    if (zeile.id === undefined) return;
    // Das Fenster zeigt die Bewertung als Zitat: der rohe Text, die Anführungszeichen setzt es selbst.
    const eintrag = props.bewertungen.section.value?.reviews.find((kandidat) => kandidat.id === zeile.id);
    emit("run", {
        type: "reviewReport",
        ortId: props.ortId,
        ortName: props.ortName,
        bewertung: {
            id: zeile.id,
            stars: eintrag?.stars ?? 0,
            ...(eintrag?.text === undefined ? {} : { text: eintrag.text }),
            head: zeile.head,
        },
    });
}

async function mag(zeile: BewertungsZeile): Promise<void> {
    const id = zeile.id;
    if (id === undefined || beschaeftigt.value.has(id)) return;
    problem.value = undefined;
    const jetzt = gemocht.umschalten(id);
    props.bewertungen.setzeGefaellt(id, Math.max(0, zeile.likes + (jetzt ? 1 : -1)));
    beschaeftigt.value = new Set(beschaeftigt.value).add(id);
    try {
        const antwort = await sendeGefaellt(id, jetzt ? 1 : -1);
        props.bewertungen.setzeGefaellt(id, antwort.gefaellt);
    } catch (fehler) {
        // Der Server hat es nicht gezählt: Stand und Zahl fallen zurück, und ein Satz sagt, warum (Drossel mit Uhrzeit, Bewertung weg; WI-0291).
        gemocht.umschalten(id);
        props.bewertungen.setzeGefaellt(id, zeile.likes);
        problem.value = besucherSatz(fehler, GEFAELLT_ABLEHNUNG, {
            zuViele: "bewertungen.ablehnung.gefaelltZuViele",
            rueckfall: () => t("bewertungen.fehler.gefaellt"),
        });
    } finally {
        const rest = new Set(beschaeftigt.value);
        rest.delete(id);
        beschaeftigt.value = rest;
    }
}
</script>

<template>
    <div ref="wurzel" class="info-bew" data-testid="info-bewertungen" :aria-busy="!bereit">
        <p v-if="bewertungen.pausiert.value" class="info-bew__note" data-testid="info-bewertungen-pausiert">
            {{ t("bewertungen.pausiert") }}
        </p>
        <p
            v-else-if="bewertungen.status.value === 'loading'"
            class="info-bew__note"
            data-testid="info-bewertungen-laedt"
        >
            {{ t("infoPanel.catalog.loading") }}
        </p>
        <template v-else-if="bewertungen.status.value === 'error'">
            <p class="info-bew__note" data-testid="info-bewertungen-fehler">{{ t("infoPanel.catalog.error") }}</p>
            <button
                type="button"
                class="info-bew__wieder"
                data-testid="info-bewertungen-wieder"
                @click="bewertungen.lade(true)"
            >
                {{ t("infoPanel.retry") }}
            </button>
        </template>
        <template v-else>
            <p
                v-if="bewertungen.oeffentlichAusgeblendet.value"
                class="info-bew__note"
                data-testid="info-bewertungen-ausgeblendet"
            >
                {{ t("inhalt.oeffentlichAusgeblendet") }}
            </p>
            <p v-if="ansicht.anzahl === 0" class="info-bew__note" data-testid="info-bewertungen-keine">
                {{ t("bewertungen.kopf.keine") }}
            </p>
            <template v-else>
                <p class="info-bew__wertzeile" data-testid="info-bewertungen-wert">
                    <span class="info-bew__wert" :title="ansicht.datenbasis">{{ ansicht.wert }}</span>
                    <InfoStars :stars="ansicht.sterne" :label="ansicht.wertLabel" />
                    <span class="info-bew__zaehlung">({{ ansicht.zaehlung }})</span>
                </p>
                <dl
                    class="info-bew__verteilung"
                    :aria-label="t('bewertungen.verteilung')"
                    data-testid="info-bewertungen-verteilung"
                >
                    <template v-for="zeile in ansicht.verteilung" :key="zeile.stufe">
                        <dt>{{ zeile.stufe }} ★</dt>
                        <dd class="info-bew__balken" aria-hidden="true">
                            <span :style="{ width: `${String(zeile.anteil * 100)}%` }"></span>
                        </dd>
                        <dd class="info-bew__anzahl">{{ zeile.anzahl }}</dd>
                    </template>
                </dl>
                <ol class="info-bew__liste" data-testid="info-bewertungen-liste">
                    <li
                        v-for="zeile in ansicht.zeilen"
                        :key="zeile.key"
                        class="info-bew__eintrag"
                        :class="{ 'is-ziel': zeile.id !== undefined && blitz === zeile.id }"
                        :data-bewertung="zeile.id"
                        data-testid="info-bewertungen-eintrag"
                    >
                        <div class="info-bew__kopf">
                            <span class="info-bew__autor">{{ zeile.head }}</span>
                            <button
                                v-if="zeile.id !== undefined"
                                type="button"
                                class="info-bew__melden"
                                :aria-label="t('bewertungen.melden')"
                                :title="t('bewertungen.melden')"
                                data-testid="info-bewertungen-melden"
                                @click="melden(zeile)"
                            >
                                ⚑
                            </button>
                        </div>
                        <InfoStars :stars="zeile.stars" :label="zeile.starsLabel" />
                        <span v-if="zeile.text !== ''" class="info-bew__text">{{ zeile.text }}</span>
                        <div v-if="zeile.id !== undefined" class="info-bew__taten">
                            <button
                                type="button"
                                class="info-bew__tat info-bew__mag"
                                :class="{ 'is-an': gemocht.hat(zeile.id) }"
                                :aria-pressed="gemocht.hat(zeile.id)"
                                :title="
                                    gemocht.hat(zeile.id)
                                        ? t('bewertungen.gefaellt.zurueck')
                                        : t('bewertungen.gefaellt.setzen')
                                "
                                :disabled="beschaeftigt.has(zeile.id)"
                                data-testid="info-bewertungen-gefaellt"
                                @click="mag(zeile)"
                            >
                                <span aria-hidden="true">{{ gemocht.hat(zeile.id) ? "♥" : "♡" }}</span>
                                {{ t("bewertungen.gefaellt")
                                }}<template v-if="zeile.likes > 0">
                                    <span class="info-bew__likes" data-testid="info-bewertungen-likes"
                                        >({{ zeile.likes }})</span
                                    ></template
                                >
                            </button>
                            <button
                                type="button"
                                class="info-bew__tat"
                                :title="t('bewertungen.teilen.titel')"
                                data-testid="info-bewertungen-teilen"
                                @click="teilen(zeile)"
                            >
                                {{ t("bewertungen.teilen") }}
                            </button>
                        </div>
                    </li>
                </ol>
                <button
                    v-if="ansicht.weitere > 0"
                    type="button"
                    class="info-bew__alle"
                    data-testid="info-bewertungen-alle"
                    @click="alle = true"
                >
                    {{ t("bewertungen.alleZeigen", { n: ansicht.gesamtGeliefert }) }}
                </button>
                <p
                    v-if="problem !== undefined"
                    class="info-bew__problem"
                    role="alert"
                    data-testid="info-bewertungen-problem"
                >
                    {{ problem }}
                </p>
            </template>
        </template>
    </div>
</template>

<style scoped>
.info-bew {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-10) var(--info-pad-x) 0;
}

.info-bew__note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Wert im Reiter wie im Abschnitt des Produkts: Wert 16, Zählung 11, Sterne 14. */
.info-bew__wertzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4);
    margin: 0;
}

.info-bew__wert {
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-bold);
}

.info-bew__wertzeile :deep(.info-stars__glyphs) {
    font-size: var(--font-size-reading);
}

.info-bew__zaehlung {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

/* Die Verteilung: ein Balken je Stufe in Sternfarbe, die Zahl rechts. */
.info-bew__verteilung {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-6);
    align-items: center;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.info-bew__verteilung dt,
.info-bew__verteilung dd {
    margin: 0;
}

.info-bew__balken {
    height: var(--space-4);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-star-muted);
}

.info-bew__balken span {
    display: block;
    height: 100%;
    background: var(--color-star);
}

.info-bew__anzahl {
    font-variant-numeric: tabular-nums;
    text-align: end;
}

.info-bew__liste {
    display: grid;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Ein Eintrag hängt an einer Kante - die Gruppierung macht eine Linie, kein Rahmen (AGENTS.md §12). */
.info-bew__eintrag {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    padding-left: var(--space-6);
    border-left: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    transition: background-color 120ms ease;
}

/* Der Eintrag eines geteilten Links trägt kurz die Lasur des Zeigens. */
.info-bew__eintrag.is-ziel {
    background: var(--color-hover-wash);
    border-left-color: var(--color-accent);
}

.info-bew__kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
}

.info-bew__autor {
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    overflow-wrap: anywhere;
}

.info-bew__eintrag :deep(.info-stars__glyphs) {
    font-size: var(--font-size-small);
}

.info-bew__text {
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

/* ⚑ leise am Zeilenende; die Fassung eines Zeichenknopfs ohne Fläche (am Finger 44 px Trefferfläche). */
.info-bew__melden {
    position: relative;
    flex: none;
    width: var(--space-24);
    height: var(--space-24);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: 1;
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

/* Leise: „♡ Gefällt mir (7)“ und „Teilen“ in der Größe von Autor und Datum. */
.info-bew__taten {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-10);
    margin-top: var(--space-2);
}

.info-bew__tat {
    position: relative;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition: color 120ms ease;
}

.info-bew__likes {
    margin-left: var(--space-2);
    font-variant-numeric: tabular-nums;
}

/* Gesetzt: ♥ in der Akzentfarbe. */
.info-bew__mag.is-an {
    color: var(--color-accent-strong);
}

.info-bew__tat:hover,
.info-bew__melden:hover {
    color: var(--color-text-strong);
}

.info-bew__melden:hover {
    background: var(--color-hover-wash);
}

.info-bew__mag.is-an:hover {
    color: var(--color-accent-strong);
}

.info-bew__tat:disabled {
    cursor: progress;
}

.info-bew__tat:focus-visible,
.info-bew__melden:focus-visible,
.info-bew__alle:focus-visible,
.info-bew__wieder:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Am Finger 44 px Trefferfläche, ohne die Zeile zu erhöhen: ein unsichtbarer Rand um den Knopf. */
@media (pointer: coarse) {
    .info-bew__tat::after,
    .info-bew__melden::after {
        content: "";
        position: absolute;
        inset: -14px -8px;
    }
}

.info-bew__alle,
.info-bew__wieder {
    justify-self: start;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.info-bew__alle:hover,
.info-bew__wieder:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-bew__problem {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .info-bew__eintrag,
    .info-bew__tat,
    .info-bew__melden {
        transition: none;
    }
}
</style>
