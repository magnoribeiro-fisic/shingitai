// Servidor do App Shin Gi Tai — cursos, checkout Stripe, liberação de acesso e vídeos protegidos.
// Chaves ficam no Firestore (config_privada/app), nunca no código nem no GitHub.
import express from "express";
import Stripe from "stripe";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { Storage } from "@google-cloud/storage";

initializeApp();
const auth = getAuth();
const db = getFirestore();
const storage = new Storage();

const APP_URL = process.env.APP_URL || "https://magnoribeiro-fisic.github.io/shingitai/app/";
const SITE_URL = process.env.SITE_URL || "https://magnoribeiro-fisic.github.io/shingitai/";
const BUCKET = process.env.BUCKET || "shingitai-cursos";
const ORIGENS = [new URL(APP_URL).origin, "http://localhost:8080", "http://127.0.0.1:8080"];
const DIA = 86400000;

// ---------- configuração privada (cache de 5 min) ----------
let _cfg = null, _cfgEm = 0;
async function cfg() {
  if (_cfg && Date.now() - _cfgEm < 300000) return _cfg;
  const d = await db.doc("config_privada/app").get();
  _cfg = d.data() || {}; _cfgEm = Date.now();
  return _cfg;
}
let _stripe = null, _stripeKey = null;
async function stripe() {
  const c = await cfg();
  if (!c.stripeSecret) throw new Error("Stripe não configurada");
  if (!_stripe || _stripeKey !== c.stripeSecret) { _stripe = new Stripe(c.stripeSecret); _stripeKey = c.stripeSecret; }
  return _stripe;
}

// ---------- provedores de vídeo (hoje Google Cloud; Bunny pronto para entrar) ----------
async function urlArquivo(arquivo) {
  const prov = arquivo.provedor || "gcs";
  if (prov === "gcs") {
    const [url] = await storage.bucket(arquivo.bucket || BUCKET).file(arquivo.caminho).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 3 * 3600000,
    });
    return url;
  }
  if (prov === "bunny") {
    // Bunny Stream: URL do player com token (assinatura SHA256 de chave+videoId+expira)
    const c = await cfg();
    const exp = Math.floor(Date.now() / 1000) + 3 * 3600;
    const { createHash } = await import("node:crypto");
    const tok = createHash("sha256").update(c.bunnyTokenKey + arquivo.videoId + exp).digest("hex");
    return `https://iframe.mediadelivery.net/embed/${c.bunnyLibraryId}/${arquivo.videoId}?token=${tok}&expires=${exp}`;
  }
  throw new Error("provedor desconhecido");
}

