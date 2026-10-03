# MOBA Map JSON / Mesh / Visualization Format (v0.8)

## Map JSON

The scene boundary is `x/y ∈ [-128,128]`. Authored map objects remain in the top-level `objects` array. v0.8 also supports strategic game objects as persistent authored data.

A valid, non-stale mesh may be serialized when its source signature matches the current map. Derived visualization/topology results are runtime state and are normally recomputed rather than treated as authoritative authored data.

## Mesh cells

Cells contain triangle geometry, centroid, neighbors, type, and registered attributes such as `passable`.

## Strategic game objects

Strategic objects support fields such as `id`, `name`, `type`, `position`, `priority`, `influenceRadius`, `enabled`, and `properties`.

## Visualization plugins

`MapVisualizers.registerRenderer(...)` registers scalar mesh renderers. Renderer results use `values[cellId]` for scalar/state output and may expose legends and statistics.

Object-type registration through `MapEditorTypes.registerObjectType(...)` and cell-attribute registration through `registerCellAttribute(...)` remain independent of visualization renderers.
