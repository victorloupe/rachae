// ============================================================
// Cliente Supabase compartilhado por todas as páginas
// Se as chaves reais estiverem configuradas em config.js, conecta
// ao Supabase oficial; caso contrário, ativa o modo de demonstração local.
// ============================================================

const ehModoMock =
  typeof SUPABASE_URL === "undefined" ||
  !SUPABASE_URL ||
  SUPABASE_URL.includes("COLE_AQUI") ||
  typeof SUPABASE_ANON_KEY === "undefined" ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY.includes("COLE_AQUI");

let supabaseClient;

if (ehModoMock) {
  supabaseClient = window.RachaFixoMock ? window.RachaFixoMock.client : null;

  // Injeta banner discreto de modo de demonstração com ícone minimalista
  window.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("banner-mock-demo")) {
      const banner = document.createElement("div");
      banner.id = "banner-mock-demo";
      banner.innerHTML = `
        <div class="banner-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span><strong>Modo Demonstração</strong> (armazenamento local)</span>
        </div>
        <button type="button" onclick="window.RachaFixoMock.resetDB()">Restaurar Dados</button>
      `;
      document.body.prepend(banner);
    }
  });
} else {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Expõe globalmente
window.supabaseClient = supabaseClient;
window.ehModoMock = ehModoMock;

// Redireciona para o login se não houver sessão ativa.
async function exigirLogin() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    const params = new URLSearchParams(window.location.search);
    const convite = params.get("convite");
    if (convite) {
      window.location.href = `cadastro.html?convite=${encodeURIComponent(convite)}`;
    } else {
      window.location.href = "index.html";
    }
    return null;
  }

  // Inicializa o perfil do usuário logado no topo
  inicializarPerfilUsuario(session.user);

  return session;
}

// Feedback tátil háptico nativo para ações no mobile (Nubank/Inter feel)
function vibrar(padrao = 15) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(padrao);
    } catch (e) {}
  }
}
window.vibrar = vibrar;

async function logout() {
  await supabaseClient.auth.signOut();
  localStorage.removeItem("casa_atual");
  localStorage.removeItem("casa_nome");
  localStorage.removeItem("casa_numero");
  localStorage.removeItem("casa_papel");
  sessionStorage.clear();
  window.location.href = "index.html";
}

// ============================================================
// Gerenciamento do Perfil do Usuário e Modal de Edição
// ============================================================
let perfilUsuarioAtual = null;

// Escapa texto vindo do usuário (nome, nome de conta, etc.) antes de inserir
// em innerHTML — evita que alguém cadastre um nome tipo "<img src=x
// onerror=...>" e execute script na tela de outro morador (XSS armazenado).
function escapeHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function calcularIniciais(nome) {
  if (!nome) return "U";
  const partes = nome.trim().replace(/\s*\([^)]*\)/g, "").split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "U";
  if (partes.length === 1) {
    return partes[0].substring(0, 2).toUpperCase();
  }
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function obterPrimeiroNome(nome) {
  if (!nome) return "Usuário";
  const limpo = nome.trim().replace(/\s*\([^)]*\)/g, "");
  return limpo.split(/\s+/)[0] || "Usuário";
}

// ============================================================
// Avatares coloridos por morador (mesma cor sempre para a mesma pessoa,
// calculada a partir do id dela — sem precisar guardar nada no banco)
// ============================================================
const PALETA_AVATAR = [
  "#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
];

// ============================================================
// Categorias das contas fixas (pra classificar Aluguel, Água, etc.)
// ============================================================
const CATEGORIAS_CONTA = {
  moradia: { label: "Moradia", cor: "#2563eb", fundo: "#dbeafe" },
  contas: { label: "Água/Luz/Internet", cor: "#0891b2", fundo: "#cffafe" },
  alimentacao: { label: "Alimentação", cor: "#059669", fundo: "#d1fae5" },
  lazer: { label: "Lazer", cor: "#7c3aed", fundo: "#ede9fe" },
  outros: { label: "Outros", cor: "#64748b", fundo: "#f1f5f9" },
};

function obterCategoriaInfo(chave) {
  return CATEGORIAS_CONTA[chave] || CATEGORIAS_CONTA.outros;
}

function gerarBadgeCategoria(chave) {
  const info = obterCategoriaInfo(chave);
  return `<span class="badge" style="font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px; background: ${info.fundo}; color: ${info.cor}; border-color: ${info.fundo};">${info.label}</span>`;
}

