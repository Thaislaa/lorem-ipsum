# ☠ Lorem Ipsum (TCC HTML e CSS)

_Chegou o momento de misturar tudo que a gente viu até agora em um exercício, o nosso TCC._

## Layout está [aqui neste Figma](https://www.figma.com/design/LjYOSHX40NoyTyqQJsUUqA/Crescer-TCC?node-id=1812-324&t=gqU59eqLOjTtIKZ9-1)

## Regras

- Individual
- Responsivo
- Mais fiel ao layout possível
- Organizado estruturalmente (arquivos, pastas, etc)
- As páginas devem estar linkadas entre elas
- Não deve haver duplicação de código. Ex.: Criar o css do botão duas vezes quando você pode criar uma classe e reaproveitar

## Dicas

- Usem `min-height: 100vh` e `margin: 0` no body
- Nas sections podem usar `min-height: {valor}vh` e a largura deve ser em `%` **NÃO** pode ser em `vw`
- Exportem as fotos em jpg, se tiver fundo transparente usem png
- Ícones e logo, exportem em .svg
- Usem transition nos cards das pessoas
- Voltem as aulas, vários componentes do TCC já foram explicados em aula
- Importante, se você usar `!important` eu vou ter certeza que você não prestou atenção na aula de especificidade
- ⚠ Façam commits e pushes regularmente ⚠

## Fontes

Importem a fonte:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Open+Sans&display=swap"
  rel="stylesheet"
/>
```

Usem cada uma conforme a necessidade.

```css
font-family: "Montserrat", sans-serif;
font-family: "Open Sans", sans-serif;
```

🚧 Não apague o conteúdo da pasta `prints`.

🚧 Para cada página você deve salvar o arquivo html como index.html, dentro de seu respectivo diretório. Exemplo:

Home: `pages/index.html`

Sobre: `pages/sobre.html`

Contato: `pages/contato.html`

## Estrutura de diretórios ideal

```
│   README.md
│   required_pages.txt
│   package.json
│   package-lock.json
│
├───pages
│   │   index.html
│   │   contato.html
│   │   sobre.html
│   │
│   └───css
│           base.css
│           home.css
│           contato.css
│           sobre.css
│
├───img
│       (imagens exportadas do Figma)
│
├───prints
│       index.png
│       contato.png
│       sobre.png
│
├───scripts
│       visual-test.mjs
│
└───.gitea
    └───workflows
            ci.yaml
```

---

## Observações (template / CI)

Repositório de template para projetos em HTML e CSS com validação visual automática na CI.

- **Não modifique** os arquivos listados abaixo. Eles fazem parte da validação automática da entrega (CI):
  - `required_pages.txt`
  - `prints/`
  - `scripts/visual-test.mjs`
  - `package.json` / `package-lock.json`
  - `.gitea/workflows/ci.yaml`

- O aluno deve criar as páginas HTML/CSS correspondentes às rotas listadas em `required_pages.txt`.

## Páginas obrigatórias

As rotas esperadas ficam em `required_pages.txt` (uma por linha). A pipeline compara cada página com a print de referência em `prints/`.

| Rota em `required_pages.txt` | Arquivo HTML (primeiro encontrado)                   | Print de referência  |
| ---------------------------- | ---------------------------------------------------- | -------------------- |
| `/`                          | `index.html`, `src/index.html` ou `pages/index.html` | `prints/index.png`   |
| `/contato`                   | `contato/index.html` (ou sob `src/` / `pages/`)      | `prints/contato.png` |
| `/sobre`                     | `sobre/index.html` (ou sob `src/` / `pages/`)        | `prints/sobre.png`   |

A busca do HTML ocorre nesta ordem: **raiz do projeto → `src/` → `pages/`**.

Linhas vazias e comentários (`# ...`) são ignorados.

## Validação visual

A CI:

1. Serve o projeto HTML/CSS localmente
2. Abre cada rota no Chromium usando as dimensões da print de referência como viewport
3. Captura a página e compara com a print em `prints/`
4. Aprova se o score de similaridade for **≥ 75%**

Como o viewport da captura vem da print, as duas imagens têm sempre o mesmo tamanho. Ainda assim, a
comparação tolera diferenças de tamanho de até **40%** em cada dimensão: nesse caso a área comum é
comparada e a diferença entra como penalidade proporcional no score.

Similaridade = `1 - (pixels diferentes / pixels comparados)`, com tolerância a pequenas diferenças de
antialiasing e de cor.

Em caso de falha, o artefato `visual-results/` contém as capturas `*.actual.png` e os diffs `*.diff.png`.

### Execução local (diagnóstico)

```bash
npm ci
npx playwright install chromium
npm run test:visual
```
