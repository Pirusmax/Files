# Org/Shop Scoping Audit Agent - Usage Examples

This document provides practical examples of how the audit agent detects and reports issues.

## Example 1: Missing org_id Filter (CRITICAL)

### ❌ Bad Code
```typescript
// src/queries/repair-orders.ts
export async function getRepairOrders() {
  const { data } = await supabase
    .from('repair_orders')
    .select('*');
  
  return data;
}
```

### Audit Result
```
🔴 CRITICAL ISSUE
Category: Database Query
File: src/queries/repair-orders.ts:3
Issue: Query on table 'repair_orders' missing org_id filter
Fix: Add .eq('org_id', orgId) to the query
Example: supabase.from('repair_orders').select('*').eq('org_id', orgId)
```

### ✅ Fixed Code
```typescript
export async function getRepairOrders(orgId: string) {
  const { data } = await supabase
    .from('repair_orders')
    .select('*')
    .eq('org_id', orgId);
  
  return data;
}
```

---

## Example 2: Missing shop_id Filter (WARNING)

### ⚠️ Suboptimal Code
```typescript
// src/queries/repair-orders.ts
export async function getRepairOrdersForOrg(orgId: string) {
  const { data } = await supabase
    .from('repair_orders')
    .select('*')
    .eq('org_id', orgId);
  
  return data;
}
```

### Audit Result
```
⚠️ WARNING
Category: Database Query
File: src/queries/repair-orders.ts:3
Issue: Query on shop-scoped table 'repair_orders' has org_id but missing shop_id filter
Suggestion: Consider adding .eq('shop_id', shopId) if shop-specific data needed
```

### ✅ Best Practice Code
```typescript
export async function getRepairOrdersForShop(orgId: string, shopId: string) {
  const { data } = await supabase
    .from('repair_orders')
    .select('*')
    .eq('org_id', orgId)
    .eq('shop_id', shopId);
  
  return data;
}
```

---

## Example 3: React Query Without orgId (CRITICAL)

### ❌ Bad Code
```tsx
// src/components/RepairOrderList.tsx
export function RepairOrderList() {
  const { data } = useQuery({
    queryKey: ['repair-orders'],
    queryFn: fetchRepairOrders
  });
  
  return <div>{/* ... */}</div>;
}
```

### Audit Result
```
🔴 CRITICAL ISSUE
Category: React Query
File: src/components/RepairOrderList.tsx:3
Issue: Query key missing orgId for org-scoped data
Fix: Add orgId to query key: ['repair-orders', orgId]
Example: queryKey: ['repair-orders', orgId, shopId]
```

### ✅ Fixed Code
```tsx
export function RepairOrderList() {
  const { orgId } = useOrganization();
  const { shopId } = useShop();
  
  const { data } = useQuery({
    queryKey: ['repair-orders', orgId, shopId],
    queryFn: () => fetchRepairOrders(orgId, shopId),
    enabled: !!orgId && !!shopId
  });
  
  return <div>{/* ... */}</div>;
}
```

---

## Example 4: RLS Policy Without org_id (CRITICAL)

### ❌ Bad Code
```sql
-- supabase/migrations/001_create_repair_orders.sql
CREATE POLICY "users_can_view_repair_orders"
ON repair_orders
FOR SELECT
USING (true);
```

### Audit Result
```
🔴 CRITICAL ISSUE
Category: RLS Policy
File: supabase/migrations/001_create_repair_orders.sql:2
Issue: RLS policy on org-scoped table 'repair_orders' missing org_id filter
Fix: Add org_id filtering to the policy
Example: USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()))
```

### ✅ Fixed Code
```sql
CREATE POLICY "users_can_view_own_org_repair_orders"
ON repair_orders
FOR SELECT
USING (
  org_id IN (
    SELECT org_id 
    FROM organization_members 
    WHERE user_id = auth.uid()
  )
);
```

---

## Example 5: Edge Function Without Validation (CRITICAL)

### ❌ Bad Code
```typescript
// supabase/functions/create-repair-order/index.ts
Deno.serve(async (req) => {
  const { order_data } = await req.json();
  
  const { data, error } = await supabase
    .from('repair_orders')
    .insert(order_data);
  
  return new Response(JSON.stringify(data));
});
```

