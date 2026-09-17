// ============================================================
// Edge Function: webhook-pix
// ------------------------------------------------------------
// URL pública que você cadastra no painel do seu PSP para receber a
// confirmação automática de pagamento. Quando o Pix cai, o PSP chama
// esta função, que marca a cobrança como "pago" no banco — é isso que
// elimina a necessidade de print de comprovante.
//
// URL desta função depois de implantada (troque SEU_PROJETO):
//   https://SEU_PROJETO.supabase.co/functions/v1/webhook-pix
//
// IMPORTANTE: cada PSP tem um formato de payload e uma forma diferente
// de validar a autenticidade do webhook (assinatura HMAC, token no
// header, etc.). Ajuste a função `validarAssinatura` e o parsing do
// payload de acordo com a documentação do provedor escolhido.
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PSP_WEBHOOK_SECRET = Deno.env.get("PSP_WEBHOOK_SECRET"); // configure no seu PSP

serve(async (req) => {
  try {
    // TODO: validar autenticidade do webhook conforme o PSP escolhido
    // (ex.: comparar header "X-Assinatura" com um HMAC do corpo usando
    // PSP_WEBHOOK_SECRET). Sem isso, qualquer um poderia chamar esta URL
    // e marcar cobranças como pagas indevidamente.

    const payload = await req.json();

    // Ajuste os nomes de campo conforme o formato real do seu PSP.
    // Abaixo, um formato genérico de exemplo:
    const txid = payload.txid || payload.id || payload.referencia_externa;
    const statusPago = payload.status === "paid" || payload.status === "CONCLUIDA";

    if (!txid || !statusPago) {
      return new Response(JSON.stringify({ ok: true, ignorado: true }), { status: 200 });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error } = await supabaseAdmin
      .from("cobrancas_individuais")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("pix_txid", txid);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
