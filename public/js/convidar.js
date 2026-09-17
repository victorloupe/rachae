// ============================================================
// Geração de convites e listagem de moradores da casa atual
// ============================================================

(() => {
let casaId = null;
let papelUsuario = "morador";
let usuarioIdAtual = null;
let dadosCasaAtual = null;

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

  if (window.Animacoes) {
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
  const aviso = document.getElementById("aviso-permissao-convite");
  if (papelUsuario === "admin") {
    if (cardConvite) cardConvite.style.display = "block";
    if (aviso) aviso.style.display = "none";
  } else {
    if (cardConvite) cardConvite.style.display = "none";
    if (aviso) aviso.style.display = "flex";
  }
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

function renderizarMoradoresNaTela(membros) {
  const container = document.getElementById("lista-moradores");
  if (!container) return;

  if (!membros || membros.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhum morador encontrado.</p>`;
    return;
  }

  const ehAdmin = papelUsuario === "admin";

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
          <div>
            <strong>${nome}${m.usuario_id === usuarioIdAtual ? " (você)" : ""}</strong><br/>
            <span class="texto-suave">
              ${m.papel === "admin" ? "Administrador" : "Morador"}
              ${telefone ? `· ${formatarTelefone(telefone)}` : ""}
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
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
                <button type="button" class="btn-icone btn-icone-remover" onclick="removerMorador('${m.id}', '${encodeURIComponent(nome)}')" title="Remover morador da casa" aria-label="Remover">
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

  if (window.Animacoes) {
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
      renderizarMoradoresNaTela(membros);
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

  sessionStorage.setItem(cacheKey, JSON.stringify(membros || []));
  renderizarMoradoresNaTela(membros || []);
}

async function removerMorador(membroId, nomeCodificado) {
  const nome = decodeURIComponent(nomeCodificado);

  const confirmou = await mostrarConfirmacao({
    titulo: "Remover Morador",
    mensagem: `Tem certeza que deseja remover ${nome} desta casa? Essa pessoa perderá o acesso às contas e cobranças.`,
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
        .from("convites_casa")
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

// Exposição explícita para o escopo global (window)
window.inicializarConvidar = inicializarConvidar;
window.removerMorador = removerMorador;
window.copiarCodigo = copiarCodigo;
window.copiarLink = copiarLink;
window.enviarConviteWhatsApp = enviarConviteWhatsApp;

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
