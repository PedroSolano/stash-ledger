# Stash Ledger

Avaliador de stash do Path of Exile 1 no estilo do Exilence Next: mostra quanto valem as suas abas com **todos os preços do poe.ninja**, guarda um histórico do patrimônio e calcula o ganho por hora. Não tem backend: o app roda na máquina do jogador, faz login direto na GGG (OAuth oficial) e busca os preços direto do poe.ninja.

> Este produto não é afiliado nem endossado pela Grinding Gear Games.

## Instalando (jogadores)

Baixe o `StashLedger-Setup-x.y.z.exe` da página de [Releases](https://github.com/PedroSolano/stash-ledger/releases/latest) e execute. A instalação é por usuário e não pede administrador.

O instalador ainda não é assinado digitalmente, então o Windows SmartScreen pode mostrar "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**. Isso só acontece na primeira instalação: daí em diante o app **se atualiza sozinho**. Ao abrir, ele procura versão nova no GitHub, baixa em segundo plano e reinicia para instalar (dá para adiar; nesse caso a versão nova entra quando você fechar o app).

## Lançando uma atualização (mantenedor)

```bash
npm version patch
git push --follow-tags
```

`npm version patch` sobe a versão (0.1.0 → 0.1.1), faz o commit e cria a tag `v0.1.1`. Para mudanças maiores, use `minor` ou `major`. Ao receber a tag, o GitHub Actions (`.github/workflows/release.yml`) roda os testes, compila o instalador e publica o release com o `latest.yml`. Em alguns minutos todos os apps instalados encontram a versão nova.

Para acompanhar o build: aba **Actions** do repositório, ou `gh run watch`.

## Rodando o código

Requisitos: Node.js 22+ (testado com 26).

```bash
npm install
npm run dev
```

Há três formas de entrar:

| Forma | Quando usar |
|---|---|
| **OAuth oficial** | O caminho recomendado. Exige um `client_id` de app registrado na GGG (veja abaixo) |
| **POESESSID** | Funciona hoje, sem registro. Usa o endpoint antigo do site, o mesmo do Exilence original |
| **Modo demonstração** | Stash de exemplo, no formato da API da GGG, com os preços reais da liga atual |

| Script | O que faz |
|---|---|
| `npm run dev` | App em modo desenvolvimento (com hot reload) |
| `npm run build` / `npm start` | Build de produção e execução do build |
| `npm test` | Testes do motor de preços, do OAuth (fluxo simulado), do rate limiter e das validações |
| `npm run price-check -- [liga]` | Baixa as 50 categorias do poe.ninja e precifica a stash de demonstração no terminal |
| `npm run typecheck` | Checagem de tipos (main/preload e renderer) |
| `npm run dist` | Gera o instalador Windows localmente em `dist/` (sem publicar) |

## Login com a GGG

O login usa o **OAuth 2.1 oficial** da GGG como **cliente público**: Authorization Code + PKCE (S256), com retorno para um servidor local temporário (`http://127.0.0.1:PORTA/callback`). O usuário digita a senha apenas no site da GGG, no navegador do sistema. O app nunca a vê, e não existe `client_secret` para vazar.

O que você precisa:

1. **Um app registrado na GGG** (https://www.pathofexile.com/developer/docs), do tipo *public client*, com os escopos `account:profile account:leagues account:stashes` e a Redirect URI local, por exemplo `http://127.0.0.1:8080/callback`.
   **Atenção:** em novembro de 2026 a página da GGG diz *"We are currently unable to process new applications"*. Até a GGG reabrir os registros, o login real não funciona. O resto do app (preços, histórico e modo demonstração) funciona.
2. Preencher **Client ID**, **Redirect URI** e **Contato** em *Configurações* (ou no `.env`, veja `.env.example`). A GGG exige que o User-Agent traga um contato: `OAuth {clientId}/{versão} (contact: {contato})`.

Regras da GGG para clientes públicos que o app já segue:
- O token de acesso dura 10 h e o refresh token dura 7 dias, sem renovação do prazo. Depois disso é preciso entrar de novo.
- Os limites de requisição são compartilhados entre todos os clientes públicos. Por isso o app lê os cabeçalhos `X-Rate-Limit-*` e espera antes de estourar qualquer regra.
- Requisições com erro 4xx contam para um limite de "requisições inválidas", então o app só tenta de novo em 401 (renova o token) e 429 (depois do `Retry-After`).

## Modo sessão (POESESSID)

Enquanto não houver um `client_id`, o app pode ler a stash pelo endpoint antigo do site (`/character-window/get-stash-items`), autenticado com o cookie `POESESSID`. Essa é a mesma técnica do Exilence original, do Acquisition e do Procurement.

Como pegar o cookie: abra pathofexile.com logado, pressione F12, vá em **Aplicativo (Application) → Cookies → https://www.pathofexile.com** e copie o valor de `POESESSID` (32 caracteres hexadecimais). No app, informe também o nome da conta com o `#1234`.

O que você precisa saber:
- **O POESESSID dá acesso total à conta no site.** Nunca compartilhe. Para invalidar o cookie, basta sair da conta no site.
- **Não é API oficial.** A documentação atual da GGG diz que usar endpoints fora da API documentada vai contra os termos de uso (seção 7i). A GGG tolera ferramentas assim há anos, mas pode mudar ou bloquear o endpoint sem aviso.
- **Limites por IP:** 30 requisições/min, 90 a cada 30 min e 180 a cada 2 h (lidos dos cabeçalhos). Cada aba gasta uma requisição por snapshot, e cada snapshot gasta mais uma para reler a lista de abas.
- Abas de mapas e de únicos podem vir vazias por esse endpoint. O seletor de abas avisa.

Como o app protege o cookie:
- Ele é validado com uma requisição real **antes** de ser guardado.
- Fica guardado criptografado (`safeStorage`), só no processo principal, e nunca volta para a interface.
- É enviado apenas no cabeçalho `Cookie` para `www.pathofexile.com`, nunca na URL, e sem seguir redirecionamentos.
- O formato é validado (hex de 32 caracteres), o que também impede injeção de cabeçalho.
- Se a GGG recusar a sessão, o app apaga o cookie na hora, para não acumular erros 403 que contam contra o IP.

## Preços (poe.ninja)

O app consulta **todas** as categorias documentadas em https://poe.ninja/docs/api:

- **Câmbio** (19): Currency, Fragment, Runegraft, AllflameEmber, Tattoo, Omen, DjinnCoin, Ducat, EnshroudingCrystal, DivinationCard, Artifact, Oil, DeliriumOrb, Scarab, Astrolabe, Thread, Fossil, Resonator, Essence.
- **Itens de stash** (29): uniques (armas, armaduras, acessórios, frascos, joias, tinturas, relíquias, mapas), Forbidden Jewels, Shrine Belts, gemas, gemas imbuídas, cluster jewels, mapas (normais, blighted, blight-ravaged, Valdo), convites, memórias, templos, scrying orbs, bases, frascos, bestas, vials, wombgifts, cadáveres e vísceras.
- **Moedas por stash** (2, endpoint legado): reserva para moedas que não aparecem no câmbio.

Na liga Covens isso dá cerca de 21 mil preços. Como cada item é casado:

| Item | Regra |
|---|---|
| Moedas, fragmentos, cartas, óleos, essências etc. | Nome exato no câmbio |
| Únicos | Nome + base; 5L/6L quando o poe.ninja separa por links; Foulborn pelos modificadores mutados; variantes pelos mods (ex.: Mageblood 4 frascos). Não identificado: o único mais barato daquela base, marcado como aproximado |
| Gemas | Nível/qualidade/corrupção exatos. Sem variante exata, usa a melhor variante abaixo do item (≈) |
| Mapas | Base + blighted/blight-ravaged, geração de atlas mais recente |
| Cluster jewels | Encantamento + nº de passivas + faixa de ilvl (50/68/75/84) |
| Bases (opcional) | Itens normais/mágicos/raros ilvl 82+ não corrompidos, por ilvl e influência |
| Templos, scrying orbs | A sala/área mais valiosa que aparece nos mods |

- **≈ aproximado:** não havia variante exata. Nesse caso o app escolhe a opção mais conservadora para não inflar o patrimônio.
- **Baixa confiança:** menos de 5 amostras no poe.ninja. O item aparece na tabela, mas fica fora do total, a menos que você ligue essa opção nas configurações.

**Uso responsável da API:** a documentação do poe.ninja recomenda que apps desktop passem por um backend próprio com cache. Sem backend, o app faz o máximo possível do lado do cliente: cache em disco por liga e categoria, requisições condicionais (ETag/304), no máximo 3 requisições simultâneas, nenhuma atualização com menos de 15 min (5 min se forçada) e um User-Agent identificável. Se no futuro você quiser um proxy (um Cloudflare Worker resolve), basta trocar o "Servidor de preços" nas configurações.

## Segurança

- **Login:** PKCE S256 com 32 bytes de entropia; `state` aleatório comparado em tempo constante; servidor de retorno ouvindo só em `127.0.0.1`, que fecha logo após o retorno ou em 5 min; o login abre no navegador do sistema (RFC 8252), não numa webview.
- **Tokens:** criptografados com a API do sistema (`safeStorage`, que usa DPAPI no Windows e Keychain no macOS). Se não houver criptografia disponível, incluindo o `basic_text` do Linux, os tokens ficam só na memória.
- **Renderer isolado:** `contextIsolation`, `sandbox` e sem `nodeIntegration`. Toda a rede e os tokens ficam no processo principal; a interface só chama as funções expostas no preload.
- **CSP estrita** em produção. Imagens apenas de `web.poecdn.com` e `poe.ninja`. Nada de navegação interna ou janelas novas; links externos só para domínios permitidos.
- **IPC validado:** apenas a janela principal pode chamar; IDs de aba são validados (hex de 10 caracteres) antes de entrar numa URL; as configurações passam por sanitização (por exemplo, sem quebras de linha no User-Agent e só `https` no servidor de preços).
- O app roda em instância única, para não haver dois processos disputando a porta do login.

## Estrutura

```
src/
  main/                 processo principal (rede, tokens, arquivos)
    auth/oauth.ts         fluxo OAuth + PKCE + servidor local
    auth/authManager.ts   tokens criptografados, refresh
    auth/sessionAuth.ts   POESESSID criptografado (modo sessão)
    auth/secureFile.ts    arquivo criptografado via safeStorage
    poe/poeApi.ts         API da GGG (ligas, abas, itens, sub-abas)
    poe/legacyApi.ts      endpoint antigo do site (modo sessão)
    poe/rateLimiter.ts    limites dinâmicos via X-Rate-Limit-*
    ninja/ninjaClient.ts  poe.ninja com cache/ETag
    pricing/              categorias, índice de preços e casamento item → preço
    controller.ts         orquestra snapshots, demo e agendamento
    store.ts              configurações e histórico (JSON em %APPDATA%/stash-ledger)
  preload/index.ts      ponte mínima (window.api)
  renderer/             interface React
  shared/types.ts       tipos compartilhados (inclui o formato de item da GGG)
tests/                  vitest
scripts/price-check.ts  verificação ao vivo dos preços
```

## Limitações conhecidas e próximos passos

- Sem `client_id` aprovado, o login real e a leitura das abas pela API da GGG não puderam ser testados ao vivo. O fluxo OAuth foi testado com um servidor da GGG simulado.
- O modo POESESSID foi testado com respostas simuladas e contra o endpoint real **com um cookie falso** (recusa tratada corretamente). Falta testar com uma sessão de verdade, em especial pastas e abas especiais.
- O casamento de **vísceras**, **scrying orbs** e **gemas imbuídas** (mecânicas recentes) foi feito a partir do formato do poe.ninja, sem um item real da API para conferir. Pode precisar de ajuste quando houver dados reais.
- Ainda não implementado: inventário dos personagens (escopo `account:characters`), Path of Exile 2 e exportação CSV.
- O instalador não é assinado digitalmente (um certificado de assinatura de código custa caro). O SmartScreen avisa na primeira instalação, e o auto-update confere a integridade de cada download pelo SHA-512 publicado no release.
- Ainda não há ícone próprio: o app usa o ícone padrão do Electron.
