// ============================================================
// Dashboard: ciclo mensal, status das cobranças e resumo financeiro
// ============================================================

(() => {
let casaId = null;
let usuarioAtualId = null;
let papelUsuarioAtual = "morador";
let dataSelecionada = new Date();
dataSelecionada.setDate(1); // Garante dia 1 do mês

let filtroAtual = "todos";
let dadosCiclosCarregados = [];

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

async function inicializarDashboard() {
  const elMes = document.getElementById("titulo-mes");
  if (elMes) {
    elMes.textContent = `${MESES[dataSelecionada.getMonth()]} de ${dataSelecionada.getFullYear()}`;
  }

  const session = await exigirLogin();
  if (!session) return;

  usuarioAtualId = session.user.id;
  casaId = localStorage.getItem("casa_atual");
  if (!casaId) {
    window.location.href = "casa.html";
    return;
  }

  papelUsuarioAtual = await obterPapelUsuarioNaCasa(casaId, usuarioAtualId);

  await carregarInfoCasaTopo();
  configurarNavegacaoMes();
  configurarFiltrosCobrancas();
  configurarAcoesDashboard();
  configurarModalPixEventos();

  if (window.Animacoes && !window.InstantNav?.emNavegacao) {
    window.Animacoes.animarEntradaPagina(".card-casa-topo, .seletor-mes, .card-metrica, #container-alerta-pessoal, .card");
  }

  await atualizarPainel();
}

window.inicializarDashboard = inicializarDashboard;

// Atualiza os dados do dashboard se o perfil do usuário for editado
if (!window._perfilAtualizadoDashBound) {
  window._perfilAtualizadoDashBound = true;
  window.addEventListener("perfilAtualizado", () => {
    if (document.getElementById("lista-ciclos")) {
      atualizarPainel();
    }
  });
}

async function carregarInfoCasaTopo() {
  const elNome = document.getElementById("dash-nome-casa");
  const elNum = document.getElementById("dash-numero-casa");

  // 1. Renderiza imediatamente do localStorage
  const nomeSalvo = localStorage.getItem("casa_nome");
  const numSalvo = localStorage.getItem("casa_numero");
  if (elNome && nomeSalvo) elNome.textContent = nomeSalvo;
  if (elNum && numSalvo) {
    elNum.textContent = `Nº ${numSalvo}`;
    elNum.style.display = "inline-block";
  }

  // 2. Busca do banco com select("*") seguro
  try {
    const { data: casa, error } = await supabaseClient
      .from("casas")
      .select("*")
      .eq("id", casaId)
      .maybeSingle();

    if (casa) {
      if (casa.nome) {
        localStorage.setItem("casa_nome", casa.nome);
        if (elNome) elNome.textContent = casa.nome;
      }
      if (elNum) {
        if (casa.numero) {
          localStorage.setItem("casa_numero", casa.numero);
          elNum.textContent = `Nº ${casa.numero}`;
          elNum.style.display = "inline-block";
        } else {
          elNum.style.display = "none";
        }
      }
    }
  } catch (e) {
    console.warn("Erro ao buscar dados da casa no dashboard:", e);
  }
}

function ehMesAtual(data = dataSelecionada) {
  const hoje = new Date();
  return (
    data.getMonth() === hoje.getMonth() &&
    data.getFullYear() === hoje.getFullYear()
  );
}

function configurarNavegacaoMes() {
  const btnAnt = document.getElementById("btn-mes-anterior");
  const btnProx = document.getElementById("btn-mes-proximo");
  const btnHoje = document.getElementById("btn-mes-atual");

  if (btnAnt) {
    btnAnt.addEventListener("click", async () => {
      dataSelecionada.setMonth(dataSelecionada.getMonth() - 1);
      await atualizarPainel();
    });
  }

  if (btnProx) {
    btnProx.addEventListener("click", async () => {
      dataSelecionada.setMonth(dataSelecionada.getMonth() + 1);
      await atualizarPainel();
    });
  }

  if (btnHoje) {
    btnHoje.addEventListener("click", async () => {
      dataSelecionada = new Date();
      dataSelecionada.setDate(1);
      await atualizarPainel();
    });
  }
}

function configurarFiltrosCobrancas() {
  const container = document.getElementById("filtros-cobrancas");
  if (!container) return;

  const botoes = container.querySelectorAll(".btn-filtro");
  botoes.forEach((btn) => {
    btn.addEventListener("click", () => {
      filtrarCobrancas(btn.dataset.filtro || "todos");
    });
  });
}

function filtrarCobrancas(tipo) {
  filtroAtual = tipo || "todos";
  const container = document.getElementById("filtros-cobrancas");
  if (container) {
    const botoes = container.querySelectorAll(".btn-filtro");
    botoes.forEach((b) => {
      if (b.dataset.filtro === filtroAtual) {
        b.classList.add("ativo");
      } else {
        b.classList.remove("ativo");
      }
    });
  }
  renderizarCiclosNaTela(true);

  // Rola suavemente até o detalhamento caso o usuário tenha acionado pelo card de alerta
  const secaoDetalhe = document.querySelector(".cabecalho-secao-detalhe");
  if (secaoDetalhe) {
    secaoDetalhe.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function primeiroDiaDoMes(data = dataSelecionada) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-01`;
}

async function atualizarPainel() {
  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();
  document.getElementById("titulo-mes").textContent = `${nomeMes} de ${ano}`;

  const btnHoje = document.getElementById("btn-mes-atual");
  if (btnHoje) {
    btnHoje.style.display = ehMesAtual() ? "none" : "inline-flex";
  }

  await carregarCiclosDoMes();
}

function renderizarSkeletonCarregando() {
  const container = document.getElementById("lista-ciclos");
  if (!container) return;
  container.innerHTML = `
    <div class="skeleton-lista">
      <div class="skeleton-item">
        <div class="skeleton-item-esq">
          <div class="skeleton-shimmer" style="width: 150px; height: 16px;"></div>
          <div class="skeleton-shimmer" style="width: 85px; height: 12px;"></div>
        </div>
        <div class="skeleton-item-dir">
          <div class="skeleton-shimmer" style="width: 70px; height: 24px; border-radius: 999px;"></div>
          <div class="skeleton-shimmer" style="width: 32px; height: 32px; border-radius: 8px;"></div>
        </div>
      </div>
      <div class="skeleton-item">
        <div class="skeleton-item-esq">
          <div class="skeleton-shimmer" style="width: 180px; height: 16px;"></div>
          <div class="skeleton-shimmer" style="width: 95px; height: 12px;"></div>
        </div>
        <div class="skeleton-item-dir">
          <div class="skeleton-shimmer" style="width: 70px; height: 24px; border-radius: 999px;"></div>
          <div class="skeleton-shimmer" style="width: 32px; height: 32px; border-radius: 8px;"></div>
        </div>
      </div>
      <div class="skeleton-item">
        <div class="skeleton-item-esq">
          <div class="skeleton-shimmer" style="width: 130px; height: 16px;"></div>
          <div class="skeleton-shimmer" style="width: 75px; height: 12px;"></div>
        </div>
        <div class="skeleton-item-dir">
          <div class="skeleton-shimmer" style="width: 70px; height: 24px; border-radius: 999px;"></div>
          <div class="skeleton-shimmer" style="width: 32px; height: 32px; border-radius: 8px;"></div>
        </div>
      </div>
    </div>
  `;
}

function atualizarBannerPessoal(cobrancaPendenteEu, totalPendenteEu) {
  const container = document.getElementById("container-alerta-pessoal");
  if (!container) return;

  if (cobrancaPendenteEu && totalPendenteEu > 0) {
    container.innerHTML = `
      <div class="card-alerta-pessoal pendente">
        <div class="alerta-pessoal-corpo">
          <div class="alerta-pessoal-icone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <div class="alerta-pessoal-texto">
            <h5>Sua pendência neste mês</h5>
            <p>Você tem <strong>${formatarMoeda(totalPendenteEu)}</strong> a pagar.</p>
          </div>
        </div>
        <button type="button" class="btn-alerta-pagar" onclick="abrirModalPix('${cobrancaPendenteEu.id}')" title="Pagar com Pix em 1 clique">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
          <span>Pagar Pix</span>
        </button>
      </div>
    `;
  } else if (dadosCiclosCarregados.length > 0) {
    const temCobrancasMinhas = dadosCiclosCarregados.some(d => d.cobrancas && d.cobrancas.some(c => c.usuario_id === usuarioAtualId));
    if (temCobrancasMinhas) {
      container.innerHTML = `
        <div class="card-alerta-pessoal pago">
          <div class="alerta-pessoal-corpo">
            <div class="alerta-pessoal-icone">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div class="alerta-pessoal-texto">
              <h5>Tudo em dia!</h5>
              <p>Sua parte de ${MESES[dataSelecionada.getMonth()]} já foi totalmente paga.</p>
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = "";
    }
  } else {
    container.innerHTML = "";
  }
}

async function carregarCiclosDoMes() {
  const container = document.getElementById("lista-ciclos");
  if (!container) return;
  const mesReferencia = primeiroDiaDoMes();
  const cacheKey = `cache_dash_${casaId}_${mesReferencia}`;

  // 1. CARREGAMENTO INSTANTÂNEO (0ms) VIA CACHE LOCAL
  let temCache = false;
  const dadosEmCache = sessionStorage.getItem(cacheKey);
  if (dadosEmCache) {
    try {
      const cacheObj = JSON.parse(dadosEmCache);
      if (cacheObj && cacheObj.dadosCiclosCarregados) {
        temCache = true;
        dadosCiclosCarregados = cacheObj.dadosCiclosCarregados;
        atualizarMetricas(cacheObj.metricas);
        atualizarContadoresFiltros(
          cacheObj.contadores.totalCobrancas,
          cacheObj.contadores.totalPendentes,
          cacheObj.contadores.totalPagas
        );
        atualizarBannerPessoal(cacheObj.banner?.cobrancaPendenteEu, cacheObj.banner?.totalPendenteEu || 0);
        atualizarAlertasVencimento(cacheObj.dadosCiclosCarregados, mesReferencia);
        calcularComparativoMesAnterior(mesReferencia, cacheObj.metricas?.totalCasa || 0);
        renderizarCiclosNaTela(false);
      }
    } catch (e) {
      console.warn("Erro ao ler cache do dashboard:", e);
    }
  }

  // Se NÃO havia cache salvo, mostra o esqueleto de carregamento
  if (!temCache) {
    renderizarSkeletonCarregando();
  }

  // 2. REVALIDAÇÃO SILENCIOSA EM SEGUNDO PLANO
  const { data: contas, error: erroContas } = await supabaseClient
    .from("contas_fixas")
    .select("*")
    .eq("casa_id", casaId)
    .eq("ativa", true);

  if (erroContas) {
    if (!temCache) {
      container.innerHTML = `<p class="erro">Erro ao carregar contas.</p>`;
    }
    return;
  }

  if (!contas || contas.length === 0) {
    dadosCiclosCarregados = [];
    container.innerHTML = `
      <div class="estado-vazio">
        <div class="estado-vazio-icone neutro">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </div>
        <h4>Nenhuma conta cadastrada</h4>
        <p>Cadastre as despesas fixas da casa (como luz, internet, água) para gerar as divisões automaticamente.</p>
        <a href="contas.html" class="btn-primario-acao" style="margin-top:14px; text-decoration:none; padding:8px 16px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
          <span>Cadastrar Conta</span>
        </a>
      </div>
    `;
    const metricasVazias = { totalCasa: 0, contasQtd: 0, suaParte: 0, seuStatus: "nenhum", totalPagas: 0, totalCobrancas: 0 };
    atualizarMetricas(metricasVazias);
    atualizarContadoresFiltros(0, 0, 0);
    atualizarBannerPessoal(null, 0);
    atualizarAlertasVencimento([], mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, 0);

    sessionStorage.setItem(cacheKey, JSON.stringify({
      dadosCiclosCarregados: [],
      metricas: metricasVazias,
      contadores: { totalCobrancas: 0, totalPendentes: 0, totalPagas: 0 },
      banner: { cobrancaPendenteEu: null, totalPendenteEu: 0 }
    }));
    return;
  }

  // Filtra apenas contas cujo início da cobrança é igual ou anterior ao mês selecionado
  const mesRefYYYYMM = mesReferencia.slice(0, 7);
  const contasDoMes = contas.filter((c) => {
    if (!c.mes_inicio) return true;
    return mesRefYYYYMM >= c.mes_inicio.slice(0, 7);
  });

  if (contasDoMes.length === 0) {
    dadosCiclosCarregados = [];
    container.innerHTML = `
      <div class="estado-vazio">
        <div class="estado-vazio-icone neutro">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <h4>Nenhuma conta ativa para este mês</h4>
        <p>Você possui contas cadastradas com início programado para os próximos meses.</p>
        <a href="contas.html" class="btn-primario-acao" style="margin-top:14px; text-decoration:none; padding:8px 16px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
          <span>Ver Contas</span>
        </a>
      </div>
    `;
    const metricasVazias = { totalCasa: 0, contasQtd: 0, suaParte: 0, seuStatus: "nenhum", totalPagas: 0, totalCobrancas: 0 };
    atualizarMetricas(metricasVazias);
    atualizarContadoresFiltros(0, 0, 0);
    atualizarBannerPessoal(null, 0);
    atualizarAlertasVencimento([], mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, 0);

    sessionStorage.setItem(cacheKey, JSON.stringify({
      dadosCiclosCarregados: [],
      metricas: metricasVazias,
      contadores: { totalCobrancas: 0, totalPendentes: 0, totalPagas: 0 },
      banner: { cobrancaPendenteEu: null, totalPendenteEu: 0 }
    }));
    return;
  }

  // GERAÇÃO AUTOMÁTICA: Cria e sincroniza as cobranças de todas as contas ativas no piloto automático!
  await garantirCobrancasDoMes(mesReferencia, contasDoMes);

  const novosDadosCiclos = [];
  let totalCasa = 0;
  let contasGeradasQtd = 0;
  let suaParte = 0;
  let suasCobrancas = [];
  let cobrancaPendenteEu = null;
  let totalPendenteEu = 0;
  let totalPagas = 0;
  let totalPendentes = 0;
  let totalCobrancas = 0;

  for (const conta of contasDoMes) {
    const { data: ciclo } = await supabaseClient
      .from("ciclos_cobranca")
      .select("*")
      .eq("conta_fixa_id", conta.id)
      .eq("mes_referencia", mesReferencia)
      .maybeSingle();

    if (!ciclo) continue;

    contasGeradasQtd++;
    totalCasa += Number(ciclo.valor_total || 0);

    const { data: cobrancas } = await supabaseClient
      .from("cobrancas_individuais")
      .select("*, profiles ( nome, telefone )")
      .eq("ciclo_id", ciclo.id);

    const lista = cobrancas || [];
    novosDadosCiclos.push({
      conta,
      ciclo,
      cobrancas: lista,
      mesReferencia,
    });

    for (const c of lista) {
      totalCobrancas++;
      const isEu = c.usuario_id === usuarioAtualId;
      if (isEu) {
        suaParte += Number(c.valor || 0);
        suasCobrancas.push(c.status);
        if (c.status !== "pago") {
          totalPendenteEu += Number(c.valor || 0);
          if (!cobrancaPendenteEu) {
            cobrancaPendenteEu = c;
          }
        }
      }
      if (c.status === "pago") {
        totalPagas++;
      } else {
        totalPendentes++;
      }
    }
  }

  // Determina status geral do usuário logado
  let seuStatus = "pendente";
  if (suasCobrancas.length === 0) {
    seuStatus = "pendente";
  } else if (suasCobrancas.every((st) => st === "pago")) {
    seuStatus = "pago";
  } else if (suasCobrancas.some((st) => st === "pago")) {
    seuStatus = "parcial";
  }

  const metricasCalculadas = {
    totalCasa,
    contasQtd: contasGeradasQtd,
    suaParte,
    seuStatus,
    totalPagas,
    totalCobrancas,
  };

  dadosCiclosCarregados = novosDadosCiclos;

  // Atualiza cache em sessionStorage para renderizar em 0ms no próximo acesso
  const novoCacheJson = JSON.stringify({
    dadosCiclosCarregados: novosDadosCiclos,
    metricas: metricasCalculadas,
    contadores: { totalCobrancas, totalPendentes, totalPagas },
    banner: { cobrancaPendenteEu, totalPendenteEu }
  });

  const dadosMudaram = !temCache || dadosEmCache !== novoCacheJson;
  sessionStorage.setItem(cacheKey, novoCacheJson);

  if (dadosMudaram) {
    atualizarMetricas(metricasCalculadas);
    atualizarContadoresFiltros(totalCobrancas, totalPendentes, totalPagas);
    atualizarBannerPessoal(cobrancaPendenteEu, totalPendenteEu);
    atualizarAlertasVencimento(novosDadosCiclos, mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, totalCasa);
    renderizarCiclosNaTela(!temCache);
  }
}

function atualizarContadoresFiltros(total, pendentes, pagos) {
  const elTodos = document.getElementById("cont-filtro-todos");
  const elPend = document.getElementById("cont-filtro-pendentes");
  const elPag = document.getElementById("cont-filtro-pagos");
  if (elTodos) elTodos.textContent = total;
  if (elPend) elPend.textContent = pendentes;
  if (elPag) elPag.textContent = pagos;
}

function calcularStatusVencimento(cobranca, conta, mesReferencia) {
  if (cobranca.status === "pago") {
    return { texto: "Pago", classe: "pago" };
  }

  if (!conta || !conta.dia_vencimento || !mesReferencia) {
    return { texto: "Pendente", classe: "pendente" };
  }

  const partes = mesReferencia.split("-");
  const ano = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const diaVenc = parseInt(conta.dia_vencimento, 10);

  const hoje = new Date();
  const dataHojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
  const dataVencZero = new Date(ano, mes - 1, diaVenc, 0, 0, 0);
  const diffDias = Math.round((dataVencZero - dataHojeZero) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) {
    return { texto: `Vencida (${diaVenc}/${String(mes).padStart(2, "0")})`, classe: "vencida" };
  }
  if (diffDias === 0) {
    return { texto: "Vence hoje!", classe: "vence-hoje" };
  }
  if (diffDias === 1) {
    return { texto: "Vence amanhã", classe: "vence-hoje" };
  }

  return { texto: `Pendente (${diaVenc}/${String(mes).padStart(2, "0")})`, classe: "pendente" };
}

function atualizarAlertasVencimento(dadosCiclos, mesReferencia) {
  const container = document.getElementById("container-alertas-vencimento");
  if (!container) return;

  if (!dadosCiclos || dadosCiclos.length === 0) {
    container.innerHTML = "";
    return;
  }

  const hoje = new Date();
  const dataHojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);

  const partes = (mesReferencia || "").split("-");
  const ano = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);

  let qtdVencidas = 0;
  let qtdVenceHoje = 0;
  let qtdVenceAmanha = 0;
  let nomesContasVencidas = new Set();
  let nomesContasHoje = new Set();

  for (const { conta, cobrancas } of dadosCiclos) {
    if (!conta || !conta.dia_vencimento) continue;
    const diaVenc = parseInt(conta.dia_vencimento, 10);
    const dataVencZero = new Date(ano, mes - 1, diaVenc, 0, 0, 0);
    const diffDias = Math.round((dataVencZero - dataHojeZero) / (1000 * 60 * 60 * 24));

    const pendentes = (cobrancas || []).filter((c) => c.status !== "pago");
    if (pendentes.length > 0) {
      if (diffDias < 0) {
        qtdVencidas += pendentes.length;
        nomesContasVencidas.add(conta.nome);
      } else if (diffDias === 0) {
        qtdVenceHoje += pendentes.length;
        nomesContasHoje.add(conta.nome);
      } else if (diffDias === 1) {
        qtdVenceAmanha += pendentes.length;
      }
    }
  }

  if (qtdVencidas > 0) {
    const listaNomes = Array.from(nomesContasVencidas).slice(0, 2).join(", ");
    container.innerHTML = `
      <div class="card-alerta-vencimento urgente">
        <div class="card-alerta-vencimento-esq">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <strong>Atenção:</strong> ${qtdVencidas} cobrança${qtdVencidas > 1 ? "s vencidas" : " vencida"} (${listaNomes}).
          </div>
        </div>
        <button type="button" class="btn-filtro" style="padding: 4px 10px; font-size: 11px; margin: 0; background: rgba(0,0,0,0.06); border: none; cursor: pointer;" onclick="filtrarCobrancas('pendente')">Ver pendentes</button>
      </div>
    `;
  } else if (qtdVenceHoje > 0) {
    const listaNomes = Array.from(nomesContasHoje).slice(0, 2).join(", ");
    container.innerHTML = `
      <div class="card-alerta-vencimento atencao">
        <div class="card-alerta-vencimento-esq">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <div>
            <strong>Vencendo hoje:</strong> ${listaNomes} (${qtdVenceHoje} pendência${qtdVenceHoje > 1 ? "s" : ""}).
          </div>
        </div>
        <button type="button" class="btn-filtro" style="padding: 4px 10px; font-size: 11px; margin: 0; background: rgba(0,0,0,0.06); border: none; cursor: pointer;" onclick="filtrarCobrancas('pendente')">Ver pendentes</button>
      </div>
    `;
  } else if (qtdVenceAmanha > 0) {
    container.innerHTML = `
      <div class="card-alerta-vencimento atencao">
        <div class="card-alerta-vencimento-esq">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <div>
            <strong>Lembrete:</strong> Há contas vencendo amanhã (${qtdVenceAmanha} pendência${qtdVenceAmanha > 1 ? "s" : ""}).
          </div>
        </div>
        <button type="button" class="btn-filtro" style="padding: 4px 10px; font-size: 11px; margin: 0; background: rgba(0,0,0,0.06); border: none; cursor: pointer;" onclick="filtrarCobrancas('pendente')">Ver pendentes</button>
      </div>
    `;
  } else {
    container.innerHTML = "";
  }
}

