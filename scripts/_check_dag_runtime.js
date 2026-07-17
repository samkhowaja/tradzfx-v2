const { globalDAG } = require('./apps/engine/dist/index.js');
console.log('DAG features:', globalDAG.getFeatureNames());
console.log('Has features_pricing:', globalDAG.get('features_pricing') ? 'YES' : 'NO');
console.log('Has features_atr:', globalDAG.get('features_atr') ? 'YES' : 'NO');
console.log('Has features_bias:', globalDAG.get('features_bias') ? 'YES' : 'NO');