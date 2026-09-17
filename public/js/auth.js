// ============================================================
// Login, Cadastro e Entrada Automática via Convite
// ============================================================

const formLogin = document.getElementById("form-login");
const formCadastro = document.getElementById("form-cadastro");

if (window.Animacoes) {
  window.Animacoes.animarEntradaPagina(".auth-topo, .card-auth, .auth-rodape");
}

// Alternar visibilidade de senha (ícone de olho)
function alternarVisibilidadeSenha(campoId, botao) {
  const campo = document.getElementById(campoId);
  if (!campo) return;

  if (campo.type === "password") {
    campo.type = "text";
    botao.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
    botao.title = "Ocultar senha";
  } else {
    campo.type = "password";
    botao.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    botao.title = "Mostrar senha";
  }
}

// ------------------------------------------------------------
// Processamento de Convite Pendente
// ------------------------------------------------------------
async function processarConviteAposAutenticacao(usuarioId) {
  const codigo = sessionStorage.getItem("pendente_convite") || localStorage.getItem("pendente_convite");
  if (!codigo) return null;

  try {
    const { data: convite, error } = await supabaseClient
      .from("convites")
      .select("id, casa_id, usado, expira_em, casas ( id, nome )")
      .eq("codigo", codigo)
      .eq("usado", false)
      .maybeSingle();

    if (convite && convite.casa_id) {
      // Adiciona o morador à casa
      await supabaseClient.from("membros_casa").insert({
        casa_id: convite.casa_id,
        usuario_id: usuarioId,
        papel: "morador",
      });

      // Marca convite como utilizado
      await supabaseClient.from("convites").update({ usado: true }).eq("id", convite.id);

      // Define a casa ativa
      localStorage.setItem("casa_atual", convite.casa_id);
      localStorage.setItem("casa_papel", "morador");
      const c = Array.isArray(convite.casas) ? convite.casas[0] : convite.casas;
      if (c && c.nome) {
        localStorage.setItem("casa_nome", c.nome);
      }
      sessionStorage.removeItem("pendente_convite");
      localStorage.removeItem("pendente_convite");

      return c ? c.nome : "a casa";
    }
  } catch (err) {
    console.warn("Erro ao vincular convite automaticamente:", err);
  }
  return null;
}

// Inicializa visualização de convite na tela
(async function inicializarConvite() {
  const urlParams = new URLSearchParams(window.location.search);
  const codigoUrl = urlParams.get("convite");
  if (codigoUrl) {
    sessionStorage.setItem("pendente_convite", codigoUrl);
    localStorage.setItem("pendente_convite", codigoUrl);
  }

  const codigo = sessionStorage.getItem("pendente_convite") || localStorage.getItem("pendente_convite");
  if (!codigo) return;

  // Atualiza links de navegação para manter o convite na URL
  const linksParaPreservar = document.querySelectorAll("#link-aba-cadastro, #link-aba-login, #link-criar-conta-rodape, #link-login-rodape");
  linksParaPreservar.forEach((link) => {
    if (link && !link.href.includes("convite=")) {
      const separador = link.href.includes("?") ? "&" : "?";
      link.href = `${link.href}${separador}convite=${encodeURIComponent(codigo)}`;
    }
  });

  // Busca dados do convite para exibir o nome da casa
  try {
    const { data: convite } = await supabaseClient
      .from("convites")
      .select("id, casa_id, codigo, expira_em, usado, casas ( id, nome )")
      .eq("codigo", codigo)
      .eq("usado", false)
      .maybeSingle();

    if (convite && convite.casas) {
      const nomeCasa = convite.casas.nome;
      const banner = document.getElementById("banner-convite-container");
      if (banner) {
        banner.innerHTML = `
          <div class="card-convite-destaque">
            <span class="badge-convite">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: -1px; margin-right: 4px;">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Convite Especial
            </span>
            <div class="convite-titulo">Você foi convidado(a) para a casa:</div>
            <div class="convite-nome-casa">${nomeCasa}</div>
            <p class="convite-sub">Ao entrar ou se cadastrar, você entrará diretamente nesta casa.</p>
          </div>
        `;
      }
    }
  } catch (e) {
    console.warn("Não foi possível carregar detalhes do convite:", e);
  }
})();

function animarShakeErro(seletor = ".card-auth") {
  if (typeof window.gsap !== "undefined") {
    gsap.timeline()
      .to(seletor, { x: -8, duration: 0.05, ease: "power1.inOut" })
      .to(seletor, { x: 8, duration: 0.05, ease: "power1.inOut" })
      .to(seletor, { x: -5, duration: 0.05, ease: "power1.inOut" })
      .to(seletor, { x: 5, duration: 0.05, ease: "power1.inOut" })
      .to(seletor, { x: 0, duration: 0.05, ease: "power1.inOut" });
  }
}

