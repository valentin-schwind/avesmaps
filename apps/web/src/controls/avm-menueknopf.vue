<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from "vue";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import { menueLage, menueSeite, menueTaste, startIndex, type MenueOption } from "./avm-menueknopf";

/**
 * Der Menüknopf (WI-0122 zweiter Nachtrag, Betreiber 2026-10-09: „kannst du das dropdown zum icon machen und rechts neben die
 * suchmaske“): ein Symbolknopf in Bedienhöhe, der ein kleines Menü mit einer Wahl aus wenigen Einträgen öffnet. Das Zeichen
 * zeigt die aktive Wahl, der Name des Knopfs nennt sie („Stätten ordnen: alphabetisch“).
 *
 * - **Der Knopf** trägt die Fassung des Felds, neben dem er steht (Kante, Fläche und Radius wie `AvmEingabe` und `AvmAuswahl`),
 *   damit Feld und Knopf als ein Paar lesen. Das Zeichen zeichnet der Aufrufer (Slot `zeichen`, mit dem Wert, den es zeigen
 *   soll), in der Schriftfarbe, wie die Lupe im Feld (Guide §6: eine Bedienhandlung wird gezeichnet, nicht gemalt).
 * - **Das Menü** ist das Blatt des Kartenmenüs (Guide §18, `area-choice-menu.vue`): Fläche, Kante, Radius 10, Schatten, eine
 *   Marke ● an der aktiven Wahl, die Fläche färbt sich unter Zeiger und Fokus. 🔴 **Es zeichnet die Seite, kein natives
 *   `<select>`** - die Liste eines `<select>` zeichnet das Betriebssystem, und kein Bild der Seite erfasst sie.
 * - **Tasten** (`avm-menueknopf.ts`): Enter, Leertaste oder Pfeil öffnen, der Fokus steht auf der aktiven Wahl; Pfeile
 *   wandern und laufen um, Pos1 und Ende springen; Enter oder Leertaste wählen; Esc schließt; nach Wahl und Esc kehrt der
 *   Fokus zum Knopf zurück. Tab und ein Klick daneben schließen, ohne den Fokus zu holen. Esc nimmt das Menü am eigenen
 *   Element (es hat den Fokus, `escape-cascade.ts`); ist der Fokus woanders, schließt es über die Kaskade, Stufe „menus“.
 * - Es geht über allem auf (`Teleport` an `body`, fest an den Knopf gerechnet): Im Infopanel schnitte sonst der Deckel es ab,
 *   der für sein Aufklappen `overflow: hidden` trägt. 💣 **In einem modalen Fenster** (`imFenster`, Guide §13.45) bleibt es im Fenster:
 *   Am `body` läge es unter dem `<dialog>` der obersten Ebene und nähme keinen Klick an; `position: fixed` hebt es trotzdem über
 *   jede rollende Spalte. Dort öffnet es auf der Seite seines Knopfs (links linksbündig, rechts rechtsbündig). Ein Bildlauf oder eine neue Fenstergröße schließt es, wie die Bewegung
 *   der Karte das Kartenmenü schließt - ein Blatt, das stehen bliebe, zeigte auf nichts mehr.
 * - **Zustände nach Guide §30.5:** Ruhe; Hover färbt die Fläche (eine Lasur über der Fassung, §30.1 „geschichtet, nicht
 *   gesetzt“) und die Kante wird kräftiger; gedrückt und offen die dunklere Lasur; Fokus nur über die Tastatur, goldene Kante
 *   und der Ring des Hauses; 120 ms `ease`, bei reduzierter Bewegung ohne Übergang. Nie Deckkraft (§30.2).
 * - **Zwei Fassungen:** `feld` (Vorgabe) ist die oben beschriebene Fassung des Felds daneben. `bauart="pille"` ist die
 *   gefüllte Pille des Sprachschalters (WI-0032, 20 px hoch, Aufschrift in der 8-px-Ausnahme `--font-size-lang`): Sie steht
 *   allein im Planerkopf, hat kein Feld neben sich und trägt deshalb die Fassung des gefüllten Knopfs (§13.11). Was auf dem
 *   geschlossenen Knopf steht, zeichnet dort der Aufrufer (Slot `knopf`); ohne diesen Slot steht wie bisher das Zeichen darin.
 *   Die Pille bleibt auch am Finger 20 px hoch, wie seit WI-0032: ihr Maß kommt von Legacy und wurde so abgenommen.
 * - **Am Finger** ist der Knopf ein Fingerziel (44 × 44 px, wie die Kamerasteuerung, `camera-controls.vue`) und die Einträge
 *   tragen die Schrift der Bedienelemente am Finger (16 px).
 */
