# Marcelo Augusto — Landing de captação

Landing page de tráfego pago em **lp.marceloaugustosites.com.br**, para captar empresários interessados em criar um site.
A home (`marceloaugustosites.com.br`) é o `index.html` da raiz do repositório e não depende desta pasta.

Funil: **anúncio → landing → aplicação (8 perguntas) → agendamento da conversa de 15 min**

O lead é salvo **antes** da agenda. Quem preenche e não agenda continua na lista para follow-up.

A página está com `noindex`: serve para anúncio e não aparece no Google, para não competir com a home.

## Estrutura (tudo dentro de `lp/`)

```
index.html             página (HTML, CSS e JS puros, sem build)
api/lead.js            função da Vercel: recebe o lead e repassa para o webhook
api/booking.js         função da Vercel: busca dia/horário da reunião no Calendly (opcional)
integracoes/           script do Google Sheets (não vai para o deploy)
media/                 posters WebP e vídeos leves do portfólio
og.jpg, favicon.png    compartilhamento e ícone
```

## Publicar no subdomínio

A LP é um projeto separado na Vercel, ligado ao mesmo repositório:

1. Vercel → **Add New → Project** → importe o repositório `MEUSITE` de novo.
2. Em **Root Directory**, escolha `lp`. Framework: **Other**. Não precisa de build.
3. Depois do deploy: **Settings → Domains** → adicione `lp.marceloaugustosites.com.br`.
   Se o DNS do domínio não estiver na Vercel, crie um registro **CNAME** `lp` → `cname.vercel-dns.com` onde o domínio está registrado.
4. Configure as variáveis de ambiente abaixo **neste projeto** (não no da home).

Para usar outro subdomínio, troque `lp.marceloaugustosites.com.br` no `<head>` do `index.html` (canonical e og).

## Configuração

### 1. Na página (`index.html`, bloco `window.CONFIG` no `<head>`)

| Campo         | O que colocar                                                |
|---------------|--------------------------------------------------------------|
| `calendlyUrl` | Link do evento de 15 min. Vazio = agendamento pelo WhatsApp. |
| `metaPixelId` | ID do Pixel da Meta                                          |
| `gtmId`       | ID do Google Tag Manager (se usar, deixe `ga4Id` vazio)      |
| `ga4Id`       | ID do GA4, se não usar GTM                                   |
| `whatsapp`    | 55 + DDD + número                                            |

As faixas de investimento ficam em `BUDGET_OPTIONS`, no script do fim da página.

### 2. Na Vercel (Settings → Environment Variables)

| Variável              | Para quê                                                            |
|-----------------------|---------------------------------------------------------------------|
| `LEAD_WEBHOOK_URL`    | Para onde vai cada lead (ex.: Web App do Google Sheets, Make, n8n)  |
| `LEAD_WEBHOOK_SECRET` | Senha que o webhook confere (a mesma do `SECRET` do script)         |
| `CALENDLY_TOKEN`      | Opcional. Mostra dia/horário na tela de confirmação.                |

Sem `LEAD_WEBHOOK_URL`, os leads ficam só nos logs da função `api/lead` na Vercel.

### 3. Planilha de leads

Siga as instruções no topo de `integracoes/google-sheets.gs`. Cada aplicação vira uma linha. Quando a pessoa agenda, a coluna `agendado` é marcada na mesma linha.

### 4. Calendly

- Crie um evento de 15 minutos com chamada online (Google Meet ou Zoom).
- Adicione uma pergunta de texto ao convidado. Ela chega preenchida com "Empresa · WhatsApp".
- As UTMs do anúncio são repassadas para o Calendly automaticamente.

## Eventos de tracking

Todos vão para o `dataLayer`. Também vão para o Meta Pixel e o GA4 quando estiverem configurados.

| Evento             | Quando                                  | Meta                        | GA4              |
|--------------------|-----------------------------------------|-----------------------------|------------------|
| `PageView`         | carregou a página                       | PageView (do próprio pixel) | page_view        |
| `CTA_Click`        | clicou num botão que leva ao formulário | custom                      | cta_click        |
| `Form_Start`       | começou a responder                     | custom                      | form_start       |
| `Form_Step`        | avançou uma pergunta (`step`)           | custom                      | form_step        |
| `Form_Complete`    | lead salvo na planilha (1x por envio)   | **Lead**                    | generate_lead    |
| `Calendar_View`    | a agenda do Calendly apareceu           | custom                      | calendar_view    |
| `Booking_Click`    | escolheu horário ou abriu o WhatsApp (1x) | custom                      | booking_click    |
| `Booking_Complete` | Calendly confirmou a reunião (1x)       | **Schedule**                | booking_complete |
| `WhatsApp_Click`   | clicou num link de WhatsApp             | custom                      | whatsapp_click   |

UTMs, `fbclid` e `gclid` ficam guardados por 30 dias e são enviados junto com o lead e com o agendamento.

Notas do Meta Pixel:

- O Lead só sai quando a API confirma que o lead chegou na planilha (`LEAD_WEBHOOK_URL`). Sem planilha configurada, não há Lead.
- `fbq.disablePushState = true` impede a Meta de mandar outro PageView quando a URL muda para `#aplicacao`.
- `SubscribedButtonClick` vem dos eventos automáticos da Meta, não do código. Para desligar: Gerenciador de Eventos → Configurações → Configuração automática de eventos.
- Em `localhost` os eventos aparecem no console com o prefixo `[track]`. No domínio real, nada é registrado.

---

Desenvolvido por **Marcelo Augusto** · [marceloaugustocapassocosta@gmail.com](mailto:marceloaugustocapassocosta@gmail.com)
