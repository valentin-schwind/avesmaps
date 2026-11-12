<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import {
    auswahlOptionen,
    bereichVon,
    eintragName,
    naechsterFokus,
    unterzeile,
    verweise,
    type SchienenBereich,
} from "./fenster-schiene";

/**
 * Die Schiene eines Fensters (Guide §13.12 „Die Schiene“; WI-0127 SYS-1, SYS-0001 §6.1; Blatt WI-0119 Fassung 2, A1 und A4):
 * Bereiche mit Einträgen links neben dem Rumpf. Ein Eintrag wählt, was der Rumpf zeigt. Sie steht in der Zone `schiene` der
 * Hülle (`AvmFenster`), die sie am Telefon an den Anfang der Leiste legt; dann ist sie eine Auswahl (`telefon`).
 *
 * - 🔴 **Linker Balken plus Fläche** markiert den gewählten Eintrag (Guide §13.12: das dritte Aktivmittel des Hauses, für Zeilen
 *   einer langen Reihe). Der Balken ist immer da, nur farblos; beim Wechsel springt nichts.
 * - Der Stand eines Eintrags steht rechts in einer festen Spalte (`--avm-fenster-schiene-wert`), damit die Werte fluchten.
 * - Bereichsköpfe in Versalien, klappbar; zugeklappt nennt die Unterzeile, was darin steht. Aufgeklappt ist beim Öffnen der
 *   Bereich des gewählten Eintrags, mit `aufgeklappt` jeder. Mit `festeKoepfe` sind die Köpfe nur Zwischenüberschriften (die
 *   Systemsteuerung, Betreiber 2026-10-17).
 * - Ein Verweis öffnet eine eigene Seite in einem neuen Tab und trägt ↗ aus der Hausregel; ein späterer Eintrag steht gestrichelt
 *   und gedämpft da (gestrichelt heißt „nicht dauerhaft“, Guide §13.17) und lässt sich nicht wählen.
 * - Tastatur (SYS-0001 §6.8): Tab erreicht jeden Kopf, Eintrag und Verweis; ↓ ↑ wandern, Pos1 und Ende springen an die Ränder,
 *   Enter und Leertaste wählen. Zustände nach §30.5: Ruhe, Hover-Lasur, gedrückt die Aktiv-Lasur, Fokusring, 120 ms.
 */
const props = defineProps<{
    bereiche: readonly SchienenBereich[];
    /** Name der Schiene für Vorleser, zugleich der Name der Auswahl am Telefon. */
    beschriftung: string;
    /** Vorsilbe der Kennungen und Test-Kennungen, eindeutig auf der Seite. */
    kennung: string;
    /** Am Telefon: eine Auswahl statt der Schiene (die Hülle sagt es, `AvmFenster` Slot `schiene`). */
    telefon?: boolean | undefined;
    /**
     * Ohne Bereichskopf, immer aufgeklappt (WI-0128 E3, heute die Verwaltung): Nennt schon der Reiter den Bereich, zeigt die Schiene nur
     * seine Einträge, Name und Stand. Das Editorpanel zeigt seine Karteninhalte seit WI-0212 als Kacheln.
     */
    ohneKopf?: boolean | undefined;
    /**
     * Alle Bereiche beim Öffnen aufgeklappt, nicht nur der des gewählten Eintrags (Medienarten der Medienverwaltung, Betreiber
     * 2026-10-11: „klappbar machen - standard ausgeklappt“). Zuklappen geht weiter.
     */
    aufgeklappt?: boolean | undefined;
    /**
     * Feste Zwischenüberschriften (die Systemsteuerung, Betreiber 2026-10-17: „vier kleine Zwischenüberschriften in VERSALIEN … nicht
     * anklickbar, nicht einklappbar und besitzen keine Pfeile. Alle Reiter bleiben dauerhaft sichtbar, einspaltig und möglichst
     * einzeilig“): der Kopf ist eine Überschrift, kein Knopf; jede Gruppe steht offen, zwischen den Gruppen nur Abstand, keine Linie;
     * Namen und Stände bleiben auf einer Zeile. Am Telefon bleibt die Auswahl ohne Gruppennamen, damit sie kurz bleibt.
     */
    festeKoepfe?: boolean | undefined;
}>();
const aktiv = defineModel<string>({ required: true });

const nav = useTemplateRef<HTMLElement>("nav");

