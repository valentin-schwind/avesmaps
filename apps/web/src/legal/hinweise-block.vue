<script setup lang="ts">
import type { HinweisBlock } from "@avesmaps3d/shared";
import InfoZeichen from "../fenster/info-zeichen.vue";
import { t } from "../i18n/i18n";
import HinweiseAnker from "./hinweise-anker.vue";
import HinweiseDiscordKnopf from "./hinweise-discord-knopf.vue";
import { klartext } from "./hinweise-inline";
import HinweiseText from "./hinweise-text.vue";

/**
 * Ein Block der Hinweise. Die Überschriften stehen eine Stufe unter dem Titel ihres Abschnitts (dort ein `h3`), die Klasse trägt den Namen aus dem Modell. Die Tafeln sind bewusst keine `FensterTafel`:
 * Der Betreiber nahm für diesen Lesetext Linien statt Zebra und Kopfband ab (Mockup vom 2026-11-04, seine Satzregeln: Struktur über feine Linien).
 *
 * „Nachricht schreiben“ schließt das Fenster; das tut das Fenster selbst (`data-hinweis-kontakt`).
 */
defineProps<{ block: HinweisBlock }>();
</script>

<template>
    <p v-if="block.art === 'lead'" class="satz-lead"><HinweiseText :text="block.text" /></p>

    <p v-else-if="block.art === 'absatz'" class="satz-absatz"><HinweiseText :text="block.text" /></p>

    <h4 v-else-if="block.art === 'h3'" class="satz-h3 hinweis-traeger" :data-hinweis="block.id">
        <span>{{ block.text }}</span>
        <HinweiseAnker :kennung="block.id" :punkt="block.text" />
    </h4>

    <h5 v-else-if="block.art === 'h4'" class="satz-h4 hinweis-traeger" :data-hinweis="block.id">
        <span>{{ block.text }}</span>
        <HinweiseAnker :kennung="block.id" :punkt="block.text" />
    </h5>

    <dl v-else-if="block.art === 'fakten'" class="satz-fakten">
        <div v-for="zeile in block.zeilen" :key="zeile.id" class="satz-zeile" :data-hinweis="zeile.id">
            <dt class="hinweis-traeger">
                <span><HinweiseText :text="zeile.begriff" /></span>
                <HinweiseAnker :kennung="zeile.id" :punkt="klartext(zeile.begriff)" />
            </dt>
            <dd>
                <template v-for="(wert, nr) in zeile.werte" :key="nr">
                    <p v-if="typeof wert === 'string'" class="satz-absatz"><HinweiseText :text="wert" /></p>
                    <ul v-else class="satz-liste">
                        <li v-for="punkt in wert" :key="punkt"><HinweiseText :text="punkt" /></li>
                    </ul>
                </template>
            </dd>
        </div>
    </dl>

    <div v-else-if="block.art === 'tafel'" class="satz-tafel">
        <table>
            <thead>
                <tr>
                    <th v-for="kopf in block.kopf" :key="kopf" scope="col">{{ kopf }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="zeile in block.zeilen" :key="zeile.id" :data-hinweis="zeile.id">
                    <th scope="row" class="hinweis-traeger">
                        <span><HinweiseText :text="zeile.zellen[0]" /></span>
                        <HinweiseAnker
                            :kennung="zeile.id"
                            :punkt="
                                zeile.zellen
                                    .slice(0, block.schluesselSpalten)
                                    .map((zelle) => klartext(zelle))
                                    .join(' ')
                            "
                        />
                    </th>
                    <td v-for="(zelle, nr) in zeile.zellen.slice(1)" :key="nr"><HinweiseText :text="zelle" /></td>
                </tr>
            </tbody>
        </table>
    </div>

    <ul v-else-if="block.art === 'liste'" class="satz-liste">
        <li v-for="punkt in block.punkte" :key="punkt"><HinweiseText :text="punkt" /></li>
    </ul>

    <aside v-else-if="block.art === 'kasten'" class="satz-kasten">
        <h6 class="satz-h5">
            <span class="satz-info"><InfoZeichen /></span>
            <span>{{ block.titel }}</span>
        </h6>
        <p v-for="absatz in block.absaetze" :key="absatz" class="satz-absatz"><HinweiseText :text="absatz" /></p>
    </aside>

    <div v-else-if="block.art === 'frage'" class="satz-faq" :data-hinweis="block.id">
        <h4 class="satz-faq__frage hinweis-traeger">
            <span>{{ block.frage }}</span>
            <HinweiseAnker :kennung="block.id" :punkt="block.frage" />
        </h4>
        <p class="satz-absatz"><HinweiseText :text="block.antwort" /></p>
    </div>

    <p v-else-if="block.art === 'sprungliste'" class="satz-links">
        <span class="satz-links__wort">{{ block.wort }}</span>
        <template v-for="(ziel, nr) in block.ziele" :key="ziel.ziel">
            <span v-if="nr > 0" class="satz-links__punkt" aria-hidden="true">·</span>
            <span><HinweiseText :text="`[${ziel.text}](${ziel.ziel})`" /></span>
        </template>
    </p>

    <img
        v-else-if="block.art === 'bild'"
        class="satz-bild"
        :src="block.src"
        :width="block.breite"
        :height="block.hoehe"
        :alt="block.alt"
        loading="lazy"
    />

    <div v-else-if="block.art === 'kontaktknoepfe'" class="satz-knoepfe">
        <HinweiseDiscordKnopf />
        <button type="button" class="kachel__knopf" data-testid="notes-kontakt" data-hinweis-kontakt>
            <span>{{ t("notes.kontakt.action") }}</span>
        </button>
    </div>
</template>

<style scoped src="./hinweise-knopf.css"></style>

<style scoped>
.satz-absatz,
.satz-lead {
    margin: 0;
    text-wrap: pretty;
}

.satz-lead {
    margin-bottom: var(--space-2);
}

/* Zwischenüberschrift: kleiner als die Klappzeile, mit einer Linie bis zum Rand. Bleibt ungetrennt: Eine Überschrift ist zu kurz für einen Strich. */
.satz-h3 {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin: var(--space-20) 0 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-reading);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
    hyphens: manual;
}

