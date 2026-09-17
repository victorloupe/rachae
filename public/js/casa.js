// ============================================================
// Listagem, criação de casa e entrada via código de convite
// ============================================================

(async () => {
  const session = await exigirLogin();
  if (!session) return;

  if (window.Animacoes) {
    window.Animacoes.animarEntradaPagina(".card");
  }

  await carregarMinhasCasas(session.user.id);

  // Se a pessoa abriu um link de convite (?convite=CODIGO), preenche o campo.
  const params = new URLSearchParams(window.location.search);
  const codigoUrl = params.get("convite");
  if (codigoUrl) {
    document.getElementById("codigo-convite").value = codigoUrl;
  }
})();

async function carregarMinhasCasas(usuarioId) {
  const container = document.getElementById("lista-casas");
  const cardSuasCasas = document.getElementById("card-suas-casas");

  try {
    let { data: membros, error } = await supabaseClient
      .from("membros_casa")
      .select("papel, casas ( * )")
      .eq("usuario_id", usuarioId);

    if (error) {
      console.warn("Erro ao carregar casas com casas(*), tentando fallback:", error);
      const res = await supabaseClient
        .from("membros_casa")
        .select("papel, casas ( id, nome, numero )")
        .eq("usuario_id", usuarioId);
      membros = res.data;
      error = res.error;
    }

    if (error) {
      if (cardSuasCasas) cardSuasCasas.style.display = "block";
      container.innerHTML = `<p class="erro">Erro ao carregar casas.</p>`;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const veioTrocar = params.get("trocar") === "1" || params.get("trocar") === "true";

    const casasValidas = (membros || [])
      .map((m) => {
        const c = Array.isArray(m.casas) ? m.casas[0] : m.casas;
        return { papel: m.papel || "morador", casa: c };
      })
      .filter((item) => item.casa && item.casa.id);

    // 1. SE TIVER EXATAMENTE 1 CASA: entra direto nela (a menos que tenha clicado em "Trocar casa")
    if (casasValidas.length === 1 && !veioTrocar) {
      const unica = casasValidas[0];
      irParaCasa(unica.casa.id, encodeURIComponent(unica.casa.nome || ""), encodeURIComponent(unica.casa.numero || ""), encodeURIComponent(unica.papel));
      return;
    }

    // 2. SE NÃO TIVER NENHUMA CASA (0 casas): esconde card "Suas casas", mostrando só criar e convite
    if (casasValidas.length === 0) {
      if (cardSuasCasas) cardSuasCasas.style.display = "none";
      return;
    }

    // 3. SE TIVER MAIS DE UMA CASA (ou clicou para trocar): exibe as casas para escolher
    if (cardSuasCasas) cardSuasCasas.style.display = "block";
    container.innerHTML = casasValidas
      .map(({ casa: c, papel }) => {
        const numTexto = c.numero ? ` <span class="texto-suave">(Nº ${c.numero})</span>` : "";
        const nomeEsc = encodeURIComponent(c.nome || "");
        const numEsc = encodeURIComponent(c.numero || "");
        const papelEsc = encodeURIComponent(papel || "morador");
        return `
          <div class="linha">
            <div>
              <strong>${c.nome}</strong>${numTexto}<br/>
              <span class="texto-suave">${papel === "admin" ? "Administrador" : "Morador"}</span>
            </div>
            <button class="pequeno" onclick="irParaCasa('${c.id}', '${nomeEsc}', '${numEsc}', '${papelEsc}')">Abrir</button>
          </div>
        `;
      })
      .join("");

    if (window.Animacoes) {
      window.Animacoes.animarListaLinhas("#lista-casas .linha");
    }
  } catch (e) {
    console.error("Falha ao carregar casas:", e);
    if (cardSuasCasas) cardSuasCasas.style.display = "block";
    container.innerHTML = `<p class="erro">Não foi possível carregar as casas.</p>`;
  }
}

function irParaCasa(casaId, nome, numero, papel) {
  localStorage.setItem("casa_atual", casaId);
  if (nome) {
    localStorage.setItem("casa_nome", decodeURIComponent(nome));
  }
  if (numero) {
    localStorage.setItem("casa_numero", decodeURIComponent(numero));
  } else {
    localStorage.removeItem("casa_numero");
  }
  if (papel) {
    localStorage.setItem("casa_papel", decodeURIComponent(papel));
  } else {
    localStorage.setItem("casa_papel", "morador");
  }
  window.location.href = "dashboard.html";
}

document.getElementById("form-criar-casa").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg-criar-casa");
  msg.className = "";
  msg.textContent = "Criando...";

  const nome = document.getElementById("nome-casa").value.trim();
  const inputNumero = document.getElementById("numero-casa");
  const numero = inputNumero ? inputNumero.value.trim() : null;

  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  const payload = { nome, criado_por: user.id };
  if (numero) payload.numero = numero;

  let { data: casa, error } = await supabaseClient
    .from("casas")
    .insert(payload)
    .select()
    .single();

  // Fallback caso a coluna 'numero' não exista ainda no banco
  if (error && error.message && error.message.includes("numero")) {
    const resFallback = await supabaseClient
      .from("casas")
      .insert({ nome, criado_por: user.id })
      .select()
      .single();
    casa = resFallback.data;
    error = resFallback.error;
  }

  if (error) {
    msg.className = "erro";
    msg.textContent = "Erro ao criar casa: " + error.message;
    return;
  }

  // Quem cria a casa entra automaticamente como admin
  const { error: erroMembro } = await supabaseClient.from("membros_casa").insert({
    casa_id: casa.id,
    usuario_id: user.id,
    papel: "admin",
  });

  if (erroMembro) {
    msg.className = "erro";
    msg.textContent = "Casa criada, mas houve erro ao te adicionar como membro.";
    return;
  }

  msg.className = "sucesso";
  msg.textContent = "Casa criada!";
  localStorage.setItem("casa_atual", casa.id);
  if (casa.nome) localStorage.setItem("casa_nome", casa.nome);
  if (casa.numero) localStorage.setItem("casa_numero", casa.numero);
  localStorage.setItem("casa_papel", "admin");
  setTimeout(() => (window.location.href = "dashboard.html"), 800);
});

document.getElementById("form-entrar-convite").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("msg-convite");
  msg.className = "";
  msg.textContent = "Verificando convite...";

  const codigo = document.getElementById("codigo-convite").value.trim();

  // aceitar_convite() roda no banco (security definer): valida o convite,
  // adiciona o morador e marca o convite como usado numa única transação
  // atômica. Substitui o antigo select+insert+update direto nas tabelas
  // convites/membros_casa, que dependia de policies de RLS abertas demais
  // (qualquer autenticado podia entrar em qualquer casa sem convite).
  const { data, error } = await supabaseClient.rpc("aceitar_convite", { p_codigo: codigo });

  if (error || !data) {
    msg.className = "erro";
    msg.textContent = error && /não encontrado|expirou|utilizado/i.test(error.message)
      ? error.message
      : "Convite inválido ou expirado.";
    return;
  }

  const resultado = Array.isArray(data) ? data[0] : data;

  msg.className = "sucesso";
  msg.textContent = "Você entrou na casa!";
  localStorage.setItem("casa_atual", resultado.casa_id);
  if (resultado.casa_nome) localStorage.setItem("casa_nome", resultado.casa_nome);
  if (resultado.casa_numero) localStorage.setItem("casa_numero", resultado.casa_numero);
  localStorage.setItem("casa_papel", "morador");
  setTimeout(() => (window.location.href = "dashboard.html"), 800);
});
