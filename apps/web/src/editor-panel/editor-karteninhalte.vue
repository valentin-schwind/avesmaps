<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue";
import { EDITORPANEL, verbModus } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import EditorZeichen from "../controls/editor-zeichen.vue";
import { naechsterFokus } from "../fenster/fenster-schiene";
import { formatNumber, t, tPlural, type MessageKey } from "../i18n/i18n";
import type { HinflugAnsicht } from "../map/hinflug-ansicht";
import type { NavStand } from "./editor-panel-nav";
import { navName, verbName } from "./editor-panel-texte";
import { kachelGruppen, type Kachel, type KachelGruppe } from "./karteninhalte-kacheln";
import type { KarteninhaltZahlen } from "./karteninhalte-zahlen";

/**
 * Der Reiter „Karteninhalte“ des Editorpanels als Kacheln (WI-0212; EDIT-0003 T37, Betreiber 2026-10-16 zur Probierseite: „so jetzt hab
 * ichs aber :)“; vorher die Schiene aus WI-0128 E3, EDIT-0001 §3.2, D12, D13, D16, D18).
 *
 * - **Kacheln in zwei Spalten**, in zwei Gruppen mit Köpfen in Versalien wie die Schiene: „Auf der Karte“ und „Nachschlagen“ (Modell
 *   `karteninhalte-kacheln.ts`). Je Kachel Zeichen, Name und darunter die Zahl der Einträge. Was noch nicht gebaut ist, steht gestrichelt
 *   und blass mit „später“ da und lässt sich nicht wählen (D16). Die gewählte Kachel zeigt Fläche und kräftigeren Rand, keinen Balken
 *   links (Betreiber 2026-10-16: „erstmal nur in den editor listen“). Am Telefon dieselben zwei Spalten.
 * - **Die Ansicht folgt der Wahl:** Wer eine Kachel wählt, stellt die Karte ohne Flug auf die Ansicht des Inhalts (`ansicht`, Zuordnung
 *   in `map/hinflug-ansicht.ts`). Das Laden des Panels und das Gemerkte stellen nichts um, nur die Wahl.
 * - **Der Steckbrief** des gewählten Inhalts: Zeichen, Name, rechts klein die Ansicht; darunter das eine Verb („⚙ Orte bearbeiten“, ohne
 *   Schreibrecht „nur lesen“, ohne Werkzeug gesperrt mit Satz) und unten EINE Zeile Legende mit Zählung, dasselbe Bauteil wie unter den
 *   Listen der Editoren.
 * - **Die Zahlen** holt `karteninhalte-zahlen.ts` erst, wenn der Reiter zu sehen ist (`sichtbar`), aus den Listen der Editoren.
 * - **„⇄ Abgleiche ›“** führt in die Systemsteuerung (D13); bis es dort den Eintrag gibt, ist es mit Satz gesperrt. Darunter die offenen
 *   Bearbeitungen (Slot, E6). 🔴 Keine Ortsliste (D18): Die Liste lebt nur im Editor.
 */
const props = defineProps<{
    nav: NavStand;
    rechte: readonly string[];
    /** Die Werkzeuge, die es schon gibt; ein Verb auf ein anderes ist gesperrt. */
    werkzeuge: ReadonlySet<string>;
    /** Am Telefon dieselben Kacheln in zwei Spalten (T37). */
    phone: boolean;
    /** Woher die Zahlen kommen; ohne stehen die Kacheln ohne Zahl. */
    zahlen?: KarteninhaltZahlen | undefined;
    /** Der Reiter ist zu sehen (Panel offen und vorn); erst dann werden Zahlen geholt. */
    sichtbar?: boolean | undefined;
}>();
const emit = defineEmits<{
    oeffne: [werkzeug: string, modus: "bearbeiten" | "lesen"];
    /** Die Wahl einer Kachel: die Karte auf die Ansicht ihres Inhalts, ohne Flug. */
    ansicht: [ziel: HinflugAnsicht];
}>();

const BEREICH = "karteninhalte";
const GRUPPEN_NAMEN: Readonly<Record<KachelGruppe, MessageKey>> = {
    karte: "editorPanel.gruppe.karte",
    nachschlagen: "editorPanel.gruppe.nachschlagen",
};

const gruppen = computed(() => kachelGruppen(props.rechte));
const gewaehlt = computed(() => props.nav.gewaehlt(BEREICH) ?? "");
const kachel = computed(() =>
    gruppen.value.flatMap((gruppe) => gruppe.kacheln).find((eine) => eine.id === gewaehlt.value && eine.gebaut),
);

function waehle(eine: Kachel): void {
    props.nav.waehle(eine.id);
    if (eine.ansicht !== undefined) emit("ansicht", eine.ansicht);
}

const zaehlung = computed(() => props.zahlen?.zaehlung.value ?? {});
const zaehlungGewaehlt = computed(() => (kachel.value === undefined ? undefined : zaehlung.value[kachel.value.id]));

