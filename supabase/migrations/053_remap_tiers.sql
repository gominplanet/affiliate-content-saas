-- 053 — Remap integrations.tier from the old 5-tier set to the new
-- 2-paid-tier model.
--
--   free    → trial    (free trial, now 5 posts lifetime)
--   starter → creator  ($49, same Stripe price)
--   growth  → creator  ($99 Growth archived; fold remaining users into Creator)
--   pro     → pro       (unchanged)
--   admin   → admin     (unchanged)
--
-- Safe because there are no paid subscribers at migration time. Idempotent:
-- re-running maps nothing once values are already new. Also normalizes any
-- NULL tier (legacy rows) to 'trial' so code defaults and the DB agree.

update public.integrations set tier = 'trial'   where tier = 'free';
update public.integrations set tier = 'creator' where tier in ('starter', 'growth');
update public.integrations set tier = 'trial'   where tier is null;
