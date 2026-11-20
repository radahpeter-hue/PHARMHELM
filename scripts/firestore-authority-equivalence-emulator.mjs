import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc} from 'firebase/firestore';
import {compactRuleSymbols,wrapReleaseColumns,RELEASE_RULE_OPTIONS} from './build-firestore-release-rules.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Isolated emulator required.');
const source=readFileSync('firestore.rules','utf8');
const mask=source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,t=>' '.repeat(t.length));
const names=['isAuthenticated','hasRole','hasAnyRole','getUserData','isTenantMember','isAdmin',
 'isHR','isFinance','isBranchManager','isProcurement','isQA','isInventoryOperator','isStockOperator','isMarketing','isLogisticsHead',
 'hasCustomModuleAccess','hasCustomModuleFunctional'];
const declarations=names.map(name=>{
 const header=new RegExp('    function '+name+'\\([^)]*\\)\\s*\\{').exec(mask);
 assert.ok(header,`Missing authority ${name}`);
 let end=header.index+header[0].length,depth=1;
 for(;end<mask.length&&depth;end++){if(mask[end]==='{')depth++;if(mask[end]==='}')depth--;}
 return source.slice(header.index,end);
}).join('\n');
const roles=['isHR','isFinance','isBranchManager','isProcurement','isQA','isInventoryOperator','isStockOperator','isMarketing','isLogisticsHead'];
const actors=[null,{}, {role:'Cashier'}, {role:'HR Head'}, {role:'Finance Head'}, {role:'Procurement Officer'},
 {role:'Branch Manager'}, {role:'owner'}, {role:'Cashier',secondaryRoles:['Finance Head']},
 {role:'Pharmacist'}, {role:'Finance Head',tenantId:'other'}, {role:'Custom Finance',roleRealmId:'custom'}];
const outcomes=[];
for(const variant of ['original','reduced','released']){
 const grants=roles.flatMap((role,index)=>[
  `match /auth_${index}/{id} { allow create: if isTenantMember(request.resource.data.tenantId) && (${variant==='original'?'isAuthenticated() && ':''}${role}()); }`,
  `match /admin_${index}/{id} { allow create: if isTenantMember(request.resource.data.tenantId) && (${role}()${variant==='original'?' || isAdmin()':''}); }`,
 ]).join('\n');
 let rules=`rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { ${declarations}\n${grants}\n} }`;
 if(variant==='released')rules=wrapReleaseColumns(compactRuleSymbols(rules,RELEASE_RULE_OPTIONS));
 const env=await initializeTestEnvironment({projectId:'demo-authority-'+variant,firestore:{rules}});
 try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
   for(let i=0;i<actors.length;i++)if(actors[i]&&actors[i].role)await setDoc(doc(ctx.firestore(),'staff','actor_'+i),{tenantId:'tenant',secondaryRoles:[],...actors[i]});
   await setDoc(doc(ctx.firestore(),'role_realms_of_operation','custom'),{tenantId:'tenant',roleType:'custom',roleName:'Custom Finance',permissions:{finance:{accessLevel:'view_functional'}}});
  });
  const decisions=[];
  for(let i=0;i<actors.length;i++){
   const db=(actors[i]===null?env.unauthenticatedContext():env.authenticatedContext('actor_'+i)).firestore();
   for(let role=0;role<roles.length;role++)for(const prefix of ['auth','admin']){
    try{await setDoc(doc(db,prefix+'_'+role,String(i)),{tenantId:'tenant'});decisions.push(true);}
    catch(error){if(error.code!=='permission-denied')throw error;decisions.push(false);}
   }
  }
  outcomes.push(decisions);
 }finally{await env.cleanup();}
}
assert.deepEqual(outcomes[1],outcomes[0],'Implied authority checks must retain exact permissions.');
assert.deepEqual(outcomes[2],outcomes[0],'Released authority checks must retain exact permissions.');
console.log(`PASS ${outcomes[0].length*2} original/reduced/released authority decisions for anonymous, absent staff, roles, secondary roles, custom roles and foreign tenants.`);
