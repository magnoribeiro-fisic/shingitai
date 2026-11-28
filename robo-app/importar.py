"""Copia aulas (vídeos e PDFs) de pastas do Google Drive para o bucket privado do app.
Vídeos são convertidos para MP4 H.264 720p (toca em qualquer celular) com início rápido.
Entrada: PASTAS = JSON {"curso-id": "idDaPastaOuArquivoNoDrive", ...}
Saída: manifesto em Firestore app_importacao/{curso} (o Claude monta o catálogo a partir dele)."""
import os, json, subprocess, requests, google.auth, re, unicodedata
from google.auth.transport.requests import Request

P = os.environ["GCP_PROJECT"]; BUCKET = os.environ["BUCKET"]
PASTAS = json.loads(os.environ["PASTAS"])
cred, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/drive.readonly"])
def tok():
    if not cred.valid: cred.refresh(Request())
    return cred.token
def call(m, u, **kw):
    h = kw.pop("headers", {}); h["Authorization"] = "Bearer " + tok()
    r = requests.request(m, u, headers=h, timeout=600, **kw)
    if r.status_code >= 300: raise RuntimeError(f"{r.status_code} {u}: {r.text[:500]}")
    return r
D = "https://www.googleapis.com/drive/v3/files"
CAMPOS = "files(id,name,mimeType,size,parents),nextPageToken"

def filhos(pid):
    out, pt = [], None
    while True:
        q = {"q": f"'{pid}' in parents and trashed=false", "fields": CAMPOS, "pageSize": 1000, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
        if pt: q["pageToken"] = pt
        j = call("GET", D, params=q).json(); out += j["files"]; pt = j.get("nextPageToken")
        if not pt: return out
def andar(fid, caminho=()):
    meta = call("GET", f"{D}/{fid}", params={"fields": "id,name,mimeType,size", "supportsAllDrives": "true"}).json()
    if meta["mimeType"] != "application/vnd.google-apps.folder":
        yield caminho, meta; return
    for f in sorted(filhos(fid), key=lambda x: x["name"]):
        if f["mimeType"] == "application/vnd.google-apps.folder":
            yield from andar(f["id"], caminho + (f["name"],))
        else:
            yield caminho + (meta["name"],) if not caminho else caminho, f

def slug(s):
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()[:70]
def existe(obj):
    r = requests.get(f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{requests.utils.quote(obj, safe='')}", headers={"Authorization": "Bearer " + tok()})
    return r.status_code == 200
def subir(arq, obj, tipo):
    with open(arq, "rb") as fh:
        call("POST", f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o", params={"uploadType": "media", "name": obj}, headers={"Content-Type": tipo}, data=fh)
def duracao(arq):
    try: return round(float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", arq]).decode().strip()))
    except Exception: return None

FS = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
for curso, raiz in PASTAS.items():
    itens = []
    for caminho, f in andar(raiz):
        mt, nome = f["mimeType"], f["name"]
        tipo = "video" if mt.startswith("video/") else ("pdf" if mt == "application/pdf" else None)
        if not tipo: print("ignorado:", nome, mt); continue
        pasta = caminho[-1] if caminho else ""
        obj = f"cursos/{curso}/{slug(pasta)}/{slug(os.path.splitext(nome)[0])}." + ("mp4" if tipo == "video" else "pdf")
        dur = None
        if not existe(obj):
            print(f"baixando {nome} ({int(f.get('size', 0))//1048576} MB)", flush=True)
            with requests.get(f"{D}/{f['id']}", params={"alt": "media", "supportsAllDrives": "true"}, headers={"Authorization": "Bearer " + tok()}, stream=True, timeout=1800) as r:
                r.raise_for_status()
                with open("entrada", "wb") as out:
                    for b in r.iter_content(8 << 20): out.write(b)
            if tipo == "video":
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "entrada", "-map", "0:v:0", "-map", "0:a:0?",
                                "-vf", "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
                                "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
                                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "saida.mp4"], check=True)
                dur = duracao("saida.mp4"); subir("saida.mp4", obj, "video/mp4"); os.remove("saida.mp4")
            else:
                subir("entrada", obj, "application/pdf")
            os.remove("entrada")
            print("  ok ->", obj, flush=True)
        else:
            print("já existe:", obj)
        itens.append({"mapValue": {"fields": {
            "pasta": {"stringValue": pasta}, "nome": {"stringValue": nome}, "tipo": {"stringValue": tipo},
            "caminho": {"stringValue": obj}, "duracao": {"integerValue": str(dur)} if dur else {"nullValue": None}}}})
    call("PATCH", f"{FS}/app_importacao/{curso}", json={"fields": {"itens": {"arrayValue": {"values": itens}}, "bucket": {"stringValue": BUCKET}}})
    print(f"MANIFESTO {curso}: {len(itens)} arquivos")
print("IMPORTACAO OK")