function gerarIndiceAvatar(chave) {
  const str = String(chave || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % PALETA_AVATAR.length;
}

function gerarCorAvatar(chave) {
  return PALETA_AVATAR[gerarIndiceAvatar(chave)];
}

// Garante que ninguém da MESMA casa fique com a cor igual à de outra
// pessoa: parte do hash de cada um (pra manter a cor "estável" entre
// as telas), mas se der empate com alguém já processado, desloca pro
// próximo tom livre da paleta.
function atribuirCoresMoradores(ids) {
  const idsUnicos = Array.from(new Set((ids || []).filter(Boolean))).sort();
  const usados = new Set();
  const mapa = {};

  for (const id of idsUnicos) {
    let idx = gerarIndiceAvatar(id);
    let tentativas = 0;
    while (usados.has(idx) && tentativas < PALETA_AVATAR.length) {
      idx = (idx + 1) % PALETA_AVATAR.length;
      tentativas++;
    }
    usados.add(idx);
    mapa[id] = PALETA_AVATAR[idx];
  }

  return mapa;
}

function gerarAvatarHtml(nome, id, tamanho = 32, corForcada = null) {
  // As iniciais são derivadas do próprio nome (ex: primeira letra), então um
  // nome tipo "<img src=x onerror=...>" viraria iniciais como "<i" — por
  // isso escapa aqui também, não só o nome completo em outros lugares.
  const iniciais = escapeHtml(calcularIniciais(nome));
  const cor = corForcada || gerarCorAvatar(id || nome || "");
  const fonte = Math.max(10, Math.round(tamanho * 0.36));
  return `<span class="avatar-morador" style="width:${tamanho}px; height:${tamanho}px; min-width:${tamanho}px; background:${cor}; font-size:${fonte}px;">${iniciais}</span>`;
}

// ============================================================
// Contas parceladas (ex.: uma TV comprada em 10x): mes_inicio é o
// mês da parcela 1, e a conta some sozinha da cobrança depois da
// última parcela — sem precisar o admin desativar na mão.
// ============================================================
function calcularParcelaAtual(conta, mesReferenciaYYYYMM) {
  if (!conta || !conta.parcelado || !conta.parcelas_total || !conta.mes_inicio) return null;

  const [anoIni, mesIni] = conta.mes_inicio.slice(0, 7).split("-").map((v) => parseInt(v, 10));
  const [anoRef, mesRef] = String(mesReferenciaYYYYMM).slice(0, 7).split("-").map((v) => parseInt(v, 10));
  if (!anoIni || !mesIni || !anoRef || !mesRef) return null;

  const diffMeses = (anoRef - anoIni) * 12 + (mesRef - mesIni);
  const parcelaAtual = diffMeses + 1;

  if (parcelaAtual < 1 || parcelaAtual > conta.parcelas_total) return null;
  return parcelaAtual;
}

async function inicializarPerfilUsuario(user) {
  if (!user) return;

  let nome = "";
  let telefone = "";
  let chavePix = "";
  let tipoChavePix = "telefone";
  let nomeTitularPix = "";
  let bancoPix = "";

  try {
    const { data: perfil } = await supabaseClient
      .from("profiles")
      .select("nome, telefone, chave_pix, tipo_chave_pix, nome_titular_pix, banco_pix")
      .eq("id", user.id)
      .maybeSingle();

    if (perfil) {
      if (perfil.nome) nome = perfil.nome;
      if (perfil.telefone) telefone = perfil.telefone || "";
      chavePix = perfil.chave_pix || "";
      tipoChavePix = perfil.tipo_chave_pix || "telefone";
      nomeTitularPix = perfil.nome_titular_pix || "";
      bancoPix = perfil.banco_pix || "";
    }
  } catch (e) {
    console.warn("Erro ao buscar perfil do usuário:", e);
  }

  if (!nome) {
    nome = (user.user_metadata && user.user_metadata.nome) || (user.email ? user.email.split("@")[0] : "Usuário");
    telefone = (user.user_metadata && user.user_metadata.telefone) || "";
  }

  perfilUsuarioAtual = {
    id: user.id,
    email: user.email || "",
    nome: nome,
    telefone: telefone,
    chave_pix: chavePix,
    tipo_chave_pix: tipoChavePix,
    nome_titular_pix: nomeTitularPix,
    banco_pix: bancoPix,
  };
  window.perfilUsuarioAtual = perfilUsuarioAtual;

  atualizarHeaderUsuarioUI(perfilUsuarioAtual);
}

function atualizarHeaderUsuarioUI(perfil) {
  if (!perfil) return;

  const headerTopo = document.querySelector("header.topo");
  if (!headerTopo) return;

  let containerAcoes = document.getElementById("topo-acoes-usuario");
  if (!containerAcoes) {
    const btnSairAntigo = headerTopo.querySelector("button.secundario.pequeno[onclick*='logout']");
    containerAcoes = document.createElement("div");
    containerAcoes.id = "topo-acoes-usuario";
    containerAcoes.className = "topo-acoes-usuario";

    if (btnSairAntigo) {
      btnSairAntigo.parentNode.replaceChild(containerAcoes, btnSairAntigo);
    } else {
      headerTopo.appendChild(containerAcoes);
    }
  }

  const iniciais = calcularIniciais(perfil.nome);
  const primeiroNome = obterPrimeiroNome(perfil.nome);

  containerAcoes.innerHTML = `
    <button type="button" class="btn-toggle-tema" id="btn-toggle-tema" onclick="alternarTema()" title="Alternar tema claro/escuro" aria-label="Alternar tema">
      <svg class="icone-lua" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
      <svg class="icone-sol" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
    </button>
    <button type="button" class="btn-usuario-topo" id="btn-usuario-topo" onclick="abrirModalPerfil()" title="${escapeHtml(perfil.nome)} (clique para editar perfil ou sair)">
      <span class="avatar-topo" id="avatar-topo">${escapeHtml(iniciais)}</span>
      <span class="nome-topo" id="nome-topo">${escapeHtml(primeiroNome)}</span>
      <svg class="chevron-topo" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
  `;
}

function garantirModalPerfil() {
  let modal = document.getElementById("modal-perfil-usuario");
  if (modal) {
    modal.remove();
  }

  modal = document.createElement("div");
  modal.id = "modal-perfil-usuario";
  modal.className = "modal-overlay-sistema";
  modal.style.display = "none";

  modal.innerHTML = `
    <div class="modal-card-sistema modal-card-perfil" role="dialog" aria-modal="true" aria-labelledby="modal-perfil-titulo">
      <!-- HEADER FIXO -->
      <div class="modal-perfil-header-fixo">
        <div class="modal-perfil-header-topo">
          <div class="modal-perfil-header-titulos">
            <span class="modal-perfil-badge-topo">Configurações da Conta</span>
            <h3 id="modal-perfil-titulo">Meu Perfil</h3>
          </div>
          <button type="button" class="btn-fechar-modal-x" onclick="fecharModalPerfil()" aria-label="Fechar modal" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="perfil-avatar-secao">
          <div class="perfil-avatar-circulo" id="modal-perfil-avatar-preview">U</div>
          <div class="perfil-avatar-info">
            <span class="perfil-avatar-nome" id="modal-perfil-preview-nome">Usuário</span>
            <span class="perfil-avatar-email" id="modal-perfil-preview-email">email@exemplo.com</span>
          </div>
          <div class="perfil-avatar-badge-status">
            <span class="perfil-status-dot"></span>
            <span>Ativo</span>
          </div>
        </div>

        <!-- ABAS SEGMENTADAS: OS 3 NA MESMA LINHA -->
        <div class="perfil-tabs-nav" role="tablist">
          <button type="button" class="perfil-tab-btn ativo" id="tab-btn-dados" onclick="alternarAbaPerfil('dados')" role="tab" aria-selected="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>Dados</span>
          </button>
          <button type="button" class="perfil-tab-btn" id="tab-btn-pix" onclick="alternarAbaPerfil('pix')" role="tab" aria-selected="false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
              <rect x="3" y="5" width="18" height="14" rx="2"></rect>
              <circle cx="12" cy="12" r="2.5"></circle>
              <path d="M7 15h.01M17 9h.01"></path>
            </svg>
            <span>Chave Pix</span>
          </button>
          <button type="button" class="perfil-tab-btn" id="tab-btn-ajustes" onclick="alternarAbaPerfil('ajustes')" role="tab" aria-selected="false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Ajustes</span>
          </button>
        </div>
      </div>

      <!-- FORM COM CORPO SCROLLÁVEL E FOOTER FIXO -->
      <form id="form-editar-perfil" onsubmit="salvarPerfilUsuario(event)" class="modal-perfil-form">
        <!-- CORPO INTERNO COM ROLAGEM SLIM -->
        <div class="modal-perfil-corpo-scroll">
          
          <!-- ABA 1: DADOS -->
          <div id="aba-painel-dados" class="perfil-tab-painel ativo">
            <div class="campo-grupo">
              <label for="input-perfil-nome" class="campo-label">
                <span>Nome Completo <span class="campo-obrigatorio">*</span></span>
              </label>
              <div class="input-com-icone">
                <span class="campo-icone-prefix">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </span>
                <input type="text" id="input-perfil-nome" required placeholder="Como você quer ser chamado" autocomplete="name" />
              </div>
            </div>

            <div class="campo-grupo">
              <label for="input-perfil-telefone" class="campo-label">
                <span>WhatsApp / Telefone</span>
              </label>
              <div class="input-com-icone">
                <span class="campo-icone-prefix">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                </span>
                <input type="tel" id="input-perfil-telefone" placeholder="(00) 00000-0000" autocomplete="tel" />
              </div>
              <span class="campo-dica">Utilizado para identificação e avisos de comprovantes.</span>
            </div>

            <div class="campo-grupo">
              <div class="campo-label-linha">
                <label for="input-perfil-email" class="campo-label">E-mail de Acesso</label>
                <span class="badge-imutavel">Não editável</span>
              </div>
              <div class="input-com-icone input-bloqueado">
                <span class="campo-icone-prefix">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                </span>
                <input type="email" id="input-perfil-email" readonly disabled />
              </div>
            </div>

            <!-- ACORDEÃO ALTERAR SENHA -->
            <div class="secao-alterar-senha">
              <button type="button" class="btn-toggle-senha-accordion" onclick="alternarSecaoSenha()">
                <div class="btn-toggle-senha-esq">
                  <span class="btn-toggle-senha-icone">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </span>
                  <span>Alterar senha de acesso</span>
                </div>
                <svg id="icone-seta-senha" class="icone-chevron-senha" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <div id="container-campos-senha" class="container-campos-senha-expandido" style="display: none;">
                <div class="campo-grupo" style="margin-bottom: 10px;">
                  <label for="input-perfil-nova-senha" class="campo-label">Nova Senha</label>
                  <div class="input-com-icone input-com-olho">
                    <span class="campo-icone-prefix">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                    </span>
                    <input type="password" id="input-perfil-nova-senha" placeholder="Mínimo 6 caracteres" autocomplete="new-password" />
                    <button type="button" class="btn-olho-senha" onclick="alternarVisibilidadeSenhaPerfil('input-perfil-nova-senha', this)" title="Ver senha">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    </button>
                  </div>
                </div>
                <div class="campo-grupo" style="margin-bottom: 0;">
                  <label for="input-perfil-confirma-senha" class="campo-label">Confirmar Nova Senha</label>
                  <div class="input-com-icone input-com-olho">
                    <span class="campo-icone-prefix">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                      </svg>
                    </span>
                    <input type="password" id="input-perfil-confirma-senha" placeholder="Repita a nova senha" autocomplete="new-password" />
                    <button type="button" class="btn-olho-senha" onclick="alternarVisibilidadeSenhaPerfil('input-perfil-confirma-senha', this)" title="Ver senha">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ABA 2: CHAVE PIX -->
          <div id="aba-painel-pix" class="perfil-tab-painel" style="display: none;">
            <div class="perfil-pix-info-card">
              <div class="perfil-pix-info-icone">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                  <circle cx="12" cy="12" r="2.5"></circle>
                  <path d="M7 15h.01M17 9h.01"></path>
                </svg>
              </div>
              <div>
                <div style="font-weight: 700; font-size: 13.5px; color: var(--cor-texto);">Sua Chave Pix para Reembolsos</div>
                <div style="font-size: 11.5px; color: var(--cor-texto-suave); line-height: 1.35; margin-top: 2px;">
                  Os outros moradores verão esta chave quando você registrar uma compra compartilhada.
                </div>
              </div>
            </div>

            <div class="campo-grupo">
              <label for="input-perfil-pix-tipo" class="campo-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; vertical-align:-1px; margin-right:4px;">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
                Tipo de Chave Pix
              </label>
              <select id="input-perfil-pix-tipo" class="campo-select" onchange="atualizarPlaceholderPixPerfil()">
                <option value="telefone">Celular</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="aleatoria">Chave Aleatória (EVP)</option>
              </select>
            </div>

            <div class="campo-grupo">
              <label for="input-perfil-pix-chave" class="campo-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; vertical-align:-1px; margin-right:4px;">
                  <path d="M21 2l-2 2m-6 6l7-7-3-3-7 7v3h3z"></path>
                  <circle cx="7.5" cy="15.5" r="5.5"></circle>
                </svg>
                Chave Pix
              </label>
              <input type="text" id="input-perfil-pix-chave" placeholder="(00) 00000-0000" />
              <span id="hint-perfil-pix" class="campo-dica" style="margin-top: 3px; font-size: 11px;"></span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="campo-grupo" style="margin-bottom: 0;">
                <label for="input-perfil-pix-titular" class="campo-label">
                  <span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; vertical-align:-1px; margin-right:3px;">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    Titular
                  </span>
                  <span class="badge-imutavel" style="font-size: 9px; padding: 1px 4px;">Opcional</span>
                </label>
                <input type="text" id="input-perfil-pix-titular" placeholder="Nome no banco" />
              </div>
              <div class="campo-grupo" style="margin-bottom: 0;">
                <label for="input-perfil-pix-banco" class="campo-label">
                  <span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; vertical-align:-1px; margin-right:3px;">
                      <line x1="3" y1="21" x2="21" y2="21"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                      <polyline points="5 10 5 21"></polyline>
                      <polyline points="19 10 19 21"></polyline>
                      <polygon points="12 2 20 7 4 7 12 2"></polygon>
                    </svg>
                    Banco
                  </span>
                  <span class="badge-imutavel" style="font-size: 9px; padding: 1px 4px;">Opcional</span>
                </label>
                <input type="text" id="input-perfil-pix-banco" placeholder="Ex: Nubank, Inter" />
              </div>
            </div>

            <!-- LIVE PREVIEW CARD -->
            <div class="pix-preview-card" style="margin-top: 14px;">
              <div class="pix-preview-badge">Pré-visualização do seu Pix</div>
              <div class="pix-preview-conteudo">
                <div class="pix-preview-icone-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 12l10 10 10-10L12 2zm0 3.5L18.5 12 12 18.5 5.5 12 12 5.5z"/>
                  </svg>
                </div>
                <div class="pix-preview-linhas">
                  <div class="pix-preview-chave-texto" id="pix-preview-chave-val">Nenhuma chave cadastrada</div>
                  <div class="pix-preview-meta" id="pix-preview-meta-val">Celular • Titular: Morador</div>
                </div>
              </div>
            </div>
          </div>

          <!-- ABA 3: AJUSTES -->
          <div id="aba-painel-ajustes" class="perfil-tab-painel" style="display: none;">
            <div class="seletor-tema-container" style="margin-top: 0;">
              <span class="seletor-tema-titulo">Tema da Interface</span>
              <div class="seletor-tema-opcoes">
                <button type="button" class="btn-opcao-tema" id="btn-tema-light" onclick="definirTema('light')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                  <span>Claro</span>
                </button>
                <button type="button" class="btn-opcao-tema" id="btn-tema-dark" onclick="definirTema('dark')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                  <span>Escuro</span>
                </button>
                <button type="button" class="btn-opcao-tema" id="btn-tema-auto" onclick="definirTema('auto')">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <span>Sistema</span>
                </button>
              </div>
            </div>

            <div class="secao-info-app" style="margin-top: 14px; padding: 12px; background: var(--cor-fundo); border: 1px solid var(--cor-borda); border-radius: 12px;">
              <div style="font-size: 12.5px; font-weight: 600; color: var(--cor-texto);">Rachaê • Gestão Compartilhada</div>
              <div style="font-size: 11.5px; color: var(--cor-texto-suave); margin-top: 2px;">
                Aplicativo sincronizado e atualizado em tempo real.
              </div>
            </div>

            <div class="rodape-acao-sair" style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--cor-borda);">
              <span class="seletor-tema-titulo" style="margin-bottom: 8px;">Sessão do Usuário</span>
              <button type="button" class="btn-sair-modal" onclick="logout()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Sair da conta</span>
              </button>
            </div>
          </div>

        </div>

        <!-- FOOTER FIXO -->
        <div class="modal-perfil-footer-fixo">
          <div id="msg-perfil-modal" class="msg-feedback-perfil" style="display: none;"></div>
          <div class="modal-botoes-grid">
            <button type="button" class="btn-perfil-cancelar" onclick="fecharModalPerfil()">Cancelar</button>
            <button type="submit" id="btn-salvar-perfil" class="btn-perfil-salvar" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important; color: #ffffff !important; border: none !important;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Salvar Alterações</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) fecharModalPerfil();
  });

  const inputTel = modal.querySelector("#input-perfil-telefone");
  if (inputTel && typeof aplicarMascaraTelefone === "function") {
    aplicarMascaraTelefone(inputTel);
  }

  const inputNome = modal.querySelector("#input-perfil-nome");
  if (inputNome) {
    inputNome.addEventListener("input", () => {
      const v = inputNome.value.trim();
      const previewIniciais = modal.querySelector("#modal-perfil-avatar-preview");
      const previewNome = modal.querySelector("#modal-perfil-preview-nome");
      if (previewIniciais) previewIniciais.textContent = calcularIniciais(v || "Usuário");
      if (previewNome) previewNome.textContent = v || "Usuário";
      atualizarPreviewPixPerfil();
    });
  }

  const inputPixTipo = modal.querySelector("#input-perfil-pix-tipo");
  if (inputPixTipo) {
    inputPixTipo.addEventListener("change", () => {
      atualizarPlaceholderPixPerfil();
      aoDigitarChavePixPerfil();
      atualizarPreviewPixPerfil();
    });
  }

  const inputPixChave = modal.querySelector("#input-perfil-pix-chave");
  if (inputPixChave) {
    inputPixChave.addEventListener("input", () => {
      aoDigitarChavePixPerfil();
      atualizarPreviewPixPerfil();
    });
  }

  const inputPixTitular = modal.querySelector("#input-perfil-pix-titular");
  if (inputPixTitular) {
    inputPixTitular.addEventListener("input", atualizarPreviewPixPerfil);
  }

  const inputPixBanco = modal.querySelector("#input-perfil-pix-banco");
  if (inputPixBanco) {
    inputPixBanco.addEventListener("input", atualizarPreviewPixPerfil);
  }

  return modal;
}

function alternarAbaPerfil(aba) {
  const abas = ["dados", "pix", "ajustes"];
  abas.forEach((a) => {
    const btn = document.getElementById(`tab-btn-${a}`);
    const painel = document.getElementById(`aba-painel-${a}`);
    if (btn) {
      if (a === aba) {
        btn.classList.add("ativo");
        btn.setAttribute("aria-selected", "true");
        btn.style.setProperty("background", "linear-gradient(135deg, #059669 0%, #10b981 100%)", "important");
        btn.style.setProperty("color", "#ffffff", "important");
        btn.style.setProperty("font-weight", "700", "important");
        btn.style.setProperty("box-shadow", "0 2px 8px rgba(16, 185, 129, 0.35)", "important");
      } else {
        btn.classList.remove("ativo");
        btn.setAttribute("aria-selected", "false");
        btn.style.setProperty("background", "transparent", "important");
        btn.style.setProperty("color", "var(--cor-texto-suave, #a1a1aa)", "important");
        btn.style.setProperty("font-weight", "600", "important");
        btn.style.setProperty("box-shadow", "none", "important");
      }
    }
    if (painel) {
      if (a === aba) {
        painel.style.display = "block";
        painel.classList.add("ativo");
      } else {
        painel.style.display = "none";
        painel.classList.remove("ativo");
      }
    }
  });
}

function atualizarPreviewPixPerfil() {
  const tipo = document.getElementById("input-perfil-pix-tipo")?.value || "telefone";
  const chave = document.getElementById("input-perfil-pix-chave")?.value?.trim() || "";
  const titular = document.getElementById("input-perfil-pix-titular")?.value?.trim() || "";
  const banco = document.getElementById("input-perfil-pix-banco")?.value?.trim() || "";
  const inputNome = document.getElementById("input-perfil-nome")?.value?.trim() || "";
  const nomeUsuario = inputNome || (perfilUsuarioAtual && perfilUsuarioAtual.nome) || "Morador";

  const elChave = document.getElementById("pix-preview-chave-val");
  const elMeta = document.getElementById("pix-preview-meta-val");

  if (elChave) {
    elChave.textContent = chave || "Nenhuma chave cadastrada";
  }
  if (elMeta) {
    const rotuloTipo = rotuloTipoPix(tipo);
    const titularExibido = titular || nomeUsuario;
    const bancoExibido = banco ? ` • ${banco}` : "";
    elMeta.textContent = `${rotuloTipo} • Titular: ${titularExibido}${bancoExibido}`;
  }
}

window.alternarAbaPerfil = alternarAbaPerfil;
window.atualizarPreviewPixPerfil = atualizarPreviewPixPerfil;

function abrirModalPerfil() {
  const modal = garantirModalPerfil();
  const perfil = perfilUsuarioAtual || window.perfilUsuarioAtual || { nome: "", telefone: "", email: "" };

  const inputNome = document.getElementById("input-perfil-nome");
  const inputTel = document.getElementById("input-perfil-telefone");
  const inputEmail = document.getElementById("input-perfil-email");
  const previewAvatar = document.getElementById("modal-perfil-avatar-preview");
  const previewNome = document.getElementById("modal-perfil-preview-nome");
  const previewEmail = document.getElementById("modal-perfil-preview-email");

  if (inputNome) inputNome.value = perfil.nome || "";
  if (inputTel) inputTel.value = formatarTelefone(perfil.telefone || "");
  if (inputEmail) inputEmail.value = perfil.email || "";

  if (previewAvatar) previewAvatar.textContent = calcularIniciais(perfil.nome);
  if (previewNome) previewNome.textContent = perfil.nome || "Usuário";
  if (previewEmail) previewEmail.textContent = perfil.email || "";

  // Campos de Chave Pix Pessoal
  const inputPixTipo = document.getElementById("input-perfil-pix-tipo");
  const inputPixChave = document.getElementById("input-perfil-pix-chave");
  const inputPixTitular = document.getElementById("input-perfil-pix-titular");
  const inputPixBanco = document.getElementById("input-perfil-pix-banco");

  if (inputPixTipo) inputPixTipo.value = perfil.tipo_chave_pix || "telefone";
  if (inputPixChave) {
    inputPixChave.value = formatarChavePixGenerica(perfil.chave_pix || "", perfil.tipo_chave_pix || "telefone");
  }
  if (inputPixTitular) inputPixTitular.value = perfil.nome_titular_pix || "";
  if (inputPixBanco) inputPixBanco.value = perfil.banco_pix || "";

  atualizarPlaceholderPixPerfil();
  atualizarPreviewPixPerfil();
  alternarAbaPerfil("dados");

  const inputNovaSenha = document.getElementById("input-perfil-nova-senha");
  const inputConfirma = document.getElementById("input-perfil-confirma-senha");
  if (inputNovaSenha) inputNovaSenha.value = "";
  if (inputConfirma) inputConfirma.value = "";

  const containerCamposSenha = document.getElementById("container-campos-senha");
  const iconeSetaSenha = document.getElementById("icone-seta-senha");
  if (containerCamposSenha) containerCamposSenha.style.display = "none";
  if (iconeSetaSenha) iconeSetaSenha.style.transform = "rotate(0deg)";

  const msgEl = document.getElementById("msg-perfil-modal");
  if (msgEl) {
    msgEl.style.display = "none";
    msgEl.textContent = "";
    msgEl.className = "msg-feedback-perfil";
  }

  const btnSalvar = document.getElementById("btn-salvar-perfil");
  if (btnSalvar) {
    btnSalvar.disabled = false;
    btnSalvar.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Salvar Alterações</span>
    `;
  }

  atualizarBotoesTemaPerfil();
  modal.style.display = "flex";
  if (window.Animacoes && typeof window.Animacoes.animarAberturaModal === "function") {
    const cardModal = modal.querySelector(".modal-card-perfil") || modal;
    window.Animacoes.animarAberturaModal(modal, cardModal);
  }
  document.addEventListener("keydown", onKeyDownPerfilModal);

  setTimeout(() => {
    if (inputNome) inputNome.focus();
  }, 100);
}

