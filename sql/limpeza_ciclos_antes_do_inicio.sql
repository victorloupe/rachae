-- ============================================================
-- Limpeza (opcional, rode uma vez): remove ciclos/cobranças que
-- ficaram registrados para meses ANTERIORES ao "mês de início" da
-- conta — por exemplo, se em algum teste anterior uma cobrança do
-- Aluguel chegou a ser gerada para Agosto mesmo com mes_inicio
-- configurado como Setembro.
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- SEGURANÇA: só apaga cobranças que ainda NÃO foram pagas (isso não
-- deveria existir de qualquer forma, já que a pessoa não devia nada
-- antes do início da conta) — nunca mexe em cobranças já pagas.
-- ============================================================

delete from public.cobrancas_individuais ci
using public.ciclos_cobranca cc, public.contas_fixas cf
where ci.ciclo_id = cc.id
  and cc.conta_fixa_id = cf.id
  and cf.mes_inicio is not null
  and to_char(cc.mes_referencia, 'YYYY-MM') < cf.mes_inicio
  and ci.status <> 'pago';

-- Remove os ciclos que ficaram sem nenhuma cobrança depois da limpeza acima
delete from public.ciclos_cobranca cc
using public.contas_fixas cf
where cc.conta_fixa_id = cf.id
  and cf.mes_inicio is not null
  and to_char(cc.mes_referencia, 'YYYY-MM') < cf.mes_inicio
  and not exists (
    select 1 from public.cobrancas_individuais ci where ci.ciclo_id = cc.id
  );

-- ============================================================
-- Fim da limpeza.
-- ============================================================
