# Files

## Org/Shop Scoping Audit Agent

This repository contains an automated audit agent that monitors, validates, and reports on the effectiveness and integrity of Organization and Shop scoping across all MaintenIX features.

### Quick Start

```bash
# Install dependencies
npm install

# Run the audit
npm run audit
```

### Features

- ✅ **Database Query Auditing**: Ensures all queries include org_id/shop_id filters
- ✅ **React Query Validation**: Verifies query keys include orgId/shopId
- ✅ **RLS Policy Checking**: Validates Row Level Security policies enforce org isolation
- ✅ **Edge Function Security**: Confirms proper authentication and authorization
- ✅ **Frontend Guard Protection**: Checks role-based access controls on sensitive actions
- ✅ **Schema Change Review**: Ensures migrations maintain proper scoping

### Documentation

- [Complete Documentation](./AUDIT_AGENT_README.md) - Full feature documentation and configuration
- [Usage Examples](./EXAMPLES.md) - Practical examples and common patterns
- [ESLint Integration](./eslint-plugin-org-shop-scoping.js) - Real-time IDE feedback

### CI/CD Integration

The audit runs automatically on:
- Push to `main` or `develop` branches
- Pull requests targeting `main` or `develop`

Results are posted as PR comments with detailed findings and recommendations.

### Security

This audit agent helps prevent:
- Data leakage between organizations
- Unauthorized access to resources
- Cross-organization data exposure
- Missing authentication checks
- Inadequate role-based access controls

For security issues, please review audit results carefully and address all CRITICAL findings before merging.

---

*For more information, see the [full documentation](./AUDIT_AGENT_README.md).*