function fecharModalPerfil() {
  const modal = document.getElementById("modal-perfil-usuario");
  if (modal) {
    const fecharImediato = () => {
      modal.style.setProperty("display", "none", "important");
      modal.classList.remove("ativo");
    };
    if (window.Animacoes && typeof window.Animacoes.animarFechamentoModal === "function") {
      const cardModal = modal.querySelector(".modal-card-perfil") || modal;
      window.Animacoes.animarFechamentoModal(modal, cardModal, fecharImediato);
    } else {
      fecharImediato();
    }
  }
  document.removeEventListener("keydown", onKeyDownPerfilModal);
}

function onKeyDownPerfilModal(e) {
  if (e.key === "Escape") {
    fecharModalPerfil();
  }
}

async function salvarPerfilUsuario(event) {
  if (event) event.preventDefault();

  const msgEl = document.getElementById("msg-perfil-modal");
  const btnSalvar = document.getElementById("btn-salvar-perfil");
  const inputNome = document.getElementById("input-perfil-nome");
  const inputTel = document.getElementById("input-perfil-telefone");
  const inputNovaSenha = document.getElementById("input-perfil-nova-senha");
  const inputConfirma = document.getElementById("input-perfil-confirma-senha");

  const mostrarMensagemModal = (texto, tipo = "erro") => {
    if (!msgEl) return;
    msgEl.className = `msg-feedback-perfil ${tipo}`;
    msgEl.textContent = texto;
    msgEl.style.display = "block";
  };

  const novoNome = inputNome ? inputNome.value.trim() : "";
  const novoTelefone = inputTel ? inputTel.value.trim() : "";
  const novaSenha = inputNovaSenha ? inputNovaSenha.value : "";
  const confirmaSenha = inputConfirma ? inputConfirma.value : "";

  const inputPixTipo = document.getElementById("input-perfil-pix-tipo");
  const inputPixChave = document.getElementById("input-perfil-pix-chave");
  const inputPixTitular = document.getElementById("input-perfil-pix-titular");
  const inputPixBanco = document.getElementById("input-perfil-pix-banco");

  const novoPixTipo = inputPixTipo ? inputPixTipo.value : "telefone";
  let novoPixChave = inputPixChave ? inputPixChave.value.trim() : "";
  const novoPixTitular = inputPixTitular ? inputPixTitular.value.trim() : "";
  const novoPixBanco = inputPixBanco ? inputPixBanco.value.trim() : "";

  if (!novoNome || novoNome.length < 2) {
    alternarAbaPerfil("dados");
    mostrarMensagemModal("Por favor, informe seu nome (pelo menos 2 letras).", "erro");
    if (inputNome) inputNome.focus();
    return;
  }

  // Validação da Chave Pix (se preenchida)
  if (novoPixChave) {
    const validacaoPix = validarChavePixCompleta(novoPixChave, novoPixTipo);
    if (!validacaoPix.valido) {
      alternarAbaPerfil("pix");
      mostrarMensagemModal(validacaoPix.erro || "Chave Pix inválida para o tipo selecionado.", "erro");
      if (inputPixChave) inputPixChave.focus();
      return;
    }
    novoPixChave = validacaoPix.chaveNormalizada;
  }

  if (novaSenha) {
    if (novaSenha.length < 6) {
      alternarAbaPerfil("dados");
      const containerCamposSenha = document.getElementById("container-campos-senha");
      if (containerCamposSenha && containerCamposSenha.style.display === "none") {
        alternarSecaoSenha();
      }
      mostrarMensagemModal("A nova senha deve possuir pelo menos 6 caracteres.", "erro");
      if (inputNovaSenha) inputNovaSenha.focus();
      return;
    }
    if (novaSenha !== confirmaSenha) {
      alternarAbaPerfil("dados");
      const containerCamposSenha = document.getElementById("container-campos-senha");
      if (containerCamposSenha && containerCamposSenha.style.display === "none") {
        alternarSecaoSenha();
      }
      mostrarMensagemModal("As senhas informadas não conferem.", "erro");
      if (inputConfirma) inputConfirma.focus();
      return;
    }
  }

  if (msgEl) msgEl.style.display = "none";
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = `<span>Salvando alterações...</span>`;
  }

  try {
    const usuarioId = (perfilUsuarioAtual && perfilUsuarioAtual.id) || (await supabaseClient.auth.getUser()).data?.user?.id;
    if (!usuarioId) {
      throw new Error("Sessão expirada. Por favor, entre novamente.");
    }

    // 1. Atualiza na tabela public.profiles (incluindo chave Pix pessoal)
    const { error: errProfiles } = await supabaseClient
      .from("profiles")
      .update({
        nome: novoNome,
        telefone: novoTelefone || null,
        chave_pix: novoPixChave || null,
        tipo_chave_pix: novoPixTipo || "telefone",
        nome_titular_pix: novoPixTitular || null,
        banco_pix: novoPixBanco || null,
      })
      .eq("id", usuarioId);

    if (errProfiles) {
      console.warn("Aviso ao atualizar tabela profiles:", errProfiles);
    }

    // 2. Atualiza no Supabase Auth (user_metadata e senha se informada)
    const updatePayload = {
      data: {
        nome: novoNome,
        telefone: novoTelefone || null,
      },
    };
    if (novaSenha) {
      updatePayload.password = novaSenha;
    }

    const { error: errAuth } = await supabaseClient.auth.updateUser(updatePayload);
    if (errAuth) {
      throw errAuth;
    }

    // 3. Atualiza estado em memória
    if (perfilUsuarioAtual) {
      perfilUsuarioAtual.nome = novoNome;
      perfilUsuarioAtual.telefone = novoTelefone;
      perfilUsuarioAtual.chave_pix = novoPixChave;
      perfilUsuarioAtual.tipo_chave_pix = novoPixTipo;
      perfilUsuarioAtual.nome_titular_pix = novoPixTitular;
      perfilUsuarioAtual.banco_pix = novoPixBanco;
    }
    window.perfilUsuarioAtual = perfilUsuarioAtual;

    // 4. Atualiza UI do Header
    atualizarHeaderUsuarioUI(perfilUsuarioAtual);

    // 5. Dispara evento customizado para que páginas abertas (ex: Dashboard) possam reagir
    window.dispatchEvent(
      new CustomEvent("perfilAtualizado", {
        detail: {
          id: usuarioId,
          nome: novoNome,
          telefone: novoTelefone,
          chave_pix: novoPixChave,
          tipo_chave_pix: novoPixTipo,
          nome_titular_pix: novoPixTitular,
          banco_pix: novoPixBanco,
        },
      })
    );

    fecharModalPerfil();
    mostrarToast("Perfil atualizado com sucesso!", "sucesso");
  } catch (err) {
    console.error("Erro ao salvar perfil:", err);
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Salvar Alterações</span>
      `;
    }
    mostrarMensagemModal(err.message || "Erro ao salvar alterações do perfil.", "erro");
  }
}

function alternarSecaoSenha() {
  const container = document.getElementById("container-campos-senha");
  const icone = document.getElementById("icone-seta-senha");
  if (!container) return;

  const estaAberto = container.style.display !== "none";
  if (estaAberto) {
    container.style.display = "none";
    if (icone) icone.style.transform = "rotate(0deg)";
  } else {
    container.style.display = "block";
    if (icone) icone.style.transform = "rotate(180deg)";
    const inputSenha = document.getElementById("input-perfil-nova-senha");
    if (inputSenha) inputSenha.focus();
  }
}

function alternarVisibilidadeSenhaPerfil(campoId, botao) {
  const campo = document.getElementById(campoId);
  if (!campo || !botao) return;

  if (campo.type === "password") {
    campo.type = "text";
    botao.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
    botao.title = "Ocultar senha";
  } else {
    campo.type = "password";
    botao.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    botao.title = "Mostrar senha";
  }
}

// Utilitário para formatar moeda no padrão brasileiro (R$ 1.234,56)
function formatarMoeda(valor) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(valor) || 0);
}

// Utilitário de notificação Toast suave (substitui o alert nativo)
function mostrarToast(mensagem, tipo = "sucesso") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    <span></span>
  `;
  // Usa textContent (não innerHTML) pro texto da mensagem: ela quase sempre
  // inclui algo digitado por alguém (nome de morador, de conta etc.), então
  // isso evita que HTML/script disfarçado de nome execute no toast.
  toast.querySelector("span").textContent = mensagem;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px) scale(0.95)";
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// ============================================================
// Modal de Confirmação Padrão do Sistema (substitui confirm() nativo)
// ============================================================
function mostrarConfirmacao({
  titulo = "Confirmação",
  mensagem = "Deseja continuar com esta ação?",
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  tipo = "normal", // 'normal', 'destaque', 'gerar', 'perigo'
} = {}) {
  return new Promise((resolve) => {
    const antigo = document.getElementById("modal-confirmacao-sistema");
    if (antigo) antigo.remove();

    const overlay = document.createElement("div");
    overlay.id = "modal-confirmacao-sistema";
    overlay.className = "modal-overlay-sistema";

    let iconeSvg = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `;

    if (tipo === "perigo") {
      iconeSvg = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
    } else if (tipo === "gerar" || tipo === "destaque") {
      iconeSvg = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
      `;
    }

    const iconeClasse = tipo === "perigo" ? "modal-icone-circulo perigo" : (tipo === "destaque" || tipo === "gerar" ? "modal-icone-circulo destaque" : "modal-icone-circulo");
    const botaoConfirmarClasse = tipo === "perigo" ? "btn-confirmar-perigo" : "";

    overlay.innerHTML = `
      <div class="modal-card-sistema" role="dialog" aria-modal="true">
        <div class="${iconeClasse}">
          ${iconeSvg}
        </div>
        <h3>${titulo}</h3>
        <p>${mensagem}</p>
        <div class="modal-botoes-grid">
          <button type="button" class="secundario" id="btn-modal-cancelar">${textoCancelar}</button>
          <button type="button" class="${botaoConfirmarClasse}" id="btn-modal-confirmar">${textoConfirmar}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const fechar = (resultado) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(resultado);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") fechar(false);
    };
    document.addEventListener("keydown", onKeyDown);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fechar(false);
    });

    document.getElementById("btn-modal-cancelar").addEventListener("click", () => fechar(false));
    document.getElementById("btn-modal-confirmar").addEventListener("click", () => fechar(true));
  });
}

// Modal de Aviso Simples (substitui alert() nativo)
function mostrarAlerta({
  titulo = "Aviso",
  mensagem = "",
  textoBotao = "Entendido",
} = {}) {
  return new Promise((resolve) => {
    const antigo = document.getElementById("modal-confirmacao-sistema");
    if (antigo) antigo.remove();

    const overlay = document.createElement("div");
    overlay.id = "modal-confirmacao-sistema";
    overlay.className = "modal-overlay-sistema";

    overlay.innerHTML = `
      <div class="modal-card-sistema" role="dialog" aria-modal="true">
        <div class="modal-icone-circulo destaque">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3>${titulo}</h3>
        <p>${mensagem}</p>
        <div>
          <button type="button" id="btn-modal-entendido" style="margin: 0; width: 100%;">${textoBotao}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const fechar = () => {
      overlay.remove();
      resolve();
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fechar();
    });

    document.getElementById("btn-modal-entendido").addEventListener("click", fechar);
  });
}

