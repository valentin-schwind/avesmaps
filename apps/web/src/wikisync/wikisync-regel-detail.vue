<script setup lang="ts">
/**
 * Die Einzelheiten EINES Regelvorschlags (WI-0253 §24; Mockup „Vorkommen: die vier Ebenen“): 1 Original im Wiki, 2 ausdrückliche Orte, 3 Regel, 4 berechnetes Ergebnis.
 *
 * - **Original:** der Wortlaut des Wikis, je Satzteil unterstrichen (gelesen), gelb (teilweise) oder rot (nicht darstellbar). Darunter jeder Teil, der nicht in die Regel kam, mit Wortlaut und Grund.
 * - **Regel:** die Bedingungen von links nach rechts ohne Klammern (UND, ODER, OHNE). Eine Fläche, die es noch nicht gibt, trägt „!“ und „wartet“. „Bisher“ zeigt die vom Wiki abgeleitete Regel, die ersetzt würde.
 * - **Ergebnis:** Treffer sind unbekannt, nicht null: Die Auswertung der Regeln gegen Flächen und Siedlungen ist ein eigenes Arbeitspaket (WI-0253 §24).
 * - Die Auswahl steht hier und in der Zeile; ein Vorschlag, der nicht wählbar ist, nennt den Grund.
 * - Eine wartende Fläche mit gleichnamiger Fläche ohne Wiki-Schlüssel trägt den Knopf „zuweisen“ (§25); das Ereignis geht an das Fenster, das fragt und sendet.
 */
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import type { WikisyncRegelOffeneFlaeche, WikisyncRegelVorschlag } from "@avesmaps3d/shared";
import WikisyncBedingung from "./wikisync-bedingung.vue";
import {
    TYP_TON,
    beziehungName,
    grundName,
    regelArtName,
    regelKurz,
    regelStatusName,
    regelZusammenfassung,
    sperreName,
    typName,
    verknuepfungName,
} from "./wikisync-regeln-text";

defineProps<{
    vorschlag: WikisyncRegelVorschlag;
    gewaehlt: boolean;
    /** Die Seite des Vorschlags im Wiki, wenn bekannt (nur als Text, kein Abruf). */
    dumpStand: string | null;
    /** Die offenen Flächen mit Kandidat (§25), wie der Server sie kennt. */
    flaechen?: readonly WikisyncRegelOffeneFlaeche[] | undefined;
    /** Warum der Knopf „zuweisen“ gerade nicht geht; `undefined`: er geht. */
    zuweisenSperre?: string | undefined;
}>();
const emit = defineEmits<{ waehle: [wert: boolean]; zuweisen: [eintrag: WikisyncRegelOffeneFlaeche] }>();

/** Wie ein Satzteil des Originals aussieht: der Zustand steht als Klasse, die Farbe kommt aus den Tripeln des Hauses. */
const teilKlasse = (zustand: string): string => `wsync-regel__frag wsync-regel__frag--${zustand}`;
</script>