// ---------- acesso ----------
const normEmail = (e) => String(e || "").trim().toLowerCase();
function acessoValido(a) {
  if (!a || a.status !== "ativo") return false;
  if (!a.ate) return true;
  const ate = a.ate.toMillis ? a.ate.toMillis() : new Date(a.ate).getTime();
  return ate > Date.now();
}
async function usuarioPorEmail(email, nome) {
  email = normEmail(email);
  try { return await auth.getUserByEmail(email); }
  catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    return await auth.createUser({ email, displayName: nome || undefined });
  }
}
// Libera os cursos de uma oferta para um e-mail. ref = id do pagamento (idempotente).
async function liberar({ email, nome, telefone, cursos, dias, ate, origem, ofertaId, ref }) {
  const user = await usuarioPorEmail(email, nome);
  const alunoRef = db.doc(`app_alunos/${user.uid}`);
  const fim = ate ? Timestamp.fromMillis(ate) : (dias ? Timestamp.fromMillis(Date.now() + dias * DIA) : null);
  const upd = { email: normEmail(email), atualizadoEm: FieldValue.serverTimestamp() };
  if (nome) upd.nome = nome;
  if (telefone) upd.telefone = telefone;
  for (const c of cursos) {
    upd[`acessos.${c}`] = { status: "ativo", origem, ofertaId: ofertaId || null, ref: ref || null, desde: Timestamp.now(), ate: fim };
  }
  const snap = await alunoRef.get();
  if (!snap.exists) await alunoRef.set({ email: normEmail(email), criadoEm: FieldValue.serverTimestamp(), senhaDefinida: false, acessos: {} });
  await alunoRef.update(upd);
  return user;
}
async function revogarPorRef(ref, motivo) {
  const p = await db.doc(`app_pagamentos/${ref}`).get();
  if (!p.exists) return false;
  const { uid, cursos } = p.data();
  const upd = {};
  for (const c of cursos || []) upd[`acessos.${c}.status`] = "revogado", upd[`acessos.${c}.motivo`] = motivo;
  await db.doc(`app_alunos/${uid}`).update(upd);
  await p.ref.update({ status: motivo, atualizadoEm: FieldValue.serverTimestamp() });
  return true;
}
async function ofertaPorId(id) {
  const d = await db.doc(`app_ofertas/${id}`).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGENS.includes(o)) {
    res.set("Access-Control-Allow-Origin", o);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Webhook da Stripe (corpo bruto para validar a assinatura)
app.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let ev;
  try {
    const c = await cfg();
    ev = (await stripe()).webhooks.constructEvent(req.body, req.headers["stripe-signature"], c.stripeWebhookSecret);
  } catch (e) { console.error("assinatura inválida", e.message); return res.status(400).send("assinatura inválida"); }
  try { await tratarEvento(ev); res.json({ ok: true }); }
  catch (e) { console.error("erro no evento", ev.type, e); res.status(500).send("erro"); }
});

async function tratarEvento(ev) {
  const o = ev.data.object;
  const s = await stripe();
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return; // Pix/boleto: espera confirmar
    const oferta = await ofertaPorId(o.metadata?.oferta);
    if (!oferta) throw new Error("oferta não encontrada: " + o.metadata?.oferta);
    const email = o.customer_details?.email || o.customer_email;
    const ref = o.payment_intent || o.subscription || o.id;
    const ja = await db.doc(`app_pagamentos/${ref}`).get();
    if (ja.exists && ja.data().status === "pago") return;
    let ate = null;
    if (o.mode === "subscription" && o.subscription) {
      const sub = await s.subscriptions.retrieve(o.subscription);
      const fim = sub.items?.data?.[0]?.current_period_end || sub.current_period_end;
      ate = (fim + 3 * 86400) * 1000; // 3 dias de tolerância para a renovação
    }
    const user = await liberar({
      email, nome: o.customer_details?.name, telefone: o.customer_details?.phone,
      cursos: oferta.cursos, dias: oferta.tipo === "anual" ? (oferta.dias || 365) : null, ate,
      origem: "stripe", ofertaId: oferta.id, ref,
    });
    await db.doc(`app_pagamentos/${ref}`).set({
      status: "pago", uid: user.uid, email: normEmail(email), oferta: oferta.id, cursos: oferta.cursos,
      valor: o.amount_total, moeda: o.currency, sessao: o.id, modo: o.mode, criadoEm: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }
  if (ev.type === "charge.refunded") return revogarPorRef(o.payment_intent, "reembolsado");
  if (ev.type === "charge.dispute.created") return revogarPorRef(o.payment_intent, "contestado");
  if (ev.type === "invoice.paid" && o.subscription && o.billing_reason !== "subscription_create") {
    const p = await db.doc(`app_pagamentos/${o.subscription}`).get();
    if (!p.exists) return;
    const fim = o.lines?.data?.[0]?.period?.end;
    const upd = {};
    for (const c of p.data().cursos) { upd[`acessos.${c}.ate`] = Timestamp.fromMillis((fim + 3 * 86400) * 1000); upd[`acessos.${c}.status`] = "ativo"; }
    await db.doc(`app_alunos/${p.data().uid}`).update(upd);
    return;
  }
  if (ev.type === "customer.subscription.deleted") return revogarPorRef(o.id, "assinatura_cancelada");
}

app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => res.redirect(APP_URL));
app.get("/saude", (req, res) => res.json({ ok: true }));