### Audit Results
```
🔴 CRITICAL ISSUE #1
Category: Edge Function
File: supabase/functions/create-repair-order/index.ts:1
Issue: Edge function missing org_id parameter extraction
Fix: Extract org_id from request body: const { org_id } = await req.json()
Example: const { org_id, shop_id } = await req.json();

🔴 CRITICAL ISSUE #2
Category: Edge Function
File: supabase/functions/create-repair-order/index.ts:1
Issue: Edge function missing user authentication
Fix: Validate user token: const { data: { user } } = await supabase.auth.getUser(token)
Example: const authHeader = req.headers.get('Authorization'); const { data: { user } } = await supabase.auth.getUser(token);

🔴 CRITICAL ISSUE #3
Category: Edge Function
File: supabase/functions/create-repair-order/index.ts:1
Issue: Edge function missing org membership validation
Fix: Check user org membership before processing
Example: const { data: membership } = await supabase.from('organization_members').select('role').eq('user_id', user.id).eq('org_id', org_id).single();
```

### ✅ Fixed Code
```typescript
Deno.serve(async (req) => {
  // 1. Extract parameters
  const { org_id, shop_id, order_data } = await req.json();
  
  // 2. Validate authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // 3. Validate org membership
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', org_id)
    .single();
  
  if (membershipError || !membership) {
    return new Response('Forbidden', { status: 403 });
  }
  
  // 4. Create repair order with proper scoping
  const { data, error } = await supabase
    .from('repair_orders')
    .insert({
      ...order_data,
      org_id,
      shop_id,
      created_by: user.id
    });
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
  
  return new Response(JSON.stringify(data));
});
```

---

## Example 6: Sensitive Action Without Role Guard (WARNING)

### ⚠️ Suboptimal Code
```tsx
// src/components/RepairOrderActions.tsx
export function RepairOrderActions({ orderId }: { orderId: string }) {
  const handleDelete = () => {
    deleteRepairOrder(orderId);
  };
  
  return (
    <Button onClick={handleDelete}>Delete Order</Button>
  );
}
```

### Audit Result
```
⚠️ WARNING
Category: Frontend Guard
File: src/components/RepairOrderActions.tsx:7
Issue: Sensitive action 'delete' button without role guard
Fix: Wrap with <RequireRole> or add role check
Example: {canAccess && <Button onClick={handleDelete}>Delete</Button>}
```

### ✅ Fixed Code (Option 1: Using Permission Hook)
```tsx
export function RepairOrderActions({ orderId }: { orderId: string }) {
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission('repair_orders.delete');
  
  const handleDelete = () => {
    deleteRepairOrder(orderId);
  };
  
  return (
    <>
      {canDelete && (
        <Button onClick={handleDelete}>Delete Order</Button>
      )}
    </>
  );
}
```

### ✅ Fixed Code (Option 2: Using Role Component)
```tsx
export function RepairOrderActions({ orderId }: { orderId: string }) {
  const handleDelete = () => {
    deleteRepairOrder(orderId);
  };
  
  return (
    <RequireRole role={['admin', 'manager']}>
      <Button onClick={handleDelete}>Delete Order</Button>
    </RequireRole>
  );
}
```

---

## Example 7: Schema Change Without RLS (WARNING)

### ⚠️ Suboptimal Code
```sql
-- supabase/migrations/002_add_priority_to_orders.sql
ALTER TABLE repair_orders
ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';
```

### Audit Result
```
⚠️ WARNING
Category: Schema Change
File: supabase/migrations/002_add_priority_to_orders.sql:2
Issue: Added org/shop column but missing RLS policy update
Suggestion: Add or update RLS policies for the new column
Example: CREATE POLICY "users_see_own_org" ON repair_orders USING (org_id IN (...));
```

### ✅ Fixed Code
```sql
ALTER TABLE repair_orders
ADD COLUMN priority VARCHAR(20) DEFAULT 'normal';

-- Ensure RLS is enabled (if not already)
ALTER TABLE repair_orders ENABLE ROW LEVEL SECURITY;

-- Update or verify policies
CREATE POLICY IF NOT EXISTS "users_see_own_org_repair_orders"
ON repair_orders
FOR SELECT
USING (
  org_id IN (
    SELECT org_id 
    FROM organization_members 
    WHERE user_id = auth.uid()
  )
);
```

