import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {exactCollectionPattern,compactCollectionSets} from '../scripts/build-firestore-release-rules.mjs';
test('every compacted application collection set retains exact membership and near misses',()=>{
 const source=readFileSync('firestore.rules','utf8');let count=0;
 for(const match of source.matchAll(/collectionName\s+in\s+\[((?:\s*'[a-z0-9_]+'\s*,?)+)\]/g)){
  const names=[...match[1].matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1]),expected=new Set(names),pattern=new RegExp(exactCollectionPattern(names));
  const probes=new Set(['','other_collection','finance_x_v1','finance_x_v1_extra']);
  for(const name of names){probes.add(name);probes.add('prefix_'+name);probes.add(name+'_suffix');for(let i=0;i<name.length;i++){probes.add(name.slice(0,i)+name.slice(i+1));probes.add(name.slice(0,i)+'x'+name.slice(i+1));}}
  for(const probe of probes)assert.equal(pattern.test(probe),expected.has(probe),probe);count++;
 }
 assert.ok(count>=4);
});
test('collection set compaction preserves quoted examples and comments',()=>{
 const source=`// collectionName in ['protected']\nlet text = "collectionName in ['example']"; return collectionName in ['abc','abcd','other'];`;
 const result=compactCollectionSets(source);assert.match(result,/\/\/ collectionName in \['protected'\]/);assert.match(result,/"collectionName in \['example'\]"/);assert.match(result,/collectionName.matches/);assert.equal(compactCollectionSets(result),result);
});
test('exact collection regex has no wildcard and handles prefix names',()=>{
 const pattern=exactCollectionPattern(['a','ab','abc','def']);assert.equal(pattern,exactCollectionPattern(['def','abc','a','ab']));const regex=new RegExp(pattern);for(const n of ['a','ab','abc','def'])assert.ok(regex.test(n));for(const n of ['','abcd','de','defx','a.b'])assert.equal(regex.test(n),false);assert.throws(()=>exactCollectionPattern(['a.*']));
});
