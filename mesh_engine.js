(() => {
  'use strict';

  const EPS = 1e-8;
  const BOUND_MIN = -128;
  const BOUND_MAX = 128;

  const sq = x => x * x;
  const dist2 = (a, b) => sq(a[0] - b[0]) + sq(a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const dot = (a, b, c) => (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]);
  const near = (a, b, eps = EPS) => dist2(a, b) <= eps * eps;
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (`00000000${(h >>> 0).toString(16)}`).slice(-8);
  }

  function regularOctagon(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 8 + i * Math.PI / 4;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function objectPolygon(obj, typeRegistry = window.MapEditorTypes) {
    const def = typeRegistry.getObjectType(obj.type);
    if (!def) return null;
    if (def.geometry === 'polygon') return (obj.points || []).map(p => [Number(p[0]), Number(p[1])]);
    if (def.geometry === 'radial_octagon') return regularOctagon(Number(obj.pos?.x), Number(obj.pos?.y), Number(obj.radius));
    return null;
  }

  function pointInPolygonEvenOdd(p, pts) {
    let inside = false;
    const [x, y] = p;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const on = Math.abs(cross(pts[j], pts[i], p)) < 1e-9
        && x >= Math.min(xi, xj) - 1e-9 && x <= Math.max(xi, xj) + 1e-9
        && y >= Math.min(yi, yj) - 1e-9 && y <= Math.max(yi, yj) + 1e-9;
      if (on) return true;
      const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-30) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function classifyPoint(p, objects, typeRegistry = window.MapEditorTypes) {
    const defaults = {};
    for (const a of typeRegistry.listCellAttributes()) defaults[a.name] = a.defaultValue;
    let winner = null;
    let priority = -Infinity;
    for (const obj of objects) {
      const def = typeRegistry.getObjectType(obj.type);
      if (!def?.mesh?.participates) continue;
      if (def.mesh.priority < priority) continue;
      const poly = objectPolygon(obj, typeRegistry);
      if (!poly || poly.length < 3) continue;
      if (!pointInPolygonEvenOdd(p, poly)) continue;
      if (def.mesh.priority > priority || !winner) {
        priority = def.mesh.priority;
        winner = { obj, def };
      }
    }
    if (!winner) return { type: 'passable', attributes: { ...defaults, passable: true }, source_object_id: null, priority: 0 };
    return {
      type: winner.def.mesh.cellType,
      attributes: { ...defaults, passable: true, ...(winner.def.mesh.attributes || {}) },
      source_object_id: winner.obj.id,
      priority: winner.def.mesh.priority
    };
  }

  function clipSegmentToRect(a, b, min = BOUND_MIN, max = BOUND_MAX) {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - min, max - a[0], a[1] - min, max - a[1]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < EPS) {
        if (q[i] < 0) return null;
      } else {
        const r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    const p0 = [a[0] + t0 * dx, a[1] + t0 * dy];
    const p1 = [a[0] + t1 * dx, a[1] + t1 * dy];
    if (near(p0, p1)) return null;
    return [p0, p1];
  }

  function parameterOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) >= Math.abs(dy)) return Math.abs(dx) < EPS ? 0 : (p[0] - a[0]) / dx;
    return Math.abs(dy) < EPS ? 0 : (p[1] - a[1]) / dy;
  }

  function pointOnSegment(p, a, b, eps = 1e-7) {
    return Math.abs(cross(a, b, p)) <= eps * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
      && dot(p, a, b) <= eps && dot(p, b, a) <= eps;
  }

  function segmentIntersectionData(a, b, c, d) {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const rxs = r[0] * s[1] - r[1] * s[0];
    const qpa = [c[0] - a[0], c[1] - a[1]];
    const qpxr = qpa[0] * r[1] - qpa[1] * r[0];
    if (Math.abs(rxs) < EPS && Math.abs(qpxr) < EPS) {
      const pts = [];
      for (const p of [a, b, c, d]) {
        if (pointOnSegment(p, a, b) && pointOnSegment(p, c, d) && !pts.some(q => near(p, q, 1e-7))) pts.push(p);
      }
      return { kind: 'collinear', points: pts };
    }
    if (Math.abs(rxs) < EPS) return { kind: 'none', points: [] };
    const t = (qpa[0] * s[1] - qpa[1] * s[0]) / rxs;
    const u = (qpa[0] * r[1] - qpa[1] * r[0]) / rxs;
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
      return { kind: 'point', points: [[a[0] + t * r[0], a[1] + t * r[1]]] };
    }
    return { kind: 'none', points: [] };
  }

  function buildRawSegments(objects, typeRegistry = window.MapEditorTypes) {
    const segments = [];
    const corners = [[BOUND_MIN, BOUND_MIN], [BOUND_MAX, BOUND_MIN], [BOUND_MAX, BOUND_MAX], [BOUND_MIN, BOUND_MAX]];
    for (let i = 0; i < 4; i++) segments.push({ a: corners[i], b: corners[(i + 1) % 4], boundary: true, source: '__map_boundary__' });

    for (const obj of objects) {
      const def = typeRegistry.getObjectType(obj.type);
      if (!def?.mesh?.participates) continue;
      const poly = objectPolygon(obj, typeRegistry);
      if (!poly || poly.length < 3) continue;
      for (let i = 0; i < poly.length; i++) {
        const clipped = clipSegmentToRect(poly[i], poly[(i + 1) % poly.length]);
        if (clipped) segments.push({ a: clipped[0], b: clipped[1], boundary: false, source: obj.id });
      }
    }
    return segments;
  }

  function planarizeSegments(segments) {
    const split = segments.map(s => ({ ...s, ts: [0, 1] }));
    for (let i = 0; i < split.length; i++) {
      for (let j = i + 1; j < split.length; j++) {
        const si = split[i], sj = split[j];
        const data = segmentIntersectionData(si.a, si.b, sj.a, sj.b);
        for (const p of data.points) {
          const ti = parameterOnSegment(p, si.a, si.b);
          const tj = parameterOnSegment(p, sj.a, sj.b);
          if (ti >= -EPS && ti <= 1 + EPS) si.ts.push(Math.max(0, Math.min(1, ti)));
          if (tj >= -EPS && tj <= 1 + EPS) sj.ts.push(Math.max(0, Math.min(1, tj)));
        }
      }
    }
    const atomic = [];
    for (const s of split) {
      const ts = [...new Set(s.ts.map(t => Math.round(t * 1e10) / 1e10))].sort((a, b) => a - b);
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-10) continue;
        const a = [s.a[0] + (s.b[0] - s.a[0]) * t0, s.a[1] + (s.b[1] - s.a[1]) * t0];
        const b = [s.a[0] + (s.b[0] - s.a[0]) * t1, s.a[1] + (s.b[1] - s.a[1]) * t1];
        if (!near(a, b, 1e-7)) atomic.push({ a, b, boundary: s.boundary, source: s.source });
      }
    }
    return atomic;
  }

  function semanticBoundaryFilter(segments, objects, typeRegistry = window.MapEditorTypes) {
    const kept = [];
    const signature = c => `${c.type}|${stableStringify(c.attributes)}`;
    for (const s of segments) {
      if (s.boundary) { kept.push(s); continue; }
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
      const e = Math.min(1e-3, Math.max(1e-5, len * 1e-4));
      const nx = -dy / len * e, ny = dx / len * e;
      const p1 = [Math.max(BOUND_MIN + 1e-7, Math.min(BOUND_MAX - 1e-7, mx + nx)), Math.max(BOUND_MIN + 1e-7, Math.min(BOUND_MAX - 1e-7, my + ny))];
      const p2 = [Math.max(BOUND_MIN + 1e-7, Math.min(BOUND_MAX - 1e-7, mx - nx)), Math.max(BOUND_MIN + 1e-7, Math.min(BOUND_MAX - 1e-7, my - ny))];
      if (signature(classifyPoint(p1, objects, typeRegistry)) !== signature(classifyPoint(p2, objects, typeRegistry))) kept.push(s);
    }
    return kept;
  }

  function dedupeGeometry(segments) {
    const vertices = [];
    const keyToIndex = new Map();
    const vertexKey = p => `${Math.round(p[0] * 1e8)}:${Math.round(p[1] * 1e8)}`;
    const getIndex = p => {
      const key = vertexKey(p);
      if (keyToIndex.has(key)) return keyToIndex.get(key);
      const idx = vertices.length;
      vertices.push([Number(p[0]), Number(p[1])]);
      keyToIndex.set(key, idx);
      return idx;
    };
    const seenEdges = new Set();
    const constraints = [];
    for (const s of segments) {
      const a = getIndex(s.a), b = getIndex(s.b);
      if (a === b) continue;
      const k = edgeKey(a, b);
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      constraints.push([a, b]);
    }
    return { vertices, constraints };
  }

  function pointSegmentDistance(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = p[0] - a[0], wy = p[1] - a[1];
    const vv = vx * vx + vy * vy;
    const t = vv < EPS ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  }

  function pointKey(p, scale = 1e7) {
    return `${Math.round(p[0] * scale)}:${Math.round(p[1] * scale)}`;
  }

  function subdivideConstraints(vertices, constraints, targetLength, maxVertices = 1500) {
    // Split long straight PSLG edges into smaller constrained edges. This is
    // important for quality: a single very long locked edge next to a dense
    // interior point cloud can force a fan of extremely thin triangles.
    const points = vertices.map(p => [...p]);
    const keyToIndex = new Map(points.map((p, i) => [pointKey(p), i]));
    const out = [];
    const target = Math.max(0.5, Number(targetLength) || 8);
    let inserted = 0;

    function getOrAdd(p) {
      const k = pointKey(p);
      if (keyToIndex.has(k)) return keyToIndex.get(k);
      if (points.length >= maxVertices) return null;
      const idx = points.length;
      points.push(p);
      keyToIndex.set(k, idx);
      inserted += 1;
      return idx;
    }

    for (const [ia, ib] of constraints) {
      const a = points[ia], b = points[ib];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / target));
      let prev = ia;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const idx = getOrAdd([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        if (idx == null) break;
        if (prev !== idx) out.push([prev, idx]);
        prev = idx;
      }
      if (prev !== ib) out.push([prev, ib]);
    }
    return { points, constraints: out, inserted };
  }

  function triangleCircumcenter(t, pts) {
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const aa = ax * ax + ay * ay, bb = bx * bx + by * by, cc = cx * cx + cy * cy;
    return [
      (aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) / d,
      (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / d
    ];
  }

  function triangleIncenter(t, pts) {
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const la = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const lb = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const lc = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const sum = la + lb + lc;
    if (sum < EPS) return null;
    return [(la * a[0] + lb * b[0] + lc * c[0]) / sum, (la * a[1] + lb * b[1] + lc * c[1]) / sum];
  }

  function findEncroachedConstraint(p, points, constraints) {
    let best = null;
    for (let ci = 0; ci < constraints.length; ci++) {
      const [ia, ib] = constraints[ci];
      const a = points[ia], b = points[ib];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const r2 = dist2(a, b) * 0.25;
      const q2 = sq(p[0] - mx) + sq(p[1] - my);
      // A point inside a constrained segment's diametral circle encroaches it.
      // Prefer the most strongly encroached segment.
      if (q2 < r2 * (1 - 1e-9)) {
        const score = r2 > EPS ? q2 / r2 : 1;
        if (!best || score < best.score) best = { ci, score };
      }
    }
    return best;
  }

  function splitConstraintAtMidpoint(points, constraints, ci, pointIndexByKey, maxVertices) {
    const edge = constraints[ci];
    if (!edge) return false;
    const [ia, ib] = edge;
    const a = points[ia], b = points[ib];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const k = pointKey(mid);
    let im = pointIndexByKey.get(k);
    if (im == null) {
      if (points.length >= maxVertices) return false;
      im = points.length;
      points.push(mid);
      pointIndexByKey.set(k, im);
    }
    if (im === ia || im === ib) return false;
    constraints.splice(ci, 1, [ia, im], [im, ib]);
    return true;
  }

  function addPointUnique(points, p, pointIndexByKey, maxVertices, minDistance = 1e-4) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
    if (p[0] < BOUND_MIN + 1e-7 || p[0] > BOUND_MAX - 1e-7 || p[1] < BOUND_MIN + 1e-7 || p[1] > BOUND_MAX - 1e-7) return false;
    if (points.length >= maxVertices) return false;
    const k = pointKey(p);
    if (pointIndexByKey.has(k)) return false;
    const md2 = minDistance * minDistance;
    for (const q of points) if (dist2(p, q) < md2) return false;
    pointIndexByKey.set(k, points.length);
    points.push([p[0], p[1]]);
    return true;
  }

  function addSteinerGrid(vertices, constraints, spacing) {
    const result = vertices.map(p => [...p]);
    const existing = new Set(result.map(p => `${Math.round(p[0] * 1e6)}:${Math.round(p[1] * 1e6)}`));
    const segs = constraints.map(([a, b]) => [vertices[a], vertices[b]]);
    const margin = Math.max(1e-4, spacing * 0.015);
    for (let y = BOUND_MIN + spacing; y < BOUND_MAX - EPS; y += spacing) {
      for (let x = BOUND_MIN + spacing; x < BOUND_MAX - EPS; x += spacing) {
        const p = [x, y];
        if (segs.some(([a, b]) => pointSegmentDistance(p, a, b) < margin)) continue;
        const k = `${Math.round(x * 1e6)}:${Math.round(y * 1e6)}`;
        if (!existing.has(k)) { existing.add(k); result.push(p); }
      }
    }
    return result;
  }

  function addBoundarySupportPoints(points, constraints, spacing, passes = 1) {
    const out = points.map(p => [...p]);
    const existing = new Set(out.map(p => `${Math.round(p[0]*1e6)}:${Math.round(p[1]*1e6)}`));
    const segs = constraints.map(([a,b]) => [points[a], points[b]]);
    const ranked = constraints.map(([ia,ib]) => {
      const a=points[ia], b=points[ib];
      return {ia,ib,len:Math.hypot(b[0]-a[0],b[1]-a[1])};
    }).filter(e => e.len > 1e-7 && e.len < spacing * 0.55).sort((a,b)=>a.len-b.len);
    const maxPass = Math.max(0, Math.min(3, Math.floor(passes)));
    for (let ring=1; ring<=maxPass; ring++) {
      let added=0;
      for (const e of ranked) {
        if (added >= 80) break;
        const a=points[e.ia], b=points[e.ib], len=e.len;
        const dx=b[0]-a[0], dy=b[1]-a[1], nx=-dy/len, ny=dx/len;
        const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
        const d=Math.min(spacing*0.45*ring, Math.max(len*0.8660254038, spacing*0.12)*ring);
        for (const sign of [-1,1]) {
          if (added >= 80) break;
          const q=[mx+nx*d*sign,my+ny*d*sign];
          if (!pointInsideBounds(q)) continue;
          if (segs.some(([s0,s1]) => pointSegmentDistance(q,s0,s1) < Math.max(1e-4, Math.min(len,spacing)*0.05))) continue;
          const k=`${Math.round(q[0]*1e6)}:${Math.round(q[1]*1e6)}`;
          if (!existing.has(k)) { existing.add(k); out.push(q); added++; }
        }
      }
    }
    return out;
  }

  function orientedTri(a, b, c, pts) {
    return cross(pts[a], pts[b], pts[c]) >= 0 ? [a, b, c] : [a, c, b];
  }

  function circumcircleContains(p, a, b, c) {
    const ax = a[0] - p[0], ay = a[1] - p[1];
    const bx = b[0] - p[0], by = b[1] - p[1];
    const cx = c[0] - p[0], cy = c[1] - p[1];
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
      - (bx * bx + by * by) * (ax * cy - cx * ay)
      + (cx * cx + cy * cy) * (ax * by - bx * ay);
    const orient = cross(a, b, c);
    return orient > 0 ? det > EPS : det < -EPS;
  }

  function delaunay(points) {
    // Bowyer-Watson with a tiny deterministic symbolic perturbation used only
    // for geometric predicates. Regular grids contain many exactly co-circular
    // point sets; without this tie-breaker a naïve floating-point implementation
    // can create a non-manifold cavity and even lose a convex-hull edge.
    const pts = points.map((p, i) => {
      const h1 = ((i * 1103515245 + 12345) >>> 0) / 0xffffffff - .5;
      const h2 = ((i * 2654435761 + 1013904223) >>> 0) / 0xffffffff - .5;
      return [p[0] + h1 * 1e-7, p[1] + h2 * 1e-7];
    });
    const n = pts.length;
    const superStart = pts.length;
    pts.push([-1e9, -1e9], [1e9, -1e9], [0, 1e9]);
    let triangles = [[superStart, superStart + 1, superStart + 2]];

    for (let pi = 0; pi < n; pi++) {
      const bad = [];
      for (let ti = 0; ti < triangles.length; ti++) {
        const t = triangles[ti];
        if (circumcircleContains(pts[pi], pts[t[0]], pts[t[1]], pts[t[2]])) bad.push(ti);
      }
      const counts = new Map();
      for (const ti of bad) {
        const t = triangles[ti];
        for (const [u, v] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
          const k = edgeKey(u, v);
          const rec = counts.get(k) || { count: 0, edge: [u, v] };
          rec.count += 1;
          counts.set(k, rec);
        }
      }
      const badSet = new Set(bad);
      triangles = triangles.filter((_, i) => !badSet.has(i));
      for (const rec of counts.values()) {
        if (rec.count !== 1) continue;
        const [u, v] = rec.edge;
        if (Math.abs(cross(pts[u], pts[v], pts[pi])) > EPS) triangles.push(orientedTri(u, v, pi, pts));
      }
    }
    return triangles.filter(t => t.every(i => i < n) && Math.abs(cross(pts[t[0]], pts[t[1]], pts[t[2]])) > EPS)
      .map(t => orientedTri(t[0], t[1], t[2], points));
  }

  function buildEdgeMap(triangles) {
    const map = new Map();
    triangles.forEach((t, ti) => {
      [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(([a, b]) => {
        const k = edgeKey(a, b);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ ti, a, b });
      });
    });
    return map;
  }

  function properSegmentsCross(a, b, c, d) {
    const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
    return d1 * d2 < -EPS && d3 * d4 < -EPS;
  }

  function recoverConstraints(points, triangles, constraints) {
    const locked = new Set();
    for (const [ca, cb] of constraints) {
      const target = edgeKey(ca, cb);
      let guard = 0;
      while (guard++ < 20000) {
        const edgeMap = buildEdgeMap(triangles);
        if (edgeMap.has(target)) { locked.add(target); break; }
        let flipped = false;
        for (const [k, refs] of edgeMap.entries()) {
          if (locked.has(k) || refs.length !== 2) continue;
          const [u, v] = k.split(':').map(Number);
          if ([u, v].includes(ca) || [u, v].includes(cb)) continue;
          if (!properSegmentsCross(points[ca], points[cb], points[u], points[v])) continue;
          const r1 = refs[0], r2 = refs[1];
          const t1 = triangles[r1.ti], t2 = triangles[r2.ti];
          const c = t1.find(x => x !== u && x !== v);
          const d = t2.find(x => x !== u && x !== v);
          if (c == null || d == null || c === d) continue;
          if (!properSegmentsCross(points[u], points[v], points[c], points[d])) continue;
          if (locked.has(edgeKey(c, d))) continue;
          triangles[r1.ti] = orientedTri(c, d, u, points);
          triangles[r2.ti] = orientedTri(d, c, v, points);
          flipped = true;
          break;
        }
        if (!flipped) {
          throw new Error(`Constraint-edge recovery failed: (${points[ca][0].toFixed(3)},${points[ca][1].toFixed(3)})→(${points[cb][0].toFixed(3)},${points[cb][1].toFixed(3)}). Try reducing the initial mesh spacing.`);
        }
      }
      if (guard >= 20000) throw new Error('Constraint-edge recovery exceeded the iteration limit.');
    }
    return triangles;
  }

  function sanitizeTriangles(points, triangles) {
    const seen = new Set();
    const out = [];
    for (const t of triangles) {
      if (!t || t.length !== 3 || new Set(t).size !== 3) continue;
      const area2 = Math.abs(cross(points[t[0]], points[t[1]], points[t[2]]));
      if (!(area2 > 1e-7)) continue;
      const k = [...t].sort((a,b)=>a-b).join(':');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(orientedTri(t[0], t[1], t[2], points));
    }
    return out;
  }

  function longestTriangleEdge(t, pts) {
    const edges = [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]];
    edges.sort((e1,e2)=>dist2(pts[e2[0]],pts[e2[1]])-dist2(pts[e1[0]],pts[e1[1]]));
    return edges[0];
  }

  function triangleMetrics(t, pts) {
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const l = [Math.hypot(a[0]-b[0],a[1]-b[1]), Math.hypot(b[0]-c[0],b[1]-c[1]), Math.hypot(c[0]-a[0],c[1]-a[1])].sort((x,y)=>x-y);
    const area = Math.abs(cross(a,b,c)) / 2;
    const angles = [];
    const sides = [l[0], l[1], l[2]];
    for (let i = 0; i < 3; i++) {
      const x = sides[i], y = sides[(i+1)%3], z = sides[(i+2)%3];
      const cosv = Math.max(-1, Math.min(1, (y*y + z*z - x*x) / Math.max(EPS, 2*y*z)));
      angles.push(Math.acos(cosv) * 180 / Math.PI);
    }
    const minAngle = Math.min(...angles);
    const alt = l[2] > EPS ? (2 * area / l[2]) : 0;
    const aspect = alt > EPS ? l[2] / alt : Infinity;
    return { area, minAngle, aspect, longest: l[2] };
  }

  function pointInsideBounds(p) { return p[0] > BOUND_MIN + 1e-7 && p[0] < BOUND_MAX - 1e-7 && p[1] > BOUND_MIN + 1e-7 && p[1] < BOUND_MAX - 1e-7; }

  function refine(points, constraints, triangles, options) {
    // Ruppert/Chew-inspired constrained-Delaunay refinement.
    // 1. detect triangles that violate min-angle / aspect targets;
    // 2. propose a circumcenter (or a safer incenter fallback);
    // 3. if the proposal encroaches a locked segment, bisect that segment;
    // 4. otherwise add the Steiner point;
    // 5. rebuild Delaunay triangulation and recover all constraints.
    // A hard cell/vertex budget keeps browser-side meshes bounded.
    const minAngle = Math.max(1, Math.min(40, Number(options.minAngle ?? 18)));
    const maxAspect = Math.max(1.5, Number(options.maxAspect ?? 6));
    const passes = Math.max(0, Math.min(10, Math.floor(Number(options.refinePasses ?? 3))));
    const maxCells = Math.max(200, Math.floor(Number(options.maxCells ?? 5000)));
    // Planar triangulations are roughly 2V cells away from the boundary. Keep
    // a safety margin so final cell count is very unlikely to exceed maxCells.
    const maxVertices = Math.max(100, Math.floor(maxCells / 2) - 8);
    const batchLimit = Math.max(8, Math.min(120, Math.floor(maxCells / 30)));
    const minSpacing = Math.max(0.08, Number(options.minSteinerSpacing ?? 0.2));

    points = points.map(p => [...p]);
    constraints = constraints.map(e => [...e]);
    triangles = triangles.map(t => [...t]);
    const pointIndexByKey = new Map(points.map((p, i) => [pointKey(p), i]));
    let addedSteiner = 0, splitConstraints = 0, completedPasses = 0;

    for (let pass = 0; pass < passes; pass++) {
      const bad = triangles.map((t, ti) => ({ ti, t, m: triangleMetrics(t, points) }))
        .filter(x => x.m.minAngle < minAngle || x.m.aspect > maxAspect)
        .sort((a, b) => {
          const sa = Math.max(maxAspect > 0 ? a.m.aspect / maxAspect : 0, minAngle / Math.max(0.01, a.m.minAngle));
          const sb = Math.max(maxAspect > 0 ? b.m.aspect / maxAspect : 0, minAngle / Math.max(0.01, b.m.minAngle));
          return sb - sa;
        });
      if (!bad.length || points.length >= maxVertices) break;

      let changed = 0;
      const splitKeys = new Set();
      for (const item of bad) {
        if (changed >= batchLimit || points.length >= maxVertices) break;

        // Severe slivers respond better to longest-edge bisection than to a
        // far-away circumcenter. This also regularizes graded boundary fans.
        const severe = item.m.aspect > maxAspect * 1.6 || item.m.minAngle < minAngle * 0.55;
        if (severe) {
          const [u, v] = longestTriangleEdge(item.t, points);
          const ek = edgeKey(u, v);
          const ci = constraints.findIndex(e => edgeKey(e[0], e[1]) === ek);
          if (ci >= 0) {
            if (!splitKeys.has(ek) && splitConstraintAtMidpoint(points, constraints, ci, pointIndexByKey, maxVertices)) {
              splitKeys.add(ek);
              splitConstraints += 1;
              changed += 1;
            }
          } else {
            const a = points[u], b = points[v];
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            if (addPointUnique(points, mid, pointIndexByKey, maxVertices, minSpacing)) {
              addedSteiner += 1;
              changed += 1;
            }
          }
          continue;
        }

        let candidate = triangleCircumcenter(item.t, points);
        if (!candidate || !pointInsideBounds(candidate)) candidate = triangleIncenter(item.t, points);
        if (!candidate) continue;

        const enc = findEncroachedConstraint(candidate, points, constraints);
        if (enc) {
          const [ea, eb] = constraints[enc.ci];
          const ek = edgeKey(ea, eb);
          if (splitKeys.has(ek)) continue;
          splitKeys.add(ek);
          if (splitConstraintAtMidpoint(points, constraints, enc.ci, pointIndexByKey, maxVertices)) {
            splitConstraints += 1;
            changed += 1;
          }
          continue;
        }

        if (addPointUnique(points, candidate, pointIndexByKey, maxVertices, minSpacing)) {
          addedSteiner += 1;
          changed += 1;
        }
      }
      if (!changed) break;

      triangles = delaunay(points);
      triangles = recoverConstraints(points, triangles, constraints);
      triangles = sanitizeTriangles(points, triangles);
      completedPasses = pass + 1;

      // Conservative early stop if the next rebuild is already at the cell cap.
      if (triangles.length >= maxCells) break;
    }

    return { points, triangles, constraints, stats: { addedSteiner, splitConstraints, completedPasses, maxVertices } };
  }

  function buildCells(points, triangles, objects, typeRegistry = window.MapEditorTypes) {
    const cells = [];
    for (const t of triangles) {
      const a = points[t[0]], b = points[t[1]], c = points[t[2]];
      const centroid = [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3];
      if (centroid[0] < BOUND_MIN - EPS || centroid[0] > BOUND_MAX + EPS || centroid[1] < BOUND_MIN - EPS || centroid[1] > BOUND_MAX + EPS) continue;
      const cls = classifyPoint(centroid, objects, typeRegistry);
      const metrics = triangleMetrics(t, points);
      cells.push({
        id: cells.length,
        vertices: [...t],
        neighbors: [],
        type: cls.type,
        attributes: cls.attributes,
        source_object_id: cls.source_object_id,
        centroid,
        area: metrics.area,
        quality: { min_angle_deg: metrics.minAngle, aspect_ratio: metrics.aspect }
      });
    }
    const edgeOwners = new Map();
    cells.forEach((cell, ci) => {
      const v = cell.vertices;
      [[v[0],v[1]],[v[1],v[2]],[v[2],v[0]]].forEach(([a,b]) => {
        const k = edgeKey(a,b);
        if (!edgeOwners.has(k)) edgeOwners.set(k, []);
        edgeOwners.get(k).push(ci);
      });
    });
    for (const owners of edgeOwners.values()) {
      if (owners.length === 2) {
        const [a,b] = owners;
        cells[a].neighbors.push(b); cells[b].neighbors.push(a);
      }
    }
    return cells;
  }

  function sourceSignature(map, typeRegistry = window.MapEditorTypes) {
    const objectSnapshot = (map?.objects || []).map(obj => {
      const def = typeRegistry.getObjectType(obj.type);
      if (!def?.mesh?.participates) return null;
      if (def.geometry === 'polygon') return { id: obj.id, type: obj.type, points: obj.points };
      return { id: obj.id, type: obj.type, pos: obj.pos, radius: obj.radius };
    }).filter(Boolean).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const typeSnapshot = typeRegistry.listObjectTypes().map(d => ({ id:d.id, geometry:d.geometry, mesh:d.mesh })).sort((a,b)=>a.id.localeCompare(b.id));
    const attributeSnapshot = typeRegistry.listCellAttributes().sort((a,b)=>a.name.localeCompare(b.name));
    return `fnv1a32:${fnv1a(stableStringify({ bounds:[BOUND_MIN,BOUND_MAX], objects:objectSnapshot, types:typeSnapshot, cell_attributes:attributeSnapshot, mesh_schema:1 }))}`;
  }

  function generate(map, options = {}, typeRegistry = window.MapEditorTypes) {
    if (!map || !Array.isArray(map.objects)) throw new Error('Map is missing the objects array.');
    const spacing = Math.max(2, Math.min(64, Number(options.spacing ?? 20)));
    const raw = buildRawSegments(map.objects, typeRegistry);
    const planar = planarizeSegments(raw);
    const effective = semanticBoundaryFilter(planar, map.objects, typeRegistry);
    const geom = dedupeGeometry(effective);
    const maxCells = Math.max(200, Math.floor(Number(options.maxCells ?? 5000)));
    const provisionalMaxVertices = Math.max(100, Math.floor(maxCells / 2) - 8);
    const boundaryTarget = Math.max(1.25, Math.min(spacing, Number(options.boundarySpacing ?? spacing * 0.4)));
    const splitGeom = subdivideConstraints(geom.vertices, geom.constraints, boundaryTarget, provisionalMaxVertices);
    let points = addSteinerGrid(splitGeom.points, splitGeom.constraints, spacing);
    // If the regular grid itself approaches the budget, retain the constrained
    // boundary and let refinement spend the remaining budget selectively.
    if (points.length > provisionalMaxVertices) points = points.slice(0, provisionalMaxVertices);
    points = addBoundarySupportPoints(points, splitGeom.constraints, spacing, Math.min(2, Number(options.refinePasses ?? 1)));
    if (points.length > provisionalMaxVertices) points = points.slice(0, provisionalMaxVertices);
    let triangles = delaunay(points);
    triangles = recoverConstraints(points, triangles, splitGeom.constraints);
    triangles = sanitizeTriangles(points, triangles);
    const refined = refine(points, splitGeom.constraints, triangles, { ...options, maxCells });
    points = refined.points; triangles = sanitizeTriangles(refined.points, refined.triangles);
    const finalConstraints = refined.constraints;
    const cells = buildCells(points, triangles, map.objects, typeRegistry);
    const statsByType = {};
    for (const c of cells) statsByType[c.type] = (statsByType[c.type] || 0) + 1;
    const qualities = cells.map(c => c.quality.aspect_ratio).filter(Number.isFinite);
    const minAngles = cells.map(c => c.quality.min_angle_deg).filter(Number.isFinite);
    return {
      schema_version: 1,
      stale: false,
      source_signature: sourceSignature(map, typeRegistry),
      bounds: { min_x: BOUND_MIN, max_x: BOUND_MAX, min_y: BOUND_MIN, max_y: BOUND_MAX },
      generator: {
        algorithm: 'planarized PSLG + constraint subdivision + constrained Delaunay recovery + Ruppert/Chew-inspired quality refinement',
        spacing,
        min_angle_deg: Number(options.minAngle ?? 18),
        max_aspect_ratio: Number(options.maxAspect ?? 6),
        refine_passes: Number(options.refinePasses ?? 3),
        boundary_spacing: boundaryTarget,
        max_cells: maxCells,
        refinement_stats: refined.stats,
        jungle_spot_participates: false
      },
      vertices: points,
      cells,
      stats: {
        vertices: points.length,
        cells: cells.length,
        constraints: finalConstraints.length,
        boundary_vertices_inserted: splitGeom.inserted,
        by_type: statsByType,
        worst_aspect_ratio: qualities.length ? Math.max(...qualities) : null,
        min_angle_deg: minAngles.length ? Math.min(...minAngles) : null
      }
    };
  }

  window.MeshEngine = {
    generate,
    sourceSignature,
    classifyPoint,
    objectPolygon,
    pointInPolygonEvenOdd,
    _debug: { buildRawSegments, planarizeSegments, semanticBoundaryFilter, dedupeGeometry, subdivideConstraints, addSteinerGrid, delaunay, buildEdgeMap, triangleMetrics, sanitizeTriangles, refine },
    API_VERSION: 2
  };
})();
