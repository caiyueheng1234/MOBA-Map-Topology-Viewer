(() => {
  'use strict';
  const CONFIG = { centralitySamples: 32, clearanceScale: 12, chokeThreshold: .48,
    pointSpacing: 8, maxPointsPerKind: 80, chokeWeights: { centrality: .55, narrowness: .35, connectivity: .10 } };
  /** Undirected passable graph with arbitrary, stable cell IDs. */
  function buildPassableGraph(mesh) {
    const graph = new Map(mesh.cells.filter(c => c.attributes?.passable !== false).map(c => [c.id,new Set()]));
    for (const c of mesh.cells) if (graph.has(c.id)) for (const id of c.neighbors || []) if (id !== c.id && graph.has(id)) { graph.get(c.id).add(id); graph.get(id).add(c.id); }
    return new Map([...graph].map(([id,neighbors]) => [id,[...neighbors]]));
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

  const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  function segmentDistance(p,a,b) {
    const dx=b[0]-a[0], dy=b[1]-a[1], denom=dx*dx+dy*dy;
    const t=denom ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/denom)) : 0;
    return distance(p,[a[0]+t*dx,a[1]+t*dy]);
  }
  /** Geometry only. Iterative Tarjan + sampled unweighted Brandes; no canvas dependencies. */
  function compute(mesh, map, options = {}) {
    const config={...CONFIG,...options,chokeWeights:{...CONFIG.chokeWeights,...options.chokeWeights}};
    const graph=buildPassableGraph(mesh), ids=[...graph.keys()], cells=new Map(mesh.cells.map(c=>[c.id,c]));
    const metrics=Object.create(null), discovery=new Map(), low=new Map(), parent=new Map(), bridges=[], regions=[];
    let clock=0;
    for (const id of ids) metrics[id]={ degree:graph.get(id).length, articulation:false, centrality:0 };
    for (const root of ids) {
      if (discovery.has(root)) continue;
      const region={id:regions.length,cellIds:[]}; regions.push(region);
      const enter = id => { discovery.set(id,++clock); low.set(id,clock); metrics[id].componentId=region.id; region.cellIds.push(id); return {id,index:0,children:0}; };
      const stack=[enter(root)];
      while (stack.length) {
        const frame=stack[stack.length-1], u=frame.id, neighbors=graph.get(u);
        if (frame.index < neighbors.length) {
          const v=neighbors[frame.index++];
          if (!discovery.has(v)) { parent.set(v,u); frame.children++; stack.push(enter(v)); }
          else if (v !== parent.get(u)) low.set(u,Math.min(low.get(u),discovery.get(v)));
        } else {
          stack.pop();
          if (!parent.has(u)) metrics[u].articulation=frame.children>1;
          else { const p=parent.get(u); low.set(p,Math.min(low.get(p),low.get(u)));
            if (parent.has(p) && low.get(u)>=discovery.get(p)) metrics[p].articulation=true;
            if (low.get(u)>discovery.get(p)) bridges.push({fromCellId:p,toCellId:u});
          }
        }
      }
    }
    const samples=Math.min(ids.length,Math.max(1,config.centralitySamples));
    for (let sample=0;sample<samples;sample++) {
      const source=ids[Math.floor(sample*ids.length/samples)], queue=[source], order=[], dist=new Map([[source,0]]), sigma=new Map([[source,1]]), predecessors=new Map(), delta=new Map();
      for (let head=0;head<queue.length;head++) {
        const u=queue[head]; order.push(u);
        for (const v of graph.get(u)) {
          if (!dist.has(v)) { dist.set(v,dist.get(u)+1); queue.push(v); }
          if (dist.get(v)===dist.get(u)+1) { sigma.set(v,(sigma.get(v)||0)+sigma.get(u)); if (!predecessors.has(v)) predecessors.set(v,[]); predecessors.get(v).push(u); }
        }
      }
      for (const w of order.reverse()) { for (const v of predecessors.get(w)||[]) delta.set(v,(delta.get(v)||0)+(sigma.get(v)/sigma.get(w))*(1+(delta.get(w)||0))); if (w!==source) metrics[w].centrality+=delta.get(w)||0; }
    }
    let max=0; for (const id of ids) max=Math.max(max,metrics[id].centrality);
    // Boundary edges include obstacle interfaces and the outer map boundary.
    // Use exact local boundary distance as seeds, then centroid graph-distance propagation.
    const edgeOwners=new Map();
    for (const id of ids) { const verts=cells.get(id).vertices||[]; for(let i=0;i<verts.length;i++) { const a=verts[i],b=verts[(i+1)%verts.length],key=a<b?`${a}:${b}`:`${b}:${a}`; if(!edgeOwners.has(key)) edgeOwners.set(key,[]); edgeOwners.get(key).push({id,a,b}); } }
    const heap=new MinHeap(), clearance=new Map(ids.map(id=>[id,Infinity]));
    for(const owners of edgeOwners.values()) if(owners.length===1) { const {id,a,b}=owners[0]; const d=segmentDistance(cells.get(id).centroid,mesh.vertices[a],mesh.vertices[b]); if(d<clearance.get(id)) { clearance.set(id,d); heap.push([d,id]); } }
    while(heap.size) { const [d,u]=heap.pop(); if(d!==clearance.get(u)) continue; for(const v of graph.get(u)) { const nd=d+distance(cells.get(u).centroid,cells.get(v).centroid); if(nd<clearance.get(v)) { clearance.set(v,nd); heap.push([nd,v]); } } }
    const bridgeCells=new Set(bridges.flatMap(b=>[b.fromCellId,b.toCellId]));
    for(const id of ids) { const m=metrics[id]; m.centrality=max?m.centrality/max:0; m.clearance=clearance.get(id); m.narrowness=Number.isFinite(m.clearance)?1/(1+m.clearance/config.clearanceScale):0; m.connectivityImportance=m.articulation?1:bridgeCells.has(id)?.75:0; const w=config.chokeWeights; m.chokeScore=m.centrality*w.centrality+m.narrowness*w.narrowness+m.connectivityImportance*w.connectivity; }
    const criticalPoints=[];
    for(const kind of ['choke','junction','articulation','dead_end']) {
      const selected=[];
      const candidates=ids.filter(id=> { const m=metrics[id]; return kind==='choke'?m.chokeScore>=config.chokeThreshold:kind==='junction'?m.degree>=3&&m.centrality>.15:kind==='articulation'?m.articulation:m.degree<=1; }).sort((a,b)=>metrics[b].chokeScore-metrics[a].chokeScore);
      for(const id of candidates) { const position=cells.get(id).centroid; if(selected.some(p=>distance(p.position,position)<config.pointSpacing)) continue;
        selected.push({id:`${kind}_${id}`,kind,position:[...position],cellIds:[id],score:metrics[id].chokeScore,radius:3,label:`${kind} ${id}`,properties:{...metrics[id]}}); if(selected.length>=config.maxPointsPerKind) break;
      } criticalPoints.push(...selected);
    }
    const edges=[]; const index=new Map(ids.map((id,i)=>[id,i]));
    for(const [u,neighbors] of graph) for(const v of neighbors) if(index.get(u)<index.get(v)) edges.push({fromCellId:u,toCellId:v,from:cells.get(u).centroid,to:cells.get(v).centroid});
    return {nodes:ids.map(id=>({id,position:cells.get(id).centroid,score:metrics[id].chokeScore})),edges,regions,bridges,cellMetrics:metrics,criticalPoints,stats:{cells:ids.length,components:regions.length,bridges:bridges.length,articulations:ids.filter(id=>metrics[id].articulation).length,centralitySamples:samples}};
  }
  window.TopologyEngine={compute,buildPassableGraph,CONFIG};
})();
