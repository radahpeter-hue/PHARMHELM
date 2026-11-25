// Diagnostic variants only: never deployment input, never evidence for the real candidate.
import {readFileSync,writeFileSync} from 'node:fs';
import {compactRuleSymbols,wrapReleaseColumns,RELEASE_RULE_OPTIONS} from './build-firestore-release-rules.mjs';
const source=readFileSync(process.argv[2]||'firestore.rules','utf8');
const remove=(text,first,last)=>{
 const start=text.indexOf(first),end=text.indexOf(last,start);
 if(start<0||end<0)throw Error('Diagnostic source markers missing.');
 return text.slice(0,start)+text.slice(end);
};
let noCoverage=remove(source,'    function payrollDay(value)','    function validPayrollSnapshot(data)');
const check="        && (before.get('coverageVersion',0) == 0 || get(payrollDayPath(data.staffId,payrollDay(before.periodEnd))).data.batchId == before.id)\n";
if(!noCoverage.includes(check))throw Error('Coverage diagnostic marker missing.');
noCoverage=noCoverage.replace(check,'');
let noRecovery=remove(source,'    function validLegacyPayrollRecovery(b)','    match /finance_payroll_batches_v1/');
const recovery="&& (data.get('legacySourceId','') == '' || validLegacyPayrollRecovery(data))\n          ";
if(!noRecovery.includes(recovery))throw Error('Recovery diagnostic marker missing.');
noRecovery=noRecovery.replace(recovery,'');
const variants={noCoverage,noRecovery,dateConversionStub:source.replace(/return int\(timestamp\.date\(int\(p\[0\]\),int\(p\[1\]\),int\(p\[2\]\)\)\.toMillis\(\) \/ 86400000\);/,'return 0;')};
for(const [name,text]of Object.entries(variants)){
 if(text===source)throw Error('Diagnostic variant did not change the source.');
 writeFileSync(`/tmp/payroll-${name}.rules`,wrapReleaseColumns(compactRuleSymbols(text,RELEASE_RULE_OPTIONS))+'\n');
}
