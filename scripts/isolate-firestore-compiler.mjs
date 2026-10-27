/** Fail-closed compiler controls, never deployable release candidates. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compactRuleSymbols} from './build-firestore-release-rules.mjs';
export function permissionSites(source) {
 const tokens=source.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g)||[];
 const t=tokens.map((token,index)=>({token,index})).filter(x=>!/^\s+$/.test(x.token)&&!x.token.startsWith('//')&&!x.token.startsWith('/*'));
 const stack=[],sites=[];
 for(let i=0;i<t.length;i++) {
  if(t[i].token==='match') {
   let end=i+1;
   for(;end<t.length;end++)if(t[end].token==='{'){
    let close=end+1;while(close<t.length&&t[close].token!=='}'&&t[close].token!=='{')close++;
    // Match path captures precede the block. Captures contain only identifiers,
    // equals and stars, whereas a rule block starts with declarations/allow/match.
    if(close>end+1&&t[close]?.token==='}'&&t.slice(end+1,close).every(x=>/^[A-Za-z_]\w*$/.test(x.token)||['=','*'].includes(x.token))){end=close;continue;}
    break;
   }
   if(t[end]?.token!=='{')throw new Error('Unterminated match header');
   const path=t.slice(i+1,end).map(x=>x.token).join('');
   stack.push({path});i=end;continue;
  }
  if(t[i].token==='{')stack.push({});
  else if(t[i].token==='}') {if(!stack.length)throw new Error('Unbalanced rules block');stack.pop();}
  else if(t[i].token==='allow') {
   let end=i+1;while(end<t.length&&t[end].token!==';')end++;
   if(end===t.length)throw new Error('Unterminated permission');
   const matches=stack.filter(x=>x.path).map(x=>x.path);
   if(!matches[0]?.startsWith('/databases/'))throw new Error('Permission outside database root');
   const group=matches[1]||'__root__';sites.push({group,start:t[i].index,end:t[end].index});i=end;
  }
 }
 if(stack.length)throw new Error('Unclosed rules block');
 return {tokens,sites};
}
export function isolateCompilerControls(source) {
 const {tokens,sites}=permissionSites(source);
 const groups=[...new Set(sites.map(s=>s.group))];
 if(groups.length<2)throw new Error('Isolation requires multiple collection groups');
 const mid=Math.ceil(groups.length/2),first=new Set(groups.slice(0,mid)),second=new Set(groups.slice(mid));
 const cases=[['first-half',first],['second-half',second],['credit-pos-crm',new Set(groups.filter(g=>/\/(pos_|credit_|sales\/|sale_revisions\/|clients\/|institutions\/)/.test(g)))],['finance-payroll',new Set(groups.filter(g=>/\/(finance_|salary_|payroll(?:_|\/)|welfare(?:_|\/)|advance_requests\/|staff_advances\/|statutory_|management_expenses\/|cash_grn_payments\/)/.test(g)))],['generic-fallback',new Set(groups.filter(g=>g.startsWith('/{collectionName}')))],['all-denied',new Set()]];
 return cases.map(([name,keep])=>{
  const output=[...tokens];for(const site of [...sites].reverse())if(!keep.has(site.group))output.splice(site.start,site.end-site.start+1,'allow read, write: if false;');
  return {name,groups:[...keep],retainedPermissions:sites.filter(s=>keep.has(s.group)).length,totalPermissions:sites.length,rules:compactRuleSymbols(output.join(''))+'\n'};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const directory=process.argv[3];if(!directory)throw new Error('Explicit diagnostic directory required');
 mkdirSync(directory,{recursive:true});const cases=isolateCompilerControls(readFileSync(process.argv[2]||'firestore.rules','utf8'));
 for(const c of cases)writeFileSync(join(directory,c.name+'.rules'),c.rules);
 writeFileSync(join(directory,'manifest.json'),JSON.stringify({diagnosticOnly:true,productionCandidate:false,cases:cases.map(({rules,...c})=>c)},null,2)+'\n');
 console.log(JSON.stringify(cases.map(({rules,...c})=>({...c,sourceBytes:Buffer.byteLength(rules)}))));
}
