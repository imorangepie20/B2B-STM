CREATE TABLE public.application_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.application_metadata (key, value)
VALUES ('application', 'b2b-stm');
