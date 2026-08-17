#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const file=path.resolve(__dirname,'..','docs','specs','candle-provenance-finalizer-design-2026-08-16.md');
const text=fs.readFileSync(file,'utf8');
const required=[
  'Lock `market.candle_ingestion_runs` row',
  'Lock all pending rows',
  'Validate every pending row',
  'Resolve authority',
  'Recompute every `content_sha256`',
  'Insert run evidence',
  'Insert raw evidence',
  'Update matching `market.candle_producer_lineage.raw_candle_id`',
  'Update `market.candle_ingestion_runs`',
  'Delete pending rows only after',
  'Commit.'
];
const section=text.slice(text.indexOf('## Exact finalizer order'));
const positions=required.map(x=>({step:x,position:section.indexOf(x)}));
const ordered=positions.every((x,i)=>i===0||x.position>positions[i-1].position);
console.log(JSON.stringify({status:ordered?'READ_ONLY_FINALIZER_ORDER_OK':'READ_ONLY_FINALIZER_ORDER_FAILED',database_writes:0,ordered,steps:positions},null,2));
if(!ordered)process.exitCode=1;
