(() => {
  'use strict';

  const renderers = new Map();

  function clone(v) {
    if (typeof structuredClone === 'function') return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function registerRenderer(def) {
    if (!def || typeof def !== 'object') throw new Error('renderer definition must be an object.');
    if (typeof def.id !== 'string' || !def.id) throw new Error('renderer.id must be a non-empty string.');
    if (typeof def.compute !== 'function') throw new Error(`${def.id}: compute(ctx) must be a function.`);
    const normalized = {
      id: def.id,
      label: def.label || def.id,
      description: def.description || '',
      requiresMesh: def.requiresMesh !== false,
      requiresSource: !!def.requiresSource,
      compute: def.compute,
      color: typeof def.color === 'function' ? def.color : defaultScalarColor,
      legend: typeof def.legend === 'function' ? def.legend : defaultLegend,
      isCellRenderable: typeof def.isCellRenderable === 'function' ? def.isCellRenderable : ((cell, value) => Number.isFinite(value))
    };
    renderers.set(normalized.id, normalized);
    return normalized;
  }

  function getRenderer(id) { return renderers.get(id) || null; }
  function listRenderers() {
    return [...renderers.values()].map(r => ({
      id: r.id, label: r.label, description: r.description,
      requiresMesh: r.requiresMesh, requiresSource: r.requiresSource
    }));
  }

  function defaultScalarColor(value, result, alpha = 0.62) {
    const min = Number(result?.min ?? 0);
    const max = Number(result?.max ?? 1);
    const denom = Math.max(1e-12, max - min);
    const t = Math.max(0, Math.min(1, (Number(value) - min) / denom));
    // Near = red (0°), far = blue (240°).
    const hue = 240 * t;
    return `hsla(${hue.toFixed(1)},92%,50%,${Math.max(0, Math.min(1, alpha))})`;
  }

  function defaultLegend(result) {
    return { minLabel: String(result?.min ?? 0), maxLabel: String(result?.max ?? '—'), gradient: 'linear-gradient(90deg, hsl(0 92% 50%), hsl(60 92% 50%), hsl(120 92% 45%), hsl(180 92% 45%), hsl(240 92% 50%))' };
  }

  function pointInTriangle(p, a, b, c) {
    const s1 = (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
    const s2 = (c[0]-b[0])*(p[1]-b[1]) - (c[1]-b[1])*(p[0]-b[0]);
    const s3 = (a[0]-c[0])*(p[1]-c[1]) - (a[1]-c[1])*(p[0]-c[0]);
    const hasNeg = s1 < -1e-9 || s2 < -1e-9 || s3 < -1e-9;
    const hasPos = s1 > 1e-9 || s2 > 1e-9 || s3 > 1e-9;
    return !(hasNeg && hasPos);
  }

  function locateCell(mesh, point, predicate = () => true) {
    if (!mesh || !Array.isArray(mesh.cells) || !Array.isArray(mesh.vertices)) return null;
    for (const cell of mesh.cells) {
      if (!predicate(cell)) continue;
      const [ia, ib, ic] = cell.vertices;
      const a = mesh.vertices[ia], b = mesh.vertices[ib], c = mesh.vertices[ic];
      if (a && b && c && pointInTriangle(point, a, b, c)) return cell;
    }
    return null;
  }

  class MinHeap {
    constructor() { this.a = []; }
    push(item) {
      const a = this.a; a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= item[0]) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const root = a[0];
      const last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          const l = i * 2 + 1, r = l + 1;
          if (l >= a.length) break;
          let child = l;
          if (r < a.length && a[r][0] < a[l][0]) child = r;
          if (a[child][0] >= last[0]) break;
          a[i] = a[child];
          i = child;
        }
        a[i] = last;
      }
      return root;
    }
    get size() { return this.a.length; }
  }

  function euclid(a, b) { return Math.hypot(Number(a[0])-Number(b[0]), Number(a[1])-Number(b[1])); }

  function computeDistanceField(ctx) {
    const mesh = ctx.mesh;
    const source = ctx.source;
    if (!mesh || !Array.isArray(mesh.cells)) throw new Error('The distance field requires a valid mesh.');
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) throw new Error('The distance field requires a valid source.');
    const sourceCell = locateCell(mesh, [source.x, source.y], c => c.attributes?.passable !== false);
    if (!sourceCell) throw new Error('The source is not inside a passable cell.');

    const n = mesh.cells.length;
    const dist = new Float64Array(n); dist.fill(Infinity);
    const prev = new Int32Array(n); prev.fill(-1);
    const heap = new MinHeap();
    const s = sourceCell.id;
    dist[s] = euclid([source.x, source.y], sourceCell.centroid);
    heap.push([dist[s], s]);

    while (heap.size) {
      const item = heap.pop();
      const d = item[0], u = item[1];
      if (d !== dist[u]) continue;
      const cu = mesh.cells[u];
      if (!cu || cu.attributes?.passable === false) continue;
      for (const v of cu.neighbors || []) {
        const cv = mesh.cells[v];
        if (!cv || cv.attributes?.passable === false) continue;
        const nd = d + euclid(cu.centroid, cv.centroid);
        if (nd + 1e-12 < dist[v]) {
          dist[v] = nd; prev[v] = u; heap.push([nd, v]);
        }
      }
    }

    const values = {};
    let max = 0, reachableCount = 0;
    for (const cell of mesh.cells) {
      const d = dist[cell.id];
      if (Number.isFinite(d) && cell.attributes?.passable !== false) {
        // Make the source cell exactly zero for a semantically clear legend.
        const value = cell.id === s ? 0 : d;
        values[cell.id] = value;
        if (value > max) max = value;
        reachableCount += 1;
      }
    }
    return {
      renderer_id: 'distance_field',
      source: { x: source.x, y: source.y },
      source_cell_id: s,
      values,
      min: 0,
      max,
      reachable_count: reachableCount,
      total_passable_cells: mesh.cells.filter(c => c.attributes?.passable !== false).length,
      units: 'scene_units',
      algorithm: 'Dijkstra on passable navmesh cell adjacency, centroid-to-centroid edge weights',
      previous: Array.from(prev)
    };
  }

  registerRenderer({
    id: 'distance_field',
    label: 'Reachable Distance Field',
    description: 'Runs Dijkstra from a passable source over the passable-cell adjacency graph of the triangular navmesh, using centroid-to-centroid distance as edge weight. Red indicates nearer cells and blue indicates farther cells; unreachable or impassable cells are not colored.',
    requiresMesh: true,
    requiresSource: true,
    compute: computeDistanceField,
    color: defaultScalarColor,
    legend: result => ({
      minLabel: 'Near / 0',
      maxLabel: Number.isFinite(result?.max) ? `Far / ${result.max.toFixed(1)}` : 'Far / —',
      gradient: 'linear-gradient(90deg, hsl(0 92% 50%), hsl(60 92% 50%), hsl(120 92% 45%), hsl(180 92% 45%), hsl(240 92% 50%))'
    })
  });

  window.MapVisualizers = {
    registerRenderer,
    getRenderer,
    listRenderers,
    locateCell,
    pointInTriangle,
    API_VERSION: 1,
    _debug: { computeDistanceField, MinHeap }
  };
})();