/** Unter dem Namen: „3.263 Einträge“, bei einem späteren Inhalt „später“; leer, solange die Zahl fehlt. */
function unterzeile(eine: Kachel): string {
    if (!eine.gebaut) return t("editorPanel.spaeter");
    const zahl = zaehlung.value[eine.id];
    return zahl === undefined
        ? ""
        : tPlural("editorPanel.kachel.eintraege", zahl.gesamt, { n: formatNumber(zahl.gesamt, 0) });
}

const ansichtText = computed(() => {
    const ziel = kachel.value?.ansicht;
    return ziel === undefined ? undefined : t("editorPanel.steckbrief.ansicht", { ansicht: t(`view.${ziel.view}`) });
});

const verb = computed(() => {
    const eintrag = EDITORPANEL.eintraege.find((x) => x.id === gewaehlt.value);
    return eintrag !== undefined && "verb" in eintrag ? eintrag.verb : undefined;
});
const modus = computed(() => verbModus(EDITORPANEL, gewaehlt.value, props.rechte));

function oeffne(): void {
    if (verb.value && modus.value) emit("oeffne", verb.value.werkzeug, modus.value);
}

watch(
    () => props.sichtbar === true,
    (ja) => {
        if (ja) props.zahlen?.gebraucht();
    },
    { immediate: true },
);

/** Pfeile wandern über die wählbaren Kacheln in Lesefolge, Pos1 und Ende springen an die Ränder (wie in der Schiene). */
const kacheln = useTemplateRef<HTMLElement>("kacheln");
const PFEIL: Readonly<Record<string, string>> = {
    ArrowRight: "ArrowDown",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowUp",
    ArrowUp: "ArrowUp",
    Home: "Home",
    End: "End",
};
function taste(event: KeyboardEvent): void {
    const richtung = PFEIL[event.key];
    if (richtung === undefined) return;
    const ziele = [...(kacheln.value?.querySelectorAll<HTMLElement>("button.kachel") ?? [])];
    const ziel = naechsterFokus(richtung, ziele.indexOf(document.activeElement as HTMLElement), ziele.length);
    if (ziel === null) return;
    event.preventDefault();
    ziele[ziel]?.focus();
}
</script>

<template>
    <div class="karteninhalte" data-testid="editorpanel-karteninhalte">
        <nav
            ref="kacheln"
            class="kacheln"
            :aria-label="t(navName(BEREICH))"
            data-testid="editorpanel-kacheln"
            @keydown="taste"
        >
            <section
                v-for="gruppe in gruppen"
                :key="gruppe.id"
                class="kacheln__gruppe"
                :aria-labelledby="`editorpanel-gruppe-${gruppe.id}`"
                :data-testid="`editorpanel-gruppe-${gruppe.id}`"
            >
                <h3 :id="`editorpanel-gruppe-${gruppe.id}`" class="kacheln__kopf avm-versalmitte">
                    {{ t(GRUPPEN_NAMEN[gruppe.id]) }}
                </h3>
                <div class="kacheln__raster">
                    <template v-for="eine in gruppe.kacheln" :key="eine.id">
                        <button
                            v-if="eine.gebaut"
                            type="button"
                            class="kachel"
                            :class="{ 'is-gewaehlt': eine.id === gewaehlt }"
                            :aria-current="eine.id === gewaehlt ? 'true' : undefined"
                            :data-testid="`editorpanel-kachel-${eine.id}`"
                            @click="waehle(eine)"
                        >
                            <EditorZeichen class="kachel__zeichen" :name="eine.zeichen" />
                            <span class="kachel__name avm-versalmitte">{{ t(navName(eine.id)) }}</span>
                            <span class="kachel__zahl avm-versalmitte einzeilig">{{ unterzeile(eine) }}</span>
                        </button>
                        <div
                            v-else
                            class="kachel kachel--spaeter"
                            aria-disabled="true"
                            :title="t('editorPanel.spaeter.satz')"
                            :data-testid="`editorpanel-kachel-${eine.id}`"
                        >
                            <EditorZeichen class="kachel__zeichen" :name="eine.zeichen" />
                            <span class="kachel__name avm-versalmitte">{{ t(navName(eine.id)) }}</span>
                            <span class="kachel__zahl avm-versalmitte einzeilig">{{ unterzeile(eine) }}</span>
                        </div>
                    </template>
                </div>
            </section>
        </nav>

        <section
            v-if="kachel"
            class="steckbrief"
            aria-labelledby="editorpanel-steckbrief-titel"
            data-testid="editorpanel-steckbrief"
            :data-inhalt="kachel.id"
        >
            <header class="steckbrief__kopf">
                <EditorZeichen class="steckbrief__zeichen" :name="kachel.zeichen" />
                <h3 id="editorpanel-steckbrief-titel" class="steckbrief__titel avm-versalmitte einzeilig">
                    {{ t(navName(kachel.id)) }}
                </h3>
                <span
                    v-if="ansichtText"
                    class="steckbrief__ansicht avm-versalmitte"
                    data-testid="editorpanel-steckbrief-ansicht"
                    >{{ ansichtText }}</span
                >
            </header>
            <AvmKnopf
                v-if="verb && modus"
                art="gefuellt"
                breit
                :zweite="modus === 'lesen' ? t('editorPanel.verb.lesen') : undefined"
                :gesperrt="werkzeuge.has(verb.werkzeug) ? undefined : t('editorPanel.werkzeugFehlt')"
                :data-modus="modus"
                testid="editorpanel-verb"
                @click="oeffne"
            >
                ⚙ {{ t(verbName(verb.id)) }}
            </AvmKnopf>
            <AvmKreisLegende
                v-if="zaehlungGewaehlt"
                class="steckbrief__legende"
                :namen="zaehlungGewaehlt.legende"
                :zahlen="zaehlungGewaehlt.kreise"
                :beschriftung="t('editorPanel.steckbrief.legende')"
                testid="editorpanel-legende"
            />
        </section>

        <div class="karteninhalte__handeln">
            <AvmKnopf breit :gesperrt="t('editorPanel.abgleiche.spaeter')" testid="editorpanel-abgleiche">
                {{ t("editorPanel.abgleiche") }}
            </AvmKnopf>
            <slot name="bearbeitungen" />
        </div>
    </div>
