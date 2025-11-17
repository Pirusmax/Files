module.exports = {
  rules: {
    'require-org-id-in-queries': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Ensure org_id is included in Supabase queries for org-scoped tables'
        },
        messages: {
          missingOrgId: 'Query on org-scoped table "{{table}}" is missing .eq("org_id", orgId)'
        }
      },
      create(context) {
        const orgScopedTables = [
          'repair_orders', 'purchase_orders', 'units', 'parts_inventory',
          'inspections', 'time_entries', 'labor_entries', 'shops',
          'organization_members', 'pm_schedules', 'vendors'
        ];
        
        return {
          CallExpression(node) {
            if (
              node.callee.type === 'MemberExpression' &&
              node.callee.property.name === 'from' &&
              node.arguments.length > 0
            ) {
              const tableName = node.arguments[0].value;
              
              if (orgScopedTables.includes(tableName)) {
                // Check if .eq('org_id', ...) exists in the chain
                let parent = node.parent;
                let hasOrgIdFilter = false;
                
                while (parent && parent.type === 'MemberExpression') {
                  if (
                    parent.property.name === 'eq' &&
                    parent.parent.arguments &&
                    parent.parent.arguments[0].value === 'org_id'
                  ) {
                    hasOrgIdFilter = true;
                    break;
                  }
                  parent = parent.parent;
                }
                
                if (!hasOrgIdFilter) {
                  context.report({
                    node,
                    messageId: 'missingOrgId',
                    data: { table: tableName }
                  });
                }
              }
            }
          }
        };
      }
    },
    
    'require-org-id-in-query-keys': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Ensure orgId is included in React Query keys for org-scoped data'
        },
        messages: {
          missingOrgIdInKey: 'Query key for org-scoped data should include orgId'
        }
      },
      create(context) {
        const orgScopedKeys = [
          'repair-orders', 'purchase-orders', 'units', 'parts-inventory',
          'inspections', 'time-entries', 'labor-entries', 'shops',
          'organization-members', 'pm-schedules', 'vendors'
        ];
        
        return {
          Property(node) {
            if (
              node.key.name === 'queryKey' &&
              node.value.type === 'ArrayExpression'
            ) {
              const elements = node.value.elements;
              if (elements.length > 0) {
                const hasOrgId = elements.some(el => 
                  el.type === 'Identifier' && 
                  (el.name === 'orgId' || el.name === 'org_id')
                );
                
                if (!hasOrgId) {
                  // Check if first element suggests org-scoped data
                  const firstElement = elements[0];
                  if (
                    firstElement.type === 'Literal' &&
                    typeof firstElement.value === 'string'
                  ) {
                    const keyName = firstElement.value;
                    if (orgScopedKeys.some(key => keyName.includes(key))) {
                      context.report({
                        node,
                        messageId: 'missingOrgIdInKey'
                      });
                    }
                  }
                }
              }
            }
          }
        };
      }
    },
    
    'require-role-guard-on-sensitive-actions': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Ensure sensitive UI actions have role-based guards'
        },
        messages: {
          missingRoleGuard: 'Sensitive action "{{action}}" should have a role guard (RequireRole, canAccess, or hasPermission)'
        }
      },
      create(context) {
        const sensitiveActions = ['delete', 'remove', 'create', 'edit', 'update', 'approve', 'cancel'];
        
        return {
          JSXElement(node) {
            const elementName = node.openingElement.name.name;
            
            if (['button', 'Button', 'Link'].includes(elementName)) {
              // Check for onClick or href attributes
              const attributes = node.openingElement.attributes;
              
              attributes.forEach(attr => {
                if (attr.type === 'JSXAttribute' && 
                    (attr.name.name === 'onClick' || attr.name.name === 'href')) {
                  
                  // Get the source code around this element
                  const sourceCode = context.getSourceCode();
                  const elementText = sourceCode.getText(node);
                  
                  // Check if any sensitive action is present
                  const hasSensitiveAction = sensitiveActions.some(action => 
                    elementText.toLowerCase().includes(action)
                  );
                  
                  if (hasSensitiveAction) {
                    // Check for role guards in parent scope
                    let current = node;
                    let hasRoleGuard = false;
                    
                    while (current && !hasRoleGuard) {
                      const parentText = sourceCode.getText(current);
                      hasRoleGuard = 
                        parentText.includes('RequireRole') ||
                        parentText.includes('canAccess') ||
                        parentText.includes('hasPermission') ||
                        parentText.includes('isAdmin');
                      
                      current = current.parent;
                    }
                    
                    if (!hasRoleGuard) {
                      const action = sensitiveActions.find(a => 
                        elementText.toLowerCase().includes(a)
                      );
                      
                      context.report({
                        node,
                        messageId: 'missingRoleGuard',
                        data: { action }
                      });
                    }
                  }
                }
              });
            }
          }
        };
      }
    },
    
    'require-org-context-with-queries': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Ensure components using React Query also use organization context'
        },
        messages: {
          missingOrgContext: 'Component uses React Query but does not import useOrganization or useShop hooks'
        }
      },
      create(context) {
        let hasQueryHook = false;
        let hasOrgContext = false;
        
        return {
          ImportDeclaration(node) {
            const source = node.source.value;
            
            // Check for React Query imports
            if (source.includes('@tanstack/react-query') || source.includes('react-query')) {
              node.specifiers.forEach(spec => {
                if (spec.imported && 
                    ['useQuery', 'useMutation', 'useInfiniteQuery'].includes(spec.imported.name)) {
                  hasQueryHook = true;
                }
              });
            }
            
            // Check for org/shop context imports
            if (source.includes('context') || source.includes('hooks')) {
              node.specifiers.forEach(spec => {
                if (spec.imported && 
                    ['useOrganization', 'useShop', 'useOrgContext', 'useShopContext'].includes(spec.imported.name)) {
                  hasOrgContext = true;
                }
              });
            }
          },
          
          'Program:exit'() {
            if (hasQueryHook && !hasOrgContext) {
              context.report({
                loc: { line: 1, column: 0 },
                messageId: 'missingOrgContext'
              });
            }
          }
        };
      }
    }
  }
};