const anfangsBereich = bereichVon(props.bereiche, aktiv.value);
const offen = ref(
    new Set<string>(
        props.aufgeklappt
            ? props.bereiche.map((bereich) => bereich.id)
            : anfangsBereich === undefined
              ? []
              : [anfangsBereich],
    ),
);

function umklappen(id: string): void {
    const naechste = new Set(offen.value);
    if (naechste.has(id)) naechste.delete(id);
    else naechste.add(id);
    offen.value = naechste;
}

const listeId = (bereich: string): string => `${props.kennung}-bereich-${bereich}`;
const eintragId = (eintrag: string): string => `${props.kennung}-eintrag-${eintrag}`;

const optionen = computed(() => auswahlOptionen(props.bereiche, props.ohneKopf || props.festeKoepfe));
const telefonVerweise = computed(() => verweise(props.bereiche));

/** ↓ ↑ Pos1 Ende über alles, was sich in der Schiene bedienen lässt. */
function taste(event: KeyboardEvent): void {
    const ziele = [...(nav.value?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])].filter(
        (element) => element.offsetParent !== null,
    );
    const index = ziele.indexOf(document.activeElement as HTMLElement);
    const ziel = naechsterFokus(event.key, index, ziele.length);
    if (ziel === null) return;
    event.preventDefault();
    ziele[ziel]?.focus();
}
</script>

<template>
    <div v-if="props.telefon" class="fenster-schiene-telefon" :data-testid="`${props.kennung}-schiene`">
        <AvmAuswahl
            v-model="aktiv"
            class="fenster-schiene-telefon__auswahl"
            :optionen="optionen"
            :aria-label="props.beschriftung"
            :testid="`${props.kennung}-auswahl`"
        />
        <a
            v-for="eintrag in telefonVerweise"
            :key="eintrag.id"
            class="fenster-schiene-telefon__verweis"
            :href="eintrag.href"
            target="_blank"
            rel="noopener"
            :data-testid="eintragId(eintrag.id)"
            >{{ eintrag.name }}</a
        >
    </div>
    <nav
        v-else
        ref="nav"
        class="fenster-schiene"
        :class="{ 'fenster-schiene--durchgehend': props.ohneKopf, 'fenster-schiene--fest': props.festeKoepfe }"
        :aria-label="props.beschriftung"
        :data-testid="`${props.kennung}-schiene`"
        @keydown="taste"
    >
        <section
            v-for="bereich in props.bereiche"
            :key="bereich.id"
            class="fenster-schiene__bereich"
            :data-testid="`${props.kennung}-bereich-${bereich.id}`"
        >
            <p
                v-if="props.festeKoepfe"
                class="fenster-schiene__gruppe avm-versalmitte einzeilig"
                role="heading"
                aria-level="3"
                :data-testid="`${props.kennung}-bereich-kopf-${bereich.id}`"
            >
                {{ bereich.name }}
            </p>
            <button
                v-else-if="!props.ohneKopf"
                type="button"
                class="fenster-schiene__kopf"
                :aria-expanded="offen.has(bereich.id)"
                :aria-controls="listeId(bereich.id)"
                :data-testid="`${props.kennung}-bereich-kopf-${bereich.id}`"
                @click="umklappen(bereich.id)"
            >
                <span class="fenster-schiene__titel avm-versalmitte">{{ bereich.name }}</span>
                <svg
                    class="fenster-schiene__winkel"
                    :class="{ 'is-offen': offen.has(bereich.id) }"
                    viewBox="0 0 6 8"
                    aria-hidden="true"
                >
                    <path
                        d="M1.25 1 4.5 4 1.25 7"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </button>
            <p v-if="!props.ohneKopf && !props.festeKoepfe && !offen.has(bereich.id)" class="fenster-schiene__unter">
                {{ unterzeile(bereich) }}
            </p>
            <ul
                v-show="props.ohneKopf || props.festeKoepfe || offen.has(bereich.id)"
                :id="listeId(bereich.id)"
                class="fenster-schiene__liste"
            >
                <li v-for="eintrag in bereich.eintraege" :key="eintrag.id">
                    <button
                        v-if="eintrag.art === 'ansicht'"
                        :id="eintragId(eintrag.id)"
                        type="button"
                        class="fenster-schiene__eintrag"
                        :class="{ 'is-aktiv': aktiv === eintrag.id }"
                        :aria-current="aktiv === eintrag.id ? 'page' : undefined"
                        :data-testid="eintragId(eintrag.id)"
                        @click="aktiv = eintrag.id"
                    >
                        <span class="fenster-schiene__name avm-versalmitte" :class="{ einzeilig: props.festeKoepfe }">{{
                            eintragName(eintrag)
                        }}</span>
                        <span class="fenster-schiene__wert avm-versalmitte">{{ eintrag.wert }}</span>
                    </button>
                    <a
                        v-else-if="eintrag.art === 'verweis'"
                        class="fenster-schiene__eintrag fenster-schiene__eintrag--verweis"
                        :href="eintrag.href"
                        target="_blank"
                        rel="noopener"
                        :data-testid="eintragId(eintrag.id)"
                    >
                        <span
                            class="fenster-schiene__name avm-versalmitte avm-nach-draussen"
                            :class="{ einzeilig: props.festeKoepfe }"
                            >{{ eintrag.name }}</span
                        >
                        <span class="fenster-schiene__wert avm-versalmitte">{{ eintrag.wert }}</span>
                    </a>
                    <span
                        v-else
                        class="fenster-schiene__eintrag fenster-schiene__eintrag--spaeter"
                        aria-disabled="true"
                        :data-testid="eintragId(eintrag.id)"
                    >
                        <span class="fenster-schiene__name avm-versalmitte" :class="{ einzeilig: props.festeKoepfe }">{{
                            eintrag.name
                        }}</span>
                        <span class="fenster-schiene__wert avm-versalmitte">{{ eintrag.wert }}</span>
                    </span>
                </li>
            </ul>
        </section>
    </nav>