<template>
    <div class="wsync-regel" :data-testid="`wsync-regel-${vorschlag.id}`">
        <div class="wsync-regel__kopf">
            <AvmPille>{{ regelArtName(vorschlag.eintrag.art) }}</AvmPille>
            <AvmPille :ton="TYP_TON[vorschlag.typ]">{{ typName(vorschlag.typ) }}</AvmPille>
            <AvmPille v-if="vorschlag.status === 'manuell'" ton="lokal">{{
                t("admin.wikisync.regeln.herkunftManuell")
            }}</AvmPille>
            <AvmPille v-else ton="neutral">{{ t("admin.wikisync.regeln.herkunftWiki") }}</AvmPille>
            <span v-if="vorschlag.artikel !== null" class="wsync-regel__leise">{{
                t("admin.wikisync.regeln.wikiSeite", { artikel: vorschlag.artikel, stand: dumpStand ?? "—" })
            }}</span>
        </div>

        <!-- 1 Original im Wiki -->
        <section class="wsync-regel__ebene">
            <h4 class="wsync-regel__ebene-kopf">
                <span class="wsync-regel__nr">1</span>{{ t("admin.wikisync.regeln.ebene.original") }}
            </h4>
            <p v-for="o in vorschlag.original" :key="o.feld" class="wsync-regel__orig">
                <span class="wsync-regel__orig-feld">{{ beziehungName(o.feld) }}</span
                ><template v-for="(teil, i) in o.teile" :key="i"
                    ><span :class="teilKlasse(teil.zustand)">{{ teil.text }}</span
                    >{{ teil.trenner }}</template
                >
            </p>
            <p class="wsync-regel__leise" data-testid="wsync-regel-legende">
                <span class="wsync-regel__frag wsync-regel__frag--ok">{{ t("admin.wikisync.regeln.legende.ok") }}</span>
                = {{ t("admin.wikisync.regeln.legende.okSatz") }} ·
                <span class="wsync-regel__frag wsync-regel__frag--offen">{{
                    t("admin.wikisync.regeln.legende.offen")
                }}</span>
                = {{ t("admin.wikisync.regeln.legende.offenSatz") }} ·
                <span class="wsync-regel__frag wsync-regel__frag--fehler">{{
                    t("admin.wikisync.regeln.legende.fehler")
                }}</span>
                =
                {{ t("admin.wikisync.regeln.legende.fehlerSatz") }}
            </p>
            <template v-for="regel in vorschlag.regeln" :key="regel.beziehung">
                <ul v-if="regel.teile.length > 0" class="wsync-regel__liste">
                    <li v-for="(teil, i) in regel.teile" :key="i">
                        <AvmPille :ton="teil.art === 'rueckfrage' ? 'warnung' : 'gefahr'">{{
                            t(
                                teil.art === "rueckfrage"
                                    ? "admin.wikisync.regeln.teil.rueckfrage"
                                    : "admin.wikisync.regeln.teil.nichtAbbildbar",
                            )
                        }}</AvmPille>
                        <span
                            ><strong>„{{ teil.text }}“</strong> · {{ beziehungName(teil.beziehung) }} ·
                            {{ t("admin.wikisync.regeln.teil.grund", { grund: grundName(teil.grund) }) }}</span
                        >
                    </li>
                </ul>
            </template>
        </section>

        <!-- 2 Ausdrückliche Orte -->
        <section class="wsync-regel__ebene">
            <h4 class="wsync-regel__ebene-kopf">
                <span class="wsync-regel__nr">2</span>{{ t("admin.wikisync.regeln.ebene.orte") }}
            </h4>
            <p class="wsync-regel__leise">{{ t("admin.wikisync.regeln.orteSatz") }}</p>
        </section>

        <!-- 3 Regel -->
        <section class="wsync-regel__ebene">
            <h4 class="wsync-regel__ebene-kopf">
                <span class="wsync-regel__nr">3</span
                >{{
                    t(
                        vorschlag.regeln.length > 1
                            ? "admin.wikisync.regeln.ebene.regeln"
                            : "admin.wikisync.regeln.ebene.regel",
                    )
                }}
            </h4>
            <AvmHinweis v-if="vorschlag.regeln.length === 0" ton="warnung">{{
                t("admin.wikisync.regeln.keinVorschlag", { grund: sperreName(vorschlag.sperre) })
            }}</AvmHinweis>
            <div v-for="regel in vorschlag.regeln" :key="regel.beziehung" class="wsync-regel__regel">
                <p class="wsync-regel__regel-kopf">
                    <strong>{{ beziehungName(regel.beziehung) }}</strong>
                    <AvmPille
                        :ton="
                            regel.status === 'entfaellt' ? 'warnung' : regel.status === 'manuell' ? 'lokal' : 'neutral'
                        "
                        >{{ regelStatusName(regel.status) }}</AvmPille
                    >
                </p>
                <p v-if="regel.status === 'manuell'" class="wsync-regel__satz">
                    {{ t("admin.wikisync.regeln.gehoertRedaktion") }}
                </p>
                <p v-else-if="regel.status === 'entfaellt'" class="wsync-regel__satz">
                    {{ t("admin.wikisync.regeln.entfaellt") }}
                </p>
                <template v-else-if="regel.bedingungen.length > 0">
                    <!-- Gleiche ODER-Bedingungen stehen oben in einer Zeile; die Kette darunter bleibt, wie sie gerechnet ist. -->
                    <p
                        v-if="regelZusammenfassung(regel) !== null"
                        class="wsync-regel__satz"
                        data-testid="wsync-regel-zusammen"
                    >
                        {{ t("admin.wikisync.regeln.zusammen", { regel: regelZusammenfassung(regel) ?? "" }) }}
                    </p>
                    <ol class="wsync-regel__kette">
                        <li v-for="(b, i) in regel.bedingungen" :key="i">
                            <span class="wsync-regel__op">{{
                                i === 0 ? t("admin.wikisync.regeln.bedingung1") : verknuepfungName(b.verknuepfung)
                            }}</span>
                            <span
                                ><WikisyncBedingung
                                    :bedingung="b"
                                    :flaechen="flaechen"
                                    :zuweisen-sperre="zuweisenSperre"
                                    @zuweisen="(eintrag: WikisyncRegelOffeneFlaeche) => emit('zuweisen', eintrag)"
                            /></span>
                        </li>
                    </ol>
                </template>
                <p v-else class="wsync-regel__satz wsync-regel__satz--leer">
                    {{ t("admin.wikisync.regeln.keineBedingung") }}
                </p>
                <p v-if="regel.bedingungen.length > 1" class="wsync-regel__leise">
                    {{ t("admin.wikisync.regeln.vonLinksNachRechts") }}
                </p>
                <p
                    v-if="regel.bisher !== null && regel.bisher.length > 0"
                    class="wsync-regel__leise"
                    data-testid="wsync-regel-bisher"
                >
                    {{
                        t("admin.wikisync.regeln.bisher", {
                            regel: regelKurz({ ...regel, bedingungen: regel.bisher }),
                        })
                    }}
                </p>
            </div>
            <AvmHinweis v-if="vorschlag.wartet" ton="warnung" testid="wsync-regel-wartet">{{
                t("admin.wikisync.regeln.wartetSatz")
            }}</AvmHinweis>
            <div class="wsync-regel__wahl">
                <AvmKaestchen
                    art="checkbox"
                    :checked="gewaehlt"
                    :gesperrt="vorschlag.waehlbar ? undefined : sperreName(vorschlag.sperre)"
                    :testid="`wsync-regel-${vorschlag.id}-wahl`"
                    @change="(wert: boolean) => emit('waehle', wert)"
                    ><span>{{
                        t(
                            vorschlag.vorgewaehlt
                                ? "admin.wikisync.regeln.uebernehmenVorgewaehlt"
                                : "admin.wikisync.regeln.uebernehmenNicht",
                        )
                    }}</span></AvmKaestchen
                >
                <span v-if="!vorschlag.waehlbar" class="wsync-regel__leise">{{ sperreName(vorschlag.sperre) }}</span>
            </div>
        </section>

        <!-- 4 Berechnetes Ergebnis -->
        <section class="wsync-regel__ebene">
            <h4 class="wsync-regel__ebene-kopf">
                <span class="wsync-regel__nr">4</span>{{ t("admin.wikisync.regeln.ebene.ergebnis") }}
            </h4>
            <p class="wsync-regel__satz" data-testid="wsync-regel-treffer">
                {{ t("admin.wikisync.regeln.trefferUnbekannt") }}
            </p>
            <p class="wsync-regel__leise">{{ t("admin.wikisync.regeln.trefferGrund") }}</p>
        </section>
    </div>
