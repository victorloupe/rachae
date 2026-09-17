// ============================================================
// Edge Function: gerar-cobranca-pix
// ------------------------------------------------------------
// Recebe { cobrancaId, valor, descricao } do front-end e devolve
// { qrcode_base64, copia_cola, txid } gerados pelo provedor de Pix (PSP).
//
// COMO ATIVAR O PIX DE VERDADE:
// 1. Crie uma conta em um PSP com Pix Cobrança + Webhook, por exemplo:
//    - Asaas: https://www.asaas.com
//    - Mercado Pago: https://www.mercadopago.com.br/developers
//    - Pagar.me: https://pagar.me
//    - Stark Bank: https://starkbank.com
// 2. Pegue a API key do provedor e salve como secret no Supabase:
//      supabase secrets set PSP_API_KEY=sua_chave_aqui
// 3. Troque o bloco "MODO SIMULAÇÃO" abaixo pela chamada real à API
//    do provedor escolhido (cada um tem seu endpoint de "criar cobrança Pix").
// 4. Implante a função:
//      supabase functions deploy gerar-cobranca-pix
//
// Enquanto isso não é feito, a função roda em MODO SIMULAÇÃO: gera um
// código Pix "copia e cola" falso, só para você testar o fluxo completo
// do app (tela, status, etc.) sem precisar de conta em nenhum PSP ainda.
// ============================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PSP_API_KEY = Deno.env.get("PSP_API_KEY"); // fica vazio até você configurar
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    const { cobrancaId, valor, descricao } = await req.json();

    if (!cobrancaId || !valor) {
      return new Response(JSON.stringify({ error: "cobrancaId e valor são obrigatórios" }), {
        status: 400,
      });
    }

    let resultado;

    if (!PSP_API_KEY) {
      // ---------- MODO SIMULAÇÃO (sem provedor configurado ainda) ----------
      const txidFalso = `SIMULADO-${cobrancaId.slice(0, 8)}`;
      resultado = {
        txid: txidFalso,
        copia_cola: `00020126580014BR.GOV.BCB.PIX0136SIMULACAO-${txidFalso}520400005303986540${valor.toFixed(
          2
        )}5802BR5913RachaFixo6009SAOPAULO62070503***6304ABCD`,
        qrcode_base64: null, // sem provedor real não geramos imagem de QR
      };
    } else {
      // ---------- MODO REAL ----------
      // Substitua este bloco pela chamada ao endpoint do seu PSP.
      // Exemplo (pseudocódigo, adapte para o provedor escolhido):
      //
      // const resp = await fetch("https://api.SEUPSP.com/v1/pix/cobrancas", {
      //   method: "POST",
      //   headers: {
      //     "Authorization": `Bearer ${PSP_API_KEY}`,
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify({
      //     valor,
      //     descricao,
      //     referencia_externa: cobrancaId,
      //     webhook_url: `${SUPABASE_URL}/functions/v1/webhook-pix`,
      //   }),
      // });
      // const dados = await resp.json();
      // resultado = {
      //   txid: dados.id,
      //   copia_cola: dados.pix_copia_e_cola,
      //   qrcode_base64: dados.pix_qrcode_base64,
      // };

      throw new Error("Integração com PSP real ainda não implementada — edite este arquivo.");
    }

    // Salva o txid já aqui também (o front-end salva de novo, não tem problema)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin
      .from("cobrancas_individuais")
      .update({
        pix_txid: resultado.txid,
        pix_copia_cola: resultado.copia_cola,
        pix_qrcode: resultado.qrcode_base64,
      })
      .eq("id", cobrancaId);

    return new Response(JSON.stringify(resultado), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
