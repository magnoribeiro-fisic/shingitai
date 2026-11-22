#!/usr/bin/env python3
"""Robo de repost @magno.riibeiro -> @magno.brap (SHIN GI TAI). Roda no GitHub Actions, sem IA.
Fila: Firestore shingitai_repost_brap (status pendente; legenda pronta em 'legenda_pronta').
Video hospedado por alguns minutos num branch temporario (tmp-video) e buscado pela Meta via video_url.
Sem segredos no GitHub: login no Google por Workload Identity Federation (sem chave);
token da Meta lido do Firestore config_privada/repost_brap."""
import os, io, json, time, subprocess, tempfile, datetime, requests, imagehash
from PIL import Image
import google.auth
from google.auth.transport.requests import Request

G = 'https://graph.facebook.com/v24.0'
REPO = os.environ['GITHUB_REPOSITORY']
PUSH = os.environ.get('PUSH_URL') or f"https://x-access-token:{os.environ['GITHUB_TOKEN']}@github.com/{REPO}"
cr, _proj = google.auth.default(scopes=['https://www.googleapis.com/auth/datastore'])
cr.refresh(Request())
PROJ = os.environ.get('GCP_PROJECT') or _proj
FB = f'https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)/documents'
FS = f'{FB}/shingitai_repost_brap'
FH = {'Authorization': 'Bearer ' + cr.token}
_cfg = requests.get(f'{FB}/config_privada/repost_brap', headers=FH, timeout=60).json()['fields']
T = _cfg['META_ACCESS_TOKEN']['stringValue']; BRAP = _cfg['INSTAGRAM_BRAP_ID']['stringValue']
WORK = tempfile.mkdtemp()


def val(v):
    k, x = next(iter(v.items()))
    return int(x) if k == 'integerValue' else x


def fila():
    out, tok = [], None
    while True:
        p = {'pageSize': 300, **({'pageToken': tok} if tok else {})}
        r = requests.get(FS, headers=FH, params=p, timeout=60).json()
        for d in r.get('documents', []):
            x = {a: val(b) for a, b in d['fields'].items() if next(iter(b)) in ('stringValue', 'integerValue')}
            x['_id'] = d['name'].split('/')[-1]; out.append(x)
        tok = r.get('nextPageToken')
        if not tok: break
    return sorted([d for d in out if d.get('status') == 'pendente' and d.get('legenda_pronta')], key=lambda d: d['ordem'])


def marcar(doc_id, **campos):
    f = {k: {'stringValue': str(v)} for k, v in campos.items()}
    r = requests.patch(f'{FS}/{doc_id}', headers=FH, params=[('updateMask.fieldPaths', k) for k in campos],
                       json={'fields': f}, timeout=60)
    r.raise_for_status()


def g(path, **p):
    p['access_token'] = T
    r = requests.get(f'{G}/{path}', params=p, timeout=60).json()
    if 'error' in r: raise RuntimeError(r['error'])
    return r


def post(path, **data):
    data['access_token'] = T
    r = requests.post(f'{G}/{path}', data=data, timeout=120).json()
    if 'error' in r: raise RuntimeError(r['error'])
    return r


def phash(u):
    return imagehash.phash(Image.open(io.BytesIO(requests.get(u, timeout=30).content)).convert('RGB'))


def ja_no_brap(src):
    h = phash(src.get('thumbnail_url') or src.get('media_url'))
    cap = (src.get('caption') or '')[:80]
    url, p = f'{G}/{BRAP}/media', {'fields': 'id,caption,thumbnail_url,media_url', 'limit': 50, 'access_token': T}
    while url:
        r = requests.get(url, params=p, timeout=60).json(); p = None
        for m in r.get('data', []):
            if cap and len(cap) > 60 and (m.get('caption') or '')[:80] == cap: return m['id']
            u = m.get('thumbnail_url') or m.get('media_url')
            if u:
                try:
                    if h - phash(u) <= 10: return m['id']
                except Exception: pass
        url = r.get('paging', {}).get('next')
    return None


def run(cmd, **k):
    return subprocess.run(cmd, check=True, **k)


