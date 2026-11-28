"""Configura (uma vez, e pode repetir sem estragar) a infraestrutura do App Shin Gi Tai.
Roda no GitHub Actions com a conta robo-app (login sem chave)."""
import os, json, requests, google.auth
from google.auth.transport.requests import Request

P = os.environ["GCP_PROJECT"]
REGIAO = os.environ.get("REGIAO", "us-central1")
BUCKET = os.environ["BUCKET"]
SRV = f"app-servidor@{P}.iam.gserviceaccount.com"
APP_ORIGEM = "https://magnoribeiro-fisic.github.io"

cred, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"])
def call(m, u, **kw):
    if not cred.valid: cred.refresh(Request())
    h = kw.pop("headers", {}); h["Authorization"] = "Bearer " + cred.token; h["x-goog-user-project"] = P
    return requests.request(m, u, headers=h, timeout=120, **kw)
def ok(r, *aceitos):
    if r.status_code >= 300 and r.status_code not in aceitos:
        raise SystemExit(f"ERRO {r.status_code} {r.url}\n{r.text[:2000]}")
    return r

# 1) Repositório de imagens do servidor
r = call("POST", f"https://artifactregistry.googleapis.com/v1/projects/{P}/locations/{REGIAO}/repositories?repositoryId=app",
         json={"format": "DOCKER", "description": "Servidor do App Shin Gi Tai"})
print("artifact registry:", r.status_code); ok(r, 409)

# 2) Bucket privado dos vídeos
r = call("POST", f"https://storage.googleapis.com/storage/v1/b?project={P}", json={
    "name": BUCKET, "location": REGIAO.upper(), "storageClass": "STANDARD",
    "iamConfiguration": {"uniformBucketLevelAccess": {"enabled": True}, "publicAccessPrevention": "enforced"},
})
print("bucket:", r.status_code); ok(r, 409)
ok(call("PATCH", f"https://storage.googleapis.com/storage/v1/b/{BUCKET}", json={"cors": [{
    "origin": [APP_ORIGEM, "http://localhost:8080"], "method": ["GET", "HEAD", "PUT"],
    "responseHeader": ["Content-Type", "Range", "Content-Range", "Accept-Ranges"], "maxAgeSeconds": 3600}]}))
pol = ok(call("GET", f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/iam")).json()
membro = f"serviceAccount:{SRV}"
if not any(b["role"] == "roles/storage.objectAdmin" and membro in b["members"] for b in pol.get("bindings", [])):
    pol.setdefault("bindings", []).append({"role": "roles/storage.objectAdmin", "members": [membro]})
    ok(call("PUT", f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/iam", json=pol))
print("bucket pronto, servidor com acesso")

# 3) Login por e-mail + senha (Firebase Authentication)
IT = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/config"
r = call("GET", IT)
if r.status_code == 404 or "CONFIGURATION_NOT_FOUND" in r.text:
    print("inicializando Authentication:", call("POST", f"https://identitytoolkit.googleapis.com/v2/projects/{P}/identityPlatform:initializeAuth", json={}).status_code)
    r = call("GET", IT)
ok(r)
conf = r.json()
dominios = set(conf.get("authorizedDomains", [])) | {"magnoribeiro-fisic.github.io", f"{P}.firebaseapp.com", f"{P}.web.app", "localhost"}
ok(call("PATCH", IT + "?updateMask=signIn.email,authorizedDomains,notification.defaultLocale,emailPrivacyConfig", json={
    "signIn": {"email": {"enabled": True, "passwordRequired": True}},
    "authorizedDomains": sorted(dominios),
    "notification": {"defaultLocale": "pt_BR"},
    "emailPrivacyConfig": {"enableImprovedEmailPrivacy": True},
}))
print("login por e-mail e senha ativo")

# 4) Regras do Firestore: nenhum acesso direto pelo navegador (tudo passa pelo servidor)
REGRAS = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n"
FR = "https://firebaserules.googleapis.com/v1"
atual = call("GET", f"{FR}/projects/{P}/releases/cloud.firestore")
if atual.ok:
    rs = call("GET", f"{FR}/{atual.json()['rulesetName']}").json()
    print("regras anteriores:\n", rs.get("source", {}).get("files", [{}])[0].get("content", "")[:1500])
rs = ok(call("POST", f"{FR}/projects/{P}/rulesets", json={"source": {"files": [{"name": "firestore.rules", "content": REGRAS}]}})).json()
rel = {"name": f"projects/{P}/releases/cloud.firestore", "rulesetName": rs["name"]}
if atual.ok: ok(call("PATCH", f"{FR}/projects/{P}/releases/cloud.firestore", json={"release": rel}))
else: ok(call("POST", f"{FR}/projects/{P}/releases", json=rel))
print("regras do Firestore: tudo bloqueado para o navegador")
print("CONFIGURACAO OK")
