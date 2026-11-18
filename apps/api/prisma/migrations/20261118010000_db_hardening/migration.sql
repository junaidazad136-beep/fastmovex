-- Fixed search_path on our functions (Supabase advisor: function_search_path_mutable)
ALTER FUNCTION public.cart_items_changed() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_block_mutation() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_cash_handover_guard() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_check_balanced() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_cod_collection_guard() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_credit_note() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_item_cost() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_lots_within_shelf() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_order_change_immutable() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_receipt_guard() SET search_path = public, pg_catalog;
ALTER FUNCTION public.fastmovex_search_norm(text) SET search_path = public, pg_catalog;
ALTER FUNCTION public.inventory_onhand_guard() SET search_path = public, pg_catalog;
ALTER FUNCTION public.release_delivery_slot() SET search_path = public, pg_catalog;
ALTER FUNCTION public.warehouse_stock_sync() SET search_path = public, pg_catalog;

-- Indexes on foreign keys used by joins, deletes and per-customer lists
CREATE INDEX IF NOT EXISTS "OrderItem_variantId_idx" ON "OrderItem"("variantId");
CREATE INDEX IF NOT EXISTS "CartItem_variantId_idx" ON "CartItem"("variantId");
CREATE INDEX IF NOT EXISTS "Refund_paymentId_idx" ON "Refund"("paymentId");
CREATE INDEX IF NOT EXISTS "Refund_sellerOrderId_idx" ON "Refund"("sellerOrderId");
CREATE INDEX IF NOT EXISTS "ReturnRequest_userId_idx" ON "ReturnRequest"("userId");
CREATE INDEX IF NOT EXISTS "Review_userId_idx" ON "Review"("userId");
CREATE INDEX IF NOT EXISTS "OrderStatusHistory_sellerOrderId_idx" ON "OrderStatusHistory"("sellerOrderId");
CREATE INDEX IF NOT EXISTS "ProductImage_variantId_idx" ON "ProductImage"("variantId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_userId_idx" ON "CouponRedemption"("userId");
CREATE INDEX IF NOT EXISTS "CouponRedemption_orderId_idx" ON "CouponRedemption"("orderId");
CREATE INDEX IF NOT EXISTS "Order_couponId_idx" ON "Order"("couponId");
CREATE INDEX IF NOT EXISTS "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX IF NOT EXISTS "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX IF NOT EXISTS "SupportTicket_orderId_idx" ON "SupportTicket"("orderId");
CREATE INDEX IF NOT EXISTS "SupportTicket_sellerId_idx" ON "SupportTicket"("sellerId");
CREATE INDEX IF NOT EXISTS "RecentlyViewed_productId_idx" ON "RecentlyViewed"("productId");
CREATE INDEX IF NOT EXISTS "DeviceToken_userId_idx" ON "DeviceToken"("userId");
