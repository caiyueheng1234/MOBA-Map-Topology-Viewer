> **Topology wiki:** [Open the browser wiki](topology_wiki.html) or [read the Markdown reference](TOPOLOGY_WIKI.md) for every layer, symbol, metric, formula and editing workflow.

# v0.8 — strategic topology and game objects

## Run and test manually

Open `index.html` in a browser. With file://, use Import JSON to choose the bundled `map_draft.json`; browser security can prevent the built-in fetch button. Alternatively serve this directory with any static HTTP server.

1. Load `map_draft.json`, open Mesh (Mesh), and generate the mesh.
2. Open Strategy / Objects. Choose Game Object in Tool, click the map, set name/type/priority/radius/enabled, and Save.
3. Switch Tool to Select and click a marker, or select its name in Existing objects. Edit its numeric position or priority and Save. Delete removes the selected object.
4. Toggle topology graph, critical points, connected regions, objects, influence rings, and labels independently. These layers coexist with distance fields.
5. In Visualization, select Strategic importance and Render. Increase a nearby enabled object's priority to see its strategic importance increase. Disable it to remove influence. Mesh and geometric topology are reused.
6. Select Route centrality to inspect sampled centrality. Select Distance field to restore the original source-point workflow; choose a passable source and Render.
7. Export JSON, import it again, and verify the object's properties. Existing folder-save behavior also includes game objects.

## Changelog / source files

- Added `game_object_manager.js`: normalized authored data, reusable type defaults and CRUD operations.
- Added `topology_engine.js`: renderer-independent geometric graph analysis.
- Added `strategic_topology.js`: distance-based influence and configurable strategic weighting.
- Updated `viewer.js` and `index.html`: object editor, selection, persistence, layered overlays, cached analysis, centrality and strategic scalar renderers, conditional source controls.
- Added `topology_tests.js` and this guide. Existing mesh generation, geometry types, bundled map and reference image are unchanged.

## Map JSON

The original format already uses `objects` for geometry, including physical towers. That field retains its original meaning. Strategic objects are stored separately:

```json
{
  "objects": [],
  "gameObjects": [{
    "id": "dragon_01",
    "name": "Dragon",
    "type": "major_objective",
    "position": [40, -20],
    "priority": 90,
    "influenceRadius": 30,
    "enabled": true,
    "properties": {}
  }]
}
```

Old maps default to an empty gameObjects array. Strategic towers are markers, not blocking geometry. Existing metadata and properties survive object edits and JSON round trips. Imported malformed numeric values default safely; negative radii become zero. Duplicate IDs are rejected by the manager; bulk imports warn and skip duplicates. Unknown type IDs are retained with generic defaults. The editor offers priorities 0–100; analysis normalizes against the configurable priority scale. Type definitions can be registered with `GameObjectTypes.registerType(...)` before viewer initialization. Definitions themselves are runtime configuration, not persisted; effective per-object values are persisted.

Derived topology and strategic results are never exported as map inputs. The existing optional mesh cache remains supported. Priority, radius, position, enabled state and object CRUD invalidate only strategic analysis; a different mesh triggers geometric analysis.

## Implemented algorithms and APIs

- `TopologyEngine.compute(mesh, map, options)`: robust cell-ID lookup; symmetric passable adjacency; connected components; degree; iterative Tarjan articulation points and graph bridges; deterministic sampled unweighted Brandes betweenness (32 sources by default), normalized against the mesh maximum.
- Clearance: detect passable triangle boundary edges, seed centroid-to-segment distances, propagate shortest centroid-route distances with a heap. Convert clearance to narrowness using `1 / (1 + clearance / scale)`.
- Choke score: 0.55 centrality + 0.35 narrowness + 0.10 connectivity importance. Critical candidates include chokes, junctions, articulation points and dead ends. Spatial suppression and per-kind caps keep markers bounded. Bridges remain explicit graph edges.
- `StrategicTopology.compute({mesh, topology, gameObjects, getDistance, weights})`: linear radius falloff times normalized priority; sum influences; blend geometric choke score and clamped influence with default 0.5/0.5 weights. Disabled objects and zero-radius objects contribute zero. A replaceable distance function permits future path-distance analysis.
- `GameObjectManager`: addObject, removeObject, updateObject, updatePriority, getObject, getObjects. Getters return copies.
- Visualization results may additionally contain `overlays.regions` (polygons/color), `edges` (from/to/color/width), `points` (position/shape/size/color/label), and `labels` (position/text/color). All are optional; scalar-only plugins still work.

## Validation performed

- Original `node mesh_engine_tests.js` passed.
- `node topology_tests.js` passed: corridor, junction, dead end, cycle, disconnected region, arbitrary string cell IDs, influence/priority/disabled behavior, normalization, duplicate rejection, persistence, unchanged geometry signature, real legacy mesh and distance field.
- Supplied legacy map produced 3,628 cells in the regression configuration. Geometric analysis took approximately 39 ms on this machine in the initial run (timings vary).
- Headless Microsoft Edge verified legacy import, mesh generation, object placement, click selection, priority edit, disable, overlays, source-control switching, JSON export/reimport and deletion, with no uncaught browser errors. The rendered editor was visually inspected.

## Limitations

This is preliminary topology, not a semantic lane/region decomposition. Regions are connected components. Degree-three triangle cells are only junction candidates; mesh tessellation affects centrality and candidate quality. Clearance is a boundary-seeded graph-distance approximation, not exact obstacle clearance. Influence currently uses straight-line distance and can cross walls. Centrality uses hop counts, not weighted path lengths. Labels can overlap on dense maps and default off. Movement is via numeric coordinates. Computation is bounded and cached but synchronous; no background worker is included. No MOBA AI, vision simulation or tactics are implemented.
