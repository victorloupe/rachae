-- ============================================================
-- MIGRAÇÃO FASE 3: DESPESAS EXTRAS / VARIÁVEIS / MERCADO
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute no Supabase > SQL Editor > New query
-- ============================================================

-- 1. TABELA DE DESPESAS AVULSAS / EXTRAS
CREATE TABLE IF NOT EXISTS public.despesas_avulsas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casa_id uuid NOT NULL REFERENCES public.casas(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  valor numeric(10,2) NOT NULL CHECK (valor > 0),
  categoria text NOT NULL DEFAULT 'alimentacao',
  pago_por_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  data date NOT NULL DEFAULT CURRENT_DATE,
  mes_referencia date NOT NULL,
  comprovante_url text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Índices de consulta rápida por casa e mês
CREATE INDEX IF NOT EXISTS idx_despesas_avulsas_casa_mes 
  ON public.despesas_avulsas (casa_id, mes_referencia);

-- 2. TABELA DE PARTICIPANTES DA DESPESA AVULSA
CREATE TABLE IF NOT EXISTS public.despesas_avulsas_participantes (
  despesa_id uuid NOT NULL REFERENCES public.despesas_avulsas(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  valor_cota numeric(10,2) NOT NULL CHECK (valor_cota >= 0),
  pago boolean NOT NULL DEFAULT false,
  pago_em timestamptz,
  PRIMARY KEY (despesa_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_despesas_avulsas_part_usuario 
  ON public.despesas_avulsas_participantes (usuario_id);

-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.despesas_avulsas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despesas_avulsas_participantes ENABLE ROW LEVEL SECURITY;

-- Policies para despesas_avulsas
DROP POLICY IF EXISTS "despesas_avulsas_select" ON public.despesas_avulsas;
CREATE POLICY "despesas_avulsas_select" ON public.despesas_avulsas
  FOR SELECT USING (public.is_member_casa(casa_id));

DROP POLICY IF EXISTS "despesas_avulsas_insert" ON public.despesas_avulsas;
CREATE POLICY "despesas_avulsas_insert" ON public.despesas_avulsas
  FOR INSERT WITH CHECK (public.is_member_casa(casa_id) AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "despesas_avulsas_update" ON public.despesas_avulsas;
CREATE POLICY "despesas_avulsas_update" ON public.despesas_avulsas
  FOR UPDATE USING (public.is_admin_casa(casa_id) OR pago_por_id = auth.uid());

DROP POLICY IF EXISTS "despesas_avulsas_delete" ON public.despesas_avulsas;
CREATE POLICY "despesas_avulsas_delete" ON public.despesas_avulsas
  FOR DELETE USING (public.is_admin_casa(casa_id) OR pago_por_id = auth.uid());

-- Policies para despesas_avulsas_participantes
DROP POLICY IF EXISTS "despesas_part_select" ON public.despesas_avulsas_participantes;
CREATE POLICY "despesas_part_select" ON public.despesas_avulsas_participantes
  FOR SELECT USING (
    public.is_member_casa((SELECT casa_id FROM public.despesas_avulsas WHERE id = despesa_id))
  );

DROP POLICY IF EXISTS "despesas_part_insert" ON public.despesas_avulsas_participantes;
CREATE POLICY "despesas_part_insert" ON public.despesas_avulsas_participantes
  FOR INSERT WITH CHECK (
    public.is_member_casa((SELECT casa_id FROM public.despesas_avulsas WHERE id = despesa_id))
  );

DROP POLICY IF EXISTS "despesas_part_update" ON public.despesas_avulsas_participantes;
CREATE POLICY "despesas_part_update" ON public.despesas_avulsas_participantes
  FOR UPDATE USING (
    public.is_admin_casa((SELECT casa_id FROM public.despesas_avulsas WHERE id = despesa_id))
    OR usuario_id = auth.uid()
    OR (SELECT pago_por_id FROM public.despesas_avulsas WHERE id = despesa_id) = auth.uid()
  );

DROP POLICY IF EXISTS "despesas_part_delete" ON public.despesas_avulsas_participantes;
CREATE POLICY "despesas_part_delete" ON public.despesas_avulsas_participantes
  FOR DELETE USING (
    public.is_admin_casa((SELECT casa_id FROM public.despesas_avulsas WHERE id = despesa_id))
    OR (SELECT pago_por_id FROM public.despesas_avulsas WHERE id = despesa_id) = auth.uid()
  );

-- 4. HABILITAR REALTIME NAS NOVAS TABELAS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'despesas_avulsas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.despesas_avulsas;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'despesas_avulsas_participantes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.despesas_avulsas_participantes;
  END IF;
END $$;

-- 5. RPC ATÔMICA: CRIAR DESPESA AVULSA COM PARTICIPANTES
CREATE OR REPLACE FUNCTION public.criar_despesa_avulsa(
  p_casa_id uuid,
  p_descricao text,
  p_valor numeric,
  p_categoria text,
  p_pago_por_id uuid,
  p_data date,
  p_mes_referencia date,
  p_participantes uuid[],
  p_comprovante_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_despesa_id uuid;
  v_num_parts int;
  v_total_centavos bigint;
  v_centavos_base bigint;
  v_sobra_centavos bigint;
  v_centavos_part bigint;
  v_idx int;
  v_usuario_id uuid;
  v_eh_pagador boolean;
BEGIN
  IF NOT public.is_member_casa(p_casa_id) THEN
    RAISE EXCEPTION 'Acesso não autorizado para esta casa.';
  END IF;

  IF p_valor <= 0 THEN
    RAISE EXCEPTION 'O valor da despesa deve ser maior que zero.';
  END IF;

  v_num_parts := COALESCE(array_length(p_participantes, 1), 0);
  IF v_num_parts = 0 THEN
    RAISE EXCEPTION 'Pelo menos um participante deve ser selecionado para a divisão.';
  END IF;

  -- Insere a despesa principal
  INSERT INTO public.despesas_avulsas (
    casa_id, descricao, valor, categoria, pago_por_id, data, mes_referencia, comprovante_url
  ) VALUES (
    p_casa_id, TRIM(p_descricao), p_valor, COALESCE(p_categoria, 'outros'),
    p_pago_por_id, COALESCE(p_data, CURRENT_DATE), p_mes_referencia, p_comprovante_url
  ) RETURNING id INTO v_despesa_id;

  -- Rateio exato em centavos entre os participantes
  v_total_centavos := ROUND(p_valor * 100)::bigint;
  v_centavos_base := v_total_centavos / v_num_parts;
  v_sobra_centavos := v_total_centavos - (v_centavos_base * v_num_parts);

  FOR v_idx IN 1..v_num_parts LOOP
    v_usuario_id := p_participantes[v_idx];
    v_centavos_part := v_centavos_base + (CASE WHEN v_idx <= v_sobra_centavos THEN 1 ELSE 0 END);
    v_eh_pagador := (v_usuario_id = p_pago_por_id);

    INSERT INTO public.despesas_avulsas_participantes (
      despesa_id, usuario_id, valor_cota, pago, pago_em
    ) VALUES (
      v_despesa_id,
      v_usuario_id,
      (v_centavos_part::numeric / 100),
      v_eh_pagador,
      CASE WHEN v_eh_pagador THEN now() ELSE NULL END
    );
  END LOOP;

  RETURN v_despesa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_despesa_avulsa(uuid, text, numeric, text, uuid, date, date, uuid[], text) TO authenticated;

-- 6. RPC: ALTERNAR STATUS DE PAGAMENTO DE COTA AVULSA
CREATE OR REPLACE FUNCTION public.alternar_status_cota_avulsa(
  p_despesa_id uuid,
  p_usuario_id uuid,
  p_pago boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_casa_id uuid;
  v_pago_por_id uuid;
BEGIN
  SELECT da.casa_id, da.pago_por_id INTO v_casa_id, v_pago_por_id
  FROM public.despesas_avulsas da
  WHERE da.id = p_despesa_id;

  IF v_casa_id IS NULL THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;

  -- Apenas quem pagou a despesa ou o administrador pode marcar/desmarcar o reembolso
  IF NOT (public.is_admin_casa(v_casa_id) OR v_pago_por_id = auth.uid()) THEN
    RAISE EXCEPTION 'Apenas quem pagou a compra ou o administrador pode confirmar o acerto desta cota.';
  END IF;

  UPDATE public.despesas_avulsas_participantes
  SET pago = p_pago,
      pago_em = CASE WHEN p_pago THEN now() ELSE NULL END
  WHERE despesa_id = p_despesa_id AND usuario_id = p_usuario_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.alternar_status_cota_avulsa(uuid, uuid, boolean) TO authenticated;

-- Notifica o PostgREST para recarregar o schema imediatamente
NOTIFY pgrst, 'reload schema';