async function calcularComparativoMesAnterior(mesReferencia, totalCasaAtual) {
  const badge = document.getElementById("badge-comparativo-mes");
  if (!badge) return;

  if (!totalCasaAtual || totalCasaAtual <= 0) {
    badge.style.display = "none";
    return;
  }

  try {
    const partes = (mesReferencia || "").split("-");
    const ano = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10);
    const dataMesAnterior = new Date(ano, mes - 2, 1);
    const mesAnteriorStr = `${dataMesAnterior.getFullYear()}-${String(dataMesAnterior.getMonth() + 1).padStart(2, "0")}-01`;

    const { data: contasCasa } = await supabaseClient
      .from("contas_fixas")
      .select("id")
      .eq("casa_id", casaId);

    if (!contasCasa || contasCasa.length === 0) {
      badge.style.display = "none";
      return;
    }

    const contaIds = contasCasa.map((c) => c.id);
    const { data: ciclosAnteriores } = await supabaseClient
      .from("ciclos_cobranca")
      .select("valor_total")
      .in("conta_fixa_id", contaIds)
      .eq("mes_referencia", mesAnteriorStr);

    const totalMesAnterior = (ciclosAnteriores || []).reduce((acc, c) => acc + Number(c.valor_total || 0), 0);

    if (totalMesAnterior > 0) {
      const diff = totalCasaAtual - totalMesAnterior;
      const pct = Math.round((Math.abs(diff) / totalMesAnterior) * 100);

      badge.style.display = "inline-flex";
      if (diff > 0) {
        badge.className = "badge-comparativo-mes maior";
        badge.innerHTML = `↑ +${pct}% vs mês ant.`;
        badge.title = `Aumento de ${formatarMoeda(diff)} em relação ao mês anterior (${formatarMoeda(totalMesAnterior)})`;
      } else if (diff < 0) {
        badge.className = "badge-comparativo-mes menor";
        badge.innerHTML = `↓ -${pct}% vs mês ant.`;
        badge.title = `Economia de ${formatarMoeda(Math.abs(diff))} em relação ao mês anterior (${formatarMoeda(totalMesAnterior)})`;
      } else {
        badge.className = "badge-comparativo-mes igual";
        badge.innerHTML = `= 0% vs mês ant.`;
        badge.title = `Mesmo total do mês anterior (${formatarMoeda(totalMesAnterior)})`;
      }
    } else {
      badge.style.display = "none";
    }
  } catch (err) {
    console.warn("Erro ao calcular comparativo do mês:", err);
    badge.style.display = "none";
  }
}

