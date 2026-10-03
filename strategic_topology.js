(() => {
  'use strict';
  const CONFIG={priorityScale:100,weights:{topology:.5,gameObjects:.5}};
  const getStrategicDistance=(object,node) => Math.hypot(object.position[0]-node.position[0],object.position[1]-node.position[1]);
  function objectInfluenceAtPoint(object,node,context={}) {
    if(!object.enabled || !(object.influenceRadius>0)) return 0;
    const d=(context.getDistance||getStrategicDistance)(object,node,context);
    return Math.max(0,1-d/object.influenceRadius)*Math.max(0,object.priority)/CONFIG.priorityScale;
  }
  /** Annotates geometric nodes and critical points without mutating geometric topology. */
  function compute({mesh,topology,gameObjects=[],getDistance,weights=CONFIG.weights}) {
    const annotate=node=> { const influence=gameObjects.reduce((sum,o)=>sum+objectInfluenceAtPoint(o,node,{mesh,getDistance}),0); return {...node,gameObjectInfluence:influence,strategicScore:Math.min(1,node.score*weights.topology+Math.min(1,influence)*weights.gameObjects)}; };
    const nodes=topology.nodes.map(annotate);
    return {nodes,criticalPoints:topology.criticalPoints.map(annotate),values:Object.fromEntries(nodes.map(n=>[n.id,n.strategicScore]))};
  }
  window.StrategicTopology={compute,objectInfluenceAtPoint,getStrategicDistance,CONFIG};
})();
