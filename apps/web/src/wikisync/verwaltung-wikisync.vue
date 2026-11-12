<script setup lang="ts">
/**
 * Der Reiter „WikiSync“ unter „Datenabgleich“ der Systemsteuerung (WI-0253 UI-1, UI-2 und §20; Mockup `review/wi-0253/wikisync-mockup.html`, abgenommen 2026-10-25 mit `dbdbe1b25`; der Ablauf
 * nach dem Entwurf `review/wi-0253/wikisync-ablauf-mockup.html`, Variante A, Vali 2026-10-26). Was der Reiter lädt und anstößt, steht in `wikisync.ts`, die Sätze in `wikisync-text.ts`.
 *
 * - **Oben die Tafel der Bereiche mit dem einen Knopf „WikiSync starten“** (`wikisync-tafel.vue`): Häkchen, Stand der letzten Übernahme und der Ablauf je Bereich. Darunter der
 *   Laufbericht mit „Zurücknehmen“ und, als drei gleichrangige Knöpfe in einer Zeile, der Dump-Bericht, die Befunde und die Regelvorschläge (je in einem eigenen Fenster; Vali 2026-10-27: „es sind mächtige
 *   Funktionen“, die kleinen Verweise wurden übersehen).
 * - **Darunter die Quellen und Werkzeuge in Legacys Listenform:** Quellstand (der Dump) und der einzelne Artikel; dann die zwei Tafeln des Kanon-Etiketts.
 * - **Rechte** (Vali 2026-10-25): Dump holen nur der Betreiber; Vorschau und Berichte ab Tester; einzelne Bereiche ab Editor, alle nur Admins; Zurücknehmen
 *   und die Tafeln ab Admin; alles Schreibende mit Passkey. Jeder gesperrte Knopf nennt den Grund.
 * - 🔴 **Kein Wiki-Abruf aus dem Browser und keiner lokal:** „Dump holen“ reiht nur einen Auftrag ein, den Claudios Korridor auf dem Server ausführt (WI-0253 §22); lokal bleibt
 *   der Knopf gesperrt. Die Zeile zeigt den Stand des Holens (wartet auf die Abholung, läuft, Ende), den letzten Dump und den nächsten planmäßigen Abruf. Der Lauf liest den
 *   Dump und die Kategorien-Datei daneben im Ordner (WI-0294); einen Wiki-Teil im 20-Sekunden-Takt gibt es nicht mehr.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { WIKI_DUMP_HOLEN_ART } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import type { FilterWahl } from "../controls/avm-filterknopf";
import { formatList, isMessageKey, t } from "../i18n/i18n";
import { authState } from "../auth/session-state";
import VerwaltungLadeproblem from "../auth/verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Wikisync } from "./wikisync";
import WikisyncArtikel from "./wikisync-artikel.vue";
import WikisyncBerichtFenster from "./wikisync-bericht-fenster.vue";
import WikisyncInfo from "./wikisync-info.vue";
import WikisyncLaufbericht from "./wikisync-laufbericht.vue";
import WikisyncNamensraeume from "./wikisync-namensraeume.vue";
import WikisyncOhne from "./wikisync-ohne.vue";
import WikisyncRegelnFenster from "./wikisync-regeln-fenster.vue";
import WikisyncTafel from "./wikisync-tafel.vue";
import WikisyncZeile from "./wikisync-zeile.vue";
import {
    KREIS_LEGENDE,
    auftragVon,
    bereichName,
    dumpErwartung,
    dumpHolenSperre,
    dumpLage,
    dumpPlanZeile,
    holenLetzteZeile,
    kreisName,
    prozent,
    umgebungKurz,
} from "./wikisync-text";

const props = defineProps<{ wikisync: Wikisync; telefon: boolean }>();
const ws = props.wikisync;

const session = authState.value;
const umgebung = session.environment ?? "";
const lokal = umgebung === "development" || umgebung === "test";
const hat = (recht: string): boolean => session.capabilities.includes(recht);
const darf = {
    dump: hat("fetch_wiki_dump"),
    sehen: hat("view_wikisync"),
    bereiche: hat("run_wikisync_areas"),
    alle: hat("run_wikisync_all"),
    zurueck: hat("undo_wikisync_run"),
    tafeln: hat("manage_canon_tables"),
    regeln: hat("apply_wiki_lore_rules"),
    flaechen: hat("edit_map_objects") || hat("edit_landscapes"),
    artikel: hat("compare_wiki_article"),
};
const rechtSatz = (recht: string): string => {
    const key = `auth.capability.${recht}`;
    return t("admin.wikisync.sperre.recht", { recht: isMessageKey(key) ? t(key) : recht });
};

/** Die Uhr für „heute, 14:05“; tickt nur, solange der Reiter zu sehen ist. */
const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    ws.follow(true);
    void ws.load();
    void ws.ladeTafeln();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    ws.follow(false);
});

