/**
 * TEMPORÁRIO — diagnóstico de configuração.
 * Reporta apenas SE cada variável existe (true/false) e o tamanho, para
 * detectar espaços/typos. NUNCA expõe o valor. Apagar após a configuração.
 */
export default function handler(req, res) {
  const check = (name) => {
    const v = process.env[name];
    if (v === undefined) return { definida: false };
    return {
      definida: true,
      tamanho: v.length,
      // prefixo ajuda a confirmar se é token de teste (TEST-) ou produção (APP_USR-)
      prefixo: v.slice(0, 5),
      temEspacoSobrando: v !== v.trim(),
    };
  };

  // Nomes parecidos, para pegar erro de digitação no painel.
  const variantes = Object.keys(process.env).filter((k) =>
    /MP|MERCADO|SUPABASE/i.test(k)
  );

  res.status(200).json({
    deployedAt: new Date().toISOString(),
    esperadas: {
      MP_ACCESS_TOKEN: check('MP_ACCESS_TOKEN'),
      MP_WEBHOOK_SECRET: check('MP_WEBHOOK_SECRET'),
      SUPABASE_URL: check('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: check('SUPABASE_SERVICE_ROLE_KEY'),
    },
    nomesEncontradosNoAmbiente: variantes,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
