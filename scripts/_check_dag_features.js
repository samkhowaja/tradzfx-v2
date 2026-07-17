const { globalDAG } = require('./apps/engine/dist/index.js');
console.log('Registered features:', globalDAG.getFeatureNames());