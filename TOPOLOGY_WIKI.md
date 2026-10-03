# Topology wiki — MOBA Map Viewer v0.8

This wiki describes the behavior implemented in v0.8. UI names match the editor, including its Chinese tab names. Start with the quick workflow and display reference; the later sections explain the precise calculations and programming interfaces.

## 1. What the topology system does

The system answers two different questions:

- **Geometric topology:** Where does traversable space connect, narrow, branch, or terminate?
- **Strategic topology:** How important are those locations when nearby authored objectives are considered?

The data flow is: **map geometry → navmesh → passable graph → geometric metrics → object influence → strategic scores**.

A navmesh cell is a triangle. A graph node represents a passable cell at its centroid; an edge connects neighboring passable cells. An authored game object is a separate marker with a position, priority and radius. Adding an objective cannot create an articulation point, bridge, junction or geometric choke. It changes strategic scores and critical-marker sizes.

All positions, influence radii and clearance distances use scene units. The map spans −128 to 128 on each axis; the origin is in the center, and positive Y points downward. Graph hop counts and scores are unitless.

## 2. Quick workflow

1. Open `index.html`. In **Import / Save**, import a map JSON or load the bundled draft. If opening with `file://` prevents the draft fetch, use the JSON file picker.
2. Open **Mesh**, then generate a mesh. Topology requires a current mesh; geometry edits make it stale until rebuilt.
3. Open **Strategy / Objects**. Enable Critical points. Add Topology graph to inspect connections, or Connected regions to inspect disconnected areas.
4. To author an objective, choose **Game Object — click map to place** in Tool. Click the map, enter its fields, and press **Save**. The click alone does not save an object.
5. Switch Tool to **Select**, then click a marker or use Existing objects. Change values and Save. Position is edited numerically; drag movement is not implemented.
6. In **Visualization**, choose Route centrality or Strategic importance and press **Render**. Neither needs a source point. Independent overlays remain available above the scalar field.
7. Use **Export Current JSON** or the existing folder-save action to persist the map. The object editor's Save updates the current map in memory; it does not write a file to disk.

For a readable overview, leave Labels and Topology graph off initially. Turn them on when inspecting a specific area. Reduce mesh opacity or hide its fill if it obscures scalar colors.

## 3. Display controls: what each one shows

| Control | Exact display | Meaning and use |
| --- | --- | --- |
| Topology graph | Thin translucent lines between adjacent passable-cell centroids; graph bridges overdrawn in gold | Inspect traversable adjacency and single-edge disconnections. These are graph connections, not physical wall edges or a simplified lane network. Gold bridges only appear while this control is enabled. |
| Connected regions | Translucent colors over passable triangles, one color per connected component | Find isolated traversable islands. Cells belong together if any chain of passable neighbors connects them. One connected map may have only one region even if it contains many rooms or lanes. Colors are identifiers, not importance levels. |
| Critical points | Orange circles, cyan squares, purple diamonds and gray triangles | Show a spatially filtered set of geometric candidates. Marker kind/location comes from geometry; marker size uses strategic score. See the marker table below. |
| Game objects | Authored markers, green when enabled and gray when disabled | Show stored objectives. Turning this visibility control off does **not** disable their influence. Hidden objects remain selectable from Existing objects. |
| Influence radius | Dashed circles with translucent interiors around visible game objects | Show each object's cutoff radius. Influence is strongest at the center and falls to zero at the ring. This display requires Game objects to be visible; hiding rings does not change calculations. Disabled objects can still have gray rings. |
| Labels | Text beside visible critical points and game objects | Critical label: `kind cellId strategicScore`, rounded to two decimals. Object label: `name (priority)`. This switch does not add graph-edge or region labels. |

Overlay toggles change display only. Their state does not remove cells or objects from analysis. Critical points, Game objects and Influence radius start enabled; graph, regions and labels start disabled.

### Critical-point legend

| Marker | Kind | Exact candidate rule | Interpretation |
| --- | --- | --- | --- |
| Orange circle | `choke` | `chokeScore >= 0.48` | A preliminary mixture of route centrality, narrowness and connectivity importance. It is not a measured passage width or guaranteed tactical choke. |
| Cyan square | `junction` | `degree >= 3` and `centrality > 0.15` | A connected, relatively central triangle. Triangle adjacency can produce this in open space; it does not prove three semantic lanes meet. |
| Purple diamond | `articulation` | Removing this graph node increases connected-component count | A single-cell connectivity vulnerability. Narrow multi-cell corridors can exist without any articulation point. |
| Gray triangle | `dead_end` | `degree <= 1` | A triangle with at most one passable neighbor. Includes isolated cells and some boundary/tessellation artifacts, not just recognizable cul-de-sacs. |

