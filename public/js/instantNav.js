// ============================================================
// instantNav.js — Navegação Instantânea SPA & Prefetch (Rachaê)
// ------------------------------------------------------------
// Elimina o recarregamento completo da página ao alternar entre
// telas, mantendo cabeçalho e rodapé fixos e trocando o conteúdo
// em 0ms com pré-carregamento em segundo plano e Cache-First.
// ============================================================

(function () {
  const pageCache = new Map();
  const scriptCarregados = new Set();
  let isNavigating = false;

  const ROTAS_PRINCIPAIS = [
    "dashboard.html",
    "contas.html",
    "convidar.html"
  ];

  const ROTA_SCRIPT_MAP = {
    "dashboard.html": {
      script: "js/dashboard.js",
      init: () => window.inicializarDashboard,
    },
    "contas.html": {
      script: "js/contas.js",
      init: () => window.inicializarContas,
    },
    "convidar.html": {
      script: "js/convidar.js",
      init: () => window.inicializarConvidar,
    },
  };

  // Marca os scripts já presentes na página inicial
  document.querySelectorAll("script[src]").forEach((s) => {
    const src = s.getAttribute("src");
    if (src) {
      const nomeScript = src.split("?")[0].split("/").pop();
      scriptCarregados.add(nomeScript);
    }
  });

  // Carrega script dinamicamente sob demanda caso ainda não esteja na página
  function carregarScript(src) {
    const nomeScript = src.split("?")[0].split("/").pop();
    if (scriptCarregados.has(nomeScript)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => {
        scriptCarregados.add(nomeScript);
        resolve();
      };
      script.onerror = (err) => {
        console.error("[InstantNav] Erro ao carregar script:", src, err);
        reject(err);
      };
      document.body.appendChild(script);
    });
  }

  // 1. Prefetch de páginas em background
  async function prefetch(url) {
    if (!url) return null;
    const cleanUrl = url.split("?")[0].split("#")[0].split("/").pop();
    if (pageCache.has(cleanUrl)) return pageCache.get(cleanUrl);

    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (res.ok) {
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Pega o conteúdo de #app-main ou .container
        const mainEl = doc.querySelector("#app-main") || doc.querySelector(".container");
        const title = doc.querySelector("title")?.textContent || document.title;

        if (mainEl) {
          const pageData = {
            html: mainEl.outerHTML,
            isAppMain: !!doc.querySelector("#app-main"),
            title: title,
          };
          pageCache.set(cleanUrl, pageData);
          return pageData;
        }
      }
    } catch (err) {
      console.warn("[InstantNav] Aviso no prefetch de " + url, err);
    }
    return null;
  }

  // Pré-carrega as abas vizinhas e seus scripts em tempo ocioso
  function iniciarPrefetchGeral() {
    const run = () => {
      ROTAS_PRINCIPAIS.forEach((rota) => {
        if (!window.location.pathname.endsWith(rota)) {
          prefetch(rota);
          const config = ROTA_SCRIPT_MAP[rota];
          if (config && config.script) {
            const link = document.createElement("link");
            link.rel = "prefetch";
            link.as = "script";
            link.href = config.script;
            document.head.appendChild(link);
          }
        }
      });
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 600);
    }
  }

  // 2. Transição Ultra-Rápida de Tela
  async function navegarPara(url, adicionarAoHistorico = true) {
    if (isNavigating) return;

    const targetBase = url.split("?")[0].split("#")[0].split("/").pop();
    const currentBase = window.location.pathname.split("/").pop() || "dashboard.html";

    // Se já estiver na página e sem query param novo, não recarrega
    if (targetBase === currentBase && !url.includes("?")) {
      return;
    }

    // Se a rota não for uma das rotas SPA, usa navegação clássica
    if (!ROTAS_PRINCIPAIS.includes(targetBase)) {
      window.location.href = url;
      return;
    }

    isNavigating = true;
    window.InstantNav.emNavegacao = true;

    // Atualiza imediatamente a aba ativa no rodapé
    atualizarRodapeNav(url);

    // Busca do cache de páginas ou via rede
    let pageData = pageCache.get(targetBase);
    if (!pageData) {
      pageData = await prefetch(url);
    }

    if (!pageData) {
      // Fallback para navegação clássica se falhar
      window.location.href = url;
      return;
    }

    const mainAtual = document.querySelector("#app-main") || document.querySelector(".container");
    if (!mainAtual) {
      window.location.href = url;
      return;
    }

    // Efeito de transição suave e ultrarrápida (70ms)
    mainAtual.style.transition = "opacity 0.07s ease, transform 0.07s ease";
    mainAtual.style.opacity = "0";
    mainAtual.style.transform = "translateY(2px)";

    await new Promise((r) => setTimeout(r, 70));

    // Substitui o conteúdo do miolo
    if (mainAtual.id === "app-main" && pageData.isAppMain) {
      mainAtual.outerHTML = pageData.html;
    } else {
      const parser = new DOMParser();
      const tempDoc = parser.parseFromString(pageData.html, "text/html");
      const novoConteudo = tempDoc.querySelector("#app-main") || tempDoc.querySelector(".container");
      if (novoConteudo) {
        mainAtual.parentNode.replaceChild(novoConteudo, mainAtual);
      }
    }

    document.title = pageData.title;

    if (adicionarAoHistorico) {
      window.history.pushState({ url }, pageData.title, url);
    }

    const novoMain = document.querySelector("#app-main") || document.querySelector(".container");
    if (novoMain) {
      novoMain.style.opacity = "1";
      novoMain.style.transform = "translateY(0)";
    }

    // Rola instantaneamente para o topo
    window.scrollTo({ top: 0, behavior: "instant" });

    // Executa o controlador JS da nova página
    await executarLogicaPagina(targetBase);

    isNavigating = false;
    window.InstantNav.emNavegacao = false;
  }

  // Atualiza classe 'ativo' nos links do menu inferior
  function atualizarRodapeNav(url) {
    const targetBase = url.split("?")[0].split("#")[0].split("/").pop();
    const links = document.querySelectorAll(".rodape-nav a");
    links.forEach((a) => {
      const href = a.getAttribute("href")?.split("?")[0].split("/").pop();
      if (href === targetBase) {
        a.classList.add("ativo");
      } else {
        a.classList.remove("ativo");
      }
    });
  }

  // Despacha a inicialização do controlador da página
  async function executarLogicaPagina(rotaBase) {
    // Reexecuta máscara de telefone se houver campo
    const camposTel = document.querySelectorAll('input[type="tel"], #telefone');
    if (typeof aplicarMascaraTelefone === "function") {
      camposTel.forEach(aplicarMascaraTelefone);
    }

    // Animação de entrada sutil
    if (window.Animacoes) {
      window.Animacoes.animarEntradaPagina(".card, .card-metrica");
    }

    const config = ROTA_SCRIPT_MAP[rotaBase];
    if (config) {
      if (config.script) {
        await carregarScript(config.script);
      }
      const fn = config.init();
      if (typeof fn === "function") {
        await fn();
      }
    }
  }

  // Intercepta cliques de links no documento
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      return;
    }

    if (href.startsWith("http://") || href.startsWith("https://") || link.target === "_blank") {
      return;
    }

    const rotaAlvo = href.split("?")[0].split("#")[0].split("/").pop();
    if (ROTAS_PRINCIPAIS.includes(rotaAlvo)) {
      e.preventDefault();
      navegarPara(href);
    }
  });

  // Prefetch sob demanda ao passar o mouse ou encostar o dedo
  document.addEventListener(
    "mouseover",
    (e) => {
      const link = e.target.closest("a");
      if (link) {
        const href = link.getAttribute("href");
        if (href && ROTAS_PRINCIPAIS.some((r) => href.includes(r))) {
          prefetch(href);
        }
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchstart",
    (e) => {
      const link = e.target.closest("a");
      if (link) {
        const href = link.getAttribute("href");
        if (href && ROTAS_PRINCIPAIS.some((r) => href.includes(r))) {
          prefetch(href);
        }
      }
    },
    { passive: true }
  );

  // Botões voltar e avançar do navegador
  window.addEventListener("popstate", () => {
    const current = window.location.pathname.split("/").pop() || "dashboard.html";
    navegarPara(current + window.location.search, false);
  });

  // Inicia prefetch quando a página estiver carregada
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciarPrefetchGeral);
  } else {
    iniciarPrefetchGeral();
  }

  // Expõe no window
  window.InstantNav = {
    navegarPara,
    prefetch,
    emNavegacao: false,
  };
})();
