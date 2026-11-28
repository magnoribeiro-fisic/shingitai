// App do aluno Shin Gi Tai — login (e-mail + senha), cursos, aulas e painel do administrador.
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence } from "firebase/auth";

const FIREBASE = { apiKey: "__API_KEY__", authDomain: "project-ca1348c0-fd1f-46bf-b8c.firebaseapp.com", projectId: "project-ca1348c0-fd1f-46bf-b8c", appId: "1:348938527666:web:f29693cb3c5c71b947faab" };
const API = "https://app-cursos-348938527666.us-central1.run.app";
const SITE = "https://magnoribeiro-fisic.github.io/shingitai/";
const fb = initializeApp(FIREBASE);
const auth = getAuth(fb);
auth.languageCode = "pt";
setPersistence(auth, browserLocalPersistence);

const $ = (s, el = document) => el.querySelector(s);
const tela = $("#tela");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
let dados = null; // resposta de /api/eu
let usuario = null;

function aviso(msg, ms = 3200) { const a = $("#aviso"); a.textContent = msg; a.hidden = false; clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.hidden = true), ms); }
function carregando() { tela.innerHTML = '<div class="carregando"><span></span></div>'; }
async function api(caminho, opt = {}) {
  const h = { ...(opt.headers || {}) };
  if (usuario) h.Authorization = "Bearer " + (await usuario.getIdToken());
  if (opt.body && typeof opt.body !== "string") { h["Content-Type"] = "application/json"; opt.body = JSON.stringify(opt.body); }
  const r = await fetch(API + caminho, { ...opt, headers: h });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Algo deu errado. Tente de novo.");
  return j;
}
const traduz = (e) => ({ "auth/invalid-credential": "E-mail ou senha incorretos.", "auth/wrong-password": "E-mail ou senha incorretos.", "auth/user-not-found": "E-mail ou senha incorretos.", "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos ou redefina sua senha.", "auth/invalid-email": "E-mail inválido.", "auth/network-request-failed": "Sem internet. Confira sua conexão." }[e.code] || e.message);

