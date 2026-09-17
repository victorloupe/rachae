-- ============================================================
-- Migração: Categorias nas contas fixas
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ============================================================

ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'outros';

COMMENT ON COLUMN public.contas_fixas.categoria IS 'Categoria da conta: moradia, contas (água/luz/internet), alimentacao, lazer ou outros.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração.
-- ============================================================
