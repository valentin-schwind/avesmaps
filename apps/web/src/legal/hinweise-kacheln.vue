<script setup lang="ts">
import { t } from "../i18n/i18n";
import { KANAELE } from "./community";
import HinweiseDiscordKnopf from "./hinweise-discord-knopf.vue";

const emit = defineEmits<{ news: [] }>();

/**
 * Die zwei Aktionskacheln oben in „Hinweise“ (WI-0045 Stufe B, Betreiber 2026-09-27: „beide,
 * Neuigkeiten gesperrt“; Legacy `.legal-dialog__actions`, `.legal-action`).
 *
 * - „Mitreden und folgen“: Discord als beschrifteter Knopf, die übrigen Kanäle als Zeichen daneben.
 * - „Was ist neu?“: Der Knopf öffnet dasselbe Fenster wie der Eckknopf „Neuigkeiten“.
 * - 🔴 Die Kacheln sind ein PAAR (Legacy): gleiche Höhe, die Knöpfe auf einer Linie - der Satz nimmt
 *   die Resthöhe und schiebt den Knopf nach unten, unabhängig von Textlänge und Sprache.
 * - Die Zeichen sind einfarbig (`currentcolor`): kein Markenblau im warmen Fenster (Guide §13.34).
 * - 🪤 Der Discord-Knopf trägt sein ↗ aus der Hausregel (`styles/canon.css`, WI-0107); die Zeichen-Knöpfe nehmen sich
 *   ausdrücklich davon aus - Begründung an der Regel unten.
 */
</script>

<template>
    <div class="kacheln">
        <section class="kachel" data-testid="notes-community">
            <h3 class="kachel__titel">{{ t("notes.social.lead") }}</h3>
            <p class="kachel__text">{{ t("notes.social.body") }}</p>
            <div class="kachel__kanaele">
                <HinweiseDiscordKnopf />
                <a
                    v-for="kanal in KANAELE"
                    :key="kanal.id"
                    class="kachel__zeichen"
                    :href="kanal.ziel"
                    target="_blank"
                    :rel="kanal.rel"
                    :aria-label="kanal.name"
                    :title="t('notes.social.channel', { channel: kanal.name })"
                    :data-testid="`notes-channel-${kanal.id}`"
                >
                    <svg
                        v-if="kanal.id === 'instagram'"
                        class="kachel__glyphe kachel__glyphe--linie"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                    >
                        <rect x="3" y="3" width="18" height="18" rx="5.4" />
                        <circle cx="12" cy="12" r="4.2" />
                        <circle class="kachel__punkt" cx="17.2" cy="6.8" r="1.1" />
                    </svg>
                    <svg
                        v-else-if="kanal.id === 'facebook'"
                        class="kachel__glyphe"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                    >
                        <path
                            d="M13.5 21.9v-8.2h2.8l.5-3.2h-3.3V8.4c0-.9.3-1.6 1.6-1.6h1.8V3.9c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v2.2H7.1v3.2h2.8v8.2z"
                        />
                    </svg>
                    <!-- Mastodon füllt seine Fläche randlos; auf 18 von 24 eingerückt wie die beiden anderen (Legacy, gemessen). -->
                    <svg v-else class="kachel__glyphe" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <g transform="translate(3.04 3) scale(0.75)">
                            <path
                                d="M23.27 5.31c-.35-2.58-2.62-4.61-5.3-5C17.51.24 15.79 0 11.81 0h-.03c-3.98 0-4.83.24-5.29.31C3.88.69 1.5 2.52.92 5.13.64 6.41.61 7.84.66 9.14c.07 1.88.09 3.75.26 5.62.12 1.24.32 2.47.62 3.68.55 2.24 2.78 4.1 4.96 4.86 2.34.79 4.85.92 7.26.38.26-.06.53-.13.79-.21.58-.19 1.27-.39 1.77-.76a.06.06 0 0 0 .02-.04v-1.81a.05.05 0 0 0-.06-.05c-1.55.37-3.12.55-4.71.55-2.73 0-3.46-1.29-3.67-1.82a5.6 5.6 0 0 1-.32-1.44.05.05 0 0 1 .07-.05c1.51.36 3.07.55 4.63.55.37 0 .75 0 1.12-.01 1.57-.05 3.23-.13 4.77-.43l.11-.02c2.44-.46 4.75-1.92 4.99-5.6.01-.15.03-1.52.03-1.67 0-.52.17-3.63-.02-5.55Zm-3.75 9.2h-2.56V8.29c0-1.31-.55-1.98-1.67-1.98-1.23 0-1.85.79-1.85 2.35v3.4h-2.54V8.66c0-1.56-.62-2.35-1.85-2.35-1.11 0-1.67.67-1.67 1.98v6.22H4.82V8.1c0-1.31.34-2.35 1.01-3.12.7-.77 1.61-1.16 2.74-1.16 1.31 0 2.3.5 2.96 1.5l.64 1.06.64-1.06c.66-1 1.65-1.5 2.96-1.5 1.13 0 2.04.39 2.74 1.16.68.77 1.01 1.81 1.01 3.12z"
                            />
                        </g>
                    </svg>
                </a>
            </div>
        </section>

        <section class="kachel" data-testid="notes-news-tile">
            <h3 class="kachel__titel">{{ t("notes.news.lead") }}</h3>
            <p class="kachel__text">{{ t("notes.news.body") }}</p>
            <button type="button" class="kachel__knopf" data-testid="notes-news" @click="emit('news')">
                {{ t("notes.news.action") }}
            </button>
        </section>
    </div>
