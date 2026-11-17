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

export function compactRuleSymbols(source,{maxLocalOwners=1}={}){
 source=balanceBooleanChains(shareRequestExpressions(compactCollectionSets(bindWriteSnapshots(shareRepeatedAllowConditions(localizeCollectionHelpers(source,maxLocalOwners))))));
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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2]||'firestore.rules',source=readFileSync(file,'utf8'),output=compactRuleSymbols(source);
 writeFileSync(file,output+'\n');console.log(`Generated equivalent release rules: ${Buffer.byteLength(source)} → ${Buffer.byteLength(output)+1} source bytes.`);
}
