# Adaptação responsiva — 8 de outubro de 2026

A página de clientes e todas as seções do painel usam regras compartilhadas em `src/responsive.css`, preservando a identidade visual e as reservas fixas de 60 minutos.

| Área | Adaptação |
| --- | --- |
| Página inicial e navegação pública | Cabeçalho reorganizado no celular, tipografia fluida, nomes e textos longos com quebra e limites de largura. |
| Reserva | Resumo abaixo do formulário até 900 px; serviços com colunas flexíveis; dias com rolagem própria e setas acessíveis; horários distribuídos conforme o espaço. |
| Histórico | Ações que se reorganizam, cartões em coluna no celular e controles de recuperação sem largura mínima fixa. |
| Menu administrativo | Menu permanente em telas amplas e gaveta até 1024 px. Fundo de proteção, fechamento por toque/Escape, foco contido no menu e bloqueio de interação com o conteúdo atrás dele. |
| Visão geral e cadastros | Indicadores e cartões passam para duas ou uma coluna; nomes, valores e descrições podem quebrar. Gráfico mantém rolagem local quando precisa de espaço. |
| Agenda | Barras e filtros se reorganizam; dias/profissionais mantêm uma largura legível com rolagem dentro da agenda e orientação textual. Cabeçalhos/escala permanecem fixos no calendário. |
| Despesas e notificações | Tabelas viram cartões com rótulos em até 600 px; mensagens longas não exigem rolagem da página. |
| Configurações | Editores e prévias em coluna em tablets/celulares; controles de imagem, cores e segurança com limites de largura. |
| Horários de profissionais | Campos identificados por rótulos, reorganizados em cartões por dia em telas pequenas. |
| Login e modais | Layout flexível; apenas o conteúdo do modal rola, mantendo botões acessíveis; altura acompanha a janela e orientação horizontal. |
| Toque e áreas seguras | Campos com fonte de 16 px em telas pequenas ou com ponteiro de toque; principais controles com pelo menos 44 px de altura; margens para recortes e bordas dos aparelhos. |

## Verificação

- Os **65 testes existentes** passaram após a alteração de navegação/markup e inclusão das regras responsivas.
- A compilação de produção foi concluída. A Vercel executa os testes novamente antes de cada publicação.
- A análise do código incluiu todas as páginas públicas, as sete seções do painel, os formulários e os modais.
- Foi compilada uma prévia isolada, com dados fictícios e sem conexão com banco ou mensagens, para conferir larguras de 320 a 1920 px e orientação horizontal.
- A inspeção visual dessa prévia permanece pendente: ela exige autenticação na Vercel. O acesso seguro pelo GitHub foi interrompido; não foi concedido acesso público à prévia.
- A existência de regras responsivas não equivale a uma certificação em todos os aparelhos ou navegadores. Não foram alegados testes físicos em iPhone/Android ou confirmação visual das dez dimensões planejadas.

Não houve mudança no banco, nas permissões de acesso aos dados ou nas regras de agendamento nesta atualização.