// ------------------------------------------------------------
// Formulário de Login
// ------------------------------------------------------------
if (formLogin) {
  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("msg-login");
    const btnSubmit = document.getElementById("btn-submit-login");
    const htmlOriginalBtn = btnSubmit ? btnSubmit.innerHTML : "Entrar";

    msg.className = "";
    msg.textContent = "";

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span>Entrando...</span>`;
    }

    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password: senha,
    });

    if (error) {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = htmlOriginalBtn;
      }
      msg.className = "erro";
      msg.textContent = traduzErro(error.message);
      animarShakeErro(".card-auth");
      return;
    }

    await redirecionarAposAutenticacao(data.user.id, msg);
  });

  const btnDemo = document.getElementById("btn-preencher-demo");
  if (btnDemo) {
    if (typeof ehModoMock !== "undefined" && !ehModoMock) {
      btnDemo.style.display = "none";
    } else {
      btnDemo.style.display = "block";
      btnDemo.addEventListener("click", () => {
        document.getElementById("email").value = "demo@rachafixo.com";
        document.getElementById("senha").value = "123456";
        formLogin.dispatchEvent(new Event("submit"));
      });
    }
  }
}

// ------------------------------------------------------------
// Formulário de Cadastro
// ------------------------------------------------------------
const inputTelCadastro = document.getElementById("telefone");
if (inputTelCadastro && typeof aplicarMascaraTelefone === "function") {
  aplicarMascaraTelefone(inputTelCadastro);
}

if (formCadastro) {
  formCadastro.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("msg-cadastro");
    const btnSubmit = document.getElementById("btn-submit-cadastro");
    const htmlOriginalBtn = btnSubmit ? btnSubmit.innerHTML : "Criar conta";

    msg.className = "";
    msg.textContent = "";

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span>Criando sua conta...</span>`;
    }

    const nome = document.getElementById("nome").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password: senha,
      options: {
        data: { nome, telefone },
      },
    });

    if (error) {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = htmlOriginalBtn;
      }
      msg.className = "erro";
      msg.textContent = traduzErro(error.message);
      animarShakeErro(".card-auth");
      return;
    }

    if (data?.user && !data?.session) {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = htmlOriginalBtn;
      }
      msg.className = "sucesso";
      msg.textContent = "Conta criada com sucesso! Verifique seu e-mail para confirmar seu cadastro antes de entrar.";
      return;
    }

    await redirecionarAposAutenticacao(data.user.id, msg);
  });
}

async function redirecionarAposAutenticacao(usuarioId, msgEl) {
  try {
    // 1. Se veio de um link de convite, adiciona diretamente à casa
    const casaNome = await processarConviteAposAutenticacao(usuarioId);
    if (casaNome) {
      if (msgEl) {
        msgEl.className = "sucesso";
        msgEl.textContent = `Você entrou em "${casaNome}"! Redirecionando...`;
      }
      setTimeout(() => (window.location.href = "dashboard.html"), 600);
      return;
    }

    // 2. Busca as casas do usuário para aplicar a regra
    let { data: membros } = await supabaseClient
      .from("membros_casa")
      .select("papel, casas ( * )")
      .eq("usuario_id", usuarioId);

    if (!membros) {
      const res = await supabaseClient
        .from("membros_casa")
        .select("papel, casas ( id, nome, numero )")
        .eq("usuario_id", usuarioId);
      membros = res.data;
    }

    const casasValidas = (membros || [])
      .map((m) => {
        const c = Array.isArray(m.casas) ? m.casas[0] : m.casas;
        return { papel: m.papel || "morador", casa: c };
      })
      .filter((item) => item.casa && item.casa.id);

    // SE TIVER EXATAMENTE 1 CASA: entra direto nela!
    if (casasValidas.length === 1) {
      const unica = casasValidas[0];
      localStorage.setItem("casa_atual", unica.casa.id);
      if (unica.casa.nome) localStorage.setItem("casa_nome", unica.casa.nome);
      if (unica.casa.numero) localStorage.setItem("casa_numero", unica.casa.numero);
      localStorage.setItem("casa_papel", unica.papel || "morador");

      if (msgEl) {
        msgEl.className = "sucesso";
        msgEl.textContent = `Entrando em "${unica.casa.nome}"...`;
      }
      setTimeout(() => (window.location.href = "dashboard.html"), 400);
      return;
    }

    // SE TIVER 0 CASAS OU MAIS DE 1: vai para casa.html
    window.location.href = "casa.html";
  } catch (e) {
    console.warn("Erro ao redirecionar após autenticação:", e);
    window.location.href = "casa.html";
  }
}

function traduzErro(erro) {
  if (!erro) return "Ocorreu um erro. Tente novamente.";
  const msg = typeof erro === "string" ? erro : (erro.code || erro.message || "");
  const mapa = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Nenhum usuário encontrado com este e-mail.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-email": "O formato de e-mail informado é inválido.",
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "User already registered": "Já existe uma conta com esse e-mail.",
    "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
  };
  return mapa[msg] || (typeof erro === "object" ? erro.message : erro) || "Erro ao processar solicitação.";
}