def baixar(src, nome):
    dest = f'{WORK}/{nome}.mp4'
    if src.get('media_url'):
        with requests.get(src['media_url'], stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(dest, 'wb') as f:
                for c in r.iter_content(1 << 20): f.write(c)
        if os.path.getsize(dest) < 95e6: return dest
    else:  # audio licenciado: a API nao entrega media_url
        run(['yt-dlp', '-q', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', dest, src['permalink']])
    out = f'{WORK}/{nome}_ok.mp4'
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', dest, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '4500k',
         '-maxrate', '5000k', '-bufsize', '9000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
         '-movflags', '+faststart', out])
    return out


def hospedar(arquivos):
    """Sobe os videos num branch temporario e devolve URLs fixas (pelo commit)."""
    d = f'{WORK}/git'; os.makedirs(d, exist_ok=True)
    gitc = ['git', '-C', d, '-c', 'user.name=robo-repost', '-c', 'user.email=robo@users.noreply.github.com']
    run(['git', 'init', '-q', d]); run(gitc + ['checkout', '-q', '--orphan', 'tmp-video'])
    nomes = []
    for a in arquivos:
        n = os.path.basename(a); os.replace(a, f'{d}/{n}'); nomes.append(n)
    run(gitc + ['add', '.']); run(gitc + ['commit', '-qm', 'video temporario'])
    run(gitc + ['push', '-q', '-f', PUSH, 'tmp-video'])
    sha = subprocess.run(['git', '-C', d, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    time.sleep(5)
    return [f'https://raw.githubusercontent.com/{REPO}/{sha}/{n}' for n in nomes]


def apagar_branch():
    subprocess.run(['git', 'push', '-q', PUSH, '--delete', 'tmp-video'],
                   capture_output=True)


def esperar(cid):
    for _ in range(90):
        st = g(cid, fields='status_code,status')
        if st['status_code'] == 'FINISHED': return
        if st['status_code'] in ('ERROR', 'EXPIRED'): raise RuntimeError(st)
        time.sleep(10)
    raise RuntimeError('container nao terminou de processar')


def publicar(item):
    sid, legenda = item['_id'], item['legenda_pronta']
    src = g(sid, fields='id,caption,media_type,media_url,thumbnail_url,permalink,is_shared_to_feed,'
                        'children{media_type,media_url,thumbnail_url}')
    if src.get('is_shared_to_feed') is False:
        marcar(sid, status='pular', obs='Reel de teste (nao esta no feed)'); print('PULADO', sid); return False
    dup = ja_no_brap(src)
    if dup:
        marcar(sid, status='ja_existia', brap_id=dup); print('JA_EXISTIA', sid, dup); return False
    try:
        if src['media_type'] == 'CAROUSEL_ALBUM':
            kids = src['children']['data']
            vids = {i: baixar(c, f'{sid}_{i}') for i, c in enumerate(kids) if c['media_type'] == 'VIDEO'}
        elif src['media_type'] == 'VIDEO':
            vids = {0: baixar(src, sid)}
        else:
            vids = {}
    except subprocess.CalledProcessError as e:
        marcar(sid, status='sem_video', obs=f'download falhou: {e}'[:400]); print('SEM_VIDEO', sid); return False
    urls = dict(zip(vids, hospedar(list(vids.values())))) if vids else {}
    try:
        if src['media_type'] == 'CAROUSEL_ALBUM':
            ids = []
            for i, c in enumerate(kids):
                if i in urls:
                    r = post(f'{BRAP}/media', media_type='VIDEO', video_url=urls[i], is_carousel_item='true')
                    esperar(r['id'])
                else:
                    r = post(f'{BRAP}/media', image_url=c['media_url'], is_carousel_item='true')
                ids.append(r['id'])
            cid = post(f'{BRAP}/media', media_type='CAROUSEL', children=','.join(ids), caption=legenda)['id']
        elif src['media_type'] == 'VIDEO':
            cid = post(f'{BRAP}/media', media_type='REELS', video_url=urls[0], caption=legenda, share_to_feed='true')['id']
        else:
            cid = post(f'{BRAP}/media', image_url=src['media_url'], caption=legenda)['id']
        esperar(cid)
        mid = post(f'{BRAP}/media_publish', creation_id=cid)['id']
    finally:
        if urls: apagar_branch()
    info = g(mid, fields='permalink')
    marcar(sid, status='publicado', brap_id=mid, brap_permalink=info.get('permalink', ''), legenda_nova=legenda,
           publicado_em=datetime.datetime.now(datetime.timezone.utc).isoformat(), obs='robo GitHub Actions')
    print('PUBLICADO', sid, '->', info.get('permalink'))
    return True


if __name__ == '__main__':
    itens = fila()
    print('pendentes com legenda:', len(itens))
    for item in itens[:5]:  # pula itens sem video/duplicados ate publicar 1
        try:
            if publicar(item): break
        except Exception as e:
            marcar(item['_id'], status='erro', obs=str(e)[:500]); print('ERRO', item['_id'], e)
            raise SystemExit(1)  # falha -> GitHub avisa o Magno por e-mail
