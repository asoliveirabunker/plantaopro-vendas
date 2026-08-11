/**
 * Catálogo de planos — FONTE ÚNICA DE VERDADE dos valores cobrados.
 *
 * Os preços exibidos em index.html (data-monthly / data-yearly) devem espelhar
 * estes valores. O que é efetivamente cobrado no Mercado Pago vem DAQUI, nunca
 * do que o navegador enviar — assim ninguém consegue alterar o preço no client.
 *
 * Anual = 10x o mensal ("2 meses grátis"), arredondado ao padrão ,90 da página.
 */
export const PLANS = {
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 14.9,
    yearly: 149.9,
  },
  max: {
    id: 'max',
    name: 'Max',
    monthly: 29.9,
    yearly: 299.9,
  },
};

/** Valor cobrado para um plano + periodicidade. Retorna null se inválido. */
export function resolveAmount(planId, billing) {
  const plan = PLANS[planId];
  if (!plan) return null;
  const annual = billing === 'yearly';
  return {
    plan,
    annual,
    amount: annual ? plan.yearly : plan.monthly,
    frequency: annual ? 12 : 1,
  };
}