</template>

<style scoped>
.wsync-regel {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    padding: var(--space-6) var(--space-10) var(--space-10);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wsync-regel__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
}

.wsync-regel__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-regel__ebene {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-regel__ebene-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}

.wsync-regel__nr {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der Wortlaut des Wikis: ein ruhiger Kasten, kein Randbalken (Hausregel: keine farbigen Balken an Zeilen). */
.wsync-regel__orig {
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text);
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.wsync-regel__orig-feld {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-regel__frag--ok {
    border-bottom: 2px solid var(--color-success-soft-border);
}

.wsync-regel__frag--offen {
    border-radius: var(--radius-sm);
    background: var(--color-warning-soft);
    box-shadow: 0 0 0 1px var(--color-warning-soft-border);
    color: var(--color-warning-soft-text);
}

.wsync-regel__frag--fehler {
    border-radius: var(--radius-sm);
    background: var(--color-danger-soft);
    box-shadow: 0 0 0 1px var(--color-danger-soft-border);
    color: var(--color-danger-soft-text);
}

.wsync-regel__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wsync-regel__liste li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-6);
    align-items: baseline;
    overflow-wrap: anywhere;
}

.wsync-regel__regel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.wsync-regel__regel-kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    margin: 0;
    color: var(--color-text-strong);
}

.wsync-regel__regel-kopf strong {
    font-weight: var(--font-weight-regular);
}

.wsync-regel__satz {
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

.wsync-regel__satz--leer {
    color: var(--color-text-muted);
    font-style: italic;
}

.wsync-regel__kette {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wsync-regel__kette li {
    display: grid;
    grid-template-columns: 6.4em minmax(0, 1fr);
    gap: var(--space-6);
    align-items: baseline;
    font-size: var(--font-size-body);
}

.wsync-regel__op {
    color: var(--color-accent-strong);
    text-align: right;
}

.wsync-regel__wahl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

@container wsync-regeln (max-width: 44em) {
    .wsync-regel__kette li {
        grid-template-columns: minmax(0, 1fr);
        gap: 0;
    }

    .wsync-regel__op {
        text-align: left;
    }
}
</style>
