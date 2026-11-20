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
// Preserve direct reads and original snapshot binding in the busiest atomic
// inventory and Treasury validators; these approach Firestore's 1000-step cap.
function budgetSensitiveRanges(mask){
 const ranges=[];
 for(const head of mask.matchAll(/^    match \/(?:identity_sequence_counters|operational_\w+|stock_orders|stock_order_lines|grn_records|transfer_invoices|transfer_invoice_lines|finance_transfers_v1)\/\{\w+\}\s*\{/gm)){
  let end=head.index+head[0].length,depth=1;for(;end<mask.length&&depth;end++){if(mask[end]==='{')depth++;if(mask[end]==='}')depth--;}
  ranges.push({from:head.index,to:end});
 }
 const declarations=[];
 for(const head of mask.matchAll(/\bfunction\s+(\w+)\([^)]*\)\s*\{/g)){
  let end=head.index+head[0].length,depth=1;for(;end<mask.length&&depth;end++){if(mask[end]==='{')depth++;if(mask[end]==='}')depth--;}
  declarations.push({name:head[1],from:head.index,to:end,body:mask.slice(head.index+head[0].length,end-1)});
 }
 const calls=value=>[...value.matchAll(/(?<![.\w])(\w+)\s*\(/g)].map(m=>m[1]);
 const needed=new Set(ranges.flatMap(r=>calls(mask.slice(r.from,r.to))));
 for(let pass=0;pass<declarations.length;pass++){
  const size=needed.size;
  for(const d of declarations)if(needed.has(d.name))for(const name of calls(d.body))needed.add(name);
  if(size===needed.size)break;
 }
 for(const d of declarations)if(needed.has(d.name))ranges.push({from:d.from,to:d.to});
 return ranges;
}

export function shareRequestExpressions(source,{preserveBudget=false}={}) {
 const masked = maskRulesTrivia(source);
 if (!databaseScope.test(masked)) return source;
 const protectedRanges=preserveBudget?budgetSensitiveRanges(masked):[];
 const paths = [...masked.matchAll(/(?<![.\w])(?:isTenantMember\((?:request\.)?resource\.data\.tenantId\)|(?:(?:request\.)?resource\.data(?:\.(?:tenantId|branchId|status|inventoryClass))?|request\.auth\.uid|request\.time)\b)/g)];
 const helpers = new Map();
 let serial = 0;
 for (const match of paths.reverse()) {
  if(protectedRanges.some(r=>match.index>=r.from&&match.index<r.to))continue;
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
 const masked=maskRulesTrivia(source),groups=new Map(),excluded=new Set(['assigned_branches','secondaryRoles','default_branch_id','branch_id','tenantId','active','status','is_duplicate','transferType','masterItemId','deliveryRoute','BRANCH_RETURN']);
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

export function omitNeverAllow(source){
 let masked=maskRulesTrivia(source);const pattern=/\ballow\s+(?:read|write|get|list|create|update|delete)(?:\s*,\s*(?:read|write|get|list|create|update|delete))*\s*:\s*if\s+false\s*;/g;
 const matches=[...masked.matchAll(pattern)];
 for(const match of matches.reverse())source=source.slice(0,match.index)+source.slice(match.index+match[0].length);
 // Firestore requires a declaration in every match, including deny-only scopes.
 masked=maskRulesTrivia(source);const empty=[];
 for(const header of masked.matchAll(/\bmatch\s+[^\n]*? \{/g)){
  const start=header.index+header[0].length;let end=start,depth=1;
  for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  if(!depth&&!masked.slice(start,end-1).trim())empty.push({from:start,to:end-1});
 }
 for(const range of empty.reverse())source=source.slice(0,range.from)+' allow read, write: if false; '+source.slice(range.to);
 return source;
}

/** Share literal field names through pure accessors. The lookup remains at
 * its original expression position, including conditional branches. */
export function shareFieldReaders(source){
 const masked=maskRulesTrivia(source),groups=new Map();
 if(!databaseScope.test(masked))return source;
 const protectedRanges=budgetSensitiveRanges(masked).filter(r=>!/^\s*match\s+\/(?:operational_\w+|stock_orders|stock_order_lines|grn_records|transfer_invoices|transfer_invoice_lines)\//.test(masked.slice(r.from,r.to)));
 const authorityEnd=masked.indexOf('function isPOSOperator(');
 if(authorityEnd>0)protectedRanges.push({from:0,to:authorityEnd});
 for(const head of masked.matchAll(/\bfunction\s+operationalIdentity\w+\([^)]*\)\s*\{/g)){
  let end=head.index+head[0].length,depth=1;for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  protectedRanges.push({from:head.index,to:end});
 }
 const excluded=new Set(['resource','data','auth','token','time']);
 for(const m of masked.matchAll(/(?<![.\w])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w{2,})\b(?![\w]|\s*\()/g)){
  if(excluded.has(m[2])||protectedRanges.some(r=>m.index>=r.from&&m.index<r.to))continue;
  if(!groups.has(m[2]))groups.set(m[2],[]);
  groups.get(m[2]).push({from:m.index,to:m.index+m[0].length,base:m[1]});
 }
 const changes=[],helpers=[];let serial=0;
 for(const [field,items] of groups){
  if(items.length<4)continue;
  let name;do{name='releaseFieldReader'+serial++;}while(source.includes(name));
  helpers.push('function '+name+'(value) { return value.'+field+'; }');
  for(const item of items)changes.push({...item,text:name+'('+item.base+')'});
 }
 for(const {from,to,text} of changes.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,helpers);
}

export function shareRequestFields(source){
 const masked=maskRulesTrivia(source),groups=new Map();
 const protectedRanges=budgetSensitiveRanges(masked);
 for(const m of masked.matchAll(/(?<![.\w])(?:request\.)?resource\.data\.[A-Za-z_]\w*\b(?![\w]|\s*\()/g)){
  if(protectedRanges.some(r=>m.index>=r.from&&m.index<r.to))continue;
  if(!groups.has(m[0]))groups.set(m[0],[]);groups.get(m[0]).push(m.index);
 }
 const changes=[],helpers=[];let serial=0;
 for(const [path,positions] of groups){
  if(positions.length<3)continue;
  let name;do{name='releaseRequestField'+serial++;}while(source.includes(name));
  helpers.push('function '+name+'() { return '+path+'; }');
  for(const from of positions)changes.push({from,to:from+path.length,text:name+'()'});
 }
 for(const {from,to,text} of changes.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,helpers);
}

/** A vector comparison retains every corresponding required equality. */
export function packEqualityConjunctions(source,{booleanChoices=false}={}){
 const splitTop=(value,operator)=>{
  const mask=maskRulesTrivia(value);let depth=0,start=0;const parts=[];
  for(let i=0;i<mask.length;i++){
   if('([{'.includes(mask[i]))depth++;
   else if(')]}'.includes(mask[i]))depth--;
   else if(!depth&&mask.startsWith(operator,i)){parts.push(value.slice(start,i));start=i+operator.length;i+=operator.length-1;}
  }
  parts.push(value.slice(start));return parts;
 };
 const unparen=value=>{
  const text=value.trim(),mask=maskRulesTrivia(text);if(mask[0]!=='(')return null;
  let depth=0;
  for(let i=0;i<mask.length;i++){if(mask[i]==='(')depth++;if(mask[i]===')')depth--;if(depth===0)return i===mask.length-1?text.slice(1,-1):null;}
  return null;
 };
 const ternary=value=>{
  const mask=maskRulesTrivia(value);let depth=0,question=-1,nested=0;
  for(let i=0;i<mask.length;i++){
   if('([{'.includes(mask[i]))depth++;
   else if(')]}'.includes(mask[i]))depth--;
   else if(!depth){
    if(mask[i]==='?'){if(question<0)question=i;else nested++;}
    else if(mask[i]===':'&&question>=0){if(nested)nested--;else return [value.slice(0,question),value.slice(question+1,i),value.slice(i+1)];}
   }
  }
  return null;
 };
 const masked=maskRulesTrivia(source),functions=[];
 for(const h of masked.matchAll(/\bfunction\s+(\w+)\([^)]*\)\s*\{/g)){
  let end=h.index+h[0].length,depth=1;for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  functions.push({name:h[1],from:h.index,to:end});
 }
 const scalarRanges=[];
 for(const head of masked.matchAll(/^    match \/(?:identity_sequence_counters)\/\{\w+\}\s*\{/gm)){
  let end=head.index+head[0].length,depth=1;for(;end<masked.length&&depth;end++){if(masked[end]==='{')depth++;if(masked[end]==='}')depth--;}
  scalarRanges.push({from:head.index,to:end});
 }
 const names=new Set(functions.map(f=>f.name)),unsafe=new Set();
 for(const name of names)if(functions.filter(f=>f.name===name).length>1)unsafe.add(name);
 for(const f of functions)if(scalarRanges.some(r=>f.from>=r.from&&f.from<r.to))unsafe.add(f.name);
 const calls=value=>[...maskRulesTrivia(value).matchAll(/(?<![.\w])(\w+)\s*\(/g)].map(m=>m[1]).filter(n=>names.has(n));
 const unsafeCalls=value=>{
  const inner=unparen(value);if(inner!==null)return unsafeCalls(inner);
  if(splitTop(value,',').length>1)return calls(value);
  const choice=ternary(value);if(choice)return booleanChoices?[...calls(choice[0]),...unsafeCalls(choice[1]),...unsafeCalls(choice[2])]:calls(value);
  for(const op of ['||','&&']){const parts=splitTop(value,op);if(parts.length>1)return parts.flatMap(unsafeCalls);}
  const text=maskRulesTrivia(value).trim(),head=/^(\w+)\s*\(/.exec(text);
  if(head&&names.has(head[1])){
   const start=head[0].length;let end=start,depth=1;
   for(;end<text.length&&depth;end++){if(text[end]==='(')depth++;if(text[end]===')')depth--;}
   if(!depth&&end===text.length)return calls(text.slice(start,end-1));
  }
  return calls(value);
 };
 const statements=[...masked.matchAll(/\breturn\b([^;]+);|\ballow\s+[a-z, ]+:\s*if\b([^;]+);|\blet\s+\w+\s*=([^;]+);/g)];
 const parsed=statements.map(m=>{
  const body=m[1]??m[2]??m[3],from=m.index+m[0].indexOf(body);
  const owner=functions.find(f=>m.index>f.from&&m.index<f.to)?.name;
  return {from,to:from+body.length,body:source.slice(from,from+body.length),owner,positive:m[3]===undefined};
 });
 for(const st of parsed)if(scalarRanges.some(r=>st.from>=r.from&&st.from<r.to))for(const name of calls(st.body))unsafe.add(name);
 for(const st of parsed)for(const name of st.positive?unsafeCalls(st.body):calls(st.body))unsafe.add(name);
 // A predicate's result must remain in positive boolean contexts all the way
 // to an allow grant. Do not change false/error behavior observed by negation,
 // equality, let bindings, ternary conditions or another function's arguments.
 for(let pass=0;pass<functions.length;pass++){
  const before=unsafe.size;
  for(const st of parsed)if(st.owner&&unsafe.has(st.owner))for(const name of calls(st.body))unsafe.add(name);
  if(unsafe.size===before)break;
 }
 const rewrite=value=>{
  const inner=unparen(value);if(inner!==null)return '('+rewrite(inner)+')';
  if(splitTop(value,',').length>1)return value;
  const choice=ternary(value);if(choice)return booleanChoices?'(('+choice[0]+')&&('+rewrite(choice[1])+'))||(!( '+choice[0]+')&&('+rewrite(choice[2])+'))':value;
  const or=splitTop(value,'||');if(or.length>1)return or.map(rewrite).join('||');
  const parts=splitTop(value,'&&');if(parts.length<3)return parts.length>1?parts.map(rewrite).join('&&'):value;
  const result=[];let pairs=[];
  const flush=()=>{
   if(pairs.length<2)result.push(...pairs.map(pair=>pair.join('==')));
   else result.push('(['+pairs.map(pair=>pair[0]).join(',')+']==['+pairs.map(pair=>pair[1]).join(',')+'])');
   pairs=[];
  };
  for(const raw of parts){
   const pair=splitTop(raw,'==');
   if(pair.length===2&&!/[?|]/.test(maskRulesTrivia(raw))&&!/^[=]|[=!<>]$/.test(pair[0].trim())&&!/^[=]/.test(pair[1].trim()))pairs.push(pair);
   else{flush();result.push(rewrite(raw));}
  }
  flush();return result.join('&&');
 };
 for(const st of parsed.reverse())if(st.positive&&(!st.owner||!unsafe.has(st.owner))&&!scalarRanges.some(r=>st.from>=r.from&&st.from<r.to))source=source.slice(0,st.from)+rewrite(st.body)+source.slice(st.to);
 return source;
}

/** Constant lists are immutable; share the whole split, not only its string. */
export function shareConstantLists(source){
 if(!databaseScope.test(maskRulesTrivia(source)))return source;
 const pattern=/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'\s*\.split\(\s*'(?:\\.|[^'\\])*'\s*\)|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
 const groups=new Map();
 for(const m of source.matchAll(pattern)){
  if(!m[0].startsWith("'")||!m[0].includes('.split(')||m[0].length<25)continue;
  if(!groups.has(m[0]))groups.set(m[0],[]);groups.get(m[0]).push(m.index);
 }
 const changes=[],helpers=[];let serial=0;
 for(const [expression,positions] of groups){
  if(positions.length<2)continue;
  let name;do{name='releaseConstantList'+serial++;}while(source.includes(name));
  helpers.push('function '+name+'() { return '+expression+'; }');
  for(const from of positions)changes.push({from,to:from+expression.length,text:name+'()'});
 }
 for(const {from,to,text} of changes.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+text+source.slice(to);
 return insertDatabaseHelpers(source,helpers);
}

/** Local helpers have match scope. Give each declaration a unique compiler
 * name so later analysis never confuses unrelated helpers in sibling matches. */
export function uniqueLocalFunctions(source){
 const mask=maskRulesTrivia(source),changes=[];let serial=0;
 for(const head of mask.matchAll(/^    match [^\n]+ \{/gm)){
  const from=head.index+head[0].length;let end=from,depth=1;
  for(;end<mask.length&&depth;end++){if(mask[end]==='{')depth++;if(mask[end]==='}')depth--;}
  const body=mask.slice(from,end-1);
  if(/\bmatch\s+\//.test(body))continue;
  const declarations=[...body.matchAll(/\bfunction\s+(\w+)\s*\(/g)],aliases=new Map();
  for(const d of declarations){
   if(declarations.filter(other=>other[1]===d[1]).length>1)continue;
   let name;do{name='releaseScopedHelper'+serial++;}while(source.includes(name));
   aliases.set(d[1],name);
  }
  for(const call of body.matchAll(/(?<![.\w])(\w+)\s*\(/g)){
   if(!aliases.has(call[1]))continue;
   const start=from+call.index;changes.push({from:start,to:start+call[1].length,text:aliases.get(call[1])});
  }
 }
 for(const {from,to,text} of changes.sort((a,b)=>b.from-a.from))source=source.slice(0,from)+text+source.slice(to);
 return source;
}

export const RELEASE_RULE_OPTIONS=Object.freeze({earlyRequests:true,broadRequests:true,fieldReaders:true,vectorEquality:true,listConstants:false,booleanChoices:false,uniqueLocals:true,tenantChecks:true,groupCollections:false});

/** On an update, an unchanged tenant plus membership of the existing tenant
 * makes the second membership call redundant. Keep both equality and the
 * original membership check; only simplify a positive top-level conjunction. */
export function elideDuplicateTenantGrants(source){
 const mask=maskRulesTrivia(source),grants=[...mask.matchAll(/\ballow\s+update\s*:\s*if\b([^;]+);/g)];
 for(const g of grants.reverse()){
  const from=g.index+g[0].indexOf(g[1]),body=source.slice(from,from+g[1].length),text=maskRulesTrivia(body);let depth=0,start=0;const parts=[];let unsupported=false;
  for(let i=0;i<text.length;i++){
   if('([{'.includes(text[i]))depth++;
   else if(')]}'.includes(text[i]))depth--;
   else if(!depth){if(text.startsWith('||',i)||text[i]==='?'){unsupported=true;break;}if(text.startsWith('&&',i)){parts.push(body.slice(start,i));start=i+2;i++;}}
  }
  if(unsupported)continue;parts.push(body.slice(start));
  const normalized=parts.map(p=>maskRulesTrivia(p).replace(/\s/g,''));
  const before='isTenantMember(resource.data.tenantId)',after='isTenantMember(request.resource.data.tenantId)';
  const equal=['request.resource.data.tenantId==resource.data.tenantId','resource.data.tenantId==request.resource.data.tenantId'];
  if(!normalized.includes(before)||!normalized.includes(after)||!equal.some(e=>normalized.includes(e)))continue;
  const filtered=parts.filter((p,i)=>normalized[i]!==after&&normalized[i]!=='isAuthenticated()');
  source=source.slice(0,from)+filtered.join('&&')+source.slice(from+g[1].length);
 }
 return source;
}

export function compactRuleSymbols(source,{minimal=false,fieldReaders=false,earlyRequests=false,broadRequests=false,vectorEquality=false,listConstants=false,booleanChoices=false,uniqueLocals=false,tenantChecks=false,maxLocalOwners=1,sharePaths=true,memoize=true,balanceConditions=true,groupCollections=true,packArrays=true,shareReaders=true,shareSchemas=true,shareConstants=true}={}){
 if(!minimal){
 source=omitNeverAllow(source);
 if(tenantChecks)source=elideDuplicateTenantGrants(source);
 if(broadRequests)source=shareRequestFields(source);
 if(earlyRequests)source=shareRequestExpressions(source,{preserveBudget:true});
 if(fieldReaders)source=shareFieldReaders(source);
 if(shareReaders)source=shareSnapshotReaders(source);
 if(shareSchemas)source=shareSchemaChecks(source);
 if(sharePaths)source=shareDocumentPaths(source);
 source=localizeCollectionHelpers(source,maxLocalOwners);
 if(uniqueLocals)source=uniqueLocalFunctions(source);
 source=shareRepeatedAllowConditions(source);
 if(groupCollections)source=groupEquivalentCollections(source);
 source=shareRequestExpressions(compactCollectionSets(bindWriteSnapshots(source)));
 if(memoize)source=memoizeRequiredExpressions(source);
 if(packArrays)source=packStringArrays(source);
 if(listConstants)source=shareConstantLists(source);
 if(shareConstants){source=shareRepeatedStringValues(source);if(memoize)source=memoizeRequiredExpressions(source);}
 if(vectorEquality){source=packEqualityConjunctions(source,{booleanChoices});if(memoize)source=memoizeRequiredExpressions(source);}
 if(balanceConditions)source=balanceBooleanChains(source);
 }
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
 const file=process.argv[2]||'firestore.rules',source=readFileSync(file,'utf8'),output=wrapReleaseColumns(compactRuleSymbols(source,RELEASE_RULE_OPTIONS));
 writeFileSync(file,output+'\n');console.log(`Generated equivalent release rules: ${Buffer.byteLength(source)} → ${Buffer.byteLength(output)+1} source bytes.`);
}