const stand = computed(() => ws.stand.value);

// ── Umgebung ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const wikisyncBereiche = computed(() =>
    (ws.bereiche.value?.bereiche ?? [])
        .filter((stand) => stand.angeschlossen)
        .map((stand) => bereichName(stand.bereich)),
);
const umgebungSatz = computed((): { text: string; info: string; ton: "neutral" | "warnung" } => {
    if (umgebung === "production") {
        return {
            text:
                wikisyncBereiche.value.length === 0
                    ? t("admin.wikisync.umgebung.productionKeine")
                    : t("admin.wikisync.umgebung.production", { bereiche: formatList(wikisyncBereiche.value) }),
            info: t("admin.wikisync.umgebung.productionInfo"),
            ton: "warnung",
        };
    }
    if (umgebung === "staging")
        return {
            text: t("admin.wikisync.umgebung.staging"),
            info: t("admin.wikisync.umgebung.stagingInfo"),
            ton: "neutral",
        };
    return { text: t("admin.wikisync.umgebung.lokal"), info: t("admin.wikisync.umgebung.lokalInfo"), ton: "neutral" };
});

// ── Quellstand ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dump = computed(() => (stand.value === null ? null : dumpLage(stand.value, jetzt.value, lokal)));
const erwartung = computed(() => dumpErwartung(stand.value?.dump.stand ?? null, jetzt.value));
const dumpInfo = computed(() => {
    const d = stand.value?.dump;
    if (d === undefined || d.datei === null) return t("admin.wikisync.dump.infoLeer");
    return t("admin.wikisync.dump.info", {
        datei: d.datei,
        pruefsumme: d.sha256 === null ? "—" : `${d.sha256.slice(0, 8)}…${d.sha256.slice(-4)}`,
    });
});
// Auf Stage und Production nennt der Server den echten Grund (kein Release, kein Dump-Ordner), nicht „lokal“ (Vali 2026-10-26, Bild der Stage); ein Holen, das schon wartet
// oder läuft, sperrt den zweiten Klick. Der Knopf reiht einen Auftrag für Claudios Korridor ein (WI-0253 §22, Vali 2026-10-27).
const dumpSperre = computed((): string | undefined =>
    stand.value === null
        ? undefined
        : dumpHolenSperre(stand.value, { darf: darf.dump, lokal, rechtSatz: rechtSatz("fetch_wiki_dump") }),
);
const holenLetzte = computed(() => (stand.value === null ? null : holenLetzteZeile(stand.value, jetzt.value)));
const dumpPlan = computed(() => (stand.value === null ? null : dumpPlanZeile(stand.value, jetzt.value, lokal)));
/** Das Ergebnis des Klicks auf „Dump holen“ (eine Ablehnung des Servers), an der Zeile des Dumps. */
const dumpMeldung = computed(() => {
    const e = ws.ergebnis.value;
    return e !== null && e.wo === "dump" ? e.result : undefined;
});

// ── Fenster ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const berichtOffen = ref(false);
const regelnOffen = ref(false);
const vorfilter = ref<FilterWahl>({});
/** Der Vergleich eines einzelnen Artikels, den das Fenster zeigt; `null`: der Bericht zum Dump. */
const artikelId = ref<number | null>(null);
function zeigeBericht(filter: FilterWahl = {}): void {
    vorfilter.value = filter;
    artikelId.value = null;
    berichtOffen.value = true;
}
function zeigeArtikel(id: number): void {
    vorfilter.value = {};
    artikelId.value = id;
    berichtOffen.value = true;
}

/** Namensräume im Dump, die die gespeicherte Tafel nicht kennt. */
const unbekannteRaeume = computed(() =>
    (stand.value?.dump.namensraeume ?? []).filter(
        (raum) => ws.tafeln.value !== null && !ws.tafeln.value.namensraeume.some((zeile) => zeile.ns === raum.nr),
    ),
);