function renderizarCiclosNaTela(animar = false) {
  const container = document.getElementById("lista-ciclos");
  if (!container) return;

  if (!dadosCiclosCarregados || dadosCiclosCarregados.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhuma cobrança ativa neste mês.</p>`;
    return;
  }

  const ehAdmin = papelUsuarioAtual === "admin";
  let html = "";
  let totalExibidas = 0;

  for (const { conta, ciclo, cobrancas, mesReferencia } of dadosCiclosCarregados) {
    // Aplica filtro por status
    const listaFiltrada = cobrancas.filter((c) => {
      if (filtroAtual === "pendente") return c.status !== "pago";
      if (filtroAtual === "pago") return c.status === "pago";
      return true; // 'todos'
    });

    // Se o filtro atual não encontrou cobranças nesta conta, não desenha o cabeçalho dela
    if (listaFiltrada.length === 0) continue;

    totalExibidas += listaFiltrada.length;

    const badgeIndividual = (conta.forma_divisao === "individual")
      ? `<span class="badge neutro" style="font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px;">Exclusiva</span>`
      : "";

    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--cor-borda);">
        <h3 style="margin: 0; font-size: 15px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
          <span>${conta.nome} — ${formatarMoeda(ciclo.valor_total)}</span>
          ${badgeIndividual}
        </h3>
        ${
          ehAdmin
            ? `
          <button type="button" class="secundario pequeno" style="font-size: 11px; padding: 3px 8px; width: auto; margin: 0 !important;" onclick="ajustarValorCiclo('${ciclo.id}', '${encodeURIComponent(conta.nome)}', ${ciclo.valor_total}, '${conta.id}')" title="Ajustar valor da fatura este mês">
            Ajustar valor
          </button>
        `
            : ""
        }
      </div>
    `;

    html += listaFiltrada
      .map((c) => {
        const isEu = c.usuario_id === usuarioAtualId;
        const statusInfo = calcularStatusVencimento(c, conta, mesReferencia);

        return `
          <div class="linha">
            <div>
              <strong>${c.profiles ? c.profiles.nome : "Morador"}${isEu ? " (você)" : ""}</strong><br/>
              <span class="texto-suave">${formatarMoeda(c.valor)}</span>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
              <span class="badge ${statusInfo.classe}">${statusInfo.texto}</span>
              <div class="acoes-linha" style="justify-content:flex-end;">
                <button class="btn-icone ${c.status === 'pago' ? 'btn-icone-pix-pago' : 'btn-icone-pix-pendente'}" onclick="abrirModalPix('${c.id}')" title="${c.status === 'pago' ? 'Pix pago (ver dados)' : 'Pix pendente (ver QR Code e pagar)'}" aria-label="Pix">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                    <path d="M7 7h.01"></path>
                    <path d="M17 7h.01"></path>
                    <path d="M7 17h.01"></path>
                    <path d="M17 17h.01"></path>
                  </svg>
                </button>
                <button class="btn-icone btn-icone-whatsapp" onclick="enviarCobrancaWhatsApp('${c.id}', '${conta.nome}', ${c.status === 'pago'})" title="${c.status === 'pago' ? 'Avisar recebimento no WhatsApp' : 'Pedir e cobrar no WhatsApp'}" aria-label="WhatsApp">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  if (totalExibidas === 0) {
    if (filtroAtual === "pendente") {
      container.innerHTML = `
        <div class="estado-vazio">
          <div class="estado-vazio-icone sucesso">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h4>Tudo pago por aqui!</h4>
          <p>Nenhuma conta pendente para este mês. Todas as cobranças foram quitadas.</p>
        </div>
      `;
    } else if (filtroAtual === "pago") {
      container.innerHTML = `
        <div class="estado-vazio">
          <div class="estado-vazio-icone neutro">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <h4>Nenhum pagamento registrado</h4>
          <p>Ainda não há pagamentos confirmados neste mês. As cobranças pendentes estão aguardando acerto.</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="estado-vazio">
          <div class="estado-vazio-icone neutro">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h4>Nenhuma cobrança encontrada</h4>
          <p>Não há lançamentos de despesas registrados para este mês.</p>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = html;
  if (animar && window.Animacoes) {
    window.Animacoes.animarListaLinhas("#lista-ciclos .linha");
  }
}

function atualizarMetricas({ totalCasa, contasQtd, suaParte, seuStatus, totalPagas, totalCobrancas }) {
  const elTotalCasa = document.getElementById("metrica-total-casa");
  const elSuaParte = document.getElementById("metrica-sua-parte");
  const elProgressoQtd = document.getElementById("metrica-progresso-qtd");

  if (window.Animacoes) {
    window.Animacoes.animarNumeroMoeda(elTotalCasa, totalCasa);
    window.Animacoes.animarNumeroMoeda(elSuaParte, suaParte);
    window.Animacoes.animarNumeroFracionario(elProgressoQtd, totalPagas, totalCobrancas);
  } else {
    if (elTotalCasa) elTotalCasa.textContent = formatarMoeda(totalCasa);
    if (elSuaParte) elSuaParte.textContent = formatarMoeda(suaParte);
    if (elProgressoQtd) elProgressoQtd.textContent = `${totalPagas} / ${totalCobrancas}`;
  }

  const elContasQtd = document.getElementById("metrica-contas-qtd");
  if (elContasQtd) {
    elContasQtd.textContent = `${contasQtd} conta${contasQtd === 1 ? "" : "s"} gerada${contasQtd === 1 ? "" : "s"}`;
  }

  const statusEl = document.getElementById("metrica-seu-status");
  if (statusEl) {
    if (seuStatus === "pago") {
      statusEl.innerHTML = `<span class="badge pago">Tudo Pago</span>`;
    } else if (seuStatus === "parcial") {
      statusEl.innerHTML = `<span class="badge pendente">Parcial</span>`;
    } else {
      statusEl.innerHTML = `<span class="badge pendente">Pendente</span>`;
    }
  }

  const pct = totalCobrancas > 0 ? Math.round((totalPagas / totalCobrancas) * 100) : 0;
  const barra = document.getElementById("metrica-barra-progresso");
  if (barra) {
    if (window.Animacoes) {
      window.Animacoes.animarBarraProgresso(barra, pct);
    } else {
      barra.style.transform = `scaleX(${pct / 100})`;
    }
    barra.style.background = pct === 100 ? "var(--cor-sucesso)" : "var(--cor-destaque)";
  }
}

function textoStatus(status) {
  return { pago: "Pago", pendente: "Pendente", atrasado: "Atrasado" }[status] || status;
}

function configurarAcoesDashboard() {
  const btnResumo = document.getElementById("btn-resumo-grupo");
  if (btnResumo) {
    btnResumo.onclick = enviarResumoGrupoWhatsApp;
  }

  const btnExportar = document.getElementById("btn-exportar-relatorio");
  if (btnExportar) {
    btnExportar.onclick = exportarRelatorioMes;
  }

  const btnGerar = document.getElementById("btn-gerar-ciclo");
  if (btnGerar) {
    btnGerar.onclick = async () => {
      btnGerar.disabled = true;
      mostrarToast("Sincronizando cobranças...");

      const mesReferencia = primeiroDiaDoMes();
      const { data: contas } = await supabaseClient
        .from("contas_fixas")
        .select("*")
        .eq("casa_id", casaId)
        .eq("ativa", true);

      const mesRefYYYYMM = mesReferencia.slice(0, 7);
      const contasDoMes = (contas || []).filter((c) => {
        if (!c.mes_inicio) return true;
        return mesRefYYYYMM >= c.mes_inicio.slice(0, 7);
      });

      await garantirCobrancasDoMes(mesReferencia, contasDoMes, true);
      limparCacheDashboard();
      mostrarToast("Cobranças sincronizadas com sucesso!");
      await carregarCiclosDoMes();
      btnGerar.disabled = false;
    };
  }
}

function limparCacheDashboard() {
  try {
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith("cache_dash_")) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {}
}

async function garantirCobrancasDoMes(mesReferencia, contas, forcarSincronizacao = false) {
  const { data: membros } = await supabaseClient
    .from("membros_casa")
    .select("usuario_id")
    .eq("casa_id", casaId);

  if (!membros || membros.length === 0) return;

  for (const conta of contas || []) {
    let { data: ciclo } = await supabaseClient
      .from("ciclos_cobranca")
      .select("id, valor_total")
      .eq("conta_fixa_id", conta.id)
      .eq("mes_referencia", mesReferencia)
      .maybeSingle();

    if (!ciclo) {
      const valorConta = Number(conta.valor_padrao || 0);
      const { data: novoCiclo, error } = await supabaseClient
        .from("ciclos_cobranca")
        .insert({
          conta_fixa_id: conta.id,
          mes_referencia: mesReferencia,
          valor_total: valorConta,
        })
        .select()
        .single();

      if (error || !novoCiclo) continue;
      ciclo = novoCiclo;
    }

    const { data: cobrancas } = await supabaseClient
      .from("cobrancas_individuais")
      .select("id, usuario_id, status, valor")
      .eq("ciclo_id", ciclo.id);

    const cobrancasExistentes = cobrancas || [];

    // CASO 1: CONTA ESPECÍFICA PARA UM MORADOR (INDIVIDUAL)
    if (conta.forma_divisao === "individual" && conta.morador_especifico_id) {
      const moradorAlvoId = conta.morador_especifico_id;
      const valorIndividual = Number(Number(ciclo.valor_total).toFixed(2));

      // Remove eventuais cobranças pendentes de outros moradores para esta conta individual
      for (const cobranca of cobrancasExistentes) {
        if (cobranca.usuario_id !== moradorAlvoId && cobranca.status !== "pago") {
          await supabaseClient
            .from("cobrancas_individuais")
            .delete()
            .eq("id", cobranca.id);
        }
      }

      const cobrancaAlvo = cobrancasExistentes.find((c) => c.usuario_id === moradorAlvoId);
      if (cobrancaAlvo) {
        if (cobrancaAlvo.status !== "pago" && (Number(cobrancaAlvo.valor) !== valorIndividual || forcarSincronizacao)) {
          await supabaseClient
            .from("cobrancas_individuais")
            .update({ valor: valorIndividual })
            .eq("id", cobrancaAlvo.id);
          await gerarPixParaCobranca(cobrancaAlvo.id, valorIndividual, conta.nome);
        }
      } else {
        const { data: nova } = await supabaseClient
          .from("cobrancas_individuais")
          .insert({
            ciclo_id: ciclo.id,
            usuario_id: moradorAlvoId,
            valor: valorIndividual,
            status: "pendente",
          })
          .select()
          .single();

        if (nova) {
          await gerarPixParaCobranca(nova.id, valorIndividual, conta.nome);
        }
      }
    } else {
      // CASO 2: DIVISÃO IGUAL ENTRE TODOS OS MEMBROS
      const usuariosComCobranca = new Set(cobrancasExistentes.map((c) => c.usuario_id));
      const precisaSincronizar =
        cobrancasExistentes.length === 0 ||
        membros.some((m) => !usuariosComCobranca.has(m.usuario_id)) ||
        forcarSincronizacao;

      if (precisaSincronizar) {
        const n = membros.length;
        const totalCentavos = Math.round(Number(ciclo.valor_total) * 100);
        const centavosPorPessoa = Math.floor(totalCentavos / n);
        let sobraCentavos = totalCentavos % n;

        for (const membro of membros) {
          const centavosDeste = centavosPorPessoa + (sobraCentavos > 0 ? 1 : 0);
          if (sobraCentavos > 0) sobraCentavos--;
          const valorPorPessoa = Number((centavosDeste / 100).toFixed(2));

          const cobrancaAtual = cobrancasExistentes.find((c) => c.usuario_id === membro.usuario_id);

          if (cobrancaAtual) {
            if (cobrancaAtual.status !== "pago") {
              await supabaseClient
                .from("cobrancas_individuais")
                .update({ valor: valorPorPessoa })
                .eq("id", cobrancaAtual.id);
              await gerarPixParaCobranca(cobrancaAtual.id, valorPorPessoa, conta.nome);
            }
          } else {
            const { data: nova } = await supabaseClient
              .from("cobrancas_individuais")
              .insert({
                ciclo_id: ciclo.id,
                usuario_id: membro.usuario_id,
                valor: valorPorPessoa,
                status: "pendente",
              })
              .select()
              .single();

            if (nova) {
              await gerarPixParaCobranca(nova.id, valorPorPessoa, conta.nome);
            }
          }
        }
      }
    }
  }
}

async function ajustarValorCiclo(cicloId, nomeContaEnc, valorAtual, contaId = null) {
  if (papelUsuarioAtual !== "admin") {
    mostrarToast("Apenas o administrador pode ajustar valores de faturas.", "alerta");
    return;
  }

  const nomeConta = decodeURIComponent(nomeContaEnc);

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
      <h3>Ajustar valor: ${nomeConta}</h3>
      <p style="margin-bottom: 12px;">Altere o valor desta fatura no mês. A divisão será recalculada automaticamente.</p>
      <div style="margin-bottom: 16px; text-align: left;">
        <label for="input-ajuste-valor" style="margin-top: 0;">Valor total da fatura (R$)</label>
        <input type="number" id="input-ajuste-valor" step="0.01" min="0" value="${valorAtual}" style="font-size: 16px; font-weight: 700;" />
      </div>
      <div class="modal-botoes-grid">
        <button type="button" class="secundario" id="btn-ajuste-cancelar">Cancelar</button>
        <button type="button" id="btn-ajuste-salvar">Salvar e Dividir</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const fechar = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) fechar();
  });

  document.getElementById("btn-ajuste-cancelar").addEventListener("click", fechar);

  document.getElementById("btn-ajuste-salvar").addEventListener("click", async () => {
    const inputVal = parseFloat(document.getElementById("input-ajuste-valor").value);
    if (isNaN(inputVal) || inputVal < 0) {
      mostrarToast("Informe um valor válido.", "alerta");
      return;
    }

    fechar();
    mostrarToast("Recalculando divisões...");

    await supabaseClient
      .from("ciclos_cobranca")
      .update({ valor_total: inputVal })
      .eq("id", cicloId);

    // Identifica se a conta deste ciclo é individual ou dividida entre todos
    let contaAssociada = null;
    if (contaId) {
      const { data: c } = await supabaseClient
        .from("contas_fixas")
        .select("*")
        .eq("id", contaId)
        .maybeSingle();
      contaAssociada = c;
    } else {
      const { data: cicloInfo } = await supabaseClient
        .from("ciclos_cobranca")
        .select("conta_fixa_id")
        .eq("id", cicloId)
        .maybeSingle();
      if (cicloInfo?.conta_fixa_id) {
        const { data: c } = await supabaseClient
          .from("contas_fixas")
          .select("*")
          .eq("id", cicloInfo.conta_fixa_id)
          .maybeSingle();
        contaAssociada = c;
      }
    }

    const ehIndividual = contaAssociada?.forma_divisao === "individual" && contaAssociada?.morador_especifico_id;

    if (ehIndividual) {
      const moradorAlvoId = contaAssociada.morador_especifico_id;
      const { data: cobrancas } = await supabaseClient
        .from("cobrancas_individuais")
        .select("id, usuario_id, status")
        .eq("ciclo_id", cicloId);

      const cobrancaAlvo = (cobrancas || []).find((c) => c.usuario_id === moradorAlvoId);
      if (cobrancaAlvo && cobrancaAlvo.status !== "pago") {
        await supabaseClient
          .from("cobrancas_individuais")
          .update({ valor: inputVal })
          .eq("id", cobrancaAlvo.id);
        await gerarPixParaCobranca(cobrancaAlvo.id, inputVal, nomeConta);
      } else if (!cobrancaAlvo) {
        const { data: nova } = await supabaseClient
          .from("cobrancas_individuais")
          .insert({
            ciclo_id: cicloId,
            usuario_id: moradorAlvoId,
            valor: inputVal,
            status: "pendente",
          })
          .select()
          .single();
        if (nova) {
          await gerarPixParaCobranca(nova.id, inputVal, nomeConta);
        }
      }
    } else {
      const { data: membros } = await supabaseClient
        .from("membros_casa")
        .select("usuario_id")
        .eq("casa_id", casaId);

      if (membros && membros.length > 0) {
        const { data: cobrancas } = await supabaseClient
          .from("cobrancas_individuais")
          .select("id, usuario_id, status")
          .eq("ciclo_id", cicloId);

        const n = membros.length;
        const totalCentavos = Math.round(inputVal * 100);
        const centavosPorPessoa = Math.floor(totalCentavos / n);
        let sobraCentavos = totalCentavos % n;

        for (const membro of membros) {
          const centavosDeste = centavosPorPessoa + (sobraCentavos > 0 ? 1 : 0);
          if (sobraCentavos > 0) sobraCentavos--;
          const valorPorPessoa = Number((centavosDeste / 100).toFixed(2));

          const cobranca = (cobrancas || []).find((c) => c.usuario_id === membro.usuario_id);
          if (cobranca && cobranca.status !== "pago") {
            await supabaseClient
              .from("cobrancas_individuais")
              .update({ valor: valorPorPessoa })
              .eq("id", cobranca.id);
            await gerarPixParaCobranca(cobranca.id, valorPorPessoa, nomeConta);
          }
        }
      }
    }

    limparCacheDashboard();
    mostrarToast(`Valor de "${nomeConta}" ajustado com sucesso!`);
    await carregarCiclosDoMes();
  });
}