const props = defineProps<{
    optionen: readonly MenueOption[];
    /** Der Name des Knopfs samt aktiver Wahl („Stätten ordnen: alphabetisch“), für Vorleser und als `title`. */
    bezeichnung: string;
    /** Der Name des Menüs („Stätten ordnen“). */
    menueBezeichnung: string;
    /** In einem modalen Fenster: das Menü bleibt im Fenster (kein `Teleport`) und richtet sich nach der Seite des Knopfs. */
    imFenster?: boolean | undefined;
    /** Die Fassung des Knopfs: `feld` (Vorgabe) wie das Feld daneben, `pille` die gefüllte Pille des Sprachschalters. */
    bauart?: "feld" | "pille" | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<string>({ required: true });

const offen = ref(false);
const lage = ref({ top: 0, left: 0 });
const knopf = useTemplateRef<HTMLButtonElement>("knopf");
const menue = useTemplateRef<HTMLDivElement>("menue");
const menueId = useId();

/** Abstand zum Knopf und zum Fensterrand: die Sprossen `space-2` und `space-6` (4 und 8 px). */
const ABSTAND = 4;
const RAND = 8;

const eintraege = (): HTMLButtonElement[] => [...(menue.value?.querySelectorAll<HTMLButtonElement>("button") ?? [])];

async function oeffnen(): Promise<void> {
    if (offen.value) return;
    offen.value = true;
    listen(true);
    await nextTick();
    const box = knopf.value?.getBoundingClientRect();
    const blatt = menue.value?.getBoundingClientRect();
    if (box && blatt) {
        const bereich =
            props.imFenster === true
                ? (knopf.value?.closest("dialog")?.getBoundingClientRect() ?? { left: 0, width: globalThis.innerWidth })
                : undefined;
        lage.value = menueLage(
            box,
            blatt,
            { width: globalThis.innerWidth, height: globalThis.innerHeight },
            ABSTAND,
            RAND,
            bereich === undefined ? "rechts" : menueSeite(box, bereich),
        );
        await nextTick();
    }
    // `preventScroll`: Ein Bildlauf schlösse das Menü, kaum dass es offen ist.
    eintraege()[startIndex(props.optionen, wert.value)]?.focus({ preventScroll: true });
}

function schliessen(zurueck: boolean): void {
    if (!offen.value) return;
    offen.value = false;
    listen(false);
    if (zurueck) knopf.value?.focus();
}

function waehlen(neu: string): void {
    wert.value = neu;
    schliessen(true);
}

function umschalten(): void {
    if (offen.value) schliessen(false);
    else void oeffnen();
}

/** Ein Pfeil auf dem geschlossenen Knopf öffnet das Menü (Enter und Leertaste klicken ihn ohnehin). */
function onKnopfTaste(event: KeyboardEvent): void {
    if (offen.value || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    void oeffnen();
}

function onMenueTaste(event: KeyboardEvent): void {
    const liste = eintraege();
    const schritt = menueTaste(event.key, liste.indexOf(document.activeElement as HTMLButtonElement), liste.length);
    if (schritt.art === "nichts") return;
    if (schritt.art === "fokus") {
        event.preventDefault();
        // Die Pfeile gehören dem Menü, nicht der Karte und nicht dem Panel.
        event.stopPropagation();
        liste[schritt.index]?.focus();
        return;
    }
    if (schritt.zurueck) {
        // Esc gehört hier dem Menü: verbraucht, damit die Tastatur der Seite nicht noch das Panel schließt.
        event.preventDefault();
        event.stopPropagation();
    }
    schliessen(schritt.zurueck);
}

function onDraussen(event: PointerEvent): void {
    const ziel = event.target as Node;
    if (knopf.value?.contains(ziel) || menue.value?.contains(ziel)) return;
    schliessen(false);
}

const onVerschoben = (): void => schliessen(false);

function listen(an: boolean): void {
    if (an) {
        document.addEventListener("pointerdown", onDraussen, true);
        document.addEventListener("scroll", onVerschoben, true);
        globalThis.addEventListener("resize", onVerschoben);
    } else {
        document.removeEventListener("pointerdown", onDraussen, true);
        document.removeEventListener("scroll", onVerschoben, true);
        globalThis.removeEventListener("resize", onVerschoben);
    }
}

const kaskade = inject(ESCAPE_CASCADE_KEY, undefined);
let abmelden: (() => void) | undefined;
onMounted(() => {
    abmelden = kaskade?.register("menus", () => {
        if (!offen.value) return false;
        schliessen(true);
        return true;
    });
});

onBeforeUnmount(() => {
    listen(false);
    abmelden?.();
});
</script>

<template>
    <span class="menueknopf-huelle">
        <button
            ref="knopf"
            type="button"
            class="menueknopf"
            :class="{ 'is-offen': offen, 'menueknopf--pille': props.bauart === 'pille' }"
            :aria-label="props.bezeichnung"
            :title="props.bezeichnung"
            aria-haspopup="menu"
            :aria-expanded="offen"
            :aria-controls="offen ? menueId : undefined"
            :data-testid="props.testid"
            @click="umschalten"
            @keydown="onKnopfTaste"
        >
            <slot name="knopf" :wert="wert">
                <span class="menueknopf__zeichen" aria-hidden="true"><slot name="zeichen" :wert="wert" /></span>
            </slot>
        </button>
        <Teleport to="body" :disabled="props.imFenster === true">
            <div
                v-if="offen"
                :id="menueId"
                ref="menue"
                class="menueknopf__menue"
                role="menu"
                :aria-label="props.menueBezeichnung"
                :style="{ top: `${String(lage.top)}px`, left: `${String(lage.left)}px` }"
                :data-testid="props.testid === undefined ? undefined : `${props.testid}-menue`"
                @keydown="onMenueTaste"
            >
                <button
                    v-for="option in props.optionen"
                    :key="option.wert"
                    type="button"
                    class="menueknopf__eintrag"
                    role="menuitemradio"
                    :aria-checked="option.wert === wert"
                    :data-wert="option.wert"
                    :data-testid="props.testid === undefined ? undefined : `${props.testid}-${option.wert}`"
                    @click="waehlen(option.wert)"
                >
                    <span class="menueknopf__marke" aria-hidden="true"></span>
                    <span v-if="$slots.zeichen" class="menueknopf__zeichen" aria-hidden="true"
                        ><slot name="zeichen" :wert="option.wert"
                    /></span>
                    <span class="menueknopf__text avm-versalmitte">{{ option.text }}</span>
                </button>
            </div>
        </Teleport>
    </span>
</template>

<style scoped>
.menueknopf-huelle {
    display: inline-flex;
    flex: none;
}

/*
 * Der Knopf in der Fassung des Felds daneben (`avm-eingabe.vue`, `avm-auswahl.vue`): Kante `border`, Fläche `panel`, Radius
 * `md`, so hoch wie die Hülle ihn stellt (`align-self: stretch`), mindestens Bedienhöhe und quadratisch.
 */
.menueknopf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--avm-control-h);
    min-height: var(--avm-control-h);
    margin: 0;
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

/* §30.1: Die Lasur liegt ÜBER der Fassung (geschichtet), sie ersetzt sie nicht. */
.menueknopf:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.menueknopf:active,
.menueknopf.is-offen {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
    color: var(--color-text-strong);
}

.menueknopf:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

/*
 * Die Pille (`bauart="pille"`): die Fassung des gefüllten Knopfs (`avm-knopf.vue` §13.11), 20 px hoch wie der
 * Sprachschalter seit WI-0032. Sie steht ohne Feld daneben, deshalb die gefüllte Fläche statt der Feldfassung; die Lasur
 * der Feldfassung wird dabei ausdrücklich abgeräumt (`background-image: none`), sonst läge sie über der Füllung.
 */
.menueknopf--pille {
    min-width: 0;
    min-height: 20px;
    padding: 0 var(--space-4);
    border-color: var(--color-button-border);
    background-color: var(--color-button);
    color: var(--color-button-text);
    font-size: var(--font-size-lang);
    letter-spacing: 0.03em;
}

.menueknopf--pille:hover {
    border-color: var(--color-button-border);
    background-color: var(--color-button-hover);
    background-image: none;
    color: var(--color-button-text);
}

.menueknopf--pille:active,
.menueknopf--pille.is-offen {
    border-color: var(--color-button-border);
    background-color: var(--color-button-active);
    background-image: none;
    color: var(--color-button-text);
}

.menueknopf--pille:focus-visible {
    border-color: var(--color-accent-strong);
}

.menueknopf__zeichen {
    display: inline-flex;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.menueknopf__zeichen > :slotted(svg) {
    width: 100%;
    height: 100%;
}

/* Das Blatt des Kartenmenüs (Guide §18, `area-choice-menu.vue`). */
.menueknopf__menue {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
}

.menueknopf__eintrag {
    display: grid;
    grid-template-columns: 1em auto auto;
    align-items: center;
    justify-content: start;
    column-gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    min-height: calc(var(--avm-control-h) + var(--space-2));
    padding: 0 var(--space-10) 0 var(--space-6);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    white-space: nowrap;
    transition: background-color 120ms ease;
}

.menueknopf__eintrag .menueknopf__zeichen {
    color: var(--color-text-muted);
}

/* Die Marke der aktiven Wahl steht im Stylesheet wie jeder Glyph im Haus; ihre Bedeutung trägt `aria-checked`. */
.menueknopf__marke {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

.menueknopf__eintrag[aria-checked="true"] > .menueknopf__marke::before {
    content: "●";
}

.menueknopf__eintrag:hover,
.menueknopf__eintrag:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
}

.menueknopf__eintrag:active {
    background: var(--color-active-wash);
}

/* Am Finger: ein Fingerziel (44 px, Apple HIG - dasselbe Maß wie die Kamerasteuerung) und die Schrift der Bedienelemente. */
@media (pointer: coarse) {
    .menueknopf,
    .menueknopf__eintrag {
        --menueknopf-finger: 44px;
    }

    .menueknopf {
        min-width: var(--menueknopf-finger);
        min-height: var(--menueknopf-finger);
    }

    .menueknopf__eintrag {
        min-height: var(--menueknopf-finger);
        font-size: var(--font-size-touch);
    }

    /* Die Pille bleibt bei ihren 20 px: Legacys Maß, 2026-09-25 so abgenommen. Ihre Einträge wachsen trotzdem mit. */
    .menueknopf--pille {
        min-width: 0;
        min-height: 20px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .menueknopf,
    .menueknopf__eintrag {
        transition: none;
    }
}
</style>
