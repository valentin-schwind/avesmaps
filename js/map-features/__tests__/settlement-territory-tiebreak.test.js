const assert = require("assert");
const { descendantWikiKeys, pickDeepestTerritory } = require("../map-features-settlement-territory-assign.js");
const kids = new Map([["staat",["graf"]],["graf",["baronA","baronB"]]]);
const set = descendantWikiKeys(["graf"], kids);
assert.ok(set.has("graf") && set.has("baronA") && set.has("baronB"), "descendants incl self");
assert.ok(!set.has("staat"), "no ancestors");
console.log("descendant tests passed");

// pickDeepestTerritory: nested staat (depth 0) > graf (depth 1) > baronA (depth 2) -> baronA wins.
const nestedMeta = new Map([
  ["staatPID", { wiki_key: "staat", depth: 0, area: 100 }],
  ["grafPID", { wiki_key: "graf", depth: 1, area: 50 }],
  ["baronAPID", { wiki_key: "baronA", depth: 2, area: 10 }],
]);
const deepest = pickDeepestTerritory(["staatPID", "grafPID", "baronAPID"], nestedMeta);
assert.ok(deepest && deepest.wiki_key === "baronA" && deepest.territory_public_id === "baronAPID", "deepest hit wins");

// Tiebreak: two hits at the SAME depth -> smaller area wins (true overlap, no ancestor relation).
const tiedMeta = new Map([
  ["claimBigPID", { wiki_key: "claimBig", depth: 2, area: 80 }],
  ["claimSmallPID", { wiki_key: "claimSmall", depth: 2, area: 20 }],
]);
const tieWinner = pickDeepestTerritory(["claimBigPID", "claimSmallPID"], tiedMeta);
assert.ok(tieWinner && tieWinner.wiki_key === "claimSmall", "same-depth tiebreak: smaller area wins");

// No hits -> null (settlement stays unassigned, not guessed -- §9.3).
assert.strictEqual(pickDeepestTerritory([], nestedMeta), null, "empty hits -> null");
assert.strictEqual(pickDeepestTerritory(undefined, nestedMeta), null, "undefined hits -> null");

console.log("pickDeepestTerritory tests passed");
