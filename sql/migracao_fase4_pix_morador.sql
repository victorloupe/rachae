-- ============================================================
-- MIGRAÇÃO FASE 4: CHAVE PIX INDIVIDUAL POR MORADOR
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- Permite que cada morador cadastre sua chave Pix pessoal no
-- perfil para receber reembolsos de despesas compartilhadas/mercado.
-- ============================================================

-- 1. ADICIONAR COLUNAS DE CHAVE PIX NA TABELA PROFILES
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS chave_pix text,
  ADD COLUMN IF NOT EXISTS tipo_chave_pix text DEFAULT 'telefone',
  ADD COLUMN IF NOT EXISTS nome_titular_pix text,
  ADD COLUMN IF NOT EXISTS banco_pix text;

-- Comentários documentando os novos campos
COMMENT ON COLUMN public.profiles.chave_pix IS 'Chave Pix pessoal do morador para recebimento de reembolsos.';
COMMENT ON COLUMN public.profiles.tipo_chave_pix IS 'Tipo da chave Pix: telefone, cpf, cnpj, email ou aleatoria.';
COMMENT ON COLUMN public.profiles.nome_titular_pix IS 'Nome completo do titular da conta bancária da chave Pix.';
COMMENT ON COLUMN public.profiles.banco_pix IS 'Nome do banco/instituição financeira (ex: Nubank, Inter, Itaú).';

-- 2. VERIFICAÇÃO DE RLS PARA PROFILES
-- As policies existentes em profiles já asseguram que:
-- a) 'profiles_update_proprio': apenas o próprio usuário pode atualizar suas colunas (id = auth.uid());
-- b) 'profiles_select_compartilha_casa': apenas usuários que dividem a mesma casa podem consultar o perfil do morador.
-- Garantimos que RLS está devidamente habilitada:
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. NOTIFICAR O SUPABASE POSTGREST PARA RECARREGAR O CACHE
NOTIFY pgrst, 'reload schema';
