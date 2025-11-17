#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class OrgShopScopingAuditor {
  constructor() {
    this.results = {
      passed: true,
      score: 0,
      totalChecks: 0,
      criticalIssues: 0,
      warnings: 0,
      recommendations: 0,
      filesScanned: 0,
      details: '',
      detailedReport: '',
      issues: []
    };
    
    this.patterns = {
      // Database queries without org_id
      unscopedQueries: [
        /\.from\s*\(\s*['"`]([^'"`]+)['"`]\s*\)(?!.*\.eq\s*\(\s*['"`]org_id['"`])/g,
        /supabase\s*\.from\s*\(\s*['"`]([^'"`]+)['"`]\s*\)(?!.*org_id)/g
      ],
      
      // React Query keys without orgId
      unscopedQueryKeys: [
        /queryKey\s*:\s*\[['"`]([^'"`]+)['"`](?![^[\]]*orgId)/g,
        /useQuery\s*\(\s*\[['"`]([^'"`]+)['"`](?![^[\]]*orgId)/g
      ],
      
      // Missing org_id in RLS policies
      rlsWithoutOrgId: [
        /CREATE\s+POLICY.*ON\s+([^\s]+).*(?!org_id)/gi
      ],
      
      // Edge functions without org validation
      edgeFunctionNoOrgValidation: [
        /Deno\.serve\s*\(.*\{[\s\S]*?\}[\s\S]*?\)/g
      ],
      
      // Missing role guards
      missingRoleGuards: [
        /<(button|Button|Link)(?![^>]*RequireRole)(?![^>]*canAccess)/g
      ]
    };
    
    this.orgScopedTables = [
      'repair_orders', 'purchase_orders', 'units', 'parts_inventory', 
      'inspections', 'time_entries', 'labor_entries', 'shops',
      'organization_members', 'pm_schedules', 'vendors'
    ];
    
    this.shopScopedTables = [
      'repair_orders', 'purchase_orders', 'parts_inventory', 
      'time_entries', 'labor_entries', 'inspections'
    ];
  }

  async run() {
    console.log('🔍 Starting Org/Shop Scoping Audit...');
    
    try {
      // Get changed files
      const changedFiles = this.getChangedFiles();
      console.log(`📁 Found ${changedFiles.length} changed files`);
      
      // Audit each category
      await this.auditDatabaseQueries(changedFiles);
      await this.auditReactQueries(changedFiles);
      await this.auditRLSPolicies(changedFiles);
      await this.auditEdgeFunctions(changedFiles);
      await this.auditFrontendGuards(changedFiles);
      await this.auditSchemaChanges(changedFiles);
      
      // Generate final report
      this.generateReport();
      this.saveResults();
      
      console.log(`✅ Audit completed. Score: ${this.results.score}/${this.results.totalChecks}`);
      
    } catch (error) {
      console.error('❌ Audit failed:', error);
      process.exit(1);
    }
  }

  getChangedFiles() {
    try {
      // Get files changed in this PR/commit
      const baseRef = process.env.GITHUB_BASE_REF || 'origin/main';
      const headRef = process.env.GITHUB_HEAD_REF || 'HEAD';
      
      const diffCommand = `git diff --name-only ${baseRef}...${headRef}`;
      const output = execSync(diffCommand, { encoding: 'utf8' });
      
      return output.trim().split('\n').filter(file => 
        file && (
          file.endsWith('.ts') || 
          file.endsWith('.tsx') || 
          file.endsWith('.js') || 
          file.endsWith('.jsx') ||
          file.endsWith('.sql') ||
          file.includes('supabase/')
        )
      );
    } catch (error) {
      console.warn('⚠️ Could not get changed files, scanning all files');
      return this.getAllRelevantFiles();
    }
  }

  getAllRelevantFiles() {
    const files = [];
    const scanDirs = ['src', 'app', 'pages', 'components', 'lib', 'supabase'];
    
    scanDirs.forEach(dir => {
      if (fs.existsSync(dir)) {
        this.scanDirectory(dir, files);
      }
    });
    
    return files;
  }

  scanDirectory(dir, files) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    entries.forEach(entry => {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        this.scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (['.ts', '.tsx', '.js', '.jsx', '.sql'].includes(ext)) {
          files.push(fullPath);
        }
      }
    });
  }

  async auditDatabaseQueries(files) {
    console.log('🗄️ Auditing database queries...');
    
    const queryFiles = files.filter(f => 
      f.includes('/queries/') || 
      f.includes('/api/') ||
      f.includes('supabase') ||
      f.endsWith('.ts') || 
      f.endsWith('.tsx')
    );

    for (const file of queryFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');
      this.results.filesScanned++;

      // Check for unscoped queries on org-scoped tables
      this.orgScopedTables.forEach(table => {
        const tableQueryRegex = new RegExp(
          `\\.from\\s*\\(\\s*['"\`]${table}['"\`]\\s*\\)`,
          'g'
        );

        let match;
        while ((match = tableQueryRegex.exec(content)) !== null) {
          // Look ahead to find the end of this query chain
          // Query ends at semicolon, closing brace on new line, or return statement
          const queryStart = match.index;
          let queryEnd = content.indexOf(';', queryStart);
          
          // If no semicolon found, look for other ending patterns
          if (queryEnd === -1 || queryEnd > queryStart + 500) {
            queryEnd = queryStart + 300; // reasonable limit
          }
          
          const querySegment = content.substring(queryStart, queryEnd);
          
          // Check if org_id filter exists in this query chain
          const hasOrgIdFilter = /\.eq\s*\(\s*['"`]org_id['"`]/.test(querySegment);
          
          if (!hasOrgIdFilter) {
            this.addIssue({
              type: 'CRITICAL',
              category: 'Database Query',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `Query on table '${table}' missing org_id filter`,
              code: match[0],
              suggestion: `Add .eq('org_id', orgId) to the query`,
              example: `supabase.from('${table}').select('*').eq('org_id', orgId)`
            });
          } else {
            this.results.score++;
          }
        }
        
        this.results.totalChecks++;
      });

      // Check for shop-scoped tables
      this.shopScopedTables.forEach(table => {
        const shopQueryRegex = new RegExp(
          `\\.from\\s*\\(\\s*['"\`]${table}['"\`]\\s*\\)`,
          'g'
        );

        let match;
        while ((match = shopQueryRegex.exec(content)) !== null) {
          // Look ahead to find the query chain end
          const queryStart = match.index;
          let queryEnd = content.indexOf(';', queryStart);
          
          if (queryEnd === -1 || queryEnd > queryStart + 500) {
            queryEnd = queryStart + 300;
          }
          
          const querySegment = content.substring(queryStart, queryEnd);
          
          // Check if org_id and shop_id filters exist
          const hasOrgIdFilter = /\.eq\s*\(\s*['"`]org_id['"`]/.test(querySegment);
          const hasShopIdFilter = /\.eq\s*\(\s*['"`]shop_id['"`]/.test(querySegment);
          
          if (hasOrgIdFilter && !hasShopIdFilter) {
            this.addIssue({
              type: 'WARNING',
              category: 'Database Query',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `Query on shop-scoped table '${table}' has org_id but missing shop_id filter`,
              code: match[0],
              suggestion: `Consider adding .eq('shop_id', shopId) if shop-specific data needed`
            });
          } else if (hasOrgIdFilter && hasShopIdFilter) {
            this.results.score++;
          }
        }
        
        this.results.totalChecks++;
      });
    }
  }

  async auditReactQueries(files) {
    console.log('⚛️ Auditing React Query keys...');
    
    const reactFiles = files.filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));

    for (const file of reactFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');

      // Check for query keys without orgId
      const queryKeyRegex = /queryKey\s*:\s*\[([^\]]+)\]/g;
      let match;
      
      while ((match = queryKeyRegex.exec(content)) !== null) {
        const queryKey = match[1];
        
        // Skip if orgId is present
        if (queryKey.includes('orgId') || queryKey.includes('org_id')) {
          this.results.score++;
        } else {
          // Check if this query is for org-scoped data
          const isOrgScoped = this.orgScopedTables.some(table => 
            queryKey.includes(table) || queryKey.includes(table.replace('_', '-'))
          );
          
          if (isOrgScoped) {
            this.addIssue({
              type: 'CRITICAL',
              category: 'React Query',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `Query key missing orgId for org-scoped data`,
              code: match[0],
              suggestion: `Add orgId to query key: [${queryKey}, orgId]`,
              example: `queryKey: ['repair-orders', orgId, shopId]`
            });
          }
        }
        
        this.results.totalChecks++;
      }

      // Check for enabled queries without orgId dependency
      const enabledRegex = /enabled\s*:\s*([^,\}]+)/g;
      while ((match = enabledRegex.exec(content)) !== null) {
        const enabled = match[1].trim();
        
        if (enabled === 'true' || (!enabled.includes('orgId') && !enabled.includes('org_id'))) {
          // Look backwards to see if this is an org-scoped query
          const beforeEnabled = content.substring(0, match.index);
          const queryKeyMatch = beforeEnabled.match(/queryKey\s*:\s*\[([^\]]+)\]/g);
          
          if (queryKeyMatch) {
            const lastQueryKey = queryKeyMatch[queryKeyMatch.length - 1];
            const isOrgScoped = this.orgScopedTables.some(table => 
              lastQueryKey.includes(table)
            );
            
            if (isOrgScoped && enabled === 'true') {
              this.addIssue({
                type: 'WARNING',
                category: 'React Query',
                file: file,
                line: this.getLineNumber(content, match.index),
                message: `Query enabled without orgId dependency`,
                code: match[0],
                suggestion: `Change to: enabled: !!orgId`,
                example: `enabled: !!orgId && !!shopId`
              });
            }
          }
        } else {
          this.results.score++;
        }
        
        this.results.totalChecks++;
      }
    }
  }

  async auditRLSPolicies(files) {
    console.log('🔒 Auditing RLS policies...');
    
    const sqlFiles = files.filter(f => f.endsWith('.sql') || f.includes('supabase'));

    for (const file of sqlFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');

      // Check for RLS policies on org-scoped tables
      const policyRegex = /CREATE\s+POLICY\s+["']([^"']+)["']\s+ON\s+([^\s]+)/gi;
      let match;
      
      while ((match = policyRegex.exec(content)) !== null) {
        const tableName = match[2].replace(/public\./, '');
        
        if (this.orgScopedTables.includes(tableName)) {
          // Check if policy includes org_id filtering
          const policyEnd = content.indexOf(';', match.index);
          const policyContent = content.substring(match.index, policyEnd);
          
          if (!policyContent.includes('org_id')) {
            this.addIssue({
              type: 'CRITICAL',
              category: 'RLS Policy',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `RLS policy on org-scoped table '${tableName}' missing org_id filter`,
              code: match[0],
              suggestion: `Add org_id filtering to the policy`,
              example: `USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()))`
            });
          } else {
            this.results.score++;
          }
          
          this.results.totalChecks++;
        }
      }

      // Check for table creation without org_id column
      const createTableRegex = /CREATE\s+TABLE\s+([^\s(]+)\s*\(/gi;
      while ((match = createTableRegex.exec(content)) !== null) {
        const tableName = match[1].replace(/public\./, '');
        
        if (this.orgScopedTables.includes(tableName)) {
          const tableEnd = content.indexOf(');', match.index);
          const tableContent = content.substring(match.index, tableEnd);
          
          if (!tableContent.includes('org_id')) {
            this.addIssue({
              type: 'CRITICAL',
              category: 'Database Schema',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `Org-scoped table '${tableName}' missing org_id column`,
              code: match[0],
              suggestion: `Add org_id UUID NOT NULL column`,
              example: `org_id UUID NOT NULL REFERENCES organizations(id)`
            });
          } else {
            this.results.score++;
          }
          
          this.results.totalChecks++;
        }
      }
    }
  }

  async auditEdgeFunctions(files) {
    console.log('🌐 Auditing edge functions...');
    
    const edgeFiles = files.filter(f => 
      f.includes('supabase/functions/') || 
      f.includes('/api/') ||
      f.includes('/edge/')
    );

    for (const file of edgeFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');

      // Check for org_id parameter validation
      if (content.includes('Deno.serve') || content.includes('export default async')) {
        let hasOrgValidation = false;
        let hasUserValidation = false;
        
        // Check for org_id extraction
        if (content.includes('org_id') && content.includes('req.json()')) {
          hasOrgValidation = true;
        }
        
        // Check for auth validation
        if (content.includes('auth.getUser') || content.includes('Authorization')) {
          hasUserValidation = true;
        }
        
        // Check for org membership validation
        const hasMembershipCheck = content.includes('organization_members') &&
          content.includes('user_id') && content.includes('org_id');
        
        if (!hasOrgValidation) {
          this.addIssue({
            type: 'CRITICAL',
            category: 'Edge Function',
            file: file,
            line: 1,
            message: `Edge function missing org_id parameter extraction`,
            suggestion: `Extract org_id from request body: const { org_id } = await req.json()`,
            example: `const { org_id, shop_id } = await req.json();`
          });
        }
        
        if (!hasUserValidation) {
          this.addIssue({
            type: 'CRITICAL',
            category: 'Edge Function',
            file: file,
            line: 1,
            message: `Edge function missing user authentication`,
            suggestion: `Validate user token: const { data: { user } } = await supabase.auth.getUser(token)`,
            example: `const authHeader = req.headers.get('Authorization'); const { data: { user } } = await supabase.auth.getUser(token);`
          });
        }
        
        if (!hasMembershipCheck && hasOrgValidation) {
          this.addIssue({
            type: 'CRITICAL',
            category: 'Edge Function',
            file: file,
            line: 1,
            message: `Edge function missing org membership validation`,
            suggestion: `Check user org membership before processing`,
            example: `const { data: membership } = await supabase.from('organization_members').select('role').eq('user_id', user.id).eq('org_id', org_id).single();`
          });
        }
        
        if (hasOrgValidation && hasUserValidation && hasMembershipCheck) {
          this.results.score += 3;
        }
        
        this.results.totalChecks += 3;
      }
    }
  }

  async auditFrontendGuards(files) {
    console.log('🛡️ Auditing frontend guards...');
    
    const frontendFiles = files.filter(f => f.endsWith('.tsx') || f.endsWith('.jsx'));

    for (const file of frontendFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');

      // Check for sensitive actions without role guards
      const sensitiveActions = [
        'delete', 'remove', 'create', 'edit', 'update', 'approve', 'cancel'
      ];

      sensitiveActions.forEach(action => {
        const buttonRegex = new RegExp(`<(button|Button|Link)[^>]*(?:onClick|href)[^>]*${action}[^>]*>`, 'gi');
        let match;
        
        while ((match = buttonRegex.exec(content)) !== null) {
          // Check if there's a role guard nearby
          const surroundingCode = content.substring(
            Math.max(0, match.index - 200),
            Math.min(content.length, match.index + match[0].length + 200)
          );
          
          const hasRoleGuard = 
            surroundingCode.includes('RequireRole') ||
            surroundingCode.includes('canAccess') ||
            surroundingCode.includes('hasPermission') ||
            surroundingCode.includes('isAdmin') ||
            surroundingCode.includes('role ===');
          
          if (!hasRoleGuard) {
            this.addIssue({
              type: 'WARNING',
              category: 'Frontend Guard',
              file: file,
              line: this.getLineNumber(content, match.index),
              message: `Sensitive action '${action}' button without role guard`,
              code: match[0],
              suggestion: `Wrap with <RequireRole> or add role check`,
              example: `{canAccess && <Button onClick={handleDelete}>Delete</Button>}`
            });
          } else {
            this.results.score++;
          }
          
          this.results.totalChecks++;
        }
      });

      // Check for organization/shop context usage
      const contextRegex = /(useOrganization|useShop|orgId|shopId)/g;
      let contextMatches = 0;
      while (contextRegex.exec(content)) {
        contextMatches++;
      }

      if (contextMatches > 0) {
        // Check if queries are properly scoped
        const queryRegex = /use(Query|InfiniteQuery|Mutation)/g;
        let queryCount = 0;
        while (queryRegex.exec(content)) {
          queryCount++;
        }

        if (queryCount > 0 && contextMatches === 0) {
          this.addIssue({
            type: 'WARNING',
            category: 'Context Usage',
            file: file,
            line: 1,
            message: `File has queries but no org/shop context usage`,
            suggestion: `Import and use useOrganization() and useShop() hooks`,
            example: `const { orgId } = useOrganization(); const { shopId } = useShop();`
          });
        } else if (queryCount > 0) {
          this.results.score++;
        }
        
        this.results.totalChecks++;
      }
    }
  }

  async auditSchemaChanges(files) {
    console.log('📋 Auditing schema changes...');
    
    const migrationFiles = files.filter(f => 
      f.includes('migration') || 
      f.includes('schema') ||
      (f.endsWith('.sql') && f.includes('supabase'))
    );

    for (const file of migrationFiles) {
      if (!fs.existsSync(file)) continue;
      
      const content = fs.readFileSync(file, 'utf8');

      // Check for new tables without proper scoping
      const alterTableRegex = /ALTER\s+TABLE\s+([^\s]+)\s+ADD\s+COLUMN/gi;
      let match;
      
      while ((match = alterTableRegex.exec(content)) !== null) {
        const tableName = match[1].replace(/public\./, '');
        
        if (this.orgScopedTables.includes(tableName)) {
          // Check if adding org_id or shop_id
          const addColumnEnd = content.indexOf(';', match.index);
          const addColumnContent = content.substring(match.index, addColumnEnd);
          
          if (addColumnContent.includes('org_id') || addColumnContent.includes('shop_id')) {
            this.results.score++;
            
            // Check if RLS is also being added
            const afterColumn = content.substring(addColumnEnd);
            if (afterColumn.includes('CREATE POLICY') || afterColumn.includes('ENABLE ROW LEVEL SECURITY')) {
              this.results.score++;
            } else {
              this.addIssue({
                type: 'WARNING',
                category: 'Schema Change',
                file: file,
                line: this.getLineNumber(content, match.index),
                message: `Added org/shop column but missing RLS policy update`,
                suggestion: `Add or update RLS policies for the new column`,
                example: `CREATE POLICY "users_see_own_org" ON ${tableName} USING (org_id IN (...));`
              });
            }
          }
          
          this.results.totalChecks += 2;
        }
      }
    }
  }

  addIssue(issue) {
    this.results.issues.push(issue);
    
    switch (issue.type) {
      case 'CRITICAL':
        this.results.criticalIssues++;
        this.results.passed = false;
        break;
      case 'WARNING':
        this.results.warnings++;
        break;
      case 'RECOMMENDATION':
        this.results.recommendations++;
        break;
    }
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  generateReport() {
    const issues = this.results.issues;
    const criticalIssues = issues.filter(i => i.type === 'CRITICAL');
    const warnings = issues.filter(i => i.type === 'WARNING');
    
    this.results.details = `
### 🔴 Critical Issues (${criticalIssues.length})
${criticalIssues.length === 0 ? '✅ No critical issues found!' : ''}
${criticalIssues.map(issue => `
**${issue.category}** - \`${issue.file}:${issue.line}\`
- **Issue**: ${issue.message}
- **Code**: \`${issue.code || 'N/A'}\`
- **Fix**: ${issue.suggestion}
${issue.example ? `- **Example**: \`${issue.example}\`` : ''}
`).join('\n')}

### ⚠️ Warnings (${warnings.length})
${warnings.length === 0 ? '✅ No warnings!' : ''}
${warnings.map(issue => `
**${issue.category}** - \`${issue.file}:${issue.line}\`
- **Issue**: ${issue.message}
- **Suggestion**: ${issue.suggestion}
${issue.example ? `- **Example**: \`${issue.example}\`` : ''}
`).join('\n')}
    `;

    this.results.detailedReport = `
## Audit Breakdown

### Files Scanned by Category
- **Database Queries**: ${this.results.filesScanned} files
- **React Components**: ${issues.filter(i => i.file.endsWith('.tsx')).length} files
- **Edge Functions**: ${issues.filter(i => i.category === 'Edge Function').length} files
- **SQL Migrations**: ${issues.filter(i => i.file.endsWith('.sql')).length} files

### Compliance Checklist
- ✅ **Database Queries**: ${this.results.totalChecks > 0 ? Math.round((this.results.score / this.results.totalChecks) * 100) : 0}% compliant
- ✅ **React Query Keys**: Include orgId/shopId in scoped queries
- ✅ **RLS Policies**: Enforce org_id filtering on all org-scoped tables
- ✅ **Edge Functions**: Validate user auth + org membership
- ✅ **Frontend Guards**: Role-based access control on sensitive actions
- ✅ **Schema Changes**: New columns include proper scoping + RLS

### Next Steps
${criticalIssues.length > 0 ? `
1. **Fix Critical Issues**: ${criticalIssues.length} critical security issues must be resolved
2. **Address Warnings**: ${warnings.length} warnings should be reviewed
3. **Re-run Audit**: Push changes and re-run this audit
` : `
1. **Review Warnings**: ${warnings.length} warnings for optimization
2. **Monitor**: Set up regular audits for future changes
3. **Document**: Update team guidelines with these patterns
`}

---
*This audit was automatically generated on ${new Date().toISOString()}*
    `;
  }

  saveResults() {
    // Save to file for GitHub Actions
    fs.writeFileSync('audit-results.json', JSON.stringify(this.results, null, 2));
    
    // Output for GitHub Actions
    console.log(`::set-output name=critical_issues::${this.results.criticalIssues}`);
    console.log(`::set-output name=warnings::${this.results.warnings}`);
    console.log(`::set-output name=score::${this.results.score}`);
    console.log(`::set-output name=total_checks::${this.results.totalChecks}`);
  }
}

// Run the auditor
if (require.main === module) {
  const auditor = new OrgShopScopingAuditor();
  auditor.run().catch(error => {
    console.error('Audit failed:', error);
    process.exit(1);
  });
}

module.exports = { OrgShopScopingAuditor };
