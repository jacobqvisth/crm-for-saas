-- Phase 16: Smart Throttling & Circuit Breaker
-- Add pause_reason to gmail_accounts (for circuit breaker)
ALTER TABLE gmail_accounts ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Add sending_settings JSON to workspaces (for workspace-level defaults)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sending_settings JSONB DEFAULT '{}';
