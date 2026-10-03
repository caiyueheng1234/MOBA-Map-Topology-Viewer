(() => {
  'use strict';
  const types = new Map();
  const registerType = def => types.set(def.id, { defaultPriority: 50, defaultRadius: 20, ...def });
  ['tower','major_objective','minor_objective','jungle_camp','base','vision_point','resource','generic'].forEach(id => registerType({ id, name: id.replaceAll('_',' '), defaultPriority: id === 'major_objective' ? 90 : 50, defaultRadius: id === 'major_objective' ? 30 : 20 }));
  const number = (v, fallback) => v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
  /** Owns normalized authored data; importing bad records warns and continues. */
  class GameObjectManager {
    constructor(objects = []) {
      this.objects = new Map();
      for (const o of Array.isArray(objects) ? objects : []) {
        try { this.addObject(o); } catch (e) { console.warn('Game object skipped:', e.message); }
      }
    }
    normalize(o) {
      if (!o || typeof o !== 'object') throw new Error('Invalid game object');
      const type = typeof o.type === 'string' && o.type ? o.type : 'generic';
      const def = types.get(type) || types.get('generic');
      return { id: typeof o.id === 'string' && o.id.trim() ? o.id : `object_${crypto.randomUUID()}`,
        name: String(o.name || o.id || def.name), type,
        position: [number(o.position?.[0],0), number(o.position?.[1],0)],
        priority: Math.max(0,number(o.priority,def.defaultPriority)),
        influenceRadius: Math.max(0,number(o.influenceRadius,def.defaultRadius)),
        enabled: o.enabled !== false,
        properties: o.properties && typeof o.properties === 'object' && !Array.isArray(o.properties) ? structuredClone(o.properties) : {} };
    }
    addObject(o) { const item = this.normalize(o); if (this.objects.has(item.id)) throw new Error(`Duplicate game object ID: ${item.id}`); this.objects.set(item.id,item); return structuredClone(item); }
    removeObject(id) { return this.objects.delete(id); }
    updateObject(id, patch) { if (!this.objects.has(id)) throw new Error(`Unknown object: ${id}`); const item = this.normalize({...this.objects.get(id), ...patch, id}); this.objects.set(id,item); return structuredClone(item); }
    updatePriority(id, priority) { return this.updateObject(id,{priority}); }
    getObject(id) { const item = this.objects.get(id); return item ? structuredClone(item) : null; }
    getObjects() { return structuredClone([...this.objects.values()]); }
  }
  window.GameObjectManager = GameObjectManager;
  window.GameObjectTypes = { registerType, list: () => [...types.values()] };
})();
