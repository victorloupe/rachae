-- ============================================================
-- Migração: Anexar comprovante de pagamento
-- Rachaê — Sistema de Gestão e Divisão de Despesas
-- ------------------------------------------------------------
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
--
-- O QUE ISSO FAZ:
-- 1. Cria um bucket de Storage privado "comprovantes" para guardar
--    prints/fotos de comprovante de pagamento (Pix, transferência etc).
-- 2. Adiciona a coluna comprovante_url em cobrancas_individuais, que
--    guarda o CAMINHO do arquivo dentro do bucket (não uma URL
--    pública — o bucket é privado, o app gera um link temporário
--    (signed URL) na hora de exibir o comprovante).
-- 3. Cria as policies de Storage: só membros da própria casa podem
--    enviar/ver os comprovantes daquela casa. O caminho de cada
--    arquivo é sempre "<casa_id>/<algo>", então a policy confere se
--    o usuário é membro da casa cujo id é a primeira pasta do caminho.
-- ============================================================

ALTER TABLE public.cobrancas_individuais
  ADD COLUMN IF NOT EXISTS comprovante_url text;

COMMENT ON COLUMN public.cobrancas_individuais.comprovante_url IS 'Caminho do arquivo de comprovante dentro do bucket privado "comprovantes" (não é uma URL pública).';

-- Cria o bucket, se ainda não existir (privado: público = false)
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

-- Permite que um membro autenticado da casa X envie/veja arquivos
-- dentro da pasta "X/" do bucket "comprovantes".
drop policy if exists "comprovantes_insert_membro_casa" on storage.objects;
create policy "comprovantes_insert_membro_casa" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "comprovantes_select_membro_casa" on storage.objects;
create policy "comprovantes_select_membro_casa" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "comprovantes_update_membro_casa" on storage.objects;
create policy "comprovantes_update_membro_casa" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'comprovantes'
    and public.is_member_casa((storage.foldername(name))[1]::uuid)
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Fim da migração.
-- ============================================================