// Link de compra curto: /comprar/iniciantes → checkout da Stripe
app.get("/comprar/:oferta", async (req, res) => {
  try {
    const oferta = await ofertaPorId(req.params.oferta);
    if (!oferta || !oferta.ativo || !oferta.stripePrice) return res.redirect(SITE_URL);
    const s = await stripe();
    const recorrente = oferta.tipo === "mensal";
    const base = {
      mode: recorrente ? "subscription" : "payment",
      line_items: [{ price: oferta.stripePrice, quantity: 1 }],
      locale: "pt-BR",
      success_url: `${APP_URL}?s={CHECKOUT_SESSION_ID}#/bem-vindo`,
      cancel_url: oferta.paginaVenda || SITE_URL,
      metadata: { oferta: oferta.id },
      allow_promotion_codes: true,
      custom_text: { submit: { message: "Acesso liberado na hora no app Shin Gi Tai. Garantia de 7 dias." } },
    };
    if (!recorrente) {
      base.customer_creation = "always";
      base.payment_intent_data = { metadata: { oferta: oferta.id } };
    } else {
      base.subscription_data = { metadata: { oferta: oferta.id } };
    }
    if (req.query.email) base.customer_email = normEmail(req.query.email);
    let sessao;
    try {
      sessao = await s.checkout.sessions.create(recorrente ? base : { ...base, payment_method_options: { card: { installments: { enabled: true } } } });
    } catch (e) {
      console.warn("sem parcelamento:", e.message);
      sessao = await s.checkout.sessions.create(base);
    }
    res.redirect(303, sessao.url);
  } catch (e) { console.error(e); res.status(500).send("Não foi possível abrir o pagamento agora. Tente de novo em instantes."); }
});

// Ofertas públicas (para mostrar cursos bloqueados com botão de compra)
app.get("/api/ofertas", async (req, res) => {
  const q = await db.collection("app_ofertas").where("ativo", "==", true).get();
  res.json(q.docs.map((d) => { const o = d.data(); return { id: d.id, nome: o.nome, cursos: o.cursos, tipo: o.tipo, preco: o.precoCentavos, parcelas: o.parcelasTexto || null }; }));
});

// Primeiro acesso logo após a compra: confere a sessão paga e deixa criar a senha
async function sessaoPaga(id) {
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id || "")) return null;
  const s = await (await stripe()).checkout.sessions.retrieve(id);
  if (s.status !== "complete") return null;
  if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") return { pendente: true, email: s.customer_details?.email };
  return { email: normEmail(s.customer_details?.email || s.customer_email), sessao: s };
}
app.get("/api/primeiro-acesso", async (req, res) => {
  try {
    const r = await sessaoPaga(req.query.s);
    if (!r) return res.status(404).json({ erro: "Compra não encontrada." });
    if (r.pendente) return res.json({ pendente: true });
    const ref = r.sessao.payment_intent || r.sessao.subscription;
    let aluno = null;
    for (let i = 0; i < 8; i++) { // o webhook pode chegar alguns segundos depois
      const p = await db.doc(`app_pagamentos/${ref}`).get();
      if (p.exists) { aluno = (await db.doc(`app_alunos/${p.data().uid}`).get()).data(); break; }
      await new Promise((ok) => setTimeout(ok, 1500));
    }
    if (!aluno) return res.json({ processando: true, email: r.email });
    res.json({ email: r.email, precisaSenha: !aluno.senhaDefinida });
  } catch (e) { console.error(e); res.status(500).json({ erro: "Erro ao conferir a compra." }); }
});
app.post("/api/primeiro-acesso", async (req, res) => {
  try {
    const { s, senha } = req.body || {};
    if (typeof senha !== "string" || senha.length < 8 || senha.length > 100) return res.status(400).json({ erro: "A senha precisa ter pelo menos 8 caracteres." });
    const r = await sessaoPaga(s);
    if (!r || r.pendente) return res.status(404).json({ erro: "Compra não encontrada ou ainda não aprovada." });
    const user = await auth.getUserByEmail(r.email);
    const ref = db.doc(`app_alunos/${user.uid}`);
    const aluno = (await ref.get()).data();
    if (!aluno) return res.status(409).json({ erro: "Seu acesso ainda está sendo liberado. Tente de novo em alguns segundos." });
    if (aluno.senhaDefinida) return res.status(409).json({ erro: "Você já criou sua senha. Entre com ela ou use 'Esqueci minha senha'." });
    await auth.updateUser(user.uid, { password: senha });
    await ref.update({ senhaDefinida: true });
    res.json({ ok: true, email: r.email });
  } catch (e) { console.error(e); res.status(500).json({ erro: "Não foi possível criar a senha." }); }
});