</template>

<style scoped>
/* Maße aus der Probierseite (Form „Kacheln“), Werte nur aus dem Kanon. Die Zonen polstern sich selbst (Guide §10). */
.karteninhalte {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding-block: var(--space-2) var(--space-12);
}

.kacheln {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline: var(--space-12);
}

.kacheln__gruppe {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* Der Gruppenkopf wie der Bereichskopf der Schiene (`fenster-schiene.vue`): Versalien, gesperrt, Gold; hier ohne Klappen. */
.kacheln__kopf {
    margin: 0;
    padding: var(--space-8) 0 var(--space-2) var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kacheln__raster {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
}

/* Eine Kachel: links das Zeichen über beide Zeilen, rechts Name und Zahl, jede auf ihre Versalhöhe geschnitten (Guide §3.2). */
.kachel {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: var(--icon-kachel) minmax(0, 1fr);
    grid-template-areas:
        "zeichen name"
        "zeichen zahl";
    align-content: center;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-8) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

/* Zwei Klassen, damit das Maß des Rumpfs die Vorgabe des Zeichens (16 px) schlägt. */
.kachel .kachel__zeichen {
    grid-area: zeichen;
    width: var(--icon-kachel);
    height: var(--icon-kachel);
    color: var(--color-accent-brown);
}

/*
 * Der Name bricht um, wenn die Spalte zu schmal ist (Telefon, lange Namen wie „Heerschappijgebieden“), mit Silbentrennung aus `html`
 * (`canon.css`); erst ein Wort ohne Trennstelle bricht irgendwo. Abgeschnitten wird er nie, die Zahl darunter schon.
 */
.kachel__name {
    grid-area: name;
    overflow-wrap: anywhere;
}

/*
 * `.einzeilig` schneidet, `.avm-versalmitte` legt den Kasten genau auf die Versalhöhe: Ziffern, Umlautpunkte und Oberlängen reichen
 * darüber und wären oben abgeschnitten. Oben bekommt die Beschneidefläche darum denselben Raum wie `.einzeilig` ihn unten gibt, im
 * Fluss zurückgenommen; die Außenhöhe bleibt die Versalhöhe.
 */
.kachel__zahl,
.steckbrief__titel {
    padding-top: var(--descender-room);
    margin-top: calc(-1 * var(--descender-room));
}

/* Die Zahl hält ihre Zeile auch leer (solange sie lädt), damit beim Eintreffen nichts springt. */
.kachel__zahl {
    grid-area: zahl;
    min-height: 1cap;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

/* Zustände nach §30.5: Hover eine Lasur mit festerem Rand, gedrückt die Aktiv-Lasur, Fokusring, 120 ms. */
button.kachel:hover {
    border-color: var(--color-border-strong);
    background-color: var(--color-hover-wash);
}

button.kachel:active {
    background-color: var(--color-active-wash);
}

.kachel:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Gewählt: Fläche und kräftigerer Rand, kräftige Schrift; kein Balken links (T26 (4)). Sie antwortet nicht mehr auf Hover. */
.kachel.is-gewaehlt,
.kachel.is-gewaehlt:hover {
    border-color: var(--color-border-strong);
    background-color: var(--color-panel-active);
    color: var(--color-text-strong);
}

/* Später: gestrichelt („nicht dauerhaft“, Guide §13.17), blass, nicht greifbar (D16). */
.kachel--spaeter {
    border-style: dashed;
    border-color: var(--color-border-strong);
    background-color: transparent;
    color: var(--color-disabled-text);
    cursor: default;
}

.kachel--spaeter .kachel__zeichen,
.kachel--spaeter .kachel__zahl {
    color: var(--color-disabled-text);
}

.steckbrief {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-inline: var(--space-12);
    padding: var(--space-10) var(--space-12) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.steckbrief__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.steckbrief__zeichen {
    color: var(--color-accent-brown);
}

.steckbrief__titel {
    flex: 0 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: normal;
}

.steckbrief__ansicht {
    flex: none;
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.steckbrief__legende {
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

.karteninhalte__handeln {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-inline: var(--space-12);
}

@media (prefers-reduced-motion: reduce) {
    .kachel {
        transition: none;
    }
}
</style>
