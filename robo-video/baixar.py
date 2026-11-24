#!/usr/bin/env python3
"""Robo de entrega de video bruto (SHIN GI TAI).
Baixa um video da pasta PARA EDITAR do Drive (login sem chave, Workload Identity Federation),
criptografa com a chave publica que o Claude gera na conversa (a privada nunca sai de la) e entrega
como artifact temporario do GitHub Actions. O repositorio e publico, por isso o video
NUNCA sai sem criptografia."""
import os, sys, subprocess, requests, google.auth
from google.auth.transport.requests import Request

PASTA = '1bSC7FhynwSAJh02phHqCRlMylqCg0f7T'  # SHIN GI TAI / PARA EDITAR
alvo = os.environ['VIDEO'].strip()
cr, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/drive.readonly'])
cr.refresh(Request())
H = {'Authorization': 'Bearer ' + cr.token}
D = 'https://www.googleapis.com/drive/v3/files'

def meta(fid):
    r = requests.get(f'{D}/{fid}', headers=H, params={'fields': 'id,name,parents,size', 'supportsAllDrives': 'true'}, timeout=60)
    return r.json() if r.ok else None

m = meta(alvo)
if not m:
    q = f"'{PASTA}' in parents and trashed=false and name contains '{alvo.replace(chr(39), chr(92)+chr(39))}'"
    fs = requests.get(D, headers=H, params={'q': q, 'fields': 'files(id,name,parents,size)', 'orderBy': 'modifiedTime desc'}, timeout=60).json().get('files', [])
    if not fs: sys.exit(f'video nao encontrado na pasta PARA EDITAR: {alvo}')
    m = fs[0]
if PASTA not in (m.get('parents') or []):
    sys.exit('so baixo videos da pasta PARA EDITAR')
print('baixando:', m['name'], m.get('size'), 'bytes')
os.makedirs('saida', exist_ok=True)
with requests.get(f"{D}/{m['id']}", headers=H, params={'alt': 'media'}, stream=True, timeout=600) as r:
    r.raise_for_status()
    with open('video.bin', 'wb') as f:
        for ch in r.iter_content(1 << 20): f.write(ch)
open('pub.pem', 'w').write(os.environ['CHAVE_PUBLICA'].replace('\\n', '\n'))
chave = os.urandom(32).hex()
open('chave.txt', 'w').write(chave)
subprocess.run(['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', 'video.bin', '-out', 'saida/video.enc', '-pass', 'file:chave.txt'], check=True)
subprocess.run(['openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', 'pub.pem',
                '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
                '-in', 'chave.txt', '-out', 'saida/chave.enc'], check=True)
open('saida/nome.txt', 'w').write(m['name'])
os.remove('video.bin'); os.remove('chave.txt')
print('ok')
