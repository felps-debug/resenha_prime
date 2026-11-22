# Loja: primeiro item em modo de teste

Objetivo: permitir que um membro compre um telão de sala por R$ 0,50, usando apenas Stripe de teste, e mostrar o efeito por 24 horas após a confirmação do pagamento.

- Banco: catálogo com preço em centavos, compras e uma função transacional que confirma cada sessão uma única vez. Leituras limitadas aos membros e escrita apenas pelo servidor.
- Servidor: verificar a sessão Supabase e a participação na sala; criar Checkout com preço do banco; verificar assinatura do webhook e confirmar somente pagamentos efetivamente pagos, com sessão, moeda e valor correspondentes.
- Interface: mostrar o telão ativo, abrir a compra e informar se o pagamento foi iniciado ou cancelado. O webhook continua sendo a fonte de verdade.
- Testes: validação de entrada, autenticação, preço, Pix pendente, assinatura, idempotência, autorização e expiração; confirmação integral na Stripe após configuração das chaves de teste.
- Implantação: nenhuma chave de produção, commit ou push nesta etapa. Manter a loja indisponível quando faltar configuração.
