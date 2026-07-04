-- Records when the user accepted this Creator Connections campaign on Amazon
-- from inside MVP (the /epc "Accept on Amazon" button, delivered by SCOUT).
-- Importing a campaign no longer accepts it — accepting is an explicit choice.
alter table public.campaigns
  add column if not exists accepted_at timestamptz;
