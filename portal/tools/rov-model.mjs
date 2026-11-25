// Turns a CAD export of the ROV into the small, compressed rov.glb that the Crush Depth page's
// 3D viewer loads (portal/js/rov-viewer.js).
//
//   cd portal/tools && npm install
//   node rov-model.mjs <export.glb> ../../rov.glb --clear 0.922,0.922,0.896 --clear-part "HOUSING TUBE"
//
// Input: a .glb of the whole assembly. From Fusion, export STEP and convert it:
//   pip install cascadio
//   python3 -c "import cascadio; cascadio.step_to_glb('rov.step', 'rov-export.glb', tol_linear=0.2, tol_angular=0.4, merge_primitives=True, include_materials=True)"
// STEP keeps each part's colour but not its transparency, so --clear names the colour (as it
// appears in the .glb, 0-1 linear RGB) that stands for clear acrylic in Fusion, and --clear-part makes a whole
// part clear when only some of its faces carry that colour. Both can be repeated.
//
// Options:
//   --min <fraction>   drop parts smaller than this share of the whole ROV (default 0.01: nuts, washers,
//                      resistors)
//   --error <mm>       how far simplifying may move a surface, in millimetres (default 0.3: under a pixel at the
//                      viewer's starting zoom)
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, prune, quantize, meshopt, instance, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { stat } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!input || !output) {
  console.error('Usage: node rov-model.mjs <export.glb> <rov.glb> [--clear r,g,b] [--clear-part name] [--min 0.01] [--error 0.3]');
  process.exit(1);
}
const MIN = Number(flag('--min')[0] ?? 0.01);
const ERROR = Number(flag('--error')[0] ?? 0.3) / 1000;
const CLEAR_COLORS = flag('--clear').map((s) => s.split(',').map(Number));
const CLEAR_PARTS = flag('--clear-part');

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const diag = (b) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
const triangles = () => {
  let t = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const batch = node.getExtension('EXT_mesh_gpu_instancing');
    const copies = batch ? batch.getAttribute('TRANSLATION')?.getCount() || 1 : 1;
    for (const p of mesh.listPrimitives()) t += copies * (p.getIndices()?.getCount() ?? 0) / 3;
  });
  return Math.round(t);
};
const size = diag(getBounds(scene));
console.log(`Read ${input}: ${triangles().toLocaleString()} triangles, ${size.toFixed(3)} m across`);

// Clear acrylic: one shared see-through material
const clear = doc.createMaterial('Clear acrylic')
  .setBaseColorFactor([0.86, 0.93, 0.97, 0.18]).setAlphaMode('BLEND')
  .setMetallicFactor(0).setRoughnessFactor(0.06).setDoubleSided(true);
const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.006);
let cleared = 0;
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  const m = p.getMaterial();
  if (m && CLEAR_COLORS.some((c) => near(m.getBaseColorFactor().slice(0, 3), c))) { p.setMaterial(clear); cleared++; }
}
scene.traverse((node) => {
  if (!node.getMesh() || !CLEAR_PARTS.some((name) => node.getName().startsWith(name))) return;
  for (const p of node.getMesh().listPrimitives()) if (p.getMaterial() !== clear) { p.setMaterial(clear); cleared++; }
});
console.log(`Made ${cleared} surfaces clear acrylic`);

// STEP colours arrive with glTF's default finish (fully metallic and fully rough), which looks muddy.
// Fusion's default grey (Steel - Satin) stays a satin metal; every other colour reads as plastic.
for (const m of root.listMaterials()) {
  if (m === clear) continue;
  const steel = near(m.getBaseColorFactor().slice(0, 3), [0.352, 0.352, 0.352]);
  m.setMetallicFactor(steel ? 0.6 : 0).setRoughnessFactor(steel ? 0.4 : 0.5).setDoubleSided(false);
}

// Small parts add triangles and draw calls but can't be seen at this scale
let dropped = 0;
for (const node of root.listNodes()) {
  if (node.getMesh() && diag(getBounds(node)) < MIN * size) { node.setMesh(null); dropped++; }
}
console.log(`Dropped ${dropped} parts smaller than ${(MIN * size * 1000).toFixed(1)} mm`);

await doc.transform(prune(), dedup(), weld());

// Simplify every part to the same absolute tolerance, so screw threads and fillets flatten out
// while big surfaces keep their shape. (meshoptimizer measures error against each mesh's own size.)
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  const pos = p.getAttribute('POSITION');
  if (!pos || !p.getIndices()) continue;
  const lo = pos.getMin([]), hi = pos.getMax([]);
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (extent > 0) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0, error: Math.min(0.5, ERROR / extent), lockBorder: false });
}

await doc.transform(
  instance({ min: 3 }),
  flatten(),
  join({ keepNamed: false }),
  prune(),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
const bytes = (await stat(output)).size;
console.log(`Wrote ${output}: ${root.listMeshes().length} meshes, ${triangles().toLocaleString()} triangles, ${(bytes / 1048576).toFixed(1)} MB`);
