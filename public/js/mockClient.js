// ============================================================
// MOCK SUPABASE CLIENT (Modo Local / Demonstração)
// ------------------------------------------------------------
// Simula autenticação, banco de dados Postgres e Edge Functions
// persistindo tudo em localStorage sem requisições de rede.
// ============================================================

(function () {
  const DB_KEY = "rachafixo_local_db";
  const SESSION_KEY = "rachafixo_local_session";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getInitialData() {
    const userId1 = "usr-vitor-0001";
    const userId2 = "usr-lucas-0002";
    const userId3 = "usr-mariana-0003";

    const casaId = "casa-solar-0001";

    return {
      auth_users: [
        {
          id: userId1,
          email: "demo@rachafixo.com",
          password: "123456",
          user_metadata: { nome: "Vitor (Demo)", telefone: "(11) 98888-1111" },
        },
        {
          id: userId2,
          email: "lucas@rachafixo.com",
          password: "123456",
          user_metadata: { nome: "Lucas Silva", telefone: "(11) 98888-2222" },
        },
        {
          id: userId3,
          email: "mariana@rachafixo.com",
          password: "123456",
          user_metadata: { nome: "Mariana Rios", telefone: "(11) 98888-3333" },
        },
      ],
      profiles: [
        { id: userId1, nome: "Vitor (Demo)", telefone: "(11) 98888-1111", criado_em: new Date().toISOString() },
        { id: userId2, nome: "Lucas Silva", telefone: "(11) 98888-2222", criado_em: new Date().toISOString() },
        { id: userId3, nome: "Mariana Rios", telefone: "(11) 98888-3333", criado_em: new Date().toISOString() },
      ],
      casas: [
        {
          id: casaId,
          nome: "Casa Solar",
          numero: "42",
          chave_pix: "11988881111",
          tipo_chave_pix: "telefone",
          criado_por: userId1,
          criado_em: new Date().toISOString(),
        },
      ],
      membros_casa: [
        { id: uuid(), casa_id: casaId, usuario_id: userId1, papel: "admin", entrou_em: new Date().toISOString() },
        { id: uuid(), casa_id: casaId, usuario_id: userId2, papel: "morador", entrou_em: new Date().toISOString() },
        { id: uuid(), casa_id: casaId, usuario_id: userId3, papel: "morador", entrou_em: new Date().toISOString() },
      ],
      convites: [
        {
          id: uuid(),
          casa_id: casaId,
          codigo: "solar123",
          criado_por: userId1,
          usado: false,
          criado_em: new Date().toISOString(),
          expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      contas_fixas: [
        {
          id: uuid(),
          casa_id: casaId,
          nome: "Aluguel",
          valor_padrao: 2400.0,
          tipo_valor: "fixo",
          dia_vencimento: 10,
          forma_divisao: "igual",
          mes_inicio: null,
          morador_especifico_id: null,
          ativa: true,
          criado_em: new Date().toISOString(),
        },
        {
          id: uuid(),
          casa_id: casaId,
          nome: "Internet Fibra 500MB",
          valor_padrao: 150.0,
          tipo_valor: "fixo",
          dia_vencimento: 15,
          forma_divisao: "igual",
          mes_inicio: null,
          morador_especifico_id: null,
          ativa: true,
          criado_em: new Date().toISOString(),
        },
        {
          id: uuid(),
          casa_id: casaId,
          nome: "Energia Elétrica (CPFL)",
          valor_padrao: 330.0,
          tipo_valor: "variavel",
          dia_vencimento: 22,
          forma_divisao: "igual",
          mes_inicio: null,
          morador_especifico_id: null,
          ativa: true,
          criado_em: new Date().toISOString(),
        },
      ],
      ciclos_cobranca: [],
      cobrancas_individuais: [],
    };
  }

  function carregarDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) {
        const initial = getInitialData();
        salvarDB(initial);
        return initial;
      }
      return JSON.parse(raw);
    } catch (e) {
      console.error("Erro ao ler DB local, reiniciando:", e);
      const initial = getInitialData();
      salvarDB(initial);
      return initial;
    }
  }

  function salvarDB(data) {
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  }

  function carregarSessao() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function salvarSessao(session) {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  }

  // --- QUERY BUILDER MOCK ---
  class QueryBuilder {
    constructor(tableName) {
      this.table = tableName;
      this.filters = [];
      this.orderRule = null;
      this.isSingle = false;
      this.isMaybeSingle = false;
      this.columns = "*";
      this.operation = "select";
      this.payload = null;
    }

    select(columns = "*") {
      this.columns = columns;
      return this;
    }

    insert(data) {
      this.operation = "insert";
      this.payload = data;
      return this;
    }

    update(data) {
      this.operation = "update";
      this.payload = data;
      return this;
    }

    delete() {
      this.operation = "delete";
      return this;
    }

    eq(column, value) {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    gt(column, value) {
      this.filters.push((row) => row[column] > value);
      return this;
    }

    order(column, { ascending = true } = {}) {
      this.orderRule = { column, ascending };
      return this;
    }

    single() {
      this.isSingle = true;
      return this._execute();
    }

    maybeSingle() {
      this.isMaybeSingle = true;
      return this._execute();
    }

    then(resolve, reject) {
      return this._execute().then(resolve, reject);
    }

    async _execute() {
      const db = carregarDB();
      if (!db[this.table]) {
        db[this.table] = [];
      }

      let rows = db[this.table];

      // INSERT
      if (this.operation === "insert") {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = items.map((item) => {
          const newItem = {
            id: item.id || uuid(),
            criado_em: item.criado_em || new Date().toISOString(),
            ...item,
          };
          db[this.table].push(newItem);
          return newItem;
        });
        salvarDB(db);

        const result = Array.isArray(this.payload) ? inserted : inserted[0];
        if (this.isSingle || this.isMaybeSingle) {
          return { data: inserted[0], error: null };
        }
        return { data: result, error: null };
      }

      // UPDATE
      if (this.operation === "update") {
        const updated = [];
        db[this.table] = db[this.table].map((row) => {
          const match = this.filters.every((fn) => fn(row));
          if (match) {
            const newRow = { ...row, ...this.payload };
            updated.push(newRow);
            return newRow;
          }
          return row;
        });
        salvarDB(db);
        if (this.isSingle || this.isMaybeSingle) {
          return { data: updated[0] || null, error: null };
        }
        return { data: updated, error: null };
      }

      // DELETE
      if (this.operation === "delete") {
        db[this.table] = db[this.table].filter((row) => !this.filters.every((fn) => fn(row)));
        salvarDB(db);
        return { data: null, error: null };
      }

      // SELECT
      let filtered = rows.filter((row) => this.filters.every((fn) => fn(row)));

      if (this.orderRule) {
        const { column, ascending } = this.orderRule;
        filtered.sort((a, b) => {
          if (a[column] < b[column]) return ascending ? -1 : 1;
          if (a[column] > b[column]) return ascending ? 1 : -1;
          return 0;
        });
      }

      // Process joins (casas, profiles)
      const mapped = filtered.map((row) => {
        const res = { ...row };
        if (this.columns.includes("casas")) {
          const casa = (db.casas || []).find((c) => c.id === row.casa_id);
          res.casas = casa || { id: row.casa_id, nome: "Casa Desconhecida", criado_em: null };
        }
        if (this.columns.includes("profiles")) {
          const profile = (db.profiles || []).find((p) => p.id === (row.usuario_id || row.id));
          res.profiles = profile || { nome: "Usuário", telefone: null };
        }
        return res;
      });

      if (this.isSingle) {
        if (mapped.length === 0) {
          return { data: null, error: { message: "Item não encontrado." } };
        }
        return { data: mapped[0], error: null };
      }

      if (this.isMaybeSingle) {
        return { data: mapped[0] || null, error: null };
      }

      return { data: mapped, error: null };
    }
  }

  // --- MOCK SUPABASE CLIENT ---
  class MockSupabaseClient {
    constructor() {
      this.isMock = true;
      this.auth = {
        getSession: async () => {
          const session = carregarSessao();
          return { data: { session }, error: null };
        },
        getUser: async () => {
          const session = carregarSessao();
          return { data: { user: session ? session.user : null }, error: null };
        },
        signInWithPassword: async ({ email, password }) => {
          const db = carregarDB();
          const user = db.auth_users.find((u) => u.email.toLowerCase() === email.toLowerCase());

          if (!user || user.password !== password) {
            return { error: { message: "Invalid login credentials" } };
          }

          const session = {
            access_token: "mock-token-" + uuid(),
            user: {
              id: user.id,
              email: user.email,
              user_metadata: user.user_metadata || {},
            },
          };
          salvarSessao(session);
          return { data: { user: session.user, session }, error: null };
        },
        signUp: async ({ email, password, options = {} }) => {
          const db = carregarDB();
          const exists = db.auth_users.some((u) => u.email.toLowerCase() === email.toLowerCase());
          if (exists) {
            return { error: { message: "User already registered" } };
          }

          const newId = uuid();
          const metadata = options.data || {};
          const newUser = {
            id: newId,
            email,
            password,
            user_metadata: metadata,
          };

          db.auth_users.push(newUser);
          db.profiles.push({
            id: newId,
            nome: metadata.nome || email.split("@")[0],
            telefone: metadata.telefone || null,
            criado_em: new Date().toISOString(),
          });

          salvarDB(db);

          const session = {
            access_token: "mock-token-" + uuid(),
            user: {
              id: newId,
              email,
              user_metadata: metadata,
            },
          };
          salvarSessao(session);
          return { data: { user: session.user, session }, error: null };
        },
        signOut: async () => {
          salvarSessao(null);
          return { error: null };
        },
        updateUser: async (attributes = {}) => {
          const session = carregarSessao();
          if (!session || !session.user) {
            return { data: null, error: { message: "Usuário não autenticado." } };
          }
          const db = carregarDB();
          const user = db.auth_users.find((u) => u.id === session.user.id);
          if (user) {
            if (attributes.password) {
              user.password = attributes.password;
            }
            if (attributes.data) {
              user.user_metadata = { ...(user.user_metadata || {}), ...attributes.data };
            }
            salvarDB(db);
            session.user.user_metadata = user.user_metadata;
            salvarSessao(session);
          }
          return { data: { user: session.user }, error: null };
        },
      };

      this.functions = {
        invoke: async (functionName, { body } = {}) => {
          if (functionName === "gerar-cobranca-pix") {
            const { cobrancaId, valor, descricao } = body || {};
            const txid = `MOCK-PIX-${(cobrancaId || uuid()).slice(0, 8).toUpperCase()}`;
            const valorFmt = Number(valor || 0).toFixed(2);
            const copiaCola = `00020126580014BR.GOV.BCB.PIX0136${txid}520400005303986540${valorFmt}5802BR5913RachaFixo6009SAOPAULO62070503***6304ABCD`;

            // Gerador de QR code via API pública simples
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(copiaCola)}`;

            return {
              data: {
                txid,
                copia_cola: copiaCola,
                qrcode_base64: qrUrl,
              },
              error: null,
            };
          }
          return { data: null, error: { message: "Função não encontrada no mock" } };
        },
      };
    }

    from(table) {
      return new QueryBuilder(table);
    }
  }

  // Funções utilitárias globais para o modo de demonstração
  window.RachaFixoMock = {
    client: new MockSupabaseClient(),
    resetDB: async function () {
      let confirmado = false;
      if (typeof window.mostrarConfirmacao === "function") {
        confirmado = await window.mostrarConfirmacao({
          titulo: "Restaurar Demonstração",
          mensagem: "Deseja restaurar os dados de demonstração iniciais? Seus dados locais serão resetados.",
          textoConfirmar: "Restaurar",
          textoCancelar: "Cancelar",
          tipo: "perigo",
        });
      } else {
        confirmado = confirm("Deseja restaurar os dados de demonstração iniciais?");
      }
      if (confirmado) {
        localStorage.removeItem(DB_KEY);
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem("casa_atual");
        localStorage.removeItem("casa_nome");
        localStorage.removeItem("casa_numero");
        window.location.href = "index.html";
      }
    },
    simularPagamento: async function (cobrancaId) {
      const db = carregarDB();
      const cobranca = (db.cobrancas_individuais || []).find((c) => c.id === cobrancaId);
      if (cobranca) {
        cobranca.status = "pago";
        cobranca.pago_em = new Date().toISOString();
        salvarDB(db);
        return true;
      }
      return false;
    },
    reverterPagamento: async function (cobrancaId) {
      const db = carregarDB();
      const cobranca = (db.cobrancas_individuais || []).find((c) => c.id === cobrancaId);
      if (cobranca) {
        cobranca.status = "pendente";
        cobranca.pago_em = null;
        salvarDB(db);
        return true;
      }
      return false;
    },
  };
})();
