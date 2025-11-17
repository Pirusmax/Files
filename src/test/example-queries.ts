// Test file with scoping issues
import { supabase } from './supabase';

// ❌ Missing org_id filter
export async function getRepairOrders() {
  const { data } = await supabase
    .from('repair_orders')
    .select('*');
  
  return data;
}

// ❌ Missing shop_id filter
export async function getOrdersForOrg(orgId: string) {
  const { data } = await supabase
    .from('repair_orders')
    .select('*')
    .eq('org_id', orgId);
  
  return data;
}

// ✅ Properly scoped
export async function getOrdersForShop(orgId: string, shopId: string) {
  const { data } = await supabase
    .from('repair_orders')
    .select('*')
    .eq('org_id', orgId)
    .eq('shop_id', shopId);
  
  return data;
}