// ============================================================
// Máscara e Formatação de Telefone / WhatsApp
// ============================================================
function formatarTelefone(valor) {
  if (!valor) return "";
  let digits = String(valor).replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.substring(2);
  }
  if (digits.length === 11) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`;
  } else if (digits.length === 10) {
    return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`;
  }
  return valor;
}

function aplicarMascaraTelefone(input) {
  if (!input) return;
  const formatar = () => {
    let v = input.value.replace(/\D/g, "");
    if (v.length > 11) v = v.substring(0, 11);

    if (v.length === 0) {
      input.value = "";
    } else if (v.length <= 2) {
      input.value = `(${v}`;
    } else if (v.length <= 6) {
      input.value = `(${v.substring(0, 2)}) ${v.substring(2)}`;
    } else if (v.length <= 10) {
      input.value = `(${v.substring(0, 2)}) ${v.substring(2, 6)}-${v.substring(6)}`;
    } else {
      input.value = `(${v.substring(0, 2)}) ${v.substring(2, 7)}-${v.substring(7)}`;
    }
  };

  input.addEventListener("input", formatar);
  input.addEventListener("paste", () => setTimeout(formatar, 0));
  if (input.value) formatar();
}

// Auto-inicializa máscara de telefone em qualquer página
document.addEventListener("DOMContentLoaded", () => {
  const camposTel = document.querySelectorAll('input[type="tel"], #telefone');
  camposTel.forEach(aplicarMascaraTelefone);
});

