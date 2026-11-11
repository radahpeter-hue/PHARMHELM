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
 const paths = [...masked.matchAll(/(?<![.\w])(?:request\.resource\.data|resource\.data|request\.auth\.uid|request\.time)\b/g)];
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

export function compactRuleSymbols(source){
 source=shareRequestExpressions(compactCollectionSets(bindWriteSnapshots(shareRepeatedAllowConditions(source))));
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const stripped=tokens.filter(t=>!t.startsWith('//')&&!t.startsWith('/*')).join('');
 const names=new Set(tokens.filter(token=>/^[A-Za-z_]\w*$/.test(token))),symbols=new Set(),aliases=new Map();
 const reservedPaths=new Set([...stripped.matchAll(/\/([A-Za-z_]\w*)/g)].map(m=>m[1]));
 for(const keyword of ['as','break','const','continue','do','else','for','function','if','in','is','let','match','return','service','true','false','null','rules_version','while'])names.add(keyword);
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';let serial=0;
 const unique=()=>{for(;;){let index=serial++,name='';do{name=alphabet[index%52]+name;index=Math.floor(index/52)-1;}while(index>=0);if(!names.has(name)){names.add(name);return name;}}};
 const addBinding=name=>{if(name&&!reservedPaths.has(name))symbols.add(name);};
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
