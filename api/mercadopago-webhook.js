import crypto from 'node:crypto';
import { PLANS } from './_plans.js';

/**
 * Webhook do Mercado Pago — ativa (ou rebaixa) o plano do usuário no Supabase
 * quando o status da assinatura muda.
 *
 * Env obrigatórias (painel da Vercel):
 *   MP_ACCESS_TOKEN            — para consultar a assinatura na API do MP
 *   SUPABASE_URL               — ex.: https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  — chave service_role (ignora RLS). NUNCA no cliente.
 * Env recomendada:
 *   MP_WEBHOOK_SECRET          — segredo da notificação, valida a assinatura x-signature
 *
 * Regra de ouro: NUNCA confiar no corpo da notificação. Ele só diz "olhe o id X";
 * o estado real é sempre relido da API do Mercado Pago.
 */

/** Valida o header x-signature conforme a documentação do Mercado Pago. */
function isSignatureValid(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return null; // não configurado → indeterminado

  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!signature || typeof signature !== 'string') return false;

  const parts = Object.fromEntries(
    signature.split(',').map(p => p.split('=').map(s => s.trim())).filter(p => p.length === 2)
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Atualiza o plano do usuário. A trigger do banco espelha em profiles. */
async function setUserPlan(userId, planId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');

  const res = await fetch(`${url}/rest/v1/user_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      plan_id: planId,
      status: 'active',
      payment_provider: 'mercadopago',
    }),
  });

  const rows = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Supabase recusou: ${res.status} ${JSON.stringify(rows)}`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Nenhuma assinatura encontrada para o usuário ${userId}.`);
  }
  return rows[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[webhook] MP_ACCESS_TOKEN ausente.');
    return res.status(500).end();
  }

  const body = req.body || {};
  const type = body.type || body.topic || req.query?.type || req.query?.topic;
  const dataId = body.data?.id || body.id || req.query?.['data.id'] || req.query?.id;

  if (!dataId) return res.status(200).json({ ignored: 'sem id' });

  // Só tratamos eventos de assinatura. Os demais são confirmados e ignorados.
  if (type !== 'subscription_preapproval' && type !== 'preapproval') {
    return res.status(200).json({ ignored: type || 'desconhecido' });
  }

  const valid = isSignatureValid(req, dataId);
  if (valid === false) {
    console.warn('[webhook] Assinatura x-signature inválida — requisição recusada.');
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }
  if (valid === null) {
    console.warn('[webhook] MP_WEBHOOK_SECRET não configurado — notificação aceita SEM validação.');
  }

  try {
    // Relê o estado real na API do Mercado Pago.
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sub = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) {
      console.error('[webhook] Falha ao consultar preapproval:', mpRes.status, sub);
      return res.status(200).json({ ignored: 'preapproval não encontrado' });
    }

    // external_reference = "<uid>:<plano>:<periodicidade>"
    const [uid, planFromRef] = String(sub.external_reference || '').split(':');
    if (!uid) {
      console.error('[webhook] external_reference sem uid:', sub.external_reference);
      return res.status(200).json({ ignored: 'sem uid' });
    }
    if (!PLANS[planFromRef]) {
      console.error('[webhook] plano desconhecido em external_reference:', planFromRef);
      return res.status(200).json({ ignored: 'plano inválido' });
    }

    // authorized = assinatura ativa. cancelled/paused = volta para o free.
    const status = sub.status;
    const targetPlan =
      status === 'authorized' ? planFromRef
      : (status === 'cancelled' || status === 'paused') ? 'free'
      : null;

    if (!targetPlan) {
      return res.status(200).json({ ignored: `status ${status}` });
    }

    await setUserPlan(uid, targetPlan);
    console.log(`[webhook] Usuário ${uid} → plano ${targetPlan} (status MP: ${status}).`);
    return res.status(200).json({ ok: true, user: uid, plan: targetPlan });
  } catch (err) {
    console.error('[webhook] Erro:', err);
    // 500 faz o Mercado Pago reenviar a notificação depois.
    return res.status(500).json({ error: 'Falha ao processar notificação.' });
  }
}
