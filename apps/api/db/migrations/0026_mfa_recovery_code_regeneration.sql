ALTER TABLE mfa_events DROP CONSTRAINT mfa_events_event_check;
ALTER TABLE mfa_events ADD CONSTRAINT mfa_events_event_check CHECK (
  event IN ('enrolled','confirmed','verified','recovered','failed','reset','recovery_codes_regenerated')
);
