'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const dir = path.join(process.cwd(), 'packages', 'strategies', 'src', 'specs');
const rows = fs.readdirSync(dir).filter((file) => file.endsWith('.yaml')).map((file) => {
  const spec = yaml.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  return {
    file,
    id: spec.id ?? file,
    active: spec.active === true,
    dxyDependency: spec.dxyDependency ?? null,
    inferredLegacy: spec.dxyDependency ? null : (/\bDXY\b/i.test(JSON.stringify(spec)) ? 'required' : 'not_required'),
  };
});
const active = rows.filter((row) => row.active);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  readOnly: true,
  activeCount: active.length,
  explicitCount: active.filter((row) => row.dxyDependency !== null).length,
  missingPolicy: active.filter((row) => row.dxyDependency === null),
  classifications: active.reduce((out, row) => {
    const policy = row.dxyDependency ?? row.inferredLegacy;
    out[policy] = (out[policy] ?? 0) + 1;
    return out;
  }, {}),
}, null, 2));