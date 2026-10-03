(() => {
  'use strict';

  const objectTypes = new Map();
  const cellAttributes = new Map();

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function registerObjectType(def) {
    if (!def || typeof def !== 'object') throw new Error('Object type definition must be an object.');
    if (typeof def.id !== 'string' || !def.id) throw new Error('Object type must have a non-empty id.');
    if (!['polygon', 'radial_octagon'].includes(def.geometry)) throw new Error(`${def.id}: Unsupported geometry.`);
    const normalized = {
      id: def.id,
      label: def.label || def.id,
      geometry: def.geometry,
      display: {
        fill: def.display?.fill || 'rgba(100,116,139,.45)',
        stroke: def.display?.stroke || 'rgba(51,65,85,.95)'
      },
      mesh: {
        participates: !!def.mesh?.participates,
        priority: Number.isFinite(Number(def.mesh?.priority)) ? Number(def.mesh.priority) : 0,
        cellType: def.mesh?.cellType || def.id,
        attributes: clone(def.mesh?.attributes || {})
      }
    };
    objectTypes.set(normalized.id, normalized);
    return normalized;
  }

  function registerCellAttribute(name, descriptor = {}) {
    if (typeof name !== 'string' || !name) throw new Error('cell attribute name cannot be empty.');
    cellAttributes.set(name, {
      defaultValue: descriptor.defaultValue,
      description: descriptor.description || ''
    });
  }

  function getObjectType(id) { return objectTypes.get(id) || null; }
  function listObjectTypes() { return [...objectTypes.values()].map(clone); }
  function listCellAttributes() { return [...cellAttributes.entries()].map(([name, d]) => ({ name, ...clone(d) })); }

  registerCellAttribute('passable', { defaultValue: true, description: 'Whether the pathfinding layer is passable.' });

  registerObjectType({
    id: 'impassable_terrain',
    label: 'impassable_terrain',
    geometry: 'polygon',
    display: { fill: 'rgba(52,103,190,.56)', stroke: 'rgba(24,62,133,.96)' },
    mesh: { participates: true, priority: 20, cellType: 'impassable_terrain', attributes: { passable: false } }
  });
  registerObjectType({
    id: 'jungle_spot',
    label: 'jungle_spot',
    geometry: 'radial_octagon',
    display: { fill: 'rgba(250,216,86,.40)', stroke: 'rgba(223,196,0,.98)' },
    // Currently excluded from mesh baking; higher priority is retained for possible future use.
    mesh: { participates: false, priority: 30, cellType: 'jungle_spot', attributes: { passable: true } }
  });
  registerObjectType({
    id: 'tower',
    label: 'tower',
    geometry: 'radial_octagon',
    display: { fill: 'rgba(40,112,210,.58)', stroke: 'rgba(24,62,133,.96)' },
    mesh: { participates: true, priority: 40, cellType: 'tower', attributes: { passable: false } }
  });
  registerObjectType({
    id: 'grass',
    label: 'grass',
    geometry: 'polygon',
    display: { fill: 'rgba(74,222,128,.30)', stroke: 'rgba(22,163,74,.88)' },
    mesh: { participates: true, priority: 10, cellType: 'grass', attributes: { passable: true } }
  });

  window.MapEditorTypes = {
    registerObjectType,
    registerCellAttribute,
    getObjectType,
    listObjectTypes,
    listCellAttributes,
    API_VERSION: 1
  };
})();