async function gerarPixParaCobranca(cobrancaId, valor, descricao) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("gerar-cobranca-pix", {
      body: { cobrancaId, valor, descricao },
    });
    if (error) throw error;

    await supabaseClient
      .from("cobrancas_individuais")
      .update({
        pix_qrcode: data.qrcode_base64 || null,
        pix_copia_cola: data.copia_cola || null,
        pix_txid: data.txid || null,
      })
      .eq("id", cobrancaId);
  } catch (e) {
    console.warn("Não foi possível gerar o Pix:", e.message);
  }
}

async function abrirModalPix(cobrancaId) {
  const { data: cobranca } = await supabaseClient
    .from("cobrancas_individuais")
    .select("*, profiles ( nome, telefone )")
    .eq("id", cobrancaId)
    .single();

  if (!cobranca) return;

  const conteudo = document.getElementById("conteudo-modal-pix");
  const ehAdmin = papelUsuarioAtual === "admin";

  let chaveDestino = null;
  let tipoChaveDestino = "telefone";
  let nomeBeneficiario = "Rachaê";

  // 1. Tenta buscar chave Pix oficial configurada na casa
  try {
    const { data: casaData } = await supabaseClient
      .from("casas")
      .select("nome, chave_pix, tipo_chave_pix")
      .eq("id", casaId)
      .maybeSingle();

    if (casaData) {
      if (casaData.nome) nomeBeneficiario = casaData.nome;
      if (casaData.chave_pix) {
        chaveDestino = casaData.chave_pix;
        tipoChaveDestino = casaData.tipo_chave_pix || "telefone";
      }
    }
  } catch (e) {
    console.warn("Erro ao buscar chave Pix da casa:", e);
  }

  // 2. Se a casa não tiver chave Pix própria, busca dados do perfil do Administrador
  if (!chaveDestino) {
    try {
      const { data: adminMembro } = await supabaseClient
        .from("membros_casa")
        .select("profiles ( nome, telefone )")
        .eq("casa_id", casaId)
        .eq("papel", "admin")
        .limit(1)
        .maybeSingle();

      if (adminMembro && adminMembro.profiles) {
        if (!nomeBeneficiario || nomeBeneficiario === "Rachaê") {
          nomeBeneficiario = adminMembro.profiles.nome || "Rachaê";
        }
        if (adminMembro.profiles.telefone) {
          chaveDestino = adminMembro.profiles.telefone;
          tipoChaveDestino = "telefone";
        }
      }
    } catch (e) {
      console.warn("Erro ao carregar dados do admin para o Pix:", e);
    }
  }

  // 3. Gera código Pix Copia e Cola Oficial (BR Code padrão BACEN / EMV)
  let payloadPix = cobranca.pix_copia_cola;
  if (!payloadPix && chaveDestino && window.gerarPayloadPix) {
    payloadPix = window.gerarPayloadPix({
      chave: chaveDestino,
      tipo: tipoChaveDestino,
      nome: nomeBeneficiario,
      cidade: "BRASIL",
      valor: Number(cobranca.valor),
      identificador: `RACHAE${cobranca.id.replace(/-/g, "").substring(0, 8).toUpperCase()}`,
    });
  }

  // 4. Gera imagem de QR Code
  let qrCodeImg = cobranca.pix_qrcode;
  if (!qrCodeImg && payloadPix) {
    qrCodeImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payloadPix)}`;
  }

  let htmlPix = `<div class="qr-box">`;

  if (qrCodeImg) {
    htmlPix += `
      <div style="background:#ffffff; padding:10px; border-radius:10px; border:1px solid var(--cor-borda); display:inline-block; margin-bottom:10px;">
        <img src="${qrCodeImg}" alt="QR Code Pix" style="width:160px; height:160px; display:block;" />
      </div>
    `;
  }

  htmlPix += `
    <p class="texto-suave" style="margin-top:2px; font-size:13px;">Valor da parcela: <strong style="font-size:17px; color:var(--cor-texto);">${formatarMoeda(cobranca.valor)}</strong></p>
    <p class="texto-suave" style="margin:2px 0 12px; font-size:12px;">Status: <span class="badge ${cobranca.status}">${textoStatus(cobranca.status)}</span></p>
  `;

  if (payloadPix) {
    htmlPix += `
      <div style="background:var(--cor-fundo); border:1px solid var(--cor-borda); border-radius:8px; padding:10px; margin-bottom:10px; text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase;">Pix Copia e Cola Oficial</span>
          <span style="font-size:11px; color:var(--cor-destaque); font-weight:600;">Com valor exato</span>
        </div>
        <div class="copia-cola" style="max-height:50px; overflow-y:auto; word-break:break-all; font-size:11px;">${payloadPix}</div>
        <button type="button" class="secundario pequeno" style="width:100%; margin-top:8px !important;" onclick="copiarPix('${payloadPix}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copiar Código Pix
        </button>
      </div>
    `;
  } else if (chaveDestino) {
    htmlPix += `
      <div style="background:var(--cor-fundo); border:1px solid var(--cor-borda); border-radius:8px; padding:10px; margin-bottom:10px; text-align:left;">
        <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase; display:block;">Chave Pix (${nomeBeneficiario})</span>
        <div style="font-size:15px; font-weight:700; color:var(--cor-texto); margin:4px 0 6px;">${chaveDestino}</div>
        <button type="button" class="secundario pequeno" style="width:100%; margin:0 !important;" onclick="copiarPix('${chaveDestino}')">
          Copiar Chave Pix
        </button>
      </div>
    `;
  }

  htmlPix += `
    <button class="pequeno btn-whatsapp" style="margin-top:6px; width:100%;" onclick="enviarCobrancaWhatsApp('${cobranca.id}', null, ${cobranca.status === 'pago'})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      ${cobranca.status === "pago" ? "Enviar confirmação no WhatsApp" : "Enviar cobrança no WhatsApp"}
    </button>
  `;

  if (ehAdmin) {
    if (cobranca.status !== "pago") {
      htmlPix += `
        <button class="pequeno sucesso-btn" style="margin-top:8px; width:100%;" onclick="confirmarPagamentoSimulado('${cobranca.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Confirmar Pagamento Recebido
        </button>
      `;
    } else {
      htmlPix += `
        <button class="pequeno secundario" style="margin-top:8px; width:100%;" onclick="reverterParaPendente('${cobranca.id}')">
          Reverter para Pendente
        </button>
      `;
    }
  }

  htmlPix += `</div>`;
  conteudo.innerHTML = htmlPix;

  const modalPixEl = document.getElementById("modal-pix");
  const cardModalPixEl = document.getElementById("card-modal-pix");
  if (window.Animacoes) {
    window.Animacoes.animarAberturaModal(modalPixEl, cardModalPixEl);
  } else {
    modalPixEl.style.display = "flex";
  }
}

async function enviarCobrancaWhatsApp(cobrancaId, nomeContaOpcional = null, jaPago = false) {
  const { data: cobranca } = await supabaseClient
    .from("cobrancas_individuais")
    .select("*, profiles ( nome, telefone )")
    .eq("id", cobrancaId)
    .single();

  if (!cobranca) return;

  const nomeMorador = cobranca.profiles ? cobranca.profiles.nome : "Morador";
  const mesFormatado = `${MESES[dataSelecionada.getMonth()]}/${dataSelecionada.getFullYear()}`;
  const valorFormatado = formatarMoeda(cobranca.valor);
  const nomeConta = nomeContaOpcional || "da casa";

  const estaPago = jaPago || cobranca.status === "pago";

  let texto = "";
  if (estaPago) {
    texto = `*Rachaê - Pagamento Confirmado* ✅\n`;
    texto += `Olá, *${nomeMorador}*!\n\n`;
    texto += `Confirmamos o recebimento do seu pagamento de *${valorFormatado}* referente à conta *${nomeConta}* (${mesFormatado}).\n\n`;
    texto += `Tudo certo por aqui, pagamento registrado com sucesso. Muito obrigado!`;
  } else {
    // 1. Descobrir dia de vencimento da conta
    let diaVencimento = null;
    if (dadosCiclosCarregados) {
      for (const d of dadosCiclosCarregados) {
        if (d.cobrancas && d.cobrancas.some((c) => c.id === cobrancaId)) {
          diaVencimento = d.conta?.dia_vencimento;
          break;
        }
      }
    }

    // 2. Buscar chave Pix oficial da casa
    let chavePixCasa = null;
    let tipoChavePixCasa = "Pix";
    try {
      const { data: casa } = await supabaseClient
        .from("casas")
        .select("chave_pix, tipo_chave_pix")
        .eq("id", casaId)
        .maybeSingle();

      if (casa?.chave_pix) {
        chavePixCasa = casa.chave_pix;
        tipoChavePixCasa = casa.tipo_chave_pix || "Pix";
      }
    } catch (e) {}

    const vencTexto = diaVencimento
      ? `📅 *Vencimento:* ${String(diaVencimento).padStart(2, "0")}/${String(dataSelecionada.getMonth() + 1).padStart(2, "0")}/${dataSelecionada.getFullYear()}\n`
      : "";

    texto = `*Rachaê - Cobrança da Casa* 🏠\n`;
    texto += `Olá, *${nomeMorador}*!\n\n`;
    texto += `Passando para lembrar da sua parte da conta *${nomeConta}* (${mesFormatado}):\n`;
    texto += `💰 *Valor:* *${valorFormatado}*\n`;
    if (vencTexto) texto += vencTexto;
    texto += `\n`;

    if (chavePixCasa) {
      texto += `🔑 *Chave Pix da Casa (${tipoChavePixCasa}):*\n\`\`\`${chavePixCasa}\`\`\`\n\n`;
    }

    if (cobranca.pix_copia_cola) {
      texto += `📋 *Código Pix Copia e Cola:*\n\`\`\`${cobranca.pix_copia_cola}\`\`\`\n\n`;
    }

    texto += `Assim que fizer o pagamento pelo app do seu banco, me avise ou envie o comprovante por aqui. Obrigado!`;
  }

  const tel = cobranca.profiles && cobranca.profiles.telefone ? cobranca.profiles.telefone.replace(/\D/g, "") : "";
  const waNum = (tel.length === 10 || tel.length === 11) ? "55" + tel : tel;

  const url = waNum
    ? `https://wa.me/${waNum}?text=${encodeURIComponent(texto)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;

  window.open(url, "_blank");
}

function exportarRelatorioMes() {
  const nomeCasaEl = document.getElementById("dash-nome-casa");
  const nomeCasa = nomeCasaEl ? nomeCasaEl.textContent.trim() : "Minha Casa";
  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();

  const printCasa = document.getElementById("print-info-casa");
  const printMes = document.getElementById("print-info-mes");
  const printEmissao = document.getElementById("print-info-emissao");

  if (printCasa) printCasa.textContent = `Casa: ${nomeCasa}`;
  if (printMes) printMes.textContent = `${nomeMes} de ${ano}`;
  if (printEmissao) {
    const hoje = new Date();
    printEmissao.textContent = `Emitido em ${hoje.toLocaleDateString("pt-BR")} às ${hoje.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }

  // Define filtro para "todos" para exibir o relatório completo com todas as cobranças
  const btnTodos = document.getElementById("filtro-btn-todos");
  if (btnTodos && filtroAtual !== "todos") {
    btnTodos.click();
  }

  const originalTitle = document.title;
  document.title = `Rachaê - Relatório ${nomeMes} ${ano} - ${nomeCasa}`;

  window.print();

  setTimeout(() => {
    document.title = originalTitle;
  }, 1000);
}