For **each kind separately**, candidates are sorted by descending choke score. A candidate is skipped if its centroid is less than 8 scene units from an already accepted marker of that kind. At most 80 markers per kind are retained. This filtering affects markers, not the full graph or metrics. A cell may qualify for multiple kinds, so markers can overlap; later-drawn kinds can cover earlier ones.

The marker size parameter is `3 + 6 × strategicScore` canvas pixels. Shape extents differ: diamonds and triangles extend beyond that parameter. Zoom does not scale these marker symbols like world geometry.

**Example label:** `choke 662 0.35` means cell 662 was selected as a geometric choke candidate and currently has strategic score 0.35. It does not mean its choke score is 0.35. With no object influence, a geometric choke score of 0.70 becomes strategic score 0.35.

### Topology statistics

| Statistic | Exact count |
| --- | --- |
| cells | Passable graph nodes; excludes blocked mesh cells. |
| regions | Connected components of the passable graph. |
| articulations | All articulation cells, including candidates suppressed from display. |
| bridges | All graph edges whose removal disconnects a component. |
| centrality samples | Number of sampled source cells: normally `min(passableCells, 32)`. |

Statistics describe geometric topology and do not change when object priority changes. They need not match the number of visible markers.

## 4. Scalar visualization modes

Select one scalar renderer in **Visualization**, then press Render. Scalar modes are mutually exclusive; topology/object overlays are independent and can accompany any of them.

**Current color direction:** red = lowest value, yellow/green = intermediate, blue = highest value. Thus blue means farther away for Distance field, but higher centrality or strategic importance in those modes. Critical-marker colors indicate kind and do not follow this gradient.

| Mode | Value per passable cell | Source required? | Practical use |
| --- | --- | --- | --- |
| Reachable Distance Field | Approximate shortest route distance from the selected source | Yes | Inspect reachable space and relative travel distance from one point. |
| Route Centrality | Normalized sampled betweenness centrality, 0–1 | No | Compare which cells lie on many sampled shortest graph routes. |
| Strategic Importance | Weighted geometric choke score plus object influence, 0–1 with default settings | No | Compare geometry and authored objective importance together. The internal renderer ID is `topology`. |

Distance field uses Dijkstra on passable adjacency with centroid-to-centroid Euclidean edge lengths. The initial cost is source-to-source-cell-centroid distance; the source cell's displayed value is forced to zero. It is a mesh approximation rather than the exact shortest continuous path. Blocked and unreachable cells receive no value.

Route centrality uses **unweighted hop-count shortest paths**, unlike the distance field. It does not use movement speed, physical edge length, gameplay traffic or object priority. A value of 1 identifies the maximum sampled centrality in the current mesh; it is not “100% of all routes.” Changing mesh resolution or ordering can change it, so comparisons across different meshes need care.

Strategic importance colors every passable node, including cells with no critical marker. No standalone choke-score or clearance scalar renderer is currently exposed; those metrics are returned by the analysis API.

The existing visualization statistics and hover area retain distance-oriented wording. In centrality/strategic mode, a displayed maximum of 1 is the configured score scale, not one scene unit or proof some cell reaches 1. “Reachable cells” may show a dash because these modes do not populate the distance renderer's reachability fields. Use the topology statistics and the selected mode's legend for interpretation.

## 5. Exact geometric metrics

### Passable graph, components and degree

Cells with `attributes.passable === false` are excluded; other cells are included. Cell IDs are looked up explicitly rather than assumed to be array offsets. Neighbor links are deduplicated, self-links are excluded, and adjacency is made symmetric.

`componentId` identifies the cell's connected component. IDs start at zero and are analysis-local, not persistent region names. `degree` is the count of distinct passable graph neighbors; it is not corridor width or movement-direction count.

### Articulation points and graph bridges

Iterative Tarjan traversal finds articulation nodes and bridges. A bridge is a **graph edge**, not a physical bridge prop. Removing a bridge disconnects its component; removing an articulation cell disconnects the remaining graph within its component. Disconnected components are handled separately.

### Route centrality

The engine samples up to 32 sources, evenly spaced in the passable cell list by index. For each, unweighted Brandes accumulation distributes shortest-path contributions across equal-length alternatives. Source nodes do not receive their own source contribution. Accumulated values are divided by the maximum accumulated value over all passable cells. If the maximum is zero, all normalized values are zero.

