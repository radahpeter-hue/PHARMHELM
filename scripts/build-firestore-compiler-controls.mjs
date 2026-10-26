// Inactive diagnostic sources only; none can substitute for the candidate gate.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {compactRuleSymbols,renameRuleSymbols,shareDocumentReads,shareTenantPredicates,cacheWriteResourceMaps,shareFieldComparisons,shareFieldReads,shareRuleAtoms} from './build-firestore-release-rules.mjs';
const source=readFileSync(process.argv[2]||'firestore.rules','utf8');
const directory=process.argv[3];if(!directory)throw new Error('Explicit diagnostic output directory required.');
mkdirSync(directory,{recursive:true});
const paths=cacheWriteResourceMaps(shareDocumentReads(shareTenantPredicates(source)));
const comparisons=shareFieldComparisons(paths);
for(const [name,rules] of [['alpha-only',source],['shared-paths',paths],['comparisons',comparisons],['fields-without-atoms',shareFieldReads(comparisons)],['scalar-atoms-only',shareFieldReads(shareRuleAtoms(comparisons,{pointReads:false}))]])writeFileSync(join(directory,name+'.rules'),renameRuleSymbols(rules)+'\n');
// Fail-closed isolation controls. These intentionally deny operations and are
// NEVER release candidates or substitutes for the real security/size gate.
const fallback=source.lastIndexOf('    match /{collectionName}/{docId}');
if(fallback<0)throw new Error('Expected final generic fallback was not found.');
writeFileSync(join(directory,'isolation-no-generic-fallback.rules'),compactRuleSymbols(source.slice(0,fallback)+'match /{collectionName}/{docId} { allow read, write: if false; }\n}\n}')+'\n');
const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
const significant=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
const changes=[];
for(let i=0;i<significant.length;i++)if(significant[i].token==='allow'){
 let end=i+1;while(end<significant.length&&significant[end].token!==';')end++;
 if(end===significant.length)throw new Error('Unterminated allow statement.');
 changes.push({start:significant[i].index,end:significant[end].index});i=end;
}
for(const change of changes.reverse())tokens.splice(change.start,change.end-change.start+1,'allow read, write: if false;');
writeFileSync(join(directory,'isolation-all-permissions-denied.rules'),renameRuleSymbols(tokens.join(''))+'\n');
