// ============================================================
// Módulo de Animações Fluidas com GSAP (GreenSock) - Rachaê
// ============================================================

const Animacoes = (() => {
  // Respeita acessibilidade de usuários que desativaram animações no SO
  const prefereReducao = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function gsapDisponivel() {
    return typeof window.gsap !== "undefined";
  }

  // Animação de entrada dos blocos da página (Staggered Fade-in)
  function animarEntradaPagina(seletor = ".card-metrica, .card, .card-casa-topo, .seletor-mes") {
    if (!gsapDisponivel() || prefereReducao) return;

    gsap.killTweensOf(seletor);

    gsap.fromTo(
      seletor,
      {
        opacity: 0,
        y: 12,
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.35,
        stagger: 0.04,
        ease: "power2.out",
        clearProps: "transform,opacity",
      }
    );
  }

  // Animação de contador numérico em moeda (estilo Nubank/Revolut)
  function animarNumeroMoeda(elemento, valorFinal, duracao = 0.5) {
    if (!elemento) return;
    const final = Number(valorFinal) || 0;

    if (!gsapDisponivel() || prefereReducao) {
      elemento.textContent = window.formatarMoeda ? window.formatarMoeda(final) : `R$ ${final.toFixed(2).replace(".", ",")}`;
      return;
    }

    // Lê valor atual do elemento se já tiver número
    const textoAtual = elemento.textContent.replace(/[^\d]/g, "");
    const valorInicial = textoAtual ? Number(textoAtual) / 100 : 0;

    // Se o valor na tela já é exatamente o final, não precisa reanimar!
    if (Math.abs(valorInicial - final) < 0.01) {
      elemento.textContent = window.formatarMoeda ? window.formatarMoeda(final) : `R$ ${final.toFixed(2).replace(".", ",")}`;
      return;
    }

    gsap.killTweensOf(elemento);
    const contador = { valor: valorInicial };

    gsap.to(contador, {
      valor: final,
      duration: duracao,
      ease: "power2.out",
      onUpdate: () => {
        if (window.formatarMoeda) {
          elemento.textContent = window.formatarMoeda(contador.valor);
        } else {
          elemento.textContent = `R$ ${contador.valor.toFixed(2).replace(".", ",")}`;
        }
      },
      onComplete: () => {
        if (window.formatarMoeda) {
          elemento.textContent = window.formatarMoeda(final);
        }
      },
    });
  }

  // Animação de contador fracionário (ex: "1 / 3")
  function animarNumeroFracionario(elemento, atual, total, duracao = 0.5) {
    if (!elemento) return;
    const alvoAtual = Number(atual) || 0;
    const alvoTotal = Number(total) || 0;

    if (!gsapDisponivel() || prefereReducao) {
      elemento.textContent = `${alvoAtual} / ${alvoTotal}`;
      return;
    }

    // Lê valor atual na tela em vez de reiniciar sempre do zero
    const partes = (elemento.textContent || "").split("/");
    const valorAtual = partes.length === 2 ? parseInt(partes[0].trim(), 10) : 0;

    if (!isNaN(valorAtual) && valorAtual === alvoAtual && (elemento.textContent || "").includes(String(alvoTotal))) {
      return; // Já está exibindo exatamente o valor correto!
    }

    const inicio = isNaN(valorAtual) ? 0 : valorAtual;
    const contador = { valor: inicio };
    gsap.killTweensOf(elemento);

    gsap.to(contador, {
      valor: alvoAtual,
      duration: duracao,
      ease: "power1.out",
      onUpdate: () => {
        elemento.textContent = `${Math.round(contador.valor)} / ${alvoTotal}`;
      },
      onComplete: () => {
        elemento.textContent = `${alvoAtual} / ${alvoTotal}`;
      },
    });
  }

  // Animação da barra de arrecadação
  function animarBarraProgresso(elemento, percentual, duracao = 0.5) {
    if (!elemento) return;
    const pctClamped = Math.max(0, Math.min(100, Number(percentual) || 0));
    const escala = pctClamped / 100;

    if (!gsapDisponivel() || prefereReducao) {
      elemento.style.transform = `scaleX(${escala})`;
      return;
    }

    gsap.killTweensOf(elemento);
    gsap.to(elemento, {
      scaleX: escala,
      duration: duracao,
      ease: "power2.out",
      transformOrigin: "left center",
    });
  }

  // Animação da barra de arrecadação segmentada (pago / atrasado / pendente)
  function animarBarraSegmentada({ segPago, segAtrasado, segPendente }, { pctPago, pctAtrasado, pctPendente }, duracao = 0.5) {
    const alvos = [
      [segPago, pctPago],
      [segAtrasado, pctAtrasado],
      [segPendente, pctPendente],
    ];

    if (!gsapDisponivel() || prefereReducao) {
      alvos.forEach(([el, pct]) => {
        if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      });
      return;
    }

    alvos.forEach(([el, pct]) => {
      if (!el) return;
      gsap.killTweensOf(el);
      gsap.to(el, {
        width: `${Math.max(0, Math.min(100, pct))}%`,
        duration: duracao,
        ease: "power2.out",
      });
    });
  }

  // Confete simples ao fechar 100% do mês (sem dependências externas além do GSAP já carregado)
  function animarConfete() {
    if (prefereReducao) return;

    const cores = ["#2563eb", "#10b981", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];
    const total = 32;
    const container = document.createElement("div");
    container.style.cssText = "position:fixed; inset:0; pointer-events:none; z-index:9999; overflow:hidden;";
    document.body.appendChild(container);

    const pecas = [];
    for (let i = 0; i < total; i++) {
      const peca = document.createElement("div");
      const cor = cores[i % cores.length];
      const tamanho = 6 + Math.random() * 6;
      peca.style.cssText = `position:absolute; top:-20px; left:${Math.random() * 100}%; width:${tamanho}px; height:${tamanho * 0.4}px; background:${cor}; border-radius:2px; opacity:0.95;`;
      container.appendChild(peca);
      pecas.push(peca);
    }

    if (!gsapDisponivel()) {
      // Sem GSAP: fallback com CSS transitions simples
      pecas.forEach((peca) => {
        peca.style.transition = "transform 1.2s ease-in, opacity 1.2s ease-in";
        requestAnimationFrame(() => {
          peca.style.transform = `translateY(${window.innerHeight + 40}px) rotate(${Math.random() * 360}deg)`;
          peca.style.opacity = "0";
        });
      });
      setTimeout(() => container.remove(), 1400);
      return;
    }

    pecas.forEach((peca) => {
      gsap.to(peca, {
        y: window.innerHeight + 40,
        x: (Math.random() - 0.5) * 160,
        rotation: Math.random() * 720 - 360,
        opacity: 0,
        duration: 1.1 + Math.random() * 0.6,
        ease: "power1.in",
        delay: Math.random() * 0.3,
      });
    });

    setTimeout(() => container.remove(), 2200);
  }

  // Animação em cascata (stagger) para listas de linhas
  function animarListaLinhas(seletorOuElementos, duracao = 0.28) {
    if (!gsapDisponivel() || prefereReducao) return;

    const itens = typeof seletorOuElementos === "string"
      ? document.querySelectorAll(seletorOuElementos)
      : seletorOuElementos;

    if (!itens || itens.length === 0) return;

    gsap.killTweensOf(itens);

    gsap.fromTo(
      itens,
      {
        opacity: 0,
        y: 6,
      },
      {
        opacity: 1,
        y: 0,
        duration: duracao,
        stagger: 0.03,
        ease: "power1.out",
        clearProps: "transform,opacity",
      }
    );
  }

  // Modal Pix / Sistema: entrada elástica suave
  function animarAberturaModal(modalEl, cardEl) {
    if (typeof modalEl === "string") {
      modalEl = document.querySelector(modalEl);
    }
    if (!modalEl || !(modalEl instanceof Element)) return;

    if (typeof cardEl === "string") {
      cardEl = document.querySelector(cardEl);
    }
    if (!cardEl || !(cardEl instanceof Element)) {
      cardEl = modalEl.querySelector(".modal-card-sistema, .modal-card-perfil, .modal-card-despesa-extra, [class*='modal-card']") || modalEl.firstElementChild;
    }

    if (gsapDisponivel()) {
      try {
        gsap.killTweensOf(modalEl);
        if (cardEl && cardEl instanceof Element) gsap.killTweensOf(cardEl);
      } catch (_) {}
    }

    modalEl.style.setProperty("display", "flex", "important");
    modalEl.classList.add("ativo");

    if (!gsapDisponivel() || prefereReducao) {
      modalEl.style.opacity = "1";
      if (cardEl && cardEl instanceof Element) {
        cardEl.style.opacity = "1";
        cardEl.style.transform = "none";
      }
      return;
    }

    gsap.fromTo(
      modalEl,
      { opacity: 0 },
      { opacity: 1, duration: 0.2, ease: "power1.out", clearProps: "opacity" }
    );

    if (cardEl && cardEl instanceof Element) {
      gsap.fromTo(
        cardEl,
        {
          opacity: 0,
          scale: 0.94,
          y: 10,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.25,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      );
    }
  }

  // Modal Pix / Sistema: fechamento suave
  function animarFechamentoModal(modalEl, cardEl, callback) {
    if (typeof modalEl === "string") {
      modalEl = document.querySelector(modalEl);
    }
    if (!modalEl || !(modalEl instanceof Element)) {
      if (typeof callback === "function") callback();
      return;
    }

    // Se o 2º argumento for uma função callback
    if (typeof cardEl === "function") {
      callback = cardEl;
      cardEl = null;
    }

    if (typeof cardEl === "string") {
      cardEl = document.querySelector(cardEl);
    }
    if (!cardEl || !(cardEl instanceof Element)) {
      cardEl = modalEl.querySelector(".modal-card-sistema, .modal-card-perfil, .modal-card-despesa-extra, [class*='modal-card']") || modalEl.firstElementChild;
    }

    let jaFechou = false;
    const fecharDireto = () => {
      if (jaFechou) return;
      jaFechou = true;
      try {
        if (gsapDisponivel()) {
          gsap.killTweensOf(modalEl);
          if (cardEl && cardEl instanceof Element) gsap.killTweensOf(cardEl);
          gsap.set(modalEl, { clearProps: "opacity,transform" });
          if (cardEl && cardEl instanceof Element) {
            gsap.set(cardEl, { clearProps: "opacity,transform" });
          }
        }
      } catch (_) {}

      modalEl.style.setProperty("display", "none", "important");
      modalEl.classList.remove("ativo");

      if (typeof callback === "function") {
        try { callback(); } catch (err) { console.warn("Callback fechamento modal:", err); }
      }
    };

    if (!gsapDisponivel() || prefereReducao) {
      fecharDireto();
      return;
    }

    try {
      const tl = gsap.timeline({
        onComplete: fecharDireto,
      });

      if (cardEl && cardEl instanceof Element) {
        tl.to(cardEl, {
          opacity: 0,
          scale: 0.94,
          duration: 0.16,
          ease: "power2.in",
        }, 0);
      }

      tl.to(modalEl, {
        opacity: 0,
        duration: 0.18,
        ease: "power2.in",
      }, 0);

      // Failsafe garantido: se GSAP não disparar onComplete em 250ms, força fechamento
      setTimeout(fecharDireto, 250);
    } catch (e) {
      console.warn("Erro ao animar fechamento modal GSAP:", e);
      fecharDireto();
    }
  }

  // Microinteração comemorativa (ao copiar Pix ou confirmar)
  function animarPulseSucesso(elemento) {
    if (!elemento || !gsapDisponivel() || prefereReducao) return;

    gsap.timeline()
      .to(elemento, { scale: 1.05, duration: 0.12, ease: "power1.out" })
      .to(elemento, { scale: 1, duration: 0.18, ease: "power2.inOut" });
  }

  // Feedback tátil nos cliques de botões principais
  function configurarMicrointeracoesBotoes() {
    if (!gsapDisponivel() || prefereReducao) return;

    document.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("button, .btn-filtro, .btn-alerta-pagar, .btn-trocar-casa");
      if (!btn) return;

      gsap.to(btn, {
        scale: 0.97,
        duration: 0.08,
        ease: "power1.inOut",
      });
    });

    document.addEventListener("mouseup", (e) => {
      const btn = e.target.closest("button, .btn-filtro, .btn-alerta-pagar, .btn-trocar-casa");
      if (!btn) return;

      gsap.to(btn, {
        scale: 1,
        duration: 0.16,
        ease: "back.out(2)",
      });
    });
  }

  // Animação de Inicialização do App (Splash Intro Screen)
  function executarSplashIntro(callback) {
    const splash = document.getElementById("app-splash-screen");
    if (!splash) {
      if (typeof callback === "function") callback();
      return;
    }

    if (prefereReducao) {
      splash.style.display = "none";
      if (typeof callback === "function") callback();
      return;
    }

    let finalizado = false;
    const finalizarSplash = () => {
      if (finalizado) return;
      finalizado = true;
      if (gsapDisponivel()) {
        gsap.to(splash, {
          opacity: 0,
          scale: 1.05,
          filter: "blur(4px)",
          duration: 0.38,
          ease: "power2.inOut",
          onComplete: () => {
            splash.style.display = "none";
            if (typeof callback === "function") callback();
            animarEntradaPagina(".auth-topo, .card-auth, .auth-rodape");
          },
        });
      } else {
        splash.style.transition = "opacity 0.35s ease, transform 0.35s ease";
        splash.style.opacity = "0";
        splash.style.transform = "scale(1.05)";
        setTimeout(() => {
          splash.style.display = "none";
          if (typeof callback === "function") callback();
        }, 360);
      }
    };

    // Permite ao usuário tocar para pular instantaneamente
    splash.addEventListener("click", finalizarSplash, { once: true });
    splash.addEventListener("touchstart", finalizarSplash, { once: true, passive: true });

    if (gsapDisponivel()) {
      const logoWrapper = splash.querySelector(".splash-logo-wrapper");
      const texto = splash.querySelector(".splash-texto");
      const barraFill = splash.querySelector(".splash-barra-fill");

      const tl = gsap.timeline({
        onComplete: finalizarSplash,
      });

      tl.fromTo(
        logoWrapper,
        { scale: 0.6, opacity: 0, y: 14 },
        { scale: 1, opacity: 1, y: 0, duration: 0.45, ease: "back.out(1.7)" }
      );

      if (texto) {
        tl.fromTo(
          texto,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
          "-=0.2"
        );
      }

      if (barraFill) {
        tl.fromTo(
          barraFill,
          { width: "0%" },
          { width: "100%", duration: 0.6, ease: "power1.inOut" },
          "-=0.2"
        );
      }

      tl.to({}, { duration: 0.18 });
    } else {
      setTimeout(finalizarSplash, 1100);
    }
  }

  // Animação de Transição após Login: "Entrando na casa"
  function animarEntrandoCasa(opcoes = {}) {
    const {
      nomeCasa = "",
      destino = "dashboard.html",
      duracao = 1.15
    } = opcoes;

    const overlay = document.getElementById("animacao-entrando-casa") || document.getElementById("app-splash-screen");
    if (!overlay) {
      window.location.href = destino;
      return;
    }

    const tituloEl = document.getElementById("anim-titulo-entrando") || overlay.querySelector(".splash-titulo");
    const subtituloEl = document.getElementById("anim-subtitulo-entrando") || overlay.querySelector(".splash-subtitulo");
    const barraFill = document.getElementById("anim-barra-fill") || overlay.querySelector(".splash-barra-fill");
    const iconeWrapper = overlay.querySelector(".splash-logo-wrapper");

    if (tituloEl) {
      tituloEl.innerHTML = `Entrando na <span>casa</span>`;
    }

    if (subtituloEl) {
      if (nomeCasa) {
        subtituloEl.textContent = `Carregando contas de "${nomeCasa}"...`;
      } else {
        subtituloEl.textContent = `Carregando contas e divisão do mês...`;
      }
    }

    overlay.style.display = "flex";
    overlay.style.opacity = "0";

    if (prefereReducao || !gsapDisponivel()) {
      overlay.style.transition = "opacity 0.25s ease";
      overlay.style.opacity = "1";
      if (barraFill) {
        barraFill.style.transition = `width ${duracao}s ease`;
        barraFill.style.width = "100%";
      }
      setTimeout(() => {
        window.location.href = destino;
      }, duracao * 1000);
      return;
    }

    // Timeline fluida GSAP
    gsap.killTweensOf([overlay, iconeWrapper, barraFill]);

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(overlay, {
          opacity: 0,
          scale: 1.04,
          filter: "blur(4px)",
          duration: 0.28,
          ease: "power2.in",
          onComplete: () => {
            window.location.href = destino;
          }
        });
      }
    });

    tl.to(overlay, {
      opacity: 1,
      duration: 0.25,
      ease: "power2.out"
    });

    if (iconeWrapper) {
      tl.fromTo(
        iconeWrapper,
        { scale: 0.6, y: 14, opacity: 0 },
        { scale: 1, y: 0, opacity: 1, duration: 0.42, ease: "back.out(1.8)" },
        "-=0.12"
      );
    }

    if (barraFill) {
      tl.fromTo(
        barraFill,
        { width: "0%" },
        { width: "100%", duration: duracao, ease: "power1.inOut" },
        "-=0.2"
      );
    } else {
      tl.to({}, { duration: duracao });
    }
  }

  // Inicialização automática das microinterações
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", configurarMicrointeracoesBotoes);
  } else {
    configurarMicrointeracoesBotoes();
  }

  return {
    animarEntradaPagina,
    animarNumeroMoeda,
    animarNumeroFracionario,
    animarBarraProgresso,
    animarBarraSegmentada,
    animarConfete,
    animarListaLinhas,
    animarAberturaModal,
    animarFechamentoModal,
    animarPulseSucesso,
    executarSplashIntro,
    animarEntrandoCasa,
  };
})();

window.Animacoes = Animacoes;
