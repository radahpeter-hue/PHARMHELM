import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasAnyRole } from '../src/utils/roles';

const source = fs.readFileSync('src/pages/Welfare.tsx', 'utf8');
const policy = source.match(/const isAdmin = hasAnyRole\(profile, (\[[^\]]+\])\)/);
assert.ok(policy);
const adminRoles = JSON.parse(policy[1].replaceAll("'", '"')) as string[];

test('ordinary employee portal roles do not expose Welfare Admin', () => {
  for (const role of ['cashier', 'pharmacist', 'dispenser', 'cleaner', 'trainee', 'Branch Manager']) {
    assert.equal(hasAnyRole({ role }, adminRoles), false, role);
  }
  assert.match(source, /\{isAdmin && \(/);
});

test('authorised welfare management and secondary HR assignments remain intact', () => {
  for (const role of ['owner', 'CEO', 'HR Head', 'HR Manager', 'HR Support Personnel', 'admin']) {
    assert.equal(hasAnyRole({ role }, adminRoles), true, role);
  }
  assert.equal(hasAnyRole({ role: 'pharmacist', secondaryRoles: ['HR Head'] }, adminRoles), true);
  assert.match(source, /case 'admin_welfare':/);
  assert.match(source, /Staff Welfare Allocations/);
});
