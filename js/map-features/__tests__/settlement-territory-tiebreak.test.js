const assert = require("assert");
const { descendantWikiKeys } = require("../map-features-settlement-territory-assign.js");
const kids = new Map([["staat",["graf"]],["graf",["baronA","baronB"]]]);
const set = descendantWikiKeys(["graf"], kids);
assert.ok(set.has("graf") && set.has("baronA") && set.has("baronB"), "descendants incl self");
assert.ok(!set.has("staat"), "no ancestors");
console.log("descendant tests passed");