// ---------- telas públicas ----------
function telaEntrar(msg = "") {
  $("#topo").hidden = true;
  tela.innerHTML = `<div class="caixa">
    <div class="logo"><div class="marca-k">SHIN GI TAI</div><div class="sub">Área do aluno</div></div>
    <form class="card" id="f">
      <label class="campo"><span>E-mail da compra</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
      <div class="erro" id="err">${esc(msg)}</div>
      <button class="btn">Entrar</button>
      <p class="centro mt"><button type="button" class="link" id="esqueci">Primeiro acesso ou esqueci minha senha</button></p>
    </form>
    <p class="centro sub mt2">Ainda não é aluno? <a href="${SITE}">Conheça os treinos</a></p>
  </div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector(".btn"); b.disabled = true;
    try { await signInWithEmailAndPassword(auth, f.get("email").trim(), f.get("senha")); }
    catch (er) { $("#err").textContent = traduz(er); b.disabled = false; }
  };
  $("#esqueci").onclick = () => telaRedefinir($("[name=email]").value);
}
function telaRedefinir(email = "") {
  tela.innerHTML = `<div class="caixa"><a class="voltar" href="#/entrar">← Voltar</a>
    <form class="card" id="f"><h2>Criar ou redefinir senha</h2>
      <p class="sub mb">Digite o e-mail usado na compra. Se ele tiver acesso, você recebe um link para criar sua senha (olhe também o spam/lixo eletrônico).</p>
      <label class="campo"><span>E-mail da compra</span><input type="email" name="email" value="${esc(email)}" required></label>
      <div class="erro" id="err"></div><button class="btn">Enviar link</button></form></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const em = new FormData(e.target).get("email").trim();
    try { await sendPasswordResetEmail(auth, em, { url: location.origin + location.pathname }); tela.innerHTML = `<div class="caixa card centro"><h2>Pronto!</h2><p class="sub mt">Se <b>${esc(em)}</b> tiver acesso, o link chega em alguns minutos. Abra o e-mail, crie sua senha e volte aqui para entrar.</p><a class="btn mt2" href="#/entrar">Voltar para o login</a></div>`; }
    catch (er) { $("#err").textContent = traduz(er); }
  };
}
async function telaBemVindo() {
  $("#topo").hidden = true;
  const s = new URLSearchParams(location.search).get("s");
  if (!s) return (location.hash = "#/entrar");
  carregando();
  let info;
  try { info = await api("/api/primeiro-acesso?s=" + encodeURIComponent(s)); } catch (e) { return telaEntrar(e.message); }
  if (info.pendente) { tela.innerHTML = `<div class="caixa card centro"><h2>Quase lá!</h2><p class="sub mt">Seu pagamento está aguardando confirmação. Assim que ele for aprovado, seu acesso é liberado e você cria sua senha por esta mesma página.</p><button class="btn mt2" onclick="location.reload()">Já paguei, verificar de novo</button></div>`; return; }
  if (info.processando) { setTimeout(telaBemVindo, 3000); return; }
  if (!info.precisaSenha) { telaEntrar("Você já criou sua senha. É só entrar."); $("[name=email]").value = info.email; return; }
  tela.innerHTML = `<div class="caixa"><div class="logo"><div class="marca-k">SHIN GI TAI</div></div>
    <form class="card" id="f"><h2>Pagamento aprovado! 🎉</h2>
      <p class="sub mb">Agora crie a senha que você vai usar para entrar no app.</p>
      <label class="campo"><span>Seu e-mail de acesso</span><input type="email" value="${esc(info.email)}" disabled></label>
      <label class="campo"><span>Crie uma senha (mínimo 8 caracteres)</span><input type="password" name="s1" minlength="8" autocomplete="new-password" required></label>
      <label class="campo"><span>Repita a senha</span><input type="password" name="s2" minlength="8" autocomplete="new-password" required></label>
      <div class="erro" id="err"></div><button class="btn">Criar senha e entrar</button></form></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector(".btn");
    if (f.get("s1") !== f.get("s2")) return ($("#err").textContent = "As senhas não são iguais.");
    b.disabled = true;
    try {
      await api("/api/primeiro-acesso", { method: "POST", body: { s, senha: f.get("s1") } });
      history.replaceState(null, "", location.pathname + "#/inicio");
      await signInWithEmailAndPassword(auth, info.email, f.get("s1"));
    } catch (er) { $("#err").textContent = traduz(er); b.disabled = false; }
  };
}

// ---------- telas do aluno ----------
async function carregarDados(forcar) { if (!dados || forcar) dados = await api("/api/eu"); $("#link-admin").hidden = !dados.admin; return dados; }
function progresso(c) { const ids = (c.modulos || []).flatMap((m) => m.aulas.map((a) => a.id)); const f = ids.filter((i) => dados.concluidas.includes(i)).length; return ids.length ? Math.round((f / ids.length) * 100) : 0; }
async function telaInicio() {
  await carregarDados();
  const lib = dados.cursos.filter((c) => c.liberado), bloq = dados.cursos.filter((c) => !c.liberado);
  const card = (c) => {
    const capa = c.capa ? `style="background-image:url('${esc(c.capa)}')"` : "";
    if (c.liberado) { const p = progresso(c); return `<a class="curso" href="#/curso/${c.id}"><div class="capa" ${capa}></div><span class="selo on">${p}% concluído</span><div class="corpo"><h3>${esc(c.titulo)}</h3><div class="barra"><i style="width:${p}%"></i></div>${c.acessoAte ? `<p class="sub peq mt">Acesso até ${new Date(c.acessoAte).toLocaleDateString("pt-BR")}</p>` : ""}</div></a>`; }
    const comprar = c.ofertaVenda && !c.emBreve ? `<a class="btn peq mt" href="${API}/comprar/${c.ofertaVenda}?email=${encodeURIComponent(dados.email)}">Desbloquear</a>` : "";
    return `<div class="curso bloq"><div class="capa" ${capa}></div><span class="selo">${c.emBreve ? "Em breve" : "🔒 Bloqueado"}</span><div class="corpo"><h3>${esc(c.titulo)}</h3><p class="sub peq">${esc(c.descricao).slice(0, 140)}</p>${comprar}</div></div>`;
  };
  tela.innerHTML = `<h1>Olá${dados.nome ? ", " + esc(dados.nome.split(" ")[0]) : ""}!</h1><p class="sub mb">Escolha seu treino e bora vencer mais um dia.</p>
    ${lib.length ? `<div class="cursos">${lib.map(card).join("")}</div>` : `<div class="card sub">Você ainda não tem cursos liberados neste e-mail (${esc(dados.email)}). Se você comprou com outro e-mail, saia e entre com ele.</div>`}
    ${bloq.length ? `<h2 class="mt2 mb">Outros treinos</h2><div class="cursos">${bloq.map(card).join("")}</div>` : ""}
    ${instalarDica()}`;
}
function instalarDica() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="instalar">📲 <b>Coloque o app na tela do celular:</b> ${ios ? "toque em Compartilhar (quadrado com seta) → <b>Adicionar à Tela de Início</b>." : "toque nos três pontinhos do navegador → <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>."}</div>`;
}
async function telaCurso(id) {
  await carregarDados();
  const c = dados.cursos.find((x) => x.id === id);
  if (!c || !c.liberado) return (location.hash = "#/inicio");
  tela.innerHTML = `<a class="voltar" href="#/inicio">← Meus treinos</a><h1>${esc(c.titulo)}</h1><p class="sub">${esc(c.descricao)}</p>
    ${c.modulos.map((m, i) => `<details class="modulo" ${i === 0 ? "open" : ""}><summary><span>${esc(m.titulo)}</span><span class="sub peq">${m.aulas.length} aulas</span></summary>
      ${m.aulas.map((a) => `<a class="aula ${dados.concluidas.includes(a.id) ? "feita" : ""}" href="#/aula/${c.id}/${a.id}"><span class="ic">${dados.concluidas.includes(a.id) ? "✓" : a.tipo === "pdf" ? "PDF" : "▶"}</span><span class="t">${esc(a.titulo)}</span><span class="d">${fmtDur(a.duracao)}</span></a>`).join("")}</details>`).join("")}`;
}
async function telaAula(cid, aid) {
  await carregarDados();
  const c = dados.cursos.find((x) => x.id === cid);
  if (!c || !c.liberado) return (location.hash = "#/inicio");
  const todas = c.modulos.flatMap((m) => m.aulas.map((a) => ({ ...a, modulo: m.titulo })));
  const i = todas.findIndex((a) => a.id === aid); const a = todas[i]; if (!a) return (location.hash = "#/curso/" + cid);
  const prox = todas[i + 1], ant = todas[i - 1];
  const feita = dados.concluidas.includes(a.id);
  tela.innerHTML = `<a class="voltar" href="#/curso/${cid}">← ${esc(c.titulo)}</a><p class="sub peq">${esc(a.modulo)}</p><h2 class="mb">${esc(a.titulo)}</h2>
    <div id="midia" class="${a.tipo === "pdf" ? "card centro" : "video"}"><div class="carregando" style="height:auto"><span></span></div></div>
    ${a.descricao ? `<p class="mt">${esc(a.descricao)}</p>` : ""}
    <button class="btn ${feita ? "sec" : "verde"} mt" id="feito">${feita ? "✓ Concluída (desmarcar)" : "Marcar como concluída"}</button>
    <div class="linha mt">${ant ? `<a class="btn sec" href="#/aula/${cid}/${ant.id}">← Anterior</a>` : "<span></span>"}${prox ? `<a class="btn sec" href="#/aula/${cid}/${prox.id}">Próxima →</a>` : "<span></span>"}</div>`;
  $("#feito").onclick = async () => {
    const novo = !dados.concluidas.includes(a.id);
    dados.concluidas = novo ? [...dados.concluidas, a.id] : dados.concluidas.filter((x) => x !== a.id);
    api("/api/progresso", { method: "POST", body: { aula: a.id, feito: novo } }).catch(() => {});
    if (novo && prox) location.hash = `#/aula/${cid}/${prox.id}`; else telaAula(cid, aid);
  };
  try {
    const r = await api(`/api/arquivo/${cid}/${aid}`);
    const m = $("#midia");
    if (a.tipo === "pdf") m.innerHTML = `<p class="mb">📄 Material em PDF</p><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir PDF</a>`;
    else if (r.provedor === "bunny") m.innerHTML = `<iframe src="${esc(r.url)}" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen></iframe>`;
    else {
      m.innerHTML = `<video controls playsinline preload="metadata" controlslist="nodownload" disablepictureinpicture src="${esc(r.url)}"></video>`;
      const v = $("video", m); v.oncontextmenu = (e) => e.preventDefault();
      v.onloadedmetadata = () => { if (v.videoWidth > v.videoHeight) m.classList.add("h"); };
      v.onended = () => { if (!dados.concluidas.includes(a.id)) $("#feito").click(); };
    }
  } catch (e) { $("#midia").innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}

// ---------- painel do administrador ----------
let cat = null, aba = "cursos";
const novoId = (p) => p + "-" + Math.random().toString(36).slice(2, 8);
async function telaAdmin(sub) {
  await carregarDados(); if (!dados.admin) return (location.hash = "#/inicio");
  aba = sub || aba;
  tela.innerHTML = `<h1>Painel</h1><div class="abas">${["cursos", "ofertas", "alunos", "vendas"].map((x) => `<button data-a="${x}" class="${x === aba ? "on" : ""}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div><div id="adm"><div class="carregando"><span></span></div></div>`;
  tela.querySelectorAll(".abas button").forEach((b) => (b.onclick = () => (location.hash = "#/admin/" + b.dataset.a)));
  const el = $("#adm");
  try {
    if (aba === "cursos" || aba === "ofertas") cat = await api("/api/admin/catalogo");
    if (aba === "cursos") return admCursos(el);
    if (aba === "ofertas") return admOfertas(el);
    if (aba === "alunos") return admAlunos(el);
    if (aba === "vendas") return admVendas(el);
  } catch (e) { el.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}
function admCursos(el) {
  const cs = cat.cursos.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  el.innerHTML = cs.map((c) => `<div class="item"><span class="t"><b>${esc(c.titulo)}</b><br><span class="sub peq">${c.id} · ${(c.modulos || []).reduce((n, m) => n + m.aulas.length, 0)} aulas ${c.ativo === false ? "· <span class='tag no'>oculto</span>" : ""}${c.emBreve ? "<span class='tag'>em breve</span>" : ""}</span></span><a class="btn peq sec" href="#/admin-curso/${c.id}">Editar</a></div>`).join("") +
    `<form id="novo" class="card mt"><h3>Novo curso</h3><p class="sub peq mb">Ex.: identificador <b>muscle-up</b>, título <b>Muscle Up</b></p><div class="linha"><input name="id" placeholder="identificador" pattern="[a-z0-9-]+" required><input name="titulo" placeholder="Título" required></div><button class="btn mt">Criar curso</button></form>`;
  $("#novo").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api("/api/admin/curso/" + f.get("id"), { method: "PUT", body: { titulo: f.get("titulo"), ordem: cs.length + 1, emBreve: true, modulos: [] } }); location.hash = "#/admin-curso/" + f.get("id"); } catch (er) { aviso(er.message); }
  };
}
async function telaAdminCurso(id) {
  await carregarDados(); if (!dados.admin) return (location.hash = "#/inicio");
  cat = await api("/api/admin/catalogo");
  const c = JSON.parse(JSON.stringify(cat.cursos.find((x) => x.id === id)));
  c.modulos = c.modulos || [];
  const desenha = () => {
    tela.innerHTML = `<a class="voltar" href="#/admin/cursos">← Cursos</a><h2>${esc(c.titulo)}</h2>
    <div class="card mt">
      <label class="campo"><span>Título</span><input id="ct" value="${esc(c.titulo)}"></label>
      <label class="campo"><span>Descrição</span><textarea id="cd">${esc(c.descricao || "")}</textarea></label>
      <label class="campo"><span>Imagem de capa (link)</span><input id="cc" value="${esc(c.capa || "")}"></label>
      <div class="linha"><label class="campo"><span>Ordem</span><input id="co" type="number" value="${c.ordem || 0}"></label>
      <label class="campo"><span>Oferta para desbloquear</span><select id="cv"><option value="">—</option>${cat.ofertas.map((o) => `<option ${o.id === c.ofertaVenda ? "selected" : ""}>${o.id}</option>`).join("")}</select></label></div>
      <label class="linha"><span style="flex:0"><input type="checkbox" id="cb" ${c.emBreve ? "checked" : ""} style="width:auto"></span><span>Mostrar como “Em breve”</span></label>
      <label class="linha mt"><span style="flex:0"><input type="checkbox" id="ca" ${c.ativo !== false ? "checked" : ""} style="width:auto"></span><span>Visível no app</span></label>
    </div>
    ${c.modulos.map((m, mi) => `<div class="card mt"><div class="linha"><input data-m="${mi}" class="mt-tit" value="${esc(m.titulo)}"><span style="flex:0;display:flex;gap:4px"><button class="mini" data-acao="msobe" data-m="${mi}">↑</button><button class="mini" data-acao="mdesce" data-m="${mi}">↓</button><button class="mini" data-acao="mdel" data-m="${mi}">✕</button></span></div>
      ${m.aulas.map((a, ai) => `<div class="item"><span class="ic">${a.tipo === "pdf" ? "📄" : "🎬"}</span><input class="t au-tit" data-m="${mi}" data-a="${ai}" value="${esc(a.titulo)}" style="padding:8px"><span class="tag ${a.arquivo ? "ok" : "no"}">${a.arquivo ? "arquivo ok" : "sem arquivo"}</span><button class="mini" data-acao="asobe" data-m="${mi}" data-a="${ai}">↑</button><button class="mini" data-acao="adesce" data-m="${mi}" data-a="${ai}">↓</button><button class="mini" data-acao="adel" data-m="${mi}" data-a="${ai}">✕</button></div>`).join("")}
      <div class="item"><input type="file" data-m="${mi}" class="up" accept="video/*,application/pdf" style="padding:8px"></div><p class="sub peq">Escolha um vídeo ou PDF para adicionar uma aula neste módulo.</p></div>`).join("")}
    <button class="btn sec mt" id="nmod">+ Adicionar módulo</button>
    <button class="btn mt" id="salvar">Salvar curso</button>`;
    const ler = () => {
      c.titulo = $("#ct").value; c.descricao = $("#cd").value; c.capa = $("#cc").value || null; c.ordem = Number($("#co").value); c.ofertaVenda = $("#cv").value || null; c.emBreve = $("#cb").checked; c.ativo = $("#ca").checked;
      tela.querySelectorAll(".mt-tit").forEach((i) => (c.modulos[i.dataset.m].titulo = i.value));
      tela.querySelectorAll(".au-tit").forEach((i) => (c.modulos[i.dataset.m].aulas[i.dataset.a].titulo = i.value));
    };
    const troca = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
    tela.querySelectorAll("[data-acao]").forEach((b) => (b.onclick = () => {
      ler(); const m = +b.dataset.m, a = +b.dataset.a, ac = b.dataset.acao;
      if (ac === "msobe") troca(c.modulos, m, m - 1); if (ac === "mdesce") troca(c.modulos, m, m + 1);
      if (ac === "mdel" && confirm("Remover este módulo e as aulas dele do app? (os arquivos continuam guardados)")) c.modulos.splice(m, 1);
      if (ac === "asobe") troca(c.modulos[m].aulas, a, a - 1); if (ac === "adesce") troca(c.modulos[m].aulas, a, a + 1);
      if (ac === "adel" && confirm("Remover esta aula do app?")) c.modulos[m].aulas.splice(a, 1);
      desenha();
    }));
    $("#nmod").onclick = () => { ler(); c.modulos.push({ id: novoId("m"), titulo: "Novo módulo", aulas: [] }); desenha(); };
    tela.querySelectorAll(".up").forEach((inp) => (inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; ler();
      const tipo = f.type === "application/pdf" ? "application/pdf" : (f.type || "video/mp4");
      try {
        aviso("Enviando " + f.name + "… não feche a tela.", 600000);
        const u = await api("/api/admin/upload", { method: "POST", body: { curso: id, nome: f.name, tipo } });
        const r = await fetch(u.url, { method: "PUT", headers: { "Content-Type": tipo }, body: f });
        if (!r.ok) throw new Error("Falha no envio do arquivo.");
        c.modulos[inp.dataset.m].aulas.push({ id: novoId("a"), titulo: f.name.replace(/\.[^.]+$/, ""), tipo: tipo === "application/pdf" ? "pdf" : "video", arquivo: u.arquivo });
        await api("/api/admin/curso/" + id, { method: "PUT", body: c });
        aviso("Aula adicionada e salva!"); desenha();
      } catch (e) { aviso(e.message); }
    }));
    $("#salvar").onclick = async () => { ler(); try { await api("/api/admin/curso/" + id, { method: "PUT", body: c }); dados = null; aviso("Curso salvo!"); } catch (e) { aviso(e.message); } };
  };
  desenha();
}
function admOfertas(el) {
  el.innerHTML = cat.ofertas.map((o) => `<div class="card mt"><h3>${esc(o.nome)} ${o.ativo ? "<span class='tag ok'>à venda</span>" : "<span class='tag no'>pausada</span>"}</h3>
    <p class="sub peq">${o.id} · ${brl(o.precoCentavos)} · ${{ vitalicio: "acesso vitalício", anual: `acesso por ${o.dias || 365} dias`, mensal: "assinatura mensal" }[o.tipo]} · libera: ${o.cursos.join(", ")}</p>
    <div class="item"><span class="t peq">${API}/comprar/${o.id}</span><button class="mini" data-c="${API}/comprar/${o.id}">⧉</button></div></div>`).join("") +
    `<p class="sub peq mt">Para criar ou mudar ofertas (pacotes, acesso de 1 ano, assinatura mensal), peça ao Claude no chat.</p>`;
  el.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.c); aviso("Link copiado!"); }));
}
async function admAlunos(el, q = "") {
  const lista = await api("/api/admin/alunos" + (q ? "?q=" + encodeURIComponent(q) : ""));
  const cursos = (cat || (cat = await api("/api/admin/catalogo"))).cursos;
  el.innerHTML = `<form id="busca" class="linha"><input name="q" placeholder="Buscar por e-mail" value="${esc(q)}"><button class="btn peq" style="flex:0">Buscar</button></form>
    <form id="lib" class="card mt"><h3>Liberar ou tirar acesso</h3><input name="email" type="email" placeholder="e-mail do aluno" required class="mt">
      <div class="mt">${cursos.map((c) => `<label class="tag" style="padding:6px 10px"><input type="checkbox" name="c" value="${c.id}" style="width:auto"> ${esc(c.titulo)}</label>`).join("")}</div>
      <div class="linha mt"><button class="btn peq verde" data-ac="liberar">Liberar</button><button class="btn peq sec" data-ac="revogar">Tirar acesso</button></div></form>
    <div class="card mt"><h3>Importar alunos da Hotmart</h3><p class="sub peq mb">Na Hotmart: Vendas → exportar (CSV). Escolha o curso e envie o arquivo.</p><select id="imc">${cursos.map((c) => `<option value="${c.id}">${esc(c.titulo)}</option>`).join("")}</select><input type="file" id="imf" accept=".csv,text/csv" class="mt"></div>
    <table class="mt"><tr><th>Aluno</th><th>Acessos</th></tr>${lista.map((a) => `<tr><td>${esc(a.email)}<br><span class="sub peq">${esc(a.nome)} ${a.senhaDefinida ? "" : "· sem senha ainda"}</span></td><td>${Object.entries(a.acessos).map(([k, v]) => `<span class="tag ${v.valido ? "ok" : "no"}">${k}${v.ate ? " até " + new Date(v.ate).toLocaleDateString("pt-BR") : ""}</span>`).join("")}</td></tr>`).join("")}</table>`;
  $("#busca").onsubmit = (e) => { e.preventDefault(); admAlunos(el, new FormData(e.target).get("q")); };
  $("#lib").onsubmit = (e) => e.preventDefault();
  $("#lib").querySelectorAll("[data-ac]").forEach((b) => (b.onclick = async () => {
    const f = new FormData($("#lib")); const cs = f.getAll("c"); if (!f.get("email") || !cs.length) return aviso("Informe o e-mail e marque os cursos.");
    try { await api("/api/admin/acesso", { method: "POST", body: { email: f.get("email"), cursos: cs, acao: b.dataset.ac } }); aviso("Feito!"); admAlunos(el, f.get("email")); } catch (er) { aviso(er.message); }
  }));
  $("#imf").onchange = async (e) => {
    const txt = await e.target.files[0].text();
    const linhas = txt.split(/\r?\n/).filter(Boolean); const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ";" : ",";
    const cab = linhas[0].split(sep).map((x) => x.replace(/"/g, "").trim().toLowerCase());
    const iE = cab.findIndex((x) => x.includes("email") || x.includes("e-mail")), iN = cab.findIndex((x) => x === "nome" || x.includes("comprador") || x.includes("name"));
    if (iE < 0) return aviso("Não achei a coluna de e-mail no arquivo.");
    const vistos = new Set(); const reg = [];
    for (const l of linhas.slice(1)) { const p = l.split(sep).map((x) => x.replace(/"/g, "").trim()); const em = (p[iE] || "").toLowerCase(); if (/\S+@\S+/.test(em) && !vistos.has(em)) { vistos.add(em); reg.push({ email: em, nome: iN >= 0 ? p[iN] : "", cursos: [$("#imc").value] }); } }
    if (!confirm(`Liberar ${reg.length} alunos no curso ${$("#imc").value}?`)) return;
    try { const r = await api("/api/admin/importar", { method: "POST", body: { linhas: reg } }); aviso(`${r.ok} alunos liberados${r.erros.length ? `, ${r.erros.length} com erro` : ""}.`, 6000); admAlunos(el); } catch (er) { aviso(er.message); }
  };
}
async function admVendas(el) {
  const v = await api("/api/admin/vendas");
  const total = v.filter((x) => x.status === "pago").reduce((s, x) => s + (x.valor || 0), 0);
  el.innerHTML = `<div class="card"><p class="sub">Vendas no app (últimas 100)</p><h2>${brl(total)}</h2></div><table class="mt"><tr><th>Quando</th><th>Aluno</th><th>Oferta</th><th>Valor</th></tr>${v.map((x) => `<tr><td class="peq">${x.quando ? new Date(x.quando).toLocaleString("pt-BR") : ""}</td><td class="peq">${esc(x.email)}</td><td class="peq">${esc(x.oferta)}${x.status !== "pago" ? ` <span class="tag no">${esc(x.status)}</span>` : ""}</td><td>${brl(x.valor || 0)}</td></tr>`).join("")}</table>`;
}

// ---------- rotas ----------
async function rota() {
  const h = location.hash.replace(/^#\/?/, ""); const [r, a, b] = h.split("/");
  if (r === "bem-vindo") return telaBemVindo();
  if (!usuario) return r === "redefinir" ? telaRedefinir() : telaEntrar();
  $("#topo").hidden = false; carregando(); window.scrollTo(0, 0);
  try {
    if (r === "curso") return await telaCurso(a);
    if (r === "aula") return await telaAula(a, b);
    if (r === "admin") return await telaAdmin(a);
    if (r === "admin-curso") return await telaAdminCurso(a);
    return await telaInicio();
  } catch (e) { tela.innerHTML = `<div class="card"><p class="erro">${esc(e.message)}</p><button class="btn mt" onclick="location.reload()">Tentar de novo</button></div>`; }
}
$("#sair").onclick = async () => { await signOut(auth); dados = null; location.hash = "#/entrar"; };
window.addEventListener("hashchange", rota);
let primeira = true;
onAuthStateChanged(auth, (u) => {
  usuario = u; dados = null;
  if (u && /entrar|bem-vindo|redefinir/.test(location.hash)) { history.replaceState(null, "", location.pathname + "#/inicio"); }
  if (primeira || true) rota(); primeira = false;
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
