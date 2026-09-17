-- ============================================================
-- Migração: Conta Parcelada (ex.: TV comprada em 10x)
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- O QUE ISSO FAZ:
-- Permite marcar uma conta fixa como parcelada (ex: uma TV dividida
-- em 10x). O mês de início da conta (campo que já existia) vira o
-- mês da parcela 1; o app calcula sozinho qual parcela é cada mês e
-- para de gerar cobrança automaticamente depois da última parcela.
-- ============================================================

ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS parcelado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcelas_total int;

COMMENT ON COLUMN public.contas_fixas.parcelado IS 'Quando true, esta conta é cobrada por um número limitado de meses (parcelas_total), a partir de mes_inicio.';
COMMENT ON COLUMN public.contas_fixas.parcelas_total IS 'Quantidade total de parcelas/meses da conta parcelada (ex: 10 para um produto pago em 10x).';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração.
-- ============================================================
