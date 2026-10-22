/** Deterministic alpha-renaming of internal rule symbols only.
 * Document paths, field names, string literals, roles and policy expressions stay intact.
 * CI checks the authored source first, then tests and deploys this same generated output.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Factor only the two exact, repeated tenant predicates. Calls preserve evaluation order
// and use the same request/resource globals. Strings, comments and field names are untouched.
export function shareTenantPredicates(source) {
 if (!source.includes('function isTenantMember(') || !/match \/databases\/\{database\}\/documents\s*\{/.test(source)) return source;
 if (/function shared(Existing|Requested)Tenant\(/.test(source)) throw new Error('Reserved compaction helper collision');
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const significant=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const replacements=[];
 for(let i=0;i<significant.length;i++) {
  for(const [expression,name] of [['isTenantMember(resource.data.tenantId)','sharedExistingTenant'],['isTenantMember(request.resource.data.tenantId)','sharedRequestedTenant']]) {
   let end=i, value='';
   while(end<significant.length && value.length<expression.length) value+=significant[end++].token;
   if(value===expression) {replacements.push({start:significant[i].index,end:significant[end-1].index,name});i=end-1;break;}
  }
 }
 for(const {start,end,name} of replacements.reverse()) tokens.splice(start,end-start+1,name+'()');
 return tokens.join('').replace(/(match \/databases\/\{database\}\/documents\s*\{)/, '$1\nfunction sharedExistingTenant() { return isTenantMember(resource.data.tenantId); }\nfunction sharedRequestedTenant() { return isTenantMember(request.resource.data.tenantId); }\n');
}
export function compactRuleSymbols(source){
 source=shareTenantPredicates(source);
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
