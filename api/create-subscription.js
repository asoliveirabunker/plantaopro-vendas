import { resolveAmount } from './_plans.js';

/**
 * Cria uma assinatura recorrente (preapproval) no Mercado Pago e devolve a URL
 * de checkout. Roda no SERVIDOR — é o único lugar onde o Access Token existe.
 *
 * Env obrigatória (configurar no painel da Vercel, nunca no repositório):
 *   MP_ACCESS_TOKEN — Access Token da aplicação no Mercado Pago
 *
 * O valor cobrado vem SEMPRE de api/_plans.js, nunca do corpo da requisição,
 * para que ninguém consiga forjar um preço pelo navegador.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[create-subscription] MP_ACCESS_TOKEN ausente no ambiente.');
    return res.status(500).json({ error: 'Pagamento não configurado. Tente novamente mais tarde.' });
  }

  const { plan, billing, email, uid } = req.body || {};

  const resolved = resolveAmount(plan, billing);
  if (!resolved) return res.status(400).json({ error: 'Plano inválido.' });

  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'E-mail da conta é obrigatório para assinar.' });
  }

  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

  // external_reference carrega os dados que o webhook precisa para ativar o
  // plano na conta certa: "<uid do Supabase>:<plano>:<periodicidade>".
  const externalReference = [uid || '', resolved.plan.id, resolved.annual ? 'yearly' : 'monthly'].join(':');

  const payload = {
    reason: `Plantão Pro — Plano ${resolved.plan.name}`,
    external_reference: externalReference,
    payer_email: cleanEmail,
    back_url: `${origin}/?assinatura=sucesso`,
    status: 'pending',
    auto_recurring: {
      frequency: resolved.frequency,
      frequency_type: 'months',
      transaction_amount: resolved.amount,
      currency_id: 'BRL',
    },
  };

  try {
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await mpRes.json().catch(() => ({}));

    if (!mpRes.ok) {
      // Loga o detalhe no servidor, devolve mensagem genérica ao cliente.
      console.error('[create-subscription] Mercado Pago recusou:', mpRes.status, data);
      return res.status(502).json({
        error: data?.message || 'Não foi possível iniciar a assinatura. Verifique os dados e tente novamente.',
      });
    }

    const checkoutUrl = data.init_point || data.sandbox_init_point;
    if (!checkoutUrl) {
      console.error('[create-subscription] Resposta sem init_point:', data);
      return res.status(502).json({ error: 'Checkout indisponível no momento.' });
    }

    return res.status(200).json({ checkoutUrl, subscriptionId: data.id });
  } catch (err) {
    console.error('[create-subscription] Erro inesperado:', err);
    return res.status(500).json({ error: 'Erro ao falar com o Mercado Pago.' });
  }
}
