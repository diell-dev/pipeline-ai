-- Migration 027: clients should not see void/cancelled invoices.
-- Portal audit: the client invoice policies only excluded 'draft', so a
-- voided invoice with balance_due_cents > 0 showed up as "outstanding" in the
-- portal and inflated the outstanding-balance KPI. Exclude void/cancelled.
DROP POLICY IF EXISTS "Client can view own invoices" ON invoices;
CREATE POLICY "Client can view own invoices" ON invoices FOR SELECT USING (
  get_user_role() = 'client'
  AND client_id = get_user_client_id()
  AND status NOT IN ('draft','void','cancelled')
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Client can view own invoice lines" ON invoice_line_items;
CREATE POLICY "Client can view own invoice lines" ON invoice_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items.invoice_id
    AND i.client_id = get_user_client_id()
    AND get_user_role() = 'client'
    AND i.status NOT IN ('draft','void','cancelled')
    AND i.deleted_at IS NULL)
);