// ---------- rotas do aluno (precisam de login) ----------
async function exigeLogin(req, res, next) {
  try {
    const t = (req.headers.authorization || "").replace(/^Bearer /, "");
    req.user = await auth.verifyIdToken(t, true);
    const c = await cfg();
    req.admin = (c.admins || []).map(normEmail).includes(normEmail(req.user.email));
    next();
  } catch { res.status(401).json({ erro: "Faça login novamente." }); }
}
function exigeAdmin(req, res, next) { req.admin ? next() : res.status(403).json({ erro: "Somente o administrador." }); }

app.get("/api/eu", exigeLogin, async (req, res) => {
  const ref = db.doc(`app_alunos/${req.user.uid}`);
  let aluno = (await ref.get()).data();
  if (!aluno) { aluno = { email: normEmail(req.user.email), acessos: {}, senhaDefinida: true }; await ref.set({ ...aluno, criadoEm: FieldValue.serverTimestamp() }); }
  else if (!aluno.senhaDefinida && req.user.firebase?.sign_in_provider === "password") await ref.update({ senhaDefinida: true });
  const cursos = (await db.collection("app_cursos").where("ativo", "==", true).get()).docs
    .map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  const lista = cursos.map((c) => {
    const ok = req.admin || acessoValido(aluno.acessos?.[c.id]);
    const base = { id: c.id, titulo: c.titulo, descricao: c.descricao || "", capa: c.capa || null, cor: c.cor || null, liberado: ok, ofertaVenda: c.ofertaVenda || null, emBreve: !!c.emBreve };
    const a = aluno.acessos?.[c.id];
    if (a?.ate) base.acessoAte = a.ate.toMillis();
    if (!ok) return { ...base, totalAulas: (c.modulos || []).reduce((n, m) => n + (m.aulas || []).length, 0) };
    return { ...base, modulos: (c.modulos || []).map((m) => ({ id: m.id, titulo: m.titulo, aulas: (m.aulas || []).map((x) => ({ id: x.id, titulo: x.titulo, tipo: x.tipo, duracao: x.duracao || null, descricao: x.descricao || "" })) })) };
  });
  res.json({ email: aluno.email, nome: aluno.nome || req.user.name || "", admin: req.admin, concluidas: aluno.concluidas || [], cursos: lista });
});

app.get("/api/arquivo/:curso/:aula", exigeLogin, async (req, res) => {
  try {
    const c = (await db.doc(`app_cursos/${req.params.curso}`).get()).data();
    if (!c) return res.status(404).json({ erro: "Curso não encontrado." });
    if (!req.admin) {
      const aluno = (await db.doc(`app_alunos/${req.user.uid}`).get()).data();
      if (!acessoValido(aluno?.acessos?.[req.params.curso])) return res.status(403).json({ erro: "Você não tem acesso a este curso." });
    }
    const aula = (c.modulos || []).flatMap((m) => m.aulas || []).find((a) => a.id === req.params.aula);
    if (!aula?.arquivo) return res.status(404).json({ erro: "Aula sem arquivo." });
    res.set("Cache-Control", "no-store");
    res.json({ url: await urlArquivo(aula.arquivo), tipo: aula.tipo, provedor: aula.arquivo.provedor || "gcs" });
  } catch (e) { console.error(e); res.status(500).json({ erro: "Erro ao abrir a aula." }); }
});