Sampling is deterministic for the same mesh/order. Small components can receive few or no sampled sources. This is a fast approximation, not an exhaustive all-pairs calculation.

### Clearance and narrowness

The engine finds triangle edges owned by exactly one passable triangle. These include outer map boundaries and obstacle interfaces. It seeds each adjacent centroid with its distance to the nearest such edge, then propagates minimum distances along centroid graph edges using a heap.

`clearance` is that boundary-seeded graph-distance estimate in scene units. Interior propagation follows mesh centroid routes and may overestimate direct clearance. It is not an exact obstacle-distance field or a traversable-diameter guarantee.

```text
narrowness = 1 / (1 + clearance / 12)
```

Larger narrowness means more constrained estimated space. Clearance 0 gives 1; clearance 12 gives 0.5; clearance 36 gives 0.25. If no boundary seed reaches a cell, clearance remains Infinity and narrowness is set to zero.

### Connectivity importance and choke score

```text
connectivityImportance = 1.00 if the cell is an articulation
                         0.75 otherwise if it touches a graph bridge
                         0.00 otherwise

chokeScore = 0.55 × centrality
           + 0.35 × narrowness
           + 0.10 × connectivityImportance
```

Default weights yield a score in 0–1. A choke candidate needs at least 0.48 before display filtering. This blend permits chokepoints without articulation; however, it can miss real passages or highlight mesh artifacts. Use the map shape and individual metrics to judge a candidate.

## 6. Game-object fields and editing

| Field / action | Meaning and usage |
| --- | --- |
| Name | Display label; does not change influence. Blank names receive a manager fallback. |
| Type | Category, marker shape and defaults. Type adds no independent combat, vision or control effect. |
| Priority | Editor accepts 0–100. Influence is proportional to priority; 0 contributes nothing. This is a relative authored weight, not a probability. |
| Influence radius | Nonnegative scene-unit cutoff. At or beyond this distance contribution is zero. Radius 0 contributes zero even at the object's position. |
| X / Y | Position in scene units; editor accepts −128 to 128. Objects can be placed inside blocked areas; no navmesh snapping is performed. |
| Enabled | False keeps the object stored and visible in gray but removes its influence. |
| Existing objects | Selects an object for editing, including a hidden object. Choosing New object clears the selection but retains form values for reuse. |
| Save | Creates a new object or updates the selected object in the in-memory map, then refreshes strategic results. |
| Delete | Removes the selected stored object; does nothing with no selection. Export/save the map to persist this deletion. |

Canvas selection works in the strategy tab with Select active, or through the existing geometry editor's Select mode. It requires Game objects visibility and uses a fixed 14-pixel hit distance from the marker center. Where objects overlap, the last stored matching object wins; use the dropdown to select another.

### Default types and symbols

| Type | Shape | Default priority | Default radius |
| --- | --- | --- | --- |
| tower | Square | 50 | 20 |
| major_objective | Diamond | 90 | 30 |
| minor_objective | Circle | 50 | 20 |
| jungle_camp | Circle | 50 | 20 |
| base | Triangle | 50 | 20 |
| vision_point | Circle | 50 | 20 |
| resource | Circle | 50 | 20 |
| generic | Circle | 50 | 20 |

For a new object, changing type fills that type's priority/radius defaults. Changing an existing object's type preserves its numeric fields. You can override those values before Save. Unknown imported types retain their type ID and use generic normalization defaults and a circle marker.

Object marker size parameter is `4 + 7 × min(1, priority / 100)` pixels. Enabled state changes color, not size. The selected marker gets a white outline. Labels show raw priority, not influence at nearby cells.

## 7. Strategic influence and score: exact meaning

For each enabled object with positive radius, at a node or critical-point position:

```text
d = straight-line distance from object position to analysis position
objectInfluence = max(0, 1 − d / radius) × max(0, priority) / 100
gameObjectInfluence = sum of all objectInfluence values
strategicScore = min(1,
    0.5 × chokeScore + 0.5 × min(1, gameObjectInfluence))
```

Disabled objects and zero-radius objects contribute zero. Overlapping objects add together; the raw `gameObjectInfluence` can exceed 1, but its score contribution saturates at 1. Imported/API priorities can exceed 100; the editor limits entry to 100, and marker sizing saturates at 100.

