// ============================================================
// Gestão de contas fixas da casa atual (Listagem, Criação e Edição)
// Com Cache-First (SWR) para carregamento instantâneo em 0ms
// ============================================================

(() => {
let casaId = null;
let papelUsuario = "morador";
let listaContasAtuais = [];
let listaMembrosCasa = [];

const MESES_NOMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function obterMesFormatadoYYYYMM(data = new Date()) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function obterNomeMesAno(yyyymm) {
  if (!yyyymm) return "";
  const partes = yyyymm.split("-");
  const ano = partes[0];
  const mesIdx = parseInt(partes[1], 10) - 1;
  return `${MESES_NOMES[mesIdx]} de ${ano}`;
}

async function inicializarContas() {
  const session = await exigirLogin();
  if (!session) return;

  casaId = localStorage.getItem("casa_atual");
  if (!casaId) {
    window.location.href = "casa.html";
    return;
  }

  papelUsuario = await obterPapelUsuarioNaCasa(casaId, session.user.id);
  configurarPermissoesInterface();

  if (window.Animacoes && !window.InstantNav?.emNavegacao) {
    window.Animacoes.animarEntradaPagina(".card, .card-metrica");
  }

  await carregarMembrosCasa();
  configurarSeletorInicio();
  configurarSeletorDivisao();

  configurarFormNovaConta();
  configurarFormEditar();
  configurarFormPixCasa();
  configurarModalEventos();

  await carregarContas();
  await carregarPixCasa();
}

window.inicializarContas = inicializarContas;

function configurarPermissoesInterface() {
  const cardNova = document.getElementById("card-nova-conta");
  const aviso = document.getElementById("aviso-permissao-contas");
  const formPix = document.getElementById("form-pix-casa");
  const visPix = document.getElementById("visualizacao-pix-morador");

  if (papelUsuario === "admin") {
    if (cardNova) cardNova.style.display = "block";
    if (aviso) aviso.style.display = "none";
    if (formPix) formPix.style.display = "block";
    if (visPix) visPix.style.display = "none";
  } else {
    if (cardNova) cardNova.style.display = "none";
    if (aviso) aviso.style.display = "flex";
    if (formPix) formPix.style.display = "none";
    if (visPix) visPix.style.display = "block";
  }
}

async function carregarMembrosCasa() {
  try {
    const { data: membros } = await supabaseClient
      .from("membros_casa")
      .select("usuario_id, papel, profiles ( id, nome )")
      .eq("casa_id", casaId);

    listaMembrosCasa = (membros || []).map((m) => ({
      usuario_id: m.usuario_id,
      nome: m.profiles?.nome || "Morador",
    }));

    preencherSelectsMoradores();
  } catch (err) {
    console.warn("Erro ao carregar moradores para contas:", err);
  }
}

function preencherSelectsMoradores() {
  const selectNovo = document.getElementById("morador-especifico");
  const selectEdit = document.getElementById("edit-morador-especifico");

  const optionsHtml =
    listaMembrosCasa.length === 0
      ? `<option value="">Nenhum morador cadastrado</option>`
      : `<option value="">Selecione o morador...</option>` +
        listaMembrosCasa.map((m) => `<option value="${m.usuario_id}">${m.nome}</option>`).join("");

  if (selectNovo) selectNovo.innerHTML = optionsHtml;
  if (selectEdit) selectEdit.innerHTML = optionsHtml;
}

function configurarSeletorInicio() {
  const hoje = new Date();
  const mesAtual = obterMesFormatadoYYYYMM(hoje);
  const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);

  // Nova conta
  const optAtual = document.getElementById("opt-mes-atual");
  const optProx = document.getElementById("opt-mes-proximo");
  const selectQuando = document.getElementById("quando-iniciar");
  const blocoCustom = document.getElementById("bloco-mes-inicio-personalizado");
  const inputCustom = document.getElementById("mes-inicio");

  if (optAtual) optAtual.textContent = `A partir deste mês (${MESES_NOMES[hoje.getMonth()]}/${hoje.getFullYear()})`;
  if (optProx) optProx.textContent = `A partir do próximo mês (${MESES_NOMES[prox.getMonth()]}/${prox.getFullYear()})`;
  if (inputCustom) inputCustom.value = mesAtual;

  if (selectQuando && blocoCustom) {
    selectQuando.onchange = () => {
      blocoCustom.style.display = selectQuando.value === "personalizado" ? "block" : "none";
    };
  }

  // Editar conta
  const editOptAtual = document.getElementById("edit-opt-mes-atual");
  const editOptProx = document.getElementById("edit-opt-mes-proximo");
  const editSelectQuando = document.getElementById("edit-quando-iniciar");
  const editBlocoCustom = document.getElementById("edit-bloco-mes-inicio-personalizado");

  if (editOptAtual) editOptAtual.textContent = `A partir deste mês (${MESES_NOMES[hoje.getMonth()]}/${hoje.getFullYear()})`;
  if (editOptProx) editOptProx.textContent = `A partir do próximo mês (${MESES_NOMES[prox.getMonth()]}/${prox.getFullYear()})`;

  if (editSelectQuando && editBlocoCustom) {
    editSelectQuando.onchange = () => {
      editBlocoCustom.style.display = editSelectQuando.value === "personalizado" ? "block" : "none";
    };
  }
}

function configurarSeletorDivisao() {
  const formaSelect = document.getElementById("forma-divisao");
  const blocoEspecifico = document.getElementById("bloco-morador-especifico");
  if (formaSelect && blocoEspecifico) {
    formaSelect.onchange = () => {
      blocoEspecifico.style.display = formaSelect.value === "individual" ? "block" : "none";
    };
  }

  const editFormaSelect = document.getElementById("edit-forma-divisao");
  const editBlocoEspecifico = document.getElementById("edit-bloco-morador-especifico");
  if (editFormaSelect && editBlocoEspecifico) {
    editFormaSelect.onchange = () => {
      editBlocoEspecifico.style.display = editFormaSelect.value === "individual" ? "block" : "none";
    };
  }
}

function renderizarContasNaTela(contas, animar = false) {
  const container = document.getElementById("lista-contas");
  if (!container) return;

  if (!contas || contas.length === 0) {
    container.innerHTML = `<p class="vazio">Nenhuma conta fixa cadastrada ainda.</p>`;
    return;
  }

  const ehAdmin = papelUsuario === "admin";

  const hojeYYYYMM = obterMesFormatadoYYYYMM();

  container.innerHTML = contas
    .map(
      (c) => {
        const comecaFuturo = c.mes_inicio && c.mes_inicio.slice(0, 7) > hojeYYYYMM;
        const tagInicio = comecaFuturo
          ? `<span class="badge" style="font-size: 11px; background: #e0f2fe; color: #0369a1; border-color: #bae6fd; font-weight: 600; margin-left: 6px;">Começa em ${obterNomeMesAno(c.mes_inicio.slice(0, 7))}</span>`
          : "";

        return `
      <div class="linha">
        <div>
          <strong>${c.nome}</strong>${tagInicio}<br/>
          <span class="texto-suave">
            ${formatarMoeda(c.valor_padrao)}
            ${c.tipo_valor === "variavel" ? "(variável)" : ""}
            · vence dia ${c.dia_vencimento}
            · divisão: ${textoFormaDivisao(c)}
          </span>
        </div>
        ${
          ehAdmin
            ? `
          <div class="acoes-linha">
            <button class="btn-icone" onclick="abrirModalEditar('${c.id}')" title="Editar conta" aria-label="Editar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
            <button class="btn-icone btn-icone-perigo" onclick="desativarConta('${c.id}')" title="Remover conta" aria-label="Remover">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        `
            : ""
        }
      </div>
    `;
      }
    )
    .join("");

  if (animar && window.Animacoes) {
    window.Animacoes.animarListaLinhas("#lista-contas .linha");
  }
}

async function carregarContas() {
  const container = document.getElementById("lista-contas");
  if (!container) return;

  const cacheKey = `cache_contas_${casaId}`;
  const cacheTotalKey = `cache_contas_total_${casaId}`;
  const cacheQtdKey = `cache_contas_qtd_${casaId}`;

  // 1. CARREGAMENTO INSTANTÂNEO (Cache local - 0ms de espera)
  const cachedContas = sessionStorage.getItem(cacheKey);
  if (cachedContas) {
    try {
      const parsed = JSON.parse(cachedContas);
      listaContasAtuais = parsed;
      const totalSalvo = Number(sessionStorage.getItem(cacheTotalKey)) || 0;
      const qtdSalva = Number(sessionStorage.getItem(cacheQtdKey)) || 1;

      const totalEl = document.getElementById("orcamento-total");
      const mediaEl = document.getElementById("orcamento-media");
      if (totalEl) totalEl.textContent = formatarMoeda(totalSalvo);
      if (mediaEl) mediaEl.textContent = `${formatarMoeda(totalSalvo / qtdSalva)} por morador (${qtdSalva} morador${qtdSalva === 1 ? "" : "es"})`;

      renderizarContasNaTela(parsed, false);
    } catch (e) {}
  }

  // 2. Busca fresca do banco em background
  const { data: contas, error } = await supabaseClient
    .from("contas_fixas")
    .select("*")
    .eq("casa_id", casaId)
    .eq("ativa", true)
    .order("dia_vencimento", { ascending: true });

  if (error) {
    if (!cachedContas) {
      container.innerHTML = `<p class="erro">Erro ao carregar contas.</p>`;
    }
    return;
  }

  listaContasAtuais = contas || [];

  // Calcular orçamento fixo previsto e média por morador considerando apenas contas vigentes no mês atual
  const hojeYYYYMM = obterMesFormatadoYYYYMM();
  const contasVigentesHoje = listaContasAtuais.filter((c) => {
    if (!c.mes_inicio) return true;
    return hojeYYYYMM >= c.mes_inicio.slice(0, 7);
  });
  const totalFixo = contasVigentesHoje.reduce((acc, c) => acc + Number(c.valor_padrao || 0), 0);

  const { data: membros } = await supabaseClient
    .from("membros_casa")
    .select("id")
    .eq("casa_id", casaId);

  const qtdMoradores = membros && membros.length > 0 ? membros.length : 1;
  const mediaPorMorador = totalFixo / qtdMoradores;

  // Atualiza cache em sessionStorage
  const novoContasJson = JSON.stringify(listaContasAtuais);
  const dadosMudaram = !cachedContas || cachedContas !== novoContasJson;

  sessionStorage.setItem(cacheKey, novoContasJson);
  sessionStorage.setItem(cacheTotalKey, String(totalFixo));
  sessionStorage.setItem(cacheQtdKey, String(qtdMoradores));

  if (dadosMudaram) {
    const totalEl = document.getElementById("orcamento-total");
    const mediaEl = document.getElementById("orcamento-media");
    if (totalEl) {
      if (window.Animacoes && !cachedContas) {
        window.Animacoes.animarNumeroMoeda(totalEl, totalFixo);
      } else {
        totalEl.textContent = formatarMoeda(totalFixo);
      }
    }
    if (mediaEl) {
      mediaEl.textContent = `${formatarMoeda(mediaPorMorador)} por morador (${qtdMoradores} morador${qtdMoradores === 1 ? "" : "es"})`;
    }

    renderizarContasNaTela(listaContasAtuais, !cachedContas);
  }
}

function textoFormaDivisao(conta) {
  if (typeof conta === "object" && conta !== null) {
    if (conta.forma_divisao === "individual") {
      const morador = listaMembrosCasa.find((m) => m.usuario_id === conta.morador_especifico_id);
      return `exclusiva para ${morador ? morador.nome : "morador específico"}`;
    }
    return { igual: "igual para todos", peso: "por peso", fixo: "valor fixo" }[conta.forma_divisao] || conta.forma_divisao;
  }
  return { igual: "igual para todos", peso: "por peso", fixo: "valor fixo", individual: "individual" }[conta] || conta;
}

// --- MODAL DE EDIÇÃO ---
function abrirModalEditar(contaId) {
  if (papelUsuario !== "admin") {
    mostrarToast("Apenas o administrador pode editar contas.", "alerta");
    return;
  }

  const conta = listaContasAtuais.find((c) => c.id === contaId);
  if (!conta) return;

  document.getElementById("edit-id").value = conta.id;
  document.getElementById("edit-nome").value = conta.nome;
  document.getElementById("edit-valor").value = conta.valor_padrao;
  document.getElementById("edit-tipo-valor").value = conta.tipo_valor || "fixo";
  document.getElementById("edit-dia-vencimento").value = conta.dia_vencimento;
  document.getElementById("edit-forma-divisao").value = conta.forma_divisao || "igual";
  document.getElementById("msg-editar-conta").textContent = "";

  // Configura campo de morador específico
  const editBlocoMorador = document.getElementById("edit-bloco-morador-especifico");
  const editSelectMorador = document.getElementById("edit-morador-especifico");
  if (editBlocoMorador && editSelectMorador) {
    if (conta.forma_divisao === "individual") {
      editBlocoMorador.style.display = "block";
      editSelectMorador.value = conta.morador_especifico_id || "";
    } else {
      editBlocoMorador.style.display = "none";
      editSelectMorador.value = "";
    }
  }

  // Configura seletor de mês de início
  const editSelectQuando = document.getElementById("edit-quando-iniciar");
  const editBlocoCustom = document.getElementById("edit-bloco-mes-inicio-personalizado");
  const editInputCustom = document.getElementById("edit-mes-inicio");

  const hoje = new Date();
  const mesAtual = obterMesFormatadoYYYYMM(hoje);
  const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const mesProx = obterMesFormatadoYYYYMM(prox);

  if (conta.mes_inicio) {
    const inicioLimpo = conta.mes_inicio.slice(0, 7);
    if (inicioLimpo === mesAtual) {
      if (editSelectQuando) editSelectQuando.value = "atual";
      if (editBlocoCustom) editBlocoCustom.style.display = "none";
      if (editInputCustom) editInputCustom.value = mesAtual;
    } else if (inicioLimpo === mesProx) {
      if (editSelectQuando) editSelectQuando.value = "proximo";
      if (editBlocoCustom) editBlocoCustom.style.display = "none";
      if (editInputCustom) editInputCustom.value = mesProx;
    } else {
      if (editSelectQuando) editSelectQuando.value = "personalizado";
      if (editBlocoCustom) editBlocoCustom.style.display = "block";
      if (editInputCustom) editInputCustom.value = inicioLimpo;
    }
  } else {
    if (editSelectQuando) editSelectQuando.value = "atual";
    if (editBlocoCustom) editBlocoCustom.style.display = "none";
    if (editInputCustom) editInputCustom.value = mesAtual;
  }

  const modal = document.getElementById("modal-editar-conta");
  if (modal) modal.style.display = "flex";
}

function fecharModalEditar() {
  const modal = document.getElementById("modal-editar-conta");
  if (modal) modal.style.display = "none";
}

function configurarModalEventos() {
  const modal = document.getElementById("modal-editar-conta");
  if (!modal) return;

  modal.onclick = (e) => {
    if (e.target === modal) fecharModalEditar();
  };

  document.onkeydown = (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") fecharModalEditar();
  };
}

function configurarFormEditar() {
  const formEdit = document.getElementById("form-editar-conta");
  if (!formEdit) return;

  formEdit.onsubmit = async (e) => {
    e.preventDefault();
    if (papelUsuario !== "admin") {
      mostrarToast("Apenas o administrador pode salvar alterações.", "alerta");
      return;
    }

    const msg = document.getElementById("msg-editar-conta");
    msg.className = "";
    msg.textContent = "Salvando alterações...";

    const id = document.getElementById("edit-id").value;
    const nome = document.getElementById("edit-nome").value.trim();
    const valor = parseFloat(document.getElementById("edit-valor").value);
    const tipoValor = document.getElementById("edit-tipo-valor").value;
    const diaVencimento = parseInt(document.getElementById("edit-dia-vencimento").value, 10);
    const formaDivisao = document.getElementById("edit-forma-divisao").value;

    let moradorEspecificoId = null;
    if (formaDivisao === "individual") {
      moradorEspecificoId = document.getElementById("edit-morador-especifico").value || null;
      if (!moradorEspecificoId) {
        msg.className = "erro";
        msg.textContent = "Por favor, selecione quem é o morador responsável.";
        return;
      }
    }

    const editQuando = document.getElementById("edit-quando-iniciar").value;
    let mesInicio = null;
    const hoje = new Date();
    if (editQuando === "atual") {
      mesInicio = obterMesFormatadoYYYYMM(hoje);
    } else if (editQuando === "proximo") {
      const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
      mesInicio = obterMesFormatadoYYYYMM(prox);
    } else {
      mesInicio = document.getElementById("edit-mes-inicio").value || obterMesFormatadoYYYYMM(hoje);
    }

    const updatePayload = {
      nome,
      valor_padrao: valor,
      tipo_valor: tipoValor,
      diaVencimento: diaVencimento,
      dia_vencimento: diaVencimento,
      forma_divisao: formaDivisao,
      mes_inicio: mesInicio,
      morador_especifico_id: moradorEspecificoId,
    };
    delete updatePayload.diaVencimento;

    let { error } = await supabaseClient
      .from("contas_fixas")
      .update(updatePayload)
      .eq("id", id);

    if (error && (error.message?.includes("column") || error.message?.includes("constraint"))) {
      console.warn("Fallback de atualização sem mes_inicio/morador_especifico_id:", error);
      const fallbackPayload = {
        nome,
        valor_padrao: valor,
        tipo_valor: tipoValor,
        dia_vencimento: diaVencimento,
        forma_divisao: formaDivisao === "individual" ? "igual" : formaDivisao,
      };
      const resFallback = await supabaseClient.from("contas_fixas").update(fallbackPayload).eq("id", id);
      if (!resFallback.error) {
        mostrarToast("Alterações salvas! Lembre-se de rodar a migração SQL no Supabase para ativar a divisão individual.", "alerta");
        error = null;
      }
    }

    if (error) {
      msg.className = "erro";
      msg.textContent = "Erro ao atualizar: " + error.message;
      return;
    }

    // Invalida cache
    sessionStorage.removeItem(`cache_contas_${casaId}`);
    limparCacheDashboard();

    fecharModalEditar();
    mostrarToast("Conta atualizada com sucesso!");
    await carregarContas();
  };
}

async function desativarConta(contaId) {
  if (papelUsuario !== "admin") {
    mostrarToast("Apenas o administrador pode remover contas.", "alerta");
    return;
  }

  const confirmado = await mostrarConfirmacao({
    titulo: "Remover Conta Fixa",
    mensagem: "Tem certeza que deseja remover esta conta fixa? Ela deixará de gerar cobranças futuras.",
    textoConfirmar: "Remover Conta",
    textoCancelar: "Cancelar",
    tipo: "perigo",
  });
  if (!confirmado) return;

  const { error } = await supabaseClient
    .from("contas_fixas")
    .update({ ativa: false })
    .eq("id", contaId);

  if (!error) {
    sessionStorage.removeItem(`cache_contas_${casaId}`);
    limparCacheDashboard();
    mostrarToast("Conta removida com sucesso.");
    await carregarContas();
  }
}

function configurarFormNovaConta() {
  const form = document.getElementById("form-nova-conta");
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (papelUsuario !== "admin") {
      mostrarToast("Apenas o administrador pode cadastrar contas.", "alerta");
      return;
    }

    const msg = document.getElementById("msg-nova-conta");
    msg.className = "";
    msg.textContent = "Salvando...";

    const nome = document.getElementById("nome").value.trim();
    const valor = parseFloat(document.getElementById("valor").value);
    const tipoValor = document.getElementById("tipo-valor").value;
    const diaVencimento = parseInt(document.getElementById("dia-vencimento").value, 10);
    const formaDivisao = document.getElementById("forma-divisao").value;

    let moradorEspecificoId = null;
    if (formaDivisao === "individual") {
      moradorEspecificoId = document.getElementById("morador-especifico").value || null;
      if (!moradorEspecificoId) {
        msg.className = "erro";
        msg.textContent = "Por favor, selecione quem é o morador responsável.";
        return;
      }
    }

    const selectQuando = document.getElementById("quando-iniciar").value;
    let mesInicio = null;
    const hoje = new Date();
    if (selectQuando === "atual") {
      mesInicio = obterMesFormatadoYYYYMM(hoje);
    } else if (selectQuando === "proximo") {
      const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
      mesInicio = obterMesFormatadoYYYYMM(prox);
    } else {
      mesInicio = document.getElementById("mes-inicio").value || obterMesFormatadoYYYYMM(hoje);
    }

    const payload = {
      casa_id: casaId,
      nome,
      valor_padrao: valor,
      tipo_valor: tipoValor,
      dia_vencimento: diaVencimento,
      forma_divisao: formaDivisao,
      mes_inicio: mesInicio,
      morador_especifico_id: moradorEspecificoId,
    };

    let { error } = await supabaseClient
      .from("contas_fixas")
      .insert(payload)
      .select()
      .single();

    if (error && (error.message?.includes("column") || error.message?.includes("constraint"))) {
      console.warn("Fallback de insert sem mes_inicio/morador_especifico_id:", error);
      const fallbackPayload = {
        casa_id: casaId,
        nome,
        valor_padrao: valor,
        tipo_valor: tipoValor,
        dia_vencimento: diaVencimento,
        forma_divisao: formaDivisao === "individual" ? "igual" : formaDivisao,
      };
      const resFallback = await supabaseClient.from("contas_fixas").insert(fallbackPayload).select().single();
      if (!resFallback.error) {
        mostrarToast("Conta adicionada! Lembre-se de rodar a migração SQL no Supabase para ativar a divisão individual.", "alerta");
        error = null;
      }
    }

    if (error) {
      msg.className = "erro";
      msg.textContent = "Erro ao salvar: " + error.message;
      return;
    }

    sessionStorage.removeItem(`cache_contas_${casaId}`);
    limparCacheDashboard();

    msg.textContent = "";
    form.reset();

    // Restaura padrões de início e divisão
    configurarSeletorInicio();
    const blocoMorador = document.getElementById("bloco-morador-especifico");
    if (blocoMorador) blocoMorador.style.display = "none";

    mostrarToast("Conta adicionada com sucesso!");
    await carregarContas();
  };
}