app.post("/api/progresso", exigeLogin, async (req, res) => {
  const { aula, feito } = req.body || {};
  if (typeof aula !== "string" || aula.length > 120) return res.status(400).end();
  await db.doc(`app_alunos/${req.user.uid}`).set({ concluidas: feito ? FieldValue.arrayUnion(aula) : FieldValue.arrayRemove(aula) }, { merge: true });
  res.json({ ok: true });
});

// ---------- painel do administrador ----------
const adm = express.Router();
adm.use(exigeLogin, exigeAdmin);

adm.get("/catalogo", async (req, res) => {
  const [c, o] = await Promise.all([db.collection("app_cursos").get(), db.collection("app_ofertas").get()]);
  res.json({ cursos: c.docs.map((d) => ({ id: d.id, ...d.data() })), ofertas: o.docs.map((d) => ({ id: d.id, ...d.data() })) });
});
const slugOk = (s) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(s);
adm.put("/curso/:id", async (req, res) => {
  if (!slugOk(req.params.id)) return res.status(400).json({ erro: "Identificador inválido (use letras minúsculas, números e hífen)." });
  const b = req.body || {};
  const curso = {
    titulo: String(b.titulo || "").slice(0, 120), descricao: String(b.descricao || "").slice(0, 2000),
    capa: b.capa || null, cor: b.cor || null, ordem: Number(b.ordem) || 0, ativo: b.ativo !== false, emBreve: !!b.emBreve,
    ofertaVenda: b.ofertaVenda || null,
    modulos: (b.modulos || []).map((m) => ({
      id: String(m.id), titulo: String(m.titulo || "").slice(0, 120),
      aulas: (m.aulas || []).map((a) => ({ id: String(a.id), titulo: String(a.titulo || "").slice(0, 160), tipo: a.tipo === "pdf" ? "pdf" : "video", descricao: String(a.descricao || "").slice(0, 2000), duracao: a.duracao || null, arquivo: a.arquivo || null })),
    })),
    atualizadoEm: FieldValue.serverTimestamp(),
  };
  if (!curso.titulo) return res.status(400).json({ erro: "Dê um título ao curso." });
  await db.doc(`app_cursos/${req.params.id}`).set(curso, { merge: false });
  res.json({ ok: true });
});
adm.delete("/curso/:id", async (req, res) => { // não apaga: só esconde
  await db.doc(`app_cursos/${req.params.id}`).update({ ativo: false });
  res.json({ ok: true });
});
adm.post("/upload", async (req, res) => {
  const { curso, nome, tipo } = req.body || {};
  if (!slugOk(curso || "")) return res.status(400).json({ erro: "curso inválido" });
  const ext = tipo === "application/pdf" ? "pdf" : (String(nome).split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const caminho = `cursos/${curso}/${Date.now()}-${String(nome).replace(/\.[^.]+$/, "").normalize("NFD").replace(/[^\w-]+/g, "-").slice(0, 60)}.${ext}`;
  const [url] = await storage.bucket(BUCKET).file(caminho).getSignedUrl({ version: "v4", action: "write", expires: Date.now() + 2 * 3600000, contentType: tipo });
  res.json({ url, arquivo: { provedor: "gcs", bucket: BUCKET, caminho } });
});
adm.put("/oferta/:id", async (req, res) => {
  if (!slugOk(req.params.id)) return res.status(400).json({ erro: "Identificador inválido." });
  const b = req.body || {};
  const ref = db.doc(`app_ofertas/${req.params.id}`);
  const atual = (await ref.get()).data() || {};
  const of = {
    nome: String(b.nome || atual.nome || "").slice(0, 120), cursos: b.cursos || atual.cursos || [],
    tipo: ["vitalicio", "anual", "mensal"].includes(b.tipo) ? b.tipo : (atual.tipo || "vitalicio"),
    dias: b.tipo === "anual" ? (Number(b.dias) || 365) : null,
    precoCentavos: Number(b.precoCentavos ?? atual.precoCentavos), ativo: b.ativo ?? atual.ativo ?? false,
    paginaVenda: b.paginaVenda ?? atual.paginaVenda ?? null, parcelasTexto: b.parcelasTexto ?? atual.parcelasTexto ?? null,
    stripeProduto: atual.stripeProduto || b.stripeProduto || null, stripePrice: atual.stripePrice || b.stripePrice || null,
  };
  if (!of.nome || !of.cursos.length || !(of.precoCentavos > 0)) return res.status(400).json({ erro: "Oferta precisa de nome, cursos e preço." });
  const s = await stripe();
  if (!of.stripeProduto) of.stripeProduto = (await s.products.create({ name: of.nome, metadata: { oferta: req.params.id } })).id;
  let precisaPreco = !of.stripePrice;
  if (!precisaPreco) {
    const p = await s.prices.retrieve(of.stripePrice);
    const recorrente = !!p.recurring;
    if (p.unit_amount !== of.precoCentavos || recorrente !== (of.tipo === "mensal")) precisaPreco = true;
  }
  if (precisaPreco) {
    of.stripePrice = (await s.prices.create({
      product: of.stripeProduto, currency: "brl", unit_amount: of.precoCentavos,
      ...(of.tipo === "mensal" ? { recurring: { interval: "month" } } : {}), metadata: { oferta: req.params.id },
    })).id;
  }
  await ref.set({ ...of, atualizadoEm: FieldValue.serverTimestamp() });
  res.json({ ok: true, oferta: of, link: `${req.protocol}://${req.get("host")}/comprar/${req.params.id}` });
});
adm.get("/alunos", async (req, res) => {
  const q = normEmail(req.query.q);
  let docs;
  if (q) docs = (await db.collection("app_alunos").where("email", ">=", q).where("email", "<=", q + "").limit(50).get()).docs;
  else docs = (await db.collection("app_alunos").orderBy("criadoEm", "desc").limit(100).get()).docs;
  res.json(docs.map((d) => { const a = d.data(); return { uid: d.id, email: a.email, nome: a.nome || "", senhaDefinida: !!a.senhaDefinida, acessos: Object.fromEntries(Object.entries(a.acessos || {}).map(([k, v]) => [k, { status: v.status, origem: v.origem, ate: v.ate?.toMillis?.() || null, valido: acessoValido(v) }])) }; }));
});
adm.post("/acesso", async (req, res) => {
  const { email, cursos, dias, acao } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(normEmail(email)) || !Array.isArray(cursos) || !cursos.length) return res.status(400).json({ erro: "Informe e-mail e cursos." });
  if (acao === "revogar") {
    const u = await auth.getUserByEmail(normEmail(email));
    const upd = {}; for (const c of cursos) upd[`acessos.${c}.status`] = "revogado";
    await db.doc(`app_alunos/${u.uid}`).update(upd);
    return res.json({ ok: true });
  }
  await liberar({ email, cursos, dias: Number(dias) || null, origem: "manual" });
  res.json({ ok: true });
});
adm.post("/importar", async (req, res) => { // alunos antigos (Hotmart): [{email, nome, cursos:[...]}]
  const linhas = (req.body?.linhas || []).slice(0, 2000);
  let ok = 0; const erros = [];
  for (const l of linhas) {
    try { await liberar({ email: l.email, nome: l.nome, cursos: l.cursos, origem: "hotmart" }); ok++; }
    catch (e) { erros.push({ email: l.email, erro: e.message }); }
  }
  res.json({ ok, erros });
});
adm.get("/vendas", async (req, res) => {
  const q = await db.collection("app_pagamentos").orderBy("criadoEm", "desc").limit(100).get();
  res.json(q.docs.map((d) => { const p = d.data(); return { id: d.id, email: p.email, oferta: p.oferta, valor: p.valor, status: p.status, quando: p.criadoEm?.toMillis?.() || null }; }));
});
app.use("/api/admin", adm);

const porta = process.env.PORT || 8080;
app.listen(porta, () => console.log("app-cursos ouvindo na porta", porta));
