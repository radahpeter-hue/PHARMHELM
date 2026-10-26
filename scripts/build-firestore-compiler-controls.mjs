// Inactive diagnostic sources only; none can substitute for the candidate gate.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renameRuleSymbols,shareDocumentReads,shareTenantPredicates,cacheWriteResourceMaps,shareFieldComparisons,shareFieldReads,shareRuleAtoms} from './build-firestore-release-rules.mjs';
const source=readFileSync(process.argv[2]||'firestore.rules','utf8');
const directory=process.argv[3];if(!directory)throw new Error('Explicit diagnostic output directory required.');
mkdirSync(directory,{recursive:true});
const paths=cacheWriteResourceMaps(shareDocumentReads(shareTenantPredicates(source)));
const comparisons=shareFieldComparisons(paths);
for(const [name,rules] of [['alpha-only',source],['shared-paths',paths],['comparisons',comparisons],['fields-without-atoms',shareFieldReads(comparisons)],['scalar-atoms-only',shareFieldReads(shareRuleAtoms(comparisons,{pointReads:false}))]])writeFileSync(join(directory,name+'.rules'),renameRuleSymbols(rules)+'\n');
