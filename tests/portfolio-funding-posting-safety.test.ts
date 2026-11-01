import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('portfolio ledger posting does not read nonexistent document in transaction',()=>{
 const source=readFileSync('src/domain/finance/portfolioFunding.ts','utf8');
 const fn=source.split('export async function postPortfolioFundingMovement')[1].split('export async function listPortfolioFundingAccounts')[0];
 assert.doesNotMatch(fn,/tx\.get\(ledgerRef\)/);
 assert.match(fn,/const prior=await getDoc\(ledgerRef\)/);
 assert.match(fn,/const winner=await getDoc\(ledgerRef\)/);
 assert.match(fn,/if\(!matches\(prior\.data\(\)\)\)/);
 assert.match(fn,/if\(!matches\(winner\.data\(\)\)\)/);
});