async function confirmarPagamentoSimulado(cobrancaId) {
  const isMock = typeof ehModoMock !== "undefined" ? ehModoMock : false;
  if (isMock && window.RachaFixoMock) {
    await window.RachaFixoMock.simularPagamento(cobrancaId);
  } else {
    await supabaseClient
      .from("cobrancas_individuais")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", cobrancaId);
  }
  fecharModalPix();
  limparCacheDashboard();
  mostrarToast("Pagamento registrado com sucesso!");
  await carregarCiclosDoMes();
}

async function reverterParaPendente(cobrancaId) {
  const isMock = typeof ehModoMock !== "undefined" ? ehModoMock : false;
  if (isMock && window.RachaFixoMock) {
    await window.RachaFixoMock.reverterPagamento(cobrancaId);
  } else {
    await supabaseClient
      .from("cobrancas_individuais")
      .update({ status: "pendente", pago_em: null })
      .eq("id", cobrancaId);
  }
  fecharModalPix();
  limparCacheDashboard();
  mostrarToast("Cobrança revertida para pendente.");
  await carregarCiclosDoMes();
}

async function enviarResumoGrupoWhatsApp() {
  const mesReferencia = primeiroDiaDoMes();
  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();

  const { data: casa } = await supabaseClient
    .from("casas")
    .select("nome")
    .eq("id", casaId)
    .single();

  const nomeCasa = casa ? casa.nome : "Nossa Casa";

  const { data: contas } = await supabaseClient
    .from("contas_fixas")
    .select("*")
    .eq("casa_id", casaId)
    .eq("ativa", true);

  if (!contas || contas.length === 0) {
    mostrarToast("Nenhuma conta fixa cadastrada.", "alerta");
    return;
  }

  const mesRefYYYYMM = mesReferencia.slice(0, 7);
  const contasDoMes = contas.filter((c) => {
    if (!c.mes_inicio) return true;
    return mesRefYYYYMM >= c.mes_inicio.slice(0, 7);
  });

  if (contasDoMes.length === 0) {
    mostrarToast("Nenhuma conta ativa para este mês.", "alerta");
    return;
  }

  let totalGeral = 0;
  let linhasContas = [];
  let mapaMoradores = {};

  for (const conta of contasDoMes) {
    const { data: ciclo } = await supabaseClient
      .from("ciclos_cobranca")
      .select("*")
      .eq("conta_fixa_id", conta.id)
      .eq("mes_referencia", mesReferencia)
      .maybeSingle();

    if (!ciclo) continue;

    totalGeral += Number(ciclo.valor_total || 0);
    linhasContas.push(`• ${conta.nome}: ${formatarMoeda(ciclo.valor_total)}`);

    const { data: cobrancas } = await supabaseClient
      .from("cobrancas_individuais")
      .select("*, profiles ( nome )")
      .eq("ciclo_id", ciclo.id);

    for (const c of cobrancas || []) {
      const uId = c.usuario_id;
      const nomeMorador = c.profiles ? c.profiles.nome : "Morador";
      if (!mapaMoradores[uId]) {
        mapaMoradores[uId] = { nome: nomeMorador, total: 0, statusList: [] };
      }
      mapaMoradores[uId].total += Number(c.valor || 0);
      mapaMoradores[uId].statusList.push(c.status);
    }
  }

  if (linhasContas.length === 0) {
    mostrarToast("Cobranças deste mês ainda não foram geradas. Clique em 'Gerar cobranças'.", "alerta");
    return;
  }

  let texto = `*Rachaê - Resumo de ${nomeMes}/${ano}*\n`;
  texto += `Casa: *${nomeCasa}*\n`;
  texto += `Total da Casa: *${formatarMoeda(totalGeral)}*\n\n`;

  texto += `*Contas do Mês:*\n`;
  texto += linhasContas.join("\n") + "\n\n";

  texto += `*Situação dos Moradores:*\n`;
  for (const uId of Object.keys(mapaMoradores)) {
    const m = mapaMoradores[uId];
    const todosPagos = m.statusList.length > 0 && m.statusList.every((st) => st === "pago");
    const statusTexto = todosPagos ? "Tudo Pago" : "Pendente";
    texto += `• ${m.nome}: ${formatarMoeda(m.total)} (${statusTexto})\n`;
  }

  texto += `\nPara pagar via Pix ou ver os códigos copia-e-cola, acesse o Rachaê.`;

  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
  window.open(url, "_blank");
}