// ============================================================
// Configuração da Chave Pix da Casa
// ============================================================
function renderizarPixNaTela(casa) {
  const badge = document.getElementById("badge-pix-tipo");
  const txtMorador = document.getElementById("txt-pix-morador");
  const selectTipo = document.getElementById("pix-tipo");
  const inputChave = document.getElementById("pix-chave");

  if (casa && casa.chave_pix) {
    if (badge) {
      badge.textContent = rotuloTipoPix(casa.tipo_chave_pix);
      badge.style.display = "inline-flex";
      badge.className = "badge pago";
    }
    if (selectTipo) selectTipo.value = casa.tipo_chave_pix || "telefone";
    if (inputChave) {
      let chaveFormatada = casa.chave_pix;
      if (casa.tipo_chave_pix === "telefone") chaveFormatada = formatarTelefonePix(casa.chave_pix);
      else if (casa.tipo_chave_pix === "cpf") chaveFormatada = formatarCpfPix(casa.chave_pix);
      else if (casa.tipo_chave_pix === "cnpj") chaveFormatada = formatarCnpjPix(casa.chave_pix);
      inputChave.value = chaveFormatada;
    }
    if (txtMorador) {
      let chaveFormatada = casa.chave_pix;
      if (casa.tipo_chave_pix === "telefone") chaveFormatada = formatarTelefonePix(casa.chave_pix);
      else if (casa.tipo_chave_pix === "cpf") chaveFormatada = formatarCpfPix(casa.chave_pix);
      else if (casa.tipo_chave_pix === "cnpj") chaveFormatada = formatarCnpjPix(casa.chave_pix);
      txtMorador.textContent = `${chaveFormatada} (${rotuloTipoPix(casa.tipo_chave_pix)})`;
    }
  } else {
    if (badge) {
      badge.textContent = "Não configurada";
      badge.style.display = "inline-flex";
      badge.className = "badge pendente";
    }
    if (txtMorador) {
      txtMorador.textContent = "Nenhuma chave Pix cadastrada pelo administrador.";
    }
  }
}

