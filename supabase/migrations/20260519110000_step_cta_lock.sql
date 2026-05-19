-- Phase: AI batch variant generation
--
-- cta_lock holds a "must-include verbatim" phrase that the AI variant
-- generator is forced to weave into every variant it produces. Keeps the
-- core ask consistent across variants even as the rest of the copy diverges.
--
-- NULL = no lock (default). Empty string treated as NULL by the generator.

ALTER TABLE sequence_steps
  ADD COLUMN cta_lock TEXT;
