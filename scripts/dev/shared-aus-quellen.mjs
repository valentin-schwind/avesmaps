// `node --import <checkout>/scripts/dev/shared-aus-quellen.mjs …` (WI-0189, Review L7-02): Node löst `@avesmaps3d/shared` auf die
// Quellen DIESES Checkouts auf statt über `node_modules` auf das gebaute `dist`. Über `node_modules` käme eine Arbeitskopie ohne
// eigenes `node_modules` beim Paket des Hauptcheckouts an, und nach einem Pull ohne Neubau beim alten Stand. Genutzt von
// `npm run dev:server` und dem eigenen Fastify der Browsertests (`E2E_SERVER=1`). Der Routing-Worker erbt `--import` und damit
// den Haken. Typcheck, übrige Befehle und Release bleiben bei `dist`.
import { registerHooks } from "node:module";

const quelle = new URL("../../packages/shared/src/index.ts", import.meta.url).href;

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "@avesmaps3d/shared") return { url: quelle, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