// ── Tafeln ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tafelSperre = computed((): string | undefined => {
    if (!darf.tafeln) return rechtSatz("manage_canon_tables");
    if (ws.tafeln.value?.quelle === "vorgabe") return t("admin.wikisync.sperre.tafelFehlt");
    return undefined;
});
const ohneAngezeigt = computed(() => (ws.tafeln.value?.objektarten ?? []).filter((zeile) => zeile.anzeigen).length);
</script>

<template>
    <div class="wsync" :class="{ 'wsync--telefon': telefon }" data-testid="wikisync">
        <AvmHinweis :ton="umgebungSatz.ton" testid="wsync-umgebung"
            >{{ umgebungSatz.text }}<WikisyncInfo :text="umgebungSatz.info"
        /></AvmHinweis>
        <VerwaltungLadeproblem
            :problems="ws.loadProblems.value"
            :fehlt="ws.unconfirmed.value"
            testid="wsync-ladefehler"
            @bestaetigen="ws.confirmAgain()"
            ><span class="wsync__block">{{ t("admin.wikisync.ladefehler") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && ws.loading.value" class="wsync__leise">{{ t("admin.loading") }}</p>

        <template v-if="stand !== null && dump !== null">
            <!-- Die Tafel der Bereiche mit dem einen Knopf, darunter der Laufbericht und die Verweise -->
            <WikisyncTafel
                :wikisync="ws"
                :stand="stand"
                :jetzt="jetzt"
                :telefon="telefon"
                :umgebung="umgebung"
                :darf="{ bereiche: darf.bereiche, alle: darf.alle }"
                :recht-satz="rechtSatz"
            />
            <WikisyncLaufbericht
                :wikisync="ws"
                :stand="stand"
                :jetzt="jetzt"
                :darf-zurueck="darf.zurueck"
                :recht-satz="rechtSatz"
            />
            <div class="wsync__fenster-knoepfe" data-testid="wsync-nebenlinks">
                <AvmKnopf :breit="telefon" testid="wsync-bericht-knopf" @click="zeigeBericht()">{{
                    t("admin.wikisync.bericht.titel")
                }}</AvmKnopf>
                <AvmKnopf :breit="telefon" testid="wsync-nur-befunde" @click="zeigeBericht({ wirkung: ['befund'] })">{{
                    t("admin.wikisync.nebenlinks.befunde")
                }}</AvmKnopf>
                <AvmKnopf :breit="telefon" testid="wsync-regeln-knopf" @click="regelnOffen = true">{{
                    t("admin.wikisync.regeln.titel")
                }}</AvmKnopf>
            </div>

            <!-- Quellstand und der einzelne Artikel -->
            <ul class="wsync__liste" :aria-label="t('admin.wikisync.lage')">
                <WikisyncZeile
                    :name="t('admin.wikisync.dump.name')"
                    :kreis="dump.kreis"
                    :kreis-name="kreisName(dump.kreis)"
                    :unter="dump.unter"
                    :ton="dump.ton"
                    :telefon="telefon"
                    :prozent="
                        auftragVon(stand, WIKI_DUMP_HOLEN_ART, 'wiki_dump_einlesen') === undefined
                            ? null
                            : prozent(auftragVon(stand, WIKI_DUMP_HOLEN_ART, 'wiki_dump_einlesen')!.fortschritt)
                    "
                    testid="wsync-dump"
                >
                    <template #was
                        >{{ t(stand.dump.datei === null ? "admin.wikisync.dump.wasLeer" : "admin.wikisync.dump.was")
                        }}<WikisyncInfo :text="dumpInfo" /><br /><span
                            :class="{ wsync__warnung: erwartung.warnung }"
                            data-testid="wsync-dump-erwartung"
                            >{{ erwartung.text }}</span
                        ><WikisyncInfo :text="t('admin.wikisync.dump.monatsanfang')" /><template
                            v-if="dumpPlan !== null"
                            ><br /><span data-testid="wsync-dump-plan">{{ dumpPlan }}</span
                            ><WikisyncInfo :text="t('admin.wikisync.dump.planInfo')" /></template
                        ><template v-if="holenLetzte !== null"
                            ><br /><span
                                :class="{ wsync__warnung: holenLetzte.ton !== 'leise' }"
                                data-testid="wsync-dump-letztes"
                                >{{ holenLetzte.text }}</span
                            ></template
                        ></template
                    >
                    <template #knopf>
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="dumpSperre"
                            :breit="telefon"
                            testid="wsync-dump-knopf"
                            @click="ws.dumpHolen()"
                            ><span aria-hidden="true">⇄ </span>{{ t("admin.wikisync.dump.knopf") }}</AvmKnopf
                        >
                    </template>
                    <VerwaltungMeldung :ergebnis="dumpMeldung" testid="wsync-dump-meldung" />
                </WikisyncZeile>

                <!-- Einen einzelnen Artikel über die MediaWiki-API vergleichen -->
                <WikisyncArtikel
                    :wikisync="ws"
                    :stand="stand"
                    :jetzt="jetzt"
                    :telefon="telefon"
                    :darf="darf.artikel"
                    :recht-satz="rechtSatz"
                    @zeige="zeigeArtikel"
                />
            </ul>
            <p class="wsync__legende" data-testid="wsync-legende">
                <span v-for="kreis in KREIS_LEGENDE" :key="kreis" class="wsync__legende-teil">
                    <AvmKreis :fuellung="kreis" :name="kreisName(kreis)" />{{ kreisName(kreis) }}
                </span>
            </p>
        </template>

        <section v-if="ws.tafeln.value !== null" class="wsync__abschnitt" data-testid="wsync-abschnitt-ns">
            <h3 class="wsync__titel">
                {{ t("admin.wikisync.ns.titel") }}
                <span class="wsync__titel-zusatz">{{
                    t("admin.wikisync.ns.titelZusatz", {
                        n: ws.tafeln.value.namensraeume.length,
                        umgebung: umgebungKurz(umgebung),
                    })
                }}</span>
            </h3>
            <WikisyncNamensraeume
                :wikisync="ws"
                :umgebung="umgebung"
                :sperre="tafelSperre"
                :dump-raeume="stand?.dump.namensraeume ?? []"
                @dump-bericht="zeigeBericht()"
            />
        </section>
        <section v-if="ws.tafeln.value !== null" class="wsync__abschnitt" data-testid="wsync-abschnitt-ohne">
            <h3 class="wsync__titel">
                {{ t("admin.wikisync.ohne.titel") }}
                <span class="wsync__titel-zusatz">{{
                    t("admin.wikisync.ohne.titelZusatz", {
                        n: ohneAngezeigt,
                        m: ws.tafeln.value.objektarten.length,
                        umgebung: umgebungKurz(umgebung),
                    })
                }}</span>
            </h3>
            <WikisyncOhne :wikisync="ws" :umgebung="umgebung" :sperre="tafelSperre" />
        </section>

        <WikisyncBerichtFenster
            v-if="berichtOffen"
            v-model:offen="berichtOffen"
            :wikisync="ws"
            :vorfilter="vorfilter"
            :artikel-id="artikelId"
            :unbekannte-raeume="unbekannteRaeume"
            @zum-dump="artikelId = null"
        />
        <WikisyncRegelnFenster
            v-if="regelnOffen"
            v-model:offen="regelnOffen"
            :wikisync="ws"
            :darf="darf.regeln"
            :darf-zurueck="darf.zurueck"
            :darf-begriffe="darf.tafeln"
            :darf-flaechen="darf.flaechen"
            :recht-satz="rechtSatz"
            :umgebung="umgebung"
        />
    </div>
</template>

<style scoped>
.wsync {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
    container: wsync / inline-size;
}

.wsync__block {
    display: block;
}

.wsync__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync__warnung {
    color: var(--color-warning-soft-text);
}

.wsync__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

/* Die Knöpfe unter der Tafel (Dump-Bericht, Befunde, Regelvorschläge öffnen je ein eigenes Fenster): weiche Knöpfe in einer Zeile, in schmalen Fenstern umgebrochen; am Telefon untereinander über die ganze Breite wie „Dump holen“. */
.wsync__fenster-knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

.wsync--telefon .wsync__fenster-knoepfe {
    flex-direction: column;
    align-items: stretch;
}

/* Die Legende wie unter Legacys Listen: leise, jedes Zeichen neben seinem Wort (Guide §13.17). */
.wsync__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wsync__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.wsync__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding-top: var(--divider-gap);
    border-top: 1px solid var(--color-divider);
}

.wsync__titel {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync__titel-zusatz {
    color: var(--color-text-muted);
    letter-spacing: 0;
    text-transform: none;
}
</style>
