-- ============================================================
-- Migration 036: Proposal follow-up reminders (Bogdan's request 2026-07-21).
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-21.
--
-- When a proposal is sent to a client and the client doesn't respond, nobody
-- was ever nudged. This adds the state the nightly cron needs to send at most
-- two reminders per proposal (day 3, day 7) to the org's owner + office
-- managers, without re-sending the same stage twice.
--   last_follow_up_stage: 0 = none, 1 = day-3 sent, 2 = day-7 sent.
-- ============================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS last_follow_up_stage SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN proposals.last_follow_up_stage IS
  'Highest follow-up reminder stage already emailed for the current send: 0=none, 1=day-3, 2=day-7. Reset to 0 on each send_to_client.';

CREATE OR REPLACE FUNCTION public.reset_proposal_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sent_to_client_at IS NOT NULL
     AND NEW.sent_to_client_at IS DISTINCT FROM OLD.sent_to_client_at THEN
    NEW.last_follow_up_stage := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_proposal_follow_up ON proposals;
CREATE TRIGGER trg_reset_proposal_follow_up
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION public.reset_proposal_follow_up();

CREATE INDEX IF NOT EXISTS idx_proposals_awaiting_followup
  ON proposals (sent_to_client_at)
  WHERE status = 'sent_to_client' AND deleted_at IS NULL;
