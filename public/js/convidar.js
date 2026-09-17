// ============================================================
// Geração de convites e listagem de moradores da casa atual
// ============================================================

(() => {
let casaId = null;
let papelUsuario = "morador";
let usuarioIdAtual = null;
let dadosCasaAtual = null;
let mapaConfiabilidade = {};

async function inicializarConvidar() {
  const session = await exigirLogin();
  if (!session) return;

  usuarioIdAtual = session.user.id;
  casaId = localStorage.getItem("casa_atual");
  if (!casaId) {
    window.location.href = "casa.html";
    return;
  }

  papelUsuario = await obterPapelUsuarioNaCasa(casaId, session.user.id);
  configurarPermissoesInterface();
  configurarEventosConvidar();
  configurarFormCriarMorador();

  if (window.Animacoes && !window.InstantNav?.emNavegacao) {
    window.Animacoes.animarEntradaPagina(".card, .card-casa-topo");
  }

  await carregarDadosCasa();
  if (papelUsuario === "admin") {
    await carregarConviteAtivo();
  }
  await carregarMoradores();
}

window.inicializarConvidar = inicializarConvidar;

// Atualiza listagem se o perfil for editado
if (!window._perfilAtualizadoConvidarBound) {
  window._perfilAtualizadoConvidarBound = true;
  window.addEventListener("perfilAtualizado", () => {
    if (document.getElementById("lista-moradores")) {
      carregarMoradores();
    }
  });
}

function configurarPermissoesInterface() {
  const cardConvite = document.getElementById("card-gerar-convite");
  const cardCriarMorador = document.getElementById("card-criar-morador");
  const aviso = document.getElementById("aviso-permissao-convite");
  if (papelUsuario === "admin") {
    if (cardConvite) cardConvite.style.display = "block";
    if (cardCriarMorador) cardCriarMorador.style.display = "block";
    if (aviso) aviso.style.display = "none";
  } else {
    if (cardConvite) cardConvite.style.display = "none";
    if (cardCriarMorador) cardCriarMorador.style.display = "none";
    if (aviso) aviso.style.display = "flex";
  }
}

function formatarTelefoneMorador(val) {
  if (!val) return "";
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function configurarFormCriarMorador() {
  const form = document.getElementById("form-criar-morador");
  if (!form) return;

  const inputTelefone = document.getElementById("morador-novo-telefone");
  if (inputTelefone) {
    inputTelefone.oninput = () => {
      inputTelefone.value = formatarTelefoneMorador(inputTelefone.value);
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (papelUsuario !== "admin") {
      mostrarToast("Apenas o administrador pode criar moradores.", "alerta");
      return;
    }

    const nome = document.getElementById("morador-novo-nome").value.trim();
    const email = document.getElementById("morador-novo-email").value.trim().toLowerCase();
    const telefone = document.getElementById("morador-novo-telefone")?.value.trim() || null;
    const senha = document.getElementById("morador-novo-senha").value;
    const msg = document.getElementById("msg-criar-morador");
    const btn = document.getElementById("btn-criar-morador");

    if (!nome || !email || !senha) {
      mostrarToast("Preencha nome, e-mail e senha.", "alerta");
      return;
    }
    if (senha.length < 6) {
      mostrarToast("A senha precisa ter pelo menos 6 caracteres.", "alerta");
      return;
    }

    btn.disabled = true;
    msg.className = "";
    msg.textContent = "Criando acesso...";

    try {
      // A edge function sempre responde 200 com { error } nos casos
      // esperados (e-mail duplicado, sem permissão, etc.), então o erro
      // "de verdade" (rede, função fora do ar) vem por `error` e o erro
      // de negócio vem dentro de `data.error`.
      const { data, error } = await supabaseClient.functions.invoke("criar-usuario-morador", {
        body: { nome, email, telefone, senha, casaId },
      });

      if (error) throw new Error(error.message || "Não foi possível falar com o servidor.");
      if (data?.error) throw new Error(data.error);

      msg.className = "sucesso";
      msg.textContent = `${nome} foi adicionado(a) à casa!`;
      mostrarToast(`${nome} já pode entrar com o e-mail e senha cadastrados.`);
      form.reset();

      sessionStorage.removeItem(`cache_moradores_${casaId}`);
      await carregarMoradores();
    } catch (err) {
      msg.className = "erro";
      msg.textContent = "Erro ao criar morador: " + err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

async function carregarDadosCasa() {
  const elNome = document.getElementById("nome-casa-topo");
  const elNumero = document.getElementById("badge-numero-casa");

  // 1. Exibe imediatamente o nome já salvo para não ficar 'Carregando casa...'
  const nomeSalvo = localStorage.getItem("casa_nome");
  const numSalvo = localStorage.getItem("casa_numero");
  if (elNome && nomeSalvo) elNome.textContent = nomeSalvo;
  if (elNumero && numSalvo) {
    elNumero.textContent = `Nº ${numSalvo}`;
    elNumero.style.display = "inline-block";
  }

  // 2. Busca do Supabase de forma segura com select(*)
  try {
    const { data: casa, error } = await supabaseClient
      .from("casas")
      .select("*")
      .eq("id", casaId)
      .maybeSingle();

    if (casa) {
      dadosCasaAtual = casa;
      if (casa.nome) {
        localStorage.setItem("casa_nome", casa.nome);
        if (elNome) elNome.textContent = casa.nome;
      }
      if (elNumero) {
        if (casa.numero) {
          localStorage.setItem("casa_numero", casa.numero);
          elNumero.textContent = `Nº ${casa.numero}`;
          elNumero.style.display = "inline-block";
        } else {
          elNumero.style.display = "none";
        }
      }
    }
  } catch (err) {
    console.warn("Erro ao buscar dados da casa:", err);
  }
}

async function carregarConviteAtivo() {
  const box = document.getElementById("box-convite-atual");
  const txtBtn = document.getElementById("txt-btn-gerar-convite");
  if (!box) return;

  const cacheKey = `cache_convite_${casaId}`;

  // 1. CARREGAMENTO INSTANTÂNEO (0ms)
  const cachedConvite = sessionStorage.getItem(cacheKey);
  if (cachedConvite) {
    try {
      const convite = JSON.parse(cachedConvite);
      if (convite && (!convite.expira_em || new Date(convite.expira_em) > new Date())) {
        renderizarConvite(convite, box);
        if (txtBtn) txtBtn.textContent = "Gerar novo link/código";
      }
    } catch (e) {}
  }

  // 2. REVALIDAÇÃO SILENCIOSA EM SEGUNDO PLANO
  try {
    const { data: convite } = await supabaseClient
      .from("convites")
      .select("*")
      .eq("casa_id", casaId)
      .eq("usado", false)
      .gt("expira_em", new Date().toISOString())
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (convite) {
      sessionStorage.setItem(cacheKey, JSON.stringify(convite));
      renderizarConvite(convite, box);
      if (txtBtn) txtBtn.textContent = "Gerar novo link/código";
    }
  } catch (err) {
    console.warn("Erro ao carregar convite ativo:", err);
  }
}

function renderizarConvite(convite, container) {
  if (!container) return;

  const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf("/") + 1);
  const link = `${window.location.origin}${basePath}cadastro.html?convite=${convite.codigo}`;
  const nomeCasa = dadosCasaAtual ? dadosCasaAtual.nome : "nossa casa";
  const numCasa = dadosCasaAtual && dadosCasaAtual.numero ? ` (Nº ${dadosCasaAtual.numero})` : "";

  container.innerHTML = `
    <!-- Box do Código da Casa -->
    <div class="codigo-casa-box">
      <span class="label-codigo">Código de Entrada da Casa</span>
      <div class="codigo-destaque-wrapper">
        <span class="codigo-grande" id="texto-codigo-casa">${convite.codigo}</span>
        <button type="button" class="btn-copiar-codigo" onclick="copiarCodigo('${convite.codigo}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copiar código
        </button>
      </div>
      <p class="texto-suave" style="margin: 6px 0 0; font-size: 11px;">A pessoa pode digitar este código na tela de entrada.</p>
    </div>

    <!-- Box do Link Completo -->
    <div class="qr-box" style="margin-top: 10px;">
      <p class="texto-suave" style="margin: 0 0 8px;">Ou envie o <strong>link direto</strong> (já adiciona a pessoa automaticamente ao se cadastrar):</p>
      <div class="copia-cola" style="font-size: 12px;">${link}</div>
      <div class="acoes-linha" style="justify-content:center; margin-top:12px; gap:8px; flex-wrap:wrap;">
        <button class="pequeno" onclick="copiarLink('${link}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copiar link
        </button>
        <button class="pequeno btn-whatsapp" onclick="enviarConviteWhatsApp('${link}', '${convite.codigo}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          Enviar no WhatsApp
        </button>
      </div>
    </div>
  `;
}

function renderizarMoradoresNaTela(membros, animar = false) {
  const container = document.getElementById("lista-moradores");
  if (!container) return;

  if (!membros || membros.length === 0) {
    container.innerHTML = `
      <div class="estado-vazio">
        <div class="estado-vazio-icone neutro">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <h4>Nenhum morador encontrado</h4>
        <p>Convide moradores para essa casa ou cadastre o acesso deles diretamente.</p>
      </div>
    `;
    return;
  }

  const ehAdmin = papelUsuario === "admin";
  const mapaCoresMoradores = atribuirCoresMoradores(membros.map((m) => m.usuario_id));

  container.innerHTML = membros
    .map((m) => {
      const nome = m.profiles ? m.profiles.nome : "Morador";
      const telefone = m.profiles && m.profiles.telefone ? m.profiles.telefone : null;
      const telDigitos = telefone ? telefone.replace(/\D/g, "") : "";
      const waNum = telDigitos.length === 10 || telDigitos.length === 11 ? "55" + telDigitos : telDigitos;
      const waLink = waNum
        ? `https://wa.me/${waNum}?text=${encodeURIComponent(`Oi ${nome}! Acesse o Rachaê da nossa casa.`)}`
        : null;

      const podeRemover = ehAdmin && m.usuario_id !== usuarioIdAtual;

      return `
        <div class="linha">
          <div class="linha-com-avatar">
            ${gerarAvatarHtml(nome, m.usuario_id, 32, mapaCoresMoradores[m.usuario_id])}
            <div>
              <strong>${nome}${m.usuario_id === usuarioIdAtual ? " (você)" : ""}</strong><br/>
              <span class="texto-suave">
                ${m.papel === "admin" ? "Administrador" : "Morador"}
                ${telefone ? `· ${formatarTelefone(telefone)}` : ""}
              </span>
              ${
                mapaConfiabilidade[m.usuario_id] !== undefined
                  ? `<br/><span class="badge ${mapaConfiabilidade[m.usuario_id] >= 80 ? "pago" : "pendente"}" style="font-size: 10px; padding: 2px 6px; margin-top: 3px; display: inline-block;" title="Percentual de cobranças pagas em dia">${mapaConfiabilidade[m.usuario_id]}% em dia</span>`
                  : ""
              }
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" class="btn-icone" onclick="abrirExtratoMorador('${m.usuario_id}', '${encodeURIComponent(nome)}')" title="Ver extrato completo" aria-label="Extrato">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </button>
            ${
              waLink
                ? `
                <a href="${waLink}" target="_blank" class="btn-icone btn-icone-whatsapp" title="Conversar no WhatsApp" aria-label="WhatsApp">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                </a>
              `
                : ""
            }
            ${
              podeRemover
                ? `
                <button type="button" class="btn-icone btn-icone-remover" onclick="removerMorador('${m.id}', '${encodeURIComponent(nome)}', '${m.usuario_id}')" title="Remover morador da casa" aria-label="Remover">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              `
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  if (animar && window.Animacoes) {
    window.Animacoes.animarListaLinhas("#lista-moradores .linha");
  }
}

async function carregarMoradores() {
  const container = document.getElementById("lista-moradores");
  const statusTopo = document.getElementById("status-moradores-topo");
  if (!container) return;

  const cacheKey = `cache_moradores_${casaId}`;

  // 1. CARREGAMENTO INSTANTÂNEO (0ms) VIA CACHE LOCAL
  const cachedMoradores = sessionStorage.getItem(cacheKey);
  if (cachedMoradores) {
    try {
      const membros = JSON.parse(cachedMoradores);
      const total = membros ? membros.length : 0;
      if (statusTopo) {
        statusTopo.textContent = `${total} morador${total === 1 ? "" : "es"}`;
      }
      renderizarMoradoresNaTela(membros, false);
    } catch (e) {}
  }

  // 2. REVALIDAÇÃO SILENCIOSA EM SEGUNDO PLANO
  const { data: membros, error } = await supabaseClient
    .from("membros_casa")
    .select("id, usuario_id, papel, entrou_em, profiles ( nome, telefone )")
    .eq("casa_id", casaId);

  if (error) {
    if (!cachedMoradores) {
      container.innerHTML = `<p class="erro">Erro ao carregar moradores.</p>`;
    }
    return;
  }

  const total = membros ? membros.length : 0;
  if (statusTopo) {
    statusTopo.textContent = `${total} morador${total === 1 ? "" : "es"}`;
  }

  const novoMoradoresJson = JSON.stringify(membros || []);
  const dadosMudaram = !cachedMoradores || cachedMoradores !== novoMoradoresJson;

  sessionStorage.setItem(cacheKey, novoMoradoresJson);

  if (dadosMudaram) {
    renderizarMoradoresNaTela(membros || [], !cachedMoradores);
  }

  // Histórico de confiabilidade (não bloqueia a renderização da lista)
  carregarConfiabilidadeMoradores(membros || []);
}

// ============================================================
// Histórico de confiabilidade: % de cobranças pagas em dia
// (considerando cobranças já vencidas — pagas ou atrasadas).
// Cobranças ainda pendentes dentro do prazo não contam, pois
// ainda não venceram.
// ============================================================
async function carregarConfiabilidadeMoradores(membros) {
  if (!membros || membros.length === 0) return;

  try {
    const { data: contasCasa } = await supabaseClient
      .from("contas_fixas")
      .select("id")
      .eq("casa_id", casaId);

    const idsContas = (contasCasa || []).map((c) => c.id);
    if (idsContas.length === 0) return;

    const { data: ciclos } = await supabaseClient
      .from("ciclos_cobranca")
      .select("id, mes_referencia, conta_fixa_id, contas_fixas ( dia_vencimento )")
      .in("conta_fixa_id", idsContas);

    const idsCiclos = (ciclos || []).map((c) => c.id);
    if (idsCiclos.length === 0) return;

    const mapaCiclos = {};
    (ciclos || []).forEach((c) => { mapaCiclos[c.id] = c; });

    const { data: cobrancas } = await supabaseClient
      .from("cobrancas_individuais")
      .select("usuario_id, status, pago_em, ciclo_id")
      .in("ciclo_id", idsCiclos);

    const hoje = new Date();
    const acumulado = {}; // usuario_id -> { venceram: 0, emDia: 0 }

    for (const c of cobrancas || []) {
      const ciclo = mapaCiclos[c.ciclo_id];
      const diaVenc = ciclo && ciclo.contas_fixas ? parseInt(ciclo.contas_fixas.dia_vencimento, 10) : null;
      if (!ciclo || !diaVenc || !ciclo.mes_referencia) continue;

      const [ano, mes] = ciclo.mes_referencia.split("-").map((v) => parseInt(v, 10));
      const dataVenc = new Date(ano, mes - 1, diaVenc, 23, 59, 59);

      const jaVenceu = c.status === "pago" ? true : dataVenc < hoje;
      if (!jaVenceu) continue; // ainda dentro do prazo, não conta pra confiabilidade

      if (!acumulado[c.usuario_id]) {
        acumulado[c.usuario_id] = { venceram: 0, emDia: 0 };
      }
      acumulado[c.usuario_id].venceram++;

      if (c.status === "pago" && c.pago_em) {
        const dataPagamento = new Date(c.pago_em);
        if (dataPagamento <= dataVenc) {
          acumulado[c.usuario_id].emDia++;
        }
      }
    }

    mapaConfiabilidade = {};
    Object.keys(acumulado).forEach((uId) => {
      const { venceram, emDia } = acumulado[uId];
      if (venceram >= 2) {
        mapaConfiabilidade[uId] = Math.round((emDia / venceram) * 100);
      }
    });

    renderizarMoradoresNaTela(membros, false);
  } catch (e) {
    console.warn("Erro ao calcular confiabilidade dos moradores:", e);
  }
}

async function removerMorador(membroId, nomeCodificado, usuarioId) {
  const nome = decodeURIComponent(nomeCodificado);

  // Antes de remover, verifica se essa pessoa ainda tem cobranças em
  // aberto na casa (pendentes ou atrasadas) — o admin precisa saber
  // disso antes de tirar o acesso dela.
  let mensagemAviso = `Tem certeza que deseja remover ${nome} desta casa? Essa pessoa perderá o acesso às contas e cobranças.`;

  try {
    const { data: contasCasa } = await supabaseClient
      .from("contas_fixas")
      .select("id")
      .eq("casa_id", casaId);

    const idsContas = (contasCasa || []).map((c) => c.id);
    if (idsContas.length > 0 && usuarioId) {
      const { data: ciclos } = await supabaseClient
        .from("ciclos_cobranca")
        .select("id")
        .in("conta_fixa_id", idsContas);

      const idsCiclos = (ciclos || []).map((c) => c.id);
      if (idsCiclos.length > 0) {
        const { data: pendentes } = await supabaseClient
          .from("cobrancas_individuais")
          .select("valor")
          .in("ciclo_id", idsCiclos)
          .eq("usuario_id", usuarioId)
          .neq("status", "pago");

        const totalPendente = (pendentes || []).reduce((acc, c) => acc + Number(c.valor || 0), 0);

        if (totalPendente > 0) {
          mensagemAviso = `<strong>${nome} ainda tem ${formatarMoeda(totalPendente)} em cobranças pendentes/atrasadas nesta casa.</strong><br/><br/>Remover agora não apaga essa dívida do histórico, mas ela perde o acesso ao app pra acompanhar ou anexar comprovante. Tem certeza que quer remover mesmo assim?`;
        }
      }
    }
  } catch (e) {
    console.warn("Erro ao checar pendências antes de remover morador:", e);
  }

  const confirmou = await mostrarConfirmacao({
    titulo: "Remover Morador",
    mensagem: mensagemAviso,
    textoConfirmar: "Remover Morador",
    textoCancelar: "Cancelar",
    tipo: "perigo",
  });

  if (!confirmou) return;

  const { error } = await supabaseClient
    .from("membros_casa")
    .delete()
    .eq("id", membroId);

  if (error) {
    mostrarToast("Erro ao remover morador: " + error.message, "alerta");
    return;
  }

  // Invalida cache local
  const cacheKey = `cache_moradores_${casaId}`;
  sessionStorage.removeItem(cacheKey);
  sessionStorage.removeItem(`cache_contas_${casaId}`);
  try {
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith("cache_dash_")) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {}

  mostrarToast(`${nome} foi removido(a) da casa.`);
  await carregarMoradores();
}

function configurarEventosConvidar() {
  const btn = document.getElementById("btn-gerar-convite");
  if (btn) {
    btn.onclick = async () => {
      if (papelUsuario !== "admin") {
        mostrarToast("Apenas o administrador pode gerar convites.", "alerta");
        return;
      }

      btn.disabled = true;
      const resultado = document.getElementById("resultado-convite");

      const { data: convite, error } = await supabaseClient
        .from("convites")
        .insert([{ casa_id: casaId, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() }])
        .select()
        .single();

      btn.disabled = false;
      if (error) {
        resultado.innerHTML = `<p class="erro">Erro ao gerar convite: ${error.message}</p>`;
        return;
      }

      resultado.innerHTML = "";
      const box = document.getElementById("box-convite-atual");
      sessionStorage.setItem(`cache_convite_${casaId}`, JSON.stringify(convite));
      renderizarConvite(convite, box);

      const txtBtn = document.getElementById("txt-btn-gerar-convite");
      if (txtBtn) txtBtn.textContent = "Gerar outro código";

      mostrarToast("Novo código e link gerados com sucesso!");
    };
  }
}

function copiarCodigo(codigo) {
  navigator.clipboard.writeText(codigo);
  mostrarToast("Código da casa copiado!");

  if (window.Animacoes) {
    const btnAtivo = document.activeElement;
    if (btnAtivo && btnAtivo.tagName === "BUTTON") {
      window.Animacoes.animarPulseSucesso(btnAtivo);
    }
  }
}

function copiarLink(link) {
  navigator.clipboard.writeText(link);
  mostrarToast("Link de convite copiado!");

  if (window.Animacoes) {
    const btnAtivo = document.activeElement;
    if (btnAtivo && btnAtivo.tagName === "BUTTON") {
      window.Animacoes.animarPulseSucesso(btnAtivo);
    }
  }
}

async function enviarConviteWhatsApp(link, codigo) {
  const nomeCasa = dadosCasaAtual ? dadosCasaAtual.nome : "nossa casa";
  const numCasa = dadosCasaAtual && dadosCasaAtual.numero ? ` (Nº ${dadosCasaAtual.numero})` : "";
  const texto = `*Convite Rachaê*\n\nOlá! Você foi convidado(a) para entrar na casa *${nomeCasa}${numCasa}* no Rachaê.\n\nCódigo da casa: *${codigo}*\n\nOu clique no link direto para se cadastrar e entrar automaticamente:\n${link}`;
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
  window.open(url, "_blank");
}

// ------------------------------------------------------------
// Extrato completo por morador: mostra tudo que a pessoa já pagou e
// deve desde que entrou na casa — útil pra fechar conta quando
// alguém sai, ou só pra conferir o histórico completo de alguém.
// ------------------------------------------------------------
async function abrirExtratoMorador(usuarioId, nomeCodificado) {
  const nome = decodeURIComponent(nomeCodificado);
  const modal = document.getElementById("modal-extrato");
  const titulo = document.getElementById("titulo-modal-extrato");
  const lista = document.getElementById("lista-extrato-morador");
  const resumo = document.getElementById("resumo-extrato-morador");
  if (!modal || !lista) return;

  titulo.textContent = `Extrato de ${nome}`;
  lista.innerHTML = `<p class="texto-suave" style="text-align:center; padding: 16px 0;">Carregando...</p>`;
  resumo.innerHTML = "";
  modal.style.display = "flex";

  try {
    const { data: contasCasa } = await supabaseClient.from("contas_fixas").select("id, nome").eq("casa_id", casaId);
    const idsContas = (contasCasa || []).map((c) => c.id);
    const mapaNomeConta = {};
    (contasCasa || []).forEach((c) => (mapaNomeConta[c.id] = c.nome));

    if (idsContas.length === 0) {
      lista.innerHTML = `<p class="texto-suave" style="text-align:center; padding: 16px 0;">Nenhuma conta cadastrada nesta casa ainda.</p>`;
      return;
    }

    const { data: ciclos } = await supabaseClient
      .from("ciclos_cobranca")
      .select("id, conta_fixa_id, mes_referencia")
      .in("conta_fixa_id", idsContas)
      .order("mes_referencia", { ascending: false });

    const idsCiclos = (ciclos || []).map((c) => c.id);
    const mapaCiclo = {};
    (ciclos || []).forEach((c) => (mapaCiclo[c.id] = c));

    if (idsCiclos.length === 0) {
      lista.innerHTML = `<p class="texto-suave" style="text-align:center; padding: 16px 0;">Nenhuma cobrança gerada ainda.</p>`;
      return;
    }

    const { data: cobrancas, error } = await supabaseClient
      .from("cobrancas_individuais")
      .select("id, ciclo_id, valor, status")
      .in("ciclo_id", idsCiclos)
      .eq("usuario_id", usuarioId);

    if (error) throw error;

    if (!cobrancas || cobrancas.length === 0) {
      lista.innerHTML = `<p class="texto-suave" style="text-align:center; padding: 16px 0;">${nome} ainda não tem cobranças registradas.</p>`;
      return;
    }

    const linhas = cobrancas
      .map((cob) => {
        const ciclo = mapaCiclo[cob.ciclo_id];
        return { ...cob, mes_referencia: ciclo ? ciclo.mes_referencia : null, conta_nome: ciclo ? mapaNomeConta[ciclo.conta_fixa_id] : "?" };
      })
      .sort((a, b) => (b.mes_referencia || "").localeCompare(a.mes_referencia || ""));

    let totalPago = 0;
    let totalPendente = 0;
    linhas.forEach((l) => {
      if (l.status === "pago") totalPago += Number(l.valor);
      else totalPendente += Number(l.valor);
    });

    resumo.innerHTML = `
      <div class="linha" style="border: none; padding: 0 0 10px 0;">
        <div><span class="texto-suave" style="font-size: 12px;">Total pago</span><br/><strong style="color: var(--cor-sucesso, #16a34a);">${formatarMoeda(totalPago)}</strong></div>
        <div style="text-align: right;"><span class="texto-suave" style="font-size: 12px;">Em aberto</span><br/><strong style="color: ${totalPendente > 0 ? "var(--cor-perigo, #dc2626)" : "inherit"};">${formatarMoeda(totalPendente)}</strong></div>
      </div>
    `;

    lista.innerHTML = linhas
      .map((l) => {
        const [ano, mes] = (l.mes_referencia || "").split("-");
        const nomesMeses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const mesTexto = mes ? `${nomesMeses[parseInt(mes, 10) - 1]}/${ano}` : "-";
        const statusTexto = l.status === "pago" ? "Pago" : l.status === "atrasado" ? "Atrasada" : "Pendente";
        const statusClasse = l.status === "pago" ? "pago" : l.status === "atrasado" ? "atrasado" : "pendente";
        return `
          <div class="linha" style="padding: 8px 0;">
            <div>
              <strong style="font-size: 13.5px;">${l.conta_nome}</strong><br/>
              <span class="texto-suave" style="font-size: 12px;">${mesTexto}</span>
            </div>
            <div style="text-align: right;">
              <strong style="font-size: 13.5px;">${formatarMoeda(Number(l.valor))}</strong><br/>
              <span class="badge ${statusClasse}" style="font-size: 10px; padding: 1px 6px;">${statusTexto}</span>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    console.warn("Erro ao carregar extrato do morador:", e);
    lista.innerHTML = `<p class="erro" style="text-align:center; padding: 16px 0;">Não foi possível carregar o extrato agora.</p>`;
  }
}

function fecharModalExtrato() {
  const modal = document.getElementById("modal-extrato");
  if (modal) modal.style.display = "none";
}

// Exposição explícita para o escopo global (window)
window.inicializarConvidar = inicializarConvidar;
window.removerMorador = removerMorador;
window.copiarCodigo = copiarCodigo;
window.copiarLink = copiarLink;
window.enviarConviteWhatsApp = enviarConviteWhatsApp;
window.abrirExtratoMorador = abrirExtratoMorador;
window.fecharModalExtrato = fecharModalExtrato;

// Auto-inicializa se a página for carregada diretamente pelo navegador
if (!window.InstantNav || !window.InstantNav.emNavegacao) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.location.pathname.endsWith("convidar.html")) {
        inicializarConvidar();
      }
    });
  } else {
    if (window.location.pathname.endsWith("convidar.html")) {
      inicializarConvidar();
    }
  }
}
})();
