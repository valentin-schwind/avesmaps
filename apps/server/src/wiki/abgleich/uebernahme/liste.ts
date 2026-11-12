import { WIKISYNC_ANGESCHLOSSEN, type WikisyncBereich } from "@avesmaps3d/shared";
import { gebietSchreiber } from "./gebiet.ts";
import { gipfelSchreiber } from "./gipfel.ts";
import { kraftlinieSchreiber } from "./kraftlinie.ts";
import { literaturSchreiber } from "./literatur.ts";
import { ortSchreiber } from "./ort.ts";
import { quelleSchreiber } from "./quelle.ts";
import { regionSchreiber } from "./region.ts";
import type { Schreiber } from "./schreiber.ts";
import { sprachenSchreiber } from "./sprachen.ts";
import { vorkommenSchreiber } from "./vorkommen.ts";
import { wegSchreiber } from "./weg.ts";

/**
 * Die angeschlossenen Bereiche (WI-0253 D-1): wo die Übernahme einen Schreiber hat. Ein Bereich, der hier fehlt, lässt sich weder umschalten noch übernehmen.
 * `WIKISYNC_ANGESCHLOSSEN` im Paket shared nennt dieselben Bereiche für die Oberfläche; ein Test hält beide Listen gleich.
 */
export const SCHREIBER: Readonly<Partial<Record<WikisyncBereich, Schreiber>>> = {
    kraftlinie: kraftlinieSchreiber,
    ort: ortSchreiber,
    weg: wegSchreiber,
    gebiet: gebietSchreiber,
    region: regionSchreiber,
    gipfel: gipfelSchreiber,
    literatur: literaturSchreiber,
    quelle: quelleSchreiber,
    vorkommen: vorkommenSchreiber,
    sprachen: sprachenSchreiber,
};

export const schreiberFuer = (bereich: WikisyncBereich): Schreiber | undefined => SCHREIBER[bereich];

export const ANGESCHLOSSENE_BEREICHE: readonly WikisyncBereich[] = WIKISYNC_ANGESCHLOSSEN;
