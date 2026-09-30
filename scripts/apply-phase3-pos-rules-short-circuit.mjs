import { readFileSync, writeFileSync } from 'node:fs';

const path = 'firestore.rules';
let rules = readFileSync(path, 'utf8');

const productOld = `      allow update: if isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && (
          isInventoryOperator() ||
          (isPOSOperator()
            && (
              (
                request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stock', 'updatedAt'])
                && request.resource.data.stock is number
                && request.resource.data.stock >= 0
              ) ||
              (
                request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'])
                && request.resource.data.stock is number
                && request.resource.data.quantityInStock is number
                && request.resource.data.stock >= 0
                && request.resource.data.quantityInStock >= 0
                && request.resource.data.stock == request.resource.data.quantityInStock
                && request.resource.data.stockAggregateSource == 'product_batches'
              )
            ))
        );`;

const productNew = `      allow update: if isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && (
          (isPOSOperator()
            && (
              (
                request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stock', 'updatedAt'])
                && request.resource.data.stock is number
                && request.resource.data.stock >= 0
              ) ||
              (
                request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stock', 'quantityInStock', 'stockAggregateSource', 'updatedAt'])
                && request.resource.data.stock is number
                && request.resource.data.quantityInStock is number
                && request.resource.data.stock >= 0
                && request.resource.data.quantityInStock >= 0
                && request.resource.data.stock == request.resource.data.quantityInStock
                && request.resource.data.stockAggregateSource == 'product_batches'
              )
            )) ||
          isInventoryOperator()
        );`;

const batchOld = `      allow update: if isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && (
          isInventoryOperator() ||
          (isQA()
            && (hasAnyRole(['QA Head', 'QA Manager', 'admin', 'Admin']) || isAdmin() || isAssignedToBranch(resource.data.branchId))
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['batch_status', 'lastUpdated'])
            && request.resource.data.batch_status == 'quarantined') ||
          (isPOSOperator()
            && isAssignedToBranch(resource.data.branchId)
            && (
              request.resource.data.diff(resource.data).affectedKeys().hasOnly(['quantity', 'updatedAt']) ||
              request.resource.data.diff(resource.data).affectedKeys().hasOnly(['quantity', 'lastUpdated'])
            )
            && request.resource.data.quantity is number
            && request.resource.data.quantity >= 0)
        );`;

const batchNew = `      allow update: if isTenantMember(resource.data.tenantId)
        && isTenantMember(request.resource.data.tenantId)
        && (
          (isPOSOperator()
            && isAssignedToBranch(resource.data.branchId)
            && (
              request.resource.data.diff(resource.data).affectedKeys().hasOnly(['quantity', 'updatedAt']) ||
              request.resource.data.diff(resource.data).affectedKeys().hasOnly(['quantity', 'lastUpdated'])
            )
            && request.resource.data.quantity is number
            && request.resource.data.quantity >= 0) ||
          isInventoryOperator() ||
          (isQA()
            && (hasAnyRole(['QA Head', 'QA Manager', 'admin', 'Admin']) || isAdmin() || isAssignedToBranch(resource.data.branchId))
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['batch_status', 'lastUpdated'])
            && request.resource.data.batch_status == 'quarantined')
        );`;

for (const [label, oldText] of [['product', productOld], ['batch', batchOld]]) {
  const count = rules.split(oldText).length - 1;
  if (count !== 1) throw new Error(`[phase3-rules] expected exactly one ${label} update block, found ${count}`);
}

rules = rules.replace(productOld, productNew).replace(batchOld, batchNew);
writeFileSync(path, rules);
console.log('[phase3-rules] Reordered existing POS update exceptions ahead of broader Inventory/QA paths. No predicate or permission was added or removed.');
