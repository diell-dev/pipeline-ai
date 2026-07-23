-- ============================================================
-- Migration 037: correct Books dashboard KPIs (bug found 2026-07-21).
--
-- The dashboard computed Outstanding AR / AP / Cash and the revenue-vs-expense
-- chart by pulling every relevant journal_entry_line into the browser and
-- summing client-side. Those reads had NO pagination, so PostgREST's default
-- 1000-row cap silently truncated them. NYSD has 2,469 lines on the monetary
-- accounts alone, so AR summed only a subset of its debits without the
-- offsetting payment credits — showing ~$646k when AR is actually $0, cash $0
-- when the bank holds $814k, and a near-empty chart.
--
-- Fix: aggregate in SQL, return one tiny JSON payload. Correct regardless of
-- ledger size and far cheaper than shipping thousands of rows per load.
-- SECURITY DEFINER but guarded to the caller's own org.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-21.
-- ============================================================

CREATE OR REPLACE FUNCTION public.books_dashboard_kpis(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tz            TEXT;
  v_month_start   DATE;
  v_month_end     DATE;
  v_month_rev     BIGINT;
  v_month_exp     BIGINT;
  v_ar            BIGINT;
  v_ap            BIGINT;
  v_cash          BIGINT;
  v_series        JSONB;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.get_user_org_id() = p_org_id) THEN
      RAISE EXCEPTION 'Not authorized to read this organization''s books'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  SELECT COALESCE(timezone, 'America/New_York') INTO v_tz
  FROM organizations WHERE id = p_org_id;
  IF v_tz IS NULL THEN v_tz := 'America/New_York'; END IF;

  v_month_start := date_trunc('month', (now() AT TIME ZONE v_tz))::date;
  v_month_end   := (v_month_start + INTERVAL '1 month')::date;

  SELECT
    COALESCE(SUM(jel.credit_cents - jel.debit_cents) FILTER (WHERE coa.type = 'income'), 0),
    COALESCE(SUM(jel.debit_cents - jel.credit_cents) FILTER (WHERE coa.type = 'expense'), 0)
  INTO v_month_rev, v_month_exp
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN chart_of_accounts coa   ON coa.id = jel.account_id
  WHERE je.organization_id = p_org_id
    AND je.deleted_at IS NULL
    AND je.posted_at IS NOT NULL
    AND je.entry_date >= v_month_start
    AND je.entry_date <  v_month_end;

  SELECT
    COALESCE(SUM(jel.debit_cents - jel.credit_cents) FILTER (
      WHERE coa.code = '1100' OR coa.subtype = 'accounts_receivable'), 0),
    COALESCE(SUM(jel.credit_cents - jel.debit_cents) FILTER (
      WHERE coa.code = '2000' OR coa.subtype = 'accounts_payable'), 0),
    COALESCE(SUM(jel.debit_cents - jel.credit_cents) FILTER (
      WHERE coa.subtype IN ('cash', 'bank')), 0)
  INTO v_ar, v_ap, v_cash
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN chart_of_accounts coa   ON coa.id = jel.account_id
  WHERE je.organization_id = p_org_id
    AND je.deleted_at IS NULL
    AND je.posted_at IS NOT NULL;

  WITH months AS (
    SELECT gs::date AS m_start,
           (gs + INTERVAL '1 month')::date AS m_end,
           to_char(gs, 'YYYY-MM') AS label
    FROM generate_series(
      date_trunc('month', (now() AT TIME ZONE v_tz)) - INTERVAL '5 months',
      date_trunc('month', (now() AT TIME ZONE v_tz)),
      INTERVAL '1 month'
    ) gs
  ),
  per_month AS (
    SELECT m.label,
      COALESCE(SUM(jel.credit_cents - jel.debit_cents) FILTER (WHERE coa.type = 'income'), 0)  AS revenue_cents,
      COALESCE(SUM(jel.debit_cents - jel.credit_cents) FILTER (WHERE coa.type = 'expense'), 0) AS expenses_cents
    FROM months m
    LEFT JOIN journal_entries je
      ON je.organization_id = p_org_id AND je.deleted_at IS NULL AND je.posted_at IS NOT NULL
     AND je.entry_date >= m.m_start AND je.entry_date < m.m_end
    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    LEFT JOIN chart_of_accounts coa   ON coa.id = jel.account_id
    GROUP BY m.label
  )
  SELECT jsonb_agg(jsonb_build_object(
           'month', label, 'revenue_cents', revenue_cents, 'expenses_cents', expenses_cents
         ) ORDER BY label)
  INTO v_series FROM per_month;

  RETURN jsonb_build_object(
    'month_revenue_cents',  v_month_rev,
    'month_expenses_cents', v_month_exp,
    'ar_cents',   v_ar,
    'ap_cents',   v_ap,
    'cash_cents', v_cash,
    'series',     COALESCE(v_series, '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.books_dashboard_kpis(UUID) FROM anon;
