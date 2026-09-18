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
let filtroMoradorAtual = "todos";
let dadosCiclosCarregados = [];
let dadosMoradoresCasa = [];
let dadosDespesasExtrasCarregadas = [];

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
  configurarRealtimeDashboard();
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

let realtimeChannelDashboard = null;

function configurarRealtimeDashboard() {
  if (!casaId || !window.supabaseClient || typeof window.supabaseClient.channel !== "function") return;

  if (realtimeChannelDashboard) {
    try {
      window.supabaseClient.removeChannel(realtimeChannelDashboard);
    } catch (e) {}
    realtimeChannelDashboard = null;
  }

  try {
    realtimeChannelDashboard = window.supabaseClient
      .channel(`realtime_dash_${casaId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cobrancas_individuais",
        },
        (payload) => {
          limparCacheDashboard();
          carregarCiclosDoMes();

          if (payload.eventType === "UPDATE") {
            const novo = payload.new;
            if (novo.status === "pago") {
              mostrarToast("Uma cobrança foi confirmada como paga!", "sucesso");
            } else if (novo.status === "em_analise") {
              mostrarToast("Novo comprovante enviado para análise!", "alerta");
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contas_fixas",
        },
        () => {
          limparCacheDashboard();
          carregarCiclosDoMes();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "despesas_avulsas",
        },
        () => {
          carregarDespesasExtrasDoMes();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "despesas_avulsas_participantes",
        },
        () => {
          carregarDespesasExtrasDoMes();
        }
      )
      .subscribe();
  } catch (errRealtime) {
    console.warn("Aviso ao conectar canal Realtime:", errRealtime);
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

  const seletorMorador = document.getElementById("filtro-morador");
  if (seletorMorador) {
    seletorMorador.addEventListener("change", () => {
      filtroMoradorAtual = seletorMorador.value || "todos";
      renderizarCiclosNaTela(true);
    });
  }
}

// Preenche o filtro por morador com as pessoas que aparecem nas cobranças do mês
function atualizarOpcoesFiltroMorador() {
  const seletor = document.getElementById("filtro-morador");
  if (!seletor) return;

  const moradoresMap = new Map();
  for (const { cobrancas } of dadosCiclosCarregados) {
    for (const c of cobrancas) {
      if (!c.usuario_id) continue;
      const nome = c.profiles ? c.profiles.nome : "Morador";
      moradoresMap.set(c.usuario_id, nome);
    }
  }

  const valorAtual = seletor.value || "todos";
  const opcoes = Array.from(moradoresMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

  seletor.innerHTML =
    `<option value="todos">Todos os moradores</option>` +
    opcoes.map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}${id === usuarioAtualId ? " (você)" : ""}</option>`).join("");

  // Mantém a seleção anterior se a pessoa ainda estiver na lista deste mês
  if (moradoresMap.has(valorAtual) || valorAtual === "todos") {
    seletor.value = valorAtual;
  } else {
    seletor.value = "todos";
    filtroMoradorAtual = "todos";
  }
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
  await carregarDespesasExtrasDoMes();
  carregarGraficoEvolucao();
}

// Gráfico simples (sem lib externa) com o total arrecadado/gerado nos últimos 6 meses da casa
async function carregarGraficoEvolucao() {
  const container = document.getElementById("grafico-evolucao");
  if (!container || !casaId) return;

  try {
    const { data: contasCasa } = await supabaseClient
      .from("contas_fixas")
      .select("id")
      .eq("casa_id", casaId);

    const idsContas = (contasCasa || []).map((c) => c.id);
    if (idsContas.length === 0) {
      container.innerHTML = `<div style="height: 106px; display: flex; align-items: center; justify-content: center;"><p class="texto-suave" style="font-size: 12.5px; margin: 0;">Sem dados suficientes ainda.</p></div>`;
      return;
    }

    // Monta os últimos 6 meses (incluindo o mês selecionado) no formato YYYY-MM-01
    const mesesJanela = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(dataSelecionada.getFullYear(), dataSelecionada.getMonth() - i, 1);
      mesesJanela.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    }

    const { data: ciclos } = await supabaseClient
      .from("ciclos_cobranca")
      .select("mes_referencia, valor_total")
      .in("conta_fixa_id", idsContas)
      .gte("mes_referencia", mesesJanela[0])
      .lte("mes_referencia", mesesJanela[mesesJanela.length - 1]);

    const totaisPorMes = {};
    mesesJanela.forEach((m) => { totaisPorMes[m] = 0; });
    (ciclos || []).forEach((c) => {
      const chave = c.mes_referencia.slice(0, 10);
      if (chave in totaisPorMes) {
        totaisPorMes[chave] += Number(c.valor_total || 0);
      }
    });

    const valores = mesesJanela.map((m) => totaisPorMes[m]);
    const maiorValor = Math.max(1, ...valores);
    const mesAtualChave = mesesJanela[mesesJanela.length - 1];

    container.innerHTML = `
      <div class="grafico-evolucao-barras">
        ${mesesJanela
          .map((m, idx) => {
            const valor = valores[idx];
            const alturaBarraPx = valor > 0 ? Math.max(8, Math.round((valor / maiorValor) * 58)) : 4;
            const [ano, mes] = m.split("-");
            const nomeMesAbrev = MESES[Number(mes) - 1].slice(0, 3);
            const ehAtual = m === mesAtualChave;
            const valorFormatado = valor > 0
              ? (Math.round(valor * 100) % 100 === 0
                  ? Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                  : Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
              : "—";
            return `
              <div class="grafico-evolucao-coluna">
                <span class="grafico-evolucao-valor">${valorFormatado}</span>
                <div class="grafico-evolucao-barra ${ehAtual ? "mes-atual" : ""}" style="height: ${alturaBarraPx}px;"></div>
                <span class="grafico-evolucao-mes">${nomeMesAbrev}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  } catch (e) {
    console.warn("Erro ao carregar gráfico de evolução:", e);
    container.innerHTML = `<div style="height: 118px; display: flex; align-items: center; justify-content: center;"><p class="texto-suave" style="font-size: 12.5px; margin: 0;">Sem dados para exibir.</p></div>`;
  }
}

