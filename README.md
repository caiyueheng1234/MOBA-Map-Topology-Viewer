# MOBA Map Viewer v0.8

An interactive MOBA map editor, navmesh viewer, and topology-analysis tool. v0.8 adds geometric/strategic topology overlays and user-defined game objects with configurable priority and influence radius.

## Main features

- Scene coordinates: `x/y ∈ [-128,128]`, origin at `(0,0)`.
- Editable map objects including `impassable_terrain`, `tower`, `jungle_spot`, and `grass`.
- Triangular pathfinding mesh stored separately from authored map objects.
- Reachable distance-field visualization using Dijkstra on passable navmesh cells.
- Route-centrality visualization.
- Strategic-importance visualization combining topology and game-object influence.
- Topology overlays for connected regions, graph structure, critical points, and bridge edges.
- User-defined strategic game objects with type, priority, influence radius, position, and enabled state.
- Maximum mesh size of 5000 cells in the current UI.

## Game objects

Open **Strategy / Objects** to place or edit strategic objects. Object priority is authored data and affects strategic analysis without rebuilding the navmesh.

Default supported types include towers, major/minor objectives, jungle camps, bases, vision points, resources, and generic objects.

## Visualization

The visualization framework is derived runtime state: it does not modify authored map data or the mesh. Scalar renderers can be combined with independent topology/object overlays.

## Files

- `index.html` — main UI
- `style.css` — UI styles
- `viewer.js` — editor, canvas, mesh, topology, and visualization integration
- `object_types.js` — map-object and cell-attribute registry
- `mesh_engine.js` — triangular mesh generator
- `visualization.js` — visualization registry and distance-field renderer
- `topology_engine.js` — geometric topology analysis
- `strategic_topology.js` — strategic scoring from topology and game objects
- `game_object_manager.js` — strategic game-object data management
- `topology_wiki.html` / `TOPOLOGY_WIKI.md` — topology meanings, formulas, and usage
- `map_draft.json` — sample map
- `reference.png` — reference image