</template>

<style scoped>
/*
 * Maße aus dem Blatt der Systemsteuerung (WI-0119 Fassung 2, `mockup.css` `.schiene`), Werte nur aus dem Kanon. Die Fläche und
 * die Haarlinie zum Rumpf trägt die Zone der Hülle; hier steht nur der Inhalt.
 */
.fenster-schiene {
    display: flex;
    flex-direction: column;
    padding: var(--space-6) var(--space-4) var(--space-6) 0;
}

.fenster-schiene__bereich {
    display: flex;
    flex-direction: column;
}

.fenster-schiene__bereich + .fenster-schiene__bereich {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

/*
 * Ohne Bereichsköpfe ist die Schiene EINE Liste (Betreiber 2026-10-14: „keine trennlinie, keine gruppierungen“). Eine Naht
 * zwischen Gruppen, die keinen Namen mehr tragen, trennt nur noch willkürlich: Der Blick sucht einen Unterschied, den es
 * nicht gibt. Die Bereiche bleiben im Markup — sie ordnen die Einträge und tragen ihre Test-Kennungen.
 */
.fenster-schiene--durchgehend .fenster-schiene__bereich + .fenster-schiene__bereich {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
}

/*
 * Feste Zwischenüberschriften (`festeKoepfe`): nur Abstand zwischen den Gruppen, keine Linie und kein Kasten (Betreiber 2026-10-17:
 * „Etwas vertikaler Abstand zwischen den Gruppen. Keine zusätzlichen Kästen, Rahmen oder aufklappbaren Bereiche“). Die Überschrift ist
 * klein, in Versalien aus dem Rahmen (die Tafel schreibt den Namen normal) und in der Farbe der Bereichsköpfe aus Blatt WI-0119 und
 * SYS-1 (`--color-accent-strong`; Betreiber 2026-10-17: „kannst du den versalien-headern ne passende farbe geben (du hattest früher
 * mal was)“). Sie steht links vor den Namen der Einträge
 * und hat rechts keinen Rand (dort steht bei Einträgen der Stand): Erst so passt „REDAKTION & ZUSAMMENARBEIT“ in die 228 px der Schiene
 * (`--avm-fenster-schiene`, Betreiber 2026-10-10 „4. A“); mit dem Einzug der Namen fehlten 14 px.
 */
.fenster-schiene--fest .fenster-schiene__bereich + .fenster-schiene__bereich {
    margin-top: var(--space-12);
    padding-top: 0;
    border-top: none;
}

.fenster-schiene__gruppe {
    margin: calc(-1 * var(--descender-room)) 0;
    padding: calc(var(--space-2) + var(--descender-room)) 0 calc(var(--space-4) + var(--descender-room)) var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/*
 * Einzeilig (Betreiber 2026-10-17: „Lange Reiternamen und Statusanzeigen dürfen keine zweite Zeile … erzeugen“): Köpfe und Namen
 * kürzen über `.einzeilig` (app.vue), zu Langes endet mit „…“. 🪤 `avm-versalmitte` schneidet den Kasten auch OBEN auf Versalhöhe;
 * `.einzeilig` bringt nur unten Luft mit, darum hier dieselbe Luft oben, sonst fehlen Akzente über Versalien (É, Sichtprüfung
 * 2026-10-17). Der Kopf trägt die Luft in seinem Polster.
 */
.fenster-schiene--fest .fenster-schiene__name {
    margin-top: calc(-1 * var(--descender-room));
    padding-top: var(--descender-room);
    overflow-wrap: normal;
}

.fenster-schiene__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-6) var(--space-8) var(--space-6) var(--space-12);
    border: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: transparent;
    color: var(--color-accent-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-align: left;
    text-transform: uppercase;
    transition: background-color 120ms ease;
}

.fenster-schiene__titel {
    flex: 1 1 auto;
    min-width: 0;
}

.fenster-schiene__winkel {
    flex: none;
    width: var(--space-6);
    height: var(--space-6);
    color: var(--color-text-muted);
    transition: transform 120ms ease;
}

/* Aufgeklappt zeigt der Winkel nach unten (Blatt: ⌄ offen, › zu). */
.fenster-schiene__winkel.is-offen {
    transform: rotate(90deg);
}

.fenster-schiene__unter {
    margin: 0;
    padding: 0 var(--space-8) var(--space-2) var(--space-12);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.fenster-schiene__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile: Name links, Stand rechts in fester Spalte; der Balken links immer da, nur farblos (§13.12). */
.fenster-schiene__eintrag {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-8) var(--space-8) var(--space-8) var(--space-10);
    border: 0;
    border-left: var(--avm-fenster-schiene-kante) solid transparent;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    text-decoration: none;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.fenster-schiene__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.fenster-schiene__wert {
    min-width: var(--avm-fenster-schiene-wert);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    text-align: right;
    white-space: nowrap;
}

/* Der Pfeil steht am Namen (`.avm-nach-draussen`), nicht hinter der Wertspalte: als Rasterzelle stünde er in einer eigenen Spalte. */
a.fenster-schiene__eintrag::after {
    content: none;
}

/* Hover ist eine Lasur (§30.1); der Kopf behält seine Farbe, ein Eintrag wird kräftig. */
.fenster-schiene__kopf:hover {
    background: var(--color-hover-wash);
}

button.fenster-schiene__eintrag:hover,
a.fenster-schiene__eintrag:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.fenster-schiene__kopf:active,
button.fenster-schiene__eintrag:active,
a.fenster-schiene__eintrag:active {
    background: var(--color-active-wash);
}

.fenster-schiene__kopf:focus-visible,
.fenster-schiene__eintrag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Gewählt: Fläche und goldener Balken, kräftige Schrift; er antwortet nicht mehr auf Hover. */
.fenster-schiene__eintrag.is-aktiv,
.fenster-schiene__eintrag.is-aktiv:hover {
    border-left-color: var(--color-accent);
    background: var(--color-panel-active);
    color: var(--color-text-strong);
}

/* Ein späterer Eintrag: gestrichelt und gedämpft, nicht greifbar (Blatt A1 „Claudio · später“). */
.fenster-schiene__eintrag--spaeter {
    width: auto;
    margin-left: var(--space-6);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-sm);
    color: var(--color-disabled-text);
    cursor: default;
}

.fenster-schiene__eintrag--spaeter .fenster-schiene__wert {
    color: var(--color-disabled-text);
}

/* Am Telefon: die Auswahl füllt die Zeile, ein Verweis steht daneben. */
.fenster-schiene-telefon {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6) var(--space-12);
}

.fenster-schiene-telefon__auswahl {
    flex: 1 1 auto;
    min-width: 0;
}

.fenster-schiene-telefon__verweis {
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--color-link);
    font-size: var(--font-size-small);
    text-decoration: none;
    transition: color 120ms ease;
}

.fenster-schiene-telefon__verweis:hover {
    color: var(--color-link-hover);
}

.fenster-schiene-telefon__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .fenster-schiene__kopf,
    .fenster-schiene__winkel,
    .fenster-schiene__eintrag,
    .fenster-schiene-telefon__verweis {
        transition: none;
    }
}
</style>
