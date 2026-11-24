// Page outline helpers shared by both backends and the sidebar.

// The page itself plus every page nested under it.
export function descendants(tree, rootId) {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) tree.filter((n) => n.parentId === out[i]).forEach((n) => out.push(n.id));
  return out;
}

// Nest a flat outline: [{id, parentId, order}] -> [{...node, children: [...]}]
export function nest(tree = []) {
  const byParent = new Map();
  tree.forEach((n) => {
    const k = n.parentId || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  });
  const ids = new Set(tree.map((n) => n.id));
  const build = (pid) => (byParent.get(pid) || [])
    .slice().sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.title).localeCompare(String(b.title)))
    .map((n) => ({ ...n, children: build(n.id) }));
  // Orphans (parent deleted) surface at the top level instead of disappearing.
  const orphans = tree.filter((n) => n.parentId && !ids.has(n.parentId)).map((n) => ({ ...n, parentId: null }));
  const roots = build(null);
  return [...roots, ...orphans.map((n) => ({ ...n, children: build(n.id) }))];
}

export function pathTo(tree = [], id) {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const out = [];
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { out.unshift(cur); seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return out;
}