</template>

<style scoped src="./hinweise-knopf.css"></style>

<style scoped>
/* Zwei Kacheln nebeneinander, bis der Platz nicht reicht (Guide §12.6 „Nebeneinander“). */
.kacheln {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
}

.kachel {
    display: flex;
    flex: 1 1 var(--avm-fenster-spalte);
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    min-width: 0;
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

/* 14 statt Legacys 15 px: 15 steht nicht auf der Leiter (Guide §3). */
.kachel__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-reading);
    font-weight: var(--font-weight-bold);
    line-height: var(--leading-tight);
}

/* Der Satz nimmt die Resthöhe: so stehen die Knöpfe beider Kacheln auf einer Linie (Legacy). */
.kachel__text {
    flex: 1 1 auto;
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* 🪤 `align-self: stretch` ist tragend: ohne es bräche die Zeile nie um, der nächste Kanal liefe aus der Kachel. */
.kachel__kanaele {
    display: flex;
    flex-wrap: wrap;
    align-self: stretch;
    align-items: center;
    gap: var(--space-6);
}

/*
 * 🪤 DIE EINZIGE AUSNAHME VON „externe Links tragen ein ↗“, und sie ist Legacys eigene (css/components/legal-dialog.css,
 * wörtlich: „ein Icon-Knopf hat keinen Text, an den sich der Pfeil haengen koennte -- er saesse als zweites Zeichen neben
 * einem 18-px-Glyph und machte aus dem Quadrat einen Klumpen. Dass der Weg nach draussen fuehrt, sagt hier das
 * Markenzeichen selbst; den Namen traegt das aria-label.“).
 *
 * Der beschriftete Discord-Knopf daneben behält sein ↗ und bekommt es seit WI-0107 aus der Hausregel
 * `a[target="_blank"]::after` (`styles/canon.css`) - hier stand es vorher ein zweites Mal.
 */
.kachel__zeichen::after {
    content: none;
}

.kachel__zeichen .kachel__glyphe {
    width: var(--icon-md);
    height: var(--icon-md);
}

.kachel__glyphe--linie {
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.8;
}

.kachel__punkt {
    fill: currentcolor;
    stroke: none;
}
</style>
