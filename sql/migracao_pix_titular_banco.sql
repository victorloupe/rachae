-- ============================================================
-- Migração: Nome do titular e banco na Chave Pix da Casa
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ============================================================

ALTER TABLE public.casas
  ADD COLUMN IF NOT EXISTS nome_titular_pix text,
  ADD COLUMN IF NOT EXISTS banco_pix text;

COMMENT ON COLUMN public.casas.nome_titular_pix IS 'Nome de quem recebe o Pix, exibido aos moradores para conferência antes de pagar.';
COMMENT ON COLUMN public.casas.banco_pix IS 'Banco/instituição da chave Pix, exibido aos moradores para conferência antes de pagar.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração.
-- ============================================================