// Utilitário para verificar papel (admin / morador)
async function obterPapelUsuarioNaCasa(casaId, usuarioId) {
  if (!casaId || !usuarioId) return "morador";
  try {
    const { data } = await supabaseClient
      .from("membros_casa")
      .select("papel")
      .eq("casa_id", casaId)
      .eq("usuario_id", usuarioId)
      .maybeSingle();

    if (data && data.papel) {
      localStorage.setItem("casa_papel", data.papel);
      return data.papel;
    }
  } catch (e) {
    console.warn("Erro ao verificar papel do usuário:", e);
  }
  return localStorage.getItem("casa_papel") || "morador";
}

// Utilitários oficiais BACEN para geração de Pix Copia e Cola (BR Code EMV)
function normalizarTextoPix(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
}

function formatarCampoPix(id, valor) {
  const len = String(valor.length).padStart(2, "0");
  return `${id}${len}${valor}`;
}

function calcularCRC16Pix(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function gerarPayloadPix({ chave, tipo, nome, cidade, valor, identificador }) {
  if (!chave) return "";
  let chaveFormatada = chave.trim();

  // Tratamento da chave de acordo com o padrão do BACEN
  const soDigitos = chaveFormatada.replace(/\D/g, "");
  if (tipo === "telefone" || (!tipo && /^[0-9]{10,11}$/.test(soDigitos))) {
    chaveFormatada = "+55" + soDigitos;
  } else if (tipo === "cpf") {
    chaveFormatada = soDigitos.substring(0, 11);
  } else if (tipo === "cnpj") {
    chaveFormatada = soDigitos.substring(0, 14);
  } else if (tipo === "email") {
    chaveFormatada = chaveFormatada.toLowerCase();
  }

  const merchantAccount =
    formatarCampoPix("00", "br.gov.bcb.pix") +
    formatarCampoPix("01", chaveFormatada);

  let payload =
    formatarCampoPix("00", "01") +
    formatarCampoPix("26", merchantAccount) +
    formatarCampoPix("52", "0000") +
    formatarCampoPix("53", "986");

  const numValor = typeof valor === "number" ? valor : parseFloat(valor);
  if (!isNaN(numValor) && numValor > 0) {
    payload += formatarCampoPix("54", numValor.toFixed(2));
  }

  const nomeLimpo = normalizarTextoPix(nome || "Rachae").substring(0, 25) || "Rachae";
  const cidadeLimpa = normalizarTextoPix(cidade || "BRASIL").substring(0, 15) || "BRASIL";
  const txidLimpo = (identificador || "***").replace(/[^a-zA-Z0-9]/g, "").substring(0, 25) || "***";

  payload += formatarCampoPix("58", "BR");
  payload += formatarCampoPix("59", nomeLimpo);
  payload += formatarCampoPix("60", cidadeLimpa);
  payload += formatarCampoPix("62", formatarCampoPix("05", txidLimpo));
  payload += "6304";

  const crc = calcularCRC16Pix(payload);
  return payload + crc;
}

// ============================================================
// Utilitários de Formatação e Validação de Chave Pix do Morador
// ============================================================
function atualizarPlaceholderPixPerfil() {
  const select = document.getElementById("input-perfil-pix-tipo");
  const input = document.getElementById("input-perfil-pix-chave");
  const hint = document.getElementById("hint-perfil-pix");
  if (!select || !input) return;

  const tipo = select.value;
  switch (tipo) {
    case "telefone":
      input.placeholder = "(00) 00000-0000";
      if (hint) hint.textContent = "Celular com DDD (10 ou 11 dígitos).";
      break;
    case "cpf":
      input.placeholder = "000.000.000-00";
      if (hint) hint.textContent = "CPF do titular (11 dígitos).";
      break;
    case "cnpj":
      input.placeholder = "00.000.000/0000-00";
      if (hint) hint.textContent = "CNPJ da pessoa jurídica (14 dígitos).";
      break;
    case "email":
      input.placeholder = "seu.email@exemplo.com";
      if (hint) hint.textContent = "E-mail cadastrado como chave Pix no seu banco.";
      break;
    case "aleatoria":
      input.placeholder = "Ex: 123e4567-e89b-12d3-a456-426614174000";
      if (hint) hint.textContent = "Chave aleatória gerada pelo seu banco.";
      break;
    default:
      input.placeholder = "Digite sua chave Pix";
      if (hint) hint.textContent = "";
  }
}

function aoDigitarChavePixPerfil() {
  const select = document.getElementById("input-perfil-pix-tipo");
  const input = document.getElementById("input-perfil-pix-chave");
  if (!select || !input) return;

  const tipo = select.value;
  if (tipo === "telefone") {
    input.value = formatarTelefonePix(input.value);
  } else if (tipo === "cpf") {
    input.value = formatarCpfPix(input.value);
  } else if (tipo === "cnpj") {
    input.value = formatarCnpjPix(input.value);
  }
}

function formatarTelefonePix(val) {
  if (!val) return "";
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function formatarCpfPix(val) {
  if (!val) return "";
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function formatarCnpjPix(val) {
  if (!val) return "";
  const digits = val.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

function formatarChavePixGenerica(chave, tipo) {
  if (!chave) return "";
  if (tipo === "telefone") return formatarTelefonePix(chave);
  if (tipo === "cpf") return formatarCpfPix(chave);
  if (tipo === "cnpj") return formatarCnpjPix(chave);
  return chave;
}

function rotuloTipoPix(tipo) {
  const map = {
    telefone: "Celular",
    cpf: "CPF",
    cnpj: "CNPJ",
    email: "E-mail",
    aleatoria: "Aleatória",
  };
  return map[tipo] || "Pix";
}

function validarChavePixCompleta(chave, tipo) {
  const c = (chave || "").trim();
  if (!c) return { valido: true, chaveNormalizada: "" };

  if (tipo === "telefone") {
    const digitos = c.replace(/\D/g, "");
    if (digitos.length !== 10 && digitos.length !== 11) {
      return { valido: false, erro: "O celular Pix deve ter DDD + número (10 ou 11 dígitos)." };
    }
    return { valido: true, chaveNormalizada: digitos };
  }

  if (tipo === "cpf") {
    const digitos = c.replace(/\D/g, "");
    if (digitos.length !== 11) {
      return { valido: false, erro: "O CPF Pix deve conter 11 dígitos." };
    }
    return { valido: true, chaveNormalizada: digitos };
  }

  if (tipo === "cnpj") {
    const digitos = c.replace(/\D/g, "");
    if (digitos.length !== 14) {
      return { valido: false, erro: "O CNPJ Pix deve conter 14 dígitos." };
    }
    return { valido: true, chaveNormalizada: digitos };
  }

  if (tipo === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) {
      return { valido: false, erro: "Informe um e-mail válido para a chave Pix." };
    }
    return { valido: true, chaveNormalizada: c.toLowerCase() };
  }

  if (tipo === "aleatoria") {
    const limpa = c.replace(/\s+/g, "");
    if (limpa.length < 32 || limpa.length > 36) {
      return { valido: false, erro: "A chave aleatória Pix costuma ter entre 32 e 36 caracteres." };
    }
    return { valido: true, chaveNormalizada: limpa };
  }

  return { valido: true, chaveNormalizada: c };
}

// Expõe no escopo global
window.mostrarConfirmacao = mostrarConfirmacao;
window.mostrarAlerta = mostrarAlerta;
window.formatarTelefone = formatarTelefone;
window.aplicarMascaraTelefone = aplicarMascaraTelefone;
window.obterPapelUsuarioNaCasa = obterPapelUsuarioNaCasa;
window.gerarPayloadPix = gerarPayloadPix;
window.calcularCRC16Pix = calcularCRC16Pix;
window.inicializarPerfilUsuario = inicializarPerfilUsuario;
window.abrirModalPerfil = abrirModalPerfil;
window.fecharModalPerfil = fecharModalPerfil;
window.salvarPerfilUsuario = salvarPerfilUsuario;
window.alternarSecaoSenha = alternarSecaoSenha;
window.alternarVisibilidadeSenhaPerfil = alternarVisibilidadeSenhaPerfil;
window.atualizarPlaceholderPixPerfil = atualizarPlaceholderPixPerfil;
window.aoDigitarChavePixPerfil = aoDigitarChavePixPerfil;
window.formatarTelefonePix = formatarTelefonePix;
window.formatarCpfPix = formatarCpfPix;
window.formatarCnpjPix = formatarCnpjPix;
window.formatarChavePixGenerica = formatarChavePixGenerica;
window.rotuloTipoPix = rotuloTipoPix;
window.validarChavePixCompleta = validarChavePixCompleta;

// ============================================================
// Gerenciamento de Tema (Dark / Light / Auto Mode)
// ============================================================
function atualizarBotoesTemaPerfil() {
  const temaSalvo = localStorage.getItem("rachae_tema") || "auto";
  const botoes = {
    light: document.getElementById("btn-tema-light"),
    dark: document.getElementById("btn-tema-dark"),
    auto: document.getElementById("btn-tema-auto"),
  };
  Object.keys(botoes).forEach((key) => {
    if (botoes[key]) {
      if (key === temaSalvo) {
        botoes[key].classList.add("ativo");
      } else {
        botoes[key].classList.remove("ativo");
      }
    }
  });
}

function inicializarTema() {
  const temaSalvo = localStorage.getItem("rachae_tema");
  if (temaSalvo === "dark" || temaSalvo === "light") {
    document.documentElement.setAttribute("data-tema", temaSalvo);
  } else {
    const prefereDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-tema", prefereDark ? "dark" : "light");
  }
  atualizarBotoesTemaPerfil();
}

function definirTema(opcao) {
  if (opcao === "auto") {
    localStorage.removeItem("rachae_tema");
    const prefereDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-tema", prefereDark ? "dark" : "light");
  } else {
    localStorage.setItem("rachae_tema", opcao);
    document.documentElement.setAttribute("data-tema", opcao);
  }
  atualizarBotoesTemaPerfil();
}

function alternarTema() {
  const temaAtual = document.documentElement.getAttribute("data-tema");
  const novoTema = temaAtual === "dark" ? "light" : "dark";
  definirTema(novoTema);
}

window.definirTema = definirTema;
window.alternarTema = alternarTema;
window.atualizarBotoesTemaPerfil = atualizarBotoesTemaPerfil;
inicializarTema();

// ============================================================
// Registro de Service Worker e Banner de Instalação PWA
// ============================================================
if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("[PWA] Service Worker não pôde ser registrado:", err);
    });
  });
}

