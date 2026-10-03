// Run with: node mesh_engine_tests.js
'use strict';
global.window = global;
require('./object_types.js');
require('./mesh_engine.js');

function assert(ok, msg) { if (!ok) throw new Error(msg); }

// 1) Self-intersecting bow-tie: intersection must become a vertex, and both
// passable and blocked triangular regions must survive classification.
{
  const map = { objects: [{ type:'impassable_terrain', id:'bow', points:[[0,0],[1,0],[0,1],[1,1]] }] };
  const mesh = MeshEngine.generate(map, { spacing:32, refinePasses:0 });
  assert(mesh.vertices.some(p => Math.abs(p[0]-.5)<1e-7 && Math.abs(p[1]-.5)<1e-7), 'missing bow-tie intersection vertex');
  assert((mesh.stats.by_type.impassable_terrain || 0) >= 2, 'missing blocked bow-tie regions');
  assert((mesh.stats.by_type.passable || 0) >= 2, 'missing passable bow-tie regions');
}

// 2) Priority: tower > terrain > grass. Jungle is intentionally ignored.
{
  const map = { objects: [
    { type:'grass', id:'g', points:[[-20,-20],[20,-20],[20,20],[-20,20]] },
    { type:'impassable_terrain', id:'t', points:[[-10,-10],[10,-10],[10,10],[-10,10]] },
    { type:'jungle_spot', id:'j', pos:{x:0,y:0}, radius:9 },
    { type:'tower', id:'tower', pos:{x:0,y:0}, radius:4 }
  ]};
  assert(MeshEngine.classifyPoint([15,0], map.objects).type === 'grass', 'grass classification failed');
  assert(MeshEngine.classifyPoint([8,0], map.objects).type === 'impassable_terrain', 'terrain priority failed');
  assert(MeshEngine.classifyPoint([0,0], map.objects).type === 'tower', 'tower priority failed');
}

// 3) Clipping: generated vertices remain inside the legal scene bounds.
{
  const map = { objects: [{ type:'impassable_terrain', id:'outside', points:[[-200,-20],[0,-20],[0,20],[-200,20]] }] };
  const mesh = MeshEngine.generate(map, { spacing:32, refinePasses:0 });
  assert(mesh.vertices.every(p => p[0]>=-128-1e-7 && p[0]<=128+1e-7 && p[1]>=-128-1e-7 && p[1]<=128+1e-7), 'out-of-bounds mesh vertex');
}

console.log('mesh_engine_tests: PASS');

// 4) Straight constrained edges may be subdivided, but the normal browser-side
// budget should keep the generated mesh below the configured cell ceiling.
{
  const map = { objects: [{ type:'impassable_terrain', id:'long', points:[[-110,-8],[110,-8],[110,8],[-110,8]] }] };
  const mesh = MeshEngine.generate(map, { spacing:20, boundarySpacing:8, refinePasses:5, minAngle:18, maxAspect:6, maxCells:3000 });
  assert(mesh.stats.boundary_vertices_inserted > 0, 'long constrained edges were not subdivided');
  assert(mesh.cells.length <= 3000, `cell budget exceeded: ${mesh.cells.length}`);
}
