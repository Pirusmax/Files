# Org/Shop Scoping Audit Agent

This automated audit agent monitors, validates, and reports on the effectiveness and integrity of Organization and Shop scoping across all MaintenIX features.

## Overview

The audit agent is designed to:
- Automatically scan code changes for org/shop scoping issues
- Validate database queries include proper org_id/shop_id filters
- Ensure React Query keys include orgId/shopId for scoped data
- Check RLS policies enforce org_id filtering
- Verify edge functions validate org membership
- Confirm frontend guards protect sensitive actions
- Review schema changes for proper scoping

## Architecture

### Components

1. **GitHub Actions Workflow** (`.github/workflows/org-shop-audit.yml`)
   - Triggers on push and pull requests
   - Runs the audit script
   - Posts results as PR comments
   - Fails CI if critical issues are found

2. **Audit Script** (`scripts/audit-org-shop-scoping.js`)
   - Main audit logic
   - Scans files for scoping violations
   - Generates detailed reports
   - Outputs results in JSON format

3. **ESLint Plugin** (`eslint-plugin-org-shop-scoping.js`)
   - IDE integration for real-time feedback
   - Custom rules for org/shop scoping
   - Catches issues during development

## Features

### 1. Database Query Auditing

Checks for:
- Queries on org-scoped tables without `.eq('org_id', orgId)`
- Queries on shop-scoped tables missing `.eq('shop_id', shopId)`

**Org-scoped tables:**
- repair_orders
- purchase_orders
- units
- parts_inventory
- inspections
- time_entries
- labor_entries
- shops
- organization_members
- pm_schedules
- vendors

**Shop-scoped tables:**
- repair_orders
- purchase_orders
- parts_inventory
- time_entries
- labor_entries
- inspections

### 2. React Query Key Auditing

Verifies:
- Query keys include `orgId` for org-scoped data
- Query keys include `shopId` for shop-scoped data
- `enabled` prop depends on orgId/shopId availability

Example:
```typescript
// ❌ Bad
queryKey: ['repair-orders']

// ✅ Good
queryKey: ['repair-orders', orgId, shopId]
enabled: !!orgId && !!shopId
```

### 3. RLS Policy Auditing

Ensures:
- All RLS policies on org-scoped tables filter by `org_id`
- New tables include org_id columns
- Tables have proper foreign key constraints

Example:
```sql
-- ✅ Good
CREATE POLICY "users_see_own_org_repair_orders"
ON repair_orders
USING (org_id IN (
  SELECT org_id FROM organization_members WHERE user_id = auth.uid()
));
```

### 4. Edge Function Auditing

Validates:
- Functions extract org_id from request
- Functions validate user authentication
- Functions check org membership before processing

Example:
```typescript
// ✅ Good
const { org_id } = await req.json();
const authHeader = req.headers.get('Authorization');
const { data: { user } } = await supabase.auth.getUser(token);

const { data: membership } = await supabase
  .from('organization_members')
  .select('role')
  .eq('user_id', user.id)
  .eq('org_id', org_id)
  .single();
```

### 5. Frontend Guard Auditing

Checks:
- Sensitive action buttons have role guards
- Components use org/shop context hooks
- Proper permission checks before actions

Example:
```typescript
// ✅ Good
{canAccess && (
  <Button onClick={handleDelete}>Delete</Button>
)}

// Or with RequireRole wrapper
<RequireRole role="admin">
  <Button onClick={handleDelete}>Delete</Button>
</RequireRole>
```

### 6. Schema Change Auditing

Reviews:
- ALTER TABLE statements adding org_id/shop_id
- New columns include RLS policy updates
- Proper indexing on scoping columns

## Usage

### Running Locally

```bash
# Install dependencies
npm install

# Run the audit
npm run audit

# Or run directly
node scripts/audit-org-shop-scoping.js
```

### CI/CD Integration

The audit automatically runs on:
- Push to `main` or `develop` branches
- Pull requests targeting `main` or `develop`

Results are posted as PR comments with:
- Overall pass/fail status
- Compliance score
- Critical issues
- Warnings
- Detailed findings

### ESLint Integration

Add to your `.eslintrc.js`:

```javascript
module.exports = {
  plugins: ['./eslint-plugin-org-shop-scoping'],
  rules: {
    'org-shop-scoping/require-org-id-in-queries': 'error',
    'org-shop-scoping/require-org-id-in-query-keys': 'error',
    'org-shop-scoping/require-role-guard-on-sensitive-actions': 'warn',
    'org-shop-scoping/require-org-context-with-queries': 'warn'
  }
};
```

## Audit Results

The audit generates a JSON report (`audit-results.json`) with:

```json
{
  "passed": true,
  "score": 45,
  "totalChecks": 50,
  "criticalIssues": 0,
  "warnings": 5,
  "recommendations": 2,
  "filesScanned": 25,
  "details": "...",
  "detailedReport": "...",
  "issues": [...]
}
```

### Issue Types

1. **CRITICAL**: Security or data isolation issues that must be fixed
   - Missing org_id filters on queries
   - RLS policies without org_id checks
   - Edge functions without auth validation

2. **WARNING**: Best practices that should be addressed
   - Missing shop_id filters
   - Queries enabled without orgId dependency
   - Sensitive actions without role guards

3. **RECOMMENDATION**: Suggestions for improvement
   - Missing context hook imports
   - Optimization opportunities

## Best Practices

### Database Queries

Always include org_id filter:
```typescript
const { data } = await supabase
  .from('repair_orders')
  .select('*')
  .eq('org_id', orgId)  // ✅ Required
  .eq('shop_id', shopId); // ✅ Good for shop-scoped
```

### React Query

Include orgId in query keys:
```typescript
const { data } = useQuery({
  queryKey: ['repair-orders', orgId, shopId],
  queryFn: () => fetchRepairOrders(orgId, shopId),
  enabled: !!orgId && !!shopId
});
```

### RLS Policies

Always filter by org_id:
```sql
CREATE POLICY "org_isolation"
ON repair_orders
USING (
  org_id IN (
    SELECT org_id 
    FROM organization_members 
    WHERE user_id = auth.uid()
  )
);
```

### Edge Functions

Validate everything:
```typescript
// 1. Extract parameters
const { org_id, shop_id } = await req.json();

// 2. Validate auth
const token = req.headers.get('Authorization')?.replace('Bearer ', '');
const { data: { user } } = await supabase.auth.getUser(token);

// 3. Check membership
const { data: membership } = await supabase
  .from('organization_members')
  .select('role')
  .eq('user_id', user.id)
  .eq('org_id', org_id)
  .single();

if (!membership) {
  return new Response('Unauthorized', { status: 403 });
}
```

### Frontend Guards

Protect sensitive actions:
```typescript
const { canAccess } = usePermissions();

return (
  <>
    {canAccess && (
      <Button onClick={handleDelete}>Delete</Button>
    )}
  </>
);
```

## Troubleshooting

### False Positives

If the audit reports false positives:
1. Ensure your code follows expected patterns
2. Check that org_id/orgId variables are named correctly
3. Verify RLS policies are in the same file as table definitions

### Adding Exceptions

To skip certain files or patterns, modify the audit script:
```javascript
// In getChangedFiles() or getAllRelevantFiles()
if (file.includes('test') || file.includes('mock')) {
  continue; // Skip test files
}
```

### Customizing Rules

Edit `scripts/audit-org-shop-scoping.js`:
- Add tables to `orgScopedTables` array
- Add shop-scoped tables to `shopScopedTables`
- Modify regex patterns in `patterns` object
- Adjust severity levels in `addIssue()`

## Maintenance

### Updating Scoped Tables

When adding new tables:
1. Add to `orgScopedTables` or `shopScopedTables` arrays
2. Update ESLint plugin if needed
3. Document in this README

### Updating Patterns

When new code patterns emerge:
1. Add regex patterns to `patterns` object
2. Create new audit methods if needed
3. Add examples to documentation

## Contributing

When contributing to the audit agent:
1. Test changes locally first
2. Ensure no false positives are introduced
3. Document new checks in this README
4. Update examples for clarity

## Security Considerations

This audit agent helps prevent:
- **Data leakage**: Queries without org_id filters
- **Unauthorized access**: Missing authentication checks
- **Privilege escalation**: Missing role guards
- **Cross-org data access**: Improper RLS policies

Always treat audit failures seriously, especially CRITICAL issues.

## Support

For issues or questions:
1. Check this documentation
2. Review example code patterns
3. Consult the Feature-Role Matrix
4. Contact the security team

---

*Last updated: 2025-11-17*
