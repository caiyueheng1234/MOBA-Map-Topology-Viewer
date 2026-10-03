# Changelog

## v0.8

- Added strategic topology analysis and overlays.
- Added route-centrality and strategic-importance scalar renderers.
- Added connected-region, topology-graph, critical-point, bridge-edge, and label overlays.
- Added persistent strategic game objects with editable type, priority, influence radius, position, and enabled state.
- Strategic-object changes update strategic analysis without rebuilding the navmesh.
- Added topology documentation/wiki.
- Preserved the existing distance-field visualization and mesh workflow.

## v0.7

- Added the Visualization tab and extensible `MapVisualizers` renderer registry.
- Added the `distance_field` renderer using Dijkstra over the passable navmesh-cell graph.
- Added source selection by numeric input or canvas click.
- Added continuous near-to-far coloring, overlay opacity, optional mesh edges, result statistics, and cell inspection.
- Increased the default/UI mesh-cell limit to 5000.
