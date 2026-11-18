/** Deterministic exact collection-set compaction and internal symbol renaming.
 * Paths, fields, roles and policy permissions stay intact. Collection sets become exact anchored regexes.
 * CI checks the authored source first, then tests and deploys this same generated output.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** A prefix trie encodes only the supplied literal names, with no wildcard. */
export function exactCollectionPattern(names) {
 if(!names.length||names.some(name=>!(/^[A-Za-z0-9_]+$/).test(name)))throw Error('Invalid collection name set.');
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

/** A create has an incoming document and an update has both snapshots.
 * Bind only those guaranteed snapshots, leaving reads, deletes and mixed
 * method grants alone. The predicate stays in its original match scope.
 */
export function bindWriteSnapshots(source) {
 const trivia = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
 const mask = value => value.replace(trivia, literal => ' '.repeat(literal.length));
 const masked = mask(source);
 const grants = [...masked.matchAll(/\ballow\s+(create|update)\s*:\s*if\b([^;]+);/g)];
 let serial = 0;
 const unique = label => {
  let name;
  do { name = 'release' + label + serial++; } while (source.includes(name));
  return name;
 };
 for (const grant of grants.reverse()) {
  const [statement, method, predicate] = grant;
  const start = grant.index + statement.indexOf(predicate);
  let body = source.slice(start, start + predicate.length);
  const references = [...predicate.matchAll(/\b(request\.resource\.data|resource\.data)\b/g)];
  const bindings = new Map();
  for (const snapshot of ['request.resource.data', 'resource.data']) {
   if (snapshot === 'resource.data' && method !== 'update') continue;
   if (references.filter(reference => reference[0] === snapshot).length >= 4) {
    bindings.set(snapshot, unique('Snapshot'));
   }
  }
  if (!bindings.size) continue;
  for (const reference of references.reverse()) {
   const alias = bindings.get(reference[0]);
   if (alias) body = body.slice(0, reference.index) + alias + body.slice(reference.index + reference[0].length);
  }
  const check = unique('Write');
  const declarations = [...bindings].map(([snapshot, alias]) => 'let ' + alias + ' = ' + snapshot + ';').join(' ');
  source = source.slice(0, grant.index) + 'function ' + check + '() { ' + declarations +
   ' return ' + body + '; } allow ' + method + ': if ' + check + '();' +
   source.slice(grant.index + statement.length);
 }
 return source;
}

const quotedOrComment = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const maskRulesTrivia = source => source.replace(quotedOrComment, token => ' '.repeat(token.length));
const databaseScope = /\bmatch\s+\/databases\/\{\w+\}\/documents\s*\{/;

function insertDatabaseHelpers(source, helpers) {
 const root = databaseScope.exec(maskRulesTrivia(source));
 if (!root || !helpers.length) return source;
 const offset = root.index + root[0].length;
 return source.slice(0, offset) + '\n' + helpers.join('\n') + '\n' + source.slice(offset);
}

/** Collection-specific helpers need not be inherited by every sibling match.
 * Follow the complete helper call graph to identify owning matches. A small
 * number of owners may each receive the identical helper declaration.
 * Only move declarations; do not change predicates, calls, paths or grants.
 * Ambiguous names and unfamiliar source layouts are left untouched.
 */
export function localizeCollectionHelpers(source, maxOwners = 1) {
 const masked = maskRulesTrivia(source);
 const blocks = pattern => [...masked.matchAll(pattern)].map(header => {
  let end = header.index + header[0].length, depth = 1;
  for (; end < masked.length && depth; end++) {
   if (masked[end] === '{') depth++;
   if (masked[end] === '}') depth--;
  }
  if (depth) throw Error('Unbalanced rules block.');
  return Object.assign([masked.slice(header.index,end),header[1]],{index:header.index});
 });
 const functions = new Map(blocks(/^    function (\w+)\([^\n]*\) \{/gm).map(m => [m[1], m]));
 const matches = blocks(/^    match [^\n]+ \{/gm);
 if (!functions.size || !matches.length) return source;
 const calls = (text, name) => new RegExp('(?<![.\\w])' + name + '\\s*\\(').test(text);
 const owners = new Map([...functions.keys()].map(name => [name, new Set()]));
 for (const [name] of functions) {
  for (const [index, match] of matches.entries()) if (calls(match[0], name)) owners.get(name).add(index);
 }
 for (let pass = 0; pass < functions.size; pass++) {
  for (const [parent, declaration] of functions) {
   const body = declaration[0].slice(declaration[0].indexOf('{') + 1);
   for (const [child] of functions) if (calls(body, child)) {
    for (const owner of owners.get(parent)) owners.get(child).add(owner);
   }
  }
 }
 let remaining = masked;
 for (const block of [...functions.values(), ...matches].sort((a, b) => b.index - a.index)) {
  remaining = remaining.slice(0, block.index) + ' '.repeat(block[0].length) + remaining.slice(block.index + block[0].length);
 }
 const candidates = new Map();
 for (const [name, declaration] of functions) {
  const targets = owners.get(name);
  if (!targets.size || targets.size > maxOwners) continue;
  const parameters = declaration[0].match(/^    function \w+\(([^)]*)\)/)[1].split(',').map(s=>s.trim());
  const ownBindings = new Set([...parameters,...[...declaration[0].matchAll(/\blet\s+(\w+)/g)].map(m=>m[1])]);
  // No newly visible binding may shadow a name referenced by the helper.
  const targetMatches = [...targets].map(index=>matches[index]);
  if (targetMatches.some(target=>{
   const localNames = [...target[0].matchAll(/\b(?:function|let)\s+(\w+)|\{(\w+)(?:=\*\*)?\}/g)].map(m => m[1] || m[2]);
   return localNames.includes(name) || localNames.some(local => !ownBindings.has(local) && new RegExp('\\b' + local + '\\b').test(declaration[0]));
  })) continue;
  // Every reference must be accounted for by the parsed function/match graph.
  if (calls(remaining, name)) continue;
  candidates.set(name,{declaration,targets:targetMatches});
 }
 // A helper retained at root must still be able to resolve all its callees.
 for (let pass = 0; pass < functions.size; pass++) {
  for (const [child] of candidates) {
   if ([...functions].some(([parent, declaration]) => !candidates.has(parent) && calls(declaration[0].slice(declaration[0].indexOf('{')+1), child))) candidates.delete(child);
  }
 }
 const replacements = [], insertions = new Map();
 for (const {declaration,targets} of candidates.values()) {
  const text = source.slice(declaration.index, declaration.index + declaration[0].length);
  replacements.push({from:declaration.index,to:declaration.index + declaration[0].length,text:''});
  for(const target of targets){
   const offset = target.index + target[0].indexOf('{', target[0].indexOf(' {')) + 1;
   if (!insertions.has(offset)) insertions.set(offset, []);
   insertions.get(offset).push(text.replace(/^/gm, '  '));
  }
 }
 for (const [from, declarations] of insertions) replacements.push({from,to:from,text:'\n' + declarations.join('\n') + '\n'});
 for (const {from,to,text} of replacements.sort((a,b) => b.from - a.from)) source = source.slice(0,from) + text + source.slice(to);
 return source;
}

/** Reassociate long homogeneous boolean chains into shallow trees. Operand
 * order and short-circuit behavior stay unchanged; ternary precedence and
 * function argument boundaries are preserved.
 */
export function balanceBooleanChains(source) {
 const positions = (value, operator) => {
  const masked = maskRulesTrivia(value), found = [];let depth=0;
  for(let i=0;i<masked.length;i++){
   if('([{'.includes(masked[i]))depth++;
   else if(')]}'.includes(masked[i]))depth--;
   else if(!depth&&masked.startsWith(operator,i)){found.push(i);i+=operator.length-1;}
  }
  return found;
 };
 const divide=(value,at,width)=>{let start=0;const parts=[];for(const index of at){parts.push(value.slice(start,index));start=index+width;}parts.push(value.slice(start));return parts;};
 const rewrite = value => {
  const masked=maskRulesTrivia(value);let result='',start=0;
  for(let i=0;i<masked.length;i++)if(masked[i]==='('){
   let end=i+1,depth=1;
   for(;end<masked.length&&depth;end++){if(masked[end]==='(')depth++;if(masked[end]===')')depth--;}
   if(depth)throw Error('Unbalanced boolean expression.');
   result+=value.slice(start,i+1)+rewrite(value.slice(i+1,end-1))+')';start=end;i=end-1;
  }
  value=result+value.slice(start);
  const commas=positions(value,',');
  if(commas.length)return divide(value,commas,1).map(rewrite).join(',');
  if(positions(value,'?').length)return value;
  for(const operator of ['||','&&']){
   const at=positions(value,operator);if(!at.length)continue;
   const parts=divide(value,at,2).map(rewrite);
   if(parts.length<8)return parts.join(operator);
   const tree=(from,to)=>to-from===1?parts[from]:'('+tree(from,Math.floor((from+to)/2))+operator+tree(Math.floor((from+to)/2),to)+')';
   return tree(0,parts.length);
  }
  return value;
 };
 const masked=maskRulesTrivia(source);
 const statements=[...masked.matchAll(/\breturn\b([^;]+);|\ballow\s+[a-z, ]+:\s*if\b([^;]+);/g)];
 for(const statement of statements.reverse()){
  const body=statement[1]??statement[2],from=statement.index+statement[0].indexOf(body);
  source=source.slice(0,from)+rewrite(source.slice(from,from+body.length))+source.slice(from+body.length);
 }
 return source;
}

/** Share the invariant database/documents path prefix. Each literal collection,
 * document expression and get/getAfter call is retained at its original site.
 */
export function shareDocumentPaths(source) {
 const masked=maskRulesTrivia(source),database=masked.match(/match\s+\/databases\/\{(\w+)\}\/documents\s*\{/)?.[1];
 if(!database)return source;
 let name='releaseDocumentPath',serial=0;
 while(source.includes(name))name='releaseDocumentPath'+serial++;
 const replacements=[],methods=new Set();let coveredUntil=0;
 for(const head of masked.matchAll(/\/databases\/\$\((\w+)\)\/documents\/([A-Za-z_]\w*)\/\$\(/g)){
  // Authority checks are evaluated frequently on complex inventory writes.
  // Keep their direct lookups to preserve the existing expression budget.
  if(head[1]!==database||head.index<coveredUntil||['staff','system_settings','branches'].includes(head[2]))continue;
  const start=head.index+head[0].length;let end=start,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='(')depth++;if(masked[end]===')')depth--;}
  if(depth)throw Error('Unbalanced document path.');
  // Never rewrite a prefix of a deeper subcollection path.
  if(masked[end]==='/')continue;
  const prefix=masked.slice(0,head.index).match(/(?<![.\w])(get|getAfter)\(\s*$/),suffix=masked.slice(end).match(/^\s*\)\s*\.data\b/);
  const method=prefix&&suffix?prefix[1]:null;
  const from=method?head.index-prefix[0].length:head.index,to=method?end+suffix[0].length:end;
  if(method)methods.add(method);
  replacements.push({from,to,text:name+(method==='get'?'Before':method==='getAfter'?'After':'')+"('"+head[2]+"',"+source.slice(start,end-1)+')'});
  coveredUntil=to;
 }
 if(replacements.length<2)return source;
 for(const {from,to,text} of replacements.reverse())source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,[`function ${name}(collection, id) { return /databases/$(${database})/documents/$(collection)/$(id); }`,
  ...[...methods].map(method=>`function ${name}${method==='get'?'Before':'After'}(collection,id) { return ${method}(/databases/$(${database})/documents/$(collection)/$(id)).data; }`)]);
}

/** Reuse pure values required by an unconditional conjunct. A successful rule
 * must evaluate that conjunct already. Never hoist out of an OR or ternary.
 * Keep the language's ten-let limit and all validation predicates intact.
 */
export function memoizeRequiredExpressions(source) {
 const masked=maskRulesTrivia(source),functions=[];let serial=0;
 for(const head of masked.matchAll(/\bfunction\s+\w+\([^)]*\)\s*\{/g)){
  const from=head.index+head[0].length;let end=from,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  if(depth)throw Error('Unbalanced memoization function.');
  functions.push({from,to:end-1});
 }
 const topOperators = value => {
  const text=maskRulesTrivia(value),and=[];let depth=0;
  for(let i=0;i<text.length;i++){
   if('([{'.includes(text[i]))depth++;
   else if(')]}'.includes(text[i]))depth--;
   else if(!depth){if(text.startsWith('||',i)||text[i]==='?')return null;if(text.startsWith('&&',i)){and.push(i);i++;}}
  }
  const parts=[];let start=0;for(const at of and){parts.push(value.slice(start,at));start=at+2;}parts.push(value.slice(start));return parts;
 };
 const candidates = value => {
  const masked=maskRulesTrivia(value),items=[];
  for(const head of masked.matchAll(/(?<![.\w])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(/g)){
   let end=head.index+head[0].length,depth=1;
   for(;end<masked.length&&depth;end++){if(masked[end]==='(')depth++;if(masked[end]===')')depth--;}
   if(!depth)items.push({from:head.index,to:end,text:value.slice(head.index,end),call:true});
  }
  for(const match of masked.matchAll(/(?<![.\w])[A-Za-z_]\w*\.[A-Za-z_]\w*\b(?![.\w]|\s*\()/g))items.push({from:match.index,to:match.index+match[0].length,text:value.slice(match.index,match.index+match[0].length),call:false});
  return items;
 };
 for(const fn of functions.reverse()){
  let body=source.slice(fn.from,fn.to),mask=maskRulesTrivia(body);
  const returned=/\breturn\b([^;]+);/.exec(mask);if(!returned)continue;
  const offset=returned.index+returned[0].indexOf(returned[1]);
  let expression=body.slice(offset,offset+returned[1].length),slots=10-[...mask.matchAll(/\blet\b/g)].length;
  const bindings=[];
  while(slots-->0){
   const parts=topOperators(expression);if(!parts)break;
   const required=new Set(parts.filter(part=>!/[?|]/.test(maskRulesTrivia(part))).flatMap(candidates).map(item=>item.text));
   const all=candidates(expression),groups=new Map();
   for(const item of all){if(!required.has(item.text))continue;if(!groups.has(item.text))groups.set(item.text,[]);groups.get(item.text).push(item);}
   const ranked=[...groups.values()].filter(items=>items.length>=(items[0].call?(items[0].text.length>=24?2:3):(items[0].text.split('.')[1].length>=8?3:4))).sort((a,b)=>(b.length-1)*b[0].text.length-(a.length-1)*a[0].text.length);
   if(!ranked.length)break;
   const items=ranked[0];let name;
   do{name='releaseMemo'+serial++;}while(source.includes(name));
   bindings.push(`let ${name} = ${items[0].text};`);
   for(const item of items.reverse())expression=expression.slice(0,item.from)+name+expression.slice(item.to);
  }
  if(!bindings.length)continue;
  body=body.slice(0,returned.index)+bindings.join(' ')+' return'+expression+body.slice(offset+returned[1].length);
  source=source.slice(0,fn.from)+body+source.slice(fn.to);
 }
 return source;
}

/** Identical leaf policies can share one exact collection guard. Only blocks
 * containing grants, without local helpers or wildcard references, qualify.
 * Append grouped policies after existing grants to preserve fast paths.
 */
export function groupEquivalentCollections(source) {
 const masked=maskRulesTrivia(source),groups=new Map();let serial=0;
 for(const head of masked.matchAll(/^    match \/([A-Za-z_]\w*)\/\{(\w+)\}\s*\{/gm)){
  const from=head.index+head[0].length;let end=from,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  if(depth)throw Error('Unbalanced collection policy.');
  const bodyMask=masked.slice(from,end-1),body=source.slice(from,end-1);
  if(!/^\s*(?:allow\s+[a-z, ]+:\s*if\s+[^;]+;\s*)+$/.test(bodyMask))continue;
  if(new RegExp('(?<!\\.)\\b'+head[2]+'\\b').test(bodyMask))continue;
  const key=(body.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_0-9]+|\S/g)||[]).filter(token=>!token.startsWith('//')&&!token.startsWith('/*')).join(' ');
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({from:head.index,to:end,body,bodyMask,collection:head[1]});
 }
 const removals=[],policies=[];
 for(const members of groups.values()){
  if(members.length<2)continue;
  let guard,collection,document;
  do{const suffix=serial++;guard='releaseGroupGuard'+suffix;collection='releaseGroupCollection'+suffix;document='releaseGroupDocument'+suffix;}while([guard,collection,document].some(name=>source.includes(name)));
  const first=members[0];let body=first.body;
  for(const grant of [...first.bodyMask.matchAll(/\ballow\s+[a-z, ]+:\s*if\s+/g)].reverse()){
   const at=grant.index+grant[0].length;body=body.slice(0,at)+guard+'() && ('+body.slice(at);
   // Match the original predicate terminator in the suffix, ignoring strings.
   const end=maskRulesTrivia(body).indexOf(';',at);body=body.slice(0,end)+')'+body.slice(end);
  }
  const names=[...new Set(members.map(member=>member.collection))];
  policies.push(`    match /{${collection}}/{${document}} {\n      function ${guard}() { return ${collection}.matches('${exactCollectionPattern(names)}'); }\n${body}\n    }`);
  removals.push(...members);
 }
 if(!policies.length)return source;
 for(const {from,to} of removals.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+source.slice(to);
 const root=databaseScope.exec(maskRulesTrivia(source));if(!root)throw Error('Missing database scope.');
 const start=root.index+root[0].length;let end=start,depth=1;const remaining=maskRulesTrivia(source);
 for(;end<remaining.length&&depth;end++){if(remaining[end]==='{')depth++;if(remaining[end]==='}')depth--;}
 return source.slice(0,end-1)+'\n'+policies.join('\n')+'\n'+source.slice(end-1);
}

/** Move identical direct grants into shared predicates. Keep every allow at its
 * original path and method. Expressions capturing a match variable or a local
 * function stay in place so the shared predicate has the same lexical scope.
 */
export function shareRepeatedAllowConditions(source) {
 const masked = maskRulesTrivia(source);
 if (!databaseScope.test(masked)) return source;
 const groups = new Map();
 const tokens = new RegExp(quotedOrComment.source + '|[A-Za-z_0-9]+|\\S', 'g');
 for (const match of masked.matchAll(/^    match \/[A-Za-z0-9_]+\/\{(\w+)\} \{\n([\s\S]*?)\n    }/gm)) {
  const [, wildcard, body] = match;
  const localNames = [wildcard, ...Array.from(body.matchAll(/\bfunction\s+(\w+)\s*\(/g), fn => fn[1])];
  const start = match.index + match[0].indexOf('\n') + 1;
  for (const grant of body.matchAll(/^      allow\s+[a-z, ]+:\s*if\s+([^;]+);/gm)) {
   const predicate = grant[1];
   if (localNames.some(name => new RegExp('(?<!\\.)\\b' + name + '\\b').test(predicate))) continue;
   const from = start + grant.index + grant[0].indexOf(predicate);
   const text = source.slice(from, from + predicate.length);
   const key = (text.match(tokens) || []).filter(token => !token.startsWith('//') && !token.startsWith('/*')).join(' ');
   if (key.length <= 65) continue;
   if (!groups.has(key)) groups.set(key, []);
   groups.get(key).push({ from, text });
  }
 }
 const helpers = [], replacements = [];
 let serial = 0;
 for (const grants of groups.values()) {
  if (grants.length < 2) continue;
  let name;
  do { name = 'releaseSharedAllow' + serial++; } while (source.includes(name));
  helpers.push('function ' + name + '() { return ' + grants[0].text + '; }');
  for (const grant of grants) replacements.push({ ...grant, name });
 }
 for (const { from, text, name } of replacements.sort((a, b) => b.from - a.from)) {
  source = source.slice(0, from) + name + '()' + source.slice(from + text.length);
 }
 return insertDatabaseHelpers(source, helpers);
}

/** Share frequently compiled request paths without binding them eagerly.
 * This preserves short-circuit evaluation when a read has no write snapshot or
 * a request has no auth object.
 */
export function shareRequestExpressions(source) {
 const masked = maskRulesTrivia(source);
 if (!databaseScope.test(masked)) return source;
 const paths = [...masked.matchAll(/(?<![.\w])(?:isTenantMember\((?:request\.)?resource\.data\.tenantId\)|(?:(?:request\.)?resource\.data(?:\.(?:tenantId|branchId|status|inventoryClass))?|request\.auth\.uid|request\.time)\b)/g)];
 const helpers = new Map();
 let serial = 0;
 for (const match of paths.reverse()) {
  const [path] = match;
  if (!helpers.has(path)) {
   let name;
   do { name = 'releaseRequestPath' + serial++; } while (source.includes(name));
   helpers.set(path, name);
  }
  source = source.slice(0, match.index) + helpers.get(path) + '()' + source.slice(match.index + path.length);
 }
 return insertDatabaseHelpers(source, [...helpers].map(([path, name]) => 'function ' + name + '() { return ' + path + '; }'));
}

/** Reconstruct static lists exactly while reducing literal AST nodes. */
export function packStringArrays(source){
 return source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\[(\s*'[^'\\\r\n]*'(?:\s*,\s*'[^'\\\r\n]*')+\s*,?\s*)\]/g,(literal,list)=>{
  if(list===undefined)return literal;
  const values=[...list.matchAll(/'([^'\\\r\n]*)'/g)].map(match=>match[1]);
  if(values.length<4||values.some(value=>value===''))return literal;
  const separator=['~','#',';','%','!','@',',',':','=','_','-'].find(char=>values.every(value=>!value.includes(char)));
  return separator?"'"+values.join(separator)+"'.split('"+separator+"')":literal;
 });
}

export function shareSnapshotReaders(source){
 const masked=maskRulesTrivia(source),changes=[],used=new Set();let covered=0,prefix='releaseSnapshotData';
 if(!databaseScope.test(masked))return source;
 while(source.includes(prefix))prefix+='X';
 for(const head of masked.matchAll(/(?<![.\w])(get|getAfter)\s*\(/g)){
  if(head.index<covered)continue;
  const from=head.index+head[0].length;let end=from,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='(')depth++;if(masked[end]===')')depth--;}
  if(depth)throw Error('Unbalanced snapshot read.');
  if(masked.slice(from,end-1).trim().startsWith('/'))continue;
  const suffix=masked.slice(end).match(/^\s*\.data\b/);if(!suffix)continue;
  const name=prefix+(head[1]==='get'?'Before':'After');
  changes.push({from:head.index,to:end+suffix[0].length,text:name+'('+source.slice(from,end-1)+')'});
  used.add(head[1]);covered=end+suffix[0].length;
 }
 if(!changes.length)return source;
 for(const {from,to,text} of changes.reverse())source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,[...used].map(method=>'function '+prefix+(method==='get'?'Before':'After')+'(path) { return ('+method+'(path)).data; }'));
}

export function shareSchemaChecks(source){
 const masked=maskRulesTrivia(source),changes=[],used=new Set();let covered=0,prefix='releaseSchemaCheck';
 if(!databaseScope.test(masked))return source;
 while(source.includes(prefix))prefix+='X';
 const argumentEnd=start=>{let end=start,depth=1;for(;end<masked.length&&depth;end++){if(masked[end]==='(')depth++;if(masked[end]===')')depth--;}if(depth)throw Error('Unbalanced schema check.');return end;};
 for(const head of masked.matchAll(/(?<![.\w])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.(keys\s*\(\s*\)\s*\.hasOnly|diff)\s*\(/g)){
  if(head.index<covered)continue;
  const from=head.index+head[0].length,firstEnd=argumentEnd(from),diff=head[2]==='diff';
  let fieldsFrom=from,fieldsEnd=firstEnd,before='';
  if(diff){
   const suffix=masked.slice(firstEnd).match(/^\s*\.affectedKeys\s*\(\s*\)\s*\.hasOnly\s*\(/);if(!suffix)continue;
   before=source.slice(from,firstEnd-1);
   fieldsFrom=firstEnd+suffix[0].length;fieldsEnd=argumentEnd(fieldsFrom);
  }
  const name=prefix+(diff?'Changes':'Keys'),fields=source.slice(fieldsFrom,fieldsEnd-1);
  changes.push({from:head.index,to:fieldsEnd,text:name+'('+head[1]+','+(diff?before+',':'')+fields+')'});
  used.add(diff?'Changes':'Keys');covered=fieldsEnd;
 }
 if(!changes.length)return source;
 for(const {from,to,text} of changes.reverse())source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,[...used].map(kind=>kind==='Keys'?'function '+prefix+'Keys(data, fields) { return (data.keys()).hasOnly(fields); }':'function '+prefix+'Changes(after, before, fields) { return (after.diff(before).affectedKeys()).hasOnly(fields); }'));
}

export function shareRepeatedStringValues(source){
 // Keep hot authority, inventory fields and inventory paths inline: nested transfer checks approach the evaluation limit.
 const masked=maskRulesTrivia(source),groups=new Map(),excluded=new Set(['assigned_branches','secondaryRoles','default_branch_id','branch_id','tenantId','active','status','is_duplicate','inventoryClass','transferType','masterItemId','deliveryRoute','BRANCH_RETURN','Finance Head','Branch Manager','branch manager','Procurement Head','Procurement Officer','Procurement Manager']);
 if(!databaseScope.test(masked))return source;
 for(const match of source.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g)){
  const literal=match[0];if(!["'",'"'].includes(literal[0])||literal.length<14)continue;
  if(/[A-Za-z0-9_]/.test(source[match.index-1]||'')||masked.slice(match.index+literal.length).match(/\S/)?.[0]===':')continue;
  if(excluded.has(literal.slice(1,-1))||/^(?:operational_|stock_orders$|opening_stock_sessions$)/.test(literal.slice(1,-1)))continue;
  if(!groups.has(literal))groups.set(literal,[]);groups.get(literal).push(match.index);
 }
 const changes=[],helpers=[];let serial=0;
 for(const [literal,positions] of groups){
  if(positions.length<3||(literal.length-4)*(positions.length-1)-28<40)continue;
  let name;do{name='releaseStringValue'+serial++;}while(source.includes(name));
  helpers.push('function '+name+'() { return '+literal+'; }');
  for(const from of positions)changes.push({from,to:from+literal.length,text:name+'()'});
 }
 for(const {from,to,text} of changes.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,helpers);
}

export function compactRuleSymbols(source,{maxLocalOwners=1,sharePaths=true,memoize=true,balanceConditions=true,groupCollections=true,packArrays=true,shareReaders=true,shareSchemas=true,shareConstants=true}={}){
 if(shareReaders)source=shareSnapshotReaders(source);
 if(shareSchemas)source=shareSchemaChecks(source);
 if(sharePaths)source=shareDocumentPaths(source);
 source=localizeCollectionHelpers(source,maxLocalOwners);
 source=shareRepeatedAllowConditions(source);
 if(groupCollections)source=groupEquivalentCollections(source);
 source=shareRequestExpressions(compactCollectionSets(bindWriteSnapshots(source)));
 if(memoize)source=memoizeRequiredExpressions(source);
 if(packArrays)source=packStringArrays(source);
 if(shareConstants){source=shareRepeatedStringValues(source);if(memoize)source=memoizeRequiredExpressions(source);}
 if(balanceConditions)source=balanceBooleanChains(source);
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const stripped=tokens.filter(t=>!t.startsWith('//')&&!t.startsWith('/*')).join('');
 const names=new Set(tokens.filter(token=>/^[A-Za-z_]\w*$/.test(token))),symbols=new Set(),aliases=new Map();
 const reservedPaths=new Set([...stripped.matchAll(/\/([A-Za-z_]\w*)/g)].map(m=>m[1]));
 for(const keyword of ['as','break','const','continue','do','else','for','function','if','in','is','let','match','return','service','true','false','null','rules_version','while'])names.add(keyword);
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let serial=0;
 const unique=()=>{for(;;){let index=serial++,name='';do{name=alphabet[index%52]+name;index=Math.floor(index/52)-1;}while(index>=0);if(!names.has(name)){names.add(name);return name;}}};
 // Rule methods can also be local binding names. Keep the method token intact.
 const ruleMethods=new Set(['read','write','get','list','create','update','delete']);
 const addBinding=name=>{if(name&&!reservedPaths.has(name)&&!ruleMethods.has(name))symbols.add(name);};
 for(const m of stripped.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)){
  symbols.add(m[1]);
  for(const name of m[2].split(',').map(s=>s.trim()).filter(Boolean))addBinding(name);
 }
 for(const m of stripped.matchAll(/\blet\s+([A-Za-z_]\w*)\s*=/g))addBinding(m[1]);
 for(const m of stripped.matchAll(/\{([A-Za-z_]\w*)(?:=\*\*)?\}/g))addBinding(m[1]);
 // Frequent bindings such as the database wildcard save more compiled bytes
 // than declarations visited early. Keep aliases globally unique as before.
 const counts=new Map();let last='';
 for(const token of tokens){
  if(/^\s+$/.test(token)||token.startsWith('//')||token.startsWith('/*'))continue;
  if(last!=='.'&&symbols.has(token))counts.set(token,(counts.get(token)||0)+1);
  last=token;
 }
 for(const name of [...symbols].sort((a,b)=>(counts.get(b)||0)-(counts.get(a)||0)))aliases.set(name,unique());
 let previous='';const output=[];
 for(const token of tokens){
  if(token.startsWith('//')||token.startsWith('/*')){output.push(' ');continue;}
  if(/^\s+$/.test(token)){output.push(' ');continue;}
  const internal=/^[A-Za-z_]\w*$/.test(token)&&previous!=='.';
  output.push(internal?(aliases.get(token)||token):token);previous=token;
 }
 return output.join('').trim();
}

/** Keep source positions compact as well as identifiers. Replace only existing
 * whitespace in comment-free compiler output, preserving every literal/token.
 */
export function wrapReleaseColumns(source,width=80){
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\s+|[^\s'"]+/g)||[];
 let output='',column=0,pending=false;
 for(const token of tokens){
  if(/^\s+$/.test(token)){pending=true;continue;}
  if(pending&&output){if(column+1+token.length>width){output+='\n';column=0;}else{output+=' ';column++;}}
  output+=token;column+=token.length;pending=false;
 }
 return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2]||'firestore.rules',source=readFileSync(file,'utf8'),output=wrapReleaseColumns(compactRuleSymbols(source));
 writeFileSync(file,output+'\n');console.log(`Generated equivalent release rules: ${Buffer.byteLength(source)} → ${Buffer.byteLength(output)+1} source bytes.`);
}
