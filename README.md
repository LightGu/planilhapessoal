# Obra Clara

Aplicacao local para organizar clientes, obras, materiais e imagens. A pesquisa de precos consulta produtos reais nos catalogos da Obramax e Telhanorte e calcula a mediana dos resultados encontrados; nenhum preco ficticio e gerado.

## Executar

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
python server/app.py
```

Acesse `http://localhost:5000`.

## Recursos

- cadastro e busca de clientes;
- cadastro e exclusao de obras;
- materiais com consulta de preco e links para os anuncios;
- upload seguro de ate 8 imagens por obra;
- interface responsiva para desktop e celular;
- dados persistidos localmente em SQLite.

A busca requer acesso a internet, mas funciona sem credencial usando os catalogos publicos da Obramax e Telhanorte. Opcionalmente, use `SERPAPI_KEY` para Google Shopping ou `ML_ACCESS_TOKEN` para Mercado Livre como provedores adicionais. Se todos estiverem indisponiveis, a tela informa a falha e permite salvar o material sem estimativa.