---

## Example 8: Complete Component with All Best Practices

### ✅ Excellent Code
```tsx
// src/components/RepairOrderList.tsx
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useShop } from '@/contexts/ShopContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';

export function RepairOrderList() {
  // 1. Get org/shop context
  const { orgId } = useOrganization();
  const { shopId } = useShop();
  const { hasPermission } = usePermissions();
  
  // 2. Query with proper scoping
  const { data: orders } = useQuery({
    queryKey: ['repair-orders', orgId, shopId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repair_orders')
        .select('*')
        .eq('org_id', orgId)
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!shopId
  });
  
  // 3. Protected actions
  const canCreate = hasPermission('repair_orders.create');
  const canDelete = hasPermission('repair_orders.delete');
  
  const handleDelete = async (orderId: string) => {
    if (!canDelete) return;
    
    await supabase
      .from('repair_orders')
      .delete()
      .eq('id', orderId)
      .eq('org_id', orgId); // Still scope deletes!
  };
  
  return (
    <div>
      {canCreate && (
        <Button onClick={() => navigate('/repair-orders/new')}>
          Create New Order
        </Button>
      )}
      
      {orders?.map(order => (
        <div key={order.id}>
          <h3>{order.title}</h3>
          
          {canDelete && (
            <Button onClick={() => handleDelete(order.id)}>
              Delete
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
```

**Why this is excellent:**
- ✅ Uses org/shop context hooks
- ✅ Query keys include orgId and shopId
- ✅ Query is enabled only when orgId and shopId exist
- ✅ Database queries include org_id and shop_id filters
- ✅ Sensitive actions are protected by permission checks
- ✅ Delete operations still include org_id filter for safety

---

## Running the Audit

### Local Development
```bash
# Install dependencies
npm install

# Run audit on your changes
npm run audit

# Or run directly
node scripts/audit-org-shop-scoping.js
```

### In CI/CD
The audit runs automatically on:
- Every push to `main` or `develop`
- Every pull request

Check the PR comments for audit results.

### Interpreting Results

#### CRITICAL Issues (Must Fix)
- Block PR merges
- Indicate security vulnerabilities
- Can lead to data leakage or unauthorized access

#### WARNING Issues (Should Fix)
- Don't block PR merges
- Indicate best practice violations
- May impact performance or maintainability

#### RECOMMENDATION Issues (Nice to Have)
- Suggestions for improvement
- Optional optimizations
- Code quality enhancements

---

## Tips for Passing the Audit

1. **Always include orgId in query keys**
   ```typescript
   // Good: queryKey: ['items', orgId]
   // Bad:  queryKey: ['items']
   ```

2. **Always filter queries by org_id**
   ```typescript
   // Good: .eq('org_id', orgId)
   // Bad:  No org_id filter
   ```

3. **Use enabled with orgId**
   ```typescript
   // Good: enabled: !!orgId
   // Bad:  enabled: true
   ```

4. **Protect sensitive UI actions**
   ```typescript
   // Good: {canDelete && <Button>Delete</Button>}
   // Bad:  <Button>Delete</Button>
   ```

5. **Validate everything in edge functions**
   - Extract org_id from request
   - Validate user authentication
   - Check org membership
   - Filter all queries

---

## Common False Positives

### 1. Public Tables
If you have tables that are intentionally not org-scoped, you may need to:
- Remove them from `orgScopedTables` array
- Document why they're public
- Ensure they don't contain sensitive data

### 2. Admin Queries
If you have admin-only queries that legitimately need to access all orgs:
- Add comments explaining the admin use case
- Ensure proper role checks are in place
- Consider separate admin-specific functions

### 3. Test Files
The audit skips files in common test directories, but if you have tests elsewhere:
- Add test patterns to `.gitignore`
- Or filter them in the audit script

---

For more information, see [AUDIT_AGENT_README.md](./AUDIT_AGENT_README.md)
