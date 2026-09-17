// ============================================================
// Edge Function: criar-usuario-morador
// ------------------------------------------------------------
// Permite que o ADMIN de uma casa crie o acesso de um morador na hora
// (nome, e-mail e senha), sem passar pelo fluxo de convite. Precisa
// rodar como Edge Function porque criar um usuário no Supabase Auth
// exige a service_role key, que nunca pode ficar no front-end.
//
// Implante com:
//   supabase functions deploy criar-usuario-morador
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autenticado." }, 200);
    }

    const { nome, email, telefone, senha, casaId } = await req.json();

    if (!nome || !email || !senha || !casaId) {
      return jsonResponse({ error: "Nome, e-mail, senha e casa são obrigatórios." }, 200);
    }

    if (String(senha).length < 6) {
      return jsonResponse({ error: "A senha precisa ter pelo menos 6 caracteres." }, 200);
    }

    // Cliente "de contexto": usa o JWT de quem chamou só para descobrir
    // quem é (não tem privilégio nenhum além disso).
    const supabaseCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 200);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Confirma manualmente que quem chamou é admin desta casa — o service
    // role ignora RLS, então essa checagem é a única coisa impedindo
    // qualquer usuário autenticado de criar gente em casas dos outros.
    const { data: membro, error: membroError } = await supabaseAdmin
      .from("membros_casa")
      .select("papel")
      .eq("casa_id", casaId)
      .eq("usuario_id", userData.user.id)
      .maybeSingle();

    if (membroError || !membro || membro.papel !== "admin") {
      return jsonResponse({ error: "Apenas o administrador da casa pode criar moradores." }, 200);
    }

    // Cria o usuário já com e-mail confirmado: é o admin cadastrando por
    // ele, não faz sentido exigir confirmação de e-mail nesse fluxo.
    const { data: novoUsuario, error: criarError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome, telefone: telefone || null },
    });

    if (criarError || !novoUsuario?.user) {
      const mensagem = (criarError?.message || "").toLowerCase().includes("already")
        ? "Já existe um usuário cadastrado com esse e-mail."
        : criarError?.message || "Não foi possível criar o usuário.";
      return jsonResponse({ error: mensagem }, 200);
    }

    // O gatilho on_auth_user_created (schema.sql) já cria o profile
    // automaticamente a partir do user_metadata acima.
    const { error: membroInsertError } = await supabaseAdmin.from("membros_casa").insert({
      casa_id: casaId,
      usuario_id: novoUsuario.user.id,
      papel: "morador",
    });

    if (membroInsertError) {
      return jsonResponse(
        { error: "Usuário criado, mas houve erro ao adicioná-lo à casa: " + membroInsertError.message },
        200
      );
    }

    return jsonResponse({ ok: true, usuario_id: novoUsuario.user.id });
  } catch (err) {
    return jsonResponse({ error: err.message || "Erro inesperado ao criar o morador." }, 200);
  }
});