With no influence, strategicScore is **half** the geometric choke score. With maximum influence and no geometric score, it is 0.5. These are comparative design scores, not tactical success probabilities.

Influence currently crosses walls and disconnected regions because distance is Euclidean. A close objective across a wall can raise a cell's score. The radius ring represents this same straight-line model. Neither game-object type nor team ownership changes the formula.

### Worked example

Assume a geometric choke score of 0.80. One objective has radius 30, and the analysis point is 6 units away, so proximity is `1 − 6/30 = 0.80`.

| Object state | Raw influence | Strategic score |
| --- | --- | --- |
| Priority 100, enabled | 0.80 | `0.40 + 0.40 = 0.80` |
| Priority 20, enabled | 0.16 | `0.40 + 0.08 = 0.48` |
| Disabled | 0 | 0.40 |
| At or outside radius | 0 | 0.40 |

The geometric choke remains 0.80 in every row. Its kind and location remain unchanged; its label score and marker size change. If several objectives produce total influence 1.4, the final score here is 0.90 because the influence term is capped.

## 8. Updating, saving and troubleshooting

| Change | What happens |
| --- | --- |
| Priority, radius, position, enabled, add/delete object | Recompute strategic analysis. Reuse mesh and geometric topology. An already-rendered Strategic importance field refreshes on Save. |
| Geometry edit | Existing mesh becomes stale. Rebuild it before using current topology. |
| New/rebuilt mesh | Recompute geometric and strategic analysis on the next render. |
| Visibility or label toggle | Redraw; cached analysis is reused. |
| Distance source | Invalidates the scalar result; use Render to calculate the field again. |
| Change scalar renderer | Clears the scalar result; use Render. Independent overlays remain. |
| Clear visualization | Clears the selected scalar result, not the independent critical-point/object overlays. |

**No topology visible:** load a map, generate a current mesh, and enable the desired layers. Hidden/stale scalar results are not evidence the map has no routes.

**No object saved after clicking:** click chooses a draft position; press Save. Verify the status message and Existing objects list.

**A gray object still has a large ring:** disabled objects remain visible. Its influence is zero regardless of ring size.

**Priority changes seem ineffective:** press Save, confirm Enabled and a positive radius, and check that the inspected cell is within radius. Route centrality intentionally ignores priority. Overlapping influences can saturate the strategic score's influence term.

**Graph or labels look crowded:** turn off graph/labels, hide mesh edges/fill as needed, then inspect the desired layer. Label collision avoidance is not implemented.

**Many junctions in open space:** the rule uses triangle degree and centrality. It is preliminary and sensitive to tessellation, not semantic lane detection.

**Numbers change after rebuilding:** cell IDs, sampling sources, graph hops and estimated clearance depend on the generated mesh. Keep mesh settings fixed when comparing objective layouts.

### Persistence

Legacy `objects` remains geometric map data. Strategic markers live in the separate top-level `gameObjects` array. Missing `gameObjects` loads as an empty array.

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

`id` is a stable unique identifier; new editor objects receive generated IDs. `properties` stores extensible metadata and survives editor updates; the UI does not edit it. Unsupported extra top-level fields on individual game objects are not preserved by normalization—put custom metadata in properties. Type registrations are runtime configuration and are not serialized, but each object's effective priority/radius is stored.

Malformed numeric fields fall back to defaults; negative priority/radius become zero. Missing/invalid position coordinates default to zero independently. The manager rejects duplicate IDs; bulk loading warns and skips duplicate or invalid records. Derived metrics, points and strategic scores are not authoritative map inputs and are not exported. A valid existing mesh cache may be exported by the original save workflow.

## 9. Programming reference

These APIs are global browser modules. The regular viewer manages their inputs and caching; consumers using them directly own cache invalidation. Raw compute calls expect valid meshes and normalized game objects.

