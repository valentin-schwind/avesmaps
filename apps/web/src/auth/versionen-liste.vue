<script setup lang="ts">
import { computed } from "vue";
import { versionGruppen, type ReleaseVoll } from "@avesmaps3d/shared";
import AvmAvatar from "../controls/avm-avatar.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { isMessageKey, t } from "../i18n/i18n";
import CommitVerweis from "./commit-verweis.vue";
import KanalSiegel from "./kanal-siegel.vue";
import { gesuchteGruppen, wann } from "./versionen";

/**
 * Die Commits eines Release nach Arbeitspaket (WI-0137, Blatt 1 (a) bis (c)): je Paket eine Zeile mit Namen und Zahl, darunter je Änderung
 * wann, wer (Siegel für Claudia und Claudio, Avatar für Personen), Art, Satz und der Commit als Link auf GitHub. Am Telefon zwei Zeilen je
 * Änderung statt der Tafel. Doku nur mit `mitDoku` (Betreiber 2026-10-11, Frage 1 B).
 */
const props = defineProps<{ release: ReleaseVoll; mitDoku: boolean; telefon: boolean; suche?: string | undefined }>();

const gruppen = computed(() =>
    gesuchteGruppen(versionGruppen(props.release.commits, props.release.pakete, props.mitDoku), props.suche ?? ""),
);
const gruppenName = (id: string, name: string | null): string =>
    id === "sonstiges" ? t("versionen.other") : name === null ? id : `${id} · ${name}`;
const artName = (art: string | null): string | null => {
    const key = `versionen.art.${art ?? ""}`;
    return art !== null && isMessageKey(key) ? t(key) : null;
};
const agent = (wer: string): "claudia" | "claudio" | null =>
    wer === "Claudia" ? "claudia" : wer === "Claudio" ? "claudio" : null;
</script>

<template>
    <div class="liste" :data-testid="`versionen-liste-${props.release.stamm}`">
        <p
            v-if="gruppen.length === 0 && (props.suche ?? '').trim() !== ''"
            class="leer"
            data-testid="versionen-suche-leer"
        >
            {{ t("versionen.searchEmpty") }}
        </p>
        <p v-else-if="gruppen.length === 0" class="leise">{{ t("versionen.none") }}</p>
        <section
            v-for="gruppe in gruppen"
            :key="gruppe.id"
            class="gruppe"
            :data-testid="`versionen-gruppe-${gruppe.id}`"
        >
            <h4 class="gruppe__kopf">
                {{ gruppenName(gruppe.id, gruppe.name) }}<span class="gruppe__zahl">{{ gruppe.zeilen.length }}</span>
            </h4>
            <ul v-if="props.telefon" class="karten">
                <li v-for="zeile in gruppe.zeilen" :key="zeile.commit.sha" class="karte">
                    <span class="karte__oben">
                        <span class="leise">{{ wann(zeile.commit.datum) }}</span>
                        <span class="wer">
                            <KanalSiegel
                                v-if="agent(zeile.commit.wer) !== null"
                                :agent="agent(zeile.commit.wer)!"
                                groesse="klein"
                            />
                            <AvmAvatar v-else :kennung="zeile.commit.wer" :name="zeile.commit.wer" groesse="klein" />
                            <span :class="`wer__name wer__name--${agent(zeile.commit.wer) ?? 'person'}`">{{
                                zeile.commit.wer
                            }}</span>
                        </span>
                        <CommitVerweis class="karte__sha" :sha="zeile.commit.sha" />
                    </span>
                    <span
                        ><span v-if="artName(zeile.art) !== null" class="art">{{ artName(zeile.art) }}</span
                        >{{ zeile.text }}</span
                    >
                </li>
            </ul>
            <FensterTafel v-else :beschriftung="gruppenName(gruppe.id, gruppe.name)" art="text" grund="fenster">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">{{ t("versionen.col.when") }}</th>
                            <th scope="col">{{ t("versionen.col.who") }}</th>
                            <th scope="col">{{ t("versionen.col.what") }}</th>
                            <th scope="col">{{ t("versionen.col.commit") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="zeile in gruppe.zeilen"
                            :key="zeile.commit.sha"
                            :data-testid="`versionen-zeile-${zeile.commit.sha.slice(0, 8)}`"
                        >
                            <td>
                                <span class="leise zeit">{{ wann(zeile.commit.datum) }}</span>
                            </td>
                            <td>
                                <span class="wer">
                                    <KanalSiegel
                                        v-if="agent(zeile.commit.wer) !== null"
                                        :agent="agent(zeile.commit.wer)!"
                                        groesse="klein"
                                    />
                                    <AvmAvatar
                                        v-else
                                        :kennung="zeile.commit.wer"
                                        :name="zeile.commit.wer"
                                        groesse="klein"
                                    />
                                    <span :class="`wer__name wer__name--${agent(zeile.commit.wer) ?? 'person'}`">{{
                                        zeile.commit.wer
                                    }}</span>
                                </span>
                            </td>
                            <td>
                                <span v-if="artName(zeile.art) !== null" class="art">{{ artName(zeile.art) }}</span
                                >{{ zeile.text }}
                            </td>
                            <td>
                                <CommitVerweis :sha="zeile.commit.sha" />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </FensterTafel>
        </section>
    </div>
</template>

<style scoped>
.liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.gruppe {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.gruppe__kopf {
    margin: 0;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: 400;
    letter-spacing: 0.02em;
}

.gruppe__zahl {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
}

.leise {
    color: var(--color-text-muted);
}

/* Eine Suche ohne Treffer: der Satz in der Farbe des Leisen, wie die leere Liste der Kataloge. */
.leer {
    margin: 0;
    color: var(--color-text-muted);
}

.zeit {
    white-space: nowrap;
}

.wer {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
}

.wer__name--claudia {
    color: var(--color-agent-claudia);
}

.wer__name--claudio {
    color: var(--color-agent-claudio);
}

.art {
    display: inline-block;
    margin-right: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karten {
    margin: 0;
    padding: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    list-style: none;
}

.karte {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    border-radius: var(--radius-sm);
}

.karte:nth-child(even) {
    background: var(--color-panel-soft);
}

.karte__oben {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.karte__sha {
    margin-left: auto;
}
</style>
