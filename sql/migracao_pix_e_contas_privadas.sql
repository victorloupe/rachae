-- ============================================================
-- Migração: Chave Pix da Casa & Contas Fixas Privadas
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ============================================================

-- 1. Colunas de Chave Pix na tabela 'casas'
ALTER TABLE public.casas
  ADD COLUMN IF NOT EXISTS chave_pix text,
  ADD COLUMN IF NOT EXISTS tipo_chave_pix text DEFAULT 'telefone';

-- 2. Coluna 'privada' na tabela 'contas_fixas'
ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS privada boolean NOT NULL DEFAULT false;

-- 3. Comentários para documentação das novas colunas
COMMENT ON COLUMN public.casas.chave_pix IS 'Chave Pix da casa para geração de QR Code e recebimento das cobranças.';
COMMENT ON COLUMN public.casas.tipo_chave_pix IS 'Tipo da chave Pix: telefone, cpf, cnpj, email ou aleatoria.';
COMMENT ON COLUMN public.contas_fixas.privada IS 'Quando true, esta conta e suas cobranças só são visíveis pelo administrador e pelo morador responsável (oculta dos demais moradores).';

-- 4. Notifica o PostgREST para recarregar o cache de schema imediatamente
NOTIFY pgrst, 'reload schema';
