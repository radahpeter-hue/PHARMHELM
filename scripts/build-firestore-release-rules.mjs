/** Deterministic exact collection-set compaction and internal symbol renaming.
 * Paths, fields, roles and policy permissions stay intact. Collection sets become exact anchored regexes.
 * CI checks the authored source first, then tests and deploys this same generated output.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** A prefix trie encodes only the supplied literal names, with no wildcard. */
export function exactCollectionPattern(names) {
 if(!names.length||names.some(name=>!(/^[a-z0-9_]+$/).test(name)))throw Error('Invalid collection name set.');
 const root={end:false,children:new Map()};
 for(const name of names){let node=root;for(const char of name){if(!node.children.has(char))node.children.set(char,{end:false,children:new Map()});node=node.children.get(char);}node.end=true;}
 const encode=node=>{
  const choices=[...node.children.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([char,child])=>char+encode(child));
  if(!choices.length)return '';
  const body=choices.length===1?choices[0]:'(?:'+choices.join('|')+')';
  return node.end?'(?:'+body+')?':body;
 };
 return '^'+encode(root)+'$';
}
export function compactCollectionSets(source) {
 // Match strings/comments first so text inside them can never be rewritten.
 return source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|collectionName\s+in\s+\[((?:\s*'[a-z0-9_]+'\s*,?)+)\]/g,
  (match,list)=>list===undefined?match:`collectionName.matches('${exactCollectionPattern([...list.matchAll(/'([a-z0-9_]+)'/g)].map(m=>m[1]))}')`);
}

export function compactRuleSymbols(source){
 source=compactCollectionSets(source);
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const stripped=tokens.filter(t=>!t.startsWith('//')&&!t.startsWith('/*')).join('');
 const names=new Set(stripped.match(/\b[A-Za-z_]\w*\b/g)||[]),functions=new Map(),variables=new Map();
 const reservedPaths=new Set([...stripped.matchAll(/\/([A-Za-z_]\w*)/g)].map(m=>m[1]));
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let serial=0;
 const unique=()=>{let index=serial++,suffix='';do{suffix=alphabet[index%52]+suffix;index=Math.floor(index/52)-1;}while(index>=0);let name='_'+suffix;while(names.has(name))name+='x';names.add(name);return name;};
 for(const m of stripped.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)){
  if(!functions.has(m[1]))functions.set(m[1],unique());
  for(const name of m[2].split(',').map(s=>s.trim()).filter(Boolean))if(!reservedPaths.has(name)&&!variables.has(name))variables.set(name,unique());
 }
 for(const m of stripped.matchAll(/\blet\s+([A-Za-z_]\w*)\s*=/g))if(!reservedPaths.has(m[1])&&!variables.has(m[1]))variables.set(m[1],unique());
 let previous='';const output=[];
 for(const token of tokens){
  if(token.startsWith('//')||token.startsWith('/*')){output.push(' ');continue;}
  if(/^\s+$/.test(token)){output.push(' ');continue;}
  const internal=/^[A-Za-z_]\w*$/.test(token)&&previous!=='.';
  output.push(internal?(functions.get(token)||variables.get(token)||token):token);previous=token;
 }
 return output.join('').trim();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2]||'firestore.rules',source=readFileSync(file,'utf8'),output=compactRuleSymbols(source);
 writeFileSync(file,output+'\n');console.log(`Generated equivalent release rules: ${Buffer.byteLength(source)} → ${Buffer.byteLength(output)+1} source bytes.`);
}
