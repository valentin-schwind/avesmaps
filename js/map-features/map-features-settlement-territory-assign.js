// Settlement <-> territory assignment helpers for the Siedlungseditor.
//
// Currently contains only the pure descendant-union helper used by the LEFT
// column (territory tree) to translate a tri-state checkbox selection into a
// containment filter for the (future) middle settlement list: a settlement is
// visible if its territory_wiki_key falls in the union of descendant sets of
// every checked node (see docs/siedlungseditor-design.md §5).
//
// Later phases extend THIS FILE with the ray-cast assignment engine (point-in-
// polygon over window.regionData via map-features-point-in-polygon.js, deepest-
// territory tiebreak) — kept together because both deal with settlement/
// territory containment. No DOM, no dependencies; usable from Node (tests) and
// the browser (settlement editor iframe).
//
// KERN-INVARIANTE: ancestor/descendant relationships are derived ONLY from
// parent_wiki_key. Never affiliation_path.

"use strict";

/**
 * Returns the set of wiki_keys reachable from any of `checkedKeys`, including
 * the checked keys themselves and every descendant (DFS over parent_wiki_key
 * child links). Pure function: does not mutate its inputs.
 *
 * @param {Iterable<string>} checkedKeys - explicitly checked territory wiki_keys.
 * @param {Map<string, string[]>} childrenByParent - parent_wiki_key -> child wiki_keys.
 * @returns {Set<string>} union of checked keys + all their descendants.
 */
function descendantWikiKeys(checkedKeys, childrenByParent) {
  const result = new Set();
  const children = childrenByParent instanceof Map ? childrenByParent : new Map();
  const stack = [...(checkedKeys || [])];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === null || typeof key === "undefined" || key === "" || result.has(key)) continue;
    result.add(key);
    const kids = children.get(key);
    if (Array.isArray(kids)) {
      for (const child of kids) stack.push(child);
    }
  }
  return result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { descendantWikiKeys };
}
if (typeof window !== "undefined") {
  window.AvesmapsSettlementAssign = Object.assign(window.AvesmapsSettlementAssign || {}, { descendantWikiKeys });
}
