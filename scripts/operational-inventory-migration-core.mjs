const hash = value => {
  let state = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return (state >>> 0).toString(36).toUpperCase();
};

/** Plans conservative, tenant-scoped backfills. It never changes an explicit SELLABLE classification. */
export function planOperationalInventoryMigration({ tenantId, items, masters, movements, orders, orderLines, grns, usageEntries, financeEntries, sellableItemIds = [], existingAuditIds = [], actorId = 'operational_inventory_migration', now = new Date().toISOString() }) {
  if (!tenantId) throw new Error('A tenant ID is required.');
  const report = { tenantId, itemsScanned: items.length, ordersScanned: orders.length, grnsScanned: grns.length, usageScanned: usageEntries.length, financeEntriesScanned: financeEntries.length, itemBackfills: [], masterCreates: [], missingHqLocations: [], openingMovements: [], orderBackfills: [], lineBackfills: [], grnBackfills: [], ambiguous: [], historicalFinanceReview: [], auditCreates: [] };
  const issue = (entityType, entityId, reason) => report.ambiguous.push({ entityType, entityId, reason });
  const mastersById = new Map(masters.filter(master => master.tenantId === tenantId).map(master => [master.id, master]));
  const movementsByItem = new Map();
  for (const movement of movements) if (movement.tenantId === tenantId) movementsByItem.set(movement.itemId, [...(movementsByItem.get(movement.itemId) || []), movement]);

  const validItems = [];
  for (const item of items) {
    if (item.tenantId !== tenantId) continue;
    if (item.inventoryClass && item.inventoryClass !== 'OPERATIONAL') {
      issue('operational_inventory', item.id, `Dedicated Operational collection contains explicit ${item.inventoryClass} classification.`);
      continue;
    }
    const operationalType = item.operationalType || (item.type === 'fixed' ? 'FIXED_ASSET' : item.type === 'non-fixed' ? 'CONSUMABLE_OPERATIONAL' : undefined);
    if (!operationalType || !item.name || !item.branchId) {
      issue('operational_inventory', item.id, 'Missing/invalid legacy subtype, name or location; requires manual review.');
      continue;
    }
    validItems.push({ ...item, legacyInventoryClass: item.inventoryClass || null, legacyOperationalType: item.operationalType || null, operationalType, inventoryClass: 'OPERATIONAL' });
  }

  // Group only by an existing master ID or a stable non-empty unique ID. Name-only matches are never merged.
  const groups = new Map();
  for (const item of validItems) {
    const key = item.masterItemId || (item.uniqueId ? `uid:${String(item.uniqueId).trim().toLowerCase()}` : `doc:${item.id}`);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const identityGroups = new Map();
  for (const [key, group] of groups) {
    const item = group[0];
    const identity = [item.name, item.category, item.type, item.operationalType, item.unitPerPack || 1, item.unitOfIssue || '']
      .map(value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    identityGroups.set(identity, [...(identityGroups.get(identity) || []), key]);
  }
  const itemMaster = new Map();
  for (const [key, group] of groups) {
    const identities = new Set(group.map(item => `${item.name.trim().toLowerCase()}|${item.category || ''}|${item.type}|${item.operationalType}|${item.unitPerPack || 1}|${item.unitOfIssue || ''}`));
    const hq = group.filter(item => item.branchId === 'HQ');
    const templateIdentity = [group[0].name, group[0].category, group[0].type, group[0].operationalType, group[0].unitPerPack || 1, group[0].unitOfIssue || '']
      .map(value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    const duplicateGroups = identityGroups.get(templateIdentity) || [];
    if (duplicateGroups.length > 1) {
      issue('operational_identity', key, `Potential duplicate across tenant-wide item identities (${duplicateGroups.join(', ')}). Link the location records to one reviewed master; migration will not merge them automatically.`);
      continue;
    }
    if (identities.size !== 1 || hq.length > 1) {
      issue('operational_identity', key, 'Location copies conflict on identity or contain multiple HQ records.');
      continue;
    }
    const masterId = group[0].masterItemId || `opm_legacy_${hash(`${tenantId}|${key}`)}`;
    const existing = mastersById.get(masterId);
    const template = group.find(item => item.branchId === 'HQ') || group[0];
    if (existing && (existing.tenantId !== tenantId || existing.inventoryClass !== 'OPERATIONAL' || existing.operationalType !== template.operationalType || existing.name.trim().toLowerCase() !== template.name.trim().toLowerCase())) {
      issue('operational_inventory_masters', masterId, 'Existing master identity conflicts with the legacy location records.');
      continue;
    }
    if (!existing) report.masterCreates.push({ id: masterId, tenantId, inventoryClass: 'OPERATIONAL', operationalType: template.operationalType, type: template.type, name: template.name, category: template.category || '', uniqueId: template.uniqueId || '', sku: template.sku || '', unitPerPack: template.unitPerPack || 1, unitOfIssue: template.unitOfIssue || '', description: template.description || '', supplier: template.supplier || '', ...(hq[0] ? { hqLocationItemId: hq[0].id } : {}), createdAt: now, updatedAt: now });
    const configuredHqExists = existing?.hqLocationItemId && items.some(item => item.id === existing.hqLocationItemId && item.tenantId === tenantId && item.branchId === 'HQ');
    if (!hq.length && !configuredHqExists) report.missingHqLocations.push({ masterItemId: masterId, itemName: template.name, reason: 'No HQ Operational location exists; Procurement external GRNs require an HQ location record.' });

    for (const item of group) {
      const itemMovements = movementsByItem.get(item.id) || [];
      const stock = Number(item.quantityInStock || 0);
      if (!Number.isFinite(stock) || stock < 0) {
        issue('operational_inventory', item.id, 'Invalid stock-on-hand value.');
        continue;
      }
      let openingMovementId = item.lastMovementId;
      if (itemMovements.length === 0 && stock > 0) {
        openingMovementId = `opm_opmig_open_${hash(`${tenantId}|${item.id}`)}`;
        report.openingMovements.push({ id: openingMovementId, tenantId, inventoryClass: 'OPERATIONAL', operationalType: item.operationalType, itemId: item.id, masterItemId: masterId, itemName: item.name, locationId: item.branchId === 'HQ' ? 'HQ_OPERATIONAL' : `BRANCH_${item.branchId}`, branchId: item.branchId, movementType: 'ADJUSTMENT', quantityDelta: stock, balanceBefore: 0, balanceAfter: stock, unitCostUGX: Number(item.cost || item.costPerPack || 0) / Math.max(1, Number(item.unitPerPack || 1)), totalValueUGX: stock * Number(item.cost || item.costPerPack || 0) / Math.max(1, Number(item.unitPerPack || 1)), reference: `MIGRATION-OPEN-${item.id}`, reason: 'Opening balance established by tenant-scoped Operational Inventory migration.', idempotencyKey: `opmig_open_${hash(`${tenantId}|${item.id}`)}`, actorId, actorName: 'Operational Inventory migration', sourceTransactionId: `opmig_${hash(`${tenantId}|${item.id}`)}`, createdAt: now });
      } else if (itemMovements.length > 0) {
        const latest = itemMovements.find(movement => movement.id === item.lastMovementId);
        if (!latest || Number(latest.balanceAfter) !== stock) {
          issue('operational_inventory', item.id, 'Existing movement history does not reconcile to current stock; opening balance cannot be inferred safely.');
          continue;
        }
      }
      itemMaster.set(item.id, masterId);
      const patch = { inventoryClass: 'OPERATIONAL', operationalType: item.operationalType, masterItemId: masterId, ...((!item.lastMovementId && openingMovementId) ? { lastMovementId: openingMovementId } : {}), updatedAt: now };
      if (item.legacyInventoryClass !== 'OPERATIONAL' || item.legacyOperationalType !== patch.operationalType || item.masterItemId !== masterId || patch.lastMovementId) report.itemBackfills.push({ id: item.id, patch });
    }
  }

  const orderClass = new Map();
  const lineClass = new Map();
  const linesByOrder = new Map();
  const operationalItemIds = new Set(validItems.map(item => item.id));
  const sellableIds = new Set(sellableItemIds);
  for (const line of orderLines) if (line.tenantId === tenantId) linesByOrder.set(line.order_id || line.orderId, [...(linesByOrder.get(line.order_id || line.orderId) || []), line]);
  for (const order of orders) {
    if (order.tenantId !== tenantId) continue;
    const lines = linesByOrder.get(order.id) || [];
    const declaredCategories = [order.categories, order.order_categories, order.orderCategories].flatMap(value => Array.isArray(value) ? value : value ? [value] : []).map(value => String(value).toLowerCase());
    const hasMixedDeclaredCategories = declaredCategories.some(value => value.includes('non_sellable') || value.includes('operational')) && declaredCategories.some(value => !value.includes('non_sellable') && !value.includes('operational'));
    const explicitClasses = new Set(lines.map(line => line.inventoryClass || (line.isOperational === true || line.category === 'non_sellable' || operationalItemIds.has(line.product_id || line.productId) ? 'OPERATIONAL' : sellableIds.has(line.product_id || line.productId) ? 'SELLABLE' : undefined)).filter(Boolean));
    const saysOperational = order.inventoryClass === 'OPERATIONAL' || order.category === 'non_sellable' || lines.some(line => line.isOperational === true || line.category === 'non_sellable' || operationalItemIds.has(line.product_id || line.productId));
    if (hasMixedDeclaredCategories) {
      issue('stock_orders', order.id, 'Historical order declares multiple inventory categories; do not auto-migrate or split it.');
      continue;
    }
    if (saysOperational && (order.inventoryClass === 'SELLABLE' || explicitClasses.has('SELLABLE'))) {
      issue('stock_orders', order.id, 'Legacy order metadata conflicts with an explicit Sellable line/order classification.');
      continue;
    }
    if (explicitClasses.size > 1) {
      issue('stock_orders', order.id, 'Mixed-class historical order; do not auto-migrate or split it.');
      continue;
    }
    const inventoryClass = saysOperational ? 'OPERATIONAL' : order.inventoryClass || (explicitClasses.size === 1 ? [...explicitClasses][0] : undefined);
    if (!inventoryClass) continue;
    if (inventoryClass === 'OPERATIONAL' && lines.some(line => !(line.product_id || line.productId))) {
      issue('stock_orders', order.id, 'Operational order has a line without a product identity; mixed-class status cannot be ruled out.');
      continue;
    }
    orderClass.set(order.id, inventoryClass);
    if (order.inventoryClass !== inventoryClass) report.orderBackfills.push({ id: order.id, inventoryClass });
    for (const line of lines) {
      const inferred = line.inventoryClass || (line.isOperational === true || line.category === 'non_sellable' || operationalItemIds.has(line.product_id || line.productId) ? 'OPERATIONAL' : sellableIds.has(line.product_id || line.productId) ? 'SELLABLE' : inventoryClass);
      if (inferred !== inventoryClass) issue('stock_order_lines', line.id, 'Order line conflicts with the source order inventory class.');
      else {
        lineClass.set(line.id, inventoryClass);
        if (line.inventoryClass !== inventoryClass) report.lineBackfills.push({ id: line.id, inventoryClass });
      }
    }
  }

  const ordersById = new Map(orders.filter(order => order.tenantId === tenantId).map(order => [order.id, order]));
  const grnClass = new Map();
  const orderLineById = new Map(orderLines.filter(line => line.tenantId === tenantId).map(line => [line.id, line]));
  for (const grn of grns) {
    if (grn.tenantId !== tenantId) continue;
    const sourceOrder = ordersById.get(grn.order_id || grn.orderId);
    const sourceClass = sourceOrder && orderClass.get(sourceOrder.id);
    if (!sourceClass) continue;
    const sourceLines = linesByOrder.get(sourceOrder.id) || [];
    if (sourceClass === 'OPERATIONAL' && (grn.items || []).length > 0 && sourceLines.length === 0) {
      issue('grn_records', grn.id, 'Operational GRN has no source order lines to prove item classification.');
      continue;
    }
    const lineClasses = (grn.items || []).map(line => {
      const sourceLine = orderLineById.get(line.source_order_line_id || line.sourceLineId || line.line_id);
      return line.inventoryClass || (line.isOperational === true || operationalItemIds.has(line.product_id || line.productId) || sourceLine?.inventoryClass === 'OPERATIONAL' || sourceLine?.category === 'non_sellable' ? 'OPERATIONAL' : sellableIds.has(line.product_id || line.productId) || sourceLine?.inventoryClass === 'SELLABLE' ? 'SELLABLE' : undefined);
    }).filter(Boolean);
    if (lineClasses.some(value => value !== sourceClass) || (grn.inventoryClass && grn.inventoryClass !== sourceClass)) {
      issue('grn_records', grn.id, 'GRN classification conflicts with its source order or line data.');
      continue;
    }
    grnClass.set(grn.id, sourceClass);
    if (!grn.inventoryClass) report.grnBackfills.push({ id: grn.id, inventoryClass: sourceClass, ...(sourceClass === 'OPERATIONAL' ? { historicalFinanceReviewRequired: true } : {}) });
    if (sourceClass === 'OPERATIONAL') report.historicalFinanceReview.push({ grnId: grn.id, reason: 'No historical Finance event will be created automatically; reconcile prior usage/expense postings before Finance backfill.' });
  }

  const operationalUsageIds = new Set(usageEntries.filter(entry => entry.tenantId === tenantId).map(entry => entry.id));
  for (const entry of financeEntries) {
    if (entry.tenantId !== tenantId) continue;
    if ((entry.reference_type === 'operational_inventory_usage' || entry.referenceType === 'operational_inventory_usage') && operationalUsageIds.has(entry.reference_id || entry.referenceId)) {
      report.historicalFinanceReview.push({ financeEntryId: entry.id, usageId: entry.reference_id || entry.referenceId, reason: 'Legacy usage expense exists; preserve it and reconcile against any historical GRN posting before changing Finance totals.' });
    }
  }

  const auditEntities = new Map();
  const itemById = new Map(validItems.map(item => [item.id, item]));
  const masterByItem = new Map([...itemMaster.entries()].map(([itemId, masterId]) => [itemId, masterId]));
  for (const itemId of itemMaster.keys()) {
    const item = itemById.get(itemId);
    const masterItemId = masterByItem.get(itemId);
    auditEntities.set(`item:${itemId}`, { entityType: 'item', entityId: itemId, before: { inventoryClass: item.legacyInventoryClass, operationalType: item.legacyOperationalType, masterItemId: item.masterItemId || null, quantityInStock: item.quantityInStock || 0 }, after: { inventoryClass: 'OPERATIONAL', operationalType: item.operationalType, masterItemId } });
  }
  for (const masterId of new Set(itemMaster.values())) auditEntities.set(`master:${masterId}`, { entityType: 'master', entityId: masterId, before: mastersById.has(masterId) ? 'EXISTING' : null, after: { inventoryClass: 'OPERATIONAL', masterItemId: masterId } });
  for (const orderId of orderClass.keys()) {
    const order = orders.find(row => row.id === orderId);
    auditEntities.set(`order:${orderId}`, { entityType: 'order', entityId: orderId, before: { inventoryClass: order.inventoryClass || null, category: order.category || null }, after: { inventoryClass: orderClass.get(orderId) } });
  }
  for (const lineId of lineClass.keys()) {
    const line = orderLines.find(row => row.id === lineId);
    auditEntities.set(`line:${lineId}`, { entityType: 'line', entityId: lineId, before: { inventoryClass: line.inventoryClass || null }, after: { inventoryClass: lineClass.get(lineId) } });
  }
  for (const grnId of grnClass.keys()) {
    const grn = grns.find(row => row.id === grnId);
    auditEntities.set(`grn:${grnId}`, { entityType: 'grn', entityId: grnId, before: { inventoryClass: grn.inventoryClass || null }, after: { inventoryClass: grnClass.get(grnId), historicalFinanceReviewRequired: grnClass.get(grnId) === 'OPERATIONAL' } });
  }
  for (const { entityType, entityId, before, after } of auditEntities.values()) {
    const auditId = `opmig_audit_${hash(`${tenantId}|${entityType}|${entityId}`)}`;
    if (!existingAuditIds.includes(auditId)) report.auditCreates.push({ id: auditId, tenantId, action: 'LEGACY_OPERATIONAL_RECONCILIATION', entityType, entityId, before, after, createdAt: now });
  }
  return report;
}