// Renderiza a distribuição de despesas por categoria com barras de progresso visuais
function renderizarCategoriasDoMes(dadosCiclos) {
  const card = document.getElementById("card-distribuicao-categorias");
  const container = document.getElementById("lista-categorias-container");
  if (!card || !container) return;

  const temCiclos = Array.isArray(dadosCiclos) && dadosCiclos.length > 0;
  const temExtras = Array.isArray(dadosDespesasExtrasCarregadas) && dadosDespesasExtrasCarregadas.length > 0;

  if (!temCiclos && !temExtras) {
    card.style.display = "none";
    container.innerHTML = "";
    return;
  }

  // Agrupa totais por categoria
  const totais = {};
  let totalGeral = 0;

  if (temCiclos) {
    for (const { conta, ciclo } of dadosCiclos) {
      if (!ciclo || !ciclo.valor_total) continue;
      const cat = (conta && conta.categoria) ? conta.categoria : "outros";
      const valor = Number(ciclo.valor_total || 0);
      totais[cat] = (totais[cat] || 0) + valor;
      totalGeral += valor;
    }
  }

  if (temExtras) {
    for (const extra of dadosDespesasExtrasCarregadas) {
      if (!extra || !extra.valor) continue;
      const cat = extra.categoria || "outros";
      const valor = Number(extra.valor || 0);
      totais[cat] = (totais[cat] || 0) + valor;
      totalGeral += valor;
    }
  }

  const chaves = Object.keys(totais);
  if (chaves.length === 0 || totalGeral <= 0) {
    card.style.display = "none";
    container.innerHTML = "";
    return;
  }

  // Ordena por maior valor
  const ordenado = chaves
    .map((cat) => ({
      categoria: cat,
      valor: totais[cat],
      pct: Math.round((totais[cat] / totalGeral) * 100),
      info: typeof obterCategoriaInfo === "function" ? obterCategoriaInfo(cat) : { label: cat, cor: "#2563eb", fundo: "#dbeafe" },
    }))
    .sort((a, b) => b.valor - a.valor);

  container.innerHTML = ordenado
    .map(
      (item) => `
    <div class="item-categoria-linha">
      <div class="item-categoria-topo">
        <div class="item-categoria-nome">
          <span class="item-categoria-ponto" style="background: ${item.info.cor};"></span>
          <span>${escapeHtml(item.info.label)}</span>
        </div>
        <div class="item-categoria-valores">
          <span class="item-categoria-valor">${formatarMoeda(item.valor)}</span>
          <span class="item-categoria-pct">${item.pct}%</span>
        </div>
      </div>
      <div class="item-categoria-trilho">
        <div class="item-categoria-progresso" style="width: ${item.pct}%; background: ${item.info.cor};"></div>
      </div>
    </div>
  `
    )
    .join("");

  card.style.display = "block";
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
          cacheObj.contadores.totalPagas,
          cacheObj.contadores.totalEmAnalise || 0
        );
        renderizarCategoriasDoMes(cacheObj.dadosCiclosCarregados);
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
    const metricasVazias = { totalCasa: 0, contasQtd: 0, suaParte: 0, seuStatus: "nenhum", totalPagas: 0, totalCobrancas: 0, totalAtrasadas: 0 };
    atualizarMetricas(metricasVazias);
    atualizarContadoresFiltros(0, 0, 0, 0);
    renderizarCategoriasDoMes([]);
    atualizarBannerPessoal(null, 0);
    atualizarAlertasVencimento([], mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, 0);

    sessionStorage.setItem(cacheKey, JSON.stringify({
      dadosCiclosCarregados: [],
      metricas: metricasVazias,
      contadores: { totalCobrancas: 0, totalPendentes: 0, totalPagas: 0, totalEmAnalise: 0 },
      banner: { cobrancaPendenteEu: null, totalPendenteEu: 0 }
    }));
    return;
  }

  // Filtra apenas contas cujo início da cobrança é igual ou anterior ao mês selecionado,
  // e (se for parcelada) que ainda não passaram da última parcela.
  const mesRefYYYYMM = mesReferencia.slice(0, 7);
  const contasDoMes = contas.filter((c) => {
    if (c.mes_inicio && mesRefYYYYMM < c.mes_inicio.slice(0, 7)) return false;
    if (c.parcelado && c.parcelas_total && calcularParcelaAtual(c, mesRefYYYYMM) === null) return false;
    return true;
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
    const metricasVazias = { totalCasa: 0, contasQtd: 0, suaParte: 0, seuStatus: "nenhum", totalPagas: 0, totalCobrancas: 0, totalAtrasadas: 0 };
    atualizarMetricas(metricasVazias);
    atualizarContadoresFiltros(0, 0, 0, 0);
    renderizarCategoriasDoMes([]);
    atualizarBannerPessoal(null, 0);
    atualizarAlertasVencimento([], mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, 0);

    sessionStorage.setItem(cacheKey, JSON.stringify({
      dadosCiclosCarregados: [],
      metricas: metricasVazias,
      contadores: { totalCobrancas: 0, totalPendentes: 0, totalPagas: 0, totalEmAnalise: 0 },
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
  let totalEmAnalise = 0;
  let totalAtrasadas = 0;
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
      } else if (c.status === "em_analise") {
        totalEmAnalise++;
      } else {
        totalPendentes++;
        const statusEfetivoC = obterStatusEfetivo(c, conta, mesReferencia);
        if (statusEfetivoC === "atrasado") {
          totalAtrasadas++;
        }
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
    totalAtrasadas,
  };

  dadosCiclosCarregados = novosDadosCiclos;

  // Atualiza cache em sessionStorage para renderizar em 0ms no próximo acesso
  const novoCacheJson = JSON.stringify({
    dadosCiclosCarregados: novosDadosCiclos,
    metricas: metricasCalculadas,
    contadores: { totalCobrancas, totalPendentes, totalPagas, totalEmAnalise },
    banner: { cobrancaPendenteEu, totalPendenteEu }
  });
  // (totalAtrasadas fica dentro de metricasCalculadas, já incluso no cache acima)

  const dadosMudaram = !temCache || dadosEmCache !== novoCacheJson;
  sessionStorage.setItem(cacheKey, novoCacheJson);

  if (dadosMudaram) {
    atualizarMetricas(metricasCalculadas);
    atualizarContadoresFiltros(totalCobrancas, totalPendentes, totalPagas, totalEmAnalise);
    renderizarCategoriasDoMes(novosDadosCiclos);
    atualizarBannerPessoal(cobrancaPendenteEu, totalPendenteEu);
    atualizarAlertasVencimento(novosDadosCiclos, mesReferencia);
    calcularComparativoMesAnterior(mesReferencia, totalCasa);
    renderizarCiclosNaTela(!temCache);
  }
}

function atualizarContadoresFiltros(total, pendentes, pagos, emAnalise = 0) {
  const elTodos = document.getElementById("cont-filtro-todos");
  const elPend = document.getElementById("cont-filtro-pendentes");
  const elPag = document.getElementById("cont-filtro-pagos");
  const elAnalise = document.getElementById("cont-filtro-analise");
  if (elTodos) elTodos.textContent = total;
  if (elPend) elPend.textContent = pendentes;
  if (elPag) elPag.textContent = pagos;
  if (elAnalise) elAnalise.textContent = emAnalise;
}

// Calcula o status "de verdade" de uma cobrança comparando o dia de
// vencimento da conta com a data de hoje: uma cobrança pendente cujo
// vencimento já passou é tratada como atrasada automaticamente, sem
// precisar que ninguém marque isso manualmente. Retorna só a palavra-chave
// ("pago" | "atrasado" | "pendente"), útil em qualquer lugar que hoje usa
// cobranca.status cru para decidir o que exibir.
function obterStatusEfetivo(cobranca, conta, mesReferencia) {
  if (cobranca.status === "pago") return "pago";
  if (cobranca.status === "em_analise") return "em_analise";
  if (!conta || !conta.dia_vencimento || !mesReferencia) return cobranca.status || "pendente";

  const partes = mesReferencia.split("-");
  const ano = parseInt(partes[0], 10);
  const mes = parseInt(partes[1], 10);
  const diaVenc = parseInt(conta.dia_vencimento, 10);

  const hoje = new Date();
  const dataHojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
  const dataVencZero = new Date(ano, mes - 1, diaVenc, 0, 0, 0);

  return dataVencZero < dataHojeZero ? "atrasado" : "pendente";
}

// Encontra a conta/mês de referência de uma cobrança avulsa (ex.: dentro do
// modal de Pix, que só tem o registro da cobrança) usando a lista de ciclos
// já carregada na tela, pra poder calcular o status efetivo dela também.
function localizarContextoCobranca(cobrancaId) {
  for (const item of dadosCiclosCarregados) {
    const encontrada = (item.cobrancas || []).find((c) => c.id === cobrancaId);
    if (encontrada) {
      return { conta: item.conta, mesReferencia: item.mesReferencia };
    }
  }
  return { conta: null, mesReferencia: null };
}

function calcularStatusVencimento(cobranca, conta, mesReferencia) {
  if (cobranca.status === "pago") {
    return { texto: "Pago", classe: "pago" };
  }
  if (cobranca.status === "em_analise") {
    return { texto: "Em Análise", classe: "em_analise" };
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
    return { texto: "Atrasada", classe: "atrasado" };
  }
  if (diffDias === 0) {
    return { texto: "Vence hoje!", classe: "vence-hoje" };
  }
  if (diffDias === 1) {
    return { texto: "Vence amanhã", classe: "vence-hoje" };
  }

  return { texto: "Pendente", classe: "pendente" };
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
        badge.innerHTML = `↑ +${pct}%`;
        badge.title = `Aumento de ${formatarMoeda(diff)} em relação ao mês anterior (${formatarMoeda(totalMesAnterior)})`;
      } else if (diff < 0) {
        badge.className = "badge-comparativo-mes menor";
        badge.innerHTML = `↓ -${pct}%`;
        badge.title = `Economia de ${formatarMoeda(Math.abs(diff))} em relação ao mês anterior (${formatarMoeda(totalMesAnterior)})`;
      } else {
        badge.className = "badge-comparativo-mes igual";
        badge.innerHTML = `= 0%`;
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

  atualizarOpcoesFiltroMorador();

  if (!dadosCiclosCarregados || dadosCiclosCarregados.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhuma cobrança ativa neste mês.</p>`;
    return;
  }

  const ehAdmin = papelUsuarioAtual === "admin";
  let html = "";
  let totalExibidas = 0;

  // Cor de avatar única por morador dentro desta casa (evita duas
  // pessoas com a mesma cor na lista, mesmo com poucas cores na paleta)
  const todosOsIds = [];
  for (const { cobrancas } of dadosCiclosCarregados) {
    for (const c of cobrancas || []) todosOsIds.push(c.usuario_id);
  }
  const mapaCoresMoradores = atribuirCoresMoradores(todosOsIds);

  for (const { conta, ciclo, cobrancas, mesReferencia } of dadosCiclosCarregados) {
    // Aplica filtro por status
    const listaFiltrada = cobrancas.filter((c) => {
      if (filtroMoradorAtual !== "todos" && c.usuario_id !== filtroMoradorAtual) return false;
      if (filtroAtual === "pendente") return c.status !== "pago" && c.status !== "em_analise";
      if (filtroAtual === "em_analise") return c.status === "em_analise";
      if (filtroAtual === "pago") return c.status === "pago";
      return true; // 'todos'
    });

    // Se o filtro atual não encontrou cobranças nesta conta, não desenha o cabeçalho dela
    if (listaFiltrada.length === 0) continue;

    totalExibidas += listaFiltrada.length;

    const badgeIndividual = (conta.forma_divisao === "individual")
      ? `<span class="badge neutro" style="font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px;">Exclusiva</span>`
      : "";

    const parcelaAtualConta = conta.parcelado && conta.parcelas_total ? calcularParcelaAtual(conta, mesReferencia) : null;
    const badgeParcela = parcelaAtualConta
      ? `<span class="badge" style="font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px; background: #ede9fe; color: #6d28d9; border-color: #ddd6fe;">Parcela ${parcelaAtualConta}/${conta.parcelas_total}</span>`
      : "";

    const badgeCategoria = gerarBadgeCategoria(conta.categoria);

    const subtituloVencimento = conta.dia_vencimento
      ? `
        <div class="cabecalho-conta-subtitulo">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>Vencimento: dia ${conta.dia_vencimento}</span>
        </div>
      `
      : "";

    html += `
      <div class="cabecalho-conta-ciclo">
        <div class="cabecalho-conta-linha-topo">
          <h3 class="cabecalho-conta-titulo">
            <span>${escapeHtml(conta.nome)} — ${formatarMoeda(ciclo.valor_total)}</span>
            ${badgeCategoria}
            ${badgeIndividual}
            ${badgeParcela}
          </h3>
          ${
            ehAdmin
              ? `
            <button type="button" class="btn-ajustar-ciclo" onclick="ajustarValorCiclo('${ciclo.id}', '${encodeURIComponent(conta.nome)}', ${ciclo.valor_total}, '${conta.id}')" title="Ajustar valor da fatura este mês" aria-label="Ajustar valor da fatura">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          `
              : ""
          }
        </div>
        ${subtituloVencimento}
      </div>
    `;

    html += listaFiltrada
      .map((c) => {
        const isEu = c.usuario_id === usuarioAtualId;
        const statusInfo = calcularStatusVencimento(c, conta, mesReferencia);

        return `
          <div class="linha">
            <div class="linha-com-avatar">
              ${gerarAvatarHtml(c.profiles ? c.profiles.nome : "Morador", c.usuario_id, 32, mapaCoresMoradores[c.usuario_id])}
              <div>
                <strong>${escapeHtml(c.profiles ? c.profiles.nome : "Morador")}${isEu ? " (você)" : ""}</strong><br/>
                <span class="texto-suave">${formatarMoeda(c.valor)}</span>
              </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
              <span class="badge ${statusInfo.classe}">${statusInfo.texto}</span>
              <div class="acoes-cobranca-grid">
                ${
                  c.comprovante_url
                    ? `
                <button class="btn-icone" onclick="verComprovante('${c.comprovante_url}', '${escapeHtml(c.profiles ? c.profiles.nome : "Morador")}')" title="Ver comprovante anexado" aria-label="Ver comprovante">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>
                `
                    : `<span class="espaco-acao-vazio" aria-hidden="true"></span>`
                }
                ${
                  isEu
                    ? `
                <button class="btn-icone ${c.status === 'pago' ? 'btn-icone-pix-pago' : 'btn-icone-pix-pendente'}" onclick="abrirModalPix('${c.id}')" title="${c.status === 'pago' ? 'Pix pago (ver dados)' : 'Pagar minha parte via Pix'}" aria-label="Pagar Pix">
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
                `
                    : `<span class="espaco-acao-vazio" aria-hidden="true"></span>`
                }
                ${
                  isEu || ehAdmin
                    ? `
                <button class="btn-icone btn-icone-whatsapp" onclick="enviarCobrancaWhatsApp('${c.id}', '${encodeURIComponent(conta.nome)}', ${c.status === 'pago'})" title="${isEu ? (c.status === 'pago' ? 'Avisar comprovante no WhatsApp' : 'Avisar pagamento no WhatsApp') : (c.status === 'pago' ? 'Confirmar recebimento no WhatsApp' : 'Cobrar morador no WhatsApp')}" aria-label="WhatsApp">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                </button>
                `
                    : `<span class="espaco-acao-vazio" aria-hidden="true"></span>`
                }
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
    } else if (filtroAtual === "em_analise") {
      container.innerHTML = `
        <div class="estado-vazio">
          <div class="estado-vazio-icone neutro">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h4>Nenhum comprovante em análise</h4>
          <p>Não há pagamentos aguardando conferência no momento.</p>
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

function atualizarMetricas({ totalCasa, contasQtd, suaParte, seuStatus, totalPagas, totalCobrancas, totalAtrasadas = 0 }) {
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

  // Barra segmentada: pago (verde) / atrasado (vermelho) / pendente em dia (âmbar)
  const totalPendentesNoPrazo = Math.max(0, totalCobrancas - totalPagas - totalAtrasadas);
  const pctPago = totalCobrancas > 0 ? (totalPagas / totalCobrancas) * 100 : 0;
  const pctAtrasado = totalCobrancas > 0 ? (totalAtrasadas / totalCobrancas) * 100 : 0;
  const pctPendente = totalCobrancas > 0 ? (totalPendentesNoPrazo / totalCobrancas) * 100 : 0;

  const segPago = document.getElementById("seg-pago");
  const segAtrasado = document.getElementById("seg-atrasado");
  const segPendente = document.getElementById("seg-pendente");
  if (window.Animacoes && window.Animacoes.animarBarraSegmentada) {
    window.Animacoes.animarBarraSegmentada({ segPago, segAtrasado, segPendente }, { pctPago, pctAtrasado, pctPendente });
  } else {
    if (segPago) segPago.style.width = `${pctPago}%`;
    if (segAtrasado) segAtrasado.style.width = `${pctAtrasado}%`;
    if (segPendente) segPendente.style.width = `${pctPendente}%`;
  }

  // Confete ao fechar 100% do mês (só dispara uma vez por carregamento)
  if (pct === 100 && totalCobrancas > 0 && !window.__confeteDisparado) {
    window.__confeteDisparado = true;
    if (window.Animacoes && window.Animacoes.animarConfete) {
      window.Animacoes.animarConfete();
    }
  } else if (pct < 100) {
    window.__confeteDisparado = false;
  }
}

function textoStatus(status) {
  return { pago: "Pago", em_analise: "Em Análise", pendente: "Pendente", atrasado: "Atrasado" }[status] || status;
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

  const btnLembretes = document.getElementById("btn-central-lembretes");
  if (btnLembretes) {
    btnLembretes.onclick = abrirCentralLembretes;
  }

  const btnExportarCsv = document.getElementById("btn-exportar-csv");
  if (btnExportarCsv) {
    btnExportarCsv.onclick = exportarCsvMes;
  }

  const btnGerar = document.getElementById("btn-gerar-ciclo");
  if (btnGerar) {
    btnGerar.onclick = async () => {
      btnGerar.disabled = true;
      mostrarToast("Atualizando cobranças do mês...");

      const mesReferencia = primeiroDiaDoMes();
      const { data: contas } = await supabaseClient
        .from("contas_fixas")
        .select("*")
        .eq("casa_id", casaId)
        .eq("ativa", true);

      const mesRefYYYYMM = mesReferencia.slice(0, 7);
      const contasDoMes = (contas || []).filter((c) => {
        if (c.mes_inicio && mesRefYYYYMM < c.mes_inicio.slice(0, 7)) return false;
        if (c.parcelado && c.parcelas_total && calcularParcelaAtual(c, mesRefYYYYMM) === null) return false;
        return true;
      });

      await garantirCobrancasDoMes(mesReferencia, contasDoMes, true);
      limparCacheDashboard();
      mostrarToast("Cobranças atualizadas com sucesso!");
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
  // 1. Tenta a sincronização atômica instantânea via RPC no PostgreSQL
  if (!forcarSincronizacao) {
    try {
      const { data: okRpc, error: errRpc } = await supabaseClient.rpc("sincronizar_cobrancas_mes", {
        p_casa_id: casaId,
        p_mes: mesReferencia,
      });
      if (!errRpc && okRpc) {
        return; // Sincronizado com sucesso e atomicamente pelo banco!
      }
    } catch (e) {
      console.warn("Aviso ao sincronizar via RPC, usando fallback cliente:", e);
    }
  }

  const { data: membros } = await supabaseClient
    .from("membros_casa")
    .select("usuario_id, entrou_em")
    .eq("casa_id", casaId);

  if (!membros || membros.length === 0) return;

  for (const conta of contas || []) {
    let { data: ciclo } = await supabaseClient
      .from("ciclos_cobranca")
      .select("id, valor_total, criado_em")
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
    } else if (conta.forma_divisao === "percentual") {
      // CASO 2: DIVISÃO POR PERCENTUAL CUSTOMIZADO (ex: 60%/40%)
      const { data: divisoes } = await supabaseClient
        .from("divisao_conta")
        .select("usuario_id, peso_ou_valor")
        .eq("conta_fixa_id", conta.id);

      const divisoesValidas = (divisoes || []).filter((d) => Number(d.peso_ou_valor) > 0);

      if (divisoesValidas.length > 0) {
        // Remove cobranças de quem não faz mais parte da divisão configurada
        const idsValidos = new Set(divisoesValidas.map((d) => d.usuario_id));
        for (const cobranca of cobrancasExistentes) {
          if (!idsValidos.has(cobranca.usuario_id) && cobranca.status !== "pago") {
            await supabaseClient.from("cobrancas_individuais").delete().eq("id", cobranca.id);
          }
        }

        const totalCentavos = Math.round(Number(ciclo.valor_total) * 100);
        const somaPercentuais = divisoesValidas.reduce((acc, d) => acc + Number(d.peso_ou_valor), 0);

        // Rateio proporcional em centavos exatos, com o resto do arredondamento
        // indo pra quem tem a maior parte fracionária (mantém o total batendo)
        const calculos = divisoesValidas.map((d) => {
          const percentualNormalizado = somaPercentuais > 0 ? Number(d.peso_ou_valor) / somaPercentuais : 0;
          const exato = totalCentavos * percentualNormalizado;
          return { usuario_id: d.usuario_id, base: Math.floor(exato), fracao: exato - Math.floor(exato) };
        });

        let somaBase = calculos.reduce((acc, c) => acc + c.base, 0);
        let sobra = totalCentavos - somaBase;

        calculos.sort((a, b) => b.fracao - a.fracao);
        for (let i = 0; i < calculos.length && sobra > 0; i++) {
          calculos[i].base += 1;
          sobra--;
        }

        for (const calc of calculos) {
          const valorPessoa = Number((calc.base / 100).toFixed(2));
          const cobrancaAtual = cobrancasExistentes.find((c) => c.usuario_id === calc.usuario_id);

          if (cobrancaAtual) {
            if (cobrancaAtual.status !== "pago" && (Number(cobrancaAtual.valor) !== valorPessoa || forcarSincronizacao)) {
              await supabaseClient
                .from("cobrancas_individuais")
                .update({ valor: valorPessoa })
                .eq("id", cobrancaAtual.id);
              await gerarPixParaCobranca(cobrancaAtual.id, valorPessoa, conta.nome);
            }
          } else {
            const { data: nova } = await supabaseClient
              .from("cobrancas_individuais")
              .insert({
                ciclo_id: ciclo.id,
                usuario_id: calc.usuario_id,
                valor: valorPessoa,
                status: "pendente",
              })
              .select()
              .single();

            if (nova) {
              await gerarPixParaCobranca(nova.id, valorPessoa, conta.nome);
            }
          }
        }
      }
    } else {
      // CASO 3: DIVISÃO IGUAL ENTRE TODOS OS MEMBROS
      // Só entram no rateio deste ciclo os moradores que já faziam parte da
      // casa QUANDO o ciclo foi gerado. Quem entra depois (ex.: um morador
      // novo adicionado no meio do mês) não é encaixado retroativamente numa
      // cobrança que já existia antes dele — ele só passa a ser cobrado a
      // partir do próximo ciclo gerado enquanto já é morador.
      const membrosElegiveis = membros.filter(
        (m) => !m.entrou_em || new Date(m.entrou_em) <= new Date(ciclo.criado_em)
      );

      const usuariosComCobranca = new Set(cobrancasExistentes.map((c) => c.usuario_id));
      const precisaSincronizar =
        cobrancasExistentes.length === 0 ||
        membrosElegiveis.some((m) => !usuariosComCobranca.has(m.usuario_id)) ||
        forcarSincronizacao;

      if (precisaSincronizar && membrosElegiveis.length > 0) {
        const n = membrosElegiveis.length;
        const totalCentavos = Math.round(Number(ciclo.valor_total) * 100);
        const centavosPorPessoa = Math.floor(totalCentavos / n);
        let sobraCentavos = totalCentavos % n;

        for (const membro of membrosElegiveis) {
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

      // RATEIO PROPORCIONAL (opt-in por conta): quem entrou no meio do mês,
      // depois deste ciclo já ter sido gerado, não é somado à divisão igual
      // acima (isso mexeria no valor de quem já pagou) — em vez disso, gera
      // uma cobrança própria pra ele, proporcional aos dias restantes do mês.
      if (conta.rateio_proporcional) {
        const mesRefDate = new Date(mesReferencia);
        const membrosTardios = membros.filter((m) => {
          if (!m.entrou_em) return false;
          const dataEntrada = new Date(m.entrou_em);
          if (dataEntrada <= new Date(ciclo.criado_em)) return false;
          return (
            dataEntrada.getFullYear() === mesRefDate.getFullYear() &&
            dataEntrada.getMonth() === mesRefDate.getMonth()
          );
        });

        for (const membro of membrosTardios) {
          const jaTemCobranca = cobrancasExistentes.some((c) => c.usuario_id === membro.usuario_id);
          if (jaTemCobranca) continue;

          const nBase = membrosElegiveis.length > 0 ? membrosElegiveis.length : 1;
          const valorBaseCentavos = Math.floor((Number(ciclo.valor_total) * 100) / nBase);
          const diasNoMes = new Date(mesRefDate.getFullYear(), mesRefDate.getMonth() + 1, 0).getDate();
          const diaEntrada = new Date(membro.entrou_em).getDate();
          const diasRestantes = Math.max(0, diasNoMes - diaEntrada + 1);
          if (diasRestantes <= 0) continue;

          const valorProporcionalCentavos = Math.round((valorBaseCentavos * diasRestantes) / diasNoMes);
          if (valorProporcionalCentavos <= 0) continue;
          const valorProporcional = Number((valorProporcionalCentavos / 100).toFixed(2));

          const { data: nova } = await supabaseClient
            .from("cobrancas_individuais")
            .insert({
              ciclo_id: ciclo.id,
              usuario_id: membro.usuario_id,
              valor: valorProporcional,
              status: "pendente",
            })
            .select()
            .single();

          if (nova) {
            await gerarPixParaCobranca(nova.id, valorProporcional, `${conta.nome} (proporcional)`);
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
      <h3>Ajustar valor: ${escapeHtml(nomeConta)}</h3>
      <p style="margin-bottom: 12px;">Altere o valor desta fatura no mês. A divisão será recalculada automaticamente.</p>
      <div style="margin-bottom: 16px; text-align: left;">
        <label for="input-ajuste-valor" style="margin-top: 0;">Valor total da fatura (R$)</label>
        <input type="number" id="input-ajuste-valor" step="0.01" min="0" value="${valorAtual}" style="font-size: 16px; font-weight: 700;" inputmode="decimal" />
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
  const { conta: contaDaCobranca, mesReferencia: mesDaCobranca } = localizarContextoCobranca(cobranca.id);
  const statusEfetivo = obterStatusEfetivo(cobranca, contaDaCobranca, mesDaCobranca);

  let chaveDestino = null;
  let tipoChaveDestino = "telefone";
  let nomeBeneficiario = "Rachaê";
  let bancoBeneficiario = null;

  // 1. Tenta buscar chave Pix oficial configurada na casa
  try {
    const { data: casaData } = await supabaseClient
      .from("casas")
      .select("nome, chave_pix, tipo_chave_pix, nome_titular_pix, banco_pix")
      .eq("id", casaId)
      .maybeSingle();

    if (casaData) {
      if (casaData.nome) nomeBeneficiario = casaData.nome;
      if (casaData.chave_pix) {
        chaveDestino = casaData.chave_pix;
        tipoChaveDestino = casaData.tipo_chave_pix || "telefone";
        // Nome do titular cadastrado pelo admin tem prioridade sobre o
        // nome da casa (ajuda o morador a conferir antes de pagar).
        if (casaData.nome_titular_pix) nomeBeneficiario = casaData.nome_titular_pix;
        if (casaData.banco_pix) bancoBeneficiario = casaData.banco_pix;
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

  // 4. Gera imagem de QR Code localmente (100% offline e privado, com fallback para API remota)
  let qrCodeImg = cobranca.pix_qrcode;
  if (!qrCodeImg && payloadPix) {
    if (typeof window.gerarQRCodeDataURL === "function") {
      try {
        qrCodeImg = window.gerarQRCodeDataURL(payloadPix, { tamanho: 240, margem: 4 });
      } catch (errQr) {
        console.warn("Aviso ao gerar QR Code localmente:", errQr);
      }
    }
    if (!qrCodeImg) {
      qrCodeImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payloadPix)}`;
    }
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
    <p class="texto-suave" style="margin:2px 0 12px; font-size:12px;">Status: <span class="badge ${statusEfetivo}">${textoStatus(statusEfetivo)}</span></p>
  `;

  if (payloadPix) {
    htmlPix += `
      <div style="background:var(--cor-fundo); border:1px solid var(--cor-borda); border-radius:8px; padding:10px; margin-bottom:10px; text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase;">Pix Copia e Cola Oficial</span>
          <span style="font-size:11px; color:var(--cor-destaque); font-weight:600;">Com valor exato</span>
        </div>
        <div class="copia-cola" style="max-height:50px; overflow-y:auto; word-break:break-all; font-size:11px;">${payloadPix}</div>
        <button type="button" class="secundario pequeno" style="width:100%; margin-top:8px !important;" onclick="copiarPix('${encodeURIComponent(payloadPix)}')">
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
        <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase; display:block;">Chave Pix (${escapeHtml(nomeBeneficiario)}${bancoBeneficiario ? " · " + escapeHtml(bancoBeneficiario) : ""})</span>
        <div style="font-size:15px; font-weight:700; color:var(--cor-texto); margin:4px 0 6px;">${escapeHtml(chaveDestino)}</div>
        <button type="button" class="secundario pequeno" style="width:100%; margin:0 !important;" onclick="copiarPix('${encodeURIComponent(chaveDestino)}')">
          Copiar Chave Pix
        </button>
      </div>
    `;
  }

  // Anexar / ver comprovante de pagamento
  const inputComprovanteId = `input-comprovante-${cobranca.id}`;
  htmlPix += `
    <div style="margin-top:8px; padding-top:10px; border-top:1px dashed var(--cor-borda);">
      <input type="file" id="${inputComprovanteId}" accept="image/*,application/pdf" style="display:none;" onchange="enviarComprovante('${cobranca.id}', this)" />
  `;
  if (cobranca.comprovante_url) {
    htmlPix += `
      <button type="button" class="secundario pequeno" style="width:100%; margin:0 !important;" onclick="verComprovante('${cobranca.comprovante_url.replace(/'/g, "\\'")}', '${escapeHtml(cobranca.profiles ? cobranca.profiles.nome : "Morador")}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Ver comprovante anexado
      </button>
      <button type="button" onclick="document.getElementById('${inputComprovanteId}').click()" class="texto-suave" style="background:none; border:none; padding:0; margin-top:6px; font-size:11px; cursor:pointer; text-decoration:underline; width:auto;">
        Trocar comprovante
      </button>
    `;
  } else {
    htmlPix += `
      <button type="button" class="secundario pequeno" style="width:100%; margin:0 !important;" onclick="document.getElementById('${inputComprovanteId}').click()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Anexar comprovante de pagamento
      </button>
    `;
  }
  htmlPix += `</div>`;

  htmlPix += `
    <button class="pequeno btn-whatsapp" style="margin-top:6px; width:100%;" onclick="enviarCobrancaWhatsApp('${cobranca.id}', null, ${cobranca.status === 'pago'})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      ${cobranca.status === "pago" ? "Enviar confirmação no WhatsApp" : "Enviar cobrança no WhatsApp"}
    </button>
  `;

  if (statusEfetivo === "em_analise") {
    htmlPix += `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; margin: 10px 0 4px; text-align: center;">
        <span style="font-size: 12.5px; font-weight: 600; color: #b45309;">Comprovante anexado aguardando validação do administrador.</span>
      </div>
    `;
  }

  if (ehAdmin) {
    if (statusEfetivo === "em_analise") {
      htmlPix += `
        <button class="pequeno btn-aprovar-comprovante" style="margin-top:8px; width:100%;" onclick="confirmarPagamentoSimulado('${cobranca.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Aprovar Comprovante (Marcar como Pago)
        </button>
        <button class="pequeno btn-recusar-comprovante" style="margin-top:6px; width:100%;" onclick="recusarComprovante('${cobranca.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Recusar Comprovante
        </button>
      `;
    } else if (cobranca.status !== "pago") {
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
  // nomeContaOpcional chega como URI-encoded (ver renderizarCiclosNaTela) pra
  // não quebrar o atributo onclick se o nome da conta tiver aspas.
  const nomeConta = (nomeContaOpcional ? decodeURIComponent(nomeContaOpcional) : null) || "da casa";

  const estaPago = jaPago || cobranca.status === "pago";

  let texto = "";
  if (estaPago) {
    texto = `*Rachaê - Pagamento Confirmado*\n`;
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
      ? `*Vencimento:* ${String(diaVencimento).padStart(2, "0")}/${String(dataSelecionada.getMonth() + 1).padStart(2, "0")}/${dataSelecionada.getFullYear()}\n`
      : "";

    texto = `*Rachaê - Cobrança da Casa*\n`;
    texto += `Olá, *${nomeMorador}*!\n\n`;
    texto += `Passando para lembrar da sua parte da conta *${nomeConta}* (${mesFormatado}):\n`;
    texto += `*Valor:* *${valorFormatado}*\n`;
    if (vencTexto) texto += vencTexto;
    texto += `\n`;

    if (chavePixCasa) {
      texto += `*Chave Pix da Casa (${tipoChavePixCasa}):*\n\`\`\`${chavePixCasa}\`\`\`\n\n`;
    }

    if (cobranca.pix_copia_cola) {
      texto += `*Código Pix Copia e Cola:*\n\`\`\`${cobranca.pix_copia_cola}\`\`\`\n\n`;
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

// ============================================================
// Exporta as cobranças do mês selecionado em CSV (abre bem no Excel/Sheets)
// ============================================================
function exportarCsvMes() {
  if (!dadosCiclosCarregados || dadosCiclosCarregados.length === 0) {
    mostrarToast("Nenhuma cobrança carregada para exportar.", "alerta");
    return;
  }

  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();

  const linhas = [["Conta", "Categoria", "Morador", "Valor (R$)", "Status", "Vencimento", "Data Pagamento", "Comprovante"]];

  for (const { conta, cobrancas, mesReferencia } of dadosCiclosCarregados) {
    const catInfo = typeof obterCategoriaInfo === "function" ? obterCategoriaInfo(conta.categoria) : { label: "Outros" };
    for (const c of cobrancas || []) {
      const nomeMorador = c.profiles ? c.profiles.nome : "Morador";
      const statusEfetivo = obterStatusEfetivo(c, conta, mesReferencia);
      const dataVenc = conta.dia_vencimento ? `${String(conta.dia_vencimento).padStart(2, "0")}/${String(dataSelecionada.getMonth() + 1).padStart(2, "0")}/${ano}` : "";
      const dataPagamento = c.pago_em ? new Date(c.pago_em).toLocaleDateString("pt-BR") : "";
      const temComprovante = c.comprovante_url ? "Sim" : "Não";

      linhas.push([
        conta.nome,
        catInfo.label,
        nomeMorador,
        Number(c.valor || 0).toFixed(2).replace(".", ","),
        textoStatus(statusEfetivo),
        dataVenc,
        dataPagamento,
        temComprovante,
      ]);
    }
  }

  const csvConteudo = linhas
    .map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  // BOM (\uFEFF) garante que acentuação abra certo no Excel
  const blob = new Blob(["\uFEFF" + csvConteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rachae_${nomeMes.toLowerCase()}_${ano}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  mostrarToast("CSV exportado com sucesso!");
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
    // Tenta executar via RPC segura
    const { error: rpcError } = await supabaseClient.rpc("confirmar_pagamento_cobranca", {
      p_cobranca_id: cobrancaId,
    });

    if (rpcError) {
      // Fallback para update direto se a função RPC ainda não tiver sido criada no banco
      const { error: updateError } = await supabaseClient
        .from("cobrancas_individuais")
        .update({ status: "pago", pago_em: new Date().toISOString() })
        .eq("id", cobrancaId);

      if (updateError) {
        mostrarToast("Erro ao confirmar pagamento: " + (updateError.message || rpcError.message), "alerta");
        return;
      }
    }
  }
  if (typeof window.vibrar === "function") window.vibrar([20, 40, 20]);
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
    // Tenta executar via RPC segura
    const { error: rpcError } = await supabaseClient.rpc("reverter_pagamento_cobranca", {
      p_cobranca_id: cobrancaId,
    });

    if (rpcError) {
      // Fallback para update direto se a função RPC ainda não tiver sido criada no banco
      const { error: updateError } = await supabaseClient
        .from("cobrancas_individuais")
        .update({ status: "pendente", pago_em: null })
        .eq("id", cobrancaId);

      if (updateError) {
        mostrarToast("Erro ao reverter cobrança: " + (updateError.message || rpcError.message), "alerta");
        return;
      }
    }
  }
  fecharModalPix();
  limparCacheDashboard();
  mostrarToast("Cobrança revertida para pendente.");
  await carregarCiclosDoMes();
}

async function recusarComprovante(cobrancaId) {
  const isMock = typeof ehModoMock !== "undefined" ? ehModoMock : false;
  if (isMock && window.RachaFixoMock) {
    mostrarToast("Comprovante recusado no modo teste.");
  } else {
    // Tenta executar via RPC segura
    const { error: rpcError } = await supabaseClient.rpc("recusar_comprovante_cobranca", {
      p_cobranca_id: cobrancaId,
    });

    if (rpcError) {
      // Fallback para update direto se a função RPC ainda não tiver sido criada no banco
      const { error: updateError } = await supabaseClient
        .from("cobrancas_individuais")
        .update({ status: "pendente", comprovante_url: null })
        .eq("id", cobrancaId);

      if (updateError) {
        mostrarToast("Erro ao recusar comprovante: " + (updateError.message || rpcError.message), "alerta");
        return;
      }
    }
  }
  fecharModalPix();
  limparCacheDashboard();
  mostrarToast("Comprovante recusado. A cobrança retornou para pendente.", "alerta");
  await carregarCiclosDoMes();
}

function enviarResumoGrupoWhatsApp() {
  if (!dadosCiclosCarregados || dadosCiclosCarregados.length === 0) {
    mostrarToast("Cobranças deste mês ainda não foram geradas. Clique em 'Sincronizar'.", "alerta");
    return;
  }

  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();

  let nomeCasa = "Nossa Casa";
  const elNomeCasa = document.getElementById("dash-nome-casa");
  if (elNomeCasa && elNomeCasa.textContent && elNomeCasa.textContent.trim()) {
    nomeCasa = elNomeCasa.textContent.trim();
  }

  let totalGeral = 0;
  let linhasContas = [];
  let mapaMoradores = {};

  for (const { conta, ciclo, cobrancas } of dadosCiclosCarregados) {
    // IMPORTANTE: Contas privadas NÃO são incluídas no resumo do grupo da casa!
    const ehPrivada = conta.privada || conta.forma_divisao === "individual_privada";
    if (ehPrivada) {
      continue;
    }

    totalGeral += Number(ciclo.valor_total || 0);
    linhasContas.push(`• ${conta.nome}: ${formatarMoeda(ciclo.valor_total)}`);

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
    mostrarToast("Nenhuma conta pública ativa para resumo no grupo.", "alerta");
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
  try {
    const popup = window.open(url, "_blank");
    if (!popup || popup.closed || typeof popup.closed === "undefined") {
      window.location.href = url;
    }
  } catch (e) {
    window.location.href = url;
  }
}

function fecharModalPix() {
  const modalPixEl = document.getElementById("modal-pix");
  const cardModalPixEl = document.getElementById("card-modal-pix");
  if (!modalPixEl) return;
  const fecharImediato = () => {
    modalPixEl.style.setProperty("display", "none", "important");
    modalPixEl.classList.remove("ativo");
  };
  if (window.Animacoes && typeof window.Animacoes.animarFechamentoModal === "function") {
    try {
      window.Animacoes.animarFechamentoModal(modalPixEl, cardModalPixEl, fecharImediato);
    } catch (e) {
      fecharImediato();
    }
  } else {
    fecharImediato();
  }
}
window.fecharModalPix = fecharModalPix;

function configurarModalPixEventos() {
  const modalPix = document.getElementById("modal-pix");
  if (modalPix) {
    modalPix.onclick = (e) => {
      if (e.target === modalPix) fecharModalPix();
    };
  }

  const modalLembretes = document.getElementById("modal-lembretes");
  if (modalLembretes) {
    modalLembretes.onclick = (e) => {
      if (e.target === modalLembretes) fecharModalLembretes();
    };
  }

  const modalExtra = document.getElementById("modal-despesa-extra");
  if (modalExtra) {
    modalExtra.onclick = (e) => {
      if (e.target === modalExtra) fecharModalDespesaExtra();
    };
    const btnX = modalExtra.querySelector(".btn-fechar-modal-x");
    if (btnX) {
      btnX.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fecharModalDespesaExtra();
      };
    }
    const btnCancelar = modalExtra.querySelector(".btn-despesa-cancelar");
    if (btnCancelar) {
      btnCancelar.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        fecharModalDespesaExtra();
      };
    }
  }
}

// ============================================================
// Central de Lembretes: lista quem está atrasado/pendente com
// vencimento próximo e prepara um lembrete de WhatsApp individual.
// Não é um envio automático — cada lembrete precisa ser disparado
// manualmente pelo admin, respeitando as limitações do WhatsApp.
// ============================================================
function abrirCentralLembretes() {
  const modal = document.getElementById("modal-lembretes");
  const lista = document.getElementById("lista-lembretes");
  if (!modal || !lista) return;

  atualizarBotaoNotificacoesUI();

  const mapaCoresMoradores = atribuirCoresMoradores(
    (dadosCiclosCarregados || []).flatMap(({ cobrancas }) => (cobrancas || []).map((c) => c.usuario_id))
  );

  const mapaPendencias = {};
  for (const { conta, cobrancas, mesReferencia } of dadosCiclosCarregados || []) {
    for (const c of cobrancas || []) {
      if (c.status === "pago") continue;
      const statusEfetivo = obterStatusEfetivo(c, conta, mesReferencia);
      const uId = c.usuario_id;
      if (!mapaPendencias[uId]) {
        mapaPendencias[uId] = {
          nome: c.profiles ? c.profiles.nome : "Morador",
          telefone: c.profiles ? c.profiles.telefone : null,
          total: 0,
          atrasado: false,
        };
      }
      mapaPendencias[uId].total += Number(c.valor || 0);
      if (statusEfetivo === "atrasado") {
        mapaPendencias[uId].atrasado = true;
      }
    }
  }

  // Inclui também pendências de despesas extras / mercado
  for (const d of dadosDespesasExtrasCarregadas || []) {
    const parts = d.despesas_avulsas_participantes || d.participantes || [];
    for (const part of parts) {
      if (part.pago) continue;
      const uId = part.usuario_id;
      const nomePart = part.profiles?.nome || "Morador";
      const telPart = part.profiles?.telefone || null;
      if (!mapaPendencias[uId]) {
        mapaPendencias[uId] = {
          nome: nomePart,
          telefone: telPart,
          total: 0,
          atrasado: false,
        };
      }
      mapaPendencias[uId].total += Number(part.valor_cota || 0);
    }
  }

  const nomeMes = MESES[dataSelecionada.getMonth()];
  const pendentes = Object.entries(mapaPendencias).sort((a, b) => {
    // Atrasados primeiro
    if (a[1].atrasado !== b[1].atrasado) return a[1].atrasado ? -1 : 1;
    return b[1].total - a[1].total;
  });

  if (pendentes.length === 0) {
    lista.innerHTML = `
      <div class="estado-vazio">
        <div class="estado-vazio-icone sucesso">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h4>Ninguém pendente</h4>
        <p>Todo mundo está em dia com as contas de ${nomeMes}.</p>
      </div>
    `;
  } else {
    lista.innerHTML = pendentes
      .map(([uId, info]) => {
        const telDigitos = info.telefone ? info.telefone.replace(/\D/g, "") : "";
        const waNum = telDigitos.length === 10 || telDigitos.length === 11 ? "55" + telDigitos : telDigitos;
        const mensagem = `Oi ${info.nome}! Passando pra lembrar que sua parte de ${nomeMes} no Rachaê está ${info.atrasado ? "atrasada" : "pendente"}: ${formatarMoeda(info.total)}. Qualquer dúvida me chama :)`;
        const waLink = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(mensagem)}` : null;

        return `
          <div class="linha">
            <div class="linha-com-avatar">
              ${gerarAvatarHtml(info.nome, uId, 32, mapaCoresMoradores[uId])}
              <div>
                <strong>${escapeHtml(info.nome)}</strong><br/>
                <span class="texto-suave">${formatarMoeda(info.total)} · ${info.atrasado ? "Atrasado" : "Pendente"}</span>
              </div>
            </div>
            ${
              waLink
                ? `<a href="${waLink}" target="_blank" class="btn-icone btn-icone-whatsapp" title="Enviar lembrete no WhatsApp" aria-label="Enviar lembrete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                    </svg>
                  </a>`
                : `<span class="texto-suave" style="font-size: 11px;">Sem telefone</span>`
            }
          </div>
        `;
      })
      .join("");
  }

  modal.style.display = "flex";
  if (window.Animacoes) {
    window.Animacoes.animarAberturaModal(modal, document.getElementById("card-modal-lembretes"));
  }
}

function fecharModalLembretes() {
  const modal = document.getElementById("modal-lembretes");
  const card = document.getElementById("card-modal-lembretes");
  if (!modal) return;
  const fecharImediato = () => {
    modal.style.setProperty("display", "none", "important");
    modal.classList.remove("ativo");
  };
  if (window.Animacoes && typeof window.Animacoes.animarFechamentoModal === "function") {
    try {
      window.Animacoes.animarFechamentoModal(modal, card, fecharImediato);
    } catch (e) {
      fecharImediato();
    }
  } else {
    fecharImediato();
  }
}
window.fecharModalLembretes = fecharModalLembretes;

// Fecha modais com a tecla ESC
if (!window._modaisDashboardKeydownBound) {
  window._modaisDashboardKeydownBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modalPix = document.getElementById("modal-pix");
      if (modalPix && modalPix.style.display === "flex") {
        fecharModalPix();
      }
      const modalExtra = document.getElementById("modal-despesa-extra");
      if (modalExtra && modalExtra.style.display === "flex") {
        fecharModalDespesaExtra();
      }
      const modalLembretes = document.getElementById("modal-lembretes");
      if (modalLembretes && modalLembretes.style.display === "flex") {
        fecharModalLembretes();
      }
    }
  });
}

// ============================================================
// FASE 3: Central de Lembretes & Cobrança Rápida Consolidada
// ============================================================
async function copiarResumoPendentesGrupo() {
  const mapaPendencias = {};

  // 1. Contas fixas do mês
  for (const { conta, cobrancas, mesReferencia } of dadosCiclosCarregados || []) {
    for (const c of cobrancas || []) {
      if (c.status === "pago") continue;
      const statusEfetivo = obterStatusEfetivo(c, conta, mesReferencia);
      const uId = c.usuario_id;
      if (!mapaPendencias[uId]) {
        mapaPendencias[uId] = {
          nome: c.profiles ? c.profiles.nome : "Morador",
          total: 0,
          atrasado: false,
          itens: [],
        };
      }
      mapaPendencias[uId].total += Number(c.valor || 0);
      mapaPendencias[uId].itens.push(conta.nome);
      if (statusEfetivo === "atrasado") {
        mapaPendencias[uId].atrasado = true;
      }
    }
  }

  // 2. Despesas extras / mercado
  for (const d of dadosDespesasExtrasCarregadas || []) {
    const parts = d.despesas_avulsas_participantes || d.participantes || [];
    for (const part of parts) {
      if (part.pago) continue;
      const uId = part.usuario_id;
      const nomePart = part.profiles?.nome || "Morador";
      if (!mapaPendencias[uId]) {
        mapaPendencias[uId] = {
          nome: nomePart,
          total: 0,
          atrasado: false,
          itens: [],
        };
      }
      mapaPendencias[uId].total += Number(part.valor_cota || 0);
      mapaPendencias[uId].itens.push(`${d.descricao} (Extra)`);
    }
  }

  const pendentesList = Object.values(mapaPendencias);
  if (pendentesList.length === 0) {
    mostrarToast("Tudo em dia! Ninguém possui contas pendentes neste mês.", "sucesso");
    return;
  }

  // Busca dados Pix da casa
  let chavePix = null;
  let tipoPix = "";
  let titularPix = "";
  let bancoPix = "";

  try {
    const { data: casaData } = await supabaseClient
      .from("casas")
      .select("nome, chave_pix, tipo_chave_pix, nome_titular_pix, banco_pix")
      .eq("id", casaId)
      .maybeSingle();

    if (casaData) {
      chavePix = casaData.chave_pix;
      tipoPix = casaData.tipo_chave_pix || "";
      titularPix = casaData.nome_titular_pix || "";
      bancoPix = casaData.banco_pix || "";
    }
  } catch (e) {
    console.warn("Aviso ao buscar Pix da casa para cobrança:", e);
  }

  const nomeCasa = localStorage.getItem("casa_nome") || "Rachaê";
  const nomeMes = MESES[dataSelecionada.getMonth()];
  const ano = dataSelecionada.getFullYear();

  let texto = `📢 *RESUMO DE CONTAS — ${nomeCasa.toUpperCase()}*\n`;
  texto += `📅 *Mês de Referência:* ${nomeMes}/${ano}\n\n`;
  texto += `💸 *Pendências em aberto:*\n`;

  for (const info of pendentesList) {
    const statusTag = info.atrasado ? "⚠️ Atrasado" : "⏳ Pendente";
    const itensStr = info.itens.length > 0 ? ` (${info.itens.slice(0, 3).join(", ")}${info.itens.length > 3 ? "..." : ""})` : "";
    texto += `• *${info.nome}:* ${formatarMoeda(info.total)} — ${statusTag}${itensStr}\n`;
  }

  if (chavePix) {
    texto += `\n🔑 *Chave Pix da Casa (Contas Fixas):* ${chavePix}`;
    if (tipoPix) texto += ` (${tipoPix.toUpperCase()})`;
    if (titularPix) texto += `\n👤 *Titular:* ${titularPix}`;
    if (bancoPix) texto += `\n🏦 *Banco:* ${bancoPix}`;
  }

  // Pendências de Despesas Extras / Mercado / Rateio entre moradores
  const pendenciasExtras = [];
  (dadosDespesasExtrasCarregadas || []).forEach((d) => {
    const pagador = (dadosMoradoresCasa || []).find((m) => m.id === d.pago_por_id) || d.profiles || {};
    const partes = d.despesas_avulsas_participantes || d.participantes || [];
    partes.forEach((p) => {
      if (!p.pago && p.usuario_id !== d.pago_por_id) {
        const devedor = (dadosMoradoresCasa || []).find((m) => m.id === p.usuario_id) || p.profiles || {};
        const pixFormatado = pagador.chave_pix
          ? (typeof window.formatarChavePixGenerica === "function"
              ? window.formatarChavePixGenerica(pagador.chave_pix, pagador.tipo_chave_pix || "telefone")
              : pagador.chave_pix)
          : null;
        pendenciasExtras.push({
          despesa: d.descricao,
          devedor: devedor.nome || "Morador",
          pagador: pagador.nome || "Morador",
          valor: Number(p.valor_cota || 0),
          pixPagador: pixFormatado ? `${pixFormatado} (${pagador.tipo_chave_pix || "Pix"})` : null,
        });
      }
    });
  });

  if (pendenciasExtras.length > 0) {
    texto += `\n\n🛒 *Reembolsos de Despesas Extras / Mercado:*\n`;
    for (const item of pendenciasExtras) {
      texto += `• *${item.devedor}* deve ${formatarMoeda(item.valor)} para *${item.pagador}* (${item.despesa})`;
      if (item.pixPagador) {
        texto += `\n  ↳ _Pix de ${item.pagador}:_ ${item.pixPagador}`;
      }
      texto += `\n`;
    }
  }

  texto += `\n\n📲 _Por favor, realizem o pagamento e anexem o comprovante no app Rachaê para darmos baixa!_ 🙌`;

  try {
    await navigator.clipboard.writeText(texto);
    mostrarToast("Resumo copiado! Cole no grupo do WhatsApp.", "sucesso");
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    mostrarToast("Resumo copiado! Cole no grupo do WhatsApp.", "sucesso");
  }
}

function atualizarBotaoNotificacoesUI() {
  const btn = document.getElementById("btn-ativar-notificacoes");
  if (!btn) return;

  if (!("Notification" in window)) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "block";
  if (Notification.permission === "granted") {
    btn.textContent = "Lembretes locais ativos";
    btn.style.opacity = "0.75";
  } else if (Notification.permission === "denied") {
    btn.textContent = "Notificações bloqueadas no navegador";
    btn.style.opacity = "0.6";
    btn.disabled = true;
  } else {
    btn.textContent = "Ativar lembretes no celular / PC";
    btn.style.opacity = "1";
    btn.disabled = false;
  }
}

async function solicitarPermissaoNotificacoes() {
  if (!("Notification" in window)) {
    mostrarToast("Seu dispositivo ou navegador não suporta notificações locais.", "aviso");
    return;
  }

  if (Notification.permission === "granted") {
    try {
      new Notification("Rachaê", {
        body: "Lembretes locais já estão ativados no seu dispositivo!",
        icon: "icons/icon-192.png",
      });
      mostrarToast("Notificações já estão ativas!", "sucesso");
    } catch (e) {
      mostrarToast("Notificações ativas!", "sucesso");
    }
    return;
  }

  if (Notification.permission === "denied") {
    mostrarToast("Notificações estão bloqueadas nas permissões do seu navegador.", "aviso");
    return;
  }

  try {
    const permissao = await Notification.requestPermission();
    atualizarBotaoNotificacoesUI();
    if (permissao === "granted") {
      new Notification("Rachaê", {
        body: "Lembretes ativados com sucesso! Avisaremos sobre as despesas da casa.",
        icon: "icons/icon-192.png",
      });
      mostrarToast("Lembretes ativados com sucesso!", "sucesso");
    } else {
      mostrarToast("Permissão de notificações não concedida.", "aviso");
    }
  } catch (err) {
    console.warn("Erro ao solicitar notificações:", err);
  }
}

// ============================================================
// FASE 3: Despesas Extras & Mercado ("Racha-Avulso")
// ============================================================
function formatarDataSimples(dataStr) {
  if (!dataStr) return "";
  const partes = String(dataStr).split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}`;
  return dataStr;
}

function obterIconeCategoriaExtra(categoria) {
  switch (categoria) {
    case "alimentacao":
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
    case "contas":
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
    case "moradia":
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    case "lazer":
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
    default:
      return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
  }
}

function obterNomeCategoriaExtra(categoria) {
  switch (categoria) {
    case "alimentacao": return "Alimentação / Mercado";
    case "contas": return "Limpeza / Consumo";
    case "moradia": return "Manutenção / Casa";
    case "lazer": return "Lazer / Churrasco";
    default: return "Outros / Compras";
  }
}

async function carregarMoradoresCasa() {
  if (!casaId) return [];
  try {
    const { data: membros, error } = await supabaseClient
      .from("membros_casa")
      .select("usuario_id, papel, profiles ( id, nome, telefone, chave_pix, tipo_chave_pix, nome_titular_pix, banco_pix )")
      .eq("casa_id", casaId);

    if (error) {
      console.warn("Aviso ao carregar membros da casa:", error);
      return dadosMoradoresCasa;
    }

    dadosMoradoresCasa = (membros || []).map((m) => ({
      id: m.usuario_id,
      nome: m.profiles?.nome || "Morador",
      telefone: m.profiles?.telefone || null,
      papel: m.papel || "morador",
      chave_pix: m.profiles?.chave_pix || null,
      tipo_chave_pix: m.profiles?.tipo_chave_pix || "telefone",
      nome_titular_pix: m.profiles?.nome_titular_pix || null,
      banco_pix: m.profiles?.banco_pix || null,
    }));

    return dadosMoradoresCasa;
  } catch (err) {
    console.warn("Erro ao buscar moradores da casa:", err);
    return dadosMoradoresCasa;
  }
}

async function carregarDespesasExtrasDoMes() {
  const container = document.getElementById("lista-despesas-extras");
  if (!container || !casaId) return;

  try {
    await carregarMoradoresCasa();
    const mapaMoradores = {};
    (dadosMoradoresCasa || []).forEach((m) => {
      mapaMoradores[m.id] = m;
    });

    const mesRef = primeiroDiaDoMes();
    const { data: dataDespesas, error: errDespesas } = await supabaseClient
      .from("despesas_avulsas")
      .select("*")
      .eq("casa_id", casaId)
      .eq("mes_referencia", mesRef)
      .order("data", { ascending: false });

    if (errDespesas) {
      console.warn("Aviso ao carregar despesas extras:", errDespesas);
      container.innerHTML = `
        <div class="estado-vazio" style="padding: 20px 16px;">
          <p class="texto-suave" style="font-size: 13px;">Módulo pronto. Se executou o script agora, atualize a página.</p>
        </div>
      `;
      dadosDespesasExtrasCarregadas = [];
      return;
    }

    const idsDespesas = (dataDespesas || []).map((d) => d.id);
    const mapaParticipantes = {};

    if (idsDespesas.length > 0) {
      const { data: dataParts, error: errParts } = await supabaseClient
        .from("despesas_avulsas_participantes")
        .select("*")
        .in("despesa_id", idsDespesas);

      if (!errParts && dataParts) {
        dataParts.forEach((part) => {
          if (!mapaParticipantes[part.despesa_id]) {
            mapaParticipantes[part.despesa_id] = [];
          }
          const moradorInfo = mapaMoradores[part.usuario_id] || { nome: "Morador" };
          mapaParticipantes[part.despesa_id].push({
            ...part,
            profiles: moradorInfo,
          });
        });
      }
    }

    dadosDespesasExtrasCarregadas = (dataDespesas || []).map((d) => {
      const pagadorInfo = mapaMoradores[d.pago_por_id] || { nome: "Morador" };
      const partes = mapaParticipantes[d.id] || [];
      return {
        ...d,
        profiles: pagadorInfo,
        participantes: partes,
        despesas_avulsas_participantes: partes,
      };
    });

    renderizarDespesasExtrasNaTela(dadosDespesasExtrasCarregadas);
    if (typeof renderizarCategoriasDoMes === "function") {
      renderizarCategoriasDoMes(dadosCiclosCarregados);
    }
  } catch (err) {
    console.warn("Erro ao carregar despesas extras:", err);
    dadosDespesasExtrasCarregadas = [];
  }
}

function renderizarDespesasExtrasNaTela(despesas) {
  const container = document.getElementById("lista-despesas-extras");
  if (!container) return;

  if (!despesas || despesas.length === 0) {
    container.innerHTML = `
      <div class="estado-vazio" style="padding: 24px 16px;">
        <div class="estado-vazio-icone" style="background: rgba(16, 185, 129, 0.1); color: var(--cor-sucesso);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
        </div>
        <h4 style="margin: 8px 0 4px; font-size: 15px;">Nenhuma despesa extra neste mês</h4>
        <p style="margin: 0; font-size: 13px; color: var(--cor-texto-suave);">Compras de supermercado, produtos de limpeza ou churrascos divididos aparecerão aqui.</p>
      </div>
    `;
    return;
  }

  const ehAdmin = papelUsuarioAtual === "admin";

  const html = despesas
    .map((d, indexDespesa) => {
      const participantes = d.despesas_avulsas_participantes || d.participantes || [];
      const pagadorMorador = (dadosMoradoresCasa || []).find((m) => m.id === d.pago_por_id) || d.profiles || {};
      const pagadorNome = pagadorMorador.nome || d.profiles?.nome || "Morador";
      const ehPagador = d.pago_por_id === usuarioAtualId;
      const podeGerenciar = ehPagador || ehAdmin;

      // Reembolsos reais (exclui quem pagou a despesa do total a reembolsar)
      const outrosParticipantes = participantes.filter((p) => p.usuario_id !== d.pago_por_id);
      const totalReembolsar = outrosParticipantes.length;
      const pagosReembolsos = outrosParticipantes.filter((p) => p.pago).length;
      const todasPagas = totalReembolsar > 0 && pagosReembolsos === totalReembolsar;

      const dataFormatada = formatarDataSimples(d.data);

      // Paleta de cores para os avatares dos participantes desta despesa
      const mapaCoresParticipantes = atribuirCoresMoradores(participantes.map((p) => p.usuario_id));

      const cotasHtml = participantes
        .map((p) => {
          const moradorCota = (dadosMoradoresCasa || []).find((m) => m.id === p.usuario_id) || p.profiles || {};
          const nomeMorador = moradorCota.nome || (p.usuario_id === usuarioAtualId ? "Você" : "Morador");
          const isPago = Boolean(p.pago);
          const isPayerSelf = p.usuario_id === d.pago_por_id;
          const isEu = p.usuario_id === usuarioAtualId;

          let badgeClasse = "pendente";
          let badgeTexto = "Pendente";
          if (isPayerSelf) {
            badgeClasse = "pago";
            badgeTexto = "Pagador";
          } else if (isPago) {
            badgeClasse = "pago";
            badgeTexto = "Reembolsado";
          }

          let acoesHtml = "";
          if (isPayerSelf) {
            // O pagador titular não possui ações de cobrança/pix sobre si mesmo
            acoesHtml = `
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
            `;
          } else if (isEu) {
            // Morador logado olhando sua própria cota nesta despesa
            if (!isPago) {
              acoesHtml = `
                <span class="espaco-acao-vazio" aria-hidden="true"></span>
                <button type="button" class="btn-icone btn-icone-pix-pendente" onclick="abrirModalPixDespesaExtra('${d.id}', '${p.usuario_id}')" title="Pagar Pix a ${escapeHtml(pagadorNome)}" aria-label="Pagar Pix">
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
                <button type="button" class="btn-icone btn-icone-whatsapp" onclick="enviarAvisoWhatsAppDespesaExtra('${d.id}', '${p.usuario_id}')" title="Avisar ${escapeHtml(pagadorNome)} no WhatsApp" aria-label="WhatsApp">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                </button>
              `;
            } else {
              acoesHtml = `
                <span class="espaco-acao-vazio" aria-hidden="true"></span>
                <span class="espaco-acao-vazio" aria-hidden="true"></span>
                <button type="button" class="btn-icone btn-icone-whatsapp" onclick="enviarAvisoWhatsAppDespesaExtra('${d.id}', '${p.usuario_id}')" title="Avisar no WhatsApp" aria-label="WhatsApp">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                  </svg>
                </button>
              `;
            }
          } else if (podeGerenciar) {
            // Pagador ou admin gerenciando o reembolso de outro morador
            const iconeToggle = isPago
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`
              : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

            acoesHtml = `
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
              <button type="button" class="btn-icone ${isPago ? '' : 'btn-icone-pix-pago'}" onclick="alternarStatusCotaDespesaExtra('${d.id}', '${p.usuario_id}', ${isPago})" title="${isPago ? 'Marcar como pendente' : 'Confirmar reembolso recebido'}" aria-label="${isPago ? 'Reverter' : 'Confirmar'}">
                ${iconeToggle}
              </button>
              <button type="button" class="btn-icone btn-icone-whatsapp" onclick="enviarCobrancaWhatsAppDespesaExtra('${d.id}', '${p.usuario_id}')" title="Cobrar ${escapeHtml(nomeMorador)} no WhatsApp" aria-label="WhatsApp">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
              </button>
            `;
          } else {
            // Outro morador olhando a cota alheia (ex: Maria olhando a cota do Pedro) -> NÃO VAI PAGAR POR ELE!
            acoesHtml = `
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
              <span class="espaco-acao-vazio" aria-hidden="true"></span>
            `;
          }

          return `
            <div class="linha">
              <div class="linha-com-avatar">
                ${gerarAvatarHtml(nomeMorador, p.usuario_id, 32, (mapaCoresParticipantes && mapaCoresParticipantes[p.usuario_id]))}
                <div>
                  <strong>${escapeHtml(nomeMorador)}${isEu ? " (você)" : ""}</strong><br/>
                  <span class="texto-suave">${formatarMoeda(p.valor_cota)}</span>
                </div>
              </div>
              <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <span class="badge ${badgeClasse}">${badgeTexto}</span>
                <div class="acoes-cobranca-grid">
                  ${acoesHtml}
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      const separadorEstilo = indexDespesa > 0
        ? "padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--cor-borda);"
        : "";

      return `
        <div class="item-despesa-extra-bloco" style="${separadorEstilo}">
          <div class="cabecalho-conta-ciclo" style="border-bottom: 1px solid var(--cor-borda); padding-bottom: 8px; margin-bottom: 4px;">
            <div class="cabecalho-conta-linha-topo">
              <h3 class="cabecalho-conta-titulo">
                <span>${escapeHtml(d.descricao)} — ${formatarMoeda(d.valor)}</span>
                <span class="badge neutro" style="font-size: 10px; font-weight: 600; padding: 2px 6px; margin-left: 6px;">
                  ${obterNomeCategoriaExtra(d.categoria)}
                </span>
              </h3>
              ${
                podeGerenciar
                  ? `<button type="button" class="btn-icone" style="color: var(--cor-perigo); width: 28px; height: 28px;" title="Excluir despesa" onclick="excluirDespesaExtra('${d.id}')">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>`
                  : ""
              }
            </div>
            <div class="cabecalho-conta-subtitulo" style="display: flex; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 6px;">
              <span>Data: ${dataFormatada} • Pago por <strong>${escapeHtml(pagadorNome)}${ehPagador ? " (você)" : ""}</strong></span>
              <span style="font-size: 11.5px; font-weight: 600; color: ${todasPagas ? "var(--cor-sucesso-texto, #059669)" : "var(--cor-texto-suave)"};">
                ${todasPagas ? "✓ Todos acertaram" : (totalReembolsar === 0 ? "Individual" : `${pagosReembolsos} de ${totalReembolsar} reembolsaram`)}
              </span>
            </div>
          </div>
          <div class="lista-linhas-despesa">
            ${cotasHtml}
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = html;
}

function enviarCobrancaWhatsAppDespesaExtra(despesaId, usuarioCotaId) {
  const despesa = (dadosDespesasExtrasCarregadas || []).find((d) => d.id === despesaId);
  if (!despesa) return;

  const participantes = despesa.despesas_avulsas_participantes || despesa.participantes || [];
  const cota = participantes.find((p) => p.usuario_id === usuarioCotaId);
  if (!cota) return;

  const moradorDevedor = (dadosMoradoresCasa || []).find((m) => m.id === usuarioCotaId) || cota.profiles || {};
  const nomeDevedor = moradorDevedor.nome || "Morador";
  const pagador = (dadosMoradoresCasa || []).find((m) => m.id === despesa.pago_por_id) || despesa.profiles || {};
  const pagadorNome = pagador.nome || "Morador";
  const valorFormatado = formatarMoeda(cota.valor_cota);

  let texto = `*Rachaê - Reembolso de Despesa*\n`;
  texto += `Olá, *${nomeDevedor}*!\n\n`;
  texto += `Passando para lembrar da sua parte da compra *${despesa.descricao}* paga por *${pagadorNome}*:\n`;
  texto += `*Valor do seu reembolso:* *${valorFormatado}*\n\n`;

  if (pagador.chave_pix) {
    const rotuloPix = typeof window.rotuloTipoPix === "function" ? window.rotuloTipoPix(pagador.tipo_chave_pix) : "Pix";
    texto += `*Chave Pix para transferir (${rotuloPix}):*\n\`\`\`${pagador.chave_pix}\`\`\`\n\n`;
  }

  texto += `Assim que fizer o Pix, avise por aqui para confirmarmos no Rachaê. Obrigado!`;

  const tel = moradorDevedor.telefone ? moradorDevedor.telefone.replace(/\D/g, "") : "";
  const waNum = tel.length === 10 || tel.length === 11 ? "55" + tel : tel;

  const url = waNum
    ? `https://wa.me/${waNum}?text=${encodeURIComponent(texto)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;

  window.open(url, "_blank");
}

function enviarAvisoWhatsAppDespesaExtra(despesaId, usuarioCotaId) {
  const despesa = (dadosDespesasExtrasCarregadas || []).find((d) => d.id === despesaId);
  if (!despesa) return;

  const participantes = despesa.despesas_avulsas_participantes || despesa.participantes || [];
  const cota = participantes.find((p) => p.usuario_id === (usuarioCotaId || usuarioAtualId));
  if (!cota) return;

  const pagador = (dadosMoradoresCasa || []).find((m) => m.id === despesa.pago_por_id) || despesa.profiles || {};
  const pagadorNome = pagador.nome || "Morador";
  const valorFormatado = formatarMoeda(cota.valor_cota);

  let texto = `*Rachaê - Reembolso Realizado*\n`;
  texto += `Olá, *${pagadorNome}*!\n\n`;
  texto += `Acabei de fazer a transferência via Pix de *${valorFormatado}* referente à minha parte da compra *${despesa.descricao}*.\n\n`;
  texto += `Pode confirmar no Rachaê quando cair. Obrigado!`;

  const tel = pagador.telefone ? pagador.telefone.replace(/\D/g, "") : "";
  const waNum = tel.length === 10 || tel.length === 11 ? "55" + tel : tel;

  const url = waNum
    ? `https://wa.me/${waNum}?text=${encodeURIComponent(texto)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;

  window.open(url, "_blank");
}

async function abrirModalNovaDespesaExtra() {
  const modal = document.getElementById("modal-despesa-extra");
  if (!modal) return;

  await carregarMoradoresCasa();

  // Preenche select do pagador
  const selPagoPor = document.getElementById("extra-pago-por");
  if (selPagoPor) {
    selPagoPor.innerHTML = dadosMoradoresCasa
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === usuarioAtualId ? "selected" : ""}>${escapeHtml(m.nome)}${m.id === usuarioAtualId ? " (Você)" : ""}</option>`
      )
      .join("");
  }

  // Preenche grid de checkboxes de participantes com avatars e check badges
  const gridParts = document.getElementById("grid-participantes-extra");
  if (gridParts) {
    gridParts.innerHTML = dadosMoradoresCasa
      .map((m) => {
        const partesNome = (m.nome || "M").trim().split(/\s+/);
        const iniciais = (partesNome[0][0] + (partesNome.length > 1 ? partesNome[partesNome.length - 1][0] : "")).toUpperCase();
        return `
        <label class="label-checkbox-morador selecionado" id="label-morador-${m.id}" title="${escapeHtml(m.nome)}">
          <input type="checkbox" name="extra_participante" value="${m.id}" checked onchange="atualizarCalculoCotaExtra()" />
          <div class="morador-avatar-mini">${escapeHtml(iniciais)}</div>
          <span class="morador-nome-texto">${escapeHtml(m.nome)}</span>
          <div class="morador-check-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </label>
      `;
      })
      .join("");
  }

  // Data padrão de hoje
  const inputData = document.getElementById("extra-data");
  if (inputData) {
    inputData.value = new Date().toISOString().split("T")[0];
  }

  // Limpa campos
  const inputDesc = document.getElementById("extra-descricao");
  if (inputDesc) inputDesc.value = "";
  const inputVal = document.getElementById("extra-valor");
  if (inputVal) {
    inputVal.value = "";
    if (!inputVal._cotaListenerAttached) {
      inputVal._cotaListenerAttached = true;
      inputVal.addEventListener("input", atualizarCalculoCotaExtra);
    }
  }

  atualizarCalculoCotaExtra();

  modal.style.display = "flex";
  if (window.Animacoes) {
    window.Animacoes.animarAberturaModal(modal, document.getElementById("card-modal-despesa-extra"));
  }
}

function alternarTodosParticipantesExtra() {
  const checkboxes = Array.from(document.querySelectorAll("input[name='extra_participante']"));
  if (checkboxes.length === 0) return;

  const todosMarcados = checkboxes.every((cb) => cb.checked);
  checkboxes.forEach((cb) => {
    cb.checked = !todosMarcados;
  });
  atualizarCalculoCotaExtra();
}

function atualizarCalculoCotaExtra() {
  const inputVal = document.getElementById("extra-valor");
  const labelCota = document.getElementById("label-valor-cota-extra");
  const subLabel = document.getElementById("cota-preview-participantes");
  const btnAlternar = document.getElementById("btn-alternar-todos-extra");

  const checkboxes = Array.from(document.querySelectorAll("input[name='extra_participante']"));
  checkboxes.forEach((cb) => {
    const parentLabel = document.getElementById(`label-morador-${cb.value}`);
    if (parentLabel) {
      if (cb.checked) parentLabel.classList.add("selecionado");
      else parentLabel.classList.remove("selecionado");
    }
  });

  const selecionados = checkboxes.filter((cb) => cb.checked);
  const total = Number(inputVal?.value || 0);

  if (btnAlternar) {
    const todosMarcados = checkboxes.length > 0 && selecionados.length === checkboxes.length;
    btnAlternar.textContent = todosMarcados ? "Desmarcar todos" : "Marcar todos";
  }

  if (subLabel) {
    if (selecionados.length === 0) {
      subLabel.textContent = "Nenhum participante selecionado";
      subLabel.style.color = "var(--cor-perigo, #ef4444)";
    } else {
      subLabel.textContent = `${selecionados.length} de ${checkboxes.length} morador${selecionados.length === 1 ? "" : "es"} dividindo`;
      subLabel.style.color = "var(--cor-texto-suave)";
    }
  }

  if (!labelCota) return;

  if (selecionados.length === 0 || total <= 0) {
    labelCota.textContent = "R$ 0,00";
    return;
  }

  const cotaMedia = total / selecionados.length;
  labelCota.textContent = `${formatarMoeda(cotaMedia)}`;
}

function fecharModalDespesaExtra() {
  const modal = document.getElementById("modal-despesa-extra");
  const card = document.getElementById("card-modal-despesa-extra");
  if (!modal) return;

  const fecharImediato = () => {
    modal.style.setProperty("display", "none", "important");
    modal.classList.remove("ativo");
  };

  if (window.Animacoes && typeof window.Animacoes.animarFechamentoModal === "function") {
    try {
      window.Animacoes.animarFechamentoModal(modal, card, fecharImediato);
    } catch (err) {
      console.warn("Erro ao fechar modal despesa extra:", err);
      fecharImediato();
    }
  } else {
    fecharImediato();
  }
}
window.fecharModalDespesaExtra = fecharModalDespesaExtra;

function fecharModalDespesaExtraPorOverlay(event) {
  if (event && event.target && event.target.id === "modal-despesa-extra") {
    fecharModalDespesaExtra();
  }
}
window.fecharModalDespesaExtraPorOverlay = fecharModalDespesaExtraPorOverlay;

async function salvarDespesaExtra(event) {
  event.preventDefault();
  const btnSalvar = document.getElementById("btn-salvar-extra");
  const descInput = document.getElementById("extra-descricao");
  const valInput = document.getElementById("extra-valor");
  const catInput = document.getElementById("extra-categoria");
  const pagoPorInput = document.getElementById("extra-pago-por");
  const dataInput = document.getElementById("extra-data");

  const descricao = descInput?.value?.trim();
  const valor = parseFloat(valInput?.value || "0");
  const categoria = catInput?.value || "outros";
  const pagoPorId = pagoPorInput?.value;
  const dataCompra = dataInput?.value || new Date().toISOString().split("T")[0];

  const checkboxes = Array.from(document.querySelectorAll("input[name='extra_participante']:checked"));
  const participantes = checkboxes.map((cb) => cb.value);

  if (!descricao) {
    mostrarToast("Informe a descrição da despesa.", "aviso");
    return;
  }
  if (!valor || valor <= 0) {
    mostrarToast("Informe um valor válido maior que zero.", "aviso");
    return;
  }
  if (!pagoPorId) {
    mostrarToast("Selecione quem pagou a compra.", "aviso");
    return;
  }
  if (participantes.length === 0) {
    mostrarToast("Selecione pelo menos um participante para dividir.", "aviso");
    return;
  }

  const textoOriginal = btnSalvar ? btnSalvar.innerHTML : "Salvar Despesa";
  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = `
      <svg class="anim-girar" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle>
      </svg>
      <span>Salvando...</span>
    `;
  }

  try {
    const mesReferencia = primeiroDiaDoMes();
    const { data, error } = await supabaseClient.rpc("criar_despesa_avulsa", {
      p_casa_id: casaId,
      p_descricao: descricao,
      p_valor: valor,
      p_categoria: categoria,
      p_pago_por_id: pagoPorId,
      p_data: dataCompra,
      p_mes_referencia: mesReferencia,
      p_participantes: participantes,
      p_comprovante_url: null,
    });

    if (error) throw error;

    mostrarToast("Despesa compartilhada registrada com sucesso!", "sucesso");
    fecharModalDespesaExtra();
    await carregarDespesasExtrasDoMes();
  } catch (err) {
    console.error("Erro ao salvar despesa compartilhada:", err);
    mostrarToast(err.message || "Erro ao registrar despesa compartilhada.", "erro");
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = textoOriginal;
    }
  }
}

async function alternarStatusCotaDespesaExtra(despesaId, usuarioId, statusAtual) {
  try {
    if (window.vibrar) window.vibrar(15);
    const novoStatus = !statusAtual;
    const { error } = await supabaseClient.rpc("alternar_status_cota_avulsa", {
      p_despesa_id: despesaId,
      p_usuario_id: usuarioId,
      p_pago: novoStatus,
    });

    if (error) throw error;

    mostrarToast(
      novoStatus ? "Reembolso confirmado com sucesso!" : "Cota marcada como pendente.",
      "sucesso"
    );
    await carregarDespesasExtrasDoMes();
  } catch (err) {
    console.error("Erro ao atualizar status da cota:", err);
    mostrarToast(err.message || "Não foi possível alterar o status do reembolso.", "erro");
  }
}

async function excluirDespesaExtra(despesaId) {
  const confirmou = await mostrarConfirmacao({
    titulo: "Excluir Despesa Compartilhada",
    mensagem: "Tem certeza que deseja excluir esta despesa compartilhada e todas as suas cotas de reembolso?",
    textoConfirmar: "Excluir Despesa",
    textoCancelar: "Cancelar",
    tipo: "perigo",
  });

  if (!confirmou) {
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("despesas_avulsas")
      .delete()
      .eq("id", despesaId);

    if (error) throw error;

    mostrarToast("Despesa compartilhada excluída com sucesso.", "sucesso");
    await carregarDespesasExtrasDoMes();
  } catch (err) {
    console.error("Erro ao excluir despesa compartilhada:", err);
    mostrarToast(err.message || "Erro ao excluir despesa.", "erro");
  }
}

function copiarPix(codigoEnc) {
  const codigo = decodeURIComponent(codigoEnc);
  navigator.clipboard.writeText(codigo);
  if (window.vibrar) window.vibrar(20);
  mostrarToast("Código Pix copiado!");

  if (window.Animacoes) {
    const btnAtivo = document.activeElement;
    if (btnAtivo && btnAtivo.tagName === "BUTTON") {
      window.Animacoes.animarPulseSucesso(btnAtivo);
    }
  }
}

// Modal Pix para Reembolso de Despesas Compartilhadas / Mercado
async function abrirModalPixDespesaExtra(despesaId, usuarioCotaId) {
  const modal = document.getElementById("modal-pix");
  const conteudo = document.getElementById("conteudo-modal-pix");
  if (!modal || !conteudo) return;

  const despesa = (dadosDespesasExtrasCarregadas || []).find((d) => d.id === despesaId);
  if (!despesa) {
    mostrarToast("Despesa não encontrada.", "aviso");
    return;
  }

  const participantes = despesa.despesas_avulsas_participantes || despesa.participantes || [];
  const cota = participantes.find((p) => p.usuario_id === (usuarioCotaId || usuarioAtualId)) || participantes[0];
  const valorCota = cota ? Number(cota.valor_cota || 0) : Number(despesa.valor || 0);

  // Busca o morador que pagou a despesa
  const pagador = (dadosMoradoresCasa || []).find((m) => m.id === despesa.pago_por_id) || despesa.profiles || {};
  const pagadorNome = pagador.nome || "Morador";
  const chaveDestino = pagador.chave_pix || null;
  const tipoChaveDestino = pagador.tipo_chave_pix || "telefone";
  const nomeBeneficiario = pagador.nome_titular_pix || pagadorNome;
  const bancoBeneficiario = pagador.banco_pix || null;

  modal.style.display = "flex";

  // Se o recebedor ainda não cadastrou chave Pix
  if (!chaveDestino) {
    const telDigitos = pagador.telefone ? pagador.telefone.replace(/\D/g, "") : "";
    const waNum = telDigitos.length === 10 || telDigitos.length === 11 ? "55" + telDigitos : telDigitos;
    const waMsg = encodeURIComponent(`Oi ${pagadorNome}! Qual é a sua chave Pix para eu transferir minha parte de ${formatarMoeda(valorCota)} de "${despesa.descricao}"?`);
    const waLink = waNum ? `https://wa.me/${waNum}?text=${waMsg}` : null;

    conteudo.innerHTML = `
      <div style="text-align: center; padding: 10px 0;">
        <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(245, 158, 11, 0.12); color: var(--cor-aviso); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3 style="margin: 0 0 6px; font-size: 16px;">Sem Chave Pix Cadastrada</h3>
        <p class="texto-suave" style="font-size: 13px; margin: 0 0 14px;">
          <strong>${escapeHtml(pagadorNome)}</strong> ainda não cadastrou a chave Pix no perfil.
        </p>
        <div style="background: var(--cor-fundo); border: 1px solid var(--cor-borda); border-radius: 10px; padding: 12px; margin-bottom: 14px; text-align: left;">
          <div style="font-size: 12px; color: var(--cor-texto-suave);">Despesa compartilhada:</div>
          <div style="font-size: 14px; font-weight: 700; color: var(--cor-texto); margin: 2px 0 4px;">${escapeHtml(despesa.descricao)}</div>
          <div style="font-size: 12px; color: var(--cor-texto-suave);">Valor da sua cota: <strong style="color: var(--cor-destaque); font-size: 15px;">${formatarMoeda(valorCota)}</strong></div>
        </div>
        ${
          waLink
            ? `<a href="${waLink}" target="_blank" rel="noopener noreferrer" class="botao pequeno btn-whatsapp" style="width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; padding: 10px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
                Pedir chave Pix no WhatsApp
              </a>`
            : `<p class="texto-suave" style="font-size: 12px;">Peça para ${escapeHtml(pagadorNome)} abrir o menu <strong>Meu Perfil</strong> no topo e cadastrar a chave Pix dele(a).</p>`
        }
      </div>
    `;
    return;
  }

  // Gera código Pix Copia e Cola Oficial (BR Code padrão BACEN / EMV)
  let payloadPix = "";
  if (window.gerarPayloadPix) {
    payloadPix = window.gerarPayloadPix({
      chave: chaveDestino,
      tipo: tipoChaveDestino,
      nome: nomeBeneficiario,
      cidade: "BRASIL",
      valor: valorCota,
      identificador: `EXTRA${despesa.id.replace(/-/g, "").substring(0, 8).toUpperCase()}`,
    });
  }

  // Gera imagem de QR Code localmente
  let qrCodeImg = "";
  if (payloadPix && typeof window.gerarQRCodeDataURL === "function") {
    try {
      qrCodeImg = window.gerarQRCodeDataURL(payloadPix, { tamanho: 240, margem: 4 });
    } catch (errQr) {
      console.warn("Aviso ao gerar QR Code localmente:", errQr);
    }
  }
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

  const rotuloChave = typeof window.rotuloTipoPix === "function" ? window.rotuloTipoPix(tipoChaveDestino) : tipoChaveDestino;
  const chaveFormatadaExibicao = typeof window.formatarChavePixGenerica === "function" ? window.formatarChavePixGenerica(chaveDestino, tipoChaveDestino) : chaveDestino;

  htmlPix += `
    <p class="texto-suave" style="margin: 2px 0 2px; font-size: 12.5px;">Reembolso de <strong>${escapeHtml(despesa.descricao)}</strong></p>
    <p class="texto-suave" style="margin-top:2px; font-size:13px;">Valor da sua parte: <strong style="font-size:18px; color:var(--cor-destaque);">${formatarMoeda(valorCota)}</strong></p>
    <p class="texto-suave" style="margin:2px 0 12px; font-size:12px;">Para: <strong>${escapeHtml(nomeBeneficiario)}</strong>${bancoBeneficiario ? ` (${escapeHtml(bancoBeneficiario)})` : ""}</p>
  `;

  if (payloadPix) {
    htmlPix += `
      <div style="background:var(--cor-fundo); border:1px solid var(--cor-borda); border-radius:8px; padding:10px; margin-bottom:10px; text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase;">Pix Copia e Cola Oficial</span>
          <span style="font-size:11px; color:var(--cor-destaque); font-weight:600;">Com valor exato</span>
        </div>
        <div class="copia-cola" style="max-height:50px; overflow-y:auto; word-break:break-all; font-size:11px;">${payloadPix}</div>
        <button type="button" class="secundario pequeno" style="width:100%; margin-top:8px !important;" onclick="copiarPix('${encodeURIComponent(payloadPix)}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:4px;">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copiar Código Pix
        </button>
      </div>
    `;
  }

  htmlPix += `
    <div style="background:var(--cor-fundo); border:1px solid var(--cor-borda); border-radius:8px; padding:10px; margin-bottom:10px; text-align:left;">
      <span style="font-size:11px; font-weight:700; color:var(--cor-texto-suave); text-transform:uppercase; display:block;">Chave Pix Direta (${escapeHtml(rotuloChave)})</span>
      <div style="font-size:15px; font-weight:700; color:var(--cor-texto); margin:4px 0 6px;">${escapeHtml(chaveFormatadaExibicao)}</div>
      <button type="button" class="secundario pequeno" style="width:100%; margin:0 !important;" onclick="copiarPix('${encodeURIComponent(chaveDestino)}')">
        Copiar Chave Pix (${escapeHtml(rotuloChave)})
      </button>
    </div>
  `;

  // Botão para avisar no WhatsApp após pagar
  const telDigitos = pagador.telefone ? pagador.telefone.replace(/\D/g, "") : "";
  const waNum = telDigitos.length === 10 || telDigitos.length === 11 ? "55" + telDigitos : telDigitos;
  if (waNum) {
    const waMsg = encodeURIComponent(`Oi ${pagadorNome}! Acabei de fazer o Pix de ${formatarMoeda(valorCota)} referente à minha parte de "${despesa.descricao}" no Rachaê!`);
    htmlPix += `
      <a href="https://wa.me/${waNum}?text=${waMsg}" target="_blank" rel="noopener noreferrer" class="botao pequeno btn-whatsapp" style="width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; padding: 8px 12px; margin-top: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Avisar ${escapeHtml(pagadorNome)} no WhatsApp
      </a>
    `;
  }

  htmlPix += `</div>`;
  conteudo.innerHTML = htmlPix;
}

// Exposição explícita para o escopo global (window)
window.inicializarDashboard = inicializarDashboard;
window.filtrarCobrancas = filtrarCobrancas;
window.abrirModalPixDespesaExtra = abrirModalPixDespesaExtra;
// ============================================================
// Anexar comprovante de pagamento (Supabase Storage, bucket privado)
// ============================================================
async function enviarComprovante(cobrancaId, inputEl) {
  const arquivo = inputEl.files && inputEl.files[0];
  if (!arquivo) return;

  if (arquivo.size > 8 * 1024 * 1024) {
    mostrarToast("O arquivo precisa ter até 8MB.", "alerta");
    return;
  }

  mostrarToast("Enviando comprovante...");

  const extensao = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
  const caminho = `${casaId}/${cobrancaId}-${Date.now()}.${extensao}`;

  const { error: erroUpload } = await supabaseClient.storage
    .from("comprovantes")
    .upload(caminho, arquivo, { upsert: false });

  if (erroUpload) {
    mostrarToast("Erro ao enviar comprovante: " + erroUpload.message, "alerta");
    return;
  }

  // Salva no banco via RPC segura com transição para 'em_analise'
  const { error: errRpc } = await supabaseClient.rpc("enviar_comprovante_cobranca", {
    p_cobranca_id: cobrancaId,
    p_caminho: caminho,
  });

  if (errRpc) {
    // Fallback caso a RPC ainda não esteja instalada no banco
    const { error: erroUpdate } = await supabaseClient
      .from("cobrancas_individuais")
      .update({ comprovante_url: caminho, status: "em_analise" })
      .eq("id", cobrancaId);

    if (erroUpdate) {
      mostrarToast("Comprovante enviado, mas houve erro ao salvar: " + erroUpdate.message, "alerta");
      return;
    }
  }

  mostrarToast("Comprovante enviado para análise do administrador!", "sucesso");
  limparCacheDashboard();
  await carregarCiclosDoMes();
  await abrirModalPix(cobrancaId);
}
window.enviarComprovante = enviarComprovante;

let comprovanteAtualUrl = null;
let comprovanteAtualNome = "comprovante";
let comprovanteZoomAtual = 1;

function aplicarZoomComprovante(novoZoom) {
  novoZoom = Math.min(3.5, Math.max(0.5, Math.round(novoZoom * 100) / 100));
  comprovanteZoomAtual = novoZoom;
  const img = document.getElementById("comprovante-preview-img");
  const label = document.getElementById("label-zoom-nivel");
  const canvas = document.getElementById("comprovante-zoom-canvas");
  const viewport = document.getElementById("comprovante-viewport");

  if (img) {
    img.style.transform = `scale(${comprovanteZoomAtual})`;
  }
  if (label) {
    label.textContent = `${Math.round(comprovanteZoomAtual * 100)}%`;
  }
  if (canvas) {
    if (comprovanteZoomAtual > 1) {
      const extraH = Math.round((comprovanteZoomAtual - 1) * 160);
      const extraV = Math.round((comprovanteZoomAtual - 1) * 120);
      canvas.style.padding = `${extraV}px ${extraH}px`;
    } else {
      canvas.style.padding = "0px";
    }
  }
  if (viewport) {
    viewport.style.cursor = comprovanteZoomAtual > 1 ? "grab" : "default";
  }
}

function alterarZoomComprovante(delta) {
  aplicarZoomComprovante(comprovanteZoomAtual + delta);
}

function resetarZoomComprovante() {
  aplicarZoomComprovante(1);
  const viewport = document.getElementById("comprovante-viewport");
  if (viewport) {
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }
}

function inicializarControlesZoom() {
  const viewport = document.getElementById("comprovante-viewport");
  const img = document.getElementById("comprovante-preview-img");
  if (!viewport || !img) return;

  // Alternar zoom com duplo clique / duplo toque
  img.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (comprovanteZoomAtual > 1.2) {
      resetarZoomComprovante();
    } else {
      aplicarZoomComprovante(2);
    }
  });

  // Zoom suave com roda do mouse
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    alterarZoomComprovante(delta);
  }, { passive: false });

  // Panning por arraste com mouse quando houver zoom
  let isDown = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;

  viewport.addEventListener("mousedown", (e) => {
    if (comprovanteZoomAtual <= 1) return;
    isDown = true;
    viewport.classList.add("arrastando");
    startX = e.pageX - viewport.offsetLeft;
    startY = e.pageY - viewport.offsetTop;
    scrollLeft = viewport.scrollLeft;
    scrollTop = viewport.scrollTop;
  });

  const stopDragging = () => {
    if (isDown) {
      isDown = false;
      viewport.classList.remove("arrastando");
    }
  };

  window.addEventListener("mouseup", stopDragging);

  viewport.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - viewport.offsetLeft;
    const y = e.pageY - viewport.offsetTop;
    const walkX = (x - startX) * 1.4;
    const walkY = (y - startY) * 1.4;
    viewport.scrollLeft = scrollLeft - walkX;
    viewport.scrollTop = scrollTop - walkY;
  });
}

async function verComprovante(caminho, nomeMorador = "") {
  if (!caminho) return;

  const modal = document.getElementById("modal-comprovante");
  const container = document.getElementById("conteudo-modal-comprovante");
  const btnBaixar = document.getElementById("btn-baixar-comprovante");
  const elSubtitulo = document.getElementById("comprovante-subtitulo");

  if (!modal || !container) {
    mostrarToast("Abrindo comprovante...");
    const { data } = await supabaseClient.storage.from("comprovantes").createSignedUrl(caminho, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    return;
  }

  // Prepara estado inicial de carregamento
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:36px 16px; min-height:200px;">
      <div class="skeleton-shimmer" style="width:44px; height:44px; border-radius:50%;"></div>
      <span class="texto-suave">Carregando visualização do comprovante...</span>
    </div>
  `;
  if (elSubtitulo) {
    elSubtitulo.textContent = nomeMorador ? `Comprovante de ${nomeMorador}` : "Visualização do arquivo anexado";
  }
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  try {
    let url = caminho;
    if (!caminho.startsWith("http://") && !caminho.startsWith("https://") && !caminho.startsWith("data:")) {
      const { data, error } = await supabaseClient.storage
        .from("comprovantes")
        .createSignedUrl(caminho, 3600); // 1 hora de validade

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || "Não foi possível gerar link do comprovante");
      }
      url = data.signedUrl;
    }

    const caminhoLimpo = caminho.split("?")[0].toLowerCase();
    const ehPdf = caminhoLimpo.endsWith(".pdf") || url.toLowerCase().includes(".pdf") || url.startsWith("data:application/pdf");

    const nomeBase = caminho.split("/").pop().split("?")[0] || (ehPdf ? "comprovante.pdf" : "comprovante.jpg");
    comprovanteAtualUrl = url;
    comprovanteAtualNome = nomeBase;

    if (btnBaixar) {
      btnBaixar.style.display = "inline-flex";
      btnBaixar.onclick = (e) => {
        e.preventDefault();
        baixarComprovanteAtual(url, nomeBase);
      };
    }

    if (ehPdf) {
      container.innerHTML = `
        <div style="width:100%; height:100%; display:flex; flex-direction:column; flex:1;">
          <iframe src="${url}#toolbar=1" class="comprovante-preview-iframe" title="Comprovante de pagamento em PDF"></iframe>
          <div style="padding:8px 12px; background:var(--cor-card); border-top:1px solid var(--cor-borda); display:flex; justify-content:space-between; align-items:center;">
            <span class="badge">Documento PDF</span>
            <a href="${url}" target="_blank" rel="noopener" class="texto-suave" style="text-decoration:underline;">Abrir em tela cheia</a>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="comprovante-zoom-container">
          <div class="comprovante-zoom-viewport" id="comprovante-viewport">
            <div class="comprovante-zoom-canvas" id="comprovante-zoom-canvas">
              <img id="comprovante-preview-img" src="${url}" alt="Comprovante de pagamento" class="comprovante-preview-img" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'comprovante-fallback-pdf\\'><p class=\\'texto-suave\\'>Não foi possível exibir a imagem diretamente. Use o botão Baixar abaixo.</p></div>';" />
            </div>
          </div>
          <div class="comprovante-zoom-toolbar">
            <button type="button" class="btn-zoom-controle" onclick="alterarZoomComprovante(-0.25)" title="Diminuir zoom" aria-label="Diminuir zoom">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button type="button" class="btn-zoom-controle" onclick="resetarZoomComprovante()" title="Redefinir tamanho" aria-label="Redefinir tamanho">
              <span class="label-zoom-nivel" id="label-zoom-nivel">100%</span>
            </button>
            <button type="button" class="btn-zoom-controle" onclick="alterarZoomComprovante(0.25)" title="Aumentar zoom" aria-label="Aumentar zoom">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
      comprovanteZoomAtual = 1;
      inicializarControlesZoom();
    }
  } catch (err) {
    console.error("Erro ao abrir comprovante:", err);
    container.innerHTML = `
      <div class="comprovante-fallback-pdf">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--cor-alerta)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p class="texto-suave" style="margin:0;">Não foi possível carregar a visualização do comprovante.</p>
      </div>
    `;
    if (btnBaixar) btnBaixar.style.display = "none";
    mostrarToast("Erro ao abrir comprovante.", "alerta");
  }
}

async function baixarComprovanteAtual(url, nomeArquivo) {
  if (!url) return;
  try {
    mostrarToast("Iniciando download...");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Falha na requisição");
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = nomeArquivo || "comprovante";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    mostrarToast("Comprovante baixado com sucesso!", "sucesso");
  } catch (e) {
    // Fallback nativo
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo || "comprovante";
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function fecharModalComprovante() {
  const modal = document.getElementById("modal-comprovante");
  if (modal) modal.style.display = "none";
  const container = document.getElementById("conteudo-modal-comprovante");
  if (container) container.innerHTML = "";
  document.body.style.overflow = "";
  comprovanteZoomAtual = 1;
}

function fecharModalComprovantePorOverlay(event) {
  if (event.target && event.target.id === "modal-comprovante") {
    fecharModalComprovante();
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("modal-comprovante");
    if (modal && modal.style.display !== "none") {
      fecharModalComprovante();
    }
  }
});

window.verComprovante = verComprovante;
window.baixarComprovanteAtual = baixarComprovanteAtual;
window.fecharModalComprovante = fecharModalComprovante;
window.fecharModalComprovantePorOverlay = fecharModalComprovantePorOverlay;
window.alterarZoomComprovante = alterarZoomComprovante;
window.resetarZoomComprovante = resetarZoomComprovante;
window.aplicarZoomComprovante = aplicarZoomComprovante;

window.abrirModalPix = abrirModalPix;
window.fecharModalPix = fecharModalPix;
window.copiarPix = copiarPix;
window.enviarCobrancaWhatsApp = enviarCobrancaWhatsApp;
window.exportarRelatorioMes = exportarRelatorioMes;
window.confirmarPagamentoSimulado = confirmarPagamentoSimulado;
window.reverterParaPendente = reverterParaPendente;
window.recusarComprovante = recusarComprovante;
window.renderizarCategoriasDoMes = renderizarCategoriasDoMes;
window.ajustarValorCiclo = ajustarValorCiclo;
window.enviarResumoGrupoWhatsApp = enviarResumoGrupoWhatsApp;
window.limparCacheDashboard = limparCacheDashboard;

window.carregarMoradoresCasa = carregarMoradoresCasa;
window.carregarDespesasExtrasDoMes = carregarDespesasExtrasDoMes;
window.renderizarDespesasExtrasNaTela = renderizarDespesasExtrasNaTela;
window.abrirModalNovaDespesaExtra = abrirModalNovaDespesaExtra;
window.alternarTodosParticipantesExtra = alternarTodosParticipantesExtra;
window.atualizarCalculoCotaExtra = atualizarCalculoCotaExtra;
window.fecharModalDespesaExtra = fecharModalDespesaExtra;
window.fecharModalDespesaExtraPorOverlay = fecharModalDespesaExtraPorOverlay;
window.salvarDespesaExtra = salvarDespesaExtra;
window.alternarStatusCotaDespesaExtra = alternarStatusCotaDespesaExtra;
window.excluirDespesaExtra = excluirDespesaExtra;
window.copiarResumoPendentesGrupo = copiarResumoPendentesGrupo;
window.enviarCobrancaWhatsAppDespesaExtra = enviarCobrancaWhatsAppDespesaExtra;
window.enviarAvisoWhatsAppDespesaExtra = enviarAvisoWhatsAppDespesaExtra;
window.solicitarPermissaoNotificacoes = solicitarPermissaoNotificacoes;
window.atualizarBotaoNotificacoesUI = atualizarBotaoNotificacoesUI;

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
