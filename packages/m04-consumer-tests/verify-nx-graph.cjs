// CI-only, read the actual Nx graph; do not change tags or graph dependencies.
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const graph = data.graph ?? data;
const nodes = Object.values(graph.nodes ?? {});
const project = root => nodes.find(node => node.data.root === root);
const consumer = project("packages/m04-consumer-tests");
const engine = project("packages/schema-engine");
const kernel = project("packages/platform-kernel");
if (!consumer || !engine || !kernel) throw Error("M04 Nx projects missing");
const edges = graph.dependencies[consumer.name] ?? [];
for (const target of [engine.name,kernel.name]) {
  if (!edges.some(edge => edge.target === target)) throw Error("missing Nx consumer edge: "+target);
}
const internal = edges.filter(edge => graph.nodes[edge.target]).map(edge=>edge.target);
if (internal.some(target => ![engine.name,kernel.name].includes(target))) throw Error("unexpected Nx workspace dependency: "+internal);
if ((graph.dependencies[engine.name] ?? []).some(edge => edge.target === consumer.name)) throw Error("production engine depends on consumer tests");
console.log("M04_NX_GRAPH PASS "+JSON.stringify({consumer:consumer.name,targets:internal}));