let deferredPromptPWA = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPromptPWA = e;

  const dispensado = localStorage.getItem("pwa_prompt_dispensado");
  const ehStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (ehStandalone || (dispensado && Date.now() - Number(dispensado) < 7 * 24 * 60 * 60 * 1000)) {
    return;
  }

  // Espera a página estar carregada para exibir o banner
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", exibirBannerInstalacaoPWA);
  } else {
    exibirBannerInstalacaoPWA();
  }
});

function exibirBannerInstalacaoPWA() {
  if (document.getElementById("banner-pwa-instalar")) return;
  const container = document.querySelector("#app-main .container") || document.querySelector(".container");
  if (!container) return;

  const banner = document.createElement("div");
  banner.id = "banner-pwa-instalar";
  banner.className = "banner-pwa-instalar";
  banner.innerHTML = `
    <div class="banner-pwa-conteudo">
      <img src="assets/icon.jpg" alt="Rachaê" class="banner-pwa-icone" />
      <div class="banner-pwa-texto">
        <strong>Instalar Rachaê no celular</strong>
        <span>Acesse suas contas e Pix com 1 toque</span>
      </div>
    </div>
    <div class="banner-pwa-acoes">
      <button type="button" class="btn-pwa-instalar" onclick="instalarAppPWA()">Instalar</button>
      <button type="button" class="btn-pwa-fechar" onclick="fecharBannerPWA()" title="Dispensar">✕</button>
    </div>
  `;
  container.prepend(banner);
}

window.instalarAppPWA = async function () {
  if (deferredPromptPWA) {
    deferredPromptPWA.prompt();
    const { outcome } = await deferredPromptPWA.userChoice;
    deferredPromptPWA = null;
    fecharBannerPWA();
  }
};

window.fecharBannerPWA = function () {
  const el = document.getElementById("banner-pwa-instalar");
  if (el) el.remove();
  localStorage.setItem("pwa_prompt_dispensado", String(Date.now()));
};