function fecharModalPix() {
  const modalPixEl = document.getElementById("modal-pix");
  const cardModalPixEl = document.getElementById("card-modal-pix");
  if (window.Animacoes) {
    window.Animacoes.animarFechamentoModal(modalPixEl, cardModalPixEl);
  } else {
    modalPixEl.style.display = "none";
  }
}

function configurarModalPixEventos() {
  const modalPix = document.getElementById("modal-pix");
  if (modalPix) {
    modalPix.onclick = (e) => {
      if (e.target === modalPix) fecharModalPix();
    };
  }
}

// Fecha modal Pix com a tecla ESC
if (!window._modalPixKeydownBound) {
  window._modalPixKeydownBound = true;
  document.addEventListener("keydown", (e) => {
    const modalPix = document.getElementById("modal-pix");
    if (e.key === "Escape" && modalPix && modalPix.style.display === "flex") {
      fecharModalPix();
    }
  });
}

function copiarPix(codigo) {
  navigator.clipboard.writeText(codigo);
  mostrarToast("Código Pix copiado!");

  if (window.Animacoes) {
    const btnAtivo = document.activeElement;
    if (btnAtivo && btnAtivo.tagName === "BUTTON") {
      window.Animacoes.animarPulseSucesso(btnAtivo);
    }
  }
}

// Exposição explícita para o escopo global (window)
window.inicializarDashboard = inicializarDashboard;
window.filtrarCobrancas = filtrarCobrancas;
window.abrirModalPix = abrirModalPix;
window.fecharModalPix = fecharModalPix;
window.copiarPix = copiarPix;
window.enviarCobrancaWhatsApp = enviarCobrancaWhatsApp;
window.exportarRelatorioMes = exportarRelatorioMes;
window.confirmarPagamentoSimulado = confirmarPagamentoSimulado;
window.reverterParaPendente = reverterParaPendente;
window.ajustarValorCiclo = ajustarValorCiclo;
window.enviarResumoGrupoWhatsApp = enviarResumoGrupoWhatsApp;
window.limparCacheDashboard = limparCacheDashboard;

// Auto-inicializa se a página for carregada diretamente pelo navegador
if (!window.InstantNav || !window.InstantNav.emNavegacao) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.location.pathname.endsWith("dashboard.html") || window.location.pathname.endsWith("/")) {
        inicializarDashboard();
      }
    });
  } else {
    if (window.location.pathname.endsWith("dashboard.html") || window.location.pathname.endsWith("/")) {
      inicializarDashboard();
    }
  }
}
})();
