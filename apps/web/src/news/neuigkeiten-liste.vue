<script setup lang="ts">
import { computed } from "vue";
import type { NewsEintrag } from "@avesmaps3d/shared";
import { phoneViewport } from "../controls/phone-viewport";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { locale, t } from "../i18n/i18n";
import { istNeu, nachMonaten, rubrikName, textStuecke } from "./news";

/**
 * Die Reihe der Neuigkeiten: Monatsband, Datumsspalte, Perlenkette, Erzählung — der Inhalt des Fensters `neuigkeiten-fenster.vue`.
 *
 * 🔴 **Aufbau wie Legacys Changelog-Dialog** (Betreiber 2026-10-14: „so anpassen, dass es zu dem design von legacy passt“; Evidenz:
 * `css/components/changelog-dialog.css` und `js/app/changelog-dialog.js` im Discovery-Mirror):
 *
 * - **Monatsband**, das beim Rollen oben stehen bleibt: Bei hundert Einträgen soll nie zu raten sein, in welchem Monat man liest.
 * - **Perlenkette**: Datum rechtsbündig in einer schmalen Spalte, Perle auf der Linie, Erzählung rechts. Dieselbe Geste wie die
 *   Etappenkette im Reiseplan (`route-stage-list.vue`) — der Verlauf ist eine Reise durch die Zeit.
 * - **Die Rubrik-Marke steht unter dem Eintrag**, nicht neben dem Titel.
 *
 * Kein Markdown, kein HTML: die Adressen im Text werden über `textStuecke` zu `FensterVerweis` (nur http(s), mit ↗ aus der Hausregel).
 *
 * 🪤 Diese Datei ist bewusst KEIN `*-fenster.vue`: Die Kette trägt zwei gemessene Maße (Spaltenbreite und Perle), und die stünden im
 * Fenster gegen die Hausregel „nur Kanonwerte“ (`test/fenster-huelle.test.ts`). Wie im Planer, wo `--mark-size` aus demselben Grund in
 * der Liste steht und nicht im Fenster.
 */
const props = defineProps<{ eintraege: readonly NewsEintrag[]; stand: number | null }>();

const monate = computed(() =>
    nachMonaten(props.eintraege).map((monat) => ({
        monat: monat.monat,
        titel: monatText(monat.monat),
        zeilen: monat.eintraege.map((eintrag) => ({
            eintrag,
            tag: tagText(eintrag.datum),
            marke: rubrikName(eintrag.rubrik),
            neu: istNeu(eintrag, props.stand),
            stuecke: textStuecke(eintrag.text),
        })),
    })),
);

function alsDatum(datum: string): Date | null {
    const [jahr, monat, tag] = datum.split("-").map((teil) => Number.parseInt(teil, 10));
    if (jahr === undefined || monat === undefined || tag === undefined) return null;
    return new Date(Date.UTC(jahr, monat - 1, tag));
}

/** „Oktober 2026“ in der Sprache des Lesers — die Überschrift des Bandes, aus `2026-10`. */
function monatText(monat: string): string {
    const datum = alsDatum(`${monat}-01`);
    if (datum === null) return monat;
    return datum.toLocaleDateString(locale.value, { year: "numeric", month: "long", timeZone: "UTC" });
}

/** „13. Oktober“ in der Sprache des Lesers; das Jahr steht schon im Monatsband darüber. Das Datum ist ein Tag, keine Uhrzeit. */
function tagText(datum: string): string {
    const tag = alsDatum(datum);
    if (tag === null) return datum;
    return tag.toLocaleDateString(locale.value, { month: "long", day: "numeric", timeZone: "UTC" });
}
</script>

<template>
    <div class="liste" :class="{ 'liste--telefon': phoneViewport }">
        <template v-for="monat in monate" :key="monat.monat">
            <h3 class="monat">{{ monat.titel }}</h3>
            <article
                v-for="zeile in monat.zeilen"
                :key="zeile.eintrag.id"
                class="eintrag"
                :class="{ 'eintrag--gelesen': !zeile.neu }"
                :data-testid="`news-${String(zeile.eintrag.id)}`"
            >
                <div class="eintrag__datum">
                    {{ zeile.tag }}
                    <span v-if="zeile.neu" class="eintrag__neu">{{ t("news.new") }}</span>
                </div>
                <div class="eintrag__rumpf">
                    <h4 class="eintrag__titel">{{ zeile.eintrag.titel }}</h4>
                    <p class="eintrag__absatz">
                        <template v-for="(stueck, stelle) in zeile.stuecke" :key="stelle">
                            <FensterVerweis v-if="stueck.art === 'verweis'" :ziel="stueck.wert">{{
                                stueck.wert
                            }}</FensterVerweis>
                            <template v-else>{{ stueck.wert }}</template>
                        </template>
                    </p>
                    <span v-if="zeile.marke !== null" class="eintrag__rubrik">{{ zeile.marke }}</span>
                </div>
            </article>
        </template>
    </div>
</template>

<style scoped>
/*
 * Legacys Changelog-Dialog (`css/components/changelog-dialog.css`), auf den Kanon dieses Hauses gelegt. Zwei Maße sind gemessen und
 * stehen deshalb als Zahl da, beide hier oben an EINER Stelle:
 *
 * - `--news-datum`: die Datumsspalte. „30. September“ ist der längste Tag des Bestands und muss ungebrochen hineinpassen.
 * - `--news-perle`: die Perle auf der Linie. Kleiner als die Perle des Planers (`--mark-size`), weil hier keine Ziffer hineingehört -
 *   sie ist ein Punkt auf einer Zeitachse, keine Marke mit Inhalt.
 */