async function carregarPixCasa() {
  const cachePixKey = `cache_pix_${casaId}`;

  // Renderiza do cache instantaneamente se existir
  const cachedPix = sessionStorage.getItem(cachePixKey);
  if (cachedPix) {
    try {
      renderizarPixNaTela(JSON.parse(cachedPix));
    } catch (e) {}
  }

  try {
    const { data: casa } = await supabaseClient
      .from("casas")
      .select("chave_pix, tipo_chave_pix")
      .eq("id", casaId)
      .maybeSingle();

    if (casa) {
      sessionStorage.setItem(cachePixKey, JSON.stringify(casa));
      renderizarPixNaTela(casa);
    }
  } catch (e) {
    console.warn("Erro ao carregar Pix da casa:", e);
  }
}

function rotuloTipoPix(tipo) {
  const map = {
    telefone: "Telefone",
    cpf: "CPF",
    cnpj: "CNPJ",
    email: "E-mail",
    aleatoria: "Aleatória",
  };
  return map[tipo] || "Pix";
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

function validarCPF(cpf) {
  const limpo = cpf.replace(/\D/g, "");
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo.charAt(i), 10) * (10 - i);
  let resto = 11 - (soma % 11);
  let digito1 = resto >= 10 ? 0 : resto;
  if (digito1 !== parseInt(limpo.charAt(9), 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo.charAt(i), 10) * (11 - i);
  resto = 11 - (soma % 11);
  let digito2 = resto >= 10 ? 0 : resto;
  return digito2 === parseInt(limpo.charAt(10), 10);
}

function validarCNPJ(cnpj) {
  const limpo = cnpj.replace(/\D/g, "");
  if (limpo.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(limpo)) return false;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(limpo.charAt(i), 10) * pesos1[i];
  let resto = soma % 11;
  let dig1 = resto < 2 ? 0 : 11 - resto;
  if (dig1 !== parseInt(limpo.charAt(12), 10)) return false;
  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(limpo.charAt(i), 10) * pesos2[i];
  resto = soma % 11;
  let dig2 = resto < 2 ? 0 : 11 - resto;
  return dig2 === parseInt(limpo.charAt(13), 10);
}

function validarEmailPix(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validarTelefonePix(tel) {
  const d = tel.replace(/\D/g, "");
  return d.length === 10 || d.length === 11;
}

function validarAleatoriaPix(chave) {
  const limpa = chave.trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(limpa) || limpa.length >= 32;
}

function configurarFormPixCasa() {
  const form = document.getElementById("form-pix-casa");
  const selectTipo = document.getElementById("pix-tipo");
  const inputChave = document.getElementById("pix-chave");
  const hintChave = document.getElementById("hint-pix-chave");
  const msg = document.getElementById("msg-pix-casa");

  if (!form) return;

  const aplicarAjusteTipo = () => {
    if (!selectTipo || !inputChave) return;
    const tipo = selectTipo.value;
    if (tipo === "telefone") {
      inputChave.placeholder = "(00) 00000-0000";
      inputChave.type = "tel";
      if (hintChave) hintChave.textContent = "Digite o DDD e o número de celular ou fixo.";
      inputChave.value = formatarTelefonePix(inputChave.value);
    } else if (tipo === "cpf") {
      inputChave.placeholder = "000.000.000-00";
      inputChave.type = "text";
      if (hintChave) hintChave.textContent = "Digite os 11 dígitos do CPF do titular da conta.";
      inputChave.value = formatarCpfPix(inputChave.value);
    } else if (tipo === "cnpj") {
      inputChave.placeholder = "00.000.000/0000-00";
      inputChave.type = "text";
      if (hintChave) hintChave.textContent = "Digite os 14 dígitos do CNPJ.";
      inputChave.value = formatarCnpjPix(inputChave.value);
    } else if (tipo === "email") {
      inputChave.placeholder = "exemplo@email.com";
      inputChave.type = "email";
      if (hintChave) hintChave.textContent = "Digite o e-mail cadastrado como chave no banco.";
      inputChave.value = inputChave.value.trim().toLowerCase();
    } else {
      inputChave.placeholder = "Chave aleatória UUID";
      inputChave.type = "text";
      if (hintChave) hintChave.textContent = "Cole a chave aleatória gerada pelo aplicativo do banco.";
      inputChave.value = inputChave.value.trim();
    }
  };

  if (selectTipo && inputChave) {
    selectTipo.onchange = aplicarAjusteTipo;

    inputChave.oninput = () => {
      const tipo = selectTipo.value;
      if (tipo === "telefone") {
        inputChave.value = formatarTelefonePix(inputChave.value);
      } else if (tipo === "cpf") {
        inputChave.value = formatarCpfPix(inputChave.value);
      } else if (tipo === "cnpj") {
        inputChave.value = formatarCnpjPix(inputChave.value);
      } else if (tipo === "email") {
        inputChave.value = inputChave.value.toLowerCase().replace(/\s/g, "");
      }
    };
  }

  aplicarAjusteTipo();

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (papelUsuario !== "admin") {
      mostrarToast("Apenas o administrador pode alterar a chave Pix da casa.", "alerta");
      return;
    }

    const tipo = selectTipo.value;
    const chave = inputChave.value.trim();

    if (!chave) {
      mostrarToast("Informe a chave Pix.", "alerta");
      inputChave.focus();
      return;
    }

    // Validação estrita por tipo de chave
    if (tipo === "telefone" && !validarTelefonePix(chave)) {
      mostrarToast("Telefone inválido. Digite DDD + número (10 ou 11 dígitos).", "alerta");
      inputChave.focus();
      return;
    }

    if (tipo === "cpf" && !validarCPF(chave)) {
      mostrarToast("CPF inválido. Verifique os números digitados.", "alerta");
      inputChave.focus();
      return;
    }

    if (tipo === "cnpj" && !validarCNPJ(chave)) {
      mostrarToast("CNPJ inválido. Verifique os números digitados.", "alerta");
      inputChave.focus();
      return;
    }

    if (tipo === "email" && !validarEmailPix(chave)) {
      mostrarToast("E-mail inválido. Digite um e-mail completo (ex: nome@dominio.com).", "alerta");
      inputChave.focus();
      return;
    }

    if (tipo === "aleatoria" && !validarAleatoriaPix(chave)) {
      mostrarToast("Chave aleatória inválida (mínimo de 32 caracteres).", "alerta");
      inputChave.focus();
      return;
    }

    msg.className = "";
    msg.textContent = "Salvando...";

    const { error } = await supabaseClient
      .from("casas")
      .update({
        chave_pix: chave,
        tipo_chave_pix: tipo,
      })
      .eq("id", casaId);

    if (error) {
      msg.className = "erro";
      msg.textContent = "Erro ao salvar chave Pix: " + error.message;
      return;
    }

    sessionStorage.removeItem(`cache_pix_${casaId}`);
    limparCacheDashboard();
    msg.textContent = "";
    mostrarToast("Chave Pix da casa validada e salva com sucesso!");
    await carregarPixCasa();
  };
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

// Exposição explícita para o escopo global (window)
window.inicializarContas = inicializarContas;
window.abrirModalEditar = abrirModalEditar;
window.fecharModalEditar = fecharModalEditar;
window.desativarConta = desativarConta;
window.limparCacheDashboard = limparCacheDashboard;

// Inicializa automaticamente se carregado diretamente pelo navegador
if (!window.InstantNav || !window.InstantNav.emNavegacao) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (window.location.pathname.endsWith("contas.html")) {
        inicializarContas();
      }
    });
  } else {
    if (window.location.pathname.endsWith("contas.html")) {
      inicializarContas();
    }
  }
}
})();
