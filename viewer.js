(() => {
  'use strict';

  const SCENE = 256;
  const SCENE_MIN = -128;
  const SCENE_MAX = 128;
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const DPR = () => window.devicePixelRatio || 1;
  let bgImage = null;

  const $ = id => document.getElementById(id);
  const controls = {
    opacity: $('opacity'), rotation: $('rotation'), offsetX: $('offsetX'), offsetY: $('offsetY'),
    uniformScale: $('uniformScale'), preScaleX: $('preScaleX'), preScaleY: $('preScaleY'),
    postScaleX: $('postScaleX'), postScaleY: $('postScaleY'),
    showMinorGrid: $('showMinorGrid'), showMajorGrid: $('showMajorGrid'), showLabels: $('showLabels'),
    showBackground: $('showBackground'), showTerrain: $('showTerrain'), showJungle: $('showJungle'), showTowers: $('showTowers'), showGrass: $('showGrass')
  };

  const state = {
    workingMap: null,
    editMode: false,
    mode: 'select', // select | add
    selectedId: null,
    hoveredId: null,
    viewZoom: 1,
    selectDraft: null,
    addDraft: {
      baseId: 'item',
      type: 'tower',
      mirror: false,
      center: false,
      pos: { x: 0, y: 0 },
      radius: 8,
      points: [[-8, -8], [8, -8], [0, 8]]
    },
    selectPointModes: [],
    addPointModes: ['absolute','absolute','absolute'],
    saveRootHandle: null,
    meshData: null,
    meshStale: true,
    meshStaleReason: 'No mesh generated',
    hoveredCellId: null,
    meshGenerating: false,
    activeTab: 'ioTab',
    visualRendererId: 'distance_field',
    visualSource: { x: 0, y: 0, valid: false, cellId: null, error: 'A valid mesh is required before the source can be validated.' },
    visualPickMode: true,
    visualResult: null,
    visualResultStale: false,
    visualResultStaleReason: '',
    flash: { ids: new Set(), until: 0, message: '' },
    canvasMessage: { text: '', until: 0 }
  };

  let gameManager = new GameObjectManager(), selectedGameId = null;
  let topologyMesh = null, topologyCache = null, strategicCache = null;
  function analysis() {
    if (!state.meshData || state.meshStale) return null;
    if (topologyMesh !== state.meshData) {
      topologyMesh = state.meshData;
      topologyCache = TopologyEngine.compute(state.meshData,state.workingMap);
      strategicCache = null;
    }
    if (!strategicCache) strategicCache = StrategicTopology.compute({mesh:state.meshData,topology:topologyCache,gameObjects:gameManager.getObjects()});
    return {topology:topologyCache,strategy:strategicCache};
  }
  function refreshGameList() {
    const list=$('gameList'); list.replaceChildren(new Option('New object',''));
    for(const o of gameManager.getObjects()) list.add(new Option(o.name,o.id));
    list.value=selectedGameId || '';
  }
  function selectGame(id) {
    selectedGameId=id || null; const o=gameManager.getObject(id); refreshGameList();
    if(o) {
      if(![...$('gameType').options].some(v=>v.value===o.type)) $('gameType').add(new Option(o.type,o.type));
      $('gameName').value=o.name; $('gameType').value=o.type; $('gamePriority').value=o.priority;
      $('gameRadius').value=o.influenceRadius; $('gameX').value=o.position[0]; $('gameY').value=o.position[1]; $('gameEnabled').checked=o.enabled;
    }
    render();
  }
  function gameChanged() {
    state.workingMap.gameObjects=gameManager.getObjects();
    strategicCache=null;
    if(state.visualRendererId==='topology' && state.visualResult) renderVisualization();
    refreshGameList(); render();
  }
  function handleGameClick(e) {
    if(!state.workingMap) return false;
    const p=canvasToScene(e.clientX,e.clientY);
    if(state.activeTab==='strategyTab' && $('gameTool').value==='place') {
      selectedGameId=null; refreshGameList(); $('gameX').value=p.x.toFixed(2); $('gameY').value=p.y.toFixed(2);
      $('gameStatus').textContent='Position chosen. Edit fields and Save.'; render(); return true;
    }
    if((state.activeTab==='strategyTab' || state.editMode && state.mode==='select') && $('gameVisible').checked) {
      const hit=gameManager.getObjects().reverse().find(o=>Math.hypot(o.position[0]-p.x,o.position[1]-p.y)*viewport().scale<14);
      if(hit) { setActiveTab('strategyTab'); selectGame(hit.id); return true; }
    }
    return false;
  }
  function marker(position,shape,size,color,label,selected=false) {
    const [x,y]=sceneToCanvas(...position); ctx.save(); ctx.translate(x,y); ctx.beginPath();
    if(shape==='square') ctx.rect(-size,-size,size*2,size*2);
    else if(shape==='diamond') {ctx.moveTo(0,-size*1.4);ctx.lineTo(size*1.4,0);ctx.lineTo(0,size*1.4);ctx.lineTo(-size*1.4,0);ctx.closePath();}
    else if(shape==='triangle') {ctx.moveTo(0,-size*1.4);ctx.lineTo(size,size);ctx.lineTo(-size,size);ctx.closePath();}
    else ctx.arc(0,0,size,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=selected?'#fff':'#172033';ctx.lineWidth=selected?3:1.5;ctx.stroke();
    if(label) {ctx.font='11px sans-serif';ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.strokeText(label,size+4,-size);ctx.fillStyle='#172033';ctx.fillText(label,size+4,-size);}
    ctx.restore();
  }
  function drawOverlayResult(result) {
    const overlays=result?.overlays || {};
    for(const region of overlays.regions || []) for(const polygon of region.polygons || []) drawPolygon(polygon,region.color || 'rgba(60,120,220,.12)',null);
    ctx.save();
    for(const edge of overlays.edges || []) {const a=sceneToCanvas(...edge.from),b=sceneToCanvas(...edge.to);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle=edge.color || 'rgba(30,100,130,.25)';ctx.lineWidth=edge.width || 1;ctx.stroke();}
    for(const p of overlays.points || []) marker(p.position,p.shape || 'circle',p.size || 5,p.color || '#f59e0b',p.label);
    for(const label of overlays.labels || []) {ctx.fillStyle=label.color || '#172033';ctx.font='11px sans-serif';ctx.fillText(label.text,...sceneToCanvas(...label.position));}
    ctx.restore();
  }
  function drawStrategicLayers() {
    const data=analysis();
    if(data) {
      const {topology:t,strategy:s}=data;
      $('topoStats').textContent=`${t.stats.cells} cells · ${t.stats.components} regions · ${t.stats.articulations} articulations · ${t.stats.bridges} bridges · ${t.stats.centralitySamples} centrality samples`;
      const overlays={regions:[],edges:[],points:[]};
      if($('topoRegions').checked) {const lookup=new Map(state.meshData.cells.map(c=>[c.id,c]));overlays.regions=t.regions.map(r=>({color:`hsla(${r.id*137.5%360},65%,50%,.14)`,polygons:r.cellIds.map(id=>lookup.get(id).vertices.map(v=>state.meshData.vertices[v]))}));}
      if($('topoGraph').checked) {
        const lookup=new Map(t.nodes.map(node=>[node.id,node]));overlays.edges=[...t.edges,...t.bridges.map(b=>({from:lookup.get(b.fromCellId).position,to:lookup.get(b.toCellId).position,color:'#c28c00',width:3}))];
      }
      const styles={choke:['circle','#f59e0b'],junction:['square','#22d3ee'],articulation:['diamond','#c084fc'],dead_end:['triangle','#94a3b8']};
      if($('topoPoints').checked) overlays.points=s.criticalPoints.map(p=>({position:p.position,shape:styles[p.kind][0],color:styles[p.kind][1],size:3+p.strategicScore*6,label:$('topoLabels').checked?`${p.label} ${p.strategicScore.toFixed(2)}`:''}));
      drawOverlayResult({overlays});
    } else $('topoStats').textContent='Generate a current mesh to analyze topology.';
    if(!state.visualResultStale && !state.meshStale) drawOverlayResult(state.visualResult);
    if($('gameVisible').checked) for(const o of gameManager.getObjects()) {
      if($('gameRings').checked && o.influenceRadius>0) {const [x,y]=sceneToCanvas(...o.position);ctx.save();ctx.beginPath();ctx.arc(x,y,o.influenceRadius*viewport().scale,0,Math.PI*2);ctx.fillStyle=o.enabled?'rgba(16,185,129,.06)':'rgba(100,100,100,.03)';ctx.fill();ctx.strokeStyle=o.enabled?'rgba(5,150,105,.4)':'#aaa';ctx.setLineDash([4,4]);ctx.stroke();ctx.restore();}
      const shape={tower:'square',major_objective:'diamond',base:'triangle'}[o.type] || 'circle';
      marker(o.position,shape,4+Math.min(1,o.priority/100)*7,o.enabled?'#10b981':'#9ca3af',$('topoLabels').checked?`${o.name} (${o.priority})`:'',o.id===selectedGameId);
    }
  }
  function initStrategy() {
    for(const type of GameObjectTypes.list()) $('gameType').add(new Option(type.name,type.id));
    $('gameType').value='generic';
    $('gameType').onchange=()=>{const type=GameObjectTypes.list().find(t=>t.id===$('gameType').value);if(!selectedGameId && type){$('gamePriority').value=type.defaultPriority;$('gameRadius').value=type.defaultRadius;}};
    $('gameList').onchange=()=>selectGame($('gameList').value);
    $('gameSave').onclick=()=>{
      if(!state.workingMap){$('gameStatus').textContent='Load a map first.';return;}
      const x=inputNumber('gameX'),y=inputNumber('gameY'),priority=inputNumber('gamePriority'),radius=inputNumber('gameRadius');
      if(![x,y,priority,radius].every(Number.isFinite)||Math.abs(x)>128||Math.abs(y)>128||priority<0||priority>100||radius<0){$('gameStatus').textContent='Enter valid coordinates (−128 to 128), priority (0–100), and radius (≥0).';return;}
      const patch={name:$('gameName').value,type:$('gameType').value,position:[x,y],priority,influenceRadius:radius,enabled:$('gameEnabled').checked};
      try {const o=selectedGameId?gameManager.updateObject(selectedGameId,patch):gameManager.addObject(patch);selectedGameId=o.id;gameChanged();$('gameStatus').textContent='Saved. Strategic scores updated; geometry and mesh unchanged.';}catch(err){$('gameStatus').textContent=err.message;}
    };
    $('gameDelete').onclick=()=>{if(selectedGameId){gameManager.removeObject(selectedGameId);selectedGameId=null;gameChanged();$('gameStatus').textContent='Deleted.';}};
    for(const id of ['topoGraph','topoRegions','topoPoints','gameVisible','gameRings','topoLabels']) $(id).onchange=render;
    MapVisualizers.registerRenderer({id:'centrality',label:'Route Centrality',description:'Sampled betweenness centrality on the passable graph.',requiresSource:false,compute:()=>({values:Object.fromEntries(Object.entries(analysis().topology.cellMetrics).map(([id,m])=>[id,m.centrality])),min:0,max:1}),legend:()=>({minLabel:'Low / 0',maxLabel:'High / 1'})});
    MapVisualizers.registerRenderer({id:'topology',label:'Strategic Importance',description:'Geometry-derived choke score combined with game-object influence. No source required.',requiresSource:false,compute:()=>({values:analysis().strategy.values,min:0,max:1}),legend:()=>({minLabel:'Low / 0',maxLabel:'High / 1'})});
  }

  function now() { return performance.now(); }
  function n(id, fallback = 0) {
    const v = Number($(id).value);
    return Number.isFinite(v) ? v : fallback;
  }
  function inputNumber(id) {
    const raw = $(id).value.trim();
    return raw === '' ? NaN : Number(raw);
  }
  function rawNumber(input) {
    const raw = input.value.trim();
    return raw === '' ? NaN : Number(raw);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function deepClone(x) {
    if (typeof structuredClone === 'function') return structuredClone(x);
    if (Array.isArray(x)) return x.map(deepClone);
    if (x && typeof x === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(x)) out[k] = deepClone(v);
      return out;
    }
    return x;
  }
  function typeDef(typeOrObj) {
    const id = typeof typeOrObj === 'string' ? typeOrObj : typeOrObj?.type;
    return window.MapEditorTypes?.getObjectType(id) || null;
  }
  function geometryOf(typeOrObj) { return typeDef(typeOrObj)?.geometry || null; }
  function meshSourceSignature() {
    return state.workingMap && window.MeshEngine ? MeshEngine.sourceSignature(state.workingMap, MapEditorTypes) : null;
  }
  function markMeshStale(reason = 'Map objects changed') {
    if (state.meshData) state.meshStale = true;
    state.meshStaleReason = reason;
    invalidateVisualization('Mesh is stale: ' + reason);
    updateMeshUI();
  }
  function serializableMap() {
    if (!state.workingMap) return null;
    const out = deepClone(state.workingMap);
    delete out.mesh;
    const sig = meshSourceSignature();
    if (state.meshData && !state.meshStale && state.meshData.source_signature === sig) {
      out.mesh = deepClone(state.meshData);
      out.mesh.stale = false;
    }
    return out;
  }
  function setStatus(text) { $('status').textContent = text; }
  function setCanvasMessage(text, ms = 2000) {
    const until = now() + ms;
    state.canvasMessage = { text, until };
    render();
    setTimeout(() => { if (state.canvasMessage.until === until) render(); }, ms + 30);
  }

  function updateCounts() {
    const el = $('objectCounts');
    if (!state.workingMap || !Array.isArray(state.workingMap.objects)) {
      el.innerHTML = '<div>Not loaded</div><div>—</div>';
      return;
    }
    const counts = new Map();
    for (const def of MapEditorTypes.listObjectTypes()) counts.set(def.id, 0);
    for (const o of state.workingMap.objects) counts.set(o.type, (counts.get(o.type) || 0) + 1);
    let html = '';
    for (const [k,v] of counts.entries()) html += `<div>${k}</div><div>${v}</div>`;
    html += `<div><strong>Total</strong></div><div><strong>${state.workingMap.objects.length}</strong></div>`;
    el.innerHTML = html;
  }

  function ensureCanvasSize() {
    // Resize only the backing store. Never write inline CSS width/height here:
    // doing so creates a layout feedback loop in a flex container and was the
    // source of the small spontaneous drift/stretch seen in v0.2.
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const dpr = DPR();
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function viewport() {
    const w = canvas.width / DPR();
    const h = canvas.height / DPR();
    const size = Math.min(w, h) * state.viewZoom;
    return {
      w, h, size,
      scale: size / SCENE,
      ox: (w - size) / 2,
      oy: (h - size) / 2
    };
  }
  function sceneToCanvas(x, y) {
    const v = viewport();
    return [v.ox + (x - SCENE_MIN) * v.scale, v.oy + (y - SCENE_MIN) * v.scale];
  }
  function canvasToScene(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const v = viewport();
    const x = (clientX - r.left - v.ox) / v.scale + SCENE_MIN;
    const y = (clientY - r.top - v.oy) / v.scale + SCENE_MIN;
    return { x, y };
  }

  function regularOctagon(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 8 + i * Math.PI / 4;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }
  function centroid(points) {
    if (!points || !points.length) return [0, 0];
    let sx = 0, sy = 0;
    for (const [x, y] of points) { sx += Number(x); sy += Number(y); }
    return [sx / points.length, sy / points.length];
  }
  function representativePoint(obj) {
    if (geometryOf(obj) === 'polygon') {
      return obj.points?.length ? [Number(obj.points[0][0]), Number(obj.points[0][1])] : centroid(obj.points || []);
    }
    return [Number(obj.pos?.x || 0), Number(obj.pos?.y || 0)];
  }

  function drawPolygon(points, fill, stroke, width = 1.2, dash = null) {
    if (!points || points.length < 3) return;
    ctx.beginPath();
    const [x0, y0] = sceneToCanvas(points[0][0], points[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = sceneToCanvas(points[i][0], points[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBackground() {
    if (!bgImage || !controls.showBackground.checked) return;
    const opacity = n('opacity', 0.45);
    const angle = n('rotation', 0) * Math.PI / 180;
    const dx = n('offsetX', 0), dy = n('offsetY', 0);
    const s = Math.max(1e-6, n('uniformScale', 1));
    const preX = Math.max(1e-6, n('preScaleX', 1));
    const preY = Math.max(1e-6, n('preScaleY', 1));
    const postX = Math.max(1e-6, n('postScaleX', 1));
    const postY = Math.max(1e-6, n('postScaleY', 1));
    const baseW = SCENE;
    const baseH = SCENE * bgImage.height / bgImage.width;
    const pxPerScene = viewport().scale;
    const [cx, cy] = sceneToCanvas(dx, dy);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(cx, cy);
    ctx.scale(postX, postY);
    ctx.rotate(angle);
    ctx.scale(s * preX, s * preY);
    ctx.drawImage(bgImage, -baseW * pxPerScene / 2, -baseH * pxPerScene / 2, baseW * pxPerScene, baseH * pxPerScene);
    ctx.restore();
  }

  function drawGrid() {
    const minor = controls.showMinorGrid.checked;
    const major = controls.showMajorGrid.checked;
    if (!minor && !major) return;
    const v = viewport();
    if (minor) {
      ctx.strokeStyle = 'rgba(15,23,42,.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 64; i++) {
        if (i % 16 === 0 && major) continue;
        const u = SCENE_MIN + i * 4;
        const [x] = sceneToCanvas(u, 0);
        const [, y] = sceneToCanvas(0, u);
        ctx.beginPath(); ctx.moveTo(x, Math.min(v.oy, v.oy + v.size)); ctx.lineTo(x, Math.max(v.oy, v.oy + v.size)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(Math.min(v.ox, v.ox + v.size), y); ctx.lineTo(Math.max(v.ox, v.ox + v.size), y); ctx.stroke();
      }
    }
    if (major) {
      ctx.strokeStyle = 'rgba(15,23,42,.78)';
      ctx.lineWidth = 2.2;
      [SCENE_MIN, -64, 0, 64, SCENE_MAX].forEach(u => {
        const [x] = sceneToCanvas(u, 0);
        const [, y] = sceneToCanvas(0, u);
        ctx.beginPath(); ctx.moveTo(x, v.oy); ctx.lineTo(x, v.oy + v.size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(v.ox, y); ctx.lineTo(v.ox + v.size, y); ctx.stroke();
      });
    }
  }

  function objectVisible(obj) {
    return (obj.type === 'impassable_terrain' && controls.showTerrain.checked)
      || (obj.type === 'jungle_spot' && controls.showJungle.checked)
      || (obj.type === 'tower' && controls.showTowers.checked)
      || (obj.type === 'grass' && controls.showGrass.checked)
      || (!['impassable_terrain','jungle_spot','tower','grass'].includes(obj.type));
  }

  function objectStyle(obj, role = 'normal') {
    const def = typeDef(obj);
    const base = def ? { fill: def.display.fill, stroke: def.display.stroke } : { fill:'rgba(100,116,139,.45)', stroke:'rgba(51,65,85,.95)' };
    if (role === 'hover') return { fill: brighten(base.fill, 0.12), stroke: brighten(base.stroke, 0.08) };
    if (role === 'selected') return { fill: brighten(base.fill, 0.22), stroke: '#ffffff' };
    if (role === 'preview') return { fill: brighten(base.fill, 0.26), stroke: '#ffffff', dash: [6, 4] };
    return base;
  }

  function brighten(rgba, amt) {
    const m = rgba.match(/rgba?\(([^)]+)\)/);
    if (!m) return rgba;
    const parts = m[1].split(',').map(v => v.trim());
    let [r, g, b, a] = parts.map(Number);
    if (!Number.isFinite(a)) a = 1;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return `rgba(${r},${g},${b},${a})`;
  }

  function drawLabel(obj, p) {
    if (!controls.showLabels.checked || !p) return;
    const [x, y] = sceneToCanvas(p[0], p[1]);
    ctx.save();
    ctx.font = `${Math.max(10, Math.min(15, viewport().scale * .7))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.strokeText(obj.id || '?', x, y);
    ctx.fillStyle = '#111827';
    ctx.fillText(obj.id || '?', x, y);
    ctx.restore();
  }

  function drawObject(obj, role = 'normal') {
    if (!objectVisible(obj)) return;
    const style = objectStyle(obj, role);
    if (geometryOf(obj) === 'polygon') {
      drawPolygon(obj.points, style.fill, style.stroke, role === 'selected' ? 2.4 : 1.4, style.dash || null);
      drawLabel(obj, centroid(obj.points));
    } else {
      const p = obj.pos || { x: 0, y: 0 };
      drawPolygon(regularOctagon(Number(p.x), Number(p.y), Number(obj.radius)), style.fill, style.stroke, role === 'selected' ? 2.4 : 1.4, style.dash || null);
      drawLabel(obj, [Number(p.x), Number(p.y)]);
    }
  }

  function getObjectById(id, arr = state.workingMap?.objects || []) {
    return arr.find(o => o.id === id) || null;
  }
  function getGroupMembers(groupId, arr = state.workingMap?.objects || []) {
    return arr.filter(o => o.group_id && o.group_id === groupId);
  }

  function validateLoadedMap(data) {
    if (!data || typeof data !== 'object') throw new Error('The top level of the JSON must be an object.');
    if (!Array.isArray(data.objects)) throw new Error('Missing objects array.');
    const ids = new Set();
    for (const o of data.objects) {
      validateObject(o, { allowMissingIdSet: false });
      if (ids.has(o.id)) throw new Error(`Duplicate id: ${o.id}`);
      ids.add(o.id);
    }
    return true;
  }

  function validateObject(obj, options = {}) {
    if (!obj || typeof obj !== 'object') throw new Error('Invalid object.');
    const def = typeDef(obj);
    if (!def) throw new Error(`Unknown object type: ${obj.type}`);
    if (typeof obj.id !== 'string' || !obj.id.trim()) throw new Error('id must be a non-empty string.');
    if (def.geometry === 'polygon') {
      if (!Array.isArray(obj.points) || obj.points.length < 3) throw new Error(`${obj.id}: points must contain at least 3 points.`);
      obj.points.forEach((p, i) => {
        if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1]))) {
          throw new Error(`${obj.id}: Point ${i + 1} is invalid.`);
        }
      });
    } else if (def.geometry === 'radial_octagon') {
      if (!obj.pos || !Number.isFinite(Number(obj.pos.x)) || !Number.isFinite(Number(obj.pos.y))) throw new Error(`${obj.id}: pos is invalid.`);
      if (!(Number(obj.radius) > 0)) throw new Error(`${obj.id}: radius must be > 0.`);
    }
    return true;
  }

  function applyMap(data, source = 'JSON', options = {}) {
    data = { ...data, objects: data.objects || [] };
    validateLoadedMap(data);
    const incoming = deepClone(data);
    const incomingMesh = incoming.mesh || null;
    delete incoming.mesh;
    state.workingMap = incoming;
    gameManager = new GameObjectManager(incoming.gameObjects);
    incoming.gameObjects = gameManager.getObjects();
    selectedGameId = null; strategicCache = null; refreshGameList();

    if (options.loadMesh) {
      state.meshData = incomingMesh;
      if (incomingMesh && incomingMesh.stale !== true && incomingMesh.source_signature === MeshEngine.sourceSignature(state.workingMap, MapEditorTypes)) {
        state.meshStale = false;
        state.meshStaleReason = '';
      } else if (incomingMesh) {
        state.meshStale = true;
        state.meshStaleReason = 'The saved mesh does not match the current map signature or was marked stale';
      } else {
        state.meshData = null;
        state.meshStale = true;
        state.meshStaleReason = 'This map does not contain a mesh';
      }
    } else if (options.mapChanged) {
      markMeshStale(options.staleReason || 'Map objects changed');
    }

    const counts = {};
    state.workingMap.objects.forEach(o => counts[o.type] = (counts[o.type] || 0) + 1);
    setStatus(`${source} loaded
${Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(' · ')}`);
    updateCounts();
    updateMeshUI();
    state.visualResult = null;
    state.visualResultStale = false;
    state.visualResultStaleReason = '';
    if ($('visualSourceX') && $('visualSourceY')) validateVisualSourceFromUI();
    if (state.selectedId && !getObjectById(state.selectedId)) state.selectedId = null;
    if (state.selectedId) loadSelectedIntoDraft();
    updateSelectionInfo();
    render();
  }

  async function loadJsonUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyMap(await res.json(), url, { loadMesh: true });
  }
  function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const im = new Image();
      im.onload = () => { bgImage = im; render(); };
      im.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  function loadImageUrl(url) {
    const im = new Image();
    im.onload = () => { bgImage = im; render(); };
    im.onerror = () => setStatus(`Unable to load background image ${url}; if opened via file://, use “Import Image”.`);
    im.src = url;
  }

  function applyReferencePreset() {
    $('opacity').value = 0.45;
    $('rotation').value = 0;
    $('offsetX').value = 1.333333;
    $('offsetY').value = 0.380952;
    $('uniformScale').value = 1.058035714;
    $('preScaleX').value = 1;
    $('preScaleY').value = 1;
    $('postScaleX').value = 1;
    $('postScaleY').value = 1;
    render();
  }
  function resetTransform() {
    ['offsetX', 'offsetY', 'rotation'].forEach(id => $(id).value = 0);
    ['uniformScale', 'preScaleX', 'preScaleY', 'postScaleX', 'postScaleY'].forEach(id => $(id).value = 1);
    $('opacity').value = 0.45;
    render();
  }
  function exportCurrentJson() {
    if (!state.workingMap) { setStatus('There is no map JSON to export.'); return; }
    const blob = new Blob([JSON.stringify(serializableMap(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'map_export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function normalizedSaveName() {
    const raw = $('saveMapName').value.trim().replace(/\.json$/i, '');
    if (!raw) throw new Error('Map name cannot be empty.');
    if (/[\\/:*?"<>|]/.test(raw)) throw new Error('Map name contains characters not allowed by the file system.');
    return raw;
  }

  async function chooseSaveRoot() {
    if (!window.showDirectoryPicker) {
      throw new Error('This browser does not support the directory write API. Open the editor in Chromium, Chrome, or Edge.');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.saveRootHandle = handle;
    $('saveFolderStatus').textContent = `Selected root folder: ${handle.name}; maps will be written to its saves/ subfolder.`;
    return handle;
  }

  async function saveToProjectFolder() {
    try {
      if (!state.workingMap) throw new Error('There is no map to save.');
      const name = normalizedSaveName();
      const root = state.saveRootHandle || await chooseSaveRoot();
      const permission = root.queryPermission ? await root.queryPermission({ mode: 'readwrite' }) : 'granted';
      if (permission !== 'granted' && root.requestPermission) {
        const granted = await root.requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') throw new Error('Folder write permission was not granted.');
      }
      const saves = await root.getDirectoryHandle('saves', { create: true });
      const fileHandle = await saves.getFileHandle(`${name}.json`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(serializableMap(), null, 2) + '\n');
      await writable.close();
      $('saveFolderStatus').textContent = `Saved: ${root.name}/saves/${name}.json (existing file overwritten if present)`;
      setCanvasMessage(`Saved ${name}.json`, 1400);
    } catch (err) {
      $('saveFolderStatus').textContent = `Save failed: ${err.message}`;
      setCanvasMessage(`Save failed: ${err.message}`, 2200);
    }
  }

  function setActiveTab(id) {
    state.activeTab = id;
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === id));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === id));
    if (id === 'visualTab') updateVisualizationUI();
    render();
  }

  function toggleEditMode() {
    state.editMode = !state.editMode;
    $('editFieldset').disabled = !state.editMode;
    $('toggleAddBtn').disabled = !state.editMode;
    $('toggleEditBtn').textContent = state.editMode ? 'Pause Edit Mode' : 'Enable Edit Mode';
    updateEditPanels();
    updateSelectionInfo();
    render();
  }

  function updateEditPanels() {
    $('selectModePanel').classList.toggle('hidden', state.mode !== 'select');
    $('addModePanel').classList.toggle('hidden', state.mode !== 'add');
    $('toggleAddBtn').textContent = state.mode === 'add' ? 'Return to Default Edit Mode' : 'Add';
    const summary = !state.editMode ? 'Current mode: disabled'
      : state.mode === 'add' ? 'Current mode: add object'
      : 'Current mode: edit existing object';
    $('editSummary').textContent = summary;
    syncDraftToUI();
    updateFormHint();
  }

  function toggleAddMode() {
    if (!state.editMode) return;
    state.mode = state.mode === 'add' ? 'select' : 'add';
    updateEditPanels();
    render();
  }

  function updateSelectionInfo() {
    const info = $('selectionInfo');
    if (!state.selectedId) {
      info.textContent = 'No object selected.';
      $('dissolveGroupBtn').disabled = true;
      $('reloadSelectedBtn').disabled = true;
      return;
    }
    const obj = getObjectById(state.selectedId);
    if (!obj) {
      info.textContent = 'The selected object no longer exists.';
      return;
    }
    const groupText = obj.group_id ? `; group: ${obj.group_id}` : '; ungrouped';
    info.textContent = `Current selection: ${obj.id}（${obj.type}）${groupText}`;
    $('dissolveGroupBtn').disabled = !obj.group_id;
    $('reloadSelectedBtn').disabled = false;
  }

  function blankSelectDraftFromObject(obj) {
    const draft = deepClone(obj);
    if (geometryOf(draft.type) === 'polygon') {
      draft.points = (draft.points || []).map(p => [Number(p[0]), Number(p[1])]);
    } else {
      draft.pos = { x: Number(draft.pos.x), y: Number(draft.pos.y) };
      draft.radius = Number(draft.radius);
    }
    return draft;
  }

  function loadSelectedIntoDraft() {
    const obj = getObjectById(state.selectedId);
    state.selectDraft = obj ? blankSelectDraftFromObject(obj) : null;
    state.selectPointModes = geometryOf(state.selectDraft) === 'polygon' ? state.selectDraft.points.map(() => 'absolute') : [];
    syncDraftToUI();
    updateSelectionInfo();
    updateFormHint();
  }

  function syncDraftToUI() {
    const d = state.selectDraft;
    if (d) {
      $('editObjectId').value = d.id || '';
      $('editObjectType').value = d.type || 'tower';
      if (geometryOf(d.type) === 'polygon') {
        $('editPolygonFields').classList.remove('hidden');
        $('editCircleFields').classList.add('hidden');
        renderPointsList('editPointsList', d.points || [], 'edit', state.selectPointModes);
      } else {
        $('editPolygonFields').classList.add('hidden');
        $('editCircleFields').classList.remove('hidden');
        $('editPosX').value = d.pos?.x ?? '';
        $('editPosY').value = d.pos?.y ?? '';
        $('editRadius').value = d.radius ?? '';
      }
      $('editGroupInfo').textContent = d.group_id ? `Current object belongs to group ${d.group_id}. If “Adjust Grouped Objects” is checked, preview and apply will update geometry/type state for all group members.` : 'Current object is not grouped.';
    } else {
      $('editObjectId').value = '';
      $('editObjectType').value = 'tower';
      renderPointsList('editPointsList', [], 'edit', state.selectPointModes);
      $('editPosX').value = '';
      $('editPosY').value = '';
      $('editRadius').value = '';
      $('editGroupInfo').textContent = 'Current object is not grouped.';
    }

    const a = state.addDraft;
    $('addBaseId').value = a.baseId;
    $('addObjectType').value = a.type;
    $('addMirrorSymmetry').checked = a.mirror;
    $('addCenterSymmetry').checked = a.center;
    if (geometryOf(a.type) === 'polygon') {
      $('addPolygonFields').classList.remove('hidden');
      $('addCircleFields').classList.add('hidden');
      renderPointsList('addPointsList', a.points || [], 'add', state.addPointModes);
    } else {
      $('addPolygonFields').classList.add('hidden');
      $('addCircleFields').classList.remove('hidden');
      $('addPosX').value = a.pos?.x ?? 0;
      $('addPosY').value = a.pos?.y ?? 0;
      $('addRadius').value = a.radius ?? 8;
    }
  }

  function renderPointsList(containerId, points, mode, modes = []) {
    const container = $(containerId);
    container.innerHTML = '';
    const normalizedModes = points.map((_, idx) => idx === 0 ? 'absolute' : (modes[idx] || 'absolute'));
    if (mode === 'edit') state.selectPointModes = normalizedModes;
    else state.addPointModes = normalizedModes;

    points.forEach((p, idx) => {
      const pointMode = normalizedModes[idx];
      const prev = idx > 0 ? points[idx - 1] : [0, 0];
      const displayX = pointMode === 'offset' ? Number(p[0]) - Number(prev[0]) : Number(p[0]);
      const displayY = pointMode === 'offset' ? Number(p[1]) - Number(prev[1]) : Number(p[1]);
      const row = document.createElement('div');
      row.className = 'point-row';
      const modeSelect = idx === 0
        ? '<select disabled><option>Absolute Coordinates</option></select>'
        : `<select class="point-mode-select" data-point-mode="${mode}" data-idx="${idx}"><option value="absolute" ${pointMode === 'absolute' ? 'selected' : ''}>Absolute Coordinates</option><option value="offset" ${pointMode === 'offset' ? 'selected' : ''}>Offset</option></select>`;
      const xName = pointMode === 'offset' ? 'ΔX' : 'X';
      const yName = pointMode === 'offset' ? 'ΔY' : 'Y';
      row.innerHTML = `
        <label class="point-mode"><span class="mini-label">Point ${idx + 1} / Definition</span>${modeSelect}</label>
        <label><span class="mini-label">${xName}</span><input data-point-value="${mode}" data-idx="${idx}" data-axis="x" type="number" step="0.1" value="${displayX}"></label>
        <label><span class="mini-label">${yName}</span><input data-point-value="${mode}" data-idx="${idx}" data-axis="y" type="number" step="0.1" value="${displayY}"></label>
        <button class="insert-point-btn" data-insert-point="${mode}" data-idx="${idx}">Insert Point After</button>
        <button class="remove-point-btn" data-remove-point="${mode}" data-idx="${idx}">Delete</button>
      `;
      container.appendChild(row);
    });
  }

  function readSelectDraftFromUI() {
    if (!state.selectedId || !state.selectDraft) return null;
    const draft = deepClone(state.selectDraft);
    draft.id = $('editObjectId').value.trim();
    draft.type = $('editObjectType').value;
    if (geometryOf(draft.type) === 'polygon') {
      draft.points = gatherPointsFromUI('editPointsList', state.selectPointModes);
      delete draft.pos; delete draft.radius;
    } else {
      draft.pos = { x: inputNumber('editPosX'), y: inputNumber('editPosY') };
      draft.radius = inputNumber('editRadius');
      delete draft.points;
    }
    return draft;
  }

  function readAddDraftFromUI() {
    const draft = deepClone(state.addDraft);
    draft.baseId = $('addBaseId').value.trim();
    draft.type = $('addObjectType').value;
    draft.mirror = $('addMirrorSymmetry').checked;
    draft.center = $('addCenterSymmetry').checked;
    if (geometryOf(draft.type) === 'polygon') {
      draft.points = gatherPointsFromUI('addPointsList', state.addPointModes);
    } else {
      draft.pos = { x: inputNumber('addPosX'), y: inputNumber('addPosY') };
      draft.radius = inputNumber('addRadius');
    }
    state.addDraft = deepClone(draft);
    return draft;
  }

  function gatherPointsFromUI(containerId, modes = []) {
    const rows = [...$(containerId).querySelectorAll('.point-row')];
    const out = [];
    rows.forEach((row, idx) => {
      const xInput = row.querySelector('input[data-axis="x"]');
      const yInput = row.querySelector('input[data-axis="y"]');
      const xv = rawNumber(xInput), yv = rawNumber(yInput);
      const mode = idx === 0 ? 'absolute' : (modes[idx] || 'absolute');
      if (mode === 'offset') {
        const prev = out[idx - 1] || [NaN, NaN];
        out.push([Number(prev[0]) + xv, Number(prev[1]) + yv]);
      } else {
        out.push([xv, yv]);
      }
    });
    return out;
  }

  function pointOfDraftShape(draft) {
    if (!draft) return [0, 0];
    if (geometryOf(draft) === 'polygon') return draft.points?.[0] || [0, 0];
    return [Number(draft.pos?.x || 0), Number(draft.pos?.y || 0)];
  }

  function applyMirrorToPoint([x, y]) { return [y, x]; }
  function applyCenterToPoint([x, y]) { return [-Number(x), -Number(y)]; }
  function applyOpsToPoint(pt, ops = []) {
    let p = [Number(pt[0]), Number(pt[1])];
    for (const op of ops) {
      if (op === 'mirror') p = applyMirrorToPoint(p);
      else if (op === 'center') p = applyCenterToPoint(p);
    }
    return p;
  }
  function applyOpsToObject(obj, ops = []) {
    const out = deepClone(obj);
    if (geometryOf(out) === 'polygon') {
      out.points = out.points.map(p => applyOpsToPoint(p, ops));
    } else {
      const [x, y] = applyOpsToPoint([Number(out.pos.x), Number(out.pos.y)], ops);
      out.pos = { x, y };
    }
    out.symmetry_ops = [...ops];
    return out;
  }
  function toggleOps(ops, op) {
    const s = new Set(ops);
    if (s.has(op)) s.delete(op); else s.add(op);
    return [...s].sort();
  }

  function directionSuffix(pt) {
    const x = Number(pt[0]), y = Number(pt[1]);
    const dx = x, dy = y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'top';
  }
  function blueRedSuffix(pt) {
    const x = Number(pt[0]), y = Number(pt[1]);
    return y >= x ? 'blue' : 'red';
  }

  function createPreviewAddObjects() {
    const d = readAddDraftFromUI();
    const seed = { type: d.type, id: d.baseId, points: geometryOf(d.type) === 'polygon' ? d.points : undefined, pos: geometryOf(d.type) !== 'polygon' ? d.pos : undefined, radius: geometryOf(d.type) !== 'polygon' ? d.radius : undefined };
    if (!d.baseId) throw new Error('Base name cannot be empty.');
    validateObject(seed);
    const opsList = [[]];
    if (d.mirror) opsList.push(['mirror']);
    if (d.center) opsList.push(['center']);
    if (d.mirror && d.center) opsList.push(['center', 'mirror']);

    const groupId = opsList.length > 1 ? `${d.baseId}_group_${Date.now()}` : null;
    const transformed = opsList.map(ops => ({ ops: ops.slice().sort(), obj: applyOpsToObject(seed, ops) }));

    // Direction names are normally derived from the nearest map edge. On exact
    // diagonal/tie cases we use the symmetry operation as the tie-breaker so a
    // 4-member orbit can never collapse to duplicate names such as item_left.
    const used = new Set();
    const allDirs = ['left', 'down', 'top', 'right'];
    function preferredDirection(entry) {
      const [x, y] = representativePoint(entry.obj).map(Number);
      const ax = Math.abs(x), ay = Math.abs(y);
      if (ax > ay) return x >= 0 ? 'right' : 'left';
      if (ay > ax) return y >= 0 ? 'down' : 'top';
      const hasMirror = entry.ops.includes('mirror');
      if (hasMirror) return y >= 0 ? 'down' : 'top';
      return x >= 0 ? 'right' : 'left';
    }

    const result = transformed.map(entry => {
      const obj = entry.obj;
      const refPt = representativePoint(obj);
      let suffix;
      if (d.mirror && d.center) {
        const pref = preferredDirection(entry);
        suffix = !used.has(pref) ? pref : allDirs.find(x => !used.has(x));
        used.add(suffix);
        obj.id = `${d.baseId}_${suffix}`;
      } else if (d.center && !d.mirror) {
        obj.id = `${d.baseId}_${blueRedSuffix(refPt)}`;
      } else if (d.mirror && !d.center) {
        const pref = preferredDirection(entry);
        suffix = !used.has(pref) ? pref : allDirs.find(x => !used.has(x));
        used.add(suffix);
        obj.id = `${d.baseId}_${suffix}`;
      } else {
        obj.id = d.baseId;
      }
      if (groupId) {
        obj.group_id = groupId;
        obj.symmetry_ops = entry.ops.slice();
      }
      return obj;
    });
    return result;
  }

  function getPreviewState() {
    const baseObjects = deepClone(state.workingMap?.objects || []);
    const preview = { objects: baseObjects, invalid: false, invalidMsg: '', highlightIds: [], previewNewIds: [], previewConflictIds: [] };
    if (!state.editMode || !state.workingMap) return preview;

    try {
      if (state.mode === 'select' && state.selectedId) {
        const draft = readSelectDraftFromUI();
        validateObject(draft);
        preview.highlightIds = [state.selectedId];
        const idx = preview.objects.findIndex(o => o.id === state.selectedId);
        if (idx >= 0) preview.objects[idx] = deepClone(draft);
        if (draft.group_id && $('adjustGrouped').checked) {
          const members = getGroupMembers(draft.group_id);
          const selectedOps = getObjectById(state.selectedId)?.symmetry_ops || [];
          const canonical = applyOpsToObject(draft, selectedOps); // inverse equals self for current ops set
          for (const member of members) {
            if (member.id === state.selectedId) continue;
            const ops = member.symmetry_ops || [];
            const transformed = applyOpsToObject(canonical, ops);
            transformed.id = member.id;
            transformed.group_id = member.group_id;
            transformed.symmetry_ops = ops.slice();
            const mi = preview.objects.findIndex(o => o.id === member.id);
            if (mi >= 0) preview.objects[mi] = transformed;
            preview.highlightIds.push(member.id);
          }
        }
      } else if (state.mode === 'add') {
        const added = createPreviewAddObjects();
        preview.objects.push(...deepClone(added));
        preview.highlightIds = added.map(o => o.id);
        preview.previewNewIds = added.map(o => o.id);
      }
    } catch (err) {
      preview.invalid = true;
      preview.invalidMsg = err.message;
    }
    return preview;
  }

  function maybeDuplicateConflict(objects, targetIds) {
    const buckets = new Map();
    for (const o of objects) {
      if (!buckets.has(o.id)) buckets.set(o.id, []);
      buckets.get(o.id).push(o.id);
    }
    const duplicates = new Set();
    for (const [id, list] of buckets.entries()) if (list.length > 1) duplicates.add(id);
    return [...duplicates].filter(id => targetIds.includes(id));
  }

  function flashDuplicate(ids, message) {
    state.flash.ids = new Set(ids);
    state.flash.until = now() + 2000;
    state.flash.message = message;
    const tick = () => {
      render();
      if (now() < state.flash.until) setTimeout(tick, 250);
      else { state.flash.ids.clear(); render(); }
    };
    tick();
  }

  function applyCurrentEdit() {
    if (!state.editMode || !state.workingMap) return;
    const objects = deepClone(state.workingMap.objects);
    try {
      if (state.mode === 'select') {
        if (!state.selectedId) {
          setCanvasMessage('No object is currently selected.', 1600);
          return;
        }
        const draft = readSelectDraftFromUI();
        validateObject(draft);
        const idx = objects.findIndex(o => o.id === state.selectedId);
        if (idx < 0) throw new Error('The selected object does not exist.');
        objects[idx] = deepClone(draft);

        if (draft.id !== state.selectedId && objects.some((o, i) => i !== idx && o.id === draft.id)) {
          $('editFormHint').textContent = `"${draft.id}"  duplicates an existing name; please rename it`;
          flashDuplicate([draft.id, ...objects.filter((o, i) => i !== idx && o.id === draft.id).map(o => o.id)], `"${draft.id}"  duplicates an existing name; please rename it`);
          return;
        }

        if (draft.group_id && $('adjustGrouped').checked) {
          const members = getGroupMembers(draft.group_id, objects);
          const selectedOps = getObjectById(state.selectedId, state.workingMap.objects)?.symmetry_ops || [];
          const canonical = applyOpsToObject(draft, selectedOps);
          for (const member of members) {
            if (member.id === state.selectedId) continue;
            const mi = objects.findIndex(o => o.id === member.id);
            if (mi < 0) continue;
            const ops = member.symmetry_ops || [];
            const transformed = applyOpsToObject(canonical, ops);
            transformed.id = member.id;
            transformed.group_id = member.group_id;
            transformed.symmetry_ops = ops.slice();
            objects[mi] = transformed;
          }
        }
        state.workingMap.objects = objects;
        state.selectedId = draft.id;
        loadSelectedIntoDraft();
      } else if (state.mode === 'add') {
        const added = createPreviewAddObjects();
        const existingIds = new Set(objects.map(o => o.id));
        const dup = [];
        for (const o of added) if (existingIds.has(o.id)) dup.push(o.id);
        const selfDup = maybeDuplicateConflict(added, added.map(o => o.id));
        const allDup = [...new Set([...dup, ...selfDup])];
        if (allDup.length) {
          $('editFormHint').textContent = `"${allDup[0]}"  duplicates an existing name; please rename it`;
          flashDuplicate(allDup, `"${allDup[0]}"  duplicates an existing name; please rename it`);
          return;
        }
        objects.push(...deepClone(added));
        state.workingMap.objects = objects;
      }
      applyMap(state.workingMap, 'Workspace', { mapChanged: true, staleReason: 'Map objects edited or added' });
      setCanvasMessage('Changes applied.', 1000);
    } catch (err) {
      $('editFormHint').textContent = `Invalid parameters; please correct them: ${err.message}`;
      setCanvasMessage('Invalid parameters; please correct them', 2000);
    }
  }

  function dissolveGroup() {
    const obj = getObjectById(state.selectedId);
    if (!obj || !obj.group_id) return;
    for (const member of state.workingMap.objects) {
      if (member.group_id === obj.group_id) {
        delete member.group_id;
        delete member.symmetry_ops;
      }
    }
    applyMap(state.workingMap, 'Workspace');
    loadSelectedIntoDraft();
    setCanvasMessage('The selected object has been removed from its group.', 1200);
  }

  function deleteSelectedObject() {
    if (!state.workingMap || !state.selectedId) {
      setCanvasMessage('No object is currently selected.', 1400);
      return;
    }
    const id = state.selectedId;
    const before = state.workingMap.objects.length;
    state.workingMap.objects = state.workingMap.objects.filter(o => o.id !== id);
    if (state.workingMap.objects.length === before) return;
    state.selectedId = null;
    state.selectDraft = null;
    state.selectPointModes = [];
    applyMap(state.workingMap, 'Workspace', { mapChanged: true, staleReason: 'Map object deleted' });
    syncDraftToUI();
    updateSelectionInfo();
    setCanvasMessage(`Deleted ${id}`, 1300);
  }

  function hitTestObject(sceneX, sceneY, obj) {
    if (!objectVisible(obj)) return false;
    if (geometryOf(obj) === 'polygon') return pointInPolygon(sceneX, sceneY, obj.points || []);
    const [cx, cy] = [Number(obj.pos?.x || 0), Number(obj.pos?.y || 0)];
    const dx = sceneX - cx, dy = sceneY - cy;
    return dx * dx + dy * dy <= Number(obj.radius) * Number(obj.radius);
  }

  function pointInPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = Number(pts[i][0]), yi = Number(pts[i][1]);
      const xj = Number(pts[j][0]), yj = Number(pts[j][1]);
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function topmostObjectAt(sceneX, sceneY) {
    const preview = getPreviewState();
    for (let i = preview.objects.length - 1; i >= 0; i--) {
      if (hitTestObject(sceneX, sceneY, preview.objects[i])) return preview.objects[i];
    }
    return null;
  }

  function updateFormHint() {
    if (!state.editMode) { $('editFormHint').textContent = 'Current definition: edit mode is paused.'; return; }
    const preview = getPreviewState();
    $('editFormHint').textContent = preview.invalid ? `Current definition is invalid: ${preview.invalidMsg}` : 'Current definition is valid; the canvas preview has been updated automatically.';
  }

  function populateObjectTypeSelects() {
    const defs = MapEditorTypes.listObjectTypes();
    for (const id of ['editObjectType', 'addObjectType']) {
      const sel = $(id);
      const current = sel.value;
      sel.innerHTML = '';
      for (const def of defs) {
        const opt = document.createElement('option');
        opt.value = def.id;
        opt.textContent = def.label || def.id;
        sel.appendChild(opt);
      }
      if (defs.some(d => d.id === current)) sel.value = current;
    }
  }

  function updateMeshUI() {
    const status = $('meshStatus');
    const stats = $('meshStats');
    if (!status || !stats) return;
    if (state.meshGenerating) {
      status.textContent = 'Generating mesh… Maps with many boundary intersections may take several seconds.';
    } else if (!state.meshData) {
      status.textContent = 'No mesh generated。';
    } else if (state.meshStale) {
      status.textContent = `Current mesh is stale: ${state.meshStaleReason || 'Map changed'}. Stale meshes are not written to JSON saves.`;
    } else {
      status.textContent = `Mesh valid; source signature = ${state.meshData.source_signature}`;
    }
    if (!state.meshData?.stats) {
      stats.innerHTML = '<div>vertices</div><div>—</div><div>cells</div><div>—</div>';
      return;
    }
    const st = state.meshData.stats;
    const by = Object.entries(st.by_type || {}).map(([k,v]) => `${k}: ${v}`).join(' · ');
    stats.innerHTML = `
      <div>vertices</div><div>${st.vertices ?? '—'}</div>
      <div>cells</div><div>${st.cells ?? '—'}</div>
      <div>constraints</div><div>${st.constraints ?? '—'}</div>
      <div>Boundary Vertices Added</div><div>${st.boundary_vertices_inserted ?? '—'}</div>
      <div>Minimum Angle</div><div>${Number.isFinite(st.min_angle_deg) ? st.min_angle_deg.toFixed(2) + '°' : '—'}</div>
      <div>Worst Aspect Ratio</div><div>${Number.isFinite(st.worst_aspect_ratio) ? st.worst_aspect_ratio.toFixed(2) : '—'}</div>
      <div>Cell Types</div><div>${by || '—'}</div>`;
  }

  function meshOptionsFromUI() {
    const spacing = inputNumber('meshSpacing');
    const refinePasses = inputNumber('meshRefinePasses');
    const minAngle = inputNumber('meshMinAngle');
    const maxAspect = inputNumber('meshMaxAspect');
    const boundarySpacing = inputNumber('meshBoundarySpacing');
    const maxCells = inputNumber('meshMaxCells');
    if (!(spacing >= 2 && spacing <= 64)) throw new Error('Initial sampling spacing must be between 2 and 64.');
    if (!(refinePasses >= 0 && refinePasses <= 8)) throw new Error('Refinement passes must be between 0 and 8.');
    if (!(minAngle > 0 && minAngle <= 40)) throw new Error('Target minimum angle must be between 0° and 40°.');
    if (!(maxAspect >= 1.5)) throw new Error('Maximum aspect ratio must be at least 1.5.');
    if (!(boundarySpacing >= 1 && boundarySpacing <= 64)) throw new Error('Straight-edge subdivision spacing must be between 1 and 64.');
    if (!(maxCells >= 500 && maxCells <= 5000)) throw new Error('Maximum cell count must be between 500 and 5000.');
    return { spacing, refinePasses: Math.floor(refinePasses), minAngle, maxAspect, boundarySpacing, maxCells: Math.floor(maxCells) };
  }

  function generateMesh() {
    if (!state.workingMap || state.meshGenerating) return;
    try {
      validateLoadedMap(state.workingMap);
      const options = meshOptionsFromUI();
      state.meshGenerating = true;
      updateMeshUI();
      render();
      setTimeout(() => {
        try {
          const mesh = MeshEngine.generate(state.workingMap, options, MapEditorTypes);
          state.meshData = mesh;
          state.meshStale = false;
          state.meshStaleReason = '';
          invalidateVisualization('Mesh regenerated; visualization must be rendered again');
          validateVisualSourceFromUI();
          setCanvasMessage(`Mesh generation complete: ${mesh.cells.length} cells`, 1500);
        } catch (err) {
          state.meshStale = true;
          state.meshStaleReason = `Generation failed: ${err.message}`;
          setCanvasMessage(`Mesh generation failed: ${err.message}`, 2600);
        } finally {
          state.meshGenerating = false;
          updateMeshUI();
          render();
        }
      }, 30);
    } catch (err) {
      state.meshGenerating = false;
      state.meshStaleReason = `Generation failed: ${err.message}`;
      updateMeshUI();
      setCanvasMessage(`Mesh generation failed: ${err.message}`, 2400);
    }
  }

  function clearMesh() {
    state.meshData = null;
    state.meshStale = true;
    state.meshStaleReason = 'Mesh cleared';
    invalidateVisualization('Mesh cleared');
    validateVisualSourceFromUI();
    state.hoveredCellId = null;
    $('meshCellInfo').textContent = 'Move the pointer over a mesh cell to inspect its type, adjacency, and quality information.';
    updateMeshUI();
    render();
  }

  function meshTypeColor(type, alpha) {
    const a = Math.max(0, Math.min(.95, alpha));
    const colors = {
      passable: [148,163,184],
      impassable_terrain: [59,130,246],
      tower: [30,64,175],
      grass: [34,197,94]
    };
    const c = colors[type] || [168,85,247];
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  function drawMesh() {
    const mesh = state.meshData;
    if (!mesh || !$('showMesh')?.checked) return;
    if (state.meshStale && !$('showStaleMesh')?.checked) return;
    const showFill = $('showMeshFill').checked;
    const showEdges = $('showMeshEdges').checked;
    const alpha = n('meshOpacity', .34);
    const hovered = state.hoveredCellId;
    ctx.save();
    for (const cell of mesh.cells || []) {
      const pts = cell.vertices.map(i => mesh.vertices[i]);
      if (pts.length !== 3) continue;
      ctx.beginPath();
      const [x0,y0] = sceneToCanvas(pts[0][0],pts[0][1]);
      ctx.moveTo(x0,y0);
      for (let i=1;i<3;i++) {
        const [x,y] = sceneToCanvas(pts[i][0],pts[i][1]);
        ctx.lineTo(x,y);
      }
      ctx.closePath();
      if (showFill) {
        const boost = cell.id === hovered ? Math.min(.92, alpha + .24) : alpha;
        ctx.fillStyle = meshTypeColor(cell.type, boost);
        ctx.fill();
      }
      if (showEdges) {
        ctx.strokeStyle = cell.id === hovered ? 'rgba(15,23,42,.95)' : (state.meshStale ? 'rgba(220,38,38,.45)' : 'rgba(15,23,42,.30)');
        ctx.lineWidth = cell.id === hovered ? 2 : .75;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function pointInTriangle(p, a, b, c) {
    const sign = (p1,p2,p3) => (p1[0]-p3[0])*(p2[1]-p3[1]) - (p2[0]-p3[0])*(p1[1]-p3[1]);
    const d1 = sign(p,a,b), d2 = sign(p,b,c), d3 = sign(p,c,a);
    const hasNeg = d1 < -1e-8 || d2 < -1e-8 || d3 < -1e-8;
    const hasPos = d1 > 1e-8 || d2 > 1e-8 || d3 > 1e-8;
    return !(hasNeg && hasPos);
  }

  function meshCellAt(x, y) {
    const mesh = state.meshData;
    if (!mesh || !$('showMesh')?.checked || (state.meshStale && !$('showStaleMesh')?.checked)) return null;
    const p=[x,y];
    for (const cell of mesh.cells || []) {
      const a=mesh.vertices[cell.vertices[0]], b=mesh.vertices[cell.vertices[1]], c=mesh.vertices[cell.vertices[2]];
      if (pointInTriangle(p,a,b,c)) return cell;
    }
    return null;
  }

  function updateMeshCellInfo(cell) {
    const el = $('meshCellInfo');
    if (!el) return;
    if (!cell) {
      el.textContent = 'Move the pointer over a mesh cell to inspect its type, adjacency, and quality information.';
      return;
    }
    const q = cell.quality || {};
    el.textContent = `cell #${cell.id}\ntype: ${cell.type}\npassable: ${cell.attributes?.passable !== false}\nsource: ${cell.source_object_id || '—'}\nneighbors: ${(cell.neighbors || []).join(', ') || '—'}\narea: ${Number(cell.area).toFixed(3)}\nmin angle: ${Number(q.min_angle_deg).toFixed(2)}°\naspect: ${Number(q.aspect_ratio).toFixed(2)}`;
  }

  function populateVisualRendererSelect() {
    const sel = $('visualRendererSelect');
    if (!sel || !window.MapVisualizers) return;
    const defs = MapVisualizers.listRenderers();
    sel.innerHTML = '';
    for (const def of defs) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = def.label || def.id;
      sel.appendChild(opt);
    }
    if (defs.some(d => d.id === state.visualRendererId)) sel.value = state.visualRendererId;
    else if (defs.length) { state.visualRendererId = defs[0].id; sel.value = defs[0].id; }
    updateVisualizationUI();
  }

  function currentVisualizer() {
    return window.MapVisualizers?.getRenderer(state.visualRendererId) || null;
  }

  function invalidateVisualization(reason = 'Inputs changed') {
    if (state.visualResult) {
      state.visualResultStale = true;
      state.visualResultStaleReason = reason;
    }
    updateVisualizationUI();
  }

  function visualCellAt(x, y, passableOnly = false) {
    if (!state.meshData || state.meshStale || !window.MapVisualizers) return null;
    return MapVisualizers.locateCell(state.meshData, [x, y], c => !passableOnly || c.attributes?.passable !== false);
  }

  function validateVisualSource(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { valid: false, error: 'X/Y must be finite numeric values.', cellId: null };
    if (x < SCENE_MIN || x > SCENE_MAX || y < SCENE_MIN || y > SCENE_MAX) return { valid: false, error: 'The source must be inside the map bounds [-128,128].', cellId: null };
    if (!state.meshData) return { valid: false, error: 'Generate or import a valid mesh first.', cellId: null };
    if (state.meshStale) return { valid: false, error: 'The current mesh is stale; regenerate it.', cellId: null };
    const cell = visualCellAt(x, y, true);
    if (!cell) return { valid: false, error: 'This position is not inside a passable cell.', cellId: null };
    return { valid: true, error: '', cellId: cell.id };
  }

  function setVisualSource(x, y, { syncInputs = true, invalidate = true } = {}) {
    const check = validateVisualSource(x, y);
    state.visualSource = { x, y, valid: check.valid, cellId: check.cellId, error: check.error };
    if (syncInputs) {
      $('visualSourceX').value = Number.isFinite(x) ? Number(x.toFixed(3)) : '';
      $('visualSourceY').value = Number.isFinite(y) ? Number(y.toFixed(3)) : '';
    }
    if (invalidate && state.visualResult) invalidateVisualization('Source changed; visualization must be rendered again');
    updateVisualizationUI();
    render();
    return check.valid;
  }

  function validateVisualSourceFromUI() {
    const x = inputNumber('visualSourceX'), y = inputNumber('visualSourceY');
    return setVisualSource(x, y, { syncInputs: false, invalidate: true });
  }

  function renderVisualization() {
    const renderer = currentVisualizer();
    if (!renderer) { setCanvasMessage('No visualization renderer is available.', 1800); return; }
    if (renderer.requiresMesh && (!state.meshData || state.meshStale)) {
      setCanvasMessage('A valid, non-stale mesh is required.', 2000); updateVisualizationUI(); return;
    }
    if (renderer.requiresSource && !validateVisualSourceFromUI()) {
      setCanvasMessage(state.visualSource.error || 'Invalid source.', 2000); return;
    }
    try {
      const result = renderer.compute({
        mesh: state.meshData,
        map: state.workingMap,
        source: { x: state.visualSource.x, y: state.visualSource.y },
        typeRegistry: window.MapEditorTypes
      });
      state.visualResult = result;
      state.visualResultStale = false;
      state.visualResultStaleReason = '';
      updateVisualizationUI();
      setCanvasMessage(`Visualization complete: ${result.reachable_count ?? Object.keys(result.values || {}).length} reachable cells`, 1500);
      render();
    } catch (err) {
      state.visualResult = null;
      state.visualResultStale = false;
      updateVisualizationUI();
      setCanvasMessage(`Visualization failed: ${err.message}`, 2400);
    }
  }

  function clearVisualization() {
    state.visualResult = null;
    state.visualResultStale = false;
    state.visualResultStaleReason = '';
    updateVisualizationUI();
    render();
  }

  function updateVisualizationUI() {
    const renderer = currentVisualizer();
    for (const id of ['visualSourceX','visualSourceY']) $(id).parentElement.hidden = !renderer?.requiresSource;
    $('visualSourceX').closest('.subsection').querySelector('h3').hidden = !renderer?.requiresSource;
    $('visualPickBtn').hidden = !renderer?.requiresSource;
    $('visualSourceStatus').hidden = !renderer?.requiresSource;
    const desc = $('visualRendererDescription');
    if (desc) desc.textContent = renderer?.description || '—';
    const sourceStatus = $('visualSourceStatus');
    if (sourceStatus) {
      if (state.visualSource.valid) sourceStatus.textContent = `Valid source: (${state.visualSource.x.toFixed(2)}, ${state.visualSource.y.toFixed(2)}) · cell #${state.visualSource.cellId}`;
      else sourceStatus.textContent = state.visualSource.error || 'Invalid source.';
    }
    const pickBtn = $('visualPickBtn');
    if (pickBtn) {
      pickBtn.textContent = `Canvas Pick: ${state.visualPickMode ? 'Enabled' : 'Paused'}`;
      pickBtn.classList.toggle('primary', state.visualPickMode);
    }
    const result = state.visualResult;
    const stats = $('visualStats');
    if (stats) {
      if (!result) stats.innerHTML = '<div>Reachable Cells</div><div>—</div><div>Maximum Distance</div><div>—</div>';
      else stats.innerHTML = `<div>Reachable Cells</div><div>${result.reachable_count ?? '—'} / ${result.total_passable_cells ?? '—'}</div><div>Maximum Distance</div><div>${Number.isFinite(result.max) ? result.max.toFixed(2) : '—'}</div><div>Status</div><div>${state.visualResultStale ? 'Stale' : 'Valid'}</div>`;
    }
    if (renderer && result) {
      const lg = renderer.legend(result);
      if ($('visualLegendMin')) $('visualLegendMin').textContent = lg.minLabel || 'Near / 0';
      if ($('visualLegendMax')) $('visualLegendMax').textContent = lg.maxLabel || 'Far / —';
      const bar = document.querySelector('.distance-gradient');
      if (bar && lg.gradient) bar.style.background = lg.gradient;
    } else {
      if ($('visualLegendMin')) $('visualLegendMin').textContent = 'Near / 0';
      if ($('visualLegendMax')) $('visualLegendMax').textContent = 'Far / —';
    }
    const info = $('visualCellInfo');
    if (info && state.visualResultStale) info.textContent = `Current visualization is stale: ${state.visualResultStaleReason || 'Inputs changed'}. Please render again.`;
  }

  function drawVisualization() {
    const result = state.visualResult;
    const renderer = currentVisualizer();
    if (!result || !renderer || !state.meshData || state.visualResultStale || state.meshStale) return;
    const alpha = n('visualOpacity', .62);
    const showEdges = $('visualShowMeshEdges')?.checked;
    const values = result.values || {};
    ctx.save();
    for (const cell of state.meshData.cells || []) {
      const value = values[cell.id];
      if (!renderer.isCellRenderable(cell, value, result)) continue;
      const pts = cell.vertices.map(i => state.meshData.vertices[i]);
      if (pts.length !== 3) continue;
      ctx.beginPath();
      const [x0,y0] = sceneToCanvas(pts[0][0],pts[0][1]);
      ctx.moveTo(x0,y0);
      for (let i=1;i<3;i++) { const [x,y]=sceneToCanvas(pts[i][0],pts[i][1]); ctx.lineTo(x,y); }
      ctx.closePath();
      ctx.fillStyle = renderer.color(value, result, alpha, cell);
      ctx.fill();
      if (showEdges) {
        ctx.strokeStyle = 'rgba(15,23,42,.22)';
        ctx.lineWidth = .7;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawVisualCrosshair() {
    if (!currentVisualizer()?.requiresSource || !state.visualSource.valid || (state.activeTab !== 'visualTab' && !state.visualResult)) return;
    const [x,y] = sceneToCanvas(state.visualSource.x, state.visualSource.y);
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.fillStyle = '#dc2626';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x,y,7,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x,y,2.6,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function updateVisualCellInfo(cell) {
    const el = $('visualCellInfo');
    if (!el) return;
    if (state.visualResultStale) { el.textContent = `Current visualization is stale: ${state.visualResultStaleReason || 'Inputs changed'}. Please render again.`; return; }
    if (!cell || !state.visualResult) { el.textContent = 'After rendering, move the pointer over a cell to inspect its distance value.'; return; }
    const v = state.visualResult.values?.[cell.id];
    el.textContent = Number.isFinite(v)
      ? `cell #${cell.id}\ntype: ${cell.type}\ndistance: ${v.toFixed(3)}\nreachable: yes`
      : `cell #${cell.id}\ntype: ${cell.type}\ndistance: —\nreachable: no`;
  }

  function drawDimOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.fillRect(0, 0, canvas.width / DPR(), canvas.height / DPR());
    ctx.restore();
  }

  function drawDuplicateFlashes(objects) {
    if (now() > state.flash.until || !state.flash.ids.size) return;
    const phase = Math.floor((state.flash.until - now()) / 250) % 2 === 0;
    if (!phase) return;
    for (const obj of objects) {
      if (!state.flash.ids.has(obj.id)) continue;
      if (geometryOf(obj) === 'polygon') drawPolygon(obj.points, null, 'rgba(239,68,68,.95)', 4);
      else drawPolygon(regularOctagon(Number(obj.pos.x), Number(obj.pos.y), Number(obj.radius)), null, 'rgba(239,68,68,.95)', 4);
    }
  }

  function drawCanvasMessages(previewInvalid) {
    const w = canvas.width / DPR(), h = canvas.height / DPR();
    if (previewInvalid) {
      ctx.save();
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Current definition is invalid', w / 2, h / 2);
      ctx.restore();
    }
    const bottomMsg = now() <= state.canvasMessage.until ? state.canvasMessage.text
      : (now() <= state.flash.until ? state.flash.message : '');
    if (bottomMsg) {
      ctx.save();
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(bottomMsg, 14, h - 14);
      ctx.restore();
    }
  }

  function render() {
    ensureCanvasSize();
    const w = canvas.width / DPR(), h = canvas.height / DPR();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    drawBackground();
    drawGrid();


    const preview = getPreviewState();
    const objects = preview.objects;
    const highlightIds = new Set(preview.highlightIds);
    const hovered = state.hoveredId;
    const selected = state.selectedId;

    for (const obj of objects) {
      if (!objectVisible(obj)) continue;
      let role = 'normal';
      if (highlightIds.has(obj.id)) role = state.mode === 'add' ? 'preview' : 'selected';
      else if (hovered && obj.id === hovered && state.editMode) role = 'hover';
      drawObject(obj, role);
    }

    if (state.editMode && (highlightIds.size > 0 || preview.invalid)) {
      drawDimOverlay();
      for (const obj of objects) {
        if (highlightIds.has(obj.id)) drawObject(obj, state.mode === 'add' ? 'preview' : 'selected');
      }
      if (!highlightIds.size && hovered && !selected) {
        const hoveredObj = objects.find(o => o.id === hovered);
        if (hoveredObj) drawObject(hoveredObj, 'hover');
      }
    }

    if (state.editMode && hovered && !highlightIds.has(hovered)) {
      const hoveredObj = objects.find(o => o.id === hovered);
      if (hoveredObj) drawObject(hoveredObj, 'hover');
    }

    drawVisualization();
    drawMesh();
    drawStrategicLayers();
    drawVisualCrosshair();
    drawDuplicateFlashes(objects);
    drawCanvasMessages(preview.invalid && state.editMode);
    $('opacityValue').textContent = n('opacity', .45).toFixed(2);
    if ($('meshOpacityValue')) $('meshOpacityValue').textContent = n('meshOpacity', .34).toFixed(2);
    if ($('visualOpacityValue')) $('visualOpacityValue').textContent = n('visualOpacity', .62).toFixed(2);
    $('zoomReadout').textContent = `${Math.round(state.viewZoom * 100)}%`;
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
  }

  function bindInputs() {
    $('jsonFile').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try { applyMap(JSON.parse(ev.target.result), file.name, { loadMesh: true }); $('saveMapName').value = file.name.replace(/\.json$/i, ''); }
        catch (err) { setStatus(`JSON load failed: ${err.message}`); }
      };
      reader.readAsText(file, 'utf-8');
    });
    $('imageFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadImageFile(f); });
    $('loadDraftBtn').addEventListener('click', () => { $('saveMapName').value = 'map_draft'; loadJsonUrl('map_draft.json').catch(err => setStatus(`Built-in JSON could not be loaded automatically: ${err.message}\nIf opened directly via file://, use “Import JSON”.`)); });
    $('loadReferenceBtn').addEventListener('click', () => loadImageUrl('reference.png'));
    $('clearImageBtn').addEventListener('click', () => { bgImage = null; render(); });
    $('referencePresetBtn').addEventListener('click', applyReferencePreset);
    $('resetImageTransformBtn').addEventListener('click', resetTransform);
    $('fitImageBtn').addEventListener('click', resetTransform);
    $('exportJsonBtn').addEventListener('click', exportCurrentJson);
    $('chooseSaveRootBtn').addEventListener('click', () => chooseSaveRoot().catch(err => { $('saveFolderStatus').textContent = `Folder selection failed: ${err.message}`; }));
    $('saveToFolderBtn').addEventListener('click', saveToProjectFolder);
    $('generateMeshBtn').addEventListener('click', generateMesh);
    $('clearMeshBtn').addEventListener('click', clearMesh);
    ['showMesh','showMeshFill','showMeshEdges','showStaleMesh','meshOpacity'].forEach(id => $(id).addEventListener('input', render));
    $('visualRendererSelect').addEventListener('change', () => { state.visualRendererId = $('visualRendererSelect').value; clearVisualization(); updateVisualizationUI(); });
    ['visualSourceX','visualSourceY'].forEach(id => $(id).addEventListener('input', validateVisualSourceFromUI));
    $('visualPickBtn').addEventListener('click', () => { state.visualPickMode = !state.visualPickMode; updateVisualizationUI(); });
    $('visualRenderBtn').addEventListener('click', renderVisualization);
    $('visualClearBtn').addEventListener('click', clearVisualization);
    ['visualOpacity','visualShowMeshEdges'].forEach(id => $(id).addEventListener('input', render));
    $('toggleEditBtn').addEventListener('click', toggleEditMode);
    $('toggleAddBtn').addEventListener('click', toggleAddMode);
    $('applyEditBtn').addEventListener('click', applyCurrentEdit);
    $('dissolveGroupBtn').addEventListener('click', dissolveGroup);
    $('reloadSelectedBtn').addEventListener('click', loadSelectedIntoDraft);
    $('deleteSelectedBtn').addEventListener('click', deleteSelectedObject);
    $('addEditPointBtn').addEventListener('click', () => {
      if (!state.selectDraft) return;
      const current = readSelectDraftFromUI();
      if (current) state.selectDraft = current;
      if (!state.selectDraft.points) state.selectDraft.points = [[-8, -8], [8, -8], [0, 8]];
      state.selectDraft.points.push([0, 0]);
      state.selectPointModes.push('absolute');
      syncDraftToUI(); updateFormHint(); render();
    });
    $('addAddPointBtn').addEventListener('click', () => {
      state.addDraft.points.push([0, 0]);
      state.addPointModes.push('absolute');
      syncDraftToUI(); updateFormHint(); render();
    });

    Object.values(controls).forEach(el => el.addEventListener('input', render));

    // IMPORTANT: do not call syncDraftToUI() on every keystroke. v0.2 did that,
    // which immediately wrote stale draft values back into the controls and made
    // text/number fields and checkboxes appear uneditable. Live preview now reads
    // the controls directly; full UI synchronization is reserved for selection,
    // mode changes, reloads and point-list structure changes.
    ['editObjectId','editPosX','editPosY','editRadius','adjustGrouped']
      .forEach(id => $(id).addEventListener('input', () => {
        if (state.selectDraft && id !== 'adjustGrouped') {
          const current = readSelectDraftFromUI();
          if (current) state.selectDraft = current;
        }
        updateFormHint();
        render();
      }));

    ['addBaseId','addPosX','addPosY','addRadius','addMirrorSymmetry','addCenterSymmetry']
      .forEach(id => $(id).addEventListener('input', () => {
        readAddDraftFromUI();
        updateFormHint();
        render();
      }));

    $('editObjectType').addEventListener('change', () => {
      if (!state.selectDraft) return;
      const oldType = state.selectDraft.type;
      const newType = $('editObjectType').value;
      // Capture the controls belonging to the OLD geometry before switching.
      state.selectDraft.id = $('editObjectId').value.trim();
      if (geometryOf(oldType) === 'polygon') {
        state.selectDraft.points = gatherPointsFromUI('editPointsList');
      } else {
        state.selectDraft.pos = { x: inputNumber('editPosX'), y: inputNumber('editPosY') };
        state.selectDraft.radius = inputNumber('editRadius');
      }
      state.selectDraft.type = newType;
      if (geometryOf(newType) === 'polygon') {
        if (!Array.isArray(state.selectDraft.points) || state.selectDraft.points.length < 3) {
          const cx = Number(state.selectDraft.pos?.x ?? 0);
          const cy = Number(state.selectDraft.pos?.y ?? 0);
          const r = Number(state.selectDraft.radius ?? 8);
          state.selectDraft.points = [[cx-r, cy-r], [cx+r, cy-r], [cx, cy+r]];
        }
      } else if (!state.selectDraft.pos) {
        const c = centroid(state.selectDraft.points || [[-8,-8],[8,-8],[0,8]]);
        state.selectDraft.pos = { x: c[0], y: c[1] };
        state.selectDraft.radius = Number(state.selectDraft.radius || 8);
      }
      syncDraftToUI(); updateFormHint(); render();
    });

    $('addObjectType').addEventListener('change', () => {
      const oldType = state.addDraft.type;
      const newType = $('addObjectType').value;
      // Capture name/symmetry and the OLD geometry without resetting controls.
      state.addDraft.baseId = $('addBaseId').value.trim();
      state.addDraft.mirror = $('addMirrorSymmetry').checked;
      state.addDraft.center = $('addCenterSymmetry').checked;
      if (geometryOf(oldType) === 'polygon') {
        state.addDraft.points = gatherPointsFromUI('addPointsList');
      } else {
        state.addDraft.pos = { x: inputNumber('addPosX'), y: inputNumber('addPosY') };
        state.addDraft.radius = inputNumber('addRadius');
      }
      state.addDraft.type = newType;
      if (geometryOf(newType) === 'polygon') {
        if (!Array.isArray(state.addDraft.points) || state.addDraft.points.length < 3) {
          const cx = Number(state.addDraft.pos?.x ?? 0);
          const cy = Number(state.addDraft.pos?.y ?? 0);
          const r = Number(state.addDraft.radius ?? 8);
          state.addDraft.points = [[cx-r, cy-r], [cx+r, cy-r], [cx, cy+r]];
        }
      } else if (!state.addDraft.pos) {
        const c = centroid(state.addDraft.points || [[-8,-8],[8,-8],[0,8]]);
        state.addDraft.pos = { x: c[0], y: c[1] };
        state.addDraft.radius = Number(state.addDraft.radius || 8);
      }
      syncDraftToUI(); updateFormHint(); render();
    });

    document.addEventListener('click', e => {
      const removeBtn = e.target.closest('[data-remove-point]');
      if (removeBtn) {
        const mode = removeBtn.dataset.removePoint;
        const idx = Number(removeBtn.dataset.idx);
        if (mode === 'edit' && state.selectDraft?.points) {
          const cur = readSelectDraftFromUI(); if (cur) state.selectDraft = cur;
          state.selectDraft.points.splice(idx, 1); state.selectPointModes.splice(idx, 1);
        }
        if (mode === 'add' && state.addDraft?.points) {
          const cur = readAddDraftFromUI(); state.addDraft = cur;
          state.addDraft.points.splice(idx, 1); state.addPointModes.splice(idx, 1);
        }
        syncDraftToUI(); updateFormHint(); render();
        return;
      }
      const insertBtn = e.target.closest('[data-insert-point]');
      if (insertBtn) {
        const mode = insertBtn.dataset.insertPoint;
        const idx = Number(insertBtn.dataset.idx);
        if (mode === 'edit' && state.selectDraft?.points) {
          const cur = readSelectDraftFromUI(); if (cur) state.selectDraft = cur;
          const pts = state.selectDraft.points;
          const a = pts[idx], b = pts[(idx + 1) % pts.length];
          const mid = [(Number(a[0]) + Number(b[0])) / 2, (Number(a[1]) + Number(b[1])) / 2];
          pts.splice(idx + 1, 0, mid); state.selectPointModes.splice(idx + 1, 0, 'offset');
        }
        if (mode === 'add' && state.addDraft?.points) {
          const cur = readAddDraftFromUI(); state.addDraft = cur;
          const pts = state.addDraft.points;
          const a = pts[idx], b = pts[(idx + 1) % pts.length];
          const mid = [(Number(a[0]) + Number(b[0])) / 2, (Number(a[1]) + Number(b[1])) / 2];
          pts.splice(idx + 1, 0, mid); state.addPointModes.splice(idx + 1, 0, 'offset');
        }
        syncDraftToUI(); updateFormHint(); render();
      }
    });

    document.addEventListener('change', e => {
      const sel = e.target.closest('[data-point-mode]');
      if (!sel) return;
      const mode = sel.dataset.pointMode;
      const idx = Number(sel.dataset.idx);
      // Geometry is stored absolutely in draft; switching representation should
      // not move the point. Only its UI representation changes.
      if (mode === 'edit') state.selectPointModes[idx] = sel.value;
      else state.addPointModes[idx] = sel.value;
      syncDraftToUI(); updateFormHint(); render();
    });

    document.addEventListener('input', e => {
      const input = e.target;
      if (input.matches('#editPointsList input[data-point-value]')) {
        const points = gatherPointsFromUI('editPointsList', state.selectPointModes);
        if (state.selectDraft) state.selectDraft.points = points;
        updateFormHint(); render();
      }
      if (input.matches('#addPointsList input[data-point-value]')) {
        const points = gatherPointsFromUI('addPointsList', state.addPointModes);
        state.addDraft.points = points;
        updateFormHint(); render();
      }
    });

    $('zoomInBtn').addEventListener('click', () => { state.viewZoom = clamp(state.viewZoom * 1.2, 0.4, 5); render(); });
    $('zoomOutBtn').addEventListener('click', () => { state.viewZoom = clamp(state.viewZoom / 1.2, 0.4, 5); render(); });
    $('zoomFitBtn').addEventListener('click', () => { state.viewZoom = 1; render(); });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      state.viewZoom = clamp(state.viewZoom * factor, 0.4, 5);
      render();
    }, { passive: false });

    canvas.addEventListener('mousemove', e => {
      const p = canvasToScene(e.clientX, e.clientY);
      $('cursorReadout').textContent = `x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}`;
      const cell = state.activeTab === 'visualTab' ? visualCellAt(p.x, p.y, false) : meshCellAt(p.x, p.y);
      const cellId = cell?.id ?? null;
      if (cellId !== state.hoveredCellId) {
        state.hoveredCellId = cellId;
        updateMeshCellInfo(cell);
        updateVisualCellInfo(cell);
        render();
      }
      if (state.activeTab === 'visualTab') {
        if (state.hoveredId !== null) { state.hoveredId = null; render(); }
        return;
      }
      if (!state.editMode) {
        if (state.hoveredId !== null) { state.hoveredId = null; render(); }
        return;
      }
      const hit = topmostObjectAt(p.x, p.y);
      const id = hit?.id || null;
      if (id !== state.hoveredId) { state.hoveredId = id; render(); }
    });
    canvas.addEventListener('mouseleave', () => {
      $('cursorReadout').textContent = 'x: —, y: —';
      state.hoveredId = null;
      state.hoveredCellId = null;
      updateMeshCellInfo(null);
      updateVisualCellInfo(null);
      render();
    });
    canvas.addEventListener('click', e => {
      if (handleGameClick(e)) return;
      const p = canvasToScene(e.clientX, e.clientY);
      if (state.activeTab === 'visualTab' && currentVisualizer()?.requiresSource && state.visualPickMode) {
        setVisualSource(p.x, p.y, { syncInputs: true, invalidate: true });
        return;
      }
      if (!state.editMode || state.mode !== 'select') return;
      const hit = topmostObjectAt(p.x, p.y);
      if (hit) {
        state.selectedId = hit.id;
        loadSelectedIntoDraft();
        render();
      }
    });

    const ro = new ResizeObserver(() => render());
    ro.observe(canvas.parentElement);
    window.addEventListener('resize', render);
  }

function init() {
  populateObjectTypeSelects();
  initStrategy();
  populateVisualRendererSelect();
  bindTabs();
  bindInputs();
  setActiveTab('ioTab');
  state.viewZoom = 1;
  syncDraftToUI();
  updateEditPanels();
  updateCounts();
  updateMeshUI();
  validateVisualSourceFromUI();
  updateVisualizationUI();
  render();

  loadJsonUrl('./map_draft.json').catch(err => {
    console.error('Failed to load default map:', err);
    setStatus(`Failed to load default map: ${err.message}`);
  });
}

init();
})();