.satz-h3::after {
    flex: 1 1 var(--space-12);
    height: 1px;
    background: var(--color-divider);
    content: "";
}

.satz > .satz-h3:first-child {
    margin-top: 0;
}

/* Unterpunkt: warmes Gold, in der Größe des Texts. */
.satz-h4 {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-hinweise-unterpunkt);
    font-size: var(--font-size-hinweise-text);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
    hyphens: manual;
}

.satz-h5 {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-hinweise-text);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}

.satz-liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding-left: 1.3em;
}

.satz-liste li {
    padding-left: 0.15em;
    text-wrap: pretty;
}

.satz-liste li::marker {
    color: var(--color-accent);
    font-size: 1.15em;
}

/* Faktenzeilen: der Begriff links, sein Wert rechts, zwischen den Zeilen eine feine Linie. */
.satz-fakten {
    display: flex;
    flex-direction: column;
    margin: 0;
}

.satz-zeile {
    display: grid;
    grid-template-columns: var(--avm-fenster-hinweise-begriff) minmax(0, 1fr);
    gap: var(--space-2) var(--space-12);
    padding-block: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

.satz-zeile:last-child {
    border-bottom: 1px solid var(--color-divider);
}

.satz-zeile dt {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-hinweise-text);
    hyphens: auto;
}

.satz-zeile dd {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    margin: 0;
}

.satz-faq {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-10);
    border-top: 1px solid var(--color-divider);
}

.satz-faq:last-child {
    border-bottom: 1px solid var(--color-divider);
}

.satz-faq__frage {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-hinweise-text);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
    hyphens: manual;
}

.satz-kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-block: var(--space-2);
    padding: var(--space-10) var(--space-12);
    border-left: 3px solid var(--color-accent);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    background: var(--color-panel-soft);
}

.satz-info {
    flex: 0 0 auto;
    width: var(--icon-kachel);
    height: var(--icon-kachel);
    color: var(--color-accent);
}

.satz-links {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--font-size-body);
    hyphens: manual;
}

.satz-links__wort {
    color: var(--color-text-strong);
}

.satz-links__punkt {
    color: var(--color-text-muted);
}

.satz-tafel table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
    hyphens: auto;
}

.satz-tafel th,
.satz-tafel td {
    padding: var(--space-4) var(--space-8) var(--space-4) 0;
    border-top: 1px solid var(--color-divider);
    font-weight: var(--font-weight-regular);
    text-align: left;
    vertical-align: top;
}

.satz-tafel thead th {
    border-top: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.satz-tafel tbody th {
    width: 30%;
    color: var(--color-text-strong);
}

.satz-tafel tbody th > span {
    margin-right: var(--space-2);
}

.satz-tafel tbody tr:last-child th,
.satz-tafel tbody tr:last-child td {
    border-bottom: 1px solid var(--color-divider);
}

.satz-bild {
    display: block;
    width: min(100%, var(--avm-fenster-hinweise-bild));
    height: auto;
    margin: var(--space-2) auto 0;
}

.satz-knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}

/* Am Telefon steht alles untereinander: Begriff über Wert, Tafelzeile als Stapel ohne Kopf. */
@media (max-width: 560px) {
    .satz-zeile {
        grid-template-columns: minmax(0, 1fr);
    }

    .satz-zeile dt {
        justify-content: flex-start;
    }

    .satz-tafel thead {
        display: none;
    }

    .satz-tafel tbody tr {
        display: block;
        padding-block: var(--space-4);
        border-top: 1px solid var(--color-divider);
    }

    .satz-tafel tbody tr:last-child {
        border-bottom: 1px solid var(--color-divider);
    }

    .satz-tafel tbody th,
    .satz-tafel tbody td,
    .satz-tafel tbody tr:last-child th,
    .satz-tafel tbody tr:last-child td {
        display: block;
        width: auto;
        padding: 0;
        border: 0;
    }

    .satz-tafel td:empty {
        display: none;
    }
}
</style>
