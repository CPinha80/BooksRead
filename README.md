# BooksRead — Livros Lidos

Aplicação para gestão de livros e leitura, feita para usar no iPhone como app de ecrã principal (PWA). Não precisa de App Store nem de servidor: os dados ficam no teu telemóvel.

## O que faz

- **Inventário de livros** — título, autor, género, páginas, capa, estado (*Por ler*, *A ler*, *Lido*, *Abandonado*), classificação de 1 a 5 estrelas e notas.
- **Pesquisa online** — ao adicionar um livro, procura por título, autor ou ISBN (Open Library) e preenche os dados automaticamente.
- **Datas de leitura** — data de início e de fim, com botões rápidos «Começar» e «Terminei ✓». Nos livros que estás a ler podes indicar a página atual.
- **Métricas**
  - meta anual com progresso, «à frente/atrás do ritmo» e projeção para o fim do ano
  - livros e páginas lidas, média de dias por livro, páginas por dia, classificação média, taxa de conclusão
  - estimativa de quando terminas os livros que estás a ler
  - livros terminados por mês (últimos 12 meses) e por ano
  - géneros e autores mais lidos
  - hábitos: dias do ano com um livro em mãos, tamanho médio dos livros, máximo de livros em simultâneo
  - recordes: leitura mais rápida e mais longa, maior ritmo, livro mais extenso, melhor classificado
- **Modo IA** (Claude) — usa os livros lidos, as datas, as classificações e as tuas notas:
  - 🧠 **Mapa de conhecimento**: o que deverias saber por teres lido esses livros, por área e nível
  - 🧭 **Lacunas e próximas leituras**: o que te falta e o que ler a seguir
  - ❓ **Testa-te**: quiz sobre as ideias dos teus livros
  - 🪞 **Perfil de leitor**: temas, evolução e padrões
  - perguntas livres; as análises ficam guardadas
- **Cópia de segurança** — exporta e importa em JSON e exporta em CSV (abre no Excel/Numbers).
- Funciona **offline** e tem **modo escuro** automático.

## Instalar no iPhone

1. Publica a app (ver abaixo) e abre o endereço no **Safari**.
2. Toca em **Partilhar** → **Adicionar ao ecrã principal**.
3. Abre a app a partir do ícone «Livros». Passa a funcionar como uma app normal, em ecrã inteiro e offline.

### Publicar com GitHub Pages

O workflow `.github/workflows/pages.yml` publica a app sempre que há um push para `main`.

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Faz merge deste branch para `main`.
3. A app fica em `https://<utilizador>.github.io/BooksRead/`.

> Nos planos gratuitos, o GitHub Pages só funciona em repositórios públicos. Os teus livros **não** vão para o repositório (ficam no iPhone), por isso torná-lo público não expõe dados pessoais. Em alternativa, usa outro alojamento estático (Netlify, Cloudflare Pages).

## Ativar a IA

1. Cria uma chave em [console.anthropic.com](https://console.anthropic.com/settings/keys). A API é paga à parte da subscrição Claude.ai.
2. Na app: **Definições → Chave da API Anthropic** → cola → **Guardar**.
3. Escolhe o modelo: **Claude Opus 5.5** (mais profundo; é o padrão) ou **Claude Sonnet 5.5** (mais rápido e barato).

A chave fica guardada só no teu iPhone (armazenamento local) e é enviada apenas para `api.anthropic.com`. Não entra nas cópias de segurança.

**Sem chave?** Ao tocares numa opção do modo IA, a app copia o prompt completo (com a tua biblioteca) para colares na app Claude.

## Os teus dados

Tudo é guardado no armazenamento local do Safari, neste dispositivo. O iOS pode apagar esses dados se limpares os dados do Safari ou se a app ficar muito tempo sem ser usada, por isso **exporta a cópia de segurança de vez em quando** (Definições → Exportar JSON) e guarda-a no iCloud Drive.

## Desenvolvimento

É HTML, CSS e JavaScript simples, sem passo de build:

```
python3 -m http.server 8000   # abre http://localhost:8000
```

| Ficheiro | Função |
|---|---|
| `index.html`, `styles.css` | Interface |
| `js/app.js` | Navegação, lista, formulário, IA e definições |
| `js/store.js` | Persistência local, importar e exportar |
| `js/stats.js` | Cálculo e gráficos das métricas |
| `js/ai.js` | Prompts e chamadas à API Claude |
| `vendor/anthropic-sdk.mjs` | SDK oficial `@anthropic-ai/sdk` (0.129.0) num único ficheiro para o browser |
| `sw.js` | Service worker (modo offline). Aumenta `VERSION` sempre que alterares ficheiros |

### Atualizar o SDK

```
npm i @anthropic-ai/sdk esbuild
echo 'export { default } from "@anthropic-ai/sdk";' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --outfile=vendor/anthropic-sdk.mjs
```