.liste {
    display: flow-root;
    --news-datum: 78px;
    --news-perle: 9px;
    /* Die Mitte der Kette: hinter der Datumsspalte, im halben Spaltenabstand. */
    --news-kette: calc(var(--news-datum) + var(--space-16) / 2);
}

/*
 * Das Monatsband bleibt beim Rollen oben stehen - bei hundert Einträgen soll niemand raten, in welchem Monat er liest. Der eigene Grund
 * ist dafür nötig: darunter läuft die Perlenkette durch.
 *
 * 💣 NICHT `top: 0`: Der Rumpf trägt sein eigenes Polster (`--space-6`), also klebte das Band genau um dieses Polster UNTER der Kante,
 * und in diesem Streifen liefe Text sichtbar durch. Das Band wird deshalb um dasselbe Polster höher gezogen und deckt den Streifen mit
 * einem Schlagschatten in der Grundfarbe ab - der Schatten malt nur, er verschiebt nichts. ⚠️ Die drei Werte sind gekoppelt und lesen
 * dasselbe Token; wer einen von Hand ändert, bekommt den Streifen zurück.
 */
.monat {
    position: sticky;
    top: calc(-1 * var(--space-6));
    z-index: 1;
    margin: var(--space-16) 0 var(--space-8);
    padding: var(--space-4) 0;
    box-shadow: 0 calc(-1 * var(--space-6)) 0 0 var(--color-panel);
    background: var(--color-panel);
    color: var(--color-accent-strong);
    font-size: var(--font-size-subhead);
    font-weight: var(--font-weight-bold);
}

.monat:first-child {
    margin-top: 0;
}

/*
 * Ein Eintrag: Datum links, Erzählung rechts, Perlenkette dazwischen. Die Linie führt von der Perle bis zur nächsten - deshalb reicht
 * sie um `--space-2` über den Eintrag hinaus, und deshalb liegt zwischen zwei Einträgen kein Abstand, nur das Polster dieses Eintrags.
 */
.eintrag {
    position: relative;
    display: grid;
    grid-template-columns: var(--news-datum) 1fr;
    gap: 0 var(--space-16);
    padding-bottom: var(--space-12);
}

.eintrag__datum {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-bold);
    text-align: right;
    white-space: nowrap;
}

.eintrag::before {
    content: "";
    position: absolute;
    left: var(--news-kette);
    top: var(--space-2);
    width: var(--news-perle);
    height: var(--news-perle);
    /* Eine Perle ist rund: 50 % ist hier die FORM, kein Radiuswert. */
    border-radius: 50%;
    border: 1px solid var(--color-panel);
    background: var(--color-accent);
}

/* Die Linie ist eine Haarlinie, also eine KANTE (Guide §5) - kein Kasten mit einer Breite. */
.eintrag::after {
    content: "";
    position: absolute;
    left: calc(var(--news-kette) + var(--news-perle) / 2);
    top: calc(var(--space-2) + var(--news-perle));
    bottom: calc(-1 * var(--space-2));
    border-left: 1px solid var(--color-divider);
}

.eintrag:last-child::after {
    display: none;
}

.eintrag__rumpf {
    padding-left: var(--space-12);
}

.eintrag__titel {
    margin: 0 0 var(--space-2);
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    font-weight: var(--font-weight-bold);
    line-height: var(--leading-snug);
}

.eintrag__absatz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    hyphens: auto;
    overflow-wrap: anywhere;
    /* 🔴 Legacys Texte tragen Zeilenumbrüche (14 der 103 übernommenen Einträge). Ohne dies klebte dort alles in einem Block. */
    white-space: pre-line;
}

.eintrag__rubrik {
    display: inline-block;
    margin-top: var(--space-4);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
}

/* „neu“ steht unter dem Datum, nicht im Titel: die Spalte links trägt alles, was den Eintrag einordnet. */
.eintrag__neu {
    display: block;
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/*
 * 🔴 Gelesen heißt leise, nicht grau: `--color-disabled-text` bedeutet im Haus „nicht verfügbar“ (gesperrte Knöpfe). Ein Eintrag, den
 * man schon kennt, ist verfügbar — man hat ihn nur gesehen. Dieselbe Regel wie im Archiv der Glocke. Der Text ist ohnehin leise, also
 * trägt den Unterschied der Titel.
 */
.eintrag--gelesen .eintrag__titel {
    color: var(--color-text-muted);
    font-weight: var(--font-weight-regular);
}

/*
 * Am Telefon steht das Datum über dem Text und die Kette fällt weg: Die Datumsspalte samt Abstand ist auf einem schmalen Schirm ein
 * Drittel der Breite - der Fließtext bliebe als Schlucht übrig. 🪤 Keine Media-Query: „ist das ein Telefon?“ beantwortet im Haus
 * `phoneViewport` (ein grober Zeiger und eine kurze Bildschirmseite), einmal für alle.
 */
.liste--telefon .eintrag {
    grid-template-columns: 1fr;
    gap: var(--space-2) 0;
}

.liste--telefon .eintrag__datum {
    text-align: left;
}

.liste--telefon .eintrag__neu {
    display: inline;
    margin-left: var(--space-4);
}

.liste--telefon .eintrag__rumpf {
    padding-left: 0;
}

.liste--telefon .eintrag::before,
.liste--telefon .eintrag::after {
    display: none;
}
</style>
