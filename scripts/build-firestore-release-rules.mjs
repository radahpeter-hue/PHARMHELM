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
// Share repeated point-read path shapes, including nested state/audit documents.
// Methods, literal path segments and original interpolated expressions are retained.
export function shareDocumentReads(source) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const candidates=[],counts=new Map();
 for(let i=0;i<t.length;i++) {
  const method=t[i].token;
  if(!['get','getAfter','exists','existsAfter'].includes(method))continue;
  const prefix=[method,'(','/','databases','/','$','(','database',')','/','documents','/'];
  if(!prefix.every((value,n)=>t[i+n]?.token===value))continue;
  let end=i+12,shape='',args=[],valid=true;
  while(end<t.length&&t[end].token!==')') {
   if(t[end].token==='$'&&t[end+1]?.token==='(') {
    const start=end+2;let depth=1;end=start;
    while(end<t.length&&depth>0){if(t[end].token==='(')depth++;if(t[end].token===')')depth--;if(depth>0)end++;}
    if(depth){valid=false;break;}
    shape+='$('+`sharedDocumentId${args.length}`+')';args.push(tokens.slice(t[start].index,t[end].index).join(''));end++;
   }else if(t[end].token==='/'||/^[A-Za-z_]\w*$/.test(t[end].token)){shape+=t[end++].token;}
   else {valid=false;break;}
  }
  const data=['get','getAfter'].includes(method);
  if(!valid||!args.length||t[end]?.token!==')'||(data&&(t[end+1]?.token!=='.'||t[end+2]?.token!=='data')))continue;
  const key=method+'/'+shape;
  candidates.push({start:t[i].index,end:t[end+(data?2:0)].index,args,key,method,shape,data});
  counts.set(key,(counts.get(key)||0)+1);i=end+(data?2:0);
 }
 const helpers=new Map(),declarations=[];let serial=0;
 for(const item of candidates)if(counts.get(item.key)>=3&&!helpers.has(item.key)){
  let name;do{name='sharedDocumentRead'+serial++;}while(new RegExp('\\b'+name+'\\b').test(source));
  helpers.set(item.key,name);
  declarations.push(`function ${name}(${item.args.map((_,i)=>'sharedDocumentId'+i).join(',')}) { return ${item.method}(/databases/$(database)/documents/${item.shape})${item.data?'.data':''}; }`);
 }
 for(const item of candidates.reverse())if(helpers.has(item.key))tokens.splice(item.start,item.end-item.start+1,helpers.get(item.key)+'('+item.args.join(',')+')');
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
  if(selected.length<3){i=end;continue;}
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
// Equal-field comparisons always evaluate both map operands. Sharing the exact
// comparison reduces repeated executable nodes without eager reads across a
// short-circuit boundary. Restrict operands to plain member chains, and require
// complete expression boundaries so arithmetic/index/call suffixes stay untouched.
export function shareFieldComparisons(source) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const identifier=value=>/^[A-Za-z_]\w*$/.test(value||'');
 const chain=start=>{let end=start;if(!identifier(t[start]?.token))return null;while(t[end+1]?.token==='.'&&identifier(t[end+2]?.token))end+=2;return end>start?{start,end,field:t[end].token}:null;};
 const matches=[],counts=new Map();
 for(let i=0;i<t.length;i++) {
  const previous=t[i-1]?.token;
  if(!['return','(','?',':'].includes(previous)&&!(previous==='&'&&t[i-2]?.token==='&')&&!(previous==='|'&&t[i-2]?.token==='|'))continue;
  const left=chain(i);if(!left||t[left.end+1]?.token!=='='||t[left.end+2]?.token!=='=')continue;
  const right=chain(left.end+3);if(!right||right.field!==left.field)continue;
  const next=t[right.end+1]?.token;
  if(![')', ';', '?', ':', ','].includes(next)&&!(next==='&'&&t[right.end+2]?.token==='&')&&!(next==='|'&&t[right.end+2]?.token==='|'))continue;
  const argument=c=>tokens.slice(t[c.start].index,t[c.end-1].index).join('');
  matches.push({start:t[i].index,end:t[right.end].index,field:left.field,args:[argument(left),argument(right)]});
  counts.set(left.field,(counts.get(left.field)||0)+1);i=right.end;
 }
 const names=new Map(),decl=[];
 for(const [field,count] of counts)if(count>=4) {
  let name='sharedEqualField_'+field;while(new RegExp('\\b'+name+'\\b').test(source))name+='x';
  names.set(field,name);decl.push(`function ${name}(sharedLeft,sharedRight) { return sharedLeft.${field} == sharedRight.${field}; }`);
 }
 for(const m of matches.reverse())if(names.has(m.field))tokens.splice(m.start,m.end-m.start+1,names.get(m.field)+'('+m.args.join(',')+')');
 return tokens.join('').replace(root,'$1\n'+decl.join('\n')+'\n');
}
// Share complete, pure lookups at their original evaluation sites. Point reads
// receive the exact original path value; get/getAfter remain separate methods.
// No read is hoisted out of a conditional and missing-field errors stay errors.
export function shareRuleAtoms(source,{pointReads=true}={}) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const matches=[],definitions=new Map();
 const fixed=[['request','.','auth','.','uid'],['request','.','time'],['getUserData','(',')','.','tenantId']];
 const helper=(key,body,args='')=>{if(!definitions.has(key)){let name='sharedRuleAtom'+definitions.size;while(new RegExp('\\b'+name+'\\b').test(source))name+='x';definitions.set(key,{name,body,args});}return definitions.get(key).name;};
 for(let i=0;i<t.length;i++) {
  if(t[i-1]?.token==='.')continue;
  let found=false;
  for(const parts of fixed)if(parts.every((value,n)=>t[i+n]?.token===value)) {
   const end=i+parts.length-1;
   matches.push({start:t[i].index,end:t[end].index,text:helper(parts.join(''),parts.join(''))+'()'});i=end;found=true;break;
  }
  if(found)continue;
  if(!pointReads)continue;
  const method=t[i].token;
  if(!['get','getAfter'].includes(method)||t[i+1]?.token!=='(')continue;
  let end=i+2,depth=1;
  for(;end<t.length;end++){if(t[end].token==='(')depth++;if(t[end].token===')')depth--;if(depth===0)break;}
  if(t[end+1]?.token!=='.'||t[end+2]?.token!=='data')continue;
  const arg=tokens.slice(t[i+2].index,t[end].index).join('');
  matches.push({start:t[i].index,end:t[end+2].index,text:helper(method,method+'(sharedPointPath).data','sharedPointPath')+'('+arg+')'});i=end+2;
 }
 for(const m of matches.reverse())tokens.splice(m.start,m.end-m.start+1,m.text);
 const decl=[...definitions.values()].map(d=>`function ${d.name}(${d.args}) { return ${d.body}; }`).join('\n');
 return tokens.join('').replace(root,'$1\n'+decl+'\n');
}
// Resolve request/resource maps at the original access site. A zero-argument
// accessor shares the repeated global path without hoisting a missing-resource
// lookup across an allow guard or changing any map field or document path.
export function shareGlobalResourceMaps(source) {
 const root=/(match \/databases\/\{database\}\/documents\s*\{)/;
 if(!root.test(source))return source;
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(({token})=>!/^\s+$/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'));
 const defs=new Map(),matches=[];
 for(let i=0;i<t.length;i++) {
  if(t[i-1]?.token==='.')continue;
  for(const parts of [['request','.','resource','.','data'],['resource','.','data']]) {
   if(!parts.every((part,n)=>t[i+n]?.token===part))continue;
   const key=parts.join('');let name=defs.get(key);
   if(!name){name=key.startsWith('request')?'sharedGlobalRequestedMap':'sharedGlobalExistingMap';while(new RegExp('\\b'+name+'\\b').test(source))name+='x';defs.set(key,name);}
   matches.push({start:t[i].index,end:t[i+parts.length-1].index,name});i+=parts.length-1;break;
  }
 }
 for(const m of matches.reverse())tokens.splice(m.start,m.end-m.start+1,m.name+'()');
 const declarations=[...defs].map(([path,name])=>`function ${name}() { return ${path}; }`).join('\n');
 return tokens.join('').replace(root,'$1\n'+declarations+'\n');
}
export function compactRuleSymbols(source){
 return renameRuleSymbols(shareGlobalResourceMaps(shareFieldReads(shareRuleAtoms(shareFieldComparisons(cacheWriteResourceMaps(shareDocumentReads(shareTenantPredicates(source))))))));
}
export function renameRuleSymbols(source){
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const stripped=tokens.filter(t=>!t.startsWith('//')&&!t.startsWith('/*')).join('');
 const names=new Set(stripped.match(/\b[A-Za-z_]\w*\b/g)||[]),functions=new Map(),variables=new Map();
 const reservedPaths=new Set([...stripped.matchAll(/\/([A-Za-z_]\w*)/g)].map(m=>m[1]));
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let serial=0;
 // Pick the shortest unused identifier. The previous mandatory underscore and
 // collision suffix added bytes to every reference in the compiled executable.
 // Original identifiers (including paths, globals and keywords) stay reserved.
 const unique=()=>{for(;;){let index=serial++,name='';do{name=alphabet[index%52]+name;index=Math.floor(index/52)-1;}while(index>=0);if(names.has(name)||['as','do','if','for','in','is'].includes(name))continue;names.add(name);return name;}};
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
