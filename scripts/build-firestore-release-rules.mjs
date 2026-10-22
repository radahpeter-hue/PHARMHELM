/** Deterministic equivalent factoring and alpha-renaming of internal symbols.
 * Document paths, map field names, string literals and role policies stay intact.
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
// Share repeated fixed-collection point reads. Only the exact get/getAfter path
// plus .data is replaced, with the original document-ID expression as argument.
// Nested subcollection paths and quoted text are deliberately left untouched.
export function shareDocumentReads(source) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const candidates=[],counts=new Map();
 for(let i=0;i<t.length;i++) {
  const method=t[i].token,collection=t[i+12]?.token;
  if(!['get','getAfter'].includes(method)||!/^[A-Za-z_]\w*$/.test(collection||''))continue;
  const prefix=[method,'(','/','databases','/','$','(','database',')','/','documents','/',collection,'/','$','('];
  if(!prefix.every((value,n)=>t[i+n]?.token===value))continue;
  let end=i+16,depth=1;
  while(end<t.length&&depth>0){if(t[end].token==='(')depth++;if(t[end].token===')')depth--;if(depth>0)end++;}
  if(depth||t[end+1]?.token!==')'||t[end+2]?.token!=='.'||t[end+3]?.token!=='data')continue;
  const key=method+'/'+collection;
  const arg=tokens.slice(t[i+16].index,t[end].index).join('');
  candidates.push({start:t[i].index,end:t[end+3].index,arg,key,method,collection});
  counts.set(key,(counts.get(key)||0)+1);i=end+3;
 }
 const helpers=new Map(),declarations=[];let serial=0;
 for(const item of candidates)if(counts.get(item.key)>=3&&!helpers.has(item.key)){
  let name;do{name='sharedDocumentRead'+serial++;}while(new RegExp('\\b'+name+'\\b').test(source));
  helpers.set(item.key,name);
  declarations.push(`function ${name}(sharedDocumentId) { return ${item.method}(/databases/$(database)/documents/${item.collection}/$(sharedDocumentId)).data; }`);
 }
 for(const item of candidates.reverse())if(helpers.has(item.key))tokens.splice(item.start,item.end-item.start+1,helpers.get(item.key)+'('+item.arg+')');
 return tokens.join('').replace(root,'$1\n'+declarations.join('\n')+'\n');
}
// Field access factoring preserves map lookup semantics, including missing-field
// errors. Only plain identifier/member chains are touched; call expressions and
// quoted strings remain unchanged.
export function shareFieldReads(source) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const fields=new Set([...source.matchAll(/\.([A-Za-z_]\w*)/g)].map(m=>m[1]).filter(name=>name.length>=6&&!['resource','data','auth','token'].includes(name)));
 const matches=[],counts=new Map();
 for(let i=0;i<t.length;i++) {
  if(!/^[A-Za-z_]\w*$/.test(t[i].token)||t[i-1]?.token==='.')continue;
  let end=i;
  while(t[end+1]?.token==='.'&&/^[A-Za-z_]\w*$/.test(t[end+2]?.token||'')) {
   end+=2;
   if(fields.has(t[end].token) && t[end+1]?.token!=='(') {
    const field=t[end].token,arg=tokens.slice(t[i].index,t[end-1].index).join('');
    matches.push({start:t[i].index,end:t[end].index,arg,field});counts.set(field,(counts.get(field)||0)+1);i=end;break;
   }
  }
 }
 const names=new Map(),decl=[];
 for(const field of fields)if((counts.get(field)||0)*(field.length-3)>field.length+50){
  let name='sharedField_'+field;while(new RegExp('\\b'+name+'\\b').test(source))name+='x';
  names.set(field,name);decl.push(`function ${name}(sharedRecord) { return sharedRecord.${field}; }`);
 }
 for(const m of matches.reverse())if(names.has(m.field))tokens.splice(m.start,m.end-m.start+1,names.get(m.field)+'('+m.arg+')');
 return tokens.join('').replace(root,'$1\n'+decl.join('\n')+'\n');
}
// Create/update requests always have a new data map; updates also have an old
// data map. Cache those immutable maps only in these method-specific allow
// expressions. Reads, deletes and mixed write methods retain their evaluation sites.
export function cacheWriteResourceMaps(source) {
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const changes=[];let serial=0;
 for(let i=0;i<t.length;i++) {
  if(t[i].token!=='allow')continue;
  let colon=i+1;while(colon<t.length&&t[colon].token!==':'&&t[colon].token!==';')colon++;
  if(t[colon]?.token!==':'||t[colon+1]?.token!=='if')continue;
  const methods=t.slice(i+1,colon).map(v=>v.token).filter(v=>v!==',');
  if(!methods.length||!methods.every(v=>['create','update'].includes(v)))continue;
  let end=colon+2;while(end<t.length&&t[end].token!==';')end++;
  const lookups=[];
  for(let at=colon+2;at<end;at++){
   if(t[at-1]?.token==='.')continue;
   for(const [parts,kind] of [[['request','.','resource','.','data'],'after'],[['resource','.','data'],'before']]) {
    if(kind==='before'&&!methods.every(v=>v==='update'))continue;
    if(parts.every((value,n)=>t[at+n]?.token===value)) {lookups.push({start:t[at].index,end:t[at+parts.length-1].index,kind});at+=parts.length-1;break;}
   }
  }
  const selected=lookups.filter(m=>lookups.filter(n=>n.kind===m.kind).length>=3);
  if(selected.length<8){i=end;continue;}
  let name;do{name='cachedWriteExpression'+serial++;}while(new RegExp('\\b'+name+'\\b').test(source));
  const base=t[colon+2].index,expr=tokens.slice(base,t[end].index);
  for(const m of selected.reverse())expr.splice(m.start-base,m.end-m.start+1,name+'_'+m.kind);
  const kinds=[...new Set(selected.map(m=>m.kind))];
  const declarations=kinds.map(kind=>`let ${name}_${kind} = ${kind==='after'?'request.resource.data':'resource.data'};`).join(' ');
  const header=tokens.slice(t[i].index,t[colon+2].index).join('');
  changes.push({start:t[i].index,end:t[end].index,text:`function ${name}() { ${declarations} return ${expr.join('')}; } ${header}${name}();`});i=end;
 }
 for(const c of changes.reverse())tokens.splice(c.start,c.end-c.start+1,c.text);
 return tokens.join('');
}
export function compactRuleSymbols(source){
 source=cacheWriteResourceMaps(shareDocumentReads(shareTenantPredicates(source)));
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
