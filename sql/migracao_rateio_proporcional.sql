-- ============================================================
-- Migração: Rateio proporcional aos dias morados
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- O QUE ISSO FAZ:
-- Adiciona a opção (por conta, "Igual para todos") de ratear
-- proporcionalmente aos dias morados quando alguém entra no meio
-- do mês, em vez de deixar essa pessoa de fora da cobrança daquele
-- mês por completo. Quem já morava recebe a cobrança de sempre;
-- quem entrou depois recebe uma cobrança própria, proporcional aos
-- dias restantes do mês.
-- ============================================================

ALTER TABLE public.contas_fixas
  ADD COLUMN IF NOT EXISTS rateio_proporcional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contas_fixas.rateio_proporcional IS 'Quando true, moradores que entram no meio do mês recebem uma cobrança proporcional aos dias restantes, em vez de ficarem de fora da cobrança daquele mês.';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração.
-- ============================================================
