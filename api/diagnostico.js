/**
 * TEMPORÁRIO — diagnóstico de configuração.
 * Reporta apenas SE cada variável existe (true/false) e o tamanho, para
 * detectar espaços/typos. NUNCA expõe o valor. Apagar após a configuração.
 */
export default async function handler(req, res) {
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

  // Teste SOMENTE-LEITURA da conexão com o Supabase: confirma que a chave
  // secreta consegue ler user_subscriptions (ou seja, ignora RLS). Nenhuma
  // escrita é feita aqui.
  let supabase = { testado: false };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/user_subscriptions?select=user_id,plan_id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const body = await r.json().catch(() => null);
      supabase = {
        testado: true,
        httpStatus: r.status,
        leituraOk: r.ok,
        linhasVisiveis: Array.isArray(body) ? body.length : null,
        erro: r.ok ? null : (body?.message || body?.error || 'desconhecido'),
      };
    } catch (e) {
      supabase = { testado: true, leituraOk: false, erro: String(e.message || e) };
    }
  }

  res.status(200).json({
    checadoEm: new Date().toISOString(),
    esperadas: {
      MP_ACCESS_TOKEN: check('MP_ACCESS_TOKEN'),
      MP_WEBHOOK_SECRET: check('MP_WEBHOOK_SECRET'),
      SUPABASE_URL: check('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: check('SUPABASE_SERVICE_ROLE_KEY'),
    },
    conexaoSupabase: supabase,
    nomesEncontradosNoAmbiente: variantes,
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
