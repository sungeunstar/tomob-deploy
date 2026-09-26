import {createExpeditionField} from '../modules/aurora-refuge-field.js';
const f=createExpeditionField();
const pts=[
[-18,-68],[-21,-74],[-15,-78],[-8,-81],[0,-83],[8,-85],[16,-86],[24,-86],[30,-86],
[-12,-76],[-4,-78],[4,-80],[12,-82],[20,-84],[28,-84],
[-10,-72],[0,-72],[10,-72],[20,-72],[30,-72],
[-10,-92],[0,-92],[10,-92],[20,-92],[30,-92]
];
for(const [x,z] of pts) console.log('H',x,z,f.height(x,z).toFixed(2),'slope',f.slope(x,z).toFixed(2),'path',f.nearPath(x,z).d.toFixed(2));