| Function | Purpose / result |
| --- | --- |
| `TopologyEngine.buildPassableGraph(mesh)` | Returns a Map from cell ID to unique symmetric passable-neighbor IDs. |
| `TopologyEngine.compute(mesh, map, options)` | Returns nodes, edges, connected regions, bridges, per-cell metrics, filtered critical points and statistics. `map` is currently reserved; geometry is read from mesh. No drawing or mutation of authored data. |
| `StrategicTopology.getStrategicDistance(object, node)` | Returns Euclidean scene-unit distance between their position arrays. |
| `StrategicTopology.objectInfluenceAtPoint(object, node, context)` | Returns one object's raw contribution. Despite the function name, node must be an object with `position: [x,y]`, not a bare array. Optional `context.getDistance` overrides distance. |
| `StrategicTopology.compute({mesh, topology, gameObjects, getDistance, weights})` | Returns annotated nodes, annotated criticalPoints and scalar values keyed by cell ID. Does not mutate geometric topology. |
| `new GameObjectManager(objects)` | Imports/normalizes a list, warning and skipping rejected records. |
| `addObject(object)` | Normalizes and adds, returns a copy, throws on duplicate ID. |
| `updateObject(id, patch)` / `updatePriority(id, priority)` | Updates existing data, preserves ID, returns a copy; unknown ID throws. |
| `removeObject(id)` | Returns whether an object was removed. |
| `getObject(id)` / `getObjects()` | Returns a copy of one object (or null), or copies of all objects. |
| `GameObjectTypes.registerType(def)` / `list()` | Registers/replaces a type definition or lists definitions. Register before viewer initialization to populate its menu. |

Each `cellMetrics[id]` contains componentId, degree, articulation, centrality, clearance, narrowness, connectivityImportance and chokeScore. Nodes expose id, position and score (the choke score). Critical points expose id, kind, position, cellIds, score, radius, label and properties containing metrics. Their stored radius of 3 is not an influence radius; the viewer computes displayed size separately.

Strategic annotations add `gameObjectInfluence` and `strategicScore`. Critical-point `score` remains the geometric score; the new strategicScore field is separate.

```javascript
const manager = new GameObjectManager(map.gameObjects || []);
const topology = TopologyEngine.compute(mesh, map);
const strategic = StrategicTopology.compute({
  mesh, topology, gameObjects: manager.getObjects()
});
// A consumer can inspect an exact per-cell metric:
const id = topology.nodes[0]?.id;
if (id !== undefined) console.log(topology.cellMetrics[id], strategic.values[id]);
```

A custom `getDistance(object, node, context)` can later supply path distance. Return distances in the same units as influenceRadius; Infinity produces zero contribution. Supply a valid nonnegative distance. No built-in navmesh/path-distance influence is implemented.

### Configuration defaults

| Setting | Default | Effect |
| --- | --- | --- |
| `TopologyEngine.CONFIG.centralitySamples` | 32 | Source cap; more samples cost more processing. Use a positive integer. |
| `clearanceScale` | 12 | Scale in the narrowness formula; larger values produce larger narrowness at equal clearance. Use a positive value. |
| `chokeThreshold` | 0.48 | Candidate cutoff, before marker suppression. |
| `pointSpacing` | 8 | Minimum same-kind marker separation in scene units. |
| `maxPointsPerKind` | 80 | Display-candidate cap per kind. |
| `chokeWeights` | 0.55 / 0.35 / 0.10 | Centrality / narrowness / connectivity weights. |
| `StrategicTopology.CONFIG.priorityScale` | 100 | Divisor for authored priority. |
| `StrategicTopology.CONFIG.weights` | 0.50 / 0.50 | Topology / gameObjects composition. |

Topology compute accepts options overriding its defaults; strategic compute accepts weights. These are developer settings, not editor controls. Weights are not automatically renormalized. Use nonnegative weights summing to one for the documented score interpretation. Changing configuration at runtime does not automatically invalidate the viewer's caches; configure before initialization or explicitly recompute in your integration.

### Visualization extension format

Scalar plugins may return `values`, `min`, `max` as before. Optional `overlays` can contain regions (polygons/color), edges (from/to/color/width), points (position/shape/size/color/label), and labels (position/text/color). Coordinates are scene positions; marker sizes and line widths are canvas pixels. Regions here are render polygons; the geometric topology engine's regions initially contain cell IDs, which the viewer resolves to triangles. No overlays is a valid scalar-only result.

## 10. Scope and limitations

The implementation is a spatial-analysis foundation. It does not simulate player movement, combat, vision, objective timing, team control, lane assignments or MOBA strategy. Scores support map-design inspection; they do not establish what a team should do.

Main approximations are sampled hop-based centrality, triangle-derived junction/dead-end candidates, boundary-seeded clearance, connected-component regions and Euclidean object influence. Computation is cached and sampling-bounded but runs synchronously. These limits should guide interpretation of every view.

For implementation history and previous validation, see [TOPOLOGY_GUIDE.md](TOPOLOGY_GUIDE.md). For the original geometry, mesh and save workflow, see [README.md](README.md) and [FORMAT.md](FORMAT.md).
