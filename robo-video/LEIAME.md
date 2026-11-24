# Robô de vídeo bruto (Drive → Claude)

O conector do Drive só baixa até 10 MB. Este robô busca o vídeo bruto da pasta `SHIN GI TAI/PARA EDITAR` e entrega ao Claude.

**Como o Claude usa (em qualquer conversa, com o computador desligado):**
1. Gerar um par de chaves RSA na sessão: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out priv.pem && openssl pkey -in priv.pem -pubout -out pub.pem`
2. Acionar: `gh api -X POST repos/magnoribeiro-fisic/shingitai/actions/workflows/baixar-video.yml/dispatches -f ref=main -f inputs[video]=<ID ou nome> -f inputs[chave_publica]="$(cat pub.pem)"`
3. Quando o run terminar: `git clone --depth 1 -b video-<run_id> https://github.com/magnoribeiro-fisic/shingitai dl`
4. `cat dl/video.enc.part* > video.enc`; descriptografar `chave.enc` com `openssl pkeyutl -decrypt -inkey priv.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256` e depois `openssl enc -d -aes-256-cbc -pbkdf2 -in video.enc -out video.mov -pass file:<chave>`

Login no Google sem chave (Workload Identity Federation, conta `robo-repost`, só leitura da pasta PARA EDITAR). O repositório é público, por isso só sai arquivo criptografado. Os branches `video-*` podem ser apagados no GitHub (Branches) a qualquer momento.
