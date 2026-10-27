import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rules=readFileSync('firestore.rules','utf8');
const golden=JSON.parse(readFileSync('tests/fixtures/firestore-fallback-policy-9264674.json','utf8'));
function list(name:string){
 const body=rules.match(new RegExp('function '+name+'\\(\\) \\{([\\s\\S]*?)\\n\\s*\\}'))![1];
 return [...body.matchAll(/\[([\s\S]*?)\]/g)].flatMap(x=>[...x[1].matchAll(/'([^']+)'/g)].map(y=>y[1]));
}
test('flattened fallback excludes exactly the same collections as the pre-change financial policy',()=>{
 const read=list('dedicatedCollection'),extra=list('dedicatedWriteCollection');
 assert.deepEqual([...read].sort(),golden.readExcluded);
 assert.deepEqual([...new Set([...read,...extra])].sort(),golden.writeExcluded);
 const probes=new Set([...golden.writeExcluded,'prescribers','arbitrary_collection','clients_extra','clients\n','',...golden.writeExcluded.map((x:string)=>x+'_fake')]);
 for(const name of probes){assert.equal(read.includes(name),golden.readExcluded.includes(name));assert.equal(read.includes(name)||extra.includes(name),golden.writeExcluded.includes(name));}
 const fallback=rules.slice(rules.indexOf('match /{collectionName}/{docId}'));
 assert.match(fallback,/allow read: if !dedicatedCollection\(\)\s*&& isAuthenticated\(\)/);
 assert.match(fallback,/allow write: if !dedicatedWriteCollection\(\)\s*&& \(request.method == 'delete'/);
});
test('identity simplification only discards checks behind collections already denied by fallback',()=>{
 const excluded=list('dedicatedCollection');for(const name of ['staff','clients','institutions'])assert.ok(excluded.includes(name));
 assert.ok(!excluded.includes('prescribers'));
 const identity=rules.slice(rules.indexOf('function immutableFallbackIdentities()'),rules.indexOf('      allow read:',rules.indexOf('function immutableFallbackIdentities()')));
 assert.match(identity,/collectionName != 'prescribers' \|\| !\('prescriber_code' in existingMap\)/);
 assert.match(identity,/requestedMap.prescriber_code == existingMap.prescriber_code/);
 // Dedicated identity guards remain, independently of the generic fallback.
 for(const field of ['employee_id','staff_code','patient_code','institution_code'])assert.ok(rules.slice(0,rules.indexOf('match /{collectionName}/{docId}')).includes(field));
});
